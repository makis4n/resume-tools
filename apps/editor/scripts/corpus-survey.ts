/**
 * Surveying the corpus (milestone 3 item 2, decision 0018): what each fetched document asks of the
 * engine and its tree, read from its source without compiling it, which is item 3's.
 *
 * For each document: its class, and every package its files load, each held by the document's
 * own files, by the tree, or by neither; the engine it needs, pdfTeX, XeTeX or LuaTeX, or either
 * when it guards on the engine; how it loads its fonts, through fontspec by a family's name or by a
 * file's, through font packages, or not at all, and whether the tree has each family and file; how
 * many macros and environments it defines, in its main file and sources and in its classes and
 * styles; what it needs that the engine lacks: LuaTeX, a bibliography tool, shell escape, images,
 * and the classes, packages and fonts neither it nor the tree holds; and its size. Then counts of
 * documents, per family and in all, as one Markdown table (`surveyTable`).
 *
 * Code a TeX run never reads is left out first: comments, a `\iffalse` block and a `comment`
 * environment, and the branch a class's options rule out of a conditional only they set
 * (`optionValues`). Code under a conditional on the engine, `\ifxetex`, `\iftutex`, `\ifPDFTeX`
 * and their kin, or under an `\ifnum` or `\ifcase` whose numbers ask them, as pandoc's templates
 * ask `\ifnum 0\ifxetex 1\fi\ifluatex 1\fi=0`, is read as each engine takes it (`readSource`), so
 * that a document whose XeTeX branch loads fontspec and whose pdfTeX branch loads Roboto's Type 1
 * fonts, as AltaCV's class and sample do, needs either engine; what it names is what either branch
 * names, and what it needs is what its pdfTeX branches need. A conditional passed as an argument,
 * as `\ifundef{\iftutex}` passes one, is not one. A package loaded in `\IfFileExists`'s branch for
 * a file that is there is loaded only if present, and no need (`references`).
 *
 * The tree is its file list alone, the engine's manifest (`readTree`): a class or package is there
 * when a `.cls` or `.sty` of its name is, a font file when an OpenType or TrueType file of its name
 * is, and a family when `TREE_FAMILIES` names it and the tree holds the file it names for it.
 *
 * They are pure functions over text and the tree's file list, so that they can be tested on
 * invented documents; what they return names classes, packages, fonts and commands, and counts,
 * never a document's text, and a name only when it is plainly one (`shownName`). Each takes time
 * linear in the length of what it reads, however a hostile document is laid out.
 */

import { resolveReference } from "./corpus-collect.ts";
import {
  type CorpusFile,
  extensionOf,
  FAMILIES,
  type Family,
  type FetchReport,
  type FetchState,
  isLive,
  type LiveDocument,
  type Manifest,
  matchingEntries,
  printable,
} from "./corpus-manifest.ts";
import {
  decode,
  documentClass,
  group,
  type Reference,
  references,
  sha256,
  WINDOW,
  withoutComments,
} from "./corpus-tex.ts";

/** Where a class or package is found: the document's own files, the tree, or neither. */
export type Held = "document" | "tree" | "missing";

/**
 * The engine a document needs: `both` when it guards on the engine and its pdfTeX branches need
 * nothing of XeTeX's or LuaTeX's.
 */
export const ENGINES = ["pdftex", "xetex", "luatex", "both"] as const;
export type Engine = (typeof ENGINES)[number];

/**
 * How a document loads its fonts: through fontspec by a family's name, or by a file's (a file's
 * name, or `Path=` or `Extension=`), through font packages, or `default` when it does none of these.
 * A document may do several.
 */
export const FONT_LOADING = ["fontspec-name", "fontspec-file", "package", "default"] as const;
export type FontLoading = (typeof FONT_LOADING)[number];

/** A class or package a document loads, and where it is found. */
export interface Loaded {
  name: string;
  held: Held;
}

/** A font a document names, a family or a file, and whether the tree has it. */
export interface NamedFont {
  name: string;
  inTree: boolean;
}

/** A font file a document names, and whether the document's folder holds one of its name too. */
export interface NamedFile extends NamedFont {
  shipped: boolean;
}

/** What the survey finds in one document. */
export interface DocumentSurvey {
  id: string;
  family: Family;
  /** Its `\documentclass`, or null when a macro builds the name. */
  class: Loaded | null;
  /** The classes its own classes load with `\LoadClass`. */
  baseClasses: Loaded[];
  /** Every package its files load with `\usepackage` or `\RequirePackage`, in name order. */
  packages: Loaded[];
  /**
   * The packages its engine's branches load only in `\IfFileExists`'s branch for a file that is
   * there, in name order: TeX loads each only when the tree or the document has it, so one the tree
   * lacks is loaded only if present, and no need.
   */
  optional: Loaded[];
  engine: Engine;
  fonts: {
    loading: FontLoading[];
    /** The font packages among its packages. */
    packages: string[];
    /** The families fontspec loads by name, and the files it loads by file. */
    families: NamedFont[];
    files: NamedFile[];
  };
  /**
   * How many `\newcommand`, `\renewcommand`, `\providecommand`, `\NewDocumentCommand`,
   * `\DeclareDocumentCommand`, `\def` and `\newenvironment` its main file and the sources it
   * inputs hold, and how many its classes and styles hold.
   */
  macros: { main: number; styles: number };
  /** What it needs that the engine lacks, on the engine it needs. */
  needs: {
    luatex: boolean;
    /**
     * biber or bibtex, for `\addbibresource`, `\bibliography`, `\printbibliography` or
     * `\bibliographystyle`.
     */
    bibliography: boolean;
    /**
     * `calls` when its code runs a program, through `\write18`, minted and their kin; `hint` when
     * only a comment asks for `-shell-escape`; null when neither.
     */
    shellEscape: "calls" | "hint" | null;
    /**
     * Images: `\includegraphics` in its main file or sources, or images beside it, which the
     * manifest counts; `includesGraphics` and `imageFiles` say which.
     */
    images: boolean;
    includesGraphics: boolean;
    imageFiles: number;
    /** The classes, packages and fonts that neither it nor the tree holds. */
    classes: string[];
    packages: string[];
    fonts: string[];
  };
  /** The main file's bytes and the files fetched; its pages wait for item 3's compile. */
  size: { main: number; files: number; pages: null };
}

/** A document the survey did not read, and why: its fetch state, or its files changed on disk. */
export interface Skipped {
  id: string;
  family: Family;
  state: Exclude<FetchState, "fetched"> | "unreadable";
}

export interface CorpusSurvey {
  documents: DocumentSurvey[];
  skipped: Skipped[];
}

// The tree.

/** The tree as the survey reads it, from the engine's file list. */
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
const fileKey = (name: string) =>
  (name.slice(name.lastIndexOf("/") + 1).replace(FONT_FILE, "") || name).toLowerCase();

/** Whether the tree has a font file of the name, OpenType or TrueType, whatever its extension. */
export const fileInTree = (tree: Tree, name: string) => tree.fontFiles.has(fileKey(name));

