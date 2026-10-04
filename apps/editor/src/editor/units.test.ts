import {
  MAX_OUTLINE,
  OUTLINE_PLACEHOLDER,
  type OutlineGroup,
  type OutlinePart,
  outlineNodes,
  Resume,
} from "@resume-tools/resume-model";
import { describe, expect, it } from "vitest";
import { generateBody } from "../templates/generate";
import type { TemplatePackage } from "../templates/package";
import {
  AWARD_PREAMBLE,
  AWARDS,
  inventedOutline,
  outlineParts,
  SKILLS,
} from "../test/invented-outline";
import { movedDown, type Placed } from "../test/moved-down";
import {
  applyUnder,
  CommandError,
  type Document,
  History,
  type StructureOp,
  UnitRefused,
} from "./document";
import { endsField } from "./Overlay";
import {
  alike,
  FIXED_WHY,
  NOT_ALIKE,
  ONLY_UNIT,
  outlineFields,
  outlineIds,
  outlineOf,
  unitEnding,
  unitPlace,
  unitShape,
} from "./outline";

// Adding, removing and moving an outline's units (the second pass's item 8). Every word is
// invented.

const step = (op: StructureOp) => ({ type: "structure", op }) as const;

/** The group `id` of a document's outline. */
function groupOf(document: Document, id: string): OutlineGroup {
  const outline = outlineOf(document.resume);
  for (const node of outlineNodes(outline?.parts ?? []))
    if (node.kind === "part" && node.part.kind === "group" && node.part.id === id) return node.part;
  throw new Error(`no group ${id}`);
}

/** The body the generator writes of a document. */
const body = (pkg: TemplatePackage, document: Document) =>
  generateBody(pkg, document.resume, document.controls);

/** A body with each field's marker taken off its text, as these tests' texts hold no brace. */
const unmarked = (latex: string) => latex.replace(/\\rtfield\{[^}]*\}\{([^}]*)\}/g, "$1");

/** The ids of a group's units, in order. */
const unitIds = (document: Document, group: string) =>
  groupOf(document, group).units.map((unit) => unit.id);

/** Every id the document's outline holds, which must be unique across it. */
const allIds = (document: Document) => outlineIds(outlineOf(document.resume)?.parts ?? []);

/** The invented outline with the group `id` marked fixed, with why. */
function withFixed(parts: OutlinePart[], id: string, why: OutlineGroup["fixed"]): OutlinePart[] {
  return parts.map((part) =>
    part.kind === "group" && part.id === id ? { ...part, fixed: why } : part,
  );
}

