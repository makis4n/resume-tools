import type { OutlinePart } from "@resume-tools/resume-model";
import { describe, expect, it } from "vitest";
import { inventedOutline, outlineParts } from "../test/invented-outline";
import type { Document } from "./document";
import { withOutcomeMarks } from "./early-import";
import { outlineOf } from "./outline";

/** The outline's parts with each group `fixed` names fixed, and each field `required` names required. */
function marked(
  parts: readonly OutlinePart[],
  fixed: Record<string, "copy" | "untried">,
  required: readonly string[],
): OutlinePart[] {
  return parts.map((part): OutlinePart => {
    if (part.kind === "group") {
      const why = fixed[part.id];
      return {
        ...part,
        ...(why === undefined ? {} : { fixed: why }),
        units: part.units.map((unit) => ({ ...unit, parts: marked(unit.parts, fixed, required) })),
      };
    }
    if ((part.kind === "text" || part.kind === "rich") && required.includes(part.id))
      return { ...part, required: true };
    return part;
  });
}

/** A document's outline's parts with the field `id`, a plain one, holding `text`. */
function typed(doc: Document, id: string, text: string): Document {
  const type = (parts: readonly OutlinePart[]): OutlinePart[] =>
    parts.map((part): OutlinePart => {
      if (part.kind === "group")
        return { ...part, units: part.units.map((unit) => ({ ...unit, parts: type(unit.parts) })) };
      return part.kind === "text" && part.id === id ? { ...part, text } : part;
    });
  return {
    ...doc,
    resume: {
      ...doc.resume,
      sections: doc.resume.sections.map((section) =>
        section.kind === "outline" ? { ...section, parts: type(section.parts) } : section,
      ),
    },
  };
}

describe("an import's document as its outcome comes (decision 0071)", () => {
  it("is the outcome's own where nothing was typed meanwhile", async () => {
    const { document: staged } = await inventedOutline(marked(outlineParts(), {}, ["mill-dates"]));
    const { document: final } = await inventedOutline(
      marked(outlineParts(), { "lantern-bullets": "copy" }, ["mill-dates"]),
    );
    expect(withOutcomeMarks(staged, final)).toBe(final);
    expect(withOutcomeMarks(final, final)).toBe(final);
  });

  it("keeps what was typed, and takes the outcome's fixed groups and required fields", async () => {
    const { document: staged } = await inventedOutline(marked(outlineParts(), {}, []));
    const { document: final } = await inventedOutline(
      marked(outlineParts(), { roles: "untried", "mill-bullets": "copy" }, ["lantern-company"]),
    );
    const present = typed(staged, "mill-dates", "2018");
    const landed = withOutcomeMarks(present, final);
    expect(landed).not.toBe(final);
    expect(landed).toEqual(typed(final, "mill-dates", "2018"));
    const parts = outlineOf(landed.resume)?.parts ?? [];
    const roles = parts.find((part) => part.kind === "group" && part.id === "roles");
    expect(roles?.kind === "group" && roles.fixed).toBe("untried");
  });

  it("takes a mark away that the outcome does not give", async () => {
    const { document: staged } = await inventedOutline(
      marked(outlineParts(), { roles: "copy" }, ["mill-dates"]),
    );
    const { document: final } = await inventedOutline(marked(outlineParts(), {}, []));
    const present = typed(staged, "lantern-dates", "2020 -- 2024");
    expect(withOutcomeMarks(present, final)).toEqual(typed(final, "lantern-dates", "2020 -- 2024"));
  });
});
