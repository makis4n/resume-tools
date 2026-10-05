/**
 * `corpus checks` (the owner's decision 5 of 5 October 2026, on decision 0060's two documents the
 * checks refused): why the import's checks refuse a document, said without a word of its text. Its
 * child (`corpus-checks-child.ts`) takes a document through the import a browser runs, and then
 * through the same steps again up to the checks, where it compiles the outline with its fields and
 * with every field kept, asks the model whether it holds each, and compiles the outline with every
 * field kept in other ways, to tell which of the package's preamble, its format, the generator's
 * writing of the body and the body's encoding stops it.
 *
 * What it prints is ids, reason codes, steps, counts, TeX's command and environment names, line
 * numbers and kinds of error, never a document's text. This module holds what reads the child's
 * findings into those: a TeX log's first error as a kind (`texError`), which reads the error's line
 * only against fixed patterns and its context only for command names and `l.<n>`, never echoing
 * either; how braces stand in a text, by place (`braceScan`); the names a line holds (`namesOn`);
 * where the generator's writing of a body differs from the body (`insertions`); and the lines the
 * command prints (`checksLines`). It imports nothing of the editor's but types, so that Node runs
 * it as it is.
 */

import { printable } from "./corpus-manifest.ts";

// A TeX log's first error, as a kind.

/** A command's name as TeX spells it: a control word, or a control symbol. */
const NAME = String.raw`\\(?:[A-Za-z@]+|[^A-Za-z@\s])`;

/** A control word, or one of the control symbols a document's LaTeX spells, alone. */
const COMMAND = new RegExp(`^${NAME}$`);

/** An environment's name as LaTeX takes one. */
const ENVIRONMENT = /^[A-Za-z@*]{1,40}$/;

/** A package's or a class's name, as an error names its owner. */
const OWNER = /^[A-Za-z0-9@_.-]{1,40}$/;

/**
 * TeX's and LaTeX's errors whose words are fixed, each read whole, `^` to `$`, so that nothing of a
 * line that is not one of them is ever printed: what each captures is a command's or an
 * environment's name, a line's number or one of a few fixed words, and the kind is made from those
 * alone. A package's or a class's error is its owner's name and no more, since its words are the
 * package's own and may quote the document.
 */
