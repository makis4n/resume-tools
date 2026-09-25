/**
 * The measurement page, which the app shows in place of the editor at `?measure=1` (milestone 2
 * item 23, decision 0016), so that the targets of plan section 4.3 can be read on the slow laptop
 * with nothing installed but the dev server. It is a developer's page, not a user's.
 *
 * It opens a curated package's sample as a new document, Jake's Resume unless `?measure=<id>`
 * names another package, and times the page as the app makes it, through the worker: the
 * engine's start and the first page (`Shown.startMs` and `Shown.ms`); the overlay's row layout of
 * the sample's longest field, as a keystroke there lays it out (`keystrokeWork`); and ten edits of
 * that field, one after another, each a command through the history and an `update`, timed from
 * the command to the page it brings, the scheduler's pause included, and by the page's own time.
 * The medians go to the console and under the page. Nothing is kept, so every load dumps the
 * format, and TeX's words stay in the console.
 */

import { useEffect, useState } from "react";
import { Compiler, type CompilerEvents, type Shown } from "../editor/compiler";
import { type Document, History, newDocument } from "../editor/document";
import { EngineClient } from "../engine/client";
import type { EngineManifest } from "../engine/manifest";
import { engineTag, fileUrl, manifestUrl } from "../engine/urls";
import { FontLibrary } from "../page/fonts";
import { Page } from "../page/Page";
import { TexLiveIndex } from "../page/texlive";
import { CURATED } from "../templates/curated";
import {
  editCommand,
  formatLimit,
  formatMs,
  type Keystroke,
  keystrokeWork,
  longestField,
  median,
  meets,
  TARGETS,
  table,
} from "./measure";

/** The package `?measure=1` measures: the one new documents start from. */
const DEFAULT_TEMPLATE = "jake";

/** Edits timed, and row layouts. */
const EDITS = 10;
const LAYOUTS = 100;

/**
 * The package a location's `?measure=` asks to measure, by id: Jake's Resume for `1`, or the one
 * the value names. Undefined when the location does not ask, and the app is the editor.
 */
export function measuredTemplate(search: string): string | undefined {
  const value = new URLSearchParams(search).get("measure");
  if (value === null) return undefined;
  return value === "1" || value === "" ? DEFAULT_TEMPLATE : value;
}

/** The fonts the page is drawn with, from the engine's tree, as the app reads them. */
async function treeFonts(): Promise<FontLibrary> {
  const get = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response;
  };
  const manifest = (await (await get(manifestUrl())).json()) as EngineManifest;
  const tag = engineTag(manifest);
  return new FontLibrary(
    new TexLiveIndex(manifest),
    async (path) => new Uint8Array(await (await get(fileUrl(tag, path))).arrayBuffer()),
  );
}

/** What the page measured. */
interface Measured {
  name: string;
  id: string;
  engine: string;
  first: Shown;
  keystroke: Keystroke;
  /** Each edit's time from its command to its page, the scheduler's pause included. */
  edits: number[];
  /** Each edit's page's own time, `Shown.ms`: compiled and drawn. */
  pages: number[];
}

/** The measurements as the console and the page show them. */
function report({ name, id, engine, first, keystroke, edits, pages }: Measured): string {
  const edit = median(pages);
  const slowest = formatMs(Math.max(...edits));
  const verdict = (target: (typeof TARGETS)[keyof typeof TARGETS], value: number) => [
    target.path,
    formatLimit(target),
    `${formatMs(value)} ${meets(target, value) ? "met" : "missed"}`,
  ];
  return [
    `${name} (${id}, ${engine}), in this browser`,
    table([
      ["Engine start", formatMs(first.startMs ?? 0), "once per worker"],
      ["First page", formatMs(first.ms), "the format dumped, two passes, the page drawn"],
      [
        `Edit to page, median of ${edits.length}`,
        formatMs(median(edits)),
        `from the command, the pause before the compile included; slowest ${slowest}`,
      ],
      [`Edit's page, median of ${pages.length}`, formatMs(edit), "compiled and drawn, no pause"],
      [
        `Keystroke rows, median of ${keystroke.runs}`,
        formatMs(keystroke.ms),
        `${keystroke.field}, ${keystroke.characters} characters on ${keystroke.rows} lines`,
      ],
    ]),
    "",
    "Against plan section 4.3, an edit by its page's own time",
    table([
      verdict(TARGETS.keystroke, keystroke.ms),
      verdict(TARGETS.typical, edit),
      verdict(TARGETS.slowLaptop, edit),
    ]),
  ].join("\n");
}

export function MeasurePage({ template }: { template: string }) {
  const [shown, setShown] = useState<Shown>();
  const [text, setText] = useState("Measuring…");

  // The effect owns the compiler and its worker, so React's second run in development closes the
  // first, and only the second measures.
  useEffect(() => {
    let live = true;
    let compiler: Compiler | undefined;
    /** The document whose page the measurement waits for. */
    let waiting:
      | { doc: Document; resolve: (shown: Shown) => void; reject: (error: Error) => void }
      | undefined;
    const pageOf = (doc: Document) =>
      new Promise<Shown>((resolve, reject) => {
        waiting = { doc, resolve, reject };
      });
    const events: CompilerEvents = {
      page: (latest) => {
        if (!live) return;
        setShown(latest);
        const settle = waiting;
        if (settle?.doc !== latest.document) return;
        waiting = undefined;
        settle.resolve(latest);
      },
      error: (message) => {
        const settle = waiting;
        waiting = undefined;
        settle?.reject(new Error(message));
      },
      busy: () => {},
    };

    const measure = async (): Promise<Measured | undefined> => {
      const found = CURATED.get(template);
      if (found === undefined)
        throw new Error(`no curated template has the id ${template}: ${[...CURATED.keys()]}`);
      const { package: pkg, sample } = found;
      const fonts = await treeFonts();
      if (!live) return undefined;
      compiler = new Compiler(() => new EngineClient(), fonts, events);
      const doc = newDocument(pkg.id, sample);
      const history = new History(doc);
      const opened = pageOf(doc);
      compiler.open(pkg, doc);
      const first = await opened;
      const field = longestField(doc.resume, first.page);
      if (field === undefined) throw new Error("the page shows no field of the sample to edit");
      const keystroke = await keystrokeWork(first.page, doc.resume, fonts, field, LAYOUTS);
      const edits: number[] = [];
      const pages: number[] = [];
      for (let i = 0; i < EDITS; i++) {
        if (!live) return undefined;
        const started = performance.now();
        const next = history.dispatch(editCommand(history.present, field.id));
        const edited = pageOf(next);
        compiler.update(next);
        const page = await edited;
        edits.push(performance.now() - started);
        pages.push(page.ms);
      }
      return { name: pkg.name, id: pkg.id, engine: pkg.engine, first, keystroke, edits, pages };
    };

    measure().then(
      (measured) => {
        if (!live || measured === undefined) return;
        const shownText = report(measured);
        console.log(shownText);
        setText(shownText);
      },
      (error: unknown) => {
        if (!live) return;
        console.error("The measurement stopped:", error);
        setText("The measurement stopped; the console says why.");
      },
    );
    return () => {
      live = false;
      compiler?.close();
    };
  }, [template]);

  return (
    <main>
      {shown && <Page svg={shown.page.svg} />}
      <pre>{text}</pre>
    </main>
  );
}
