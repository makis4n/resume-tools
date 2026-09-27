/**
 * The naming request, built in the browser (milestone 3 item 6, plan section 6 step 4, decision
 * 0024): what an import sends the naming step about its template, from the body's tree
 * (`parse.ts`), the engine's signatures and definitions (`signatures.ts`), the probe's verdicts
 * (`probe.ts`) and the preamble. Nothing of the resume's text goes: the request holds the
 * template's definitions, masked; the probe's verdict on each argument; call sites whose every
 * letter is `x` or `X` and every digit `0`, outside the names of commands; and the preamble's
 * settings, masked but for numbers, units, colours and known keywords.
 *
 * The request is built for each template macro and environment the body calls or opens, and each
 * the preamble calls to store the header's text (`isSetter`): its signature, its definition and
 * the definitions of its closure, data by name alone (decision 0020), its key (`keyOf`), what the
 * probe found of each argument, and up to three of its calls, the ones whose arguments differ most.
 *
 * Definitions are masked by pattern, emails, links and phone numbers, before item 4 hashes them
 * (`maskDefinition`); what a pattern misses, the person's name wrapped in `\mbox`, a bare domain, a
 * phone written with `\,`, is masked here by the document's own values, in the simple form item
 * 11 finishes: every stretch of a definition that spells, spaces and commands aside, a text of the
 * body's, a date, a raw chunk's words, a header value or a text the preamble stores, and every word
 * of it that is a word of the person's header or stored text, is replaced by its placeholder. A
 * definition that masking changes is sent with the hash of what is sent, so that no hash of the
 * person's text leaves the browser; its key, and its dependents', are then the document's own.
 *
 * `assertNoText` checks a request against a document by the same rules, and throws, naming where
 * but never what, when any of the document's text is in it.
 */

import {
  type CallSite,
  type Dependency,
  datePlaceholder,
  type FamilyHint,
  keyOf,
  maskDefinition,
  NAMING_VERSION,
  NamingRequest,
  placeholder,
  REQUEST_CAPS,
  type RequestArgument,
  type RequestDefinition,
  type RequestMacro,
  type RequestPreamble,
  sha256,
} from "@resume-tools/naming";
import { readSpec } from "./arguments";
import {
  type Argument,
  bodyOfText,
  buildTree,
  type DateNode,
  type Node,
  readBody,
  type Tree,
} from "./parse";
import type { Probe } from "./probe";
import type { EngineSignatures, Signature } from "./signatures";
import { STANDARD } from "./standard";

// The document's own values.

/** The header's values, as item 7 finds them in a document, which mask what leaves as its text. */
export interface HeaderValues {
  first?: string;
  last?: string;
  headline?: string;
  email?: string;
  phone?: string;
  location?: string;
  links?: readonly { label?: string; href?: string }[];
}

/**
 * A document's text, as the leak check and the masking read it: the body's tree, whose text runs,
 * link addresses, dates and raw chunks are the person's; the header's values, when found; and the
 * texts the preamble stores, as Awesome-CV's `\name{...}{...}` does, the probe's candidates there.
 */
export interface DocumentText {
  tree: Tree;
  header?: HeaderValues;
  stored?: readonly string[];
}

/** What a text of the document's is, as a leak names it. */
type Origin = "text" | "link" | "date" | "raw" | "header" | "stored";

/** A text of the document's, as it is matched: its letters and digits, each folded. */
interface Needle {
  /** Its characters, each a code point folded (`fold`). */
  chars: string[];
  origin: Origin;
}

/** The document's texts, folded, by their first MIN_NEEDLE characters. */
interface Strings {
  byPrefix: Map<string, Needle[]>;
}

/**
 * A character as the matchers read it: its base letter, its accents taken off, in lower case; or
 * nothing, for anything but a letter or a digit. TeX writes `&` as `\&`, `é` as `\'e` and an en
 * dash as `--`, so the matchers read letters and digits alone, and a text of the document's is
 * found in a definition however the definition's source writes its punctuation and accents.
 */
function fold(char: string): string {
  const base = char.normalize("NFD");
  const first = String.fromCodePoint(base.codePointAt(0) ?? 0);
  if (!/^[\p{L}\p{N}]$/u.test(first)) return "";
  const lowered = first.toLowerCase();
  return [...lowered].length === 1 ? lowered : first;
}

/** A text as the matchers read it: its letters and digits, folded (`fold`), in order. */
function folded(text: string): string {
  let out = "";
  for (const char of text) out += fold(char);
  return out;
}

/** How many letters and digits a text holds. */
const alphanumerics = (text: string) => (text.match(/[\p{L}\p{N}]/gu) ?? []).length;

/**
 * Whether a folded text could be a placeholder: only `x` and `0`, so that looking for it would
 * find every call site. Nothing of it can leak.
 */
const placeholderLike = (text: string) => /^[x0]*$/.test(text);

/** The least letters and digits a text of the document's holds for the matchers to look for it. */
const MIN_NEEDLE = 3;

/**
 * The shortest text the matchers look for anywhere: one shorter, a first name of three letters
 * among them, is found only as whole words, so that `Tom` never masks `bottom` in a class's
 * definition, which would give the class's macro a key of the document's own.
 */
const ANYWHERE = 6;

/** A command at a place: an environment's `\begin` or `\end` with its name, a word or a symbol. */
const COMMAND = /\\(?:begin|end)\s*\{[A-Za-z@*]*\}|\\[A-Za-z@]+|\\[\s\S]?/uy;

/**
 * A raw chunk's stretches of text: what lies between its commands, braces, TeX's special
 * characters and comments, trimmed, which TeX may set as text.
 */
