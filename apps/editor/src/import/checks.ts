/**
 * The checks without answers (the second pass's item 6, decisions 0049 and 0050): an imported
 * resume's outline compiled as the editor will compile it, from its package's format, dumped once
 * (`OutlineCompiler`), and checked, as the first pass's four checks checked an assembly (decision
 * 0026), with nothing named and nothing asked of a service. Each bisection is the probe's
 * (`settle`, decision 0022), within `CHECK_BUDGET` compiles, and check 3's within `UNITS_BUDGET`.
 *
 * 1. **The page.** The outline, every field the probe proved in the editor's marker, must set the
 *    reference's page, its glyphs and rules, the specials aside. Where it does not, the outline
 *    with every field kept as the upload wrote it is compiled: where that stops too, the import is
 *    refused; where it sets another page, the package's preamble moves it and no field does, the
 *    import is partial, and that page is what the fields must keep. Each field whose rewriting
 *    moves the page (`differs`), or stops the compile (`compile`), is then found and becomes kept
 *    text, its candidate's every field with it, and one the budget leaves untried too
 *    (`untested`).
 * 2. **Mutations.** Every field is set to a long text, to special characters and to nothing, each
 *    in one compile of all of them, bisected where it stops: a field that stops it on text becomes
 *    kept text (`text`), one that stops it only when empty is required (`OutlineText.required`),
 *    and one the bisection leaves untried becomes kept text (`untested`), since nothing proved it
 *    takes any text (the plan's "fields are proven once, at import, and then trusted"). Letters
 *    of other scripts, Greek and Cyrillic, are tried once each in every field together: where one
 *    stops the compile, the document's fonts lack that script whatever field holds it, which the
 *    report says by its name, and no field is kept for it (decision 0055).
 * 3. **Groups.** Every group gains a copy of its last unit, its fields emptied, a required one
 *    holding `OUTLINE_PLACEHOLDER`, and loses its first unit and its last, each kind of trial in
 *    batches whose changes do not overlap, compiled together, and halved where a batch breaks the
 *    page (`bisect`). Decision 0050's three rules: a group of one unit is not tried without it,
 *    since the editor never removes a group's only unit; a trial keeps the page when the compile
 *    goes through and every other glyph of the reference is still there in the same font, size and
 *    code, in its order or reflowed to another column or page (`judged`), and a removal takes out
 *    every glyph the probe's runs give to a part inside the unit, the template's own free to go
 *    either way (`rolesOf`); so a unit that sets the rest of the page in other glyphs, as a size or
 *    a font declared in it and running on past its end would, fails, and its group is fixed. A
 *    group any trial of which fails, or the budget leaves, is fixed (`OutlineGroup.fixed`), and the
 *    editor neither adds to it nor removes from it. Where the page is not the reference's, the
 *    trials are judged all the same where it sets the reference's glyphs, moved; where it sets
 *    others, they have nothing to be judged against, and every group is fixed as untried.
 * 4. **Controls.** Unchanged: each control the package offers is tried at every value. An
 *    outline's package offers none (`outlinePackage`), so there is none to try.
 *
 * What it returns is the outline as the checks leave it, its fields kept or required and its groups
 * fixed, with why; and ids and counts. Nothing here reaches the network, and nothing it says quotes
 * the resume: a compile's log is for developers alone.
 */

import {
  type OutlineFixed,
  type OutlinePart,
  outlineNodes,
  type Resume,
  type RichText,
} from "@resume-tools/resume-model";
import { emptiedCopy } from "../editor/outline";
import type { EngineSession } from "../engine/session";
import type { FontLibrary } from "../page/fonts";
import { generateBody, generateFormat } from "../templates/generate";
import { fontFiles, type TemplatePackage } from "../templates/package";
import { MARKER_BEGIN, markerId } from "../tex/fields";
import type { Candidate } from "./candidates";
import { type Outline, outlineResume, type Unit } from "./outline";
import type { Span } from "./parse";
import {
  failed,
  type ProbeCandidate,
  probeOrder,
  type SetResult,
  settle,
  suspectsIn,
  type UncoveredRun,
} from "./probe";
import {
  type Difference,
  difference,
  type GlyphStream,
  type ReferenceGlyph,
  type ReferenceItem,
  readOutput,
  shippedFont,
} from "./reference";
import { type Refusal, refusal } from "./refusal";
import type { LockReason } from "./report";
import { dumpFiles } from "./xetex-check";

/** How many compiles one bisection of a check may make, as the probe's budget bounds its own. */
export const CHECK_BUDGET = 48;

/** How many compiles check 3's trials may make, as the probe's budget bounds its own. */
export const UNITS_BUDGET = 64;

/**
 * The texts check 2 sets every field to: long, empty, and characters TeX reads, Latin letters with
 * accents among them; and letters of other scripts, Greek and Cyrillic, which a document's fonts
 * may lack whatever field holds them, and which are each tried once for the whole document.
 */
