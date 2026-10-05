// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Resume } from "@resume-tools/resume-model";
import type { Editor } from "@tiptap/core";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Shown } from "../editor/compiler";
import { type Command, type Document, newDocument } from "../editor/document";
import { Overlay } from "../editor/Overlay";
import { curated } from "../templates/curated";
import type { DviDocument, PageItem } from "../tex/dvi";
import type { Field } from "../tex/fields";
import { glyphOf, glyphText } from "../tex/glyphs";
import { INCH, renderPage, US_LETTER } from "../tex/svg";
import { parseTfm } from "../tex/tfm";
import { parseType1 } from "../tex/type1";
import type { DrawnPage, FieldLayout } from "./draw";
import type { PageFont } from "./fonts";
import type { Box } from "./locked";
import { LOCKED_TIP, Page, Pages, pageSvg } from "./Page";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// An invented page of Jake's sample with an invented part kept as an import keeps one (decision
// 0041): a plain field's glyph, a rich field's, and the locked part's two glyphs and its block.

const PLAIN = "fennel.title";
const RICH = "fennel-2.text";
const LOCKED = "lock-hobbies";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(resolve(import.meta.dirname, "../tex/fixtures", name)));

/** cmr10, from the fixtures, which the overlays set a field in. */
const roman: PageFont = (() => {
  const outlines = parseType1(fixture("cmr10.pfb"));
  return {
    kind: "tex",
    name: "cmr10",
    tfm: parseTfm(fixture("cmr10.tfm")),
    outlines,
    text: (code) =>
      glyphOf(outlines, code) === undefined ? undefined : glyphText(outlines.encoding[code] ?? ""),
  };
})();

/** A field set in cmr10 at 10 pt, its first glyph at `y` down the page. */
const layoutAt = (y: number): FieldLayout => ({
  paragraph: undefined,
  fonts: [{ font: roman, size: 10, glyphs: 1, letters: 1 }],
  font: roman,
  size: 10,
  x: 72,
  y,
  secondLine: undefined,
  baseline: [72],
});

/** The locked part's block, in TeX points. */
const BLOCK: Box = { left: 72, top: 134, right: 300, bottom: 176 };

/** The page, drawn as `renderPage` draws one: a run of four glyphs of an invented font. */
const SVG = (() => {
  const SP = 65536;
  const doc: DviDocument = {
    id: 7,
    numerator: 25_400_000,
    denominator: 473_628_672,
    magnification: 1000,
    comment: "",
    fonts: new Map(),
    nativeFonts: new Map([[1, { id: 1, name: "Invented.otf", index: 0, size: 10 * SP, flags: 0 }]]),
    pages: [
      {
        counters: [],
        items: [
          {
            kind: "native",
            font: 1,
            h: 0,
            v: 30 * SP,
            width: 20 * SP,
            glyphs: [
              { id: 7, x: 0, y: 0 },
              { id: 7, x: 0, y: 20 * SP },
              { id: 7, x: 0, y: 40 * SP },
              { id: 7, x: 10 * SP, y: 40 * SP },
            ],
          },
        ],
      },
    ],
  };
  const glyph = (item: number, glyph: number) => ({ item, glyph, text: "V", offset: 0 });
  return renderPage(doc, doc.pages[0] as DviDocument["pages"][0], {
    outlines: () => undefined,
    native: () => ({ unitsPerEm: 1000, pathOf: () => "M0 0L500 700Z" }),
    fields: new Map([
      [PLAIN, { id: PLAIN, glyphs: [glyph(0, 0)] }],
      [RICH, { id: RICH, glyphs: [glyph(0, 1)] }],
    ]),
    locked: {
      glyphs: new Map([
        ["0:2", LOCKED],
        ["0:3", LOCKED],
      ]),
      blocks: new Map([[LOCKED, [BLOCK]]]),
    },
  });
})();

/** The sample with the invented part after its sections, as an import keeps one. */
const document0: Document = newDocument(
  "jake",
  Resume.parse({
    ...curated("jake").sample,
    sections: [
      ...curated("jake").sample.sections,
      { kind: "locked", id: LOCKED, title: "", role: "other", latex: "\\section*{Hobbies}" },
    ],
  }),
);

const page: DrawnPage = {
  svg: SVG,
  size: US_LETTER,
  fields: new Map([
    [PLAIN, { id: PLAIN, glyphs: [], layout: layoutAt(102) }],
    [RICH, { id: RICH, glyphs: [], layout: layoutAt(122) }],
  ]),
  locked: new Map([[LOCKED, { id: LOCKED, blocks: [BLOCK] }]]),
  glyphs: [],
  pageCount: 1,
  unmatched: 0,
  missingFonts: new Map(),
};

const shown: Shown = {
  page,
  pages: [page],
  body: { latex: "", texts: new Map(), dropped: [], surplus: [] },
  document: document0,
  ms: 0,
};

/**
 * The page and the overlay over it as the app puts them together: a click on a field opens the
 * overlay, plain or rich, a new one for each click; with a button before and after for the tab
 * order, and every click on a field noted.
 */
