/**
 * What Enter at the end of a field on the page adds to an imported outline (the second pass's item
 * 8): a bullet or an entry, the unit the field ends (`unitEnding`), and never a section, which the
 * side panel still adds. An outline whose entries stand at its own level, in no section, so gains
 * entries from the side panel alone.
 */

import type { OutlinePart, OutlineUnit } from "@resume-tools/resume-model";
import { isOutlineField } from "@resume-tools/resume-model";
import { type UnitPlace, unitEnding } from "./outline";
import { piecesOf } from "./retype";

/** Whether a field shows something, as the generator writes only one that does. */
const shows = (part: OutlinePart) =>
  isOutlineField(part) &&
  (typeof part.text === "string" ? part.text : part.text.map((run) => run.text).join("")).trim() !==
    "";

/**
 * Whether a unit is a section rather than a bullet or an entry: one that holds units which hold
 * units of their own, as a section holds entries with bullets; or one whose own parts write one
 * field, its heading, and after it a group or kept text that sets words (`piecesOf`), as a section
 * holds entries without bullets, a list of skills, or a paragraph.
 */
export function sectionLike(unit: OutlineUnit): boolean {
  const deep = unit.parts.some(
    (part) =>
      part.kind === "group" &&
      part.units.some((inner) => inner.parts.some((each) => each.kind === "group")),
  );
  if (deep) return true;
  const own = unit.parts.flatMap((part, at) => (shows(part) ? [at] : []));
  const [heading] = own;
  if (own.length !== 1 || heading === undefined) return false;
  return unit.parts
    .slice(heading + 1)
    .some(
      (part) =>
        part.kind === "group" ||
        (part.kind === "kept" && piecesOf(part.latex).some((piece) => /\p{L}/u.test(piece.text))),
    );
}

/**
 * The unit Enter at the end of the field `id` adds a copy after, or none: none for a section, a
 * unit of a group at the outline's own level whose units hold groups, as a run of sections holds
 * entries, or one whose own parts read as a section's (`sectionLike`).
 */
export function enterAdds(parts: readonly OutlinePart[], id: string): UnitPlace | undefined {
  const place = unitEnding(parts, id);
  const unit = place?.group.units[place.index];
  if (place === undefined || unit === undefined) return undefined;
  const outermost =
    place.path.length === 1 &&
    place.group.units.some((each) => each.parts.some((part) => part.kind === "group"));
  return outermost || sectionLike(unit) ? undefined : place;
}
