/**
 * What the engine says of the commands and environments a body uses that the parser's table does
 * not know (milestone 3 item 4, decision 0020): whether each is the template's or LaTeX's, what
 * arguments it takes, and the template's definitions, closed over the macros they name. The
 * parser never reads a class file for a definition: TeX has read it already, and `\meaning` gives
 * back what TeX made of it, the spacing and comments a fork changed gone.
 *
 * One compile, of the document's own preamble from the stock format, in the reference's job and
 * with its files, on its engine, goes past `\begin{document}` and writes to a file one record for
 * each name the body uses that the table does not know, and each environment's `\x` and `\endx`:
 * its `\meaning`, and for a command or an environment xparse defines, its argument specification
 * (`\GetDocumentCommandArgSpec`, or the environment's). It then follows every macro's meaning to
 * the macros it names, and prints theirs, to a cap, but for the table's names, LaTeX's scratch
 * macros and expl3's functions; and beside a macro of one of the shapes below, the macro it hands
 * its work to, which reading its meaning back would split: the robust command's `\x ` (a name
 * that ends in a space), the optional argument's `\\x` (a name that starts with a backslash),
 * twoopt's `\2\x`, and xparse's `\x code` and its environments' code. TeX writes a line to a file
 * whole, however long (`max_print_line` bounds only the terminal and the log), with `\newlinechar`
 * off; the characters 9, 10 and 11 in a meaning, which pdfTeX or XeTeX writes raw, are written as
 * `^^I`, `^^J` and `^^K`, as TeX writes every other control character, so that a record is one
 * line and a meaning the same text on both engines. A second compile, from
 * `\documentclass{article}` alone, prints the same names' meanings in LaTeX's kernel: a name
 * defined the same way there is standard, and every other macro is the template's, whether its
 * class, a package or its preamble defines it.
 *
 * `\meaning` shows a macro in three shapes that the arguments are read from. A plain macro,
 * `macro:#1#2->...`, takes one argument for each parameter, and, when its replacement text ends
 * with a command and brace groups, what that command takes beyond the groups: `\ding` is
 * `\Pisymbol {pzd}`, and takes one. A `\newcommand` with an optional first argument is
 * `\@protected@testopt \x \\x {default}`, and its second macro, `\\x`, has the parameters,
 * `[#1]#2`; one written by hand looks ahead with `\@ifnextchar [` or `\@ifstar`, and the branch it
 * hands to, past the flags it sets, has them. A `\DeclareRobustCommand` is `\protect \x  `, and its
 * real macro is `\x `, read in turn as any of the others. An xparse command's specification is
 * xparse's own, and a few packages' commands are their table's (`packages.ts`). A macro whose
 * parameters are delimited, or that looks ahead in any other way, is not resolved, and the parser
 * keeps its calls raw; so is a name the engine says is undefined, a primitive, a `\char` or a
 * register, which it records as such. A macro whose replacement text ends by handing on to a
 * command whose arguments cannot be read is marked (`tail`), so that the parser can be cautious.
 *
 * A template macro whose replacement text holds no parameter and names nothing but text, as a
 * preamble's `\name{...}` sets `\@firstname`, is data, the person's: the result keeps its length
 * alone, and it takes no part in any hash or key. Every other template macro's definition is its
 * meaning, with the emails, links and phone numbers in it masked by a placeholder of the same
 * length, closed over the template macros it names, the first reached first, to 64 definitions
 * and 64 KB, the data among them by name alone, but for scratch macros, whose meaning is whatever
 * was last put in them; each definition's SHA-256, and its closure's (`keysOf`), are item 6's
 * cache key.
 */

import { printRaw } from "@unified-latex/unified-latex-util-argspec";
import type { Engine, EngineSession } from "../engine/session";
import { isReadable, readSpec } from "./arguments";
import { decodeText, encodeLike, type Intake } from "./intake";
import { packageSignature, twooptSpec } from "./packages";
import type { Body, Known, Uses } from "./parse";
import { IMPORT_JOB, type Reference, type ReferenceOptions, referenceFiles } from "./reference";
import { type Refusal, refusal } from "./refusal";
import { QUANTITIES, SCRATCH, STANDARD } from "./standard";

/** How a command's arguments were read: from which shape of its meaning, or not at all. */
export type Resolution = "meaning" | "optional" | "robust" | "xparse" | "unresolved";

export const RESOLUTIONS: readonly Resolution[] = [
  "meaning",
  "optional",
  "robust",
  "xparse",
  "unresolved",
];

/**
 * What the engine said of a command or an environment the body uses: `Known`'s kind, arguments and
 * `tail`, which marks one whose tail could not be read, and how they were read.
 */
export interface Signature extends Known {
  /** How its arguments were read; `unresolved` for anything that is not a macro. */
  how: Resolution;
  /** Why they could not be, for one unresolved: its kind, or what its meaning shows. */
  why?: string;
  /** The package whose table gave its arguments, which its meaning does not show (`packages.ts`). */
  package?: string;
}

/**
 * A template macro that is code: its meaning with personal data masked, the hash of it, and the
 * template macros it names, closed over.
 */
export interface TemplateMacro {
  kind?: "definition";
  /** Its `\meaning`, as TeX printed it, emails, links and phone numbers masked. */
  meaning: string;
  /** The SHA-256 of its masked meaning in UTF-8, in hex: item 6's cache key is built from it. */
  hash: string;
  /** The template macros its meaning names, and theirs, the first reached first, to the cap. */
  dependencies: string[];
  /** Whether the closure stopped at its cap, 64 definitions or 64 KB of meanings. */
  capped: boolean;
}

/** A template macro that holds data, as a preamble's `\name{...}` sets: its length alone. */
export interface DataMacro {
  kind: "data";
  /** How long its replacement text is, which the result never holds. */
  length: number;
}

/** What the two compiles said: every name the body uses, and every template macro found. */
export interface EngineSignatures {
  engine: Engine;
  /** What the body calls that the table does not know, by name. */
  commands: Record<string, Signature>;
  /** What the body opens that the table does not know, by name. */
  environments: Record<string, Signature>;
  /** Every template macro the compile printed, the body's and those they name, by name. */
  macros: Record<string, TemplateMacro | DataMacro>;
  /** Whether the compile stopped printing at its cap, or before its end, so that some are missing. */
  truncated: boolean;
  /** The two compiles' passes, in milliseconds. */
  ms: number;
}

export interface SignatureOptions extends ReferenceOptions {}

/** How many names the compile prints at most, the body's first. */
export const MAX_PRINTED = 2048;

/** The closure of a template macro's definition: at most this many definitions, itself among them. */
export const MAX_CLOSURE_MACROS = 64;

/** And at most this many characters of meanings, together. */
export const MAX_CLOSURE_BYTES = 65_536;

/** A meaning longer than this is printed, and not followed to the names it holds. */
const MAX_FOLLOWED = 65_536;

