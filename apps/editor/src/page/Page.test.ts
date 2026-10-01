import { describe, expect, it } from "vitest";
import { fieldAt, lockedAt, onPageClick } from "./Page";

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

describe("lockedAt", () => {
  /** Just enough of an element: `closest` finds what `attributes` holds for each selector. */
  const under = (attributes: Record<string, string>) =>
    ({
      closest: (selector: string) => {
        const name = /^\[([a-z-]+)\]$/.exec(selector)?.[1];
        return name !== undefined && name in attributes
          ? { getAttribute: (asked: string) => attributes[asked] ?? null }
          : null;
      },
    }) as unknown as Element;

  it("reads the locked part a glyph or a block of it carries (decision 0041)", () => {
    expect(lockedAt(under({ "data-locked": "lock-hobbies" }))).toBe("lock-hobbies");
  });

  it("finds none over a field's glyph, whatever lies under it, off a part, or off any element", () => {
    expect(
      lockedAt(under({ "data-field": "name", "data-locked": "lock-hobbies" })),
    ).toBeUndefined();
    expect(lockedAt(under({}))).toBeUndefined();
    expect(lockedAt(under({ "data-locked": "" }))).toBeUndefined();
    expect(lockedAt(null)).toBeUndefined();
    expect(lockedAt({} as Element)).toBeUndefined();
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
