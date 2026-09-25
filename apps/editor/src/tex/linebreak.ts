/**
 * TeX's line breaker, for the editing overlay.
 *
 * The overlay is set in the page's own font, but the browser breaks lines by its own
 * rules and TeX by Knuth and Plass's, so a multi-line field drifts by whole words
 * wherever the two disagree. This module ports tex.web §813–890 (the `line_break`
 * procedure with its active list, fitness classes, demerits and three passes) over a
 * list of boxes, glue, kerns, penalties and discretionaries, so the overlay can break
 * exactly where TeX will. `paragraphNodes` builds that list from a field's text with
 * the font's TFM metrics, ligatures, kerns and space factors, the way TeX's main loop
 * does, or with a native font's advances, as XeTeX sets one (`Face`), and
 * `richParagraphNodes` from rich text's runs, each in its own font. Hyphenation is a
 * hook, not built in.
 *
 * All dimensions are in scaled points, integers, as in TeX.
 */

import { INVISIBLE } from "./fields";
import { runBreaks } from "./runs";
import type { LigKernResult, ScaledMetrics, Tfm } from "./tfm";
import { applyLigKern } from "./tfm";

export interface Glue {
  width: number;
  stretch: number;
  shrink: number;
  /** 0 for finite stretch, 1..3 for fil, fill, filll. */
  stretchOrder: number;
  shrinkOrder: number;
}

export const ZERO_GLUE: Glue = { width: 0, stretch: 0, shrink: 0, stretchOrder: 0, shrinkOrder: 0 };
/** `0pt plus 1fil`: LaTeX's `\@flushglue`, used for `\raggedright` and `\parfillskip`. */
export const FIL_GLUE: Glue = {
  width: 0,
  stretch: 65536,
  shrink: 0,
  stretchOrder: 1,
  shrinkOrder: 0,
};

export type Node =
  | { kind: "box"; width: number; offset: number; end: number; code?: number }
  | (Glue & { kind: "glue"; offset: number; end: number })
  | { kind: "kern"; width: number }
  | { kind: "penalty"; penalty: number }
  | {
      kind: "disc";
      /** Width of what goes at the end of the line when broken here (a hyphen, or nothing). */
      preWidth: number;
      /** True when inserted by hyphenation: only the second pass may break here. */
      hyphenation: boolean;
      offset: number;
    }
  /**
   * A `\special`, which sets nothing, as hyperref's at each end of a link: TeX may break at glue
   * after it, as after a letter, and never at a kern right before it, which stays on its line.
   */
  | { kind: "whatsit" };

export interface LineSpec {
  indent: number;
  width: number;
}

export interface BreakParams {
  /** Line widths as a `\parshape`: line n uses entry n, the last entry repeats. */
  lines: LineSpec[];
  pretolerance: number;
  tolerance: number;
  emergencyStretch: number;
  linePenalty: number;
  adjDemerits: number;
  doubleHyphenDemerits: number;
  finalHyphenDemerits: number;
  leftSkip: Glue;
  rightSkip: Glue;
  parFillSkip: Glue;
  /**
   * `\spaceskip` and `\xspaceskip`: when not zero, the glue between words, and after a sentence,
   * in place of the font's. `breakLines` never reads them; `paragraphNodes` builds the list with
   * them (`TextOptions`), as TeX does when it appends a space, so they travel with the paragraph.
   */
  spaceSkip: Glue;
  xspaceSkip: Glue;
}

/** Plain TeX and LaTeX defaults; `\raggedright` sets rightskip and parfillskip to fil. */
export const LATEX_PARAMS: Omit<BreakParams, "lines"> = {
  pretolerance: 100,
  tolerance: 200,
  emergencyStretch: 0,
  linePenalty: 10,
  adjDemerits: 10000,
  doubleHyphenDemerits: 10000,
  finalHyphenDemerits: 5000,
  leftSkip: ZERO_GLUE,
  rightSkip: ZERO_GLUE,
  parFillSkip: FIL_GLUE,
  spaceSkip: ZERO_GLUE,
  xspaceSkip: ZERO_GLUE,
};

export interface Line {
  /** Index of the first node on the line. */
  from: number;
  /** Index of the node the line breaks at, or `nodes.length` for the paragraph's end. */
  breakAt: number;
  /** Natural width of the line's material, in scaled points. */
  natural: number;
  /** The width it was set to. */
  width: number;
  badness: number;
  fitness: number;
  hyphenated: boolean;
}

const INF_BAD = 10000;
const INF_PENALTY = 10000;
const EJECT_PENALTY = -10000;
const AWFUL_BAD = 0x3fffffff;
const MAX_LINE = 0x3fffffff;

