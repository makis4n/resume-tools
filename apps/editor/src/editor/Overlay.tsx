/**
 * The editing overlay: a field opened in place on the page, set in the page's own glyphs and
 * broken into lines where TeX will break them, so that what the user types sits where the next
 * compile puts it (decision 0004). It is the spike's overlay (`spike/overlay.ts`) as product code.
 *
 * A keystroke never waits for TeX. Every input rebuilds the field's text from the rows the
 * browser edited, breaks it again with TeX's breaker, the field's font metrics and the parameters
 * TeX measured for its paragraph (the paragraph special, `page/paragraph.ts`), draws the rows and
 * puts the caret back; then the edit goes to the document as a command, and the compile follows it
 * after the scheduler's pause. The browser wraps nothing: each row is a `<div>` of its own with
 * `white-space: pre`, and its `word-spacing` is the glue TeX sets on the line, nothing on a ragged
 * line or the last line of a justified one, the shrink or stretch spread over the spaces otherwise.
 * The rows are set in a web font built from the page's own outlines (`page/webfont.ts`), and wait
 * for it. When the compile's page arrives the overlay reads its place from the new page and stays
 * open with its text and caret; a field the new page no longer has closes it.
 *
 * Offsets are UTF-16 indices throughout, as the DOM and the model slice by. A field is one
 * paragraph, so Enter inserts nothing, and pasted text comes in plain, its line breaks as spaces.
 * Formatting keys insert nothing, and neither do the browser's own undo and redo, whose record of
 * the rows this overlay redraws on every input would be wrong; item 12 gives undo across page and
 * panel. Dates open a small picker instead, since the model stores them as dates.
 */

import { type Dates, YearMonth } from "@resume-tools/resume-model";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FieldLayout } from "../page/draw";
import type { PageFont } from "../page/fonts";
import { breakParams, parseParagraph, startingAt } from "../page/paragraph";
import { ASCENT, registerWebFont, typedCodes, webFontFamily, webFontOf } from "../page/webfont";
import {
  type Node as BreakNode,
  type BreakParams,
  breakLines,
  type Face,
  LATEX_PARAMS,
  lineRanges,
  paragraphNodes,
} from "../tex/linebreak";
import { scaleTfm } from "../tex/tfm";
import type { Shown } from "./compiler";
import { type Command, type Document, fieldsOf } from "./document";

/** Scaled points in a point. */
const PT = 65536;

/** One line of the overlay: where its text starts and ends, and the glue TeX adds per space. */
export interface Row {
  /** Where the row's text starts, and where the next row's starts, as UTF-16 offsets. */
  from: number;
  to: number;
  /** What TeX sets each space on the line wider (or, below zero, narrower) by, in scaled points. */
  wordSpacingSp: number;
}

/**
 * The rows a field's text is set in: TeX's lines for `params`, and one row for a field TeX never
 * breaks, which has none. The rows tile the text (`lineRanges`), so joining them gives it back.
 *
 * Each row's word spacing makes its spaces as wide as TeX's glue on the line, spread evenly over
 * them. The browser sets every space at the font's interword space, where TeX sets a wider one
 * after a sentence; and TeX stretches or shrinks a line's glue only when it shrank the line or
 * stretched a line of a justified paragraph, since fil glue in the margins, or `\parfillskip` on
 * the last line, takes all the stretch otherwise.
 */
export function layoutRows(text: string, face: Face, params: BreakParams | undefined): Row[] {
  const whole = [{ from: 0, to: text.length, wordSpacingSp: 0 }];
  if (params === undefined) return whole;
  const nodes = paragraphNodes(text, face);
  const lines = breakLines(nodes, params);
  const { leftSkip, rightSkip, parFillSkip } = params;
  const rows = lineRanges(nodes, lines, text.length).map((range, i): Row => {
    const line = lines[i];
    if (line === undefined) return { from: range.from, to: range.to, wordSpacingSp: 0 };
    const glue = nodes
      .slice(line.from, line.breakAt)
      .filter((node): node is Extract<BreakNode, { kind: "glue" }> => node.kind === "glue");
    const wider = glue.reduce((sum, space) => sum + space.width - face.metrics.space, 0);
    const shortfall = line.width - line.natural - leftSkip.width - rightSkip.width;
    const last = i === lines.length - 1;
    const justified =
      leftSkip.stretchOrder === 0 &&
      rightSkip.stretchOrder === 0 &&
      !(last && parFillSkip.stretchOrder > 0);
    const set = shortfall < 0 || justified ? shortfall : 0;
    return {
      from: range.from,
      to: range.to,
      wordSpacingSp: glue.length > 0 ? (wider + set) / glue.length : 0,
    };
  });
  return rows.length > 0 ? rows : whole;
}

