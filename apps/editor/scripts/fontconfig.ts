/**
 * Hiding the fonts the archive's packages add from fontconfig (decision 0011).
 *
 * XeTeX looks fonts up by name through fontconfig, and the release's `/etc/fonts/fonts.conf` has
 * fontconfig scan `/texlive/texmf-dist/fonts/opentype` and `/type1`, which is where the packages'
 * OpenType and Type 1 files land. The engine session restores the engine's heap after every run,
 * so fontconfig scans those folders again on every XeTeX run, and the packages' fonts, 184 files
 * and 54 MB, would add about 250 ms to each XeTeX compile and 54 MB to the browser's first.
 * Nothing needs fontconfig to see them: the templates load them by file, through kpathsea (item
 * 21), and pdfTeX and xdvipdfmx read them through `pdftex.map`. So the fetch script tells
 * fontconfig to refuse each folder the packages put outline files in, with a glob naming the folder
 * itself: fontconfig refuses a folder before it scans it, but checks a file against a glob only
 * after it has opened the file, so a glob of `<folder>/*` would hide the fonts and read them all
 * the same. They are pure functions over the conf's text and lists of files, so that they can be
 * tested without a tree.
 */

/** Where the tree keeps outline files fontconfig could scan: OpenType, TrueType and Type 1. */
const OUTLINE_TREES = ["opentype", "truetype", "type1"].map(
  (kind) => `/texlive/texmf-dist/fonts/${kind}/`,
);

/**
 * The folders the packages put outline files in, each once, in path order, from the files each
 * package added, by package name. A package that would put outline files in a folder the bundles
 * hold files in, or under, is refused, naming the package and the folder, since the folder's glob
 * would hide the bundles' fonts too.
 */
export function packageFontFolders(
  added: ReadonlyMap<string, readonly string[]>,
  bundled: readonly string[],
): string[] {
  const folders = new Set<string>();
  for (const [name, paths] of added) {
    for (const path of paths) {
      if (!OUTLINE_TREES.some((tree) => path.startsWith(tree))) continue;
      const folder = path.slice(0, path.lastIndexOf("/"));
      if (folders.has(folder)) continue;
      const shared = bundled.find((file) => file.startsWith(`${folder}/`));
      if (shared)
        throw new Error(
          `${name} puts fonts in ${folder}, where the bundles hold ${shared}; hiding the folder from fontconfig would hide the bundles' fonts too`,
        );
      folders.add(folder);
    }
  }
  return [...folders].sort();
}

/** Text for XML, with the characters markup takes as its own escaped. */
const xmlText = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * The release's `fonts.conf` with a `<selectfont><rejectfont>` block that refuses the folders, one
 * `<glob>` naming each folder itself, before `</fontconfig>`; the rest of it stays as it was. With
 * no folders, it is returned as it is.
 */
export function hideFontFolders(conf: string, folders: readonly string[]): string {
  if (folders.length === 0) return conf;
  const end = conf.lastIndexOf("</fontconfig>");
  if (end < 0)
    throw new Error("fonts.conf has no </fontconfig> to add the packages' folders before");
  const block = [
    "<!-- The folders of the fonts added from TeX Live's archive, which XeTeX takes by file -->",
    "<selectfont>",
    "<rejectfont>",
    ...folders.map((folder) => `<glob>${xmlText(folder)}</glob>`),
    "</rejectfont>",
    "</selectfont>",
    "",
  ].join("\n");
  return conf.slice(0, end) + block + conf.slice(end);
}
