/**
 * The outline, measured (milestone 3's second pass, item 2, `docs/milestone-3-overhaul.md`): what
 * the second pass's `.tex` import would make of a resume, built from the parser's tree (decision
 * 0020) and the probe's verdicts (decision 0022), with no naming step and no assembly, so that its
 * numbers can set the pass's targets. `spike-outline-child.ts` runs it on the engine.
 *
 * - **Fields.** Every candidate the probe found editable is a field, where it stands in the
 *   person's LaTeX: the body's in place, and a value the preamble stores, as Awesome-CV's name,
 *   through the preamble's call issued again after it, as the probe issues it. A field is written
 *   as the generator writes a slot (decision 0007): in the editor's marker, its text as the
 *   generator escapes a rich field's runs, and a date's text as plain text, since an outline holds
 *   no date (`writeOutline`).
 * - **Kept text.** Everything else, written back byte for byte.
 * - **Groups of units.** A list's items are a group, and so is a run of calls to the same command,
 *   each with what follows it up to the next (`groupsOf`).
 *
 * The plan's check 1 compiles the outline and keeps a field only where its rewriting keeps the
 * reference's page, which the child bisects as the probe does (`settle`); check 3's trials, a copy
 * of a group's last unit with its fields emptied and the removal of its first and of its last
 * (`trialsOf`), are judged by what they leave of the reference's glyphs, in its order or reflowed
 * to another column or page (`judged`). The words are the reference's page's, read as item 13's
 * report reads them (decision 0039), each set down to a field, to kept text the first pass's retype
 * reaches (decision 0042), or to kept text it does not (`wordsOf`).
 *
 * What it returns is LaTeX for the engine, and ids and counts; nothing here prints.
 */

import type { Engine } from "../src/engine/session";
import { type Candidate, wrapEnd } from "../src/import/candidates";
import {
  type Group,
  groupsOf,
  type Leaf,
  leavesOf,
  type Unit,
  type Words,
  wordsOf,
} from "../src/import/outline";
import type { Node, Span } from "../src/import/parse";
import { regenerate } from "../src/import/print";
import type { ProbeCandidate, UncoveredRun } from "../src/import/probe";
import type { GlyphStream, ReferenceGlyph } from "../src/import/reference";

// The tree, the groups and the words: promoted into the import (the second pass's item 5).

export { type Group, groupsOf, type Leaf, leavesOf, type Unit, type Words, wordsOf };

// Writing the outline.

/** A field as the outline writes it: the probe's candidate's id, span and braces. */
export type FieldSpan = Pick<Candidate, "id" | "start" | "end" | "bare">;

/** A source the outline is written from: its text, its leaves, and how a field's text is written. */
export interface OutlineSource {
  source: string;
  leaves: readonly Leaf[];
  /**
   * A leaf as the generator writes what a field holds of it (`regenerated`); without it, a field's
   * own bytes, as the probe wraps them.
   */
  regen?: (leaf: Leaf) => string;
}

/** A change to the body a trial makes: a span taken out, or text put in at a place. */
export type Edit =
  | { kind: "delete"; start: number; end: number }
  | { kind: "insert"; at: number; text: string };

/**
 * A leaf as the generator writes it, on `engine`: a text's runs as rich text, escaped and marked as
 * a rich field's are (`regenerate`, decision 0020), and a date's text as plain text, since an
 * outline's field is text and holds no date.
 */
export function regenerated(source: string, engine: Engine): (leaf: Leaf) => string {
  return (leaf) => {
    const node: Node =
      leaf.kind === "text"
        ? leaf
        : { kind: "text", runs: [{ text: leaf.text }], start: leaf.start, end: leaf.end };
    return regenerate(
      {
        kind: "body",
        source,
        start: leaf.start,
        end: leaf.end,
        content: [node],
        nodes: 1,
        levels: 1,
      },
      engine,
    );
  };
}

/** A field placed for writing: where its markers go, and the leaves its text is written from. */
interface Placed {
  id: string;
  start: number;
  end: number;
  bare: boolean;
  leaves: Leaf[];
  /** Every leaf it overlaps lies within it, so that its text can be written from them. */
  clean: boolean;
}

/**
 * Where each field's markers go, as `marked` puts them (`candidates.ts`): around its span, past the
 * spaces TeX skipped after a control word it ends in, and a field that starts before the last one
 * ended left out. Where its text is written from its leaves, a leaf whose braces hold the whole
 * field is the field, and the markers go around it.
 */
