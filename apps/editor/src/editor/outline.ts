/**
 * An imported outline as the editor edits it (the second pass's item 7, decision 0049): its fields,
 * which open in place on any page as a built-in template's do, and its kept text, whose runs of
 * plain text are retyped as a locked part's are (decision 0042).
 *
 * Kept text has no marker of its own on the page (`page/kept.ts`): what the page sets of it is read
 * between the fields the generator writes, a segment at a time. So a segment here is the kept text
 * the generator writes between two of the outline's fields that it writes, one after the other,
 * or before the first or after the last: its pieces, the kept parts and units' gaps it holds, each
 * where it is in the outline (`KeptAt`), and what the generator writes between them that is no kept
 * text, as the braces of a field given as one token. A retype changes a run of plain text within one
 * kept piece, and nothing else, as one step of the history (`retypeKept`).
 */

import {
  endsInComment,
  isOutlineField,
  OUTLINE_PLACEHOLDER,
  type OutlineField,
  type OutlineFixed,
  type OutlineGroup,
  type OutlinePart,
  OutlineSection,
  type OutlineUnit,
  outlineNodes,
  type Resume,
} from "@resume-tools/resume-model";
import { keptId } from "../page/kept";
import { isBlank } from "../templates/escape";

/** The outline of an imported `.tex` resume's document, its one section, or undefined for another. */
export function outlineOf(resume: Resume): OutlineSection | undefined {
  for (const section of resume.sections) if (section.kind === "outline") return section;
  return undefined;
}

/**
 * Where a piece of kept text is in an outline: `path` goes from its parts to the piece, a part's
 * index, then for a group a unit's index and a part's in it, and so on; `gap` says it is that unit's
 * gap, the kept text before it, rather than a part.
 */
export interface KeptAt {
  path: readonly number[];
  gap?: true;
}

/** A piece of a segment: kept text where it is (`at`), or what the generator writes beside it. */
export interface SegmentPiece {
  latex: string;
  at?: KeptAt;
}

/** The kept text between two fields the generator writes (the module's comment). */
export interface KeptSegment {
  /** As the page reads it (`keptId`). */
  id: string;
  pieces: SegmentPiece[];
  /** Its pieces' LaTeX, joined, as the generator writes it. */
  latex: string;
  /** Where each piece starts in `latex`. */
  starts: number[];
}

/** Whether the generator writes a field of an outline: a field whose text shows something. */
const written = (part: Extract<OutlinePart, { kind: "text" | "rich" }>) =>
  !isBlank(typeof part.text === "string" ? part.text : part.text.map((run) => run.text).join(""));

/** A field's marker id, `<id>.text`, as the generator names it and the page reads it. */
export const markerOf = (id: string) => `${id}.text`;

/**
 * What the generator writes of an outline, in its order (`outlinePart`): each piece of kept text
 * where it is, a unit's gap before every unit but its group's first, a line's end after one that
 * ends in a comment, and each field, written or not, with the braces of one given as one token.
 */
function* writing(
  parts: readonly OutlinePart[],
  path: readonly number[] = [],
): Generator<
  | { kind: "kept"; latex: string; at?: KeptAt }
  | { kind: "field"; part: Extract<OutlinePart, { kind: "text" | "rich" }> }
> {
  const kept = function* (latex: string, at: KeptAt) {
    if (latex === "") return;
    yield { kind: "kept" as const, latex, at };
    if (endsInComment(latex)) yield { kind: "kept" as const, latex: "\n" };
  };
  for (const [index, part] of parts.entries()) {
    const at = [...path, index];
    if (part.kind === "kept") yield* kept(part.latex, { path: at });
    else if (part.kind === "group")
      for (const [u, unit] of part.units.entries()) {
        if (u > 0) yield* kept(unit.gap, { path: [...at, u], gap: true });
        yield* writing(unit.parts, [...at, u]);
      }
    else {
      if (part.bare === true) yield { kind: "kept", latex: "{" };
      yield { kind: "field", part };
      if (part.bare === true) yield { kind: "kept", latex: "}" };
    }
  }
}

