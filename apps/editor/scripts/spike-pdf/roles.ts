/**
 * What each line of a PDF is (item 3, a first cut of item 12's first step): one role from a closed
 * list, said by rules from the line's features, its size, its weight, where it sits and what stands
 * around it. The hosted model says the same from the same features (`model.ts`); the filing step
 * after it is the same whoever labelled the lines (`file.ts`).
 */

import type { Layout, Line } from "./layout.ts";
import {
  countWords,
  hasEmail,
  headingRole,
  isEmail,
  isPhone,
  isPlace,
  isShortName,
  isUrl,
  looksLikeDate,
  phoneIn,
} from "./text.ts";

/** The roles a line may have: a closed list, which the model is given as an enum. */
export const ROLES = [
  "name",
  "contact",
  "section heading",
  "entry head",
  "date",
  "place",
  "bullet",
  "running text",
] as const;
export type Role = (typeof ROLES)[number];

/** What the rules and the model see of a line: its text and its features, by its id. */
export interface Features {
  id: number;
  text: string;
  page: number;
  /** Its column among how many, where it stands. */
  column: number;
  columns: number;
  /** Its left edge from its column's, and its width, in points. */
  indent: number;
  width: number;
  /** Its size against the body's, to two places: 1 is the body's size. */
  size: number;
  bold: boolean;
  italic: boolean;
  /** Whether its letters are all capitals. */
  caps: boolean;
  bullet: boolean;
  /** Its place among the lines of its row in its column, from the left, and how many there are. */
  rowIndex: number;
  rowSize: number;
  /** Whether a long rule runs by it, as under a heading. */
  rule: boolean;
  /** The gap above it, in body sizes, to one place; none for the first in its column. */
  gapAbove?: number;
  /** How many links it carries. */
  links: number;
  /** The rows of text it joins. */
  rows: number;
}

/** Whether a text's letters are all capitals, three or more of them. */
export function allCaps(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, "");
  return letters.length >= 3 && letters === letters.toUpperCase() && /\p{Lu}/u.test(letters);
}

/** Each line's features, as the rules read them and the model is told them. */
export function featuresOf(layout: Layout): Features[] {
  return layout.lines.map((line) => ({
    id: line.id,
    text: line.text,
    page: line.page,
    column: line.column,
    columns: line.columns,
    indent: Math.round(line.x0 - line.columnLeft),
    width: Math.round(line.x1 - line.x0),
    size: Math.round((line.size / layout.bodySize) * 100) / 100,
    bold: line.bold,
    italic: line.italic,
    caps: allCaps(line.text),
    bullet: line.bullet,
    rowIndex: line.rowIndex,
    rowSize: line.rowSize,
    rule: line.rule,
    ...(line.gapAbove === undefined
      ? {}
      : { gapAbove: Math.round((line.gapAbove / layout.bodySize) * 10) / 10 }),
    links: line.links.length,
    rows: line.rows,
  }));
}

/** Whether a line reads as a contact: an email, a phone, an address, a link, or items of them. */
export function contactLike(line: Pick<Line, "text" | "links">): boolean {
  if (line.links.length > 0) return true;
  if (hasEmail(line.text) || isPhone(line.text) || phoneIn(line.text) !== undefined) return true;
  const items = line.text.split(/\s*[|•·⋅◦∙,]\s*|\s{2,}/u).filter((item) => item !== "");
  return items.some((item) => isUrl(item) || hasEmail(item) || isPhone(item));
}

/** Whether a line is nothing but contacts: an email, a phone or an address, or some of them. */
export function onlyContact(text: string): boolean {
  const items = text
    .replace(/^(?:e-?mail|phone|tel|mobile|web(?:site)?|linkedin|github)\s*[:.]\s*/iu, "")
    .split(/\s*[|•·⋅◦∙]\s*|\s{2,}/u)
    .filter((item) => item !== "");
  return (
    items.length > 0 &&
    countWords(text) <= 6 &&
    items.every((item) => isEmail(item) || isPhone(item) || isUrl(item))
  );
}