function Sheet({ clicks }: { clicks: string[] }) {
  const [clicked, setClicked] = useState<{ field: string; offset: number; click: number }>();
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <button type="button">Before</button>
      <div ref={setSheet} style={{ position: "relative" }}>
        <Page
          svg={page.svg}
          locked={page.locked}
          size={page.size}
          onField={(field, offset) => {
            clicks.push(field);
            setClicked({ field, offset, click: clicks.length });
          }}
        />
        {clicked && sheet && (
          <Overlay
            key={clicked.click}
            field={clicked.field}
            offset={clicked.offset}
            document={document0}
            shown={shown}
            page={sheet}
            onCommand={(_: Command) => {}}
            onClose={() => setClicked(undefined)}
          />
        )}
      </div>
      <button type="button">After</button>
    </>
  );
}

describe("a locked part on the page (decision 0041)", () => {
  let host: HTMLElement;
  let root: Root;
  let clicks: string[];
  const ctm = Object.getOwnPropertyDescriptor(SVGElement.prototype, "getScreenCTM");

  beforeAll(() => {
    // jsdom loads no fonts; the web fonts register at once, as a browser's would once built. Nor
    // does it lay out the SVG, so the overlays find no place on it and open unplaced.
    Object.assign(globalThis, {
      FontFace: class {
        load() {
          return Promise.resolve(this);
        }
      },
    });
    Object.defineProperty(window.document, "fonts", { value: { add: () => {} } });
    Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
      value: () => null,
      configurable: true,
    });
  });

  afterAll(() => {
    if (ctm) Object.defineProperty(SVGElement.prototype, "getScreenCTM", ctm);
    else delete (SVGElement.prototype as { getScreenCTM?: unknown }).getScreenCTM;
  });

  beforeEach(() => {
    host = window.document.createElement("div");
    window.document.body.append(host);
    root = createRoot(host);
    clicks = [];
    act(() => root.render(<Sheet clicks={clicks} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  /** The page's element, and the elements of the SVG that carry a field or the part. */
  const pageOf = () => host.querySelector(".page") as HTMLElement;
  const fieldGlyph = (id: string) => host.querySelector(`use[data-field="${id}"]`) as SVGUseElement;
  const lockedGlyphs = () => [...host.querySelectorAll(`use[data-locked="${LOCKED}"]`)];
  const lockedBlock = () => host.querySelector(`rect[data-locked="${LOCKED}"]`) as SVGRectElement;
  const tip = () => host.querySelector('[role="tooltip"]');

  /** A pointer event, as the browser sends one to `target`, from `related` where it came from. */
  function point(type: "pointerover" | "pointerout", target: Element, related?: Element) {
    const init = { bubbles: true, relatedTarget: related ?? null };
    act(() => {
      target.dispatchEvent(
        typeof PointerEvent === "function"
          ? new PointerEvent(type, init)
          : new MouseEvent(type, init),
      );
    });
  }

  const click = (target: Element) =>
    act(() => {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

  /** The plain overlay's rows, open over a field, if they are. */
  const plainOverlay = () => host.querySelector(".overlay[contenteditable]");

  /** The plain overlay's rows, once their web font has registered and they have mounted. */
  async function plainRows(): Promise<Element> {
    for (let tries = 0; tries < 50; tries++) {
      const rows = plainOverlay();
      if (rows) return rows;
      await act(() => new Promise((done) => setTimeout(done, 10)));
    }
    throw new Error("the plain overlay did not mount");
  }

  /** The rich editor's element, once its web font has registered and it has mounted. */
  async function richEditor(): Promise<HTMLElement & { editor: Editor }> {
    for (let tries = 0; tries < 50; tries++) {
      const dom = host.querySelector(".ProseMirror") as (HTMLElement & { editor?: Editor }) | null;
      if (dom?.editor) return dom as HTMLElement & { editor: Editor };
      await act(() => new Promise((done) => setTimeout(done, 10)));
    }
    throw new Error("the rich editor did not mount");
  }

  /** What the Tab key stops at in the document, in order: what is focusable and not left out. */
  const tabStops = (within: ParentNode = window.document) =>
    [...within.querySelectorAll("*")].filter(
      (element) =>
        (element as HTMLElement).tabIndex >= 0 && !(element as HTMLButtonElement).disabled,
    );

  it("marks the part's glyphs and block, and none of them as a field's", () => {
    expect(lockedGlyphs()).toHaveLength(2);
    expect(lockedBlock()).not.toBeNull();
    for (const each of [...lockedGlyphs(), lockedBlock()])
      expect(each.hasAttribute("data-field")).toBe(false);
    expect(tip()).toBeNull();
  });

  it("shows a lock and one line over the part while the pointer is over it, and none off it", () => {
    const [glyph] = lockedGlyphs();
    if (glyph === undefined) throw new Error("no glyph of the part");
    point("pointerover", glyph);
    expect(tip()?.textContent).toBe(LOCKED_TIP);
    // The padlock, drawn, which a screen reader passes over, and the part's block marked.
    expect(tip()?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelectorAll(".locked-block")).toHaveLength(1);
    // Between the part's words, over its block, the lock stays.
    point("pointerover", lockedBlock(), glyph);
    expect(tip()?.textContent).toBe(LOCKED_TIP);
    // Over a field, or the page's own white, it goes.
    point("pointerover", fieldGlyph(PLAIN), lockedBlock());
    expect(tip()).toBeNull();
    expect(host.querySelectorAll(".locked-block")).toHaveLength(0);
    point("pointerover", glyph, fieldGlyph(PLAIN));
    expect(tip()).not.toBeNull();
    point("pointerover", host.querySelector('rect[fill="white"]') as Element, glyph);
    expect(tip()).toBeNull();
    // And off the page altogether.
    point("pointerover", glyph);
    point("pointerout", glyph, window.document.body);
    expect(tip()).toBeNull();
  });

  it("lets the pointer through the lock, which takes no click of its own", () => {
    const [glyph] = lockedGlyphs();
    if (glyph === undefined) throw new Error("no glyph of the part");
    point("pointerover", glyph);
    for (const element of [tip(), ...host.querySelectorAll(".locked-block")])
      expect((element as HTMLElement | null)?.style.pointerEvents).toBe("none");
  });

  it("opens nothing at a click on the part, where a click on a field opens its overlay", async () => {
    for (const target of [...lockedGlyphs(), lockedBlock()]) click(target);
    // Given the time a field's overlay takes to open, none has.
    await act(() => new Promise((done) => setTimeout(done, 50)));
    expect(clicks).toEqual([]);
    expect(plainOverlay()).toBeNull();
    expect(host.querySelector(".ProseMirror")).toBeNull();
    click(fieldGlyph(PLAIN));
    expect(clicks).toEqual([PLAIN]);
    await plainRows();
  });

  it("leaves the plain overlay open on its field at a hover and a click on the part", async () => {
    click(fieldGlyph(PLAIN));
    const open = await plainRows();
    const [glyph] = lockedGlyphs();
    if (glyph === undefined) throw new Error("no glyph of the part");
    point("pointerover", glyph);
    expect(tip()?.textContent).toBe(LOCKED_TIP);
    click(glyph);
    click(lockedBlock());
    // No field opened anew, and the same overlay, the plain one, stays over the same field.
    await act(() => new Promise((done) => setTimeout(done, 50)));
    expect(clicks).toEqual([PLAIN]);
    expect(plainOverlay()).toBe(open);
    expect(host.querySelector(".ProseMirror")).toBeNull();
  });

  it("leaves the rich editor open on its field at a hover and a click on the part", async () => {
    click(fieldGlyph(RICH));
    const editor = await richEditor();
    const runs = editor.editor.getJSON();
    const [glyph] = lockedGlyphs();
    if (glyph === undefined) throw new Error("no glyph of the part");
    point("pointerover", glyph);
    expect(tip()?.textContent).toBe(LOCKED_TIP);
    click(glyph);
    click(lockedBlock());
    await act(() => new Promise((done) => setTimeout(done, 50)));
    expect(clicks).toEqual([RICH]);
    expect(host.querySelector(".ProseMirror")).toBe(editor);
    expect(editor.editor.getJSON()).toEqual(runs);
    expect(plainOverlay()).toBeNull();
  });

  it("gives the part and its lock no tab stop, so that the keyboard passes them by", async () => {
    const [before, after] = [...host.querySelectorAll("button")];
    expect(tabStops()).toEqual([before, after]);
    const [glyph] = lockedGlyphs();
    if (glyph === undefined) throw new Error("no glyph of the part");
    point("pointerover", glyph);
    expect(tip()).not.toBeNull();
    // With the lock shown, the page still has no stop, and nothing of the part takes the focus.
    expect(tabStops()).toEqual([before, after]);
    before?.focus();
    for (const element of [
      ...lockedGlyphs(),
      lockedBlock(),
      tip(),
      ...host.querySelectorAll(".locked-block"),
    ]) {
      (element as HTMLElement | SVGElement | null)?.focus();
      expect(window.document.activeElement).toBe(before);
    }
    // With a field's overlay open, what it adds are its own, and the page adds none.
    click(fieldGlyph(RICH));
    await richEditor();
    expect(tabStops(pageOf())).toEqual([]);
    expect(tabStops().at(0)).toBe(before);
    expect(tabStops().at(-1)).toBe(after);
    // And the probe can fail: an element of the page given a tab stop would be one.
    lockedBlock().setAttribute("tabindex", "0");
    expect(tabStops(pageOf())).toEqual([lockedBlock()]);
    lockedBlock().removeAttribute("tabindex");
  });

  it("places the lock where the SVG draws the part, under an open overlay, and within the page", () => {
    // jsdom lays nothing out: the page, its SVG and the line get the boxes a browser would give
    // them, the SVG drawn 816 pixels across, and the line 400 wide. A part near the page's right
    // edge, whose line would run past it at the part's left.
    const box = (left: number, top: number, width: number, height: number) =>
      ({
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
      }) as DOMRect;
    const width = 400;
    const near: Box = { left: 480, top: 300, right: 560, bottom: 320 };
    const scale = 816 / US_LETTER.width;
    const measured = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect");
    Object.defineProperty(Element.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: Element) {
        if (this.getAttribute("role") === "tooltip") return box(0, 0, width, 18);
        if (this.tagName.toLowerCase() === "svg") return box(110, 230, 816, 1056);
        if (this.classList.contains("page")) return box(100, 200, 900, 1100);
        return box(0, 0, 0, 0);
      },
    });
    try {
      act(() =>
        root.render(
          <Page
            svg={SVG}
            size={US_LETTER}
            locked={new Map([[LOCKED, { id: LOCKED, blocks: [BLOCK, near] }]])}
          />,
        ),
      );
      point("pointerover", lockedBlock());
    } finally {
      if (measured) Object.defineProperty(Element.prototype, "getBoundingClientRect", measured);
    }
    // Each block where the SVG draws it, from the SVG's corner, 10 and 30 pixels into the page.
    const blocks = [...host.querySelectorAll(".locked-block")] as HTMLElement[];
    expect(blocks).toHaveLength(2);
    const at = (element: HTMLElement | undefined, side: "left" | "top" | "width") =>
      Number.parseFloat(element?.style[side] ?? "");
    expect(at(blocks[0], "left")).toBeCloseTo(10 + BLOCK.left * scale, 3);
    expect(at(blocks[0], "top")).toBeCloseTo(30 + BLOCK.top * scale, 3);
    expect(at(blocks[0], "width")).toBeCloseTo((BLOCK.right - BLOCK.left) * scale, 3);
    // The line: above the first block, under a field's overlay, its bar and its pickers, which come
    // after the page at the same height, and at the block's left, which keeps it within the page.
    const line = tip() as HTMLElement;
    expect(line.style.zIndex).toBe("1");
    expect(at(line, "left")).toBeCloseTo(10 + BLOCK.left * scale, 3);
    // Over the part near the right edge, the line moves left as far as it takes to end there.
    act(() =>
      root.render(
        <Page
          svg={SVG}
          size={US_LETTER}
          locked={new Map([[LOCKED, { id: LOCKED, blocks: [near] }]])}
        />,
      ),
    );
    Object.defineProperty(Element.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: Element) {
        if (this.getAttribute("role") === "tooltip") return box(0, 0, width, 18);
        if (this.tagName.toLowerCase() === "svg") return box(110, 230, 816, 1056);
        if (this.classList.contains("page")) return box(100, 200, 900, 1100);
        return box(0, 0, 0, 0);
      },
    });
    try {
      point("pointerout", lockedBlock(), window.document.body);
      point("pointerover", lockedBlock());
    } finally {
      if (measured) Object.defineProperty(Element.prototype, "getBoundingClientRect", measured);
    }
    const moved = tip() as HTMLElement;
    expect(at(moved, "left") + width).toBeCloseTo(10 + 816, 3);
    expect(at(moved, "left")).toBeLessThan(10 + near.left * scale);
  });
});