function rawPieces(source: string): string[] {
  const pieces: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim() !== "") pieces.push(current.trim());
    current = "";
  };
  for (let i = 0; i < source.length; ) {
    const char = source[i] ?? "";
    if (char === "%") {
      flush();
      const newline = source.indexOf("\n", i);
      i = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (char === "\\") {
      flush();
      COMMAND.lastIndex = i;
      i += Math.max(1, COMMAND.exec(source)?.[0].length ?? 1);
      continue;
    }
    if ("{}[]$&#^_".includes(char)) {
      flush();
      i++;
      continue;
    }
    current += char;
    i++;
  }
  flush();
  return pieces;
}

/** Every node of a tree, arguments' content and raw chunks' placed arguments among them. */
function* nodesOf(nodes: readonly Node[]): Generator<Node> {
  for (const node of nodes) {
    yield node;
    switch (node.kind) {
      case "section":
      case "call":
        for (const arg of node.args) if (arg.content !== undefined) yield* nodesOf(arg.content);
        break;
      case "list":
      case "item":
      case "environment":
      case "block":
        for (const arg of node.args) if (arg.content !== undefined) yield* nodesOf(arg.content);
        yield* nodesOf(node.content);
        break;
      case "group":
        yield* nodesOf(node.content);
        break;
      case "raw":
        for (const arg of node.args ?? [])
          if (arg.content !== undefined) yield* nodesOf(arg.content);
        break;
      default:
        break;
    }
  }
}

/**
 * Whether a text of the body's is one the person wrote, which the matchers look for: three letters
 * or more, no `=`, and two words or more, or twelve letters and digits or more. A single word of the
 * body, as `itemize` in `\setlist[itemize]{...}` or a section's title, is as likely the template's
 * code or a word any resume has as the person's, and masking it where a class's definition holds
 * it would give that macro a key of the document's own, which no other document's cache entry
 * serves; the person's name and contacts are the header's, which count at any length.
 */
function isWritten(text: string): boolean {
  if (text.includes("=") || (text.match(/\p{L}/gu) ?? []).length < MIN_NEEDLE) return false;
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).length >= 2 || alphanumerics(text) >= 12;
}

/**
 * The document's texts the matchers look for, folded (`folded`): every text node's text and each
 * of its runs, every date as spelled and every raw chunk's pieces that the person wrote
 * (`isWritten`); every link's address, the header's values, the name whole and each word of it,
 * and the texts the preamble stores and each word of those of two words or fewer; each of
 * MIN_NEEDLE letters and digits or more, and none shaped as a placeholder.
 */
function stringsOf(document: DocumentText): Strings {
  const byPrefix = new Map<string, Needle[]>();
  const seen = new Set<string>();
  const add = (text: string | undefined, origin: Origin) => {
    if (text === undefined) return;
    if ((origin === "text" || origin === "date" || origin === "raw") && !isWritten(text)) return;
    const found = folded(text);
    const chars = [...found];
    if (chars.length < MIN_NEEDLE || placeholderLike(found) || seen.has(found)) return;
    seen.add(found);
    const prefix = chars.slice(0, MIN_NEEDLE).join("");
    const list = byPrefix.get(prefix) ?? [];
    list.push({ chars, origin });
    byPrefix.set(prefix, list);
  };
  const addWords = (text: string | undefined, origin: Origin) => {
    for (const word of text?.match(/[\p{L}\p{N}]+/gu) ?? []) add(word, origin);
  };
  const source = document.tree.source;
  for (const node of nodesOf(document.tree.content)) {
    if (node.kind === "text") {
      add(node.runs.map((run) => run.text).join(""), "text");
      for (const run of node.runs) {
        add(run.text, "text");
        add(run.href, "link");
      }
    } else if (node.kind === "date") add(node.text, "date");
    else if (node.kind === "raw")
      for (const piece of rawPieces(source.slice(node.start, node.end))) add(piece, "raw");
  }
  const header = document.header ?? {};
  for (const value of [header.first, header.last, header.headline, header.email])
    add(value, "header");
  for (const value of [header.phone, header.location]) add(value, "header");
  if (header.first !== undefined || header.last !== undefined)
    add(`${header.first ?? ""} ${header.last ?? ""}`, "header");
  for (const link of header.links ?? []) {
    add(link.label, "header");
    add(link.href, "header");
  }
  addWords(header.first, "header");
  addWords(header.last, "header");
  for (const text of document.stored ?? []) {
    add(text, "stored");
    if ((text.match(/[\p{L}\p{N}]+/gu) ?? []).length <= 2) addWords(text, "stored");
  }
  return { byPrefix };
}

// What a matcher reads of a request's texts.

/**
 * The letters and digits of a text a matcher reads, folded (`fold`): their places in the text, in
 * code units, and whether each starts a word, which it does when anything but a letter or a digit
 * of the same stretch comes before it.
 */
interface Visible {
  at: number[];
  text: string[];
  starts: boolean[];
}

/** A visible text being read: `push` a character the reader met, `gap` anything between. */
function reader() {
  const visible: Visible = { at: [], text: [], starts: [] };
  let gap = true;
  return {
    visible,
    push(at: number, char: string) {
      const letter = fold(char);
      if (letter === "") {
        gap = true;
        return;
      }
      visible.at.push(at);
      visible.text.push(letter);
      visible.starts.push(gap);
      gap = false;
    },
    gap() {
      gap = true;
    },
  };
}

/**
 * The letters and digits of source a matcher reads: not a command's name, `\begin` and `\end` with
 * the environment's, nor a control symbol's character; nor what a comment holds.
 */