/** Whether two lines stand in the same column. */
const sameColumn = (a: Line, b: Line) => a.column === b.column && a.columns === b.columns;

/** A label before a colon, as `Languages: TypeScript, Rust` has, short and at the line's start. */
export const LABEL = /^([^:]{1,32}):\s*(\S.*)$/u;

/**
 * A line's text without the date at its end, and the date, when it ends in one after a comma, a
 * separator or an opening bracket: `Teacher, School (2016–2024)`, `Analyst | 2019 – 2021`. The
 * longest date wins, so a range is not cut at its own dash.
 */
export function trailingDate(text: string): { rest: string; date: string } | undefined {
  const trimmed = text.trim();
  if (!/(?:19|20)\d\d|present/iu.test(trimmed)) return undefined;
  for (const cut of trimmed.matchAll(/\s*(?:[,|·•]|\s[–—-]\s|\()\s*/gu)) {
    const rest = trimmed.slice(0, cut.index).trim();
    const date = trimmed
      .slice(cut.index + cut[0].length)
      .replace(/\)\s*$/u, "")
      .trim();
    if (rest !== "" && looksLikeDate(date)) return { rest, date };
  }
  return undefined;
}

/**
 * Each line's role, by rules. Bullets first, by their glyph; the name, the largest line high on the
 * first page; the headings, by the style most lines with a section's words or a rule share; then,
 * before the first heading, contacts and running text, and after it, dates, places and entries'
 * heads by their rows, weights and sizes, and running text for the rest.
 */