/**
 * The row an offset falls in, and its column there. A row's end is the next row's start, where
 * the offset belongs to the next row, after the space TeX broke at; the text's end is in the last.
 */
export function rowOf(rows: readonly Row[], offset: number): { row: number; column: number } {
  let row = rows.findIndex((each) => offset >= each.from && offset < each.to);
  if (row < 0) row = offset <= 0 ? 0 : rows.length - 1;
  const { from, to } = rows[row] ?? { from: 0, to: 0 };
  return { row, column: Math.min(Math.max(0, offset - from), to - from) };
}

/**
 * The breaker's face for a font at a size in points: its TFM scaled as TeX scales it, and the
 * code for each character by the rule its web font's character map follows (`typedCodes`), so
 * that a character the breaker measures is the glyph the browser draws. A font with no outlines
 * has no codes, and its text measures as nothing.
 */
export function faceFor(font: PageFont, size: number): Face {
  const codes = font.outlines ? typedCodes(font.outlines, font.text) : new Map<string, number>();
  return {
    tfm: font.tfm,
    metrics: scaleTfm(font.tfm, Math.round(size * PT)),
    codeFor: (char) => codes.get(char),
    hyphenChar: 45,
  };
}

/** How the overlay breaks a field: the face, and the parameters, none for a field on one row. */
export interface Setting {
  face: Face;
  params: BreakParams | undefined;
}

/** Fields whose paragraph special could not be read, which the console has heard of. */
const unread = new Set<string>();

/**
 * How the overlay sets a field on a page: the face of its first glyph's font, and the breaker's
 * parameters from its paragraph special, the first line shortened by however far into it the
 * field starts. A field TeX never breaks (`inner`) has no parameters. Without a special it can
 * read, a field breaks by LaTeX's defaults over the width the page suggests, its line's start
 * taken as the margin on both sides, and the console hears of it once.
 */
export function settingFor(id: string, layout: FieldLayout, pageWidth: number): Setting {
  const face = faceFor(layout.font, layout.size);
  const paragraph = layout.paragraph === undefined ? undefined : parseParagraph(layout.paragraph);
  if (paragraph?.inner) return { face, params: undefined };
  const into = Math.round((layout.x - layout.lineStart) * PT);
  if (paragraph !== undefined) return { face, params: startingAt(breakParams(paragraph), into) };
  if (!unread.has(id)) {
    unread.add(id);
    console.warn(`The paragraph of ${id} could not be read, so it breaks by LaTeX's defaults`, {
      special: layout.paragraph,
    });
  }
  const width = Math.max(0, Math.round((pageWidth - 2 * layout.lineStart) * PT));
  return { face, params: startingAt({ ...LATEX_PARAMS, lines: [{ indent: 0, width }] }, into) };
}

/** A month as `<input type="month">` reads and writes it. */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The command a date picker sends for what it shows: a start, and an end that is a month,
 * `"present"`, or none. A start the model refuses, as an emptied input gives, sends nothing, since
 * dates need one; an end that is not a month or the present is no end date.
 */
export function datesCommand(
  field: string,
  start: string,
  end: string | undefined,
): Command | undefined {
  if (!YearMonth.safeParse(start).success) return undefined;
  const dates: Dates =
    end === "present" || (end !== undefined && MONTH.test(end)) ? { start, end } : { start };
  return { type: "dates", field, dates };
}

export interface OverlayProps {
  /** The field's id, as the page's markers and the document's commands name it. */
  field: string;
  /** Where in the field's text the click landed, which the caret opens at. */
  offset: number;
  /** The document as it stands, whose text for the field the overlay opens with. */
  document: Document;
  /** The latest page, which the overlay takes its place and paragraph from. */
  shown: Shown;
  /** The element the page's SVG is drawn in, positioned, which the overlay is placed in. */
  page: HTMLElement;
  /** Each edit, as a command for the document. */
  onCommand: (command: Command) => void;
  onClose: () => void;
}

