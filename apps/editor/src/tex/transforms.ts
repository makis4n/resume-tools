/**
 * What xdvipdfmx's graphics state does to what a DVI sets, so that the page can draw it where the
 * PDF does (decision 00XX).
 *
 * xdvipdfmx makes the PDF from the same DVI the page is drawn from (decision 0003), and a few of
 * the specials it reads change where it sets what follows them: `pdf:btrans` and its `pdf:etrans`,
 * as pgf's dvipdfmx driver sets a TikZ node's text and graphicx's driver a rotated or scaled box;
 * `x:scale`, `x:rotate` and `x:bscale` in their level of the graphics state, which `x:gsave` and
 * `x:grestore`, or `pdf:bcontent` and `pdf:econtent`, open and close. Each transformation is taken
 * about the point it is written at, as xdvipdfmx takes it, and composed with the ones open around
 * it. `parseDvi` applies the result to every item of a page (`placeItems`), so that the page, its glyphs' boxes,
 * the reference's stream and the checks all see what the PDF shows (`tex/dvi.ts`).
 *
 * A `cm` a template writes itself, in a `pdf:code`, `pdf:literal` or `pdf:content`, moves what
 * the PDF sets after it too, but xdvipdfmx keeps no account of it, and the page does not follow it:
 * pgf writes one for a scope's `transform canvas`. So the state also keeps the PDF's own stack of
 * levels, which xdvipdfmx's levels and a template's `q` and `Q` push and pop alike, and marks the
 * level such a `cm` is written in, and every level opened inside it, as `other`: what is set there
 * is left where it is and stays locked. pgf's pairs of `-1 0 0 -1 0 0 cm`, which undo each other
 * around each node's text, and the identity move nothing. What it does not see: a form,
 * `pdf:bxobj` to `pdf:exobj`, whose content the PDF draws wherever `pdf:uxobj` puts it. A
 * `pdf:btrans` whose arguments it cannot read is a level that moves nothing here, kept as `other`.
 */

import type { PageItem } from "./dvi";

/**
 * The kinds of transformation an item can be set inside, by what its matrix does: a translation
 * alone (`pdf:btrans matrix 1 0 0 1 e f`, as a TikZ node's text has), a rotation, a scale on
 * either axis, any other matrix, or a level whose transformation is not read (`other`).
 */
export const TRANSFORM_KINDS = ["translation", "rotate", "scale", "matrix", "other"] as const;
export type TransformKind = (typeof TRANSFORM_KINDS)[number];

/**
 * An affine map in xdvipdfmx's user space, y up as the PDF has it, its offsets in DVI units:
 * `x' = a x + c y + e`, `y' = b x + d y + f`.
 */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** What an item is set inside: the kind, and the matrix's linear part where it is not the identity. */
export interface ItemTransform {
  kind: TransformKind;
  /** `a b c d` of the matrix, y up as the PDF has it; left out for a translation. */
  matrix?: readonly [number, number, number, number];
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * How close a matrix's entry is taken to be the value a kind has there: pgf writes its matrices to
 * five places, so the cosine and sine of a TikZ node's rotation are off by up to 5e-6 each, and the
 * sum of their squares by twice that.
 */
const EPSILON = 1e-4;

const near = (x: number, y: number) => Math.abs(x - y) < EPSILON;

/** `m` after `n`: what `n` maps a point to, mapped by `m`. */
export function compose(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

/**
 * A matrix `m` taken about the point `(x, y)`, as xdvipdfmx takes a `pdf:btrans` or an `x:`
 * transformation about the point it is written at: the point stays where it is, and then moves by
 * `m`'s offsets.
 */
export function about(m: Affine, x: number, y: number): Affine {
  return {
    ...m,
    e: m.e + (1 - m.a) * x - m.c * y,
    f: m.f + (1 - m.d) * y - m.b * x,
  };
}

/** The kind of transformation a matrix is, by its linear part. */
export function kindOf(m: Affine): Exclude<TransformKind, "other"> {
  if (near(m.a, 1) && near(m.b, 0) && near(m.c, 0) && near(m.d, 1)) return "translation";
  if (near(m.b, 0) && near(m.c, 0)) return "scale";
  if (near(m.a, m.d) && near(m.b, -m.c) && near(m.a * m.a + m.b * m.b, 1)) return "rotate";
  return "matrix";
}

/** A number as xdvipdfmx reads one, or NaN. */
function numberOf(token: string | undefined): number {
  return token !== undefined && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)
    ? Number(token)
    : Number.NaN;
}

/** The units a length of a `pdf:btrans` may be given in, as xdvipdfmx reads them. */
const LENGTH = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:(?:true)?(?:pt|in|cm|mm|bp|pc|dd|cc|sp|px))?$/;
const UNIT = /^(?:true)?(?:pt|in|cm|mm|bp|pc|dd|cc|sp|px)$/;

