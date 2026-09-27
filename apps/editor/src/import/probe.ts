/**
 * The probe (milestone 3 item 5, plan section 6 step 3, decision 0022): which parts of an imported
 * resume the editor may mark as fields. Every candidate (`candidates.ts`), an argument of a call to
 * a template macro or of a template environment, a section's title, a list item's text or label, or
 * a paragraph of rich text, is wrapped in `\rtfield`, the prelude's marker macro (decision 0007),
 * and the body is compiled; a candidate is editable when the compile succeeds, its markers come
 * once, in order, on one page, the glyphs between them spell its text (`alignField`), and the
 * output, the markers set aside, sets the reference's glyph stream (`sameGlyphs`), so that the
 * wrapping moved nothing.
 *
 * On pdfTeX the document's own preamble, with the prelude after it as `generateFormat` puts it
 * after a package's, is dumped once as a format in the `import` job, and every probe compile is a
 * body compile from it. On XeTeX a preamble that loads fontspec cannot be dumped (decision 0003),
 * so until item 8 rewrites XeTeX's fonts every probe compile is a whole compile from the stock
 * format, as the reference was, fontconfig given the tree's fonts, with the prelude before
 * `\begin{document}`; a pdfTeX preamble that does not dump, or whose format does not set the
 * reference's glyphs, takes that path too. `Path` hides the difference, and the result says which
 * a document took. Either way the unmarked body compiles first, the baseline, which must set the
 * reference's glyphs, and whose auxiliary files every probe compile starts from, so that no compile
 * reads what another's markers wrote. A probe compile takes two passes at most; one that stops, or
 * whose log still asks for a pass after them, is a failure of the whole set.
 *
 * All the candidates are wrapped at once, first. What a candidate's own markers and glyphs show is
 * its own; a set whose compile stops, or whose output moves with no candidate's markers to say
 * why, is split until a single candidate fails alone (`settle`). A document has a budget of 64
 * compiles, after which what is left is `untested`. The verdicts are
 * gathered per macro and argument, per environment and argument, and per kind of standard node
 * (`aggregate`), which is what item 6 describes and item 7 assembles from. The glyphs of the
 * reference no editable field covers are the uncovered runs, each set down to the locked candidate
 * or the raw chunk that sets it, where the probe can tell, or to the template's own text.
 *
 * Nothing here reaches for Node or the browser: the caller brings the session and the fonts, as the
 * validation harness's caller does. What the probe finds names ids, macros and counts; a
 * candidate's text is the resume's, and stays with the caller.
 */

import type { CompileResult, Engine, EngineSession } from "../engine/session";
import type { FontLibrary } from "../page/fonts";
import { PARAGRAPH_MARKER, PRELUDE } from "../templates/prelude";
import {
  alignField,
  collectFields,
  type Field,
  MARKER_BEGIN,
  MARKER_END,
  markerId,
} from "../tex/fields";
import { checkSpecial, SETS_NO_GLYPH } from "../validate/harness";
import {
  type Candidate,
  type Candidates,
  candidatesOf,
  isSetter,
  marked,
  type RawChunk,
  reissued,
} from "./candidates";
import { encodeLike, type Intake } from "./intake";
import { asksForRerun } from "./log";
import {
  type Body,
  bodyOf,
  bodyOfText,
  buildTree,
  type ReadBody,
  readBody,
  type Tree,
  type Uses,
  usesOf,
} from "./parse";
import {
  type DifferenceKind,
  difference,
  type GlyphStream,
  IMPORT_JOB,
  type Reference,
  type ReferenceOptions,
  readOutput,
  referenceFiles,
  shippedFont,
} from "./reference";
import { signatures as askSignatures, type EngineSignatures } from "./signatures";

/** How many compiles a document's probe may make, the baseline and the dump aside. */
export const PROBE_BUDGET = 64;

/** How many passes a probe compile takes at most, from the baseline's auxiliary files. */
export const PROBE_PASSES = 2;

/**
 * Why a candidate is locked: it holds a raw chunk (`raw`); the compile stopped or ran out of passes
 * with it (`breaks`); its markers never reached the page, since the argument is not typeset, as a
 * length, a colour, a key or an address is (`vanished`); they came twice, or its text reached a
 * special as well, as a link's address or a running head has it (`twice`); they came, and its
 * glyphs spelt its text, but glyphs moved, or the page cannot place its own (`moved`); its glyphs
 * do not spell its text, as when a macro transforms it or takes its markers apart (`misaligned`),
 * or do only in another case, as `\MakeUppercase` sets it, which the aligner does not fold yet
 * (`case`); it begins on one page and ends on another, or never ends (`split`); or the budget ran
 * out before it was settled (`untested`).
 */
export const REASONS = [
  "raw",
  "breaks",
  "vanished",
  "twice",
  "moved",
  "misaligned",
  "case",
  "split",
  "untested",
] as const;
export type Reason = (typeof REASONS)[number];

/**
 * What the probe says of a candidate: `editable`; `container`, one that holds structure, whose
 * parts are candidates of their own and which is neither editable nor locked; or why it is locked.
 */
export type Verdict = "editable" | "container" | Reason;

/** The reasons a compile can show, as against `raw`, known before any, and `untested`, after. */
type Failure = Exclude<Reason, "raw" | "untested">;

/**
 * How a verdict was reached: in a set, by what the candidate's own markers showed or because the
 * set passed (`together`); alone (`alone`); as a candidate of its kind reached alone, in a set of
 * its kind that failed as that one did (`like`); without a compile, since the candidate holds a raw
 * chunk or structure (`unprobed`); or not, the budget spent (`budget`).
 */
export type Settled = "together" | "alone" | "like" | "unprobed" | "budget";

/** A candidate and what the probe found. */
export interface ProbeCandidate extends Candidate {
  verdict: Verdict;
  /**
   * More about a failure: where the second copy was (`page` or `special`), how a split field ended
   * (`no end`, `out of order`), that a macro took the markers apart (`torn`), that the page cannot
   * place the field (`transform`), or the kind of the first difference from the reference.
   */
  detail?: string;
  settled: Settled;
}

/** A glyph of an output: its page, from 0, and its place among the page's glyphs, from 0. */
export type GlyphPlace = readonly [page: number, at: number];

