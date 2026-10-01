/**
 * The review of the top templates' answers (milestone 3 item 17, decisions 0037 and 0043): what
 * `corpus review export` writes for an Opus agent to read, and what `corpus review check` proves of
 * the redefinitions a review writes.
 *
 * **What the run keeps.** For each document, `corpus run` keeps under `.corpus/run/<id>/review.json`
 * what the review reads of it (`RunDocument`): its naming request as the privacy gate is given it,
 * whether the gate passes it, the document's text as the leak check reads it, which the export is
 * checked against and which never leaves `.corpus/`, and its macros' fates, reduced to reasons,
 * macro names and counts (`reviewNotesOf`).
 *
 * **Templates.** Two documents are of one template when their requests share at least MIN_SHARED
 * macro keys and at least half the keys of the one with fewer; a template is every document linked
 * so, directly or through others (`templatesOf`). Templates are ranked by the documents they cover,
 * then by their keys, then by their first document's id.
 *
 * **The export.** For each of the top templates, one folder (`exportPlan`): the requests of the
 * fewest of its documents that together hold every key its passing requests hold, each written as
 * the gate passed it, never one the gate withholds; the answer the cache serves now for each of its
 * keys, as the cache holds it; and `template.json`, its documents' outcomes and its macros' fates
 * summed by key, each named as a written request names it. Everything is checked with the leak
 * detector against every document of the template before it is written: a request must hold none
 * of their text, and any other file none but a single word the builder does not mask by either, as
 * a word of the contract's own, `education` as a role, is one.
 *
 * **The check.** A redefinition a reviewed answer carries is kept when every corpus document whose
 * request holds the answer's key, and whose import reaches the checks, applies it, its page kept,
 * and runs the checks through; it is dropped when one drops it, the checks stop on one, or one times
 * out or dies (`redefinitionVerdicts`).
 *
 * Node runs this file by stripping its types, so it imports values only from files that import
 * nothing Node lacks, and the editor's modules as types alone, with their real extensions.
 */

import {
  type AnswerCache,
  answerFor,
  type NamingRequest,
  type RequestMacro,
  VERDICTS,
} from "@resume-tools/naming";
import type { AssemblyChecks, LockedPart, LockReason } from "../src/import/assemble.ts";
import type { DocumentText, HeaderValues, PageStrings } from "../src/import/naming.ts";
import type { Node, Tree } from "../src/import/parse.ts";
import type { Aggregate } from "../src/import/probe.ts";
import { CHECK_NOTES, CHECKS, LOCK_REASONS } from "./corpus-assemble.ts";
import { FAMILIES, type Family, formatJson, printable } from "./corpus-manifest.ts";
import { shownMacro } from "./corpus-parse.ts";
import { type RefusalStep, RUN_OUTCOMES, type RunOutcome, type RunRecord } from "./corpus-run.ts";

// What the run keeps of a document.

/** A tally: how many parts, and how many words they hold. */
export interface Tally {
  parts: number;
  words: number;
}

/** A macro's fate in one document, or summed over a template's: counts, by reason and check. */
export interface MacroFate {
  /** How many calls the document makes of it. */
  calls: number;
  /** How the cache answered it when the run asked: a reviewed answer, the model's, none, or refused. */
  answer: "reviewed" | "model" | "none" | "refused";
  /** The probe's verdicts on its arguments, by index: how many calls came to each. */
  verdicts: Record<string, Partial<Record<string, number>>>;
  /** Its fields over its calls: editable, raw, required, and locked by reason. */
  fields: {
    editable: number;
    raw: number;
    required: number;
    locked: Partial<Record<string, number>>;
  };
  /** The parts kept locked at its calls, by reason. */
  parts: Partial<Record<string, Tally>>;
  /** The harness's findings and the checks' own on its fields, by check. */
  findings: Partial<Record<string, number>>;
}

/** A macro of a document's request, as the review reads it: by its key, named as the request names it. */
export interface MacroNotes extends MacroFate {
  of: "command" | "environment";
  name: string;
  key: string;
}

/** What a document's import came to, macro by macro, and what no macro holds. */
export interface ReviewNotes {
  macros: MacroNotes[];
  /** Locked parts and findings at no macro of the request: the body's own text, a raw chunk. */
  elsewhere: { parts: Partial<Record<string, Tally>>; findings: Partial<Record<string, number>> };
  /** The redefinitions the checks applied and dropped, by name: template code, from the answers. */
  redefinitions: { applied: string[]; dropped: string[] };
  /** The checks' own notes the validation gave: `stopped`, `untested`, `unproven`. */
  checks: string[];
}

/**
 * A document's text as the leak check reads it (`DocumentText`), as JSON keeps it: the body's tree,
 * the header's values, the texts its preamble stores, its sources, its page's strings and the names
 * its request writes as placeholders. It is the document's, and stays under `.corpus/` alone.
 */
export interface KeptText {
  tree: Tree;
  header: HeaderValues;
  stored: string[];
  sources: string[];
  page: PageStrings;
  names: [string, string][];
}

/** What `corpus run` keeps of a document for the review, under `.corpus/run/<id>/review.json`. */
export interface RunDocument {
  id: string;
  family: Family;
  outcome: RunOutcome;
  /**
   * Its naming request as the import sends it (`importRequest`, decision 0038): built with the
   * upload's sources and the page's strings, and without the header's values, which the check of
   * it is given besides (`gate`).
   */
  request?: NamingRequest;
  gate?: "passes" | "withholds";
  text?: KeptText;
  notes?: ReviewNotes;
  /** Its editable rate, where it was assembled. */
  rate?: number;
  /** The stamp of the run that kept it (`RunRecord`). */
  run?: string;
}

