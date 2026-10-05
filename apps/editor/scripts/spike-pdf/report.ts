/**
 * The PDF spike's results and its tables (item 3). The results are one JSON file, `results.json`
 * beside this module, which each set's run writes its part of and `--report` reprints the tables
 * from, reading and calling nothing. The invented sets' parts hold invented text, the fields a
 * reading got wrong; the corpus's part, the spike's own run, holds counts summed over its
 * documents, never a document's text. The corpus is read by `pdf-corpus` now (item 15), whose
 * counts and table (`../pdf-counts.ts`) this reprints that part with.
 */

import { type CorpusSummary, corpusTable, median, nothingDropped } from "../pdf-counts.ts";
import type { Failure } from "./model.ts";
import { FIELD_KINDS, type FieldKind, type Score, type Tally } from "./score.ts";

/** A score as the results keep it: the tallies, without each field. */
export interface ScoreSummary {
  all: Tally;
  byKind: Record<FieldKind, Tally>;
  entries: Tally;
  entriesSwapped: Tally;
  headerExact: boolean;
  sectionsExact: boolean;
  bulletsExact: boolean;
}

export const summaryOf = (score: Score): ScoreSummary => ({
  all: score.all,
  byKind: score.byKind,
  entries: score.entries,
  entriesSwapped: score.entriesSwapped,
  headerExact: score.headerExact,
  sectionsExact: score.sectionsExact,
  bulletsExact: score.bulletsExact,
});

/** One reading of an invented PDF, by the rules or with the model's labels. */
export interface Reading {
  words: {
    read: number;
    landed: number;
    unfiled: number;
    chars?: { read: number; landed: number; unfiled: number };
  };
  flags: { dateAsText: number; unfiled: number };
  score: ScoreSummary;
  /** The fields it got wrong: invented text. */
  wrong: { kind: FieldKind; truth: string; read?: string }[];
}

/** One call to the model, as kept: when, how long, and how it ended. */
export interface CallRecord {
  at: string;
  ms: number;
  failure?: Failure;
  status?: number;
  tokens?: { input: number; output: number; reasoning?: number };
  lines: number;
  /** The fields right of the reading the call's roles gave, where it answered and was scored. */
  fields?: Tally;
}

/** One invented PDF's results. */
export interface DocResult {
  id: string;
  /** The template, for the first set; the tool, for the third. */
  group: string;
  pages: number;
  lines: number;
  columns: number;
  icons: number;
  hyphenJoins: number;
  /** Milliseconds pdf.js took to read it, and the rules to lay it out, label it and file it. */
  readMs: number;
  rulesMs: number;
  rules: Reading;
  model?: { model: string; calls: CallRecord[]; reading?: Reading; labelMs?: number };
}

/** What the reader is: its version, its size, and how it loads. */
export interface ReaderInfo {
  package: string;
  version: string;
  license: string;
  /** Bytes of the browser's build: the main module and the worker, raw and gzipped. */
  sizes: { file: string; raw: number; gzip: number; brotli: number }[];
  loading: string[];
  /** The optional native package pnpm installs beside it, and its size on disk. */
  optional: { package: string; version: string; bytes: number; loadedInNode: boolean }[];
}

/** An invented set's run: when, at which commit, pdf.js's first read, and each PDF's results. */
export interface SetResults {
  at: string;
  commit: string;
  /** Milliseconds pdf.js's first read took, its loading and its worker's start with it. */
  coldMs?: number;
  documents: DocResult[];
}

export interface Results {
  version: 1;
  reader?: ReaderInfo;
  builtin?: SetResults;
  other?: SetResults;
  corpus?: { at: string; commit: string; summary: CorpusSummary };
}

const max = (values: readonly number[]) => (values.length === 0 ? 0 : Math.max(...values));

// The tables.

/** The group of the third set's PDFs held out from the rules' debugging, and of the others. */
export const HELD_OUT = "held out";
const DEBUGGING = "debugged on";

const percent = (tally: Tally | undefined) =>
  tally === undefined || tally.total === 0
    ? "–"
    : `${((100 * tally.right) / tally.total).toFixed(1)}% (${tally.right}/${tally.total})`;
const share = (part: number, whole: number) =>
  whole === 0 ? "–" : `${((100 * part) / whole).toFixed(1)}%`;
const ms = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
const kib = (bytes: number) => `${(bytes / 1024).toFixed(0)} KiB`;

const add = (a: Tally, b: Tally): Tally => ({ total: a.total + b.total, right: a.right + b.right });
const none: Tally = { total: 0, right: 0 };