describe("an outline's units", () => {
  it("take a copy of a bullet after it, its field emptied, its kept text and gap byte for byte", async () => {
    const { pkg, document } = await inventedOutline();
    const after = applyUnder(pkg, document, step({ op: "addUnit", after: "lantern-1" }));
    const units = groupOf(after, "lantern-bullets").units;
    expect(units.map((unit) => unit.id).filter((id) => id !== units[1]?.id)).toEqual([
      "lantern-1",
      "lantern-2",
    ]);
    // A copy of the last bullet, as the import's checks tried it, after the first, of its shape.
    const [original, copy] = [units[2], units[1]];
    if (original === undefined || copy === undefined) throw new Error("no copy");
    // Its kept text and its gap are the very strings of the unit it copies.
    expect(copy.gap).toBe(original.gap);
    const kept = (parts: OutlinePart[]) => parts.filter((part) => part.kind === "kept");
    expect(kept(copy.parts)).toEqual(kept(original.parts));
    expect(kept(copy.parts)[0]).toBe(kept(original.parts)[0]);
    // Its field emptied, under a new id.
    const [field] = [...outlineFields(copy.parts)];
    expect(field?.part).toEqual({ kind: "rich", id: field?.part.id, text: [] });
    expect(field?.part.id).not.toBe("lantern-1-text");
    // Every id unique across the document, as the model reads it.
    expect(new Set(allIds(after)).size).toBe(allIds(after).length);
    expect(Resume.safeParse(after.resume).success).toBe(true);
    // The rest of the outline is the one before, shared.
    const outline = outlineOf(after.resume);
    expect(outline?.parts[0]).toBe(outlineOf(document.resume)?.parts[0]);
    expect(groupOf(after, "mill-bullets")).toBe(groupOf(document, "mill-bullets"));
  });

  it("copy an entry whole: its fields emptied and its bullets copied, every id new", async () => {
    const parts = outlineParts();
    // The company required, as the checks mark a field that stops the compile when empty.
    const roles = parts[3];
    if (roles?.kind !== "group") throw new Error("no roles");
    const [lantern, mill] = roles.units;
    if (lantern === undefined || mill === undefined) throw new Error("no roles");
    parts[3] = {
      ...roles,
      units: [
        lantern,
        {
          ...mill,
          parts: mill.parts.map((part) =>
            part.kind === "text" && part.id === "mill-company" ? { ...part, required: true } : part,
          ),
        },
      ],
    };
    const { pkg, document } = await inventedOutline(parts);
    const after = applyUnder(pkg, document, step({ op: "addUnit", after: "mill" }));
    const copy = groupOf(after, "roles").units[2];
    if (copy === undefined) throw new Error("no copy");
    const fields = [...outlineFields(copy.parts)].map(({ part }) => part);
    // The required company holds the placeholder, and stays required; the rest are empty.
    expect(fields.map((part) => part.text)).toEqual([OUTLINE_PLACEHOLDER, "", []]);
    expect(fields.map((part) => part.required === true)).toEqual([true, false, false]);
    const before = new Set(allIds(document));
    const minted = outlineIds([{ kind: "group", id: "x", units: [copy] }]).slice(1);
    expect(minted).toHaveLength(6);
    expect(minted.filter((id) => before.has(id))).toEqual([]);
    expect(new Set(allIds(after)).size).toBe(allIds(after).length);
    // Its gap is the one it was copied with, as is every piece of its kept text.
    expect(copy.gap).toBe(mill.gap);
    expect(unmarked(body(pkg, after).latex)).toContain(
      "Mill and Sons}{2019}\n\\begin{itemize}\n  \\item Cut half of the waste in the shop\n\\end{itemize}\n\n\\role{New text}{}\n\\begin{itemize}\n  \\item \n\\end{itemize}",
    );
  });

  it("are removed, and a removed copy leaves the body the one before to the byte", async () => {
    const { pkg, document } = await inventedOutline();
    const added = applyUnder(pkg, document, step({ op: "addUnit", after: "lantern-2" }));
    const copy = unitIds(added, "lantern-bullets")[2];
    if (copy === undefined) throw new Error("no copy");
    const removed = applyUnder(pkg, added, step({ op: "removeUnit", id: copy }));
    expect(body(pkg, removed).latex).toBe(body(pkg, document).latex);
    // The first removed: the second, its gap no more written, comes first.
    const first = applyUnder(pkg, document, step({ op: "removeUnit", id: "lantern-1" }));
    expect(unitIds(first, "lantern-bullets")).toEqual(["lantern-2"]);
    expect(unmarked(body(pkg, first).latex)).toContain(
      "\\begin{itemize}\n  \\item Kept the press running through the winter\n\\end{itemize}",
    );
  });

  it("never lose a group's only unit", async () => {
    const { pkg, document } = await inventedOutline();
    expect(() => applyUnder(pkg, document, step({ op: "removeUnit", id: "mill-1" }))).toThrow(
      CommandError,
    );
  });

  it("move among their siblings, each with its gap", async () => {
    const parts = outlineParts();
    const roles = parts[3];
    if (roles?.kind !== "group") throw new Error("no roles");
    // Bullets parted by gaps of their own, the second's with a comment.
    const bullets = (roles.units[0]?.parts[5] ?? roles) as OutlineGroup;
    const [one, two] = bullets.units;
    if (one === undefined || two === undefined) throw new Error("no bullets");
    const three = {
      ...two,
      id: "lantern-3",
      gap: "\n  % third\n  ",
      parts: two.parts.map((part) =>
        part.kind === "rich"
          ? { ...part, id: "lantern-3-text", text: [{ text: "Bound ledgers" }] }
          : part,
      ),
    };
    const lantern = roles.units[0];
    if (lantern === undefined) throw new Error("no role");
    const changed = { ...bullets, units: [one, two, three] };
    parts[3] = {
      ...roles,
      units: [
        { ...lantern, parts: lantern.parts.map((part) => (part === bullets ? changed : part)) },
        ...roles.units.slice(1),
      ],
    };
    const { pkg, document } = await inventedOutline(parts);
    const moved = applyUnder(pkg, document, step({ op: "moveUnit", id: "lantern-3", to: 0 }));
    expect(unitIds(moved, "lantern-bullets")).toEqual(["lantern-3", "lantern-1", "lantern-2"]);
    // The third, now first, writes no gap; the first, now second, writes its own, the upload's
    // gap beside the second (the builder gives a group's first unit its second's gap).
    expect(unmarked(body(pkg, moved).latex)).toContain(
      "\\begin{itemize}\n  \\item Bound ledgers\n  \\item Set careful type for forty journals\n  \\item Kept the press running through the winter\n\\end{itemize}",
    );
    // Moved back, the body is the one before to the byte, the comment's gap with it.
    const back = applyUnder(pkg, moved, step({ op: "moveUnit", id: "lantern-3", to: 2 }));
    expect(body(pkg, back).latex).toBe(body(pkg, document).latex);
    expect(() =>
      applyUnder(pkg, document, step({ op: "moveUnit", id: "lantern-1", to: 3 })),
    ).toThrow(CommandError);
    expect(() =>
      applyUnder(pkg, document, step({ op: "moveUnit", id: "lantern-1", to: -1 })),
    ).toThrow(CommandError);
  });

  it("of a fixed group take no copy, removal or move", async () => {
    for (const why of ["copy", "removal", "untried"] as const) {
      const { pkg, document } = await inventedOutline(withFixed(outlineParts(), "roles", why));
      for (const op of [
        { op: "addUnit", after: "mill" },
        { op: "removeUnit", id: "mill" },
        { op: "moveUnit", id: "mill", to: 0 },
      ] as const)
        expect(() => applyUnder(pkg, document, step(op))).toThrow(CommandError);
      // A group inside one of its units is no fixed group, and takes them.
      const after = applyUnder(pkg, document, step({ op: "addUnit", after: "lantern-2" }));
      expect(unitIds(after, "lantern-bullets")).toHaveLength(3);
    }
  });

  it("refuse a unit the outline has not, and a copy past the outline's size", async () => {
    const { pkg, document } = await inventedOutline();
    expect(() => applyUnder(pkg, document, step({ op: "addUnit", after: "nobody" }))).toThrow(
      CommandError,
    );
    expect(() => applyUnder(pkg, document, step({ op: "addUnit", after: "roles" }))).toThrow(
      CommandError,
    );
    // A bullet whose kept text is over half the outline's limit takes no copy.
    const parts = outlineParts();
    const big = await inventedOutline(
      parts.map((part, i) =>
        i === 3 && part.kind === "group"
          ? {
              ...part,
              units: part.units.map((unit) =>
                unit.id === "mill"
                  ? {
                      ...unit,
                      parts: [
                        { kind: "kept", latex: `%${"y".repeat(MAX_OUTLINE / 2)}\n` },
                        ...unit.parts,
                      ],
                    }
                  : unit,
              ),
            }
          : part,
      ),
    );
    expect(() => applyUnder(big.pkg, big.document, step({ op: "addUnit", after: "mill" }))).toThrow(
      CommandError,
    );
  });

  it("are added, removed and moved as steps undo takes back and redo does again, ids unique each time", async () => {
    const { pkg, document } = await inventedOutline();
    const history = new History(document, pkg);
    history.dispatch(step({ op: "addUnit", after: "lantern-1" }));
    const added = history.present;
    const copy = unitIds(added, "lantern-bullets")[1] as string;
    history.dispatch(step({ op: "moveUnit", id: copy, to: 0 }));
    history.dispatch(step({ op: "removeUnit", id: "lantern-2" }));
    expect(unitIds(history.present, "lantern-bullets")).toEqual([copy, "lantern-1"]);
    history.undo();
    history.undo();
    expect(history.present).toBe(added);
    history.undo();
    expect(history.present).toBe(document);
    history.redo();
    expect(history.present).toBe(added);
    // A copy made again after an undo has ids of its own, unique in its document.
    history.undo();
    history.dispatch(step({ op: "addUnit", after: "lantern-1" }));
    expect(unitIds(history.present, "lantern-bullets")[1]).not.toBe(copy);
    for (let n = 0; n < 40; n++)
      history.dispatch(
        step({ op: "addUnit", after: unitIds(history.present, "roles")[0] as string }),
      );
    const ids = allIds(history.present);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Resume.safeParse(history.present.resume).success).toBe(true);
  });
});

