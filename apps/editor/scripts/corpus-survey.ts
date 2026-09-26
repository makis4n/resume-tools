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
 * and their kin, is read as each engine takes it (`readSource`), so that a document whose XeTeX
 * branch loads fontspec and whose pdfTeX branch loads Roboto's Type 1 fonts, as AltaCV's class and
 * sample do, needs either engine; what it names is what either branch names, and what it needs is
 * what its pdfTeX branches need.
 *
 * The tree is its file list alone, the engine's manifest (`readTree`): a class or package is there
 * when a `.cls` or `.sty` of its name is, a font file when an OpenType or TrueType file of its name
 * is, and a family when `TREE_FAMILIES` names it and the tree holds the file it names for it.
 *
 * They are pure functions over text and the tree's file list, so that they can be tested on
 * invented documents; what they return names classes, packages, fonts and commands, and counts,
 * never a document's text.
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
 * its design sizes, "LM Roman 10" and so on; Philokalia; and Sparks. Layout 5 adds Font Awesome 4,
 * Academicons and Simple Icons; Fira Sans and Fira Mono; IBM Plex Sans, Sans Condensed, Serif and
 * Mono; Raleway; and TeX Gyre's nine (decision 0018). A name matches a family when it is the
 * family's name, or that name followed by style words or a design size ("Roboto Light",
 * "SourceSansPro-Bold", "LM Roman 12"), whatever its case, spaces, hyphens and underscores, as
 * fontconfig ignores case and spaces in a family's name.
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
  SimpleIcons: "SimpleIcons.otf",
  "Fira Sans": "FiraSans-Regular.otf",
  "Fira Mono": "FiraMono-Regular.otf",
  "IBM Plex Sans": "IBMPlexSans-Regular.otf",
  "IBM Plex Sans Condensed": "IBMPlexSansCondensed-Regular.otf",
  "IBM Plex Serif": "IBMPlexSerif-Regular.otf",
  "IBM Plex Mono": "IBMPlexMono-Regular.otf",
  Raleway: "Raleway-Regular.otf",
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

/** What may follow a family's name in a name that means one of its faces. */
const STYLE_WORDS =
  /^(?:regular|bold|italic|it|oblique|light|medium|medm|thin|black|heavy|hairline|semibold|smbld|demibold|demi|extrabold|extralight|extlt|ultralight|ultrabold|book|text|solid|normal|upright|roman|\d+)*$/;

/**
 * Whether a name fontspec asks for by name is a family of the tree, or one of its faces: a family
 * of `TREE_FAMILIES` whose file the tree holds.
 */
