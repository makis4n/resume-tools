import { describe, expect, it } from "vitest";
import { Resume } from "./index";

describe("Resume", () => {
  it("accepts a minimal resume", () => {
    const result = Resume.safeParse({
      version: 1,
      header: { name: "Ada Lovelace", links: [] },
      sections: [
        {
          kind: "entries",
          id: "experience",
          title: "Experience",
          entries: [
            {
              id: "analytical-engine",
              title: "Analyst",
              place: "London",
              dates: { start: "1842", end: "1843" },
              bullets: [[{ text: "Wrote the first program." }]],
            },
          ],
        },
        { kind: "list", id: "skills", title: "Skills", items: [[{ text: "Mathematics" }]] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bad date", () => {
    const result = Resume.safeParse({
      version: 1,
      header: { name: "x", links: [] },
      sections: [
        {
          kind: "entries",
          id: "e",
          title: "E",
          entries: [
            { id: "1", title: "t", dates: { start: "March 2020", end: null }, bullets: [] },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
