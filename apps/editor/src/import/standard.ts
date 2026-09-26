/**
 * The parser's table of standard commands (milestone 3 item 4, decision 0020): what LaTeX and the
 * packages every resume leans on define, which the parser reads without asking the engine, and
 * what it makes of each. Everything a body uses that this table does not know goes to the engine
 * (`signatures.ts`), which says what it is and what arguments it takes.
 *
 * A command here is one of three things. Rich text: an escape, a symbol, an accent, a mark such as
 * `\textbf`, a declaration such as `\bfseries` inside a group, a link, or `\\` inside a paragraph,
 * which the parser decodes into the model's `RichText` (`richtext.ts`). Structure: a section's
 * title or a list's item. Or a command with an effect that is not text, a space, a rule, a colour,
 * a size, a box, which stays raw, byte for byte: of those, the ones whose argument is text a page
 * shows, as a coloured word or a box's contents, name that argument (`content`), so that the
 * parser places what is inside it. An environment is a list, a block whose body the parser
 * places, such as `center`, or raw, such as `tabular`.
 *
 * The argument specifications are xparse's, as unified-latex reads them. Those of LaTeX's kernel,
 * xcolor, hyperref, multicol and geometry come from unified-latex's CTAN table, but where it
 * differs from what LaTeX does, which is said beside each change.
 */

import { environmentInfo, macroInfo } from "@unified-latex/unified-latex-ctan";

/** Which of the model's marks a text command or a declaration sets. */
export type Mark = "bold" | "italic" | "emph" | "none";

/** What the parser makes of a standard command. */
export type Role =
  /** Text with no argument: an escape, a symbol, a letter, `~`'s kin. */
  | { kind: "symbol"; text: string }
  /** An accent over its one argument, composed: a combining mark, or `alone` over nothing. */
  | { kind: "accent"; mark: string; alone: string }
  /** Its one argument as rich text with a mark: `\textbf`, `\textit`, `\emph`, `\textsc`. */
  | { kind: "mark"; mark: Mark }
  /** The rest of the group with a mark: `\bfseries`, `\bf`, `\itshape`, `\it`, `\em`. */
  | { kind: "declaration"; mark: Mark }
  /** `\href{url}{text}`: the text as a link. */
  | { kind: "link" }
  /** `\url{x}` and `\nolinkurl{x}`: the address as its own text, a link or not. */
  | { kind: "address"; link: boolean }
  /** `\\`: a space inside a paragraph, since a field is one paragraph. */
  | { kind: "break" }
  /** `\section` and its kin, at their depth: `\part` -1, `\chapter` 0, `\section` 1, and so on. */
  | { kind: "section"; level: number }
  /** `\item`. */
  | { kind: "item" }
  /** A definition in TeX's own syntax, `\def\x#1{...}` or `\let\x\y`, which no spec describes. */
  | { kind: "definition" }
  /** A primitive or a parameter that takes a TeX quantity, as `\vskip 2pt` or `\parindent=0pt`. */
  | { kind: "quantity" }
  /** A command whose effect is not text; `content` names the arguments that hold text. */
  | { kind: "raw"; content?: readonly number[] };

/** A standard command: its argument specification and its role. */
export interface Standard {
  spec: string;
  role: Role;
}

/** What the parser makes of a standard environment. */
export type EnvironmentRole = "list" | "block" | "raw";

export interface StandardEnvironment {
  spec: string;
  role: EnvironmentRole;
}

/** The escapes, symbols and letters the parser decodes, by command. */
const SYMBOLS: Readonly<Record<string, string>> = {
  "&": "&",
  "%": "%",
  $: "$",
  "#": "#",
  _: "_",
  "{": "{",
  "}": "}",
  // A control space is the space between words.
  " ": " ",
  // A thin space, U+2009, for want of one the model sets exactly.
  ",": " ",
  textbackslash: "\\",
  textbullet: "•",
  // The generator writes these for characters TeX reads as something else (decision 0007).
  textasciitilde: "~",
  textasciicircum: "^",
  textless: "<",
  textgreater: ">",
  textbar: "|",
  textunderscore: "_",
  textendash: "–",
  textemdash: "—",
  ldots: "…",
  dots: "…",
  textellipsis: "…",
  textquoteleft: "‘",
  textquoteright: "’",
  textquotedblleft: "“",
  textquotedblright: "”",
  ss: "ß",
  ae: "æ",
  AE: "Æ",
  oe: "œ",
  OE: "Œ",
  aa: "å",
  AA: "Å",
  o: "ø",
  O: "Ø",
  l: "ł",
  L: "Ł",
  i: "ı",
  j: "ȷ",
  // The generator's break inside a long run of text (decision 0007), and a word's hyphenation
  // point, which set no text of their own.
  allowbreak: "",
  "-": "",
};