/**
 * The code that prints the records, after `\begin{document}`: in expl3, which LaTeX's kernel
 * holds. It reads the names it is asked about from `<job>.rtn`, and those it passes over from
 * `<job>.rtk`, when there are such files, a line each and a `|` after each, since TeX drops a
 * line's trailing spaces; and it writes `<job>.rtm`: `N:` and a name, `M:` and its meaning or
 * `undefined`, `S:` and an xparse specification, `T:` where it stopped at its cap and `E:` at its
 * end. With `follow` false, as in the kernel's compile, it prints the names it is given alone.
 *
 * The walk is a queue of names kept in numbered macros, since expl3's sequences copy themselves
 * on every change, and a thousand names made that quadratic. It reads each meaning back as tokens
 * (`\tl_set_rescan:Nnn`) with every printable character a letter, set once for the whole walk,
 * so that a name that TeX printed whole reads back whole, and a control symbol as itself. The
 * same catcodes are in force while it prints, so TeX prints a space after every control sequence
 * but the control space. Before a meaning or a specification is written, its characters 9, 10
 * and 11 become `^^I`, `^^J` and `^^K`: pdfTeX writes all three raw and XeTeX the character 10,
 * which would end the record's line, and TeX writes every other control character so already.
 */
export function meaningsCode(follow: boolean): string {
  return String.raw`\ExplSyntaxOn
\group_begin:
\char_set_catcode_letter:N \@
\int_set:Nn \tex_newlinechar:D { -1 }
\bool_new:N \l__rtsig_follow_bool
\bool_set_${follow ? "true" : "false"}:N \l__rtsig_follow_bool
\int_new:N \l__rtsig_count_int
\int_new:N \l__rtsig_head_int
\int_new:N \l__rtsig_tail_int
\str_new:N \l__rtsig_meaning_str
\str_new:N \l__rtsig_spec_str
\tl_new:N \l__rtsig_body_tl
\tl_new:N \l__rtsig_scan_tl
\iow_new:N \g__rtsig_iow
\ior_new:N \g__rtsig_ior
\cs_set_protected:Npn \__rtsig_catcodes:
  {
    \int_step_inline:nnn { 0 } { 31 } { \char_set_catcode_other:n {##1} }
    \int_step_inline:nnn { 33 } { 126 } { \char_set_catcode_letter:n {##1} }
    \int_step_inline:nnn { 127 } { 255 } { \char_set_catcode_other:n {##1} }
    \char_set_catcode_escape:n { 92 }
  }
\cs_set_protected:Npn \__rtsig_escape:Nnn #1#2#3
  {
    \use:e
      {
        \str_replace_all:Nnn \exp_not:N #1
          { \char_generate:nn {#2} { 12 } }
          { \c_circumflex_str \c_circumflex_str #3 }
      }
  }
\cs_set_protected:Npn \__rtsig_escape:N #1
  {
    \__rtsig_escape:Nnn #1 { 9 } { I }
    \__rtsig_escape:Nnn #1 { 10 } { J }
    \__rtsig_escape:Nnn #1 { 11 } { K }
  }
\cs_set_protected:Npn \__rtsig_expl:nTF #1
  { \str_if_in:nnTF {#1} { : } { \use_i:nn } { \str_if_in:nnTF {#1} { _ } { \use_i:nn } { \use_ii:nn } } }
\cs_set_protected:Npn \__rtsig_mark:n #1 { \cs_set:cpn { rtsig~seen~#1 } { } }
\cs_set_protected:Npn \__rtsig_queue:n #1
  {
    \int_incr:N \l__rtsig_tail_int
    \cs_set:cpn { rtsig~queue~\int_use:N \l__rtsig_tail_int } {#1}
  }
\cs_generate_variant:Nn \__rtsig_mark:n { x }
\cs_set_protected:Npn \__rtsig_given:n #1
  {
    \str_if_empty:nF {#1}
      {
        \if_cs_exist:w rtsig~seen~#1 \cs_end: \else:
          \__rtsig_mark:n {#1}
          \__rtsig_queue:n {#1}
        \fi:
      }
  }
\cs_generate_variant:Nn \__rtsig_given:n { x }
\cs_set_protected:Npn \__rtsig_found:n #1
  {
    \if_cs_exist:w rtsig~seen~#1 \cs_end: \else:
      \__rtsig_mark:n {#1}
      \__rtsig_expl:nTF {#1} { }
        {
          \if_cs_exist:w #1 \cs_end:
            \exp_after:wN \token_if_macro:NT \cs:w #1 \cs_end: { \__rtsig_queue:n {#1} }
          \fi:
        }
    \fi:
  }
\cs_generate_variant:Nn \__rtsig_found:n { x }
\cs_set:Npn \__rtsig_after:w #1 -> #2 \q_stop {#2}
\cs_set_protected:Npn \__rtsig_follow:
  {
    \tl_set:Nx \l__rtsig_body_tl { \exp_after:wN \__rtsig_after:w \l__rtsig_meaning_str \q_stop }
    \exp_args:NNnV \tl_set_rescan:Nnn \l__rtsig_scan_tl { } \l__rtsig_body_tl
    \tl_map_inline:Nn \l__rtsig_scan_tl
      { \token_if_cs:NT ##1 { \__rtsig_found:x { \cs_to_str:N ##1 } } }
  }
\cs_set_protected:Npn \__rtsig_spec:
  {
    \str_set:NV \l__rtsig_spec_str \ArgumentSpecification
    \__rtsig_escape:N \l__rtsig_spec_str
    \iow_now:Nx \g__rtsig_iow { S: \l__rtsig_spec_str }
  }
\cs_set_protected:Npn \__rtsig_print:n #1
  {
    \int_incr:N \l__rtsig_count_int
    \iow_now:Nn \g__rtsig_iow { N: #1 }
    \if_cs_exist:w #1 \cs_end:
      \exp_after:wN \cs_set_eq:NN \exp_after:wN \l__rtsig_tok \cs:w #1 \cs_end:
      \exp_after:wN \str_set:Nn \exp_after:wN \l__rtsig_meaning_str
        \exp_after:wN { \token_to_meaning:N \l__rtsig_tok }
      \__rtsig_escape:N \l__rtsig_meaning_str
      \iow_now:Nx \g__rtsig_iow { M: \l__rtsig_meaning_str }
      \bool_if:NT \l__rtsig_follow_bool
        {
          \str_if_in:NnTF \l__rtsig_meaning_str { __cmd_start_env }
            { \GetDocumentEnvironmentArgSpec {#1} \__rtsig_spec: }
            {
              \str_if_in:NnT \l__rtsig_meaning_str { __cmd_start }
                { \exp_after:wN \GetDocumentCommandArgSpec \cs:w #1 \cs_end: \__rtsig_spec: }
            }
          \token_if_macro:NT \l__rtsig_tok
            {
              \__rtsig_expl:nTF {#1} { }
                {
                  \int_compare:nNnT { \str_count:N \l__rtsig_meaning_str } < { ${MAX_FOLLOWED} }
                    { \__rtsig_follow: }
                  \str_if_in:NnT \l__rtsig_meaning_str { protect }
                    { \__rtsig_found:n { #1 ~ } }
                  \str_if_in:NnT \l__rtsig_meaning_str { testopt }
                    {
                      \__rtsig_found:x { \c_backslash_str #1 }
                      \__rtsig_found:x { \c_backslash_str #1 ~ }
                    }
                  \str_if_in:NnT \l__rtsig_meaning_str { to@ScanSecondOptArg }
                    { \__rtsig_found:n { 2 #1 } }
                  \str_if_in:NnT \l__rtsig_meaning_str { __cmd_start }
                    {
                      \__rtsig_found:n { #1 ~ code }
                      \__rtsig_found:n { environment ~ #1 ~ code }
                      \__rtsig_found:n { environment ~ #1 ~ end }
                      \__rtsig_found:n { environment ~ #1 ~ end ~ aux }
                      \__rtsig_found:n { environment ~ #1 ~ end ~ code }
                    }
                }
            }
        }
    \else:
      \iow_now:Nn \g__rtsig_iow { M:undefined }
    \fi:
  }
\iow_open:Nn \g__rtsig_iow { \c_sys_jobname_str .rtm }
\ior_open:NnT \g__rtsig_ior { \c_sys_jobname_str .rtk }
  {
    \ior_str_map_inline:Nn \g__rtsig_ior { \__rtsig_mark:x { \str_range:nnn {#1} { 1 } { -2 } } }
    \ior_close:N \g__rtsig_ior
  }
\ior_open:NnT \g__rtsig_ior { \c_sys_jobname_str .rtn }
  {
    \ior_str_map_inline:Nn \g__rtsig_ior { \__rtsig_given:x { \str_range:nnn {#1} { 1 } { -2 } } }
    \ior_close:N \g__rtsig_ior
  }
\cs_set_protected:Npn \__rtsig_run:
  {
    % The catcodes the meanings are read back in, set once for the whole walk: the walk's code is
    % read already, and the rescans alone read anything new.
    \group_begin:
    \__rtsig_catcodes:
    \bool_while_do:nn { \int_compare_p:nNn { \l__rtsig_head_int } < { \l__rtsig_tail_int } }
      {
        \int_incr:N \l__rtsig_head_int
        \int_compare:nNnTF { \l__rtsig_count_int } < { ${MAX_PRINTED} }
          { \exp_args:Nv \__rtsig_print:n { rtsig~queue~\int_use:N \l__rtsig_head_int } }
          {
            \int_set_eq:NN \l__rtsig_head_int \l__rtsig_tail_int
            \iow_now:Nn \g__rtsig_iow { T: }
          }
      }
    \group_end:
  }
\__rtsig_run:
\iow_now:Nn \g__rtsig_iow { E: }
\iow_close:N \g__rtsig_iow
\group_end:
\ExplSyntaxOff
\csname @@end\endcsname
`;
}

