/**
 * The import's measurement page, which the app shows in place of the editor at `?measure=import`,
 * and `?measure=import-xetex` for XeTeX (milestone 3 item 19, decision 0045), so that the import
 * can be timed in a browser with nothing installed but the dev server. It is a developer's page,
 * not a user's.
 *
 * It takes the upstream sample `import.ts` names for the engine, Jake's Resume for pdfTeX and
 * Awesome-CV for XeTeX, as the dev server serves it (`scripts/serve-samples.ts`, once `corpus
 * oracle` has fetched it), and imports it as the document list imports a file, through the editor's
 * compile scheduler and the worker, reads its report as the app does, then opens what it comes to,
 * to its first drawn page, without waiting for a Continue where the report is partial
 * (`measureImport`). Each import is on a new worker, as a newly opened editor's is, with fonts of
 * its own; the first is not counted, since it fills the HTTP cache, and the next five are timed. The
 * table goes under the page's heading as text, and to the console, with the verdict against the
 * import's bar, under 8 s since decision 0045 raised it (`IMPORT_TARGET`), judged with the engine's
 * start and without `load`, on pdfTeX; XeTeX's import is reported beside it, not judged. Nothing of
 * the sample is shown, and nothing is kept.
 */

import { useEffect, useState } from "react";
import { EngineClient } from "../engine/client";
import type { EngineManifest } from "../engine/manifest";
import type { Engine } from "../engine/session";
import { engineTag, fileUrl, manifestUrl } from "../engine/urls";
import type { Upload } from "../import/intake";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import {
  formatTime,
  IMPORT_RUNS,
  IMPORT_SAMPLES,
  type ImportMeasured,
  type ImportRuns,
  importRuns,
  importTable,
  isRefused,
  measureImport,
} from "./import";

/**
 * The engine a location's `?measure=` asks the import to be measured on: pdfTeX for `import`,
 * XeTeX for `import-xetex`. Undefined for any other value, and when the location does not ask.
 */
export function measuredImport(search: string): Engine | undefined {
  const value = new URLSearchParams(search).get("measure");
  return value === "import" ? "pdftex" : value === "import-xetex" ? "xetex" : undefined;
}

/** Where the dev server serves a sample: `scripts/serve-samples.ts`'s route. */
export const sampleUrl = (id: string) => `/measure/samples/${encodeURIComponent(id)}.zip`;

async function get(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`${url}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  return response;
}

/**
 * How an import is measured in this browser, once its sample and the tree's manifest are fetched:
 * an engine on a new worker, started before the import as the app's would be, and fonts of their
 * own, read through the HTTP cache as the app reads them.
 */
export async function inThisBrowser(engine: Engine): Promise<() => Promise<ImportMeasured>> {
  const { id } = IMPORT_SAMPLES[engine];
  const files: Upload[] = [
    { name: `${id}.zip`, bytes: new Uint8Array(await (await get(sampleUrl(id))).arrayBuffer()) },
  ];
  const manifest = (await (await get(manifestUrl())).json()) as EngineManifest;
  const tag = engineTag(manifest);
  const fonts = () =>
    new FontLibrary(
      new TexLiveIndex(manifest),
      async (path) => new Uint8Array(await (await get(fileUrl(tag, path))).arrayBuffer()),
    );
  return () =>
    measureImport({
      start: async () => {
        const client = new EngineClient();
        try {
          await client.start();
        } catch (error) {
          client.terminate();
          throw error;
        }
        return client;
      },
      fonts,
      files,
    });
}

/** What the page shows once the imports are done: the table, or the refusal that stopped them. */
export function importReport(engine: Engine, done: ImportRuns, hidden: number): string {
  const sample = IMPORT_SAMPLES[engine];
  if ("refused" in done) {
    const { reason, message } = done.refused.refused;
    const when = done.warm ? "the import that warms up" : "a timed import";
    return `${sample.name}'s upstream sample (${sample.id}) was refused in ${when} (${reason}): ${message}`;
  }
  const runs = done.runs.length;
  const how = [
    `In this browser, each import on a new worker. One import first, not counted, filled the HTTP cache; then ${runs} were timed.`,
    hidden === 0
      ? "The tab was in front throughout."
      : `The tab was hidden during ${hidden} of the ${runs} timed imports, which Chrome slows: measure again with the tab in front.`,
  ];
  return [...how, "", importTable(engine, done.runs, "browser")].join("\n");
}

export interface ImportMeasurePageProps {
  engine: Engine;
  /** How each import is measured, once what it needs is fetched; this browser's by default. */
  prepare?: (engine: Engine) => Promise<() => Promise<ImportMeasured>>;
  runs?: number;
}

export function ImportMeasurePage({
  engine,
  prepare = inThisBrowser,
  runs = IMPORT_RUNS,
}: ImportMeasurePageProps) {
  const [text, setText] = useState("Fetching the sample…");

  // React's second run of the effect in development stops the first before its first import, so
  // only the second measures.
  useEffect(() => {
    let live = true;
    const show = (line: string) => {
      if (live) setText(line);
    };
    // Whether the tab was hidden at any time during the import under way, which Chrome slows.
    const visible = () => document.visibilityState === "visible";
    let hiddenNow = !visible();
    const onVisibility = () => {
      if (!visible()) hiddenNow = true;
    };
    document.addEventListener("visibilitychange", onVisibility);
    let hidden = 0;
    const measure = async () => {
      const once = await prepare(engine);
      if (!live) return undefined;
      let current = 0;
      /** Each finished import's whole, the warm-up's first, for the line that says how far it got. */
      const took: string[] = [];
      const timed = async () => {
        hiddenNow = !visible();
        const measured = await once();
        if (current > 0 && hiddenNow) hidden++;
        if (!isRefused(measured)) took.push(formatTime(measured.ms));
        return measured;
      };
      return importRuns(
        timed,
        runs,
        (index) => {
          current = index;
          const [warm, ...timedSoFar] = took;
          show(
            index === 0
              ? "Warming up: one import from the file to the page, not counted, to fill the HTTP cache…"
              : [
                  `Timing import ${index} of ${runs}…`,
                  `The warm-up took ${warm}.`,
                  ...(timedSoFar.length > 0 ? [`So far: ${timedSoFar.join(", ")}.`] : []),
                ].join(" "),
          );
        },
        () => live,
      );
    };
    measure().then(
      (done) => {
        if (!live || done === undefined) return;
        const report = importReport(engine, done, hidden);
        console.log(report);
        show(report);
      },
      (error: unknown) => {
        if (!live) return;
        console.error("The measurement stopped:", error);
        show("The measurement stopped; the console says why.");
      },
    );
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [engine, prepare, runs]);

  return (
    <main>
      <h1>The import, from the file to the page</h1>
      <pre>{text}</pre>
    </main>
  );
}
