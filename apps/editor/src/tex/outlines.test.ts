import { describe, expect, it } from "vitest";
import type { FontOutlines } from "./glyphs";
import { reencode, transform, transformBox, transformPath } from "./outlines";

const FONT: FontOutlines = {
  name: "Test",
  encoding: ["A", "B", ...Array.from({ length: 254 }, () => ".notdef")],
  glyphs: {
    A: { w: 600, d: "M0 0L500 0L250 700Z", b: [0, 0, 500, 700] },
    B: { w: 500, d: "", b: null },
  },
};

describe("transformPath", () => {
  const every = "M0 0L100 0C100 50 50 100 0 100Q-50 50 0 0Z";

  it("maps every point of every command, and keeps the commands", () => {
    // Stretched to 0.85 and slanted by 0.2: x' = 0.85x + 0.2y.
    expect(transformPath(every, [0.85, 0, 0.2, 1, 0, 0])).toBe(
      "M0 0L85 0C95 50 62.5 100 20 100Q-32.5 50 0 0Z",
    );
    // Scaled by a half and moved, as a virtual font places a glyph.
    expect(transformPath(every, [0.5, 0, 0, 0.5, 10, -20])).toBe(
      "M10 -20L60 -20C60 5 35 30 10 30Q-15 5 10 -20Z",
    );
  });

  it("rounds to three decimals, and reads what it writes", () => {
    const once = transformPath("M1 1L2 3", [1 / 3, 0, 0, 1 / 3, 0, 0]);
    expect(once).toBe("M0.333 0.333L0.667 1");
    expect(transformPath(once, [1, 0, 0, 1, 0, 0])).toBe(once);
    expect(transformPath("M-.5 1e2", [1, 0, 0, 1, 0, 0])).toBe("M-0.5 100");
    expect(transformPath("", [2, 0, 0, 2, 0, 0])).toBe("");
  });

  it("refuses commands it does not read, and numbers that do not fit a command", () => {
    expect(() => transformPath("M0 0h10", [1, 0, 0, 1, 0, 0])).toThrow("holds h");
    expect(() => transformPath("M0 0L10", [1, 0, 0, 1, 0, 0])).toThrow("gives L 1 numbers");
    expect(() => transformPath("M0 0Z 5", [1, 0, 0, 1, 0, 0])).toThrow("gives Z 1 numbers");
  });
});

describe("transformBox", () => {
  it("takes the extent of the four corners, which a slant moves apart", () => {
    expect(transformBox([0, -10, 100, 200], [1, 0, 0.5, 1, 0, 0])).toEqual([-5, -10, 200, 200]);
    expect(transformBox(null, [1, 0, 0.5, 1, 0, 0])).toBeNull();
  });
});

describe("reencode", () => {
  it("gives each code the glyph the vector names, and none where the font lacks it", () => {
    const vector = ["B", "A", "Missing", ...FONT.encoding.slice(3)];
    const moved = reencode(FONT, vector);
    expect(moved.encoding.slice(0, 3)).toEqual(["B", "A", "Missing"]);
    expect(moved.glyphs[moved.encoding[1] as string]).toBe(FONT.glyphs.A);
    expect(moved.glyphs[moved.encoding[2] as string]).toBeUndefined();
    expect(FONT.encoding[0]).toBe("A");
  });
});

describe("transform", () => {
  it("slants and stretches every glyph, scaling advances and recomputing boxes", () => {
    const oblique = transform(FONT, { slant: 0.2, extend: 0.5 });
    expect(oblique.glyphs.A).toEqual({ w: 300, d: "M0 0L250 0L265 700Z", b: [0, 0, 390, 700] });
    expect(oblique.glyphs.B).toEqual({ w: 250, d: "", b: null });
    expect(oblique.encoding).toBe(FONT.encoding);
  });

  it("leaves a font with neither as it is", () => {
    expect(transform(FONT, {})).toBe(FONT);
    expect(transform(FONT, { slant: 0, extend: 1 })).toBe(FONT);
  });
});
