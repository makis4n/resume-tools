/**
 * A PDF's lines, labelled (milestone 3 second pass, item 12, the first of its two steps, promoted
 * from the spike of item 3, decision 0051): what each line is, one role from a closed list, said
 * from the line's text and its features, its size, its weight, where it sits and what stands around
 * it. Rules say it here (`labelByRules`), and they stay the answer for a person who does not agree
 * to send the PDF's text. The hosted model of item 13 replaces this step only, through the seam
 * below (`Labeller`): it is given the same lines and answers a role a line, and the filing step
 * after it (`file.ts`) is the same whoever labelled the lines.
 */

import type { Layout, Line } from "./layout.ts";
import type { Features, Role } from "./roles.ts";
import { ROLES } from "./roles.ts";
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

// The closed list of roles and what a line's features are live in `roles.ts`, which the reading
// service takes too without the layout's code.
export { type Features, ROLES, type Role } from "./roles.ts";

/** Whether a text's letters are all capitals, three or more of them. */
export function allCaps(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, "");
  return letters.length >= 3 && letters === letters.toUpperCase() && /\p{Lu}/u.test(letters);
}

/** Each line's features, as a table of plain values: what a model is told of the lines. */
export function featuresOf(layout: LabelInput): Features[] {
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
export function labelByRules(layout: LabelInput): Role[] {
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

// The seam: who labels the lines.

/**
 * What a labeller is given: the layout's lines in reading order, each with its text and its
 * features, the pages they stand on, and the body's size. Every labeller gets the same.
 */
export type LabelInput = Pick<Layout, "lines" | "pages" | "bodySize">;

/** Who said what the lines are, which the review names. */
export type LabelledBy = "rules" | "model";

/**
 * Step one of reading a PDF, as a seam: given the lines, a role for each, `roles[i]` the role of
 * `lines[i]`, every one from `ROLES`. The rules are one labeller (`rulesLabeller`); the hosted
 * model of item 13 is another, which may answer later, fail, or answer in the wrong form, and the
 * rules then answer in its place (`labelLines`).
 */
export interface Labeller {
  readonly by: LabelledBy;
  label(
    input: LabelInput,
    options: { signal?: AbortSignal },
  ): readonly Role[] | Promise<readonly Role[]>;
}

/** The rules, as a labeller: always there, and always an answer. */
export const rulesLabeller: Labeller = { by: "rules", label: (input) => labelByRules(input) };

/**
 * Why a labeller's answer was not taken, and the rules answered in its place: the person has not
 * agreed to send the PDF's text (`no consent`), the labeller failed or could not reach its service
 * (`failed`), it answered past its time budget (`timeout`), or in a form other than one role from
 * the list for each line (`wrong form`).
 */
export const LABEL_FALLBACKS = ["no consent", "failed", "timeout", "wrong form"] as const;
export type LabelFallback = (typeof LABEL_FALLBACKS)[number];

/**
 * What a labeller throws to say why it gives no answer, so that the rules answer with that reason
 * kept. Anything else it throws is `failed`.
 */
export class LabellerFallback extends Error {
  readonly reason: LabelFallback;

  constructor(reason: LabelFallback) {
    super(`The labeller gave no answer: ${reason}.`);
    this.name = "LabellerFallback";
    this.reason = reason;
  }
}

/** The lines' roles, who said them, and, when the rules stood in, why. */
export interface Labels {
  roles: Role[];
  by: LabelledBy;
  fallback?: LabelFallback;
}

/** Whether an answer holds one role from the closed list for each line, and nothing else. */
export function rolesFit(lines: readonly Line[], roles: unknown): roles is readonly Role[] {
  return (
    Array.isArray(roles) &&
    roles.length === lines.length &&
    roles.every((role) => typeof role === "string" && (ROLES as readonly string[]).includes(role))
  );
}

/**
 * Label the lines with a labeller, the rules by default. An answer that fails, or that does not
 * give one role from the list for each line, is set aside whole, and the rules answer, with the
 * reason kept: the one a `LabellerFallback` names, or `failed`. Stopping by `signal` is the
 * caller's, and is not caught.
 */
export async function labelLines(
  input: LabelInput,
  labeller: Labeller = rulesLabeller,
  options: { signal?: AbortSignal } = {},
): Promise<Labels> {
  if (labeller === rulesLabeller) return { roles: labelByRules(input), by: "rules" };
  let answer: unknown;
  try {
    answer = await labeller.label(input, options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const fallback = error instanceof LabellerFallback ? error.reason : "failed";
    return { roles: labelByRules(input), by: "rules", fallback };
  }
  if (!rolesFit(input.lines, answer))
    return { roles: labelByRules(input), by: "rules", fallback: "wrong form" };
  return { roles: [...answer], by: labeller.by };
}