/**
 * LaTeX's accent commands: the combining mark each puts over, or under, its argument, and what it
 * sets over nothing, as `\^{}` sets a circumflex. `\t` ties two letters, and goes after the first.
 */
const ACCENTS: Readonly<Record<string, readonly [mark: string, alone: string]>> = {
  "`": ["̀", "`"],
  "'": ["́", "´"],
  "^": ["̂", "^"],
  "~": ["̃", "~"],
  "=": ["̄", "¯"],
  u: ["̆", "˘"],
  ".": ["̇", "˙"],
  '"': ["̈", "¨"],
  r: ["̊", "˚"],
  H: ["̋", "˝"],
  v: ["̌", "ˇ"],
  c: ["̧", "¸"],
  k: ["̨", "˛"],
  d: ["̣", "."],
  b: ["̱", "_"],
  t: ["͡", "͡"],
};

const MARKS: Readonly<Record<string, Mark>> = {
  textbf: "bold",
  textit: "italic",
  emph: "emph",
  textsc: "none",
};

const DECLARATIONS: Readonly<Record<string, Mark>> = {
  bfseries: "bold",
  bf: "bold",
  itshape: "italic",
  it: "italic",
  em: "emph",
};

const SECTIONS: Readonly<Record<string, number>> = {
  part: -1,
  chapter: 0,
  section: 1,
  subsection: 2,
  subsubsection: 3,
  paragraph: 4,
  subparagraph: 5,
};

/**
 * Commands with an effect that is not text and no argument: spacing, breaks, sizes, font
 * switches outside the declarations above, and TeX's own that take nothing.
 */
const BARE: readonly string[] = [
  ...["vfill", "hfill", "hfil", "vfil", "hss", "vss", "smallskip", "medskip", "bigskip"],
  ...["smallbreak", "medbreak", "bigbreak", "noindent", "indent", "par", "newline", "newpage"],
  ...["clearpage", "cleardoublepage", "centering", "raggedright", "raggedleft", "nobreak"],
  ...["break", "strut", "relax", "ignorespaces", "unskip", "leavevmode", "null", "protect"],
  ...["quad", "qquad", "enspace", "enskip", "thinspace", "negthinspace", "space", "hrule"],
  ...["vrule", "hline", "@", "/", "LaTeX", "TeX", "LaTeXe", "today", "maketitle"],
  ...["tableofcontents", "appendix", "columnbreak", "sloppy", "fussy", "frenchspacing"],
  ...["nonfrenchspacing", "normalfont", "rmfamily", "sffamily", "ttfamily", "mdseries"],
  ...["upshape", "slshape", "scshape", "rm", "sf", "tt", "sl", "sc", "md", "up", "tiny"],
  ...["scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge"],
  ...["Huge", "selectfont", "nopagecolor", "restoregeometry", "makeatletter", "makeatother"],
  ...["egroup", "bgroup", "begingroup", "endgroup", "normalcolor", "baselinestretch"],
  "arraystretch",
];

/**
 * Commands with an effect that is not text and arguments CTAN's table lacks, or has wrong, with
 * the arguments that hold text a page shows.
 */
