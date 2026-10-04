import type { OutlinePart, OutlineSection } from "@resume-tools/resume-model";
import { describe, expect, it } from "vitest";
import type { GlyphBox } from "../page/draw";
import { keptId } from "../page/kept";
import { generateBody } from "../templates/generate";
import { inventedOutline, outlineParts } from "../test/invented-outline";
import { apply, CommandError, FieldTooLong, fieldsOf, History, MAX_FIELD } from "./document";
import { keptSegments, outlineOf, withKept, writtenFields } from "./outline";
import { isRetype, NOT_RETYPED, retypedKept, retypeKeptOf, retypesOf } from "./retype";

// An outline's fields and kept text as the editor edits them (the second pass's item 7). Every
// word is invented.

const sectionOf = (parts: OutlinePart[]): OutlineSection => ({
  kind: "outline",
  id: "outline",
  title: "",
  role: "other",
  parts,
});

/** Glyphs drawn for a segment, one a character of `text`, as the page reads them. */
const drawn = (segment: string, text: string): GlyphBox[] =>
  [...text]
    .filter((c) => c !== " ")
    .map((c) => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      font: "cmr10",
      size: 10,
      locked: segment,
      text: c,
    }));

describe("an outline's fields", () => {
  it("are every field of the outline, by its marker's id, a text or a rich text", async () => {
    const { document } = await inventedOutline();
    const fields = fieldsOf(document.resume);
    expect([...fields.keys()]).toEqual([
      "work.text",
      "lantern-company.text",
      "lantern-dates.text",
      "lantern-1-text.text",
      "lantern-2-text.text",
      "mill-company.text",
      "mill-dates.text",
      "mill-1-text.text",
      "projects.text",
      "orrery.text",
    ]);
    expect(fields.get("lantern-dates.text")?.kind).toBe("text");
    expect(fields.get("lantern-2-text.text")?.kind).toBe("rich");
  });

  it("take a text and rich runs, which undo takes back and redo does again", async () => {
    const { pkg, document } = await inventedOutline();
    const history = new History(document, pkg);
    history.dispatch({ type: "text", field: "mill-dates.text", text: "2018 -- 2019" }, "visit");
    history.seal();
    const runs = [{ text: "Built a " }, { text: "brass", bold: true }, { text: " orrery" }];
    const after = history.dispatch({ type: "rich", field: "orrery.text", runs });
    const fields = fieldsOf(after.resume);
    expect(fields.get("mill-dates.text")?.get(after.resume)).toBe("2018 -- 2019");
    expect(fields.get("orrery.text")?.get(after.resume)).toEqual(runs);
    // Nothing else of the outline changed.
    const before = fieldsOf(document.resume);
    for (const [id, field] of fields)
      if (id !== "mill-dates.text" && id !== "orrery.text")
        expect(field.get(after.resume)).toEqual(before.get(id)?.get(document.resume));
    expect(writtenFields(outlineOf(after.resume) as OutlineSection)).toEqual(
      writtenFields(outlineOf(document.resume) as OutlineSection),
    );
    history.undo();
    expect(
      fieldsOf(history.present.resume).get("orrery.text")?.get(history.present.resume),
    ).toEqual([{ text: "Built a brass orrery that keeps time" }]);
    history.undo();
    expect(history.present).toBe(document);
    history.redo();
    history.redo();
    expect(history.present.resume).toEqual(after.resume);
  });

  it("refuse to empty a field the import's checks found required (decision 0055)", async () => {
    const parts = outlineParts();
    parts[1] = { kind: "rich", id: "work", text: [{ text: "Experience" }], required: true };
    const { pkg, document } = await inventedOutline(parts);
    expect(() => apply(document, { type: "rich", field: "work.text", runs: [] })).toThrow(
      CommandError,
    );
    const history = new History(document, pkg);
    expect(() =>
      history.dispatch({ type: "rich", field: "work.text", runs: [{ text: " " }] }),
    ).toThrow(CommandError);
    // Another text, and another field emptied, are taken.
    history.dispatch({ type: "rich", field: "work.text", runs: [{ text: "Work" }] });
    history.dispatch({ type: "text", field: "mill-dates.text", text: "" });
    expect(
      fieldsOf(history.present.resume).get("mill-dates.text")?.get(history.present.resume),
    ).toBe("");
  });

  it("refuse a text for a rich field, and a field the outline does not hold", async () => {
    const { document } = await inventedOutline();
    expect(() => apply(document, { type: "text", field: "orrery.text", text: "x" })).toThrow(
      CommandError,
    );
    expect(() => apply(document, { type: "text", field: "nobody.text", text: "x" })).toThrow(
      CommandError,
    );
  });
});