/** tex.web §108: how bad it is to stretch or shrink by `t` when `s` is available. */
export function badness(t: number, s: number): number {
  if (t === 0) return 0;
  if (s <= 0) return INF_BAD;
  let r: number;
  if (t <= 7230584) r = Math.floor((t * 297) / s);
  else if (s >= 1663497) r = Math.floor(t / Math.floor(s / 297));
  else r = t;
  if (r > 1290) return INF_BAD;
  return Math.floor((r * r * r + 0o400000) / 0o1000000);
}

const discardable = (n: Node) => n.kind === "glue" || n.kind === "kern" || n.kind === "penalty";

interface Active {
  line: number;
  fitness: number;
  /** Node index of the break this node stands for; -1 for the paragraph start. */
  breakAt: number;
  /** First node of the line that follows the break, after pruning discardables. */
  from: number;
  hyphenated: boolean;
  demerits: number;
  prev: Active | null;
  next: Active | null;
}

/** Break a paragraph's node list into lines the way TeX would. */
export function breakLines(nodes: Node[], params: BreakParams): Line[] {
  const n = nodes.length;
  // Cumulative sums, so the width of any span is a difference: the stretch by order of infinity.
  const sumW = new Float64Array(n + 1);
  const sumS = [0, 1, 2, 3].map(() => new Float64Array(n + 1));
  const [sumS0, sumS1, sumS2, sumS3] = sumS as [
    Float64Array,
    Float64Array,
    Float64Array,
    Float64Array,
  ];
  const sumSh = new Float64Array(n + 1);
  const sumShOrder = new Uint8Array(n + 1);
  for (let i = 0; i < n; i++) {
    const node = nodes[i] as Node;
    const w =
      node.kind === "disc" || node.kind === "penalty" || node.kind === "whatsit" ? 0 : node.width;
    sumW[i + 1] = (sumW[i] as number) + w;
    for (let o = 0; o < 4; o++) {
      const s = sumS[o] as Float64Array;
      s[i + 1] =
        (s[i] as number) + (node.kind === "glue" && node.stretchOrder === o ? node.stretch : 0);
    }
    sumSh[i + 1] = (sumSh[i] as number) + (node.kind === "glue" ? node.shrink : 0);
    sumShOrder[i + 1] = Math.max(
      sumShOrder[i] as number,
      node.kind === "glue" && node.shrink > 0 ? node.shrinkOrder : 0,
    );
  }
  const nextBox = new Int32Array(n + 1);
  nextBox[n] = n;
  for (let i = n - 1; i >= 0; i--)
    nextBox[i] = discardable(nodes[i] as Node) ? (nextBox[i + 1] as number) : i;

  const specs = params.lines.length ? params.lines : [{ indent: 0, width: 0 }];
  const lastSpecialLine = specs.length - 1;
  const secondWidth = (specs[specs.length - 1] as LineSpec).width;
  const easyLine = lastSpecialLine; // looseness is 0
  const lineWidthOf = (l: number) =>
    l > lastSpecialLine ? secondWidth : (specs[l - 1] as LineSpec).width;
  // The width of each line up to the last special one, by line number, for the breaker's loop.
  const specialWidths = Float64Array.from({ length: lastSpecialLine + 1 }, (_, l) =>
    l === 0 ? 0 : lineWidthOf(l),
  );
  const { adjDemerits, linePenalty } = params;
  const background = {
    width: params.leftSkip.width + params.rightSkip.width,
    stretch: [0, 0, 0, 0],
    shrink: params.leftSkip.shrink + params.rightSkip.shrink,
  };
  for (const g of [params.leftSkip, params.rightSkip])
    background.stretch[g.stretchOrder] = (background.stretch[g.stretchOrder] ?? 0) + g.stretch;

  const passes: { threshold: number; second: boolean; final: boolean; emergency: number }[] = [];
  if (params.pretolerance >= 0)
    passes.push({ threshold: params.pretolerance, second: false, final: false, emergency: 0 });
  passes.push({
    threshold: params.tolerance,
    second: true,
    final: params.emergencyStretch <= 0,
    emergency: 0,
  });
  if (params.emergencyStretch > 0)
    passes.push({
      threshold: params.tolerance,
      second: true,
      final: true,
      emergency: params.emergencyStretch,
    });

  for (const pass of passes) {
    const head: Active = {
      line: 0,
      fitness: 0,
      breakAt: -2,
      from: 0,
      hyphenated: false,
      demerits: 0,
      prev: null,
      next: null,
    };
    const last: Active = { ...head, line: MAX_LINE };
    const start: Active = {
      line: 1,
      fitness: 2,
      breakAt: -1,
      from: nextBox[0] as number,
      hyphenated: false,
      demerits: 0,
      prev: null,
      next: last,
    };
    head.next = start;
    let best: Active | null = null;

    const tryBreak = (cur: number, pi: number, hyphenatedBreak: boolean) => {
      if (Math.abs(pi) >= INF_PENALTY) {
        if (pi > 0) return;
        pi = EJECT_PENALTY;
      }
      const atEnd = cur === n;
      const pre =
        !atEnd && (nodes[cur] as Node).kind === "disc"
          ? (nodes[cur] as { preWidth: number }).preWidth
          : 0;
      // The stretch every line ending here has besides its own glue's, by order of infinity: the
      // skips', \parfillskip's at the paragraph's end, and the emergency stretch. The loop below
      // runs for every active break at every breakpoint, so it allocates nothing.
      const extra = (order: number) =>
        (background.stretch[order] ?? 0) +
        (atEnd && params.parFillSkip.stretchOrder === order ? params.parFillSkip.stretch : 0);
      const extra0 = extra(0) + pass.emergency;
      const extra1 = extra(1);
      const extra2 = extra(2);
      const extra3 = extra(3);
      const naturalExtra = pre + background.width;
      const shrinkExtra = background.shrink + (atEnd ? params.parFillSkip.shrink : 0);
      const { threshold, final } = pass;
      let prevR = head;
      let r = head.next as Active;
      let oldL = 0;
      const minimal = [AWFUL_BAD, AWFUL_BAD, AWFUL_BAD, AWFUL_BAD];
      const bestPlace: (Active | null)[] = [null, null, null, null];
      const bestLine = [0, 0, 0, 0];
      let minimum = AWFUL_BAD;
      for (;;) {
        const l = r.line;
        if (l > oldL) {
          if (minimum < AWFUL_BAD && (oldL !== easyLine || r === last)) {
            for (let fit = 0; fit < 4; fit++) {
              if ((minimal[fit] as number) <= minimum + adjDemerits) {
                const q: Active = {
                  line: (bestLine[fit] as number) + 1,
                  fitness: fit,
                  breakAt: cur,
                  from: nextBox[Math.min(n, cur + 1)] as number,
                  hyphenated: hyphenatedBreak,
                  demerits: minimal[fit] as number,
                  prev: bestPlace[fit] ?? null,
                  next: r,
                };
                prevR.next = q;
                prevR = q;
              }
            }
            minimum = AWFUL_BAD;
            minimal.fill(AWFUL_BAD);
          }
          if (r === last) return;
          if (l > easyLine) oldL = MAX_LINE - 1;
          else oldL = l;
        }
        const lineWidth = l > easyLine ? secondWidth : (specialWidths[l] as number);
        // The line from r's break to this one.
        const from = r.from;
        const natural = (sumW[cur] as number) - (sumW[from] as number) + naturalExtra;
        const shrink = (sumSh[cur] as number) - (sumSh[from] as number) + shrinkExtra;
        const shortfall = lineWidth - natural;
        let b: number;
        let fit: number;
        if (shortfall > 0) {
          if (
            (sumS1[cur] as number) - (sumS1[from] as number) + extra1 !== 0 ||
            (sumS2[cur] as number) - (sumS2[from] as number) + extra2 !== 0 ||
            (sumS3[cur] as number) - (sumS3[from] as number) + extra3 !== 0
          ) {
            b = 0;
            fit = 2;
          } else {
            b = badness(shortfall, (sumS0[cur] as number) - (sumS0[from] as number) + extra0);
            fit = b > 12 ? (b > 99 ? 0 : 1) : 2;
          }
        } else if (-shortfall > shrink) {
          b = INF_BAD + 1;
          fit = 3;
        } else {
          b = badness(-shortfall, shrink);
          fit = b > 12 ? 3 : 2;
        }
        let artificial = false;
        let stays: boolean;
        if (b > INF_BAD || pi === EJECT_PENALTY) {
          if (final && minimum === AWFUL_BAD && r.next === last && prevR === head) {
            artificial = true;
          } else if (b > threshold) {
            // Deactivate r: later breaks can only make this line worse.
            prevR.next = r.next;
            r = r.next as Active;
            continue;
          }
          stays = false;
        } else {
          prevR = r;
          if (b > threshold) {
            r = r.next as Active;
            continue;
          }
          stays = true;
        }
        let d: number;
        if (artificial) d = 0;
        else {
          d = linePenalty + b;
          d = Math.abs(d) >= 10000 ? 100000000 : d * d;
          if (pi !== 0) {
            if (pi > 0) d += pi * pi;
            else if (pi > EJECT_PENALTY) d -= pi * pi;
          }
          if (hyphenatedBreak && r.hyphenated)
            d += atEnd ? params.finalHyphenDemerits : params.doubleHyphenDemerits;
          if (Math.abs(fit - r.fitness) > 1) d += adjDemerits;
        }
        d += r.demerits;
        if (d <= (minimal[fit] as number)) {
          minimal[fit] = d;
          bestPlace[fit] = r;
          bestLine[fit] = l;
          if (d < minimum) minimum = d;
        }
        if (stays) r = r.next as Active;
        else {
          prevR.next = r.next;
          r = r.next as Active;
        }
      }
    };

    for (let cur = 0; cur < n; cur++) {
      const node = nodes[cur] as Node;
      switch (node.kind) {
        case "glue": {
          const before = nodes[cur - 1];
          // tex.web §866: glue is a place to break after a letter, a discretionary or a special.
          if (before?.kind === "box" || before?.kind === "disc" || before?.kind === "whatsit")
            tryBreak(cur, 0, false);
          break;
        }
        case "penalty":
          tryBreak(cur, node.penalty, false);
          break;
        case "kern":
          // tex.web §866's kern_break: a kern followed by glue is a place to break, as after an
          // ellipsis or an italic correction, and the glue after it is not, since a kern comes
          // before it. Font kerns stand between two letters, so every kern here is explicit.
          if (nodes[cur + 1]?.kind === "glue") tryBreak(cur, 0, false);
          break;
        case "disc":
          if (!node.hyphenation || pass.second)
            tryBreak(cur, node.preWidth > 0 ? HYPHEN_PENALTY : EX_HYPHEN_PENALTY, true);
          break;
        default:
          break;
      }
    }
    // tex.web §873: the final break is tried as a hyphenated one, so a last-but-one line
    // that ends in a hyphen is charged \finalhyphendemerits.
    tryBreak(n, EJECT_PENALTY, true);

    let fewest = AWFUL_BAD;
    for (let r: Active | null = head.next; r && r !== last; r = r.next) {
      if (r.demerits < fewest) {
        fewest = r.demerits;
        best = r;
      }
    }
    if (best) {
      // Follow the chain of breaks back to the start, then describe each line.
      const chain: Active[] = [];
      for (let a: Active | null = best; a && a.breakAt >= 0; a = a.prev) chain.unshift(a);
      const lines: Line[] = [];
      let prev: Active = start;
      chain.forEach((a, i) => {
        const cur = a.breakAt;
        const atEnd = cur === n;
        const pre =
          !atEnd && (nodes[cur] as Node).kind === "disc"
            ? (nodes[cur] as { preWidth: number }).preWidth
            : 0;
        const natural = (sumW[cur] as number) - (sumW[prev.from] as number) + pre;
        lines.push({
          from: prev.from,
          breakAt: cur,
          natural,
          width: lineWidthOf(i + 1),
          badness: 0,
          fitness: a.fitness,
          hyphenated: a.hyphenated,
        });
        prev = a;
      });
      return lines;
    }
  }
  throw new Error("line breaking found no solution");
}

