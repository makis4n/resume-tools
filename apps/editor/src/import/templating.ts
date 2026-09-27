/**
 * Template text for an imported package (milestone 3 item 7, decision 0026): what the assembly
 * copies from a resume's source into a snippet, as TeX reads it and as the snippet language takes
 * it.
 *
 * A snippet holds the template's code and never the person's text: the commands between the
 * fields, their delimiters, the spaces around them, and arguments that are the same in every call.
 * So what it copies from the source goes through `templateText`: comments out, as TeX drops them,
 * since a comment is as likely to hold the person's words as the template's; runs of whitespace
 * made one space, one line's end or one blank line, as TeX reads them; and any `{{` that would
 * begin a tag broken by an empty group, as decision 0006 has a template write it (`{{}{word}}`).
 * Two copies of a template compare by `sameTemplate`, which reads a space and a line's end alike.
 */

import { KeptLatex } from "@resume-tools/resume-model";
import { EXTRAS_PREFIX } from "../templates/snippet";

/**
 * A text with its comments out as TeX drops them: from an unescaped `%` to the end of its line,
 * the line's end and the spaces that begin the next line with it. A blank line after a comment is
 * still a paragraph's end, so one line's end stays for it.
 */
export function withoutComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; ) {
    const char = text[i] ?? "";
    if (char === "\\") {
      // A control symbol, `\%` among them, is two characters, neither of which begins a comment.
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (char !== "%") {
      out += char;
      i++;
      continue;
    }
    const end = text.indexOf("\n", i);
    if (end < 0) break;
    let next = end + 1;
    while (text[next] === " " || text[next] === "\t") next++;
    if (text[next] === "\n" || text[next] === "\r") out += "\n";
    i = next;
  }
  return out;
}

/**
 * Whitespace as TeX reads it: a run holding a blank line is a paragraph's end, kept as one blank
 * line; any other run is one space, kept as a line's end where it held one, for a reader's sake.
 */
export function collapsed(text: string): string {
  return text.replace(/[ \t\r\n]+/g, (run) => {
    const ends = run.match(/\n/g)?.length ?? 0;
    return ends >= 2 ? "\n\n" : ends === 1 ? "\n" : " ";
  });
}

/** A tag of the snippet language a text would begin, at its `{{`. */
const TAG_LIKE = /\{\{(?=\s*[&#^/]?\s*(?:x\.[A-Za-z0-9_-]*|[A-Za-z][A-Za-z0-9]*)\s*\}\})/g;

/**
 * Text as a snippet holds it: every `{{` that would begin a tag written `{{}{`, which TeX reads as
 * the same group with an empty one inside (decision 0006); control characters, which the
 * generator's escaper drops from what a user types, left out.
 */
export function snippetText(text: string): string {
  return text
    .replace(/\p{Cc}/gu, (char) => (/[\t\n\r]/.test(char) ? char : ""))
    .replace(TAG_LIKE, "{{}{");
}

/** Source copied into a snippet: comments out, whitespace as TeX reads it, tags broken. */
export function templateText(source: string): string {
  return snippetText(collapsed(withoutComments(source)));
}

/**
 * How a template's text compares: as `templateText` gives it, with a line's end read as a space,
 * which TeX makes of it, and a paragraph's end kept apart.
 */
export function comparable(text: string): string {
  return collapsed(withoutComments(text)).replace(/\n\n|\n/g, (run) => (run === "\n" ? " " : run));
}

/** Whether two copies of a template's text read the same to TeX (`comparable`). */
export const sameTemplate = (a: string, b: string) => comparable(a) === comparable(b);

/** Whether a text holds nothing TeX reads but spaces and comments. */
export const isBlankSource = (text: string) => /^\s*$/.test(withoutComments(text));

/**
 * How many words a text holds: runs of letters and digits, as item 13 counts a field's words.
 */
export const wordsIn = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;

/**
 * Whether LaTeX may be kept, as the model takes a locked section's or an extra's (`KeptLatex`,
 * decision 0025): at most `MAX_KEPT_LATEX` characters, none of the editor's own macros or marker
 * texts, and braces that balance as TeX reads an argument.
 */
export const isKept = (latex: string) => KeptLatex.safeParse(latex).success;

/** An extras slot for `key`: its node's extra under that key, written as it is (decision 0025). */
export const extrasSlot = (key: string) => `{{&${EXTRAS_PREFIX}${key}}}`;

/** What TeX cannot take in a macro's argument, which `\rtlocked` reads a locked part as. */
const NOT_IN_AN_ARGUMENT =
  /\\(?:verb|lstinline|mintinline|catcode|makeatletter|makeatother|ExplSyntaxOn|ExplSyntaxOff)(?![A-Za-z])|\\begin\s*\{(?:verbatim|Verbatim|lstlisting|minted|comment|filecontents)\*?\}/;

/**
 * A part of the body as a locked section keeps it, which the generator writes as `\rtlocked`'s
 * argument (decision 0025): each `#` and `%` in the address of `\href`, `\url` or `\nolinkurl`
 * written `\#` and `\%`, which hyperref turns back as it does the generator's (decision 0007), since
 * in an argument the first is a parameter and the second a comment; or undefined for a part the
 * argument cannot take, `\verb` or a category code changed in it, or the schema refuses.
 */
export function asLocked(latex: string): string | undefined {
  const escaped = escapedAddresses(latex);
  if (NOT_IN_AN_ARGUMENT.test(withoutComments(escaped)) || !isKept(escaped)) return undefined;
  return escaped;
}

/** LaTeX with every unescaped `#` and `%` in an address of `\href`, `\url` or `\nolinkurl` escaped. */
function escapedAddresses(latex: string): string {
  let out = "";
  let at = 0;
  const command = /\\(?:href|url|nolinkurl)(?![A-Za-z])/g;
  for (const found of latex.matchAll(command)) {
    let i = found.index + found[0].length;
    if (i < at) continue;
    while (/\s/.test(latex[i] ?? "")) i++;
    if (latex[i] === "[") {
      const close = latex.indexOf("]", i);
      if (close < 0) continue;
      i = close + 1;
      while (/\s/.test(latex[i] ?? "")) i++;
    }
    if (latex[i] !== "{") continue;
    let depth = 0;
    let end = -1;
    for (let j = i; j < latex.length; j++) {
      const char = latex[j];
      if (char === "\\") j++;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        end = j;
        break;
      }
    }
    if (end < 0) continue;
    out += latex.slice(at, i + 1);
    let inner = "";
    for (let j = i + 1; j < end; j++) {
      const char = latex[j] ?? "";
      if (char === "\\") {
        inner += latex.slice(j, j + 2);
        j++;
      } else inner += char === "#" || char === "%" ? `\\${char}` : char;
    }
    out += inner;
    at = end;
  }
  return out + latex.slice(at);
}
