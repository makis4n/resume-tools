/**
 * The fonts a LaTeX source loads, and the tree's font families by name: what the corpus's survey
 * reads of every document (decision 0018), what the import pipeline's intake reads of an upload
 * (decision 0019), and what item 8 of milestone 3 will translate into a package's `fonts` through
 * this table. fontspec asks fontconfig for a family by its name; the tree's families are those its
 * OpenType and TrueType files make (`TREE_FAMILIES`), and a font the source loads by file is the
 * tree's when the tree holds a file of its name (`fileInTree`).
 *
 * The tree is its file list alone, the engine's manifest (`readTree`): a class or package is there
 * when a `.cls` or `.sty` of its name is, a font file when an OpenType or TrueType file of its name
 * is, and a family when `TREE_FAMILIES` names it and the tree holds the file it names for it.
 *
 * They are pure functions over text and the tree's file list, as `source.ts`'s are, and what they
 * return names fonts, never a document's text. Each takes time linear in what it reads, however a
 * hostile document is laid out. Node's scripts load this file as it is, by stripping its types, so
 * its one import names its file's extension.
 */

import { bracketed, group } from "./source.ts";

// The tree.

/** The tree as a source's reader sees it, from the engine's file list. */
export interface Tree {
  /** The names of its classes and packages, `name.cls` and `name.sty`, under a `tex/` folder. */
  styles: ReadonlySet<string>;
  /** Its OpenType and TrueType files' names, without their extension, in lower case. */
  fontFiles: ReadonlySet<string>;
  /** Its packages whose folder under `tex/` has a namesake holding OpenType or TrueType files. */
  fontPackages: ReadonlySet<string>;
}

/** Index the tree's files, by path in the engine's file system, once. */
export function readTree(files: Readonly<Record<string, number>>): Tree {
  const styles = new Set<string>();
  const fontFiles = new Set<string>();
  const fontFolders = new Set<string>();
  const stylesByFolder: [folder: string, name: string][] = [];
  for (const path of Object.keys(files)) {
    const font = /\/fonts\/(?:opentype|truetype)\/(?:.*\/)?([^/]+)\/([^/]+)\.(?:otf|ttf)$/i.exec(
      path,
    );
    if (font?.[1] && font[2]) {
      fontFolders.add(font[1]);
      fontFiles.add(font[2].toLowerCase());
      continue;
    }
    const style = /\/tex\/[^/]+\/([^/]+)\/(?:.*\/)?([^/]+\.(?:sty|cls))$/.exec(path);
    if (style?.[1] && style[2]) {
      styles.add(style[2]);
      if (style[2].endsWith(".sty")) stylesByFolder.push([style[1], style[2].slice(0, -4)]);
    }
  }
  const fontPackages = new Set(
    stylesByFolder.filter(([folder]) => fontFolders.has(folder)).map(([, name]) => name),
  );
  return { styles, fontFiles, fontPackages };
}

/**
 * The font families the tree's OpenType and TrueType files make, by the typographic family their
 * name tables give, as fontspec asks fontconfig for them by name, each with the file of its
 * upright face, which the tree must hold for the family to count as the tree's
 * (`familyInTree`), so that one table serves a tree of any layout. The tree of layout 4 had
 * Roboto, Roboto Condensed, Roboto Mono, Roboto Serif, Roboto Serif Condensed and Roboto Slab;
 * Lato; Source Sans Pro; Font Awesome 5 Free and Brands; Latin Modern's sixteen, and the names of
 * its design sizes, "LM Roman 10" and so on; Philokalia; and Sparks. Layout 5 adds Font Awesome 4
 * and Academicons; IBM Plex Sans, Sans Condensed, Serif and Mono; and TeX Gyre's nine (decision
 * 0018). A name matches a family when it is the family's name, or that name followed by style
 * words or a design size ("Roboto Light", "SourceSansPro-Bold", "LM Roman 12"), whatever its case,
 * spaces, hyphens and underscores, as fontconfig ignores case and spaces in a family's name.
 */
