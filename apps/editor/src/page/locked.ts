/**
 * The locked parts of an imported resume on its typeset page (milestone 3 item 15, decision 0041).
 *
 * The generator writes a locked section's LaTeX, kept as the upload had it, between two lock
 * markers, `\special{rt:l:<id>}` before it and `\special{rt:l:/<id>}` after it (decisions 0025
 * and 0041), which move nothing on the page. The page reads them as it reads a field's markers,
 * and never as a field: what the output sets between a part's two markers, its glyphs and its
 * rules, is the part's, but for what a field's markers hold there, which is the field's, and for
 * what the output sets there out of the source's order (`lockedSets`). Nothing of a part is
 * edited, so the page aligns no text with it: it says where the part is on the page drawn, in
 * blocks, which the page's lock shows over on hover (`Page.tsx`). The side panel names a part as
 * item 13's report does, from the import's own reading of the original's page (decision 0039).
 */

import { LOCK_END, LOCK_MARKER } from "../templates/prelude";
import type { DviDocument } from "../tex/dvi";
import { MARKER_BEGIN, MARKER_END, markerId } from "../tex/fields";

/**
 * A glyph or a drawn rule of a locked part: its page, from 0, its item's index there, and, for a
 * glyph of a native run, the glyph's index in the run; and whether a field the part holds comes
 * between it and the part's glyph or rule before it, as a field a class's header macro sets
 * between two lines the part keeps, where the part's blocks part (`blocksOf`).
 */