const KINDS: readonly [RegExp, (found: RegExpExecArray) => string][] = [
  [/^Undefined control sequence\.$/, () => "undefined control sequence"],
  [
    /^Missing ([{}$#]|\$\$|\\endcsname|\\right\.|\\cr|\\endgroup|control sequence) inserted\.$/,
    (found) => `missing ${found[1]} inserted`,
  ],
  [/^Missing number, treated as zero\.$/, () => "missing number, treated as zero"],
  [
    /^Extra \}, or forgotten (\\endgroup|\$|\$\$|\\right)\.$/,
    (found) => `extra }, or forgotten ${found[1]}`,
  ],
  [
    /^Extra (\\else|\\fi|\\or|\\endcsname|\\right\.|alignment tab has been changed to \\cr)\.$/,
    (found) => `extra ${found[1]}`,
  ],
  [/^Too many \}'s\.$/, () => "too many }'s"],
  [
    new RegExp(`^Paragraph ended before (${NAME}) was complete\\.$`),
    (found) => `paragraph ended before ${found[1]} was complete`,
  ],
  [
    new RegExp(
      `^(File ended|Forbidden control sequence found) while scanning (use|definition|text|preamble) of (${NAME})\\.$`,
    ),
    (found) => `${found[1]?.toLowerCase()} while scanning ${found[2]} of ${found[3]}`,
  ],
  [
    new RegExp(`^Argument of (${NAME}) has an extra \\}\\.$`),
    (found) => `argument of ${found[1]} has an extra }`,
  ],
  [
    new RegExp(`^Use of (${NAME}) doesn't match its definition\\.$`),
    (found) => `use of ${found[1]} doesn't match its definition`,
  ],
  [
    new RegExp(`^Illegal parameter number in definition of (${NAME})\\.$`),
    (found) => `illegal parameter number in definition of ${found[1]}`,
  ],
  [
    new RegExp(
      `^You can't use \`(${NAME}|macro parameter character #|alignment tab character &)' (in|after) ([a-z ]{1,40}mode|${NAME})\\.$`,
    ),
    (found) => `you can't use ${found[1]} ${found[2]} ${found[3]}`,
  ],
  [
    /^Misplaced (alignment tab character &|\\noalign|\\omit|\\cr|\\crcr|\\span)\.$/,
    (found) => `misplaced ${found[1]}`,
  ],
  [
    /^Incomplete (\\if[A-Za-z@]*); all text was ignored after line (\d+)\.$/,
    (found) => `incomplete ${found[1]}, all text ignored after line ${found[2]}`,
  ],
  [
    /^TeX capacity exceeded, sorry \[([A-Za-z ]{1,40})=\d+\]\.$/,
    (found) => `TeX capacity exceeded: ${found[1]}`,
  ],
  [
    /^(Dimension too large|Arithmetic overflow|Number too big|Double superscript|Double subscript|Text line contains an invalid character|Display math should end with \$\$|Emergency stop|Bad space factor|Bad register code|Bad character code|Improper alphabetic constant|Infinite glue shrinkage found in a paragraph|Limit controls must follow a math operator|Interwoven alignment preambles are not allowed|Only one # is allowed per tab|Missing # inserted in alignment preamble|Illegal unit of measure \((?:pt|mu|replaced by filll) inserted\))\.$/,
    (found) => (found[1] ?? "").toLowerCase(),
  ],
  [
    /^LaTeX Error: \\begin\{([A-Za-z@*]{1,40})\} on input line (\d+) ended by \\end\{([A-Za-z@*]{1,40})\}\.$/,
    (found) => `\\begin{${found[1]}} of line ${found[2]} ended by \\end{${found[3]}}`,
  ],
  [
    /^LaTeX Error: Environment ([A-Za-z@*]{1,40}) undefined\.$/,
    (found) => `environment ${found[1]} undefined`,
  ],
  [
    new RegExp(`^LaTeX Error: Command (${NAME}) (already defined|not defined as a command)\\.$`),
    (found) => `command ${found[1]} ${found[2]}`,
  ],
  [
    /^LaTeX Error: (There's no line here to end|Something's wrong--perhaps a missing \\item|Lonely \\item--perhaps a missing list environment|Too deeply nested|Can be used only in preamble|Missing \\begin\{document\}|Not in outer par mode|Float\(s\) lost|Too many unprocessed floats|\\verb ended by end of line|\\verb illegal in command argument|Bad math environment delimiter|Illegal character in array arg|Counter too large|Option clash for package [A-Za-z0-9@_.-]{1,40})\.$/,
    (found) => `LaTeX: ${found[1]}`,
  ],
  [
    /^LaTeX Error: File `[^']*?(\.[A-Za-z0-9]{1,8})?' not found\.$/,
    (found) => `LaTeX: a file not found${found[1] === undefined ? "" : ` (${found[1]})`}`,
  ],
  [/^LaTeX Error: /, () => "LaTeX: an error of another kind, its words withheld"],
  [
    /^Package inputenc Error: (Unicode character|Unicode char|Invalid UTF-8 byte|Keyboard character used is undefined)/,
    (found) => `inputenc: ${found[1]?.toLowerCase()}`,
  ],
  [
    /^(Package|Class) ([^ ]{1,40}) Error: /,
    (found) =>
      `${found[1]?.toLowerCase()} ${OWNER.test(found[2] ?? "") ? found[2] : "of another name"}'s error, its words withheld`,
  ],
  [
    /^pdfTeX error \((\\[A-Za-z]{1,40})\)/,
    (found) => `pdfTeX error in ${found[1]}, its words withheld`,
  ],
  [/^Font \\[^=]{1,60}=.* not loadable: /, () => "a font not loadable"],
];

/** A TeX log's first error, as `texError` reads it: kinds, names and numbers, never words of it. */
export interface TexError {
  /** The error as one of TeX's or LaTeX's kinds (`KINDS`), with the names it gives in place. */
  kind: string;
  /** TeX's line of the file it read where it stopped, the `l.<n>` of its context. */
  line?: number;
  /** The command TeX found undefined, by name, the last token of the context's first line. */
  command?: string;
  /** The macros TeX was expanding, innermost first, by name, from the context's `\name #1->`. */
  inside: string[];
  /** What TeX was to read again or had inserted, where it is a command, by name. */
  token?: string;
  /** Whether TeX said first that an argument, a definition or a text ran away. */
  runaway: boolean;
  /** The file TeX was reading at the error, as `fileKind` says it. */
  file?: string;
}

/** A name as printed: a command's, or none where it is not one (`COMMAND`). */
const commandName = (text: string | undefined) =>
  text !== undefined && COMMAND.test(text) ? text : undefined;

/** The extensions a file of the job's folder is named by, which are never the upload's words. */
const KNOWN_EXTENSIONS = new Set(
  [
    ...["tex", "sty", "cls", "def", "cfg", "fd", "clo", "ldf", "dict", "bib", "bbl", "bst", "aux"],
    ...["toc", "out", "lof", "lot", "nav", "snm", "vrb", "png", "jpg", "jpeg", "pdf", "eps"],
  ].map((extension) => `.${extension}`),
);

/** A file's extension as printed: one of `KNOWN_EXTENSIONS`, or none. */
const knownExtension = (name: string) => {
  const extension = /\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0]?.toLowerCase() ?? "";
  return KNOWN_EXTENSIONS.has(extension) ? extension : undefined;
};

/** A log line that begins a box's display, which echoes the box's text up to a blank line. */
const BOX_WARNING = /^(?:Overfull|Underfull|Tight|Loose) \\[hv]box\b/;

/**
 * The file a log was reading where its first error is, by the parentheses TeX writes as it opens
 * and closes files: every `(` opens something and every `)` closes the last, a file where a path
 * follows the `(`, so that a parenthesis of a warning's own words, `(badness 10000)`, closes
 * itself. What echoes the document is skipped: the line after a runaway argument's, and a box's
 * display, from its warning to the blank line after it. The file is the innermost one open, as
 * `fileKind` names it; or undefined where the log does not say.
 */
function fileAt(
  lines: readonly string[],
  at: number,
  job: string,
  treeFile: (path: string) => boolean,
): string | undefined {
  const open: (string | undefined)[] = [];
  const path =
    /^((?:\.\/|\/)[^\s()]*|[A-Za-z0-9_.-]+\.(?:tex|sty|cls|def|cfg|fd|clo|ldf|aux|toc|out|bbl|dict))/;
  let skip: "line" | "box" | undefined;
  for (const line of lines.slice(0, at)) {
    if (skip === "line") {
      skip = undefined;
      continue;
    }
    if (skip === "box") {
      if (line.trim() === "") skip = undefined;
      continue;
    }
    if (/^Runaway \w+\?$/.test(line)) {
      skip = "line";
      continue;
    }
    if (BOX_WARNING.test(line)) {
      skip = "box";
      continue;
    }
    for (let k = 0; k < line.length; k++) {
      if (line[k] === "(") open.push(path.exec(line.slice(k + 1, k + 513))?.[1]);
      else if (line[k] === ")") open.pop();
    }
  }
  const innermost = [...open].reverse().find((each) => each !== undefined);
  if (innermost === undefined) return undefined;
  return fileKind(innermost, innermost.slice(innermost.lastIndexOf("/") + 1), job, treeFile);
}

/**
 * A file as printed: the job's main file, the body, as `main`; another file of the job's folder by
 * a known extension alone, since its name is the upload's (`a file of the upload's (.tex)`, `the
 * job's .aux`); a file of the engine's tree by its name, a package's, only where `treeFile` says
 * the path is one; and anything else in fixed words, so that no word of a log's reaches a line.
 */
function fileKind(
  path: string,
  name: string,
  job: string,
  treeFile: (path: string) => boolean,
): string {
  const extension = knownExtension(name);
  const shown = extension === undefined ? "" : ` (${extension})`;
  if (name === `${job}.tex` || name === job) return "main";
  if (name.startsWith(`${job}.`)) return `a file of the job's${shown}`;
  if (path.startsWith("./") || !path.startsWith("/")) return `a file of the upload's${shown}`;
  return treeFile(path) && /^[A-Za-z0-9_.-]{1,60}$/.test(name)
    ? `TeX Live's ${name}`
    : "a file of TeX Live's";
}

/**
 * A log's first error as a kind (`TexError`), or undefined where it has none: the error's line read
 * against `KINDS` alone, and of its context only `l.<n>`, the undefined command, the macros being
 * expanded and a token read again, each a command's name or a number. A runaway argument's line,
 * which echoes the argument, is only counted. `job` names the job, whose main file is the body;
 * `treeFile` says whether a path is a file of the engine's tree, which alone is named.
 */
export function texError(
  log: string,
  job: string,
  treeFile: (path: string) => boolean = () => false,
): TexError | undefined {
  const lines = log.split(/\r?\n/);
  const at = lines.findIndex((line) => line.startsWith("! "));
  if (at < 0) return undefined;
  const line = (lines[at] ?? "").slice(2);
  let kind = "an error of another kind, its words withheld";
  for (const [pattern, name] of KINDS) {
    const found = pattern.exec(line);
    if (found !== null) {
      kind = name(found);
      break;
    }
  }
  const error: TexError = {
    kind,
    inside: [],
    runaway: lines.slice(Math.max(0, at - 3), at).some((each) => /^Runaway \w+\?$/.test(each)),
  };
  const file = fileAt(lines, at, job, treeFile);
  if (file !== undefined) error.file = file;
  const context = lines.slice(at + 1, at + 40);
  if (kind === "undefined control sequence") {
    const first = context.find((each) => each.trim() !== "") ?? "";
    const command = commandName(new RegExp(`(${NAME})\\s*$`).exec(first)?.[1]);
    if (command !== undefined) error.command = command;
  }
  for (let k = 0; k < context.length; k++) {
    const each = context[k] ?? "";
    const number = /^l\.(\d+)\b/.exec(each)?.[1];
    if (number !== undefined) {
      error.line = Number(number);
      break;
    }
    const macro = new RegExp(`^(${NAME}) ?[^\\s]*?->`).exec(each)?.[1];
    if (macro !== undefined && commandName(macro) !== undefined) error.inside.push(macro);
    if (/^<(to be read again|inserted text|recently read)>\s*$/.test(each)) {
      const next = /^\s+(\S+)\s*$/.exec(context[k + 1] ?? "")?.[1];
      const token = commandName(next);
      if (token !== undefined && error.token === undefined) error.token = token;
    }
  }
  return error;
}

/** An error as a line prints it: its kind, and each name and number it has. */
export function errorLine(error: TexError, line?: (n: number) => string): string {
  const parts = [error.kind];
  if (error.command !== undefined) parts.push(error.command);
  if (error.runaway) parts.push("after a runaway argument");
  if (error.inside.length > 0) parts.push(`inside ${error.inside.slice(0, 4).join(" in ")}`);
  if (error.token !== undefined) parts.push(`reading ${error.token} again`);
  if (error.file !== undefined) parts.push(`in ${error.file}`);
  if (error.line !== undefined) parts.push(line?.(error.line) ?? `at line ${error.line}`);
  return parts.join(", ");
}

// Braces, lines and names.

/**
 * The commands whose first argument is an address, which hyperref's `\href` and url.sty's `\url`,
 * `\path` and `\nolinkurl` read with `%` as a character of it, as the model's reading of kept
 * text has them (`packages/resume-model`).
 */
const ADDRESS_COMMAND = /\\(href|url|path|nolinkurl)(?![A-Za-z@])/y;

/** How braces stand in a text, as `braceScan` reads them, by place in it. */
export interface Braces {
  /** The first `}` that closes no `{`. */
  under?: number;
  /** Each `{` no `}` closes, where it stands. */
  open: number[];
  /** Where an address `\url|...|` opened that its delimiter never closed. */
  delimited?: number;
}

/**
 * How braces stand in a text as the model reads kept text where it stands outside any argument
 * (`packages/resume-model`'s `scan` with addresses): a brace after a backslash is no brace, a
 * comment is not read, and a `%` in the address of `\href`, `\url`, `\path` or `\nolinkurl` is a
 * character. Where the model says the text does not balance, this says where.
 */
export function braceScan(latex: string): Braces {
  const lineEnd = (char: string | undefined) => char === "\n" || char === "\r";
  const open: number[] = [];
  let under: number | undefined;
  let address: number | undefined;
  let delimiter: { char: string; at: number } | undefined;
  for (let at = 0; at < latex.length; at++) {
    const char = latex[at];
    if (delimiter !== undefined) {
      if (char === delimiter.char) delimiter = undefined;
      continue;
    }
    if (char === "\\") {
      ADDRESS_COMMAND.lastIndex = at;
      const command = address === undefined ? ADDRESS_COMMAND.exec(latex) : null;
      if (command === null) {
        at++;
        continue;
      }
      let next = ADDRESS_COMMAND.lastIndex;
      while (next < latex.length && /\s/.test(latex[next] ?? "")) next++;
      if (command[1] === "href" && latex[next] === "[") {
        const close = latex.indexOf("]", next);
        if (close >= 0) next = close + 1;
        while (next < latex.length && /\s/.test(latex[next] ?? "")) next++;
      }
      const opens = latex[next];
      if (opens === "{") {
        address = open.length;
        open.push(next);
        at = next;
      } else if (opens !== undefined && command[1] !== "href" && !/[\s\\%}A-Za-z]/.test(opens)) {
        delimiter = { char: opens, at: next };
        at = next;
      } else at = next - 1;
    } else if (char === "%" && address === undefined) {
      while (at + 1 < latex.length && !lineEnd(latex[at + 1])) at++;
    } else if (char === "{") open.push(at);
    else if (char === "}") {
      if (open.length === 0) under ??= at;
      else open.pop();
      if (open.length === address) address = undefined;
    }
  }
  return {
    ...(under === undefined ? {} : { under }),
    open,
    ...(delimiter === undefined ? {} : { delimited: delimiter.at }),
  };
}