/** Names as a file the code reads: a line each, a `|` after each for the spaces TeX would drop. */
export const nameLines = (names: Iterable<string>) =>
  [...names].map((name) => `${name}|\n`).join("");

/** A name the compiles can be given: printable ASCII, so that its bytes are the same either way. */
const isGivable = (name: string) => name !== "" && /^[\x20-\x7e]+$/.test(name);

/** What the compile printed of a name: its meaning, and its xparse specification if any. */
export interface Printed {
  meaning: string;
  spec?: string;
}

/** A compile's records, and whether it printed them all. */
export interface Printout {
  records: Map<string, Printed>;
  /** It reached its end. */
  ended: boolean;
  /** It stopped at its cap of MAX_PRINTED names. */
  truncated: boolean;
}

/** The records a compile wrote (`meaningsCode`). */
export function readPrintout(text: string): Printout {
  const records = new Map<string, Printed>();
  let current: Printed | undefined;
  let ended = false;
  let truncated = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("N:")) {
      current = { meaning: "" };
      records.set(line.slice(2), current);
    } else if (line.startsWith("M:") && current !== undefined) current.meaning = line.slice(2);
    else if (line.startsWith("S:") && current !== undefined) current.spec = line.slice(2).trim();
    else if (line === "T:") truncated = true;
    else if (line === "E:") ended = true;
  }
  return { records, ended, truncated };
}

/**
 * A file a compile wrote, as text a line at a time: each line UTF-8 where it is, and Latin-1 where
 * it is not, so that one meaning's bytes cannot change how another's read.
 */
export function linesOf(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let start = 0; start <= bytes.length; ) {
    const end = bytes.indexOf(10, start);
    const stop = end < 0 ? bytes.length : end;
    lines.push(decodeText(bytes.subarray(start, stop)));
    start = stop + 1;
  }
  return lines.join("\n");
}

/** A meaning as `\meaning` shows it: a macro's prefixes, parameters and replacement, or its kind. */
export type Meaning =
  | {
      kind: "macro";
      long: boolean;
      protected: boolean;
      outer: boolean;
      parameters: string;
      replacement: string;
    }
  | { kind: "undefined" | "primitive" | "char" | "register" | "other" };

const MACRO = /^((?:\\(?:protected|long|outer))*) ?macro:/;