/**
 * A field opened for editing: the overlay for a text or rich field, and the picker for dates.
 * A rich field opens on its runs' text joined, as the page shows it, and each edit sets it as one
 * plain run, losing its bold, italic and links, until item 10 edits rich fields in Tiptap.
 */
export function Overlay(props: OverlayProps) {
  const { field: id, shown, onClose } = props;
  // What the field is and holds when it opens; after that the overlay's own text is the field's.
  const [opened] = useState(() => {
    const field = fieldsOf(props.document.resume).get(id);
    switch (field?.kind) {
      case "text":
        return { kind: field.kind, text: field.get(props.document.resume) ?? "" };
      case "rich":
        return {
          kind: field.kind,
          text: field
            .get(props.document.resume)
            .map((run) => run.text)
            .join(""),
        };
      case "dates":
        return { kind: field.kind, dates: field.get(props.document.resume) };
      default:
        return undefined;
    }
  });
  const layout = shown.page.fields.get(id)?.layout;
  // A page without the field, as a template that drops an emptied field gives, closes it.
  const gone = opened === undefined || layout === undefined;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (opened === undefined || layout === undefined) return null;
  if (opened.kind === "dates")
    return <DatePicker {...props} layout={layout} dates={opened.dates} />;
  return (
    <TextOverlay {...props} layout={layout} text={opened.text} rich={opened.kind === "rich"} />
  );
}

/** The web font a field is set in, and the page font it was built from. */
interface Ready {
  font: PageFont;
  /** The CSS font family to set the rows in. */
  family: string;
}

/** Fonts whose web font the browser refused, which the console has heard of. */
const refused = new Set<string>();

/**
 * The web font for the font a field is set in, once it is registered. Until the first is, there is
 * none; a later font keeps the one before until it is ready, so that the rows never go blank. A
 * font the page cannot draw, or whose web font the browser refuses, gets the browser's serif, so
 * that the field can still be edited, set as the page is not.
 */
function useWebFont(font: PageFont): Ready | undefined {
  const [ready, setReady] = useState<Ready>();
  useEffect(() => {
    let live = true;
    const settle = (family: string) => {
      if (live) setReady({ font, family });
    };
    registerWebFont(font.name, () => webFontOf(font)).then(
      () => settle(`${cssString(webFontFamily(font.name))}, serif`),
      (error: unknown) => {
        if (!refused.has(font.name)) {
          refused.add(font.name);
          console.warn(`The overlay cannot set ${font.name} in its own glyphs`, error);
        }
        settle("serif");
      },
    );
    return () => {
      live = false;
    };
  }, [font]);
  return ready;
}

/** A CSS string holding `text`. */
const cssString = (text: string) => `"${text.replace(/["\\]/g, "\\$&")}"`;

/**
 * Where the rows go and how big they are on the page as shown: the page's SVG is scaled to its
 * container, so its current transformation matrix gives the scale and offset, as in the spike.
 */
interface Frame {
  setting: Setting;
  family: string;
  /** The first row's top left, in CSS pixels in the page's container. */
  left: number;
  top: number;
  fontPx: number;
  lineHeightPx: number;
  /** CSS pixels per scaled point. */
  pxPerSp: number;
  /**
   * Where each line starts from the first line's start, and how wide it is, in pixels; the last
   * repeats.
   */
  indents: number[];
  widths: number[];
  /**
   * All of the above as one string, which a new page gives again when it leaves the field where
   * it was, as it mostly does, so the rows need not be drawn again and the selection is kept.
   */
  key: string;
}

/**
 * The baselines a field's lines sit on, down the page, in TeX points: for each character, the
 * lowest glyph that draws it, so that an accent TeX raised over its letter is not taken for a line.
 */
function baselinesOf(shown: Shown, id: string): number[] {
  const lowest = new Map<number, number>();
  for (const glyph of shown.page.glyphs)
    if (glyph.field === id && glyph.offset !== undefined)
      lowest.set(glyph.offset, Math.max(glyph.y, lowest.get(glyph.offset) ?? glyph.y));
  return [...new Set(lowest.values())].sort((a, b) => a - b);
}