const HYPHEN_PENALTY = 50;
const EX_HYPHEN_PENALTY = 50;

/**
 * A font's interword glue, in scaled points: the space, its stretch and shrink, and the extra
 * space after a sentence, `\fontdimen2`, `3`, `4` and `7`.
 */
export type FontSpace = Pick<ScaledMetrics, "space" | "stretch" | "shrink" | "extraSpace">;

/** A TeX font's ligature and kern program, and its kerns scaled to the size it is used at. */
export interface LigKernProgram {
  tfm: Tfm;
  kerns: Int32Array;
}

/**
 * A font as the paragraph builder needs it, at the size a field is set in: a TeX font, whose
 * codes are its characters and which has a ligature and kern program, or a native font, whose
 * codes are its glyphs and which has neither (decision 0014).
 */
export interface Face {
  /** The font's code for a character of the text, or undefined if it has none. */
  codeFor: (ch: string) => number | undefined;
  /** The width of a code's glyph, in scaled points. */
  widthOf: (code: number) => number;
  /**
   * The italic correction TeX's `\/` appends after a code's glyph, in scaled points, which
   * LaTeX's `\textit` and `\textbf` set at their ends (`FaceRun`); 0 for none.
   */
  italicOf: (code: number) => number;
  /**
   * The font's slant, its `\fontdimen1`, which LaTeX's `\maybe@ic` reads to decide whether a
   * run ends in an italic correction: above 0 for a slanted font.
   */
  slant: number;
  /** The font's interword glue, which a space is built from (`spaceGlue`). */
  spaceGlue: () => FontSpace;
  /** The code of the font's `\hyphenchar`, after which TeX may break a word; 45 in a text font. */
  hyphenChar: number;
  /**
   * A TeX font's ligature and kern program, which `paragraphNodes` runs over each run of the
   * face's characters; a face without one sets each character as a box of its own, with no kern.
   */
  ligKern?: LigKernProgram;
  /**
   * The width, in scaled points, of a character this font has no code for but another font of
   * the field sets, as LaTeX sets `€`, `×` or `°` from TS1 in a T1 paragraph; undefined when none
   * does. Such a character is a box of its own, which takes part in no ligature or kern, since
   * TeX's ligature and kern program runs within one font.
   */
  fallbackWidth?: (ch: string) => number | undefined;
  /**
   * The italic correction of such a character, from the font `fallbackWidth` measures it in,
   * which TeX's `\/` sets after it, as it takes a correction from the font of the character before
   * it whatever font that is (tex.web §1113); undefined, or 0, when that font gives it none.
   */
  fallbackItalic?: (ch: string) => number | undefined;
}