// An invented document of two pages (decision 0046): on the first, a field and the start of a part
// a page break splits; on the second, the split part's end, a field and a part of its own.

const SPLIT = "lock-split";
const LATER_PART = "lock-later";
const LATER = "header.last";

/** A box around the glyph `row` of an invented page, which sets one glyph a row, 20 pt apart. */
const rowBox = (row: number): Box => ({
  left: 72,
  top: 92 + 20 * row,
  right: 300,
  bottom: 104 + 20 * row,
});

/**
 * The page `index` of the invented document, drawn as `renderPage` draws one, a page after the
 * first naming its shapes apart: one glyph a row, each of a field or a part as `rows` says, and
 * each part's blocks as `blocks` gives them.
 */
function inventedPage(
  index: number,
  rows: { field?: string; locked?: string }[],
  blocks: Map<string, Box[]>,
  fieldLayouts: Map<string, FieldLayout>,
): DrawnPage {
  const SP = 65536;
  const doc: DviDocument = {
    id: 7,
    numerator: 25_400_000,
    denominator: 473_628_672,
    magnification: 1000,
    comment: "",
    fonts: new Map(),
    nativeFonts: new Map([[1, { id: 1, name: "Invented.otf", index: 0, size: 10 * SP, flags: 0 }]]),
    pages: [
      {
        counters: [],
        items: [
          {
            kind: "native",
            font: 1,
            h: 0,
            v: 30 * SP,
            width: 20 * SP,
            glyphs: rows.map((_, row) => ({ id: 7, x: 0, y: 20 * row * SP })),
          },
        ],
      },
    ],
  };
  const fields = new Map(
    rows.flatMap((row, glyph) =>
      row.field === undefined
        ? []
        : [[row.field, { id: row.field, glyphs: [{ item: 0, glyph, text: "V", offset: 0 }] }]],
    ),
  );
  const svg = renderPage(doc, doc.pages[0] as DviDocument["pages"][0], {
    outlines: () => undefined,
    native: () => ({ unitsPerEm: 1000, pathOf: () => "M0 0L500 700Z" }),
    fields,
    locked: {
      glyphs: new Map(
        rows.flatMap((row, glyph) =>
          row.locked === undefined ? [] : [[`0:${glyph}`, row.locked]],
        ),
      ),
      blocks,
    },
    ids: index === 0 ? "" : `p${index}-`,
  });
  return {
    svg,
    size: US_LETTER,
    fields: new Map(
      [...fields].map(([id, field]) => [
        id,
        { ...field, glyphs: [], layout: fieldLayouts.get(id) },
      ]),
    ),
    // Every page holds every part, with no block where it is all on another.
    locked: new Map([SPLIT, LATER_PART].map((id) => [id, { id, blocks: blocks.get(id) ?? [] }])),
    glyphs: [],
    pageCount: 2,
    unmatched: 0,
    missingFonts: new Map(),
  };
}

