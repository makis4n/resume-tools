/**
 * What the corpus's PDF reading keeps of a document, and its tables (milestone 3 second pass,
 * item 15, from the spike of item 3): counts only, by the document's id, never a line, a word or a
 * field of it. `countsOf` makes them from a reading by rules; `pdf-corpus` writes them, one file a
 * document, under `.corpus/pdf-corpus/`, and prints `corpusTable` and `targetLines` of their sum.
 */

import { SECTION_ROLES, type SectionRole } from "@resume-tools/resume-model";
import { UNFILED_ID } from "../src/pdf/file.ts";
import type { PdfResume } from "../src/pdf/resume.ts";
import { ROLES, type Role } from "../src/pdf/roles.ts";

/** What became of a document: read, or why not, and how much of it. Counts only. */
export interface CorpusCounts {
  /**
   * `read`; or the reference compile's refusal reason; `no-pdf` when xdvipdfmx made none; the
   * reader's refusal; `failed`, `timeout` or `crashed`.
   */
  outcome: string;
  /** For `failed`, the kind of error, its class's name alone. */
  failure?: string;
  /** For `no-pdf`, why xdvipdfmx made none, by its kind (`pdfErrorKind`). */
  pdfError?: string;
  engine?: string;
  compileMs?: number;
  pdfBytes?: number;
  readMs?: number;
  rulesMs?: number;
  pages?: number;
  /** The most columns found side by side on a page, and the pages with more than one. */
  columns?: number;
  multiColumnPages?: number;
  lines?: number;
  /** The blocks the lines stand in (`src/pdf/layout.ts`). */
  blocks?: number;
  roles?: Record<Role, number>;
  /** The sections the filing made, the catch-all not among them, and by their role. */
  sections?: number;
  sectionRoles?: Record<SectionRole, number>;
  entries?: number;
  /** The entries whose dates the resume holds as dates. */
  entriesDated?: number;
  bullets?: number;
  /**
   * Words read; those the resume holds; those in the catch-all; and those in a recognised place;
   * and the letters and digits read, held and in the catch-all, by which nothing read is dropped.
   */
  words?: {
    read: number;
    landed: number;
    unfiled: number;
    recognised: number;
    chars?: { read: number; landed: number; unfiled: number };
  };
  icons?: number;
  hyphenJoins?: number;
  flags?: { dateAsText: number; unfiled: number };
  /** Whether the header found a name, an email and a phone, and how many links. */
  header?: { name: boolean; email: boolean; phone: boolean; links: number };
}

/**
 * Why xdvipdfmx made no PDF, by its kind, from the session's error, which may name a font or a
 * file and is never kept: a special it refuses to run, by the special's command; a font it has no
 * outline for, or cannot find; its abort; or another failure.
 */
export function pdfErrorKind(error: string | undefined): string {
  if (error === undefined) return "no reason given";
  const special = /reads a file or reconfigures xdvipdfmx: (\S+(?: [A-Za-z]+)?)/.exec(error)?.[1];
  if (special !== undefined)
    return /^[A-Za-z:]+=?(?: [A-Za-z]+)?$/.test(special) ? `a special, ${special}` : "a special";
  if (/without \.vf or "physical" font/i.test(error)) return "a font with no outline";
  if (/could not (?:locate|find)[^\n]*font|font[^\n]*not found/i.test(error))
    return "a font it cannot find";
  if (/has no output/.test(error)) return "no output";
  if (/aborted/.test(error)) return "xdvipdfmx aborted";
  if (/exited with/.test(error)) return "xdvipdfmx failed";
  return "another reason";
}