/**
 * The outline's fields the generator writes, by their marker ids, in the order it writes them,
 * which is the order the page reads its segments by (`DrawOptions.outline`).
 */
export function writtenFields(section: OutlineSection): string[] {
  const ids: string[] = [];
  for (const step of writing(section.parts))
    if (step.kind === "field" && written(step.part)) ids.push(markerOf(step.part.id));
  return ids;
}

/** Every segment of an outline's kept text, in order (the module's comment), with no piece or not. */
export function keptSegments(section: OutlineSection): KeptSegment[] {
  const segments: KeptSegment[] = [];
  let before: string | undefined;
  let pieces: SegmentPiece[] = [];
  const close = (after: string | undefined) => {
    const starts: number[] = [];
    let latex = "";
    for (const piece of pieces) {
      starts.push(latex.length);
      latex += piece.latex;
    }
    segments.push({ id: keptId(before, after), pieces, latex, starts });
    pieces = [];
  };
  for (const step of writing(section.parts)) {
    if (step.kind === "kept") pieces.push(step.at === undefined ? { latex: step.latex } : step);
    else if (written(step.part)) {
      const id = markerOf(step.part.id);
      close(id);
      before = id;
    }
  }
  close(undefined);
  return segments;
}

/** An edit of kept text: the piece at `at`, as it is to be. */
export interface KeptEdit {
  at: KeptAt;
  latex: string;
}

/**
 * The outline with each piece of kept text `edits` names replaced, or a reason it cannot be: a
 * piece that is not kept text, or an outline the model refuses after it, as kept text that holds
 * the editor's markers' texts, which a retype typed so would make (`OutlineSection`).
 */
export function withKept(
  section: OutlineSection,
  edits: readonly KeptEdit[],
): OutlineSection | { refused: string } {
  let parts = section.parts;
  for (const edit of edits) {
    const changed = replaced(parts, edit.at.path, edit.at.gap === true, edit.latex);
    if (changed === undefined) return { refused: "it names no kept text of the outline" };
    parts = changed;
  }
  const read = OutlineSection.safeParse({ ...section, parts });
  return read.success ? read.data : { refused: read.error.message };
}

/** The part at `path` among `parts` (`KeptAt.path`), or undefined where there is none. */
export function partAt(
  parts: readonly OutlinePart[],
  path: readonly number[],
): OutlinePart | undefined {
  const [index, unit, ...rest] = path;
  const part = index === undefined ? undefined : parts[index];
  if (unit === undefined || part === undefined) return part;
  if (part.kind !== "group") return undefined;
  const inner = part.units[unit];
  return inner === undefined ? undefined : partAt(inner.parts, rest);
}

/**
 * `parts` with what is at `path` changed by `change`, the part there, or with `gap`, the gap of the
 * unit the path ends at; undefined where there is none, or `change` gives none.
 */
function changedAt(
  parts: readonly OutlinePart[],
  path: readonly number[],
  change: { part: (part: OutlinePart) => OutlinePart | undefined } | { gap: string },
): OutlinePart[] | undefined {
  const [index, unit, ...rest] = path;
  const part = index === undefined ? undefined : parts[index];
  if (index === undefined || part === undefined) return undefined;
  let next: OutlinePart | undefined;
  if (unit === undefined) next = "part" in change ? change.part(part) : undefined;
  else {
    if (part.kind !== "group") return undefined;
    const old = part.units[unit];
    if (old === undefined) return undefined;
    let changed: OutlineUnit | undefined;
    if (rest.length > 0) {
      const inner = changedAt(old.parts, rest, change);
      changed = inner === undefined ? undefined : { ...old, parts: inner };
    } else if ("gap" in change && unit > 0) changed = { ...old, gap: change.gap };
    if (changed === undefined) return undefined;
    const units = part.units.map((each, u) => (u === unit ? (changed as OutlineUnit) : each));
    next = { ...part, units };
  }
  if (next === undefined) return undefined;
  return parts.map((each, i) => (i === index ? (next as OutlinePart) : each));
}

