// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RichText } from "@resume-tools/resume-model";
import type { Editor } from "@tiptap/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DrawnPage, FieldLayout } from "../page/draw";
import type { PageFont } from "../page/fonts";
import { curated } from "../templates/curated";
import type { Fold } from "../tex/fields";
import { glyphOf, glyphText } from "../tex/glyphs";
import { parseTfm } from "../tex/tfm";
import { parseType1 } from "../tex/type1";
import type { Shown } from "./compiler";
import { apply, type Command, type Document, fieldsOf, newDocument } from "./document";
import { Overlay } from "./Overlay";
import { BREAKS } from "./RichOverlay";
import { docToRuns } from "./rich";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = (name: string) =>
  new Uint8Array(readFileSync(resolve(import.meta.dirname, "../tex/fixtures", name)));

/** A page font of the fixtures' metrics `tfm`, drawn with cmr10's outlines, named `name`. */
function fontOf(name: string, tfm: string): PageFont {
  const outlines = parseType1(fixture("cmr10.pfb"));
  return {
    kind: "tex",
    name,
    tfm: parseTfm(fixture(`${tfm}.tfm`)),
    outlines,
    text: (code) =>
      glyphOf(outlines, code) === undefined ? undefined : glyphText(outlines.encoding[code] ?? ""),
  };
}

const ID = "fennel-2.text";

/** The paragraph special of a bullet in Jake's `\resumeItem`, as `\rt@par` writes it. */
const SPECIAL =
  `rt:p:${ID}:hsize=542.02501pt;leftskip=0.0pt;rightskip=0.0pt plus 1.0fil;` +
  "parfillskip=0.0pt plus 1.0fil;pretolerance=100;tolerance=200;emergencystretch=0.0pt;" +
  "hangindent=0.0pt;hangafter=1;parshape=1;inner=0;shape=34.93008pt,507.09492pt;" +
  "spaceskip=0.0pt;xspaceskip=0.0pt";

/**
 * A page that sets the field's text of `document` in `font`, every glyph of it, in the case the
 * page folds it to when `folded` is given.
 */
function shownIn(font: PageFont, document: Document, folded?: Fold): Shown {
  const field = fieldsOf(document.resume).get(ID);
  const runs = field?.kind === "rich" ? field.get(document.resume) : [];
  const text = runs.map((run) => run.text).join("");
  const layout: FieldLayout = {
    paragraph: SPECIAL,
    fonts: [{ font, size: 10, glyphs: text.length, letters: text.length }],
    font,
    size: 10,
    x: 72,
    y: 100,
    secondLine: undefined,
    baseline: [72],
    ...(folded === undefined ? {} : { folded }),
  };
  const page: DrawnPage = {
    svg: "",
    size: { width: 612, height: 792 },
    fields: new Map([[ID, { id: ID, glyphs: [], layout }]]),
    glyphs: [...text].map((_, offset) => ({
      ...{ x: 72 + 5 * offset, y: 100, left: 0, top: 0, right: 0, bottom: 0 },
      ...{ font: font.name, size: 10, field: ID, offset },
    })),
    pageCount: 1,
    unmatched: 0,
    missingFonts: new Map(),
  };
  return { page, body: { latex: "", texts: new Map(), dropped: [], surplus: [] }, document, ms: 0 };
}

/** The runs a document holds for the field. */
function runsIn(document: Document): RichText {
  const field = fieldsOf(document.resume).get(ID);
  return field?.kind === "rich" ? field.get(document.resume) : [];
}