/**
 * The matrix a `pdf:btrans`'s arguments give, its offsets in big points, as xdvipdfmx reads them:
 * `matrix a b c d e f`, or `rotate` (degrees, anticlockwise), `scale`, `xscale` and `yscale`, which
 * it makes a matrix of, scaled and then rotated; `width`, `height`, `depth`, `bbox` and `clip`,
 * which move nothing; none, the identity. Undefined for anything else, or a matrix given with a
 * scale or a rotation.
 */
export function btransMatrix(args: string): Affine | undefined {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  let matrix: Affine | undefined;
  let rotate: number | undefined;
  let xscale: number | undefined;
  let yscale: number | undefined;
  let at = 0;
  const numbers = (n: number): number[] | undefined => {
    const values = tokens.slice(at, at + n).map(numberOf);
    at += n;
    return values.length === n && values.every(Number.isFinite) ? values : undefined;
  };
  while (at < tokens.length) {
    const key = tokens[at++];
    switch (key) {
      case "matrix": {
        const v = numbers(6);
        if (v === undefined) return undefined;
        const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = v;
        matrix = { a, b, c, d, e, f };
        break;
      }
      case "rotate":
      case "scale":
      case "xscale":
      case "yscale": {
        const [v] = numbers(1) ?? [];
        if (v === undefined) return undefined;
        if (key === "rotate") rotate = v;
        if (key === "scale" || key === "xscale") xscale = v;
        if (key === "scale" || key === "yscale") yscale = v;
        break;
      }
      case "width":
      case "height":
      case "depth": {
        const token = tokens[at++];
        if (token === undefined || !LENGTH.test(token)) return undefined;
        if (/\d\.?$/.test(token) && UNIT.test(tokens[at] ?? "")) at++;
        break;
      }
      case "bbox":
        if (numbers(4) === undefined) return undefined;
        break;
      case "clip":
        if (numbers(1) === undefined) return undefined;
        break;
      default:
        return undefined;
    }
  }
  const made = rotate !== undefined || xscale !== undefined || yscale !== undefined;
  if (matrix !== undefined) return made ? undefined : matrix;
  if (!made) return IDENTITY;
  const angle = ((rotate ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const sx = xscale ?? 1;
  const sy = yscale ?? 1;
  // Adding 0 makes a -0 of no rotation 0.
  return { a: sx * cos + 0, b: sx * sin + 0, c: -sy * sin + 0, d: sy * cos + 0, e: 0, f: 0 };
}

/** What every special that changes xdvipdfmx's graphics state starts with. */
const PREFIXED = /^\s*(?:pdf|x):/;

/** The specials that change xdvipdfmx's graphics state, by every name it takes for each. */
const BTRANS = /^\s*pdf:\s*(?:btrans|begintransform|begintrans|bt)(?!\w)/;
const ETRANS = /^\s*pdf:\s*(?:etrans|endtransform|endtrans|et)(?!\w)/;
const BCONTENT = /^\s*pdf:\s*bcontent(?!\w)/;
const ECONTENT = /^\s*pdf:\s*econtent(?!\w)/;
const GSAVE = /^\s*x:\s*gsave(?!\w)/;
const GRESTORE = /^\s*x:\s*grestore(?!\w)/;
const XSCALE = /^\s*x:\s*scale(?!\w)/;
const XROTATE = /^\s*x:\s*rotate(?!\w)/;
const BSCALE = /^\s*x:\s*bscale(?!\w)/;
const ESCALE = /^\s*x:\s*escale(?!\w)/;
/** The specials whose text goes into the PDF's content as it is, and their text. */
const LITERAL = /^\s*pdf:\s*(code|literal|content)(?!\w)([\s\S]*)$/;

/**
 * Whether a `cm`'s operands leave what is set after it where xdvipdfmx puts it: the identity, or
 * the half turn pgf writes twice around each node's text, which undo each other.
 */
function movesNothing(operands: readonly number[]): boolean {
  const [a, b, c, d, e, f] = operands;
  if (
    operands.length !== 6 ||
    [a, b, c, d, e, f].some((x) => x === undefined || !Number.isFinite(x))
  )
    return false;
  const m = { a, b, c, d, e, f } as Affine;
  return (
    near(m.b, 0) &&
    near(m.c, 0) &&
    near(m.e, 0) &&
    near(m.f, 0) &&
    ((near(m.a, 1) && near(m.d, 1)) || (near(m.a, -1) && near(m.d, -1)))
  );
}

/**
 * What a template's own content does to the PDF's stack of levels, operator by operator: `q`
 * pushes one, `Q` pops one, and a `cm` that moves anything (`movesNothing`), or whose operands are
 * not read, marks the level it is in. Strings, hex strings and dictionaries are passed over, so
 * that a `q` inside one is not taken for the operator.
 */
function literalOperators(content: string): ("q" | "Q" | "moves")[] {
  const out: ("q" | "Q" | "moves")[] = [];
  const tokens = content
    .replace(/\((?:\\[\s\S]|[^\\)])*\)|<<|>>|<[^<>]*>/g, " ")
    .split(/[\s[\]{}/]+/)
    .filter(Boolean);
  let operands: number[] = [];
  for (const token of tokens) {
    const value = numberOf(token);
    if (Number.isFinite(value)) {
      operands.push(value);
      continue;
    }
    if (token === "q" || token === "Q") out.push(token);
    else if (token === "cm" && !movesNothing(operands.slice(-6))) out.push("moves");
    operands = [];
  }
  return out;
}

/**
 * A level of the graphics state: the transformation in effect, whether anything in it or around
 * it transforms (a `pdf:btrans` opened it, or an `x:` transformation was taken in it), and whether
 * a transformation in it or around it could not be read.
 */
interface Level {
  m: Affine;
  transforming: boolean;
  unread: boolean;
}

/**
 * xdvipdfmx's graphics state along one page of a DVI, as its specials change it: `special` reads
 * each special where it is set, and `transform` says what an item set at a point now is inside.
 * `unitsPerBp` is how many DVI units a big point is, which a matrix's offsets are given in.
 */
export class GraphicsState {
  private levels: Level[] = [{ m: IDENTITY, transforming: false, unread: false }];
  /** The scales `x:bscale` took, which `x:escale` undoes, as xdvipdfmx keeps them, in no level. */
  private scales: { x: number; y: number }[] = [];
  /**
   * The PDF's own stack of levels, which xdvipdfmx's levels and a template's `q` and `Q` push and
   * pop alike: for each, whether a template's `cm` moved what is set in it, which xdvipdfmx keeps
   * no account of.
   */
  private written: boolean[] = [false];

  constructor(private readonly unitsPerBp: number) {}

  /** Whether a template's `cm` moves what is set now. */
  private get moved(): boolean {
    return this.written[this.written.length - 1] === true;
  }

  private open() {
    this.written.push(this.moved);
  }

  private close() {
    if (this.written.length > 1) this.written.pop();
  }

  /** A template's own content, as the PDF's stack of levels takes it (`literalOperators`). */
  private literal(content: string) {
    for (const operator of literalOperators(content))
      if (operator === "q") this.open();
      else if (operator === "Q") this.close();
      else this.written[this.written.length - 1] = true;
  }

  private get top(): Level {
    return this.levels[this.levels.length - 1] as Level;
  }

  /** Take `m`, its offsets in DVI units, about the DVI point `(h, v)` in the level now open. */
  private take(m: Affine, h: number, v: number) {
    const top = this.top;
    top.m = compose(top.m, about(m, h, -v));
    top.transforming = true;
  }

  /** Read a special set at the DVI point `(h, v)`. */
  special(text: string, h: number, v: number) {
    // Most of a page's specials are the editor's markers and colours, which change nothing here.
    if (!PREFIXED.test(text)) return;
    const literal = LITERAL.exec(text);
    if (literal !== null) {
      // xdvipdfmx sets a `pdf:content` inside a level of its own, which it closes after.
      const own = literal[1] === "content";
      if (own) this.open();
      this.literal(literal[2] ?? "");
      if (own) this.close();
    } else if (BTRANS.test(text)) {
      const top = this.top;
      const m = btransMatrix(text.replace(BTRANS, ""));
      const level: Level = { m: top.m, transforming: true, unread: top.unread || m === undefined };
      this.levels.push(level);
      this.open();
      if (m !== undefined)
        level.m = compose(
          top.m,
          about({ ...m, e: m.e * this.unitsPerBp, f: m.f * this.unitsPerBp }, h, -v),
        );
    } else if (BCONTENT.test(text) || GSAVE.test(text)) {
      this.levels.push({ ...this.top });
      this.open();
    } else if (ETRANS.test(text) || ECONTENT.test(text) || GRESTORE.test(text)) {
      // xdvipdfmx closes no level it did not open, and writes no `Q` for one.
      if (this.levels.length > 1) {
        this.levels.pop();
        this.close();
      }
    } else if (XSCALE.test(text)) {
      const [x, y] = text.replace(XSCALE, "").trim().split(/\s+/).map(numberOf);
      if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y))
        this.take({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 }, h, v);
      else this.unread();
    } else if (XROTATE.test(text)) {
      const degrees = numberOf(text.replace(XROTATE, "").trim().split(/\s+/)[0]);
      if (Number.isFinite(degrees)) {
        const angle = (degrees * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        this.take({ a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }, h, v);
      } else this.unread();
    } else if (BSCALE.test(text)) {
      const [x, y] = text.replace(BSCALE, "").trim().split(/\s+/).map(numberOf);
      if (x !== undefined && y !== undefined && Math.abs(x) > 1e-7 && Math.abs(y) > 1e-7) {
        this.scales.push({ x: 1 / x, y: 1 / y });
        this.take({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 }, h, v);
      } else this.unread();
    } else if (ESCALE.test(text)) {
      const scale = this.scales.pop();
      if (scale !== undefined) this.take({ a: scale.x, b: 0, c: 0, d: scale.y, e: 0, f: 0 }, h, v);
    }
  }

  /** A transformation this level holds that was not read: it moves nothing here. */
  private unread() {
    this.top.transforming = true;
    this.top.unread = true;
  }

  /** The transformation in effect, or undefined where nothing transforms what is set. */
  get current(): Affine | undefined {
    return this.top.transforming ? this.top.m : undefined;
  }

  /**
   * What an item set now is inside, or undefined where nothing transforms what is set: `other`
   * where a transformation is not read, or a template's `cm` moves it.
   */
  transform(): ItemTransform | undefined {
    const top = this.top;
    if (!top.transforming && !this.moved) return undefined;
    const kind = top.unread || this.moved ? "other" : kindOf(top.m);
    const { a, b, c, d } = top.m;
    const linear = kindOf(top.m) === "translation";
    return linear ? { kind } : { kind, matrix: [a, b, c, d] };
  }
}

