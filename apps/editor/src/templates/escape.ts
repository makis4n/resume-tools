/**
 * Escaping for what a user types, on its way into LaTeX.
 *
 * User text reaches LaTeX only through a snippet's slots, and the generator escapes each slot by
 * its type, so these functions are what keep a user's text from acting as LaTeX (decision 0007).
 * Every character either typesets as itself or is dropped: nothing a user types can open a group,
 * start a comment, enter math or call a macro, whatever the template does with the result.
 */

/**
 * What means nothing on a page, or what TeX would refuse: controls, format characters such as
 * zero-width joiners and U+FEFF, lone surrogates, which UTF-8 cannot encode, and the line and
 * paragraph separators.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;

/** Every character `escapeText` changes: the invisible ones, and those TeX gives a meaning. */
const TEXT_CHANGES = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp} \\{}$&#^_%~<>|]/gu;

const TEXT_ESCAPES: Readonly<Record<string, string>> = {
  // A field is one paragraph, since Enter inserts nothing (decision 0004), so a break is a space.
  "\t": " ",
  "\n": " ",
  "\r": " ",
  " ": " ",
  " ": " ",
  " ": "~",
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
};

/**
 * Escape text for a text, rich or date slot, typeset or raw. What is not escaped passes through:
 * letters outside ASCII, dashes and curly quotes, which LaTeX's UTF-8 input and XeTeX typeset,
 * and anything else, which the prelude has LaTeX drop when it has no definition for it.
 */
export function escapeText(text: string): string {
  return text.replace(TEXT_CHANGES, (char) => TEXT_ESCAPES[char] ?? "");
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
 * drops are gone. The generator leaves such a field out, as it leaves out an empty one.
 */
export function isBlank(text: string): boolean {
  return text.replace(INVISIBLE, "").trim() === "";
}