/**
 * Why what the last run kept cannot serve the review's export, or its check, in one line; none when
 * it can. The review reads the committed answers and `model`'s cache, so the run must have read the
 * same; it must have finished, and every document it took must carry its stamp, none left by
 * another run (`stamps`, each document's by its id); and the check, which holds a redefinition to
 * every corpus document whose request holds its key, needs a run that took every fetched one.
 */
export function runMismatch(input: {
  record: RunRecord | undefined;
  purpose: "export" | "check";
  model: string;
  fetched: readonly string[];
  stamps: ReadonlyMap<string, string | undefined>;
}): string | undefined {
  const { record, model } = input;
  if (record === undefined) return "No run is recorded: run `corpus run` first.";
  if (!record.complete) return "The last run did not finish: run `corpus run` again.";
  if (record.answers !== "cache")
    return `The last run read the committed answers alone, and the review reads ${model}'s cache too: run \`corpus run\` without --committed-only.`;
  if (record.cache !== model)
    return `The last run read ${record.cache === null ? "no model's cache" : `${record.cache}'s cache`}, and NAMING_MODEL names ${model}: run \`corpus run\` with the one model.`;
  const taken = new Set(record.ids);
  if (input.purpose === "check" && input.fetched.some((id) => !taken.has(id)))
    return `The last run took ${record.ids.length} of the ${input.fetched.length} fetched documents, and the check holds a redefinition to every one: run \`corpus run\` over the whole corpus.`;
  const stale = record.ids.filter((id) => input.stamps.get(id) !== record.stamp).length;
  if (stale > 0)
    return `${stale} of the last run's ${record.ids.length} documents ${stale === 1 ? "was" : "were"} kept by another run: run \`corpus run\` again.`;
  return undefined;
}

/** The document's text as the leak check takes it, from what the run kept. */
export const documentTextOf = (text: KeptText): DocumentText => ({
  tree: text.tree,
  header: text.header,
  stored: text.stored,
  sources: text.sources,
  page: text.page,
  names: new Map(text.names),
});

/** A macro's identity: whether a command or an environment, and its name. */
const identity = (of: string, name: string) => `${of}|${name}`;

/** A macro's fate with nothing counted yet. */
const blank = (answer: MacroFate["answer"]): MacroFate => ({
  calls: 0,
  answer,
  verdicts: {},
  fields: { editable: 0, raw: 0, required: 0, locked: {} },
  parts: {},
  findings: {},
});

/** Add `n` to a count under `key`. */
function bump(counts: Partial<Record<string, number>>, key: string, n = 1) {
  counts[key] = (counts[key] ?? 0) + n;
}

/** Add a part of `words` words to a tally under `key`. */
function tally(tallies: Partial<Record<string, Tally>>, key: string, parts: number, words: number) {
  const each = tallies[key] ?? { parts: 0, words: 0 };
  each.parts += parts;
  each.words += words;
  tallies[key] = each;
}

/** A slot's macro, from its key `of|name|index` (`slotKey`); none for a standard node's kind. */
function slotMacro(slot: string): string | undefined {
  const parts = slot.split("|");
  if (parts.length < 3) return undefined;
  const [of, ...rest] = parts;
  rest.pop();
  return of === "command" || of === "environment" ? identity(of, rest.join("|")) : undefined;
}

/** A node's children: its arguments' content and its own, whatever its kind. */
function childrenOf(node: Node): Node[] {
  const args = "args" in node && node.args !== undefined ? node.args : [];
  const content = "content" in node && Array.isArray(node.content) ? node.content : [];
  return [...args.flatMap((arg) => arg.content ?? []), ...content];
}

/** The macro a node calls or opens, as the request would name it: a command or an environment. */
function nodeMacro(node: Node): string | undefined {
  if (node.kind === "call") return identity("command", node.name);
  if (node.kind === "environment") return identity("environment", node.name);
  if (node.kind === "raw" && node.name !== undefined)
    return identity(node.why === "environment" ? "environment" : "command", node.name);
  return undefined;
}

/**
 * The innermost macro of `known` whose call, or environment, holds `offset` of a tree's source: the
 * macro a locked part that starts there belongs to. Siblings never overlap, so the first that holds
 * it is the one to go into.
 */
export function macroAt(
  nodes: readonly Node[],
  offset: number,
  known: (macro: string) => boolean,
): string | undefined {
  let found: string | undefined;
  let level: readonly Node[] = nodes;
  for (;;) {
    const holder = level.find((node) => node.start <= offset && offset < node.end);
    if (holder === undefined) return found;
    const macro = nodeMacro(holder);
    if (macro !== undefined && known(macro)) found = macro;
    level = childrenOf(holder);
  }
}

/** What a document's validation gives the notes: its checks, and its locked parts. */
export interface NotedAssembly {
  checks: Pick<AssemblyChecks, "all" | "findings" | "required" | "redefinitions">;
  extras: readonly Pick<LockedPart, "at" | "reason" | "words">[];
}

/** The checks' own notes, `stopped`, `untested` and `unproven`, as `corpus-assemble.ts` lists them. */
const NOTE_CHECKS: ReadonlySet<string> = new Set(CHECK_NOTES);

/**
 * What a document's import came to, macro by macro, for the review (`ReviewNotes`): each macro of
 * its request with a key, named as the request names it, with how the cache answered it, the
 * probe's verdicts on its arguments, its fields, the parts kept locked at its calls and the findings
 * on its fields; and what no macro holds. `realName` reads a request's name back to the document's,
 * as the assembly and the probe name macros (`realName` of `naming.ts`); `cache` is the one the run
 * answered from, asked again for each macro as the assembly asks it (`answerFor`).
 */