export const TREE_FAMILIES: Readonly<Record<string, string>> = {
  Roboto: "Roboto-Regular.otf",
  "Roboto Condensed": "RobotoCondensed-Regular.otf",
  "Roboto Mono": "RobotoMono-Regular.otf",
  "Roboto Serif": "RobotoSerif-Regular.otf",
  "Roboto Serif Condensed": "RobotoSerif_Condensed-Regular.otf",
  "Roboto Slab": "RobotoSlab-Regular.otf",
  Lato: "Lato-Regular.ttf",
  "Source Sans Pro": "SourceSansPro-Regular.otf",
  "Font Awesome 5 Free": "FontAwesome5Free-Solid-900.otf",
  "Font Awesome 5 Brands": "FontAwesome5Brands-Regular-400.otf",
  "Latin Modern Roman": "lmroman10-regular.otf",
  "Latin Modern Roman Caps": "lmromancaps10-regular.otf",
  "Latin Modern Roman Demi": "lmromandemi10-regular.otf",
  "Latin Modern Roman Dunhill": "lmromandunh10-regular.otf",
  "Latin Modern Roman Slanted": "lmromanslant10-regular.otf",
  "Latin Modern Roman Unslanted": "lmromanunsl10-regular.otf",
  "Latin Modern Sans": "lmsans10-regular.otf",
  "Latin Modern Sans Demi Cond": "lmsansdemicond10-regular.otf",
  "Latin Modern Sans Quotation": "lmsansquot8-regular.otf",
  "Latin Modern Mono": "lmmono10-regular.otf",
  "Latin Modern Mono Caps": "lmmonocaps10-regular.otf",
  "Latin Modern Mono Light": "lmmonolt10-regular.otf",
  "Latin Modern Mono Light Cond": "lmmonoltcond10-regular.otf",
  "Latin Modern Mono Prop": "lmmonoprop10-regular.otf",
  "Latin Modern Mono Prop Light": "lmmonoproplt10-regular.otf",
  "Latin Modern Mono Slanted": "lmmonoslant10-regular.otf",
  "LM Roman": "lmroman10-regular.otf",
  "LM Sans": "lmsans10-regular.otf",
  "LM Mono": "lmmono10-regular.otf",
  Philokalia: "Philokalia-Regular.otf",
  Sparks: "Sparks-Bar-Medium.otf",
  FontAwesome: "FontAwesome.otf",
  Academicons: "academicons.ttf",
  "IBM Plex Sans": "IBMPlexSans-Regular.otf",
  "IBM Plex Sans Condensed": "IBMPlexSansCondensed-Regular.otf",
  "IBM Plex Serif": "IBMPlexSerif-Regular.otf",
  "IBM Plex Mono": "IBMPlexMono-Regular.otf",
  "TeX Gyre Adventor": "texgyreadventor-regular.otf",
  "TeX Gyre Bonum": "texgyrebonum-regular.otf",
  "TeX Gyre Chorus": "texgyrechorus-mediumitalic.otf",
  "TeX Gyre Cursor": "texgyrecursor-regular.otf",
  "TeX Gyre Heros": "texgyreheros-regular.otf",
  "TeX Gyre Heros Cn": "texgyreheroscn-regular.otf",
  "TeX Gyre Pagella": "texgyrepagella-regular.otf",
  "TeX Gyre Schola": "texgyreschola-regular.otf",
  "TeX Gyre Termes": "texgyretermes-regular.otf",
};

/** A font's name as fontconfig compares it, and as the family table is keyed. */
const fontKey = (name: string) => name.toLowerCase().replace(/[\s_-]+/g, "");

/** The table's families as fontconfig compares their names, each with its file. */
const FAMILY_KEYS = Object.entries(TREE_FAMILIES).map(
  ([family, file]): [key: string, file: string] => [fontKey(family), file],
);

/**
 * The words that may follow a family's name in a name that means one of its faces, as runs of
 * digits may; longest first, so that `demibold` is read whole before `demi`.
 */
const STYLE_WORDS = [
  ...["regular", "bold", "italic", "it", "oblique", "light", "medium", "medm", "thin", "black"],
  ...["heavy", "hairline", "semibold", "smbld", "demibold", "demi", "extrabold", "extralight"],
  ...["extlt", "ultralight", "ultrabold", "book", "text", "solid", "normal", "upright", "roman"],
].sort((a, b) => b.length - a.length);

/** The longest name looked for among the tree's families; none of theirs comes near it. */
const MAX_FAMILY_NAME = 128;

/**
 * Whether a key is nothing but style words and runs of digits, read from its start, each time the
 * longest word that fits: one pass over it, where a regular expression of the alternatives
 * backtracks over every way of splitting a run of digits or of `demibold`s before it fails. Only
 * `it` and `demi` start other words, and neither choice can end where the longer one would not.
 */
