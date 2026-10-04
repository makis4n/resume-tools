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
  type OutlinePart,
  OutlineSection,
  type OutlineUnit,
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
