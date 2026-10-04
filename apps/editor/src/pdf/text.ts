/**
 * What the rules read in a PDF's line's words (item 12, from the spike of item 3): dates and
 * ranges, emails, phones, addresses, places, the words a section's heading gives its role by, and
 * the count of words that the check of every word read against the resume built uses.
 */

import type { Dates, SectionRole, YearMonth } from "@resume-tools/resume-model";

/** The letters and digits of a text, which the check of nothing dropped counts. */
export const countChars = (text: string) => (text.match(/[\p{L}\p{N}]/gu) ?? []).length;

/** A word, for the count: a stretch with no space in it that holds a letter or a digit. */
export function countWords(text: string): number {
  let count = 0;
  for (const word of text.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(word)) count++;
  return count;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH = `(?:${Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|")})\\.?`;
const YEAR = "(?:19|20)\\d\\d";
const NOW = "(?:present|current|now|today|ongoing)";

/** One end of a range: a month and a year, in words or digits, a year, or now. */
const POINT = `(?:${MONTH}\\s*,?\\s*'?${YEAR}|(?:0?[1-9]|1[0-2])\\s*[/.]\\s*${YEAR}|${YEAR}\\s*[/.-]\\s*(?:0[1-9]|1[0-2])(?!\\d)|${YEAR}|${NOW})`;
const DASH = "\\s*(?:–|—|-|‒|―|−|to|until|till)\\s*";
const RANGE = new RegExp(`^\\(?\\s*(${POINT})(?:${DASH}(${POINT}))?\\s*\\)?$`, "iu");

/** A date's words that do not fit the model, a season's or an expected date's. */
const DATE_WORDS =
  /^(?:(?:spring|summer|fall|autumn|winter|expected|anticipated|since|from|until|by|est\.?|graduation|graduating|class of|q[1-4]|h[12])\b[\s,.:]*)+/iu;

/** One end of a range as the model holds it: `2020-06`, `2020`, or `present`. */
function pointOf(text: string): YearMonth | "present" | undefined {
  const point = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (new RegExp(`^${NOW}$`, "iu").test(point)) return "present";
  const named = new RegExp(`^(${MONTH})\\s*,?\\s*'?(${YEAR})$`, "iu").exec(point);
  if (named) {
    const month = MONTHS[(named[1] ?? "").replace(".", "")];
    if (month === undefined) return undefined;
    return `${named[2]}-${String(month).padStart(2, "0")}`;
  }
  const monthFirst = new RegExp(`^(0?[1-9]|1[0-2])\\s*[/.]\\s*(${YEAR})$`, "u").exec(point);
  if (monthFirst) return `${monthFirst[2]}-${(monthFirst[1] ?? "").padStart(2, "0")}`;
  const yearFirst = new RegExp(`^(${YEAR})\\s*[/.-]\\s*(0[1-9]|1[0-2])$`, "u").exec(point);
  if (yearFirst) return `${yearFirst[1]}-${yearFirst[2]}`;
  if (new RegExp(`^${YEAR}$`, "u").test(point)) return point;
  return undefined;
}

/**
 * A date or a range as the model holds it, from a line's text: `Mar 2021 – Present`, `2019 – 2021`,
 * `06/2019 - 08/2020`, `May 2018`. Undefined for text that is not one, or one the model cannot
 * hold, a season's or an expected date's, which `looksLikeDate` still knows.
 */
export function parseDates(text: string): Dates | undefined {
  const match = RANGE.exec(text.trim());
  if (!match) return undefined;
  const start = pointOf(match[1] ?? "");
  if (start === undefined || start === "present") return undefined;
  if (match[2] === undefined) return { start };
  const end = pointOf(match[2]);
  if (end === undefined) return undefined;
  return { start, end };
}

/** Whether a line's text is a date or a range, whether or not the model can hold it. */
export function looksLikeDate(text: string): boolean {
  const trimmed = text.trim();
  if (parseDates(trimmed) !== undefined) return true;
  if (new RegExp(`^${NOW}$`, "iu").test(trimmed)) return true;
  if (!new RegExp(YEAR, "u").test(trimmed) && !new RegExp(`^${NOW}$`, "iu").test(trimmed))
    return false;
  const rest = trimmed.replace(DATE_WORDS, "");
  // What is left once the date's own words go: a range of the model's, or of seasons' years.
  const seasons = rest.replace(
    new RegExp(`\\b(?:spring|summer|fall|autumn|winter)\\s+(${YEAR})`, "giu"),
    "$1",
  );
  return parseDates(seasons) !== undefined;
}

const EMAIL = /^(?:e-?mail:?\s*)?[\w.+'-]+@[\w-]+(?:\.[\w-]+)+$/iu;
const EMAIL_IN = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/u;

/** Whether text is an email address, or holds one. */
export const isEmail = (text: string) => EMAIL.test(text.trim());
export const hasEmail = (text: string) => EMAIL_IN.test(text);

/** An email address in text, without a label before it. */
export const emailIn = (text: string) => EMAIL_IN.exec(text)?.[0];

/** Whether text is a phone number: digits, seven or more, with the signs a number is written with. */
export function isPhone(text: string): boolean {
  const number = text
    .trim()
    .replace(/^(?:phone|tel(?:ephone)?|mobile|mob|cell|ph)\.?:?\s*/iu, "")
    .trim();
  if (!/^\+?[\d\s().\-–/]+$/u.test(number)) return false;
  const digits = number.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15 && !/^\d{4}\s*[-–]\s*\d{4}$/.test(number);
}

/** A phone number in text, without a label before it. */
export function phoneIn(text: string): string | undefined {
  const found = /\+?\(?\d[\d\s().\-–/]{6,}\d/u.exec(text)?.[0];
  return found !== undefined && isPhone(found) ? found.trim() : undefined;
}

/** Whether text is a web address, with or without its scheme: `quist.example.com/work`. */
export function isUrl(text: string): boolean {
  const trimmed = text.trim();
  return (
    /^(?:https?:\/\/)?(?:www\.)?[\w-]+(?:\.[\w-]+)+(?:[/?#]\S*)?$/iu.test(trimmed) &&
    !isEmail(trimmed) &&
    !/^\d+(?:\.\d+)+$/.test(trimmed)
  );
}

/**
 * Whether text names a place: `Portland, OR`, `Leeds, UK`, `Rio de Janeiro, Brazil`, `Remote`: two
 * or three parts a comma parts, each a capitalised word or up to three, five words in all.
 */
export function isPlace(text: string): boolean {
  const trimmed = text.trim();
  if (/^(?:remote|online|hybrid|on-?site)(?:\s*[(,].*)?$/iu.test(trimmed)) return true;
  const word = "\\p{Lu}[\\p{L}\\p{M}.'’-]*";
  const small = "(?:de|di|da|del|la|le|of|am|upon|on|sur)";
  const first = `${word}(?:\\s+(?:${word}|${small})){0,3}`;
  const last = `${word}(?:\\s+${word})?`;
  if (!new RegExp(`^${first}(?:,\\s*${first})?,\\s*${last}$`, "u").test(trimmed)) return false;
  return countWords(trimmed) <= 5;
}

/** Whether text is one capitalised word or two, as a place standing alone may be: `Utrecht`. */
export const isShortName = (text: string) =>
  /^\p{Lu}[\p{L}\p{M}.'’-]+(?:\s\p{Lu}[\p{L}\p{M}.'’-]+)?$/u.test(text.trim());

/**
 * The role a section's heading gives it, from its words, or undefined for words no section is
 * known by. `Programming Languages` is skills, and `Languages` alone languages.
 */
export function headingRole(text: string): SectionRole | undefined {
  const words = text.toLowerCase().replace(/[^\p{L}\s&]/gu, " ");
  if (
    /\bskill|competenc|technolog|expertise|tech stack|toolbox|tools\b|programming languages/u.test(
      words,
    )
  )
    return "skills";
  if (/\blanguages?\b/u.test(words)) return "languages";
  if (
    /experience|employment|work history|career|positions|internships?\b|\bwork\b|professional background/u.test(
      words,
    )
  )
    return "experience";
  if (/education|academic|degrees?\b|studies|qualifications/u.test(words)) return "education";
  if (/project|portfolio|open source/u.test(words)) return "projects";
  if (
    /award|honou?rs?\b|achievement|accomplishment|recognition|scholarship|prizes?\b|distinction/u.test(
      words,
    )
  )
    return "awards";
  if (/publication|papers?\b|patents?\b|talks?\b|presentations?\b|conferences?\b/u.test(words))
    return "publications";
  if (/summary|profile|about|objective|statement|overview|introduction|personal/u.test(words))
    return "summary";
  if (
    /interest|hobb|activit|volunteer|certific|course|leadership|membership|references|involvement|extracurricular|contact|other|misc|additional/u.test(
      words,
    )
  )
    return "other";
  return undefined;
}

/**
 * Text as two readings of one page compare it: letters composed, ligatures and the dashes and quotes
 * TeX makes of `--`, `---`, `` ` `` and `'` taken back to the keys typed, a non-breaking space or
 * hyphen to a plain one, a letter a font sets with another's glyph (`Đ` with `Ð`) to one, and
 * spaces collapsed.
 */
export function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[     ]/g, " ")
    .replace(/[‐‑]/g, "-")
    .replace(/Đ/g, "Ð")
    .replace(/đ/g, "ð")
    .replace(/[​‌‍⁠﻿­]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