export async function reviewNotesOf(input: {
  request: Pick<NamingRequest, "macros">;
  realName: (name: string) => string;
  cache: Pick<AnswerCache, "get">;
  probe: { macros: readonly Aggregate[] };
  assembled?: NotedAssembly;
  trees: { body: Tree; preamble?: Tree };
}): Promise<ReviewNotes> {
  const keyed = input.request.macros.filter(
    (macro): macro is RequestMacro & { key: string } => macro.key !== undefined,
  );
  // The request's names by the document's, as the probe and the assembly name macros.
  const byReal = new Map<string, MacroNotes>();
  const partners = new Map(
    keyed.flatMap((macro) =>
      macro.of === "command" ? [[input.realName(macro.name), macro.key] as const] : [],
    ),
  );
  const macros: MacroNotes[] = [];
  for (const macro of keyed) {
    const real = input.realName(macro.name);
    const given = await answerFor(input.cache, macro.key, { name: real, of: macro.of, partners });
    const answer =
      given === undefined
        ? "none"
        : "reason" in given
          ? "refused"
          : given.reviewed
            ? "reviewed"
            : "model";
    const notes: MacroNotes = {
      of: macro.of,
      name: macro.name,
      key: macro.key,
      ...blank(answer),
      calls: macro.calls,
    };
    macros.push(notes);
    byReal.set(identity(macro.of, real), notes);
  }
  for (const each of input.probe.macros) {
    if (each.of === "standard" || each.index === undefined) continue;
    const notes = byReal.get(identity(each.of === "call" ? "command" : "environment", each.name));
    if (notes === undefined) continue;
    const verdicts = (notes.verdicts[String(each.index)] ??= {});
    for (const [verdict, n] of Object.entries(each.counts)) bump(verdicts, verdict, n ?? 0);
  }
  const elsewhere: ReviewNotes["elsewhere"] = { parts: {}, findings: {} };
  const checks: string[] = [];
  const assembled = input.assembled;
  if (assembled !== undefined) {
    const fields = new Map(assembled.checks.all.map((field) => [field.field, field]));
    for (const field of assembled.checks.all) {
      const macro = slotMacro(field.slot);
      const notes = macro === undefined ? undefined : byReal.get(macro);
      if (notes === undefined) continue;
      if (field.mode === "typeset") notes.fields.editable++;
      else if (field.mode === "raw") notes.fields.raw++;
      else bump(notes.fields.locked, field.reason ?? "locked");
    }
    for (const slot of assembled.checks.required) {
      const macro = slotMacro(slot);
      const notes = macro === undefined ? undefined : byReal.get(macro);
      if (notes !== undefined) notes.fields.required++;
    }
    for (const finding of assembled.checks.findings) {
      if (NOTE_CHECKS.has(finding.check) && !checks.includes(finding.check))
        checks.push(finding.check);
      const field = finding.field === undefined ? undefined : fields.get(finding.field);
      const macro = field === undefined ? undefined : slotMacro(field.slot);
      const notes = macro === undefined ? undefined : byReal.get(macro);
      bump(notes?.findings ?? elsewhere.findings, finding.check);
    }
    const known = (macro: string) => byReal.has(macro);
    for (const part of assembled.extras) {
      const at = /^([bp])(\d+)$/.exec(part.at);
      const tree = at?.[1] === "p" ? input.trees.preamble : input.trees.body;
      const macro =
        at === null || tree === undefined ? undefined : macroAt(tree.content, Number(at[2]), known);
      const notes = macro === undefined ? undefined : byReal.get(macro);
      tally(notes?.parts ?? elsewhere.parts, part.reason, 1, part.words);
    }
  }
  return {
    macros,
    elsewhere,
    redefinitions: {
      applied: [...(assembled?.checks.redefinitions.applied ?? [])],
      dropped: [...(assembled?.checks.redefinitions.dropped ?? [])],
    },
    checks: checks.sort(),
  };
}

// Templates.

/** The fewest keys two documents' requests share to be of one template. */
export const MIN_SHARED = 2;

/** The rule the export states in its index. */
export const TEMPLATE_RULE = `Two documents are of one template when their naming requests share at least ${MIN_SHARED} macro keys and at least half the keys of the one with fewer; a template is every document linked so, directly or through others, ranked by the documents it covers.`;

/** A document as the grouping reads it: its id, its family, and its request's macro keys. */
export interface Keyed {
  id: string;
  family: Family;
  keys: readonly string[];
}

/** A template of the corpus: documents whose requests share their macro keys (`templatesOf`). */
export interface Template {
  rank: number;
  /** Its folder's name in the export: its rank, and the family most of its documents are of. */
  folder: string;
  family: Family;
  documents: string[];
  /** Every key its documents' requests hold, by how many of them hold it, most first. */
  keys: string[];
}

/**
 * Whether two documents' requests are of one template: they share at least MIN_SHARED keys, and at
 * least half the keys of the one with fewer, so that a fork that calls fewer of its template's
 * macros is its template's, and a key two templates happen to share, a bare `\end{itemize}`
 * closer's, links neither.
 */
export function linked(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  let shared = 0;
  for (const key of a) if (b.has(key)) shared++;
  return shared >= MIN_SHARED && 2 * shared >= Math.min(a.size, b.size);
}

/**
 * The corpus's templates, from its documents' requests' keys: each set of documents linked
 * (`linked`) directly or through others, ranked by how many documents it covers, then by how many
 * keys, then by its first document's id, so that the same documents give the same templates in any
 * order. A document whose request holds no key is of none.
 */
