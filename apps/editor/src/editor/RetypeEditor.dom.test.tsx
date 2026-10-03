// @vitest-environment jsdom
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DrawnPage, GlyphBox } from "../page/draw";
import { LOCKED_TIP, Pages, RETYPE_TIP } from "../page/Page";
import { curated } from "../templates/curated";
import { type Document, History, newDocument } from "./document";
import { NOT_YET, Panel } from "./Panel";
import { CHECKING, RetypeEditor, WAITING } from "./RetypeEditor";
import { isRetype, RETYPE_REFUSED, RetypeGuard, type RetypeVerdict, retypesOf } from "./retype";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// An invented resume with two parts kept as an import keeps them (decision 0025): a heading whose
// words are plain text, and a chart whose labels a command builds, which offers nothing; the page
// and the compiles are the test's own, put together with the editor as the app puts them.

const HEADING = String.raw`\begin{center}\textbf{Quill Invented} \\ \small 555-0100\end{center}`;
const CHART = String.raw`\wheelchart{1cm}{6/Sleep}`;

function documentOf(): Document {
  const document = newDocument("jake", curated("jake").sample);
  return {
    ...document,
    resume: {
      ...document.resume,
      sections: [
        { kind: "locked", id: "lock-heading", title: "", role: "other", latex: HEADING },
        { kind: "locked", id: "lock-chart", title: "", role: "other", latex: CHART },
      ],
    },
  };
}

/** One glyph box for each character of `text` but spaces, of the part `part`, along a line. */
function glyphsOf(part: string, text: string, y: number): GlyphBox[] {
  return [...text.replace(/\s/g, "")].map((char, index) => ({
    x: 72 + 6 * index,
    y,
    left: 72 + 6 * index,
    top: y - 8,
    right: 78 + 6 * index,
    bottom: y,
    font: "cmr10",
    size: 10,
    locked: part,
    text: char,
  }));
}

