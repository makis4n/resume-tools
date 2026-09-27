/**
 * What the naming contract masks, so that the rules live with the contract (milestone 3 item 6,
 * decision 0024): a call site's text, by a placeholder of the same length and character class
 * (`placeholder`), a date by its shape (`datePlaceholder`), and a definition's emails, links, phone
 * numbers and postcodes, by a placeholder of the same length that names what it hides where it is
 * long enough to (`maskDefinition`, decision 0020's rule, which item 4 made and item 11 finished,
 * decision 0029). `holdsText` is the check the
 * request's schema makes of every call site: no letter but `x` and `X`, and no digit but `0`,
 * outside the names of commands and environments; `specDefaults` reads the defaults an xparse
 * signature gives, which the schema checks the same way.
 */

import type { Dates } from "@resume-tools/resume-model";

/**
 * A letter or a digit of any script, or a mark: what `Alphabetic` takes beside the letters, the
 * vowel signs and viramas of Devanagari, Tamil or Thai and the letters of an enclosed alphabet,
 * as `Ⓠ`, and every combining mark, as a decomposed accent. A mark alone spells nothing, but
 * kept after the letter it sits on it tells which letter that was.
 */
const ALPHANUMERIC = /[\p{Alphabetic}\p{N}\p{M}]/gu;

/** A capital, or a letter in title case, which the placeholder writes `X`. */
const CAPITAL = /^[\p{Lu}\p{Lt}]$/u;

/** A digit or another number, which the placeholder writes `0`. */
const NUMBER = /^\p{N}$/u;

/**
 * A text's placeholder, character for character: a capital `X`, any other letter, of any script,
 * and any mark or enclosed letter `x`, a digit or another number `0`, and everything else as it
 * is, spaces, punctuation and symbols, so that the model sees the text's shape and none of its
 * words. A character is a code point, so the placeholder has as many of them as the text.
 */
export function placeholder(text: string): string {
  return text.replace(ALPHANUMERIC, (char) =>
    CAPITAL.test(char) ? "X" : NUMBER.test(char) ? "0" : "x",
  );
}

/**
 * A date's placeholder, shaped as it is spelled: `0000` for a year, `0000-00` for a month, and a
 * range as its two ends joined by ` -- `, an open end `xxxxxxx`, whatever words and separators the
 * document spells them with.
 */
export function datePlaceholder(dates: Dates): string {
  const end = (value: string) =>
    value === "present" ? "xxxxxxx" : value.length === 4 ? "0000" : "0000-00";
  return dates.end === undefined ? end(dates.start) : `${end(dates.start)} -- ${end(dates.end)}`;
}

/**
 * The names a call site may hold in their own letters: a command's, `\` and ASCII letters, and an
 * environment's, after `\begin` or `\end`; and a control symbol, `\` and a character that is not
 * a letter, a digit or a mark. What else a site holds is the placeholders of the document's text.
 */
const NAMES = /\\(?:begin|end)\s*\{[A-Za-z@*]*\}|\\[A-Za-z]+|\\[^\p{Alphabetic}\p{N}\p{M}]/gu;

/**
 * Whether a call site's text holds text of the document's: a letter other than `x` or `X`, or a
 * digit other than `0`, outside the names of commands and environments. The request's schema
 * refuses such a site, whatever built it.
 */
export function holdsText(text: string): boolean {
  const left = text.replace(NAMES, "");
  for (const char of left.match(ALPHANUMERIC) ?? [])
    if (char !== "x" && char !== "X" && char !== "0") return true;
  return false;
}

/**
 * The defaults an xparse signature gives, each its brace group's text, in order: `O{...}`'s and
 * `G{...}`'s, `D<>{...}`'s and `R<>{...}`'s after their two delimiters, and the second group of
 * `E{...}{...}`, which holds one for each of its tokens; or undefined for a text that is not a
 * signature. A processor, `>{...}` or `={...}`, and the tokens of `e`, `E`, `t` and `u` are no
 * default, and a delimiter is one token: a character, a command's name or a brace group.
 */