export function visibleOfSource(source: string): Visible {
  const read = reader();
  for (let i = 0; i < source.length; ) {
    const char = source[i] ?? "";
    if (char === "%") {
      read.gap();
      const newline = source.indexOf("\n", i);
      i = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (char === "\\") {
      read.gap();
      let j = i + 1;
      while (j < source.length && /[A-Za-z]/.test(source[j] ?? "")) j++;
      if (j === i + 1) {
        i += 1 + ([...source.slice(i + 1, i + 3)][0]?.length ?? 1);
        continue;
      }
      const name = source.slice(i + 1, j);
      if (name === "begin" || name === "end") {
        let k = j;
        while (k < source.length && /[ \t\n\r]/.test(source[k] ?? "")) k++;
        const close = source[k] === "{" ? source.indexOf("}", k) : -1;
        if (close > 0 && /^[A-Za-z@*]*$/.test(source.slice(k + 1, close))) j = close + 1;
      }
      i = j;
      continue;
    }
    const code = source.codePointAt(i) ?? 0;
    const whole = String.fromCodePoint(code);
    read.push(i, whole);
    i += whole.length;
  }
  return read.visible;
}

/**
 * The letters and digits of a `\meaning` a matcher reads, of its parameter text and its
 * replacement text: not a command's name, which TeX prints up to the space after it, an
 * environment's after `\begin` or `\end`, nor a parameter.
 */
export function visibleOfMeaning(meaning: string): Visible {
  const read = reader();
  const head = /^((?:\\(?:protected|long|outer) ?)*)macro:/.exec(meaning);
  if (head === null) return read.visible;
  const arrow = meaning.indexOf("->", head[0].length);
  const scan = (from: number, to: number) => {
    read.gap();
    for (let i = from; i < to; ) {
      const char = meaning[i] ?? "";
      if (char === "\\") {
        read.gap();
        if (meaning[i + 1] === " ") {
          i += 2;
          continue;
        }
        const space = meaning.indexOf(" ", i + 1);
        const name = meaning.slice(i + 1, space < 0 ? to : space);
        i = space < 0 || space >= to ? to : space + 1;
        // An environment's name after `\begin` or `\end` is code, as a command's is.
        if ((name === "begin" || name === "end") && meaning[i] === "{") {
          const close = meaning.indexOf("}", i);
          if (close > 0 && close < to && /^[A-Za-z@*]*$/.test(meaning.slice(i + 1, close)))
            i = close + 1;
        }
        continue;
      }
      if (char === "#" && /[1-9#]/.test(meaning[i + 1] ?? "")) {
        read.gap();
        i += 2;
        continue;
      }
      const code = meaning.codePointAt(i) ?? 0;
      const whole = String.fromCodePoint(code);
      read.push(i, whole);
      i += whole.length;
    }
  };
  if (arrow < 0) scan(head[0].length, meaning.length);
  else {
    scan(head[0].length, arrow);
    scan(arrow + 2, meaning.length);
  }
  return read.visible;
}

/**
 * Which of a text's visible characters spell a text of the document's, and what the first was: a
 * needle of ANYWHERE characters or more wherever it falls, and a shorter one only where it starts
 * a word and ends one, but `anywhere`, as in a setting, whose masking moves no key, where a first
 * name inside a colour's name is masked too.
 */
function found(
  visible: Visible,
  strings: Strings,
  anywhere = false,
): { hide: Uint8Array; origin?: Origin } {
  const chars = visible.text;
  const size = chars.length;
  const hide = new Uint8Array(size);
  let origin: Origin | undefined;
  const startsAt = (i: number) => i >= size || visible.starts[i] === true;
  const at = (i: number, needle: Needle) => needle.chars.every((char, k) => chars[i + k] === char);
  for (let i = 0; i + MIN_NEEDLE <= size; i++) {
    const candidates = strings.byPrefix.get(chars.slice(i, i + MIN_NEEDLE).join(""));
    if (candidates === undefined) continue;
    for (const needle of candidates) {
      const length = needle.chars.length;
      if (i + length > size || !at(i, needle)) continue;
      if (!anywhere && length < ANYWHERE && !(startsAt(i) && startsAt(i + length))) continue;
      hide.fill(1, i, i + length);
      origin ??= needle.origin;
    }
  }
  return { hide, ...(origin === undefined ? {} : { origin }) };
}

/** A text with the characters `hide` marks among its visible ones written as their placeholders. */
function hidden(text: string, visible: Visible, hide: Uint8Array): string {
  if (!hide.includes(1)) return text;
  let out = "";
  let from = 0;
  visible.at.forEach((at, i) => {
    if (hide[i] !== 1) return;
    const whole = String.fromCodePoint(text.codePointAt(at) ?? 0);
    out += text.slice(from, at) + placeholder(whole);
    from = at + whole.length;
  });
  return out + text.slice(from);
}

// Call sites.

/** The names the page may show a call site with: the table's, and what the engine says is defined. */
type Known = (name: string) => boolean;

/** Where a site's text is cut, so that no command's name is cut in two: before its backslash. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let kept = text.slice(0, max - 1);
  const backslash = kept.lastIndexOf("\\");
  if (backslash >= 0 && backslash > kept.length - 80) kept = kept.slice(0, backslash);
  return `${kept}…`;
}

/**
 * A stretch of the body's source as a call site shows it: every date its date's shape; every
 * command's name as it is, where the table knows it or the engine says it is defined, and as its
 * placeholder otherwise; environments' names, control symbols, braces and punctuation as they
 * are; every other letter and digit as its placeholder; comments left out and spaces made one.
 */
function sketch(
  source: string,
  from: number,
  to: number,
  dates: readonly DateNode[],
  known: Known,
): string {
  let out = "";
  let space = false;
  const put = (text: string) => {
    if (space && out !== "") out += " ";
    space = false;
    out += text;
  };
  let d = 0;
  while (d < dates.length && (dates[d]?.start ?? 0) < from) d++;
  for (let i = from; i < to; ) {
    const date = dates[d];
    if (date !== undefined && date.start === i && date.end <= to) {
      put(datePlaceholder(date.dates));
      i = date.end;
      d++;
      continue;
    }
    const char = source[i] ?? "";
    if (char === "%") {
      const newline = source.indexOf("\n", i);
      i = newline < 0 || newline >= to ? to : newline + 1;
      continue;
    }
    if (/\s/.test(char)) {
      space = true;
      i++;
      continue;
    }
    if (char === "\\") {
      let j = i + 1;
      while (j < to && /[A-Za-z]/.test(source[j] ?? "")) j++;
      if (j === i + 1) {
        const next = [...source.slice(i + 1, i + 3)][0] ?? "";
        // A control symbol shows its character, but a space's as a space, and a letter's or a
        // digit's, which a control symbol's never is in ASCII, as its placeholder.
        const shown = /\s/.test(next) ? " " : /[\p{L}\p{N}]/u.test(next) ? placeholder(next) : next;
        put(`\\${shown}`);
        i += 1 + next.length;
        continue;
      }
      const name = source.slice(i + 1, j);
      if (name === "begin" || name === "end") {
        let k = j;
        while (k < to && /[ \t\n\r]/.test(source[k] ?? "")) k++;
        const close = source[k] === "{" ? source.indexOf("}", k) : -1;
        if (close > 0 && close < to && /^[A-Za-z@*]*$/.test(source.slice(k + 1, close))) {
          put(`\\${name}{${source.slice(k + 1, close)}}`);
          i = close + 1;
          continue;
        }
      }
      put(`\\${known(name) ? name : placeholder(name)}`);
      i = j;
      continue;
    }
    const code = source.codePointAt(i) ?? 0;
    const whole = String.fromCodePoint(code);
    put(placeholder(whole));
    i += whole.length;
  }
  return out;
}

/** What an argument holds, for telling calls apart: absent, empty, a date, text, or more. */
function shapeOf(arg: Argument | undefined): string {
  if (arg === undefined || !arg.present) return "absent";
  const content = arg.content ?? [];
  if (content.length === 0) return "empty";
  if (content.every((node) => node.kind === "date")) return "date";
  if (content.every((node) => node.kind === "text")) return "text";
  return "other";
}

/**
 * Up to REQUEST_CAPS.sites calls, the first and then those whose arguments' shapes differ from the
 * ones taken, and then the next in the source's order: the model sees a macro's variations.
 */
function chosen<T extends { args: readonly Argument[] }>(calls: readonly T[]): T[] {
  const taken: T[] = [];
  const shapes = new Set<string>();
  const shape = (call: T) => call.args.map(shapeOf).join("|");
  for (const call of calls) {
    if (taken.length >= REQUEST_CAPS.sites) break;
    if (taken.length > 0 && shapes.has(shape(call))) continue;
    taken.push(call);
    shapes.add(shape(call));
  }
  for (const call of calls) {
    if (taken.length >= REQUEST_CAPS.sites) break;
    if (!taken.includes(call)) taken.push(call);
  }
  return taken;
}

// The preamble's settings.

/** Commands whose statements set the page, the base size, fonts, colours or spacing. */
const SETTING_COMMANDS = new Set([
  ...["geometry", "newgeometry", "setlength", "addtolength", "linespread", "setstretch"],
  ...["definecolor", "colorlet", "setmainfont", "setsansfont", "setmonofont", "newfontfamily"],
  ...["defaultfontfeatures", "fontsize", "renewcommand", "setlist", "titlespacing"],
  ...["titleformat", "columnratio", "usepackage", "RequirePackage", "pagecolor", "color"],
  ...["fontfamily", "selectfont", "setsecnumdepth", "moderncvstyle", "moderncvcolor"],
]);

/** Packages whose loading, and options, set the page, fonts, colours or spacing. */
const SETTING_PACKAGES = new Set([
  ...["geometry", "fullpage", "fontenc", "inputenc", "fontspec", "xcolor", "color", "setspace"],
  ...["parskip", "titlesec", "enumitem", "microtype", "lmodern", "charter", "helvet", "times"],
  ...["mathpazo", "palatino", "roboto", "lato", "sourcesanspro", "sourcesans3", "fontawesome"],
  ...["fontawesome5", "noto", "noto-sans", "FiraSans", "raleway", "carlito", "paracol"],
  ...["libertine", "tgpagella", "tgheros", "tgtermes", "ebgaramond", "CormorantGaramond"],
  ...["sectsty", "ragged2e", "multicol", "anyfontsize", "fix-cm", "mathptmx", "cabin"],
]);

/**
 * Words a setting keeps as they are: the settings' own keywords, the packages above, the names of
 * classes and of the fonts in the engine's tree, and xcolor's models and colours. A colour the
 * preamble names is kept too, and numbers, lengths and hex colours are.
 */
const KEYWORDS = new Set(
  [
    ...["paper", "papersize", "a4paper", "a5paper", "b5paper", "letterpaper", "legalpaper"],
    ...["executivepaper", "landscape", "portrait", "margin", "hmargin", "vmargin", "left"],
    ...["right", "top", "bottom", "inner", "outer", "lmargin", "rmargin", "tmargin", "bmargin"],
    ...["textwidth", "textheight", "width", "height", "total", "body", "includehead"],
    ...["includefoot", "includeheadfoot", "includemp", "includeall", "ignorehead", "ignorefoot"],
    ...["headheight", "headsep", "footskip", "marginparwidth", "marginparsep", "columnsep"],
    ...["hscale", "vscale", "scale", "centering", "nohead", "nofoot", "noheadfoot", "showframe"],
    ...["heightrounded", "twoside", "oneside", "onecolumn", "twocolumn", "draft", "final"],
    ...["fleqn", "leqno", "titlepage", "notitlepage", "openright", "openany", "pt", "in", "cm"],
    ...["mm", "em", "ex", "bp", "pc", "sp", "dd", "cc", "fil", "fill", "plus", "minus", "true"],
    ...["false", "T1", "OT1", "TU", "LY1", "utf8", "latin1", "default", "sfdefault", "rmdefault"],
    ...["ttdefault", "familydefault", "scaled", "osf", "lf", "lining", "oldstyle", "tabular"],
    ...["proportional", "light", "medium", "regular", "bold", "semibold", "condensed", "sc", "sf"],
    ...["rm", "tt", "Ligatures", "TeX", "Numbers", "Scale", "MatchLowercase", "Path", "Extension"],
    ...["UprightFont", "BoldFont", "ItalicFont", "BoldItalicFont", "SmallCapsFont", "Renderer"],
    ...["Mapping", "tex", "text", "Color", "Colour", "Roboto", "Lato", "Source", "Sans", "Serif"],
    ...["Pro", "Latin", "Modern", "Font", "Awesome", "Free", "Brands", "Solid", "Regular"],
    ...["Light", "Medium", "Bold", "Italic", "Semibold", "otf", "ttf", "Noto", "Fira", "Open"],
    ...["usenames", "dvipsnames", "svgnames", "x11names", "table", "HTML", "RGB", "rgb", "cmyk"],
    ...["gray", "Gray", "HSB", "hsb", "wave", "black", "blue", "brown", "cyan", "darkgray"],
    ...["green", "lightgray", "lime", "magenta", "olive", "orange", "pink", "purple", "red"],
    ...["teal", "violet", "white", "yellow", "leftmargin", "rightmargin", "labelsep", "itemsep"],
    ...["topsep", "parsep", "partopsep", "noitemsep", "nosep", "label", "align", "itemindent"],
    ...["labelwidth", "labelindent", "font", "before", "after", "itemize", "enumerate"],
    ...["description", "section", "subsection", "subsubsection", "paragraph", "block", "hang"],
    ...["display", "runin", "wrap", "frame", "onehalfspacing", "doublespacing", "singlespacing"],
    ...["article", "extarticle", "report", "moderncv", "altacv", "europecv", "europasscv"],
    ...["simplecv", "res", "resume", "classic", "casual", "banking", "oldstyle", "fancy"],
    ...["email", "link", "phone", "normalsize", "small", "large", "footnotesize", "scriptsize"],
    ...["tiny", "huge", "linkcolor", "urlcolor", "colorlinks", "hidelinks", "pdftex", "xetex"],
    ...["dvipdfmx", "withhyper", "ragged2e", "normalphoto", "bookmarks", "english", "british"],
    ...["american", "german", "french", "spanish", "bfseries", "mdseries", "itshape", "scshape"],
  ]
    .concat([...SETTING_PACKAGES])
    .map((word) => word.toLowerCase()),
);

/** A number, with a unit or a register's name after it: a length, a size, a ratio. */
const QUANTITY =
  /^[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:pt|pc|in|bp|cm|mm|dd|cc|sp|em|ex|mu|px|fil|fill|filll)?$/i;

/** A colour in hex, as `\definecolor{...}{HTML}{8F0D0D}` gives it. */
const HEX = /^[0-9A-Fa-f]{6}$/;

/** The document class, its options and its name, the first `\documentclass` outside comments. */
function classOf(preamble: string): { name: string; options: string[] } | undefined {
  const found = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(preamble);
  if (found === null) return undefined;
  const options = (found[1] ?? "")
    .split(",")
    .map((option) => option.trim())
    .filter((option) => option !== "");
  return { name: (found[2] ?? "").trim(), options };
}

/** The preamble with its comments taken out, a comment being `%` after an even run of backslashes. */
function withoutComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] !== "%") continue;
        let backslashes = 0;
        for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) backslashes++;
        if (backslashes % 2 === 0) return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

