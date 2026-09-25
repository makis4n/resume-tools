/**
 * The paragraph a field is set in, as TeX measured it where the field begins.
 *
 * The overlay breaks a field's lines with TeX's breaker so that what the user types sits where
 * the next compile will put it (decision 0004), and a breaker is only as good as its parameters.
 * Rather than guess them from the template, the generated LaTeX has TeX write them into a special
 * right after each field's begin marker (decision 0007): `rt:p:<id>:` and then `key=value` pairs
 * joined by `;`, always the same keys in the same order, each value as `\the` prints it. This
 * module reads that special back into the breaker's parameters.
 */

import { PARAGRAPH_MARKER } from "../templates/prelude";
import { type BreakParams, type Glue, LATEX_PARAMS, type LineSpec } from "../tex/linebreak";

/** The paragraph special's values, in scaled points where they are lengths. */
export interface Paragraph {
  /** The field the special belongs to, lowercased, as the page reads the markers. */
  id: string;
  hsize: number;
  leftSkip: Glue;
  rightSkip: Glue;
  parFillSkip: Glue;
  pretolerance: number;
  tolerance: number;
  emergencyStretch: number;
  hangIndent: number;
  hangAfter: number;
  /** `\parshape`'s lines, one entry each; empty when the paragraph has none. */
  shape: LineSpec[];
  /**
   * Whether TeX set the field in restricted horizontal mode, such as a tabular cell or an
   * `\mbox`, where it never breaks a line (`\ifinner`).
   */
  inner: boolean;
  /**
   * `\spaceskip` and `\xspaceskip`, the glue between words and after a sentence in place of the
   * font's when not zero, as ragged2e sets them to make the spaces of `\RaggedRight` rigid.
   */
  spaceSkip: Glue;
  xspaceSkip: Glue;
}

/** The keys of the special, in the order decision 0007 gives them and `prelude.ts` writes them. */
const KEYS = [
  "hsize",
  "leftskip",
  "rightskip",
  "parfillskip",
  "pretolerance",
  "tolerance",
  "emergencystretch",
  "hangindent",
  "hangafter",
  "parshape",
  "inner",
  "shape",
  "spaceskip",
  "xspaceskip",
] as const;

/** Scaled points in a point. */
const PT = 65536;

/**
 * The most lines of a paragraph's shape the breaker is given. The breaker tells the lines of a
 * shape apart, so its work grows with the shape's length as well as the text's: a template's
 * `\parshape` of 2,000 lines, or a `\hangafter` of 2^31 - 1 spelled out, made each keystroke cost
 * hundreds of milliseconds. No resume paragraph has 64 lines, so a longer `\parshape` keeps its
 * first 64, the last of which repeats, as TeX repeats a shape's last line anyway, and hanging
 * indentation spells out at most 64 lines before the ones that repeat.
 */
export const MAX_SHAPE_LINES = 64;

/** A number as `\the` prints one: an optional minus sign, digits, and a fraction. */
const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const DIMENSION = new RegExp(`^(${NUMBER})pt$`);
const INTEGER = /^-?\d+$/;
/** A stretch or shrink component: its amount and its unit, `pt` or an order of infinity. */
const COMPONENT = String.raw`(${NUMBER})(pt|fil|fill|filll)`;
const GLUE = new RegExp(`^(${NUMBER})pt(?: plus ${COMPONENT})?(?: minus ${COMPONENT})?$`);

/** The infinity order a unit names: 0 for points, then 1 to 3 for `fil` to `filll`. */
const ORDERS: Record<string, number> = { pt: 0, fil: 1, fill: 2, filll: 3 };

/**
 * The largest length and integer TeX holds, `\maxdimen` in scaled points and 2^31 - 1: `\the`
 * prints nothing larger, so a special that holds more, which only a template that writes its own
 * could, is malformed. A length past them would be infinite to the breaker, which then keeps every
 * break of a paragraph in play at once.
 */
const MAX_DIMEN = 0x3fffffff;
const MAX_INTEGER = 0x7fffffff;

/** Points as scaled points, or undefined past `\maxdimen`. */
function scaled(points: string): number | undefined {
  const sp = Math.round(Number(points) * PT);
  return Math.abs(sp) <= MAX_DIMEN ? sp : undefined;
}

function dimension(text: string): number | undefined {
  const match = DIMENSION.exec(text);
  return match ? scaled(match[1] as string) : undefined;
}

function integer(text: string): number | undefined {
  return INTEGER.test(text) && Math.abs(Number(text)) <= MAX_INTEGER ? Number(text) : undefined;
}

function glue(text: string): Glue | undefined {
  const match = GLUE.exec(text);
  if (!match) return undefined;
  const [, width = "", stretch = "0", stretchUnit, shrink = "0", shrinkUnit] = match;
  const [natural, plus, minus] = [width, stretch, shrink].map(scaled);
  if (natural === undefined || plus === undefined || minus === undefined) return undefined;
  return {
    width: natural,
    stretch: plus,
    stretchOrder: stretchUnit === undefined ? 0 : (ORDERS[stretchUnit] ?? 0),
    shrink: minus,
    shrinkOrder: shrinkUnit === undefined ? 0 : (ORDERS[shrinkUnit] ?? 0),
  };
}

/** `\parshape`'s lines, `<indent>,<length>` joined by `|`; empty text for no lines. */
function shape(text: string): LineSpec[] | undefined {
  if (text === "") return [];
  const lines: LineSpec[] = [];
  for (const line of text.split("|")) {
    const [indent, width, ...rest] = line.split(",");
    const spec = {
      indent: dimension(indent ?? ""),
      width: dimension(width ?? ""),
    };
    if (rest.length > 0 || spec.indent === undefined || spec.width === undefined) return undefined;
    lines.push({ indent: spec.indent, width: spec.width });
  }
  return lines;
}

