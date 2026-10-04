import { describe, expect, it } from "vitest";
import {
  featuresOf,
  type Labeller,
  labelByRules,
  labelLines,
  ROLES,
  type Role,
  rolesFit,
  rulesLabeller,
} from "./label.ts";
import { layOut } from "./layout.ts";
import type { ReadPdf, TextRun } from "./read.ts";
import { resumeOfPdf } from "./resume.ts";

function run(text: string, x: number, baseline: number, options: Partial<TextRun> = {}): TextRun {
  const size = options.size ?? 10;
  return {
    text,
    x,
    baseline,
    size,
    width: options.width ?? 0.5 * size * text.length,
    font: options.font ?? "Invented-Regular",
    bold: options.bold ?? false,
    italic: options.italic ?? false,
  };
}

/** An invented resume, as a page sets it. */
const read: ReadPdf = {
  pages: [
    {
      number: 1,
      width: 612,
      height: 792,
      runs: [
        run("Wren Halloway", 200, 60, { size: 22, bold: true }),
        run("wren@example.com", 230, 85),
        run("EXPERIENCE", 50, 120, { size: 12, bold: true }),
        run("Compositor", 50, 140, { bold: true }),
        run("Mar 2019 – Present", 480, 140),
        run("•", 55, 160),
        run("Set the type for forty books a year.", 65, 160),
      ],
      links: [],
      marks: [],
    },
  ],
  ms: 0,
};

const layout = layOut(read);

/** A labeller standing in for the hosted model: it answers what it is told to. */
const answering = (answer: () => unknown): Labeller => ({
  by: "model",
  label: async () => answer() as Role[],
});

describe("the labelling step's seam", () => {
  it("gives one role a line from the closed list, by rules", async () => {
    const labels = await labelLines(layout);
    expect(labels).toEqual({ roles: labelByRules(layout), by: "rules" });
    expect(labels.roles).toEqual([
      "name",
      "contact",
      "section heading",
      "entry head",
      "date",
      "bullet",
    ]);
    expect(labels.roles.every((role) => ROLES.includes(role))).toBe(true);
  });

  it("takes a labeller's roles, line for line, and files them as the rules' are", async () => {
    // A model that calls the date a place: the filing step files what it is given.
    const roles = labelByRules(layout).map((role) => (role === "date" ? "place" : role));
    const { labels, filed } = await resumeOfPdf(read, { labeller: answering(() => roles) });
    expect(labels).toEqual({ roles, by: "model" });
    expect(filed.resume.sections[0]).toMatchObject({
      entries: [{ title: "Compositor", place: "Mar 2019 – Present" }],
    });
  });

  it("gives every labeller the same lines, whose features a model may be told", async () => {
    let given: unknown;
    const spy: Labeller = {
      by: "model",
      label: (input) => {
        given = input;
        return labelByRules(input);
      },
    };
    await labelLines(layout, spy);
    expect(given).toBe(layout);
    const features = featuresOf(layout);
    expect(features.map((line) => line.text)).toEqual(layout.lines.map((line) => line.text));
    expect(features[0]).toMatchObject({ id: 0, bold: true, size: 2.2, column: 0, columns: 1 });
  });

  it("falls back to the rules when a labeller fails, or answers in the wrong form", async () => {
    const rules = labelByRules(layout);
    await expect(
      labelLines(
        layout,
        answering(() => {
          throw new Error("the service did not answer");
        }),
      ),
    ).resolves.toEqual({ roles: rules, by: "rules", fallback: "failed" });
    for (const wrong of [
      rules.slice(1),
      [...rules, "bullet"],
      rules.map((role, index) => (index === 0 ? "headline" : role)),
      "name",
      undefined,
    ])
      await expect(
        labelLines(
          layout,
          answering(() => wrong),
        ),
      ).resolves.toEqual({
        roles: rules,
        by: "rules",
        fallback: "wrong form",
      });
  });

  it("does not answer for a labeller its caller stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    const stopped: Labeller = {
      by: "model",
      label: async (_, { signal }) => {
        signal?.throwIfAborted();
        return labelByRules(layout);
      },
    };
    await expect(labelLines(layout, stopped, { signal: controller.signal })).rejects.toThrow();
  });

  it("knows a fitting answer", () => {
    expect(rolesFit(layout.lines, labelByRules(layout))).toBe(true);
    expect(rolesFit(layout.lines, [])).toBe(false);
    expect(rulesLabeller.by).toBe("rules");
  });
});
