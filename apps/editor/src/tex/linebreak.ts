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
 * does. Hyphenation is a hook, not built in.
 *
 * All dimensions are in scaled points, integers, as in TeX.
 */

import type { ScaledMetrics, Tfm } from "./tfm";
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
    };

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
  // Cumulative sums, so the width of any span is a difference.
  const sumW = new Float64Array(n + 1);
  const sumS = [0, 1, 2, 3].map(() => new Float64Array(n + 1));
  const sumSh = new Float64Array(n + 1);
  const sumShOrder = new Uint8Array(n + 1);
  for (let i = 0; i < n; i++) {
    const node = nodes[i] as Node;
    const w = node.kind === "disc" || node.kind === "penalty" ? 0 : node.width;
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
              if ((minimal[fit] as number) <= minimum + params.adjDemerits) {
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
        const lineWidth = l > easyLine ? secondWidth : lineWidthOf(l);
        // The line from r's break to this one.
        const from = r.from;
        const natural = (sumW[cur] as number) - (sumW[from] as number) + pre + background.width;
        const stretch = [0, 1, 2, 3].map(
          (o) =>
            ((sumS[o] as Float64Array)[cur] as number) -
            ((sumS[o] as Float64Array)[from] as number) +
            (background.stretch[o] ?? 0) +
            (atEnd && params.parFillSkip.stretchOrder === o ? params.parFillSkip.stretch : 0) +
            (o === 0 ? pass.emergency : 0),
        );
        const shrink =
          (sumSh[cur] as number) -
          (sumSh[from] as number) +
          background.shrink +
          (atEnd ? params.parFillSkip.shrink : 0);
        const shortfall = lineWidth - natural;
        let b: number;
        let fit: number;
        if (shortfall > 0) {
          if (
            (stretch[1] as number) !== 0 ||
            (stretch[2] as number) !== 0 ||
            (stretch[3] as number) !== 0
          ) {
            b = 0;
            fit = 2;
          } else {
            b = badness(shortfall, stretch[0] as number);
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
          if (pass.final && minimum === AWFUL_BAD && r.next === last && prevR === head) {
            artificial = true;
          } else if (b > pass.threshold) {
            // Deactivate r: later breaks can only make this line worse.
            prevR.next = r.next;
            r = r.next as Active;
            continue;
          }
          stays = false;
        } else {
          prevR = r;
          if (b > pass.threshold) {
            r = r.next as Active;
            continue;
          }
          stays = true;
        }
        let d: number;
        if (artificial) d = 0;
        else {
          d = params.linePenalty + b;
          d = Math.abs(d) >= 10000 ? 100000000 : d * d;
          if (pi !== 0) {
            if (pi > 0) d += pi * pi;
            else if (pi > EJECT_PENALTY) d -= pi * pi;
          }
          if (hyphenatedBreak && r.hyphenated)
            d += atEnd ? params.finalHyphenDemerits : params.doubleHyphenDemerits;
          if (Math.abs(fit - r.fitness) > 1) d += params.adjDemerits;
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
          if (before && (before.kind === "box" || before.kind === "disc")) tryBreak(cur, 0, false);
          break;
        }
        case "penalty":
          tryBreak(cur, node.penalty, false);
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

/** A font as the paragraph builder needs it. */
export interface Face {
  tfm: Tfm;
  metrics: ScaledMetrics;
  /** The font's code for a character of the text, or undefined if it has none. */
  codeFor: (ch: string) => number | undefined;
  /** `\hyphenchar` of the font; 45 for text fonts. */
  hyphenChar: number;
}

export interface TextOptions {
  /** `\sfcode` of a character; defaults to LaTeX's. */
  sfCode?: (ch: string) => number;
  /** Positions inside a word where TeX would hyphenate it. */
  hyphenate?: (word: string) => number[];
  /** Text offset the paragraph starts at, for fields that begin mid-paragraph. */
  offset?: number;
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

/** tex.web §1041–1044: the interword glue for a space factor. */
export function spaceGlue(metrics: ScaledMetrics, spaceFactor: number): Glue {
  if (spaceFactor === 1000)
    return {
      width: metrics.space,
      stretch: metrics.stretch,
      shrink: metrics.shrink,
      stretchOrder: 0,
      shrinkOrder: 0,
    };
  return {
    width: metrics.space + (spaceFactor >= 2000 ? metrics.extraSpace : 0),
    stretch: Math.floor((metrics.stretch * spaceFactor) / 1000),
    shrink: Math.floor((metrics.shrink * 1000) / spaceFactor),
    stretchOrder: 0,
    shrinkOrder: 0,
  };
}

/**
 * Build the node list for a paragraph of text in one font: characters become boxes
 * after the font's ligature and kern program, spaces become glue sized by the space
 * factor, an explicit hyphen gets a discretionary after it, and a trailing space is
 * dropped as TeX drops it at `\par`.
 */
export function paragraphNodes(text: string, face: Face, options: TextOptions = {}): Node[] {
  const sfCode = options.sfCode ?? latexSfCode;
  const base = options.offset ?? 0;
  const nodes: Node[] = [];
  let spaceFactor = 1000;
  // Characters are code points; offsets are UTF-16 indices, which is what callers slice by.
  const chars: { ch: string; at: number }[] = [];
  let pos = 0;
  for (const ch of text) {
    chars.push({ ch, at: pos });
    pos += ch.length;
  }
  const at = (k: number) => base + (chars[k]?.at ?? text.length);
  const isSpace = (k: number) => /\s/.test(chars[k]?.ch ?? "");
  let i = 0;
  let pendingSpace: { offset: number; end: number } | undefined;
  while (i < chars.length) {
    if (isSpace(i)) {
      const from = i;
      while (i < chars.length && isSpace(i)) i++;
      if (nodes.length) pendingSpace = { offset: at(from), end: at(i) };
      continue;
    }
    const from = i;
    while (i < chars.length && !isSpace(i)) i++;
    if (pendingSpace) {
      nodes.push({ kind: "glue", ...spaceGlue(face.metrics, spaceFactor), ...pendingSpace });
      pendingSpace = undefined;
    }
    const word = chars.slice(from, i);
    const codes: number[] = [];
    const sources: number[] = [];
    word.forEach((c, k) => {
      const code = face.codeFor(c.ch);
      if (code === undefined) return; // TeX drops a missing character
      codes.push(code);
      sources.push(from + k);
    });
    const hyphens = new Set(
      options.hyphenate ? options.hyphenate(word.map((c) => c.ch).join("")) : [],
    );
    const lig = applyLigKern(face.tfm, codes);
    lig.codes.forEach((code, k) => {
      const first = sources[lig.source[k] as number] as number;
      const nextSource = lig.source[k + 1];
      const end = nextSource === undefined ? i : (sources[nextSource] as number);
      nodes.push({
        kind: "box",
        width: face.metrics.widths[code] ?? 0,
        offset: at(first),
        end: at(end),
        code,
      });
      for (let s = first; s < end; s++)
        spaceFactor = nextSpaceFactor(spaceFactor, sfCode(chars[s]?.ch ?? ""));
      if (code === face.hyphenChar)
        nodes.push({ kind: "disc", preWidth: 0, hyphenation: false, offset: at(end) });
      if (hyphens.has(end - from) && k < lig.codes.length - 1)
        nodes.push({
          kind: "disc",
          preWidth: face.metrics.widths[face.hyphenChar] ?? 0,
          hyphenation: true,
          offset: at(end),
        });
      const kern = lig.kernAfter[k] as number;
      if (kern >= 0 && k < lig.codes.length - 1)
        nodes.push({ kind: "kern", width: face.metrics.kerns[kern] ?? 0 });
    });
  }
  return nodes;
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