export function specDefaults(spec: string): string[] | undefined {
  const defaults: string[] = [];
  let at = 0;
  const spaces = () => {
    while (at < spec.length && /\s/.test(spec[at] ?? "")) at++;
  };
  /** A brace group's text, `at` past its close; undefined where none opens or none closes. */
  const group = (): string | undefined => {
    spaces();
    if (spec[at] !== "{") return undefined;
    let depth = 0;
    for (let i = at; i < spec.length; i++) {
      const char = spec[i];
      if (char === "\\") i++;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        const text = spec.slice(at + 1, i);
        at = i + 1;
        return text;
      }
    }
    return undefined;
  };
  /** One token, `at` past it: a brace group, a command's name, or a character. */
  const token = (): boolean => {
    spaces();
    if (at >= spec.length) return false;
    if (spec[at] === "{") return group() !== undefined;
    const name = /^\\(?:[A-Za-z@]+|[^])/u.exec(spec.slice(at))?.[0];
    at += name?.length ?? String.fromCodePoint(spec.codePointAt(at) ?? 0).length;
    return true;
  };
  /** A default's group, kept; false where none is given. */
  const given = () => {
    const text = group();
    if (text !== undefined) defaults.push(text);
    return text !== undefined;
  };
  while (at < spec.length) {
    const type = spec[at++] ?? "";
    let read: boolean;
    switch (type) {
      case "r":
      case "d":
        read = token() && token();
        break;
      case "R":
      case "D":
        read = token() && token() && given();
        break;
      case "O":
      case "G":
        read = given();
        break;
      case "E":
        read = group() !== undefined && given();
        break;
      case "t":
      case "u":
        read = token();
        break;
      case "e":
      case ">":
      case "=":
        read = group() !== undefined;
        break;
      default:
        read = /\s|[mosvblg+!]/.test(type);
    }
    if (!read) return undefined;
  }
  return defaults;
}

/**
 * A command's name as code spells it, in a class or a package: `@`, `_` and `:` among its letters,
 * as LaTeX's and expl3's are, `\\@empty` and fontawesome5's `\\str_use:N`.
 */
const CODE_NAME = /\\[A-Za-z@_:]+/g;

/**
 * Whether a signature's default holds text of the document's: `holdsText` of it, past the names
 * of the commands it holds, which it spells as code does (`CODE_NAME`), since a default is part
 * of a definition. The request's schema refuses a signature with such a default, whatever built
 * it: the builder sends each default as its placeholder, as it does a call site's argument.
 */
export function defaultHoldsText(text: string): boolean {
  return holdsText(text.replace(CODE_NAME, ""));
}

/** A placeholder of `length` characters for what a pattern found: `<email___>`. */
function named(kind: string, length: number): string {
  if (length < kind.length + 2) return "_".repeat(length);
  return `<${kind}${"_".repeat(length - kind.length - 2)}>`;
}

/**
 * A host name as the patterns read one: at most ten labels of at most 63 characters, as DNS has
 * them, the last of letters. The bounds keep a match to a few hundred characters, so that the
 * patterns below take time linear in a definition however it is spelled: unbounded, a megabyte of
 * dotted or hyphenated letters made each pattern try every label from every start, which is
 * quadratic, seconds on 64,000 characters.
 */
const HOST = String.raw`[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,63}`;

/**
 * A link: a scheme and an address, `www.` and one, or a host and a path of at most 2,048
 * characters.
 */
const LINK = new RegExp(
  String.raw`\b(?:(?:https?|ftp):\/\/|mailto:|www\.)[^\s{}\\]+|\b${HOST}\/[^\s{}\\]{0,2048}`,
  "g",
);

/**
 * An email address: a local part of at most 64 characters, as RFC 5321 has it, that starts where a
 * word does, and a host.
 */
const EMAIL = new RegExp(String.raw`\b[A-Za-z0-9._%+-]{1,64}@${HOST}`, "g");

/** A run of digits and the separators a phone number has; one of 7 digits or more is one. */
const PHONE = /\+?\(?\d[\d ().~/+-]*\d/g;

/**
 * A postcode of letters and digits, in capitals, a space between its halves, as an address writes
 * one: the UK's, `QV1A 2ZX`, and Canada's, `X9Q 0Q9`. No class's or package's code is so shaped,
 * where a postcode of digits alone, `94103` or `10115`, is a number as code writes them,
 * `\penalty 10000`, and is left to the document's own values (decision 0029).
 */
const POSTCODE = /\b(?:[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}|[A-Z]\d[A-Z] \d[A-Z]\d)\b/g;

/**
 * A definition with the personal data its patterns find masked, each by a placeholder of its own
 * length: links, email addresses, runs of 7 digits or more with separators, which phone numbers
 * are (decision 0020), and postcodes of letters and digits (`POSTCODE`). A definition then hashes
 * the same whoever's address it holds. What the patterns miss, a name or a street, the request
 * builder masks by the document's own values and its page before anything leaves the browser
 * (decision 0029). It takes time linear in the definition's length (`HOST`).
 */
export function maskDefinition(text: string): string {
  return text
    .replace(LINK, (found) => named("link", found.length))
    .replace(EMAIL, (found) => named("email", found.length))
    .replace(PHONE, (found) =>
      (found.match(/\d/g) ?? []).length >= 7 ? named("phone", found.length) : found,
    )
    .replace(POSTCODE, (found) => named("postcode", found.length));
}