const RAW: Readonly<Record<string, Standard>> = {
  fontsize: raw("m m"),
  fontfamily: raw("m"),
  fontseries: raw("m"),
  fontshape: raw("m"),
  fontencoding: raw("m"),
  usefont: raw("m m m m"),
  linespread: raw("m"),
  // CTAN's table gives `\enlargethispage` a star and no length.
  enlargethispage: raw("s m"),
  // CTAN's table gives `\label` an optional argument, which only cleveref adds.
  label: raw("m"),
  newgeometry: raw("m"),
  twocolumn: raw("o"),
  onecolumn: raw("o"),
  pagebreak: raw("o"),
  printbibliography: raw("o"),
  hyphenation: raw("m"),
  selectlanguage: raw("m"),
  foreignlanguage: raw("o m m", [2]),
  MakeUppercase: raw("m", [0]),
  MakeLowercase: raw("m", [0]),
  uppercase: raw("m", [0]),
  lowercase: raw("m", [0]),
  textrm: raw("m", [0]),
  textsf: raw("m", [0]),
  texttt: raw("m", [0]),
  textup: raw("m", [0]),
  textmd: raw("m", [0]),
  textsl: raw("m", [0]),
  textnormal: raw("m", [0]),
  underline: raw("m", [0]),
  mbox: raw("m", [0]),
  fbox: raw("m", [0]),
  makebox: raw("d() o o m", [3]),
  framebox: raw("o o m", [2]),
  parbox: raw("o o o m m", [4]),
  raisebox: raw("m o o m", [3]),
  textcolor: raw("o m m", [2]),
  colorbox: raw("o m m", [2]),
  fcolorbox: raw("o m o m m", [4]),
  footnote: raw("o m", [1]),
  marginpar: raw("o m", [1]),
  hyperlink: raw("m m", [1]),
  hypertarget: raw("m m", [1]),
  texorpdfstring: raw("m m", [0]),
  // Definitions in LaTeX's syntax, whose body is code, not text.
  newcommand: raw("s m o o m"),
  renewcommand: raw("s m o o m"),
  providecommand: raw("s m o o m"),
  DeclareRobustCommand: raw("s m o o m"),
  newenvironment: raw("s m o o m m"),
  renewenvironment: raw("s m o o m m"),
  NewDocumentCommand: raw("m m m"),
  RenewDocumentCommand: raw("m m m"),
  ProvideDocumentCommand: raw("m m m"),
  DeclareDocumentCommand: raw("m m m"),
  NewDocumentEnvironment: raw("m m m m"),
  // What a body names that `\begin` and `\end` left unmatched.
  begin: raw("m"),
  end: raw("m"),
};

function raw(spec: string, content?: readonly number[]): Standard {
  return { spec, role: content === undefined ? { kind: "raw" } : { kind: "raw", content } };
}

/** TeX's own definitions, whose syntax no argument specification describes. */
const DEFINITIONS: readonly string[] = ["def", "edef", "gdef", "xdef", "let", "futurelet"];

/**
 * TeX's primitives and parameters that take a quantity, a dimension, glue or a number, after them
 * and an optional `=`: the parser keeps the quantity in the command's raw chunk. A LaTeX length or
 * counter the engine reports as a register takes one the same way (`signatures.ts`).
 */
export const QUANTITIES: ReadonlySet<string> = new Set([
  ...["hskip", "vskip", "kern", "mkern", "mskip", "penalty", "hbox", "vbox", "vtop", "raise"],
  ...["lower", "moveleft", "moveright", "setbox", "parindent", "parskip", "baselineskip"],
  ...["lineskip", "lineskiplimit", "hsize", "vsize", "leftskip", "rightskip", "parfillskip"],
  ...["tabskip", "topskip", "hangindent", "hangafter", "emergencystretch", "hfuzz", "vfuzz"],
  ...["hbadness", "vbadness", "tolerance", "pretolerance", "looseness", "linepenalty"],
  ...["clubpenalty", "widowpenalty", "spaceskip", "xspaceskip", "tabcolsep", "arrayrulewidth"],
  ...["itemsep", "parsep", "topsep"],
  ...["partopsep", "labelsep", "labelwidth", "leftmargin", "rightmargin", "itemindent"],
  ...["listparindent", "columnsep", "columnseprule", "textwidth", "linewidth", "textheight"],
  ...["fboxsep", "fboxrule", "multicolsep", "footskip", "headsep", "headheight"],
]);

/** The standard packages whose specifications come from CTAN's table. */
const CTAN_PACKAGES = ["latex2e", "xcolor", "hyperref", "multicol", "geometry"] as const;

