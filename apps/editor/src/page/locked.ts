/**
 * The locked parts of an imported resume on its typeset page (milestone 3 item 15, decision 0041).
 *
 * The generator writes a locked section's LaTeX, kept as the upload had it, between two lock
 * markers, `\special{rt:l:<id>}` before it and `\special{rt:l:/<id>}` after it (decisions 0025
 * and 0041), which move nothing on the page. The page reads them as it reads a field's markers,
 * and never as a field: what the output sets between a part's two markers, its glyphs and its
 * rules, in the output's order and on whatever page each falls, is the part's, but for what a
 * field's markers hold there, which is the field's. Nothing of a part is edited, so the page aligns
 * no text with it: it says where the part is on the page drawn, in blocks, which the page's lock
 * shows over on hover (`Page.tsx`). The side panel names a part as item 13's report does, from the
 * import's own reading of the original's page (decision 0039).
 */

import { LOCK_END, LOCK_MARKER } from "../templates/prelude";
import type { DviDocument } from "../tex/dvi";
import { MARKER_BEGIN, MARKER_END, markerId } from "../tex/fields";

/**
 * A glyph or a drawn rule of a locked part: its page, from 0, its item's index there, and, for a
 * glyph of a native run, the glyph's index in the run.
 */
export interface LockedItem {
  kind: "glyph" | "rule";
  page: number;
  item: number;
  glyph?: number;
}

/** A locked part as the output sets it: its section's id, and its glyphs and rules, in order. */
export interface LockedSet {
  id: string;
  items: LockedItem[];
}

/** A box on a page, in TeX points from its top-left corner. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A locked part as the page shows it (`DrawnPage.locked`). */
export interface LockedRegion {
  /** Its section's id, lowercased, as the page reads every marker. */
  id: string;
  /** Where it shows on the page drawn (`blocksOf`); none when it is all on another page. */
  blocks: Box[];
}

/**
 * What a lock marker says: the part it starts or ends, by its id, lowercased, as the page reads
 * every marker; undefined for any other special.
 */
export function lockMarker(text: string): { id: string; end: boolean } | undefined {
  const named = markerId(text, LOCK_MARKER);
  if (named === undefined) return undefined;
  return named.startsWith(LOCK_END)
    ? { id: named.slice(LOCK_END.length), end: true }
    : { id: named, end: false };
}

/**
 * Every locked part a document's output sets (`LockedSet`), by its id, in the order its first
 * marker comes. A part's start opens it and its end closes it, and a part a page breaks runs on to
 * its end on the next page. A glyph or a drawn rule while a part is open is the part's, and each
 * open part's where the output has two open at once; but not while a field opened since is: a
 * field's markers, which a part's LaTeX never holds, may still come from a macro it calls, as a
 * header a class stored is set by its `\makecvheader`, and what they hold is the field's. A native
 * run's `.notdef`, which draws nothing, is none of a part's.
 *
 * The output sets what lies between a part's markers in the source's order only within one run of
 * a page, one column: paracol sets two columns side by side column by column, page by page, and a
 * page's foot and the next page's head come between a part's lines where a page breaks it. So a
 * part whose end the output sets before its start, as one that runs from one column into the other
 * ends at the top of the second before it starts at the foot of the first, or whose start no end
 * follows, is set out of the source's order, and what lies between its markers is no more its own
 * than anything else's: it keeps nothing, and the page shows no lock over it. And a part the output
 * starts on one page and ends on another keeps, on the first, the run of what it sets that goes on
 * down the page from its start, up to where the output goes back up the page by more than a line,
 * to the top of another column, and on the last the run that goes down into its end, as the page
 * groups a part's blocks (`blocksOf`): what lies past them, another column's sections, is not its.
 */
