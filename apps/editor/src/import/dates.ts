/**
 * Reading dates in an imported resume's text (milestone 3 item 4, decision 0020): a whole argument
 * or a whole run of text that reads as a date or a range becomes the model's `Dates`, which the
 * generator formats again (decision 0007), and anything else stays text.
 *
 * A date is a month and a year, the month by its English name, full or in three letters, with or
 * without a period (`Sept` too, as resumes write it), or by its number, `01/2020` or `2020-01`; or
 * a year alone. A range is two dates joined by any dash, a hyphen, `--`, `---`, an en or em dash,
 * or the word `to`, and an end that is still open reads `Present`, `Current`, `Now`, `Ongoing` or
 * `Today`, in any case. Years run from 1900 to 2100, so that a number that is not one stays text.
 */

import type { Dates, YearMonth } from "@resume-tools/resume-model";

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

/** Month names as a resume writes them, in lower case, to their numbers from 1. */
const MONTHS: ReadonlyMap<string, number> = new Map([
  ...MONTH_NAMES.map((name, i): [string, number] => [name, i + 1]),
  ...MONTH_NAMES.map((name, i): [string, number] => [name.slice(0, 3), i + 1]),
  ["sept", 9],
]);

/** The words an end still open reads, in lower case. */
const OPEN_ENDS: ReadonlySet<string> = new Set(["present", "current", "now", "ongoing", "today"]);

/** Spaces as the decoded text may hold them: a space, a tie, a thin space. */
const SPACE = "[\\s\\u00a0\\u2009\\u202f]";

/** A year from 1900 to 2100. */
const isYear = (digits: string) => {
  const year = Number(digits);
  return digits.length === 4 && year >= 1900 && year <= 2100;
};

const pad = (month: number) => String(month).padStart(2, "0");

const NAMED = new RegExp(`^([A-Za-z]+)\\.?${SPACE}*,?${SPACE}*(\\d{4})$`);
const SLASHED = /^(\d{1,2})\/(\d{4})$/;
const DASHED = /^(\d{4})-(\d{1,2})$/;

/** One date, or undefined when the text is not one. */
export function readDate(text: string): YearMonth | undefined {
  const trimmed = text.trim();
  if (/^\d{4}$/.test(trimmed)) return isYear(trimmed) ? trimmed : undefined;
  const named = NAMED.exec(trimmed);
  if (named) {
    const month = MONTHS.get((named[1] ?? "").toLowerCase());
    const year = named[2] ?? "";
    return month !== undefined && isYear(year) ? `${year}-${pad(month)}` : undefined;
  }
  const numeric = SLASHED.exec(trimmed);
  const iso = DASHED.exec(trimmed);
  const [year, month] = numeric
    ? [numeric[2] ?? "", Number(numeric[1])]
    : iso
      ? [iso[1] ?? "", Number(iso[2])]
      : ["", 0];
  return isYear(year) && month >= 1 && month <= 12 ? `${year}-${pad(month)}` : undefined;
}

/** The dashes and the word that join a range's two ends, with the spaces around them. */
const JOIN = new RegExp(
  `${SPACE}*(?:---|--|[-\\u2013\\u2014])${SPACE}*|${SPACE}+to${SPACE}+`,
  "gi",
);

/**
 * A date or a range the whole text reads as, or undefined when it reads as neither. A range's
 * start is a date; its end a date, or open.
 */
export function readDates(text: string): Dates | undefined {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.length > 64) return undefined;
  const single = readDate(trimmed);
  if (single !== undefined) return { start: single };
  for (const join of trimmed.matchAll(JOIN)) {
    const start = readDate(trimmed.slice(0, join.index));
    if (start === undefined) continue;
    const rest = trimmed.slice(join.index + join[0].length).trim();
    if (OPEN_ENDS.has(rest.toLowerCase())) return { start, end: "present" };
    const end = readDate(rest);
    if (end !== undefined) return { start, end };
  }
  return undefined;
}
