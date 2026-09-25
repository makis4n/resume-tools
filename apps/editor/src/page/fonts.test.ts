import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import { cpuMsAsync } from "../test/timing";
import { parseDvi } from "../tex/dvi";
import { drawPage } from "./draw";
import { FontLibrary } from "./fonts";
import { TexLiveIndex } from "./texlive";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../tex/fixtures/${name}`, import.meta.url)));

const ONE = 2 ** 20;
const bytes = (n: number, value: number) =>
  Array.from({ length: n }, (_, i) => (value >>> (8 * (n - 1 - i))) & 0xff);

/**
 * A virtual font at 10 pt over one local font at its size: each code of a list set as that code,
 * or each code of a record set as its packet says, in a short or a long packet by its length.
 */
function virtualFont(local: string, packets: number[] | Record<number, number[]>): Uint8Array {
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
  const byCode = Array.isArray(packets)
    ? Object.fromEntries(packets.map((code) => [code, [code]]))
    : packets;
  for (const [code, dvi] of Object.entries(byCode)) {
    const head =
      dvi.length < 242
        ? [dvi.length, Number(code), ...bytes(3, ONE / 2)]
        : [242, ...bytes(4, dvi.length), ...bytes(4, Number(code)), ...bytes(4, ONE / 2)];
    out.push(...head, ...dvi);
  }
  out.push(248, 248, 248, 248);
  return new Uint8Array(out);
}

/** `n` copies of a packet's commands. */
const times = (n: number, commands: number[]) => Array.from({ length: n }, () => commands).flat();

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

  it("keeps a font's metrics when its outlines cannot be read, and reads them next time", async () => {
    for (const [font, failing] of [
      ["cmr10", "cmr10.pfb"],
      ["cmr10x", "8r.enc"],
    ] as const) {
      const { fonts, reads } = libraryOver(cmr10, failing);
      const first = await fonts.load(font);
      expect(first?.tfm.designSize, failing).toBe(10);
      expect(first?.outlines, failing).toBeUndefined();
      expect(first?.missing, failing).toBe("the network dropped it");
      expect(first?.text(65), failing).toBeUndefined();
      // Forgotten once it settled: the next load reads the file again, and draws the font.
      const second = await fonts.load(font);
      expect(second?.outlines?.glyphs.A, failing).toBeDefined();
      expect([...reads].find(([path]) => path.endsWith(failing))?.[1], failing).toBe(2);
      // Kept from then on.
      expect(await fonts.load(font), failing).toBe(second);
    }
  });

  it("leaves a virtual font undrawn this time only, when a read under it failed", async () => {
    const over = {
      ...cmr10,
      "/fonts/tfm/v/over.tfm": fixture("cmr10.tfm"),
      "/fonts/vf/v/over.vf": virtualFont("cmr10", [65]),
    };
    for (const [failing, why] of [
      ["over.vf", "the network dropped it"],
      ["cmr10.pfb", "its virtual font sets cmr10, which cannot be drawn: the network dropped it"],
      ["cmr10.tfm", "the network dropped it"],
    ]) {
      const { fonts } = libraryOver(over, failing);
      const first = await fonts.load("over");
      expect(first?.missing, failing).toBe(why);
      expect(first?.tfm.designSize, failing).toBe(10);
      expect((await fonts.load("over"))?.outlines?.encoding[65], failing).toBe("A");
    }
  });

  it("rejects when what every page needs cannot be read, and reads it again next time", async () => {
    const withList = { ...cmr10, "/fonts/map/glyphlist/glyphlist.txt": "A;0041\n" };
    for (const failing of ["cmr10.tfm", "pdftex.map", "glyphlist.txt"]) {
      const { fonts } = libraryOver(withList, failing);
      await expect(fonts.load("cmr10"), failing).rejects.toThrow("the network dropped it");
      expect((await fonts.load("cmr10"))?.outlines?.glyphs.A, failing).toBeDefined();
    }
  });

  it("refuses at once the reviewers' virtual fonts, which fan out past any real one", async () => {
    // fan1 sets cmr10's A 241 times for its code 65, and fan2 sets fan1's code 65 241 times for
    // each of 128 codes: 31 KB of files that used to compose 39 MB of path data for each code,
    // hold the thread for most of a minute and then run out of memory.
    const fan = times(241, [65]);
    const top = Object.fromEntries(Array.from({ length: 128 }, (_, code) => [code, fan]));
    const { fonts } = libraryOver({
      ...cmr10,
      "/fonts/tfm/v/fan1.tfm": fixture("cmr10.tfm"),
      "/fonts/vf/v/fan1.vf": virtualFont("cmr10", { 65: fan }),
      "/fonts/tfm/v/fan2.tfm": fixture("cmr10.tfm"),
      "/fonts/vf/v/fan2.vf": virtualFont("fan1", top),
    });
    // Refused at the first packet past the limit, however far the packets fan out, they now cost
    // 0.2 to 1.4 ms of CPU time (`cpuMsAsync`): a budget with no smaller case to compare them
    // with, so 500 ms of CPU time is their bound alone.
    const took = await cpuMsAsync(async () => {
      const [fan1, fan2] = await Promise.all([fonts.load("fan1"), fonts.load("fan2")]);
      expect(fan1?.outlines).toBeUndefined();
      expect(fan1?.missing).toBe("the packet of 65 sets more than 64 characters and rules");
      expect(fan2?.outlines).toBeUndefined();
      expect(fan2?.missing).toBe("the packet of 0 sets more than 64 characters and rules");
    });
    expect(took).toBeLessThan(500);
  });

  it("refuses a chain of virtual fonts more than four deep", async () => {
    const files: Record<string, Uint8Array | string> = { ...cmr10 };
    let below = "cmr10";
    for (let level = 1; level <= 5; level++) {
      files[`/fonts/tfm/v/deep${level}.tfm`] = fixture("cmr10.tfm");
      files[`/fonts/vf/v/deep${level}.vf`] = virtualFont(below, [65]);
      below = `deep${level}`;
    }
    const { fonts } = libraryOver(files);
    expect((await fonts.load("deep4"))?.outlines?.encoding[65]).toBe("A");
    expect((await fonts.load("deep5"))?.missing).toBe("its virtual fonts nest 5 deep, more than 4");
  });

  it("refuses a virtual font whose glyphs hold more than any real one's", async () => {
    // wide composes 40 of cmr10's As into one glyph, some 24 KB of path data. huge sets 64 of
    // those, past what one glyph may hold; many sets 2 for each of 128 codes, each glyph within
    // it and all of them past what a font may. names1 sets 64 empty rules, whose glyph has no
    // path, only a name, names2 64 of those, and names3 64 of names2's, whose names alone would
    // have grown by 64 times a level.
    const empty = [137, ...bytes(8, 0)];
    const { fonts } = libraryOver({
      ...cmr10,
      "/fonts/tfm/v/wide.tfm": fixture("cmr10.tfm"),
      "/fonts/vf/v/wide.vf": virtualFont("cmr10", { 65: times(40, [65]) }),
      "/fonts/tfm/v/huge.tfm": fixture("cmr10.tfm"),
      "/fonts/vf/v/huge.vf": virtualFont("wide", { 65: times(64, [65]) }),
      "/fonts/tfm/v/many.tfm": fixture("cmr10.tfm"),
      "/fonts/vf/v/many.vf": virtualFont(
        "wide",
        Object.fromEntries(Array.from({ length: 128 }, (_, code) => [code, times(2, [65])])),
      ),
      "/fonts/tfm/v/names1.tfm": fixture("cmr10.tfm"),
      "/fonts/vf/v/names1.vf": virtualFont("cmr10", { 65: times(64, empty) }),
      "/fonts/tfm/v/names2.tfm": fixture("cmr10.tfm"),
      "/fonts/vf/v/names2.vf": virtualFont("names1", { 65: times(64, [65]) }),
      "/fonts/tfm/v/names3.tfm": fixture("cmr10.tfm"),
      "/fonts/vf/v/names3.vf": virtualFont("names2", { 65: times(64, [65]) }),
    });
    const wide = await fonts.load("wide");
    const size = wide?.outlines?.glyphs[wide.outlines.encoding[65] ?? ""]?.d.length ?? 0;
    // Two fit in a glyph, three do not.
    expect(size).toBeGreaterThan((64 * 1024) / 3);
    expect(size).toBeLessThan((64 * 1024) / 2);
    // The limits bound the work: composed up to them, the four cost 70 to 116 ms of CPU time, and
    // 153 to 156 ms with no limits at all, which the refusals catch rather than the time. So 2,000
    // ms of CPU time is a budget alone, with no smaller case to compare them with.
    const took = await cpuMsAsync(async () => {
      expect((await fonts.load("huge"))?.missing).toBe(
        "its character 65 holds more than 65536 characters of path data and name",
      );
      expect((await fonts.load("many"))?.missing).toBe(
        "its glyphs hold more than 4194304 characters of path data and names",
      );
      expect((await fonts.load("names2"))?.missing).toBeUndefined();
      expect((await fonts.load("names3"))?.missing).toBe(
        "its character 65 holds more than 65536 characters of path data and name",
      );
    });
    expect(took).toBeLessThan(2_000);
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
    // T1's dotless i and j, which a text may hold, read as themselves.
    expect([25, 26].map((code) => t1?.text(code))).toEqual(["\u{131}", "\u{237}"]);
    expect([136, 191, 176].map((code) => ts1?.text(code))).toEqual(["•", "€", "°"]);
    // TS1's symbols the glyph list lacks, or reads as other characters than LaTeX sets them for.
    expect([152, 173, 42, 60, 62].map((code) => ts1?.text(code))).toEqual([
      "\u{2031}",
      "\u{2117}",
      "\u{204e}",
      "\u{27e8}",
      "\u{27e9}",
    ]);
    // lm-ts1.enc names the superior figures two.superior and the like, and the old-style ones
    // dollar.oldstyle and cent.oldstyle.
    const figures = [185, 178, 179, 138, 139];
    expect(figures.map((code) => ts1?.text(code))).toEqual(["¹", "²", "³", "$", "¢"]);
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
    // The visible space is three rules, which read as the character T1 has at 32.
    expect(outlines?.encoding[32]).toBe("rule+rule+rule");
    expect(times?.text(32)).toBe("\u{2423}");
    expect(times?.text(233)).toBe("é");
  });

  it("reads a virtual font's codes in T1 and TS1 by their encoding, and in OT1 by the glyphs", async () => {
    const fonts = new FontLibrary(index(), flaky("never"));
    const loaded = await Promise.all(
      ["ptmr8t", "pcrr8t", "ptmrc8t", "ptmr8c", "pcrr7t", "ptmri7t"].map((name) =>
        fonts.load(name),
      ),
    );
    for (const font of loaded) expect(font?.missing, font?.name).toBeUndefined();
    const [times, courier, caps, symbols, courierOt1, italicOt1] = loaded;
    // fontinst builds these from two glyphs, which read as d', d̄, l', t', L' and ij; the codes
    // stand for ď, đ, ľ, ť, Ľ and ĳ.
    const composites = [164, 158, 169, 180, 137, 188];
    expect(composites.map((code) => times?.text(code))).toEqual(["ď", "đ", "ľ", "ť", "Ľ", "ĳ"]);
    // The glyphs keep their parts' names, which item 9's web fonts need apart.
    expect(times?.outlines?.encoding[164]).toBe("d+quoteright");
    // A name the glyph list does not know, T1's Germandbls, reads by the glyphs: \SS is S and S.
    expect(times?.text(223)).toBe("SS");
    // Courier's en and em dashes are one and two hyphens.
    expect([21, 22].map((code) => courier?.text(code))).toEqual(["--", "---"]);
    // A small-caps font's lowercase letters are smaller capitals.
    expect([65, 97, 233, 255].map((code) => caps?.text(code))).toEqual(["A", "a", "é", "ß"]);
    // TS1: the Euro, which Times lacks and fontinst draws as a rule, the centred asterisk, which
    // LaTeX sets for ⁎, the symbols the glyph list lacks, such as ‱ and ℗, and the angle brackets,
    // and the superior figures, which lm-ts1.enc names one.superior and the like.
    expect([191, 42, 152, 173, 60, 62].map((code) => symbols?.text(code))).toEqual([
      "€",
      "\u{204e}",
      "\u{2031}",
      "\u{2117}",
      "\u{27e8}",
      "\u{27e9}",
    ]);
    expect([185, 178, 179].map((code) => symbols?.text(code))).toEqual(["¹", "²", "³"]);
    // OT1's layout depends on the shape, so it reads by the glyphs: Courier has < where a roman
    // font has ¡, and an italic font £ where an upright one has $.
    expect([60, 62, 123].map((code) => courierOt1?.text(code))).toEqual(["<", ">", "{"]);
    expect(italicOt1?.text(36)).toBe("£");
  });

  it("draws the Ubuntu tree's fonts through the merged map", async () => {
    const fonts = new FontLibrary(index(), flaky("never"));
    for (const name of ["umvs", "feymr10"]) {
      const font = await fonts.load(name);
      expect(font?.missing, name).toBeUndefined();
      expect(Object.keys(font?.outlines?.glyphs ?? {}).length, name).toBeGreaterThan(0);
    }
  });

  it("draws the archive packages' fonts, set as a pdfTeX port sets them", async () => {
    // Written as a pdfTeX port is (decisions 0008 and 0009): the dvipdfmx driver, T1 and Latin
    // Modern. A TikZ line, a word in each family's pdfTeX face, and an icon.
    const body = [
      "\\documentclass[dvipdfmx]{article}",
      "\\usepackage[T1]{fontenc}",
      "\\usepackage{lmodern}",
      "\\usepackage{tikz}",
      "\\usepackage{fontawesome5}",
      "\\usepackage{lato}",
      "\\usepackage{roboto}",
      "\\usepackage{sourcesanspro}",
      "\\begin{document}",
      "\\tikz\\draw (0,0) -- (2,0);",
      "{\\lato Lato} {\\roboto Roboto} {\\sffamily Source} \\faGithub",
      "\\end{document}",
    ].join("\n");
    const session = await startNodeSession();
    const compiled = session.compile("pdftex", "stock", body, { job: "archive", maxPasses: 1 });
    if (!compiled.output) throw new Error(compiled.error);
    const doc = parseDvi(compiled.output, () => undefined);
    // Each family's own Type 1 face, and Font Awesome's brands, which the merged map draws.
    expect([...doc.fonts.values()].map((font) => font.name)).toEqual(
      expect.arrayContaining([
        "Lato-Regular-T1-TLF",
        "Roboto-Regular-lf-t1",
        "SourceSansPro-Regular-tlf-t1",
        "fa5brands0",
      ]),
    );
    // TikZ draws its line with dvipdfmx's specials, which the page leaves to the PDF.
    const specials = doc.pages[0]?.items.flatMap((item) =>
      item.kind === "special" ? [item.text] : [],
    );
    expect(specials?.some((text) => text.startsWith("pdf:code"))).toBe(true);
    const drawn = await drawPage(
      compiled.output,
      new FontLibrary(index(), flaky("never")),
      new Map(),
    );
    expect(drawn.missingFonts).toEqual(new Map());
    expect(drawn.glyphs.length).toBeGreaterThan("LatoRobotoSource".length);
  }, 60_000);

  it("reads the EC fonts' padded TS1 metrics, and reports that they have no outlines", async () => {
    const font = await new FontLibrary(index(), flaky("never")).load("tcrm1000");
    expect(font?.tfm.designSize).toBe(10);
    expect(font?.outlines).toBeUndefined();
    expect(font?.missing).toBe("no font map entry names an outline file");
    expect(font?.text(136)).toBeUndefined();
  });
});
