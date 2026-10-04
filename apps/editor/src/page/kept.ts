/**
 * An imported outline's kept text on its typeset page (the second pass's item 7, decision 0049).
 *
 * An outline's kept text is the upload's own LaTeX, written back around its fields with no marker of
 * its own: its pieces are fragments of the person's LaTeX, a command and the brace that opens its
 * argument, where no marker could stand. What it sets on the page is found from the fields' markers
 * instead, which the probe proved stand where they do. The kept text between two fields the
 * generator writes one after the other, a segment, sets what the output sets between the first's
 * end marker and the second's begin marker, where the output sets them in that order: within one run
 * of a page, one column, the output keeps the source's order. Where it does not, as paracol sets two
 * columns side by side, or a class sets its header's fields in an order of its own, the glyphs
 * between two fields that are not one after the other in the outline are no segment's, and the page
 * shows them as the template's. The page shows a segment's lock as a locked part's, and a retype of
 * its words reads its glyphs as a locked part's (`retype.ts`, decision 0042).
 *
 * Markers are read as an outline's page reads them (`acceptedMarkers`): of each of its fields only
 * the first begin and the first end after it, so that kept text that sets a marker by another
 * spelling moves no segment's bounds.
 */

import type { DviDocument } from "../tex/dvi";
import { acceptedMarkers, MARKER_BEGIN, MARKER_END, markerId } from "../tex/fields";
import type { LockedItem, LockedSet } from "./locked";

/** What every segment's id starts with, which no section's id holds, since an id has no colon. */
export const KEPT_PREFIX = "kept:";

/**
 * The id of the segment of kept text between the field `before` and the field `after`, by their
 * marker ids, `<id>.text`: none before the outline's first field, and none after its last.
 */
export const keptId = (before: string | undefined, after: string | undefined) =>
  `${KEPT_PREFIX}${before ?? ""}>${after ?? ""}`;

/** Whether a locked part's id, as the page reads it, is a segment's of kept text. */
export const isKeptId = (id: string) => id.startsWith(KEPT_PREFIX);

/**
 * A segment of kept text as the output sets it: its glyphs and rules, as a locked part's, and the
 * specials the output sets between its two fields, which a link or a colour its LaTeX holds writes.
 */
export interface KeptSet extends LockedSet {
  specials: { page: number; item: number }[];
}

/** How far down from the glyph or rule before it one of a segment's starts a block of its own. */
const NEW_LINE = 2 * 65536;

/**
 * Every segment of kept text the output sets (the module's comment), by its id: `order` is the
 * outline's fields the generator writes, by their marker ids, in the order it writes them, and the
 * markers are those `acceptedMarkers` accepts, read again here unless given. A segment the output
 * sets nothing of, or sets out of the outline's order, is left out. Each line of a segment is a
 * block of its own on the page (`LockedItem.resumes`), since the line before it and the line after
 * it may hold fields, which no block of the segment's may lie over: a segment often ends one line
 * and starts the next, as the kept text between two bullets does.
 */
export function keptSets(
  doc: Pick<DviDocument, "pages">,
  order: readonly string[],
  accepted: readonly ReadonlySet<number>[] = acceptedMarkers(doc.pages, new Set(order)),
): Map<string, KeptSet> {
  const place = new Map(order.map((id, index) => [id, index]));
  const sets = new Map<string, KeptSet>();
  /** What the output set since the last field ended, outside every field. */
  let items: LockedItem[] = [];
  let specials: KeptSet["specials"] = [];
  /** The place in `order` of the field that ended last, -1 before the first. */
  let after = -1;
  /** How many accepted fields are open where the walk stands. */
  let open = 0;
  /** Where the segment's glyph or rule before stands down the page, which a new line passes. */
  let down = Number.NEGATIVE_INFINITY;
  const push = (item: LockedItem, v: number) => {
    items.push(v > down + NEW_LINE && items.length > 0 ? { ...item, resumes: true } : item);
    down = v;
  };
  /** The segment between `after` and the field at `next`, if it is the one after it. */
  const close = (next: number) => {
    if (next === after + 1 && (items.length > 0 || specials.length > 0)) {
      const id = keptId(order[after], order[next]);
      if (!sets.has(id)) sets.set(id, { id, items, specials });
    }
    items = [];
    specials = [];
  };
  doc.pages.forEach((page, number) => {
    const marks = accepted[number];
    page.items.forEach((item, index) => {
      if (item.kind === "special") {
        if (marks?.has(index)) {
          const begun = markerId(item.text, MARKER_BEGIN);
          if (begun !== undefined) {
            if (open === 0) close(place.get(begun) ?? -2);
            open++;
            return;
          }
          const ended = markerId(item.text, MARKER_END);
          if (ended !== undefined) {
            open = Math.max(0, open - 1);
            if (open === 0) {
              after = place.get(ended) ?? -2;
              items = [];
              specials = [];
            }
          }
          return;
        }
        if (open === 0) specials.push({ page: number, item: index });
        return;
      }
      if (open > 0) return;
      const at = { page: number, item: index };
      if (item.kind === "rule") {
        if (item.width > 0 && item.height > 0) push({ kind: "rule", ...at }, item.v);
      } else if (item.kind === "glyph") push({ kind: "glyph", ...at }, item.v);
      else if (item.kind === "native")
        item.glyphs.forEach((each, glyph) => {
          // A native run's `.notdef` draws nothing, and is no glyph of a segment's.
          if (each.id !== 0) push({ kind: "glyph", ...at, glyph }, item.v + each.y);
        });
    });
  });
  close(order.length);
  return sets;
}
