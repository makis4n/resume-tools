/**
 * The PDF spike's first set (item 3): the editor's own PDFs. Each built-in template, Jake's Resume,
 * AltaCV and Awesome-CV, typesets each of the curated packages' invented sample resumes, compiled
 * by the editor's engine as the editor compiles a document and made into a PDF as the editor
 * exports one. Each PDF is written beside its truth, the resume it was made from, under
 * `fixtures/builtin/`, which git ignores: the engine makes them again on every run.
 *
 * The editor's modules are written for Vite, with `?raw` imports, which Node cannot load, so they
 * load through Vite's module runner with the app's own config, as `measure.ts` does; this file
 * imports nothing of the editor itself but types.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
// Node runs this file by stripping its types, so the type imports need their real extensions.
import type { EngineManifest } from "../../src/engine/manifest.ts";

type NodeEngine = typeof import("../../src/engine/node.ts");
type Curated = typeof import("../../src/templates/curated.ts");
type Generate = typeof import("../../src/templates/generate.ts");
type Package = typeof import("../../src/templates/package.ts");
type Fonts = typeof import("../../src/page/fonts.ts");
type TexLive = typeof import("../../src/page/texlive.ts");

const APP = fileURLToPath(new URL("../..", import.meta.url));

/** Where the first set's PDFs and truths go. */
export const BUILTIN_DIR = fileURLToPath(new URL("./fixtures/builtin/", import.meta.url));

/** One PDF of the first set: the template, the resume, and the files. */
export interface BuiltinPdf {
  /** `<template>--<resume's sample>`, as `jake--altacv`. */
  id: string;
  template: string;
  resume: string;
  pdf: string;
  truth: string;
  /** Milliseconds the compile and the PDF took. */
  ms: number;
  /** The characters a XeTeX template's fonts could not set, which the body left out. */
  dropped: string[];
}

/**
 * Compile every built-in template with every curated sample resume, and write each PDF and its
 * truth under `BUILTIN_DIR`. Throws when the engine is missing or a compile fails, since a failed
 * compile of a curated template is a bug the suite would catch.
 */
export async function makeBuiltinPdfs(
  say: (line: string) => void = () => undefined,
): Promise<BuiltinPdf[]> {
  const config = await resolveConfig(
    { root: APP, logLevel: "warn", ssr: { noExternal: ["opentype.js"] } },
    "serve",
  );
  const environment = createRunnableDevEnvironment("ssr", config, { hot: false });
  await environment.init();
  const { runner } = environment;
  try {
    const { ENGINE_DIR, engineAvailable, startNodeSession } =
      await runner.import<NodeEngine>("/src/engine/node.ts");
    if (!engineAvailable()) throw new Error("There is no .engine/: run fetch-engine first.");
    const { CURATED } = await runner.import<Curated>("/src/templates/curated.ts");
    const { generateBody, generateFormat } = await runner.import<Generate>(
      "/src/templates/generate.ts",
    );
    const { defaultControls, fontFiles } = await runner.import<Package>(
      "/src/templates/package.ts",
    );
    const { FontLibrary } = await runner.import<Fonts>("/src/page/fonts.ts");
    const { TexLiveIndex } = await runner.import<TexLive>("/src/page/texlive.ts");
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    const fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    const session = await startNodeSession();
    mkdirSync(BUILTIN_DIR, { recursive: true });
    const samples = [...CURATED.values()].map(({ package: pkg, sample }) => ({
      id: pkg.id,
      sample,
    }));
    const made: BuiltinPdf[] = [];
    for (const { package: pkg } of CURATED.values()) {
      const values = defaultControls(pkg);
      const files = fontFiles(pkg);
      const covers = files.length === 0 ? undefined : (await fonts.coverage(files)).covers;
      const format = generateFormat(pkg, values);
      const dumped = session.dump(pkg.engine, format.name, format.preamble, format.files);
      if (!dumped.ok) throw new Error(`${pkg.id}'s format did not dump`);
      for (const { id: resumeId, sample } of samples) {
        const started = performance.now();
        const id = `${pkg.id}--${resumeId}`;
        const job = `spike-${pkg.id}`;
        session.forget(job);
        const body = generateBody(pkg, sample, values, covers === undefined ? {} : { covers });
        const result = session.compile(pkg.engine, format.name, body.latex, {
          job,
          maxPasses: 3,
        });
        if (!result.ok) throw new Error(`${id} did not compile`);
        const pdf = session.pdf(job);
        if (!pdf.ok || pdf.pdf === undefined) throw new Error(`${id} made no PDF: ${pdf.error}`);
        const pdfPath = join(BUILTIN_DIR, `${id}.pdf`);
        const truthPath = join(BUILTIN_DIR, `${id}.truth.json`);
        writeFileSync(pdfPath, pdf.pdf);
        writeFileSync(truthPath, `${JSON.stringify(sample, null, 2)}\n`);
        const ms = performance.now() - started;
        made.push({
          id,
          template: pkg.id,
          resume: resumeId,
          pdf: pdfPath,
          truth: truthPath,
          ms,
          dropped: body.dropped,
        });
        say(`${id}: ${pdf.pdf.length} bytes, ${Math.round(ms)} ms`);
      }
    }
    return made;
  } finally {
    await environment.close();
  }
}