/**
 * A TeX font's face from its TFM scaled to the size: its codes, its widths and italic
 * corrections, its slant, its interword glue and its ligature and kern program. `codeFor` says
 * which code a character is.
 */
export function tfmFace(
  tfm: Tfm,
  metrics: ScaledMetrics,
  codeFor: (ch: string) => number | undefined,
  hyphenChar = 45,
): Face {
  return {
    codeFor,
    widthOf: (code) => metrics.widths[code] ?? 0,
    italicOf: (code) => metrics.italics[code] ?? 0,
    slant: tfm.params[1] ?? 0,
    spaceGlue: () => metrics,
    hyphenChar,
    ligKern: { tfm, kerns: metrics.kerns },
  };
}

export interface TextOptions {
  /** `\sfcode` of a character; defaults to LaTeX's. */
  sfCode?: (ch: string) => number;
  /** Positions inside a word where TeX would hyphenate it. */
  hyphenate?: (word: string) => number[];
  /** Text offset the paragraph starts at, for fields that begin mid-paragraph. */
  offset?: number;
  /** `\spaceskip`, which sets the glue between words in place of the font's when not zero. */
  spaceSkip?: Glue;
  /** `\xspaceskip`, which sets the glue after a sentence in place of the font's when not zero. */
  xspaceSkip?: Glue;
}