// Reading a source as each engine takes it.

/** A source as the survey reads it (`readSource`). */
export interface Reading {
  /** The source with comments and the code TeX never reads, `\iffalse` blocks and the like, out. */
  live: string;
  /** The live source with the branches of each guard on the engine that pdfTeX does not take out. */
  pdftex: string;
  /** The same for XeTeX. */
  xetex: string;
  /** Whether the live source guards on the engine. */
  guarded: boolean;
}

/** TeX's own conditionals, which are conditionals whatever follows them. */
const PRIMITIVE_CONDITIONALS = new Set([
  ...["if", "ifcat", "ifnum", "ifdim", "ifodd", "ifvmode", "ifhmode", "ifmmode", "ifinner"],
  ...["ifvoid", "ifhbox", "ifvbox", "ifx", "ifeof", "iftrue", "iffalse", "ifcase", "ifdefined"],
  ...["ifcsname", "iffontchar", "ifincsname", "ifpdfprimitive", "ifprimitive", "ifpdfabsnum"],
  "ifpdfabsdim",
]);

/**
 * Conditionals written as macros, which take their branches as arguments and end with no `\fi`:
 * ifthen's, xifthen's, etoolbox's and biblatex's; and `\iff`, the symbol, which is no conditional at
 * all. Any other `\if` name a brace follows is taken for one too, unless the source declares it
 * with `\newif`.
 */
const MACRO_CONDITIONALS = new Set([
  ...["ifthenelse", "ifempty", "ifbool", "iftoggle", "ifboolexpr", "ifboolexpe", "ifblank"],
  ...["ifstrequal", "ifstrempty", "ifdef", "ifundef", "ifcsdef", "ifcsundef", "ifdefmacro"],
  ...["ifcsmacro", "ifdefparam", "ifcsparam", "ifdefprefix", "ifcsprefix", "ifdefprotected"],
  ...["ifcsprotected", "ifdefltxprotect", "ifcsltxprotect", "ifdefempty", "ifcsempty"],
  ...["ifdefvoid", "ifcsvoid", "ifdefequal", "ifcsequal", "ifdefstring", "ifcsstring"],
  ...["ifdefstrequal", "ifcsstrequal", "ifdefcounter", "ifcscounter", "ifltxcounter"],
  ...["ifdeflength", "ifcslength", "ifdefdimen", "ifcsdimen", "ifnumcomp", "ifnumequal"],
  ...["ifnumgreater", "ifnumless", "ifnumodd", "ifdimcomp", "ifdimequal", "ifdimgreater"],
  ...["ifdimless", "ifinlist", "ifinlistcs", "ifrmnum", "ifpatchable", "iffieldundef"],
  ...["iflistundef", "ifnameundef", "iffieldequals", "iffieldequalstr", "ifentrytype"],
  ...["ifcategory", "ifkeyword", "ifmtarg", "ifcommandkey", "iff"],
]);

/** The commands whose next control word is a name they define, not one they run. */
const DEFINERS = new Set([
  ...["def", "gdef", "edef", "xdef", "newif", "newcommand", "renewcommand", "providecommand"],
  ...["DeclareRobustCommand", "NewDocumentCommand", "RenewDocumentCommand"],
  ...["ProvideDocumentCommand", "DeclareDocumentCommand", "newrobustcmd", "renewrobustcmd"],
  "providerobustcmd",
]);

/** The engines' own commands, which only the engine that has them defines. */
const ENGINE_PROBES: Readonly<Record<string, "pdftex" | "xetex" | "luatex">> = {
  XeTeXversion: "xetex",
  XeTeXrevision: "xetex",
  directlua: "luatex",
  luatexversion: "luatex",
  luatexrevision: "luatex",
  pdftexversion: "pdftex",
  pdftexrevision: "pdftex",
};

/** The engines `readSource` gives a view for; LuaTeX's is the live source, every branch read. */
const VIEWS = ["pdftex", "xetex"] as const;
type View = (typeof VIEWS)[number];

/** A conditional's first branch, which TeX takes when its test holds, and its `\else`. */
const FIRST = 0;
const ELSE = -1;

/**
 * Which branch of a guard each engine takes: FIRST, the `\else` (ELSE), or for an `\ifcase` the
 * case of that number, whose `\else` is also taken for a number no case has.
 */
type Guard = Readonly<Record<View, number>>;

/** A guard on the engine, and where its test ends. */
interface Found {
  guard: Guard;
  end: number;
}

/**
 * The guard on the engine a conditional is, if it is one, and where its test ends: one that asks
 * the engine (`engineTest`), or an `\ifnum` or `\ifcase` whose numbers do (`numberGuard`).
 * `\unless` before it turns it round.
 */
function guardOf(name: string, text: string, at: number, unless: boolean): Found | undefined {
  if (name === "ifnum" || name === "ifcase") return numberGuard(name, text, at, unless);
  const test = engineTest(name, text, at);
  if (!test) return undefined;
  const branch = (holds: boolean) => (holds !== unless ? FIRST : ELSE);
  return {
    guard: { pdftex: branch(test.holds.pdftex), xetex: branch(test.holds.xetex) },
    end: test.end,
  };
}

/**
 * Whether each engine finds a conditional that asks the engine true, and where its test ends: a
 * conditional whose name names an engine, as `\ifxetex`, `\ifluatex`, `\ifPDFTeX`, `\iftutex` and
 * AltaCV's `\ifxetexorluatex` do, or `\ifdefined`, `\ifcsname` or `\ifx ... \undefined` asked of
 * a command only one engine has, such as `\XeTeXversion`. Undefined for any other.
 */
function engineTest(
  name: string,
  text: string,
  at: number,
): { holds: Record<View, boolean>; end: number } | undefined {
  const lower = name.toLowerCase();
  if (/xetex|tutex/.test(lower)) return { holds: { pdftex: false, xetex: true }, end: at };
  if (lower.includes("luatex")) return { holds: { pdftex: false, xetex: false }, end: at };
  if (lower.includes("pdftex")) return { holds: { pdftex: true, xetex: false }, end: at };
  if (name !== "ifdefined" && name !== "ifcsname" && name !== "ifx") return undefined;
  const probe = name === "ifcsname" ? /\s*([A-Za-z]+)\s*\\endcsname/y : /\s*\\([A-Za-z]+)/y;
  probe.lastIndex = at;
  const found = probe.exec(text)?.[1];
  const engine =
    found !== undefined && Object.hasOwn(ENGINE_PROBES, found) ? ENGINE_PROBES[found] : undefined;
  if (!engine) return undefined;
  let end = probe.lastIndex;
  let defined = true;
  if (name === "ifx") {
    const undefinedTest = /\s*\\(?:@?undefined|relax)(?![A-Za-z@])/y;
    undefinedTest.lastIndex = end;
    if (!undefinedTest.exec(text)) return undefined;
    end = undefinedTest.lastIndex;
    defined = false;
  }
  return {
    holds: { pdftex: (engine === "pdftex") === defined, xetex: (engine === "xetex") === defined },
    end,
  };
}

