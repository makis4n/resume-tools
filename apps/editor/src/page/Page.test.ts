import { describe, expect, it } from "vitest";
import { fieldAt, onPageClick } from "./Page";

/** Just enough of an element for fieldAt: `closest` finds `found` for the field selector. */
const target = (found: Record<string, string> | null) =>
  ({
    closest: (selector: string) =>
      selector === "[data-field]" && found
        ? { getAttribute: (name: string) => found[name] ?? null }
        : null,
  }) as unknown as Element;

describe("fieldAt", () => {
  it("reads the field and character offset of the glyph under a click", () => {
    expect(fieldAt(target({ "data-field": "name", "data-offset": "7" }))).toEqual({
      field: "name",
      offset: 7,
    });
  });

  it("finds nothing off a field, or without an offset", () => {
    expect(fieldAt(target(null))).toBeUndefined();
    expect(fieldAt(null)).toBeUndefined();
    expect(fieldAt(target({ "data-field": "name" }))).toBeUndefined();
  });
});

describe("onPageClick", () => {
  it("reports the field and the character the click landed on, as they are", () => {
    const clicks: [string, number][] = [];
    const click = onPageClick((field, offset) => clicks.push([field, offset]));
    click({ target: target({ "data-field": "name", "data-offset": "7" }) });
    click({ target: target(null) });
    expect(clicks).toEqual([["name", 7]]);
  });
});