/** A character as a kind: a digit, a letter, a space, a brace, or another sign. */
const charKind = (char: string | undefined) =>
  char === undefined
    ? "nothing"
    : /\d/.test(char)
      ? "a digit"
      : /\p{L}/u.test(char)
        ? "a letter"
        : /\s/.test(char)
          ? "a space"
          : /[{}]/.test(char)
            ? `a ${char}`
            : char === "\\"
              ? "a backslash"
              : "another sign";

/**
 * The comment on the line of a place, as counts and kinds: the `{` and `}` before its `%` and
 * after it, and what kind of character stands right before the `%` and right after it; or
 * undefined for a line without one.
 */
export function commentFacts(
  text: string,
  at: number,
): { before: [number, number]; after: [number, number]; prev: string; next: string } | undefined {
  const span = lineSpan(text, lineAt(text, at));
  const line = text.slice(span.start, span.end);
  const cut = commentStart(line);
  if (cut < 0) return undefined;
  const count = (part: string, char: string) => part.split(char).length - 1;
  const head = line.slice(0, cut);
  const tail = line.slice(cut + 1);
  return {
    before: [count(head, "{"), count(head, "}")],
    after: [count(tail, "{"), count(tail, "}")],
    prev: charKind(line[cut - 1]),
    next: charKind(line[cut + 1]),
  };
}