/** How far past an `\ifnum` or `\ifcase` its numbers are read for the engine, in characters. */
const TEST_WINDOW = 128;

/** How deep engine conditionals in a test's numbers are read inside one another. */
const MAX_NESTED = 8;

/**
 * An `\ifnum` or `\ifcase` whose numbers ask the engine, as pandoc's templates' `\ifnum
 * 0\ifxetex 1\fi\ifluatex 1\fi=0` does, read as each engine reads it: each engine conditional in
 * its numbers reduced to the branch the engine takes, `\ifxetex 1\fi` to `1` on XeTeX and to
 * nothing on pdfTeX, then `<integer> <relation> <integer>`, or `\ifcase`'s one integer, read from
 * what is left as TeX reads it; each engine takes the branch its numbers give. Undefined when the
 * numbers hold no engine conditional, or anything but digits, signs, spaces, a relation and
 * engine conditionals whose branches hold the same, such as a register or a macro, which TeX
 * would have to read or expand; and when they do not end within TEST_WINDOW characters.
 */
function numberGuard(
  name: "ifnum" | "ifcase",
  text: string,
  at: number,
  unless: boolean,
): Found | undefined {
  if (name === "ifcase" && unless) return undefined;
  const stop = Math.min(text.length, at + TEST_WINDOW);
  const guard: Record<View, number> = { pdftex: ELSE, xetex: ELSE };
  let end = at;
  for (const engine of VIEWS) {
    const asked = { engine: false };
    const chars = testChars(text, at, stop, engine, undefined, asked, 0);
    const test = readNumbers(chars, name === "ifnum" ? 2 : 1, at);
    if (!test || !asked.engine || (test.end >= stop && stop < text.length)) return undefined;
    end = Math.max(end, test.end);
    const [a = 0, b = 0] = test.numbers;
    if (name === "ifcase") guard[engine] = a >= 0 ? a : ELSE;
    else {
      const holds = test.relation === "<" ? a < b : test.relation === ">" ? a > b : a === b;
      guard[engine] = holds !== unless ? FIRST : ELSE;
    }
  }
  return { guard, end };
}

/**
 * A character of a test's numbers as an engine reads it, and the index where what it came from
 * ends: `""` for an engine conditional read to its `\fi`, which TeX reads through as it looks for
 * more digits, and `undefined` for anything else, a control word, a brace or a letter, which ends
 * a number, or the test when it still wants one.
 */
interface TestChar {
  char: string | undefined;
  end: number;
}

/**
 * The characters an engine reads from `from` to `to` as it reads a test's numbers: a run of spaces
 * as one, and none after a control word, as TeX's input does; and each engine conditional read as
 * the branch the engine takes of it, whose characters end, for the test, where the conditional
 * does (`whole`), since TeX reads a conditional to its `\fi`. `asked` records that one was met.
 * Returns whether it stopped at something else.
 */
function* testChars(
  text: string,
  from: number,
  to: number,
  engine: View,
  whole: number | undefined,
  asked: { engine: boolean },
  depth: number,
): Generator<TestChar, boolean> {
  let at = from;
  while (at < to) {
    const char = text[at] ?? "";
    if (/\s/.test(char)) {
      let lines = 0;
      for (; at < to && /\s/.test(text[at] ?? ""); at++) if (text[at] === "\n") lines++;
      // A blank line is TeX's `\par`, which ends a number.
      if (lines > 1) {
        yield { char: undefined, end: at };
        return true;
      }
      yield { char: " ", end: whole ?? at };
    } else if (/[\d+\-<=>]/.test(char)) {
      at++;
      yield { char, end: whole ?? at };
    } else {
      const nested = depth < MAX_NESTED ? engineConditional(text, at, to) : undefined;
      if (!nested) {
        yield { char: undefined, end: at };
        return true;
      }
      asked.engine = true;
      const [start, end] = nested.branch(engine);
      if (yield* testChars(text, start, end, engine, whole ?? nested.end, asked, depth + 1))
        return true;
      at = afterSpaces(text, nested.end, to);
      yield { char: "", end: whole ?? at };
    }
  }
  return false;
}

/**
 * The engine conditional at `at`, read to its `\fi` before `to`: where it ends, and the part of it
 * each engine reads, the branch it takes after the spaces TeX drops after a control word.
 * Undefined when there is none there, or its `\fi` is not before `to`.
 */
function engineConditional(
  text: string,
  at: number,
  to: number,
): { end: number; branch: (engine: View) => Span } | undefined {
  const word = /\\([A-Za-z@]+)/y;
  word.lastIndex = at;
  const name = word.exec(text)?.[1];
  const test = name === undefined ? undefined : engineTest(name, text, word.lastIndex);
  if (!test) return undefined;
  const parts = conditionalParts(text, test.end, to);
  if (!parts) return undefined;
  const { elseStart, elseEnd, fiStart, fiEnd } = parts;
  return {
    end: fiEnd,
    branch: (engine) =>
      test.holds[engine]
        ? [afterSpaces(text, test.end, to), elseStart ?? fiStart]
        : elseEnd === undefined
          ? [fiStart, fiStart]
          : [afterSpaces(text, elseEnd, to), fiStart],
  };
}

/**
 * The `\else` and the `\fi` of a conditional whose test ends at `from`, before `to`, paired as TeX
 * pairs them when it skips a branch, by counting the conditionals between.
 */
function conditionalParts(
  text: string,
  from: number,
  to: number,
): { elseStart?: number; elseEnd?: number; fiStart: number; fiEnd: number } | undefined {
  let depth = 0;
  let found: Span | undefined;
  for (const match of text.slice(from, to).matchAll(/\\([A-Za-z@]+)/g)) {
    const name = match[1] ?? "";
    const start = from + match.index;
    const end = start + match[0].length;
    if (name === "fi" && depth === 0)
      return {
        ...(found ? { elseStart: found[0], elseEnd: found[1] } : {}),
        fiStart: start,
        fiEnd: end,
      };
    if (name === "fi") depth--;
    else if (name === "else" && depth === 0) found ??= [start, end];
    else if (name.startsWith("if") && !MACRO_CONDITIONALS.has(name)) depth++;
  }
  return undefined;
}

/**
 * `count` integers read from a test's characters as TeX reads them, the relation between two, and
 * the index where the last one's source ends: a number is spaces and signs, then digits, read up to
 * the first thing that is not one, through every conditional on the way, and one space after it.
 * Undefined when they are not there to read.
 */
