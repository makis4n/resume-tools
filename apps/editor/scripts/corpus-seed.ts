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
 * request (`src/import/naming.ts`), built with the header's values items 7 and 11 pass, which it
 * finds in the sample's own calls by the answers (`headerOf`). It prints each sample's macros and
 * environments with their hashes, their keys and the probe's verdicts, and checks that each has an
 * answer file that validates, whose hash is the macro's own and whose key is its file's name, and
 * that `answerFor` gives it for the macro, its list's partners found by their keys. A key is
 * printed with item 4's beside it where the two differ, which is where a sample's own values masked
 * a definition, and a fork's request would not find the file: that is a problem too.
 *
 * An answer is filed under item 4's key (`keysOf`), with the dependencies it is computed from and
 * its list's partners by their keys (`Filed`); `corpus seed --write` writes each file so, moving a
 * file whose key changed, as a new naming version or an upgrade of the tree moves keys, and
 * without `--write` says what it would change (`seedPlan`).
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
import {
  answerFor,
  type Dependency,
  keyOf,
  NAMING_VERSION,
  type NamingRequest,
  type PartnerKeys,
  StoredAnswer,
} from "@resume-tools/naming";
import type { Candidate } from "../src/import/candidates.ts";
import type { HeaderValues } from "../src/import/naming.ts";
import type { Verdict } from "../src/import/probe.ts";
import type { EngineSignatures } from "../src/import/signatures.ts";
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

/**
 * What an answer is filed under: item 4's key for the macro or environment (`keysOf`), which no
 * value of a document's masks, and the hash and the dependencies it is computed from
 * (`keyInputs`), which the answer carries so that it can be filed again under a new version's key.
 */
export interface Filed {
  key: string;
  hash: string;
  dependencies: Dependency[];
}

/** One of a sample's macros or environments, as the seed checks it: names and numbers only. */
export interface SeedMacro {
  of: "command" | "environment";
  name: string;
  /** Its own definition's hash, and its key, as its request gives them; none for data. */
  hash?: string;
  key?: string;
  /** What its answer is filed under; none for a macro that holds data. */
  filed?: Filed;
  signature?: string;
  arguments: { index: number; kind: string; verdict?: Verdict; empty?: Verdict }[];
  calls: number;
  /** Whether the seed answers it though the sample does not call it (`SEED_EXTRAS`). */
  extra: boolean;
}

/** The signatures module's functions an answer's filing is read with. */
type Signatures = typeof import("../src/import/signatures.ts");

/**
 * What each of a sample's macros and environments is filed under (`Filed`): a command's key from
 * `keysOf`, an environment's from `environmentKeysOf`, with what each is computed from.
 */
export async function filingOf(
  found: Pick<EngineSignatures, "macros" | "environments">,
  signatures: Pick<Signatures, "keysOf" | "environmentKeysOf" | "keyInputs">,
): Promise<(of: SeedMacro["of"], name: string) => Filed | undefined> {
  const commands = await signatures.keysOf({ macros: found.macros });
  const environments = await signatures.environmentKeysOf(found);
  return (of, name) => {
    const keys = of === "command" ? commands : environments;
    const key = Object.hasOwn(keys, name) ? keys[name] : undefined;
    const inputs = signatures.keyInputs(found, of, name);
    return key === undefined || inputs === undefined ? undefined : { key, ...inputs };
  };
}

/**
 * A sample's redefinitions, those its macros' answers carry, and what they do to its page: its
 * calls to the macros they serve regenerated as item 7 writes them (`regenerate`), the rest of its
 * body as it is, compiled with them against the same body
 * compiled without them, `keeps` when the two set the same glyphs, else how they first differ, or
 * `stopped`; and the sample as it is, compiled with them against its reference, which a
 * redefinition written for the generator's escaped text may not take, as AltaCV's `\printinfo`
 * does not take a raw `_`. Redefinitions go after `\documentclass`, and, where a compile stops
 * there, before `\begin{document}`, as a macro a package or the preamble defines needs
 * (`placed`).
 */