export function familyInTree(tree: Tree, name: string): boolean {
  const key = fontKey(name);
  return FAMILY_KEYS.some(
    ([family, file]) =>
      (key === family || (key.startsWith(family) && STYLE_WORDS.test(key.slice(family.length)))) &&
      fileInTree(tree, file),
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

/** Which branch of a guard each engine takes: `true` for the first, `false` for the `\else`. */
interface Guard {
  pdftex: boolean;
  xetex: boolean;
}

/**
 * The guard on the engine a conditional is, if it is one, and where its test ends: a conditional
 * whose name names an engine, as `\ifxetex`, `\ifluatex`, `\ifPDFTeX`, `\iftutex` and AltaCV's
 * `\ifxetexorluatex` do, or `\ifdefined`, `\ifcsname` or `\ifx ... \undefined` asked of a command
 * only one engine has, such as `\XeTeXversion`; `\unless` before it turns it round.
 */
function guardOf(
  name: string,
  text: string,
  at: number,
  unless: boolean,
): { guard: Guard; end: number } | undefined {
  let guard: Guard | undefined;
  let end = at;
  const lower = name.toLowerCase();
  if (/xetex|tutex/.test(lower)) guard = { pdftex: false, xetex: true };
  else if (lower.includes("luatex")) guard = { pdftex: false, xetex: false };
  else if (lower.includes("pdftex")) guard = { pdftex: true, xetex: false };
  else if (name === "ifdefined" || name === "ifcsname" || name === "ifx") {
    const probe = name === "ifcsname" ? /\s*([A-Za-z]+)\s*\\endcsname/y : /\s*\\([A-Za-z]+)/y;
    probe.lastIndex = at;
    const found = probe.exec(text);
    const engine = found?.[1] === undefined ? undefined : ENGINE_PROBES[found[1]];
    if (!found || !engine) return undefined;
    end = probe.lastIndex;
    let defined = true;
    if (name === "ifx") {
      const undefinedTest = /\s*\\(?:@?undefined|relax)(?![A-Za-z@])/y;
      undefinedTest.lastIndex = end;
      if (!undefinedTest.exec(text)) return undefined;
      end = undefinedTest.lastIndex;
      defined = false;
    }
    guard = { pdftex: (engine === "pdftex") === defined, xetex: (engine === "xetex") === defined };
  }
  if (!guard) return undefined;
  return { guard: unless ? { pdftex: !guard.pdftex, xetex: !guard.xetex } : guard, end };
}

/** An open conditional as the walk meets it. */
interface Frame {
  start: number;
  /** Where its test ends, which every view drops for a guard, so no probe is read as a need. */
  testEnd: number;
  guard?: Guard;
  /** The branch every engine takes, when the conditional's value is known: `\iffalse`'s `\else`. */
  fixed?: boolean;
  elseStart?: number;
  elseEnd?: number;
}

/** A part of a text, from `start` to before `end`. */
type Span = [start: number, end: number];

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
 * `comment` environments, out of every view; and each guard on the engine's untaken branch out of
 * that engine's view. Conditionals are paired with their `\fi` by counting, as TeX does when it
 * skips a branch: TeX's own, the guards, every `\if` name the source declares with `\newif` or
 * lets to a conditional, and any other `\if` name that no brace follows and the source does not
 * define as a macro, since ifthen's and etoolbox's conditionals take their branches as arguments
 * and end with no `\fi`. A conditional left open at the end closes there.
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

  const dead: Span[] = [];
  const pdftex: Span[] = [];
  const xetex: Span[] = [];
  let guarded = false;
  const stack: Frame[] = [];
  /** How many control words ahead are names being defined or let, not run. */
  let naming = 0;
  let unless = false;
  /** Whether the walk is in a branch no engine takes. */
  const skipping = () =>
    stack.some(
      (frame) => frame.fixed !== undefined && frame.fixed === (frame.elseStart !== undefined),
    );
  const close = (frame: Frame, fiStart: number, fiEnd: number) => {
    if (frame.fixed === false) dead.push([frame.start, frame.elseEnd ?? fiEnd]);
    if (frame.fixed === true && frame.elseStart !== undefined)
      dead.push([frame.elseStart, fiStart]);
    if (!frame.guard) return;
    for (const [taken, spans] of [
      [frame.guard.pdftex, pdftex],
      [frame.guard.xetex, xetex],
    ] as const) {
      spans.push([frame.start, frame.testEnd]);
      if (taken && frame.elseStart !== undefined) spans.push([frame.elseStart, fiStart]);
      if (!taken) spans.push([frame.start, frame.elseEnd ?? fiEnd]);
    }
  };
  for (const word of words) {
    const name = word[1] ?? "";
    const at = word.index;
    const after = at + word[0].length;
    if (naming > 0) {
      naming--;
      continue;
    }
    if (name === "let") naming = 2;
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
        frame.elseStart = at;
        frame.elseEnd = after;
      }
    } else if (name.startsWith("if") && conditional(name, after)) {
      const found = guardOf(name, text, after, unless);
      if (found && !skipping()) guarded = true;
      const value =
        name === "iffalse" ? false : name === "iftrue" ? true : found ? undefined : known.get(name);
      stack.push({
        start: unless ? text.lastIndexOf("\\unless", at) : at,
        testEnd: found?.end ?? after,
        ...(found ? { guard: found.guard } : {}),
        ...(value === undefined ? {} : { fixed: unless ? !value : value }),
      });
    }
    unless = false;
  }
  for (let frame = stack.pop(); frame; frame = stack.pop()) close(frame, text.length, text.length);
  return {
    live: without(text, dead),
    pdftex: without(text, [...dead, ...pdftex]),
    xetex: without(text, [...dead, ...xetex]),
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
 * false, as `\newif` leaves it, when none of them sets it. Any other conditional is left out, and
 * both its branches are read.
 */
export function optionValues(
  files: readonly { text: string; isClass: boolean }[],
  passed: readonly string[],
): Map<string, boolean> {
  const declared = new Set<string>();
  const outside = new Set<string>();
  const options: { name: string; sets: [string, boolean][] }[] = [];
  const defaults: string[] = [];
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
        options.push({ name: name.value.trim(), sets });
      }
      for (const match of text.matchAll(/\\ExecuteOptions(?![A-Za-z@])/g))
        defaults.push(
          ...(group(text, match.index + match[0].length)?.value ?? "")
            .split(",")
            .map((option) => option.trim()),
        );
    }
    for (const match of without(text, spans).matchAll(SETTER)) outside.add(`if${match[1]}`);
  }
  const values = new Map<string, boolean>();
  for (const name of declared) {
    if (outside.has(name) || !options.some((option) => option.sets.some(([set]) => set === name)))
      continue;
    let value = false;
    const run = (option: (typeof options)[number]) => {
      for (const [set, to] of option.sets) if (set === name) value = to;
    };
    for (const option of defaults) for (const each of options) if (each.name === option) run(each);
    for (const each of options) if (passed.includes(each.name)) run(each);
    values.set(name, value);
  }
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