/** What one candidate's markers and glyphs showed in a compile. */
export interface Own {
  ok: boolean;
  /** Why not, when not. */
  reason?: Failure;
  detail?: string;
  /** Its glyphs, when its markers came, the first copy's. */
  glyphs?: GlyphPlace[];
}

/** What one compile of a set of candidates showed. */
export interface SetResult {
  /** It stopped, or its log still asked for a pass after the last. */
  broke: boolean;
  /** Its output, the markers set aside, sets the reference's glyph stream. */
  same: boolean;
  /** How it first differs from the reference, when it does. */
  difference?: DifferenceKind;
  /** Markers came whose ids are none of the set's: a macro took one apart. */
  torn: boolean;
  /** What each candidate of the set showed. */
  own: ReadonlyMap<string, Own>;
  /**
   * The candidates the compile names as the likeliest to have stopped it or moved its glyphs: those
   * whose markers TeX's error shows it reading, or the field whose markers come last before where
   * the output first parts from the reference's.
   */
  suspects?: readonly string[];
}

/** A compile of a set of candidates wrapped, and what it showed. */
export type CompileSet = (set: readonly Candidate[]) => Promise<SetResult>;

/** What `settle` decided, and how many compiles it took. */
export interface Settlement {
  verdicts: Map<string, { verdict: Verdict; detail?: string; settled: Settled }>;
  /** The glyphs of each candidate that came in a compile whose output set the reference's. */
  evidence: Map<string, GlyphPlace[]>;
  compiles: number;
}

/**
 * A candidate's kind, for bisection: its place, its kind, whose argument it is and which, and
 * whether it is empty. A macro's calls fail alike, so candidates of one kind are tried together,
 * and once one has stopped a compile or moved its glyphs alone, the others of its kind are tried
 * among themselves. A paragraph at the top of the body is a kind of its own; one inside an
 * argument that is not probed is of that argument's kind.
 */
export function kindOf(candidate: Candidate, owners: ReadonlyMap<string, Candidate>): string {
  const empty = candidate.empty ? "empty" : "";
  if (candidate.kind === "paragraph") {
    const owner = candidate.within === undefined ? undefined : owners.get(candidate.within);
    return owner === undefined
      ? `paragraph|${candidate.id}`
      : `part|${kindOf(owner, owners)}|${empty}`;
  }
  return [
    candidate.where,
    candidate.kind,
    candidate.of ?? "",
    candidate.name,
    candidate.index ?? "",
    empty,
  ].join("|");
}

/**
 * The verdict of each candidate, from compiles of sets of them (`compile`), within `budget`
 * compiles. The candidates come in the order their sets are split along: kinds together, each
 * kind's in the order of the source (`probeOrder`).
 *
 * A set is compiled whole. What a candidate's own markers and glyphs show is its own, whatever
 * else the set holds (`Own`): markers that never came, came twice, or went into a special, a
 * field split across pages, glyphs that do not spell its text, or glyphs the page cannot place.
 * Only a failure of the set as a whole needs splitting: a compile that stops, or an output that
 * does not set the reference's glyphs when no candidate's own markers say why. Such a set is split
 * until a single candidate fails alone (`breaks`, `moved`), the candidates the compile names first
 * (`SetResult.suspects`), each tried alone, and then the rest without them; otherwise in two, at
 * the edge between kinds nearest its middle when there is one near it. When the output sets the
 * reference's glyphs, every candidate whose markers passed is editable. When it does not, those
 * are tried again without the ones that failed, and so are the ones whose markers never came,
 * whose failure the move may have caused. Markers taken apart, whose ids the set does not hold,
 * leave a candidate whose markers never came to be tried alone, where a torn marker is its own
 * (`misaligned`). Once one of a kind has failed alone, the others of its kind are tried among
 * themselves, apart from the rest: a set of a kind one of which stopped a compile alone takes that
 * verdict whole when it stops one too (`like`), since an argument that stops TeX, a length or a key,
 * stops it whatever it holds; one that moved the page is split still, since what moves it may be
 * what one call holds and another does not. What the budget leaves is `untested`.
 */
