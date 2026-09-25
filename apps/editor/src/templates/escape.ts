/**
 * Escaping for what a user types, on its way into LaTeX.
 *
 * User text reaches LaTeX only through a snippet's slots, and the generator escapes each slot by
 * its type, so these functions are what keep a user's text from acting as LaTeX (decision 0007).
 * Every character either typesets as itself or is dropped: nothing a user types can open a group,
 * start a comment, enter math or call a macro, whatever the template does with the result.
 */

import { INVISIBLE } from "../tex/fields";

/**
 * Every character `escapeText` changes: the invisible ones, which the page's aligner skips too;
 * every space separator; and those TeX or OT1 read as something else.
 */
const TEXT_CHANGES = new RegExp(`${INVISIBLE.source}|[\\p{Zs}\\\\{}$&#^_%~<>|[\\]*\`]`, "gu");

/** A space separator, such as a thin or an ideographic space, which LaTeX has no definition for. */
const SPACE_SEPARATOR = /\p{Zs}/u;

const TEXT_ESCAPES: Readonly<Record<string, string>> = {
  // A field is one paragraph, since Enter inserts nothing (decision 0004), so a break is a space.
  "\t": " ",
  "\n": " ",
  "\r": " ",
  "\u2028": " ",
  "\u2029": " ",
  // The space separators that do not break; any other becomes a space. LaTeX defines none of
  // them, so each would be left out, joining the words on either side.
  "\u00a0": "~",
  "\u202f": "~",
  "\u2007": "~",
  // The ten characters TeX gives a meaning to. The caret and the tilde are the ASCII characters
  // where the font encoding has them, T1 and XeTeX's TU; in OT1 LaTeX sets them as accents.
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  $: "\\$",
  "&": "\\&",
  "#": "\\#",
  "^": "\\textasciicircum{}",
  _: "\\_",
  "%": "\\%",
  "~": "\\textasciitilde{}",
  // OT1, the encoding of LaTeX's default fonts, has ¡, ¿ and an em dash at these three codes.
  "<": "\\textless{}",
  ">": "\\textgreater{}",
  "|": "\\textbar{}",
  // Braced, so that raw text right after \\ or \item is never read as an optional argument or
  // a star.
  "[": "{[}",
  "]": "{]}",
  "*": "{*}",
  // After an empty group, so that a ? or ! before it cannot make OT1's ¿ or ¡ ligature. It still
  // sets as OT1's opening quote, which the page reads as a backtick.
  "`": "{}`",
};

/**
 * Escape text for a text, rich or date slot, typeset or raw. The text is composed first (NFC), so
 * an accent typed as a combining mark reaches LaTeX as the letter it has a definition for. What
 * is not escaped passes through: letters outside ASCII, dashes and curly quotes, which LaTeX's
 * UTF-8 input and XeTeX typeset; a straight double quote, which OT1 sets as a closing quote, as
 * LaTeX does; and anything else, which the prelude has LaTeX drop when it has no definition for
 * it or the font encoding no glyph.
 */
export function escapeText(text: string): string {
  return text
    .normalize("NFC")
    .replace(TEXT_CHANGES, (char) => TEXT_ESCAPES[char] ?? (SPACE_SEPARATOR.test(char) ? " " : ""));
}

/**
 * The characters a URL keeps as they are: RFC 3986's unreserved and reserved characters, and `%`,
 * since an address may be encoded already. `$` and `~` are left out although an address may hold
 * them, because they are TeX-special and hyperref does not turn them back: `%7E` is the same
 * address as `~`, and `$` is rare in one.
 */
const URL_KEPT = /^[A-Za-z0-9\-._:/?#[\]@!&'()*+,;=%]$/;

/** What hyperref turns back into the character inside `\href` and `\url`, nested or not. */
const URL_ESCAPES: Readonly<Record<string, string>> = {
  "%": "\\%",
  "#": "\\#",
  "&": "\\&",
  _: "\\_",
};

const UTF8 = new TextEncoder();

/**
 * Escape an address for a raw URL slot, as in `\href{{{&href}}}{...}`. Whitespace around it is
 * dropped, as a browser drops it; anything else a URL may not hold is percent-encoded as UTF-8;
 * and the characters TeX would read are escaped the way hyperref undoes, which holds whether or
 * not the `\href` sits in another macro's argument, as a link in rich text always does.
 */
export function escapeUrl(url: string): string {
  let escaped = "";
  for (const char of url.replace(INVISIBLE, "").trim()) {
    if (URL_KEPT.test(char)) escaped += URL_ESCAPES[char] ?? char;
    else for (const byte of UTF8.encode(char)) escaped += `\\%${hex(byte)}`;
  }
  return escaped;
}

const hex = (byte: number) => byte.toString(16).toUpperCase().padStart(2, "0");

/**
 * True when a text would show nothing: only whitespace is left once the characters `escapeText`
 * drops are gone. The generator leaves such a field out, as it leaves out an empty one. It reads
 * the text composed, as `escapeText` does.
 */
export function isBlank(text: string): boolean {
  return text.normalize("NFC").replace(INVISIBLE, "").trim() === "";
}
