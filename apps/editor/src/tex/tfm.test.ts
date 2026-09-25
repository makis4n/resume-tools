import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENGINE_DIR, engineAvailable } from "../engine/node";
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

  it("reads a file padded past the length its header gives, as TeX does", () => {
    const plain = fixture("cmr10.tfm");
    const padded = new Uint8Array(plain.length + 100);
    padded.set(plain);
    expect(parseTfm(padded)).toEqual(parseTfm(plain));
    // The tables must still add up to the header's length, whatever follows them.
    const inflated = padded.slice();
    new DataView(inflated.buffer).setUint16(0, plain.length / 4 + 1);
    expect(() => parseTfm(inflated)).toThrow(/do not add up/);
  });
});

// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("parseTfm over the tree's TS1 fonts", () => {
  const tree = (path: string) => new Uint8Array(readFileSync(join(ENGINE_DIR, "files", path)));

  it("reads Latin Modern's and the EC fonts' TS1 metrics, the latter padded", () => {
    const lm = parseTfm(tree("/texlive/texmf-dist/fonts/tfm/public/lm/ts1-lmr10.tfm"));
    const tc = tree("/texlive/texmf-dist/fonts/tfm/jknappen/ec/tcrm1000.tfm");
    expect(tc.length).toBeGreaterThan(new DataView(tc.buffer, tc.byteOffset).getUint16(0) * 4);
    // Code 136 is TS1's bullet, which LaTeX's itemize sets.
    for (const tfm of [lm, parseTfm(tc)]) {
      expect(tfm.designSize).toBe(10);
      expect(tfm.chars[136 - tfm.bc]).toBeDefined();
    }
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