function readNumbers(
  chars: Iterator<TestChar, boolean>,
  count: 1 | 2,
  start: number,
): { numbers: number[]; relation: string | undefined; end: number } | undefined {
  let end = start;
  let next = chars.next();
  const peek = () => (next.done ? undefined : next.value.char);
  const take = () => {
    if (!next.done) end = next.value.end;
    next = chars.next();
  };
  const numbers: number[] = [];
  let relation: string | undefined;
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      while (peek() === " " || peek() === "") take();
      relation = peek();
      if (relation !== "<" && relation !== "=" && relation !== ">") return undefined;
      take();
    }
    let sign = 1;
    for (let char = peek(); char === " " || char === "" || char === "+" || char === "-"; ) {
      if (char === "-") sign = -sign;
      take();
      char = peek();
    }
    let digits = "";
    for (let char = peek(); char !== undefined && (char === "" || /\d/.test(char)); ) {
      digits += char;
      take();
      char = peek();
    }
    // More than nine digits would pass TeX's largest number.
    if (digits === "" || digits.length > 9) return undefined;
    numbers.push(sign * Number(digits));
    if (peek() === " ") take();
  }
  return { numbers, relation, end };
}

/** The index after the spaces at `at`, looking no further than `to`. */
function afterSpaces(text: string, at: number, to: number): number {
  while (at < to && /\s/.test(text[at] ?? "")) at++;
  return at;
}

/** How far past a `\csname` its `\endcsname` is looked for, in characters. */
const CSNAME_WINDOW = 256;

/** The index after the `\endcsname` ending a name begun at `at`, if one does within the window. */
function csnameEnd(text: string, at: number): number | undefined {
  const found = text.slice(at, at + CSNAME_WINDOW).search(/\\endcsname(?![A-Za-z@])/);
  return found < 0 ? undefined : at + found + "\\endcsname".length;
}

/**
 * The index after the token at `at`, after any spaces: a control word, a name `\csname` builds, a
 * control symbol, or a character.
 */
function tokenEnd(text: string, at: number): number {
  const start = afterSpaces(text, at, text.length);
  const token = /\\(?:([A-Za-z@]+)|[^])/y;
  token.lastIndex = start;
  const match = token.exec(text);
  if (!match) return Math.min(start + 1, text.length);
  if (match[1] === "csname") return csnameEnd(text, token.lastIndex) ?? token.lastIndex;
  return token.lastIndex;
}

/**
 * Where what a primitive conditional tests ends: the command `\ifdefined` asks after, the two
 * tokens `\ifx` compares, the name `\ifcsname` builds. They are tested, not run, so a conditional
 * among them, as in `\ifdefined\ifxetex`, opens none.
 */
function testedUpTo(name: string, text: string, at: number): number {
  if (name === "ifdefined") return tokenEnd(text, at);
  if (name === "ifx") return tokenEnd(text, tokenEnd(text, at));
  if (name === "ifcsname") return csnameEnd(text, at) ?? at;
  return at;
}

/** An open conditional as the walk meets it. */
interface Frame {
  start: number;
  /**
   * Where its test ends, which every view drops for a guard, so no probe is read as a need, and
   * whose words the walk passes over.
   */
  testEnd: number;
  guard?: Guard;
  /** The branch every engine takes, when the conditional's value is known: `\iffalse`'s `\else`. */
  fixed?: boolean;
  /** An `\ifcase`'s `\or`s, each of which starts its next case. */
  ors?: Span[];
  elseStart?: number;
  elseEnd?: number;
}

/** A part of a text, from `start` to before `end`. */
type Span = [start: number, end: number];

/** Whether the walk, at a frame, is in its branch no engine takes. */
const inDeadBranch = (frame: Frame) =>
  frame.fixed !== undefined && frame.fixed === (frame.elseStart !== undefined);

/**
 * The part of a conditional an engine keeps when it takes a branch: the first, an `\ifcase`'s
 * case of that number, or the `\else`; none when the conditional has no such branch.
 */
function branchOf(frame: Frame, taken: number, fiStart: number): Span | undefined {
  const ors = frame.ors ?? [];
  if (taken >= 0 && taken <= ors.length)
    return [
      taken === 0 ? frame.testEnd : (ors[taken - 1]?.[1] ?? frame.testEnd),
      ors[taken]?.[0] ?? frame.elseStart ?? fiStart,
    ];
  return frame.elseEnd === undefined ? undefined : [frame.elseEnd, fiStart];
}

/** A text with the spans taken out, each left as a space, so no two words run together. */
function without(text: string, spans: readonly Span[]): string {
  const sorted = [...spans].sort(([a], [b]) => a - b);
  let out = "";
  let at = 0;
  for (const [start, end] of sorted) {
    if (end <= at) continue;
    out += `${text.slice(at, Math.max(at, start))} `;
    at = Math.max(at, end);
  }
  return out + text.slice(at);
}

/**
 * Read a source as TeX's engines would: comments out; the branch no engine takes of a conditional
 * whose value is known, `\iffalse`'s first and `\iftrue`'s `\else`, and those `known` gives, and
 * `comment` environments, out of every view; and each guard on the engine's untaken branches out of
 * that engine's view. Conditionals are paired with their `\fi` by counting, as TeX does when it
 * skips a branch: TeX's own, the guards, every `\if` name the source declares with `\newif` or
 * lets to a conditional, and any other `\if` name that no brace follows and the source does not
 * define as a macro, since ifthen's and etoolbox's conditionals take their branches as arguments
 * and end with no `\fi`. A conditional passed as an argument opens none: one that is a group's
 * whole content, as in `\ifundef{\iftutex}`, but for TeX's own, since `{\iffalse}\fi` balances a
 * brace; one a primitive conditional tests (`testedUpTo`); and one in a name `\csname` builds. A
 * conditional left open at the end closes there.
 */
