/**
 * What the naming contract masks, so that the rules live with the contract (milestone 3 item 6,
 * decision 0024): a call site's text, by a placeholder of the same length and character class
 * (`placeholder`), a date by its shape (`datePlaceholder`), and a definition's emails, links and
 * phone numbers, by a placeholder of the same length that names what it hides (`maskDefinition`,
 * decision 0020's rule, which item 4 made and item 11 finishes). `holdsText` is the check the
 * request's schema makes of every call site: no letter but `x` and `X`, and no digit but `0`,
 * outside the names of commands and environments.
 */

import type { Dates } from "@resume-tools/resume-model";

/** A letter or a digit of any script. */
const ALPHANUMERIC = /[\p{L}\p{N}]/gu;

/** A capital, or a letter in title case, which the placeholder writes `X`. */
const CAPITAL = /^[\p{Lu}\p{Lt}]$/u;

/** A digit or another number, which the placeholder writes `0`. */
const NUMBER = /^\p{N}$/u;

/**
 * A text's placeholder, character for character: a capital `X`, any other letter, of any script,
 * `x`, a digit or another number `0`, and everything else as it is, spaces, punctuation, symbols
 * and marks, so that the model sees the text's shape and none of its words. A character is a code
 * point, so the placeholder has as many of them as the text.
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
 * a letter or a digit. What else a site holds is the placeholders of the document's text.
 */
const NAMES = /\\(?:begin|end)\s*\{[A-Za-z@*]*\}|\\[A-Za-z]+|\\[^\p{L}\p{N}]/gu;

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

/** A placeholder of `length` characters for what a pattern found: `<email___>`. */
function named(kind: string, length: number): string {
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
 * A definition with the personal data its patterns find masked, each by a placeholder of its own
 * length: links, email addresses, and runs of 7 digits or more with separators, which phone
 * numbers are (decision 0020). A definition then hashes the same whoever's address it holds. What
 * the patterns miss, a name or an address, the request builder masks by the document's own values
 * before anything leaves the browser, and item 11 finishes those rules.
 */
export function maskDefinition(text: string): string {
  return text
    .replace(LINK, (found) => named("link", found.length))
    .replace(EMAIL, (found) => named("email", found.length))
    .replace(PHONE, (found) =>
      (found.match(/\d/g) ?? []).length >= 7 ? named("phone", found.length) : found,
    );
}