/** A paragraph special's field, lowercased, and the values after it; undefined for any other. */
function split(text: string): { id: string; values: string } | undefined {
  if (text.slice(0, PARAGRAPH_MARKER.length).toLowerCase() !== PARAGRAPH_MARKER) return undefined;
  const rest = text.slice(PARAGRAPH_MARKER.length);
  const colon = rest.indexOf(":");
  if (colon < 0) return undefined;
  return { id: rest.slice(0, colon).toLowerCase(), values: rest.slice(colon + 1) };
}

/**
 * The field a paragraph special names, lowercased, or undefined for any other special. The id is
 * read whatever its case, as `markerId` reads the markers, since a template may set a field in
 * `\MakeUppercase`, which uppercases the special's text too; its values are never uppercased,
 * because `\rt@par` is protected and writes them after the case change.
 */
export function paragraphId(text: string): string | undefined {
  return split(text)?.id;
}

/**
 * The paragraph a special describes, or undefined when it is not a paragraph special with
 * decision 0007's keys, in its order, each with a value `\the` could have printed.
 */
export function parseParagraph(text: string): Paragraph | undefined {
  const special = split(text);
  if (special === undefined) return undefined;
  const pairs = special.values.split(";");
  if (pairs.length !== KEYS.length) return undefined;
  const values = new Map<string, string>();
  for (const [i, pair] of pairs.entries()) {
    const equals = pair.indexOf("=");
    if (equals < 0 || pair.slice(0, equals) !== KEYS[i]) return undefined;
    values.set(pair.slice(0, equals), pair.slice(equals + 1));
  }
  const value = (key: (typeof KEYS)[number]) => values.get(key) ?? "";
  const inner = value("inner");
  const paragraph = {
    id: special.id,
    hsize: dimension(value("hsize")),
    leftSkip: glue(value("leftskip")),
    rightSkip: glue(value("rightskip")),
    parFillSkip: glue(value("parfillskip")),
    pretolerance: integer(value("pretolerance")),
    tolerance: integer(value("tolerance")),
    emergencyStretch: dimension(value("emergencystretch")),
    hangIndent: dimension(value("hangindent")),
    hangAfter: integer(value("hangafter")),
    shape: shape(value("shape")),
    inner: inner === "1" ? true : inner === "0" ? false : undefined,
    spaceSkip: glue(value("spaceskip")),
    xspaceSkip: glue(value("xspaceskip")),
  };
  const lines = integer(value("parshape"));
  // `\parshape` counts the lines `shape` spells out, so the two must agree.
  if (lines === undefined || paragraph.shape?.length !== Math.max(0, lines)) return undefined;
  for (const field of Object.values(paragraph)) if (field === undefined) return undefined;
  return paragraph as Paragraph;
}

/** `count` copies of a line. */
const repeat = (line: LineSpec, count: number) => Array.from({ length: count }, () => line);

/**
 * The lines of a paragraph as `breakLines` takes them, by TeX's rules (tex.web §848–849): the
 * `\parshape` when it has one, whose last line repeats; otherwise the hanging indentation, which
 * with `\hangafter` n ≥ 0 narrows the lines after the first n, and with n < 0 the first −n; and
 * otherwise every line `\hsize` wide. A positive `\hangindent` indents on the left, a negative one
 * on the right, so the line starts where it would have and is that much shorter. At most
 * `MAX_SHAPE_LINES` lines are spelled out, and one more that repeats.
 */
function lineSpecs(paragraph: Paragraph): LineSpec[] {
  const { hsize, hangIndent, hangAfter } = paragraph;
  if (paragraph.shape.length > 0) return paragraph.shape.slice(0, MAX_SHAPE_LINES);
  const full = { indent: 0, width: hsize };
  if (hangIndent === 0) return [full];
  const hung = { indent: Math.max(0, hangIndent), width: hsize - Math.abs(hangIndent) };
  const special = Math.min(Math.abs(hangAfter), MAX_SHAPE_LINES);
  return hangAfter < 0 ? [...repeat(hung, special), full] : [...repeat(full, special), hung];
}

/**
 * The breaker's parameters for a paragraph: its lines, tolerances, emergency stretch and skips
 * from the special, and the demerits and `\linepenalty`, which the special does not carry, as
 * LaTeX leaves them. A field TeX never breaks (`inner`) is left to the caller, which sets it on
 * one row without the breaker.
 */
export function breakParams(paragraph: Paragraph): BreakParams {
  return {
    ...LATEX_PARAMS,
    lines: lineSpecs(paragraph),
    pretolerance: paragraph.pretolerance,
    tolerance: paragraph.tolerance,
    emergencyStretch: paragraph.emergencyStretch,
    leftSkip: paragraph.leftSkip,
    rightSkip: paragraph.rightSkip,
    parFillSkip: paragraph.parFillSkip,
    spaceSkip: paragraph.spaceSkip,
    xspaceSkip: paragraph.xspaceSkip,
  };
}

/**
 * The parameters for a field that starts `offset` scaled points into its paragraph's first line,
 * after other text there, as a skill set after its label does: that line is shorter by the
 * offset and starts that much further in, and the lines after it keep their own. A shape of one
 * line, which repeats, gets a copy of it after the shortened one, so that only the first line is
 * shorter. The field is taken to start on its paragraph's first line, which the page cannot tell
 * apart from a later one.
 */
export function startingAt(params: BreakParams, offset: number): BreakParams {
  const [first, ...rest] = params.lines;
  if (first === undefined || offset <= 0) return params;
  const shortened = { indent: first.indent + offset, width: first.width - offset };
  return { ...params, lines: [shortened, ...(rest.length > 0 ? rest : [first])] };
}