/** Where a group that opens at `at`, with `open` and `close`, ends, past its close; or -1. */
function groupEnd(text: string, at: number, open: string, close: string): number {
  let depth = 0;
  for (let i = at; i < text.length && i < at + REQUEST_CAPS.setting; i++) {
    const char = text[i];
    if (char === "\\") i++;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * A statement's end: its command, a star, then its arguments, braced or bracketed, or a command
 * for its first, as `\setlength\parskip{0pt}` gives, past spaces and one line's end each.
 */
function statementEnd(text: string, from: number): number {
  let at = from;
  let groups = 0;
  for (; groups < 6; groups++) {
    let next = at;
    while (text[next] === " " || text[next] === "\t") next++;
    if (text[next] === "\n") {
      next++;
      while (text[next] === " " || text[next] === "\t") next++;
      if (text[next] === "\n") break;
    }
    const char = text[next];
    if (char === "*" && groups === 0) {
      at = next + 1;
      continue;
    }
    if (char === "{" || char === "[") {
      const end = groupEnd(text, next, char, char === "{" ? "}" : "]");
      if (end < 0) break;
      at = end;
      continue;
    }
    const name = char === "\\" && groups === 0 ? /^\\[A-Za-z@]+/.exec(text.slice(next)) : null;
    if (name === null) break;
    at = next + name[0].length;
  }
  return at;
}

/** Whether a statement is a setting: its command sets one, and its package or macro is one. */
function isSetting(command: string, statement: string): boolean {
  if (command === "usepackage" || command === "RequirePackage") {
    const names = /\{([^}]*)\}\s*$/.exec(statement)?.[1] ?? "";
    return names.split(",").some((name) => SETTING_PACKAGES.has(name.trim()));
  }
  if (command === "renewcommand") {
    const target = /^\\renewcommand\*?\s*\{?\\([A-Za-z@]+)/.exec(statement)?.[1] ?? "";
    return /font|family|default|size|stretch|colou?r|skip|sep|margin|spacing|marker/i.test(target);
  }
  return true;
}

/** The colours a preamble names, with `\definecolor` or `\colorlet`, which settings keep. */
function coloursOf(preamble: string): Set<string> {
  const names = new Set<string>();
  for (const found of preamble.matchAll(
    /\\(?:definecolor|colorlet)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g,
  ))
    names.add((found[1] ?? "").trim().toLowerCase());
  return names;
}

/**
 * A setting as the request holds it: its emails, links and phone numbers masked by pattern, then
 * every word but a number or a length, a hex colour, a colour the preamble names or a keyword
 * written as its placeholder; commands' names, braces and punctuation as they are.
 */
function maskedSetting(statement: string, colours: ReadonlySet<string>): string {
  const keep = (word: string) =>
    QUANTITY.test(word) ||
    HEX.test(word) ||
    KEYWORDS.has(word.toLowerCase()) ||
    colours.has(word.toLowerCase());
  let out = "";
  const text = maskDefinition(statement);
  for (let i = 0; i < text.length; ) {
    const char = text[i] ?? "";
    if (char === "\\") {
      const name = /^\\(?:[A-Za-z@]+|.)/su.exec(text.slice(i))?.[0] ?? "\\";
      out +=
        /^\\[\p{L}\p{N}]$/u.test(name) && !/^\\[A-Za-z]$/.test(name)
          ? `\\${placeholder(name.slice(1))}`
          : name;
      i += name.length;
      continue;
    }
    const word = /^[\p{L}\p{N}][\p{L}\p{N}.,+-]*/u.exec(text.slice(i))?.[0];
    if (word !== undefined) {
      // A word runs to its last letter or digit; a trailing dot or comma is punctuation.
      const trimmed = word.replace(/[.,+-]+$/, "");
      out += keep(trimmed) ? trimmed : placeholder(trimmed);
      i += trimmed.length;
      continue;
    }
    out += char;
    i += char.length;
  }
  return out;
}

/**
 * The preamble's candidate settings: the class and its options, and each statement of a setting
 * command, in order, its comments gone, each masked as a setting is (`maskedSetting`), then by the
 * document's own values, and cut at the request's cap.
 */
function preambleOf(preamble: string, strings: Strings): RequestPreamble {
  const text = withoutComments(preamble);
  const colours = coloursOf(text);
  const mask = (statement: string) => {
    const masked = maskedSetting(statement.replace(/\s+/g, " ").trim(), colours);
    const visible = visibleOfSource(masked);
    return cut(hidden(masked, visible, found(visible, strings, true).hide), REQUEST_CAPS.setting);
  };
  const settings: string[] = [];
  for (const command of text.matchAll(/\\([A-Za-z@]+)/g)) {
    if (settings.length >= REQUEST_CAPS.settings) break;
    const name = command[1] ?? "";
    if (!SETTING_COMMANDS.has(name)) continue;
    const start = command.index;
    const end = statementEnd(text, start + command[0].length);
    const statement = text.slice(start, end);
    if (isSetting(name, statement)) settings.push(mask(statement));
  }
  const documentClass = classOf(text);
  return {
    ...(documentClass === undefined
      ? {}
      : {
          class: {
            name: mask(documentClass.name),
            options: documentClass.options.slice(0, REQUEST_CAPS.options).map(mask),
          },
        }),
    settings,
  };
}

// The request.

/** Options for building a request. */
export interface RequestOptions {
  /** The header's values, as item 7 finds them, which mask definitions as the body's text does. */
  header?: HeaderValues;
  /**
   * Template macros and environments to describe though the document does not call them, as the
   * seed describes a class's macros its sample leaves out: each is asked of the engine too.
   */
  also?: { commands?: readonly string[]; environments?: readonly string[] };
}

/** A call, or an environment opened, in the body or the preamble: its node, whatever holds it. */
interface Use {
  of: RequestMacro["of"];
  name: string;
  args: readonly Argument[];
  content?: readonly Node[];
  source: string;
}

/** The families a class's name says, as the corpus's classifier reads them (decision 0017). */
const CLASS_FAMILIES: ReadonlyMap<string, FamilyHint> = new Map([
  ["altacv", "altacv"],
  ["awesome-cv", "awesome-cv"],
  ["moderncv", "moderncv"],
  ["europecv", "europecv"],
]);

/**
 * The family a document's class says it is, when it is one of the corpus's; or Jake's Resume, whose
 * forks load `article`, when the body calls `\resumeSubheading`, as the corpus's classifier has it.
 */
function familyOf(
  className: string | undefined,
  called: ReadonlySet<string>,
): FamilyHint | undefined {
  const byClass = CLASS_FAMILIES.get(className?.toLowerCase() ?? "");
  if (byClass !== undefined) return byClass;
  return called.has("resumeSubheading") ? "jake" : undefined;
}

/** A signature's arguments' kinds, in order, as the request lists them. */
function argumentKinds(spec: string | undefined): RequestArgument["kind"][] {
  const parts = spec === undefined ? undefined : readSpec(spec);
  return (parts ?? []).map((part) =>
    part.type === "optionalStar"
      ? "star"
      : part.type === "optionalToken"
        ? "token"
        : part.type === "optional"
          ? "optional"
          : "mandatory",
  );
}

/**
 * The calls a preamble makes, at its top level, to the macros that store the header's text, as the
 * probe found them (`isSetter`): each call's node in the preamble's own tree, which the engine's
 * signatures read as they read the body's.
 */
function preambleCalls(
  preamble: string,
  signatures: EngineSignatures,
  setters: ReadonlySet<string>,
): { tree?: Tree; calls: Node[] } {
  if (setters.size === 0) return { calls: [] };
  const read = readBody(bodyOfText(preamble));
  if ("refused" in read) return { calls: [] };
  const tree = buildTree(read, signatures);
  if ("refused" in tree) return { calls: [] };
  return {
    tree,
    calls: tree.content.filter((node) => node.kind === "call" && setters.has(node.name)),
  };
}

/**
 * The naming request for a document (decision 0024): each template macro and environment its body
 * calls or opens, and each the preamble calls to store the header's text, with its definition and
 * its closure's, masked, its key, the probe's verdicts and up to three call sites; and the
 * preamble's settings. `tree` is the body's, `signatures` what the engine said of the body's names
 * and the preamble's (`probeUses`), `probe` the probe's aggregates and candidates, and
 * `preamble` the main file's text before `\begin{document}`. The request is checked against the
 * contract's schema before it is given back, so that a call site holding the document's text
 * throws rather than leaves.
 */
export async function buildRequest(
  tree: Tree,
  signatures: EngineSignatures,
  probe: Pick<Probe, "macros" | "candidates">,
  preamble: string,
  options: RequestOptions = {},
): Promise<NamingRequest> {
  const ofPreamble = probe.candidates.filter((each) => each.where === "preamble");
  const strings = stringsOf({
    tree,
    ...(options.header === undefined ? {} : { header: options.header }),
    stored: ofPreamble.map((each) => each.text),
  });
  const commandOf = (name: string): Signature | undefined =>
    Object.hasOwn(signatures.commands, name) ? signatures.commands[name] : undefined;
  const environmentOf = (name: string): Signature | undefined =>
    Object.hasOwn(signatures.environments, name) ? signatures.environments[name] : undefined;
  const macroOf = (name: string) =>
    Object.hasOwn(signatures.macros, name) ? signatures.macros[name] : undefined;
  const known: Known = (name) =>
    name === "begin" ||
    name === "end" ||
    STANDARD.has(name) ||
    macroOf(name) !== undefined ||
    (commandOf(name) !== undefined && commandOf(name)?.kind !== "undefined");
  const datesOf = (nodes: readonly Node[]) =>
    [...nodesOf(nodes)]
      .filter((node): node is DateNode => node.kind === "date")
      .sort((a, b) => a.start - b.start);

  // The uses, in the source's order: the preamble's storing calls first, then the body's.
  const setters = new Set(
    ofPreamble.filter((each) => each.of === "call" && each.name !== "").map((each) => each.name),
  );
  const head = preambleCalls(preamble, signatures, setters);
  const sources = new Map<string, DateNode[]>([[tree.source, datesOf(tree.content)]]);
  if (head.tree !== undefined) sources.set(head.tree.source, datesOf(head.tree.content));
  const uses: Use[] = [];
  const isTemplate = (name: string) => commandOf(name)?.kind === "template";
  for (const node of head.calls)
    if (node.kind === "call" && isTemplate(node.name))
      uses.push({
        of: "command",
        name: node.name,
        args: node.args,
        source: head.tree?.source ?? "",
      });
  for (const name of setters)
    if (isTemplate(name) && !uses.some((use) => use.name === name))
      uses.push({ of: "command", name, args: [], source: "" });
  for (const node of nodesOf(tree.content)) {
    if (node.kind === "call" && isTemplate(node.name))
      uses.push({ of: "command", name: node.name, args: node.args, source: tree.source });
    else if (node.kind === "environment" && environmentOf(node.name)?.kind === "template")
      uses.push({
        of: "environment",
        name: node.name,
        args: node.args,
        content: node.content,
        source: tree.source,
      });
    else if (node.kind === "raw" && node.name !== undefined && isTemplate(node.name))
      uses.push({ of: "command", name: node.name, args: [], source: "" });
  }
  for (const name of options.also?.commands ?? [])
    if (macroOf(name) !== undefined) uses.push({ of: "command", name, args: [], source: "" });
  for (const name of options.also?.environments ?? [])
    if (macroOf(name) !== undefined) uses.push({ of: "environment", name, args: [], source: "" });

  const byMacro = new Map<string, Use[]>();
  for (const use of uses) {
    const id = `${use.of}|${use.name}`;
    const list = byMacro.get(id) ?? [];
    list.push(use);
    byMacro.set(id, list);
  }

  // The definitions: every macro's own and its closure's, masked by the document's values.
  const definitions = new Map<string, RequestDefinition>();
  const define = async (name: string) => {
    if (definitions.has(name)) return;
    const macro = macroOf(name);
    if (macro === undefined) return;
    if (macro.kind === "data") {
      definitions.set(name, { kind: "data", name });
      return;
    }
    const visible = visibleOfMeaning(macro.meaning);
    const text = hidden(macro.meaning, visible, found(visible, strings).hide);
    const hash = text === macro.meaning ? macro.hash : await sha256(text);
    definitions.set(name, { kind: "definition", name, hash, text });
  };

  const macros: RequestMacro[] = [];
  for (const list of byMacro.values()) {
    const [first] = list;
    if (first === undefined) continue;
    const { of, name } = first;
    const own = macroOf(name);
    if (own === undefined) continue;
    const endName = `end${name}`;
    const end = of === "environment" ? macroOf(endName) : undefined;
    const closure = [
      ...(end === undefined ? [] : [endName]),
      ...(own.kind === "data" ? [] : own.dependencies),
      ...(end === undefined || end.kind === "data" ? [] : end.dependencies),
    ];
    await define(name);
    for (const dependency of closure) await define(dependency);
    // Every name a closure holds is one the engine printed, so each has a definition.
    const dependencies = [...new Set(closure)].filter(
      (each) => each !== name && definitions.has(each),
    );
    const signature = (of === "environment" ? environmentOf(name) : commandOf(name))?.spec;
    const kinds = argumentKinds(signature);
    const aggregates = probe.macros.filter(
      (each) => each.of === (of === "environment" ? "environment" : "call") && each.name === name,
    );
    const args: RequestArgument[] = kinds.map((kind, i) => {
      const aggregate = aggregates.find((each) => each.index === i + 1);
      return {
        index: i + 1,
        kind,
        ...(aggregate === undefined ? {} : { verdict: aggregate.verdict }),
        ...(aggregate?.empty === undefined ? {} : { empty: aggregate.empty }),
      };
    });
    const called = list.filter((use) => use.source !== "");
    const sites: CallSite[] = chosen(called).map((use) => {
      const dates = sources.get(use.source) ?? [];
      const site: CallSite = {
        arguments: kinds.map((_, i) => {
          const arg = use.args[i];
          if (arg === undefined || !arg.present) return null;
          return cut(
            sketch(use.source, arg.innerStart, arg.innerEnd, dates, known),
            REQUEST_CAPS.site,
          );
        }),
      };
      const content = use.content ?? [];
      const firstNode = content[0];
      const lastNode = content.at(-1);
      if (of === "environment" && firstNode !== undefined && lastNode !== undefined)
        site.body = cut(sketch(use.source, firstNode.start, lastNode.end, dates, known), 600);
      return site;
    });
    const ownDefinition = definitions.get(name);
    const key =
      ownDefinition?.kind === "definition"
        ? await keyOf(
            NAMING_VERSION,
            ownDefinition.hash,
            dependencies.flatMap((dependency): Dependency[] => {
              const found = definitions.get(dependency);
              return found?.kind === "definition" ? [[dependency, found.hash]] : [];
            }),
          )
        : undefined;
    const capped = (macro: typeof own | undefined) =>
      macro !== undefined && macro.kind !== "data" && macro.capped;
    macros.push({
      of,
      name,
      ...(signature === undefined ? {} : { signature }),
      ...(key === undefined ? {} : { key }),
      dependencies,
      capped: capped(own) || capped(end),
      arguments: args,
      sites,
      calls: called.length,
    });
  }

  const family = familyOf(
    classOf(withoutComments(preamble))?.name,
    new Set(macros.map((macro) => macro.name)),
  );
  return NamingRequest.parse({
    version: NAMING_VERSION,
    engine: signatures.engine,
    ...(family === undefined ? {} : { family }),
    preamble: preambleOf(preamble, strings),
    macros,
    definitions: [...definitions.values()],
  });
}

// Redefinitions.

/** Where a statement's argument in `open` and `close` that starts at `at` ends, past its close. */
function closing(text: string, at: number, open: string, close: string): number {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") i++;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Where a main file's `\documentclass` statement ends, its options and its class's name read: the
 * first outside a comment; or -1 when it has none.
 */
export function classEnd(text: string): number {
  let offset = 0;
  for (const line of text.split("\n")) {
    let comment = line.length;
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== "%") continue;
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) backslashes++;
      if (backslashes % 2 === 0) {
        comment = i;
        break;
      }
    }
    const found = /\\documentclass(?![A-Za-z@])/.exec(line.slice(0, comment));
    if (found !== null) {
      let at = offset + found.index + found[0].length;
      const skip = () => {
        while (/\s/.test(text[at] ?? "")) at++;
      };
      skip();
      if (text[at] === "[") {
        at = closing(text, at, "[", "]");
        if (at < 0) return -1;
        skip();
      }
      if (text[at] !== "{") return -1;
      return closing(text, at, "{", "}");
    }
    offset += line.length + 1;
  }
  return -1;
}

