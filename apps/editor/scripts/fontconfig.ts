/**
 * The fontconfig configuration of the tree's XeTeX, which lists no font folder at all (decisions
 * 0011 and 0014).
 *
 * XeTeX starts fontconfig the first time a run loads a native font, and the release's
 * `/etc/fonts/fonts.conf` has fontconfig scan `/texlive/texmf-dist/fonts/opentype` and `/type1`:
 * 565 files, 21 MB, which the browser's worker reads one synchronous request at a time on a XeTeX
 * template's first compile. The engine session restores the engine's heap after every run, so
 * fontconfig scans them again on every XeTeX compile, from memory, about 200 of the 284 ms the
 * invented template's body took. Nothing needs fontconfig to find a font: a XeTeX template
 * declares every font it uses by file, which XeTeX finds through kpathsea, and pdfTeX and
 * xdvipdfmx read theirs through `pdftex.map`. So the fetch script writes the release's conf
 * without its folders, and fontconfig starts with no font to scan. It is a pure function over the
 * conf's text, so that it can be tested without a tree.
 */

/** A folder fontconfig scans: a `<dir>` element, with or without attributes, and its line. */
const DIR = /[^\S\n]*<dir\b[^>]*?(?:\/>|>[^<]*<\/dir\s*>)[^\S\n]*\n?/g;

/**
 * The release's `fonts.conf` without a folder for fontconfig to scan: every `<dir>` element goes,
 * with its line, and the rest stays as it was. A conf that would still lead fontconfig to fonts is
 * refused: one with a `<dir>` this cannot take out, or one that includes other configuration,
 * which may name folders of its own.
 */
export function withoutFontFolders(conf: string): string {
  const bare = conf.replace(DIR, "");
  if (/<dir\b/.test(bare))
    throw new Error("fonts.conf has a <dir> whose form the fetch script cannot take out");
  if (/<include\b/.test(bare))
    throw new Error("fonts.conf includes other configuration, which may name font folders");
  return bare;
}
