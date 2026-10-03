/**
 * Whether a retype of a locked part left the page outside it as it was (milestone 3 item 16,
 * decision 0042), by the import's own comparison of glyph streams (`difference`, decision 0019),
 * the one its first check holds a regenerated body to: the same pages, of the same size, and on
 * each the same glyphs in the same fonts, the same rules and the same specials, in the same order,
 * each within a scaled point of its place. The part's own glyphs and rules, as the page reads them
 * (`lockedSets`), and the specials between its two markers, a link's or a colour's that the part
 * sets, are left out of both outputs, so that only what the part sets may change: a line of it
 * broken elsewhere is the part's, and one line more or fewer moves what follows it, which is not.
 *
 * It reads each output as the import reads one (`readOutput`), so the app loads it, with the
 * import's reading, only when the first retype is checked.
 */

import { type Difference, difference, type GlyphStream, readOutput } from "../import/reference";
import type { FontLibrary } from "../page/fonts";
import { lockedSets, lockMarker } from "../page/locked";
import type { DviDocument } from "../tex/dvi";

/**
 * A glyph stream with a part's own items left out: the glyphs and rules `lockedSets` gives it, and
 * where the output sets its start before its end, every special between the two.
 */
export function streamWithout(stream: GlyphStream, doc: DviDocument, part: string): GlyphStream {
  const id = part.toLowerCase();
  const own = new Set(
    (lockedSets(doc).get(id)?.items ?? []).map(
      (each) => `${each.page}:${each.item}:${each.glyph ?? -1}`,
    ),
  );
  // Whether the output sets the part's start first, which the specials between its markers are
  // then read from; a part set out of order keeps them all in the comparison.
  const first = doc.pages
    .flatMap((page) => page.items)
    .map((item) => (item.kind === "special" ? lockMarker(item.text) : undefined))
    .find((marker) => marker?.id === id);
  const ordered = first !== undefined && !first.end;
  let inside = false;
  const pages = stream.pages.map((page, index) => {
    const items = doc.pages[index]?.items ?? [];
    const kept: GlyphStream["pages"][number]["items"] = [];
    // The stream holds a DVI item's glyphs one by one: a native run's each, and every other item as
    // one, in the order the output sets them (`readOutput`).
    let at = 0;
    items.forEach((item, itemIndex) => {
      const count = item.kind === "native" ? item.glyphs.length : 1;
      if (item.kind === "special") {
        const marker = lockMarker(item.text);
        if (ordered && marker?.id === id) inside = !marker.end;
        const each = page.items[at];
        if (each !== undefined && !inside) kept.push(each);
        at += 1;
        return;
      }
      for (let glyph = 0; glyph < count; glyph++) {
        const each = page.items[at + glyph];
        const key = `${index}:${itemIndex}:${item.kind === "native" ? glyph : -1}`;
        if (each !== undefined && !own.has(key)) kept.push(each);
      }
      at += count;
    });
    return { items: kept };
  });
  return { ...stream, pages };
}

/**
 * Where the page outside the locked part `part` first differs between the output before a retype
 * of it and the output after, or undefined when it does not (the module's comment).
 */
export async function outsideDifference(
  fonts: FontLibrary,
  before: Uint8Array,
  after: Uint8Array,
  part: string,
): Promise<Difference | undefined> {
  const [was, now] = await Promise.all([readOutput(fonts, before), readOutput(fonts, after)]);
  return difference(
    streamWithout(was.stream, was.doc, part),
    streamWithout(now.stream, now.doc, part),
  );
}

/** `outsideDifference` as the guard asks it (`OutsideCheck`): true when nothing outside changed. */
export const outsideCheck =
  (fonts: FontLibrary) =>
  async (before: Uint8Array, after: Uint8Array, part: string): Promise<boolean> =>
    (await outsideDifference(fonts, before, after, part)) === undefined;