/** A reading's counts. */
export function countsOf({ layout, labels, filed }: PdfResume): CorpusCounts {
  const roleCounts = Object.fromEntries(ROLES.map((role) => [role, 0])) as Record<Role, number>;
  for (const role of labels.roles) roleCounts[role]++;
  const sections = filed.resume.sections.filter((section) => section.id !== UNFILED_ID);
  const sectionRoles = Object.fromEntries(SECTION_ROLES.map((role) => [role, 0])) as Record<
    SectionRole,
    number
  >;
  for (const section of sections) sectionRoles[section.role]++;
  const entries = sections.flatMap((section) =>
    section.kind === "entries" ? section.entries : [],
  );
  const { header } = filed.resume;
  return {
    outcome: "read",
    pages: layout.pages.length,
    columns: Math.max(1, ...layout.pages.map((page) => page.columns)),
    multiColumnPages: layout.pages.filter((page) => page.columns > 1).length,
    lines: layout.lines.length,
    blocks: layout.blocks.length,
    roles: roleCounts,
    sections: sections.length,
    sectionRoles,
    entries: entries.length,
    entriesDated: entries.filter((entry) => entry.dates !== undefined).length,
    bullets: entries.reduce((sum, entry) => sum + entry.bullets.length, 0),
    words: {
      read: filed.words.read,
      landed: filed.words.landed,
      unfiled: filed.words.unfiled,
      recognised: filed.words.landed - filed.words.unfiled,
      chars: filed.words.chars,
    },
    icons: layout.icons,
    hyphenJoins: layout.hyphenJoins,
    flags: {
      dateAsText: filed.flags.filter((flag) => flag.kind === "date-as-text").length,
      unfiled: filed.flags.filter((flag) => flag.kind === "unfiled").length,
    },
    header: {
      name: `${header.name.first}${header.name.last}`.trim() !== "",
      email: header.email !== undefined,
      phone: header.phone !== undefined,
      links: header.links.length,
    },
  };
}

/** A corpus run's counts summed, and by family. */
export interface CorpusSummary {
  documents: number;
  outcomes: Record<string, number>;
  /** Of the documents that compiled and made no PDF, why, by kind. */
  pdfErrors: Record<string, number>;
  read: number;
  pages: number;
  columns: Record<string, number>;
  multiColumnPages: number;
  /** The lines and blocks laid out, in all; absent from a run before item 11 counted blocks. */
  lines?: number;
  blocks?: number;
  sections: { total: number; median: number; none: number };
  sectionRoles: Record<string, number>;
  entries: number;
  /** Absent from a run before item 15 counted them. */
  entriesDated?: number;
  bullets: number;
  words: { read: number; landed: number; unfiled: number; recognised: number };
  /**
   * Per document: every word read landed; and the share recognised, its median in percent, and
   * how many reach 85%.
   */
  everyWordLands: number;
  recognisedMedian: number;
  recognised85: number;
  header: { name: number; email: number; phone: number; links: number };
  icons: number;
  hyphenJoins: number;
  flags: { dateAsText: number; unfiled: number; documentsWithUnfiled: number };
  times: {
    compile: { median: number; max: number };
    read: { median: number; max: number };
    rules: { median: number; max: number };
    /** pdf.js's reading and the rules together, a PDF; absent before item 15. */
    readAndRules?: { median: number; max: number };
  };
  families: Record<
    string,
    { documents: number; read: number; recognised: number; wordsRead: number; twoColumns: number }
  >;
}

/**
 * Whether every word read landed: as many letters and digits are held as were read, where they
 * were counted, and else as many words.
 */
export function nothingDropped(
  words: { read: number; landed: number; chars?: { read: number; landed: number } } | undefined,
): boolean {
  if (words === undefined) return false;
  return words.chars === undefined
    ? words.landed >= words.read
    : words.chars.landed >= words.chars.read;
}

