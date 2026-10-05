/**
 * The PDF import's measurement page, which the app shows in place of the editor at
 * `?measure=import-pdf` (milestone 3 second pass, item 18), beside the `.tex` import's
 * (`ImportMeasurePage.tsx`), so that a PDF import by rules can be timed in a browser, the slow
 * laptop's among them, with nothing installed but the dev server. It is a developer's page, not a
 * user's.
 *
 * It makes the editor's own PDF of each built-in template, typesetting its own invented sample, on
 * a worker of its own, as the editor exports one (`builtinPdfs`), and imports each by rules as the
 * app does for a person who said no (`measurePdfImport`): the reader's worker, which draws each page
 * as a picture for the review, the layout, the labels by rules with nothing sent, the filing and the
 * review's draft; then the draft set on its template on a new worker, to its first drawn page. One
 * pass over the PDFs is not counted, since it loads the reader and fills the HTTP cache, and the next
 * five are timed. The table goes under the page's heading as text, and to the console, with the
 * verdict against the target, under 1 s, judged on the slowest import. The PDFs other tools printed
 * are the Node command's alone, which reads them from the repository; nothing of any PDF is shown,
 * and nothing is kept.
 */

import { useEffect, useState } from "react";
import { DRAW_SCALE } from "../editor/pdf-import";
import { EngineClient } from "../engine/client";
import type { EngineManifest } from "../engine/manifest";
import { engineTag, fileUrl, manifestUrl } from "../engine/urls";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { readPdfFile } from "../pdf";
import { IMPORT_RUNS } from "./import";
import {
  builtinPdfs,
  formatTime,
  measurePdfImport,
  type PdfMeasured,
  type PdfRuns,
  type PdfSample,
  pdfRuns,
  pdfTable,
} from "./pdf-import";

/** Whether a location's `?measure=` asks for the PDF import's measurement. */
export const measuredPdfImport = (search: string) =>
  new URLSearchParams(search).get("measure") === "import-pdf";

async function get(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`${url}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  return response;
}

/** An engine on a new worker, started, as the app's compiler starts one. */
async function startedClient(): Promise<EngineClient> {
  const client = new EngineClient();
  try {
    await client.start();
  } catch (error) {
    client.terminate();
    throw error;
  }
  return client;
}

/** What a PDF import is measured with, and on. */
export interface PdfPrepared {
  pdfs: PdfSample[];
  once(pdf: PdfSample): Promise<PdfMeasured>;
}

/**
 * How a PDF import is measured in this browser: the built-in templates' PDFs made on a worker of
 * their own, then each import read by the reader's worker, its pages drawn as pictures, and its
 * page set on a new worker, with fonts of its own read through the HTTP cache, as the app's are.
 */
export async function pdfsInThisBrowser(): Promise<PdfPrepared> {
  const manifest = (await (await get(manifestUrl())).json()) as EngineManifest;
  const tag = engineTag(manifest);
  const fonts = () =>
    new FontLibrary(
      new TexLiveIndex(manifest),
      async (path) => new Uint8Array(await (await get(fileUrl(tag, path))).arrayBuffer()),
    );
  const pdfs = await builtinPdfs(await startedClient(), fonts());
  return {
    pdfs,
    once: (pdf) =>
      measurePdfImport(pdf, {
        read: (bytes) => readPdfFile(bytes, { drawScale: DRAW_SCALE }),
        page: { engine: startedClient, fonts },
        locale: navigator.language,
      }),
  };
}

/** What the page shows once the imports are done: the table, or the refusal that stopped them. */
export function pdfReport(done: PdfRuns, hidden: number, runs: number): string {
  if ("refused" in done) {
    const { id, refused } = done.refused;
    return `The invented PDF ${id} was refused (${refused.reason}): ${refused.message}`;
  }
  const how = [
    `In this browser. One pass over the PDFs first, not counted, loaded the reader and filled the HTTP cache; then ${runs} were timed.`,
    hidden === 0
      ? "The tab was in front throughout."
      : `The tab was hidden during ${hidden} of the ${runs} timed passes, which Chrome slows: measure again with the tab in front.`,
  ];
  return [...how, "", pdfTable(done.runs, "browser")].join("\n");
}

export interface PdfMeasurePageProps {
  /** What the imports are measured with, once it is made; this browser's by default. */
  prepare?: () => Promise<PdfPrepared>;
  runs?: number;
}

export function PdfMeasurePage({
  prepare = pdfsInThisBrowser,
  runs = IMPORT_RUNS,
}: PdfMeasurePageProps) {
  const [text, setText] = useState("Making the built-in templates' PDFs…");

  // React's second run of the effect in development stops the first before its first import, so
  // only the second measures.
  useEffect(() => {
    let live = true;
    const show = (line: string) => {
      if (live) setText(line);
    };
    const visible = () => document.visibilityState === "visible";
    let hiddenNow = !visible();
    const onVisibility = () => {
      if (!visible()) hiddenNow = true;
    };
    document.addEventListener("visibilitychange", onVisibility);
    let hidden = 0;
    let current = 0;
    const measure = async () => {
      const { pdfs, once } = await prepare();
      if (!live) return undefined;
      const took: string[] = [];
      return pdfRuns(
        pdfs,
        async (pdf) => {
          const measured = await once(pdf);
          if (!("refused" in measured)) took.push(formatTime(measured.ms));
          return measured;
        },
        runs,
        (pass) => {
          if (current > 0 && hiddenNow) hidden++;
          current = pass;
          hiddenNow = !visible();
          show(
            pass === 0
              ? `Warming up: one pass over ${pdfs.length} PDFs, not counted…`
              : `Timing pass ${pass} of ${runs}… So far: ${took.slice(pdfs.length).join(", ") || "none"}.`,
          );
        },
        () => live,
      );
    };
    measure().then(
      (done) => {
        if (!live || done === undefined) return;
        if (current > 0 && hiddenNow) hidden++;
        const report = pdfReport(done, hidden, runs);
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
  }, [prepare, runs]);

  return (
    <main>
      <h1>A PDF import by rules, from the file to the review</h1>
      <pre>{text}</pre>
    </main>
  );
}
