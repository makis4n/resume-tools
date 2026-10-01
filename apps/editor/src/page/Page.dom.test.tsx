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
import type { DviDocument } from "../tex/dvi";
import { glyphOf, glyphText } from "../tex/glyphs";
import { renderPage, US_LETTER } from "../tex/svg";
import { parseTfm } from "../tex/tfm";
import { parseType1 } from "../tex/type1";
import type { DrawnPage, FieldLayout } from "./draw";
import type { PageFont } from "./fonts";
import type { Box } from "./locked";
import { LOCKED_TIP, Page } from "./Page";

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