export interface LockedItem {
  kind: "glyph" | "rule";
  page: number;
  item: number;
  glyph?: number;
  resumes?: true;
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
 * A glyph or a drawn rule of the output as `lockedSets` reads it: where it is among the output's,
 * its place, its size, and how many fields' markers hold it; all in the output's units.
 */
interface Drawn extends LockedItem {
  h: number;
  v: number;
  size: number;
  fields: number;
}

/** Where a marker stands: among the output's glyphs and rules, the number before it; its page; and
 * how many fields' markers hold it. */
interface Marker {
  at: number;
  page: number;
  fields: number;
}

/** The size a rule is taken to be set at before any glyph, 10 pt in scaled points. */
const RULE_SIZE = 10 * 65536;

/**
 * How far left of where a part starts, in sizes, a line on a later page of it may start and still
 * be its: a list's indent or a hanging label, and never the width of another column.
 */
const COLUMN_SLACK = 3;

/**
 * Every locked part a document's output sets (`LockedSet`), by its id, in the order its first
 * marker comes, read from its markers' places among the output's glyphs and rules.
 *
 * - **A part the output sets in the source's order**, its start before its end, has what the
 *   output sets between them, but for what a field opened since holds: a field's markers, which a
 *   part's LaTeX never holds, may still come from a macro it calls, as a class's header macro sets
 *   a field the class stored, and what they hold is the field's. A part that one page holds keeps
 *   all of it, side-by-side cells, columns of its own and all. Within one run of a page, one
 *   column, the output keeps the source's order, and across runs it need not: paracol sets two
 *   columns side by side, column by column, page by page, and a page's foot and the next page's
 *   head come between a part's lines where a page breaks it. So a part on several pages keeps, on
 *   the first, what goes down from its first line until the output goes back up above that line,
 *   to the top of another column, where a cell beside the last goes no higher than the part's own
 *   first line; and on each page after, every line that starts no further left of where the part's
 *   own lines start on its first page than a list's indent, so not another column's to its left.
 *   Its markers do not say where its column is: TeX writes one at the end of a paragraph the part
 *   follows with no blank line, and the other after the part's last line.
 * - **A part whose end the output sets before its start**, as one that runs from the foot of a
 *   column into the next column ends at that column's top, on the page before, has the run that
 *   goes down into its end, the lines before it on its page, after the last field or part there,
 *   that start where the line its end stands on starts; and the run from its start down its
 *   column, as above, up to the next part.
 * - **A part with no start or no end** keeps nothing, and the page shows no lock over it.
 *
 * What the output sets in the span of a part nested in another's, as only a reordering can, is
 * the inner part's. A native run's `.notdef`, which draws nothing, is no glyph of a part's.
 */
export function lockedSets(doc: DviDocument): Map<string, LockedSet> {
  const drawn: Drawn[] = [];
  const starts = new Map<string, Marker>();
  const ends = new Map<string, Marker>();
  /** Each field's or part's marker's place among the drawn, which bounds a run into an end. */
  const fenced: number[] = [];
  /** Each part's marker's place, which bounds a run from a start. */
  const locks: number[] = [];
  const order: string[] = [];
  let fields = 0;
  doc.pages.forEach((page, number) => {
    let size = RULE_SIZE;
    page.items.forEach((item, index) => {
      if (item.kind === "special") {
        const marker = lockMarker(item.text);
        if (marker !== undefined) {
          if (!order.includes(marker.id)) order.push(marker.id);
          const into = marker.end ? ends : starts;
          if (!into.has(marker.id)) into.set(marker.id, { at: drawn.length, page: number, fields });
          fenced.push(drawn.length);
          locks.push(drawn.length);
        } else if (markerId(item.text, MARKER_BEGIN) !== undefined) {
          fields++;
          fenced.push(drawn.length);
        } else if (markerId(item.text, MARKER_END) !== undefined) {
          fields = Math.max(0, fields - 1);
          fenced.push(drawn.length);
        }
        return;
      }
      const at = { page: number, item: index, fields };
      if (item.kind === "rule") {
        if (item.width > 0 && item.height > 0)
          drawn.push({ kind: "rule", ...at, h: item.h, v: item.v, size });
      } else if (item.kind === "glyph") {
        size = doc.fonts.get(item.font)?.scale ?? size;
        drawn.push({ kind: "glyph", ...at, h: item.h, v: item.v, size });
      } else if (item.kind === "native") {
        size = doc.nativeFonts.get(item.font)?.size ?? size;
        item.glyphs.forEach((each, glyph) => {
          if (each.id !== 0)
            drawn.push({
              kind: "glyph",
              ...at,
              glyph,
              h: item.h + each.x,
              v: item.v + each.y,
              size,
            });
        });
      }
    });
  });
  // Each part's span where its start comes first: what lies in a span nested in another part's
  // is the inner part's, and what lies in any is none of a part's set out of order.
  const spans = new Map<string, { from: number; to: number }>();
  for (const id of order) {
    const [start, end] = [starts.get(id), ends.get(id)];
    if (start !== undefined && end !== undefined && start.at <= end.at)
      spans.set(id, { from: start.at, to: end.at });
  }
  /** Whether what is set at `at` is another part's than `id`'s, by their spans. */
  const another = (id: string, at: number) => {
    const own = spans.get(id);
    for (const [other, { from, to }] of spans)
      if (other !== id && at >= from && at < to && (!own || (own.from <= from && to <= own.to)))
        return true;
    return false;
  };
  /** The drawn from `from` to `to`, by their places, that are no other part's than `id`'s. */
  const ownOf = (id: string, from: number, to: number) => {
    const own: Drawn[] = [];
    for (let at = Math.max(0, from); at < Math.min(to, drawn.length); at++)
      if (!another(id, at)) own.push(drawn[at] as Drawn);
    return own;
  };
  const sets = new Map<string, LockedSet>();
  for (const id of order) {
    const start = starts.get(id);
    const end = ends.get(id);
    let kept: Drawn[] = [];
    if (start !== undefined && end !== undefined && start.at <= end.at) {
      const between = outside(ownOf(id, start.at, end.at), start.fields);
      const pages = [...new Set(between.map((each) => each.page))];
      const down = downFromFirst(between, pages[0]);
      // Where the part's own lines start on its first page: its column's left edge, or its indent.
      const left = Math.min(...between.slice(0, down).map((each) => each.h));
      kept =
        pages.length <= 1
          ? between
          : between.filter((each, i) =>
              each.page === pages[0] ? i < down : startsInColumn(between, i, left),
            );
    } else if (start !== undefined && end !== undefined) {
      // The end first: the run that goes down into it, after the last field or part before it on
      // its page and in its column, and the run from the start down its column to the next part.
      const from = Math.max(
        ...fenced.filter((at) => at < end.at && drawn[at]?.page === end.page),
        drawn.findIndex((each) => each.page === end.page),
        0,
      );
      const into = outside(
        ownOf(id, from, end.at).filter((each) => each.page === end.page),
        end.fields,
      );
      const next = locks.find((at) => at > start.at) ?? drawn.length;
      const after = outside(
        ownOf(id, start.at, next).filter((each) => each.page === start.page),
        start.fields,
      );
      // The end stands at the end of the part's last line, which starts at the part's column.
      const last = into[lineStart(into, into.length - 1)];
      kept = [
        ...into.filter((_, i) => last !== undefined && startsInColumn(into, i, last.h)),
        ...after.slice(0, downFromFirst(after, start.page)),
      ];
    }
    sets.set(id, {
      id,
      items: kept.map(({ kind, page, item, glyph, resumes }) => ({
        kind,
        page,
        item,
        ...(glyph === undefined ? {} : { glyph }),
        ...(resumes ? { resumes } : {}),
      })),
    });
  }
  return sets;
}

/**
 * What of `drawn` no field opened since a part's marker holds, `fields` being how many were open
 * there; each one after a field's glyphs it leaves out marked as resuming the part.
 */
function outside(drawn: readonly Drawn[], fields: number): Drawn[] {
  const kept: Drawn[] = [];
  let skipped = false;
  for (const each of drawn) {
    if (each.fields > fields) {
      skipped = kept.length > 0;
      continue;
    }
    kept.push(skipped ? { ...each, resumes: true } : { ...each, resumes: undefined });
    skipped = false;
  }
  return kept;
}

/**
 * Where, among `drawn`, a part's run on page `page`, its first, ends: at the first of them past
 * the page, or the first that goes back up the page by more than its size and above the part's
 * first line there, to the top of another column, where a cell beside the last goes back up no
 * higher than the part's own first line.
 */
function downFromFirst(drawn: readonly Drawn[], page: number | undefined): number {
  const first = drawn.find((each) => each.page === page);
  const end = drawn.findIndex((each, i) => {
    if (each.page !== page) return i > 0;
    const before = drawn[i - 1];
    return (
      first !== undefined &&
      before !== undefined &&
      before.page === page &&
      each.v < before.v - BACK_UP * each.size &&
      each.v < first.v - each.size / 2
    );
  });
  return end < 0 ? drawn.length : end;
}

/**
 * Where the line of the glyph or rule `i` of `drawn` starts, among them: a line starts where the
 * output goes to another page or baseline, or back left by more than the size of what comes next.
 */
function lineStart(drawn: readonly Drawn[], i: number): number {
  let first = i;
  for (; first > 0; first--) {
    const [before, here] = [drawn[first - 1], drawn[first]];
    if (before === undefined || here === undefined) break;
    const turned =
      before.page !== here.page ||
      Math.abs(here.v - before.v) > here.size / 2 ||
      here.h < before.h - here.size;
    if (turned) break;
  }
  return first;
}

/**
 * Whether the glyph or rule `i` of `drawn` is on a line that starts no further left of `left`, where
 * the part's own lines start, in the output's units, than `COLUMN_SLACK` sizes.
 */
function startsInColumn(drawn: readonly Drawn[], i: number, left: number): boolean {
  const start = drawn[lineStart(drawn, i)];
  return start === undefined || start.h >= left - COLUMN_SLACK * start.size;
}

/** A glyph's or a rule's box on a page, with its baseline and the size it is set at, in TeX points. */
export interface Placed extends Box {
  baseline: number;
  size: number;
  /** Whether a field the part holds comes before it, which starts a block of its own. */
  resumes?: boolean;
}

/** How far back up a page a part may go from one glyph or rule to the next in a block, in sizes. */
const BACK_UP = 1;

/**
 * Where a locked part shows on a page, in blocks: the boxes of its glyphs and rules, in the order
 * the page sets them, joined into one box each run of them that goes on down the page; a new block
 * starts where the part goes back up the page by more than the size of what comes next, a line or
 * more, as at the top of a column, or of a table's cell beside the last, and where a field it
 * holds comes between, so that no block lies over the field. A superscript, or an accent TeX raised
 * over a capital, goes up less and stays in its line's block. The page's lock shows over the
 * blocks, and what lies between them on the page is not under it.
 */
export function blocksOf(placed: readonly Placed[]): Box[] {
  const blocks: Box[] = [];
  let block: Box | undefined;
  let baseline = Number.NEGATIVE_INFINITY;
  for (const each of placed) {
    if (
      block === undefined ||
      each.resumes === true ||
      each.baseline < baseline - BACK_UP * each.size
    ) {
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