describe("a field's length", () => {
  it("is refused past MAX_FIELD, plain or rich, and a field already longer may still shrink", async () => {
    const { document } = await inventedOutline();
    const long = "Quill ".repeat(MAX_FIELD / 5).slice(0, MAX_FIELD + 1);
    expect(() => apply(document, { type: "text", field: "mill-dates.text", text: long })).toThrow(
      FieldTooLong,
    );
    expect(() =>
      apply(document, { type: "rich", field: "orrery.text", runs: [{ text: long }] }),
    ).toThrow(FieldTooLong);
    // A link's address counts with its text.
    const half = long.slice(0, MAX_FIELD / 2 + 1);
    expect(() =>
      apply(document, {
        type: "rich",
        field: "orrery.text",
        runs: [{ text: half, href: `https://quill.example/${half}` }],
      }),
    ).toThrow(FieldTooLong);
    const most = long.slice(0, MAX_FIELD);
    const full = apply(document, { type: "text", field: "mill-dates.text", text: most });
    expect(fieldsOf(full.resume).get("mill-dates.text")?.get(full.resume)).toBe(most);
    // A field longer than the cap, as no edit makes it, may still be shortened, if not lengthened.
    const parts = outlineParts();
    parts[1] = { kind: "rich", id: "work", text: [{ text: `${most}0123456789` }] };
    const { document: over } = await inventedOutline(parts);
    const shorter = apply(over, {
      type: "rich",
      field: "work.text",
      runs: [{ text: `${most}01` }],
    });
    expect(fieldsOf(shorter.resume).get("work.text")?.get(shorter.resume)).toEqual([
      { text: `${most}01` },
    ]);
    expect(() =>
      apply(over, { type: "rich", field: "work.text", runs: [{ text: `${most}0123456789x` }] }),
    ).toThrow(FieldTooLong);
  });
});

describe("History.restore", () => {
  it("makes a document the history held the present, dropping what came after it for good", async () => {
    const { pkg, document } = await inventedOutline();
    const history = new History(document, pkg);
    const one = history.dispatch({ type: "text", field: "mill-dates.text", text: "2018" });
    const two = history.dispatch({ type: "text", field: "mill-dates.text", text: "2017" }, "v");
    history.dispatch({ type: "text", field: "mill-dates.text", text: "2016" }, "v");
    // Within the open visit: the step stays, its start the same.
    expect(history.restore(two)).toBe(two);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBe(one);
    // Where a step began: the steps after it go.
    history.redo();
    expect(history.restore(one)).toBe(one);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBe(document);
  });
});