function placeFields(out: OutlineSource, fields: readonly FieldSpan[], limit: number): Placed[] {
  const sorted = [...fields].sort((a, b) => a.start - b.start || a.end - b.end);
  const placed: Placed[] = [];
  let reach = -1;
  sorted.forEach((field, i) => {
    if (field.start < reach) return;
    const next = sorted[i + 1]?.start ?? limit;
    let start = field.start;
    let end =
      field.end === field.start
        ? field.end
        : wrapEnd(out.source, field.end, Math.max(field.end, next));
    if (out.regen !== undefined && field.end > field.start) {
      const holding = out.leaves.find(
        (leaf) =>
          leaf.start <= field.start &&
          leaf.end >= field.end &&
          (leaf.start < field.start || leaf.end > field.end),
      );
      if (holding !== undefined) {
        start = holding.start;
        end = Math.max(end, holding.end);
      }
    }
    const inside = out.leaves.filter((leaf) => leaf.end > start && leaf.start < end);
    const clean = inside.every((leaf) => leaf.start >= start && leaf.end <= end);
    placed.push({ id: field.id, start, end, bare: field.bare === true, leaves: inside, clean });
    reach = end;
  });
  return placed;
}

/** A field in the editor's marker, in braces of its own where its argument has none. */
const marker = (id: string, content: string, bare: boolean) =>
  `${bare ? "{" : ""}\\rtfield{${id}}{${content}}${bare ? "}" : ""}`;

/**
 * The outline's LaTeX for the part of a source from `range.start` to `range.end`: each of `fields`
 * in its marker, its text written as the generator writes it where `out.regen` is given, and
 * everything else the source's bytes; with `edits` made, a span taken out with the fields that
 * start in it, and text put in at a place, after any field the place falls inside. With no
 * `regen` and no edit, it is what the probe compiles (`marked`). `unclean` counts the fields whose
 * text could not be written from their leaves, one overlapping their edge, which keep their bytes.
 */