/** LaTeX's space factor codes: uppercase 999, sentence-ending punctuation raised, some zero. */
export function latexSfCode(ch: string): number {
  if (ch >= "A" && ch <= "Z") return 999;
  switch (ch) {
    case ".":
    case "?":
    case "!":
      return 3000;
    case ":":
      return 2000;
    case ";":
      return 1500;
    case ",":
      return 1250;
    case ")":
    case "'":
    case "]":
    case "’":
    case "”":
      return 0;
    default:
      return 1000;
  }
}

/** tex.web §1034: how a character changes the space factor. */
function nextSpaceFactor(current: number, sf: number): number {
  if (sf === 1000) return 1000;
  if (sf < 1000) return sf > 0 ? sf : current;
  return current < 1000 ? 1000 : sf;
}

/** tex.web §107: `x * n / d`, truncated towards zero, as TeX scales glue by a space factor. */
function xnOverD(x: number, n: number, d: number): number {
  return x < 0 ? -Math.floor((-x * n) / d) : Math.floor((x * n) / d);
}

/** Whether glue is TeX's `zero_glue`, which a skip set to nothing becomes (tex.web §1229). */
const isZero = (glue: Glue) => glue.width === 0 && glue.stretch === 0 && glue.shrink === 0;

/**
 * tex.web §1041–1044: the interword glue for a space factor. `\xspaceskip`, when not zero, is the
 * glue after a sentence as it stands; otherwise the space is `\spaceskip`, when not zero, or the
 * font's, widened after a sentence and its stretch and shrink scaled by the space factor.
 * ragged2e's `\RaggedRight` sets `\spaceskip` to the font's space with neither, so its spaces are
 * rigid and its `\rightskip` takes a line's whole shortfall.
 */
export function spaceGlue(
  metrics: FontSpace,
  spaceFactor: number,
  skips: Pick<TextOptions, "spaceSkip" | "xspaceSkip"> = {},
): Glue {
  const { spaceSkip = ZERO_GLUE, xspaceSkip = ZERO_GLUE } = skips;
  if (spaceFactor >= 2000 && !isZero(xspaceSkip)) return { ...xspaceSkip };
  const space = isZero(spaceSkip)
    ? {
        width: metrics.space,
        stretch: metrics.stretch,
        shrink: metrics.shrink,
        stretchOrder: 0,
        shrinkOrder: 0,
      }
    : { ...spaceSkip };
  if (spaceFactor === 1000) return space;
  return {
    ...space,
    width: space.width + (spaceFactor >= 2000 ? metrics.extraSpace : 0),
    stretch: xnOverD(space.stretch, spaceFactor, 1000),
    shrink: xnOverD(space.shrink, 1000, spaceFactor),
  };
}

