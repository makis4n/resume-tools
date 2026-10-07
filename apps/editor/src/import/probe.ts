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
 * so the import rewrites its fonts to files first (decision 0023, the second pass's item 5) and
 * gives the probe the families' declarations (`ProbeOptions.declarations`): the rewritten preamble
 * is dumped with them after it, as `generateFormat` dumps a XeTeX package's, and the probe compiles
 * from that format as it does on pdfTeX. A XeTeX document probed without them, or a preamble that
 * does not dump, or whose format does not set the reference's glyphs, compiles whole from the stock
 * format, as the reference was, fontconfig given the tree's fonts, with the prelude before
 * `\begin{document}`. `Path` hides the difference, and the result says which
 * a document took. Either way the unmarked body compiles first, the baseline, which must set the
 * reference's glyphs, and whose auxiliary files every probe compile starts from, so that no compile
 * reads what another's markers wrote. A probe compile takes two passes at most, the second when
 * its first changed a file it read, as a table of contents that sets a marked title does, which
 * LaTeX's log never asks a pass for; one that stops, or whose log still asks for a pass after
 * them, is a failure of the whole set.
 *
 * All the candidates are wrapped at once, first. What a candidate's own markers and glyphs show is
 * its own; a set whose compile stops, or whose output moves with no candidate's markers to say
 * why, is split until a single candidate fails alone (`settle`); and every editable candidate is
 * then compiled together, as item 7 marks them, and one that fails beside the others is locked. A
 * document has a budget of 64 compiles, spent on the kinds that hold the most words first
 * (`probeOrder`), after which what is left is `untested`. The verdicts are
 * gathered per macro and argument, per environment and argument, and per kind of standard node
 * (`aggregate`), which is what item 6 describes and item 7 assembles from. The glyphs of the
 * reference no editable field covers are the uncovered runs, each set down, by where in the source
 * it comes from, to the locked candidate or the raw chunk that sets it, or to the template's own
 * text (`uncoveredRuns`).
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
import { dumpFiles } from "./xetex-check";

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
 * or do only once the glyphs and the text are both folded whole to small letters (`case`); it
 * begins on one page and ends on another, or never ends (`split`); or the budget ran out before it
 * was settled (`untested`).
 *
 * The aligner folds a text's case itself, once for each glyph and only where the fold changes a
 * character the glyph spells (decision 0021), so a field set through `\MakeUppercase` is editable.
 * `case` is a field that fold cannot match and folding the whole field to small letters can: a
 * mapping other than Unicode's default ones, as German's `de-x-eszett` capitals set ß as ẞ, which
 * is ß in small letters, where the aligner takes ß's capitals for SS.
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
 * its kind that failed as that one did (`like`); in the check of every editable candidate
 * together, as the one whose markers, added to others that passed, failed the compile (`union`);
 * without a compile, since the candidate holds a raw chunk or structure (`unprobed`); or not, the
 * budget spent (`budget`).
 */
export type Settled = "together" | "alone" | "like" | "union" | "unprobed" | "budget";

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
  /**
   * Its output sets the reference's glyphs, page by page, in the same order, wherever it places
   * them, as when a move shifts them and nothing is added or left out: its candidates' glyphs are
   * then at the places among the reference's that the output has them at (`uncoveredRuns`).
   */
  order?: boolean;
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
  /**
   * The glyphs of each candidate that came in a compile whose output set the reference's, or set
   * them in the same order elsewhere (`SetResult.order`), as places among the reference's.
   */
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

/** A text's words, as the report counts them: runs of letters and digits. */
const wordCount = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;

/** The words of a set of candidates' texts. */
const wordsIn = (set: readonly Candidate[]) =>
  set.reduce((sum, each) => sum + wordCount(each.text), 0);

/**
 * The verdict of each candidate, from compiles of sets of them (`compile`), within `budget`
 * compiles. The candidates come in the order their sets are split along: kinds together, each
 * kind's in the order of the source (`probeOrder`), the probe's kinds that hold the most words
 * first.
 *
 * A set is compiled whole. What a candidate's own markers and glyphs show is its own, whatever
 * else the set holds (`Own`): markers that never came, came twice, or went into a special, a
 * field split across pages, glyphs that do not spell its text, or glyphs the page cannot place.
 * Only a failure of the set as a whole needs splitting: a compile that stops, or an output that
 * does not set the reference's glyphs when no candidate's own markers say why. Such a set is split
 * until a single candidate fails alone (`breaks`, `moved`), the candidates the compile names first
 * (`SetResult.suspects`), each tried alone, and then the rest without them; otherwise in two, at
 * the edge between kinds nearest its middle when there is one near it. When every named one
 * passes alone, the names were a wrong guess, and the rest, if it fails too, is halved whatever its
 * compile names; each half's compile is trusted again. When the output sets the reference's glyphs,
 * every candidate whose markers passed is editable. When it does not, those are tried again
 * without the ones that failed, and so are the ones whose markers the move may
 * have cost them (`unclear`): markers that never came, came on two pages, or came twice on the
 * page, as a field a move pushed across a page's end straddles it. Markers taken apart, whose ids
 * the set does not hold, leave a candidate whose markers never came to be tried alone, where a
 * torn marker is its own (`misaligned`). Once one of a kind has failed alone, the others of its
 * kind are tried among themselves, apart from the rest: a set of a kind one of which stopped a
 * compile alone takes that verdict whole when it stops one too (`like`), since an argument that
 * stops TeX, a length or a key, stops it whatever it holds; one that moved the page is split
 * still, since what moves it may be what one call holds and another does not.
 *
 * Then every editable candidate is compiled together, as item 7 marks them (`union`), which two
 * of them may fail that passed apart; the bisection leaves the budget's last compile to it when
 * there are editable candidates no compile has passed together. What the budget leaves is
 * `untested`.
 *
 * The kinds held apart are tried before the rest of the set. With `wordsFirst`, as the probe
 * settles (decision 0069), the rest's first compile comes before them when the rest holds more
 * words than each, and a kind held apart whose candidates hold no word waits for the rest, since
 * the budget it would take one candidate at a time wins no word back. For candidates in the same
 * order, the same sets are compiled either way when the budget does not run out, so the verdicts
 * are the same: this rule decides only what the budget leaves.
 */
export async function settle(
  candidates: readonly Candidate[],
  compile: CompileSet,
  budget: number,
  owners: ReadonlyMap<string, Candidate> = new Map(candidates.map((each) => [each.id, each])),
  wordsFirst = false,
): Promise<Settlement> {
  const verdicts: Settlement["verdicts"] = new Map();
  const evidence = new Map<string, GlyphPlace[]>();
  const failing = new Map<string, Failure>();
  const kinds = new Map(candidates.map((each) => [each.id, kindOf(each, owners)]));
  const kind = (candidate: Candidate) => kinds.get(candidate.id) ?? candidate.id;
  /** The sets whose compile passed, each of its candidates' markers with it, by their ids. */
  const passing = new Map<string, readonly Candidate[]>();
  /**
   * The sets, by their ids, that are what is left of a set once every candidate its compile named
   * passed alone: such a set that fails is halved, whatever its compile names (decision 0069).
   */
  const blind = new Set<string>();
  const keyOf = (set: readonly Candidate[]) =>
    set
      .map((each) => each.id)
      .sort()
      .join(" ");
  let compiles = 0;

  const open = (set: readonly Candidate[]) => set.filter((each) => !verdicts.has(each.id));
  const decide = (candidate: Candidate, verdict: Verdict, settled: Settled, detail?: string) => {
    if (verdicts.has(candidate.id)) return;
    verdicts.set(candidate.id, { verdict, settled, ...(detail === undefined ? {} : { detail }) });
    if (settled === "alone" && (verdict === "breaks" || verdict === "moved"))
      failing.set(kind(candidate), verdict);
  };
  /** Whether a compile passed: it did not stop, it set the reference's glyphs, and every marker. */
  const passes = (result: SetResult, set: readonly Candidate[]) =>
    !result.broke && result.same && set.every((each) => result.own.get(each.id)?.ok === true);
  /** The candidates decided editable so far, when no compile of just them has passed. */
  const unchecked = () => {
    const editable = candidates.filter((each) => verdicts.get(each.id)?.verdict === "editable");
    return editable.length > 0 && !passing.has(keyOf(editable));
  };
  /**
   * A compile of a set, which keeps the glyphs of each candidate in it as evidence when its output
   * set the reference's glyphs, or set them in the same order, and notes a set that passed.
   */
  const compileOf = async (set: readonly Candidate[]): Promise<SetResult> => {
    compiles++;
    const result = await compile(set);
    if (!result.broke && (result.same || result.order === true))
      for (const candidate of set) {
        const glyphs = result.own.get(candidate.id)?.glyphs;
        if (glyphs !== undefined && !evidence.has(candidate.id)) evidence.set(candidate.id, glyphs);
      }
    if (passes(result, set)) passing.set(keyOf(set), set);
    return result;
  };
  /** A compile of the bisection's, which leaves the budget's last to the union when it has work. */
  const run = async (set: readonly Candidate[]): Promise<SetResult | undefined> => {
    if (compiles >= budget || (compiles === budget - 1 && unchecked())) {
      for (const candidate of set) decide(candidate, "untested", "budget");
      return undefined;
    }
    return compileOf(set);
  };
  /**
   * Whether what a candidate's own markers showed may be another's doing: markers that never came,
   * beside markers torn apart or in an output that moved; or markers on two pages, or twice on the
   * page, in an output that moved, which may have pushed its field across a page's end or brought
   * a running head's copy of it onto the page.
   */
  const unclear = (result: SetResult, candidate: Candidate) => {
    const own = result.own.get(candidate.id);
    if (own === undefined || own.ok) return false;
    if (own.reason === "vanished") return result.torn || !result.same;
    const moved = own.reason === "split" || (own.reason === "twice" && own.detail === "page");
    return moved && !result.same;
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
   * rest without them; or, when it names none of them, or all, or it is what was left of a set
   * whose compile named wrongly, in two. When every named one passes alone the names were wrong,
   * and the rest, if it fails as it was left, is halved, not tried without its own names: where
   * each next name is wrong too, trusting them takes a compile a name and one for the rest at each
   * step, and halving a level takes as many compiles as there were names, and three. A rest the
   * quarantine trims first is no longer the set left, and is tried by its names again.
   */
  const split = async (set: readonly Candidate[], result: SetResult, quarantine: boolean) => {
    const named = blind.has(keyOf(set))
      ? []
      : set.filter((each) => result.suspects?.includes(each.id));
    if (named.length > 0 && named.length < set.length) {
      for (const each of named) await test([each], quarantine);
      const rest = set.filter((each) => !named.includes(each));
      if (named.every((each) => verdicts.get(each.id)?.verdict === "editable"))
        blind.add(keyOf(rest));
      await test(rest, quarantine);
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
      if (wordsFirst) return apart(set, held);
      for (const group of byKind(held)) await testKind(group);
      set = open(set);
    }
    if (set.length === 0) return;
    const result = await run(set);
    if (result !== undefined) await judge(set, result);
  };

  /** What a compile of a set shows of its candidates, and the compiles it then takes. */
  const judge = async (set: readonly Candidate[], result: SetResult): Promise<void> => {
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
    for (const each of set) {
      const own = result.own.get(each.id);
      if (own === undefined || own.ok || unclear(result, each)) continue;
      decide(each, own.reason ?? "vanished", "together", own.detail);
    }
    const doubtful = set.filter((each) => unclear(result, each));
    if (result.same) {
      for (const each of passed) decide(each, "editable", "together");
      for (const each of doubtful) await test([each]);
      return;
    }
    const again = [...passed, ...doubtful];
    if (again.length < set.length) await test(again);
    else await split(set, result, true);
  };

  /**
   * A set some of whose kinds are held apart, with `wordsFirst`. The rest's first compile comes
   * first when the rest holds more words than each kind held apart, since a rest that passes is
   * settled by it whatever the budget leaves; then each kind held apart that holds a word, tried
   * among themselves; then what the rest's compile showed, and the compiles it takes; then the
   * kinds held apart that hold no word. The compiles are the ones the kinds held apart first would
   * take, in another order.
   */
  const apart = async (set: readonly Candidate[], held: readonly Candidate[]) => {
    const rest = set.filter((each) => !held.includes(each));
    const groups = byKind(held);
    const empty = groups.filter((group) => wordsIn(group) === 0);
    const full = groups.filter((group) => !empty.includes(group));
    const ahead = rest.length > 0 && full.every((group) => wordsIn(rest) > wordsIn(group));
    const first = ahead ? await run(rest) : undefined;
    for (const group of full) await testKind(group);
    if (!ahead) await test(rest);
    else if (first !== undefined) await judge(rest, first);
    for (const group of empty) await testKind(group);
    const left = open(set);
    if (left.length > 0 && left.length < set.length) await test(left);
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
      if (own !== undefined && !own.ok && !unclear(result, each))
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

  /** Candidates as the budget leaves them: those of the largest set known to pass stay editable. */
  const leave = (set: readonly Candidate[]) => {
    const ids = new Set(set.map((each) => each.id));
    let kept: readonly Candidate[] = [];
    for (const known of passing.values())
      if (known.length > kept.length && known.every((each) => ids.has(each.id))) kept = known;
    for (const each of set)
      if (!kept.includes(each)) verdicts.set(each.id, { verdict: "untested", settled: "budget" });
  };
  /** A compile of a set in the union's check, which may spend the whole budget. */
  const check = (set: readonly Candidate[]) =>
    compiles >= budget ? Promise.resolve(undefined) : compileOf(set);
  /**
   * Every editable candidate together, as item 7 marks them, in one compile, unless a set the
   * bisection compiled was just them and passed. Two may fail together that passed apart, as two
   * whose markers each take a little from one line. Then the shortest run of them, in their order,
   * that fails is found by halving, knowing that none of them passes, and its last one is locked
   * (`union`): its verdict alone in that compile, or `breaks` or `moved` when the compile shows no
   * other; and so again, until those left pass together. When the budget runs out first, the
   * largest set of them known to pass stays editable, and the rest are `untested`.
   */
  const union = async () => {
    let set = candidates.filter((each) => verdicts.get(each.id)?.verdict === "editable");
    // How many of `set`, from its start, are known to pass together.
    let known = 0;
    for (;;) {
      if (set.length === 0 || passing.has(keyOf(set))) return;
      const whole = await check(set);
      if (whole === undefined) return leave(set);
      if (passes(whole, set)) return;
      let lo = known;
      let hi = set.length;
      let failed = whole;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        const prefix = set.slice(0, mid);
        if (passing.has(keyOf(prefix))) {
          lo = mid;
          continue;
        }
        const result = await check(prefix);
        if (result === undefined) return leave(set);
        if (passes(result, prefix)) lo = mid;
        else {
          hi = mid;
          failed = result;
        }
      }
      const culprit = set[hi - 1] as Candidate;
      const found = alone(failed, culprit);
      const locked =
        found.verdict === "editable"
          ? {
              verdict: "moved" as const,
              ...(failed.difference ? { detail: failed.difference } : {}),
            }
          : found;
      verdicts.set(culprit.id, { ...locked, settled: "union" });
      set = set.filter((each) => each !== culprit);
      known = hi - 1;
    }
  };

  await test(candidates);
  await union();
  for (const candidate of candidates) decide(candidate, "untested", "budget");
  return { verdicts, evidence, compiles };
}

/**
 * The order `settle` splits candidates along: kinds together, in the order each kind first comes
 * in the source, and each kind's candidates in the source's order, the body's before the
 * preamble's calls. With `wordsFirst`, as the probe takes them (decision 0069), the kinds whose
 * candidates' text holds the most words come first, kinds of as many words in the order each first
 * came: the bisection tries its first half before its second, so what the budget leaves
 * `untested` is the last kinds, the ones with the fewest words. The order is a heuristic: a first
 * half that fails can take a compile a later candidate would have passed with. And it changes more
 * than what the budget leaves: the union locks the later of two that fail together, so with the
 * words first it tends to keep the one with more words. The checks' bisections take the words
 * first too (decision 0075, the checks' budgets).
 */
export function probeOrder(
  candidates: readonly Candidate[],
  owners: ReadonlyMap<string, Candidate> = new Map(candidates.map((each) => [each.id, each])),
  wordsFirst = false,
): Candidate[] {
  const kinds = new Map<string, { words: number; first: number; members: Candidate[] }>();
  for (const candidate of candidates) {
    const name = kindOf(candidate, owners);
    const group = kinds.get(name) ?? { words: 0, first: kinds.size, members: [] };
    group.members.push(candidate);
    group.words += wordCount(candidate.text);
    kinds.set(name, group);
  }
  const groups = [...kinds.values()];
  if (wordsFirst) groups.sort((a, b) => b.words - a.words || a.first - b.first);
  return groups.flatMap((group) => group.members);
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
 * Whether two glyph streams set the same glyphs, page by page, in the same order, wherever they
 * place them: the same font, face, size and code, one for one.
 */
export function sameOrder(a: GlyphStream, b: GlyphStream): boolean {
  if (a.pages.length !== b.pages.length) return false;
  const glyphsOf = (page: GlyphStream["pages"][number] | undefined) =>
    (page?.items ?? []).flatMap((item) => (item.kind === "glyph" ? [item] : []));
  return a.pages.every((page, p) => {
    const ours = glyphsOf(page);
    const theirs = glyphsOf(b.pages[p]);
    return (
      ours.length === theirs.length &&
      ours.every((x, i) => {
        const y = theirs[i];
        return (
          y !== undefined &&
          x.font === y.font &&
          x.native === y.native &&
          x.index === y.index &&
          x.size === y.size &&
          x.code === y.code
        );
      })
    );
  });
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
    order: differs === undefined || sameOrder(reference, stream),
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
export const AUXILIARY = ["aux", "toc", "lof", "lot", "out", "nav", "snm", "loa"];

/** FNV-1a, 32 bits, over UTF-8: a format's name, not a secret. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text))
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

/** Whether a compile failed as a whole: it stopped, or asked for a pass after its last. */
export const failed = (result: CompileResult, maxPasses: number) =>
  !result.ok ||
  result.output === undefined ||
  (result.passes.length >= maxPasses && asksForRerun(result.log));

/**
 * The one function a probe compiles through, whatever the engine: the body, marked, and the
 * preamble's calls issued again, compiled from the document's format or whole from the stock
 * format, in `maxPasses` at most; with `settled`, a pass that changed a file of the job's folder
 * is followed by another (`CompileOptions.rerunOnChange`), as a probe compile's are.
 */
export interface Path {
  kind: "format" | "whole";
  compile(body: string, setters: string, maxPasses: number, settled?: boolean): CompileResult;
}

/** Everything a compile of the document needs, and what the probe measures of it. */
export interface Setup {
  session: EngineSession;
  engine: Engine;
  intake: Intake;
  body: Body;
  job: string;
  files: Record<string, Uint8Array>;
  /**
   * What goes right after the preamble, before the prelude: a XeTeX rewrite's font declarations
   * (`ProbeOptions.declarations`), with a line's end after them; nothing otherwise.
   */
  declarations?: string;
}

/** Text in the encoding of the main file, with its byte-order mark or without. */
function encoded(intake: Intake, text: string, mark: boolean): Uint8Array {
  const bytes = encodeLike(intake.main.bytes, text) ?? new TextEncoder().encode(text);
  const marked = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return marked && !mark ? bytes.subarray(3) : bytes;
}

/**
 * The document's format: the preamble with the prelude, dumped as `import-` and a hash of what is
 * dumped and of the job's files, and how long the dump took; not `ok` when the preamble does not
 * dump.
 */
function dumpFormat(setup: Setup): { name: string; ms: number; ok: boolean } {
  const { session, engine, intake, body, files } = setup;
  const dumped = `${body.preamble}\n${setup.declarations ?? ""}${PROBE_PRELUDE}`;
  const listed = Object.entries(files)
    .map(([path, bytes]) => `${path}:${bytes.length}`)
    .sort()
    .join("\n");
  const name = `import-${fnv1a(`${dumped}\n${listed}`)}`;
  try {
    // A XeTeX dump takes the job's text files alone, as the rewrite's check dumps its format.
    const given = engine === "xetex" ? dumpFiles(files) : files;
    const result = session.dump(engine, name, encoded(intake, dumped, true), given);
    return { name, ms: result.ms, ok: result.ok };
  } catch {
    return { name, ms: 0, ok: false };
  }
}

/**
 * The format path: every compile a body compile from the document's format, `name`, on its engine,
 * the preamble's calls issued again before `\begin{document}`.
 */
export function formatPath(setup: Setup, name: string): Path {
  const { session, engine, intake, body, job, files } = setup;
  const begin = body.before.slice(body.preamble.length);
  return {
    kind: "format",
    compile: (text, setters, maxPasses, settled = false) =>
      session.compile(
        engine,
        name,
        encoded(intake, `${setters}${begin}${text}${body.after}`, false),
        { job, maxPasses, files, ...(settled ? { rerunOnChange: true } : {}) },
      ),
  };
}

/**
 * The whole path: the document compiled whole from the stock format, as the reference was, on its
 * engine, fontconfig given the tree's fonts on XeTeX, with the declarations, the prelude and the
 * preamble's calls issued again before `\begin{document}`.
 */
export function wholePath(setup: Setup): Path {
  const { session, engine, intake, body, job, files } = setup;
  const begin = body.before.slice(body.preamble.length);
  const declarations = setup.declarations ?? "";
  return {
    kind: "whole",
    compile: (text, setters, maxPasses, settled = false) =>
      session.compile(
        engine,
        "stock",
        encoded(
          intake,
          `${body.preamble}\n${declarations}${PROBE_PRELUDE}${setters}${begin}${text}${body.after}`,
          true,
        ),
        {
          job,
          maxPasses,
          files,
          fontsByName: engine === "xetex",
          ...(settled ? { rerunOnChange: true } : {}),
        },
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
   * What sets it, by where in the source it comes from (`uncoveredRuns`): a locked candidate,
   * whose glyphs a compile showed there, in whose source the run's lies, or in whose source the
   * run's is, the header's among them; a raw chunk likewise; or, with neither, the template's own
   * text, such as a label, a separator or an icon (`chrome`).
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
  /**
   * The format's name, when it dumped, on the document's engine, which the probe leaves in the
   * session and its caller drops (`EngineSession.dropFormat`); and how long the dump took, in
   * milliseconds.
   */
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
  /**
   * How many passes the candidates' compiles took in all: one each, and a second where the first
   * changed an auxiliary file it read, as a table of contents that sets a marked title.
   */
  passes: number;
  /** The whole probe, from its start to its result, in milliseconds. */
  ms: number;
  /** The compiles that asked the engine what the preamble's calls are, when the caller had not. */
  signaturesMs?: number;
  /**
   * The engine's signatures the probe read the preamble with: the caller's, and what the engine
   * said of the preamble's commands the caller did not ask of, so that every macro the probe
   * reports, a header's among them, has its meaning and hash for item 6.
   */
  signatures: EngineSignatures;
  candidates: ProbeCandidate[];
  /** Per macro and argument, and per environment and argument. */
  macros: Aggregate[];
  /** Per kind of standard node: section titles, items, labels, paragraphs. */
  standard: Aggregate[];
  /** The reference's glyphs, and those editable fields cover. */
  glyphs: { reference: number; covered: number };
  uncovered: UncoveredRun[];
  /**
   * Every run of the reference's glyphs and what sets it, as `uncovered` has those no editable
   * field covers, and those it does, each run of them its editable candidate's: what the assembly
   * reads, to say which field or locked part of the document sets each glyph, for item 13's report
   * (decision 0039). Absent from a probe made before it.
   */
  runs?: UncoveredRun[];
}

export interface ProbeOptions extends ReferenceOptions {
  /** How many compiles the candidates may take; PROBE_BUDGET by default. */
  budget?: number;
  /**
   * For a XeTeX document whose fonts the import rewrote to files (decision 0023): the families'
   * declarations (`fontDeclarations`), which go after its preamble, so that the preamble dumps as
   * a format and every probe compile is a body compile from it, as on pdfTeX. Without them, a
   * XeTeX document compiles whole.
   */
  declarations?: string;
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
/** The body's source and the preamble's, which candidates' and raw chunks' spans are in. */
export interface Sources {
  body: string;
  preamble: string;
}

/** What sets glyphs no editable field covers (`UncoveredRun`). */
type Setter =
  | { by: "candidate"; candidate: string }
  | { by: "raw"; raw: RawChunk }
  | { by: "chrome" };

/** What may set glyphs, and where it is in its source. */
interface Placed {
  where: Candidate["where"];
  start: number;
  end: number;
  setter: Setter;
}

const CHROME: Setter = { by: "chrome" };

/** How far past the last piece found a piece of a character or two may be found, in characters. */
const NEAR = 3;

/** Whether two setters are one. */
const sameSetter = (a: Setter | undefined, b: Setter | undefined) =>
  a !== undefined &&
  b !== undefined &&
  a.by === b.by &&
  (a.by !== "candidate" || (b.by === "candidate" && a.candidate === b.candidate)) &&
  (a.by !== "raw" || (b.by === "raw" && a.raw === b.raw));

/** The one of `spans` that holds all of `lo` to `hi` and is the shortest, if any does. */
function innermost<T extends { start: number; end: number }>(
  spans: readonly T[],
  lo: number,
  hi: number,
): T | undefined {
  let best: T | undefined;
  for (const each of spans)
    if (
      each.start <= lo &&
      hi <= each.end &&
      (best === undefined || each.end - each.start < best.end - best.start)
    )
      best = each;
  return best;
}

/**
 * A text as the uncovered runs compare a page's glyphs with the source: without accents, spaces,
 * hyphens and dashes, in lower case, and every quote as one of two, since TeX sets `--` as one
 * glyph, a line's end may add a hyphen, and a class may set a text in capitals.
 */
export function comparable(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[^\p{L}\p{N}\p{P}\p{S}]|[-‐-―−]/gu, "");
}

/**
 * What a span of LaTeX source may set, roughly, in pieces: the runs of its characters between its
 * commands, its braces, the signs of mathematics and of alignments, and its comments, an escaped
 * character as itself, and TeX's quotes as they set. A piece an argument sets nothing of, a
 * length, a key or an address, is then one the page lacks, and leaves the others to be found.
 */
export function piecesOf(source: string, start: number, end: number): string[] {
  const pieces: string[] = [];
  let piece = "";
  const cut = () => {
    if (piece !== "") pieces.push(piece.replace(/``/g, "“").replace(/''/g, "”"));
    piece = "";
  };
  for (let at = start; at < end; at++) {
    const char = source[at] ?? "";
    if (char === "%") {
      cut();
      const newline = source.indexOf("\n", at);
      at = newline < 0 || newline >= end ? end : newline;
    } else if (char === "\\") {
      const next = source[at + 1] ?? "";
      if (next !== "" && "%&$#_{}".includes(next)) piece += next;
      else cut();
      if (/[A-Za-z@]/.test(next))
        while (at + 1 < end && /[A-Za-z@]/.test(source[at + 1] ?? "")) at++;
      else at++;
    } else if ("{}$&^_~".includes(char)) cut();
    else piece += char;
  }
  cut();
  return pieces;
}

/**
 * The runs of the reference's glyphs no editable field covers, each set down to what sets it, by
 * where in the source it comes from.
 *
 * A glyph a compile showed a candidate setting, in an output that set the reference's glyphs, or
 * set them in the same order elsewhere (`evidence`), is that candidate's. The others come in
 * stretches between such glyphs, and a stretch comes from the source between the candidates
 * either side of it: from the end of the one before to the start of the one after, or the
 * source's start or end where there is none, in the body's source, or in the preamble's, whose
 * calls store the header's text; beside both, from each. A stretch whose source lies in a raw
 * chunk is the chunk's, as a separator between two parts of one is; one whose source lies in a
 * locked candidate, between two parts of it, is that candidate's. In any other, what overlaps its
 * source and may set glyphs no compile placed, a locked candidate none placed, as one that stops
 * TeX, and in the body a raw chunk, is found by the pieces of text its part of the source sets,
 * among the stretch's glyphs' texts, in the order of the source (`comparable`, `piecesOf`), and
 * holds what lies between the first and the last it finds; then, for what none of them set, the
 * other arguments of the calls either side, since a macro may set its arguments in another order
 * than it takes them; and every part again by its words alone, among the glyphs still unclaimed, as
 * a macro that parses a list of `value/label` pairs sets each label alone (item 13's review). What
 * none of these sets is the template's own text, as a label, a separator or an icon (`chrome`). A
 * stretch
 * whose glyphs the page names none of, as a font with no outlines has them, is shared among what
 * overlaps its source in proportion to how much of the source each is. A run ends where what sets
 * it changes, and at a page's end. Beside them come every run of the reference's glyphs, those
 * editable fields cover among them, each its candidate's (`all`), which item 13's report reads.
 */
export function uncoveredRuns(
  reference: GlyphStream,
  candidates: readonly ProbeCandidate[],
  evidence: ReadonlyMap<string, readonly GlyphPlace[]>,
  raw: readonly RawChunk[],
  sources: Sources,
): { runs: UncoveredRun[]; covered: number; all: UncoveredRun[] } {
  const byId = new Map(candidates.map((each) => [each.id, each]));
  const glyphs = reference.pages.map((page) =>
    page.items.flatMap((item) => (item.kind === "glyph" ? [item] : [])),
  );
  const owner = glyphs.map((page) => new Array<string | undefined>(page.length).fill(undefined));
  for (const [id, places] of evidence)
    for (const [page, at] of places) {
      const row = owner[page];
      if (row !== undefined && at < row.length && row[at] === undefined) row[at] = id;
    }
  const editable = (candidate: ProbeCandidate | undefined) => candidate?.verdict === "editable";
  let covered = 0;
  // Every glyph in turn, across the pages, with the candidate a compile showed setting it.
  const flat: { page: number; at: number; text?: string; owner?: ProbeCandidate }[] = [];
  owner.forEach((row, page) => {
    row.forEach((id, at) => {
      const found = id === undefined ? undefined : byId.get(id);
      if (editable(found)) covered++;
      const text = glyphs[page]?.[at]?.text;
      flat.push({
        page,
        at,
        ...(text === undefined ? {} : { text }),
        ...(found === undefined ? {} : { owner: found }),
      });
    });
  });

  const locked = (candidate: ProbeCandidate) =>
    candidate.verdict !== "editable" && candidate.verdict !== "container";
  const ofCandidate = (each: ProbeCandidate): Placed => ({
    where: each.where,
    start: each.start,
    end: each.end,
    setter: { by: "candidate", candidate: each.id },
  });
  const bySource = (a: Placed, b: Placed) => a.start - b.start || b.end - a.end;
  // What may set glyphs no compile placed: a locked candidate none did, but one whose markers
  // never came, which sets nothing, and one that holds a raw chunk sets what the chunk inside it
  // does; and the body's raw chunks.
  const unplaced = (where: Candidate["where"]) =>
    candidates
      .filter(
        (each) =>
          each.where === where &&
          locked(each) &&
          each.verdict !== "vanished" &&
          !evidence.has(each.id),
      )
      .map(ofCandidate);
  const setters = {
    body: [
      ...unplaced("body"),
      ...raw.map(
        (chunk): Placed => ({
          where: "body",
          start: chunk.start,
          end: chunk.end,
          setter: { by: "raw", raw: chunk },
        }),
      ),
    ].sort(bySource),
    preamble: unplaced("preamble").sort(bySource),
  };
  const enclosing = {
    body: candidates.filter((each) => each.where === "body" && locked(each)),
    preamble: candidates.filter((each) => each.where === "preamble" && locked(each)),
  };
  /** What overlaps `lo` to `hi` of a source and may set glyphs, the outermost, with its part. */
  const partsIn = (where: Candidate["where"], lo: number, hi: number) => {
    const found: { placed: Placed; lo: number; hi: number }[] = [];
    for (const placed of setters[where]) {
      if (placed.end <= lo || placed.start >= hi) continue;
      const last = found.at(-1)?.placed;
      if (last !== undefined && placed.start >= last.start && placed.end <= last.end) continue;
      found.push({ placed, lo: Math.max(lo, placed.start), hi: Math.min(hi, placed.end) });
    }
    return found;
  };
  /** The call a candidate is an argument of, or a part of an argument of, by its id. */
  const callOf = (candidate: ProbeCandidate | undefined): string | undefined => {
    if (candidate === undefined) return undefined;
    if (candidate.kind === "argument") return candidate.id.slice(0, candidate.id.lastIndexOf("-"));
    return candidate.within === undefined ? undefined : callOf(byId.get(candidate.within));
  };
  /** Each call's arguments' source, from the first's start to the last's end. */
  const calls = new Map<string, { start: number; end: number }>();
  for (const each of candidates) {
    const call = each.kind === "argument" ? callOf(each) : undefined;
    if (call === undefined) continue;
    const span = calls.get(call);
    calls.set(call, {
      start: Math.min(span?.start ?? each.start, each.start),
      end: Math.max(span?.end ?? each.end, each.end),
    });
  }
  /**
   * What sets a stretch between the glyphs of `before` and of `after`: the whole of it, when its
   * source lies in a raw chunk or a locked candidate; otherwise what overlaps its source, each
   * with the part of it that does, in the source's order; and, for what none of them sets, the
   * other arguments of the calls whose arguments `before` and `after` are, since a macro may set
   * its arguments in another order than it takes them (`more`).
   */
  const settersOf = (
    before: ProbeCandidate | undefined,
    after: ProbeCandidate | undefined,
  ): { whole?: Setter; parts: ReturnType<typeof partsIn>; more: ReturnType<typeof partsIn> } => {
    if (before !== undefined && after !== undefined && before.where !== after.where)
      return {
        parts: [
          ...partsIn(before.where, before.end, sources[before.where].length),
          ...partsIn(after.where, 0, after.start),
        ],
        more: [],
      };
    const where = before?.where ?? after?.where ?? "body";
    const from = before?.end ?? 0;
    const to = after?.start ?? sources[where].length;
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    const chunk = where === "body" ? innermost(raw, lo, hi) : undefined;
    if (chunk !== undefined) return { whole: { by: "raw", raw: chunk }, parts: [], more: [] };
    const candidate = innermost(enclosing[where], lo, hi);
    if (candidate !== undefined)
      return { whole: { by: "candidate", candidate: candidate.id }, parts: [], more: [] };
    const parts = partsIn(where, lo, hi);
    const around = [before, after].flatMap((each) => {
      const span = calls.get(callOf(each) ?? "");
      return span === undefined ? [] : [span];
    });
    const more = partsIn(
      where,
      Math.min(lo, ...around.map((span) => span.start)),
      Math.max(hi, ...around.map((span) => span.end)),
    ).filter((part) => !parts.some((each) => each.placed === part.placed));
    return { parts, more };
  };

  // What sets each glyph: its owner, or what sets its part of the stretch it is in.
  const setterAt: Setter[] = [];
  let i = 0;
  while (i < flat.length) {
    const known = flat[i]?.owner;
    if (known !== undefined) {
      setterAt[i] = { by: "candidate", candidate: known.id };
      i++;
      continue;
    }
    let j = i + 1;
    while (j < flat.length && flat[j]?.owner === undefined) j++;
    const { whole, parts, more } = settersOf(flat[i - 1]?.owner, flat[j]?.owner);
    for (let k = i; k < j; k++) setterAt[k] = whole ?? CHROME;
    // The stretch's glyphs' texts, one after the other, each character with its glyph.
    const glyphOf: number[] = [];
    let text = "";
    for (let k = i; k < j; k++) {
      const each = comparable(flat[k]?.text ?? "");
      text += each;
      for (let c = 0; c < each.length; c++) glyphOf.push(k);
    }
    if (text === "" && parts.length > 0) {
      // The page names none of them: shared in proportion to how much of the source each is.
      const total = parts.reduce((sum, part) => sum + part.hi - part.lo, 0);
      let reach = 0;
      let k = i;
      for (const part of parts) {
        reach += part.hi - part.lo;
        for (const until = i + Math.round((reach / Math.max(total, 1)) * (j - i)); k < until; k++)
          setterAt[k] = part.placed.setter;
      }
    } else {
      // Each piece of each's source, in the source's order, where the stretch's text next has it
      // and no other's claimed it; a piece of a character or two only close by, where it is not a
      // letter met by chance. What a setter's first and last pieces found hold is its, as a label
      // its own command sets between them. One the page sets before those the source has before
      // it is looked for from the stretch's start.
      const claimed = new Set<number>();
      const free = (at: number, length: number) =>
        glyphOf.slice(at, at + length).every((k) => !claimed.has(k));
      /** Each piece of a part's source, or with `words`, each run of letters and digits of them. */
      const piecesOfPart = (part: (typeof parts)[number], words: boolean) => {
        const pieces = piecesOf(sources[part.placed.where], part.lo, part.hi);
        return words ? pieces.flatMap((piece) => piece.match(/[\p{L}\p{N}]+/gu) ?? []) : pieces;
      };
      const find = (part: (typeof parts)[number], start: number, words = false) => {
        let first: number | undefined;
        let last: number | undefined;
        let at = start;
        for (const piece of piecesOfPart(part, words)) {
          const wanted = comparable(piece);
          if (wanted === "") continue;
          let found = text.indexOf(wanted, at);
          while (found >= 0 && !free(found, wanted.length)) found = text.indexOf(wanted, found + 1);
          if (found < 0 || (wanted.length <= 2 && found - at > NEAR)) continue;
          first ??= glyphOf[found];
          last = glyphOf[found + wanted.length - 1];
          at = found + wanted.length;
        }
        return first === undefined || last === undefined ? undefined : { first, last, at };
      };
      let from = 0;
      const take = (part: (typeof parts)[number], found: ReturnType<typeof find>) => {
        if (found === undefined) return;
        for (let k = found.first; k <= found.last; k++)
          if (!claimed.has(k)) {
            setterAt[k] = part.placed.setter;
            claimed.add(k);
          }
        from = Math.max(from, found.at);
      };
      for (const part of parts) take(part, find(part, from) ?? find(part, 0));
      for (const part of more) take(part, find(part, 0));
      // Every part is looked for again by its words alone, in the source's order, among the glyphs
      // still unclaimed, since a piece the page never shows whole hides the words it holds: a
      // list of `value/label` pairs a macro parses, setting each label alone (a `\foreach` chart,
      // decision 0013), whose one braced label may be found and the rest not. What its first and
      // last words found there hold is its, so that no word of the document's own is left to the
      // template's text for the shape its source gives it (item 13's review).
      for (const part of [...parts, ...more]) take(part, find(part, 0, true));
    }
    i = j;
  }

  const placeOf = (glyph: { page: number; at: number }) => {
    const item = glyphs[glyph.page]?.[glyph.at];
    return { h: item?.h ?? 0, v: item?.v ?? 0 };
  };
  /** The glyphs in runs of what sets them, each run on one page, with or without the editable's. */
  const runsOf = (withEditable: boolean) => {
    const found: UncoveredRun[] = [];
    let at = 0;
    while (at < flat.length) {
      const start = flat[at];
      if (start === undefined || (!withEditable && editable(start.owner))) {
        at++;
        continue;
      }
      const setter = setterAt[at] ?? CHROME;
      let end = at + 1;
      while (end < flat.length) {
        const each = flat[end];
        if (
          each === undefined ||
          each.page !== start.page ||
          (!withEditable && editable(each.owner)) ||
          !sameSetter(setterAt[end], setter)
        )
          break;
        end++;
      }
      const last = flat[end - 1] ?? start;
      found.push({
        page: start.page,
        from: start.at,
        to: last.at + 1,
        first: placeOf(start),
        last: placeOf(last),
        ...setter,
      });
      at = end;
    }
    return found;
  };
  return { runs: runsOf(false), covered, all: runsOf(true) };
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
): Promise<{ tree?: Tree; setters: Set<string>; signatures: EngineSignatures; ms?: number }> {
  const read = readBody(bodyOfText(body.preamble));
  if ("refused" in read) return { setters: new Set(), signatures: found };
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
        truncated: found.truncated || more.truncated,
        ms: found.ms + more.ms,
      };
  }
  const setters = new Set(
    Object.entries(signatures.commands)
      .filter(
        ([name, signature]) => signature.kind === "template" && isSetter(signatures.macros[name]),
      )
      .map(([name]) => name),
  );
  const timed = ms === undefined ? {} : { ms };
  if (setters.size === 0) return { setters, signatures, ...timed };
  const tree = buildTree(read, signatures);
  return { ...("refused" in tree ? {} : { tree }), setters, signatures, ...timed };
}

/**
 * Probe a document: which of its body's candidates, and of its preamble's calls that store a
 * header's text, the editor may mark (`Probe`). `tree` is the tree of the intake's body, parsed
 * with `found`, the engine's signatures of it (`signatures`); the reference is the original's, and
 * the job, `import` by default, is forgotten before and after. The document's format, where it
 * dumped, stays in the session; whoever asked for the probe drops it when done
 * (`EngineSession.dropFormat`), and a probe that throws drops it itself.
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
  const declarations =
    options.declarations === undefined || options.declarations === ""
      ? ""
      : `${options.declarations}\n`;
  const setup: Setup = { session, engine: made.engine, intake, body, job, files, declarations };
  const probed = candidates.filter((each) => each.unprobed === undefined);
  const owners = new Map(candidates.map((each) => [each.id, each]));
  const shipped = (path: string) => shippedFont(files, job, path);

  // The baseline: the unmarked body, which must set the reference's glyphs, on the format path
  // where the engine is pdfTeX, or XeTeX with its fonts declared by file, and the preamble dumps,
  // and the whole path otherwise.
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
  if (made.engine === "pdftex" || options.declarations !== undefined) {
    const dumped = dumpFormat(setup);
    format = { name: dumped.name, ms: dumped.ms };
    if (!dumped.ok) fallback = "dump";
  }
  try {
    const dumped = format !== undefined && fallback === undefined ? format.name : undefined;
    if (dumped !== undefined) {
      const onFormat = formatPath(setup, dumped);
      const differs = await tryBaseline(onFormat);
      if (differs === undefined) path = onFormat;
      else {
        fallback = "baseline";
        formatDifference = differs;
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
    let passes = 0;
    const route = path;
    const compileSet: CompileSet = async (set) => {
      const text = marked(
        tree.source,
        set.filter((each) => each.where === "body"),
      );
      const calls = reissued(body.preamble, setters, set);
      let result: CompileResult;
      try {
        result = route.compile(text, calls, PROBE_PASSES, true);
      } catch {
        return { broke: true, same: false, torn: false, own: new Map() };
      }
      compileMs += result.passes.reduce((sum, pass) => sum + pass, 0);
      passes += result.passes.length;
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
        ? await settle(probeOrder(probed, owners, true), compileSet, budget, owners, true)
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
    const { runs, covered, all } = uncoveredRuns(made, results, settlement.evidence, raw, {
      body: tree.source,
      preamble: preamble.tree?.source ?? "",
    });
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
      passes,
      ms: performance.now() - started,
      ...(preamble.ms === undefined ? {} : { signaturesMs: preamble.ms }),
      signatures: preamble.signatures,
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
      runs: all,
    };
  } catch (error) {
    // A probe that did not finish leaves no format behind.
    session.forget(job);
    if (format !== undefined && fallback !== "dump") session.dropFormat(made.engine, format.name);
    throw error;
  }
}