/**
 * The frame for a field on the page in `container`: its first row's baseline and left edge on its
 * first glyph's, the font's size scaled as the page is, and the line height the page's baselines
 * give when the field has two lines or more, else 1.2 em. The first row is as wide as the field's
 * first line, the measure TeX breaks it at, so a line TeX would fill is not cut short.
 */
function frameOf(
  container: HTMLElement,
  shown: Shown,
  id: string,
  layout: FieldLayout,
  ready: Ready,
): Frame | undefined {
  const ctm = container.querySelector("svg")?.getScreenCTM();
  if (!ctm) return undefined;
  const scale = ctm.a;
  const at = new DOMPoint(layout.x, layout.y).matrixTransform(ctm);
  const box = container.getBoundingClientRect();
  const fontPx = layout.size * scale;
  const [first, second] = baselinesOf(shown, id);
  const lineHeightPx =
    first !== undefined && second !== undefined ? (second - first) * scale : 1.2 * fontPx;
  // With the web font's ascent at 0.8 em and descent 0.2 em, the baseline sits this far down a row.
  const baseline = (lineHeightPx - fontPx) / 2 + ASCENT * fontPx;
  const setting = settingFor(id, { ...layout, font: ready.font }, shown.page.size.width);
  const lines = setting.params?.lines ?? [];
  const pxPerSp = scale / PT;
  const start = lines[0]?.indent ?? 0;
  const frame = {
    setting,
    family: ready.family,
    left: at.x - box.left - container.clientLeft + container.scrollLeft,
    top: at.y - baseline - box.top - container.clientTop + container.scrollTop,
    fontPx,
    lineHeightPx,
    pxPerSp,
    indents: lines.map((line) => (line.indent - start) * pxPerSp),
    widths: lines.map((line) => line.width * pxPerSp),
  };
  const { setting: _, ...placed } = frame;
  const key = JSON.stringify([placed, setting.params, ready.font.name, layout.size]);
  return { ...frame, key };
}

/** What a field's text holds in place of a line break: a space, as the generator makes one. */
const LINE_BREAKS = /\r\n|[\t\n\r\u2028\u2029]/g;

/**
 * Inputs the overlay does not take: a new paragraph or line, which a field cannot hold;
 * formatting, which a plain field has none of; and the browser's undo and redo, until item 12.
 */
const REFUSED = /^(insertParagraph|insertLineBreak|format|history)/;

/**
 * The overlay's rows in the DOM, drawn by hand rather than by React, since the browser edits them
 * too: the field's text broken as TeX will break it, one `<div>` per line.
 */
class FieldRows {
  private rows: Row[] = [];
  private frame: Frame | undefined;

  constructor(
    private readonly element: HTMLDivElement,
    public text: string,
  ) {}

  /**
   * Take a frame, from a new page or font, and draw the rows in it with the caret put at `caret`;
   * a frame the rows are already in changes nothing.
   */
  place(frame: Frame, caret: number | undefined) {
    if (this.frame?.key === frame.key) return;
    this.frame = frame;
    const width = frame.widths[0];
    Object.assign(this.element.style, {
      left: `${frame.left}px`,
      top: `${frame.top}px`,
      width: width === undefined ? "max-content" : `${width}px`,
      fontFamily: frame.family,
      fontSize: `${frame.fontPx}px`,
      lineHeight: `${frame.lineHeightPx}px`,
    });
    this.draw(caret);
  }

  /**
   * Take the text the browser left in the rows, draw it broken anew with the caret where it was,
   * and say whether it changed. The rows tile the text, so joining what they hold loses nothing.
   */
  update(): boolean {
    const caret = this.caret();
    const text = [...this.element.childNodes]
      .map((node) => node.textContent ?? "")
      .join("")
      .replace(LINE_BREAKS, " ");
    const changed = text !== this.text;
    this.text = text;
    this.draw(caret);
    return changed;
  }

  /** Where the caret is in the text, or undefined when the selection is not in the rows. */
  caret(): number | undefined {
    const selection = document.getSelection();
    const node = selection?.focusNode;
    if (!selection || !node || !this.element.contains(node)) return undefined;
    const before = document.createRange();
    before.setStart(this.element, 0);
    before.setEnd(node, selection.focusOffset);
    return before.toString().length;
  }

