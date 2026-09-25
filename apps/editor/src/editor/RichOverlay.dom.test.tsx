// @vitest-environment jsdom
import type { RichText } from "@resume-tools/resume-model";
import type { Editor } from "@tiptap/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Command } from "./document";
import { RichOverlay } from "./RichOverlay";
import { docToRuns } from "./rich";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** One row of the whole text, which is all these tests need of TeX's lines. */
const oneRow = (runs: RichText) => [
  { from: 0, to: runs.reduce((sum, run) => sum + run.text.length, 0), wordSpacingSp: 0 },
];

/**
 * A clipboard or a drag's data holding `plain` as text and `html` as HTML, which says whether
 * the HTML was ever asked for.
 */
function transfer(plain: string, html: string) {
  const data = {
    htmlRead: false,
    getData(type: string) {
      if (type === "text/html") {
        data.htmlRead = true;
        return html;
      }
      return type === "text/plain" ? plain : "";
    },
  };
  return data;
}

/**
 * A hostile page's copy: a rule the browser matches against every pasted element, and 20,000 of
 * them, 500 KB in all, which ProseMirror would parse and style before any handler of the editor's.
 */
const HOSTILE =
  "<style>div:has(~ div ~ div ~ p){color:red}</style>" + "<div><span>x</span></div>".repeat(20_000);

describe("the rich editor's paste and drop", () => {
  let host: HTMLElement;
  let root: Root;
  let commands: Command[];

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    commands = [];
    act(() =>
      root.render(
        <RichOverlay
          field="fennel-2.text"
          offset={0}
          runs={[{ text: "Led the team" }]}
          family="serif"
          looks={new Map()}
          measure={() => undefined}
          rowsFor={oneRow}
          onCommand={(command) => commands.push(command)}
          onClose={() => {}}
        />,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  /** The editor in the host, after "Led" with the caret. */
  function editor(): Editor {
    const dom = host.querySelector(".ProseMirror") as (HTMLElement & { editor?: Editor }) | null;
    if (!dom?.editor) throw new Error("the rich editor did not mount");
    dom.editor.commands.setTextSelection(4);
    return dom.editor;
  }

  it("pastes the text alone, never reading the HTML, however much of it there is", () => {
    const view = editor().view;
    const clipboard = transfer("the whole", HOSTILE);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboard });
    const started = performance.now();
    act(() => {
      view.dom.dispatchEvent(event);
    });
    const took = performance.now() - started;
    expect(clipboard.htmlRead).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(docToRuns(view.state.doc)).toEqual([{ text: "Ledthe whole the team" }]);
    expect(took).toBeLessThan(100);
  });

  it("drops text from elsewhere as text alone, never reading its HTML", () => {
    const view = editor().view;
    // jsdom lays nothing out, so the place a drop lands is given.
    view.posAtCoords = () => ({ pos: 4, inside: -1 });
    const dragged = transfer("the whole", HOSTILE);
    const event = new MouseEvent("drop", {
      bubbles: true,
      cancelable: true,
      clientX: 1,
      clientY: 1,
    });
    Object.defineProperty(event, "dataTransfer", { value: dragged });
    const started = performance.now();
    act(() => {
      view.dom.dispatchEvent(event);
    });
    const took = performance.now() - started;
    expect(dragged.htmlRead).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(docToRuns(view.state.doc)).toEqual([{ text: "Ledthe whole the team" }]);
    expect(took).toBeLessThan(100);
  });

  it("pastes the text during a composition too, rather than leaving it to the browser", () => {
    const view = editor().view;
    act(() => {
      view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    expect(view.composing).toBe(true);
    const clipboard = transfer("the whole", "<b>the whole</b>");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboard });
    act(() => {
      view.dom.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(clipboard.htmlRead).toBe(false);
    expect(docToRuns(view.state.doc)).toEqual([{ text: "Ledthe whole the team" }]);
  });
});
