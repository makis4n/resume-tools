/**
 * The locked parts of an imported resume on its typeset page (milestone 3 item 15, decision 0041).
 *
 * The generator writes a locked section's LaTeX, kept as the upload had it, between two lock
 * markers, `\special{rt:l:<id>}` before it and `\special{rt:l:/<id>}` after it (decisions 0025
 * and 0041), which move nothing on the page. The page reads them as it reads a field's markers,
 * and never as a field: what the output sets between a part's two markers, its glyphs and its
 * rules, is the part's, but for what a field's markers hold there, which is the field's, and for
 * what the output sets there out of the source's order (`lockedSets`). The page aligns no text
 * with a part, as it does a field's: it says where the part is on the page drawn, in
 * blocks, which the page's lock shows over on hover (`Page.tsx`). The side panel names a part as
 * item 13's report does, from the import's own reading of the original's page (decision 0039). A
 * retype of a part's words reads its glyphs' texts from the page (`retype.ts`, decision 0042).
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

/**
 * Where a marker stands: among the output's glyphs and rules, the number before it; its page; how
 * many fields' markers hold it; and its place on the page, in the output's units.
 */
interface Marker {
  at: number;
  page: number;
  fields: number;
  h: number;
  v: number;
}

/** The size a rule is taken to be set at before any glyph, 10 pt in scaled points. */
const RULE_SIZE = 10 * 65536;

/**
 * How far from where a part's column starts, in sizes, a line may start and still be in it: a
 * list's indent or a hanging label, and never the width of another column.
 */
const COLUMN_SLACK = 3;

