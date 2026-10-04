/**
 * What a PDF's line may be, and what is known of it (milestone 3 second pass, items 12 and 13): the
 * closed list of roles, and a line's features as plain values, by its id. The labelling step
 * (`label.ts`) says them in the page; the reading service (`src/service/label.ts`) takes them
 * from the page and gives the model the list as an enum. Pure, with no import, so that the service
 * takes it without the layout's code.
 */

/**
 * The most characters of a line's text sent to be labelled, and the most the service takes: a role
 * needs the line's start, not all of a long paragraph.
 */
export const LABEL_TEXT_CHARS = 2_000;

/** The roles a line may have: a closed list, which a model is given as an enum. */
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