export async function settle(
  candidates: readonly Candidate[],
  compile: CompileSet,
  budget: number,
  owners: ReadonlyMap<string, Candidate> = new Map(candidates.map((each) => [each.id, each])),
): Promise<Settlement> {
  const verdicts: Settlement["verdicts"] = new Map();
  const evidence = new Map<string, GlyphPlace[]>();
  const failing = new Map<string, Failure>();
  const kinds = new Map(candidates.map((each) => [each.id, kindOf(each, owners)]));
  const kind = (candidate: Candidate) => kinds.get(candidate.id) ?? candidate.id;
  let compiles = 0;

  const open = (set: readonly Candidate[]) => set.filter((each) => !verdicts.has(each.id));
  const decide = (candidate: Candidate, verdict: Verdict, settled: Settled, detail?: string) => {
    if (verdicts.has(candidate.id)) return;
    verdicts.set(candidate.id, { verdict, settled, ...(detail === undefined ? {} : { detail }) });
    if (settled === "alone" && (verdict === "breaks" || verdict === "moved"))
      failing.set(kind(candidate), verdict);
  };
  const run = async (set: readonly Candidate[]): Promise<SetResult | undefined> => {
    if (compiles >= budget) {
      for (const candidate of set) decide(candidate, "untested", "budget");
      return undefined;
    }
    compiles++;
    const result = await compile(set);
    if (!result.broke && result.same)
      for (const candidate of set) {
        const glyphs = result.own.get(candidate.id)?.glyphs;
        if (glyphs !== undefined && !evidence.has(candidate.id)) evidence.set(candidate.id, glyphs);
      }
    return result;
  };
  /** The two halves a set is split into: at the edge between kinds nearest its middle, if near. */
  const halves = (set: readonly Candidate[]): Candidate[][] => {
    const middle = set.length / 2;
    let at = Math.floor(middle);
    let best = Number.POSITIVE_INFINITY;
    for (let i = 1; i < set.length; i++) {
      const edge = kind(set[i] as Candidate) !== kind(set[i - 1] as Candidate);
      const off = Math.abs(i - middle);
      if (edge && off <= set.length / 4 && off < best) {
        best = off;
        at = i;
      }
    }
    return [set.slice(0, at), set.slice(at)];
  };
  /** Candidates grouped by kind, in the order each kind's first came. */
  const byKind = (set: readonly Candidate[]) => {
    const groups = new Map<string, Candidate[]>();
    for (const each of set) {
      const group = groups.get(kind(each)) ?? [];
      group.push(each);
      groups.set(kind(each), group);
    }
    return [...groups.values()];
  };
  /** A single candidate's verdict from its own compile. */
  const alone = (
    result: SetResult,
    candidate: Candidate,
  ): { verdict: Verdict; detail?: string } => {
    if (result.broke) return { verdict: "breaks" };
    const own = result.own.get(candidate.id);
    if (own !== undefined && !own.ok && own.reason !== undefined)
      return own.reason === "vanished" && result.torn
        ? { verdict: "misaligned", detail: "torn" }
        : { verdict: own.reason, ...(own.detail === undefined ? {} : { detail: own.detail }) };
    if (!result.same)
      return { verdict: "moved", ...(result.difference ? { detail: result.difference } : {}) };
    return { verdict: "editable" };
  };
  /**
   * A set that failed as a whole, split: the candidates its compile names each tried alone, and the
   * rest without them; or, when it names none of them, or all, in two.
   */
  const split = async (set: readonly Candidate[], result: SetResult, quarantine: boolean) => {
    const named = set.filter((each) => result.suspects?.includes(each.id));
    if (named.length > 0 && named.length < set.length) {
      for (const each of named) await test([each], quarantine);
      await test(
        set.filter((each) => !named.includes(each)),
        quarantine,
      );
      return;
    }
    for (const half of halves(set)) await test(half, quarantine);
  };

  const test = async (given: readonly Candidate[], quarantine = true): Promise<void> => {
    let set = open(given);
    // The others of a kind one of which stopped a compile or moved its glyphs alone are tried
    // among themselves.
    while (quarantine && set.length > 1) {
      const held = set.filter((each) => failing.has(kind(each)));
      if (held.length === 0) break;
      for (const group of byKind(held)) await testKind(group);
      set = open(set);
    }
    if (set.length === 0) return;
    const result = await run(set);
    if (result === undefined) return;
    const only = set.length === 1 ? set[0] : undefined;
    if (only !== undefined) {
      const { verdict, detail } = alone(result, only);
      decide(only, verdict, "alone", detail);
      return;
    }
    if (result.broke) {
      await split(set, result, true);
      return;
    }
    const passed = set.filter((each) => result.own.get(each.id)?.ok === true);
    // A candidate whose markers never came may have lost them to another's move, or to a torn
    // marker the set cannot tell whose it is.
    const unclear = (each: Candidate) => {
      const own = result.own.get(each.id);
      return own?.ok !== true && own?.reason === "vanished" && (result.torn || !result.same);
    };
    for (const each of set) {
      const own = result.own.get(each.id);
      if (own === undefined || own.ok || unclear(each)) continue;
      decide(each, own.reason ?? "vanished", "together", own.detail);
    }
    const doubtful = set.filter(unclear);
    if (result.same) {
      for (const each of passed) decide(each, "editable", "together");
      for (const each of doubtful) await test([each]);
      return;
    }
    const again = [...passed, ...doubtful];
    if (again.length < set.length) await test(again);
    else await split(set, result, true);
  };

  /** A kind one of which stopped a compile or moved its glyphs alone, tried among themselves. */
  const testKind = async (group: readonly Candidate[]) => {
    const set = open(group);
    const first = set[0];
    if (first === undefined) return;
    if (set.length === 1) {
      await test(set, false);
      return;
    }
    const reason = failing.get(kind(first));
    const result = await run(set);
    if (result === undefined) return;
    if (result.broke) {
      if (reason === "breaks") for (const each of set) decide(each, "breaks", "like");
      else await split(set, result, false);
      return;
    }
    for (const each of set) {
      const own = result.own.get(each.id);
      if (own !== undefined && !own.ok && !(own.reason === "vanished" && result.torn))
        decide(each, own.reason ?? "vanished", "together", own.detail);
    }
    const passed = set.filter((each) => result.own.get(each.id)?.ok === true);
    const doubtful = open(set).filter((each) => !passed.includes(each));
    // A kind whose calls move the page moves it by what each holds, as a letter a margin kerns
    // does at a line's start, so each that moves it is found alone, the one the output names first.
    if (result.same) for (const each of passed) decide(each, "editable", "together");
    else if (passed.length > 0 && passed.length < set.length) await test(passed, false);
    else if (passed.length > 0) await split(passed, result, false);
    for (const each of doubtful) await test([each], false);
  };

  await test(candidates);
  for (const candidate of candidates) decide(candidate, "untested", "budget");
  return { verdicts, evidence, compiles };
}

/**
 * The order `settle` splits candidates along: kinds together, in the order each kind first comes
 * in the source, and each kind's candidates in the source's order, the body's before the
 * preamble's calls.
 */
export function probeOrder(
  candidates: readonly Candidate[],
  owners: ReadonlyMap<string, Candidate> = new Map(candidates.map((each) => [each.id, each])),
): Candidate[] {
  const kinds = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const name = kindOf(candidate, owners);
    const list = kinds.get(name) ?? [];
    list.push(candidate);
    kinds.set(name, list);
  }
  return [...kinds.values()].flat();
}

// Reading a compile.

