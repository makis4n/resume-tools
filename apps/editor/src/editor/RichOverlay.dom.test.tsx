// @vitest-environment jsdom
import type { RichText } from "@resume-tools/resume-model";
import type { Editor } from "@tiptap/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fastest } from "../test/timing";
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
 * A hostile page's copy: a rule the browser matches against every pasted element, and `count` of
 * them, which ProseMirror would parse and style before any handler of the editor's.
 */
const hostile = (count: number) =>
  "<style>div:has(~ div ~ div ~ p){color:red}</style>" + "<div><span>x</span></div>".repeat(count);

/** The hostile copy the tests paste and drop: 20,000 elements, 500 KB in all. */
const HOSTILE = hostile(20_000);

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
    /** A paste of "the whole" with `html` beside it, dispatched and taken. */
    const paste = (html: string) => {
      const clipboard = transfer("the whole", html);
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: clipboard });
      act(() => {
        view.dom.dispatchEvent(event);
      });
      return { clipboard, event };
    };
    const { clipboard, event } = paste(HOSTILE);
    expect(clipboard.htmlRead).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(docToRuns(view.state.doc)).toEqual([{ text: "Ledthe whole the team" }]);
    // The HTML is never read, so the paste costs 0.6 to 0.8 times what it costs beside a tenth
    // of it, in CPU time (`fastest`); parsed, as ProseMirror parses a paste the editor leaves
    // to it, 20 times. So the paste is bound by three times the tenth's, and by 100 ms.
    const [short = 0, long = 0] = fastest(
      [hostile(2_000), HOSTILE].map((html) => () => paste(html)),
      5,
    );
    expect(long).toBeLessThan(3 * short);
    expect(long).toBeLessThan(100);
  });

  it("drops text from elsewhere as text alone, never reading its HTML", () => {
    const view = editor().view;
    // jsdom lays nothing out, so the place a drop lands is given.
    view.posAtCoords = () => ({ pos: 4, inside: -1 });
    /** A drop of "the whole" from elsewhere with `html` beside it, dispatched and taken. */
    const drop = (html: string) => {
      const dragged = transfer("the whole", html);
      const event = new MouseEvent("drop", {
        bubbles: true,
        cancelable: true,
        clientX: 1,
        clientY: 1,
      });
      Object.defineProperty(event, "dataTransfer", { value: dragged });
      act(() => {
        view.dom.dispatchEvent(event);
      });
      return { dragged, event };
    };
    const { dragged, event } = drop(HOSTILE);
    expect(dragged.htmlRead).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(docToRuns(view.state.doc)).toEqual([{ text: "Ledthe whole the team" }]);
    // As for a paste: 0.7 to 0.8 times the tenth's, and 20 times with the HTML parsed.
    const [short = 0, long = 0] = fastest(
      [hostile(2_000), HOSTILE].map((html) => () => drop(html)),
      5,
    );
    expect(long).toBeLessThan(3 * short);
    expect(long).toBeLessThan(100);
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
