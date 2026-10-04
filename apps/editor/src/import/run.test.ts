import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { outlineNodes, Resume } from "@resume-tools/resume-model";
import { strToU8, unzipSync } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import { Compiler, type Engine, type Shown } from "../editor/compiler";
import { type Document, History } from "../editor/document";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { DocumentStore } from "../storage/store";
import { generateBody, generateFormat } from "../templates/generate";
import { resolveTemplate, type Template } from "../templates/resolve";
import { JAKE_FORK } from "../test/jake-fork";
import { XETEX_RESUME } from "../test/xetex-resume";
import { readTree } from "./fonts";
import { standIn } from "./images";
import { treeImages } from "./intake";
import { isRefusal } from "./refusal";
import { reportOfImport } from "./report";
import {
  IMPORT_STEPS,
  type ImportDeps,
  type Imported,
  type ImportProgress,
  importResume,
  uploadOf,
} from "./run";

// Every file here is invented for these tests: the fork of Jake's Resume holds invented words in
// the template's own shape (`../test/jake-fork.ts`); nothing is a real person's resume.

const tex = (name: string, text: string) => ({ name, bytes: strToU8(text) });

/**
 * The fork with a picture in its heading, a PNG the upload holds beside it, which the job keeps a
 * stand-in of, so that a document compiled without its job's files stops.
 */
const WITH_PHOTO = JAKE_FORK.replace(
  "\\usepackage{tabularx}\n",
  "\\usepackage{tabularx}\n\\usepackage{graphicx}\n",
).replace("\\begin{center}\n", "\\begin{center}\n    \\includegraphics[height=1cm]{photo} \\\\\n");

/** An invented picture of 60 by 60 pixels, blank, as the upload's photo. */
const PHOTO = {
  name: "photo.png",
  bytes: standIn({ kind: "png", width: 60, height: 60, xdpi: 72, ydpi: 72 }),
};

describe("uploadOf", () => {
  test("takes one file as it is, and packs several into a zip at their names", () => {
    const one = tex("cv.tex", "\\documentclass{article}");
    expect(uploadOf([one])).toBe(one);
    const packed = uploadOf([one, tex("invented.cls", "\\ProvidesClass{invented}")]);
    if (isRefusal(packed)) throw new Error(packed.message);
    expect(packed.name).toBe("upload.zip");
    expect(Object.keys(unzipSync(packed.bytes)).sort()).toEqual(["cv.tex", "invented.cls"]);
  });

  test("refuses no file, a zip among several, and two files of one name, in plain words", () => {
    expect(uploadOf([])).toMatchObject({ refused: true, reason: "intake" });
    const zip = { name: "resume.zip", bytes: new Uint8Array([0x50, 0x4b, 3, 4]) };
    expect(uploadOf([tex("cv.tex", ""), zip])).toMatchObject({
      message: "Upload one zip on its own, or your .tex file with the files it needs beside it.",
    });
    expect(uploadOf([tex("cv.tex", ""), tex("cv.tex", "")])).toMatchObject({
      message: "This upload holds two files named cv.tex.",
    });
  });
});

/** The outline's fields, groups and units, by kind, as an import made them. */
function nodesOf(imported: Imported) {
  const [section] = imported.document.resume.sections;
  if (section?.kind !== "outline") throw new Error("the import holds no outline");
  const found = { fields: [] as string[], groups: 0, units: 0 };
  for (const step of outlineNodes(section.parts))
    if (step.kind === "unit") found.units++;
    else if (step.part.kind === "group") found.groups++;
    else if (step.part.kind !== "kept") found.fields.push(step.part.id);
  return found;
}