/** `parts` with the part at `path` replaced by `part`; undefined where there is none. */
export const withPartAt = (
  parts: readonly OutlinePart[],
  path: readonly number[],
  part: OutlinePart,
): OutlinePart[] | undefined => changedAt(parts, path, { part: () => part });

/** `parts` with the kept part, or the unit's gap, at `path` holding `latex`; undefined if none. */
function replaced(
  parts: readonly OutlinePart[],
  path: readonly number[],
  gap: boolean,
  latex: string,
): OutlinePart[] | undefined {
  return gap
    ? changedAt(parts, path, { gap: latex })
    : changedAt(parts, path, {
        part: (part) => (part.kind === "kept" ? { kind: "kept", latex } : undefined),
      });
}

/**
 * Every field of an outline's parts with where it is (`KeptAt.path`), in the order the generator
 * writes them, written or not.
 */
export function* outlineFields(
  parts: readonly OutlinePart[],
  path: readonly number[] = [],
): Generator<{ part: Extract<OutlinePart, { kind: "text" | "rich" }>; path: number[] }> {
  for (const [index, part] of parts.entries()) {
    const at = [...path, index];
    if (part.kind === "text" || part.kind === "rich") yield { part, path: at };
    else if (part.kind === "group")
      for (const [u, unit] of part.units.entries()) yield* outlineFields(unit.parts, [...at, u]);
  }
}

/**
 * A copy of a unit as the editor makes a new one (the second pass's item 8), which check 3 tries as
 * it is made here (decision 0055): every field, group and unit in it under a new id `mint` gives,
 * every field emptied, or holding `OUTLINE_PLACEHOLDER` where `required` names it, and its kept
 * text and gap as they are, byte for byte. A group in it keeps its units, each copied so, and why
 * it is fixed, if it is; a field keeps whether it is required and given as one token.
 */
export function emptiedCopy(
  unit: OutlineUnit,
  mint: () => string,
  required: (id: string) => boolean,
): OutlineUnit {
  const map = (list: readonly OutlinePart[]): OutlinePart[] =>
    list.map((part): OutlinePart => {
      if (part.kind === "kept") return part;
      if (part.kind === "group")
        return {
          ...part,
          id: mint(),
          units: part.units.map((each) => ({ ...each, id: mint(), parts: map(each.parts) })),
        };
      const holds = required(part.id) ? OUTLINE_PLACEHOLDER : "";
      return part.kind === "text"
        ? { ...part, id: mint(), text: holds }
        : { ...part, id: mint(), text: holds === "" ? [] : [{ text: holds }] };
    });
  return { ...unit, id: mint(), parts: map(unit.parts) };
}

/**
 * Where a unit of an outline is: `path` goes from the outline's parts to its group (`KeptAt.path`),
 * the group, and the unit's index among its units.
 */
export interface UnitPlace {
  path: number[];
  group: OutlineGroup;
  index: number;
}

/** Where the unit `id` is among `parts`, however deep (`UnitPlace`), or undefined. */
export function unitPlace(
  parts: readonly OutlinePart[],
  id: string,
  path: readonly number[] = [],
): UnitPlace | undefined {
  for (const [index, part] of parts.entries()) {
    if (part.kind !== "group") continue;
    const at = [...path, index];
    for (const [u, unit] of part.units.entries()) {
      if (unit.id === id) return { path: at, group: part, index: u };
      const inner = unitPlace(unit.parts, id, [...at, u]);
      if (inner !== undefined) return inner;
    }
  }
  return undefined;
}