/** A page whose heading reads `name`, and whose chart sets two icons, which the page cannot read. */
function pageOf(name: string): DrawnPage {
  const glyphs = [
    ...glyphsOf("lock-heading", `${name} 555-0100`, 100),
    ...glyphsOf("lock-chart", "??", 200).map((glyph) => ({ ...glyph, text: undefined })),
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 612 792" width="612" height="792">${glyphs
    .map(
      (glyph) =>
        `<rect data-locked="${glyph.locked}" x="${glyph.left}" y="${glyph.top}" width="6" height="8"/>`,
    )
    .join("")}</svg>`;
  return {
    svg,
    size: { width: 612, height: 792 },
    fields: new Map(),
    locked: new Map([
      [
        "lock-heading",
        { id: "lock-heading", blocks: [{ left: 72, top: 92, right: 300, bottom: 100 }] },
      ],
      [
        "lock-chart",
        { id: "lock-chart", blocks: [{ left: 72, top: 192, right: 90, bottom: 200 }] },
      ],
    ]),
    glyphs,
    pageCount: 1,
    unmatched: 0,
    missingFonts: new Map(),
  };
}

/** What the test's compile of a retyped document comes to: its page, or the compile stopping. */
type Compiled = { page: DrawnPage; output: Uint8Array } | "stopped";

/**
 * The page, the side panel's rows of the parts, and the retype's editor, with the history, the guard
 * and an undo, wired as the app wires them; the compile and the check outside the part are the
 * test's.
 */
function Editor({
  compile,
  outside,
  saved,
}: {
  compile: (document: Document) => Promise<Compiled>;
  outside: () => boolean;
  saved: Document[];
}) {
  const history = useRef(new History(documentOf())).current;
  const guard = useRef(new RetypeGuard(async () => outside())).current;
  const [shown, setShown] = useState<{
    document: Document;
    pages: DrawnPage[];
    output: Uint8Array;
  }>({
    document: history.present,
    pages: [pageOf("Quill Invented")],
    output: new Uint8Array([0]),
  });
  const [present, setPresent] = useState(history.present);
  const [retyping, setRetyping] = useState<{ part: string; checking: boolean; message?: string }>();
  const retypes = retypesOf(shown.document, shown.pages);
  const settle = (verdict: RetypeVerdict, next?: typeof shown) => {
    setPresent(history.present);
    if (verdict.kept) {
      if (next !== undefined) setShown(next);
      saved.push(history.present);
      setRetyping(undefined);
    } else
      setRetyping(
        (current) =>
          current && { ...current, checking: false, message: RETYPE_REFUSED[verdict.why] },
      );
  };
  const keep = async (texts: string[]) => {
    const found = retyping && retypes.get(retyping.part);
    if (retyping === undefined || found === undefined || !isRetype(found)) return;
    const after = guard.start(history, found, texts, shown);
    if (after === "unchanged") return setRetyping(undefined);
    if ("why" in after) return;
    setPresent(after);
    setRetyping({ part: retyping.part, checking: true });
    const compiled = await compile(after);
    if (compiled === "stopped") {
      const verdict = guard.stopped(after);
      if (verdict) settle(verdict);
      return;
    }
    const next = { document: after, pages: [compiled.page], output: compiled.output };
    const verdict = await guard.paged(next);
    if (verdict) settle(verdict, next);
  };
  const found = retyping === undefined ? undefined : retypes.get(retyping.part);
  const retypable = new Set([...retypes].flatMap(([part, each]) => (isRetype(each) ? [part] : [])));
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          history.undo();
          setPresent(history.present);
          setShown((current) => ({ ...current, document: history.present }));
        }}
      >
        Undo
      </button>
      <Pages
        pages={shown.pages}
        retypable={retypable}
        onLocked={(part) => setRetyping({ part, checking: false })}
        {...(retyping !== undefined && found !== undefined && isRetype(found)
          ? {
              editing: {
                part: retyping.part,
                editor: (
                  <RetypeEditor
                    key={retyping.part}
                    pieces={found.pieces}
                    ready={shown.document === present}
                    checking={retyping.checking}
                    {...(retyping.message === undefined ? {} : { message: retyping.message })}
                    onKeep={(texts) => void keep(texts)}
                    onCancel={() => {
                      guard.cancel();
                      setPresent(history.present);
                      setRetyping(undefined);
                    }}
                  />
                ),
              },
            }
          : {})}
      />
      <Panel
        document={present}
        retypes={
          new Map(
            [...retypes].map(([part, each]) => [part, isRetype(each) ? undefined : each.reason]),
          )
        }
        onRetype={(part) => setRetyping({ part, checking: false })}
        onCommand={() => {}}
        onSeal={() => {}}
      />
      <output data-testid="latex">
        {present.resume.sections
          .map((section) => (section.kind === "locked" ? section.latex : ""))
          .join("\n")}
      </output>
    </div>
  );
}

describe("retyping a locked part's words (decision 0042)", () => {
  let host: HTMLElement;
  let root: Root;
  let saved: Document[];
  /** The next compile's outcome, which the test settles, and whether the page outside is kept. */
  let settleCompile: ((compiled: Compiled) => void) | undefined;
  let outsideKept: boolean;

  beforeEach(() => {
    host = window.document.createElement("div");
    window.document.body.append(host);
    root = createRoot(host);
    saved = [];
    outsideKept = true;
    act(() =>
      root.render(
        <Editor
          compile={() =>
            new Promise<Compiled>((resolve) => {
              settleCompile = resolve;
            })
          }
          outside={() => outsideKept}
          saved={saved}
        />,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const editor = () => host.querySelector("form.retype") as HTMLFormElement | null;
  const inputs = () => [...host.querySelectorAll<HTMLInputElement>("form.retype input")];
  const button = (name: string) =>
    [...host.querySelectorAll("button")].find(
      (each) => each.textContent === name,
    ) as HTMLButtonElement;
  const latex = () => host.querySelector('[data-testid="latex"]')?.textContent ?? "";
  const part = (id: string) => host.querySelector(`rect[data-locked="${id}"]`) as Element;

  function type(input: HTMLInputElement, text: string) {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      set?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const click = (target: Element) =>
    act(() => {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  async function landed(compiled: Compiled) {
    await act(async () => {
      settleCompile?.(compiled);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("opens the editor at a click on a part whose words are plain text, its runs as the page shows them", () => {
    act(() => {
      part("lock-heading").dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    expect(host.querySelector('[role="tooltip"]')?.textContent).toBe(RETYPE_TIP);
    click(part("lock-heading"));
    expect(editor()).not.toBeNull();
    expect(inputs().map((input) => input.value)).toEqual(["Quill Invented", "555-0100"]);
    expect(window.document.activeElement).toBe(inputs()[0]);
    // Under the part's first block, on its page; and never a line of its LaTeX.
    expect(editor()?.closest(".retype-place")?.closest(".page")).not.toBeNull();
    expect(editor()?.textContent).not.toMatch(/[\\{}]/);
  });

  it("opens nothing at a part whose words are not plain text, which says why", () => {
    act(() => {
      part("lock-chart").dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    expect(host.querySelector('[role="tooltip"]')?.textContent).toBe(LOCKED_TIP);
    click(part("lock-chart"));
    expect(editor()).toBeNull();
    const buttons = [...host.querySelectorAll("button")].filter(
      (each) => each.textContent === "Change words",
    );
    expect(buttons.map((each) => [each.disabled, each.title])).toEqual([
      [false, ""],
      [
        true,
        "Its words are not written as plain text in your file, so they cannot be changed here.",
      ],
    ]);
    expect(NOT_YET).not.toMatch(/[\\{}]/);
  });

  it("retypes, checks and keeps the words, saved once the page passes, and undo takes them back", async () => {
    click(button("Change words"));
    const [name] = inputs();
    if (name === undefined) throw new Error("no input");
    type(name, "Wren Invented");
    click(button("Keep"));
    // Applied, unsaved, while its page is checked.
    expect(host.textContent).toContain(CHECKING);
    expect(button("Keep").disabled).toBe(true);
    expect(latex()).toContain("Wren Invented");
    expect(saved).toEqual([]);
    await landed({ page: pageOf("Wren Invented"), output: new Uint8Array([1]) });
    expect(editor()).toBeNull();
    expect(saved).toHaveLength(1);
    expect(latex()).toContain(String.raw`\textbf{Wren Invented} \\ \small 555-0100`);
    click(button("Undo"));
    expect(latex()).toContain("Quill Invented");
  });

  it("takes back words that move the page outside the part, says why, and keeps what was typed", async () => {
    outsideKept = false;
    click(part("lock-heading"));
    const [name] = inputs();
    if (name === undefined) throw new Error("no input");
    type(name, "Wren Invented Wren Invented Wren Invented");
    click(button("Keep"));
    await landed({
      page: pageOf("Wren Invented Wren Invented Wren Invented"),
      output: new Uint8Array([1]),
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(RETYPE_REFUSED.moved);
    expect(latex()).toContain("Quill Invented");
    expect(saved).toEqual([]);
    expect(inputs()[0]?.value).toBe("Wren Invented Wren Invented Wren Invented");
  });

  it("takes back words whose compile stopped, and closes on Escape", async () => {
    click(part("lock-heading"));
    const [, phone] = inputs();
    if (phone === undefined) throw new Error("no input");
    type(phone, "555-0199");
    click(button("Keep"));
    await landed("stopped");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(RETYPE_REFUSED.stopped);
    expect(latex()).toContain("555-0100");
    act(() => {
      editor()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(editor()).toBeNull();
  });

  it("waits while the page is not the document's", () => {
    const pieces = [{ text: "Quill Invented" }];
    act(() =>
      root.render(
        <RetypeEditor
          pieces={pieces}
          ready={false}
          checking={false}
          onKeep={() => {}}
          onCancel={() => {}}
        />,
      ),
    );
    expect(host.textContent).toContain(WAITING);
    expect(button("Keep").disabled).toBe(true);
  });
});
