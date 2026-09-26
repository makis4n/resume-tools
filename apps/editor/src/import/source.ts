/**
 * Reading a LaTeX document's source without compiling it: what the import pipeline's intake reads
 * of an upload (milestone 3 item 3, decision 0019), and what the corpus's scripts read of every
 * document they collect and survey (decisions 0017 and 0018), which is why it is here, under
 * `src/`, and not among the scripts.
 *
 * What a source loads (`references`), its class (`documentClass`), the code each engine reads of it
 * (`readSource`), the values a class's options give its conditionals (`optionValues`), what that
 * code needs of the engines (`viewNeeds`, `engineFrom`), and the images it shows (`graphicsNames`).
 * TeX's comments count for nothing here, as they count for nothing to TeX: every reader takes them
 * out first, so that a commented-out `\documentclass` or `\input` counts for nothing.
 *
 * They are pure functions over text, so that they can be tested on invented documents; what they
 * return names classes, packages, files, commands and engines, never a document's text beyond the
 * names of the files it loads. Each takes time linear in the length of what it reads, however a
 * hostile document is laid out. This file imports nothing, so that Node's scripts load it as it is,
 * by stripping its types, and the browser's bundle takes it as any other module.
 */

/** The source with TeX's comments taken out: from a `%` that no backslash escapes to its line's end. */
export function withoutComments(tex: string): string {
  return tex.replace(/(^|[^\\])((?:\\\\)*)%.*$/gm, "$1$2");
}

/** Whether the source is a whole document: `\documentclass`, `\begin{document}`, `\end{document}`. */
export function isWholeDocument(tex: string): boolean {
  const text = withoutComments(tex);
  return (
    /\\documentclass(?![A-Za-z@])/.test(text) &&
    /\\begin\s*\{document\}/.test(text) &&
    /\\end\s*\{document\}/.test(text)
  );
}

/** The class the source's first `\documentclass` names, if any. */
export function documentClass(tex: string): string | undefined {
  const text = withoutComments(tex);
  const match = /\\documentclass(?![A-Za-z@])/.exec(text);
  if (!match) return undefined;
  return argument(text, match.index + match[0].length)?.trim();
}

/** Whether a source holds LaTeX 2.09's `\documentstyle`, which LaTeX2e replaced in 1994. */
export const holdsDocumentStyle = (tex: string) =>
  /\\documentstyle(?![A-Za-z@])/.test(withoutComments(tex));

/** Whether a source holds `\documentclass`, as a main file does, outside its comments. */
export const holdsDocumentClass = (tex: string) =>
  /\\documentclass(?![A-Za-z@])/.test(withoutComments(tex));

/**
 * A file a document loads, by the name it gives: a class through `\documentclass` or `\LoadClass`,
 * a package through `\usepackage` or `\RequirePackage`, a source through `\input`, `\include`,
 * `\subfile`, `\InputIfFileExists`, `\import` or `\subimport`, or a bibliography through
 * `\bibliography` or `\addbibresource`. `\subimport` names its file from the folder of the file
 * that calls it, where the others name theirs from the main file's, as TeX's working folder is.
 * One loaded in the second argument of `\IfFileExists`, the code it runs when the file it asks
 * after is there, is `optional`: TeX loads it only then.
 */
export interface Reference {
  kind: "class" | "package" | "input" | "bibliography";
  name: string;
  fromCaller?: boolean;
  optional?: boolean;
}

const COMMANDS =
  /\\(documentclass|LoadClass|LoadClassWithOptions|usepackage|RequirePackage|RequirePackageWithOptions|input|include|subfile|InputIfFileExists|import|subimport|bibliography|addbibresource)(?![A-Za-z@])/g;

/**
 * The files a source loads, in the order it names them. A name built by a macro, holding a
 * backslash or a `#`, cannot be read without running TeX and is left out, and so is one whose
 * brackets do not close within WINDOW characters, which keeps the time this takes linear in the
 * source's length however its brackets are laid out.
 */
