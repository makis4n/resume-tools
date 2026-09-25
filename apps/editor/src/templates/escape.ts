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
const TEXT_CHANGES = new RegExp(`${INVISIBLE.source}|[\\p{Zs}\\\\{}$&#^_%~<>|[\\]*]`, "gu");

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
};

/**
 * A `?` or `!` right before a backtick, which OT1 would set together as its ¿ or ¡. An empty
 * group between the two keeps them apart, and the backtick still sets as OT1's opening quote,
 * which the page reads as a backtick. Any other backtick is left alone, so that two of them
 * still make the opening double quote.
 */
const INVERTED_MARK = /[?!](?=`)/g;

/**
 * A run of code points past Latin Extended-A, from U+0180 on, other than the 48 composed letters
 * LaTeX's UTF-8 input defines there. Those are in `t1enc.dfu`, which every pdfTeX format loads
 * for its T1 encoding, and OT1 sets nearly all of them too, with an accent or `\textcommabelow`:
 * Romanian's `ș` and `ț`, Pinyin's `ǎ`, `ǐ`, `ǒ` and `ǔ`, transliterated Sanskrit's dotted
 * letters, and a few more.
 */
const UNDEFINED_PAST_EXTENDED_A =
  /(?:(?![\u{1cd}-\u{1d4}\u{1e2}\u{1e3}\u{1e6}-\u{1eb}\u{1f0}\u{1f4}\u{1f5}\u{218}-\u{21b}\u{232}\u{233}\u{1e02}\u{1e03}\u{1e0d}\u{1e1e}-\u{1e21}\u{1e25}\u{1e30}\u{1e31}\u{1e37}\u{1e43}\u{1e45}\u{1e47}\u{1e5b}\u{1e63}\u{1e6d}\u{1e8e}-\u{1e91}\u{1ef2}\u{1ef3}])[\u{180}-\u{10ffff}])+/gu;

/**
 * Text in the form pdfTeX's LaTeX sets best. It is composed (NFC), so that an accent typed as a
 * combining mark reaches LaTeX as the letter it has a definition for, as every letter of Latin-1
 * and Latin Extended-A has. Past those it is decomposed again (NFD), except for the few letters
 * LaTeX defines there, so that a letter it has no definition for, such as Vietnamese's `ễ`, sets
 * its base letter, and the prelude leaves out the combining marks, rather than dropping the
 * letter whole. That is pdfTeX's reach; XeTeX's fonts set such letters as they are, so a text for
 * XeTeX's declared fonts stays composed (`escapeText`'s `fonts`).
 */
function normalized(text: string): string {
  return text.normalize("NFC").replace(UNDEFINED_PAST_EXTENDED_A, (run) => run.normalize("NFD"));
}

/**
 * What escaping would pass through as itself and a font would have to set: anything past ASCII
 * but spaces, which become spaces or ties, and the invisible characters, which escaping drops.
 */
const SET_AS_ITSELF = new RegExp(`(?!\\s|\\p{Zs}|${INVISIBLE.source})[^\\u{0}-\\u{7f}]`, "gu");

/**
 * What a XeTeX package's declared fonts can set among them (decision 0014), which `escapeText`
 * takes a text's characters past ASCII to, and what hears of each character they cannot.
 */
export interface TextFonts {
  covers: (char: string) => boolean;
  /** Told of each character the fonts cannot set, which is left out, or set in part (`partOf`). */
  lacks: (char: string) => void;
}

/**
 * What the fonts can set of a character they cannot set whole: the parts of its canonical
 * decomposition that are ASCII or that they cover, the base of an accented letter and each of its
 * accents they have, as pdfTeX's LaTeX sets the base of a letter it has no definition for
 * (`normalized`); nothing of a character that does not decompose.
 */
function partOf(char: string, covers: (char: string) => boolean): string {
  const parts = [...char.normalize("NFD")];
  if (parts.length < 2) return "";
  return parts.filter((part) => part < "\u{80}" || covers(part)).join("");
}

/**
 * Escape text for a text, rich or date slot, typeset or raw. The text is first put in the form
 * LaTeX sets best, composed and then decomposed past Latin Extended-A (`normalized`). What is not
 * escaped passes through: letters outside ASCII, dashes and curly quotes, which LaTeX's UTF-8
 * input and XeTeX typeset; a straight double quote, which OT1 sets as a closing quote, as LaTeX
 * does; and anything else, which the prelude has LaTeX drop when it has no definition for it or
 * the font encoding no glyph.
 *
 * XeTeX sets a font's `.notdef` box for a character the font lacks, so for a XeTeX package that
 * declares its fonts the generator says which characters they can set (`fonts`, decision 0014):
 * the text then stays composed, since XeTeX's fonts set letters whole and HarfBuzz decomposes one
 * a font lacks, and every character that would pass through as itself and that they cannot set is
 * set as the part of it they can, an accented letter as its base, or else left out, so that it too
 * either typesets as itself, or as its letter, or is dropped.
 */
export function escapeText(text: string, fonts?: TextFonts): string {
  const form =
    fonts === undefined
      ? normalized(text)
      : text.normalize("NFC").replace(SET_AS_ITSELF, (char) => {
          if (fonts.covers(char)) return char;
          fonts.lacks(char);
          return partOf(char, fonts.covers);
        });
  return form
    .replace(TEXT_CHANGES, (char) => TEXT_ESCAPES[char] ?? (SPACE_SEPARATOR.test(char) ? " " : ""))
    .replace(INVERTED_MARK, "$&{}");
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
 * the text normalized, as `escapeText` does.
 */
export function isBlank(text: string): boolean {
  return normalized(text).replace(INVISIBLE, "").trim() === "";
}
