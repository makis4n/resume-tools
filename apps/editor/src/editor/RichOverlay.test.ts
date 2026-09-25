import type { RichText } from "@resume-tools/resume-model";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { BREAKS, type Layout, lineBreaks, type RichFrame, type RichRow } from "./RichOverlay";
import { RICH_SCHEMA, runsToDoc } from "./rich";

const schema = getSchema(RICH_SCHEMA);
const PT = 65536;

/** A field broken after the first space past its tenth character, as a stand-in for TeX. */
function rowsFor(runs: RichText): RichRow[] {
  const text = runs.map((run) => run.text).join("");
  const cut = text.indexOf(" ", 10) + 1;
  if (cut <= 0) return [{ from: 0, to: text.length, wordSpacingSp: 0 }];
  return [
    { from: 0, to: cut, wordSpacingSp: PT },
    { from: cut, to: text.length, wordSpacingSp: 0 },
  ];
}

/** A field whose second line starts 20 pixels further in than its first, at a pixel a point. */
const frame: RichFrame = {
  left: 0,
  top: 0,
  fontPx: 10,
  lineHeightPx: 12,
  pxPerSp: 1 / PT,
  indents: [0, 20],
  widths: [100, 80],
  key: "",
};

/** The decorations a state draws, as ranges, the widgets' sides and keys, and the rows. */
function drawn(state: EditorState) {
  const breaks = BREAKS.getState(state);
  return {
    rows: breaks?.rows.length,
    decorations: (breaks?.decorations.find() ?? []).map((decoration) =>
      decoration.from === decoration.to
        ? { widget: decoration.from, side: decoration.spec.side, key: decoration.spec.key }
        : { from: decoration.from, to: decoration.to },
    ),
  };
}

describe("TeX's lines as decorations", () => {
  const doc = Node.fromJSON(
    schema,
    runsToDoc([
      { text: "Led the " },
      { text: "migration", bold: true },
      { text: " of three services" },
    ]),
  );

  it("breaks before each line after the first, after the space TeX broke at", () => {
    const layout: Layout = { rowsFor, frame };
    const state = EditorState.create({ schema, doc, plugins: [lineBreaks(() => layout)] });
    // "Led the migration " is the first line: the break is at offset 18, position 19, and the
    // first line's spaces are a point wider, across the bold run's boundary too.
    expect(drawn(state)).toEqual({
      rows: 2,
      decorations: [
        { from: 1, to: 19 },
        { widget: 19, side: -1, key: "break 20" },
      ],
    });
  });

  it("draws the lines again when the document changes, or when the layout does", () => {
    let layout: Layout = { rowsFor, frame: undefined };
    let state = EditorState.create({ schema, doc, plugins: [lineBreaks(() => layout)] });
    // With no place yet, the lines are there but set with neither spacing nor indent.
    expect(drawn(state).decorations).toEqual([{ widget: 19, side: -1, key: "break 0" }]);
    // "Led the the migration": the first line is now "Led the the ", which ends at offset 12.
    state = state.apply(state.tr.insertText("the ", 5));
    expect(drawn(state).decorations).toEqual([{ widget: 13, side: -1, key: "break 0" }]);
    layout = { rowsFor, frame };
    const unchanged = state.apply(state.tr.setMeta("other", true));
    expect(drawn(unchanged).decorations).toEqual([{ widget: 13, side: -1, key: "break 0" }]);
    state = state.apply(state.tr.setMeta(BREAKS, true));
    expect(drawn(state).decorations).toEqual([
      { from: 1, to: 13 },
      { widget: 13, side: -1, key: "break 20" },
    ]);
  });

  it("sets a field TeX never breaks on one line, with no break", () => {
    const layout: Layout = { rowsFor: () => [{ from: 0, to: 35, wordSpacingSp: 0 }], frame };
    const state = EditorState.create({ schema, doc, plugins: [lineBreaks(() => layout)] });
    expect(drawn(state)).toEqual({ rows: 1, decorations: [] });
  });
});