export function references(tex: string): Reference[] {
  const text = withoutComments(tex);
  const found: Reference[] = [];
  const within = ifFileExists(text);
  /** Whether the command being read is in `\IfFileExists`'s branch for a file that is there. */
  let optional = false;
  const add = (kind: Reference["kind"], names: string[], fromCaller = false) => {
    for (const raw of names) {
      const name = raw.trim();
      if (name !== "" && !/[\\#]/.test(name))
        found.push({
          kind,
          name,
          ...(fromCaller ? { fromCaller } : {}),
          ...(optional ? { optional } : {}),
        });
    }
  };
  for (const match of text.matchAll(COMMANDS)) {
    const command = match[1] ?? "";
    const at = match.index + match[0].length;
    optional = within(match.index);
    switch (command) {
      case "documentclass":
      case "LoadClass":
      case "LoadClassWithOptions":
        add("class", [argument(text, at) ?? ""]);
        break;
      case "usepackage":
      case "RequirePackage":
      case "RequirePackageWithOptions":
        add("package", (argument(text, at) ?? "").split(","));
        break;
      case "input": {
        // LaTeX's \input takes a group; TeX's primitive takes a name that ends at a space.
        const braced = group(text, at);
        BARE_NAME.lastIndex = at;
        add("input", [braced?.value ?? BARE_NAME.exec(text)?.[1] ?? ""]);
        break;
      }
      case "include":
      case "subfile":
      case "InputIfFileExists":
        add("input", [group(text, at)?.value ?? ""]);
        break;
      case "import":
      case "subimport": {
        const folder = group(text, at);
        const file = folder && group(text, folder.end);
        if (folder && file) {
          const path = folder.value.trim().replace(/\/?$/, "/") + file.value.trim();
          add("input", [path.replace(/^\//, "")], command === "subimport");
        }
        break;
      }
      case "bibliography":
        add("bibliography", (group(text, at)?.value ?? "").split(","));
        break;
      case "addbibresource":
        add("bibliography", [argument(text, at) ?? ""]);
        break;
    }
  }
  return found;
}

/**
 * Whether an index of the text is in the second argument of an `\IfFileExists`, the code TeX runs
 * only when the file named first is there, asked of indexes that do not go down: each argument is
 * passed once, so that this takes time linear in the text's length however many there are.
 */
function ifFileExists(text: string): (at: number) => boolean {
  const spans: [start: number, end: number][] = [];
  for (const match of text.matchAll(/\\IfFileExists(?![A-Za-z@])/g)) {
    const file = group(text, match.index + match[0].length);
    const exists = file && group(text, file.end);
    if (exists) spans.push([file.end, exists.end]);
  }
  spans.sort(([a], [b]) => a - b);
  let next = 0;
  /** The furthest end of the arguments that start at or before the last index asked. */
  let reach = -1;
  return (at) => {
    for (let span = spans[next]; span && span[0] <= at; span = spans[++next])
      reach = Math.max(reach, span[1]);
    return at < reach;
  };
}

/** TeX's primitive `\input` name: spaces, then everything up to a space, a brace or a comment. */
const BARE_NAME = /\s+([^\s{}\\%]+)/y;

/**
 * How many characters past where it starts an argument is looked for: a bracket that has not
 * closed by then is taken never to, so that reading one command's arguments costs at most this
 * much, and reading a source costs at most this much for each command in it.
 */
export const WINDOW = 8_192;

/** The index after any spaces at `at`, looking no further than `stop`. */
function skipSpace(text: string, at: number, stop: number): number {
  while (at < stop && /\s/.test(text[at] ?? "")) at++;
  return at;
}

/**
 * The index after any `[...]` optional arguments at `at` and the spaces around them, or undefined
 * when they do not end within WINDOW characters of `at`.
 */
function skipOptional(text: string, at: number): number | undefined {
  const stop = Math.min(text.length, at + WINDOW);
  for (;;) {
    at = skipSpace(text, at, stop);
    if (at >= stop) return stop === text.length ? at : undefined;
    if (text[at] !== "[") return at;
    let depth = 0;
    let i = at + 1;
    for (; i < stop; i++) {
      const char = text[i];
      if (char === "\\") i++;
      else if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === "]" && depth <= 0) break;
    }
    if (i >= stop) return undefined;
    at = i + 1;
  }
}

/**
 * The braced group at `at`, after any spaces, and the index after it; undefined if there is none,
 * or it does not close within WINDOW characters of `at`.
 */
export function group(text: string, at: number): { value: string; end: number } | undefined {
  const stop = Math.min(text.length, at + WINDOW);
  const start = skipSpace(text, at, stop);
  if (start >= stop || text[start] !== "{") return undefined;
  let depth = 0;
  for (let i = start; i < stop; i++) {
    const char = text[i];
    if (char === "\\") i++;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return { value: text.slice(start + 1, i), end: i + 1 };
  }
  return undefined;
}

/** A command's mandatory argument at `at`, after its optional ones; undefined if unreadable. */
function argument(text: string, at: number): string | undefined {
  const after = skipOptional(text, at);
  return after === undefined ? undefined : group(text, after)?.value;
}

/** The bracketed argument at `at`, after any spaces, and the index after it, if there is one. */
export function bracketed(text: string, at: number): { value: string; end: number } | undefined {
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

// Reading a source as each engine takes it.

/** A source as the engines read it (`readSource`). */
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

// What a source needs of the engines.

/**
 * Packages that need XeTeX, or LuaTeX with fontspec: fontspec, polyglossia and xeCJK, and the
 * others of their kind; and academicons, which sets its icons in the TU encoding alone, which
 * pdfTeX does not have.
 */
export const XETEX_PACKAGES: ReadonlySet<string> = new Set([
  ...["fontspec", "polyglossia", "xeCJK", "xltxtra", "xunicode", "mathspec", "unicode-math"],
  ...["bidi", "xgreek", "xepersian", "realscripts", "xetexko", "fontsetup", "xeCJKfntef"],
  ...["xecolor", "academicons"],
]);

/** XeTeX's primitives, but for the version tests guards make, and fontspec's and xeCJK's commands. */
export const XETEX_COMMANDS =
  /\\(?:XeTeX(?!version|revision)[a-z][A-Za-z]*|setmainfont|setsansfont|setmonofont|setromanfont|setmathfont|setboldmathfont|newfontfamily|renewfontfamily|setfontfamily|providefontfamily|newfontface|renewfontface|setfontface|providefontface|fontspec|defaultfontfeatures|addfontfeatures?|setCJK(?:main|sans|mono|family)font|newCJKfontfamily|setmainlanguage|setdefaultlanguage|setotherlanguages?)(?![A-Za-z@])/;

/** Packages that need LuaTeX. */
export const LUATEX_PACKAGES: ReadonlySet<string> = new Set([
  ...["luacode", "luatexbase", "luatextra", "luaotfload", "lualatex-math", "luamplib"],
  ...["luacolor", "lua-ul", "luatexja", "luatexja-fontspec", "luatexja-preset", "luabidi"],
  ...["selnolig", "luavlna", "lua-visual-debug", "luaquotes", "pyluatex", "emoji"],
  "lua-widow-control",
]);

/** LuaTeX's primitives, but for the version tests guards make, and luacode's environments. */
export const LUATEX_COMMANDS =
  /\\(?:directlua|luaexec|luadirect|latelua|luaescapestring|begin\s*\{luacode\*?\})(?![A-Za-z@])/;

/**
 * The engine a document's source asks for: `both` when it guards on the engine and its pdfTeX
 * branches need nothing of XeTeX's or LuaTeX's.
 */
export const SOURCE_ENGINES = ["pdftex", "xetex", "luatex", "both"] as const;
export type SourceEngine = (typeof SOURCE_ENGINES)[number];

/** What a view of a document needs of the engines beyond pdfTeX. */
export interface Needs {
  xetex: boolean;
  luatex: boolean;
}

/**
 * What one engine's view of a document needs (`readSource`): XeTeX for fontspec, polyglossia and
 * the other packages of `XETEX_PACKAGES`, or for a XeTeX or fontspec command; LuaTeX for a LuaTeX
 * package or a Lua command. `texts` are the view of each of the document's files, and `packages`
 * the packages that view loads.
 */
export function viewNeeds(texts: readonly string[], packages: readonly string[]): Needs {
  return {
    xetex:
      packages.some((name) => XETEX_PACKAGES.has(name)) ||
      texts.some((text) => XETEX_COMMANDS.test(text)),
    luatex:
      packages.some((name) => LUATEX_PACKAGES.has(name)) ||
      texts.some((text) => LUATEX_COMMANDS.test(text)),
  };
}

/**
 * The engine a document needs, from what its pdfTeX view and its XeTeX view need: pdfTeX when its
 * pdfTeX view needs neither of the others, or `both` when it guards on the engine; failing that,
 * XeTeX when its XeTeX view needs no LuaTeX; LuaTeX otherwise.
 */
export function engineFrom(onPdftex: Needs, onXetex: Needs, guarded: boolean): SourceEngine {
  if (!onPdftex.xetex && !onPdftex.luatex) return guarded ? "both" : "pdftex";
  return onXetex.luatex ? "luatex" : "xetex";
}

// The images a source shows.

/** `\includegraphics`, and its starred form. */
const INCLUDE_GRAPHICS = /\\includegraphics\*?(?![A-Za-z@])/g;

/**
 * The files `\includegraphics` names in a source, in its order, each as it gives it, after its
 * optional arguments: a name built by a macro, holding a backslash or a `#`, cannot be read without
 * running TeX and is left out, as `references` leaves one out, and so is one whose brackets do not
 * close within WINDOW characters.
 */
export function graphicsNames(tex: string): string[] {
  const text = withoutComments(tex);
  const names: string[] = [];
  for (const match of text.matchAll(INCLUDE_GRAPHICS)) {
    const name = argument(text, match.index + match[0].length)?.trim() ?? "";
    if (name !== "" && !/[\\#]/.test(name)) names.push(name);
  }
  return names;
}

/**
 * The folders `\graphicspath` names in a source, each as it gives it, in the order graphicx looks
 * in them after TeX's working folder: `\graphicspath{{images/}{photos/}}` names two.
 */
export function graphicsPaths(tex: string): string[] {
  const text = withoutComments(tex);
  const folders: string[] = [];
  for (const match of text.matchAll(/\\graphicspath(?![A-Za-z@])/g)) {
    const list = group(text, match.index + match[0].length)?.value ?? "";
    for (let each = group(list, 0); each; each = group(list, each.end)) {
      const folder = each.value.trim();
      if (folder !== "" && !/[\\#]/.test(folder)) folders.push(folder);
    }
  }
  return folders;
}
