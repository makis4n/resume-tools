/**
 * The seed (milestone 3 item 6, decision 0024): the naming step's answers for the three launch
 * templates' macros and environments, written by hand from the ports and committed under
 * `corpus/answers/<key>.json`, one file for each, a stored answer (`StoredAnswer`) that a person
 * reviewed. They are the first cache entries, so that a fork of Jake's Resume, AltaCV or
 * Awesome-CV hits the cache from its first import, and the fixtures the pipeline's tests run on
 * with no model.
 *
 * `corpus seed` runs items 4 and 5 on the oracle's upstream samples (`corpus-oracle.ts`), as the
 * import pipeline would: the reference compile, the signatures, the parse, the probe, and the naming
 * request (`src/import/naming.ts`). It prints each sample's macros and environments with their
 * hashes, their keys and the probe's verdicts, and checks that each has an answer file that
 * validates, whose hash is the macro's own and whose key is its file's name. A key is printed
 * with item 4's beside it where the two differ, which is where a sample's own text masked a
 * definition, and a fork's request would not find the file.
 *
 * Besides what a sample calls, the seed answers a few macros its port uses or its preamble
 * defines that the sample leaves out (`SEED_EXTRAS`): the engine is asked of them with the
 * sample's own names, and their keys come from the same class, so that a fork that calls them hits
 * the cache too.
 *
 * What is printed names macros, hashes and verdicts; never a sample's text.
 */

// Node runs this file by stripping its types, so it imports the editor's modules as types alone,
// with their real extensions, and values only from files that import nothing Node lacks.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NAMING_VERSION, type NamingRequest, StoredAnswer } from "@resume-tools/naming";
import type { Verdict } from "../src/import/probe.ts";
import { type Family, printable } from "./corpus-manifest.ts";
import { shownMacro } from "./corpus-parse.ts";

/** The committed answers: one stored answer a file, named by its key. */
export const ANSWERS_DIR = fileURLToPath(new URL("../corpus/answers/", import.meta.url));

/**
 * What the seed answers beside what each sample calls: Jake's Resume's preamble defines
 * `\resumeSubSubheading` and `\resumeSubItem`, which its sample never calls; AltaCV's port sets
 * its contacts through `\printinfo`, which the sample reaches only through the fields
 * `\NewInfoField` makes; and Awesome-CV's port sets labelled items in `cvskills` with `\cvskill`,
 * and the contacts through `\extrainfo`, which the example resume leaves out.
 */
export const SEED_EXTRAS: Readonly<
  Partial<Record<Family, { commands: readonly string[]; environments: readonly string[] }>>
> = {
  jake: { commands: ["resumeSubSubheading", "resumeSubItem"], environments: [] },
  altacv: { commands: ["printinfo"], environments: [] },
  "awesome-cv": { commands: ["cvskill", "extrainfo"], environments: ["cvskills"] },
};

/** One of a sample's macros or environments, as the seed checks it: names and numbers only. */
export interface SeedMacro {
  of: "command" | "environment";
  name: string;
  /** Its own definition's hash, and its key; none for a macro that holds data. */
  hash?: string;
  key?: string;
  /** Item 4's key for it (`keysOf`), where it differs from the request's. */
  item4?: string;
  signature?: string;
  arguments: { index: number; kind: string; verdict?: Verdict; empty?: Verdict }[];
  calls: number;
  /** Whether the seed answers it though the sample does not call it (`SEED_EXTRAS`). */
  extra: boolean;
}

/**
 * A sample's redefinitions, those its macros' answers carry, and what they do to its page: its
 * calls to the macros they serve regenerated as item 7 writes them (`regenerate`), the rest of its
 * body as it is, compiled with them against the same body
 * compiled without them, `keeps` when the two set the same glyphs, else how they first differ, or
 * `stopped`; and the sample as it is, compiled with them against its reference, which a
 * redefinition written for the generator's escaped text may not take, as AltaCV's `\printinfo`
 * does not take a raw `_`.
 */
export interface SeedRedefinitions {
  names: string[];
  regenerated: string;
  raw: string;
  /** What each does alone, when together they do not keep both pages. */
  each?: { name: string; regenerated: string; raw: string }[];
}

/** What became of a sample: its request's macros, or why there are none. */
export interface SeedRow {
  id: string;
  family: Family;
  outcome: "requested" | "no reference" | "not parsed" | "crashed" | "timeout";
  engine?: "pdftex" | "xetex";
  macros?: SeedMacro[];
  redefinitions?: SeedRedefinitions;
}