/** A marker's id inside another special's text, as a link's address holds its argument's. */
const EMBEDDED = /rt:b:(?:\\detokenize\s*\{)?([a-z0-9-]+)/gi;

/** What the harness's special check says of a field set where the PDF alone transforms it. */
const TRANSFORMED = "PDF-only transform";

/** A field's text and glyphs, read case-insensitively. */
function folded(field: Field): Field {
  return {
    id: field.id,
    glyphs: field.glyphs.map((glyph) => ({
      ...glyph,
      text: glyph.text?.toLowerCase(),
      ...(glyph.alternatives === undefined
        ? {}
        : { alternatives: glyph.alternatives.map((each) => each.toLowerCase()) }),
      offset: -1,
    })),
  };
}

/**
 * Whether a field's glyphs spell a text: every glyph matches a character of it (`alignField`), and
 * the glyphs account for all of it that sets a glyph, as the harness's alignment check has it. A
 * copy of the field is aligned, so the field's offsets stay as they were.
 */
function spells(field: Field, text: string): boolean {
  const copy: Field = { id: field.id, glyphs: field.glyphs.map((glyph) => ({ ...glyph })) };
  const { unmatched, covered } = alignField(copy, text);
  return unmatched === 0 && text.slice(covered).replace(SETS_NO_GLYPH, "") === "";
}

/**
 * What an output shows of a set of candidates: whether it sets the reference's glyph stream, the
 * markers set aside, and each candidate's markers and glyphs (`Own`), read as the harness reads a
 * page's fields: each page parsed with the fonts' widths, its glyphs named as the page names them,
 * its fields collected with their markers read whatever their case (`collectFields`).
 */
export async function observe(
  fonts: FontLibrary,
  reference: GlyphStream,
  output: Uint8Array,
  set: readonly Candidate[],
  shipped: (path: string) => Uint8Array | undefined = () => undefined,
): Promise<SetResult> {
  const { stream, doc, textOf } = await readOutput(fonts, output, shipped);
  const differs = difference(reference, stream);
  const ids = new Set(set.map((each) => each.id));
  // Each item's place among its page's glyphs, a native run's glyphs each one.
  const places = doc.pages.map((page) => {
    const first: number[] = [];
    let n = 0;
    page.items.forEach((item, i) => {
      first[i] = n;
      if (item.kind === "glyph") n++;
      else if (item.kind === "native") n += item.glyphs.length;
    });
    return first;
  });
  type At = { page: number; index: number };
  const marks = new Map<string, { begins: At[]; ends: At[]; embedded: number }>();
  const marksOf = (id: string) => {
    const found = marks.get(id) ?? { begins: [], ends: [], embedded: 0 };
    marks.set(id, found);
    return found;
  };
  let torn = false;
  doc.pages.forEach((page, p) =>
    page.items.forEach((item, index) => {
      if (item.kind !== "special") return;
      const begin = markerId(item.text, MARKER_BEGIN);
      const end = begin === undefined ? markerId(item.text, MARKER_END) : undefined;
      const id = begin ?? end;
      if (id !== undefined) {
        if (!ids.has(id)) torn ||= begin !== undefined;
        else (begin !== undefined ? marksOf(id).begins : marksOf(id).ends).push({ page: p, index });
        return;
      }
      if (item.text.slice(0, PARAGRAPH_MARKER.length).toLowerCase() === PARAGRAPH_MARKER) return;
      for (const match of item.text.matchAll(EMBEDDED)) {
        const found = match[1]?.toLowerCase();
        if (found !== undefined && ids.has(found)) marksOf(found).embedded++;
      }
    }),
  );
  const transformed = new Set(
    checkSpecial(doc)
      .filter((finding) => finding.message.includes(TRANSFORMED))
      .flatMap((finding) => finding.field ?? []),
  );
  const fieldsOn = new Map<number, Map<string, Field>>();
  const fieldOf = (page: number, id: string) => {
    let fields = fieldsOn.get(page);
    const items = doc.pages[page];
    if (fields === undefined && items !== undefined) {
      fields = collectFields(items, textOf);
      fieldsOn.set(page, fields);
    }
    return fields?.get(id);
  };
  const own = new Map<string, Own>();
  for (const candidate of set) {
    const found = marks.get(candidate.id);
    const begin = found?.begins[0];
    if (found === undefined || begin === undefined) {
      own.set(candidate.id, {
        ok: false,
        reason: "vanished",
        ...(found !== undefined && found.embedded > 0 ? { detail: "special" } : {}),
      });
      continue;
    }
    const field = fieldOf(begin.page, candidate.id);
    const glyphs: GlyphPlace[] = (field?.glyphs ?? []).flatMap((glyph) => {
      const first = places[begin.page]?.[glyph.item];
      if (first === undefined) return [];
      const others = (glyph.items ?? []).flatMap((item) => {
        const at = places[begin.page]?.[item];
        return at === undefined ? [] : [[begin.page, at] as const];
      });
      return [[begin.page, first + (glyph.glyph ?? 0)] as const, ...others];
    });
    const fail = (reason: Failure, detail?: string, keep = true) =>
      own.set(candidate.id, {
        ok: false,
        reason,
        ...(detail === undefined ? {} : { detail }),
        ...(keep ? { glyphs } : {}),
      });
    const end = found.ends[0];
    if (found.begins.length > 1) fail("twice", "page");
    else if (found.embedded > 0) fail("twice", "special");
    else if (end === undefined) fail("split", "no end", false);
    else if (end.page !== begin.page) fail("split", undefined, false);
    else if (end.index < begin.index) fail("split", "out of order", false);
    else if (field === undefined || !spells(field, candidate.text))
      fail(
        field !== undefined && spells(folded(field), candidate.text.toLowerCase())
          ? "case"
          : "misaligned",
      );
    else if (transformed.has(candidate.id)) fail("moved", "transform");
    else own.set(candidate.id, { ok: true, glyphs });
  }
  // The field whose begin marker comes last before where the output parts from the reference's.
  let suspect: string | undefined;
  if (differs?.page !== undefined) {
    const items = stream.pages[differs.page]?.items ?? [];
    const found = differs.item === undefined ? -1 : items.indexOf(differs.item);
    for (let at = found < 0 ? items.length - 1 : found; at >= 0 && suspect === undefined; at--) {
      const item = items[at];
      const id = item?.kind === "special" ? markerId(item.text, MARKER_BEGIN) : undefined;
      if (id !== undefined && ids.has(id)) suspect = id;
    }
  }
  return {
    broke: false,
    same: differs === undefined,
    ...(differs === undefined ? {} : { difference: differs.kind }),
    torn,
    own,
    ...(suspect === undefined ? {} : { suspects: [suspect] }),
  };
}

/** A candidate's id where TeX's error shows it reading the candidate's markers. */
const NAMED = /(?:rtfield\s*\{?|rt:[bep]:(?:\\detokenize\s*\{)?)([a-z0-9-]+)/gi;

/**
 * The candidates a compile that stopped names: those whose markers its first error's context
 * shows TeX reading, the lines from the error to the line of the source it was on, which name the
 * argument that stopped it when it stopped as it read one.
 */
export function suspectsIn(log: string, ids: ReadonlySet<string>): string[] {
  const lines = log.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith("! "));
  if (start < 0) return [];
  const context: string[] = [];
  for (let at = start; at < lines.length && at < start + 40; at++) {
    const line = lines[at] ?? "";
    context.push(line);
    if (/^l\.\d+/.test(line)) {
      context.push(lines[at + 1] ?? "");
      break;
    }
  }
  const found: string[] = [];
  for (const match of context.join("\n").matchAll(NAMED)) {
    const id = match[1]?.toLowerCase();
    if (id !== undefined && ids.has(id) && !found.includes(id)) found.push(id);
  }
  return found.slice(0, 2);
}

// The compiles.

/**
 * The prelude as the probe appends it to a preamble: `PRELUDE`, with `@` given back the category
 * it had where the preamble ended, since the prelude ends with `\makeatother`, and a preamble may
 * end with `\makeatletter` still in force, which its body then relies on.
 */
export const PROBE_PRELUDE = `\\expandafter\\chardef\\csname rt@probe@at\\endcsname=\\catcode\`\\@\n${PRELUDE}\\catcode\`\\@=\\csname rt@probe@at\\endcsname\n`;

/** The auxiliary files the baseline writes that later compiles read, by extension. */
const AUXILIARY = ["aux", "toc", "lof", "lot", "out", "nav", "snm", "loa"];

/** FNV-1a, 32 bits, over UTF-8: a format's name, not a secret. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text))
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

/** Whether a compile failed as a whole: it stopped, or asked for a pass after its last. */
const failed = (result: CompileResult, maxPasses: number) =>
  !result.ok ||
  result.output === undefined ||
  (result.passes.length >= maxPasses && asksForRerun(result.log));

/**
 * The one function a probe compiles through, whatever the engine: the body, marked, and the
 * preamble's calls issued again, compiled from the document's format or whole from the stock
 * format.
 */
export interface Path {
  kind: "format" | "whole";
  compile(body: string, setters: string, maxPasses: number): CompileResult;
}

/** Everything a compile of the document needs, and what the probe measures of it. */
interface Setup {
  session: EngineSession;
  engine: Engine;
  intake: Intake;
  body: Body;
  job: string;
  files: Record<string, Uint8Array>;
}

/** Text in the encoding of the main file, with its byte-order mark or without. */
function encoded(intake: Intake, text: string, mark: boolean): Uint8Array {
  const bytes = encodeLike(intake.main.bytes, text) ?? new TextEncoder().encode(text);
  const marked = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return marked && !mark ? bytes.subarray(3) : bytes;
}

/**
 * The format path: the preamble with the prelude dumped as `import-` and a hash of what is dumped,
 * and every compile a body compile from it, the preamble's calls issued again before
 * `\begin{document}`; or undefined, with how long the dump took, when the preamble does not dump.
 */
function formatPath(setup: Setup): { path?: Path; name: string; ms: number } {
  const { session, intake, body, job, files } = setup;
  const dumped = `${body.preamble}\n${PROBE_PRELUDE}`;
  const listed = Object.entries(files)
    .map(([path, bytes]) => `${path}:${bytes.length}`)
    .sort()
    .join("\n");
  const name = `import-${fnv1a(`${dumped}\n${listed}`)}`;
  const begin = body.before.slice(body.preamble.length);
  let result: ReturnType<EngineSession["dump"]>;
  try {
    result = session.dump("pdftex", name, encoded(intake, dumped, true), files);
  } catch {
    return { name, ms: 0 };
  }
  if (!result.ok) return { name, ms: result.ms };
  return {
    name,
    ms: result.ms,
    path: {
      kind: "format",
      compile: (text, setters, maxPasses) =>
        session.compile(
          "pdftex",
          name,
          encoded(intake, `${setters}${begin}${text}${body.after}`, false),
          {
            job,
            maxPasses,
            files,
          },
        ),
    },
  };
}

/**
 * The whole path: the document compiled whole from the stock format, as the reference was, on its
 * engine, fontconfig given the tree's fonts on XeTeX, with the prelude and the preamble's calls
 * issued again before `\begin{document}`.
 */
function wholePath(setup: Setup): Path {
  const { session, engine, intake, body, job, files } = setup;
  const begin = body.before.slice(body.preamble.length);
  return {
    kind: "whole",
    compile: (text, setters, maxPasses) =>
      session.compile(
        engine,
        "stock",
        encoded(
          intake,
          `${body.preamble}\n${PROBE_PRELUDE}${setters}${begin}${text}${body.after}`,
          true,
        ),
        { job, maxPasses, files, fontsByName: engine === "xetex" },
      ),
  };
}

// The result.

/** The verdicts of one macro's or environment's argument, or of one kind of standard node. */
export interface Aggregate {
  /** A template macro's argument, a template environment's, or a standard node's kind. */
  of: "call" | "environment" | "standard";
  /** The macro's or environment's name, or the kind: `section`, `item`, `label`, `paragraph`. */
  name: string;
  /** For an argument, its place in the signature, from 1. */
  index?: number;
  /** How many candidates it has in the document. */
  calls: number;
  /**
   * `editable` when every call probed was, those whose argument is empty aside; else the verdict
   * of the first that failed, in the source's order; `untested` when the budget left one. With no
   * call probed but empty ones, `container` when a call holds structure, or else what the empty
   * ones came to, or `raw`.
   */
  verdict: Verdict;
  /** How many of its candidates came to each verdict. */
  counts: Partial<Record<Verdict, number>>;
  /** The verdict of its first empty call that failed where the others passed. */
  empty?: Verdict;
  /** The paragraphs inside its calls that were not probed, and how many of them are editable. */
  parts?: { total: number; editable: number };
}

/** A run of the reference's glyphs no editable field covers, and what sets it, when told. */
export interface UncoveredRun {
  /** Its page, from 0, and its glyphs' places among the page's, from `from` to before `to`. */
  page: number;
  from: number;
  to: number;
  /** Where its first and its last glyph are, in scaled points, as the reference has them. */
  first: { h: number; v: number };
  last: { h: number; v: number };
  /**
   * What sets it: a locked candidate, whose glyphs a compile showed there, or which lies between
   * the fields either side of the run in the source; a raw chunk that lies there; or, with neither,
   * the template's own text, such as a label, a rule's caption or an icon (`chrome`).
   */
  by: "candidate" | "raw" | "chrome";
  candidate?: string;
  raw?: RawChunk;
}

/** What the probe found for a document. */
export interface Probe {
  engine: Engine;
  /** The compiles it made: from the document's format, or whole. */
  path: "format" | "whole";
  /** Why a pdfTeX document took whole compiles: its preamble did not dump, or its format differs. */
  fallback?: "dump" | "baseline";
  /**
   * How the unmarked body compiled from the format first differed from the reference, or that it
   * stopped, for a document that took whole compiles for it.
   */
  formatDifference?: "stopped" | DifferenceKind;
  /** The format's name, and how long its dump took, in milliseconds, when it dumped. */
  format?: string;
  dumpMs?: number;
  /**
   * Why nothing could be probed: the unmarked body stopped, or did not set the reference's glyphs,
   * and how it first differed.
   */
  baseline?: "stopped" | DifferenceKind;
  /** The baseline's passes, in milliseconds. */
  baselineMs: number;
  /** The compiles the candidates took, the budget, and their passes, in milliseconds. */
  compiles: number;
  budget: number;
  compileMs: number;
  /** The whole probe, from its start to its result, in milliseconds. */
  ms: number;
  /** The compiles that asked the engine what the preamble's calls are, when the caller had not. */
  signaturesMs?: number;
  candidates: ProbeCandidate[];
  /** Per macro and argument, and per environment and argument. */
  macros: Aggregate[];
  /** Per kind of standard node: section titles, items, labels, paragraphs. */
  standard: Aggregate[];
  /** The reference's glyphs, and those editable fields cover. */
  glyphs: { reference: number; covered: number };
  uncovered: UncoveredRun[];
}

export interface ProbeOptions extends ReferenceOptions {
  /** How many compiles the candidates may take; PROBE_BUDGET by default. */
  budget?: number;
}

const FAILURES: ReadonlySet<Verdict> = new Set([
  "breaks",
  "vanished",
  "twice",
  "moved",
  "misaligned",
  "case",
  "split",
]);

/**
 * The verdicts gathered per macro and argument, per environment and argument, and per kind of
 * standard node: what item 6 sends and item 7 assembles from. A paragraph inside an argument that
 * was not probed counts among that argument's parts, not as a standard node.
 */
export function aggregate(candidates: readonly ProbeCandidate[]): {
  macros: Aggregate[];
  standard: Aggregate[];
} {
  const byId = new Map(candidates.map((each) => [each.id, each]));
  const groups = new Map<
    string,
    {
      of: Aggregate["of"];
      name: string;
      index?: number;
      members: ProbeCandidate[];
      parts: ProbeCandidate[];
    }
  >();
  const groupOf = (of: Aggregate["of"], name: string, index?: number) => {
    const key = `${of}|${name}|${index ?? ""}`;
    const group = groups.get(key) ?? {
      of,
      name,
      ...(index === undefined ? {} : { index }),
      members: [],
      parts: [],
    };
    groups.set(key, group);
    return group;
  };
  for (const candidate of candidates) {
    const owner = candidate.within === undefined ? undefined : byId.get(candidate.within);
    if (candidate.kind === "paragraph" && owner?.kind === "argument" && owner.of !== undefined)
      groupOf(owner.of, owner.name, owner.index).parts.push(candidate);
    else if (candidate.kind === "argument" && candidate.of !== undefined)
      groupOf(candidate.of, candidate.name, candidate.index).members.push(candidate);
    else groupOf("standard", candidate.kind).members.push(candidate);
  }
  const macros: Aggregate[] = [];
  const standard: Aggregate[] = [];
  for (const group of groups.values()) {
    if (group.members.length === 0) continue;
    const counts: Partial<Record<Verdict, number>> = {};
    for (const each of group.members) counts[each.verdict] = (counts[each.verdict] ?? 0) + 1;
    const full = group.members.filter((each) => !each.empty);
    const empty = group.members.filter((each) => each.empty);
    const first = (list: readonly ProbeCandidate[], test: (verdict: Verdict) => boolean) =>
      list.find((each) => test(each.verdict))?.verdict;
    let verdict: Verdict;
    let emptyVerdict: Verdict | undefined;
    const failure = first(full, (each) => FAILURES.has(each));
    if (failure !== undefined) verdict = failure;
    else if (first(full, (each) => each === "untested") !== undefined) verdict = "untested";
    else if (first(full, (each) => each === "editable") !== undefined) {
      verdict = "editable";
      emptyVerdict = first(empty, (each) => FAILURES.has(each));
    } else if (first(group.members, (each) => each === "container") !== undefined) {
      // A slot for structure, as an entry's argument holding its bullets is, whose empty calls
      // may still have failed, as one whose emptiness the macro tests does.
      verdict = "container";
      emptyVerdict = first(empty, (each) => FAILURES.has(each));
    } else
      verdict =
        first(empty, (each) => FAILURES.has(each)) ??
        first(empty, (each) => each === "untested") ??
        first(empty, (each) => each === "editable") ??
        "raw";
    const result: Aggregate = {
      of: group.of,
      name: group.name,
      ...(group.index === undefined ? {} : { index: group.index }),
      calls: group.members.length,
      verdict,
      counts,
      ...(emptyVerdict === undefined ? {} : { empty: emptyVerdict }),
      ...(group.parts.length === 0
        ? {}
        : {
            parts: {
              total: group.parts.length,
              editable: group.parts.filter((each) => each.verdict === "editable").length,
            },
          }),
    };
    (group.of === "standard" ? standard : macros).push(result);
  }
  return { macros, standard };
}

/**
 * The runs of the reference's glyphs no editable field covers, each set down to what sets it: a
 * locked candidate whose glyphs a compile that set the reference's showed there; otherwise, by the
 * source's order, the first locked candidate that sets text, or else the first raw chunk that may,
 * between the fields either side of the run; otherwise the template's own text. The order of the
 * page and of the source mostly agree, and where they do not, as paracol sets its columns one
 * after the other, a run may be set down to a node near the one that sets it.
 */
export function uncoveredRuns(
  reference: GlyphStream,
  candidates: readonly ProbeCandidate[],
  evidence: ReadonlyMap<string, readonly GlyphPlace[]>,
  raw: readonly RawChunk[],
  length: number,
): { runs: UncoveredRun[]; covered: number } {
  const byId = new Map(candidates.map((each) => [each.id, each]));
  const glyphs = reference.pages.map((page) => page.items.filter((item) => item.kind === "glyph"));
  const owner = glyphs.map((page) => new Array<string | undefined>(page.length).fill(undefined));
  for (const [id, places] of evidence)
    for (const [page, at] of places) {
      const row = owner[page];
      if (row !== undefined && at < row.length && row[at] === undefined) row[at] = id;
    }
  const editable = (id: string | undefined) =>
    id !== undefined && byId.get(id)?.verdict === "editable";
  let covered = 0;
  // Every glyph in turn, across the pages, with the nearest body field before and after it.
  const flat: { page: number; at: number; owner?: string }[] = [];
  owner.forEach((row, page) => {
    row.forEach((id, at) => {
      if (editable(id)) covered++;
      flat.push({ page, at, ...(id === undefined ? {} : { owner: id }) });
    });
  });
  const anchored = (id: string | undefined) => {
    const candidate = id === undefined ? undefined : byId.get(id);
    return candidate?.where === "body" ? candidate : undefined;
  };
  const before: (ProbeCandidate | undefined)[] = [];
  let last: ProbeCandidate | undefined;
  for (const [i, glyph] of flat.entries()) {
    before[i] = last;
    last = anchored(glyph.owner) ?? last;
  }
  const after: (ProbeCandidate | undefined)[] = [];
  let next: ProbeCandidate | undefined;
  for (let i = flat.length - 1; i >= 0; i--) {
    after[i] = next;
    next = anchored(flat[i]?.owner) ?? next;
  }
  const sets = (candidate: ProbeCandidate) =>
    candidate.where === "body" &&
    candidate.verdict !== "editable" &&
    candidate.verdict !== "container" &&
    candidate.verdict !== "vanished" &&
    candidate.verdict !== "raw" &&
    !evidence.has(candidate.id);
  const locked = candidates.filter(sets).sort((a, b) => a.start - b.start);
  const chunks = [...raw].sort((a, b) => a.start - b.start);
  /** The first of spans sorted by their start that lies within `from` and `to`. */
  const within = <T extends { start: number; end: number }>(
    list: readonly T[],
    from: number,
    to: number,
  ) => {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((list[mid] as T).start < from) lo = mid + 1;
      else hi = mid;
    }
    for (let at = lo; at < list.length && (list[at] as T).start <= to; at++)
      if ((list[at] as T).end <= to) return list[at];
    return undefined;
  };
  const runs: UncoveredRun[] = [];
  let i = 0;
  while (i < flat.length) {
    const start = flat[i];
    if (start === undefined || editable(start.owner)) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < flat.length) {
      const each = flat[j];
      if (
        each === undefined ||
        each.page !== start.page ||
        editable(each.owner) ||
        each.owner !== start.owner
      )
        break;
      j++;
    }
    const end = flat[j - 1] ?? start;
    const at = (place: { page: number; at: number }) => {
      const item = glyphs[place.page]?.[place.at];
      return { h: item?.h ?? 0, v: item?.v ?? 0 };
    };
    const run: UncoveredRun = {
      page: start.page,
      from: start.at,
      to: end.at + 1,
      first: at(start),
      last: at(end),
      by: "chrome",
    };
    if (start.owner !== undefined) {
      run.by = "candidate";
      run.candidate = start.owner;
    } else {
      const lo = before[i]?.end ?? 0;
      const hi = after[j - 1]?.start ?? length;
      const [from, to] = lo <= hi ? [lo, hi] : [hi, lo];
      const candidate = within(locked, from, to);
      const chunk = candidate === undefined ? within(chunks, from, to) : undefined;
      if (candidate !== undefined) {
        run.by = "candidate";
        run.candidate = candidate.id;
      } else if (chunk !== undefined) {
        run.by = "raw";
        run.raw = chunk;
      }
    }
    runs.push(run);
    i = j;
  }
  return { runs, covered };
}