/**
 * Every standard command, by name: CTAN's table for the packages above, as raw commands; then this
 * file's roles and corrections over it.
 */
export const STANDARD: ReadonlyMap<string, Standard> = (() => {
  const table = new Map<string, Standard>();
  for (const pkg of CTAN_PACKAGES)
    for (const [name, info] of Object.entries(macroInfo[pkg]))
      table.set(name, raw(info.signature ?? ""));
  for (const name of BARE) table.set(name, raw(""));
  for (const [name, standard] of Object.entries(RAW)) table.set(name, standard);
  for (const [name, text] of Object.entries(SYMBOLS))
    table.set(name, { spec: "", role: { kind: "symbol", text } });
  for (const [name, [mark, alone]] of Object.entries(ACCENTS))
    table.set(name, { spec: "m", role: { kind: "accent", mark, alone } });
  for (const [name, mark] of Object.entries(MARKS))
    table.set(name, { spec: "m", role: { kind: "mark", mark } });
  for (const [name, mark] of Object.entries(DECLARATIONS))
    table.set(name, { spec: "", role: { kind: "declaration", mark } });
  for (const [name, level] of Object.entries(SECTIONS))
    table.set(name, { spec: "s o m", role: { kind: "section", level } });
  for (const name of DEFINITIONS) table.set(name, { spec: "", role: { kind: "definition" } });
  for (const name of QUANTITIES) table.set(name, { spec: "", role: { kind: "quantity" } });
  table.set("href", { spec: "o m m", role: { kind: "link" } });
  table.set("url", { spec: "m", role: { kind: "address", link: true } });
  table.set("nolinkurl", { spec: "m", role: { kind: "address", link: false } });
  // `\\` looks for its star and its length past spaces, as `\@ifstar` and `\@ifnextchar` do,
  // where CTAN's table has it look for neither.
  table.set("\\", { spec: "s o", role: { kind: "break" } });
  table.set("item", { spec: "o", role: { kind: "item" } });
  return table;
})();

/**
 * Every standard environment, by name: lists, blocks whose body the parser places, and raw ones,
 * CTAN's table giving the arguments where it has them.
 */
export const STANDARD_ENVIRONMENTS: ReadonlyMap<string, StandardEnvironment> = (() => {
  const table = new Map<string, StandardEnvironment>();
  const spec = (name: string) => {
    for (const pkg of CTAN_PACKAGES) {
      const info = (environmentInfo[pkg] as Record<string, { signature?: string }>)[name];
      if (info !== undefined) return info.signature ?? "";
    }
    return "";
  };
  for (const name of ["itemize", "enumerate", "description"])
    table.set(name, { spec: "o", role: "list" });
  for (const name of ["center", "flushleft", "flushright", "quote", "quotation", "verse"])
    table.set(name, { spec: "", role: "block" });
  table.set("minipage", { spec: spec("minipage"), role: "block" });
  table.set("multicols", { spec: spec("multicols"), role: "block" });
  table.set("multicols*", { spec: spec("multicols*"), role: "block" });
  for (const name of [
    ...["tabular", "tabular*", "tabularx", "tabulary", "longtable", "array", "table"],
    ...["table*", "figure", "figure*", "tabbing", "picture", "tikzpicture", "thebibliography"],
    ...["filecontents", "filecontents*", "abstract", "titlepage", "wrapfigure", "list"],
    ...["trivlist", "math", "displaymath", "equation", "equation*", "align", "align*"],
  ])
    table.set(name, { spec: spec(name), role: "raw" });
  return table;
})();

/**
 * Names the engine is never asked about beside the table's: LaTeX's scratch macros, whose meaning
 * is whatever was put in them last, and would make any macro that names one read differently in
 * every document.
 */
export const SCRATCH: readonly string[] = [
  ...["reserved@a", "reserved@b", "reserved@c", "reserved@d", "reserved@e", "reserved@f"],
  ...["@tempa", "@tempb", "@tempc", "@gtempa", "@let@token", "next", "@currname", "@currext"],
  ...["@filelist", "@toodeep", "@tempswatrue", "@tempswafalse", "@ifdefinable"],
];