/** Whether `braceScan` finds a text balanced, as the model's reading of an outline wants it. */
export const balances = (braces: Braces) =>
  braces.under === undefined && braces.open.length === 0 && braces.delimited === undefined;

/** The line a place in a text is on, from 1. */
export function lineAt(text: string, at: number): number {
  let line = 1;
  for (let k = 0; k < at && k < text.length; k++) if (text[k] === "\n") line++;
  return line;
}

/** A text's line, from 1, as a range of places in it. */
export function lineSpan(text: string, line: number): { start: number; end: number } {
  let start = 0;
  for (let n = 1; n < line; n++) {
    const next = text.indexOf("\n", start);
    if (next < 0) return { start: text.length, end: text.length };
    start = next + 1;
  }
  const end = text.indexOf("\n", start);
  return { start, end: end < 0 ? text.length : end };
}

/**
 * The commands and environments a piece of LaTeX names, in order, each once, at most `limit`: a
 * command by its name, an environment as `{name}` after `\begin` or `\end`; and `%` where it
 * holds a comment. Nothing else of it.
 */
export function namesOn(latex: string, limit = 12): string[] {
  const names: string[] = [];
  const add = (name: string) => {
    if (!names.includes(name) && names.length < limit) names.push(name);
  };
  const found = new RegExp(`${NAME}|%`, "g");
  for (const match of latex.matchAll(found)) {
    const name = match[0];
    if (name === "%") {
      const before = latex.slice(0, match.index ?? 0);
      if ((/\\*$/.exec(before)?.[0].length ?? 0) % 2 === 0) add("% (a comment)");
      continue;
    }
    if (!COMMAND.test(name) || name === "\\%") continue;
    if (name === "\\begin" || name === "\\end") {
      const env = /^\s*\{([^}]*)\}/.exec(latex.slice((match.index ?? 0) + name.length))?.[1];
      add(env !== undefined && ENVIRONMENT.test(env) ? `${name}{${env}}` : name);
    } else add(name);
  }
  return names;
}