export function labelByRules(layout: Layout): Role[] {
  const { lines, bodySize } = layout;
  const roles: Role[] = lines.map((line) => (line.bullet ? "bullet" : "running text"));
  const firstPage = lines.filter((line) => line.page === (lines[0]?.page ?? 1));
  const pageHeight = layout.pages[0]?.height ?? 792;

  // The name: the largest line high on the first page, clearly larger than the body, or else the
  // first line, when it is short, bold and has no digits.
  const nameCandidates = firstPage.filter(
    (line) =>
      !line.bullet &&
      line.top < 0.3 * pageHeight &&
      countWords(line.text) >= 1 &&
      countWords(line.text) <= 5 &&
      !/[\d@]/.test(line.text),
  );
  const largest = [...nameCandidates].sort((a, b) => b.size - a.size || a.top - b.top)[0];
  let name: Line | undefined;
  if (largest !== undefined && largest.size >= 1.3 * bodySize) name = largest;
  else {
    const first = firstPage[0];
    if (first !== undefined && first.bold && nameCandidates.includes(first)) name = first;
  }
  if (name !== undefined) roles[name.id] = "name";

  // The headings: short lines set apart by size, capitals, weight, a rule or a section's words,
  // which share the style the most of those with a section's words or a rule have.
  const headingCandidate = (line: Line) =>
    !line.bullet &&
    line !== name &&
    line.rows === 1 &&
    countWords(line.text) >= 1 &&
    countWords(line.text) <= 6 &&
    line.text.length <= 50 &&
    /\p{L}{2}/u.test(line.text) &&
    !/[@]/.test(line.text) &&
    !/[.,;]$/.test(line.text) &&
    !looksLikeDate(line.text) &&
    !contactLike(line);
  const styleOf = (line: Line) =>
    `${line.font}|${Math.round(line.size * 2) / 2}|${allCaps(line.text)}|${line.bold}`;
  const scoreOf = (line: Line) =>
    (headingRole(line.text) !== undefined ? 2 : 0) +
    (line.rule ? 2 : 0) +
    (line.size >= 1.4 * bodySize ? 2 : line.size >= 1.12 * bodySize ? 1 : 0) +
    (allCaps(line.text) ? 1 : 0) +
    (line.bold ? 1 : 0) +
    (line.rowSize === 1 ? 0.5 : 0) +
    ((line.gapAbove ?? 0) >= bodySize ? 1 : 0);
  const candidates = lines.filter(headingCandidate);
  const styles = new Map<string, number>();
  for (const line of candidates)
    if (headingRole(line.text) !== undefined || line.rule)
      styles.set(styleOf(line), (styles.get(styleOf(line)) ?? 0) + scoreOf(line));
  const headingStyle = [...styles].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const line of candidates) {
    const sameStyle = headingStyle !== undefined && styleOf(line) === headingStyle;
    const standsOut = line.size >= 1.12 * bodySize || allCaps(line.text) || line.bold || line.rule;
    if ((sameStyle && standsOut) || scoreOf(line) >= 5) roles[line.id] = "section heading";
  }

  // Before the first heading: contacts, and the rest running text.
  const firstHeading = lines.find((line) => roles[line.id] === "section heading");
  const headerEnd = firstHeading?.id ?? lines.length;
  for (const line of lines.slice(0, headerEnd)) {
    if (roles[line.id] !== "running text") continue;
    if (contactLike(line) || isPlace(line.text)) roles[line.id] = "contact";
  }
  // A short line beside a contact on its row is a contact too, as a place between two addresses.
  for (const line of lines.slice(0, headerEnd))
    if (
      roles[line.id] === "running text" &&
      countWords(line.text) <= 4 &&
      lines.some(
        (other) =>
          other !== line &&
          roles[other.id] === "contact" &&
          sameColumn(other, line) &&
          other.row === line.row &&
          Math.max(other.x0 - line.x1, line.x0 - other.x1) <= 6 * line.size,
      )
    )
      roles[line.id] = "contact";
  // After it, a line that is nothing but an address, a phone or an email, as a sidebar's are.
  for (const line of lines.slice(headerEnd))
    if (roles[line.id] === "running text" && onlyContact(line.text)) roles[line.id] = "contact";

  // After it: dates and places, then entries' heads.
  const after = lines.slice(headerEnd);
  for (const line of after) {
    if (roles[line.id] !== "running text") continue;
    if (looksLikeDate(line.text)) roles[line.id] = "date";
  }
  const rowMates = (line: Line) =>
    lines.filter((other) => other.row === line.row && other !== line && sameColumn(other, line));
  // A place at a row's end, beside a date or a title.
  for (const line of after) {
    if (roles[line.id] !== "running text" || line.rowIndex === 0) continue;
    const besideDate = rowMates(line).some((other) => roles[other.id] === "date");
    if (isPlace(line.text) || (isShortName(line.text) && (besideDate || line.italic)))
      roles[line.id] = "place";
  }
  for (const line of after) {
    if (roles[line.id] !== "running text") continue;
    const words = countWords(line.text);
    if (words > 16 || line.rows > 1) continue;
    const labelled = LABEL.test(line.text) && (line.parts[0]?.bold ?? false);
    if (labelled) continue;
    const mates = rowMates(line);
    const besideDateOrPlace = mates.some(
      (other) => roles[other.id] === "date" || roles[other.id] === "place",
    );
    const larger = line.size >= 1.08 * bodySize;
    const dated = words <= 20 && trailingDate(line.text) !== undefined;
    if (besideDateOrPlace || line.bold || larger || dated) roles[line.id] = "entry head";
  }
  // A place alone on its row, next to an entry's head or its date.
  for (const line of after) {
    if (roles[line.id] !== "running text" || !isPlace(line.text)) continue;
    const near = [lines[line.id - 1], lines[line.id + 1]].some(
      (other) =>
        other !== undefined && (roles[other.id] === "entry head" || roles[other.id] === "date"),
    );
    if (near) roles[line.id] = "place";
  }
  // An italic line or a short one right after an entry's head, before its bullets, is the head's
  // second line, as a title's company or a degree is.
  for (const line of after) {
    if (roles[line.id] !== "running text") continue;
    const previous = lines[line.id - 1];
    const next = lines[line.id + 1];
    if (previous === undefined || roles[previous.id] !== "entry head") continue;
    const short = countWords(line.text) <= 10 && line.rows === 1;
    const beforeBody =
      next === undefined ||
      roles[next.id] === "bullet" ||
      roles[next.id] === "date" ||
      roles[next.id] === "place";
    if (short && (line.italic || beforeBody) && !LABEL.test(line.text))
      roles[line.id] = "entry head";
  }
  return roles;
}