/** The tallies of a set of readings, summed. */
function sumReadings(readings: readonly Reading[]) {
  const byKind = Object.fromEntries(FIELD_KINDS.map((kind) => [kind, none])) as Record<
    FieldKind,
    Tally
  >;
  let all = none;
  let entries = none;
  let entriesSwapped = none;
  for (const reading of readings) {
    all = add(all, reading.score.all);
    entries = add(entries, reading.score.entries);
    entriesSwapped = add(entriesSwapped, reading.score.entriesSwapped);
    for (const kind of FIELD_KINDS) byKind[kind] = add(byKind[kind], reading.score.byKind[kind]);
  }
  return {
    all,
    byKind,
    entries,
    entriesSwapped,
    headerExact: readings.filter((reading) => reading.score.headerExact).length,
    sectionsExact: readings.filter((reading) => reading.score.sectionsExact).length,
    bulletsExact: readings.filter((reading) => reading.score.bulletsExact).length,
    everyWordLands: readings.filter((reading) => nothingDropped(reading.words)).length,
    wordsRead: readings.reduce((sum, reading) => sum + reading.words.read, 0),
    wordsLanded: readings.reduce((sum, reading) => sum + reading.words.landed, 0),
    unfiled: readings.reduce((sum, reading) => sum + reading.words.unfiled, 0),
  };
}

/**
 * The model's fields right, pass by pass: the k-th scored call of every document summed, for each
 * k that every document has one for.
 */
function passTallies(documents: readonly DocResult[]): Tally[] {
  const scored = documents.map((doc) =>
    (doc.model?.calls ?? []).flatMap((call) => (call.fields === undefined ? [] : [call.fields])),
  );
  const passes = Math.min(...scored.map((calls) => calls.length));
  if (documents.length === 0 || !Number.isFinite(passes)) return [];
  return Array.from({ length: passes }, (_, pass) =>
    scored.reduce((sum, calls) => add(sum, calls[pass] ?? none), none),
  );
}

/** The successful model calls of a set's documents, their times, and the failures by kind. */
function modelTimes(documents: readonly DocResult[]) {
  const calls = documents.flatMap((doc) => doc.model?.calls ?? []);
  const answered = calls.filter((call) => call.failure === undefined).map((call) => call.ms);
  const failures: Record<string, number> = {};
  for (const call of calls)
    if (call.failure !== undefined) failures[call.failure] = (failures[call.failure] ?? 0) + 1;
  return {
    calls: calls.length,
    answered,
    failures,
    within30: answered.filter((value) => value <= 30_000).length,
  };
}