/** Where a line's comment starts: its first `%` no backslash escapes; or -1 where it has none. */
function commentStart(line: string): number {
  for (let k = 0; k < line.length; k++) {
    if (line[k] === "\\") k++;
    else if (line[k] === "%") return k;
  }
  return -1;
}

/**
 * What stands around a place in a text, as names and places: the environments begun before it and
 * not ended, innermost last, outside comments; whether an `\iffalse` before it is not yet ended by
 * a `\fi`; the first `}` after it inside a comment; and the first `\egroup` after it, outside one.
 */
export interface AroundBrace {
  environments: string[];
  iffalse: boolean;
  commentBrace?: number;
  egroup?: number;
}

export function aroundBrace(text: string, at: number): AroundBrace {
  const environments: string[] = [];
  let iffalse = 0;
  let commentBrace: number | undefined;
  let egroup: number | undefined;
  let offset = 0;
  for (const line of text.split("\n")) {
    const cut = commentStart(line);
    const code = cut < 0 ? line : line.slice(0, cut);
    if (offset + line.length < at) {
      for (const found of code.matchAll(
        /\\(begin|end)\s*\{([^}]*)\}|\\iffalse(?![A-Za-z@])|\\fi(?![A-Za-z@])/g,
      )) {
        if (found[0].startsWith("\\iffalse")) iffalse++;
        else if (found[0].startsWith("\\fi")) iffalse = Math.max(0, iffalse - 1);
        else if (found[1] === "begin") environments.push(found[2] ?? "");
        else {
          const k = environments.lastIndexOf(found[2] ?? "");
          if (k >= 0) environments.splice(k);
        }
      }
    } else {
      const from = Math.max(0, at - offset + 1);
      if (commentBrace === undefined && cut >= 0) {
        const brace = line.indexOf("}", Math.max(cut, from));
        if (brace >= 0) commentBrace = offset + brace;
      }
      if (egroup === undefined) {
        const found = /\\egroup(?![A-Za-z@])/.exec(code.slice(Math.min(from, code.length)));
        if (found !== null) egroup = offset + Math.min(from, code.length) + found.index;
      }
      if (commentBrace !== undefined && egroup !== undefined) break;
    }
    offset += line.length + 1;
  }
  return {
    environments: environments.filter((name) => ENVIRONMENT.test(name)),
    iffalse: iffalse > 0,
    ...(commentBrace === undefined ? {} : { commentBrace }),
    ...(egroup === undefined ? {} : { egroup }),
  };
}

