/**
 * The rich editor: a rich field opened in place on the page in Tiptap, with bold, italic and links
 * and nothing else (plan section 8.1, milestone 2 item 10). `Overlay.tsx` places and sizes it as it
 * does a plain field and gives it its fonts, each variant's text set in the page's own glyphs, and
 * the lines are broken where TeX will break them, so that what the user types sits where the next
 * compile puts it (decision 0004).
 *
 * ProseMirror owns the editable DOM, so TeX's lines come in as decorations over it. The paragraph
 * is set with `white-space: pre`, so the browser wraps nothing; a widget that draws a `<br>` ends
 * each line where TeX ends it, after the space TeX broke at, so that the space stays on its line;
 * and each line's `word-spacing` spreads the glue TeX sets on it over its spaces, as the plain rows
 * do. The widget sits before the caret at its position (`side: -1`), so a caret at the start of a
 * line, which is after the space TeX broke at, is drawn there, where what the user types there
 * goes, and not at the end of the line before. The lines are worked out again on every change to
 * the document, and whenever a new page brings new fonts or a new place.
 *
 * Each change to the document is a `rich` command with the runs it holds (`docToRuns`), which the
 * app compiles after its pause, as it does the plain overlay's edits. Enter inserts nothing, since
 * a field is one paragraph; pasted and dropped text comes in plain, with the marks where it lands;
 * and the browser's own formatting, undo and redo insert nothing, as in the plain overlay, since
 * item 12 gives undo across page and panel. A small bar under the field toggles bold, italic and a
 * link, as Cmd or Ctrl with B, I and K do, and a link's address is edited in a popover under the
 * bar, which shows what the address will link to. The editor closes on Escape, and when the focus
 * leaves it, its bar and the popover.
 */