/** A set's table: by group and in all, the rules and the model side by side. */
function setTable(
  title: string,
  documents: readonly DocResult[],
  groupLabel: string,
  coldMs?: number,
): string[] {
  const groups = [...new Set(documents.map((doc) => doc.group))];
  // Where some PDFs are held out, the ones the rules were debugged on are summed apart too.
  const debugging = groups.includes(HELD_OUT) ? [DEBUGGING] : [];
  const columns = [...groups, ...debugging, "all"];
  const of = (column: string) =>
    documents.filter(
      (doc) =>
        column === "all" ||
        doc.group === column ||
        (column === DEBUGGING && doc.group !== HELD_OUT),
    );
  const rows: string[] = [];
  const line = (label: string, values: readonly string[]) =>
    rows.push(`| ${label} | ${values.join(" | ")} |`);
  rows.push(`**${title}**`, "");
  line(groupLabel, columns);
  rows.push(`|---|${columns.map(() => "--:").join("|")}|`);
  line(
    "PDFs, pages",
    columns.map((column) => {
      const docs = of(column);
      return `${docs.length}, ${docs.reduce((sum, doc) => sum + doc.pages, 0)}`;
    }),
  );
  const rules = (column: string) => sumReadings(of(column).map((doc) => doc.rules));
  const model = (column: string) => {
    const readings = of(column).flatMap((doc) => (doc.model?.reading ? [doc.model.reading] : []));
    return readings.length === 0 ? undefined : { ...sumReadings(readings), n: readings.length };
  };
  line(
    "Words read; every word lands (rules)",
    columns.map((column) => {
      const r = rules(column);
      return `${r.wordsRead}; ${r.everyWordLands} of ${of(column).length}`;
    }),
  );
  line(
    "Words in the catch-all (rules)",
    columns.map((column) => String(rules(column).unfiled)),
  );
  line(
    "**Fields right, rules**",
    columns.map((column) => percent(rules(column).all)),
  );
  line(
    "**Fields right, model**",
    columns.map((column) => {
      const m = model(column);
      return m === undefined
        ? "not run"
        : `${percent(m.all)}${m.n < of(column).length ? `, ${m.n} PDFs` : ""}`;
    }),
  );
  line(
    "Fields right, model, each pass over every PDF",
    columns.map((column) => {
      const passes = passTallies(of(column));
      return passes.length === 0
        ? "–"
        : passes.map((tally) => percent(tally).split(" ")[0]).join(", ");
    }),
  );
  for (const kind of FIELD_KINDS)
    line(
      `${kind}: rules / model`,
      columns.map((column) => {
        const r = rules(column).byKind[kind];
        const m = model(column)?.byKind[kind];
        return r.total === 0 ? "–" : `${percent(r)} / ${m === undefined ? "–" : percent(m)}`;
      }),
    );
  line(
    "Entries right (title, place, dates): rules / model",
    columns.map((column) => {
      const m = model(column);
      return `${percent(rules(column).entries)} / ${m ? percent(m.entries) : "–"}`;
    }),
  );
  line(
    "The same, a title and subtitle swapped counted right: rules / model",
    columns.map((column) => {
      const m = model(column);
      return `${percent(rules(column).entriesSwapped)} / ${m ? percent(m.entriesSwapped) : "–"}`;
    }),
  );
  line(
    "Header exact; sections exact; bullets exact (rules, PDFs)",
    columns.map((column) => {
      const r = rules(column);
      return `${r.headerExact}; ${r.sectionsExact}; ${r.bulletsExact} of ${of(column).length}`;
    }),
  );
  line(
    "Header exact; sections exact; bullets exact (model, PDFs)",
    columns.map((column) => {
      const m = model(column);
      return m === undefined
        ? "–"
        : `${m.headerExact}; ${m.sectionsExact}; ${m.bulletsExact} of ${m.n}`;
    }),
  );
  line(
    "Rules' time a PDF, median and max (reading by pdf.js apart)",
    columns.map((column) => {
      const values = of(column).map((doc) => doc.rulesMs);
      return `${ms(median(values))}, ${ms(max(values))}`;
    }),
  );
  line(
    "pdf.js's reading a PDF, median and max",
    columns.map((column) => {
      const values = of(column).map((doc) => doc.readMs);
      return `${ms(median(values))}, ${ms(max(values))}`;
    }),
  );
  line(
    "Reading and rules together a PDF, median and max",
    columns.map((column) => {
      const values = of(column).map((doc) => doc.readMs + doc.rulesMs);
      return `${ms(median(values))}, ${ms(max(values))}`;
    }),
  );
  line(
    "pdf.js's first read in a run, its loading with it",
    columns.map((column) => (column === "all" && coldMs !== undefined ? ms(coldMs) : "–")),
  );
  line(
    "Model's call a PDF, median and max; within 30 s",
    columns.map((column) => {
      const times = modelTimes(of(column));
      return times.answered.length === 0
        ? "–"
        : `${ms(median(times.answered))}, ${ms(max(times.answered))}; ${times.within30} of ${times.answered.length}`;
    }),
  );
  line(
    "Model's calls; failures by kind",
    columns.map((column) => {
      const times = modelTimes(of(column));
      const failures = Object.entries(times.failures)
        .map(([kind, count]) => `${kind} ${count}`)
        .join(", ");
      return times.calls === 0 ? "–" : `${times.calls}; ${failures === "" ? "none" : failures}`;
    }),
  );
  return rows;
}

/** The reader's table. */
function readerTable(reader: ReaderInfo): string[] {
  const rows = [
    `**The reader: ${reader.package} ${reader.version}, ${reader.license}**`,
    "",
    "| File | Raw | gzip -9 | Brotli |",
    "|---|--:|--:|--:|",
    ...reader.sizes.map(
      (size) => `| \`${size.file}\` | ${kib(size.raw)} | ${kib(size.gzip)} | ${kib(size.brotli)} |`,
    ),
    "",
    ...reader.loading.map((each) => `- ${each}`),
    ...reader.optional.map(
      (each) =>
        `- pnpm also installs \`${each.package}\` ${each.version}, an optional native package, ${kib(each.bytes)} on disk on this machine; ${each.loadedInNode ? "pdf.js loads it in Node when it starts, to stand in for the browser's DOMMatrix and Path2D, and reads text without it" : "pdf.js does not load it to read text"}.`,
    ),
  ];
  return rows;
}

/** Every table the results hold, as Markdown. */
export function tables(results: Results): string {
  const parts: string[][] = [];
  if (results.builtin)
    parts.push(
      setTable(
        `The editor's own PDFs: three built-in templates, three invented resumes each (${results.builtin.commit})`,
        results.builtin.documents,
        "Template",
        results.builtin.coldMs,
      ),
    );
  if (results.other)
    parts.push(
      setTable(
        `Invented resumes from other tools (${results.other.commit})`,
        results.other.documents,
        "Fixture",
        results.other.coldMs,
      ),
    );
  if (results.corpus) parts.push(corpusTable(results.corpus.summary));
  if (results.reader) parts.push(readerTable(results.reader));
  return parts.map((part) => part.join("\n")).join("\n\n");
}