const PAGES: DrawnPage[] = [
  inventedPage(
    0,
    [{ field: PLAIN }, { locked: SPLIT }, { locked: SPLIT }],
    new Map([[SPLIT, [rowBox(1)]]]),
    new Map([[PLAIN, layoutAt(102)]]),
  ),
  inventedPage(
    1,
    [{ locked: SPLIT }, { field: LATER }, { locked: LATER_PART }],
    new Map([
      [SPLIT, [rowBox(0)]],
      [LATER_PART, [rowBox(2)]],
    ]),
    new Map([[LATER, layoutAt(122)]]),
  ),
];

const shownPages: Shown = { ...shown, page: PAGES[0] as DrawnPage, pages: PAGES };

/** Every page and the overlay over them, as the app puts them together, each click noted. */
function TwoPages({ clicks }: { clicks: string[] }) {
  const [clicked, setClicked] = useState<{ field: string; offset: number; click: number }>();
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <button type="button">Before</button>
      <div ref={setSheet} style={{ position: "relative" }}>
        <Pages
          pages={PAGES}
          onField={(field, offset) => {
            clicks.push(field);
            setClicked({ field, offset, click: clicks.length });
          }}
        />
        {clicked && sheet && (
          <Overlay
            key={clicked.click}
            field={clicked.field}
            offset={clicked.offset}
            document={document0}
            shown={shownPages}
            page={sheet}
            onCommand={(_: Command) => {}}
            onClose={() => setClicked(undefined)}
          />
        )}
      </div>
      <button type="button">After</button>
    </>
  );
}