describe("the unit a field ends", () => {
  it("is a bullet's at its text, an entry's at its last field before its bullets, and none elsewhere", async () => {
    const { document } = await inventedOutline();
    const parts = outlineOf(document.resume)?.parts ?? [];
    const place = unitEnding(parts, "lantern-2-text");
    expect(place?.group.id).toBe("lantern-bullets");
    expect(place?.index).toBe(1);
    // An entry's last field before its bullets ends the entry; its company, before it, nothing.
    expect(unitEnding(parts, "lantern-company")).toBeUndefined();
    const entry = unitEnding(parts, "lantern-dates");
    expect([entry?.group.id, entry?.index]).toEqual(["roles", 0]);
    // A field in no group, and one the outline has not.
    expect(unitEnding(parts, "work")).toBeUndefined();
    expect(unitEnding(parts, "nobody")).toBeUndefined();
    expect(unitPlace(parts, "mill-1")?.group.id).toBe("mill-bullets");
  });

  it("is an entry's where its last written field has no bullets after it", async () => {
    const parts = outlineParts();
    const roles = parts[3];
    if (roles?.kind !== "group") throw new Error("no roles");
    // The mill's bullet emptied: its dates are the last it writes.
    parts[3] = {
      ...roles,
      units: roles.units.map((unit) =>
        unit.id !== "mill"
          ? unit
          : {
              ...unit,
              parts: unit.parts.map((part) =>
                part.kind === "group"
                  ? {
                      ...part,
                      units: part.units.map((each) => ({
                        ...each,
                        parts: each.parts.map((inner) =>
                          inner.kind === "rich" ? { ...inner, text: [] } : inner,
                        ),
                      })),
                    }
                  : part,
              ),
            },
      ),
    };
    const { document } = await inventedOutline(parts);
    const place = unitEnding(outlineOf(document.resume)?.parts ?? [], "mill-dates");
    expect(place?.group.id).toBe("roles");
    expect(place?.index).toBe(1);
  });
});

