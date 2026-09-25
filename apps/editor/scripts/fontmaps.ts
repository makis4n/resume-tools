/**
 * Merging font maps into `pdftex.map`, as TeX Live's `updmap` does with each map it is told about.
 *
 * The tree's `pdftex.map` is updmap's output for TeX Live's own `web2c/updmap.cfg`, which lists
 * only the basic tree's maps. The Ubuntu bundles bring fonts of their own, such as marvosym,
 * eurosym and txfonts, whose maps were never added to that file, so neither the page nor
 * xdvipdfmx, whose `dvipdfmx.cfg` reads `pdftex.map`, could find their outlines. The fetch script
 * appends their entries, so that the page and the PDF (item 14) find the same outline for the
 * same font. It is a pure function over the files' texts, so that it can be tested without a tree.
 */

import { basename } from "node:path";
// Node runs the fetch script by stripping its types, so imports need their real extensions.
import { parseMapLine } from "../src/page/fontmap.ts";

/** A map file to merge: where it is, and its text. */
export interface MapFile {
  path: string;
  text: string;
}

/**
 * `base` with the entries of `maps` it lacks appended, in the order given, as updmap would add
 * the maps: an entry for a TeX font that `base` or an earlier map already has is left out, as is
 * one that names no outline file or one `hasOutline` says the tree lacks, since xdvipdfmx would
 * fail on such an entry and the page could not draw its font either. Comments are not copied;
 * each map's entries are headed by a comment naming the map, as updmap heads them, and kept as
 * their lines are. The result ends with a newline.
 */
export function mergeFontMaps(
  base: string,
  maps: readonly MapFile[],
  hasOutline: (file: string) => boolean,
): string {
  const known = new Set<string>();
  for (const line of base.split(/\r?\n/)) {
    const entry = parseMapLine(line);
    if (entry) known.add(entry.tfm);
  }
  const out = [base.endsWith("\n") ? base : `${base}\n`];
  for (const map of maps) {
    const added: string[] = [];
    for (const line of map.text.split(/\r?\n/)) {
      const entry = parseMapLine(line);
      if (!entry || known.has(entry.tfm) || !entry.fontFile || !hasOutline(entry.fontFile))
        continue;
      known.add(entry.tfm);
      added.push(line);
    }
    if (added.length > 0) out.push(`% ${basename(map.path)}\n`, ...added.map((l) => `${l}\n`));
  }
  return out.join("");
}