/**
 * The commands a body uses and those its preamble calls, which the engine is asked about
 * (`signatures`), so that the probe knows which of the preamble's calls store a header's text.
 */
export function probeUses(read: ReadBody, preamble: ReadBody | undefined): Uses {
  const body = usesOf(read);
  if (preamble === undefined) return body;
  const commands = new Set([...body.commands, ...usesOf(preamble).commands]);
  return { commands: [...commands].sort(), environments: body.environments };
}

/**
 * The preamble's tree and the template macros it calls that store their arguments, from what the
 * engine said of its commands; the engine is asked of those `found` does not hold, which costs its
 * two compiles, unless the caller asked of them too (`probeUses`).
 */
async function preambleOf(
  session: EngineSession,
  intake: Intake,
  made: Reference,
  body: Body,
  found: EngineSignatures,
  options: ReferenceOptions,
): Promise<{ tree?: Tree; setters: Set<string>; ms?: number }> {
  const read = readBody(bodyOfText(body.preamble));
  if ("refused" in read) return { setters: new Set() };
  const asked = usesOf(read).commands.filter((name) => !Object.hasOwn(found.commands, name));
  let signatures = found;
  let ms: number | undefined;
  if (asked.length > 0) {
    const started = performance.now();
    const more = await askSignatures(
      session,
      intake,
      made,
      body,
      { commands: asked, environments: [] },
      options,
    );
    ms = performance.now() - started;
    if (!("refused" in more))
      signatures = {
        ...found,
        commands: { ...found.commands, ...more.commands },
        macros: { ...more.macros, ...found.macros },
      };
  }
  const setters = new Set(
    Object.entries(signatures.commands)
      .filter(
        ([name, signature]) => signature.kind === "template" && isSetter(signatures.macros[name]),
      )
      .map(([name]) => name),
  );
  if (setters.size === 0) return { setters, ...(ms === undefined ? {} : { ms }) };
  const tree = buildTree(read, signatures);
  return { ...("refused" in tree ? {} : { tree }), setters, ...(ms === undefined ? {} : { ms }) };
}