describe("Enter at a plain field's end", () => {
  const key = (init: Partial<KeyboardEvent> = {}) => ({
    key: "Enter",
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    ...init,
  });

  it("is Enter alone, nothing selected, the caret after the last character", () => {
    expect(endsField(key(), true, 12, 12)).toBe(true);
    expect(endsField(key(), true, 11, 12)).toBe(false);
    expect(endsField(key(), false, 12, 12)).toBe(false);
    expect(endsField(key(), true, undefined, 12)).toBe(false);
    for (const held of ["shiftKey", "altKey", "ctrlKey", "metaKey", "isComposing"] as const)
      expect(endsField(key({ [held]: true }), true, 12, 12)).toBe(false);
    expect(endsField(key({ key: "Tab" }), true, 12, 12)).toBe(false);
  });
});

describe("a page after a unit was added, read against the page before", () => {
  /** A line of glyphs at `y` on `page`, one a character of `text`, from x = 10. */
  const line = (text: string, y: number, page = 0): Placed[] =>
    [...text].map((char, i) => ({ page, x: 10 + i, y, text: char, font: "cmr10", size: 10 }));

  it("is the page before but for glyphs that set no letter and what moved down", () => {
    const before = [...line("Head", 10), ...line("•One", 20), ...line("•Two", 30)];
    // A bullet between the two, whose own glyph stands higher than the next one's did.
    const after = [...line("Head", 10), ...line("•One", 20), ...line("•", 28), ...line("•Two", 40)];
    expect(movedDown(before, after)).toMatchObject({ added: 1, runs: 1 });
    // A line moved onto the next page, past the foot of its own, which stands where it stood.
    const footed = [...before, ...line("Foot", 90)];
    const moved = [...line("Head", 10), ...line("•One", 20), ...line("•", 30), ...line("Foot", 90)];
    expect(movedDown(footed, [...moved, ...line("•Two", 5, 1)])).toMatchObject({
      added: 1,
      runs: 1,
    });
  });

  it("is not where a letter is added, a glyph goes, or one moves up", () => {
    const before = [...line("Head", 10), ...line("•One", 20)];
    expect(movedDown(before, [...line("Head", 10), ...line("•Ones", 20)]).problem).toBeDefined();
    expect(movedDown(before, [...line("Head", 10), ...line("•On", 20)]).problem).toBeDefined();
    expect(movedDown(before, [...line("Head", 10), ...line("•One", 15)]).problem).toBeDefined();
    expect(movedDown(before, before)).toEqual({ added: 0, runs: 0, rise: 0 });
    // A new entry's kept text may set words, where they are asked for, in one run.
    const words = [...line("Head", 10), ...line("New", 15), ...line("•One", 25)];
    expect(movedDown(before, words).problem).toBeDefined();
    expect(movedDown(before, words, { words: true })).toMatchObject({ added: 3, runs: 1 });
  });
});