describe.skipIf(!engineAvailable())("an import, on the engine (decisions 0038 and 0049)", () => {
  let session: EngineSession;
  let deps: ImportDeps;
  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    deps = {
      session,
      fonts: new FontLibrary(new TexLiveIndex(manifest), async (path) =>
        readFileSync(join(ENGINE_DIR, "files", path)),
      ),
      tree: readTree(manifest.files, manifest.fonts),
      treeImage: treeImages(
        manifest.files,
        (path) => new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path))),
      ),
    };
  }, 60_000);

  /** The compile engine the app's worker is, over a Node session, as the compiler takes one. */
  const engineOf = (on: EngineSession) => (): Engine => ({
    start: async () => {},
    dump: async (kind, name, preamble, files) => on.dump(kind, name, preamble, files),
    putFormat: async (kind, name, format) => on.putFormat(kind, name, format),
    forget: async (job) => on.forget(job),
    compile: async (kind, format, body, options) => on.compile(kind, format, body, options),
    pdf: async (job, options) => on.pdf(job, options),
    dropFormat: async (kind, name) => on.dropFormat(kind, name),
    terminate: () => {},
  });

  /**
   * A compiler over a session, the test's by default, and the next page it shows, or its message
   * if it shows none.
   */
  function editor(store: DocumentStore, on: EngineSession = session) {
    let onPage: (shown: Shown) => void = () => {};
    let onError: (error: Error) => void = () => {};
    const compiler = new Compiler(
      engineOf(on),
      deps.fonts,
      {
        page: (shown) => onPage(shown),
        error: (message) => onError(new Error(message)),
        busy: () => {},
      },
      { formats: store.formatsFor("test") },
    );
    const nextPage = () =>
      new Promise<Shown>((resolve, reject) => {
        onPage = resolve;
        onError = reject;
      });
    return { compiler, nextPage };
  }

  /** A document's template as the app resolves it, which must be there. */
  async function templateOf(store: DocumentStore, doc: Document, id: string): Promise<Template> {
    const template = await resolveTemplate(doc.template, id, store);
    if (template === undefined) throw new Error(`no template ${doc.template}`);
    return template;
  }

  /** An import of `source` as the main file, which must come through. */
  async function imported(source: string, ...more: { name: string; bytes: Uint8Array }[]) {
    const outcome = await importResume([tex("resume.tex", source), ...more], deps);
    if (isRefusal(outcome)) throw new Error(`refused: ${outcome.message}\n${outcome.log ?? ""}`);
    return outcome;
  }

  /**
   * Whether a resume compiles through an import's package, from its format, in a job given what the
   * import keeps for its compiles, as the editor's compiles are given it.
   */
  function compiles(done: Imported, resume: Document["resume"]): boolean {
    const pkg = done.package;
    const format = generateFormat(pkg, {});
    const files = {
      ...done.job.files,
      ...(done.job.bbl === undefined ? {} : { "check.bbl": done.job.bbl }),
    };
    try {
      if (!session.dump(pkg.engine, format.name, format.preamble, pkg.files).ok) return false;
      const body = generateBody(pkg, resume, {}).latex;
      return session.compile(pkg.engine, format.name, body, { job: "check", maxPasses: 3, files })
        .ok;
    } finally {
      session.dropFormat(pkg.engine, format.name);
      session.forget("check");
    }
  }

  test("imports a fork of Jake's Resume as an outline, which opens, downloads and opens after a reload", async () => {
    const steps: ImportProgress[] = [];
    // With a picture beside it, which its compiles need: its job keeps a stand-in of it.
    const outcome = await importResume([tex("resume.tex", WITH_PHOTO), PHOTO], deps, (step) =>
      steps.push(step),
    );
    if (isRefusal(outcome)) throw new Error(`refused: ${outcome.message}`);
    const done: Imported = outcome;
    // Each step named in plain words, in order, the compiles counted as they came: no request is
    // built and no service is asked (decision 0049).
    expect([...new Set(steps.map((step) => step.step))]).toEqual([
      "intake",
      "reference",
      "fonts",
      "signatures",
      "parse",
      "probe",
      "outline",
      "validate",
    ]);
    expect(steps.every((step) => step.label === IMPORT_STEPS[step.step])).toBe(true);
    expect(steps.at(-1)?.compiles).toBe(done.report.compiles);
    expect(done.package.id).toMatch(/^import-[0-9a-f]{12}$/);
    expect(done.package.snippets.document).toBe("{{sections}}");
    expect(done.document.template).toBe(done.package.id);
    // One section, the outline, which holds the whole body from `\begin{document}` on.
    expect(done.document.resume.sections.map((section) => section.kind)).toEqual(["outline"]);
    const nodes = nodesOf(done);
    expect(nodes.fields.length).toBe(done.report.outline.fields);
    expect(done.report.outline.fields).toBeGreaterThan(20);
    // The entries, the bullets of each and the sections are groups of units.
    expect(done.report.outline.groups).toBe(nodes.groups);
    expect(done.report.outline.groups).toBeGreaterThanOrEqual(4);
    expect(done.report.outline.units).toBe(nodes.units);
    // The outline compiled sets the reference's page.
    expect(done.report.checks.outcome).toBe("assembled");
    expect(done.upload).toEqual({ files: [tex("resume.tex", WITH_PHOTO), PHOTO] });
    // The job's files are the upload's but for the main file, which the body replaces, the
    // picture's stand-in among them, which the PDF may show; the body cannot do without them.
    expect(Object.keys(done.job.files)).not.toContain("resume.tex");
    expect(Object.keys(done.job.files)).toEqual(expect.arrayContaining(["photo.png", "photo.xbb"]));
    expect(done.job.images).toEqual(["photo.png"]);
    expect(compiles(done, done.document.resume)).toBe(true);
    expect(compiles({ ...done, job: { files: {}, images: [] } }, done.document.resume)).toBe(false);
    // The format the editor opens with, as the import dumped it.
    expect(done.formats?.map((each) => each.name)).toEqual([generateFormat(done.package, {}).name]);
    // The import forgot its jobs.
    expect(session.written("import", "import.tex")).toBeUndefined();

    // Kept, and opened as any document is, with its package from the store; the page marks every
    // field the outline holds, each spelling its text.
    const name = `resume-tools-import-${Date.now()}`;
    const store = new DocumentStore({ name });
    const id = await store.importDocument(done);
    const stored = await store.get(id);
    if (stored === undefined) throw new Error("not stored");
    const template = await templateOf(store, stored.document, id);
    expect(template.package).toEqual(done.package);
    const { compiler, nextPage } = editor(store);
    const history = new History(stored.document, template.package);
    let next = nextPage();
    compiler.open(template.package, history.present, template.job);
    const first = await next;
    expect(first.page.unmatched).toBe(0);
    const marked = [...first.pages.flatMap((page) => [...page.fields.keys()])];
    expect(new Set(marked)).toEqual(new Set(nodes.fields.map((field) => `${field}.text`)));
    const pdf = await compiler.pdf();
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
    compiler.close();
    await store.close();

    // After a reload: a new store over the same database, a new compiler and a new TeX session,
    // which holds nothing of the first, so that the page needs what the store kept.
    const reloaded = new DocumentStore({ name });
    expect((await reloaded.list()).map((each) => [each.id, each.templateName])).toEqual([
      [id, done.package.name],
    ]);
    const again = await reloaded.get(id);
    if (again === undefined) throw new Error("lost in the reload");
    expect(Resume.parse(again.document.resume)).toEqual(done.document.resume);
    const reopened = await templateOf(reloaded, again.document, id);
    expect(reopened.job).toEqual(done.job);
    const later = editor(reloaded, await startNodeSession());
    next = later.nextPage();
    later.compiler.open(reopened.package, again.document, reopened.job);
    const shown = await next;
    expect(shown.page.unmatched).toBe(0);
    expect(shown.page.fields.size).toBe(first.page.fields.size);
    later.compiler.close();
    // Its last document gone, the package goes, and its formats with it.
    expect(await reloaded.remove(id)).toBe(done.package.id);
    await reloaded.close();
  }, 60_000);

  // The hand count of decision 0039, over the fork's page, its words invented: 92 words, every one
  // the resume's. The first pass kept its heading and its skills as the upload wrote them; the
  // outline holds the words of both where the probe proved them, in fields.
  test("reports the fork's words in fields, in kept text and locked, out of 92", async () => {
    const done = await imported(JAKE_FORK);
    const { words } = done.report.outline;
    expect(Math.abs(words.body - 92)).toBeLessThanOrEqual(2);
    expect(words.template).toBe(0);
    expect(words.fields + words.retype + words.locked).toBe(words.body);
    expect(words.fields).toBeGreaterThanOrEqual(80);
    // The report reads the same words, those in fields editable on the page.
    const report = reportOfImport(done);
    expect(report.matched).toBe(true);
    expect(report.words.body).toBe(words.body);
    expect(report.words.editable).toBe(words.fields);
    expect(report.words.locked).toBe(words.retype + words.locked);
    // Kept text is named by its first words, never by a command.
    expect(report.locked.every((each) => !/[\\{}]/.test(each.words))).toBe(true);
  }, 60_000);

  test("imports a resume on XeTeX from a saved format, its name a field through the preamble", async () => {
    const steps: ImportProgress[] = [];
    const outcome = await importResume([tex("resume.tex", XETEX_RESUME)], deps, (step) =>
      steps.push(step),
    );
    if (isRefusal(outcome)) throw new Error(`refused: ${outcome.message}\n${outcome.log ?? ""}`);
    // The fonts go by file before the signatures, the parse and the probe.
    expect([...new Set(steps.map((step) => step.step))]).toEqual([
      "intake",
      "reference",
      "fonts",
      "rewrite",
      "signatures",
      "parse",
      "probe",
      "outline",
      "validate",
    ]);
    expect(outcome.package.engine).toBe("xetex");
    expect(outcome.package.fonts?.length).toBeGreaterThan(0);
    // The rewritten preamble dumps: the package's format is the one the editor opens with.
    expect(outcome.formats?.map((each) => each.name)).toEqual([
      generateFormat(outcome.package, {}).name,
    ]);
    expect(outcome.package.preamble).not.toContain("\\usepackage{fontspec}");
    expect(outcome.package.preamble).toContain("\\usepackage{rt-fontspec}");
    expect(outcome.report.checks.outcome).toBe("assembled");
    // The preamble's call that stores the name, issued again with its two fields before the
    // document begins, and the body's fields after.
    const [section] = outcome.document.resume.sections;
    if (section?.kind !== "outline") throw new Error("no outline");
    const [call, first, between, last] = section.parts;
    expect(call).toEqual({ kind: "kept", latex: "\\name{" });
    expect(first).toMatchObject({ kind: "rich", text: [{ text: "Quill" }] });
    expect(between).toEqual({ kind: "kept", latex: "}{" });
    expect(last).toMatchObject({ kind: "rich", text: [{ text: "Wren" }] });
    expect(section.parts[4]).toMatchObject({ kind: "kept" });
    expect(section.parts[4]?.kind === "kept" && section.parts[4].latex).toBe(
      "}\n\\begin{document}\n\\makeheader\n",
    );
    // The two headings, each with what follows it up to the next, are a group of two units.
    expect(section.parts[5]).toMatchObject({ kind: "group" });
    expect(section.parts[5]?.kind === "group" && section.parts[5].units.length).toBe(2);
    const { words } = outcome.report.outline;
    expect(words.fields).toBe(words.body);
    expect(compiles(outcome, outcome.document.resume)).toBe(true);
  }, 60_000);

  test("stops between compiles when its signal is aborted, and forgets its jobs", async () => {
    const stop = new AbortController();
    const reason = new Error("stopped by the test");
    const run = importResume(
      [tex("resume.tex", JAKE_FORK)],
      deps,
      (step) => {
        if (step.step === "signatures" && !step.compiling) stop.abort(reason);
      },
      stop.signal,
    );
    await expect(run).rejects.toBe(reason);
    expect(session.written("import", "import.tex")).toBeUndefined();
  }, 60_000);
});
