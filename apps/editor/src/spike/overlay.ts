/**
 * Spike: an editable overlay set in the page's own font, and a measurement of how far
 * its characters sit from the glyphs TeX placed. Given a `Layout`, the overlay breaks
 * its lines with TeX's own algorithm and metrics instead of the browser's, and sets
 * each line's word spacing the way TeX set its glue, so only the browser's glyph
 * placement within a line remains as drift.
 */

import {
  type BreakParams,
  breakLines,
  type Face,
  lineRanges,
  paragraphNodes,
} from "../tex/linebreak";

interface GlyphBox {
  offset: number;
  /** Client (CSS pixel) coordinates of the glyph origin on its baseline. */
  x: number;
  baseline: number;
  width: number;
  line: number;
}

export interface ShiftReport {
  field: string;
  font: string;
  fontPx: number;
  lineHeightPx: number;
  align: string;
  glyphs: number;
  svgLines: number;
  overlayLines: number;
  /** Glyphs whose overlay character sits on a different line than the SVG glyph. */
  lineMismatches: number;
  maxDx: number;
  meanDx: number;
  maxDy: number;
}

/** How to break the field's text the way TeX did. */
export interface Layout {
  face: Face;
  params: BreakParams;
  /** CSS pixels per scaled point. */
  pxPerSp: number;
}

const FIELD_GLYPHS = (svg: SVGSVGElement, id: string) => [
  ...svg.querySelectorAll<SVGUseElement>(`use[data-field="${CSS.escape(id)}"]`),
];

function glyphBoxes(svg: SVGSVGElement, id: string): GlyphBox[] {
  const ctm = svg.getScreenCTM();
  if (!ctm) throw new Error("no CTM");
  const toClient = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(ctm);
  const raw = FIELD_GLYPHS(svg, id).map((el) => {
    const x = Number(el.getAttribute("x"));
    const y = Number(el.getAttribute("y"));
    const p = toClient(x, y);
    const q = toClient(x + Number(el.dataset.w ?? 0), y);
    return { offset: Number(el.dataset.offset), x: p.x, baseline: p.y, width: q.x - p.x, line: 0 };
  });
  const baselines = [...new Set(raw.map((g) => Math.round(g.baseline * 10) / 10))].sort(
    (a, b) => a - b,
  );
  for (const g of raw) g.line = baselines.findIndex((b) => Math.abs(b - g.baseline) < 0.5);
  return raw;
}

export interface OverlayHandle {
  element: HTMLDivElement;
  report: () => ShiftReport;
  close: () => void;
  /** The field's text as edited so far. */
  text: () => string;
}

/**
 * Open a contenteditable overlay on a field, positioned so its first baseline and left
 * edge coincide with the SVG glyphs, in the same font and size.
 */