/** A row as a child sends it, before the parent adds the sample's id and family. */
export type SeedChildRow = Omit<SeedRow, "id" | "family">;

/**
 * A request's macros as the seed checks them: each one's name, hash, key and verdicts, with item
 * 4's key where it differs, and whether the seed asked of it though the sample does not call it.
 */
export function seedMacros(
  request: NamingRequest,
  item4: Readonly<Record<string, string>>,
  extras: { commands: readonly string[]; environments: readonly string[] } | undefined,
): SeedMacro[] {
  const definitions = new Map(request.definitions.map((each) => [each.name, each]));
  return request.macros.map((macro) => {
    const own = definitions.get(macro.name);
    const extra =
      macro.calls === 0 &&
      (macro.of === "command" ? extras?.commands : extras?.environments)?.includes(macro.name) ===
        true;
    const theirs = macro.of === "command" ? item4[macro.name] : undefined;
    return {
      of: macro.of,
      name: macro.name,
      ...(own?.kind === "definition" ? { hash: own.hash } : {}),
      ...(macro.key === undefined ? {} : { key: macro.key }),
      ...(theirs !== undefined && theirs !== macro.key ? { item4: theirs } : {}),
      ...(macro.signature === undefined ? {} : { signature: macro.signature }),
      arguments: macro.arguments.map((argument) => ({ ...argument })),
      calls: macro.calls,
      extra,
    };
  });
}

/**
 * What the answers folder holds for a macro: a stored answer that validates, of this naming
 * version, filed under its key, for its name and kind, whose hash is the macro's own (`ok`); or
 * what is wrong: no file, a file that does not validate, a hash or a key or a name that is
 * another's. A macro that holds data has no key, and needs no answer (`data`).
 */
export type AnswerState = "ok" | "data" | "missing" | "invalid" | "hash" | "key" | "name";

/** The state of a macro's answer, and a line of what is wrong, naming no text. */
export function answerState(
  macro: SeedMacro,
  read: (key: string) => string | undefined,
): { state: AnswerState; why?: string } {
  if (macro.key === undefined || macro.hash === undefined) return { state: "data" };
  const text = read(macro.key);
  if (text === undefined) return { state: "missing" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { state: "invalid", why: "not JSON" };
  }
  const parsed = StoredAnswer.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      state: "invalid",
      why: `${issue?.path.join(".") ?? ""}: ${issue?.message ?? "does not validate"}`,
    };
  }
  const stored = parsed.data;
  if (stored.version !== NAMING_VERSION || stored.key !== macro.key) return { state: "key" };
  if (stored.hash !== macro.hash) return { state: "hash" };
  if (stored.name !== macro.name || stored.of !== macro.of) return { state: "name" };
  return { state: "ok" };
}

/**
 * The redefinitions the answers for these macros carry, each once by its name, in the order the
 * macros come, and the macros whose answers carry any, as `of|name`; an answer that does not
 * validate carries none.
 */
export function redefinitionsOf(
  macros: readonly { of: string; name: string; key?: string }[],
  read: (key: string) => string | undefined,
): { redefinitions: { name: string; latex: string }[]; serving: Set<string> } {
  const found = new Map<string, string>();
  const serving = new Set<string>();
  for (const macro of macros) {
    const text = macro.key === undefined ? undefined : read(macro.key);
    if (text === undefined) continue;
    let parsed: ReturnType<typeof StoredAnswer.safeParse>;
    try {
      parsed = StoredAnswer.safeParse(JSON.parse(text));
    } catch {
      continue;
    }
    if (!parsed.success || !("reviewed" in parsed.data.answer)) continue;
    const redefinitions = parsed.data.answer.redefinitions ?? [];
    if (redefinitions.length > 0) serving.add(`${macro.of}|${macro.name}`);
    for (const each of redefinitions) if (!found.has(each.name)) found.set(each.name, each.latex);
  }
  return { redefinitions: [...found].map(([name, latex]) => ({ name, latex })), serving };
}

/** An answer file's key, from its name, or none for a name that is no key's. */
export const keyOfFile = (name: string) => /^([0-9a-f]{64})\.json$/.exec(name)?.[1];