/**
 * The characters the generator writes as `~` (decision 0007), the no-break spaces: LaTeX's
 * `\nobreakspace`, `\leavevmode\nobreak\ `, which is a penalty of 10000 and then a control
 * space, the interword glue at a space factor of 1000 whatever the space factor is.
 */
const NO_BREAK_SPACE = /^[\u00a0\u202f\u2007]$/u;

/**
 * The characters the generator writes as a space: the line breaks and every other space
 * separator. A run of them is one space token to TeX, and so one glue.
 */
const SPACE = /^[\t\n\r\u2028\u2029\p{Zs}]$/u;

/**
 * What the generator leaves out of the LaTeX, and so TeX never sees: the invisible characters,
 * U+FEFF and the zero-width space among them, other than the line breaks, which are spaces. They
 * cost nothing and never break, and a word runs on through them, its ligatures and kerns too.
 */
const LEFT_OUT = new RegExp(`^(?:${INVISIBLE.source})$`, "u");

/** What a character of a field's text is to TeX once the generator has written it. */
function kindOf(ch: string): "space" | "tie" | "none" | "char" {
  if (NO_BREAK_SPACE.test(ch)) return "tie";
  if (SPACE.test(ch)) return "space";
  if (LEFT_OUT.test(ch)) return "none";
  return "char";
}

/**
 * LaTeX's `\textellipsis`, which it sets `…` with when the font has no glyph for it, as neither
 * OT1 nor T1 has: three periods, each followed by a kern of `\fontdimen3`, the font's interword
 * stretch. A kern ends a ligature and kern run, and does not change the space factor, so a space
 * after `…` is a space after a period.
 */
const ELLIPSIS = "\u2026";

/**
 * A run of a paragraph's text in one font, as the generator writes rich text (decision 0007): each
 * run in its own `\textbf`, `\textit` or `\href`, so that a font change or a special stands
 * between two runs, and TeX's ligature and kern program never runs across them.
 */
export interface FaceRun {
  /** The run's text. The runs' texts joined are the paragraph's, which offsets count through. */
  text: string;
  /** The font TeX sets the run in. */
  face: Face;
  /**
   * Whether TeX appends an italic correction where the run ends, as LaTeX's `\textit` and
   * `\textbf` do with `\/` at their ends and `\textbf` at its start; `rich.ts` decides it from the
   * runs' marks (`breakRuns`). It is a kern of the italic correction of the last character set,
   * after that character and before a space or no-break space after it, which LaTeX takes off and
   * puts back around the kern (`\sw@slant`). It is the correction of that character's own font,
   * a companion's such as TS1's for a `°` (`Face.fallbackItalic`); and like `\/`, it sets nothing after
   * anything but a character, such as the kern that ends an ellipsis or a hyphen's discretionary.
   */
  italicCorrection?: boolean;
  /**
   * Whether the run is a link, set inside `\href`, whose specials hyperref sets at its start and
   * end (`whatsit`). The run's closing italic correction comes before its closing special, so that
   * a break at the space after the link keeps the correction on its line, where a break at the
   * kern would drop it (the reviewers' italic links, a line 0.69 pt short).
   */
  link?: boolean;
}

/**
 * Build the node list for a paragraph of text as the generator writes it and TeX sets it: the
 * one-run case of `richParagraphNodes`.
 */
export function paragraphNodes(text: string, face: Face, options: TextOptions = {}): Node[] {
  return richParagraphNodes([{ text, face }], options);
}

/**
 * Build the node list for a paragraph of runs as the generator writes them and TeX sets them:
 * characters become boxes after their run's font's ligature and kern program, a run of spaces
 * becomes one glue sized by the space factor (or `\spaceskip` and `\xspaceskip`), a no-break space
 * a penalty of 10000 and a normal space, and an explicit hyphen gets a discretionary after it. A
 * character the run's font lacks is a box of another of the field's fonts when one has it
 * (`Face.fallbackWidth`), and is dropped otherwise, as TeX drops a missing character. Leading
 * spaces are dropped, and so is a trailing one, as TeX drops it at `\par`. A font without a
 * ligature and kern program, a native font's, sets each character as a box of its own. A run of
 * characters with no space longer than the generator lets one be has a penalty of 0 where the
 * generator writes its break opportunity, `\allowbreak`, which ends the font's ligatures and kerns
 * there as TeX does (`runBreaks`), the count going on from one run into the next as the
 * generator's does.
 *
 * Each run is set in its own face, and ligatures and kerns never cross from one run into the
 * next, as they never cross a font change in TeX. A space's glue is its run's font's, since TeX
 * takes the interword glue from the font current where it reads the space; spaces on both sides of
 * a boundary are two glues, as TeX reads a space token on each side of the commands between; and
 * the space factor carries across runs, as TeX keeps it across a font change. Offsets are over the
 * runs' texts joined.
 */