export function templatesOf(documents: readonly Keyed[]): Template[] {
  const docs = [...documents]
    .filter((doc) => doc.keys.length > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sets = docs.map((doc) => new Set(doc.keys));
  const parent = docs.map((_, i) => i);
  const root = (i: number): number => {
    let at = i;
    while (parent[at] !== at) at = parent[at] ?? at;
    return at;
  };
  for (let i = 0; i < docs.length; i++)
    for (let j = i + 1; j < docs.length; j++) {
      const [a, b] = [sets[i], sets[j]];
      if (a === undefined || b === undefined || !linked(a, b)) continue;
      const [x, y] = [root(i), root(j)];
      if (x !== y) parent[Math.max(x, y)] = Math.min(x, y);
    }
  const groups = new Map<number, number[]>();
  docs.forEach((_, i) => {
    const at = root(i);
    groups.set(at, [...(groups.get(at) ?? []), i]);
  });
  const unranked = [...groups.values()].map((members) => {
    const counts = new Map<string, number>();
    const families = new Map<Family, number>();
    for (const i of members) {
      for (const key of sets[i] ?? []) counts.set(key, (counts.get(key) ?? 0) + 1);
      const family = docs[i]?.family ?? "other";
      families.set(family, (families.get(family) ?? 0) + 1);
    }
    const family =
      [...families].sort(
        ([a, x], [b, y]) => y - x || FAMILIES.indexOf(a) - FAMILIES.indexOf(b),
      )[0]?.[0] ?? "other";
    return {
      family,
      documents: members.map((i) => docs[i]?.id ?? ""),
      keys: [...counts].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)).map(([key]) => key),
    };
  });
  unranked.sort(
    (a, b) =>
      b.documents.length - a.documents.length ||
      b.keys.length - a.keys.length ||
      ((a.documents[0] ?? "") < (b.documents[0] ?? "") ? -1 : 1),
  );
  return unranked.map((each, i) => ({
    rank: i + 1,
    folder: `${String(i + 1).padStart(2, "0")}-${each.family}`,
    ...each,
  }));
}

// The export.

/** A file the export writes, by its path under the export's folder. */
export interface ExportFile {
  path: string;
  text: string;
}

/** A leak the detector finds, as `findLeaks` of `naming.ts` gives it, which this file cannot import. */
export interface FoundLeak {
  origin: string;
  kind: string;
  alone?: true;
}

/** The leak detector (`findLeaks`), which the caller brings from the editor's modules. */
export type FindLeaks = (request: NamingRequest, document: DocumentText) => readonly FoundLeak[];

/** What a file the export writes is, which says what of it the leak check reads (`leaksIn`). */
export type ExportKind = "request" | "answer" | "summary";

/**
 * The fields that hold names of macros and definitions, a macro's own, a list's partner's, a
 * redefinition's and the dependencies', and keys and hashes: code, which the gate reads by its own
 * rule for names and never as text (decision 0033). Every name the export writes comes from a
 * request the gate passed, an answer filed from one, or the seed.
 */
const NAME_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "closedBy",
  "openedBy",
  "dependencies",
  "partnerKeys",
  "key",
  "hash",
]);

/** The fields whose keys, not values, are names: the redefinitions applied and dropped, by name. */
const NAMED_KEYS: ReadonlySet<string> = new Set(["applied", "dropped"]);

/** The export's sentences: what `template.json` and `index.json` say in words of their own. */
export const NO_REQUEST_NOTE =
  "No request of this template is written: the privacy gate withholds every one, or it holds another document's text.";
export const UNWRITTEN_NOTE = "Only requests not written hold it.";
const WHY_UNCHECKED =
  "The run kept no text of one of its documents, to check what it would write against.";
const WHY_LEAK = "The leak check found a document's text in its summary.";

/** The fields of `template.json` and `index.json`. */
const SUMMARY_FIELDS = [
  "version",
  "template",
  "rank",
  "family",
  "documents",
  "id",
  "outcome",
  "rate",
  "gate",
  "request",
  "requests",
  "written",
  "withheld",
  "note",
  "outcomes",
  "macros",
  "of",
  "answer",
  "file",
  "filing",
  "calls",
  "verdicts",
  "fields",
  "editable",
  "raw",
  "required",
  "locked",
  "parts",
  "words",
  "findings",
  "refusedIn",
  "elsewhere",
  "redefinitions",
  "applied",
  "dropped",
  "checks",
  "rule",
  "fetched",
  "run",
  "withRequests",
  "templates",
  "folder",
  "keys",
  "answers",
  "why",
];

/**
 * The export's own words in a summary: its fields, and the closed lists its values come from, the
 * outcomes, families, lock reasons, the harness's checks and the checks' own, the probe's verdicts,
 * the gate's words, where an answer comes from and what a macro is; and its own sentences.
 */
const OWN_WORDS: ReadonlySet<string> = new Set([
  ...SUMMARY_FIELDS,
  ...RUN_OUTCOMES,
  ...FAMILIES,
  ...LOCK_REASONS,
  ...CHECKS,
  ...CHECK_NOTES,
  ...VERDICTS,
  ...["passes", "withholds", "none", "reviewed", "model", "command", "environment"],
  ...[NO_REQUEST_NOTE, UNWRITTEN_NOTE, TEMPLATE_RULE, WHY_UNCHECKED, WHY_LEAK],
]);

/**
 * The shapes of the export's own values: a key or a hash, a document's id, a number, a template's
 * folder, and a file the export writes.
 */
const OWN_SHAPES: readonly RegExp[] = [
  /^[0-9a-f]{64}$/,
  /^[a-z]+(?:-[a-z]+)*-\d{4}$/,
  /^\d+$/,
  /^\d{2,}-[a-z]+(?:-[a-z]+)*$/,
  /^(?:requests\/[a-z]+(?:-[a-z]+)*-\d{4}|answers\/[0-9a-f]{64})\.json$/,
];

/** Whether a summary's string is the export's own: a word, a sentence or a value of its own, or a name. */
const own = (value: string, names: ReadonlySet<string>) =>
  OWN_WORDS.has(value) || OWN_SHAPES.some((shape) => shape.test(value)) || names.has(value);

/**
 * What of a file's JSON the leak check reads, its texts, and a redefinition's LaTeX apart, which is
 * read as the source it is: of an answer, which its schema holds to the contract's closed lists,
 * keys and names, its notes and its redefinitions' LaTeX; of a summary, every string and every key
 * but the names and hashes (`NAME_FIELDS`, `NAMED_KEYS`) and the export's own (`own`).
 */
