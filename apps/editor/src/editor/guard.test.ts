import { describe, expect, it } from "vitest";
import { curated } from "../templates/curated";
import { type Command, History, newDocument } from "./document";
import { StructureGuard, structureOf } from "./guard";

// Jake's sample, invented, as a document the guard watches (decision 0041).
const { sample } = curated("jake");
const opened = newDocument("jake", sample, "en-US");

const moved: Command = { type: "structure", op: { op: "moveSection", id: "skills", to: 0 } };
const typed: Command = { type: "text", field: "exp.title", text: "Work" };

describe("structureOf", () => {
  it("changes with a node added, removed or moved, or a section's role, and not with a field's text", () => {
    const structure = structureOf(opened.resume);
    const history = new History(opened);
    expect(structureOf(history.dispatch(typed).resume)).toBe(structure);
    expect(structureOf(history.dispatch(moved).resume)).not.toBe(structure);
    const role = new History(opened).dispatch({
      type: "structure",
      op: { op: "setSection", id: "proj", role: "other" },
    });
    expect(structureOf(role.resume)).not.toBe(structure);
    const removed = new History(opened).dispatch({
      type: "structure",
      op: { op: "removeSection", id: "proj" },
    });
    expect(structureOf(removed.resume)).not.toBe(structure);
  });
});

describe("StructureGuard", () => {
  it("saves a field's edit at once, and holds a structural step until a page shows it", () => {
    const guard = new StructureGuard();
    const history = new History(opened);
    history.dispatch(typed);
    expect(guard.changed(history, opened)).toBe(true);
    const before = history.present;
    history.dispatch(moved);
    expect(guard.changed(history, before)).toBe(false);
    expect(guard.holds(history)).toBe(true);
    // What is typed after it waits with it.
    const after = history.present;
    history.dispatch({ type: "text", field: "edu.title", text: "Schooling" });
    expect(guard.changed(history, after)).toBe(false);
    // A page of the document before the step, still on its way, lets go of nothing.
    expect(guard.paged(before)).toBe(false);
    expect(guard.holds(history)).toBe(true);
    // The page of the step's structure does: the present is saved.
    expect(guard.paged(history.present)).toBe(true);
    expect(guard.holds(history)).toBe(false);
    expect(guard.changed(history, history.present)).toBe(true);
  });

  it("takes a step whose compile stops back, with what came after it, to the last page shown", () => {
    const guard = new StructureGuard();
    const history = new History(opened);
    history.dispatch(typed);
    guard.changed(history, opened);
    const shown = history.present;
    history.dispatch(moved);
    guard.changed(history, shown);
    const stopped = history.present;
    history.dispatch({ type: "text", field: "edu.title", text: "Schooling" });
    guard.changed(history, stopped);
    // A compile of another structure stopped for another reason: not the step's to take back.
    expect(guard.stopped(shown)).toBe(false);
    expect(guard.stopped(history.present)).toBe(true);
    expect(history.present).toBe(shown);
    expect(guard.holds(history)).toBe(false);
    // What was taken back can be done again, and is held again.
    const redone = history.redo();
    expect(redone).toBe(stopped);
    expect(guard.changed(history, shown)).toBe(false);
  });

  it("holds an undo or a redo that changes the structure, as any structural step", () => {
    const guard = new StructureGuard();
    const history = new History(opened);
    history.dispatch(moved);
    expect(guard.changed(history, opened)).toBe(false);
    expect(guard.paged(history.present)).toBe(true);
    const step = history.present;
    history.undo();
    expect(guard.changed(history, step)).toBe(false);
    expect(guard.paged(opened)).toBe(true);
  });

  it("lets go of what it holds when another document opens, which saves none of it", () => {
    const guard = new StructureGuard();
    const history = new History(opened);
    history.dispatch(moved);
    guard.changed(history, opened);
    guard.forget();
    expect(guard.holds(history)).toBe(false);
    expect(guard.paged(history.present)).toBe(false);
    expect(guard.stopped(history.present)).toBe(false);
  });
});

describe("StructureGuard, holding every change of an imported outline", () => {
  // What `every` holds: an outline's field's text may stop the compile, as a letter its fonts lack
  // does (the second pass's item 7). The guard is told of each change, each page and each stop as
  // the app tells it; the documents here are Jake's invented sample's, the guard's rule the same.
  const type = (history: History, text: string) =>
    history.dispatch({ type: "text", field: "exp.title", text }, "field:exp.title");

  it("holds a field's edit until a page of the present shows it", () => {
    const guard = new StructureGuard();
    const history = new History(opened);
    type(history, "W");
    expect(guard.changed(history, opened, true)).toBe(false);
    const first = history.present;
    type(history, "Wo");
    expect(guard.changed(history, first, true)).toBe(false);
    // A page of an earlier document lets go of nothing.
    expect(guard.paged(first)).toBe(false);
    expect(guard.holds(history)).toBe(true);
    expect(guard.paged(history.present)).toBe(true);
    expect(guard.holds(history)).toBe(false);
  });

  it("takes a stop back to the last document a page showed, within one visit, with nothing to redo", () => {
    const guard = new StructureGuard();
    const history = new History(opened);
    history.dispatch(typed);
    history.seal();
    const saved = history.present;
    type(history, "W");
    guard.changed(history, saved, true);
    const shown = history.present;
    type(history, "Wo");
    guard.changed(history, shown, true);
    // The page of the first keystroke came: a stop now takes back to it, inside the visit.
    expect(guard.paged(shown)).toBe(false);
    type(history, "Wor");
    guard.changed(history, history.present, true);
    // An earlier document's stop says nothing: the present compiles next.
    expect(guard.stopped(shown)).toBe(false);
    expect(guard.stopped(history.present)).toBe(true);
    expect(history.present).toBe(shown);
    expect(history.canRedo).toBe(false);
    // Undo still takes back the visit as one step, to the document saved before it.
    expect(history.undo()).toBe(saved);
    expect(guard.holds(history)).toBe(false);
  });

  it("takes a stop back to where a step began, dropping the step", () => {
    const guard = new StructureGuard();
    const history = new History(opened);
    history.dispatch(typed);
    const saved = history.present;
    history.dispatch(moved);
    guard.changed(history, saved, true);
    expect(guard.stopped(history.present)).toBe(true);
    expect(history.present).toBe(saved);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBe(opened);
  });
});
