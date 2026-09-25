import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable } from "../engine/node";
import { FontLibrary } from "./fonts";
import { TexLiveIndex } from "./texlive";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../tex/fixtures/${name}`, import.meta.url)));

const ONE = 2 ** 20;
const bytes = (n: number, value: number) =>
  Array.from({ length: n }, (_, i) => (value >>> (8 * (n - 1 - i))) & 0xff);

/** A virtual font at 10 pt over one local font at its size, each code set as that code. */
function virtualFont(local: string, codes: number[]): Uint8Array {
  const name = [...local].map((c) => c.charCodeAt(0));
  const out = [247, 202, 0, ...bytes(4, 0), ...bytes(4, 10 * ONE)];
  out.push(
    243,
    0,
    ...bytes(4, 0),
    ...bytes(4, ONE),
    ...bytes(4, 10 * ONE),
    0,
    name.length,
    ...name,
  );
  for (const code of codes) out.push(1, code, ...bytes(3, ONE / 2), code);
  out.push(248, 248, 248, 248);
  return new Uint8Array(out);
}

/**
 * A library over a tree of the given files, by path under the first TeX Live tree, which reads
 * each through `files` and counts the reads, except that the first read of a path ending in
 * `failing` throws.
 */
function libraryOver(files: Record<string, Uint8Array | string>, failing?: string) {
  const root = "/texlive/texmf-dist";
  const manifest: EngineManifest = {
    release: "test",
    layout: 2,
    bundles: [],
    files: Object.fromEntries(Object.keys(files).map((path) => [`${root}${path}`, 1])),
  };
  const reads = new Map<string, number>();
  const read = async (path: string) => {
    const relative = path.slice(root.length);
    reads.set(relative, (reads.get(relative) ?? 0) + 1);
    // Not an Error: a reader may throw anything, and the library passes it on as one.
    if (failing && path.endsWith(failing) && reads.get(relative) === 1)
      throw "the network dropped it";
    const file = files[relative];
    if (file === undefined) throw new Error(`no ${path}`);
    return typeof file === "string" ? new TextEncoder().encode(file) : file;
  };
  return { fonts: new FontLibrary(new TexLiveIndex(manifest), read), reads };
}

describe("FontLibrary over an invented tree", () => {
  const cmr10 = {
    "/fonts/map/pdftex/pdftex.map": "cmr10 CMR10 <cmr10.pfb\ncmr10x CMR10 <8r.enc <cmr10.pfb\n",
    "/fonts/tfm/cm/cmr10.tfm": fixture("cmr10.tfm"),
    "/fonts/tfm/cm/cmr10x.tfm": fixture("cmr10.tfm"),
    "/fonts/type1/cm/cmr10.pfb": fixture("cmr10.pfb"),
    "/fonts/enc/base/8r.enc": fixture("8r.enc"),
  };

  it("reads a Type 1 file once for two fonts that share it", async () => {
    const { fonts, reads } = libraryOver(cmr10);
    const [plain, recoded] = await Promise.all([fonts.load("cmr10"), fonts.load("cmr10x")]);
    expect(reads.get("/fonts/type1/cm/cmr10.pfb")).toBe(1);
    // OT1 has fi at 12; TeX Base 1 has fi at 2 and the Euro, which cmr10 lacks, at 128.
    expect(plain?.outlines?.encoding[12]).toBe("fi");
    expect(recoded?.outlines?.encoding[2]).toBe("fi");
    expect(recoded?.outlines?.glyphs.fi).toBe(plain?.outlines?.glyphs.fi);
    expect(recoded?.outlines?.encoding[128]).toBe("Euro");
    expect(recoded?.text(128)).toBeUndefined();
    expect(recoded?.text(2)).toBe("fi");
  });

  it("draws a virtual font over a virtual font", async () => {
    const { fonts } = libraryOver({
      ...cmr10,
      "/fonts/tfm/v/inner.tfm": fixture("cmr10.tfm"),
      "/fonts/vf/v/inner.vf": virtualFont("cmr10", [65, 66]),
      "/fonts/tfm/v/outer.tfm": fixture("cmr10.tfm"),
      "/fonts/vf/v/outer.vf": virtualFont("inner", [65]),
    });
    const outer = await fonts.load("outer");
    expect(outer?.missing).toBeUndefined();
    expect(outer?.outlines?.encoding[65]).toBe("A");
    expect(outer?.outlines?.glyphs.A?.d).toBe((await fonts.load("cmr10"))?.outlines?.glyphs.A?.d);
    expect(outer?.text(65)).toBe("A");
    // A code whose packet is missing, and one the TFM lacks, have no outline.
    expect(outer?.outlines?.encoding[66]).toBe(".notdef");
    expect(outer?.text(66)).toBeUndefined();
  });

  it("refuses virtual fonts that lead back to each other, rather than wait for ever", async () => {
    const { fonts } = libraryOver({
      ...cmr10,
      "/fonts/tfm/v/left.tfm": fixture("cmr10.tfm"),
      "/fonts/vf/v/left.vf": virtualFont("right", [65]),
      "/fonts/tfm/v/right.tfm": fixture("cmr10.tfm"),
      "/fonts/vf/v/right.vf": virtualFont("left", [65]),
      "/fonts/tfm/v/self.tfm": fixture("cmr10.tfm"),
      "/fonts/vf/v/self.vf": virtualFont("self", [65]),
    });
    const [left, right, self] = await Promise.all(
      ["left", "right", "self"].map((n) => fonts.load(n)),
    );
    expect(self?.missing).toBe("its virtual font sets self, which leads back to self");
    for (const font of [left, right]) {
      expect(font?.outlines).toBeUndefined();
      expect(font?.missing).toMatch(/leads back to/);
    }
  });

  it("leaves a font it cannot read the outlines of undrawn, and says why", async () => {
    const { fonts } = libraryOver({
      ...cmr10,
      "/fonts/type1/cm/cmr10.pfb": new Uint8Array([1, 2, 3]),
      "/fonts/tfm/v/over.tfm": fixture("cmr10.tfm"),
      "/fonts/vf/v/over.vf": virtualFont("cmr10", [65]),
      "/fonts/tfm/v/bad.tfm": fixture("cmr10.tfm"),
      "/fonts/vf/v/bad.vf": new Uint8Array([247, 202, 0, 0]),
    });
    const broken = await fonts.load("cmr10");
    expect(broken?.tfm.designSize).toBe(10);
    expect(broken?.outlines).toBeUndefined();
    expect(broken?.missing).toBe("not a Type 1 font: no eexec section");
    expect(broken?.text(65)).toBeUndefined();
    expect((await fonts.load("over"))?.missing).toBe(
      "its virtual font sets cmr10, which cannot be drawn: not a Type 1 font: no eexec section",
    );
    expect((await fonts.load("bad"))?.missing).toMatch(/^virtual font ends early/);
    expect(await fonts.load("nosuch")).toBeUndefined();
  });

  it("passes on a read that fails, and reads again next time", async () => {
    const { fonts, reads } = libraryOver(cmr10, ".pfb");
    await expect(fonts.load("cmr10")).rejects.toThrow("the network dropped it");
    expect((await fonts.load("cmr10"))?.outlines?.glyphs.A).toBeDefined();
    expect(reads.get("/fonts/type1/cm/cmr10.pfb")).toBe(2);
  });
});

// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("FontLibrary", () => {
  const index = () =>
    new TexLiveIndex(
      JSON.parse(readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8")) as EngineManifest,
    );
  /** Reads from the engine tree, except that it fails once for a path ending in `failing`. */
  const flaky = (failing: string) => {
    let failed = false;
    return async (path: string) => {
      if (path.endsWith(failing) && !failed) {
        failed = true;
        throw new Error(`dropped ${failing}`);
      }
      return readFileSync(join(ENGINE_DIR, "files", path));
    };
  };

  it("loads Computer Modern with its metrics and outlines", async () => {
    const font = await new FontLibrary(index(), flaky("never")).load("cmr10");
    expect(font?.tfm.designSize).toBe(10);
    expect(font?.outlines?.glyphs.A).toBeDefined();
    expect(font?.text(123)).toBe("--");
  });

  it("reads the font map again after a failed read", async () => {
    const fonts = new FontLibrary(index(), flaky("pdftex.map"));
    await expect(fonts.load("cmr10")).rejects.toThrow("dropped pdftex.map");
    expect((await fonts.load("cmr10"))?.outlines).toBeDefined();
  });

  it("reads a font again after a failed read", async () => {
    const fonts = new FontLibrary(index(), flaky("cmbx12.tfm"));
    await expect(fonts.load("cmbx12")).rejects.toThrow("dropped cmbx12.tfm");
    expect((await fonts.load("cmbx12"))?.outlines).toBeDefined();
  });

  it("draws Latin Modern in T1 and TS1, re-encoded from one Type 1 file", async () => {
    const fonts = new FontLibrary(index(), flaky("never"));
    const [t1, ts1] = await Promise.all([fonts.load("ec-lmr10"), fonts.load("ts1-lmr10")]);
    expect(t1?.missing).toBeUndefined();
    expect(ts1?.missing).toBeUndefined();
    expect(t1?.outlines?.encoding[233]).toBe("eacute");
    expect(t1?.outlines?.glyphs.eacute).toBeDefined();
    // T1's glyphs by the AGL, and Computer Modern's spellings where the aligner expects them.
    expect([233, 208, 36, 21, 16, 19].map((code) => t1?.text(code))).toEqual([
      "é",
      "\u{d0}",
      "$",
      "--",
      "``",
      "«",
    ]);
    expect([136, 191, 176].map((code) => ts1?.text(code))).toEqual(["•", "€", "°"]);
    // The same outline under both encodings.
    expect(ts1?.outlines?.glyphs.A).toBe(t1?.outlines?.glyphs.A);
  });

  it("slants and stretches the URW fonts as the map says", async () => {
    const fonts = new FontLibrary(index(), flaky("never"));
    const [upright, oblique, courier, narrow] = await Promise.all(
      ["ptmr8r", "ptmro8r", "pcrr8r", "pcrr8rn"].map((name) => fonts.load(name)),
    );
    const a = upright?.outlines?.glyphs.A;
    const slanted = oblique?.outlines?.glyphs.A;
    expect(slanted?.w).toBe(a?.w);
    expect(slanted?.d).not.toBe(a?.d);
    expect(slanted?.b?.[2]).toBeGreaterThan(a?.b?.[2] ?? Infinity);
    expect(narrow?.outlines?.glyphs.A?.w).toBeCloseTo(
      (courier?.outlines?.glyphs.A?.w ?? 0) * 0.85,
      6,
    );
  });

  it("composes Times in T1 from its raw font, accented letters from two glyphs", async () => {
    const fonts = new FontLibrary(index(), flaky("never"));
    const [times, raw] = await Promise.all([fonts.load("ptmr8t"), fonts.load("ptmr8r")]);
    expect(times?.missing).toBeUndefined();
    const outlines = times?.outlines;
    expect(outlines?.encoding[65]).toBe("A");
    expect(outlines?.glyphs.A?.d).toBe(raw?.outlines?.glyphs.A?.d);
    // Abreve: 8r's breve, raised, over the A, and the advance from ptmr8t's TFM.
    expect(outlines?.encoding[128]).toBe("A+breve");
    expect(times?.text(128)).toBe("Ă");
    const abreve = outlines?.glyphs["A+breve"];
    const breve = raw?.outlines?.glyphs.breve;
    const contours = (d = "") => d.split("M").length - 1;
    expect(contours(abreve?.d)).toBe(contours(breve?.d) + contours(raw?.outlines?.glyphs.A?.d));
    expect(abreve?.b?.[3]).toBeGreaterThan(raw?.outlines?.glyphs.A?.b?.[3] ?? Infinity);
    expect(abreve?.b?.[3]).toBeGreaterThan(breve?.b?.[3] ?? Infinity);
    expect(abreve?.w).toBeCloseTo(raw?.outlines?.glyphs.A?.w ?? 0, 0);
    // The visible space is three rules, which have no text.
    expect(outlines?.encoding[32]).toBe("rule+rule+rule");
    expect(times?.text(32)).toBeUndefined();
    expect(times?.text(233)).toBe("é");
  });

  it("draws the Ubuntu tree's fonts through the merged map", async () => {
    const fonts = new FontLibrary(index(), flaky("never"));
    for (const name of ["umvs", "feymr10"]) {
      const font = await fonts.load(name);
      expect(font?.missing, name).toBeUndefined();
      expect(Object.keys(font?.outlines?.glyphs ?? {}).length, name).toBeGreaterThan(0);
    }
  });

  it("reads the EC fonts' padded TS1 metrics, and reports that they have no outlines", async () => {
    const font = await new FontLibrary(index(), flaky("never")).load("tcrm1000");
    expect(font?.tfm.designSize).toBe(10);
    expect(font?.outlines).toBeUndefined();
    expect(font?.missing).toBe("no font map entry names an outline file");
    expect(font?.text(136)).toBeUndefined();
  });
});