export function readSource(tex: string, known: ReadonlyMap<string, boolean> = new Map()): Reading {
  const text = withoutComments(tex).replace(
    /\\begin\s*\{comment\}[\s\S]*?(?:\\end\s*\{comment\}|$)/g,
    (block) => " ".repeat(block.length),
  );
  const declared = new Set<string>();
  const macros = new Set<string>();
  const words = [...text.matchAll(/\\([A-Za-z@]+)/g)];
  for (const [i, word] of words.entries()) {
    const next = words[i + 1]?.[1];
    if (next === undefined) continue;
    if (word[1] === "newif") declared.add(next);
    else if (word[1] === "let" && PRIMITIVE_CONDITIONALS.has(words[i + 2]?.[1] ?? ""))
      declared.add(next);
    else if (DEFINERS.has(word[1] ?? "")) macros.add(next);
  }
  const conditional = (name: string, after: number) => {
    if (PRIMITIVE_CONDITIONALS.has(name) || declared.has(name) || known.has(name)) return true;
    if (/xetex|luatex|pdftex|tutex/i.test(name)) return true;
    if (macros.has(name) || MACRO_CONDITIONALS.has(name)) return false;
    return !/^\s*\{/.test(text.slice(after, after + 64));
  };
  const argument = (name: string, at: number, after: number) =>
    !PRIMITIVE_CONDITIONALS.has(name) &&
    /\{\s*$/.test(text.slice(Math.max(0, at - 64), at)) &&
    /^\s*\}/.test(text.slice(after, after + 64));

  const dead: Span[] = [];
  const cut: Record<View, Span[]> = { pdftex: [], xetex: [] };
  let guarded = false;
  const stack: Frame[] = [];
  /** How many control words ahead are names being defined or let, not run. */
  let naming = 0;
  let unless = false;
  /** Where the walk takes up again, past a test's or a name's words, none of which runs. */
  let resume = 0;
  /** How many open conditionals the walk is in a branch of that no engine takes. */
  let deadDepth = 0;
  const close = (frame: Frame, fiStart: number, fiEnd: number) => {
    if (inDeadBranch(frame)) deadDepth--;
    if (frame.fixed === false) dead.push([frame.start, frame.elseEnd ?? fiEnd]);
    if (frame.fixed === true && frame.elseStart !== undefined)
      dead.push([frame.elseStart, fiStart]);
    if (!frame.guard) return;
    for (const engine of VIEWS) {
      const kept = branchOf(frame, frame.guard[engine], fiStart);
      if (kept) cut[engine].push([frame.start, kept[0]], [kept[1], fiEnd]);
      else cut[engine].push([frame.start, fiEnd]);
    }
  };
  for (const word of words) {
    const at = word.index;
    if (at < resume) continue;
    const name = word[1] ?? "";
    const after = at + word[0].length;
    if (name === "csname") {
      resume = csnameEnd(text, after) ?? after;
      if (naming > 0) naming--;
    } else if (naming > 0) naming--;
    else if (name === "let") naming = 2;
    else if (DEFINERS.has(name)) naming = 1;
    else if (name === "unless") {
      unless = true;
      continue;
    } else if (name === "fi") {
      const frame = stack.pop();
      if (frame) close(frame, at, after);
    } else if (name === "else") {
      const frame = stack.at(-1);
      if (frame && frame.elseStart === undefined) {
        if (inDeadBranch(frame)) deadDepth--;
        frame.elseStart = at;
        frame.elseEnd = after;
        if (inDeadBranch(frame)) deadDepth++;
      }
    } else if (name === "or") {
      const frame = stack.at(-1);
      if (frame?.ors && frame.elseStart === undefined) frame.ors.push([at, after]);
    } else if (name.startsWith("if") && conditional(name, after) && !argument(name, at, after)) {
      const found = guardOf(name, text, after, unless);
      if (found && deadDepth === 0) guarded = true;
      const value =
        name === "iffalse" ? false : name === "iftrue" ? true : found ? undefined : known.get(name);
      const frame: Frame = {
        start: unless ? text.lastIndexOf("\\unless", at) : at,
        testEnd: found?.end ?? testedUpTo(name, text, after),
        ...(found ? { guard: found.guard } : {}),
        ...(value === undefined ? {} : { fixed: unless ? !value : value }),
        ...(name === "ifcase" ? { ors: [] } : {}),
      };
      stack.push(frame);
      if (inDeadBranch(frame)) deadDepth++;
      resume = frame.testEnd;
    }
    unless = false;
  }
  for (let frame = stack.pop(); frame; frame = stack.pop()) close(frame, text.length, text.length);
  return {
    live: without(text, dead),
    pdftex: without(text, [...dead, ...cut.pdftex]),
    xetex: without(text, [...dead, ...cut.xetex]),
    guarded,
  };
}

/** A conditional set by name: `\@academiconstrue` sets `\if@academicons`. */
const SETTER = /\\([A-Za-z@]+)(true|false)(?![A-Za-z@])/g;

/** ifthen's way of setting a conditional `\newif` declared: `\setboolean{name}{true}`. */
const SET_BOOLEAN = /\\setboolean\s*\{\s*([A-Za-z@]+)\s*\}/g;

/** The options `\documentclass` passes, by name. */
export function classOptions(tex: string): string[] {
  const text = withoutComments(tex);
  const match = /\\documentclass(?![A-Za-z@])/.exec(text);
  const options = match && bracketed(text, match.index + match[0].length);
  return (options?.value ?? "")
    .split(",")
    .map((option) => option.replace(/=.*$/s, "").trim())
    .filter((option) => option !== "");
}

/**
 * The values a class's options give the conditionals only its options set: each conditional the
 * document's files declare with `\newif` that a `\DeclareOption` of one of its classes sets true or
 * false, and that nothing outside an option's code sets, by name or through `\setboolean`. Its
 * value is what the options the class runs leave it: those it names in `\ExecuteOptions`, then
 * those the document passes, in the order the class declares them, as `\ProcessOptions` runs them;
 * false, as `\newif` leaves it, when none of them sets it. An option declared twice runs its last
 * code, where it was last declared, as LaTeX keeps it. Any other conditional is left out, and both
 * its branches are read.
 *
 * Each option's code runs once, so that this takes time linear in the declarations, defaults and
 * options however many there are: running the defaults in turn leaves each conditional what the
 * last of them to set it sets, which is what running each once, in the order of the last time it
 * is named, leaves it.
 */
export function optionValues(
  files: readonly { text: string; isClass: boolean }[],
  passed: readonly string[],
): Map<string, boolean> {
  const declared = new Set<string>();
  const outside = new Set<string>();
  /** What each option's code sets, by the option's name, in the order of its last declaration. */
  const options = new Map<string, [string, boolean][]>();
  /** The options `\ExecuteOptions` names, in the order of the last time it names each. */
  const defaults = new Set<string>();
  for (const file of files) {
    const text = withoutComments(file.text);
    for (const match of text.matchAll(/\\newif\s*\\(if[A-Za-z@]+)/g))
      if (match[1]) declared.add(match[1]);
    for (const match of text.matchAll(SET_BOOLEAN)) outside.add(`if${match[1]}`);
    const spans: Span[] = [];
    if (file.isClass) {
      for (const match of text.matchAll(/\\DeclareOption(?![A-Za-z@*])/g)) {
        const name = group(text, match.index + match[0].length);
        const code = name && group(text, name.end);
        if (!name || !code) continue;
        spans.push([match.index, code.end]);
        const sets = [...code.value.matchAll(SETTER)].map((set): [string, boolean] => [
          `if${set[1]}`,
          set[2] === "true",
        ]);
        options.delete(name.value.trim());
        options.set(name.value.trim(), sets);
      }
      for (const match of text.matchAll(/\\ExecuteOptions(?![A-Za-z@])/g))
        for (const option of (group(text, match.index + match[0].length)?.value ?? "").split(",")) {
          defaults.delete(option.trim());
          defaults.add(option.trim());
        }
    }
    for (const match of without(text, spans).matchAll(SETTER)) outside.add(`if${match[1]}`);
  }
  const setByOptions = new Set([...options.values()].flatMap((sets) => sets.map(([name]) => name)));
  const values = new Map<string, boolean>();
  for (const name of declared)
    if (!outside.has(name) && setByOptions.has(name)) values.set(name, false);
  const run = (sets: readonly [string, boolean][]) => {
    for (const [name, to] of sets) if (values.has(name)) values.set(name, to);
  };
  for (const option of defaults) run(options.get(option) ?? []);
  const given = new Set(passed);
  for (const [option, sets] of options) if (given.has(option)) run(sets);
  return values;
}

// What a source needs.

/**
 * Packages that need XeTeX, or LuaTeX with fontspec: fontspec, polyglossia and xeCJK, and the
 * others of their kind; and academicons, which sets its icons in the TU encoding alone, which
 * pdfTeX does not have.
 */
const XETEX_PACKAGES = new Set([
  ...["fontspec", "polyglossia", "xeCJK", "xltxtra", "xunicode", "mathspec", "unicode-math"],
  ...["bidi", "xgreek", "xepersian", "realscripts", "xetexko", "fontsetup", "xeCJKfntef"],
  ...["xecolor", "academicons"],
]);

/** XeTeX's primitives, but for the version tests guards make, and fontspec's and xeCJK's commands. */
const XETEX_COMMANDS =
  /\\(?:XeTeX(?!version|revision)[a-z][A-Za-z]*|setmainfont|setsansfont|setmonofont|setromanfont|setmathfont|setboldmathfont|newfontfamily|renewfontfamily|setfontfamily|providefontfamily|newfontface|renewfontface|setfontface|providefontface|fontspec|defaultfontfeatures|addfontfeatures?|setCJK(?:main|sans|mono|family)font|newCJKfontfamily|setmainlanguage|setdefaultlanguage|setotherlanguages?)(?![A-Za-z@])/;

/** Packages that need LuaTeX. */
const LUATEX_PACKAGES = new Set([
  ...["luacode", "luatexbase", "luatextra", "luaotfload", "lualatex-math", "luamplib"],
  ...["luacolor", "lua-ul", "luatexja", "luatexja-fontspec", "luatexja-preset", "luabidi"],
  ...["selnolig", "luavlna", "lua-visual-debug", "luaquotes", "pyluatex", "emoji"],
  "lua-widow-control",
]);

/** LuaTeX's primitives, but for the version tests guards make, and luacode's environments. */
const LUATEX_COMMANDS =
  /\\(?:directlua|luaexec|luadirect|latelua|luaescapestring|begin\s*\{luacode\*?\})(?![A-Za-z@])/;

const BIBLIOGRAPHY =
  /\\(?:addbibresource|bibliography|printbibliography|bibliographystyle)(?![A-Za-z@])/;

/** Commands and packages that run programs, which shell escape allows. */
const SHELL_COMMANDS = /\\(?:write18|ShellEscape|tikzexternalize)(?![A-Za-z@])/;
const SHELL_PACKAGES = new Set([
  ...["minted", "svg", "gnuplottex", "pythontex", "markdown", "auto-pst-pdf", "pstool"],
  "shellesc",
]);
/** A comment asking for shell escape, as `% !TEX options = -shell-escape` does. */
const SHELL_HINT = /-shell-escape|-enable-write18/;

const INCLUDES_GRAPHICS = /\\includegraphics(?![A-Za-z@])/;

const DEFINITIONS =
  /\\(?:newcommand|renewcommand|providecommand|NewDocumentCommand|DeclareDocumentCommand|def|newenvironment)(?![A-Za-z@])/g;

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
const FONT_FILE = /\.(?:otf|ttf|ttc|otc|pfb|pfa)$/i;

/** The bracketed argument at `at`, after any spaces, and the index after it, if there is one. */
function bracketed(text: string, at: number): { value: string; end: number } | undefined {
  const stop = Math.min(text.length, at + WINDOW);
  let start = at;
  while (start < stop && /\s/.test(text[start] ?? "")) start++;
  if (text[start] !== "[") return undefined;
  let depth = 0;
  for (let i = start + 1; i < stop; i++) {
    const char = text[i];
    if (char === "\\") i++;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === "]" && depth <= 0) return { value: text.slice(start + 1, i), end: i + 1 };
  }
  return undefined;
}

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

