/**
 * The oracle (milestone 3 item 5, decision 0022): the three launch templates' upstream samples,
 * which the import pipeline must take as their hand-written ports do, editable what a port marks
 * and locked what a port leaves out of the model. `corpus/oracle.json` names each sample's files,
 * as the corpus's manifest names a document's, at a pinned commit, and the verdict the probe
 * should find for each of its macros' arguments and each kind of its standard nodes, worked out
 * from the port's snippets and its decision record, with why. `corpus oracle` fetches the files
 * into `.corpus/oracle/`, as `corpus fetch` fetches a document, never into git, since the upstream
 * text is not ours, probes each sample as `corpus probe` does, and prints the expected verdicts
 * against the found ones, and how many disagree. A disagreement is a finding for the decision
 * record, not always a bug in the probe: an upstream class does what its port changed by hand, and
 * a later item's change is what the probe needs.
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Verdict } from "../src/import/probe.ts";
import {
  CORPUS_DIR,
  CorpusFile,
  FAMILIES,
  type LiveDocument,
  type Manifest,
  printable,
} from "./corpus-manifest.ts";
import { type ProbeRow, shownArgument, VERDICTS } from "./corpus-probe.ts";

/** The oracle's file. */
export const ORACLE_FILE = fileURLToPath(new URL("../corpus/oracle.json", import.meta.url));

/** Where `corpus oracle` fetches the samples, one folder per id, and its probes. Ignored by git. */
export const ORACLE_DIR = join(CORPUS_DIR, "oracle");

const Verdicts = z.enum(VERDICTS as [Verdict, ...Verdict[]]);

/** The kinds of standard node the probe gathers verdicts for. */
const STANDARD = ["section", "item", "label", "paragraph"] as const;

/**
 * What the probe should find for one of a sample's macros' arguments, one of its environments'
 * arguments, or one kind of its standard nodes: a verdict, `locked` for any reason, or one of a
 * few; what the port does with it, marks it or leaves it out of the model; and why.
 */
const Expected = z
  .strictObject({
    macro: z.string().min(1).optional(),
    environment: z.string().min(1).optional(),
    standard: z.enum(STANDARD).optional(),
    /** The argument's place in the signature, from 1, for a macro's or an environment's. */
    argument: z.number().int().positive().optional(),
    port: z.enum(["marks", "omits"]),
    expected: z.union([Verdicts, z.literal("locked")]),
    /** Other verdicts that agree. */
    or: z.array(Verdicts).optional(),
    why: z.string().min(1),
  })
  .superRefine((entry, ctx) => {
    const subjects = [entry.macro, entry.environment, entry.standard].filter(
      (each) => each !== undefined,
    );
    if (subjects.length !== 1)
      ctx.addIssue({
        code: "custom",
        message: "an entry names one macro, environment or standard kind",
      });
    if ((entry.standard === undefined) !== (entry.argument !== undefined))
      ctx.addIssue({
        code: "custom",
        message: "a macro's or an environment's entry names its argument",
      });
  });
export type Expected = z.infer<typeof Expected>;

/** A sample: its files, as the corpus's manifest names a document's, and what the probe should find. */
const OracleDocument = z.strictObject({
  id: z.string().regex(/^[a-z]+(?:-[a-z]+)*-\d{4}$/, "an id is a family, a dash and four digits"),
  family: z.enum(FAMILIES),
  repo: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, "a repository is owner/name"),
  repoId: z.number().int().positive(),
  commit: z.string().regex(/^[0-9a-f]{40}$/, "a commit is 40 lower-case hex digits"),
  license: z.string().min(1).nullable(),
  main: z.string().min(1),
  files: z.array(CorpusFile).min(1),
  images: z.number().int().nonnegative(),
  expected: z.array(Expected).min(1),
});
export type OracleDocument = z.infer<typeof OracleDocument>;

export const Oracle = z
  .strictObject({
    version: z.literal(1),
    documents: z.array(OracleDocument).min(1),
  })
  .superRefine((oracle, ctx) => {
    for (const doc of oracle.documents)
      if (doc.files[0]?.path !== doc.main)
        ctx.addIssue({ code: "custom", message: `${doc.id}: the main file comes first` });
  });
export type Oracle = z.infer<typeof Oracle>;

/** A sample as `corpus fetch` takes a document: the oracle's entry without what it expects. */
export function oracleDocument(doc: OracleDocument): LiveDocument {
  const { expected: _, ...rest } = doc;
  return { ...rest, assets: [] };
}