/**
 * The command a brace at `at` belongs to, by name: the last command before it on its line with
 * only brackets, braces' contents closed, stars and spaces between; or undefined for a brace of
 * its own, as a group.
 */
export function commandBefore(latex: string, at: number): string | undefined {
  const lineStart = latex.lastIndexOf("\n", at - 1) + 1;
  let k = at;
  let depth = 0;
  while (k > lineStart) {
    const char = latex[k - 1] ?? "";
    if (char === "}" || char === "]") depth++;
    else if ((char === "{" || char === "[") && depth > 0) depth--;
    else if (depth === 0 && !/[\s*]/.test(char)) break;
    k--;
  }
  const name = new RegExp(`(${NAME})$`).exec(latex.slice(lineStart, k))?.[1];
  return commandName(name);
}

// The generator's writing of a body, against the body.

/**
 * Where a text the generator wrote differs from the text it should be byte for byte, `expected`:
 * where `expected` starts in it, and what it adds where, as places in `expected`; or, where it does
 * more than add, the place in `expected` where they part. Greedy, which reads a writing that only
 * adds, as the generator's line's end after a comment, exactly.
 */
export interface Written {
  start?: number;
  added: { at: number; text: string }[];
  parted?: number;
  /** For each place of `written` from `start`, the place of `expected` it stands for. */
  map: Int32Array;
}