/** The median of numbers, or 0 for none. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

const max = (values: readonly number[]) => (values.length === 0 ? 0 : Math.max(...values));

/** The corpus's per-document counts summed, by the document's id and family. */
export function summariseCorpus(
  documents: readonly { id: string; family: string; counts: CorpusCounts }[],
): CorpusSummary {
  const outcomes: Record<string, number> = {};
  const pdfErrors: Record<string, number> = {};
  const columns: Record<string, number> = {};
  const sectionRoles: Record<string, number> = {};
  const families: CorpusSummary["families"] = {};
  const read = documents.filter((doc) => doc.counts.outcome === "read");
  for (const { family, counts } of documents) {
    outcomes[counts.outcome] = (outcomes[counts.outcome] ?? 0) + 1;
    if (counts.outcome === "no-pdf") {
      const why = counts.pdfError ?? "not recorded";
      pdfErrors[why] = (pdfErrors[why] ?? 0) + 1;
    }
    const each = (families[family] ??= {
      documents: 0,
      read: 0,
      recognised: 0,
      wordsRead: 0,
      twoColumns: 0,
    });
    each.documents++;
    if (counts.outcome !== "read") continue;
    each.read++;
    each.recognised += counts.words?.recognised ?? 0;
    each.wordsRead += counts.words?.read ?? 0;
    if ((counts.columns ?? 1) >= 2) each.twoColumns++;
    const key = (counts.columns ?? 1) >= 3 ? "3+" : String(counts.columns ?? 1);
    columns[key] = (columns[key] ?? 0) + 1;
    for (const [role, count] of Object.entries(counts.sectionRoles ?? {}))
      sectionRoles[role] = (sectionRoles[role] ?? 0) + count;
  }
  const sum = (pick: (counts: CorpusCounts) => number) =>
    read.reduce((total, doc) => total + pick(doc.counts), 0);
  const shares = read.map(({ counts }) =>
    (counts.words?.read ?? 0) === 0
      ? 1
      : (counts.words?.recognised ?? 0) / (counts.words?.read ?? 1),
  );
  const times = (pick: (counts: CorpusCounts) => number | undefined) => {
    const values = read.flatMap((doc) => {
      const value = pick(doc.counts);
      return value === undefined ? [] : [value];
    });
    return { median: median(values), max: max(values) };
  };
  return {
    documents: documents.length,
    outcomes,
    pdfErrors,
    read: read.length,
    pages: sum((counts) => counts.pages ?? 0),
    columns,
    multiColumnPages: sum((counts) => counts.multiColumnPages ?? 0),
    lines: sum((counts) => counts.lines ?? 0),
    blocks: sum((counts) => counts.blocks ?? 0),
    sections: {
      total: sum((counts) => counts.sections ?? 0),
      median: median(read.map((doc) => doc.counts.sections ?? 0)),
      none: read.filter((doc) => (doc.counts.sections ?? 0) === 0).length,
    },
    sectionRoles,
    entries: sum((counts) => counts.entries ?? 0),
    entriesDated: sum((counts) => counts.entriesDated ?? 0),
    bullets: sum((counts) => counts.bullets ?? 0),
    words: {
      read: sum((counts) => counts.words?.read ?? 0),
      landed: sum((counts) => counts.words?.landed ?? 0),
      unfiled: sum((counts) => counts.words?.unfiled ?? 0),
      recognised: sum((counts) => counts.words?.recognised ?? 0),
    },
    everyWordLands: read.filter(({ counts }) => nothingDropped(counts.words)).length,
    recognisedMedian: 100 * median(shares),
    recognised85: shares.filter((share) => share >= 0.85).length,
    header: {
      name: read.filter((doc) => doc.counts.header?.name).length,
      email: read.filter((doc) => doc.counts.header?.email).length,
      phone: read.filter((doc) => doc.counts.header?.phone).length,
      links: sum((counts) => counts.header?.links ?? 0),
    },
    icons: sum((counts) => counts.icons ?? 0),
    hyphenJoins: sum((counts) => counts.hyphenJoins ?? 0),
    flags: {
      dateAsText: sum((counts) => counts.flags?.dateAsText ?? 0),
      unfiled: sum((counts) => counts.flags?.unfiled ?? 0),
      documentsWithUnfiled: read.filter((doc) => (doc.counts.flags?.unfiled ?? 0) > 0).length,
    },
    times: {
      compile: times((counts) => counts.compileMs),
      read: times((counts) => counts.readMs),
      rules: times((counts) => counts.rulesMs),
      readAndRules: times((counts) =>
        counts.readMs === undefined || counts.rulesMs === undefined
          ? undefined
          : counts.readMs + counts.rulesMs,
      ),
    },
    families,
  };
}

const share = (part: number, whole: number) =>
  whole === 0 ? "–" : `${((100 * part) / whole).toFixed(1)}%`;
const ms = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;

