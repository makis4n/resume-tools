/**
 * Whether a page after a unit was added is the page before but for the unit's glyphs and moving
 * down (the second pass's item 8): every glyph before is still there, in order, of the same text,
 * font and size, at the same distance across, and on the same page no higher or on a later page;
 * and the glyphs between them, the new unit's, set no letter or digit, as a unit whose fields are
 * emptied sets none. A line moved onto the next page passes its page's foot, which stands where it
 * stood, so the order is held where the two pages share a run of glyphs, and the rest is paired
 * where it stands still, and then in order.
 */

import type { DrawnPage } from "../page/draw";

/** A glyph as the comparison reads it: its page, where it is, and what it is. */
export interface Placed {
  page: number;
  x: number;
  y: number;
  text: string | undefined;
  font: string;
  size: number;
}

/** Every glyph of the pages, in order, as the comparison reads it. */
export const placedGlyphs = (pages: readonly DrawnPage[]): Placed[] =>
  pages.flatMap((page, at) =>
    page.glyphs.map((glyph) => ({
      page: at,
      x: glyph.x,
      y: glyph.y,
      text: glyph.text,
      font: glyph.font,
      size: glyph.size,
    })),
  );

/** How far a glyph may stand from where it stood, in points, as the page reads positions. */
const NEAR = 0.01;

/** Whether two glyphs are the same glyph, wherever down the page they stand. */
const same = (a: Placed, b: Placed) =>
  a.text === b.text && a.font === b.font && a.size === b.size && Math.abs(a.x - b.x) < NEAR;

/** Whether a glyph stands where it stood. */
const still = (a: Placed, b: Placed) =>
  same(a, b) && a.page === b.page && Math.abs(a.y - b.y) < NEAR;

/** Whether a glyph now stands higher than it stood, on its page or an earlier one. */
const up = (was: Placed, now: Placed) =>
  now.page < was.page || (now.page === was.page && now.y < was.y - NEAR);

/** Whether a glyph sets a letter or a digit, which no emptied unit sets. */
const wordy = (glyph: Placed) => /[\p{L}\p{N}]/u.test(glyph.text ?? "");

/** Whether a glyph after can be one before: the same glyph, where it stood or lower or later. */
const fits = (was: Placed, now: Placed) => same(was, now) && !up(was, now);

/**
 * The pairs of a longest run of glyphs `before` and `after` share in order (`fits`), by their
 * indexes, found by the usual table of common runs.
 */
function common(before: readonly Placed[], after: readonly Placed[]): [number, number][] {
  const n = before.length;
  const m = after.length;
  const table = new Uint32Array((n + 1) * (m + 1));
  const cell = (i: number, j: number) => table[i * (m + 1) + j] as number;
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i * (m + 1) + j] = fits(before[i] as Placed, after[j] as Placed)
        ? cell(i + 1, j + 1) + 1
        : Math.max(cell(i + 1, j), cell(i, j + 1));
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m; )
    if (fits(before[i] as Placed, after[j] as Placed) && cell(i, j) === cell(i + 1, j + 1) + 1)
      pairs.push([i++, j++]);
    else if (cell(i + 1, j) >= cell(i, j + 1)) i++;
    else j++;
  return pairs;
}

/**
 * What differs between `before` and `after` but for added glyphs that set no letter or digit and
 * glyphs moved down (the module's comment): the first problem found, or undefined where there is
 * none; and how many glyphs were added. The glyphs are paired as the longest run in order the two
 * share; those it leaves, as a page's foot that a line moved onto the next page passes, pair where
 * they stand where they stood, and then in order, each lower or later.
 */
export function movedDown(
  before: readonly Placed[],
  after: readonly Placed[],
): { problem?: string; added: number } {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    still(before[start] as Placed, after[start] as Placed)
  )
    start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    same(before[before.length - 1 - end] as Placed, after[after.length - 1 - end] as Placed)
  )
    end++;
  const pairs: [number, number][] = [];
  for (let i = 0; i < start; i++) pairs.push([i, i]);
  const middle = common(
    before.slice(start, before.length - end),
    after.slice(start, after.length - end),
  );
  for (const [i, j] of middle) pairs.push([start + i, start + j]);
  for (let k = end; k > 0; k--) pairs.push([before.length - k, after.length - k]);
  for (const [i, j] of pairs)
    if (up(before[i] as Placed, after[j] as Placed))
      return { problem: `glyph ${i} moved up`, added: 0 };
  const paired = new Set(pairs.map(([i]) => i));
  const taken = new Set(pairs.map(([, j]) => j));
  const left = before.flatMap((glyph, i) => (paired.has(i) ? [] : [{ glyph, i }]));
  let rest = after.flatMap((glyph, j) => (taken.has(j) ? [] : [{ glyph, j }]));
  // What stands where it stood, then what stands lower or later, in order.
  const unplaced = left.filter(({ glyph }) => {
    const at = rest.findIndex((each) => still(glyph, each.glyph));
    if (at < 0) return true;
    rest = rest.filter((_, k) => k !== at);
    return false;
  });
  let at = 0;
  let added = 0;
  for (const { glyph, i } of unplaced) {
    while (
      at < rest.length &&
      !(
        same(glyph, (rest[at] as { glyph: Placed }).glyph) &&
        !up(glyph, (rest[at] as { glyph: Placed }).glyph)
      )
    ) {
      if (wordy((rest[at] as { glyph: Placed }).glyph))
        return { problem: `glyph ${i} is missing, or a letter was added`, added };
      added++;
      at++;
    }
    if (at >= rest.length) return { problem: `glyph ${i} is missing`, added };
    at++;
  }
  for (const { glyph } of rest.slice(at)) {
    if (wordy(glyph)) return { problem: "a letter was added", added };
    added++;
  }
  return { added };
}