/** Every id an outline's parts hold, of its fields, groups and units. */
export function outlineIds(parts: readonly OutlinePart[]): string[] {
  const ids: string[] = [];
  for (const step of outlineNodes(parts))
    if (step.kind === "unit") ids.push(step.unit.id);
    else if (step.part.kind !== "kept") ids.push(step.part.id);
  return ids;
}

/**
 * The unit a field ends, as Enter at the field's end adds a unit after (the second pass's item 8):
 * the unit whose own parts, outside the groups within it, hold the field `id`, where no field of
 * its own parts the generator writes comes after it, so that the end of the field is the end of
 * what the unit sets in words of its own: a bullet's text ends its bullet, and an entry's last
 * field before its bullets ends its entry. Undefined for a field in no unit, or one with a written
 * field of its unit's own after it.
 */
export function unitEnding(parts: readonly OutlinePart[], id: string): UnitPlace | undefined {
  /** Whether `list` holds the field as a part of its own, and where it ends a unit within, if so. */
  const within = (
    list: readonly OutlinePart[],
    path: readonly number[],
  ): { own: boolean; place?: UnitPlace } | undefined => {
    for (const [index, part] of list.entries()) {
      if (isOutlineField(part)) {
        if (part.id === id) return { own: true };
        continue;
      }
      if (part.kind !== "group") continue;
      for (const [u, unit] of part.units.entries()) {
        const inner = within(unit.parts, [...path, index, u]);
        if (inner === undefined) continue;
        if (!inner.own) return { own: false, ...(inner.place ? { place: inner.place } : {}) };
        const own = unit.parts.filter(
          (each): each is OutlineField => isOutlineField(each) && written(each),
        );
        return own.at(-1)?.id === id
          ? { own: false, place: { path: [...path, index], group: part, index: u } }
          : { own: false };
      }
    }
    return undefined;
  };
  return within(parts, [])?.place;
}

/**
 * A unit's shape: its own parts, outside the groups within it, as the generator writes them with
 * every field emptied, its kept text byte for byte, each field by its kind, and a group within it
 * by its place alone. Two units of one shape set the same around their fields.
 */
export function unitShape(unit: OutlineUnit): string {
  return JSON.stringify(
    unit.parts.map((part) =>
      part.kind === "kept"
        ? ["kept", part.latex]
        : part.kind === "group"
          ? ["group"]
          : [part.kind, part.bare === true, part.required === true],
    ),
  );
}

/**
 * Whether a group's units are all of one shape (`unitShape`), so that what parts one from the next
 * is in their gaps and the last holds nothing the others lack: then a unit moves among them, and a
 * copy of the last goes in after any of them, as it went in after the last when the import's checks
 * tried it.
 */
export function alike(group: OutlineGroup): boolean {
  const last = group.units.at(-1);
  if (last === undefined) return true;
  const shape = unitShape(last);
  return group.units.every((unit) => unitShape(unit) === shape);
}

/**
 * Why a group's buttons are disabled where the import's checks found it fixed (decision 0055),
 * which they say when pointed at: it takes no unit more or fewer, and none of its units moves.
 */
export const FIXED_WHY: Readonly<Record<OutlineFixed, string>> = {
  copy: "Adding one here changed the rest of the page when your resume was imported, so these stay as they are",
  removal:
    "Removing one here changed the rest of the page when your resume was imported, so these stay as they are",
  untried: "These could not be tried when your resume was imported, so they stay as they are",
  stops:
    "A change here stopped the page from being made when your resume was imported, so these stay as they are",
};

/** Why the Remove of a group's only unit is disabled: a list needs at least one (decision 0050). */
export const ONLY_UNIT = "This is the only one here, and there must be at least one";

/**
 * Why a group's units take no move, and a new one only after the last (`alike`): they are not all
 * written alike in the person's file, so what parts them may be in them, and the last may hold
 * what follows the group (the second pass's item 8).
 */
export const NOT_ALIKE =
  "These are not all written alike in your file, so they keep their order, and a new one goes after the last";