/**
 * A main file's text with an answer's redefinitions after its document class, each once by its
 * name, the first given of a name taken, in order, a line each: what item 7 does with the
 * redefinitions of the answers it assembles from (decision 0024). Undefined when the text has no
 * `\documentclass` to put them after.
 */
export function withRedefinitions(
  text: string,
  redefinitions: readonly { name: string; latex: string }[],
): string | undefined {
  const at = classEnd(text);
  if (at < 0) return undefined;
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const each of redefinitions) {
    if (seen.has(each.name)) continue;
    seen.add(each.name);
    lines.push(each.latex);
  }
  if (lines.length === 0) return text;
  return `${text.slice(0, at)}\n${lines.join("\n")}\n${text.slice(at)}`;
}

// The leak check.

/** Where a request holds a text, for a leak's message: never the text itself. */
function textsOf(request: NamingRequest): { where: string; text: string; meaning: boolean }[] {
  const texts: { where: string; text: string; meaning: boolean }[] = [];
  for (const definition of request.definitions)
    if (definition.kind === "definition")
      texts.push({
        where: `the definition of ${definition.name}`,
        text: definition.text,
        meaning: true,
      });
  for (const macro of request.macros)
    macro.sites.forEach((site, s) => {
      site.arguments.forEach((argument, a) => {
        if (argument !== null)
          texts.push({
            where: `call site ${s + 1} of ${macro.name}, argument ${a + 1}`,
            text: argument,
            meaning: false,
          });
      });
      if (site.body !== undefined)
        texts.push({
          where: `call site ${s + 1} of ${macro.name}, its body`,
          text: site.body,
          meaning: false,
        });
    });
  request.preamble.settings.forEach((setting, i) =>
    texts.push({ where: `setting ${i + 1}`, text: setting, meaning: false }),
  );
  const documentClass = request.preamble.class;
  if (documentClass !== undefined) {
    texts.push({ where: "the class's name", text: documentClass.name, meaning: false });
    documentClass.options.forEach((option, i) =>
      texts.push({ where: `the class's option ${i + 1}`, text: option, meaning: false }),
    );
  }
  return texts;
}

/**
 * Throw when a request holds any of a document's text: a text of the body's, a date or a raw
 * chunk's words that the person wrote (`isWritten`), a link's address, a header value or a word of
 * the name, or a text the preamble stores, spelt out in a definition, a call site, a setting or the
 * class, spaces, commands and punctuation aside (`found`). The message says what kind of text is
 * where, never the text. The builder masks by the same rules, so its requests pass; the check is
 * what item 11's corpus-wide test runs, and what a change to the builder must still pass.
 */
export function assertNoText(request: NamingRequest, document: DocumentText): void {
  const strings = stringsOf(document);
  for (const { where, text, meaning } of textsOf(request)) {
    const visible = meaning ? visibleOfMeaning(text) : visibleOfSource(text);
    const { origin } = found(visible, strings, !meaning);
    if (origin !== undefined)
      throw new Error(`The naming request holds the document's text (${origin}) in ${where}.`);
  }
}