import type { RichText } from "@resume-tools/resume-model";
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  type Editor,
  EditorContent,
  type UseEditorOptions,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import { type MouseEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { linkAddress } from "../templates/generate";
import type { Fold } from "../tex/fields";
import type { Command } from "./document";
import { docToRuns, linePositions, RICH_SCHEMA, runsToDoc, TEXT_START, type Variant } from "./rich";

/** A line of the field as TeX sets it: the offsets of its text, and the glue it adds per space. */
export interface RichRow {
  from: number;
  to: number;
  /** What TeX sets each space on the line wider (or, below zero, narrower) by, in scaled points. */
  wordSpacingSp: number;
}

/** Where the field is set in the page's container, and how big, as `Overlay.tsx` measures it. */
export interface RichFrame {
  /** The first line's top left, in CSS pixels in the page's container. */
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
  /** The letter font's `font-feature-settings`, for a variant with no look of its own. */
  features?: string;
  /** All of the above as one string, which is the same when a new page leaves the field as it was. */
  key: string;
}

/**
 * How a variant of the field is drawn: its CSS font family, its size against the field's, and the
 * `font-feature-settings` its font's glyphs are substituted with (decision 0023).
 */
export interface Look {
  family: string;
  scale: number;
  features?: string;
}

/**
 * The CSS `text-transform` that shows a field's text in the case the page folds it to, capitals or
 * small letters (`FieldLayout.folded`, decision 0021), while the text itself, which the user edits
 * and the document holds, keeps its own case; `none` for a field the page sets as it stands, and
 * for one whose glyphs are of both cases (`mixed`), which no one case shows, so its text as typed.
 */
export function textTransform(folded: Fold | undefined): "uppercase" | "lowercase" | "none" {
  if (folded === "upper") return "uppercase";
  return folded === "lower" ? "lowercase" : "none";
}

export interface RichOverlayProps {
  /** The field's id, as the page's markers and the document's commands name it. */
  field: string;
  /** Where in the field's text the click landed, which the caret opens at. */
  offset: number;
  /**
   * The field's runs as the document holds them now. The editor opens on them, and after that its
   * own document is the field's, each edit sent as a command; runs the editor did not send, when
   * the field changed under it, close it at its next edit rather than be written over.
   */
  runs: RichText;
  /** The CSS font family of the field's letter font, which a variant without a look is drawn in. */
  family: string;
  /** How each variant the page sets is drawn. */
  looks: ReadonlyMap<Variant, Look>;
  /**
   * The case the page sets the field in when it is not the runs' own, as a title a class sets
   * through `\MakeUppercase` (`FieldLayout.folded`): the text is shown in it, or as typed where the
   * glyphs are of both cases (`textTransform`), and the runs keep their own case.
   */
  folded?: Fold;
  /** Where the field is set on the page as shown now; a new one comes with each page. */
  measure: () => RichFrame | undefined;
  /** The rows TeX sets runs in, which the editor draws its lines as. */
  rowsFor: (runs: RichText) => RichRow[];
  /** Each edit, as a command for the document. */
  onCommand: (command: Command) => void;
  onClose: () => void;
  /** Enter at the end of the field's text, nothing selected (`OverlayProps.onEnd`). */
  onEnd?: () => void;
}

/** What the editor draws the field's lines from. */
export interface Layout {
  rowsFor: (runs: RichText) => RichRow[];
  frame: RichFrame | undefined;
}

/** TeX's rows for the document, and the decorations that draw them. */
export interface Breaks {
  rows: RichRow[];
  decorations: DecorationSet;
}

export const BREAKS = new PluginKey<Breaks>("texLineBreaks");

/** How far line `k` starts from the field's leftmost line, in pixels; the last indent repeats. */
function indentOf(frame: RichFrame, k: number): number {
  const { indents } = frame;
  return (indents[Math.min(k, indents.length - 1)] ?? 0) - Math.min(0, ...indents);
}

/** How wide line `k` is, in pixels, or undefined for a field TeX never breaks. */
function widthOf(frame: RichFrame, k: number): number | undefined {
  return frame.widths[Math.min(k, frame.widths.length - 1)];
}

/**
 * A line's end as the editor draws it: a `<br>`, and when the next line starts further in than the
 * field's leftmost line, an empty inline block as wide, since the lines are one paragraph's.
 * ProseMirror makes the widget one the user cannot type into or select.
 */
function lineBreak(indent: number): HTMLElement {
  const br = document.createElement("br");
  if (indent <= 0) return br;
  const space = document.createElement("span");
  space.style.display = "inline-block";
  space.style.width = `${indent}px`;
  const widget = document.createElement("span");
  widget.append(br, space);
  return widget;
}

/**
 * TeX's rows for a rich field's document, as `layout` breaks its runs, and the decorations that
 * draw them (`linePositions`): a break before each line after the first, and the line's word
 * spacing over each line whose spaces TeX sets at anything but the font's width.
 */
function breaksOf(doc: ProseMirrorNode, layout: Layout): Breaks {
  let rows: RichRow[];
  try {
    rows = layout.rowsFor(docToRuns(doc));
  } catch (error) {
    // The breaker refuses only a font or parameters no real paragraph has; one line still edits.
    console.warn("The overlay could not break the field's lines", error);
    rows = [{ from: 0, to: doc.textContent.length, wordSpacingSp: 0 }];
  }
  const { frame } = layout;
  const { breaks, lines } = linePositions(rows);
  const decorations = breaks.map((position, i) => {
    const indent = frame ? indentOf(frame, i + 1) : 0;
    return Decoration.widget(position, () => lineBreak(indent), {
      side: -1,
      key: `break ${indent}`,
    });
  });
  for (const line of lines) {
    const spacing = frame ? line.wordSpacingSp * frame.pxPerSp : 0;
    if (spacing !== 0 && line.to > line.from)
      decorations.push(
        Decoration.inline(line.from, line.to, { style: `word-spacing: ${spacing}px` }),
      );
  }
  return { rows, decorations: DecorationSet.create(doc, decorations) };
}

/**
 * The plugin that holds TeX's lines for the document, worked out again on every transaction that
 * changes the document or carries `BREAKS`, which the editor sends when its layout changes.
 */
export function lineBreaks(layout: () => Layout): Plugin<Breaks> {
  return new Plugin<Breaks>({
    key: BREAKS,
    state: {
      init: (_, state) => breaksOf(state.doc, layout()),
      apply: (tr, breaks, _, state) =>
        tr.docChanged || tr.getMeta(BREAKS) ? breaksOf(state.doc, layout()) : breaks,
    },
    props: { decorations: (state) => BREAKS.getState(state)?.decorations },
  });
}

/** What the editor's keys and plugins call back into. */
interface Hooks {
  layout: () => Layout;
  close: () => void;
  link: () => void;
  /** Enter at the end of the field's text, nothing selected: whether something took it. */
  end: () => void;
}

/**
 * A field's keys and TeX's lines: Enter inserts nothing, in any combination, since a field is one
 * paragraph, and at the field's end, alone, it asks for a unit after (`Hooks.end`); Escape closes the editor; and Cmd or Ctrl and K open the link popover, and never the
 * browser's own search, which would take the focus and close the editor.
 */
function fieldKeys(hooks: Hooks) {
  return Extension.create({
    name: "richField",
    priority: 1000,
    addKeyboardShortcuts() {
      return {
        // Enter inserts nothing; at the field's end, with nothing selected, it adds a unit
        // (`OverlayProps.onEnd`).
        Enter: ({ editor }) => {
          const { selection, doc } = editor.state;
          if (selection.empty && selection.head === Selection.atEnd(doc).head) hooks.end();
          return true;
        },
        "Shift-Enter": () => true,
        "Mod-Enter": () => true,
        Escape: () => {
          hooks.close();
          return true;
        },
        "Mod-k": () => {
          hooks.link();
          return true;
        },
      };
    },
    addProseMirrorPlugins() {
      return [lineBreaks(hooks.layout)];
    },
  });
}

/** What a field's text holds in place of a line break: a space, as the generator makes one. */
const LINE_BREAKS = /\r\n|[\t\n\r\u2028\u2029]/g;

/**
 * Inputs the editor does not take: a new paragraph or line, which a field cannot hold; the
 * browser's own formatting, which would bring marks a field does not have; and the browser's undo
 * and redo, which its menu still gives, since the app's history is the one undo: its own take the
 * keys, and take back the visit to the field (item 12).
 */
const REFUSED = /^(insertParagraph|insertLineBreak|format|history)/;

/** How the field's text is set, apart from its fonts, which `styleFor` gives. */
const TEXT_STYLE =
  "position: relative; white-space: pre; outline: 1px solid #0a7; outline-offset: 1px;";

/** Class names that scope each editor's style to it. */
let scopes = 0;

/**
 * The editor's style, scoped to it by `scope`: each variant in its font's family, and at its size
 * when that differs from the field's, with no weight or slant the browser would add on top, since
 * the fonts are already bold or italic; the first line's indent; the case the page folds the field
 * to (`textTransform`); and a link underlined, since the page may not show links at all. What
 * ProseMirror's own style sheet does for the DOM it draws is here too, since Tiptap's is not
 * loaded: it would set the text to wrap.
 */
function styleFor(
  scope: string,
  family: string,
  looks: ReadonlyMap<Variant, Look>,
  frame: RichFrame | undefined,
  folded?: Fold,
): string {
  const at = `.${scope}`;
  const font = (variant: Variant) => {
    const look = looks.get(variant);
    const size =
      frame && look && look.scale !== 1 ? ` font-size: ${frame.fontPx * look.scale}px;` : "";
    const features = look?.features ?? frame?.features ?? "normal";
    return `font-family: ${look?.family ?? family};${size} font-feature-settings: ${features};`;
  };
  const indent = frame ? indentOf(frame, 0) : 0;
  return [
    `${at} .ProseMirror { ${font("regular")} text-indent: ${indent}px; }`,
    `${at} .ProseMirror { text-transform: ${textTransform(folded)}; }`,
    `${at} .ProseMirror p { margin: 0; }`,
    `${at} strong { font-weight: normal; ${font("bold")} }`,
    `${at} em { font-style: normal; ${font("italic")} }`,
    `${at} strong em, ${at} em strong { ${font("boldItalic")} }`,
    `${at} .ProseMirror a { color: inherit; text-decoration: underline #0a7; }`,
    `${at} img.ProseMirror-separator { display: inline !important; border: none !important; margin: 0 !important; width: 0 !important; height: 0 !important; }`,
    `${at} .ProseMirror-hideselection *::selection { background: transparent; }`,
    `${at} .ProseMirror-hideselection { caret-color: transparent; }`,
  ].join("\n");
}

/** How the editor looks around its text, apart from where it is and its font's size. */
const OVERLAY_STYLE = {
  position: "absolute",
  zIndex: 1,
  margin: 0,
  padding: 0,
  border: 0,
  fontWeight: "normal",
  fontStyle: "normal",
  fontKerning: "none",
  fontVariantLigatures: "none",
  fontSynthesis: "none",
  letterSpacing: 0,
  textTransform: "none",
  textAlign: "left",
  color: "#000",
} as const;

/** How the bar and the popover look, in the editor's own type rather than the page's. */
const CONTROLS_STYLE = {
  width: "max-content",
  marginTop: 4,
  padding: "3px 4px",
  background: "#fff",
  border: "1px solid #0a7",
  font: "13px system-ui, sans-serif",
  lineHeight: "normal",
  whiteSpace: "normal",
} as const;

/** Keep the focus where it is on a click in the bar or popover, other than in its input. */
const keepFocus = (event: MouseEvent) => {
  if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
};

/**
 * The marks at the selection, which the bar shows, and the number of lines the text is set in,
 * which the lines' backgrounds follow.
 */
function editorState(editor: Editor) {
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    link: editor.isActive("link"),
    href: String(editor.getAttributes("link").href ?? ""),
    empty: editor.state.selection.empty,
    lines: BREAKS.getState(editor.state)?.rows.length ?? 1,
  };
}