function styleWords(key: string): boolean {
  let at = 0;
  while (at < key.length) {
    if (/\d/.test(key[at] ?? "")) {
      while (/\d/.test(key[at] ?? "")) at++;
      continue;
    }
    const word = STYLE_WORDS.find((each) => key.startsWith(each, at));
    if (word === undefined) return false;
    at += word.length;
  }
  return true;
}

/**
 * Whether a name fontspec asks for by name is a family of the tree, or one of its faces: a family
 * of `TREE_FAMILIES` whose file the tree holds. A name longer than MAX_FAMILY_NAME is none.
 */
export function familyInTree(tree: Tree, name: string): boolean {
  if (name.length > MAX_FAMILY_NAME) return false;
  const key = fontKey(name);
  return FAMILY_KEYS.some(
    ([family, file]) =>
      fileInTree(tree, file) &&
      (key === family || (key.startsWith(family) && styleWords(key.slice(family.length)))),
  );
}

/** A font file's name without its folder or extension, in lower case, as the tree is indexed. */
export const fileKey = (name: string) =>
  (name.slice(name.lastIndexOf("/") + 1).replace(FONT_FILE, "") || name).toLowerCase();

/** Whether the tree has a font file of the name, OpenType or TrueType, whatever its extension. */
export const fileInTree = (tree: Tree, name: string) => tree.fontFiles.has(fileKey(name));

/**
 * Font packages whatever the tree holds: those the brief names, roboto, lato, sourcesanspro,
 * fontawesome5, fontawesome, academicons, opensans, montserrat, raleway and fira's, and the
 * common text fonts of TeX Live. A package the tree holds is a font package too when its folder
 * has a namesake holding OpenType or TrueType files (`readTree`).
 */
export const FONT_PACKAGES: ReadonlySet<string> = new Set([
  ...["roboto", "lato", "sourcesanspro", "fontawesome5", "fontawesome", "academicons"],
  ...["opensans", "montserrat", "raleway", "FiraSans", "FiraMono", "sourceserifpro"],
  ...["sourcecodepro", "sourcesans", "lmodern", "times", "mathptmx", "helvet", "courier"],
  ...["palatino", "mathpazo", "avant", "bookman", "charter", "newcent", "utopia", "fourier"],
  ...["kpfonts", "libertine", "libertinus", "ebgaramond", "garamondx", "cabin", "carlito"],
  ...["crimson", "cochineal", "merriweather", "inconsolata", "noto", "noto-serif", "noto-sans"],
  ...["plex-serif", "plex-sans", "plex-mono", "tgpagella", "tgtermes", "tgheros", "tgschola"],
  ...["tgbonum", "tgadventor", "tgcursor", "tgchorus", "newtxtext", "newpxtext", "tempora"],
  ...["XCharter", "DejaVuSans", "DejaVuSerif", "DejaVuSansMono", "dejavu", "bera", "beramono"],
  ...["arev", "cmbright", "marvosym", "gillius", "josefin", "quattrocento", "heuristica"],
  ...["droidsans", "droidserif", "droidsansmono", "inter", "nunito", "worksans", "mlmodern"],
  "simpleicons",
]);

/**
 * fontspec's commands that load a font, and xeCJK's. Each takes the font's name in braces, and
 * options in brackets before it or after.
 */
const FONT_COMMANDS =
  /\\(setmainfont|setsansfont|setmonofont|setromanfont|setmathfont|setboldmathfont|newfontfamily|renewfontfamily|setfontfamily|providefontfamily|newfontface|renewfontface|setfontface|providefontface|fontspec|setCJKmainfont|setCJKsansfont|setCJKmonofont|setCJKfamilyfont|newCJKfontfamily)(?![A-Za-z@])/g;

/** Those that name the command they define first: `\newfontfamily\headerfont{Roboto}`. */
const DEFINE_FONT_COMMANDS = new Set([
  ...["newfontfamily", "renewfontfamily", "setfontfamily", "providefontfamily", "newfontface"],
  ...["renewfontface", "setfontface", "providefontface", "newCJKfontfamily"],
]);

/** A font file's name ends in one of these. */
export const FONT_FILE = /\.(?:otf|ttf|ttc|otc|pfb|pfa)$/i;

/** A value with the braces around the whole of it, if any, taken off. */
function unbraced(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  const inner = group(trimmed, 0);
  return inner && inner.end === trimmed.length ? inner.value.trim() : trimmed;
}