export function insertions(expected: string, written: string, start: number): Written {
  const map = new Int32Array(Math.max(0, written.length - start) + 1).fill(-1);
  const added: { at: number; text: string }[] = [];
  let i = 0;
  let j = start;
  let parted: number | undefined;
  while (i < expected.length && j < written.length) {
    map[j - start] = i;
    if (written[j] === expected[i]) {
      i++;
      j++;
      continue;
    }
    const last = added.at(-1);
    if (last !== undefined && last.at === i) last.text += written[j];
    else added.push({ at: i, text: written[j] ?? "" });
    j++;
    if (added.length > 200) {
      parted = i;
      break;
    }
  }
  if (parted === undefined && i < expected.length) parted = i;
  map[j - start] = i;
  return { start, added, ...(parted === undefined ? {} : { parted }), map };
}

/** What an addition holds, as a kind: line ends, spaces, braces, or characters of other kinds. */
export function addedKind(text: string): string {
  if (/^\n+$/.test(text)) return text.length === 1 ? "a line's end" : `${text.length} line ends`;
  if (/^ +$/.test(text)) return `${text.length} ${text.length === 1 ? "space" : "spaces"}`;
  if (/^[{}]+$/.test(text)) return `braces ${text}`;
  return `${text.length} ${text.length === 1 ? "character" : "characters"} of other kinds`;
}

// The row and its lines.

/** A compile's verdict as the diagnostic prints it. */
export interface CompileVerdict {
  /** What it came to: the page the checks want, another page, or it stopped. */
  outcome: "same" | "differs" | "stops" | "not generated" | "not dumped" | "unreadable";
  /** For a page that differs, the first difference's kind and page, from 1. */
  difference?: { kind: string; page?: number };
  /** For one that stopped, its first error, with its line where it is a line of the body. */
  error?: string;
  /** Whether it stopped by asking for a pass after its last, and no error. */
  rerun?: boolean;
}

/** What the diagnostic found of a document: lines of kinds, names and numbers, as printed. */
export interface ChecksRow {
  id: string;
  lines: string[];
}

/** A compile's verdict as one line's words. */
export function verdictWords(verdict: CompileVerdict): string {
  switch (verdict.outcome) {
    case "same":
      return "sets the page the checks want";
    case "differs":
      return `sets another page: ${verdict.difference?.kind ?? "differs"}${verdict.difference?.page === undefined ? "" : ` on page ${verdict.difference.page}`}`;
    case "stops":
      return verdict.error !== undefined
        ? `stops: ${verdict.error}`
        : verdict.rerun === true
          ? "stops: it asked for another pass after its third"
          : "stops: no error, and no page";
    case "not generated":
      return "the generator wrote no body";
    case "not dumped":
      return "its format did not dump";
    case "unreadable":
      return "its output could not be read";
  }
}

/** The lines `corpus checks` prints of a document, each through `printable`. */
export function checksLines(row: ChecksRow): string[] {
  return [`${row.id}:`, ...row.lines.map((line) => `  ${line}`)].map(printable);
}