describe("units not all of one shape", () => {
  it("take no move, and a copy only after the last, saying why in plain words", async () => {
    for (const [parts, group, first, last] of [
      [AWARDS, "awards", "alpha", "gamma"],
      [SKILLS, "skills", "skill-1", "skill-3"],
    ] as const) {
      const { pkg, document } = await inventedOutline([...parts], AWARD_PREAMBLE);
      expect(alike(groupOf(document, group))).toBe(false);
      const refused = (op: StructureOp) => {
        try {
          applyUnder(pkg, document, step(op));
        } catch (error) {
          return error instanceof UnitRefused ? error.plain : "another error";
        }
        return "taken";
      };
      // A move would carry a line break or a comma, or the closing paragraph, where it is not.
      expect(refused({ op: "moveUnit", id: last, to: 0 })).toBe(NOT_ALIKE);
      expect(refused({ op: "moveUnit", id: first, to: 1 })).toBe(NOT_ALIKE);
      // After the first, a copy of the last would bring its closing paragraph's place with it.
      expect(refused({ op: "addUnit", after: first })).toBe(NOT_ALIKE);
      // After the last, it is the copy the checks tried.
      expect(refused({ op: "addUnit", after: last })).toBe("taken");
      expect(refused({ op: "removeUnit", id: first })).toBe("taken");
    }
  });

  it("is told apart from units of one shape, whatever their bullets", async () => {
    const { document } = await inventedOutline();
    // The roles: one with two bullets, one with one, of one shape outside them.
    expect(alike(groupOf(document, "roles"))).toBe(true);
    expect(alike(groupOf(document, "lantern-bullets"))).toBe(true);
    const [lantern, mill] = groupOf(document, "roles").units;
    if (lantern === undefined || mill === undefined) throw new Error("no roles");
    expect(unitShape(lantern)).toBe(unitShape(mill));
    expect(unitShape(lantern)).not.toMatch(/Lantern|Set careful/);
  });

  it("an entry with bullets takes a copy of the last entry after it, from Enter at its dates", async () => {
    const { pkg, document } = await inventedOutline();
    const parts = outlineOf(document.resume)?.parts ?? [];
    const place = unitEnding(parts, "lantern-dates");
    const unit = place?.group.units[place.index];
    if (unit === undefined) throw new Error("no entry");
    const after = applyUnder(pkg, document, step({ op: "addUnit", after: unit.id }));
    const roles = groupOf(after, "roles").units;
    expect(roles.map((each) => each.id).filter((id) => id !== roles[1]?.id)).toEqual([
      "lantern",
      "mill",
    ]);
    // The mill's shape: one bullet, every field emptied.
    expect(unmarked(body(pkg, after).latex)).toContain(
      "\\end{itemize}\n\n\\role{}{}\n\\begin{itemize}\n  \\item \n\\end{itemize}\n\n\\role{Mill and Sons}",
    );
  });

  it("refuse with why in plain words: a fixed group's and an only unit's", async () => {
    const { pkg, document } = await inventedOutline(withFixed(outlineParts(), "roles", "stops"));
    const why = (op: StructureOp) => {
      try {
        applyUnder(pkg, document, step(op));
      } catch (error) {
        return error instanceof UnitRefused ? error.plain : undefined;
      }
    };
    expect(why({ op: "addUnit", after: "mill" })).toBe(FIXED_WHY.stops);
    expect(why({ op: "removeUnit", id: "mill-1" })).toBe(ONLY_UNIT);
    for (const text of Object.values(FIXED_WHY)) expect(text).not.toMatch(/[\\{}]/);
    expect(FIXED_WHY.stops).not.toBe(FIXED_WHY.copy);
  });
});
