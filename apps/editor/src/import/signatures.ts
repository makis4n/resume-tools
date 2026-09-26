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
 * that ends in a space), the optional argument's `\\x` (a name that starts with a backslash), and
 * xparse's `\x code` and its environments' code. TeX writes a line to a file whole, however long
 * (`max_print_line` bounds only the terminal and the log), with `\newlinechar` off, so a record's
 * lines are its lines. A second compile, from `\documentclass{article}` alone, prints the same
 * names' meanings in LaTeX's kernel: a name defined the same way there is standard, and every other
 * macro is the template's, whether its class, a package or its preamble defines it.
 *
 * `\meaning` shows a macro in three shapes that the arguments are read from. A plain macro,
 * `macro:#1#2->...`, takes one argument for each parameter. A `\newcommand` with an optional first
 * argument is `\@protected@testopt \x \\x {default}`, and its second macro, `\\x`, has the
 * parameters, `[#1]#2`; one written by hand looks ahead with `\@ifnextchar [` or `\@ifstar`, and
 * the branch it hands to has them. A `\DeclareRobustCommand` is `\protect \x  `, and its real macro
 * is `\x `, read in turn as any of the others. An xparse command's specification is xparse's own.
 * A macro whose parameters are delimited, or that looks ahead in any other way, is not resolved,
 * and the parser keeps its calls raw; so is a name the engine says is undefined, a primitive, a
 * `\char` or a register, which it records as such.
 *
 * A template macro's definition is its meaning, closed over the template macros it names, the
 * first reached first, to 64 macros and 64 KB; each meaning's SHA-256 is item 6's cache key.
 */

import type { Engine, EngineSession } from "../engine/session";
import { isReadable } from "./arguments";
import { decodeText, encodeLike, type Intake } from "./intake";
import type { Body, Known, Uses } from "./parse";
import { IMPORT_JOB, type Reference, type ReferenceOptions, referenceFiles } from "./reference";
import { type Refusal, refusal } from "./refusal";
import { SCRATCH, STANDARD } from "./standard";

/** How a command's arguments were read: from which shape of its meaning, or not at all. */
export type Resolution = "meaning" | "optional" | "robust" | "xparse" | "unresolved";

export const RESOLUTIONS: readonly Resolution[] = [
  "meaning",
  "optional",
  "robust",
  "xparse",
  "unresolved",
];

/** What the engine said of a command or an environment the body uses. */
export interface Signature extends Known {
  /** How its arguments were read; `unresolved` for anything that is not a macro. */
  how: Resolution;
  /** Why they could not be, for one unresolved: its kind, or what its meaning shows. */
  why?: string;
}

/** A template macro: its meaning, the hash of it, and the template macros it names, closed over. */
export interface TemplateMacro {
  /** Its `\meaning`, as TeX printed it: the normalised definition. */
  meaning: string;
  /** The SHA-256 of its meaning in UTF-8, in hex: item 6's cache key is built from it. */
  hash: string;
  /** The template macros its meaning names, and theirs, the first reached first, to the cap. */
  dependencies: string[];
  /** Whether the closure stopped at its cap, 64 macros or 64 KB of meanings. */
  capped: boolean;
}

/** What the two compiles said: every name the body uses, and every template macro found. */
export interface EngineSignatures {
  engine: Engine;
  /** What the body calls that the table does not know, by name. */
  commands: Record<string, Signature>;
  /** What the body opens that the table does not know, by name. */
  environments: Record<string, Signature>;
  /** Every template macro the compile printed, the body's and those they name, by name. */
  macros: Record<string, TemplateMacro>;
  /** Whether the compile stopped printing at its cap, or before its end, so that some are missing. */
  truncated: boolean;
  /** The two compiles' passes, in milliseconds. */
  ms: number;
}

export interface SignatureOptions extends ReferenceOptions {}

/** How many names the compile prints at most, the body's first. */
export const MAX_PRINTED = 2048;

/** The closure of a template macro's definition: at most this many macros, itself among them. */
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
 * so that a name that TeX printed whole reads back whole, and a control symbol as itself.
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
  { \iow_now:Nx \g__rtsig_iow { S: \exp_not:V \ArgumentSpecification } }