export interface SeedRedefinitions {
  names: string[];
  regenerated: string;
  raw: string;
  /** Where they went when a compile after the class stopped, and one before the body did not. */
  placed?: "preamble";
  /** What each does alone, when together they do not keep both pages. */
  each?: { name: string; regenerated: string; raw: string; placed?: "preamble" }[];
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
 * A request's macros as the seed checks them: each one's name, hash, key and verdicts, what its
 * answer is filed under (`filed`), and whether the seed asked of it though the sample does not
 * call it.
 */
export function seedMacros(
  request: NamingRequest,
  filed: (of: SeedMacro["of"], name: string) => Filed | undefined,
  extras: { commands: readonly string[]; environments: readonly string[] } | undefined,
): SeedMacro[] {
  const definitions = new Map(request.definitions.map((each) => [each.name, each]));
  return request.macros.map((macro) => {
    const own = definitions.get(macro.name);
    const extra =
      macro.calls === 0 &&
      (macro.of === "command" ? extras?.commands : extras?.environments)?.includes(macro.name) ===
        true;
    const filing = macro.key === undefined ? undefined : filed(macro.of, macro.name);
    return {
      of: macro.of,
      name: macro.name,
      ...(own?.kind === "definition" ? { hash: own.hash } : {}),
      ...(macro.key === undefined ? {} : { key: macro.key }),
      ...(filing === undefined ? {} : { filed: filing }),
      ...(macro.signature === undefined ? {} : { signature: macro.signature }),
      arguments: macro.arguments.map((argument) => ({ ...argument })),
      calls: macro.calls,
      extra,
    };
  });
}

/**
 * An answer file's text as Biome formats it, so that `pnpm format` leaves a written file as it is:
 * two spaces of indentation, every object expanded, and an array that holds no object on one line
 * when that line, indentation and comma included, fits in 100 columns, else one item a line, as
 * `formatJson` writes the manifest, and as a list of dependencies of one pair, an array of arrays,
 * is set.
 */
export function formatAnswer(value: unknown): string {
  const flat = (item: unknown): string | undefined => {
    if (!Array.isArray(item))
      return item !== null && typeof item === "object" ? undefined : JSON.stringify(item);
    const items = item.map(flat);
    return items.every((each) => each !== undefined) ? `[${items.join(", ")}]` : undefined;
  };
  const lines = (item: unknown, indent: string, head: string, tail: string): string[] => {
    if (Array.isArray(item)) {
      const one = flat(item);
      const line = `${indent}${head}${one}${tail}`;
      if (one !== undefined && (item.length === 0 || [...line].length <= 100)) return [line];
      return [
        `${indent}${head}[`,
        ...item.flatMap((each, i) =>
          lines(each, `${indent}  `, "", i < item.length - 1 ? "," : ""),
        ),
        `${indent}]${tail}`,
      ];
    }
    if (item !== null && typeof item === "object") {
      const entries = Object.entries(item).filter(([, each]) => each !== undefined);
      if (entries.length === 0) return [`${indent}${head}{}${tail}`];
      return [
        `${indent}${head}{`,
        ...entries.flatMap(([key, each], i) =>
          lines(each, `${indent}  `, `${JSON.stringify(key)}: `, i < entries.length - 1 ? "," : ""),
        ),
        `${indent}}${tail}`,
      ];
    }
    return [`${indent}${head}${JSON.stringify(item)}${tail}`];
  };
  return `${lines(value, "", "", "").join("\n")}\n`;
}

/** A stored answer from its file's text, or undefined for one that does not validate. */
function storedOf(text: string | undefined): StoredAnswer | undefined {
  if (text === undefined) return undefined;
  try {
    const parsed = StoredAnswer.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The answers the folder holds for a request's commands, by name, under the keys the request
 * gives them: what item 7 reads a document's header values by, before it asks again with them.
 * `realName` gives the document's name of a name the request masks (`realName` of `naming.ts`),
 * since the answers are asked for by the document's names.
 */
export function commandAnswers(
  request: Pick<NamingRequest, "macros">,
  read: (key: string) => string | undefined,
  realName: (name: string) => string = (name) => name,
): (name: string) => StoredAnswer | undefined {
  const keys = new Map(
    request.macros.flatMap((macro) =>
      macro.of === "command" && macro.key !== undefined
        ? [[realName(macro.name), macro.key] as const]
        : [],
    ),
  );
  return (name) => {
    const key = keys.get(name);
    return key === undefined ? undefined : storedOf(read(key));
  };
}

/** The header's fields a header's slot, or a contact's, sets. */
const HEADER_FIELDS = ["first", "last", "headline", "email", "phone", "location"] as const;
type HeaderField = (typeof HEADER_FIELDS)[number];
const isHeaderField = (slot: string | undefined): slot is HeaderField =>
  (HEADER_FIELDS as readonly (string | undefined)[]).includes(slot);

/**
 * The header's values a sample gives, as item 7 finds them in a document and items 7 and 11 pass
 * to the request builder (`HeaderValues`): each argument of a call, in the preamble or the body, to
 * a command whose answer is the header's, a contact or a link, by the slot its answer says it
 * fills, a name given whole split before its last word where the answer maps it to the first and
 * the last name, as AltaCV's is; a field's first value is taken, and every link's.
 */
export function headerOf(
  candidates: readonly Pick<Candidate, "of" | "name" | "index" | "text">[],
  answerOf: (name: string) => StoredAnswer | undefined,
): HeaderValues {
  const header: Partial<Record<HeaderField, string>> = {};
  const links: { label?: string; href?: string }[] = [];
  const set = (field: HeaderField, text: string) => {
    if (header[field] === undefined && text !== "") header[field] = text;
  };
  for (const candidate of candidates) {
    const text = candidate.text.trim();
    if (candidate.of !== "call" || candidate.index === undefined || text === "") continue;
    const answer = answerOf(candidate.name)?.answer;
    const argument = answer?.arguments.find((each) => each.index === candidate.index);
    if (answer === undefined || argument === undefined) continue;
    const slots = argument.parts?.map((part) => part.slot) ?? [argument.slot];
    if (
      answer.kind === "header" &&
      slots.length === 2 &&
      slots[0] === "first" &&
      slots[1] === "last"
    ) {
      const at = text.lastIndexOf(" ");
      set("first", at < 0 ? text : text.slice(0, at).trim());
      if (at >= 0) set("last", text.slice(at + 1));
    } else if (answer.kind === "header") {
      for (const slot of slots) if (isHeaderField(slot)) set(slot, text);
    } else if (
      answer.kind === "contact" &&
      argument.slot === "text" &&
      answer.contact !== undefined
    )
      set(answer.contact, text);
    else if (answer.kind === "link" && argument.slot === "label") links.push({ label: text });
    else if (answer.kind === "link" && argument.slot === "href") links.push({ href: text });
  }
  return { ...header, ...(links.length === 0 ? {} : { links }) };
}

/**
 * What the answers folder holds for a macro: a stored answer that validates, of this naming
 * version, filed under its key, for its name and kind, whose hash is the macro's own, and that
 * `answerFor` gives the macro, its dependencies giving its key and its list's partners found by
 * their keys (`ok`); or what is wrong: its request's key is not what its answer is filed under,
 * since a value of the document's masked a definition (`moved`), no file, a file that does not
 * validate, a key, a hash or a name that is another's, or a partner the sample has no macro of
 * by its key (`partner`). A macro that holds data has no key, and needs no answer (`data`).
 */
export type AnswerState =
  | "ok"
  | "data"
  | "moved"
  | "missing"
  | "invalid"
  | "hash"
  | "key"
  | "name"
  | "partner";

/**
 * The state of a macro's answer, and a line of what is wrong, naming no text. `partners` is the
 * sample's commands' keys, by name, among which its list's partners are found.
 */
export async function answerState(
  macro: SeedMacro,
  read: (key: string) => string | undefined,
  partners: ReadonlyMap<string, string> = new Map(),
): Promise<{ state: AnswerState; why?: string }> {
  if (macro.key === undefined || macro.hash === undefined) return { state: "data" };
  if (macro.filed?.key !== macro.key)
    return {
      state: "moved",
      why:
        macro.filed === undefined
          ? "item 4 gives it no key"
          : `filed under item 4's ${macro.filed.key.slice(0, 12)}`,
    };
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
  // The seed's files hold their partners' keys, which `--write` writes: a partner is found by key
  // alone, never by the name a fork keeps (decision 0028).
  const served = await answerFor({ get: () => json }, macro.key, {
    name: macro.name,
    of: macro.of,
    partners,
    byName: false,
  });
  if (served === undefined) return { state: "key", why: "its dependencies do not give its key" };
  if (served.answer === undefined)
    return served.reason === "kind" ? { state: "name" } : { state: "partner" };
  return { state: "ok" };
}

/** A sample's commands' keys, by name, among which an answer's partners are found. */
export const partnersOf = (macros: readonly SeedMacro[]) =>
  new Map(
    macros.flatMap((macro) =>
      macro.of === "command" && macro.key !== undefined ? [[macro.name, macro.key] as const] : [],
    ),
  );

/** Each macro's answer state, by `id|of|name`, as the table reports them. */
export async function seedStates(
  rows: readonly SeedRow[],
  read: (key: string) => string | undefined,
): Promise<Map<string, { state: AnswerState; why?: string }>> {
  const states = new Map<string, { state: AnswerState; why?: string }>();
  for (const row of rows) {
    const partners = partnersOf(row.macros ?? []);
    for (const macro of row.macros ?? [])
      states.set(`${row.id}|${macro.of}|${macro.name}`, await answerState(macro, read, partners));
  }
  return states;
}

/**
 * A file `corpus seed --write` writes: a macro's answer filed under what it is filed under now
 * (`Filed`), with its list's partners by their keys; the key of the file it was in, which it
 * leaves when that is another; and what changes, the naming version among them after a bump.
 */
export interface SeedWrite {
  family: Family;
  of: SeedMacro["of"];
  name: string;
  from: string;
  to: string;
  changes: ("version" | "key" | "hash" | "dependencies" | "partnerKeys")[];
  /** The file's text, as Biome formats it. */
  text: string;
}

/** A file's JSON, when it is an object's, as a file of an older naming version still is. */
function jsonOf(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const json: unknown = JSON.parse(text);
    return json !== null && typeof json === "object" && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What `corpus seed --write` writes to the answers folder: for each sample's macro that has a key,
 * its answer's file, found under the key it is filed under now, or under its request's key, or by
 * its family, kind and name, rewritten with this naming version, that key, its hash, its
 * dependencies and its list's partners' keys, where any differs from the file, so that an answer
 * of an older version is filed again when it validates as this version's; and what it cannot
 * write, a macro with no file, an answer that does not validate so, or one whose partner the
 * sample has no key for, naming macros only.
 */
export async function seedPlan(
  rows: readonly SeedRow[],
  folder: { read: (key: string) => string | undefined; keys: readonly string[] },
): Promise<{ writes: SeedWrite[]; problems: string[] }> {
  const byName = new Map<string, string>();
  for (const key of folder.keys) {
    const json = jsonOf(folder.read(key));
    if (json !== undefined) byName.set(`${json.family}|${json.of}|${json.name}`, key);
  }
  const writes: SeedWrite[] = [];
  const problems: string[] = [];
  for (const row of rows) {
    const macros = row.macros ?? [];
    for (const macro of macros) {
      const filed = macro.filed;
      if (filed === undefined) continue;
      const shown = `${row.family} ${shownName(macro)}`;
      const from = [
        filed.key,
        macro.key,
        byName.get(`${row.family}|${macro.of}|${macro.name}`),
      ].find((key) => key !== undefined && folder.read(key) !== undefined);
      const text = from === undefined ? undefined : folder.read(from);
      const json = jsonOf(text);
      if (from === undefined || text === undefined || json === undefined) {
        problems.push(`${shown}: no answer to file under ${filed.key.slice(0, 12)}`);
        continue;
      }
      const { dependencies, partnerKeys: partners, ...kept } = json;
      const list = (json.answer as { list?: Record<string, unknown> } | undefined)?.list;
      const partnerKeys: PartnerKeys = {};
      for (const which of ["closedBy", "openedBy"] as const) {
        const named = list?.[which];
        if (typeof named !== "string") continue;
        const partner = macros.find((each) => each.of === "command" && each.name === named);
        if (partner?.filed === undefined)
          problems.push(`${shown}: its list names a macro the sample gives no key`);
        else partnerKeys[which] = partner.filed.key;
      }
      const next = {
        ...kept,
        version: NAMING_VERSION,
        key: filed.key,
        hash: filed.hash,
        dependencies: filed.dependencies,
        ...(Object.keys(partnerKeys).length === 0 ? {} : { partnerKeys }),
      };
      const checked = StoredAnswer.safeParse(next);
      if (
        !checked.success ||
        (await keyOf(NAMING_VERSION, filed.hash, filed.dependencies)) !== filed.key
      ) {
        const issue = checked.error?.issues[0];
        problems.push(
          `${shown}: its answer does not validate filed under ${filed.key.slice(0, 12)}${issue === undefined ? "" : ` (${issue.path.join(".")}: ${issue.message})`}`,
        );
        continue;
      }
      const written = formatAnswer(next);
      if (written === text && from === filed.key) continue;
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      writes.push({
        family: row.family,
        of: macro.of,
        name: macro.name,
        from,
        to: filed.key,
        changes: [
          ...(json.version === NAMING_VERSION ? [] : ["version" as const]),
          ...(from === filed.key ? [] : ["key" as const]),
          ...(json.hash === filed.hash ? [] : ["hash" as const]),
          ...(same(dependencies, filed.dependencies) ? [] : ["dependencies" as const]),
          ...(same(partners ?? {}, partnerKeys) ? [] : ["partnerKeys" as const]),
        ],
        text: written,
      });
    }
  }
  return { writes, problems };
}

/** A macro as the tables name it, in backticks: plainly, or as a name that is not plain. */
function shownName(macro: Pick<SeedMacro, "of" | "name">): string {
  const shown = shownMacro(macro.name);
  if (shown === undefined) return "`a name that is not plain`";
  return macro.of === "environment" ? `\`${shown.slice(1)} (environment)\`` : `\`${shown}\``;
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

/** What `corpus seed` did or would do to the answers folder, as the table reports it. */
export interface SeedPlanShown {
  writes: readonly SeedWrite[];
  problems: readonly string[];
  /** Whether the writes were made (`--write`), or are what it would make. */
  written: boolean;
}

/**
 * The seed's table: for each sample's macro and environment, its hash and key, item 4's key where
 * it differs, the probe's verdicts, and the state of its answer (`seedStates`); then what the
 * redefinitions do, the answer files no macro claims, what `--write` wrote or would write, and
 * the count of problems: every answer that is not `ok` or `data`, a redefinition that stops a
 * compile, and every file `--write` would write or could not. Names of macros only when they are
 * plainly one.
 */
export function seedTable(
  rows: readonly SeedRow[],
  states: ReadonlyMap<string, { state: AnswerState; why?: string }>,
  files: readonly string[],
  plan: SeedPlanShown = { writes: [], problems: [], written: false },
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
      const { state, why } = states.get(`${row.id}|${macro.of}|${macro.name}`) ?? {
        state: "missing",
      };
      for (const key of [macro.key, macro.filed?.key]) if (key !== undefined) claimed.add(key);
      if (state !== "ok" && state !== "data") problems++;
      const moved = macro.key !== undefined && macro.filed?.key !== macro.key;
      const key = `${short(macro.key)}${moved && macro.filed !== undefined ? `, item 4's ${short(macro.filed.key)}` : ""}`;
      const answer =
        state === "ok" || state === "data"
          ? state
          : `**${state}**${why === undefined ? "" : ` (${why})`}`;
      lines.push(
        `| ${row.family} | ${shownName(macro)}${macro.extra ? " (not called)" : ""} | ${short(macro.hash)} | ${key} | ${verdicts(macro)} | ${answer} |`,
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
    const placed = (where: "preamble" | undefined) =>
      where === undefined ? "" : " (placed before \\begin{document})";
    lines.push(
      `${row.family}: ${found.names.length} ${found.names.length === 1 ? "redefinition" : "redefinitions"} (${found.names.map(named).join(", ")})${placed(found.placed)}; its calls they serve regenerated, with them against without them: ${shownEffect(found.regenerated)}; the sample as it is, against its reference: ${shownEffect(found.raw)}.`,
      ...(found.each ?? []).map(
        (one) =>
          `  ${named(one.name)} alone${placed(one.placed)}: regenerated ${shownEffect(one.regenerated)}; as it is ${shownEffect(one.raw)}.`,
      ),
    );
  }
  lines.push("");
  if (unclaimed.length > 0)
    lines.push(
      `Answer files no sample's macro claims: ${unclaimed.map((key) => short(key)).join(", ")}.`,
    );
  if (plan.writes.length > 0) {
    if (!plan.written) problems += plan.writes.length;
    lines.push(
      `${plan.written ? "Wrote" : "`corpus seed --write` would write"} ${plan.writes.length} answer ${plan.writes.length === 1 ? "file" : "files"}:`,
      ...plan.writes.map(
        (write) =>
          `  ${write.family} ${shownName(write)}: ${write.changes.includes("key") ? `moved from ${short(write.from)} to ${short(write.to)}, ` : ""}${write.changes.filter((change) => change !== "key").join(", ") || "formatted"}.`,
      ),
    );
  }
  problems += plan.problems.length;
  lines.push(...plan.problems.map((problem) => `Cannot write: ${problem}.`));
  lines.push(`Problems: ${problems}.`);
  return { table: `${lines.map(printable).join("\n")}\n`, problems };
}