// A document.

/** The files a class or package of the document is found in: its own `.cls` and `.sty`. */
const STYLE_EXTENSIONS = new Set([".cls", ".sty", ".def", ".clo", ".fd"]);

const unique = (names: readonly string[]) => [...new Set(names)].sort();

/** What the survey shows for a name it will not print (`shownName`). */
export const UNPRINTABLE = "(unprintable name)";

/**
 * A name as the survey prints it and writes it: letters, digits, spaces and `._/+-`, at most 64
 * characters, which every class, package, font and command name the corpus gives fits. Any other
 * is shown as UNPRINTABLE and counted all the same, so that no line break, pipe or run of a
 * document's text a hostile source puts in a name reaches the table or the JSON.
 */
export function shownName(name: string): string {
  return /^[A-Za-z0-9 ._/+-]{1,64}$/.test(name) ? name : UNPRINTABLE;
}

/** Items in name order, once each, their names as shown (`shownName`). */
function shown<T extends { name: string }>(items: readonly T[]): T[] {
  const kept = new Map<string, T>();
  for (const item of items) {
    const each = { ...item, name: shownName(item.name) };
    kept.set(JSON.stringify(each), each);
  }
  return [...kept.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Names in order, once each, as shown (`shownName`). */
const shownNames = (names: readonly string[]) => unique(names.map(shownName));

/** A document's file as the survey reads it. */
export interface SourceFile {
  path: string;
  text: string;
}

/**
 * Survey one document from its files, the main file first, as the manifest lists them, and the
 * tree.
 */
export function surveyDocument(
  doc: LiveDocument,
  files: readonly SourceFile[],
  tree: Tree,
): DocumentSurvey {
  const paths = new Set(doc.files.map((file) => file.path));
  const texts = files.filter((file) => extensionOf(file.path) !== ".bib");
  const mainText = texts.find((file) => file.path === doc.main)?.text ?? "";
  const known = optionValues(
    texts.map((file) => ({ text: file.text, isClass: extensionOf(file.path) === ".cls" })),
    classOptions(mainText),
  );
  const read = texts.map((file) => ({ ...file, reading: readSource(file.text, known) }));
  const guarded = read.some((file) => file.reading.guarded);

  // What a view of the document loads: its packages, and the classes its classes load.
  const loads = (view: (file: (typeof read)[number]) => string) =>
    read.flatMap((file) =>
      references(view(file)).map((reference) => ({ reference, caller: file.path })),
    );
  const heldAs = (reference: Reference, caller: string): Held => {
    if (resolveReference(reference, caller, doc.main, paths) !== undefined) return "document";
    const extension = reference.kind === "class" ? ".cls" : ".sty";
    const file = reference.name.endsWith(extension)
      ? reference.name
      : `${reference.name}${extension}`;
    return !file.includes("/") && tree.styles.has(file) ? "tree" : "missing";
  };
  // Each package, where it is, and whether it is loaded only if present: every load of it is in
  // `\IfFileExists`'s branch for a file that is there, so TeX loads it only when it is not missing.
  const packagesOf = (view: (file: (typeof read)[number]) => string) => {
    const found = new Map<string, { held: Held; optional: boolean }>();
    for (const { reference, caller } of loads(view)) {
      if (reference.kind !== "package") continue;
      const seen = found.get(reference.name);
      if (seen) seen.optional &&= reference.optional === true;
      else
        found.set(reference.name, {
          held: heldAs(reference, caller),
          optional: reference.optional === true,
        });
    }
    return found;
  };
  /** The packages TeX loads of those: all but the ones loaded only if present that are missing. */
  const loadedOf = (view: (file: (typeof read)[number]) => string) =>
    [...packagesOf(view)]
      .filter(([, each]) => !each.optional || each.held !== "missing")
      .map(([name]) => name);
  const baseClassesOf = (view: (file: (typeof read)[number]) => string) => {
    const found = new Map<string, Held>();
    for (const { reference, caller } of loads(view))
      if (
        reference.kind === "class" &&
        extensionOf(caller) === ".cls" &&
        !found.has(reference.name)
      )
        found.set(reference.name, heldAs(reference, caller));
    return found;
  };

  // The engine: what the pdfTeX branches need, and failing pdfTeX, what the XeTeX ones need.
  const needsOf = (view: (file: (typeof read)[number]) => string) => {
    const packages = loadedOf(view);
    return {
      xetex:
        packages.some((name) => XETEX_PACKAGES.has(name)) ||
        read.some((file) => XETEX_COMMANDS.test(view(file))),
      luatex:
        packages.some((name) => LUATEX_PACKAGES.has(name)) ||
        read.some((file) => LUATEX_COMMANDS.test(view(file))),
    };
  };
  const onPdftex = needsOf((file) => file.reading.pdftex);
  const onXetex = needsOf((file) => file.reading.xetex);
  const engine: Engine =
    !onPdftex.xetex && !onPdftex.luatex
      ? guarded
        ? "both"
        : "pdftex"
      : !onXetex.luatex
        ? "xetex"
        : "luatex";
  // What it needs is read in the view of its engine: pdfTeX's for either, XeTeX's for XeTeX.
  const view = (file: (typeof read)[number]) =>
    engine === "xetex"
      ? file.reading.xetex
      : engine === "luatex"
        ? file.reading.live
        : file.reading.pdftex;
  const live = (file: (typeof read)[number]) => file.reading.live;

  const main = read.find((file) => file.path === doc.main);
  const className = main ? documentClass(main.reading.live) : undefined;
  const cls: Loaded | null =
    className === undefined
      ? null
      : { name: className, held: heldAs({ kind: "class", name: className }, doc.main) };

  const packages = packagesOf(live);
  const fontPackages = [...packages.keys()].filter(
    (name) => FONT_PACKAGES.has(name) || tree.fontPackages.has(name),
  );
  const shipped = new Set(doc.assets.map(fileKey));
  const fontsIn = (select: (file: (typeof read)[number]) => string) => {
    const found = read.map((file) => fontsOf(select(file)));
    return {
      families: unique(found.flatMap((each) => each.families)),
      files: unique(found.flatMap((each) => each.files)),
    };
  };
  const fonts = fontsIn(live);
  const loading: FontLoading[] = [];
  if (fonts.families.length > 0) loading.push("fontspec-name");
  if (fonts.files.length > 0) loading.push("fontspec-file");
  if (fontPackages.length > 0) loading.push("package");
  if (loading.length === 0) loading.push("default");

  const sources = read.filter((file) => !STYLE_EXTENSIONS.has(extensionOf(file.path)));
  const styles = read.filter((file) => STYLE_EXTENSIONS.has(extensionOf(file.path)));
  const definitions = (files: typeof read) =>
    files.reduce((sum, file) => sum + (file.reading.live.match(DEFINITIONS)?.length ?? 0), 0);

  const needed = fontsIn(view);
  const neededPackages = [...packagesOf(view)];
  const includesGraphics = sources.some((file) => INCLUDES_GRAPHICS.test(view(file)));
  const shellCalls =
    read.some((file) => SHELL_COMMANDS.test(view(file))) ||
    loadedOf(view).some((name) => SHELL_PACKAGES.has(name));
  const missing = (found: ReadonlyMap<string, Held>) =>
    [...found].filter(([, held]) => held === "missing").map(([name]) => name);

  return {
    id: doc.id,
    family: doc.family,
    class: cls && { name: shownName(cls.name), held: cls.held },
    baseClasses: shown([...baseClassesOf(live)].map(([name, held]) => ({ name, held }))),
    packages: shown([...packages].map(([name, { held }]) => ({ name, held }))),
    optional: shown(
      neededPackages
        .filter(([, { optional }]) => optional)
        .map(([name, { held }]) => ({ name, held })),
    ),
    engine,
    fonts: {
      loading,
      packages: shownNames(fontPackages),
      families: shown(fonts.families.map((name) => ({ name, inTree: familyInTree(tree, name) }))),
      files: shown(
        fonts.files.map((name) => ({
          name,
          inTree: fileInTree(tree, name),
          shipped: shipped.has(fileKey(name)),
        })),
      ),
    },
    macros: { main: definitions(sources), styles: definitions(styles) },
    needs: {
      luatex: engine === "luatex",
      bibliography: read.some((file) => BIBLIOGRAPHY.test(view(file))),
      shellEscape: shellCalls
        ? "calls"
        : sources.some((file) => SHELL_HINT.test(file.text))
          ? "hint"
          : null,
      images: includesGraphics || doc.images > 0,
      includesGraphics,
      imageFiles: doc.images,
      classes: shownNames([
        ...(cls?.held === "missing" ? [cls.name] : []),
        ...missing(baseClassesOf(view)),
      ]),
      packages: shownNames(
        neededPackages
          .filter(([, { held, optional }]) => held === "missing" && !optional)
          .map(([name]) => name),
      ),
      fonts: shownNames([
        ...needed.families.filter((name) => !familyInTree(tree, name)),
        ...needed.files.filter((name) => !fileInTree(tree, name)),
      ]),
    },
    size: { main: doc.files[0]?.bytes ?? 0, files: doc.files.length, pages: null },
  };
}

// The corpus.

export interface SurveyOptions {
  manifest: Manifest;
  /** The last fetch's report; a document it does not mark fetched is skipped. */
  report: FetchReport | undefined;
  tree: Tree;
  /** A document's file as the fetch wrote it, or undefined when it cannot be read. */
  read: (doc: LiveDocument, file: CorpusFile) => Uint8Array | undefined;
}

/**
 * Survey every document the last fetch marks fetched, in the manifest's order; the others, and one
 * whose file is gone or differs from its hash, are counted apart and skipped. A withdrawn document
 * is no longer the corpus's and is neither.
 */
export function surveyCorpus(options: SurveyOptions): CorpusSurvey {
  const { manifest, tree } = options;
  const entries = matchingEntries(manifest, options.report);
  const documents: DocumentSurvey[] = [];
  const skipped: Skipped[] = [];
  for (const doc of manifest.documents.filter(isLive)) {
    const state = entries.get(doc.id)?.state ?? "pending";
    if (state !== "fetched") {
      skipped.push({ id: doc.id, family: doc.family, state });
      continue;
    }
    const sources: SourceFile[] = [];
    for (const file of doc.files) {
      const bytes = options.read(doc, file);
      if (!bytes || bytes.length !== file.bytes || sha256(bytes) !== file.sha256) break;
      sources.push({ path: file.path, text: decode(bytes) });
    }
    if (sources.length < doc.files.length)
      skipped.push({ id: doc.id, family: doc.family, state: "unreadable" });
    else documents.push(surveyDocument(doc, sources, tree));
  }
  return { documents, skipped };
}

// The table.

/** The table's columns: each family, then all of them. */
const COLUMNS = [...FAMILIES, "all"] as const;

/**
 * The last column's heading, which a package's row fills: of all the documents, how many load it
 * only if present (`DocumentSurvey.optional`), where the others count those that need it.
 */
const OPTIONAL_COLUMN = "loaded only if present";

/** A name as a table's cell shows it, in code; the table ranks and counts names as shown. */
const cell = (name: string) => `\`${name}\``;

/** Whether a document lacks nothing of the engine's: no class, package or font, and not LuaTeX. */
export const lacksNothing = (row: DocumentSurvey) =>
  row.needs.classes.length === 0 &&
  row.needs.packages.length === 0 &&
  row.needs.fonts.length === 0 &&
  !row.needs.luatex;

/** The packages a document loads only if present that the tree lacks, as shown. */
const optionalMissing = (row: DocumentSurvey) =>
  row.optional.filter(({ held }) => held === "missing").map(({ name }) => shownName(name));

/** The packages, fonts and classes a document names, as shown (`shownName`). */
const neededPackages = (row: DocumentSurvey) => row.needs.packages.map(shownName);
const neededFonts = (row: DocumentSurvey) => row.needs.fonts.map(shownName);
const className = (row: DocumentSurvey) => (row.class ? [shownName(row.class.name)] : []);

/** How many of the documents, of each family and in all, a test is true of. */
function counts<T extends { family: Family }>(rows: readonly T[], test: (row: T) => boolean) {
  return COLUMNS.map(
    (column) =>
      rows.filter((row) => (column === "all" || row.family === column) && test(row)).length,
  );
}

/** The names the documents give, most documents first, then by name, the first `top`. */
function ranked(
  rows: readonly DocumentSurvey[],
  namesOf: (row: DocumentSurvey) => string[],
  top: number,
) {
  const tally = new Map<string, number>();
  for (const row of rows)
    for (const name of new Set(namesOf(row))) tally.set(name, (tally.get(name) ?? 0) + 1);
  return [...tally]
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, top)
    .map(([name]) => name);
}

/** How many top packages and fonts the tree lacks, and top classes, the table lists. */
export const TOP_MISSING = 25;
export const TOP_CLASSES = 10;

const ENGINE_LABELS: Readonly<Record<Engine, string>> = {
  pdftex: "Engine: pdfTeX",
  xetex: "Engine: XeTeX",
  luatex: "Engine: LuaTeX",
  both: "Engine: either, guarded on the engine",
};

const LOADING_LABELS: Readonly<Record<FontLoading, string>> = {
  "fontspec-name": "Fonts: fontspec, by name",
  "fontspec-file": "Fonts: fontspec, by file",
  package: "Fonts: font packages",
  default: "Fonts: none loaded",
};

/**
 * The survey as one Markdown table of documents, per family and in all: how many were surveyed and
 * skipped, the engines, how fonts are loaded (a document may load them several ways), what they
 * need that the engine lacks and how many lack nothing, then the packages the tree lacks that most
 * documents load, with how many need each and how many load it only if present, the fonts the tree
 * lacks that most need, and the classes most use. It names classes, packages, fonts and counts,
 * never a document's text, and each line is one line, whatever a name holds (`printable`).
 */
export function surveyTable(survey: CorpusSurvey): string {
  const rows = survey.documents;
  const line = (label: string, values: readonly (number | string)[], last: number | string = "") =>
    `| ${label} | ${[...values, last].join(" | ")} |`;
  const section = (label: string) =>
    line(
      `**${label}**`,
      COLUMNS.map(() => ""),
    );
  const count = (label: string, test: (row: DocumentSurvey) => boolean) =>
    line(label, counts(rows, test));
  const lines = [
    line("", COLUMNS, OPTIONAL_COLUMN),
    `|---|${[...COLUMNS, OPTIONAL_COLUMN].map(() => "--:").join("|")}|`,
    count("Documents surveyed", () => true),
    line(
      "Skipped: not fetched, or changed on disk",
      counts(survey.skipped, () => true),
    ),
    ...ENGINES.map((engine) => count(ENGINE_LABELS[engine], (row) => row.engine === engine)),
    ...FONT_LOADING.map((kind) =>
      count(LOADING_LABELS[kind], (row) => row.fonts.loading.includes(kind)),
    ),
    count("Needs a class the tree lacks", (row) => row.needs.classes.length > 0),
    count("Needs a package the tree lacks", (row) => row.needs.packages.length > 0),
    count("Needs a font the tree lacks", (row) => row.needs.fonts.length > 0),
    count("Needs LuaTeX", (row) => row.needs.luatex),
    count("Lacks nothing: no class, package or font the tree lacks, nor LuaTeX", lacksNothing),
    count("Needs biber or bibtex", (row) => row.needs.bibliography),
    count("Needs shell escape", (row) => row.needs.shellEscape !== null),
    count("Needs shell escape only by a comment's hint", (row) => row.needs.shellEscape === "hint"),
    count(
      "Has images: calls `\\includegraphics` or has image files beside it",
      (row) => row.needs.images,
    ),
    count(
      "Calls `\\includegraphics` in its main file or sources",
      (row) => row.needs.includesGraphics,
    ),
    section(`Packages the tree lacks, top ${TOP_MISSING}`),
    ...ranked(rows, (row) => [...neededPackages(row), ...optionalMissing(row)], TOP_MISSING).map(
      (name) =>
        line(
          cell(name),
          counts(rows, (row) => neededPackages(row).includes(name)),
          rows.filter((row) => optionalMissing(row).includes(name)).length,
        ),
    ),
    section(`Fonts the tree lacks, top ${TOP_MISSING}`),
    ...ranked(rows, neededFonts, TOP_MISSING).map((name) =>
      count(cell(name), (row) => neededFonts(row).includes(name)),
    ),
    section(`Classes, top ${TOP_CLASSES}`),
    ...ranked(rows, className, TOP_CLASSES).map((name) =>
      count(cell(name), (row) => className(row).includes(name)),
    ),
  ];
  return `${lines.map(printable).join("\n")}\n`;
}