export function lockedSets(doc: DviDocument): Map<string, LockedSet> {
  const sets = new Map<string, LockedSet>();
  /** The part of an id, made where its first marker comes, which keeps the parts in that order. */
  const setOf = (id: string) => {
    const set = sets.get(id) ?? { id, items: [] };
    sets.set(id, set);
    return set;
  };
  // The parts set out of order, and those open where the walk stands, the innermost last, each
  // with how many fields were open as it opened, the page it started on, where its items start in
  // its set, and the baseline and size of each it has taken since, in the output's units.
  const disordered = new Set<string>();
  const open: Span[] = [];
  let fields = 0;
  doc.pages.forEach((page, number) => {
    page.items.forEach((item, index) => {
      if (item.kind === "special") {
        const marker = lockMarker(item.text);
        if (marker !== undefined) {
          const set = setOf(marker.id);
          const at = open.findIndex((each) => each.set === set);
          if (marker.end) {
            if (at >= 0) closed(open.splice(at, 1)[0] as Span, number);
            else disordered.add(marker.id);
          } else if (at < 0 && !disordered.has(marker.id))
            open.push({ set, fields, page: number, from: set.items.length, placed: [] });
        } else if (markerId(item.text, MARKER_BEGIN) !== undefined) fields++;
        else if (markerId(item.text, MARKER_END) !== undefined) fields = Math.max(0, fields - 1);
        return;
      }
      // Every part open takes it: the source never nests one part in another, so two are open at
      // once only where the output has set them out of its order, and each keeps its own runs.
      const parts = open.filter((part) => fields <= part.fields);
      if (parts.length === 0) return;
      const take = (taken: LockedItem, v: number, size: number | undefined) => {
        for (const part of parts) {
          part.set.items.push(taken);
          part.placed.push({ v, size: size ?? part.placed.at(-1)?.size ?? RULE_SIZE });
        }
      };
      if (item.kind === "rule") {
        if (item.width > 0 && item.height > 0)
          take({ kind: "rule", page: number, item: index }, item.v, undefined);
      } else if (item.kind === "glyph") {
        const size = doc.fonts.get(item.font)?.scale ?? 0;
        take({ kind: "glyph", page: number, item: index }, item.v, size);
      } else if (item.kind === "native") {
        const size = doc.nativeFonts.get(item.font)?.size ?? 0;
        item.glyphs.forEach((each, glyph) => {
          if (each.id !== 0)
            take({ kind: "glyph", page: number, item: index, glyph }, item.v + each.y, size);
        });
      }
    });
  });
  for (const { set } of open) disordered.add(set.id);
  for (const id of disordered) setOf(id).items = [];
  return sets;
}

/**
 * A part open as `lockedSets` walks the output: its set, how many fields were open as it opened,
 * the page it started on, where the items it has taken since start among its set's, and the
 * baseline and size of each of those, in the output's units.
 */
interface Span {
  set: LockedSet;
  fields: number;
  page: number;
  from: number;
  placed: { v: number; size: number }[];
}

/** The size a rule is taken to be set at before any glyph of its part, 10 pt in scaled points. */
const RULE_SIZE = 10 * 65536;

/**
 * A part's span, closed on page `end`: where it started on another page, what it took there is cut
 * to the run that goes on down the page from its start, and what it took on `end` to the run that
 * goes down into its end; a run ends where the output goes back up the page by more than the size
 * of what comes next, as `blocksOf` starts a block (`lockedSets`).
 */
function closed(span: Span, end: number) {
  if (span.page === end) return;
  const { set, from, placed } = span;
  const items = set.items.slice(from);
  /** Whether the item at `i` goes back up its page from the one before it, to another run. */
  const backUp = (i: number) => {
    const [before, here] = [placed[i - 1], placed[i]];
    return (
      before !== undefined &&
      here !== undefined &&
      items[i - 1]?.page === items[i]?.page &&
      here.v < before.v - BACK_UP * here.size
    );
  };
  let first = items.findIndex((each, i) => each.page !== span.page || backUp(i));
  if (first < 0) first = items.length;
  let last = items.findIndex((each) => each.page === end);
  if (last < 0) last = items.length;
  for (let i = items.length - 1; i > last; i--)
    if (backUp(i)) {
      last = i;
      break;
    }
  const kept = items.filter((each, i) =>
    each.page === span.page ? i < first : each.page !== end || i >= last,
  );
  set.items.splice(from, items.length, ...kept);
}

/** A glyph's or a rule's box on a page, with its baseline and the size it is set at, in TeX points. */
export interface Placed extends Box {
  baseline: number;
  size: number;
}

/** How far back up a page a part may go from one glyph or rule to the next in a block, in sizes. */
const BACK_UP = 1;

/**
 * Where a locked part shows on a page, in blocks: the boxes of its glyphs and rules, in the order
 * the page sets them, joined into one box each run of them that goes on down the page; a new block
 * starts where the part goes back up the page by more than the size of what comes next, a line or
 * more, as at the top of a column, or of a table's cell beside the last. A superscript, or an
 * accent TeX raised over a capital, goes up less and stays in its line's block. The page's lock
 * shows over the blocks, and what lies between them on the page is not under it.
 */
export function blocksOf(placed: readonly Placed[]): Box[] {
  const blocks: Box[] = [];
  let block: Box | undefined;
  let baseline = Number.NEGATIVE_INFINITY;
  for (const each of placed) {
    if (block === undefined || each.baseline < baseline - BACK_UP * each.size) {
      block = { left: each.left, top: each.top, right: each.right, bottom: each.bottom };
      blocks.push(block);
    } else {
      block.left = Math.min(block.left, each.left);
      block.top = Math.min(block.top, each.top);
      block.right = Math.max(block.right, each.right);
      block.bottom = Math.max(block.bottom, each.bottom);
    }
    baseline = each.baseline;
  }
  return blocks;
}