export const MUTATIONS = {
  long: "Invented words for a long field ".repeat(10).slice(0, 300),
  empty: "",
  special: "\\ { } $ & # ^ _ % ~ < > | [ ] * -- ' \" é ß ø ğ",
  scripts: { greek: "ω α", cyrillic: "Ж д" },
} as const;

// Compiling.

/** A compile of an outline: whether it stopped, what it set where it did not, and its log. */
export interface Compiled {
  broke: boolean;
  stream?: GlyphStream;
  /** The compile's log, for developers alone: it quotes the source. */
  log: string;
}

/** What an outline is compiled with: the session, the fonts, its package, a job and its files. */
export interface CompilerInput {
  session: EngineSession;
  fonts: FontLibrary;
  pkg: TemplatePackage;
  /** The job the compiles run in, forgotten before the first and when the compiler closes. */
  job: string;
  /** The job's files, the reference compile's, beside the package's own. */
  files: Record<string, Uint8Array>;
  /** Stops the checks between compiles, throwing its reason. */
  signal?: AbortSignal;
}

/**
 * An outline's compiles, as the editor will compile it, counted: its package's format dumped once,
 * with the job's files beside the package's, a XeTeX format with their text files alone
 * (`dumpFiles`), and each body the generator makes compiled from it in the job, three passes at
 * most, its output read as the reference's was. The format's bytes are what the editor takes
 * rather than dumping it again (decision 0045).
 */
export class OutlineCompiler {
  count = 0;
  ms = 0;
  private dumped?: { name: string; bytes: Uint8Array };
  private covers?: Awaited<ReturnType<typeof coversOf>>;

  constructor(private readonly input: CompilerInput) {}

  /** Dumps the package's format; the log, for developers, where the dump stops. */
  start(): { ok: true } | { ok: false; log: string } {
    const { session, pkg, job, files } = this.input;
    const format = generateFormat(pkg, {});
    const withPackage: Record<string, Uint8Array> = { ...files };
    for (const [name, text] of Object.entries(pkg.files))
      withPackage[name] = new TextEncoder().encode(text);
    session.forget(job);
    // A XeTeX dump takes the job's text files alone, as the rewrite's check dumps its format.
    const given = pkg.engine === "xetex" ? dumpFiles(withPackage) : withPackage;
    this.input.signal?.throwIfAborted();
    const result = session.dump(pkg.engine, format.name, format.preamble, given);
    this.ms += result.ms;
    if (!result.ok || result.format === undefined) return { ok: false, log: result.log };
    this.dumped = { name: format.name, bytes: result.format };
    return { ok: true };
  }

  /** The format the compiles start from, by name, and its bytes. */
  get format(): { name: string; bytes: Uint8Array } {
    if (this.dumped === undefined) throw new Error("the outline's format was not dumped");
    return this.dumped;
  }