/** How far down the window the invented second page is drawn, in pixels, the first at its top. */
const SECOND = 1000;

describe("every page on screen (decision 0046)", () => {
  let host: HTMLElement;
  let root: Root;
  let clicks: string[];
  const ctm = Object.getOwnPropertyDescriptor(SVGElement.prototype, "getScreenCTM");
  const point0 = (globalThis as { DOMPoint?: unknown }).DOMPoint;

  beforeAll(() => {
    Object.assign(globalThis, {
      FontFace: class {
        load() {
          return Promise.resolve(this);
        }
      },
    });
    if (!("fonts" in window.document))
      Object.defineProperty(window.document, "fonts", { value: { add: () => {} } });
    // jsdom lays nothing out: each page's SVG is drawn at one pixel a point, the first at the
    // window's top and the second `SECOND` pixels down, as a browser stacks them.
    Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
      configurable: true,
      value(this: SVGElement) {
        const index = Number(this.closest("[data-page]")?.getAttribute("data-page") ?? 0);
        return { a: 1, b: 0, c: 0, d: 1, e: 0, f: index * SECOND };
      },
    });
    if (point0 === undefined)
      Object.assign(globalThis, {
        DOMPoint: class {
          constructor(
            readonly x: number,
            readonly y: number,
          ) {}
          matrixTransform(m: { a: number; b: number; c: number; d: number; e: number; f: number }) {
            return { x: m.a * this.x + m.c * this.y + m.e, y: m.b * this.x + m.d * this.y + m.f };
          }
        },
      });
  });

  afterAll(() => {
    if (ctm) Object.defineProperty(SVGElement.prototype, "getScreenCTM", ctm);
    else delete (SVGElement.prototype as { getScreenCTM?: unknown }).getScreenCTM;
    if (point0 === undefined) delete (globalThis as { DOMPoint?: unknown }).DOMPoint;
  });

  beforeEach(() => {
    host = window.document.createElement("div");
    window.document.body.append(host);
    root = createRoot(host);
    clicks = [];
    act(() => root.render(<TwoPages clicks={clicks} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const pageAt = (index: number) => host.querySelector(`[data-page="${index}"]`) as HTMLElement;
  const fieldGlyph = (id: string) => host.querySelector(`use[data-field="${id}"]`) as SVGUseElement;
  const partGlyphs = (index: number, id: string) => [
    ...pageAt(index).querySelectorAll(`use[data-locked="${id}"]`),
  ];
  const tips = () => [...host.querySelectorAll('[role="tooltip"]')];
  const blocksOn = (index: number) => pageAt(index).querySelectorAll(".locked-block").length;

  function over(target: Element | undefined, related?: Element) {
    if (target === undefined) throw new Error("nothing to point at");
    act(() => {
      target.dispatchEvent(
        new (typeof PointerEvent === "function" ? PointerEvent : MouseEvent)("pointerover", {
          bubbles: true,
          relatedTarget: related ?? null,
        }),
      );
    });
  }

  const click = (target: Element) =>
    act(() => {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

  /** The plain overlay's rows, once placed on the page that shows their field. */
  async function placedRows(): Promise<HTMLElement> {
    for (let tries = 0; tries < 50; tries++) {
      const rows = host.querySelector(".overlay[contenteditable]") as HTMLElement | null;
      if (rows?.style.top) return rows;
      await act(() => new Promise((done) => setTimeout(done, 10)));
    }
    throw new Error("the plain overlay was not placed");
  }

  it("draws every page, one under the other, each with its own glyphs' shapes", () => {
    const pages = [...host.querySelectorAll(".page")];
    expect(pages.map((page) => page.getAttribute("data-page"))).toEqual(["0", "1"]);
    expect(pages.map((page) => page.querySelectorAll("svg use").length)).toEqual([3, 3]);
    // The second page's shapes are its own, so that no id stands twice in the document.
    const ids = [...host.querySelectorAll("svg path[id]")].map((path) => path.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const use of pageAt(1).querySelectorAll("use"))
      expect(use.getAttribute("href")?.startsWith("#p1-")).toBe(true);
    expect(pageSvg(host, 1)?.closest("[data-page]")).toBe(pageAt(1));
    expect(pageSvg(host, 2)).toBeNull();
  });

  it("opens a field on the second page in place, over that page, as one on the first", async () => {
    click(fieldGlyph(LATER));
    expect(clicks).toEqual([LATER]);
    const later = Number.parseFloat((await placedRows()).style.top);
    // Its first glyph at 122 pt down its page, which is drawn `SECOND` pixels down.
    expect(later).toBeGreaterThan(SECOND + 100);
    expect(later).toBeLessThan(SECOND + 122);
    act(() => (window.document.activeElement as HTMLElement | null)?.blur());
    click(fieldGlyph(PLAIN));
    const first = Number.parseFloat((await placedRows()).style.top);
    // The two fields' first glyphs are 20 pt apart down their pages, and the pages `SECOND` apart.
    expect(later - first).toBeCloseTo(SECOND + 20, 3);
  });

  it("shows the lock of a part on the second page over it, and opens nothing at a click", async () => {
    const [glyph] = partGlyphs(1, LATER_PART);
    over(glyph);
    expect(tips().map((tip) => tip.textContent)).toEqual([LOCKED_TIP]);
    expect(pageAt(1).querySelector('[role="tooltip"]')).not.toBeNull();
    expect([blocksOn(0), blocksOn(1)]).toEqual([0, 1]);
    if (glyph) click(glyph);
    await act(() => new Promise((done) => setTimeout(done, 50)));
    expect(clicks).toEqual([]);
    expect(host.querySelector(".overlay")).toBeNull();
    // Over the second page's field, it goes.
    over(fieldGlyph(LATER), glyph);
    expect(tips()).toEqual([]);
  });

  it("shows the lock of a part a page break splits on both pages, its line over its start", () => {
    for (const glyph of [partGlyphs(1, SPLIT)[0], partGlyphs(0, SPLIT)[1]]) {
      over(glyph);
      // A block on each page, and one line, on the first page, where the part starts.
      expect([blocksOn(0), blocksOn(1)]).toEqual([1, 1]);
      expect(tips()).toHaveLength(1);
      expect(pageAt(0).querySelector('[role="tooltip"]')?.textContent).toBe(LOCKED_TIP);
      over(pageAt(1).querySelector('rect[fill="white"]') ?? undefined, glyph);
      expect([blocksOn(0), blocksOn(1), tips().length]).toEqual([0, 0, 0]);
    }
  });

  it("gives the pages no tab stop, however many there are", () => {
    const stops = [...host.querySelectorAll("*")].filter(
      (element) => (element as HTMLElement).tabIndex >= 0,
    );
    expect(stops.map((element) => element.textContent)).toEqual(["Before", "After"]);
  });
});

// The first click on a field that seemed to miss (the owner's decision of 2026-10-05). An invented
// document of two pages, the window scrolled down to the second, which sets a field of two words
// in a TeX font, as pdfTeX sets a name, a kept part's glyph after it on its line, and under them a
// field of two words in a native font, as XeTeX sets a bullet. The space between two words is no
// glyph, and a glyph takes a click only within its ink's box, so a click between the words lands
// on the page's white, as the browser said of the click that missed.

const KEPT = "lock-after";
/** The two lines' baselines, down the page from the DVI origin, in points. */
const TEX_LINE = 30;
const NATIVE_LINE = 50;
/**
 * The TeX field's glyphs' origins: two words of four glyphs, each five points wide, the first word
 * ending at 20 points and the second starting at 26.
 */
const TEX_X = [0, 5, 10, 15, 26, 31, 36, 41];
/** Where each of the TeX field's glyphs is in its text: the space between its words is at 4. */
const TEX_OFFSETS = [0, 1, 2, 3, 5, 6, 7, 8];
/** The kept part's glyph, after the field on its line. */
const KEPT_X = 60;
/** The native field's glyphs' origins, which give no width, and where each is in its text. */
const NATIVE_X = [0, 6, 18, 24];
const NATIVE_OFFSETS = [0, 1, 3, 4];

/** The two pages: the first with nothing on it, and the second with the two fields. */
const WORD_PAGES: DrawnPage[] = (() => {
  const SP = 65536;
  const cmr10 = parseType1(fixture("cmr10.pfb"));
  const letter = (code: number, h: number): PageItem => ({
    kind: "glyph",
    font: 1,
    code,
    h: h * SP,
    v: TEX_LINE * SP,
    width: 5 * SP,
  });
  const items: PageItem[] = [
    ...TEX_X.map((h, index) => letter(97 + index, h)),
    letter(122, KEPT_X),
    {
      kind: "native",
      font: 2,
      h: 0,
      v: NATIVE_LINE * SP,
      width: 30 * SP,
      glyphs: NATIVE_X.map((x) => ({ id: 7, x: x * SP, y: 0 })),
    },
  ];
  const doc: DviDocument = {
    id: 8,
    numerator: 25_400_000,
    denominator: 473_628_672,
    magnification: 1000,
    comment: "",
    fonts: new Map([[1, { id: 1, name: "cmr10", checksum: 0, scale: 10 * SP, design: 10 * SP }]]),
    nativeFonts: new Map([[2, { id: 2, name: "Invented.otf", index: 0, size: 10 * SP, flags: 0 }]]),
    pages: [
      { counters: [], items: [] },
      { counters: [], items },
    ],
  };
  const run = TEX_X.length + 1;
  const fields = new Map<string, Field>([
    [
      PLAIN,
      {
        id: PLAIN,
        glyphs: TEX_X.map((_, item) => ({ item, text: "a", offset: TEX_OFFSETS[item] ?? 0 })),
      },
    ],
    [
      LATER,
      {
        id: LATER,
        glyphs: NATIVE_X.map((_, glyph) => ({
          item: run,
          glyph,
          text: "v",
          offset: NATIVE_OFFSETS[glyph] ?? 0,
        })),
      },
    ],
  ]);
  const block: Box = {
    left: INCH + KEPT_X - 1,
    top: INCH + TEX_LINE - 8,
    right: INCH + KEPT_X + 6,
    bottom: INCH + TEX_LINE + 3,
  };
  return doc.pages.map((each, index): DrawnPage => {
    const second = index === 1;
    return {
      svg: renderPage(doc, each, {
        outlines: (name) => (name === "cmr10" ? cmr10 : undefined),
        native: () => ({ unitsPerEm: 1000, pathOf: () => "M0 0L500 700Z" }),
        ...(second ? { fields } : {}),
        locked: {
          glyphs: new Map(second ? [[String(TEX_X.length), KEPT]] : []),
          blocks: new Map(second ? [[KEPT, [block]]] : []),
        },
        ids: index === 0 ? "" : `p${index}-`,
      }),
      size: US_LETTER,
      fields: second
        ? new Map([
            [PLAIN, { id: PLAIN, glyphs: [], layout: layoutAt(INCH + TEX_LINE) }],
            [LATER, { id: LATER, glyphs: [], layout: layoutAt(INCH + NATIVE_LINE) }],
          ])
        : new Map(),
      locked: new Map([[KEPT, { id: KEPT, blocks: second ? [block] : [] }]]),
      glyphs: [],
      pageCount: 2,
      unmatched: 0,
      missingFonts: new Map(),
    };
  });
})();

const shownWords: Shown = { ...shown, page: WORD_PAGES[0] as DrawnPage, pages: WORD_PAGES };

/** Every page and the overlay over them, as the app puts them together, each click noted. */
function WordPages({ clicks }: { clicks: [string, number][] }) {
  const [clicked, setClicked] = useState<{ field: string; offset: number; click: number }>();
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setSheet} style={{ position: "relative" }}>
      <Pages
        pages={WORD_PAGES}
        onField={(field, offset) => {
          clicks.push([field, offset]);
          setClicked({ field, offset, click: clicks.length });
        }}
      />
      {clicked && sheet && (
        <Overlay
          key={clicked.click}
          field={clicked.field}
          offset={clicked.offset}
          document={document0}
          shown={shownWords}
          page={sheet}
          onCommand={(_: Command) => {}}
          onClose={() => setClicked(undefined)}
        />
      )}
    </div>
  );
}

describe("a click between a field's glyphs, the window scrolled (the first click that missed)", () => {
  let host: HTMLElement;
  let root: Root;
  let clicks: [string, number][];
  /** How far down the window is scrolled, in pixels. */
  let scrolled = 0;
  const ctm = Object.getOwnPropertyDescriptor(SVGElement.prototype, "getScreenCTM");
  const rect = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect");
  const point0 = (globalThis as { DOMPoint?: unknown }).DOMPoint;

  beforeAll(() => {
    Object.assign(globalThis, {
      FontFace: class {
        load() {
          return Promise.resolve(this);
        }
      },
    });
    if (!("fonts" in window.document))
      Object.defineProperty(window.document, "fonts", { value: { add: () => {} } });
    // jsdom lays nothing out: each page's SVG is drawn at a pixel a point, the second `SECOND`
    // pixels under the first, and the window scrolled down by `scrolled` moves everything up.
    Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
      configurable: true,
      value(this: SVGElement) {
        const index = Number(this.closest("[data-page]")?.getAttribute("data-page") ?? 0);
        return { a: 1, b: 0, c: 0, d: 1, e: 0, f: index * SECOND - scrolled };
      },
    });
    Object.defineProperty(Element.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          left: 0,
          top: -scrolled,
          width: 900,
          height: 2 * SECOND,
          x: 0,
          y: -scrolled,
        }) as DOMRect,
    });
    if (point0 === undefined)
      Object.assign(globalThis, {
        DOMPoint: class {
          constructor(
            readonly x: number,
            readonly y: number,
          ) {}
          matrixTransform(m: { a: number; b: number; c: number; d: number; e: number; f: number }) {
            return { x: m.a * this.x + m.c * this.y + m.e, y: m.b * this.x + m.d * this.y + m.f };
          }
        },
      });
  });

  afterAll(() => {
    if (ctm) Object.defineProperty(SVGElement.prototype, "getScreenCTM", ctm);
    else delete (SVGElement.prototype as { getScreenCTM?: unknown }).getScreenCTM;
    if (rect) Object.defineProperty(Element.prototype, "getBoundingClientRect", rect);
    if (point0 === undefined) delete (globalThis as { DOMPoint?: unknown }).DOMPoint;
  });

  beforeEach(() => {
    scrolled = 0;
    host = window.document.createElement("div");
    window.document.body.append(host);
    root = createRoot(host);
    clicks = [];
    act(() => root.render(<WordPages clicks={clicks} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const second = () => host.querySelector('[data-page="1"]') as HTMLElement;

  /**
   * A click on the second page at `x` points along a line from the DVI origin and `above` points
   * over its `baseline`, as the browser sends one: to the element under it, which `on` names, the
   * page's white unless said, and with where it is in the window, scrolled as it is.
   */
  function clickAt(x: number, baseline: number, above = 3, on?: Element | null) {
    const target = on ?? second().querySelector('rect[fill="white"]');
    if (!target) throw new Error("nothing to click on");
    act(() => {
      target.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: INCH + x,
          clientY: SECOND - scrolled + INCH + baseline - above,
        }),
      );
    });
  }

  /** The plain overlay's rows, once placed on the page that shows their field. */
  async function placedRows(): Promise<HTMLElement> {
    for (let tries = 0; tries < 50; tries++) {
      const rows = host.querySelector(".overlay[contenteditable]") as HTMLElement | null;
      if (rows?.style.top) return rows;
      await act(() => new Promise((done) => setTimeout(done, 10)));
    }
    throw new Error("the plain overlay was not placed");
  }

  /** Close the open field, as a click elsewhere does. */
  const leave = () => act(() => (window.document.activeElement as HTMLElement | null)?.blur());

  it("opens a field at the first click between its words, after a scroll to its page", async () => {
    scrolled = SECOND;
    // Between the TeX field's two words: past the first, which ends at 20 points, and before the
    // second, which starts at 26.
    clickAt(23, TEX_LINE);
    expect(clicks).toEqual([[PLAIN, 5]]);
    // Over the field on the second page, where the window has scrolled it to.
    const top = Number.parseFloat((await placedRows()).style.top);
    expect(top).toBeGreaterThan(SECOND + INCH + TEX_LINE - 20);
    expect(top).toBeLessThan(SECOND + INCH + TEX_LINE);
    // Above a short letter, the second, within its width, from 5 points to 10: the letter's.
    leave();
    clickAt(7.5, TEX_LINE, 7);
    expect(clicks.at(-1)).toEqual([PLAIN, 1]);
  });

  it("opens a field set in a native font, whose glyphs give no width, between its words", async () => {
    scrolled = SECOND;
    // Past half a size after the first word's last glyph, at 6, and before the second word's, at 18.
    clickAt(15, NATIVE_LINE);
    expect(clicks).toEqual([[LATER, 3]]);
    await placedRows();
  });

  it("opens nothing off a field's line, past its end, or on a kept part's glyph beside it", async () => {
    scrolled = SECOND;
    // Past the field's end, at 46 points, and before the kept part's glyph, at 60; between the
    // lines; and far off both.
    clickAt(53, TEX_LINE);
    clickAt(26, (TEX_LINE + NATIVE_LINE) / 2);
    clickAt(300, TEX_LINE);
    // On the kept part's glyph, and on its block beside it, on the field's line: the part's.
    const kept = second().querySelector(`use[data-locked="${KEPT}"]`);
    clickAt(KEPT_X, TEX_LINE, 3, kept);
    clickAt(KEPT_X + 5, TEX_LINE, 3, second().querySelector(`rect[data-locked="${KEPT}"]`));
    await act(() => new Promise((done) => setTimeout(done, 50)));
    expect(clicks).toEqual([]);
    expect(host.querySelector(".overlay")).toBeNull();
  });
});
