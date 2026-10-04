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
  bisect,
  deletedAsSet,
  deletedOnly,
  glyphKeys,
  insertedAsSet,
  insertedOnly,
  judged,
  keepsPage,
  type Role,
  rolesOf,
  type TrialKind,
  type TrialVerdict,
} from "../src/import/checks";
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

// The tree, the groups and the words: promoted into the import (the second pass's item 5).

export { type Group, groupsOf, type Leaf, leavesOf, type Unit, type Words, wordsOf };

// Check 3's judging and the bisection: promoted into the import's checks (the second pass's item 6).

export {
  bisect,
  deletedAsSet,
  deletedOnly,
  glyphKeys,
  insertedAsSet,
  insertedOnly,
  judged,
  keepsPage,
  type Role,
  rolesOf,
  type TrialKind,
  type TrialVerdict,
};

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

// Judging a trial's page: promoted into the import's checks (the second pass's item 6).

/** How many times each glyph comes in an output, by `glyphKey`. */
function tally(keys: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
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