export function writeOutline(
  out: OutlineSource,
  fields: readonly FieldSpan[],
  edits: readonly Edit[] = [],
  range: Span = { start: 0, end: out.source.length },
): { latex: string; unclean: number } {
  const { source } = out;
  const ours = fields.filter((field) => field.start >= range.start && field.end <= range.end);
  const placed = placeFields(out, ours, range.end);
  // A span taken out starts after a field it starts inside, and takes whole the fields that start
  // in it; overlapping spans are one.
  const deletes = edits
    .flatMap((edit) => (edit.kind === "delete" ? [{ start: edit.start, end: edit.end }] : []))
    .sort((a, b) => a.start - b.start);
  for (const span of deletes)
    for (const field of placed) {
      if (field.start < span.start && span.start < field.end) span.start = field.end;
      if (field.start >= span.start && field.start < span.end)
        span.end = Math.max(span.end, field.end);
    }
  const merged: Span[] = [];
  for (const span of deletes) {
    const last = merged.at(-1);
    if (last !== undefined && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else if (span.end > span.start) merged.push({ ...span });
  }
  const gone = (at: number) => merged.some((span) => at >= span.start && at < span.end);
  const kept = placed.filter((field) => !gone(field.start));
  const inserts = edits.flatMap((edit) =>
    edit.kind === "insert"
      ? [
          {
            at: kept.find((field) => field.start < edit.at && edit.at < field.end)?.end ?? edit.at,
            text: edit.text,
          },
        ]
      : [],
  );
  type Op =
    | { order: 0; start: number; end: number; text: string }
    | { order: 1; start: number; end: number; field: Placed }
    | { order: 2; start: number; end: number };
  const ops: Op[] = [
    ...inserts.map((each) => ({
      order: 0 as const,
      start: each.at,
      end: each.at,
      text: each.text,
    })),
    ...kept.map((field) => ({ order: 1 as const, start: field.start, end: field.end, field })),
    ...merged.map((span) => ({ order: 2 as const, start: span.start, end: span.end })),
  ].sort((a, b) => a.start - b.start || a.order - b.order);
  let latex = "";
  let at = range.start;
  let unclean = 0;
  for (const op of ops) {
    if (op.start < at) continue;
    latex += source.slice(at, op.start);
    if (op.order === 0) latex += op.text;
    else if (op.order === 1) {
      const { field } = op;
      if (out.regen !== undefined && !field.clean) unclean++;
      latex += marker(field.id, contentOf(out, field), field.bare);
    }
    at = op.end;
  }
  return { latex: latex + source.slice(at, range.end), unclean };
}

/** A field's text: its leaves as `out.regen` writes them, and its other bytes as they are. */
function contentOf(out: OutlineSource, field: Placed): string {
  const { source, regen } = out;
  if (regen === undefined || !field.clean) return source.slice(field.start, field.end);
  let content = "";
  let at = field.start;
  for (const leaf of field.leaves) {
    content += source.slice(at, leaf.start) + regen(leaf);
    at = leaf.end;
  }
  return content + source.slice(at, field.end);
}

// Check 3's trials.

/** What check 3 tries of a group: a copy of its last unit, or the removal of its first or last. */
export type TrialKind = "copy" | "first" | "last";

/** A trial: its group, by its place among the groups, what it tries, and the change it makes. */
export interface Trial {
  group: number;
  kind: TrialKind;
  edit: Edit;
}

/**
 * A unit's LaTeX with each field in it emptied: in its marker, under an id `idOf` gives, and with
 * nothing inside, as a new unit's field is before anything is typed in it; its kept text as it is.
 */
export function emptied(
  source: string,
  unit: Pick<Unit, "start" | "end">,
  fields: readonly FieldSpan[],
  idOf: () => string,
): string {
  const inside = fields
    .filter((field) => field.start >= unit.start && field.end <= unit.end)
    .sort((a, b) => a.start - b.start);
  let latex = "";
  let at = unit.start;
  inside.forEach((field, i) => {
    if (field.start < at) return;
    const next = inside[i + 1]?.start ?? unit.end;
    const end =
      field.end === field.start
        ? field.end
        : Math.min(wrapEnd(source, field.end, Math.max(field.end, next)), unit.end);
    latex += source.slice(at, field.start) + marker(idOf(), "", field.bare === true);
    at = end;
  });
  return latex + source.slice(at, unit.end);
}

/**
 * Check 3's trials of each group (the plan's item 6): a copy of its last unit, its fields emptied,
 * put in after it with what parts it from the unit before it; the removal of its first unit, up to
 * the next; and the removal of its last, from where the one before it ends. A group of one unit has
 * one removal, which is both its first and its last (`last` is left out).
 */
export function trialsOf(
  source: string,
  groups: readonly Group[],
  fields: readonly FieldSpan[],
): Trial[] {
  let made = 0;
  const idOf = () => `n${++made}`;
  return groups.flatMap((group, at): Trial[] => {
    const first = group.units[0];
    const last = group.units.at(-1);
    if (first === undefined || last === undefined) return [];
    const before = group.units.at(-2);
    const copy = `${group.gap}${emptied(source, last, fields, idOf)}`;
    const trials: Trial[] = [
      { group: at, kind: "copy", edit: { kind: "insert", at: last.end, text: copy } },
      {
        group: at,
        kind: "first",
        edit: {
          kind: "delete",
          start: first.start,
          end: before === undefined ? first.end : first.next,
        },
      },
    ];
    if (before !== undefined)
      trials.push({
        group: at,
        kind: "last",
        edit: { kind: "delete", start: before.end, end: last.end },
      });
    return trials;
  });
}

/**
 * Trials in batches whose changes do not overlap, each to be compiled together, each trial in the
 * first batch it fits: copies, which only put text in, all in one; removals apart where one takes
 * out what another does, as an entry's removal takes its first bullet.
 */
export function batchesOf(trials: readonly Trial[]): Trial[][] {
  const span = (trial: Trial) =>
    trial.edit.kind === "delete"
      ? { start: trial.edit.start, end: trial.edit.end }
      : { start: trial.edit.at, end: trial.edit.at };
  /** Two spans overlap where both take something out and share some of it. */
  const overlap = (a: Span, b: Span) =>
    a.start < a.end && b.start < b.end && a.start < b.end && b.start < a.end;
  const batches: Trial[][] = [];
  for (const trial of trials) {
    const mine = span(trial);
    const fits = batches.find((batch) => batch.every((each) => !overlap(span(each), mine)));
    if (fits === undefined) batches.push([trial]);
    else fits.push(trial);
  }
  return batches;
}

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

// Judging a trial's page.

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
 * Why a trial broke the page, counted glyph by glyph wherever they stand: how many glyphs it must
 * keep are gone (`lost`), how many it must take out are still there (`left`), and how many it set
 * that the reference does not, or more often (`added`), which a copy may and a removal may not.
 */
export function brokenBy(
  kind: TrialKind,
  reference: readonly string[],
  output: readonly string[],
  role: (at: number) => Role,
): { lost: number; left: number; added: number } {
  const out = tally(output);
  const all = tally(reference);
  const must = new Map<string, number>();
  const may = new Map<string, number>();
  reference.forEach((key, at) => {
    const each = kind === "copy" ? "keep" : role(at);
    if (each === "delete") must.set(key, (must.get(key) ?? 0) + 1);
    if (each !== "keep") may.set(key, (may.get(key) ?? 0) + 1);
  });
  const found = { lost: 0, left: 0, added: 0 };
  for (const [key, n] of all) {
    const gone = n - (out.get(key) ?? 0);
    const going = must.get(key) ?? 0;
    const free = may.get(key) ?? 0;
    if (gone > free) found.lost += gone - free;
    if (gone < going) found.left += going - Math.max(gone, 0);
    if (kind !== "copy" && gone < 0) found.added -= gone;
  }
  if (kind !== "copy") for (const [key, n] of out) if (!all.has(key)) found.added += n;
  return found;
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