/** Reads the committed answers, by key, and lists the files. */
export function answersFolder(dir: string = ANSWERS_DIR): {
  read: (key: string) => string | undefined;
  keys: string[];
} {
  const keys = existsSync(dir)
    ? readdirSync(dir)
        .map(keyOfFile)
        .filter((key): key is string => key !== undefined)
    : [];
  return {
    read: (key) => {
      const path = join(dir, `${key}.json`);
      return existsSync(path) ? readFileSync(path, "utf8") : undefined;
    },
    keys,
  };
}

/** What redefinitions do to a page, as the table says it: `keeps`, or how it first differs. */
const shownEffect = (effect: string) =>
  effect === "keeps" ? "keeps" : effect === "stopped" ? "**stopped**" : `moves it (${effect})`;

/** A hash as the table shows it: its first twelve digits. */
const short = (hash: string | undefined) => (hash === undefined ? "" : `\`${hash.slice(0, 12)}\``);

/** A macro's verdicts as the table shows them: each argument's, and its empty calls'. */
function verdicts(macro: SeedMacro): string {
  if (macro.arguments.length === 0) return "no arguments";
  return macro.arguments
    .map(
      (argument) =>
        `#${argument.index} ${argument.verdict ?? "not called"}${argument.empty === undefined ? "" : ` (empty: ${argument.empty})`}`,
    )
    .join(", ");
}

/**
 * The seed's table: for each sample's macro and environment, its hash and key, item 4's key where
 * it differs, the probe's verdicts, and the state of its answer; then the answer files no macro
 * claims, and the count of problems. Names of macros only when they are plainly one.
 */
export function seedTable(
  rows: readonly SeedRow[],
  read: (key: string) => string | undefined,
  files: readonly string[],
): { table: string; problems: number } {
  const lines = [
    "| Template | Macro | Hash | Key | Verdicts | Answer |",
    "|---|---|---|---|---|---|",
  ];
  let problems = 0;
  const claimed = new Set<string>();
  for (const row of rows) {
    if (row.outcome !== "requested") {
      lines.push(`| ${row.family} | ${row.outcome} | | | | **missing** |`);
      problems++;
      continue;
    }
    for (const macro of row.macros ?? []) {
      const shown = shownMacro(macro.name);
      const name =
        shown === undefined
          ? "a name that is not plain"
          : macro.of === "environment"
            ? `${shown.slice(1)} (environment)`
            : shown;
      const { state, why } = answerState(macro, read);
      if (macro.key !== undefined) claimed.add(macro.key);
      if (state !== "ok" && state !== "data") problems++;
      const key = `${short(macro.key)}${macro.item4 === undefined ? "" : `, item 4's ${short(macro.item4)}`}`;
      const answer =
        state === "ok" || state === "data"
          ? state
          : `**${state}**${why === undefined ? "" : ` (${why})`}`;
      lines.push(
        `| ${row.family} | \`${name}\`${macro.extra ? " (not called)" : ""} | ${short(macro.hash)} | ${key} | ${verdicts(macro)} | ${answer} |`,
      );
    }
  }
  const unclaimed = files.filter((key) => !claimed.has(key));
  lines.push("");
  for (const row of rows) {
    const found = row.redefinitions;
    if (found === undefined) continue;
    // A redefinition that moves a page is item 7's to judge, document by document, by the
    // reference check; one that stops a compile the page takes without it is the seed's to fix.
    if (found.regenerated === "stopped" || found.raw === "stopped") problems++;
    const named = (name: string) => `\\${name}`;
    lines.push(
      `${row.family}: ${found.names.length} ${found.names.length === 1 ? "redefinition" : "redefinitions"} (${found.names.map(named).join(", ")}); its calls they serve regenerated, with them against without them: ${shownEffect(found.regenerated)}; the sample as it is, against its reference: ${shownEffect(found.raw)}.`,
      ...(found.each ?? []).map(
        (one) =>
          `  ${named(one.name)} alone: regenerated ${shownEffect(one.regenerated)}; as it is ${shownEffect(one.raw)}.`,
      ),
    );
  }
  lines.push("");
  if (unclaimed.length > 0)
    lines.push(
      `Answer files no sample's macro claims: ${unclaimed.map((key) => short(key)).join(", ")}.`,
    );
  lines.push(`Problems: ${problems}.`);
  return { table: `${lines.map(printable).join("\n")}\n`, problems };
}