  /** A resume compiled from the format, and its output read. */
  async compile(resume: Resume): Promise<Compiled> {
    const { session, fonts, pkg, job, files, signal } = this.input;
    const format = this.format;
    signal?.throwIfAborted();
    this.covers ??= await coversOf(fonts, pkg);
    let latex: string;
    try {
      latex = generateBody(pkg, resume, {}, this.covers).latex;
    } catch (error) {
      return { broke: true, log: error instanceof Error ? error.message : String(error) };
    }
    this.count++;
    let result: ReturnType<EngineSession["compile"]>;
    try {
      result = session.compile(pkg.engine, format.name, latex, { job, maxPasses: 3, files });
    } catch (error) {
      if (signal?.aborted === true) throw error;
      return { broke: true, log: error instanceof Error ? error.message : String(error) };
    }
    this.ms += result.passes.reduce((sum, pass) => sum + pass, 0);
    if (failed(result, 3) || result.output === undefined) return { broke: true, log: result.log };
    try {
      const { stream } = await readOutput(fonts, result.output, (path) =>
        shippedFont(files, job, path),
      );
      return { broke: false, stream, log: result.log };
    } catch (error) {
      return { broke: true, log: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Drops the format from the session and forgets the job; the format's bytes stay readable. */
  close() {
    const { session, pkg, job } = this.input;
    session.forget(job);
    if (this.dumped !== undefined) session.dropFormat(pkg.engine, this.dumped.name);
  }
}

/** What a XeTeX package's fonts can set, as the editor leaves out the rest. */
async function coversOf(fonts: FontLibrary, pkg: TemplatePackage) {
  const files = fontFiles(pkg);
  if (files.length === 0) return {};
  return { covers: (await fonts.coverage(files)).covers };
}

// Comparing.

/**
 * A glyph stream's glyphs and rules alone: its specials, which hyperref's driver writes otherwise
 * and the editor's markers add, left aside.
 */
export const glyphsOnly = (stream: GlyphStream): GlyphStream => ({
  ...stream,
  pages: stream.pages.map((page) => ({
    items: page.items.filter((item) => item.kind !== "special"),
  })),
});

/** Where a compile's page differs from `target`'s, its glyphs and rules; none where it does not. */
const differs = (target: GlyphStream, stream: GlyphStream) =>
  difference(glyphsOnly(target), glyphsOnly(stream));

/** The field whose begin marker comes last before where a stream parts from another. */
function suspectOf(stream: GlyphStream, found: Difference | undefined): string | undefined {
  if (found?.page === undefined) return undefined;
  const items: readonly ReferenceItem[] = stream.pages[found.page]?.items ?? [];
  const at = found.item === undefined ? -1 : items.indexOf(found.item);
  for (let k = at < 0 ? items.length - 1 : at; k >= 0; k--) {
    const item = items[k];
    const id = item?.kind === "special" ? markerId(item.text, MARKER_BEGIN) : undefined;
    if (id !== undefined) return id.replace(/\.text$/, "");
  }
  return undefined;
}

// Check 3's trials, judged (promoted from the outline spike, decision 0050).

/** What check 3 tries of a group: a copy of its last unit, or the removal of its first or last. */
export type TrialKind = "copy" | "first" | "last";

/**
 * Each of `items` judged by `test`, which compiles a set of them together and gives its verdict: a
 * set whose verdict `passes` gives each of its items that verdict, and one that fails is halved
 * until each that fails alone is found, with its own. `test` gives undefined once its budget is
 * spent, and the items it would have judged are left undecided.
 */
export async function bisect<T, V>(
  items: readonly T[],
  test: (set: readonly T[]) => Promise<V | undefined>,
  passes: (verdict: V) => boolean,
): Promise<Map<T, V | undefined>> {
  const results = new Map<T, V | undefined>();
  const run = async (set: readonly T[]): Promise<void> => {
    if (set.length === 0) return;
    const verdict = await test(set);
    if (verdict === undefined || passes(verdict) || set.length === 1) {
      for (const each of set) results.set(each, verdict);
      return;
    }
    const middle = Math.ceil(set.length / 2);
    await run(set.slice(0, middle));
    await run(set.slice(middle));
  };
  await run(items);
  return results;
}

/** A glyph as a trial compares two outputs: its font, face, size and code, wherever it stands. */
const glyphKey = (glyph: ReferenceGlyph) =>
  `${glyph.font}|${glyph.native === true ? 1 : 0}|${glyph.index ?? 0}|${glyph.size}|${glyph.code}`;

/** An output's glyphs, page after page, as `glyphKey` names them. */
export function glyphKeys(stream: Pick<GlyphStream, "pages">): string[] {
  return stream.pages.flatMap((page) =>
    page.items.flatMap((item) => (item.kind === "glyph" ? [glyphKey(item)] : [])),
  );
}

/**
 * Whether an output sets every glyph of the reference, in its order, with others among them: a
 * copy's, wherever it put them. The rest of the page is the reference's, moved or not.
 */
export function insertedOnly(reference: readonly string[], output: readonly string[]): boolean {
  let matched = 0;
  for (const key of output) if (matched < reference.length && reference[matched] === key) matched++;
  return matched === reference.length;
}

/** What a removal must do with a glyph of the reference: take it out, keep it, or either. */
export type Role = "delete" | "keep" | "either";

/**
 * Whether an output is the reference with some of its glyphs taken out and nothing else: every
 * glyph `role` says to take out gone, every glyph it says to keep there, in the reference's order,
 * and the template's own glyphs, a bullet or a rule's label, either. A removal leaves the rest of
 * the page as it was, moved up or not.
 */
export function deletedOnly(
  reference: readonly string[],
  output: readonly string[],
  role: (at: number) => Role,
): boolean {
  const out = reference.length - output.length;
  if (out < 0) return false;
  // Which numbers of glyphs taken out are reachable, having read so many of the reference's.
  let reach = new Uint8Array(out + 1);
  let next = new Uint8Array(out + 1);
  reach[0] = 1;
  for (let at = 0; at < reference.length; at++) {
    next.fill(0);
    const must = role(at);
    let any = false;
    for (let taken = 0; taken <= out; taken++) {
      if (reach[taken] !== 1) continue;
      if (must !== "keep" && taken < out) {
        next[taken + 1] = 1;
        any = true;
      }
      const kept = at - taken;
      if (must !== "delete" && kept < output.length && reference[at] === output[kept]) {
        next[taken] = 1;
        any = true;
      }
    }
    if (!any) return false;
    [reach, next] = [next, reach];
  }
  return reach[out] === 1;
}

/** How many times each glyph comes in an output, by `glyphKey`. */
function tally(keys: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

/**
 * Whether an output sets every glyph of the reference, as many times or more, wherever it sets
 * them: a copy's page whose columns or pages broke elsewhere, as paracol's two columns do when the
 * left one grows, which `insertedOnly` reads as out of order.
 */
export function insertedAsSet(reference: readonly string[], output: readonly string[]): boolean {
  const out = tally(output);
  for (const [key, n] of tally(reference)) if ((out.get(key) ?? 0) < n) return false;
  return true;
}

/**
 * Whether an output is the reference with some glyphs taken out, counted glyph by glyph wherever
 * they stand, as `deletedOnly` reads it in order: no glyph the reference does not set as often,
 * and of each, as many taken out as `role` says must go, and no more than may.
 */
export function deletedAsSet(
  reference: readonly string[],
  output: readonly string[],
  role: (at: number) => Role,
): boolean {
  const out = tally(output);
  const must = new Map<string, number>();
  const may = new Map<string, number>();
  const all = tally(reference);
  reference.forEach((key, at) => {
    const each = role(at);
    if (each === "delete") must.set(key, (must.get(key) ?? 0) + 1);
    if (each !== "keep") may.set(key, (may.get(key) ?? 0) + 1);
  });
  for (const key of out.keys()) if (!all.has(key)) return false;
  for (const [key, n] of all) {
    const gone = n - (out.get(key) ?? 0);
    if (gone < (must.get(key) ?? 0) || gone > (may.get(key) ?? 0)) return false;
  }
  return true;
}

/**
 * What a trial's compile came to: the rest of the page the reference's, in its order (`holds`);
 * its glyphs all there but some set elsewhere, a column or a page broken at another place
 * (`reflows`); the compile stopped (`stops`); or glyphs lost, added where none should be, or set
 * otherwise (`breaks`).
 */
export type TrialVerdict = "holds" | "reflows" | "stops" | "breaks";

/** Whether a trial's verdict leaves the rest of the page as it was, moved or not. */
export const keepsPage = (verdict: TrialVerdict | undefined) =>
  verdict === "holds" || verdict === "reflows";

/**
 * A trial's or a batch's verdict from its output's glyphs against the reference's: a copy's put
 * glyphs in, a removal's took them out, as `role` says each may go.
 */
export function judged(
  kind: TrialKind,
  reference: readonly string[],
  output: readonly string[] | undefined,
  role: (at: number) => Role,
): TrialVerdict {
  if (output === undefined) return "stops";
  if (kind === "copy")
    return insertedOnly(reference, output)
      ? "holds"
      : insertedAsSet(reference, output)
        ? "reflows"
        : "breaks";
  return deletedOnly(reference, output, role)
    ? "holds"
    : deletedAsSet(reference, output, role)
      ? "reflows"
      : "breaks";
}

/**
 * What a removal must do with each glyph of the reference, flattened page after page, given what
 * sets each (the probe's runs, `Probe.runs`) and the spans it takes out of the body: a glyph set by
 * a part of the body inside them must go, one set by a part outside them, or by the preamble, must
 * stay, and the template's own, or one set by a part across their edge, may do either.
 */
export function rolesOf(
  reference: Pick<GlyphStream, "pages">,
  runs: readonly UncoveredRun[],
  candidates: ReadonlyMap<string, Pick<Candidate, "where" | "start" | "end">>,
  taken: readonly Span[],
): (at: number) => Role {
  const offsets: number[] = [];
  let total = 0;
  for (const page of reference.pages) {
    offsets.push(total);
    total += page.items.filter((item) => item.kind === "glyph").length;
  }
  const roles: Role[] = new Array(total).fill("either");
  for (const run of runs) {
    let role: Role = "either";
    const span =
      run.by === "raw" && run.raw !== undefined
        ? { where: "body" as const, start: run.raw.start, end: run.raw.end }
        : run.by === "candidate" && run.candidate !== undefined
          ? candidates.get(run.candidate)
          : undefined;
    if (span !== undefined) {
      if (span.where === "preamble") role = "keep";
      else if (taken.some((each) => span.start >= each.start && span.end <= each.end))
        role = "delete";
      else if (taken.every((each) => span.end <= each.start || span.start >= each.end))
        role = "keep";
    }
    const offset = offsets[run.page] ?? 0;
    for (let at = run.from; at < run.to; at++) roles[offset + at] = role;
  }
  return (at) => roles[at] ?? "either";
}

// Changing an outline.

/** An outline's parts with every field `chosen` names set to `text`, a rich one to one run of it. */
export function mutated(
  parts: readonly OutlinePart[],
  chosen: (id: string) => boolean,
  text: string,
): OutlinePart[] {
  const rich: RichText = text === "" ? [] : [{ text }];
  const map = (list: readonly OutlinePart[]): OutlinePart[] =>
    list.map((part): OutlinePart => {
      if (part.kind === "group")
        return { ...part, units: part.units.map((unit) => ({ ...unit, parts: map(unit.parts) })) };
      if (part.kind === "text") return chosen(part.id) ? { ...part, text } : part;
      if (part.kind === "rich") return chosen(part.id) ? { ...part, text: rich } : part;
      return part;
    });
  return map(parts);
}

/** The editor's copy of a unit, which check 3 tries as the editor makes it (`emptiedCopy`). */
export { emptiedCopy };

/** A trial of check 3: its group, by id, what it tries, and the span of the body it changes. */
export interface Trial {
  group: string;
  kind: TrialKind;
  /** What it takes out of the body's source, or, for a copy, the empty span where it puts one. */
  span: Span;
}

/**
 * Check 3's trials of each group the body holds, by its units' spans (`Outline.groups`): a copy of
 * its last unit, put in after it; and, where it has two units or more, the removal of its first,
 * up to the next, and of its last, from where the one before it ends. A group of one unit is never
 * left without it (decision 0050's first rule).
 */
export function trialsOf(groups: ReadonlyMap<string, readonly Unit[]>): Trial[] {
  return [...groups].flatMap(([group, units]): Trial[] => {
    const first = units[0];
    const last = units.at(-1);
    const before = units.at(-2);
    if (first === undefined || last === undefined) return [];
    const copy: Trial = { group, kind: "copy", span: { start: last.end, end: last.end } };
    if (before === undefined) return [copy];
    return [
      copy,
      { group, kind: "first", span: { start: first.start, end: first.next } },
      { group, kind: "last", span: { start: before.end, end: last.end } },
    ];
  });
}

/**
 * Trials in batches whose changes do not overlap, each to be compiled together, each trial in the
 * first batch it fits: copies, which only put text in, all in one; removals apart where one takes
 * out what another does, as an entry's removal takes its first bullet.
 */
export function batchesOf(trials: readonly Trial[]): Trial[][] {
  const overlap = (a: Span, b: Span) =>
    a.start < a.end && b.start < b.end && a.start < b.end && b.start < a.end;
  const batches: Trial[][] = [];
  for (const trial of trials) {
    const fits = batches.find((batch) => batch.every((each) => !overlap(each.span, trial.span)));
    if (fits === undefined) batches.push([trial]);
    else fits.push(trial);
  }
  return batches;
}

/**
 * An outline's parts with `trials` made: each group a trial names given a copy of its last unit as
 * it stood (`emptiedCopy`), or without its first unit or its last; the rest as it is.
 */
export function tried(
  parts: readonly OutlinePart[],
  trials: readonly Trial[],
  required: (id: string) => boolean,
): OutlinePart[] {
  const byGroup = new Map(trials.map((each) => [each.group, each.kind]));
  let minted = 0;
  const mint = () => `copy-${++minted}`;
  const map = (list: readonly OutlinePart[]): OutlinePart[] =>
    list.map((part): OutlinePart => {
      if (part.kind !== "group") return part;
      const units = part.units.map((unit) => ({ ...unit, parts: map(unit.parts) }));
      const kind = byGroup.get(part.id);
      const last = part.units.at(-1);
      if (kind === "copy" && last !== undefined)
        return { ...part, units: [...units, emptiedCopy(last, mint, required)] };
      if (kind === "first") return { ...part, units: units.slice(1) };
      if (kind === "last") return { ...part, units: units.slice(0, -1) };
      return { ...part, units };
    });
  return map(parts);
}

/**
 * An outline's parts marked as the checks found them: each field `required` names required, and
 * each group `fixed` names fixed, with why.
 */
export function marked(
  parts: readonly OutlinePart[],
  required: ReadonlySet<string>,
  fixed: ReadonlyMap<string, OutlineFixed>,
): OutlinePart[] {
  const map = (list: readonly OutlinePart[]): OutlinePart[] =>
    list.map((part): OutlinePart => {
      if (part.kind === "group") {
        const why = fixed.get(part.id);
        return {
          ...part,
          ...(why === undefined ? {} : { fixed: why }),
          units: part.units.map((unit) => ({ ...unit, parts: map(unit.parts) })),
        };
      }
      if ((part.kind === "text" || part.kind === "rich") && required.has(part.id))
        return { ...part, required: true };
      return part;
    });
  return map(parts);
}

// The checks.

/** What the checks take. */
export interface ChecksInput {
  compiler: OutlineCompiler;
  /** The page the outline must set: the reference's, a XeTeX document's with its fonts by file. */
  reference: GlyphStream;
  /** The outline, with the candidates `kept` names kept as text (`buildOutline`). */
  build: (kept: ReadonlySet<string>) => Outline;
  /** The probe's candidates, which the bisections group by kind, and its runs. */
  candidates: readonly ProbeCandidate[];
  runs: readonly UncoveredRun[];
  /** How many compiles each bisection of checks 1 and 2 may make, and check 3's trials. */
  budget?: number;
  unitsBudget?: number;
  /** Hears where the checks are and where a budget ran out (`CheckEvent`), and changes nothing. */
  observe?: (event: CheckEvent) => void;
}

/**
 * Which compiles of the checks are under way: a check's own, or its bisection's, and the outline
 * as checks 1 and 2 leave it, compiled again (`checks again`).
 */
export type CheckPhase =
  | "check 1"
  | "check 1 bisection"
  | "check 2"
  | "check 2 bisection"
  | "checks again"
  | "check 3"
  | "check 3 bisection";

/**
 * What a caller may hear of the checks as they run, for the corpus's diagnostics: each phase as it
 * begins, its compiles after it; and a check whose budget ran out, with how many fields it kept as
 * text untried, or, for check 3, how many groups it left untried. Ids and counts, never text.
 */
export type CheckEvent =
  | { phase: CheckPhase }
  | { budget: "check 1" | "check 2" | "check 3"; left: number };

/** What check 3 found of a group, by kind of trial: whether it keeps the page, or untried. */
export interface GroupTrials {
  copy?: TrialVerdict;
  first?: TrialVerdict;
  last?: TrialVerdict;
}

/** What the checks found. */
export interface Checked {
  /** The outline as the checks leave it, its required fields and fixed groups marked. */
  outline: Outline;
  resume: Resume;
  /**
   * The candidates the checks kept as text, by id, and why: `differs`, `compile`, `text` or
   * `untested`.
   */
  kept: ReadonlyMap<string, LockReason>;
  /** The fields that are required, by id. */
  required: ReadonlySet<string>;
  /** The groups that are fixed, by id, and why. */
  fixed: ReadonlyMap<string, OutlineFixed>;
  /** Each group's trials, by its id. */
  trials: ReadonlyMap<string, GroupTrials>;
  /** How many candidates each of check 2's texts stopped the compile with. */
  stops: { long: number; special: number; empty: number };
  /** Whether the document's fields take letters of other scripts, each tried apart. */
  scripts: { greek: boolean; cyrillic: boolean };
  /** `partial` when the outline with no field sets another page than the reference's. */
  outcome: "assembled" | "partial";
  difference?: Difference;
  /** What the checks could not do, a check's name and a line of counts, never the resume's text. */
  notes: { check: string; message: string }[];
  compiles: number;
  ms: number;
}

/** A field-switch of the bisections: the probe's candidate a field is of. */
const switches = (outline: Outline, byId: ReadonlyMap<string, ProbeCandidate>): Candidate[] =>
  [...outline.fields.keys()].flatMap((id) => byId.get(id) ?? []);

/** `n` things, as a note counts them: `1 field`, `2 fields`. */
const counted = (n: number, thing: string) => `${n} ${thing}${n === 1 ? "" : "s"}`;

/**
 * The four checks of an outline (the module's comment): the outline the checks leave, its marks,
 * and what they found; or a refusal where even the outline with every field kept as text does not
 * compile (`stopped`), or the model refuses it (`keep`).
 */
export async function checkOutline(input: ChecksInput): Promise<Checked | Refusal> {
  const { compiler, reference, build, runs } = input;
  // What the caller hears changes nothing the checks do, not even when it throws.
  const observe = (event: CheckEvent) => {
    try {
      input.observe?.(event);
    } catch {}
  };
  const budget = input.budget ?? CHECK_BUDGET;
  const byId = new Map(input.candidates.map((each) => [each.id, each]));
  const notes: Checked["notes"] = [];
  const kept = new Map<string, LockReason>();
  const keySet = (ids: Iterable<string>) => [...ids].sort().join(" ");
  /** What each outline compiled unmarked came to, by the candidates it kept as text. */
  const known = new Map<string, { broke: boolean; found?: Difference; log: string }>();
  let target = reference;
  const compileKept = async (ids: ReadonlySet<string>) => {
    const outline = build(ids);
    const resume = outlineResume(outline.parts);
    if (resume === undefined) return { outline, compiled: undefined };
    const compiled = await compiler.compile(resume);
    const found = compiled.stream === undefined ? undefined : differs(target, compiled.stream);
    known.set(keySet(ids), {
      broke: compiled.broke,
      ...(found ? { found } : {}),
      log: compiled.log,
    });
    return { outline, compiled, found };
  };
  const holds = (ids: ReadonlySet<string>) => {
    const was = known.get(keySet(ids));
    return was !== undefined && !was.broke && was.found === undefined;
  };

  // 1. The page.
  observe({ phase: "check 1" });
  const whole = build(new Set());
  if (outlineResume(whole.parts) === undefined) return refusal("keep");
  const fieldOf = switches(whole, byId);
  const all = new Set(fieldOf.map((each) => each.id));
  let outcome: Checked["outcome"] = "assembled";
  let differsFrom: Difference | undefined;
  const first = await compileKept(new Set());
  if (first.compiled === undefined || first.compiled.broke || first.found !== undefined) {
    // The outline with every field kept is the floor: what the package sets of the upload's own.
    const floor = await compileKept(all);
    if (floor.compiled === undefined) return refusal("keep");
    if (floor.compiled.broke || floor.compiled.stream === undefined)
      return refusal("stopped", undefined, floor.compiled.log);
    if (floor.found !== undefined) {
      outcome = "partial";
      differsFrom = floor.found;
      // The fields must keep the page the package sets, which no field moved.
      target = floor.compiled.stream;
      known.clear();
      known.set(keySet(all), { broke: false, log: floor.compiled.log });
    }
    const again =
      first.compiled?.stream === undefined ? undefined : differs(target, first.compiled.stream);
    if (first.compiled === undefined || first.compiled.broke || again !== undefined) {
      const ids = (set: readonly Candidate[]) => new Set(set.map((each) => each.id));
      observe({ phase: "check 1 bisection" });
      const settled = await settle(
        probeOrder(fieldOf, byId),
        async (set): Promise<SetResult> => {
          const on = ids(set);
          const off = new Set([...all].filter((id) => !on.has(id)));
          const tried = await compileKept(off);
          const own = new Map(set.map((each) => [each.id, { ok: true }]));
          if (tried.compiled === undefined) return { broke: true, same: false, torn: false, own };
          const fields = new Set([...tried.outline.owners.keys()]);
          const named = tried.compiled.broke
            ? suspectsIn(tried.compiled.log, fields)
            : [suspectOf(tried.compiled.stream as GlyphStream, tried.found) ?? ""];
          const suspects = [
            ...new Set(named.flatMap((field) => tried.outline.owners.get(field) ?? [])),
          ];
          return {
            broke: tried.compiled.broke,
            same: !tried.compiled.broke && tried.found === undefined,
            ...(tried.found === undefined ? {} : { difference: tried.found.kind }),
            torn: false,
            own,
            ...(suspects.length === 0 ? {} : { suspects }),
          };
        },
        budget,
        byId,
      );
      let untested = 0;
      for (const [id, { verdict }] of settled.verdicts) {
        if (verdict === "editable") continue;
        kept.set(
          id,
          verdict === "untested" ? "untested" : verdict === "breaks" ? "compile" : "differs",
        );
        if (verdict === "untested") untested++;
      }
      if (untested > 0) observe({ budget: "check 1", left: untested });
      if (untested > 0)
        notes.push({
          check: "untested",
          message: `the first check's bisection ran out of its ${counted(budget, "compile")} and kept ${counted(untested, "field")} as text`,
        });
    }
  }

  // 2. Mutations: long, special and empty texts in every field, bisected where one stops.
  let current = build(new Set(kept.keys()));
  const fields = switches(current, byId);
  const onText = new Set<string>();
  const stops = { long: 0, special: 0, empty: 0 };
  const onEmpty = new Set<string>();
  const untried = new Set<string>();
  /** A compile of the outline with every field of the candidates `on` names set to `text`. */
  const mutate = async (text: string, on: ReadonlySet<string>) => {
    const owners = current.owners;
    const resume = outlineResume(
      mutated(current.parts, (field) => on.has(owners.get(field) ?? ""), text),
    );
    if (resume === undefined) return { broke: true, log: "" };
    return compiler.compile(resume);
  };
  for (const [name, text] of [
    ["long", MUTATIONS.long],
    ["special", MUTATIONS.special],
    ["empty", MUTATIONS.empty],
  ] as const) {
    // A field already kept as text by an earlier text is not tried again.
    const trying = fields.filter((each) => !onText.has(each.id) && !untried.has(each.id));
    if (trying.length === 0) break;
    observe({ phase: "check 2" });
    const whole = await mutate(text, new Set(trying.map((each) => each.id)));
    if (!whole.broke) continue;
    const fieldIds = new Set(current.owners.keys());
    observe({ phase: "check 2 bisection" });
    const settled = await settle(
      probeOrder(trying, byId),
      async (set): Promise<SetResult> => {
        const on = new Set(set.map((each) => each.id));
        const result = await mutate(text, on);
        const suspects = [
          ...new Set(
            suspectsIn(result.log, fieldIds).flatMap((field) => current.owners.get(field) ?? []),
          ),
        ].filter((id) => on.has(id));
        return {
          broke: result.broke,
          same: true,
          torn: false,
          own: new Map(set.map((each) => [each.id, { ok: true }])),
          ...(suspects.length === 0 ? {} : { suspects }),
        };
      },
      budget,
      byId,
    );
    let left = 0;
    for (const [id, { verdict }] of settled.verdicts) {
      if (verdict === "editable") continue;
      if (verdict === "untested") {
        untried.add(id);
        left++;
      } else {
        stops[name]++;
        if (name === "empty") onEmpty.add(id);
        else onText.add(id);
      }
    }
    if (left > 0) observe({ budget: "check 2", left });
    if (left > 0)
      notes.push({
        check: "untested",
        message: `the second check's bisection of the ${name} text ran out of its ${counted(budget, "compile")} and kept ${counted(left, "field")} as text`,
      });
  }
  // Letters of other scripts, in every field at once: where they stop the compile, they stop it
  // whatever field holds them, since the document's fonts lack them, and no field is the cause.
  const remaining = fields.filter((each) => !onText.has(each.id) && !untried.has(each.id));
  observe({ phase: "check 2" });
  const sets = async (text: string) =>
    remaining.length === 0 ||
    !(await mutate(text, new Set(remaining.map((each) => each.id)))).broke;
  // Each script apart, so that a document whose fonts set one is never said to lack it.
  const scripts = {
    greek: await sets(MUTATIONS.scripts.greek),
    cyrillic: await sets(MUTATIONS.scripts.cyrillic),
  };
  for (const id of onText) kept.set(id, "text");
  for (const id of untried) if (!kept.has(id)) kept.set(id, "untested");
  if (onText.size > 0 || untried.size > 0) current = build(new Set(kept.keys()));
  const required = new Set(
    [...current.owners].flatMap(([field, candidate]) => (onEmpty.has(candidate) ? [field] : [])),
  );

  // The outline as checks 1 and 2 leave it must set the page; one that the bisection did not
  // compile as it stands is compiled now.
  const settledKept = new Set(kept.keys());
  observe({ phase: "checks again" });
  if (!known.has(keySet(settledKept))) await compileKept(settledKept);
  if (!holds(settledKept)) {
    let was = known.get(keySet(settledKept));
    if (was?.broke !== false) {
      // Fields that passed one by one stop the compile together, past every bisection: they are all
      // kept as text, which must compile, or the import is refused.
      for (const field of switches(current, byId)) kept.set(field.id, "compile");
      const floor = new Set(kept.keys());
      current = build(floor);
      required.clear();
      if (!known.has(keySet(floor))) await compileKept(floor);
      was = known.get(keySet(floor));
      if (was === undefined) return refusal("keep");
      if (was.broke) return refusal("stopped", undefined, was.log);
    }
    if (was.found !== undefined && outcome === "assembled") {
      outcome = "partial";
      differsFrom = was.found;
    }
  }

  // 3. Groups: a copy of each one's last unit, and the removal of its first and its last.
  const fixed = new Map<string, OutlineFixed>();
  const trials = new Map<string, GroupTrials>();
  const groupIds = [...outlineNodes(current.parts)].flatMap((step) =>
    step.kind === "part" && step.part.kind === "group" ? [step.part.id] : [],
  );
  // The trials are judged against the reference's glyphs, by what the probe's runs say sets each:
  // a page that differs from it only in where its glyphs stand, as a package's preamble may move
  // them, is judged as well; one that sets other glyphs is not, and every group is untried.
  let judging = outcome === "assembled";
  observe({ phase: "check 3" });
  if (!judging) {
    const resume = outlineResume(current.parts);
    const base = resume === undefined ? undefined : await compiler.compile(resume);
    const keys = base?.stream === undefined || base.broke ? undefined : glyphKeys(base.stream);
    const wanted = glyphKeys(reference);
    judging = keys?.length === wanted.length && keys.every((key, at) => key === wanted[at]);
  }
  if (!judging) {
    for (const id of groupIds) fixed.set(id, "untried");
  } else {
    const wanted = glyphKeys(reference);
    const isRequired = (id: string) => required.has(id);
    let spent = 0;
    const unitsBudget = input.unitsBudget ?? UNITS_BUDGET;
    /** The batch the bisection is on, whose first compile is check 3's and the rest its halves'. */
    let whole: readonly Trial[] = [];
    const test = async (batch: readonly Trial[]): Promise<TrialVerdict | undefined> => {
      if (spent >= unitsBudget) return undefined;
      spent++;
      observe({ phase: batch === whole ? "check 3" : "check 3 bisection" });
      const kind = batch[0]?.kind ?? "copy";
      const resume = outlineResume(tried(current.parts, batch, isRequired));
      const compiled = resume === undefined ? undefined : await compiler.compile(resume);
      const output =
        compiled?.stream === undefined || compiled.broke ? undefined : glyphKeys(compiled.stream);
      const taken = kind === "copy" ? [] : batch.map((each) => each.span);
      return judged(kind, wanted, output, rolesOf(reference, runs, byId, taken));
    };
    const all = trialsOf(current.groups);
    for (const kind of ["copy", "first", "last"] as const)
      for (const batch of batchesOf(all.filter((each) => each.kind === kind))) {
        whole = batch;
        for (const [trial, verdict] of await bisect(batch, test, keepsPage)) {
          const found = trials.get(trial.group) ?? {};
          if (verdict !== undefined) found[trial.kind] = verdict;
          trials.set(trial.group, found);
        }
      }
    for (const id of groupIds) {
      const units = current.groups.get(id);
      const found = trials.get(id) ?? {};
      const removals = units !== undefined && units.length > 1;
      if (
        units === undefined ||
        found.copy === undefined ||
        (removals && (found.first === undefined || found.last === undefined))
      )
        fixed.set(id, "untried");
      // A trial that stopped the compile says so (`stops`), apart from one that changed the page.
      else if (!keepsPage(found.copy)) fixed.set(id, found.copy === "stops" ? "stops" : "copy");
      else if (removals && !(keepsPage(found.first) && keepsPage(found.last)))
        fixed.set(id, found.first === "stops" || found.last === "stops" ? "stops" : "removal");
    }
    const left = [...fixed.values()].filter((why) => why === "untried").length;
    if (left > 0) observe({ budget: "check 3", left });
    if (left > 0)
      notes.push({
        check: "units",
        message: `the third check ran out of its ${counted(unitsBudget, "compile")} and left ${counted(left, "group")} untried, which take no unit more or fewer`,
      });
  }

  // 4. Controls: an outline's package offers none (`outlinePackage`), so there is none to try.

  const parts = marked(current.parts, required, fixed);
  const resume = outlineResume(parts);
  if (resume === undefined) return refusal("keep");
  return {
    outline: { ...current, parts },
    resume,
    kept,
    required,
    fixed,
    trials,
    stops,
    scripts,
    outcome,
    ...(differsFrom === undefined ? {} : { difference: differsFrom }),
    notes,
    compiles: compiler.count,
    ms: compiler.ms,
  };
}