/** The oracle as a manifest `fetchCorpus` fetches into `ORACLE_DIR`. */
export function oracleManifest(oracle: Oracle, today: string): Manifest {
  const counters = Object.fromEntries(
    FAMILIES.map((family) => [family, 1]),
  ) as Manifest["counters"];
  return {
    version: 1,
    collected: today,
    counters,
    documents: oracle.documents.map(oracleDocument),
  };
}

/** One line of the comparison: a sample's argument or kind, what was expected and what was found. */
export interface OracleLine {
  template: string;
  subject: string;
  port: Expected["port"];
  expected: string;
  found: string;
  agrees: boolean;
  why: string;
}

/** A verdict with how many calls came to it, as the comparison shows one. */
function shownVerdict(verdict: Verdict, counts: Partial<Record<Verdict, number>>, calls: number) {
  const others = Object.entries(counts)
    .filter(([each]) => each !== verdict)
    .map(([each, n]) => `${n} ${each}`);
  return `${verdict} (${counts[verdict] ?? 0} of ${calls}${others.length === 0 ? "" : `; ${others.join(", ")}`})`;
}

/** Whether a found verdict is the one expected. */
function agrees(expected: Expected, found: Verdict | undefined): boolean {
  if (found === undefined) return false;
  if (expected.expected === "locked")
    return found !== "editable" && found !== "container" && found !== "untested";
  return found === expected.expected || (expected.or ?? []).includes(found);
}

/**
 * The expected verdicts of a sample against those its probe found, a line each, and a line for
 * each of the probe's arguments the oracle does not list, which disagrees since the oracle should
 * list every argument its sample has. With no probe, every line disagrees.
 */
export function compare(doc: OracleDocument, row: ProbeRow | undefined): OracleLine[] {
  const lines: OracleLine[] = [];
  const seen = new Set<string>();
  const key = (of: string, name: string, index?: number) => `${of}|${name}|${index ?? ""}`;
  for (const entry of doc.expected) {
    const expected =
      entry.expected === "locked" || entry.or === undefined
        ? entry.expected
        : [entry.expected, ...entry.or].join(" or ");
    if (entry.standard !== undefined) {
      const found = row?.standard?.[entry.standard];
      lines.push({
        template: doc.family,
        subject: `${entry.standard} (standard)`,
        port: entry.port,
        expected,
        found:
          found === undefined
            ? "absent"
            : `${found.verdict} (${found.editable} of ${found.total} editable)`,
        agrees: agrees(entry, found?.verdict),
        why: entry.why,
      });
      continue;
    }
    const of = entry.environment === undefined ? "call" : "environment";
    const name = entry.macro ?? entry.environment ?? "";
    seen.add(key(of, name, entry.argument));
    const found = row?.arguments?.find(
      (each) => each.of === of && each.name === name && each.index === entry.argument,
    );
    const parts =
      found?.parts === undefined
        ? ""
        : `; parts ${found.parts.editable} of ${found.parts.total} editable`;
    const empty = found?.empty === undefined ? "" : `; empty: ${found.empty}`;
    lines.push({
      template: doc.family,
      subject: shownArgument({ of, name, index: entry.argument }) ?? name,
      port: entry.port,
      expected,
      found:
        found === undefined
          ? "absent"
          : `${shownVerdict(found.verdict, found.counts, found.calls)}${empty}${parts}`,
      agrees: agrees(entry, found?.verdict),
      why: entry.why,
    });
  }
  for (const found of row?.arguments ?? []) {
    if (seen.has(key(found.of, found.name, found.index))) continue;
    lines.push({
      template: doc.family,
      subject: shownArgument(found) ?? "an argument whose name is not plain",
      port: "omits",
      expected: "not in the oracle",
      found: shownVerdict(found.verdict, found.counts, found.calls),
      agrees: false,
      why: "The oracle does not list it.",
    });
  }
  return lines;
}

/** The comparison as a Markdown table, and how many lines disagree. */
export function oracleTable(lines: readonly OracleLine[]): string {
  const rows = [
    "| Template | Argument | Port | Expected | Found | |",
    "|---|---|---|---|---|---|",
    ...lines.map(
      (line) =>
        `| ${line.template} | \`${line.subject}\` | ${line.port} | ${line.expected} | ${line.found} | ${line.agrees ? "agrees" : "**disagrees**"} |`,
    ),
    "",
    `Disagreements: ${lines.filter((line) => !line.agrees).length} of ${lines.length}.`,
  ];
  return `${rows.map(printable).join("\n")}\n`;
}