/**
 * Put a page's items where xdvipdfmx sets them, in place: each special read where it is set, in
 * order, and each item set inside a transformation moved by it (`placed`), a native run's glyphs'
 * offsets turned with it (`turned`), and marked with what it is set inside (`transform`); one a
 * template's `cm` moves is marked `other` and left where the transformations read put it.
 * `unitsPerBp` is how many DVI units a big point is. The state starts afresh on each page.
 */
export function placeItems(items: PageItem[], unitsPerBp: number): void {
  const state = new GraphicsState(unitsPerBp);
  for (const item of items) {
    const m = state.current;
    const transform = state.transform();
    // A special changes the state from where it is set, which is where TeX set it.
    const { h, v } = item;
    if (transform !== undefined) item.transform = transform;
    if (m !== undefined && transform !== undefined) {
      const at = placed(m, item.h, item.v);
      item.h = at.h;
      item.v = at.v;
      const { matrix } = transform;
      if (item.kind === "native" && matrix !== undefined)
        item.glyphs = item.glyphs.map((glyph) => ({
          ...glyph,
          ...turned(matrix, glyph.x, glyph.y),
        }));
    }
    if (item.kind === "special") state.special(item.text, h, v);
  }
}

/** Where `m` takes the DVI point `(h, v)`, as a DVI point. */
export function placed(m: Affine, h: number, v: number): { h: number; v: number } {
  return { h: m.a * h - m.c * v + m.e, v: -(m.b * h - m.d * v + m.f) };
}

/** Where a linear part `matrix` takes an offset `(x, y)` of the DVI, as an offset of the DVI. */
export function turned(
  matrix: readonly [number, number, number, number],
  x: number,
  y: number,
): { x: number; y: number } {
  const [a, b, c, d] = matrix;
  return { x: a * x - c * y, y: -(b * x - d * y) };
}
