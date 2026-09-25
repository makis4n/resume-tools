/**
 * Dates as the page shows them. The model stores dates as dates, never as prose (decision 0006),
 * so the date format control changes every date on the page at once, and TeX never formats one.
 */

import type { Dates, YearMonth } from "@resume-tools/resume-model";
import type { DateFormat } from "./package";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * One date in a format: `Jun 2020`, `June 2020`, `06/2020` or `2020`. A date stored as a year
 * alone is the year in every format. Throws for a date the model would refuse.
 */
export function formatDate(date: YearMonth, format: DateFormat): string {
  const [, year, month] = /^(\d{4})(?:-(\d{2}))?$/.exec(date) ?? [];
  if (year === undefined) throw new RangeError(`not a date: ${date}`);
  if (month === undefined || format === "yyyy") return year;
  const name = MONTHS[Number(month) - 1];
  if (name === undefined) throw new RangeError(`not a date: ${date}`);
  switch (format) {
    case "MMM yyyy":
      return `${name.slice(0, 3)} ${year}`;
    case "MMMM yyyy":
      return `${name} ${year}`;
    case "MM/yyyy":
      return `${month}/${year}`;
  }
}

/**
 * A date or a range. The two ends are joined by an en dash between spaces, which pdfTeX and XeTeX
 * both typeset and which the aligner matches to the `--` ligature's glyph; an ongoing range ends
 * in `Present`, and a single date, such as an award's, stands alone.
 */
export function formatDates(dates: Dates, format: DateFormat): string {
  const start = formatDate(dates.start, format);
  if (dates.end === undefined) return start;
  const end = dates.end === "present" ? "Present" : formatDate(dates.end, format);
  return `${start} – ${end}`;
}