function readable(
  value: unknown,
  kind: "answer" | "summary",
  names: ReadonlySet<string>,
  into: { text: string[]; latex: string[] },
  field = "",
): void {
  if (typeof value === "string") {
    if (field === "latex") into.latex.push(value);
    else if (kind === "answer" ? field === "notes" : !own(value, names)) into.text.push(value);
  } else if (Array.isArray(value))
    for (const each of value) readable(each, kind, names, into, field);
  else if (value !== null && typeof value === "object")
    for (const [key, each] of Object.entries(value)) {
      if (NAME_FIELDS.has(key)) continue;
      if (kind === "summary" && !NAMED_KEYS.has(field) && !own(key, names)) into.text.push(key);
      readable(each, kind, names, into, NAMED_KEYS.has(field) ? "" : key);
    }
}

/**
 * What the export writes beside the requests, as the leak check reads it: the arguments of a call
 * site of a request of its own, which the gate reads as it reads a call site's (decision 0033): its
 * texts with every backslash and percent sign a space, so that the check reads each of their letters
 * and digits, a command's name and a comment's too; and a redefinition's LaTeX as the source it is.
 */
export function asCallSite(text: string, latex = ""): NamingRequest {
  return {
    version: 1,
    engine: "pdftex",
    preamble: { settings: [] },
    macros: [
      {
        of: "command",
        name: "rtexport",
        dependencies: [],
        capped: false,
        arguments: [
          { index: 1, kind: "mandatory" },
          { index: 2, kind: "mandatory" },
        ],
        sites: [{ arguments: [text.replace(/[\\%]/g, " "), latex] }],
        calls: 1,
      },
    ],
    definitions: [],
  } as NamingRequest;
}

/**
 * Whether a file holds any of a document's text, and what kinds, never the text: a request, any at
 * all, as the gate refuses one; an answer or a summary, what of its JSON can hold text (`readable`),
 * any but a single word the builder does not mask by (`Leak.alone`). `names` are the macros' and
 * definitions' names a summary may hold, those of the requests the export writes beside it. A file
 * that is no JSON is read whole.
 */
export function leaksIn(
  file: { text: string; kind: ExportKind; request?: NamingRequest; names?: ReadonlySet<string> },
  documents: readonly DocumentText[],
  findLeaks: FindLeaks,
): string[] {
  const kinds = new Set<string>();
  let read = { text: [file.text], latex: [] as string[] };
  if (file.kind !== "request")
    try {
      const into = { text: [] as string[], latex: [] as string[] };
      readable(JSON.parse(file.text), file.kind, file.names ?? new Set(), into);
      read = into;
    } catch {
      // Not JSON: the whole of it is read as text.
    }
  const site = asCallSite(read.text.join("\n"), read.latex.join("\n"));
  for (const document of documents) {
    const leaks =
      file.kind === "request" && file.request !== undefined
        ? findLeaks(file.request, document)
        : findLeaks(site, document).filter((leak) => leak.alone !== true);
    for (const leak of leaks) kinds.add(`${leak.origin} in ${leak.kind}`);
  }
  return [...kinds].sort();
}

/** The keys a request's macros hold. */
const keysOfRequest = (request: Pick<NamingRequest, "macros">) =>
  request.macros.flatMap((macro) => (macro.key === undefined ? [] : [macro.key]));

/**
 * The fewest requests that together hold every key in `wanted`, greedily: the one that holds the
 * most keys not yet held first, the first by id among equals.
 */
export function coverOf(
  requests: readonly { id: string; keys: ReadonlySet<string> }[],
  wanted: ReadonlySet<string>,
): string[] {
  const left = new Set(wanted);
  const pool = [...requests].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const chosen: string[] = [];
  while (left.size > 0) {
    let best: (typeof pool)[number] | undefined;
    let most = 0;
    for (const each of pool) {
      let count = 0;
      for (const key of each.keys) if (left.has(key)) count++;
      if (count > most) {
        best = each;
        most = count;
      }
    }
    if (best === undefined) break;
    chosen.push(best.id);
    for (const key of best.keys) left.delete(key);
  }
  return chosen;
}

/**
 * The dependencies a macro's key is computed from, as a stored answer files them: its closure's
 * definitions that are code, by name and hash, in the closure's order, data left out, as
 * `storedAnswersOf` of the naming package gives them.
 */
function filingOf(request: NamingRequest, macro: RequestMacro) {
  const definitions = new Map(request.definitions.map((each) => [each.name, each]));
  const own = definitions.get(macro.name);
  if (own?.kind !== "definition") return undefined;
  return {
    hash: own.hash,
    ...(request.family === undefined ? {} : { family: request.family }),
    dependencies: macro.dependencies.flatMap((name) => {
      const found = definitions.get(name);
      return found?.kind === "data" ? [] : [[name, found?.hash ?? null]];
    }),
  };
}

/** A key's fates over a template's documents, summed (`MacroFate`). */
interface Summed extends Omit<MacroFate, "answer"> {
  /** In how many of them the cache's answer was refused for the macro, another kind's or pairing. */
  refusedIn: number;
}

/** A key's sum with nothing counted yet. */
function blankSum(): Summed {
  const { answer: _answer, ...fate } = blank("none");
  return { ...fate, refusedIn: 0 };
}