export function RichOverlay({
  field,
  offset,
  runs,
  family,
  looks,
  folded,
  measure,
  rowsFor,
  onCommand,
  onClose,
  onEnd,
}: RichOverlayProps) {
  const [frame, setFrame] = useState<RichFrame>();
  // Whether the user asked for the link popover, rather than the caret being in a link.
  const [linking, setLinking] = useState(false);
  const [scope] = useState(() => `rt-rich-${++scopes}`);
  const wrapper = useRef<HTMLDivElement>(null);
  const layout = useRef<Layout>({ rowsFor, frame: undefined });
  // What the document holds for the field as far as the editor knows, as JSON: the runs it opened
  // on and each edit it has sent since, which the document may not show yet; and whether the
  // document has shown anything else, which only a change the editor did not make gives.
  const [known] = useState(() => ({ sent: [JSON.stringify(runs)], changed: false }));
  const latest = useRef({ field, onCommand, onClose, onEnd, link: () => {}, known });

  const [options] = useState((): UseEditorOptions => {
    const hooks: Hooks = {
      layout: () => layout.current,
      close: () => latest.current.onClose(),
      link: () => latest.current.link(),
      end: () => latest.current.onEnd?.(),
    };
    return {
      extensions: [...RICH_SCHEMA, fieldKeys(hooks)],
      content: runsToDoc(runs),
      injectCSS: false,
      enableInputRules: false,
      enablePasteRules: false,
      editorProps: {
        attributes: {
          role: "textbox",
          spellcheck: "false",
          autocapitalize: "off",
          autocorrect: "off",
          style: TEXT_STYLE,
        },
        // Paste and drop are taken as DOM events, which ProseMirror hands the editor before its
        // own handling: that parses the clipboard's HTML, and applies every rule of a style sheet
        // it holds to what it parsed, before `handlePaste` runs, so that a page the user copies
        // from could hold the tab for seconds; and during a composition it leaves a paste to the
        // browser, which would bring the HTML's marks and links in.
        handleDOMEvents: {
          beforeinput: (_view, event) => {
            if (!REFUSED.test(event.inputType)) return false;
            event.preventDefault();
            return true;
          },
          // Pasted text comes in plain, its line breaks as spaces, with the marks at the caret.
          paste: (view, event) => {
            event.preventDefault();
            const text = (event.clipboardData?.getData("text/plain") ?? "").replace(
              LINE_BREAKS,
              " ",
            );
            if (text !== "") view.dispatch(view.state.tr.insertText(text).scrollIntoView());
            return true;
          },
          // A drag within the field is ProseMirror's own, which moves its text, marks and all;
          // one from elsewhere comes in plain, as a paste does, with the marks where it lands.
          drop: (view, event) => {
            if (view.dragging) return false;
            event.preventDefault();
            const text = (event.dataTransfer?.getData("text/plain") ?? "").replace(
              LINE_BREAKS,
              " ",
            );
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (text === "" || !at) return true;
            const tr = view.state.tr.insertText(text, at.pos);
            view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at.pos + text.length)));
            view.focus();
            return true;
          },
        },
      },
      onUpdate: ({ editor }) => {
        const { known } = latest.current;
        // The field changed under the editor, as its document says: the edit would write over it.
        if (known.changed) {
          latest.current.onClose();
          return;
        }
        const runs = docToRuns(editor.state.doc);
        known.sent.push(JSON.stringify(runs));
        latest.current.onCommand({ type: "rich", field: latest.current.field, runs });
      },
      // A popover asked for is for the text selected when it was asked for.
      onSelectionUpdate: () => setLinking(false),
    };
  });
  const editor = useEditor(options);
  const state = useEditorState({ editor, selector: ({ editor }) => editorState(editor) });

  /** Open the link popover, when there is a link to edit or text to make one. */
  const openLink = () => {
    if (editor.state.selection.empty && !editor.isActive("link")) return;
    setLinking(true);
  };
  useLayoutEffect(() => {
    latest.current = { field, onCommand, onClose, onEnd, link: openLink, known };
  });
  // Each time the document's runs for the field change: the editor's own edit coming back, which
  // settles every edit sent before it, or another change.
  const now = useMemo(() => JSON.stringify(runs), [runs]);
  useLayoutEffect(() => {
    const at = known.sent.lastIndexOf(now);
    if (at >= 0) known.sent.splice(0, at);
    else known.changed = true;
  }, [known, now]);

  // Placed on the page as it is shown now, and again with each new page.
  useLayoutEffect(() => {
    const next = measure();
    if (next) setFrame((before) => (before?.key === next.key ? before : next));
  }, [measure]);

  // TeX's lines drawn again for a new place or new fonts. The first time the field is placed, the
  // caret goes where the click landed; after that it stays where the user left it.
  const opened = useRef<Editor | undefined>(undefined);
  useLayoutEffect(() => {
    layout.current = { rowsFor, frame };
    if (editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(BREAKS, true));
    if (frame === undefined || opened.current === editor) return;
    opened.current = editor;
    editor.commands.setTextSelection(TEXT_START + offset);
    editor.view.focus();
  }, [editor, rowsFor, frame, offset]);

  const applyLink = (href: string) => {
    // Focus goes back to the text before the popover can go, so that it is never lost with it.
    editor.view.focus();
    const chain = editor.chain();
    (state.link ? chain.extendMarkRange("link") : chain).setMark("link", { href }).run();
    setLinking(false);
  };
  const removeLink = () => {
    editor.view.focus();
    editor.chain().extendMarkRange("link").unsetMark("link").run();
    setLinking(false);
  };
  const cancelLink = () => {
    editor.view.focus();
    setLinking(false);
  };

  const lines = frame
    ? Array.from({ length: state.lines }, (_, k) => ({
        marginLeft: indentOf(frame, k),
        width: widthOf(frame, k) ?? "100%",
      }))
    : [];
  const extents = frame ? frame.widths.map((width, k) => indentOf(frame, k) + width) : [];
  return (
    <div
      ref={wrapper}
      className={scope}
      style={{
        ...OVERLAY_STYLE,
        visibility: frame ? "visible" : "hidden",
        left: frame ? frame.left - indentOf(frame, 0) : 0,
        top: frame?.top ?? 0,
        width: extents.length > 0 ? Math.max(...extents) : "max-content",
        fontSize: frame?.fontPx,
        lineHeight: frame ? `${frame.lineHeightPx}px` : undefined,
      }}
      onBlur={(event) => {
        // The focus leaving the text for the bar or the popover stays inside; anywhere else, or
        // nowhere, as a click on the page gives, closes the editor.
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !wrapper.current?.contains(next)) onClose();
      }}
      // A click between the text and the bar is inside too, and takes the focus nowhere.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      <style>{styleFor(scope, family, looks, frame, folded)}</style>
      {/* The lines' white, under the text, as wide as TeX's lines, which hides the page's glyphs
          under them and nothing beside them, such as a label before the field's first line. */}
      <div aria-hidden style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
        {lines.map((line, k) => (
          <div
            // The lines are places, not items: the kth line's white is always the kth.
            key={k}
            style={{ ...line, height: frame?.lineHeightPx, background: "#fff" }}
          />
        ))}
      </div>
      <EditorContent editor={editor} style={{ position: "relative" }} />
      <div
        role="toolbar"
        aria-label="Text style"
        style={{ ...CONTROLS_STYLE, display: "flex", gap: 4 }}
        onMouseDown={keepFocus}
      >
        <button
          type="button"
          title="Bold"
          aria-pressed={state.bold}
          aria-keyshortcuts="Meta+B Control+B"
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <b>B</b>
        </button>
        <button
          type="button"
          title="Italic"
          aria-pressed={state.italic}
          aria-keyshortcuts="Meta+I Control+I"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <i>I</i>
        </button>
        <button
          type="button"
          title={state.empty && !state.link ? "Select the text to link" : "Link"}
          aria-pressed={state.link}
          aria-keyshortcuts="Meta+K Control+K"
          disabled={state.empty && !state.link}
          onClick={openLink}
        >
          Link
        </button>
      </div>
      {(linking || state.link) && (
        <LinkPopover
          key={`${linking} ${state.href}`}
          href={state.link ? state.href : ""}
          inLink={state.link}
          focus={linking}
          onApply={applyLink}
          onRemove={removeLink}
          onCancel={cancelLink}
        />
      )}
    </div>
  );
}

