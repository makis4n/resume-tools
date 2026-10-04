/**
 * A PDF's layout (milestone 3 second pass, item 11, promoted from the spike of item 3, decision
 * 0051): pure rules over what the reader gives (`read.ts`), whoever then says what each line is.
 * Runs become lines and lines become blocks; columns are found from the gaps between them and read
 * one after the other; a bullet's glyph, or the dot a browser draws for one, marks a bullet; an
 * icon is dropped and its drop noted on the line it stood in; and a hyphen at a line's end joins
 * its word only where the next line carries on in small letters.
 *
 * Words: a *run* is pdf.js's, one font on one baseline; a *row* is the runs on one baseline; a
 * *piece* of a row is a stretch of it with no wide gap, so that a title and the date set apart from
 * it at the row's right end are two; a *line* is a piece, or several pieces of a paragraph or a
 * bullet that wraps, joined; a *block* is a stretch of lines in one column in about one size, with
 * no more than the column's own spacing and no rule between them: a paragraph, an entry, a heading
 * set apart. Lines and blocks come out in reading order.
 *
 * Positions are the reader's: PDF points from the page's top left, y growing down.
 */

import type { Mark, PdfLink, ReadPdf, TextRun } from "./read.ts";

/** A run as a line holds it, with where it ends. */
export interface Part {
  text: string;
  x0: number;
  x1: number;
  /** The baseline of the row it stands on, which tells a wrapped line's rows apart. */
  baseline: number;
  size: number;
  font: string;
  bold: boolean;
  italic: boolean;
}

export interface Line {
  /** Its place in reading order, from 0. */
  id: number;
  page: number;
  text: string;
  /** The runs it joins, in order, without the bullet's glyph and the icons. */
  parts: Part[];
  /** Its box on the page, its first row's baseline, and its last's. */
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  baseline: number;
  lastBaseline: number;
  /** The size most of its letters are set in, and whether most are bold, italic. */
  size: number;
  bold: boolean;
  italic: boolean;
  font: string;
  /** Whether a bullet's glyph or a drawn dot stood before it. */
  bullet: boolean;
  /** The row it stands on, an id shared with the other lines of the row in its column. */
  row: number;
  /** Its place among the lines of its row in its column, from the left, and how many there are. */
  rowIndex: number;
  rowSize: number;
  /** Its column, from 0 at the left, among how many stand side by side where it is. */
  column: number;
  columns: number;
  /** The right edge of the column it stands in. */
  columnRight: number;
  columnLeft: number;
  /** The addresses of the links over it, in order, each once. */
  links: string[];
  /** Whether a long rule runs just above, through or just below it, as under a heading. */
  rule: boolean;
  /** The rows of text it joins: 1, or more for a paragraph or bullet that wraps. */
  rows: number;
  /** The gap from the line above it in its column to its own top, in points; none for a first. */
  gapAbove?: number;
  /** How many icons were dropped from its rows: a phone's or a mail's sign before a contact. */
  icons: number;
  /** The block it stands in, by the block's id. */
  block: number;
}

/**
 * A stretch of lines in one column of one page, each standing on the row of the one before it or
 * right below it, in about its size, with no wider gap than the column's usual spacing and no rule
 * between (`sameBlock`): a paragraph, an entry's head with its bullets, a heading set apart.
 */