  /** Put the caret at an offset in the text. */
  put(offset: number) {
    const { row, column } = rowOf(this.rows, Math.min(offset, this.text.length));
    const line = this.element.children[row];
    const node = line?.firstChild;
    if (!line) return;
    if (node instanceof Text)
      document.getSelection()?.collapse(node, Math.min(column, node.length));
    else document.getSelection()?.collapse(line, 0);
  }

  private draw(caret: number | undefined) {
    const frame = this.frame;
    if (!frame) return;
    let rows: Row[];
    try {
      rows = layoutRows(this.text, frame.setting.face, frame.setting.params);
    } catch (error) {
      // The breaker refuses only a font or parameters no real paragraph has; one row still edits.
      console.warn("The overlay could not break the field's lines", error);
      rows = layoutRows(this.text, frame.setting.face, undefined);
    }
    this.rows = rows;
    this.element.replaceChildren(...rows.map((row, i) => this.line(row, i, frame)));
    if (caret !== undefined) this.put(caret);
  }

  /** One row's element: its text, or a line break to hold the caret when it has none. */
  private line(row: Row, index: number, frame: Frame): HTMLDivElement {
    const line = document.createElement("div");
    const text = this.text.slice(row.from, row.to);
    line.append(text === "" ? document.createElement("br") : text);
    const indent = frame.indents[Math.min(index, frame.indents.length - 1)];
    const width = frame.widths[Math.min(index, frame.widths.length - 1)];
    Object.assign(line.style, {
      height: `${frame.lineHeightPx}px`,
      marginLeft: `${indent ?? 0}px`,
      width: width === undefined ? "" : `${width}px`,
      wordSpacing: `${row.wordSpacingSp * frame.pxPerSp}px`,
      background: "#fff",
    });
    return line;
  }
}

/** How the overlay looks, apart from where it is and the font, which the page decides. */
const OVERLAY_STYLE = {
  position: "absolute",
  zIndex: "1",
  margin: "0",
  padding: "0",
  border: "0",
  outline: "1px solid #0a7",
  outlineOffset: "1px",
  whiteSpace: "pre",
  fontWeight: "normal",
  fontStyle: "normal",
  fontKerning: "none",
  fontVariantLigatures: "none",
  fontSynthesis: "none",
  letterSpacing: "0",
  textTransform: "none",
  textAlign: "left",
  color: "#000",
} as const;

function TextOverlay(props: OverlayProps & { layout: FieldLayout; text: string; rich: boolean }) {
  const ready = useWebFont(props.layout.font);
  if (!ready) return null;
  return <Rows {...props} ready={ready} />;
}

function Rows({
  field: id,
  offset,
  shown,
  page,
  layout,
  text,
  rich,
  ready,
  onCommand,
  onClose,
}: OverlayProps & { layout: FieldLayout; text: string; rich: boolean; ready: Ready }) {
  const box = useRef<HTMLDivElement>(null);
  const rows = useRef<FieldRows | undefined>(undefined);
  const latest = useRef({ onCommand, onClose });
  useLayoutEffect(() => {
    latest.current = { onCommand, onClose };
  });

  // The rows and what the browser does to them, from when they first appear to when they close.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    Object.assign(element.style, OVERLAY_STYLE);
    const editing = new FieldRows(element, text);
    rows.current = editing;
    const edited = () => {
      if (!editing.update()) return;
      const { text } = editing;
      latest.current.onCommand(
        rich ? { type: "rich", field: id, runs: [{ text }] } : { type: "text", field: id, text },
      );
    };
    const listeners: [string, (event: Event) => void][] = [
      [
        "input",
        (event) => {
          // An input method composing a character edits the rows until it is done.
          if (!(event as InputEvent).isComposing) edited();
        },
      ],
      ["compositionend", edited],
      [
        "beforeinput",
        (event) => {
          if (REFUSED.test((event as InputEvent).inputType)) event.preventDefault();
        },
      ],
      [
        "paste",
        (event) => {
          event.preventDefault();
          const pasted = (event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
          document.execCommand("insertText", false, pasted.replace(LINE_BREAKS, " "));
        },
      ],
      [
        "keydown",
        (event) => {
          const { key } = event as KeyboardEvent;
          if (key === "Enter") event.preventDefault();
          if (key === "Escape") {
            event.preventDefault();
            latest.current.onClose();
          }
        },
      ],
      ["blur", () => latest.current.onClose()],
    ];
    for (const [type, listener] of listeners) element.addEventListener(type, listener);
    return () => {
      for (const [type, listener] of listeners) element.removeEventListener(type, listener);
      rows.current = undefined;
    };
  }, [id, rich, text]);

  // Placed on the page as it is shown now, and again with each new page or font. The first time,
  // the caret goes where the click landed; after that it stays where the user left it.
  const placed = useRef(false);
  useLayoutEffect(() => {
    const editing = rows.current;
    const element = box.current;
    if (!editing || !element) return;
    const frame = frameOf(page, shown, id, layout, ready);
    if (!frame) return;
    if (placed.current) {
      editing.place(frame, document.activeElement === element ? editing.caret() : undefined);
      return;
    }
    placed.current = true;
    editing.place(frame, undefined);
    element.focus({ preventScroll: true });
    editing.put(offset);
  }, [page, shown, id, layout, ready, offset]);

  return (
    <div
      ref={box}
      className="overlay"
      role="textbox"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
    />
  );
}