/**
 * Every locked part a document's output sets (`LockedSet`), by its id, in the order its first
 * marker comes, read from its markers' places among the output's glyphs and rules.
 *
 * - **A part the output sets in the source's order**, its start before its end, has what the
 *   output sets between them, but for what a field opened since holds: a field's markers, which a
 *   part's LaTeX never holds, may still come from a macro it calls, as a class's header macro sets
 *   a field the class stored, and what they hold is the field's. A part whose markers stand on one
 *   page keeps all of it, side-by-side cells, columns of its own and all. Within one run of a page,
 *   one column, the output keeps the source's order, and across runs it need not: paracol sets two
 *   columns side by side, column by column, page by page, so that between the markers of a part a
 *   page breaks lie the other column's sections, and a page's foot and the next page's head. So a
 *   part whose markers stand on two pages or more keeps, on its start's page, the run from its
 *   start down its column (`columnRun`): up to where the output goes back up above its start, to
 *   another column's top, or to its own first line's height, where the part starts at its column's
 *   top, unless the output comes back to the part's column after, as a table's next row does after
 *   a cell beside the last; on the pages after, the lines that start in its column, where its start
 *   stands or its lines start, give or take a list's indent, so not another column's to its left,
 *   to its end, and on a page between, up to where another column starts beside it, as above.
 * - **A part whose end the output sets before its start**, as one that runs from the foot of a
 *   column into the next column ends at that column's top, on the page before, has the run that
 *   goes down into its end, the lines before it on its page, after the last field or part there,
 *   that start in the column its end stands in; and the run from its start down its column, as
 *   above, up to the next part.
 * - **A part with no start or no end** keeps nothing, and the page shows no lock over it.
 *
 * Where a marker stands says where its column starts (`columnOf`): TeX writes one between
 * paragraphs at its column's left edge, and one that follows a paragraph with no blank line at
 * the end of the paragraph's last line, which starts at the column's edge.
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
          if (!into.has(marker.id))
            into.set(marker.id, { at: drawn.length, page: number, fields, h: item.h, v: item.v });
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
  /**
   * Where the column a marker stands in starts: where the line it ends starts, as TeX writes a
   * marker at the end of a paragraph's last line, or else where it stands, at its column's left
   * edge, as TeX writes one between paragraphs.
   */
  const columnOf = (marker: Marker): number => {
    const before = drawn[marker.at - 1];
    const ends =
      before !== undefined &&
      before.page === marker.page &&
      Math.abs(before.v - marker.v) <= before.size / 2 &&
      before.h <= marker.h;
    return ends ? (drawn[lineStart(drawn, marker.at - 1)]?.h ?? marker.h) : marker.h;
  };
  const sets = new Map<string, LockedSet>();
  for (const id of order) {
    const start = starts.get(id);
    const end = ends.get(id);
    let kept: Drawn[] = [];
    if (start !== undefined && end !== undefined && start.at <= end.at) {
      const between = outside(ownOf(id, start.at, end.at), start.fields);
      if (start.page === end.page) kept = between;
      else {
        // Its start's page: the run from its start down its column; the pages after: the lines in
        // its column, to its end, or, on a page between, to where another column starts.
        const onPage = (page: number) => between.filter((each) => each.page === page);
        const run = onPage(start.page);
        kept = run.slice(0, columnRun(run, start.v, columnOf(start)));
        const left = Math.min(columnOf(start), ...kept.map((each) => each.h));
        for (let page = start.page + 1; page <= end.page; page++) {
          const on = onPage(page);
          const column = on.filter((_, i) => startsInColumn(on, i, left));
          kept.push(
            ...(page === end.page ? column : column.slice(0, columnRun(column, undefined, left))),
          );
        }
      }
    } else if (start !== undefined && end !== undefined) {
      // The end first: the run that goes down into it, after the last field or part before it on
      // its page, in its column, and the run from the start down its column to the next part.
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
      const column = columnOf(end);
      kept = [
        ...into.filter((_, i) => startsInColumn(into, i, column)),
        ...after.slice(0, columnRun(after, start.v, columnOf(start))),
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
 * How many of `run`, what a part sets on one page in the output's order, are its own column's: up
 * to the first that goes back up the page, to another column's top, above `anchor`, the part's
 * start on the page it starts on, or to within a size of the part's first line there, as where
 * the part starts at its own column's top; but not where the output comes back after it to a line
 * that starts where the part's column starts, `left`, as a table's next row after a cell beside
 * the last, which went back up. Another column the output sets after the part's own on the page,
 * as paracol sets its second, never comes back.
 */
function columnRun(run: readonly Drawn[], anchor: number | undefined, left: number): number {
  let first: Drawn | undefined;
  for (let i = 0; i < run.length; i++) {
    const each = run[i] as Drawn;
    const before = run[i - 1];
    const above = anchor !== undefined && each.v < anchor - each.size / 2;
    const up = before === undefined ? above : each.v < before.v - BACK_UP * each.size;
    const level = first !== undefined && each.v < first.v + each.size;
    if (up && (above || level) && !returns(run, i, left)) return i;
    first ??= each;
  }
  return run.length;
}

/** Whether `run` sets, after its glyph or rule `i`, a line that starts where `left` is. */
function returns(run: readonly Drawn[], i: number, left: number): boolean {
  for (let j = i + 1; j < run.length; j++) {
    const each = run[j] as Drawn;
    if (startsLine(run, j) && Math.abs(each.h - left) <= COLUMN_SLACK * each.size) return true;
  }
  return false;
}

/**
 * Whether the glyph or rule `i` of `drawn` starts a line among them: the first, or where the output
 * goes to another page or baseline, or back left by more than the size of what comes next.
 */
function startsLine(drawn: readonly Drawn[], i: number): boolean {
  const [before, here] = [drawn[i - 1], drawn[i]];
  return (
    before === undefined ||
    here === undefined ||
    before.page !== here.page ||
    Math.abs(here.v - before.v) > here.size / 2 ||
    here.h < before.h - here.size
  );
}

/** Where the line of the glyph or rule `i` of `drawn` starts, among them (`startsLine`). */
function lineStart(drawn: readonly Drawn[], i: number): number {
  let first = i;
  while (first > 0 && !startsLine(drawn, first)) first--;
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
