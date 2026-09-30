/**
 * The reference compile over the corpus (milestone 3 item 3, decision 0019): `corpus reference`
 * takes each fetched document in as a person's zip of it would come in (`src/import/intake.ts`),
 * compiles it to a reference or refuses it (`src/import/reference.ts`), and prints one table of
 * what became of them, per family and in all.
 *
 * The engine session's calls are synchronous, so a document that loops would hold a whole run, and
 * nothing in its thread could stop it. So the documents go to a pool of child processes
 * (`corpus-reference-child.ts`), each with an engine session and fonts of its own, one document at
 * a time; a document gets LIMIT_MS, after which its child is killed, another started in its place,
 * and the document counted as timed out.
 *
 * A document's zip holds its files at their paths in its repository, as the manifest names them,
 * and, for each font the manifest names beside its main file, the tree's file of that name when
 * the tree has one: the corpus fetches no font (decision 0017), and a person's zip would hold them.
 * It holds no image, which the corpus only counts; `\includegraphics` gets stand-ins for them.
 *
 * What is printed and written names classes, packages, fonts, files and commands, and counts,
 * never a document's text: a name only when it is plainly one (`shownName`), and every line
 * through `printable`. A document's log, which quotes its source, is written under `.corpus/`
 * alone, for a developer to read.
 */

import { type ChildProcess, fork } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { fileKey } from "../src/import/fonts.ts";
import type { Intake, StandIn } from "../src/import/intake.ts";
import type { Reference } from "../src/import/reference.ts";
import { REFUSAL_REASONS, type Refusal, type RefusalReason } from "../src/import/refusal.ts";
import { FAMILIES, type Family, type LiveDocument, printable } from "./corpus-manifest.ts";
import { shownName } from "./corpus-survey.ts";

/** How long one document may take, intake and compiles together, before its child is killed. */
export const LIMIT_MS = 90_000;

/** How many child processes compile at once. */
export const POOL_SIZE = 4;

/** What became of a document: a reference, or the reason it was refused. */
export type Outcome = "reference" | RefusalReason;

/** One document's row: names and numbers only, never its text. */
export interface ReferenceRow {
  id: string;
  family: Family;
  outcome: Outcome;
  /**
   * The template, package, font or file a refusal names, or the command a compile stopped on, as
   * shown (`shownName`).
   */
  name?: string;
  /** For a compile that stopped, what kind of error stopped it (`stoppedKind`). */
  stopped?: string;
  /** The engine the source asks for, and the one the reference compiled on. */
  source?: Intake["source"];
  engine?: Reference["engine"];
  pages?: number;
  /** Milliseconds of every pass the reference took, compiles run again among them. */
  ms?: number;
  /** The passes of the compile that made the reference. */
  passes?: number;
  fonts?: { tex: number; native: number; shipped: number };
  /**
   * The intake's stand-ins, and those the compile added; of them all, those for an image the
   * upload lacked, 1 by 1, and those for the tree's, at its size; and the images dropped.
   */
  images?: { replaced: number; added: number; missing: number; tree: number; dropped: number };
  /** How many warnings that matter the log gave (`warningsOf`). */
  warnings?: number;
  bibliographyLeftOut?: boolean;
  /** Milliseconds from the document's being sent to its child to its row coming back. */
  wall: number;
}

/** A row as a child sends it, before the parent adds the document's id, family and time. */
export type ChildRow = Omit<ReferenceRow, "id" | "family" | "wall">;

/**
 * A document's row from what the intake and the reference compile made of it: numbers, and a
 * refusal's name as shown.
 */
export function rowOf(taken: Intake | Refusal, result?: Reference | Refusal): ChildRow {
  if ("refused" in taken) return refusedRow(taken);
  const images = (added: StandIn[]) => {
    const all = [...taken.images.replaced, ...added];
    return {
      replaced: taken.images.replaced.length,
      added: added.length,
      missing: all.filter((image) => image.missing).length,
      tree: all.filter((image) => image.tree).length,
      dropped: taken.images.dropped.length,
    };
  };
  if (result === undefined || "refused" in result)
    return { source: taken.source, ...refusedRow(result), images: images([]) };
  return {
    source: taken.source,
    outcome: "reference",
    engine: result.engine,
    pages: result.pages.length,
    ms: Math.round(result.ms),
    passes: result.passes.length,
    fonts: {
      tex: result.fonts.tex.length,
      native: result.fonts.native.length,
      shipped: result.fonts.shipped.length,
    },
    images: images(result.images),
    warnings: result.warnings.length,
    bibliographyLeftOut: result.bibliographyLeftOut,
  };
}