describe("a rich field open in its editor", () => {
  const roman = fontOf("cmr10", "cmr10");
  // A page whose letter font the field has not had yet, as when most of it is made bold.
  const bold = fontOf("cmbx10", "cmbx10");
  let host: HTMLElement;
  let root: Root;
  let commands: Command[];
  let closed: number;
  let document0: Document;

  beforeAll(() => {
    // jsdom loads no fonts; the web fonts register at once, as a browser's would once built.
    Object.assign(globalThis, {
      FontFace: class {
        load() {
          return Promise.resolve(this);
        }
      },
    });
    Object.defineProperty(window.document, "fonts", { value: { add: () => {} } });
  });

  beforeEach(() => {
    host = window.document.createElement("div");
    window.document.body.append(host);
    root = createRoot(host);
    commands = [];
    closed = 0;
    document0 = newDocument("jake", curated("jake").sample);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function show(document: Document, shown: Shown) {
    act(() =>
      root.render(
        <Overlay
          field={ID}
          offset={4}
          document={document}
          shown={shown}
          page={host}
          onCommand={(command) => commands.push(command)}
          onClose={() => closed++}
        />,
      ),
    );
  }

  /** The editor's element, once its web font has registered and it has mounted. */
  async function mounted(): Promise<HTMLElement & { editor: Editor }> {
    for (let tries = 0; tries < 50; tries++) {
      const dom = host.querySelector(".ProseMirror") as (HTMLElement & { editor?: Editor }) | null;
      if (dom?.editor) return dom as HTMLElement & { editor: Editor };
      await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    }
    throw new Error("the rich editor did not mount");
  }

  /** Type `text` at the end of the field, as a keystroke's transaction does. */
  function type(editor: Editor, text: string) {
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText(text, editor.state.doc.content.size - 1));
    });
  }

  it("keeps its editor and its text when a page brings a letter font it has not had", async () => {
    show(document0, shownIn(roman, document0));
    const dom = await mounted();
    const { editor } = dom;
    type(editor, " Twice.");
    act(() => {
      editor.chain().selectAll().toggleBold().run();
    });
    // The app applies each command, and the page it compiles sets most of the field in bold.
    const edited = commands.reduce(apply, document0);
    show(edited, shownIn(bold, edited));
    expect(host.querySelector(".ProseMirror")).toBe(dom);
    const typed = [
      {
        text: "Led the migration of three services to a shared queue, which halved on-call pages. Twice.",
        bold: true,
      },
    ];
    expect(docToRuns(editor.state.doc)).toEqual(typed);
    type(editor, "!");
    expect(commands.at(-1)).toEqual({
      type: "rich",
      field: ID,
      runs: [{ ...typed[0], text: `${typed[0]?.text}!` }],
    });
    expect(closed).toBe(0);
  });

  it("shows a field the page sets in capitals in capitals, measured so, and keeps its runs' case", async () => {
    show(document0, shownIn(roman, document0));
    const { editor } = await mounted();
    const style = () => host.querySelector("style")?.textContent ?? "";
    const spacing = () => BREAKS.getState(editor.state)?.rows[0]?.wordSpacingSp;
    expect(style()).toContain(".ProseMirror { text-transform: none; }");
    expect(spacing()).toBe(0);
    // A page that sets the field through \MakeUppercase, as the class's next compile may.
    show(document0, shownIn(roman, document0, "upper"));
    expect(style()).toContain(".ProseMirror { text-transform: uppercase; }");
    // In capitals the bullet is wider, so TeX shrinks its line's spaces to fit it, as the rows do.
    expect(BREAKS.getState(editor.state)?.rows).toHaveLength(1);
    expect(spacing()).toBeLessThan(0);
    // The runs keep their own case, and so does what the user types.
    expect(docToRuns(editor.state.doc)).toEqual(runsIn(document0));
    type(editor, " Twice.");
    const sent = commands.at(-1);
    expect(sent?.type === "rich" && sent.runs.at(-1)?.text.endsWith("pages. Twice.")).toBe(true);
    expect(closed).toBe(0);
  });

  it("opens on the field's runs as the document holds them, not as they were when clicked", async () => {
    show(document0, shownIn(roman, document0));
    // Before the editor mounts, the side panel sets the field's text.
    const changed = apply(document0, {
      type: "rich",
      field: ID,
      runs: [{ text: "Led the move to a shared queue.", italic: true }],
    });
    show(changed, shownIn(roman, document0));
    const { editor } = await mounted();
    expect(docToRuns(editor.state.doc)).toEqual(runsIn(changed));
  });

  it("closes, rather than write over it, when the field changed under it", async () => {
    show(document0, shownIn(roman, document0));
    const { editor } = await mounted();
    type(editor, " Twice.");
    const edited = commands.reduce(apply, document0);
    show(edited, shownIn(roman, edited));
    type(editor, " Thrice.");
    const again = commands.reduce(apply, document0);
    show(again, shownIn(roman, again));
    expect(closed).toBe(0);
    // Something else sets the field's text, and the next keystroke must not undo it.
    const underneath = apply(again, {
      type: "rich",
      field: ID,
      runs: [{ text: "Rewritten in the panel." }],
    });
    show(underneath, shownIn(roman, again));
    const sent = commands.length;
    type(editor, "!");
    expect(commands).toHaveLength(sent);
    expect(closed).toBeGreaterThan(0);
  });
});