/** fontspec's options as keys and values, split at the commas outside braces. */
function keyValues(options: string): [key: string, value: string][] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < options.length; i++) {
    const char = options[i];
    if (char === "\\") i++;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === "," && depth === 0) {
      items.push(options.slice(start, i));
      start = i + 1;
    }
  }
  items.push(options.slice(start));
  return items.flatMap((item) => {
    const equals = item.indexOf("=");
    return equals < 0 ? [] : [[item.slice(0, equals).trim(), unbraced(item.slice(equals + 1))]];
  });
}

/** A name read from the source that TeX would have to expand first, which the survey cannot. */
const built = (name: string) => name === "" || /[\\#]/.test(name);

/** The most bracketed option groups read for one font command, before its name and after. */
const MAX_OPTION_GROUPS = 4;

/** The longest face's name kept, once each `*` in it is the font's name: none is near it. */
const MAX_FACE = 128;

/**
 * The fonts fontspec loads in a source: the families it asks for by name, and the files. A face's
 * name with a `*` in it is the font's name put in its place, and a face whose name would pass
 * MAX_FACE is dropped, so that a hostile document cannot make a name the square of its length.
 */
export function fontsOf(text: string): { families: string[]; files: string[] } {
  const families: string[] = [];
  const files: string[] = [];
  // `\defaultfontfeatures{Path=...}` or `{Extension=...}` makes every font after it a file.
  let defaults: { path?: string; extension?: string } = {};
  for (const match of text.matchAll(/\\defaultfontfeatures\+?(?![A-Za-z@])/g)) {
    const options = group(text, match.index + match[0].length)?.value ?? "";
    for (const [key, value] of keyValues(options)) {
      if (/^path$/i.test(key)) defaults = { ...defaults, path: value };
      if (/^extension$/i.test(key)) defaults = { ...defaults, extension: value };
    }
  }
  for (const match of text.matchAll(FONT_COMMANDS)) {
    const command = match[1] ?? "";
    let at = match.index + match[0].length;
    const options: string[] = [];
    if (command === "newCJKfontfamily") at = bracketed(text, at)?.end ?? at;
    if (DEFINE_FONT_COMMANDS.has(command)) {
      const defined = /\s*(?:\\[A-Za-z@]+|\{\s*\\[A-Za-z@]+\s*\})/y;
      defined.lastIndex = at;
      if (!defined.exec(text)) continue;
      at = defined.lastIndex;
    }
    if (command === "setCJKfamilyfont") at = group(text, at)?.end ?? at;
    for (
      let option = bracketed(text, at);
      option && options.length < MAX_OPTION_GROUPS;
      option = bracketed(text, at)
    ) {
      options.push(option.value);
      at = option.end;
    }
    const argument = group(text, at);
    if (!argument) continue;
    const after = options.length < MAX_OPTION_GROUPS && bracketed(text, argument.end);
    if (after) options.push(after.value);
    const name = argument.value.trim();
    if (built(name)) continue;
    const pairs = keyValues(options.join(","));
    const value = (key: string) => pairs.find(([each]) => each.toLowerCase() === key)?.[1];
    const path = value("path") ?? defaults.path;
    const extension = value("extension") ?? defaults.extension;
    // UprightFont=*-Regular, BoldFont=..., and Font=... inside FontFace={b}{n}{Font=...}.
    const faces = pairs.flatMap(([key, each]) =>
      /^[A-Za-z]+Font$/.test(key)
        ? [each]
        : [...each.matchAll(/(?:^|[,{\s])Font\s*=\s*([^,{}]+)/g)].map((found) => found[1] ?? ""),
    );
    const face = (each: string) =>
      each.length + (each.split("*").length - 1) * (name.length - 1) > MAX_FACE
        ? ""
        : each.replaceAll("*", name).trim();
    const named = faces.map(face).filter((each) => !built(each));
    const byFile =
      path !== undefined ||
      extension !== undefined ||
      [name, ...named].some((each) => FONT_FILE.test(each));
    if (!byFile) {
      families.push(name, ...named);
      continue;
    }
    // A file's name is its face's, or the font's own when no UprightFont names the upright one.
    const upright = pairs.some(([key]) => key.toLowerCase() === "uprightfont");
    for (const each of upright ? named : [name, ...named])
      files.push(
        FONT_FILE.test(each) || extension === undefined || built(extension)
          ? each
          : `${each}${extension}`,
      );
  }
  return { families, files };
}