export function openOverlay(
  svg: SVGSVGElement,
  container: HTMLElement,
  id: string,
  initialText: string,
  layout?: Layout,
): OverlayHandle {
  let text = initialText;
  const glyphs = glyphBoxes(svg, id);
  const first = FIELD_GLYPHS(svg, id)[0];
  if (glyphs.length === 0 || !first) throw new Error(`field ${id} has no glyphs on the page`);
  const font = first.dataset.font ?? "cmr10";
  const ctm = svg.getScreenCTM();
  const scale = ctm ? ctm.a : 1;
  const fontPx = Number(first.dataset.size ?? 10) * scale;
  const lines = Math.max(...glyphs.map((g) => g.line)) + 1;
  const baselineOf = (line: number) => glyphs.find((g) => g.line === line)?.baseline ?? 0;
  const lineHeightPx = lines > 1 ? baselineOf(1) - baselineOf(0) : fontPx * 1.2;
  const left = Math.min(...glyphs.map((g) => g.x));
  // The measure: the widest full line, or the only line.
  const fullLines = lines > 1 ? glyphs.filter((g) => g.line < lines - 1) : glyphs;
  const right = Math.max(...fullLines.map((g) => g.x + g.width));
  // TeX justified the paragraph only if every full line ends at the same edge; ragged-right
  // paragraphs (Jake's preamble sets \raggedright) must not be stretched by the overlay.
  const lineRight = (line: number) =>
    Math.max(...glyphs.filter((g) => g.line === line).map((g) => g.x + g.width));
  const rights = Array.from({ length: Math.max(0, lines - 1) }, (_, i) => lineRight(i));
  const justified = rights.length > 1 && Math.max(...rights) - Math.min(...rights) < 1;
  // With our fonts' ascent 0.8em and descent 0.2em the baseline sits this far below the line top.
  const baselineInLine = (lineHeightPx - fontPx) / 2 + 0.8 * fontPx;

  const containerRect = container.getBoundingClientRect();
  const el = document.createElement("div");
  el.id = "overlay";
  el.contentEditable = "true";
  el.spellcheck = false;
  Object.assign(el.style, {
    position: "absolute",
    left: `${left - containerRect.left + container.scrollLeft}px`,
    top: `${baselineOf(0) - baselineInLine - containerRect.top + container.scrollTop}px`,
    width: `${right - left + 0.5}px`,
    fontFamily: `"${font}"`,
    fontSize: `${fontPx}px`,
    lineHeight: `${lineHeightPx}px`,
    textAlign: justified && !layout ? "justify" : "left",
    whiteSpace: layout ? "pre" : "pre-wrap",
    hyphens: "manual",
    margin: "0",
    padding: "0",
    border: "0",
    outline: "1px solid #0a7",
    background: "rgba(255,255,255,0.85)",
    zIndex: "10",
  });
  container.appendChild(el);

  /** The text's lines, as TeX would break them (one line when there is no layout). */
  type Row = { from: number; to: number; wordSpacingPx: number };
  let rows: Row[] = [];
  const layOut = () => {
    if (!layout) {
      rows = [{ from: 0, to: text.length, wordSpacingPx: 0 }];
      return;
    }
    const nodes = paragraphNodes(text, layout.face);
    const broken = breakLines(nodes, layout.params);
    const { leftSkip, rightSkip, parFillSkip } = layout.params;
    rows = lineRanges(nodes, broken, text.length).map((range, i) => {
      const line = broken[i];
      if (!line) return { ...range, wordSpacingPx: 0 };
      // Glue is set only when TeX had to shrink the line, or to stretch a justified one:
      // fil glue in the margins, or \parfillskip on the last line, takes all the stretch.
      const spaces = nodes.slice(line.from, line.breakAt).filter((n) => n.kind === "glue").length;
      const shortfall = line.width - line.natural;
      const last = i === broken.length - 1;
      const stretchable =
        rightSkip.stretchOrder === 0 &&
        leftSkip.stretchOrder === 0 &&
        !(last && parFillSkip.stretchOrder > 0);
      const setBy = shortfall < 0 ? shortfall : stretchable ? shortfall : 0;
      return { ...range, wordSpacingPx: spaces ? (setBy / spaces) * layout.pxPerSp : 0 };
    });
  };
  const render = () => {
    layOut();
    el.replaceChildren(
      ...rows.map((row) => {
        const div = document.createElement("div");
        div.textContent = text.slice(row.from, row.to);
        div.style.wordSpacing = `${row.wordSpacingPx}px`;
        div.style.minHeight = `${lineHeightPx}px`;
        return div;
      }),
    );
  };
  render();

  /** Text node and local offset for a character offset; the text's length is its end. */
  const locate = (offset: number): { node: Text; at: number } | undefined => {
    let i = rows.findIndex((r) => offset >= r.from && offset < r.to);
    if (i < 0 && offset >= text.length) i = rows.length - 1;
    const row = rows[i];
    const node = el.children[i]?.firstChild;
    if (!row || !(node instanceof Text)) return undefined;
    return { node, at: Math.min(offset - row.from, node.length) };
  };

  // After each edit, rebuild the text from whatever the browser left in the element (the
  // rows tile the text, so the join loses nothing), break it again, and put the caret back.
  el.addEventListener("input", () => {
    const sel = document.getSelection();
    let caret = text.length;
    if (sel?.anchorNode && el.contains(sel.anchorNode)) {
      const before = document.createRange();
      before.setStart(el, 0);
      before.setEnd(sel.anchorNode, sel.anchorOffset);
      caret = before.toString().length;
    }
    text = [...el.childNodes].map((n) => n.textContent ?? "").join("");
    render();
    const where = locate(Math.min(caret, text.length));
    if (where && sel) {
      const range = document.createRange();
      range.setStart(where.node, where.at);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });

  const report = (): ShiftReport => {
    const range = document.createRange();
    const charRect = (offset: number) => {
      const where = locate(offset);
      if (!where) return undefined;
      range.setStart(where.node, where.at);
      range.setEnd(where.node, Math.min(where.at + 1, where.node.length));
      return range.getClientRects()[0];
    };
    const tops = new Set<number>();
    const measured: { dx: number; dy: number; svgLine: number; overlayTop: number }[] = [];
    for (const g of glyphs) {
      const r = charRect(g.offset);
      if (!r) continue;
      tops.add(Math.round(r.top));
      measured.push({
        dx: r.left - g.x,
        dy: r.top + 0.8 * fontPx - g.baseline,
        svgLine: g.line,
        overlayTop: Math.round(r.top),
      });
    }
    const overlayLines = [...tops].sort((a, b) => a - b);
    const lineMismatches = measured.filter(
      (r) => overlayLines.indexOf(r.overlayTop) !== r.svgLine,
    ).length;
    const same = measured.filter((r) => overlayLines.indexOf(r.overlayTop) === r.svgLine);
    const abs = (a: number[]) => a.map(Math.abs);
    return {
      field: id,
      font,
      fontPx,
      lineHeightPx,
      align: layout ? `tex (${rows.length} lines)` : el.style.textAlign,
      glyphs: glyphs.length,
      svgLines: lines,
      overlayLines: overlayLines.length,
      lineMismatches,
      maxDx: same.length ? Math.max(...abs(same.map((r) => r.dx))) : Number.NaN,
      meanDx: same.length
        ? abs(same.map((r) => r.dx)).reduce((a, b) => a + b, 0) / same.length
        : Number.NaN,
      maxDy: same.length ? Math.max(...abs(same.map((r) => r.dy))) : Number.NaN,
    };
  };

  return { element: el, report, close: () => el.remove(), text: () => text };
}