/** Add a document's fate of a macro to a key's sum. */
function add(sum: Summed, fate: MacroFate) {
  sum.calls += fate.calls;
  if (fate.answer === "refused") sum.refusedIn++;
  for (const [index, counts] of Object.entries(fate.verdicts)) {
    const into = (sum.verdicts[index] ??= {});
    for (const [verdict, n] of Object.entries(counts)) bump(into, verdict, n ?? 0);
  }
  sum.fields.editable += fate.fields.editable;
  sum.fields.raw += fate.fields.raw;
  sum.fields.required += fate.fields.required;
  for (const [reason, n] of Object.entries(fate.fields.locked))
    bump(sum.fields.locked, reason, n ?? 0);
  for (const [reason, each] of Object.entries(fate.parts))
    if (each !== undefined) tally(sum.parts, reason, each.parts, each.words);
  for (const [check, n] of Object.entries(fate.findings)) bump(sum.findings, check, n ?? 0);
}

/** A tally of names: how many documents each is in. */
function names(counts: Map<string, number>, list: readonly string[]) {
  for (const name of new Set(list)) counts.set(name, (counts.get(name) ?? 0) + 1);
}

/** A map of counts as JSON keeps it, sorted by its keys. */
const sorted = <T>(map: Map<string, T>) =>
  Object.fromEntries([...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** What the export comes to: its files, the templates it wrote, and why any is left out. */
export interface ExportPlan {
  files: ExportFile[];
  templates: Template[];
  /** The top templates not written, and why: the leak check found a document's text in its summary. */
  withheld: { folder: string; kinds: string[] }[];
}

/**
 * The export (decision 0043): for each of the `top` templates of the documents the run kept, a
 * folder of the requests of the fewest documents that together hold every key the template's
 * passing requests hold, as the gate passed them; the answer `cache` serves now for each of its
 * keys, as the cache holds it; and `template.json`, what became of its documents and its macros,
 * each named as a written request names it; and an `index.json` of them all. Every file is checked
 * with `findLeaks` against every document of its template (`leaksIn`), the index against every
 * document of every template it lists: a request that holds any of their text is not written, nor
 * an answer that holds any but a single word the builder does not mask by, and a template whose
 * summary does is left out, named in the index. `fetched` is how many documents the corpus has.
 */
export async function exportPlan(input: {
  documents: readonly RunDocument[];
  top: number;
  cache: (key: string) => string | undefined;
  findLeaks: FindLeaks;
  fetched: number;
}): Promise<ExportPlan> {
  const byId = new Map(input.documents.map((doc) => [doc.id, doc]));
  const templates = templatesOf(
    input.documents.flatMap((doc) =>
      doc.request === undefined
        ? []
        : [{ id: doc.id, family: doc.family, keys: keysOfRequest(doc.request) }],
    ),
  ).slice(0, Math.max(0, input.top));
  const files: ExportFile[] = [];
  const written: Template[] = [];
  const withheld: ExportPlan["withheld"] = [];
  const everyText: DocumentText[] = [];
  for (const template of templates) {
    const docs = template.documents.flatMap((id) => byId.get(id) ?? []);
    const texts = docs.flatMap((doc) => (doc.text === undefined ? [] : [documentTextOf(doc.text)]));
    // A document with a request whose text the run did not keep cannot be checked against: its
    // template is left out whole.
    if (texts.length < docs.length) {
      withheld.push({ folder: template.folder, kinds: ["unchecked"] });
      continue;
    }
    // The fewest of the requests the gate passes that hold every key they hold, each checked again
    // against every document of the template, its own among them; one that holds another's text is
    // left out, as one the gate withholds is, and the rest are covered again without it.
    const passing = docs.flatMap((doc) =>
      doc.gate === "passes" && doc.request !== undefined
        ? [{ id: doc.id, request: doc.request, keys: new Set(keysOfRequest(doc.request)) }]
        : [],
    );
    const failed = new Set<string>();
    const checked = new Map<string, boolean>();
    const holds = (each: (typeof passing)[number]) => {
      const known = checked.get(each.id);
      if (known !== undefined) return known;
      const found =
        leaksIn({ text: "", kind: "request", request: each.request }, texts, input.findLeaks)
          .length > 0;
      checked.set(each.id, found);
      return found;
    };
    let requests: typeof passing = [];
    for (;;) {
      const pool = passing.filter((each) => !failed.has(each.id));
      const chosen = coverOf(pool, new Set(pool.flatMap((each) => [...each.keys])));
      requests = chosen.flatMap((id) => pool.find((each) => each.id === id) ?? []);
      const holding = requests.find(holds);
      if (holding === undefined) break;
      failed.add(holding.id);
    }
    const folderFiles: ExportFile[] = requests.map((each) => ({
      path: `${template.folder}/requests/${each.id}.json`,
      text: formatJson(each.request),
    }));
    // Each key's name, kind and filing, from the first written request that holds it.
    const macroOf = new Map<string, { request: NamingRequest; macro: RequestMacro }>();
    for (const each of requests)
      for (const macro of each.request.macros)
        if (macro.key !== undefined && !macroOf.has(macro.key))
          macroOf.set(macro.key, { request: each.request, macro });
    // The answers the cache serves now, as it holds them.
    const answers = new Map<string, "reviewed" | "model">();
    for (const key of template.keys) {
      const text = input.cache(key);
      if (text === undefined) continue;
      const stored = await answerFor({ get: () => text }, key);
      if (stored === undefined) continue;
      if (leaksIn({ text, kind: "answer" }, texts, input.findLeaks).length > 0) continue;
      answers.set(key, stored.reviewed ? "reviewed" : "model");
      folderFiles.push({ path: `${template.folder}/answers/${key}.json`, text });
    }
    // The macros' fates summed by key, and what else the documents came to.
    const sums = new Map<string, Summed>();
    const elsewhereParts: Partial<Record<string, Tally>> = {};
    const elsewhereFindings: Partial<Record<string, number>> = {};
    const outcomes = new Map<string, number>();
    const applied = new Map<string, number>();
    const dropped = new Map<string, number>();
    const checks = new Map<string, number>();
    for (const doc of docs) {
      outcomes.set(doc.outcome, (outcomes.get(doc.outcome) ?? 0) + 1);
      const notes = doc.notes;
      if (notes === undefined) continue;
      for (const macro of notes.macros) {
        const sum = sums.get(macro.key) ?? blankSum();
        add(sum, macro);
        sums.set(macro.key, sum);
      }
      for (const [reason, each] of Object.entries(notes.elsewhere.parts))
        if (each !== undefined) tally(elsewhereParts, reason, each.parts, each.words);
      for (const [check, n] of Object.entries(notes.elsewhere.findings))
        bump(elsewhereFindings, check, n ?? 0);
      names(applied, notes.redefinitions.applied);
      names(dropped, notes.redefinitions.dropped);
      names(checks, notes.checks);
    }
    const summary = {
      version: 1,
      template: template.folder,
      rank: template.rank,
      family: template.family,
      documents: docs.map((doc) => ({
        id: doc.id,
        family: doc.family,
        outcome: doc.outcome,
        ...(doc.rate === undefined ? {} : { rate: doc.rate }),
        gate: doc.gate ?? "none",
        ...(requests.some((each) => each.id === doc.id)
          ? { request: `requests/${doc.id}.json` }
          : {}),
      })),
      requests: {
        written: requests.length,
        withheld:
          docs.filter((doc) => doc.request !== undefined).length - passing.length + failed.size,
        ...(requests.length === 0 ? { note: NO_REQUEST_NOTE } : {}),
      },
      outcomes: sorted(outcomes),
      macros: template.keys.map((key) => {
        const found = macroOf.get(key);
        const fate = sums.get(key) ?? blankSum();
        const filing = found === undefined ? undefined : filingOf(found.request, found.macro);
        return {
          key,
          ...(found === undefined
            ? { name: null, note: UNWRITTEN_NOTE }
            : { of: found.macro.of, name: found.macro.name }),
          documents: docs.filter(
            (doc) => doc.request !== undefined && keysOfRequest(doc.request).includes(key),
          ).length,
          answer: answers.get(key) ?? "none",
          ...(answers.has(key) ? { file: `answers/${key}.json` } : {}),
          ...(filing === undefined ? {} : { filing }),
          ...fate,
        };
      }),
      elsewhere: { parts: elsewhereParts, findings: elsewhereFindings },
      redefinitions: { applied: sorted(applied), dropped: sorted(dropped) },
      checks: sorted(checks),
    };
    const summaryText = formatJson(summary);
    // The names the summary may hold: its written requests' macros' and definitions'.
    const requestNames = new Set(
      requests.flatMap((each) => [
        ...each.request.macros.map((macro) => macro.name),
        ...each.request.definitions.map((definition) => definition.name),
      ]),
    );
    const kinds = leaksIn(
      { text: summaryText, kind: "summary", names: requestNames },
      texts,
      input.findLeaks,
    );
    if (kinds.length > 0) {
      withheld.push({ folder: template.folder, kinds });
      continue;
    }
    files.push(...folderFiles, { path: `${template.folder}/template.json`, text: summaryText });
    written.push(template);
    everyText.push(...texts);
  }
  const index = formatJson({
    version: 1,
    rule: TEMPLATE_RULE,
    documents: {
      fetched: input.fetched,
      run: input.documents.length,
      withRequests: input.documents.filter((doc) => doc.request !== undefined).length,
    },
    templates: written.map((template) => ({
      folder: template.folder,
      rank: template.rank,
      family: template.family,
      documents: template.documents.length,
      keys: template.keys.length,
      requests: files.filter((file) => file.path.startsWith(`${template.folder}/requests/`)).length,
      answers: files.filter((file) => file.path.startsWith(`${template.folder}/answers/`)).length,
    })),
    withheld: withheld.map((each) => ({
      folder: each.folder,
      why: each.kinds[0] === "unchecked" ? WHY_UNCHECKED : WHY_LEAK,
    })),
  });
  const kinds = leaksIn({ text: index, kind: "summary" }, everyText, input.findLeaks);
  if (kinds.length > 0)
    throw new Error(
      `The export's index holds a document's text, so nothing is written: ${kinds.join("; ")}.`,
    );
  files.push({ path: "index.json", text: index });
  return { files, templates: written, withheld };
}

// The check.

/** A reviewed answer that carries redefinitions, as the check reads it. */
export interface Carrier {
  key: string;
  of: "command" | "environment";
  name: string;
  redefinitions: string[];
}

/**
 * The reviewed answers of a folder's files that carry redefinitions (`Carrier`), how many carry
 * none, and the keys of the files that are no answer the cache would serve under their names: one
 * that does not validate, is of another naming version, is filed under another key, or whose
 * dependencies do not give its key (`answerFor`), as the committed answers' test holds them.
 */
export async function carriersOf(files: readonly { key: string; text: string }[]): Promise<{
  carriers: Carrier[];
  others: number;
  invalid: string[];
}> {
  const carriers: Carrier[] = [];
  const invalid: string[] = [];
  let others = 0;
  for (const file of files) {
    const stored = await answerFor({ get: () => file.text }, file.key);
    if (stored === undefined) {
      invalid.push(file.key);
      continue;
    }
    if (!stored.reviewed) continue;
    const redefinitions =
      "reviewed" in stored.answer
        ? (stored.answer.redefinitions ?? []).map((each) => each.name)
        : [];
    if (redefinitions.length === 0) others++;
    else carriers.push({ key: stored.key, of: stored.of, name: stored.name, redefinitions });
  }
  return { carriers, others, invalid };
}

/** What a document's assembly, run for the check, came to. */
export interface Checked {
  id: string;
  outcome: RunOutcome;
  applied: readonly string[];
  dropped: readonly string[];
  /** The checks' own notes: `stopped`, `untested`, `unproven`. */
  checks: readonly string[];
  /** For one the pipeline refused, the step that refused it and why (`RefusalStep`). */
  refused?: { step: RefusalStep; reason: string };
}

/**
 * A redefinition's verdict: kept, proven on the corpus; unproven, since no corpus document applies
 * it, none holding its keys or none of those reaching the checks; or dropped.
 */
export type VerdictKind = "kept" | "unproven" | "dropped";

/** A redefinition's verdict over the corpus, in names and counts. */
export interface Verdict {
  name: string;
  /** The macros whose reviewed answers carry it, as the answers name them. */
  macros: string[];
  /** The templates whose documents hold one of their keys, as the export names them. */
  templates: string[];
  /**
   * The documents whose requests hold one of the keys; and of them, those whose checks applied it,
   * whose page it moved, where the checks could prove no redefinition (their note `unproven`), where
   * they stopped, which they refused, which timed out or died, and which the check never reached:
   * refused before the checks, or for a font the page cannot draw, or where the answer is not served.
   */
  documents: number;
  applied: number;
  moved: number;
  unprovable: number;
  stopped: number;
  refused: number;
  died: number;
  unreached: number;
  verdict: VerdictKind;
  why: string;
}

/**
 * Each redefinition's verdict (decision 0043), over the documents whose requests hold a key of an
 * answer that carries it: **dropped** when one drops it (it moves the page, or the checks could prove
 * no redefinition there, `unproven`), when the checks stop on one, when the validation refuses one
 * for anything but a font the page cannot draw (the assembly, or its reading back, which the
 * redefinition may cause), or when one times out or dies; else **kept** when one or more apply it,
 * the page kept and the checks run through; else **unproven**: no document holds its keys, or none of
 * those reaches the checks, the import refusing it before them. A document refused before the checks,
 * or for a font, or where the answer is not served for its macro, neither keeps nor drops it.
 */
export function redefinitionVerdicts(input: {
  carriers: readonly Carrier[];
  /** The documents whose requests hold each key. */
  holders: ReadonlyMap<string, readonly string[]>;
  results: ReadonlyMap<string, Checked>;
  /** The templates, by the export's folders, whose documents hold each key. */
  templates: ReadonlyMap<string, readonly string[]>;
}): Verdict[] {
  const byName = new Map<string, Carrier[]>();
  for (const carrier of input.carriers)
    for (const name of new Set(carrier.redefinitions))
      byName.set(name, [...(byName.get(name) ?? []), carrier]);
  return [...byName]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, carriers]) => {
      const ids = [
        ...new Set(carriers.flatMap((carrier) => input.holders.get(carrier.key) ?? [])),
      ].sort();
      const count = {
        applied: 0,
        moved: 0,
        unprovable: 0,
        stopped: 0,
        refused: 0,
        died: 0,
        unreached: 0,
      };
      for (const id of ids) {
        const result = input.results.get(id);
        if (result === undefined || result.outcome === "timeout" || result.outcome === "crashed")
          count.died++;
        else if (result.dropped.includes(name)) {
          if (result.checks.includes("unproven")) count.unprovable++;
          else count.moved++;
        } else if (result.applied.includes(name)) {
          if (result.checks.includes("stopped")) count.stopped++;
          else count.applied++;
        } else if (
          result.outcome === "refused" &&
          result.refused?.step === "checks" &&
          result.refused.reason !== "font"
        )
          count.refused++;
        else count.unreached++;
      }
      const failing = count.moved + count.unprovable + count.stopped + count.refused + count.died;
      const reasons = [
        ...(count.moved > 0 ? [`it moves the page of ${count.moved}`] : []),
        ...(count.unprovable > 0
          ? [`the checks could prove no redefinition on ${count.unprovable}`]
          : []),
        ...(count.stopped > 0 ? [`the checks stopped on ${count.stopped}`] : []),
        ...(count.refused > 0 ? [`the checks refused ${count.refused}`] : []),
        ...(count.died > 0 ? [`${count.died} timed out or died`] : []),
      ];
      const verdict: VerdictKind =
        failing > 0 ? "dropped" : count.applied === 0 ? "unproven" : "kept";
      const why =
        verdict === "dropped"
          ? `Dropped: ${reasons.join("; ")}.`
          : verdict === "unproven"
            ? ids.length === 0
              ? "Unproven: no corpus document's request holds its keys."
              : `Unproven: ${ids.length === 1 ? "the one document that holds its keys does not reach" : `none of the ${ids.length} documents that hold its keys reaches`} the checks.`
            : `Kept: applied, the page kept and the checks run through, on ${count.applied === 1 ? "the one document" : `all ${count.applied} documents`} that reached the checks${count.unreached > 0 ? `, of ${ids.length} that hold its keys` : ""}.`;
      const templates = [
        ...new Set(carriers.flatMap((carrier) => input.templates.get(carrier.key) ?? [])),
      ].sort();
      return {
        name,
        macros: [...new Set(carriers.map((carrier) => carrier.name))].sort(),
        templates,
        documents: ids.length,
        ...count,
        verdict,
        why,
      };
    });
}

/** A redefinition's verdict as the check prints it: names that are plainly names, and counts. */
export function verdictLine(verdict: Verdict): string {
  const shown = (name: string) => shownMacro(name) ?? "a macro whose name is not plain";
  const templates =
    verdict.templates.length === 0 ? "no template the export names" : verdict.templates.join(", ");
  return printable(
    `${verdict.verdict.toUpperCase()} ${shown(verdict.name)}, carried by the answers of ${verdict.macros.map(shown).join(", ")} (${templates}): ${verdict.documents} ${verdict.documents === 1 ? "document holds" : "documents hold"} their keys; ${verdict.applied} applied it, ${verdict.moved} had their page moved, ${verdict.unprovable} proved none, ${verdict.stopped} stopped, ${verdict.refused} were refused by the checks, ${verdict.died} timed out or died, ${verdict.unreached} were not reached. ${verdict.why}`,
  );
}
