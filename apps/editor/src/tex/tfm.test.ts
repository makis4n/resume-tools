import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTfm, scaleFixWord, scaleTfm } from "./tfm";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe("parseTfm", () => {
  it("reads the header and character range of cmr10", () => {
    const tfm = parseTfm(fixture("cmr10.tfm"));
    expect(tfm.designSize).toBe(10);
    expect(tfm.bc).toBe(0);
    expect(tfm.ec).toBe(127);
    expect(tfm.chars).toHaveLength(128);
    expect(tfm.chars[97]).toBeDefined();
  });

  it("rejects a truncated file", () => {
    expect(() => parseTfm(fixture("cmr10.tfm").subarray(0, 100))).toThrow(/length mismatch/);
  });
});

describe("scaleFixWord", () => {
  it("scales an exact half em without rounding", () => {
    // 0.5 as a fix_word is 2^19; at 12pt (786432sp) that is 6pt.
    expect(scaleFixWord(2 ** 19, 786432)).toBe(393216);
  });

  it("handles negative fix_words the way TeX does", () => {
    expect(scaleFixWord(-(2 ** 19), 655360)).toBe(-327680);
  });
});

describe("scaleTfm", () => {
  it("scales the letter a in cmr10 the way TeX does at 10pt", () => {
    const m = scaleTfm(parseTfm(fixture("cmr10.tfm")), 655360);
    expect(m.widths[97]).toBe(327681); // 5.00002pt: cmr10 stores the width as 0.500002em
    expect(m.heights[97]).toBeGreaterThan(0);
    expect(m.depths[97]).toBe(0);
  });

  it("leaves missing characters at zero", () => {
    const m = scaleTfm(parseTfm(fixture("cmr10.tfm")), 655360);
    expect(m.widths[200]).toBe(0);
  });
});