export interface Block {
  /** Its place in reading order, from 0. */
  id: number;
  page: number;
  column: number;
  columns: number;
  /** Its lines' ids, in reading order; consecutive, since a block's lines are read together. */
  lines: number[];
  /** The box around its lines. */
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

export interface Layout {
  lines: Line[];
  blocks: Block[];
  pages: { number: number; width: number; height: number; columns: number }[];
  /** The links of every page, for the header's addresses. */
  links: (PdfLink & { page: number })[];
  /** The size most of the document's letters are set in. */
  bodySize: number;
  /**
   * How many icons were dropped in all, those on rows with no text left among them too; and how
   * many hyphens joined a word across two rows.
   */
  icons: number;
  hyphenJoins: number;
}

/**
 * The fonts that set icons rather than text: Font Awesome and its kin, and the symbol fonts that
 * templates take pictograms from. A run in one of them is an icon, dropped, whatever characters
 * its encoding gives it.
 */
const ICON_FONT =
  /awesome|academicons|materialicons|material-?symbols|material-?icons|icomoon|glyphicons|ionicons|octicons|simple-?icons|devicon|fontello|entypo|typicons|feather|lucide|tabler|bootstrap-?icons|boxicons|marvosym|webdings|wingding/i;

/** The dingbat fonts, whose glyphs before a line are its bullet. */
const DINGBAT_FONT = /dingbat|zapf|pifont|wasy|symbol/i;

/** The characters a bullet is set with. */
const BULLET_CHARS = new Set([..."•◦▪▫‣⁃●○■□►▸▹▶➢➤➣→✓✔❖◆◇∙·⋅∗*-–—"]);

/** Characters that are pictures, not text: the private use areas, and pictographs. */
const PICTURE =
  /[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{FFFD}\u{FE0F}]/gu;

/** A run's text without what is a picture, and whether it lost any. */
function withoutPictures(text: string): { text: string; lost: boolean } {
  const kept = text.replace(PICTURE, (char) => (BULLET_CHARS.has(char) ? char : ""));
  return { text: kept, lost: kept !== text };
}

/** Whether a run is only a bullet's glyph. */
const isBulletGlyph = (run: { text: string; font: string }) =>
  (run.text.length === 1 && BULLET_CHARS.has(run.text)) ||
  (DINGBAT_FONT.test(run.font) && run.text.trim().length === 1);

/** The gap between two runs past which a row splits into pieces: the larger of these. */
const PIECE_GAP_EM = 1.2;
const PIECE_GAP_MIN = 10;

/** The gap between two runs past which they are two words, in ems of the larger. */
const WORD_GAP_EM = 0.12;

/** How far apart two runs' baselines may be and stand on one row, in ems of the smaller. */
const ROW_BASELINE_EM = 0.45;

/** A piece of a row, before it becomes a line. */
interface Piece {
  page: number;
  runs: Part[];
  baseline: number;
  bullet: boolean;
  icons: number;
  row: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  size: number;
}

/** The size most of a set of runs' letters are set in. */
function dominantSize(parts: readonly { text: string; size: number }[]): number {
  const counts = new Map<number, number>();
  for (const part of parts) {
    const size = Math.round(part.size * 10) / 10;
    counts.set(size, (counts.get(size) ?? 0) + part.text.replace(/\s/g, "").length);
  }
  let best = 0;
  let most = -1;
  for (const [size, count] of counts)
    if (count > most || (count === most && size > best)) {
      best = size;
      most = count;
    }
  return best;
}

/**
 * A page's rows of runs: runs whose baselines are within a fraction of an em stand on one row, the
 * row whose baseline is nearest, so that a run beside a column's row whose baseline is a little
 * off is not taken from the row of its own bullet.
 */
function rowsOf(runs: readonly TextRun[]): TextRun[][] {
  const sorted = [...runs].sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const rows: { baseline: number; size: number; runs: TextRun[] }[] = [];
  for (const run of sorted) {
    let row: (typeof rows)[number] | undefined;
    for (const each of rows) {
      const off = Math.abs(each.baseline - run.baseline);
      if (off > ROW_BASELINE_EM * Math.min(each.size, run.size)) continue;
      if (row === undefined || off < Math.abs(row.baseline - run.baseline)) row = each;
    }
    if (row) {
      row.runs.push(run);
      // The row's baseline is its largest run's, which a bullet's small glyph does not move.
      if (run.size > row.size) {
        row.size = run.size;
        row.baseline = run.baseline;
      }
    } else rows.push({ baseline: run.baseline, size: run.size, runs: [run] });
  }
  return rows.map((row) => row.runs.sort((a, b) => a.x - b.x));
}

/**
 * A row's runs cut into pieces at its wide gaps, icons dropped and a leading bullet marked; with
 * every icon the row dropped counted, those that stood before a piece noted on it, and those after
 * the row's last text on its last piece.
 */
function piecesOf(
  page: number,
  row: number,
  runs: readonly TextRun[],
): { pieces: Piece[]; icons: number } {
  const pieces: Piece[] = [];
  let current: Piece | undefined;
  let icons = 0;
  let dropped = 0;
  for (const run of runs) {
    const icon = ICON_FONT.test(run.font);
    const { text, lost } = icon ? { text: "", lost: true } : withoutPictures(run.text);
    if (lost) {
      icons++;
      dropped++;
    }
    if (text.trim() === "") continue;
    const part: Part = {
      text: text.trim(),
      x0: run.x,
      x1: run.x + run.width,
      baseline: run.baseline,
      size: run.size,
      font: run.font,
      bold: run.bold,
      italic: run.italic,
    };
    const last = current?.runs.at(-1);
    const gap = last === undefined ? 0 : part.x0 - last.x1;
    const wide = Math.max(PIECE_GAP_EM * Math.max(part.size, last?.size ?? 0), PIECE_GAP_MIN);
    // A bullet's glyph stays with the text after it, however wide its gap.
    const afterBullet = current !== undefined && current.bullet && current.runs.length === 0;
    if (current === undefined || (gap > wide && !afterBullet)) {
      current = {
        page,
        runs: [],
        baseline: run.baseline,
        bullet: false,
        icons: 0,
        row,
        x0: part.x0,
        x1: part.x1,
        top: 0,
        bottom: 0,
        size: 0,
      };
      pieces.push(current);
    }
    current.icons += icons;
    icons = 0;
    if (current.runs.length === 0 && !current.bullet && isBulletGlyph(part)) {
      current.bullet = true;
      continue;
    }
    // A bullet written as text: `- ` or `• ` before the words.
    if (current.runs.length === 0 && !current.bullet) {
      const leading = /^([•◦▪‣⁃●○■►▸➢➤✓✔❖∙·*–—-])\s+(?=\S)/u.exec(part.text);
      if (leading) {
        current.bullet = true;
        part.text = part.text.slice(leading[0].length);
      }
    }
    current.runs.push(part);
  }
  for (const piece of pieces) {
    piece.size = dominantSize(piece.runs);
    piece.x0 = Math.min(...piece.runs.map((part) => part.x0));
    piece.x1 = Math.max(...piece.runs.map((part) => part.x1));
    piece.top = piece.baseline - 0.75 * piece.size;
    piece.bottom = piece.baseline + 0.25 * piece.size;
  }
  // A piece left with no text, a bullet's glyph at a row's end, is dropped.
  const kept = pieces.filter((piece) => piece.runs.length > 0);
  const last = kept.at(-1);
  if (last !== undefined) last.icons += icons;
  return { pieces: kept, icons: dropped };
}

/** Runs' texts joined as a row sets them: a space where the gap is a word's, none otherwise. */
export function joinParts(parts: readonly Part[]): string {
  let text = "";
  let previous: Part | undefined;
  for (const part of parts) {
    if (previous !== undefined) {
      const gap = part.x0 - previous.x1;
      const space = gap > WORD_GAP_EM * Math.max(part.size, previous.size);
      if (space && !/\s$/.test(text) && !/^\s/.test(part.text)) text += " ";
    }
    text += part.text;
    previous = part;
  }
  return unspaced(text.replace(/\s+/g, " ").trim());
}

/**
 * Text set letter-spaced, `S U M M A R Y`, as pdf.js reads it, a space at every letter's gap, with
 * the spaces taken out: four or more tokens, nearly all of one or two letters, none of more than
 * three. pdf.js gives a word's gap the same one space, so `W O R K E X P E R I E N C E` keeps no
 * word boundary.
 */
export function unspaced(text: string): string {
  const tokens = text.split(" ");
  if (tokens.length < 4) return text;
  const short = tokens.filter((token) => token.length <= 2).length;
  if (short < 0.8 * tokens.length || tokens.some((token) => token.length > 3)) return text;
  if (!tokens.every((token) => /^[\p{L}&]+$/u.test(token))) return text;
  return tokens.join("");
}

// Columns.

/** A region's split into two columns: where, and the rows it spans. */
interface Split {
  x: number;
  top: number;
  bottom: number;
}

/** The share of the region's height a split must span. */
const SPLIT_HEIGHT = 0.25;
/** The rows each side of a split must hold. */
const SPLIT_ROWS = 3;
/** Past this share of the right side's pieces standing on the left side's rows, it is a table. */
const TABLE_ROWS = 0.6;
/** From this share of the left side's pieces standing on the right side's rows, it is a table. */
const TABLE_CELLS = 0.7;
/** At least this share of the right side's pieces start at one edge, as a column's do. */
const COLUMN_EDGE = 0.4;

/**
 * Where a region of pieces splits into two columns, if anywhere: the vertical band of gap, free of
 * any piece across it, that spans the most height with pieces on both sides, as long as it spans a
 * quarter of the region, both sides hold three rows, the right side's pieces mostly start at one
 * edge, as a column's do, and they mostly do not stand on the left side's rows, as a table's cells
 * and a title's date at the row's end do.
 */
function findSplit(pieces: readonly Piece[]): Split | undefined {
  if (pieces.length < 2 * SPLIT_ROWS) return undefined;
  const top = Math.min(...pieces.map((piece) => piece.top));
  const bottom = Math.max(...pieces.map((piece) => piece.bottom));
  const left = Math.floor(Math.min(...pieces.map((piece) => piece.x0)));
  const right = Math.ceil(Math.max(...pieces.map((piece) => piece.x1)));
  let best: (Split & { height: number }) | undefined;
  let run: { from: number; to: number; top: number; bottom: number } | undefined;
  const runs: { from: number; to: number; top: number; bottom: number; height: number }[] = [];
  for (let x = left + 1; x < right; x++) {
    const blocked = pieces
      .filter((piece) => piece.x0 - 1 < x && x < piece.x1 + 1)
      .map((piece) => [piece.top, piece.bottom] as const)
      .sort((a, b) => a[0] - b[0]);
    // The free bands at x, between the pieces across it.
    const free: [number, number][] = [];
    let from = top;
    for (const [a, b] of blocked) {
      if (a > from) free.push([from, a]);
      from = Math.max(from, b);
    }
    if (from < bottom) free.push([from, bottom]);
    let found: { top: number; bottom: number; height: number } | undefined;
    for (const [a, b] of free) {
      const inside = pieces.filter((piece) => piece.top >= a - 0.5 && piece.bottom <= b + 0.5);
      const leftRows = new Set(inside.filter((piece) => piece.x1 <= x).map((piece) => piece.row));
      const rightRows = new Set(inside.filter((piece) => piece.x0 >= x).map((piece) => piece.row));
      if (leftRows.size < SPLIT_ROWS || rightRows.size < SPLIT_ROWS) continue;
      const spanTop = Math.min(...inside.map((piece) => piece.top));
      const spanBottom = Math.max(...inside.map((piece) => piece.bottom));
      const height = spanBottom - spanTop;
      if (found === undefined || height > found.height)
        found = { top: spanTop, bottom: spanBottom, height };
    }
    if (found === undefined) {
      if (run) runs.push({ ...run, height: run.bottom - run.top });
      run = undefined;
      continue;
    }
    if (run && run.top === found.top && run.bottom === found.bottom) run.to = x;
    else {
      if (run) runs.push({ ...run, height: run.bottom - run.top });
      run = { from: x, to: x, top: found.top, bottom: found.bottom };
    }
  }
  if (run) runs.push({ ...run, height: run.bottom - run.top });
  runs.sort((a, b) => b.height - a.height);
  for (const each of runs) {
    if (each.height < SPLIT_HEIGHT * (bottom - top)) break;
    const x = (each.from + each.to) / 2;
    const inside = pieces.filter(
      (piece) => piece.top >= each.top - 0.5 && piece.bottom <= each.bottom + 0.5,
    );
    const leftSide = inside.filter((piece) => piece.x1 <= x);
    const rightSide = inside.filter((piece) => piece.x0 >= x);
    // A table's rows: most of the right side's pieces stand on the left side's rows, or most of the
    // left side's on the right side's, as a column of years beside the entries they head does.
    const onRowsOf = (pieces: readonly Piece[], others: readonly Piece[]) =>
      pieces.filter((piece) =>
        others.some((other) => Math.abs(other.baseline - piece.baseline) <= 1),
      ).length;
    if (onRowsOf(rightSide, leftSide) > TABLE_ROWS * rightSide.length) continue;
    if (onRowsOf(leftSide, rightSide) >= TABLE_CELLS * leftSide.length) continue;
    const edge = Math.min(...rightSide.map((piece) => piece.x0));
    const atEdge = rightSide.filter((piece) => piece.x0 - edge <= 2).length;
    if (atEdge < COLUMN_EDGE * rightSide.length) continue;
    best = { x, top: each.top, bottom: each.bottom, height: each.height };
    break;
  }
  return best;
}

/** A region's pieces in reading order, with each piece's column among how many, by `findSplit`. */
function order(
  pieces: readonly Piece[],
  depth = 0,
): { piece: Piece; column: number; columns: number; left: number; right: number }[] {
  const split = depth < 3 ? findSplit(pieces) : undefined;
  if (split === undefined) {
    const left = Math.min(...pieces.map((piece) => piece.x0));
    const right = Math.max(...pieces.map((piece) => piece.x1));
    return [...pieces]
      .sort((a, b) => a.baseline - b.baseline || a.x0 - b.x0)
      .map((piece) => ({ piece, column: 0, columns: 1, left, right }));
  }
  const inBand = (piece: Piece) =>
    piece.top >= split.top - 0.5 && piece.bottom <= split.bottom + 0.5;
  const above = pieces.filter((piece) => !inBand(piece) && piece.top < split.top);
  const below = pieces.filter((piece) => !inBand(piece) && piece.top >= split.top);
  const leftSide = pieces.filter((piece) => inBand(piece) && piece.x1 <= split.x);
  const rightSide = pieces.filter((piece) => inBand(piece) && piece.x0 >= split.x);
  const leftOrdered = order(leftSide, depth + 1);
  const rightOrdered = order(rightSide, depth + 1);
  const leftColumns = Math.max(1, ...leftOrdered.map((each) => each.columns));
  const rightColumns = Math.max(1, ...rightOrdered.map((each) => each.columns));
  const columns = leftColumns + rightColumns;
  return [
    ...(above.length > 0 ? order(above, depth + 1) : []),
    ...leftOrdered.map((each) => ({ ...each, columns })),
    ...rightOrdered.map((each) => ({ ...each, column: each.column + leftColumns, columns })),
    ...(below.length > 0 ? order(below, depth + 1) : []),
  ];
}

// Lines.

/** Whether a drawn dot stands just before a piece, at its height: a bullet a browser drew. */
function dotBefore(piece: Piece, marks: readonly Mark[]): boolean {
  return marks.some(
    (mark) =>
      mark.kind === "dot" &&
      mark.x1 <= piece.x0 + 0.5 &&
      piece.x0 - mark.x1 <= 3 * piece.size &&
      (mark.y0 + mark.y1) / 2 >= piece.top &&
      (mark.y0 + mark.y1) / 2 <= piece.bottom,
  );
}

/** Whether a long rule runs just above, through or just below a piece. */
function ruleBy(piece: Piece, marks: readonly Mark[], columnWidth: number): boolean {
  return marks.some((mark) => {
    if (mark.kind !== "rule") return false;
    const middle = (mark.y0 + mark.y1) / 2;
    const near =
      middle >= piece.top - 0.6 * piece.size && middle <= piece.baseline + 1.0 * piece.size;
    const long = mark.x1 - mark.x0 >= Math.max(120, 0.35 * columnWidth);
    const beside = mark.x0 <= piece.x1 + 3 * piece.size && mark.x1 >= piece.x0;
    return near && long && beside;
  });
}

/** The links over a piece: those whose box overlaps it. */
function linksOver(piece: Piece, links: readonly PdfLink[]): string[] {
  const over = links.filter(
    (link) =>
      link.x0 < piece.x1 &&
      link.x1 > piece.x0 &&
      link.y0 < piece.bottom + 1 &&
      link.y1 > piece.top - 1,
  );
  return [...new Set(over.map((link) => link.url))];
}

/** Whether most of a set of runs' letters are set in a style. */
function mostly(parts: readonly Part[], style: "bold" | "italic"): boolean {
  let yes = 0;
  let all = 0;
  for (const part of parts) {
    const letters = part.text.replace(/[^\p{L}\p{N}]/gu, "").length;
    all += letters;
    if (part[style]) yes += letters;
  }
  return all > 0 && yes >= 0.6 * all;
}

/** The font most of a set of runs' letters are set in. */
function dominantFont(parts: readonly Part[]): string {
  const counts = new Map<string, number>();
  for (const part of parts) counts.set(part.font, (counts.get(part.font) ?? 0) + part.text.length);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/**
 * Lay a read PDF out: its rows, pieces and columns on each page, its lines in reading order, and
 * the lines of a paragraph or a bullet that wraps joined into one, with a word a hyphen broke at a
 * row's end joined where the next row carries on in small letters.
 */
export function layOut(read: ReadPdf): Layout {
  const lines: Line[] = [];
  const pages: Layout["pages"] = [];
  const links: Layout["links"] = [];
  let icons = 0;
  let hyphenJoins = 0;
  let rowId = 0;
  const bodySize = dominantSize(
    read.pages.flatMap((page) => page.runs).map((run) => ({ text: run.text, size: run.size })),
  );
  for (const page of read.pages) {
    links.push(...page.links.map((link) => ({ ...link, page: page.number })));
    const pieces = rowsOf(page.runs).flatMap((runs) => {
      const row = piecesOf(page.number, rowId++, runs);
      icons += row.icons;
      return row.pieces;
    });
    for (const piece of pieces)
      if (!piece.bullet && dotBefore(piece, page.marks)) piece.bullet = true;
    if (pieces.length === 0) {
      pages.push({ number: page.number, width: page.width, height: page.height, columns: 0 });
      continue;
    }
    const ordered = order(pieces);
    pages.push({
      number: page.number,
      width: page.width,
      height: page.height,
      columns: Math.max(...ordered.map((each) => each.columns)),
    });
    // Each piece's row, among the pieces of its column on that row.
    const rowKey = (each: (typeof ordered)[number]) =>
      `${each.piece.row}:${each.column}:${each.columns}`;
    const rowMembers = new Map<string, Piece[]>();
    for (const each of ordered) {
      const key = rowKey(each);
      rowMembers.set(key, [...(rowMembers.get(key) ?? []), each.piece]);
    }
    const pageLines: Line[] = [];
    for (const each of ordered) {
      const { piece } = each;
      const members = (rowMembers.get(rowKey(each)) ?? [piece]).sort((a, b) => a.x0 - b.x0);
      const parts = piece.runs;
      const line: Line = {
        id: 0,
        page: page.number,
        text: joinParts(parts),
        parts,
        x0: piece.x0,
        x1: piece.x1,
        top: piece.top,
        bottom: piece.bottom,
        baseline: piece.baseline,
        lastBaseline: piece.baseline,
        size: piece.size,
        bold: mostly(parts, "bold"),
        italic: mostly(parts, "italic"),
        font: dominantFont(parts),
        bullet: piece.bullet,
        row: piece.row,
        rowIndex: members.indexOf(piece),
        rowSize: members.length,
        column: each.column,
        columns: each.columns,
        columnLeft: each.left,
        columnRight: each.right,
        links: linksOver(piece, page.links),
        rule: ruleBy(piece, page.marks, each.right - each.left),
        rows: 1,
        icons: piece.icons,
        block: 0,
      };
      if (line.text !== "") pageLines.push(line);
    }
    // The gap above each line, from the last line above it in its column.
    for (const [index, line] of pageLines.entries()) {
      const above = pageLines
        .slice(0, index)
        .filter(
          (other) =>
            other.column === line.column &&
            other.columns === line.columns &&
            other.bottom <= line.top + 0.5,
        )
        .at(-1);
      if (above !== undefined) line.gapAbove = line.top - above.bottom;
    }
    // Join the rows of a paragraph or a bullet that wraps.
    const joined: Line[] = [];
    for (const line of pageLines) {
      const previous = joined.at(-1);
      if (previous !== undefined && wraps(previous, line)) {
        const join = joinRows(previous.text, line.text);
        if (join.hyphen) hyphenJoins++;
        previous.text = join.text;
        previous.parts = [...previous.parts, ...line.parts];
        previous.x1 = Math.max(previous.x1, line.x1);
        previous.bottom = line.bottom;
        previous.lastBaseline = line.baseline;
        previous.rows += line.rows;
        previous.links = [...new Set([...previous.links, ...line.links])];
        previous.size = dominantSize(previous.parts);
        previous.bold = mostly(previous.parts, "bold");
        previous.italic = mostly(previous.parts, "italic");
        previous.icons += line.icons;
        continue;
      }
      joined.push(line);
    }
    lines.push(...joined);
  }
  lines.forEach((line, index) => {
    line.id = index;
  });
  const marks = new Map(read.pages.map((page) => [page.number, page.marks]));
  return { lines, blocks: blocksOf(lines, marks), pages, links, bodySize, icons, hyphenJoins };
}

/**
 * A block ends at a gap wider than both of these: a share of an em of the larger line, and a
 * multiple of the gap its column usually leaves between two lines, so that a column set with loose
 * leading is not cut at every line.
 */
const BLOCK_GAP_EM = 0.6;
const BLOCK_GAP_USUAL = 1.3;
/** A block ends where the size changes by more than this share of the smaller, as at a heading. */
const BLOCK_SIZE_CHANGE = 0.15;

/** The key of a line's column on its page, which its blocks keep to. */
const columnKey = (line: Line) => `${line.page}:${line.column}:${line.columns}`;

/** The vertical gap from one line to the next, below it. */
const gapBetween = (line: Line, next: Line) => next.top - line.bottom;

/**
 * Whether `next` stands in the block `line` stands in, `line` being the line before it in reading
 * order: on its page and in its column, and on its row, or right below it with no gap wider than
 * the column's usual (`usualGap`), in about its size, and with no long rule between them (`marks`,
 * its page's), so that a heading over a rule stands apart from what follows.
 */
export function sameBlock(
  line: Line,
  next: Line,
  { usualGap = 0, marks = [] }: { usualGap?: number; marks?: readonly Mark[] } = {},
): boolean {
  if (columnKey(line) !== columnKey(next)) return false;
  if (line.row === next.row) return true;
  const smaller = Math.min(line.size, next.size);
  if (Math.abs(line.size - next.size) > BLOCK_SIZE_CHANGE * smaller) return false;
  const gap = gapBetween(line, next);
  if (gap < -0.5 * smaller) return false;
  if (gap > Math.max(BLOCK_GAP_EM * Math.max(line.size, next.size), BLOCK_GAP_USUAL * usualGap))
    return false;
  return !ruleBetween(line, next, marks);
}

/** Whether a long rule runs between two lines, one below the other, across them. */
function ruleBetween(line: Line, next: Line, marks: readonly Mark[]): boolean {
  const x0 = Math.min(line.x0, next.x0);
  const x1 = Math.max(line.x1, next.x1);
  const columnWidth = line.columnRight - line.columnLeft;
  return marks.some((mark) => {
    if (mark.kind !== "rule") return false;
    const middle = (mark.y0 + mark.y1) / 2;
    const long = mark.x1 - mark.x0 >= Math.max(120, 0.35 * columnWidth);
    return (
      long &&
      middle >= line.baseline &&
      middle <= next.top + 0.25 * next.size &&
      mark.x0 < x1 &&
      mark.x1 > x0
    );
  });
}

/** Lines in reading order, cut into blocks where `sameBlock` says, each line told its block. */
function blocksOf(lines: Line[], marks: ReadonlyMap<number, readonly Mark[]>): Block[] {
  // Each column's usual gap: the median of the gaps between its lines that follow one another
  // down the column.
  const gaps = new Map<string, number[]>();
  for (const [index, line] of lines.entries()) {
    const previous = lines[index - 1];
    if (previous === undefined || columnKey(previous) !== columnKey(line)) continue;
    if (previous.row === line.row) continue;
    const gap = gapBetween(previous, line);
    if (gap >= 0) gaps.set(columnKey(line), [...(gaps.get(columnKey(line)) ?? []), gap]);
  }
  const usual = new Map([...gaps].map(([key, values]) => [key, median(values)]));
  const blocks: Block[] = [];
  let previous: Line | undefined;
  for (const line of lines) {
    let block = blocks.at(-1);
    if (
      block === undefined ||
      previous === undefined ||
      !sameBlock(previous, line, {
        usualGap: usual.get(columnKey(line)),
        marks: marks.get(line.page),
      })
    ) {
      block = {
        id: blocks.length,
        page: line.page,
        column: line.column,
        columns: line.columns,
        lines: [],
        x0: line.x0,
        x1: line.x1,
        top: line.top,
        bottom: line.bottom,
      };
      blocks.push(block);
    }
    block.lines.push(line.id);
    block.x0 = Math.min(block.x0, line.x0);
    block.x1 = Math.max(block.x1, line.x1);
    block.top = Math.min(block.top, line.top);
    block.bottom = Math.max(block.bottom, line.bottom);
    line.block = block.id;
    previous = line;
  }
  return blocks;
}

/** The median of numbers, or 0 for none. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** The width of a line's first word, a character's share of its first run's width a character. */
function firstWordWidth(line: Line): number {
  const first = line.parts[0];
  if (first === undefined) return 0;
  const word = /^\S+/.exec(first.text)?.[0] ?? "";
  const each = first.text.length === 0 ? 0 : (first.x1 - first.x0) / first.text.length;
  return word.length * each;
}

/**
 * Whether `next` carries on the paragraph or bullet `line` ends: it stands right below it in its
 * column, alone on its row, in the same size, starts where the text of `line` starts, and `line`
 * is full, its row too short for `next`'s first word.
 */
export function wraps(line: Line, next: Line): boolean {
  if (next.bullet || line.page !== next.page) return false;
  if (line.column !== next.column || line.columns !== next.columns) return false;
  // Nothing stands right of the line on its row, as a table's cell may have on its left.
  if (line.rowIndex !== line.rowSize - 1 || next.rowSize !== 1) return false;
  if (Math.abs(line.size - next.size) > 0.6) return false;
  const pitch = next.baseline - line.lastBaseline;
  if (pitch < 0.9 * line.size || pitch > 1.5 * line.size) return false;
  const textStart = line.parts[0]?.x0 ?? line.x0;
  if (Math.abs(next.x0 - textStart) > 2.5) return false;
  const room = line.columnRight - line.x1;
  return room < firstWordWidth(next) + 0.4 * line.size;
}

/**
 * Two rows of a paragraph joined: with a space; or, where the first ends in a hyphen after a letter
 * and the second carries on in a small letter, as one word without the hyphen; or, where the second
 * starts otherwise, with the hyphen kept and no space. A hyphen is `-`, or the hyphen and the soft
 * hyphen a browser sets where it breaks a word, U+2010 and U+00AD.
 */
export function joinRows(first: string, second: string): { text: string; hyphen: boolean } {
  if (/\p{L}[-‐­]$/u.test(first)) {
    if (/^\p{Ll}/u.test(second)) return { text: `${first.slice(0, -1)}${second}`, hyphen: true };
    return { text: `${first.replace(/[‐­]$/u, "-")}${second}`, hyphen: false };
  }
  return { text: `${first} ${second}`, hyphen: false };
}
