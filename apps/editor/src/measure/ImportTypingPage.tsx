/**
 * The page that times typing on an imported resume, which the app shows in place of the editor at
 * `?measure=import-typing` (the perf run's lane D2), so that an edit after an import can be timed in
 * a browser with nothing installed but the dev server. It is a developer's page, not a user's.
 *
 * It takes each launch template's upstream sample (`TYPING_SAMPLES`): Jake's Resume, AltaCV and
 * Awesome-CV, or the one `&sample=<id>` names, as the dev server serves it (`scripts/serve-samples.ts`,
 * once `corpus oracle` has fetched it), and imports it as the import's own page does
 * (`browserImport`), through the editor's compile scheduler and a new worker, opening what it comes
 * to without waiting for a Continue; then, on that scheduler and worker, as the app keeps them, it
 * edits the longest editable field five times, each edit timed from its command to its drawn page,
 * split into the scheduler's pause, the compile and the draw (`measureImportTyping`). The table goes
 * under the page's heading as text, and to the console. Nothing of the samples is shown, and
 * nothing is kept.
 */

import { useEffect, useState } from "react";
import { browserImport } from "./ImportMeasurePage";
import {
  familyOf,
  familyTable,
  type ImportTypingMeasured,
  measureImportTyping,
  noneSkipped,
  skip,
  summaryLines,
  TYPING_EDITS,
  TYPING_SAMPLES,
  type TypingRow,
  typingRow,
  typingTable,
} from "./import-typing";

/**
 * The samples a location's `?measure=import-typing` asks to type on: every launch template's, or
 * the one `sample` names, none when it names no upstream sample. Undefined when the location asks
 * for another page.
 */
export function measuredImportTyping(search: string): string[] | undefined {
  const params = new URLSearchParams(search);
  if (params.get("measure") !== "import-typing") return undefined;
  const sample = params.get("sample");
  const ids = TYPING_SAMPLES.map((each) => each.id);
  return sample === null ? ids : ids.filter((id) => id === sample);
}

/** How a sample is imported and typed on in this browser, once what it needs is fetched. */
async function inThisBrowser(id: string, edits: number) {
  const how = await browserImport(id);
  return () => measureImportTyping(how, edits);
}

/** A sample's name, by its id. */
const nameOf = (id: string) => TYPING_SAMPLES.find((each) => each.id === id)?.name ?? id;

/** What the page shows once every sample is done: the tables and the summary. */
export function typingReport(
  rows: readonly TypingRow[],
  skipped: ReturnType<typeof noneSkipped>,
  edits: number,
  hidden: number,
): string {
  return [
    `In this browser, each sample imported once on a new worker and opened; then ${edits} edits of its longest editable field timed on that worker.`,
    hidden === 0
      ? "The tab was in front throughout."
      : `The tab was hidden while ${hidden} of the samples were typed on, which Chrome slows: measure again with the tab in front.`,
    "",
    typingTable(rows),
    "",
    familyTable(rows),
    "",
    ...summaryLines(rows, skipped),
  ].join("\n");
}

export interface ImportTypingPageProps {
  /** The upstream samples to type on, by id. */
  samples: readonly string[];
  /** How each sample is imported and typed on; this browser's by default. */
  prepare?: (id: string, edits: number) => Promise<() => Promise<ImportTypingMeasured>>;
  edits?: number;
}

export function ImportTypingPage({
  samples,
  prepare = inThisBrowser,
  edits = TYPING_EDITS,
}: ImportTypingPageProps) {
  const [text, setText] = useState("Fetching the samples…");

  // React's second run of the effect in development stops the first before its first import, so
  // only the second measures.
  useEffect(() => {
    let live = true;
    const show = (line: string) => {
      if (live) setText(line);
    };
    // Whether the tab was hidden at any time during the sample under way, which Chrome slows.
    const visible = () => document.visibilityState === "visible";
    let hiddenNow = !visible();
    const onVisibility = () => {
      if (!visible()) hiddenNow = true;
    };
    document.addEventListener("visibilitychange", onVisibility);
    const measure = async () => {
      if (samples.length === 0)
        throw new Error(
          `no upstream sample to type on: &sample= takes ${TYPING_SAMPLES.map((each) => each.id).join(", ")}`,
        );
      const rows: TypingRow[] = [];
      const skipped = noneSkipped();
      let hidden = 0;
      for (const [index, id] of samples.entries()) {
        if (!live) return undefined;
        show(
          `Importing ${nameOf(id)}'s upstream sample (${id}), ${index + 1} of ${samples.length}, then timing ${edits} edits…`,
        );
        const once = await prepare(id, edits);
        if (!live) return undefined;
        hiddenNow = !visible();
        const measured = await once();
        if (hiddenNow) hidden++;
        if ("refused" in measured || !measured.typing.typed) skip(skipped, measured);
        else
          rows.push(
            typingRow(id, familyOf(id), {
              import: measured.import,
              typing: measured.typing,
            }),
          );
      }
      return typingReport(rows, skipped, edits, hidden);
    };
    measure().then(
      (report) => {
        if (!live || report === undefined) return;
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
  }, [samples, prepare, edits]);

  return (
    <main>
      <h1>Typing on an imported resume</h1>
      <pre>{text}</pre>
    </main>
  );
}