export function richParagraphNodes(runs: readonly FaceRun[], options: TextOptions = {}): Node[] {
  const sfCode = options.sfCode ?? latexSfCode;
  const nodes: Node[] = [];
  let spaceFactor = 1000;
  // A space waits for what comes after it, since TeX drops the paragraph's last, and is set in its
  // own run's font whatever follows it.
  let pendingSpace: { offset: number; end: number; face: Face } | undefined;
  const flushSpace = () => {
    if (pendingSpace) {
      const { face, ...at } = pendingSpace;
      nodes.push({ kind: "glue", ...spaceGlue(face.spaceGlue(), spaceFactor, options), ...at });
    }
    pendingSpace = undefined;
  };
  // The last character's box set, and its italic correction, for a `\/` after it.
  let lastChar: { node: Node; italic: number } | undefined;
  // How many characters of a run with no space the runs so far end in (`runBreaks`).
  let carried = 0;

  /** Set one run's text, whose first character is at offset `base` in the paragraph. */
  const setText = (text: string, face: Face, base: number) => {
    // Characters are code points; offsets are UTF-16 indices, which is what callers slice by.
    const chars: { ch: string; at: number; kind: ReturnType<typeof kindOf> }[] = [];
    let pos = 0;
    for (const ch of text) {
      chars.push({ ch, at: pos, kind: kindOf(ch) });
      pos += ch.length;
    }
    const at = (k: number) => base + (chars[k]?.at ?? text.length);
    const kind = (k: number) => chars[k]?.kind;
    const period = face.codeFor(".");
    // Where the generator breaks a long run, by the character the break comes before.
    const cut = runBreaks(text, carried);
    carried = cut.carried;
    const breaks = new Set(cut.breaks);
    const breaksBefore = (k: number) => breaks.has(chars[k]?.at ?? -1);

    /**
     * Set the word from character `from` to `to`. It is cut into runs of the face's own
     * characters, each put through the font's ligature and kern program; a character another font
     * sets, and each period of an ellipsis, ends a run, as a font change or a kern ends one in TeX.
     */
    const setWord = (from: number, to: number) => {
      // Where each character stands in the word as `hyphenate` sees it, without the left-out ones.
      const place: number[] = [];
      let letters = "";
      for (let k = from; k <= to; k++) {
        place.push(letters.length);
        const c = chars[k];
        if (k < to && c?.kind === "char") letters += c.ch;
      }
      const hyphens = new Set(options.hyphenate ? options.hyphenate(letters) : []);
      // The run being gathered: the face's codes, and the character each came from.
      let codes: number[] = [];
      let sources: number[] = [];
      const setRun = (end: number) => {
        const lig = face.ligKern ? applyLigKern(face.ligKern.tfm, codes) : unchanged(codes);
        lig.codes.forEach((code, k) => {
          const first = sources[lig.source[k] as number] as number;
          const next = lig.source[k + 1];
          const last = next === undefined ? end : (sources[next] as number);
          const box: Node = {
            kind: "box",
            width: face.widthOf(code),
            offset: at(first),
            end: at(last),
            code,
          };
          nodes.push(box);
          lastChar = { node: box, italic: face.italicOf(code) };
          for (let s = first; s < last; s++) {
            const c = chars[s];
            if (c?.kind === "char") spaceFactor = nextSpaceFactor(spaceFactor, sfCode(c.ch));
          }
          if (code === face.hyphenChar)
            nodes.push({ kind: "disc", preWidth: 0, hyphenation: false, offset: at(last) });
          if (hyphens.has(place[last - from] ?? -1) && k < lig.codes.length - 1)
            nodes.push({
              kind: "disc",
              preWidth: face.widthOf(face.hyphenChar),
              hyphenation: true,
              offset: at(last),
            });
          const kern = lig.kernAfter[k] as number;
          if (kern >= 0 && k < lig.codes.length - 1)
            nodes.push({ kind: "kern", width: face.ligKern?.kerns[kern] ?? 0 });
        });
        codes = [];
        sources = [];
      };
      for (let k = from; k < to; k++) {
        const c = chars[k];
        if (c?.kind !== "char") continue;
        const code = face.codeFor(c.ch);
        if (code !== undefined) {
          codes.push(code);
          sources.push(k);
        } else if (c.ch === ELLIPSIS && period !== undefined) {
          // The first period joins the run before it, as TeX sets it right after the letter
          // before; the kern after each period ends a run.
          for (let dot = 0; dot < 3; dot++) {
            codes.push(period);
            sources.push(k);
            setRun(k + 1);
            nodes.push({ kind: "kern", width: face.spaceGlue().stretch });
          }
          spaceFactor = nextSpaceFactor(spaceFactor, sfCode("."));
        } else {
          // TeX drops a character no font of the field has, and the run goes on past it.
          const width = face.fallbackWidth?.(c.ch);
          if (width === undefined) continue;
          setRun(k);
          const box: Node = { kind: "box", width, offset: at(k), end: at(k + 1) };
          nodes.push(box);
          lastChar = { node: box, italic: face.fallbackItalic?.(c.ch) ?? 0 };
          spaceFactor = nextSpaceFactor(spaceFactor, sfCode(c.ch));
        }
      }
      setRun(to);
    };

    let i = 0;
    while (i < chars.length) {
      const here = kind(i);
      const from = i;
      if (here === "none") i++;
      else if (here === "space") {
        while (i < chars.length && (kind(i) === "space" || kind(i) === "none")) i++;
        // A space an earlier run ended in is a glue of its own, since TeX reads two spaces there.
        flushSpace();
        if (nodes.length) pendingSpace = { offset: at(from), end: at(i), face };
      } else if (here === "tie") {
        flushSpace();
        nodes.push({ kind: "penalty", penalty: INF_PENALTY });
        nodes.push({
          kind: "glue",
          ...spaceGlue(face.spaceGlue(), 1000, options),
          offset: at(i),
          end: at(i + 1),
        });
        i++;
      } else {
        flushSpace();
        while (i < chars.length && (kind(i) === "char" || kind(i) === "none")) i++;
        // A word the generator breaks is set in pieces, a penalty of 0 before each but the first,
        // and before the first too where the break comes as the run begins.
        let start = from;
        for (let k = from; k < i; k++)
          if (breaksBefore(k)) {
            if (k > start) setWord(start, k);
            nodes.push({ kind: "penalty", penalty: 0 });
            start = k;
          }
        setWord(start, i);
      }
    }
  };

  /**
   * LaTeX's `\/` where a run ends: the italic correction of the last character set, as a kern
   * right after it. LaTeX's `\sw@slant` takes off one glue, the space waiting to be set or a
   * no-break space's, and then one penalty, the no-break space's, sets the correction and puts
   * them back; and `\/` sets nothing after anything else, such as a kern or a discretionary.
   */
  const correctItalic = () => {
    let last = nodes.length - 1;
    if (pendingSpace === undefined && nodes[last]?.kind === "glue") last--;
    if (nodes[last]?.kind === "penalty") last--;
    const tail = nodes[last];
    if (tail !== undefined && tail === lastChar?.node && lastChar.italic !== 0)
      nodes.splice(last + 1, 0, { kind: "kern", width: lastChar.italic });
  };

  let base = options.offset ?? 0;
  for (const run of runs) {
    // A link opens with a special, after a space before it and before any inside it. One that
    // starts the paragraph has nothing before it to break after, and its leading spaces are
    // dropped as any others are.
    if (run.link && nodes.length > 0) {
      flushSpace();
      nodes.push({ kind: "whatsit" });
    }
    setText(run.text, run.face, base);
    if (run.italicCorrection) correctItalic();
    // A link closes with a special, after its correction and any space inside it.
    if (run.link) {
      flushSpace();
      nodes.push({ kind: "whatsit" });
    }
    base += run.text.length;
  }
  return nodes;
}