/**
 * The picker a field's dates open: a month for the start, and for the end a month, the present,
 * or none. Each change is a `dates` command. It sits under the field's first glyph, and closes on
 * Escape, when focus leaves it, or at a click outside it.
 */
function DatePicker({
  field: id,
  shown,
  page,
  layout,
  dates,
  onCommand,
  onClose,
}: OverlayProps & { layout: FieldLayout; dates: Dates | undefined }) {
  const [value, setValue] = useState(dates);
  const [place, setPlace] = useState<{ left: number; top: number }>();
  const root = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const latest = useRef(onClose);
  useLayoutEffect(() => {
    latest.current = onClose;
  });

  useLayoutEffect(() => {
    const ctm = page.querySelector("svg")?.getScreenCTM();
    if (!ctm) return;
    const at = new DOMPoint(layout.x, layout.y).matrixTransform(ctm);
    const box = page.getBoundingClientRect();
    setPlace({
      left: at.x - box.left - page.clientLeft + page.scrollLeft,
      // Below the baseline by the font's descent and a little more.
      top: at.y + 0.35 * layout.size * ctm.a - box.top - page.clientTop + page.scrollTop,
    });
  }, [page, shown, layout]);

  useEffect(() => {
    first.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) latest.current();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  const send = (start: string, end: string | undefined) => {
    const command = datesCommand(id, start, end);
    if (command?.type !== "dates") return;
    setValue(command.dates);
    onCommand(command);
  };
  const start = value?.start ?? "";
  const end = value?.end;
  const month = (date: string | undefined) => (date !== undefined && MONTH.test(date) ? date : "");
  return (
    <div
      ref={root}
      className="date-picker"
      role="dialog"
      style={{
        position: "absolute",
        zIndex: 1,
        left: place?.left,
        top: place?.top,
        display: "flex",
        gap: "0.5em",
        alignItems: "center",
        padding: "0.4em 0.6em",
        background: "#fff",
        border: "1px solid #0a7",
        font: "13px system-ui, sans-serif",
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
      onBlur={(event) => {
        // Focus that goes nowhere is a click, which the listener above judges: Safari focuses no
        // checkbox or button that is clicked, so a click on one inside would read as leaving.
        const next = event.relatedTarget;
        if (next instanceof Node && !root.current?.contains(next)) onClose();
      }}
    >
      <label>
        Start{" "}
        <input
          ref={first}
          type="month"
          value={month(start)}
          onChange={(event) => send(event.target.value, end)}
        />
      </label>
      <label>
        End{" "}
        <input
          type="month"
          value={month(end)}
          disabled={end === "present"}
          onChange={(event) => send(start, event.target.value || undefined)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={end === "present"}
          onChange={(event) => send(start, event.target.checked ? "present" : undefined)}
        />{" "}
        Present
      </label>
      <button type="button" disabled={end === undefined} onClick={() => send(start, undefined)}>
        No end date
      </button>
    </div>
  );
}