/** The fonts fontspec loads in a source: the families it asks for by name, and the files. */
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
    for (let option = bracketed(text, at); option; option = bracketed(text, at)) {
      options.push(option.value);
      at = option.end;
    }
    const argument = group(text, at);
    if (!argument) continue;
    const after = bracketed(text, argument.end);
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
    const face = (each: string) => each.replaceAll("*", name).trim();
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
  const packagesOf = (view: (file: (typeof read)[number]) => string) => {
    const found = new Map<string, Held>();
    for (const { reference, caller } of loads(view))
      if (reference.kind === "package" && !found.has(reference.name))
        found.set(reference.name, heldAs(reference, caller));
    return found;
  };
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
    const packages = [...packagesOf(view).keys()];
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
  const neededPackages = packagesOf(view);
  const includesGraphics = sources.some((file) => INCLUDES_GRAPHICS.test(view(file)));
  const shellCalls =
    read.some((file) => SHELL_COMMANDS.test(view(file))) ||
    [...neededPackages.keys()].some((name) => SHELL_PACKAGES.has(name));
  const missing = (found: ReadonlyMap<string, Held>) =>
    [...found].filter(([, held]) => held === "missing").map(([name]) => name);

  return {
    id: doc.id,
    family: doc.family,
    class: cls,
    baseClasses: [...baseClassesOf(live)].map(([name, held]) => ({ name, held })),
    packages: [...packages]
      .map(([name, held]) => ({ name, held }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    engine,
    fonts: {
      loading,
      packages: unique(fontPackages),
      families: fonts.families.map((name) => ({ name, inTree: familyInTree(tree, name) })),
      files: fonts.files.map((name) => ({
        name,
        inTree: fileInTree(tree, name),
        shipped: shipped.has(fileKey(name)),
      })),
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
      classes: unique([
        ...(cls?.held === "missing" ? [cls.name] : []),
        ...missing(baseClassesOf(view)),
      ]),
      packages: unique(missing(neededPackages)),
      fonts: unique([
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

/** A name as a table's cell shows it, in code, so that no name can break the table. */
const cell = (name: string) => `\`${name.replaceAll("`", "'").replaceAll("|", "\\|")}\``;

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
 * need that the engine lacks, then the packages and fonts the tree lacks that most documents need,
 * and the classes most use. It names classes, packages, fonts and counts, never a document's text.
 */
export function surveyTable(survey: CorpusSurvey): string {
  const rows = survey.documents;
  const line = (label: string, values: readonly (number | string)[]) =>
    `| ${label} | ${values.join(" | ")} |`;
  const section = (label: string) =>
    line(
      `**${label}**`,
      COLUMNS.map(() => ""),
    );
  const count = (label: string, test: (row: DocumentSurvey) => boolean) =>
    line(label, counts(rows, test));
  const lines = [
    line("", COLUMNS),
    `|---|${COLUMNS.map(() => "--:").join("|")}|`,
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
    ...ranked(rows, (row) => row.needs.packages, TOP_MISSING).map((name) =>
      count(cell(name), (row) => row.needs.packages.includes(name)),
    ),
    section(`Fonts the tree lacks, top ${TOP_MISSING}`),
    ...ranked(rows, (row) => row.needs.fonts, TOP_MISSING).map((name) =>
      count(cell(name), (row) => row.needs.fonts.includes(name)),
    ),
    section(`Classes, top ${TOP_CLASSES}`),
    ...ranked(rows, (row) => (row.class ? [row.class.name] : []), TOP_CLASSES).map((name) =>
      count(cell(name), (row) => row.class?.name === name),
    ),
  ];
  return `${lines.join("\n")}\n`;
}