/**
 * A refused document's row: its reason, what it names, and what kind of error stopped it. A
 * command is shown with its backslash, and any other name as the survey shows one.
 */
function refusedRow(refused: Refusal | undefined): ChildRow {
  if (refused === undefined) return { outcome: "stopped" };
  const name = refused.name;
  const shown =
    name === undefined ? undefined : /^\\[A-Za-z@]{1,63}$/.test(name) ? name : shownName(name);
  return {
    outcome: refused.reason,
    ...(shown === undefined ? {} : { name: shown }),
    ...(refused.reason === "stopped" ? { stopped: stoppedKind(refused.log ?? "") } : {}),
  };
}

/** The kinds of first error a compile stops on, by the error's words; a kind names no text. */
const STOPPED_KINDS: readonly [RegExp, string][] = [
  [/^Undefined control sequence\./, "an undefined command"],
  [/^LaTeX Error: Environment .* undefined\./, "an undefined environment"],
  [
    /^(?:Package inputenc Error|LaTeX Error): (?:Unicode character|Invalid UTF-8)/,
    "a character pdfTeX cannot set",
  ],
  [/^Missing \$ inserted\./, "mathematics outside mathematics"],
  [/^LaTeX Error: File `.*' not found\./, "a graphic it cannot stand in for"],
  [/^TeX capacity exceeded/, "TeX's memory"],
  [/^LaTeX Error: Missing \\begin\{document\}\./, "text before the document"],
  [/^LaTeX Error: Unknown graphics extension/, "a graphic of an unknown format"],
  [/^Package babel Error: Unknown option/, "a language babel lacks"],
  [/^pdfTeX error \(\\[A-Za-z]+\): not allowed in DVI mode/, "a primitive of pdfTeX's PDF mode"],
  [/^LaTeX hooks Error:/, "LaTeX's hooks"],
  [/^Package .* Error:/, "a package's error"],
  [/^Class .* Error:/, "a class's error"],
  [/^LaTeX Error:/, "another LaTeX error"],
];

/**
 * What kind of error a compile stopped on, from the first error of its log, by its words alone:
 * `no pages` when it stopped on none, as a document with nothing to ship does.
 */
export function stoppedKind(log: string): string {
  const error = log
    .split(/\r?\n/)
    .find((line) => line.startsWith("! "))
    ?.slice(2);
  if (error === undefined) return "no pages";
  return STOPPED_KINDS.find(([pattern]) => pattern.test(error))?.[1] ?? "another TeX error";
}

// The upload.

/**
 * A document's zip, as a person would upload it: its files at their paths in its repository, and
 * for each font the manifest names beside its main file, the file `treeFont` finds of its name in
 * the tree, if any.
 */
export function uploadOf(
  doc: LiveDocument,
  read: (path: string) => Uint8Array,
  treeFont: (name: string) => Uint8Array | undefined,
): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const file of doc.files) files[file.path] = read(file.path);
  for (const asset of doc.assets) {
    const font = treeFont(asset.slice(asset.lastIndexOf("/") + 1));
    if (font !== undefined && files[asset] === undefined) files[asset] = font;
  }
  return zipSync(files);
}

/** The engine's tree, whose files the runners put in a zip for the fonts a document names. */
const ENGINE_FILES = fileURLToPath(new URL("../.engine/files", import.meta.url));

/**
 * The tree's font files by name, without the extension, in lower case: OpenType and TrueType for
 * a font the manifest names as either, and Type 1 for one it names as `.pfb`; `files` is the
 * engine's manifest's file list, and a file is read from the engine's tree when it is asked for,
 * as `uploadOf` asks.
 */
export function treeFonts(files: Readonly<Record<string, number>>) {
  const found = new Map<string, string>();
  for (const path of Object.keys(files)) {
    const kind = /\/fonts\/(?:opentype|truetype)\/.*\.(?:otf|ttf)$/i.test(path)
      ? "outline"
      : /\/fonts\/type1\/.*\.pfb$/i.test(path)
        ? "pfb"
        : undefined;
    const key = kind && `${kind}:${fileKey(path)}`;
    if (key && !found.has(key)) found.set(key, path);
  }
  return (name: string) => {
    const kind = /\.pfb$/i.test(name) ? "pfb" : "outline";
    const path = found.get(`${kind}:${fileKey(name)}`);
    return path === undefined ? undefined : new Uint8Array(readFileSync(join(ENGINE_FILES, path)));
  };
}

// The pool.

/**
 * A document for the pool: its id, and the message its child is sent, made only when it is sent,
 * so that no more than the pool's size of them are held at once.
 */
export interface PoolTask {
  id: string;
  message: () => unknown;
}

/** What became of a task: its child's reply, or that it timed out or its child died. */
export interface PoolResult {
  reply?: unknown;
  timedOut?: boolean;
  crashed?: boolean;
  /** Milliseconds from the task's being sent to what became of it. */
  wall: number;
}

export interface PoolOptions {
  /** The child's module, which Node runs. */
  script: string;
  tasks: readonly PoolTask[];
  size?: number;
  limitMs?: number;
  /** Called as each task ends, in the order they end. */
  onResult?: (task: PoolTask, result: PoolResult) => void;
  /**
   * Stops the pool when it aborts: every child is killed, and the tasks they hold and those not yet
   * sent are left undone, never counted as timed out or died; the pool resolves with what ended.
   */
  signal?: AbortSignal;
}

/**
 * Run tasks in a pool of child processes, one task each at a time. A child says `{ type: "ready" }`
 * once it has started, is sent `{ type: "task", id, message }`, and answers `{ type: "done", id,
 * ... }`, which is the task's reply. A task that has no answer within the limit has its child
 * killed, and one that dies is counted so; another child starts in its place while tasks are left.
 * A child that dies before it is ready is started again, but not past twice the pool's size, which
 * means it cannot start at all.
 */
export function runPool(options: PoolOptions): Promise<Map<string, PoolResult>> {
  const size = options.size ?? POOL_SIZE;
  const limitMs = options.limitMs ?? LIMIT_MS;
  const queue = [...options.tasks];
  const results = new Map<string, PoolResult>();
  return new Promise((resolve, reject) => {
    let alive = 0;
    let failedStarts = 0;
    const live = new Set<ChildProcess>();
    const stopped = () => options.signal?.aborted === true;
    options.signal?.addEventListener(
      "abort",
      () => {
        queue.length = 0;
        for (const child of live) child.kill("SIGKILL");
      },
      { once: true },
    );
    const finish = (task: PoolTask, result: PoolResult) => {
      results.set(task.id, result);
      options.onResult?.(task, result);
    };
    const start = () => {
      const child: ChildProcess = fork(options.script, [], {
        serialization: "advanced",
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      });
      live.add(child);
      alive++;
      let ready = false;
      let task: PoolTask | undefined;
      let sent = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = () => {
        task = queue.shift();
        if (task === undefined) {
          child.kill();
          return;
        }
        const current = task;
        sent = performance.now();
        child.send({ type: "task", id: current.id, message: current.message() });
        timer = setTimeout(() => {
          if (task !== current) return;
          task = undefined;
          finish(current, { timedOut: true, wall: performance.now() - sent });
          child.kill("SIGKILL");
        }, limitMs);
      };
      child.on("message", (message: { type?: string; id?: string }) => {
        if (message.type === "ready" && !ready) {
          ready = true;
          next();
        } else if (message.type === "done" && task !== undefined && message.id === task.id) {
          clearTimeout(timer);
          const done = task;
          task = undefined;
          finish(done, { reply: message, wall: performance.now() - sent });
          next();
        }
      });
      child.on("exit", () => {
        clearTimeout(timer);
        live.delete(child);
        alive--;
        if (task !== undefined) {
          // A task the pool stopped is left undone, as one never sent is.
          if (!stopped()) finish(task, { crashed: true, wall: performance.now() - sent });
          task = undefined;
        }
        if (!ready && !stopped() && ++failedStarts > 2 * size) {
          reject(new Error("the pool's children cannot start"));
          return;
        }
        if (queue.length > 0 && !stopped()) start();
        else if (alive === 0) resolve(results);
      });
    };
    if (queue.length === 0 || stopped()) resolve(results);
    else for (let i = 0; i < Math.min(size, queue.length); i++) start();
  });
}

// The table.

const COLUMNS = [...FAMILIES, "all"] as const;

const REASON_LABELS: Readonly<Record<RefusalReason, string>> = {
  luatex: "Refused: needs LuaTeX",
  class: "Refused: a template the tree lacks",
  package: "Refused: a package the tree lacks",
  font: "Refused: a font the tree lacks",
  file: "Refused: a file the upload or the tree lacks",
  image: "Refused: shows an image in a format with no stand-in",
  stopped: "Refused: stopped for another reason",
  passes: "Refused: did not settle in three passes",
  parse: "Refused: the parser could not read its body",
  keep: "Refused: a part the assembly cannot keep",
  timeout: `Refused: timed out, past ${LIMIT_MS / 1000} s`,
  intake: "Refused at intake",
  feature: "Refused: a font feature this editor cannot reproduce",
  difference: "Refused: fonts that come out otherwise",
  unreadable: "Refused: a page set in fonts the page cannot read",
};

/**
 * The reasons a reference compile can give, which the table has a row each for: not the parser's,
 * which come after the reference, nor the font rewrite's (decision 0023), nor the naming request
 * builder's (decision 0033).
 */
const REFERENCE_REASONS = REFUSAL_REASONS.filter(
  (reason) =>
    reason !== "parse" &&
    reason !== "feature" &&
    reason !== "difference" &&
    reason !== "unreadable",
);

/** The median of numbers, or undefined for none. */
function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** How many names the table lists under each reason; `referenceNames` gives them all. */
export const TOP_NAMES = 15;

/** The reasons whose refusals name what stopped them, and what the names are of. */
const NAMED_REASONS: readonly [RefusalReason, string][] = [
  ["class", "Templates the tree lacks"],
  ["package", "Packages the tree lacks"],
  ["font", "Fonts the tree lacks"],
  ["file", "Files the upload or the tree lacks"],
  ["image", "Images in a format with no stand-in"],
  ["stopped", "Stopped on an undefined command, by the command"],
];

/**
 * Every name the refusals of a reason give, with how many documents gave it, the most first and
 * then by name: what the table's lists are the top of.
 */
function tallyOf(rows: readonly ReferenceRow[], reason: RefusalReason): [string, number][] {
  const tally = new Map<string, number>();
  for (const row of rows)
    if (row.outcome === reason && row.name !== undefined)
      tally.set(row.name, (tally.get(row.name) ?? 0) + 1);
  return [...tally].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
}

/** Every name each reason's refusals give, with its count (`tallyOf`), for the JSON. */
export function referenceNames(
  rows: readonly ReferenceRow[],
): Partial<Record<RefusalReason, Record<string, number>>> {
  const names: Partial<Record<RefusalReason, Record<string, number>>> = {};
  for (const [reason] of NAMED_REASONS) {
    const tally = tallyOf(rows, reason);
    if (tally.length > 0) names[reason] = Object.fromEntries(tally);
  }
  return names;
}

/**
 * Every name each reason's refusals give, with its count, as lines under the table: a list for
 * each reason that names any, every name of it and not only the table's top TOP_NAMES. Every line
 * is one line, whatever a name holds (`printable`).
 */
export function referenceNameLines(rows: readonly ReferenceRow[]): string[] {
  const lines: string[] = [];
  for (const [reason, label] of NAMED_REASONS) {
    const tally = tallyOf(rows, reason);
    if (tally.length === 0) continue;
    lines.push(`${label}, all ${tally.length}:`);
    lines.push(`  ${tally.map(([name, count]) => `${name} ${count}`).join(", ")}`);
  }
  return lines.map(printable);
}

/**
 * What the corpus's reference compiles came to, as one Markdown table, per family and in all: how
 * many documents compiled to a reference and how many were refused for each reason, the pages of
 * the references, the engines they compiled on, the bibliographies left out and the images stood
 * in for, and the median and slowest compile times; then, for each reason that names what is
 * missing, the names the most documents were refused for, and the kinds of error the rest stopped
 * on. Every line is one line, whatever a name holds (`printable`).
 */
export function referenceTable(rows: readonly ReferenceRow[]): string {
  const of = (column: (typeof COLUMNS)[number]) =>
    rows.filter((row) => column === "all" || row.family === column);
  const line = (label: string, values: readonly (number | string)[]) =>
    `| ${label} | ${values.join(" | ")} |`;
  const count = (label: string, test: (row: ReferenceRow) => boolean) =>
    line(
      label,
      COLUMNS.map((column) => of(column).filter(test).length),
    );
  const time = (label: string, pick: (values: number[]) => number | undefined) =>
    line(
      label,
      COLUMNS.map((column) => {
        const values = of(column).flatMap((row) =>
          row.outcome === "reference" && row.ms !== undefined ? [row.ms] : [],
        );
        const value = pick(values);
        return value === undefined ? "" : `${Math.round(value)} ms`;
      }),
    );
  const section = (label: string) =>
    line(
      `**${label}**`,
      COLUMNS.map(() => ""),
    );
  const reference = (row: ReferenceRow) => row.outcome === "reference";
  const named = (reason: RefusalReason) => {
    const label = NAMED_REASONS.find(([each]) => each === reason)?.[1] ?? reason;
    const top = tallyOf(rows, reason).slice(0, TOP_NAMES);
    if (top.length === 0) return [];
    return [
      section(label),
      ...top.map(([name]) =>
        count(`\`${name}\``, (row) => row.outcome === reason && row.name === name),
      ),
    ];
  };
  const kinds = [
    ...new Set(rows.flatMap((row) => (row.stopped === undefined ? [] : [row.stopped]))),
  ].sort((a, b) => {
    const n = (kind: string) => rows.filter((row) => row.stopped === kind).length;
    return n(b) - n(a) || (a < b ? -1 : 1);
  });
  const lines = [
    line("", COLUMNS),
    `|---|${COLUMNS.map(() => "--:").join("|")}|`,
    count("Documents", () => true),
    count("Compiled to a reference", reference),
    ...REFERENCE_REASONS.map((reason) =>
      count(REASON_LABELS[reason], (row) => row.outcome === reason),
    ),
    count("Reference of one page", (row) => reference(row) && row.pages === 1),
    count("Reference of two pages", (row) => reference(row) && row.pages === 2),
    count("Reference of more pages", (row) => reference(row) && (row.pages ?? 0) > 2),
    count("Engine: pdfTeX", (row) => reference(row) && row.engine === "pdftex"),
    count("Engine: XeTeX", (row) => reference(row) && row.engine === "xetex"),
    count(
      "Engine: XeTeX after pdfTeX would not do",
      (row) => reference(row) && row.engine === "xetex" && row.source !== "xetex",
    ),
    count("Bibliography left out", (row) => row.bibliographyLeftOut === true),
    count(
      "Images stood in for",
      (row) => reference(row) && (row.images?.replaced ?? 0) + (row.images?.added ?? 0) > 0,
    ),
    count(
      "Images the upload lacked, stood in for at 1 by 1",
      (row) => reference(row) && (row.images?.missing ?? 0) > 0,
    ),
    count(
      "Images of the tree, stood in for at their size",
      (row) => reference(row) && (row.images?.tree ?? 0) > 0,
    ),
    count("Fonts from the upload", (row) => reference(row) && (row.fonts?.shipped ?? 0) > 0),
    time("Compile time, median", median),
    time("Compile time, slowest", (values) =>
      values.length === 0 ? undefined : Math.max(...values),
    ),
    ...named("class"),
    ...named("package"),
    ...named("font"),
    ...named("file"),
    ...named("image"),
    ...(kinds.length === 0
      ? []
      : [
          section("Stopped, by the first error"),
          ...kinds.map((kind) => count(kind, (row) => row.stopped === kind)),
        ]),
    ...named("stopped"),
  ];
  return `${lines.map(printable).join("\n")}\n`;
}