/** Read what `\meaning` printed. */
export function readMeaning(text: string): Meaning {
  if (text === "undefined") return { kind: "undefined" };
  const macro = MACRO.exec(text);
  if (macro) {
    const rest = text.slice(macro[0].length);
    const arrow = rest.indexOf("->");
    const prefixes = macro[1] ?? "";
    return {
      kind: "macro",
      long: prefixes.includes("\\long"),
      protected: prefixes.includes("\\protected"),
      outer: prefixes.includes("\\outer"),
      parameters: arrow < 0 ? rest : rest.slice(0, arrow),
      replacement: arrow < 0 ? "" : rest.slice(arrow + 2),
    };
  }
  if (/^\\char"[0-9A-F]+$/.test(text)) return { kind: "char" };
  if (/^\\(?:count|dimen|skip|muskip|toks)\d+$/.test(text)) return { kind: "register" };
  if (/^\\(?:math|Umath)char/.test(text)) return { kind: "other" };
  if (/^\\\S+$/.test(text)) return { kind: "primitive" };
  return { kind: "other" };
}

/** A token of a meaning as the compile prints it. */
export type Token =
  | { kind: "cs"; name: string }
  | { kind: "open" }
  | { kind: "close" }
  | { kind: "parameter"; text: string }
  | { kind: "char"; text: string };

/**
 * A meaning's tokens as the compile prints them, where every printable character is a letter: a
 * control sequence is a backslash and its name up to the space TeX prints after it, but for the
 * control space, `\ `, whose space is its name; a parameter is `#` and a digit, or `##`.
 */
export function tokensOf(text: string): Token[] {
  const tokens: Token[] = [];
  for (let at = 0; at < text.length; ) {
    const char = text[at] ?? "";
    const next = text[at + 1];
    if (char === "\\" && next !== undefined) {
      if (next === " ") {
        tokens.push({ kind: "cs", name: " " });
        at += 2;
        continue;
      }
      const space = text.indexOf(" ", at + 1);
      const end = space < 0 ? text.length : space;
      tokens.push({ kind: "cs", name: text.slice(at + 1, end) });
      at = end + 1;
      continue;
    }
    if (char === "#" && next !== undefined && /[1-9#]/.test(next)) {
      tokens.push({ kind: "parameter", text: char + next });
      at += 2;
      continue;
    }
    tokens.push(
      char === "{"
        ? { kind: "open" }
        : char === "}"
          ? { kind: "close" }
          : { kind: "char", text: char },
    );
    at++;
  }
  return tokens;
}

/**
 * An xparse specification as the parser reads it: its processors, `>{...}` and `={...}`, which do
 * not change what it reads, taken out; undefined when what is left cannot be read.
 */
export function xparseSpec(spec: string): string | undefined {
  let out = "";
  for (let i = 0; i < spec.length; i++) {
    const char = spec[i];
    // A `>` that closes the delimiters of `d<>`, `D<>`, `r<>` or `R<>` is no processor.
    const closes = char === ">" && /[dDrR]<$/.test(out);
    if ((char === ">" || char === "=") && spec[i + 1] === "{" && !closes) {
      let depth = 0;
      let j = i + 1;
      for (; j < spec.length; j++) {
        if (spec[j] === "{") depth++;
        else if (spec[j] === "}" && --depth === 0) break;
      }
      i = j;
      continue;
    }
    out += char;
  }
  const cleaned = out.replace(/\s+/g, " ").trim();
  return isReadable(cleaned) ? cleaned : undefined;
}

/** A macro's arguments as read from its meaning, or why they could not be. */
export interface Resolved {
  spec?: string;
  how: Resolution;
  why?: string;
  tail?: "unresolved";
  package?: string;
}

/** How deep `resolve` follows a macro into those it hands its work to, a tail's among them. */
const MAX_DEPTH = 3;

/** The robust shape: `\protect \x  `, or `\x@protect \x \protect \x  ` for a control symbol. */
const ROBUST = /^(?:\\x@protect \\(.) ?\\protect \\\1 |\\protect \\(.+) ) $/s;

/** The optional-argument shape: `\@protected@testopt \x \\x {default}`, or `\@testopt \\x {...}`. */
const OPTIONAL = [/^\\@protected@testopt \\(.+?) \\\\\1 \{/s, /^\\@testopt \\\\(.+?) \{/s];

/** Commands that look ahead for the next character, as `\@ifnextchar [` does. */
const NEXT_CHARACTER = new Set(["@ifnextchar", "kernel@ifnextchar", "new@ifnextchar"]);

/** Commands that look ahead for a macro's arguments in ways a meaning cannot say. */
const LOOKS_AHEAD = /^\\(?:@ifnextchar|kernel@ifnextchar|new@ifnextchar|@ifstar|futurelet|@ifnch) /;

/**
 * Commands that take the name after them as their own argument, so that a replacement text that
 * ends with the two hands nothing on: `\def\x{...}`, `\let\x\y`, `\setbox\x`.
 */
const TAKES_A_NAME = new Set([
  ...["def", "edef", "gdef", "xdef", "let", "global", "long", "outer", "protected", "noexpand"],
  ...["the", "string", "meaning", "show", "showthe", "showbox", "ifx", "ifdefined", "box", "copy"],
  ...["unhbox", "unvbox", "unhcopy", "unvcopy", "setbox", "wd", "ht", "dp", "advance"],
  ...["multiply", "divide", "chardef", "mathchardef", "countdef", "dimendef", "skipdef"],
  ...["toksdef", "font", "aftergroup", "afterassignment", "newcommand", "renewcommand"],
  ...["providecommand", "DeclareRobustCommand", "newif", "newlength", "newcount", "newdimen"],
  ...["newskip", "newtoks", "newbox", "newsavebox", "setlength", "addtolength", "settowidth"],
  ...["settoheight", "settodepth", "sbox", "savebox", "usebox", "@namedef"],
]);

/**
 * Commands that take a name and then the name after it as their own arguments, so that a
 * replacement text that ends with the three hands nothing on: `\setlength\x\y`.
 */
const TAKES_TWO_NAMES = ["let", "futurelet", "setlength", "addtolength", "advance", "multiply"];

/**
 * Commands a tail may end with that take no arguments, which the table does not list, and
 * `\xspace`, which looks at what follows and takes none of it.
 */
const TAKES_NOTHING = new Set([
  ...["fi", "else", "or", "cr", "crcr", "unkern", "unpenalty", "hfilneg", "vfilneg", "endinput"],
  "xspace",
]);

/**
 * An expl3 function's arguments, which its name's signature says: one for each letter, and none
 * that can be read for one that takes a parameter text, reads up to a delimiter, or builds a name
 * (`p`, `w`, `D`, `c`).
 */
function expl3Arguments(name: string): string[] | undefined {
  const signature = /^[A-Za-z_@]+:([A-Za-z]*)$/.exec(name)?.[1];
  if (signature === undefined || /[pwDc]/.test(signature)) return undefined;
  return mandatory(signature.length);
}

/** TeX's boxes, whose one brace group, when a tail gives it, is all they take. */
const BOXES = new Set(["hbox", "vbox", "vtop", "vcenter"]);

const UNRESOLVED_LOOK: Resolved = { how: "unresolved", why: "looks ahead" };

/**
 * A command's arguments from what the compile printed, by the shape of its meaning: a package's
 * table, an xparse specification, the robust command's real macro, the optional argument's second
 * macro, a look ahead by hand, or the parameters of a plain one and what its tail takes. A name
 * the compile did not print whose base the table knows, as an alias of `\textbf` hands its work to
 * `\textbf `, takes the table's.
 */
export function resolve(name: string, records: ReadonlyMap<string, Printed>, depth = 0): Resolved {
  const record = records.get(name);
  if (record === undefined) {
    const base = name.endsWith(" ") ? name.slice(0, -1) : name;
    const standard = STANDARD.get(base);
    if (depth > 0 && standard !== undefined && isReadable(standard.spec))
      return { spec: standard.spec, how: "meaning" };
    return { how: "unresolved", why: "not printed" };
  }
  if (record.spec !== undefined) {
    const spec = xparseSpec(record.spec);
    return spec === undefined
      ? { how: "unresolved", why: "specification" }
      : { spec, how: "xparse" };
  }
  const meaning = readMeaning(record.meaning);
  if (meaning.kind !== "macro") return { how: "unresolved", why: meaning.kind };
  const found: Resolved =
    depth > MAX_DEPTH
      ? { how: "unresolved", why: "too deep" }
      : fromMeaning(meaning.parameters, meaning.replacement, records, depth);
  const known = packageSignature(name, record.meaning);
  if (known === undefined) return found;
  return {
    spec: known.spec,
    how: found.how === "unresolved" ? "meaning" : found.how,
    package: known.package,
  };
}

/** A macro's arguments from its parameters and replacement text, by the shapes above. */
function fromMeaning(
  parameters: string,
  replacement: string,
  records: ReadonlyMap<string, Printed>,
  depth: number,
): Resolved {
  const tokens = tokensOf(replacement);
  if (parameters === "") {
    const robust = ROBUST.exec(replacement);
    if (robust) {
      const found = resolve(`${robust[1] ?? robust[2] ?? ""} `, records, depth + 1);
      return found.how === "unresolved" ? found : { ...found, how: "robust" };
    }
    const optional = OPTIONAL.map((shape) => shape.exec(replacement)).find((hit) => hit !== null);
    if (optional) return optionalForm(optional[1] ?? "", records, depth);
    const ahead = lookAhead(tokens, records, depth);
    if (ahead !== undefined) return ahead;
    if (LOOKS_AHEAD.test(replacement)) return UNRESOLVED_LOOK;
  }
  if (!/^(?:#\d)*$/.test(parameters)) return { how: "unresolved", why: "delimited" };
  return withTail(mandatory(parameters.length / 2), tokens, records, depth, "meaning");
}

const mandatory = (count: number) => Array.from({ length: count }, () => "m");

/**
 * The optional-argument form's arguments, from its second macro, `\\x`: `[#1]` and plain
 * parameters, and what its tail takes, or twoopt's two optional arguments. An alias of a command
 * the table knows, as `\let\x\section`, which the compile does not follow, takes the table's.
 */
function optionalForm(
  target: string,
  records: ReadonlyMap<string, Printed>,
  depth: number,
): Resolved {
  const second = records.get(`\\${target}`);
  if (second === undefined) {
    const standard = STANDARD.get(target.trimEnd());
    return standard !== undefined && isReadable(standard.spec)
      ? { spec: standard.spec, how: "optional" }
      : { how: "unresolved", why: "optional" };
  }
  const found = bracketed(second, records, depth + 1);
  return found.how === "unresolved" ? { how: "unresolved", why: "optional" } : found;
}

/**
 * What a macro takes that a look ahead for `[` hands to: its parameters, `[#1]` and plain ones,
 * and what its tail takes; or, twoopt's second macro, two optional arguments and the rest.
 */
function bracketed(
  printed: Printed,
  records: ReadonlyMap<string, Printed>,
  depth: number,
): Resolved {
  const meaning = readMeaning(printed.meaning);
  const rest = meaning.kind === "macro" ? /^\[#1\]((?:#\d)*)$/.exec(meaning.parameters) : null;
  if (meaning.kind !== "macro" || rest === null) return { how: "unresolved" };
  const twoopt = twooptSpec(meaning.replacement, (name) => records.get(name)?.meaning);
  if (twoopt !== undefined) return { spec: twoopt, how: "optional", package: "twoopt" };
  const own = ["o", ...mandatory((rest[1] ?? "").length / 2)];
  return withTail(own, tokensOf(meaning.replacement), records, depth, "optional");
}

/**
 * A macro's arguments: its own, then what the command its replacement text ends with takes beyond
 * the brace groups that follow it there, as `\ding`, `\Pisymbol {pzd}`, takes one more. A tail
 * whose own cannot be read leaves the macro's own, marked `tail`.
 */
function withTail(
  own: string[],
  tokens: readonly Token[],
  records: ReadonlyMap<string, Printed>,
  depth: number,
  how: Resolution,
): Resolved {
  const tail = tailOf(tokens);
  if (tail === undefined) return { spec: own.join(" "), how };
  const after =
    tail === "unknown" ? undefined : handedOn(tail.name, tail.groups, records, depth + 1);
  const agree =
    after !== undefined &&
    tail !== "unknown" &&
    tail.others.every((other) => {
      const branch = handedOn(other, 0, records, depth + 1);
      return branch !== undefined && branch.items.join(" ") === after.items.join(" ");
    });
  if (after === undefined || !agree) return { spec: own.join(" "), how, tail: "unresolved" };
  const spec = [...own, ...after.items].join(" ");
  return after.tail ? { spec, how, tail: "unresolved" } : { spec, how };
}

/** Whether a token is a space. */
const isSpace = (token: Token | undefined) => token?.kind === "char" && token.text === " ";

/** Where the brace group that closes just before `end` opens, or -1. */
function groupStart(tokens: readonly Token[], end: number): number {
  let depth = 0;
  for (let at = end - 1; at >= 0; at--) {
    const token = tokens[at];
    if (token?.kind === "close") depth++;
    else if (token?.kind === "open" && --depth === 0) return at;
  }
  return -1;
}

/** The last token before `end` that is no space, and where it is. */
function lastBefore(tokens: readonly Token[], end: number): { token?: Token; at: number } {
  let at = end - 1;
  while (at >= 0 && isSpace(tokens[at])) at--;
  return { token: tokens[at], at };
}

/** What a replacement text ends by handing on to (`tailOf`). */
interface Tail {
  name: string;
  /** How many brace groups follow it there. */
  groups: number;
  /** The commands a conditional's other branches hand on to, which must take the same. */
  others: string[];
}

const named = (token: Token | undefined, names: readonly string[]) =>
  token?.kind === "cs" && names.includes(token.name);

/**
 * The command a replacement text ends with, and how many brace groups follow it there: what the
 * macro hands the rest of its arguments to. Undefined when it ends with anything else, or with a
 * name a command before it takes as its own (`\def\x{...}`, `\let\x\y`, `\kern\z@`, `2\p@`);
 * `unknown` when it ends in a way whose reading on cannot be said: a look ahead, `\futurelet`, a
 * name built with `\csname`, or `\expandafter` and a command before the last. A conditional
 * whose every branch ends with `\expandafter` and a command, as etoolbox's
 * `\expandafter\@firstoftwo \else \expandafter\@secondoftwo \fi`, hands on to those commands.
 */
function tailOf(tokens: readonly Token[]): Tail | "unknown" | undefined {
  let end = tokens.length;
  let groups = 0;
  for (;;) {
    const last = lastBefore(tokens, end);
    if (last.token?.kind !== "close") break;
    const start = groupStart(tokens, last.at + 1);
    if (start < 0) return undefined;
    end = start;
    groups++;
  }
  const last = lastBefore(tokens, end);
  const before = lastBefore(tokens, last.at);
  const twoBefore = lastBefore(tokens, before.at);
  const threeBefore = lastBefore(tokens, twoBefore.at);
  const looks = [...NEXT_CHARACTER, "@ifstar"];
  if (last.token?.kind === "char") return named(before.token, looks) ? "unknown" : undefined;
  if (last.token?.kind !== "cs") return undefined;
  const name = last.token.name;
  if ([before, twoBefore, threeBefore].some((token) => named(token.token, looks))) return "unknown";
  if (name === "fi" && groups === 0 && named(twoBefore.token, ["expandafter"]))
    return conditionalTail(tokens, before);
  if (named(twoBefore.token, ["futurelet", "expandafter"]) || name === "endcsname")
    return "unknown";
  if (before.token?.kind === "char" && /^[-+=.,0-9]$/.test(before.token.text)) return undefined;
  if (before.token?.kind === "cs" && TAKES_A_NAME.has(before.token.name)) return undefined;
  if (before.token?.kind === "cs" && QUANTITIES.has(before.token.name)) return undefined;
  if (named(twoBefore.token, TAKES_TWO_NAMES)) return undefined;
  return { name, groups, others: [] };
}

/**
 * The tail of a conditional that ends `\expandafter X \fi`: X, when every `\else` and `\or` in the
 * text follows `\expandafter` and a command, those commands the other branches' tails. `unknown`
 * when any does not, or there is no other branch, since the macro then takes X's arguments only
 * as the test falls.
 */
function conditionalTail(
  tokens: readonly Token[],
  last: { token?: Token; at: number },
): Tail | "unknown" {
  if (last.token?.kind !== "cs") return "unknown";
  const others: string[] = [];
  for (let at = 0; at < last.at; at++) {
    if (!named(tokens[at], ["else", "or"])) continue;
    const branch = lastBefore(tokens, at);
    if (branch.token?.kind !== "cs" || !named(lastBefore(tokens, branch.at).token, ["expandafter"]))
      return "unknown";
    others.push(branch.token.name);
  }
  return others.length === 0 ? "unknown" : { name: last.token.name, groups: 0, others };
}

/**
 * What a command takes beyond `groups` brace groups given it: the arguments left, and whether it
 * too may take more (`tail`). Undefined when that cannot be read: a command the compile did not
 * print and neither the table nor TeX's commands that take nothing know, or one that reads a
 * quantity or a definition.
 */
function handedOn(
  name: string,
  groups: number,
  records: ReadonlyMap<string, Printed>,
  depth: number,
): { items: string[]; tail: boolean } | undefined {
  if (TAKES_NOTHING.has(name)) return { items: [], tail: false };
  const expl3 = expl3Arguments(name);
  if (expl3 !== undefined) {
    const items = afterGroups(expl3.join(" "), groups);
    return items === undefined ? undefined : { items, tail: false };
  }
  if (records.has(name)) {
    const found = resolve(name, records, depth);
    const items = found.spec === undefined ? undefined : afterGroups(found.spec, groups);
    return items === undefined ? undefined : { items, tail: found.tail === "unresolved" };
  }
  const standard = STANDARD.get(name);
  if (standard !== undefined) {
    if (standard.role.kind === "definition") return undefined;
    if (standard.role.kind === "quantity")
      return groups > 0 && BOXES.has(name) ? { items: [], tail: false } : undefined;
    const items = afterGroups(standard.spec, groups);
    return items === undefined ? undefined : { items, tail: false };
  }
  return undefined;
}

/**
 * What a specification leaves to read after `groups` brace groups: each fills the next mandatory
 * argument, and passes a star or an optional argument, which a brace is not. None when the groups
 * are more than it takes; undefined when a group meets an argument it cannot give, as one in
 * other delimiters.
 */
function afterGroups(spec: string, groups: number): string[] | undefined {
  const parts = readSpec(spec);
  if (parts === undefined) return undefined;
  let left = groups;
  let at = 0;
  for (; at < parts.length && left > 0; at++) {
    const part = parts[at];
    if (part?.type === "mandatory" && part.openBrace === "{") left--;
    else if (part?.type === "mandatory") return undefined;
  }
  return parts.slice(at).map((part) => printRaw(part));
}

/**
 * Where a look ahead's branch starts and ends, a brace group or a token, from `at`, past spaces;
 * and where what follows it starts.
 */
function branchAt(
  tokens: readonly Token[],
  from: number,
): { start: number; end: number; next: number } | undefined {
  let at = from;
  while (isSpace(tokens[at])) at++;
  const token = tokens[at];
  if (token === undefined || token.kind === "close") return undefined;
  if (token.kind !== "open") return { start: at, end: at + 1, next: at + 1 };
  let depth = 0;
  for (let end = at; end < tokens.length; end++) {
    if (tokens[end]?.kind === "open") depth++;
    else if (tokens[end]?.kind === "close" && --depth === 0)
      return { start: at + 1, end, next: end + 1 };
  }
  return undefined;
}

/** Where a balanced group that opens at `at` ends, past its close; or -1. */
function groupEnd(tokens: readonly Token[], at: number): number {
  let depth = 0;
  for (let end = at; end < tokens.length; end++) {
    if (tokens[end]?.kind === "open") depth++;
    else if (tokens[end]?.kind === "close" && --depth === 0) return end + 1;
  }
  return -1;
}

/**
 * Past the flags a branch sets before it hands on: spaces, `\relax`, `\protect`, `\global`, a
 * `\newif` switch (`\@xtrue`, `\@xfalse`), `\let` and its two tokens, and `\def` and its kin with
 * a name, its parameters and its body.
 */
function pastSetters(tokens: readonly Token[], from: number, end: number): number {
  let at = from;
  while (at < end) {
    const token = tokens[at];
    if (isSpace(token)) {
      at++;
      continue;
    }
    if (token?.kind !== "cs") return at;
    const name = token.name;
    if (["relax", "protect", "global"].includes(name) || /^(?!if).+(?:true|false)$/.test(name)) {
      at++;
      continue;
    }
    if (name === "let") {
      let next = at + 2;
      while (isSpace(tokens[next])) next++;
      const equals = tokens[next];
      if (equals?.kind === "char" && equals.text === "=") next++;
      while (isSpace(tokens[next])) next++;
      at = next + 1;
      continue;
    }
    if (["def", "edef", "gdef", "xdef"].includes(name)) {
      let next = at + 2;
      while (next < end && tokens[next]?.kind !== "open") next++;
      const close = groupEnd(tokens, next);
      if (close < 0) return at;
      at = close;
      continue;
    }
    return at;
  }
  return at;
}

/** Whether the tokens from `from` to `end` are spaces alone. */
const onlySpaces = (tokens: readonly Token[], from: number, end: number) =>
  tokens.slice(from, end).every((token) => isSpace(token));

/**
 * What a look ahead's branch takes: past the flags it sets, the first command that takes arguments
 * beyond the brace groups it is given there, whose arguments must be the last of the branch. The
 * branch `\@ifnextchar [` takes when a `[` follows hands on to a command whose parameters are
 * `[#1]` and plain ones, or whose first argument is optional; the one `\@ifnextchar *` takes
 * leaves the star to it, and hands on to one whose parameters are `*` and plain ones. Unresolved
 * when no command in the branch takes arguments.
 */
function branchTakes(
  tokens: readonly Token[],
  records: ReadonlyMap<string, Printed>,
  depth: number,
  next: "[" | "*" | undefined,
): Resolved {
  for (let at = pastSetters(tokens, 0, tokens.length); at < tokens.length; ) {
    const token = tokens[at];
    if (token?.kind !== "cs") return UNRESOLVED_LOOK;
    let end = at + 1;
    let groups = 0;
    while (tokens[end]?.kind === "open") {
      end = groupEnd(tokens, end);
      if (end < 0) return UNRESOLVED_LOOK;
      groups++;
    }
    const last = onlySpaces(tokens, end, tokens.length);
    const printed = records.get(token.name);
    const opened = printed === undefined ? undefined : readMeaning(printed.meaning);
    const delimited = opened?.kind === "macro" && /^[[*]/.test(opened.parameters);
    if (next === "*" || (delimited && groups === 0)) {
      // The star or the `[` is the next character: the command that finds it must take it.
      if (printed === undefined || opened?.kind !== "macro" || !last || groups > 0)
        return UNRESOLVED_LOOK;
      let found = UNRESOLVED_LOOK;
      if (next === "*") found = starred(opened, records, depth);
      else if (next === "[") found = bracketed(printed, records, depth);
      return found.how === "unresolved" ? UNRESOLVED_LOOK : { ...found, how: "optional" };
    }
    const after = handedOn(token.name, groups, records, depth);
    if (after === undefined) return UNRESOLVED_LOOK;
    if (after.items.length > 0) {
      const first = readSpec(after.items[0] ?? "")?.[0];
      if (!last || (next === "[" && (first?.type !== "optional" || first.openBrace !== "[")))
        return UNRESOLVED_LOOK;
      return {
        spec: after.items.join(" "),
        how: "optional",
        ...(after.tail ? { tail: "unresolved" as const } : {}),
      };
    }
    at = pastSetters(tokens, end, tokens.length);
  }
  return UNRESOLVED_LOOK;
}

/** What a macro whose parameters are `*` and plain ones takes after the star, and its tail's. */
function starred(
  meaning: Extract<Meaning, { kind: "macro" }>,
  records: ReadonlyMap<string, Printed>,
  depth: number,
): Resolved {
  const rest = /^\*((?:#\d)*)$/.exec(meaning.parameters);
  if (rest === null) return UNRESOLVED_LOOK;
  const own = mandatory((rest[1] ?? "").length / 2);
  return withTail(own, tokensOf(meaning.replacement), records, depth, "optional");
}

/**
 * A look ahead by hand, `\@ifnextchar [{...}{...}` or `\@ifstar {...}{...}` (or
 * `\@ifnextchar *`), the whole of a replacement text but for the flags set before it: through the
 * branch that takes the optional argument, or the star's two branches, which must agree on what
 * follows the star. Undefined for a replacement text of any other shape.
 */
function lookAhead(
  tokens: readonly Token[],
  records: ReadonlyMap<string, Printed>,
  depth: number,
): Resolved | undefined {
  let at = pastSetters(tokens, 0, tokens.length);
  const head = tokens[at];
  if (head?.kind !== "cs") return undefined;
  // What the first branch finds next: a `[`, or a star `\@ifnextchar` leaves in place; none when
  // `\@ifstar` has taken the star.
  let next: "[" | "*" | undefined;
  if (NEXT_CHARACTER.has(head.name)) {
    const char = tokens[at + 1];
    if (char?.kind !== "char" || (char.text !== "[" && char.text !== "*")) return undefined;
    next = char.text;
    at += 2;
  } else if (head.name === "@ifstar") at += 1;
  else return undefined;
  const first = branchAt(tokens, at);
  const second = first === undefined ? undefined : branchAt(tokens, first.next);
  if (first === undefined || second === undefined) return UNRESOLVED_LOOK;
  if (!onlySpaces(tokens, second.next, tokens.length)) return UNRESOLVED_LOOK;
  const branch = (range: { start: number; end: number }) => tokens.slice(range.start, range.end);
  const given = branchTakes(branch(first), records, depth + 1, next);
  if (next === "[" || given.how === "unresolved") return given;
  const plain = branchTakes(branch(second), records, depth + 1, undefined);
  if (plain.how === "unresolved" || plain.spec !== given.spec) return UNRESOLVED_LOOK;
  const tail = given.tail ?? plain.tail;
  return { spec: `s ${given.spec}`, how: "optional", ...(tail ? { tail } : {}) };
}

/**
 * The names a meaning names, as the compile prints them: a backslash, then its name up to the
 * space TeX prints after it. A name holding a space, as xparse's `\x code`, reads as its first
 * word; the compile prints those a macro hands its work to beside it, which `closure` adds.
 */
export function namesIn(meaning: string): string[] {
  return tokensOf(meaning).flatMap((token) => (token.kind === "cs" ? [token.name] : []));
}

/** The names a macro may hand its work to, which the compile prints beside it. */
const companions = (name: string) => [
  `${name} `,
  `\\${name}`,
  `\\${name} `,
  `2${name}`,
  `${name} code`,
  `environment ${name} code`,
  `environment ${name} end`,
  `environment ${name} end aux`,
  `environment ${name} end code`,
];

/**
 * The names a template macro that holds data may name besides characters: `\relax`, `\@empty`,
 * `\protect` and `\space` (`~` is a character); the text the parser's table decodes, escapes,
 * symbols, letters, accents, marks, declarations, links and `\\`, since a name holds `\'e` and an
 * address `\href`; the spacing and dots Awesome-CV's example puts between a person's positions,
 * `{\enskip\cdotp\enskip}`, and their kin; and the breaks and skips a list of contacts holds, as
 * an AltaCV `\personalinfo{...}` does.
 */
const DATA_NAMES: ReadonlySet<string> = new Set([
  ...["relax", "@empty", "protect", "space"],
  ...[...STANDARD]
    .filter(([, standard]) =>
      ["symbol", "accent", "mark", "declaration", "link", "address", "break"].includes(
        standard.role.kind,
      ),
    )
    .map(([name]) => name),
  ...[" ", ",", ";", ":", "!", "-", "@", "/", "enskip", "enspace", "quad", "qquad", "thinspace"],
  ...["xspace", "nobreakspace", "newline", "cdotp", "textperiodcentered", "slash", "today"],
  ...["smallskip", "medskip", "bigskip", "par", "hfill", "hfil", "vfill", "linebreak", "nobreak"],
  ...["strut", "noindent", "null", "unskip", "ignorespaces"],
]);

/** Commands a template macro that holds data may give brace groups to: spacing. */
const DATA_CALLS: ReadonlySet<string> = new Set(["hspace", "vspace"]);

/**
 * Whether a template macro holds data, not code: its replacement text holds no parameter, and
 * names nothing but text (`DATA_NAMES`) and, each given a brace group, commands `calls` says take
 * arguments. A preamble's `\name{Quill}{Invented}` makes one, `\newcommand{\myemail}{...}` another,
 * and AltaCV's `\personalinfo{\email{...}\phone{...}}` a third; the caller checks that the macro
 * itself takes nothing, so that one that hands on, `\cvsubsection` as `\cvsection{sub}`, is code.
 */
export function isData(meaning: Meaning, calls: (name: string) => boolean = () => false): boolean {
  if (meaning.kind !== "macro") return false;
  const tokens = tokensOf(meaning.replacement);
  return tokens.every(
    (token, at) =>
      token.kind !== "parameter" &&
      (token.kind !== "cs" ||
        DATA_NAMES.has(token.name) ||
        (tokens[at + 1]?.kind === "open" && (DATA_CALLS.has(token.name) || calls(token.name)))),
  );
}

/**
 * Whether a name is a scratch macro's, whose meaning is whatever was last put in it, and so no part
 * of a template's definition: LaTeX's `\@tempa`, `\reserved@a` and their kin, xkeyval's and
 * ltxcmds' state, the option being processed, `\@ifnextchar`'s helpers, expl3's variables, and what
 * `\@ifpackageloaded` reads, a package's version and options.
 */
export function isScratch(name: string): boolean {
  return (
    SCRATCH.includes(name) ||
    /^(?:@temp|reserved@|XKV@|LTXcmds@|@gtemp|@curr|@x|[lgc]_|ver@|opt@)/.test(name) ||
    /@temp[a-f]$/.test(name) ||
    /^(?:CurrentOption|@filelist|@unusedoptionlist|@classoptionslist|@raw@classoptionslist)$/.test(
      name,
    ) ||
    /^(?:@declaredoptions|@ptionlist)$/.test(name)
  );
}

/** A placeholder of `length` characters for what item 11's patterns found: `<email___>`. */
function placeholder(kind: string, length: number): string {
  if (length < kind.length + 2) return "_".repeat(length);
  return `<${kind}${"_".repeat(length - kind.length - 2)}>`;
}

/** A link: a scheme and an address, `www.` and one, or a domain and a path. */
const LINK =
  /\b(?:(?:https?|ftp):\/\/|mailto:|www\.)[^\s{}\\]+|\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\/[^\s{}\\]*/g;

/** An email address. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** A run of digits and the separators a phone number has; one of 7 digits or more is one. */
const PHONE = /\+?\(?\d[\d ().~/+-]*\d/g;

/**
 * A definition with the personal data item 11's patterns find in it masked, each by a placeholder
 * of its own length: links, email addresses, and runs of 7 digits or more with separators, which
 * phone numbers are. A definition then hashes the same whoever's address it holds.
 */
export function masked(text: string): string {
  return text
    .replace(LINK, (found) => placeholder("link", found.length))
    .replace(EMAIL, (found) => placeholder("email", found.length))
    .replace(PHONE, (found) =>
      (found.match(/\d/g) ?? []).length >= 7 ? placeholder("phone", found.length) : found,
    );
}

/** The SHA-256 of a text in UTF-8, in hex. */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Each template macro's closure: the template macros its meaning names and those it hands its
 * work to, then theirs, the first reached first, until MAX_CLOSURE_MACROS macros, itself among
 * them, or MAX_CLOSURE_BYTES characters of meanings. A macro that holds data (`data`) is named in
 * it, by its name alone, and followed no further; it counts against neither cap, so that which
 * fields a preamble sets does not move where a closure stops.
 */
export function closure(
  name: string,
  meanings: ReadonlyMap<string, string>,
  data: ReadonlySet<string> = new Set(),
): { dependencies: string[]; capped: boolean } {
  const seen = new Set([name]);
  const queue = [name];
  const dependencies: string[] = [];
  let macros = 1;
  let bytes = meanings.get(name)?.length ?? 0;
  for (let at = 0; at < queue.length; at++) {
    const current = queue[at] ?? "";
    for (const next of [...namesIn(meanings.get(current) ?? ""), ...companions(current)]) {
      if (seen.has(next)) continue;
      if (data.has(next)) {
        seen.add(next);
        dependencies.push(next);
        continue;
      }
      const meaning = meanings.get(next);
      if (meaning === undefined) continue;
      seen.add(next);
      if (macros + 1 > MAX_CLOSURE_MACROS || bytes + meaning.length > MAX_CLOSURE_BYTES)
        return { dependencies, capped: true };
      macros++;
      bytes += meaning.length;
      dependencies.push(next);
      queue.push(next);
    }
  }
  return { dependencies, capped: false };
}

/**
 * Each definition's key: the SHA-256 of its hash and its dependencies' that are definitions, in
 * order, by name. A macro that holds data takes no part, neither its text nor whether a preamble
 * set it. It is item 6's cache key but for the naming version, and what the corpus runner compares
 * between documents: two whose class or style is the same file give each macro the file defines,
 * and the preamble leaves alone, the same key, whatever the person's name and settings.
 */
export async function keysOf(
  signatures: Pick<EngineSignatures, "macros">,
): Promise<Record<string, string>> {
  const keys = record<string>();
  for (const [name, macro] of Object.entries(signatures.macros)) {
    if (macro.kind === "data") continue;
    const dependencies = macro.dependencies.flatMap((dependency) => {
      const found = signatures.macros[dependency];
      return found?.kind === "data" ? [] : [[dependency, found?.hash ?? null]];
    });
    keys[name] = await sha256(JSON.stringify([macro.hash, dependencies]));
  }
  return keys;
}

/** A record for an object keyed by names a document gives, with no prototype to collide with. */
const record = <T>() => Object.create(null) as Record<string, T>;

/**
 * What the engine says of the names a body uses (`usesOf`), from two compiles in the reference's
 * job, which is forgotten after; or a refusal when the first compile never reaches the code that
 * prints, or stops before it prints anything, as when the document's preamble breaks it.
 */
export async function signatures(
  session: EngineSession,
  intake: Intake,
  made: Reference,
  body: Body,
  uses: Uses,
  options: SignatureOptions = {},
): Promise<EngineSignatures | Refusal> {
  const job = options.job ?? IMPORT_JOB;
  const engine = made.engine;
  const asked = [
    ...uses.commands,
    ...uses.environments.flatMap((name) => [name, `end${name}`]),
  ].filter(isGivable);
  const files = referenceFiles(intake, made, options);
  files[`${job}.rtn`] = new TextEncoder().encode(nameLines(asked));
  files[`${job}.rtk`] = new TextEncoder().encode(nameLines([...STANDARD.keys(), ...SCRATCH]));
  const main = `${body.before}${meaningsCode(true)}`;
  const bytes = encodeLike(intake.main.bytes, main) ?? new TextEncoder().encode(main);
  let ms = 0;
  const compile = (text: Uint8Array | string, given: Record<string, Uint8Array>) => {
    session.forget(job);
    const result = session.compile(engine, "stock", text, {
      job,
      maxPasses: 1,
      files: given,
      fontsByName: engine === "xetex",
    });
    ms += result.passes.reduce((sum, pass) => sum + pass, 0);
    const written = session.written(job, `${job}.rtm`);
    return { result, printout: written && readPrintout(linesOf(written)) };
  };
  const document = compile(bytes, files);
  // No file means the compile never reached the code that prints; an empty one that ends is a
  // body that uses nothing the table does not know.
  const nothing = document.printout !== undefined && document.printout.records.size === 0;
  if (document.printout === undefined || (nothing && !document.printout.ended)) {
    session.forget(job);
    return refusal("stopped", undefined, document.result.log);
  }
  const records = document.printout.records;
  const kernelNames = [...records.keys()].filter(isGivable);
  const kernel = compile(`\\documentclass{article}\\begin{document}${meaningsCode(false)}`, {
    [`${job}.rtn`]: new TextEncoder().encode(nameLines(kernelNames)),
  });
  session.forget(job);
  const inKernel = kernel.printout?.records ?? new Map<string, Printed>();

  /** What a printed name is: the template's macro, LaTeX's, or what else its meaning says. */
  const kindOf = (name: string): Signature["kind"] => {
    const printed = records.get(name);
    const meaning = readMeaning(printed?.meaning ?? "undefined");
    if (meaning.kind === "macro")
      return inKernel.get(name)?.meaning === printed?.meaning ? "standard" : "template";
    return meaning.kind === "undefined" ? "undefined" : meaning.kind;
  };
  const resolutions = new Map<string, Resolved>();
  const resolveOnce = (name: string) => {
    const known = resolutions.get(name);
    if (known !== undefined) return known;
    const found = resolve(name, records);
    resolutions.set(name, found);
    return found;
  };
  const signatureOf = (name: string): Signature => {
    const kind = kindOf(name);
    if (kind !== "template" && kind !== "standard") return { kind, how: "unresolved", why: kind };
    const resolved = resolveOnce(name);
    return {
      kind,
      how: resolved.how,
      ...(resolved.spec === undefined ? {} : { spec: resolved.spec }),
      ...(resolved.why === undefined ? {} : { why: resolved.why }),
      ...(resolved.tail === undefined ? {} : { tail: resolved.tail }),
      ...(resolved.package === undefined ? {} : { package: resolved.package }),
    };
  };
  const commands = record<Signature>();
  for (const name of uses.commands) commands[name] = signatureOf(name);
  const environments = record<Signature>();
  for (const name of uses.environments) environments[name] = signatureOf(name);

  // The template's macros: data, whose text never leaves this function, and definitions, masked;
  // scratch macros are neither. A macro that holds data takes nothing itself.
  const takesArguments = (name: string) =>
    kindOf(name) === "template" && (resolveOnce(name).spec ?? "") !== "";
  const meanings = new Map<string, string>();
  const data = new Map<string, number>();
  for (const [name, printed] of records) {
    if (kindOf(name) !== "template" || isScratch(name)) continue;
    const meaning = readMeaning(printed.meaning);
    const takesNothing = () => {
      const own = resolveOnce(name);
      return own.spec === "" && own.tail === undefined;
    };
    if (meaning.kind === "macro" && isData(meaning, takesArguments) && takesNothing())
      data.set(name, meaning.replacement.length);
    else meanings.set(name, masked(printed.meaning));
  }
  const held = new Set(data.keys());
  const macros = record<TemplateMacro | DataMacro>();
  for (const name of records.keys()) {
    const length = data.get(name);
    const meaning = meanings.get(name);
    if (length !== undefined) macros[name] = { kind: "data", length };
    else if (meaning !== undefined)
      macros[name] = { meaning, hash: await sha256(meaning), ...closure(name, meanings, held) };
  }
  return {
    engine,
    commands,
    environments,
    macros,
    truncated: document.printout.truncated || !document.printout.ended,
    ms,
  };
}