/** The corpus's table, as Markdown: counts only. */
export function corpusTable(summary: CorpusSummary): string[] {
  const rows: string[] = ["**The corpus, read by rules alone (counts only)**", ""];
  const line = (label: string, value: string) => rows.push(`| ${label} | ${value} |`);
  rows.push("| | |", "|---|--:|");
  line("Documents tried", String(summary.documents));
  line("Read", String(summary.read));
  const refused = Object.entries(summary.outcomes)
    .filter(([outcome]) => outcome !== "read")
    .sort((a, b) => b[1] - a[1])
    .map(([outcome, count]) => `${outcome} ${count}`)
    .join(", ");
  line("Not read, by reason", refused === "" ? "none" : refused);
  const noPdf = Object.entries(summary.pdfErrors ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([why, count]) => `${why} ${count}`)
    .join(", ");
  if (noPdf !== "") line("Compiled, and xdvipdfmx made no PDF, by why", noPdf);
  line("Pages read", String(summary.pages));
  const columns = Object.entries(summary.columns)
    .sort()
    .map(([key, count]) => `${key}: ${count}`)
    .join(", ");
  line("Columns found, the most on a page: documents", columns);
  line("Pages with more than one column", String(summary.multiColumnPages));
  if (summary.blocks !== undefined && summary.blocks > 0)
    line("Lines; blocks", `${summary.lines}; ${summary.blocks}`);
  line(
    "Sections found: in all; median a document; documents with none",
    `${summary.sections.total}; ${summary.sections.median}; ${summary.sections.none}`,
  );
  line(
    "Sections by role",
    Object.entries(summary.sectionRoles)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([role, count]) => `${role} ${count}`)
      .join(", "),
  );
  line(
    summary.entriesDated === undefined
      ? "Entries; their bullets"
      : "Entries; those with dates; their bullets",
    summary.entriesDated === undefined
      ? `${summary.entries}; ${summary.bullets}`
      : `${summary.entries}; ${summary.entriesDated}; ${summary.bullets}`,
  );
  line("Words read", String(summary.words.read));
  line(
    "Words that land in the resume",
    `${summary.words.landed} (${share(summary.words.landed, summary.words.read)})`,
  );
  line("Documents where every word read lands", `${summary.everyWordLands} of ${summary.read}`);
  line(
    "**Words in a recognised place**, against the catch-all",
    `${summary.words.recognised} (${share(summary.words.recognised, summary.words.read)}); catch-all ${summary.words.unfiled} (${share(summary.words.unfiled, summary.words.read)})`,
  );
  line(
    "The share recognised a document: median; documents at 85% or more",
    `${summary.recognisedMedian.toFixed(1)}%; ${summary.recognised85} of ${summary.read}`,
  );
  line(
    "Header found: name, email, phone (documents); links",
    `${summary.header.name}, ${summary.header.email}, ${summary.header.phone}; ${summary.header.links}`,
  );
  line(
    "Icons dropped; hyphens joined; dates kept as text",
    `${summary.icons}; ${summary.hyphenJoins}; ${summary.flags.dateAsText}`,
  );
  line(
    "Lines in the catch-all; documents with any",
    `${summary.flags.unfiled}; ${summary.flags.documentsWithUnfiled}`,
  );
  line(
    "Rules a PDF, median and max",
    `${ms(summary.times.rules.median)}, ${ms(summary.times.rules.max)}`,
  );
  line(
    "pdf.js's reading a PDF, median and max",
    `${ms(summary.times.read.median)}, ${ms(summary.times.read.max)}`,
  );
  if (summary.times.readAndRules !== undefined)
    line(
      "pdf.js's reading and the rules together, median and max",
      `${ms(summary.times.readAndRules.median)}, ${ms(summary.times.readAndRules.max)}`,
    );
  line(
    "The engine's compile, median and max",
    `${ms(summary.times.compile.median)}, ${ms(summary.times.compile.max)}`,
  );
  rows.push(
    "",
    "| Family | Documents | Read | Recognised | Two columns or more |",
    "|---|--:|--:|--:|--:|",
  );
  for (const [family, each] of Object.entries(summary.families).sort())
    rows.push(
      `| ${family} | ${each.documents} | ${each.read} | ${share(each.recognised, each.wordsRead)} | ${each.twoColumns} |`,
    );
  return rows;
}

/** The share of words that must land in a recognised place (docs/milestone-3-overhaul.md). */
export const RECOGNISED_TARGET = 0.95;

/** The most a PDF may take by rules, pdf.js's reading with them, in milliseconds. */
export const RULES_TARGET_MS = 1_000;

/** The owner's targets for the corpus set, each met or not, from a summary. */
export function targetLines(summary: CorpusSummary): string[] {
  const met = (yes: boolean) => (yes ? "met" : "NOT met");
  const recognised = summary.words.read === 0 ? 0 : summary.words.recognised / summary.words.read;
  const slowest =
    summary.times.readAndRules?.max ?? summary.times.read.max + summary.times.rules.max;
  return [
    '**Targets, rules on the corpus** (docs/milestone-3-overhaul.md, "For a PDF import")',
    "",
    `- Every word read lands: ${summary.everyWordLands} of ${summary.read} documents read: ${met(summary.read > 0 && summary.everyWordLands === summary.read)}`,
    `- At least ${100 * RECOGNISED_TARGET}% of words in a recognised place: ${share(summary.words.recognised, summary.words.read)}: ${met(recognised >= RECOGNISED_TARGET)}`,
    `- Under ${RULES_TARGET_MS / 1000} s a PDF by rules, pdf.js's reading with them: ${ms(slowest)} at most: ${met(summary.read > 0 && slowest < RULES_TARGET_MS)}`,
  ];
}