/** A run of codes as a font with no ligature and kern program sets it: each code as it is. */
function unchanged(codes: number[]): LigKernResult {
  return { codes, source: codes.map((_, k) => k), kernAfter: codes.map(() => -1) };
}

export interface LineRange {
  /** Text offset where the line's text starts. */
  from: number;
  /** Text offset where the next line's text starts, or the text's length for the last line. */
  to: number;
  /** True when the line ends with a hyphen TeX inserted. */
  hyphenated: boolean;
}

/**
 * Map broken lines back to character offsets. The ranges tile the whole text: a line
 * runs from where the previous one stopped to the first character of the next one, so
 * the spaces TeX broke at, leading and trailing whitespace, and characters the font has
 * no glyph for all belong to some line and survive a round trip through an editor.
 */
export function lineRanges(nodes: Node[], lines: Line[], textLength: number): LineRange[] {
  const startOf = (line: Line): number | undefined => {
    for (let i = line.from; i < line.breakAt; i++) {
      const node = nodes[i] as Node;
      if (node.kind === "box") return node.offset;
    }
    return undefined;
  };
  let from = 0;
  return lines.map((line, i) => {
    const next = lines[i + 1];
    const to = next === undefined ? textLength : (startOf(next) ?? from);
    const at = nodes[line.breakAt];
    const range = {
      from,
      to: Math.max(from, to),
      hyphenated: line.hyphenated && !!at && at.kind === "disc" && at.preWidth > 0,
    };
    from = range.to;
    return range;
  });
}