\cs_set_protected:Npn \__rtsig_print:n #1
  {
    \int_incr:N \l__rtsig_count_int
    \iow_now:Nn \g__rtsig_iow { N: #1 }
    \if_cs_exist:w #1 \cs_end:
      \exp_after:wN \cs_set_eq:NN \exp_after:wN \l__rtsig_tok \cs:w #1 \cs_end:
      \exp_after:wN \str_set:Nn \exp_after:wN \l__rtsig_meaning_str
        \exp_after:wN { \token_to_meaning:N \l__rtsig_tok }
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
}

/**
 * A look ahead by hand for an optional argument or a star, `\@ifnextchar [\x@opt \x@plain ` or
 * `\@ifstar {\x@star }{\x@plain }`: the first branch, whose parameters say what follows.
 */
const AHEAD = /^\\(?:@ifnextchar|kernel@ifnextchar) \[\{?\\(\S+) /;
const STARRED = /^\\@ifstar \{?\\(\S+) /;

/** Commands that look ahead for a macro's arguments in ways a meaning cannot say. */
const LOOKS_AHEAD = /^\\(?:@ifnextchar|kernel@ifnextchar|@ifstar|futurelet|@ifnch) /;

/**
 * A command's arguments from what the compile printed, by the shape of its meaning: an xparse
 * specification, the robust command's real macro, the optional argument's second macro, or the
 * parameters of a plain one. A name the compile did not print whose base the table knows, as an
 * alias of `\textbf` hands its work to `\textbf `, takes the table's.
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
  if (meaning.parameters === "" && depth < 2) {
    const robust = /^(?:\\x@protect \\.\\protect \\(.) |\\protect \\(.+) ) $/s.exec(
      meaning.replacement,
    );
    if (robust) {
      const inner = `${robust[1] ?? robust[2] ?? ""} `;
      const found = resolve(inner, records, depth + 1);
      return found.how === "unresolved" ? found : { spec: found.spec, how: "robust" };
    }
    const optional =
      /^\\@protected@testopt \\(.+?) \\\\\1 \{/s.exec(meaning.replacement) ??
      /^\\@testopt \\\\(.+?) \{/s.exec(meaning.replacement);
    if (optional) {
      const target = optional[1] ?? "";
      const second = records.get(`\\${target}`);
      // An alias of a command the table knows, as `\let\x\section`, which the compile does not
      // follow, takes the table's arguments.
      const standard = second === undefined ? STANDARD.get(target.trimEnd()) : undefined;
      if (standard !== undefined && isReadable(standard.spec))
        return { spec: standard.spec, how: "optional" };
      const inner = second === undefined ? undefined : readMeaning(second.meaning);
      if (inner?.kind !== "macro") return { how: "unresolved", why: "optional" };
      const rest = /^\[#1\]((?:#\d)*)$/.exec(inner.parameters);
      if (rest === null) return { how: "unresolved", why: "optional" };
      const count = (rest[1] ?? "").length / 2;
      return {
        spec: ["o", ...Array.from({ length: count }, () => "m")].join(" "),
        how: "optional",
      };
    }
    // A look ahead by hand: the optional argument's branch takes `[#1]` and the rest; the star's
    // branch takes what the command takes after its star.
    const ahead = AHEAD.exec(meaning.replacement);
    const branch = ahead === null ? undefined : records.get(ahead[1] ?? "");
    const opened = branch === undefined ? undefined : readMeaning(branch.meaning);
    const rest = opened?.kind === "macro" ? /^\[#1\]((?:#\d)*)$/.exec(opened.parameters) : null;
    if (rest !== null) {
      const count = (rest[1] ?? "").length / 2;
      return {
        spec: ["o", ...Array.from({ length: count }, () => "m")].join(" "),
        how: "optional",
      };
    }
    const starred = STARRED.exec(meaning.replacement);
    const inner = starred === null ? undefined : resolve(starred[1] ?? "", records, depth + 1);
    if (inner?.spec !== undefined) return { spec: `s ${inner.spec}`.trim(), how: "optional" };
    if (LOOKS_AHEAD.test(meaning.replacement)) return { how: "unresolved", why: "looks ahead" };
  }
  const parameters = /^(?:#\d)*$/.exec(meaning.parameters);
  if (parameters === null) return { how: "unresolved", why: "delimited" };
  const count = meaning.parameters.length / 2;
  return { spec: Array.from({ length: count }, () => "m").join(" "), how: "meaning" };
}

/**
 * The names a meaning names, as `\meaning` prints them: a backslash, then a name of more than one
 * character up to the space TeX prints after it, a letter's name alike, or one other character.
 * A name holding a space, as xparse's `\x code`, reads as its first word; the compile prints those
 * a macro hands its work to beside it, which `closure` adds.
 */
export function namesIn(meaning: string): string[] {
  const names: string[] = [];
  const LETTER = /[A-Za-z@_:]/;
  for (let i = meaning.indexOf("\\"); i >= 0 && i < meaning.length; i = meaning.indexOf("\\", i)) {
    const next = meaning[i + 1];
    if (next === undefined) break;
    if (LETTER.test(next)) {
      const space = meaning.indexOf(" ", i + 1);
      const end = space < 0 ? meaning.length : space;
      names.push(meaning.slice(i + 1, end));
      i = end;
    } else {
      names.push(next);
      i += 2;
    }
  }
  return names;
}

/** The names a macro may hand its work to, which the compile prints beside it. */
const companions = (name: string) => [
  `${name} `,
  `\\${name}`,
  `\\${name} `,
  `${name} code`,
  `environment ${name} code`,
  `environment ${name} end`,
  `environment ${name} end aux`,
  `environment ${name} end code`,
];

/** The SHA-256 of a text in UTF-8, in hex. */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Each template macro's closure: the template macros its meaning names and those it hands its
 * work to, then theirs, the first reached first, until MAX_CLOSURE_MACROS macros, itself among
 * them, or MAX_CLOSURE_BYTES characters of meanings.
 */
export function closure(
  name: string,
  meanings: ReadonlyMap<string, string>,
): { dependencies: string[]; capped: boolean } {
  const seen = new Set([name]);
  const queue = [name];
  const dependencies: string[] = [];
  let bytes = meanings.get(name)?.length ?? 0;
  for (let at = 0; at < queue.length; at++) {
    const current = queue[at] ?? "";
    for (const next of [...namesIn(meanings.get(current) ?? ""), ...companions(current)]) {
      if (seen.has(next) || !meanings.has(next)) continue;
      seen.add(next);
      const size = meanings.get(next)?.length ?? 0;
      if (dependencies.length + 1 >= MAX_CLOSURE_MACROS || bytes + size > MAX_CLOSURE_BYTES)
        return { dependencies, capped: true };
      bytes += size;
      dependencies.push(next);
      queue.push(next);
    }
  }
  return { dependencies, capped: false };
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
    return { result, printout: written && readPrintout(decodeText(written)) };
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
  const signatureOf = (name: string): Signature => {
    const kind = kindOf(name);
    if (kind !== "template" && kind !== "standard") return { kind, how: "unresolved", why: kind };
    const resolved = resolve(name, records);
    return {
      kind,
      how: resolved.how,
      ...(resolved.spec === undefined ? {} : { spec: resolved.spec }),
      ...(resolved.why === undefined ? {} : { why: resolved.why }),
    };
  };
  const commands = record<Signature>();
  for (const name of uses.commands) commands[name] = signatureOf(name);
  const environments = record<Signature>();
  for (const name of uses.environments) environments[name] = signatureOf(name);

  const meanings = new Map<string, string>();
  for (const [name, printed] of records)
    if (kindOf(name) === "template") meanings.set(name, printed.meaning);
  const macros = record<TemplateMacro>();
  for (const [name, meaning] of meanings)
    macros[name] = { meaning, hash: await sha256(meaning), ...closure(name, meanings) };
  return {
    engine,
    commands,
    environments,
    macros,
    truncated: document.printout.truncated || !document.printout.ended,
    ms,
  };
}