/**
 * Probe a document: which of its body's candidates, and of its preamble's calls that store a
 * header's text, the editor may mark (`Probe`). `tree` is the tree of the intake's body, parsed
 * with `found`, the engine's signatures of it (`signatures`); the reference is the original's, and
 * the job, `import` by default, is forgotten before and after.
 */
export async function probe(
  session: EngineSession,
  fonts: FontLibrary,
  intake: Intake,
  made: Reference,
  tree: Tree,
  found: EngineSignatures,
  options: ProbeOptions = {},
): Promise<Probe> {
  const started = performance.now();
  const job = options.job ?? IMPORT_JOB;
  const budget = options.budget ?? PROBE_BUDGET;
  const body = bodyOf(intake);
  if ("refused" in body || body.text !== tree.source)
    throw new Error("the tree is not of the intake's body");
  const preamble = await preambleOf(session, intake, made, body, found, options);
  const { candidates, setters, raw }: Candidates = candidatesOf(tree, {
    ...(preamble.tree === undefined ? {} : { preamble: preamble.tree }),
    setters: preamble.setters,
  });
  const files: Record<string, Uint8Array> = referenceFiles(intake, made, options);
  const setup: Setup = { session, engine: made.engine, intake, body, job, files };
  const probed = candidates.filter((each) => each.unprobed === undefined);
  const owners = new Map(candidates.map((each) => [each.id, each]));
  const shipped = (path: string) => shippedFont(files, job, path);

  // The baseline: the unmarked body, which must set the reference's glyphs, on the format path
  // where the engine is pdfTeX and the preamble dumps, and the whole path otherwise.
  const unmarked = tree.source;
  let fallback: Probe["fallback"];
  let formatDifference: Probe["formatDifference"];
  let format: { name: string; ms: number } | undefined;
  let path: Path | undefined;
  let baselineMs = 0;
  let baseline: Probe["baseline"];
  const tryBaseline = async (candidate: Path): Promise<Probe["baseline"]> => {
    session.forget(job);
    let result: CompileResult;
    try {
      result = candidate.compile(unmarked, "", 3);
    } catch {
      return "stopped";
    }
    baselineMs += result.passes.reduce((sum, pass) => sum + pass, 0);
    if (failed(result, 3) || result.output === undefined) return "stopped";
    const { stream } = await readOutput(fonts, result.output, shipped);
    return difference(made, stream)?.kind;
  };
  if (made.engine === "pdftex") {
    const dumped = formatPath(setup);
    format = { name: dumped.name, ms: dumped.ms };
    if (dumped.path === undefined) fallback = "dump";
    else {
      const differs = await tryBaseline(dumped.path);
      if (differs === undefined) path = dumped.path;
      else {
        fallback = "baseline";
        formatDifference = differs;
      }
    }
  }
  if (path === undefined) {
    const whole = wholePath(setup);
    baseline = await tryBaseline(whole);
    path = whole;
  }
  // Every probe compile starts from the auxiliary files the baseline wrote.
  for (const extension of AUXILIARY) {
    const name = `${job}.${extension}`;
    const bytes = session.written(job, name);
    if (bytes !== undefined) files[name] = bytes;
  }

  let compileMs = 0;
  const route = path;
  const compileSet: CompileSet = async (set) => {
    const text = marked(
      tree.source,
      set.filter((each) => each.where === "body"),
    );
    const calls = reissued(body.preamble, setters, set);
    let result: CompileResult;
    try {
      result = route.compile(text, calls, PROBE_PASSES);
    } catch {
      return { broke: true, same: false, torn: false, own: new Map() };
    }
    compileMs += result.passes.reduce((sum, pass) => sum + pass, 0);
    if (failed(result, PROBE_PASSES) || result.output === undefined)
      return {
        broke: true,
        same: false,
        torn: false,
        own: new Map(),
        suspects: suspectsIn(result.log, new Set(set.map((each) => each.id))),
      };
    try {
      return await observe(fonts, made, result.output, set, shipped);
    } catch {
      // Output the page cannot read is no output the editor can mark.
      return { broke: true, same: false, torn: false, own: new Map() };
    }
  };

  const settlement =
    baseline === undefined
      ? await settle(probeOrder(probed, owners), compileSet, budget, owners)
      : { verdicts: new Map(), evidence: new Map<string, GlyphPlace[]>(), compiles: 0 };
  session.forget(job);

  const results: ProbeCandidate[] = candidates.map((candidate) => {
    if (candidate.unprobed !== undefined)
      return { ...candidate, verdict: candidate.unprobed, settled: "unprobed" };
    const decided = settlement.verdicts.get(candidate.id) ?? {
      verdict: "untested" as const,
      settled: "budget" as const,
    };
    return { ...candidate, ...decided };
  });
  const { macros, standard } = aggregate(results);
  const { runs, covered } = uncoveredRuns(
    made,
    results,
    settlement.evidence,
    raw,
    tree.source.length,
  );
  return {
    engine: made.engine,
    path: path.kind,
    ...(fallback === undefined ? {} : { fallback }),
    ...(formatDifference === undefined ? {} : { formatDifference }),
    ...(format === undefined ? {} : { dumpMs: format.ms }),
    ...(format === undefined || fallback === "dump" ? {} : { format: format.name }),
    ...(baseline === undefined ? {} : { baseline }),
    baselineMs,
    compiles: settlement.compiles,
    budget,
    compileMs,
    ms: performance.now() - started,
    ...(preamble.ms === undefined ? {} : { signaturesMs: preamble.ms }),
    candidates: results,
    macros,
    standard,
    glyphs: {
      reference: made.pages.reduce(
        (sum, page) => sum + page.items.filter((item) => item.kind === "glyph").length,
        0,
      ),
      covered,
    },
    uncovered: runs,
  };
}