describe("an outline's kept text, by segment", () => {
  it("is what the generator writes between the fields it writes, one after the other", async () => {
    // Field texts of letters alone, so that a field's marker is easy to cut out of the LaTeX.
    const { pkg, document } = await inventedOutline();
    const outline = outlineOf(document.resume) as OutlineSection;
    const { latex, texts } = generateBody(pkg, document.resume, {});
    expect(writtenFields(outline)).toEqual([...texts.keys()]);
    const between = latex
      .replace(/\n$/, "")
      .split(/\\rtfield\{[a-z0-9.-]+\}\{(?:[^{}]|\{[^{}]*\})*\}/);
    const segments = keptSegments(outline);
    expect(segments.map((segment) => segment.latex)).toEqual(between);
    const ids = writtenFields(outline);
    expect(segments.map((segment) => segment.id)).toEqual(
      [undefined, ...ids].map((before, index) => keptId(before, ids[index])),
    );
  });

  it("joins the kept text around a blank field, which the generator does not write", () => {
    const outline = sectionOf([
      { kind: "kept", latex: "\\textbf{" },
      { kind: "text", id: "a", text: "Quill" },
      { kind: "kept", latex: "} and " },
      { kind: "text", id: "b", text: " " },
      { kind: "kept", latex: " \\textit " },
      { kind: "text", id: "c", text: "", bare: true },
      { kind: "kept", latex: " % a note" },
      { kind: "text", id: "d", text: "Wren", bare: true },
    ]);
    expect(writtenFields(outline)).toEqual(["a.text", "d.text"]);
    const [first, middle, last] = keptSegments(outline);
    expect(first?.latex).toBe("\\textbf{");
    // A bare field's braces, and a line's end after a comment, are the generator's, no kept text.
    expect(middle?.latex).toBe("} and  \\textit {} % a note\n{");
    expect(middle?.pieces.map((piece) => piece.at?.path ?? null)).toEqual([
      [2],
      [4],
      null,
      null,
      [6],
      null,
      null,
    ]);
    expect(last).toEqual({
      id: keptId("d.text", undefined),
      pieces: [{ latex: "}" }],
      latex: "}",
      starts: [0],
    });
  });

  it("is retyped run by run, each within one piece of kept text, never across two", () => {
    const outline = sectionOf([
      { kind: "kept", latex: "Rowing on the " },
      {
        kind: "group",
        id: "g",
        units: [
          { id: "u1", gap: "", parts: [{ kind: "kept", latex: "river" }] },
          { id: "u2", gap: " and the ", parts: [{ kind: "kept", latex: "lake" }] },
        ],
      },
      { kind: "text", id: "a", text: "Quill" },
    ]);
    const [segment] = keptSegments(outline);
    if (segment === undefined) throw new Error("no segment");
    // The first run, "Rowing on the river", runs from one piece into the next, and is not offered.
    const found = retypeKeptOf(
      segment,
      new Map([[segment.id, drawn(segment.id, "Rowing on the river and the lake")]]),
    );
    expect(found).toEqual({ reason: NOT_RETYPED.notPlain });
  });

  it("is retyped and kept through a command, and refused where it would hold a marker's text", () => {
    const parts: OutlinePart[] = [
      { kind: "kept", latex: "\\section*{Hobbies}\nRowing on weekends.\n\\section*{" },
      { kind: "text", id: "a", text: "Work" },
      { kind: "kept", latex: "}\n" },
      {
        kind: "group",
        id: "g",
        units: [
          { id: "u1", gap: "", parts: [{ kind: "kept", latex: "\\par x " }] },
          { id: "u2", gap: "\n\\par Fishing ", parts: [{ kind: "kept", latex: "\\textbf{y}" }] },
        ],
      },
    ];
    const resume = {
      version: 1 as const,
      header: { name: { first: "", last: "" }, links: [] },
      sections: [sectionOf(parts)],
    };
    const document = { version: 1 as const, template: "jake", resume, controls: {} };
    const [first, second] = keptSegments(sectionOf(parts));
    if (first === undefined || second === undefined) throw new Error("no segment");
    const pages = [
      {
        glyphs: [
          ...drawn(first.id, "Hobbies Rowing on weekends."),
          ...drawn(second.id, "x Fishing y"),
        ],
      },
    ];
    const retypes = retypesOf(document, pages);
    const hobbies = retypes.get(first.id);
    const fishing = retypes.get(second.id);
    if (hobbies === undefined || !isRetype(hobbies)) throw new Error("nothing to retype");
    if (fishing === undefined || !isRetype(fishing)) throw new Error("nothing to retype");
    expect(hobbies.pieces.map((piece) => piece.text)).toEqual(["Hobbies", "Rowing on weekends."]);
    // A unit's gap is kept text too.
    expect(fishing.pieces.map((piece) => piece.text)).toEqual(["x", "Fishing", "y"]);
    const edits = retypedKept(first, hobbies, ["Pastimes", "Sailing & rowing"]);
    expect(edits).toEqual([
      {
        at: { path: [0] },
        latex: "\\section*{Pastimes}\nSailing \\& rowing\n\\section*{",
      },
    ]);
    const after = apply(document, { type: "retypeKept", section: "outline", kept: edits ?? [] });
    expect(after.resume.sections[0]).toEqual(
      sectionOf([{ kind: "kept", latex: edits?.[0]?.latex ?? "" }, ...parts.slice(1)]),
    );
    const gap = retypedKept(second, fishing, ["x", "Hiking", "y"]);
    expect(gap).toEqual([{ at: { path: [3, 1], gap: true }, latex: "\n\\par Hiking " }]);
    expect(retypedKept(first, hobbies, ["Hobbies", "Rowing on weekends."])).toBeUndefined();
    // A run typed as the page's own marker's text: the outline refuses to keep it.
    const marker = retypedKept(first, hobbies, ["rt:b:a.text", "Rowing on weekends."]);
    expect(() =>
      apply(document, { type: "retypeKept", section: "outline", kept: marker ?? [] }),
    ).toThrow(CommandError);
    // A place that is no kept text.
    expect(withKept(sectionOf(parts), [{ at: { path: [1] }, latex: "x" }])).toHaveProperty(
      "refused",
    );
    expect(
      withKept(sectionOf(parts), [{ at: { path: [3, 0], gap: true }, latex: "x" }]),
    ).toHaveProperty("refused");
  });

  it("is listed whole for the invented outline, each segment once", () => {
    const outline = sectionOf(outlineParts());
    const ids = keptSegments(outline).map((segment) => segment.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(writtenFields(outline).length + 1);
  });
});