/**
 * A link's address, edited in an input: Apply sets it as typed, Enter too, and Remove unlinks the
 * text; Escape goes back to the text. The generator decides what an address links to
 * (`linkAddress`, decision 0007), and the popover says what that is, as the user types, or that
 * the text will not be linked, so that no address is a surprise on the page. The undo and redo
 * keys in it are the browser's (`NATIVE_UNDO`), which undoes the typing in the input and nothing
 * else (`refuseNativeUndo`): an address reaches the document only when it is applied, so the
 * app's history holds none of it, and the app's undo would take the focus out of the popover,
 * which closes the editor and loses it.
 */
function LinkPopover({
  href,
  inLink,
  focus,
  onApply,
  onRemove,
  onCancel,
}: {
  /** The link's address, or nothing for a new link. */
  href: string;
  /** Whether the caret or the selection is in a link, which Remove unlinks. */
  inLink: boolean;
  /** Whether the user asked for the popover, which then takes the focus. */
  focus: boolean;
  onApply: (href: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(href);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (focus) input.current?.focus({ preventScroll: true });
  }, [focus]);
  const address = linkAddress(draft);
  return (
    <div
      role="group"
      aria-label="Link"
      data-native-undo
      style={CONTROLS_STYLE}
      onMouseDown={keepFocus}
    >
      <label>
        Address{" "}
        <input
          ref={input}
          value={draft}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft !== "") {
              event.preventDefault();
              onApply(draft);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
      </label>{" "}
      <button type="button" disabled={draft === ""} onClick={() => onApply(draft)}>
        Apply
      </button>{" "}
      {inLink && (
        <button type="button" onClick={onRemove}>
          Remove
        </button>
      )}
      <div>{address === undefined ? "Will not be linked" : `Links to ${address}`}</div>
    </div>
  );
}
