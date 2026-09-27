import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Resume } from "@resume-tools/resume-model";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { generateBody, generateFormat } from "../templates/generate";
import { INVENTED_XETEX } from "../templates/invented";
import { defaultControls, fontFiles, parsePackage } from "../templates/package";
import { PRELUDE } from "../templates/prelude";
import { bound, fastestAsync } from "../test/timing";
import { type DviDocument, type PageItem, parseDvi } from "../tex/dvi";
import { collectFields } from "../tex/fields";
import { INCH } from "../tex/svg";
import { parseType1 } from "../tex/type1";
import {
  type DrawnPage,
  drawPage,
  fieldsShown,
  type GlyphBox,
  glyphAt,
  letterSpaceOf,
  paperSize,
  ruleCrossings,
} from "./draw";

import { FontLibrary } from "./fonts";
import { TexLiveIndex } from "./texlive";

/** The spike's Jake's Resume, its preamble and its marked-up body, kept as fixtures. */
const spike = (name: string) =>
  readFileSync(new URL(`../tex/fixtures/${name}`, import.meta.url), "utf8");

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../tex/fixtures/${name}`, import.meta.url)));

const ONE = 2 ** 20;
const bytes = (n: number, value: number) =>
  Array.from({ length: n }, (_, i) => (value >>> (8 * (n - 1 - i))) & 0xff);

/** cmr10 and its map entry, by path under the first TeX Live tree. */
const CMR10: Record<string, Uint8Array | string> = {
  "/fonts/map/pdftex/pdftex.map": "cmr10 CMR10 <cmr10.pfb\n",
  "/fonts/tfm/cm/cmr10.tfm": fixture("cmr10.tfm"),
  "/fonts/type1/cm/cmr10.pfb": fixture("cmr10.pfb"),
};

/**
 * A library over a tree of the given files, by path under the first TeX Live tree, whose reads of
 * a path ending in `failing` fail, the first `times` of them.
 */
function libraryOf(
  files: Record<string, Uint8Array | string>,
  failing = "never",
  times = Number.POSITIVE_INFINITY,
) {
  const root = "/texlive/texmf-dist";
  const manifest = { release: "test", layout: 2, bundles: [], files: {} } as EngineManifest;
  for (const path of Object.keys(files)) manifest.files[`${root}${path}`] = 1;
  let failed = 0;
  return new FontLibrary(new TexLiveIndex(manifest), async (path) => {
    if (path.endsWith(failing) && failed++ < times) throw new Error(`could not read ${path}`);
    const file = files[path.slice(root.length)];
    if (file === undefined) throw new Error(`no ${path}`);
    return typeof file === "string" ? new TextEncoder().encode(file) : file;
  });
}

/** A library over a tree holding only cmr10, whose reads of a path ending in `failing` fail. */
const cmr10Library = (failing = "never") => libraryOf(CMR10, failing);

describe("drawPage over an invented tree", () => {
  // accents.dvi sets `caf\'e \'Etude na\"\i ve` and `\textasciitilde mara\^{}x` in OT1's cmr10.
  const texts = new Map([
    ["word", "café Étude naïve"],
    ["lone", "~mara^x"],
  ]);

  it("gives an accent the field and offset of its letter, in the SVG and the hit boxes", async () => {
    const drawn = await drawPage(fixture("accents.dvi"), cmr10Library(), texts);
    expect(drawn.missingFonts).toEqual(new Map());
    expect(drawn.unmatched).toBe(0);
    // Three accented letters of two glyphs each, and the lone tilde and circumflex on their own.
    const word = drawn.glyphs.filter((glyph) => glyph.field === "word");
    expect(word).toHaveLength("caféÉtudenaïve".length + 3);
    const at = (offset: number) => word.filter((glyph) => glyph.offset === offset);
    for (const offset of [3, 5, 13]) expect(at(offset), `offset ${offset}`).toHaveLength(2);
    const marked = drawn.svg.match(/data-field="word" data-offset="3"/g) ?? [];
    expect(marked).toHaveLength(2);
    expect(drawn.fields.get("lone")?.glyphs.map((glyph) => glyph.offset)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });

  it("gives each field its fonts, its first glyph's place, and its baseline", async () => {
    const drawn = await drawPage(fixture("accents.dvi"), cmr10Library(), texts);
    for (const id of ["word", "lone"]) {
      const layout = drawn.fields.get(id)?.layout;
      const glyphs = drawn.fields.get(id)?.glyphs ?? [];
      const first = drawn.glyphs.find((glyph) => glyph.field === id);
      expect(layout?.font.name, id).toBe("cmr10");
      expect(layout?.size, id).toBeCloseTo(10, 5);
      expect(
        layout?.fonts.map((each) => [each.font, each.glyphs]),
        id,
      ).toEqual([[layout?.font, glyphs.length]]);
      expect([layout?.x, layout?.y], id).toEqual([first?.x, first?.y]);
      // Each field is one line, and the only one on its baseline.
      expect(layout?.secondLine, id).toBeUndefined();
      const line = drawn.glyphs.filter((glyph) => glyph.y === first?.y).map((glyph) => glyph.x);
      expect(layout?.baseline, id).toEqual(line.sort((a, b) => a - b));
      // The fixture was compiled without the prelude, so it has no paragraph specials.
      expect(layout?.paragraph, id).toBeUndefined();
    }
  });

  it("names a font whose outlines cannot be read, and draws the page without it", async () => {
    const drawn = await drawPage(fixture("accents.dvi"), cmr10Library("cmr10.pfb"), texts);
    expect(drawn.missingFonts).toEqual(
      new Map([["cmr10", "could not read /texlive/texmf-dist/fonts/type1/cm/cmr10.pfb"]]),
    );
    expect(drawn.glyphs).toEqual([]);
    expect(drawn.fields.get("word")?.glyphs.length).toBeGreaterThan(0);
  });

  it("draws a font whose outlines could not be read the time before", async () => {
    const fonts = libraryOf(CMR10, "cmr10.pfb", 1);
    expect((await drawPage(fixture("accents.dvi"), fonts, texts)).missingFonts.size).toBe(1);
    const again = await drawPage(fixture("accents.dvi"), fonts, texts);
    expect(again.missingFonts).toEqual(new Map());
    const good = await drawPage(fixture("accents.dvi"), cmr10Library(), texts);
    expect(again.glyphs).toEqual(good.glyphs);
    expect(again.unmatched).toBe(0);
  });

  it("rejects when a font's metrics, the font map or the glyph list cannot be read", async () => {
    // Without them every glyph after the font's would be drawn in the wrong place, or named
    // wrongly, with no error; the caller keeps the page it had.
    const withList = { ...CMR10, "/fonts/map/glyphlist/glyphlist.txt": "A;0041\n" };
    for (const failing of ["cmr10.tfm", "pdftex.map", "glyphlist.txt"]) {
      const fonts = libraryOf(withList, failing, 1);
      await expect(drawPage(fixture("accents.dvi"), fonts, texts), failing).rejects.toThrow(
        `could not read /texlive/texmf-dist/fonts/`,
      );
      expect((await drawPage(fixture("accents.dvi"), fonts, texts)).unmatched, failing).toBe(0);
    }
  });

  it("leaves out the codes an encoding names after an object's members, rather than throw", async () => {
    // An encoding vector may give a glyph any name: here cmr10's a, c, e and f are named
    // constructor, toString, __proto__ and valueOf, as they are and slanted, whose glyphs
    // `transform` makes anew.
    const names = parseType1(fixture("cmr10.pfb")).encoding;
    const renamed = new Map([
      [97, "constructor"],
      [99, "toString"],
      [101, "__proto__"],
      [102, "valueOf"],
    ]);
    const vector = names.map((name, code) => `/${renamed.get(code) ?? name}`).join("\n");
    for (const entry of ["<proto.enc <cmr10.pfb", '" .167 SlantFont " <proto.enc <cmr10.pfb']) {
      const fonts = libraryOf({
        ...CMR10,
        "/fonts/map/pdftex/pdftex.map": `cmr10 CMR10 ${entry}\n`,
        "/fonts/enc/test/proto.enc": `/Proto [\n${vector}\n] def\n`,
      });
      const drawn = await drawPage(fixture("accents.dvi"), fonts, texts);
      expect(drawn.missingFonts, entry).toEqual(new Map());
      expect(drawn.svg, entry).not.toMatch(/data-code="(97|99|101|102)"/);
      expect(drawn.svg, entry).toMatch(/data-code="100"/);
      // Their glyphs have no text, which the fields count.
      const lone = drawn.fields.get("lone")?.glyphs.map((glyph) => glyph.text);
      expect(lone, entry).toEqual(["~", "m", undefined, "r", undefined, "^", "x"]);
      expect(drawn.unmatched, entry).toBeGreaterThan(0);
    }
  });

  it("aligns a virtual font's glyph whose text is a word an object has, rather than throw", async () => {
    // The reviewers' virtual font: cmr10 drawn over base10, the same font under another name,
    // with its a composed of c, o, n and the rest, which reads as "constructor".
    const packets: Record<number, number[]> = {};
    for (let code = 0; code < 128; code++) packets[code] = [code];
    packets[97] = [..."constructor"].map((c) => c.charCodeAt(0));
    const out = [247, 202, 0, ...bytes(4, 0), ...bytes(4, 10 * ONE)];
    out.push(243, 0, ...bytes(4, 0), ...bytes(4, ONE), ...bytes(4, 10 * ONE), 0, 6);
    out.push(...[..."base10"].map((c) => c.charCodeAt(0)));
    for (const [code, dvi] of Object.entries(packets))
      out.push(dvi.length, Number(code), ...bytes(3, ONE / 2), ...dvi);
    out.push(248, 248, 248, 248);
    const fonts = libraryOf({
      "/fonts/map/pdftex/pdftex.map": "base10 CMR10 <cmr10.pfb\n",
      "/fonts/tfm/cm/cmr10.tfm": fixture("cmr10.tfm"),
      "/fonts/tfm/cm/base10.tfm": fixture("cmr10.tfm"),
      "/fonts/type1/cm/cmr10.pfb": fixture("cmr10.pfb"),
      "/fonts/vf/test/cmr10.vf": new Uint8Array(out),
    });
    const drawn = await drawPage(fixture("accents.dvi"), fonts, texts);
    expect(drawn.missingFonts).toEqual(new Map());
    const word = drawn.fields.get("word")?.glyphs.map((glyph) => glyph.text);
    expect(word?.slice(0, 4)).toEqual(["c", "constructor", "f", "é"]);
    // The four a's, in café, naïve and mara, match nothing in their fields' texts.
    expect(drawn.unmatched).toBe(4);
  });
});

describe("drawPage on XeTeX's XDV over an invented tree", () => {
  it("names a native font the tree lacks by its file, and draws its runs as boxes", async () => {
    // hello.xdv sets a line in Source Sans 3, from a file of the spike's own the tree lacks.
    const drawn = await drawPage(fixture("hello.xdv"), libraryOf({}), new Map());
    expect(drawn.missingFonts).toEqual(
      new Map([["SourceSans3-Regular.otf", "TeX Live has no SourceSans3-Regular.otf"]]),
    );
    const runs = parseDvi(fixture("hello.xdv"), () => undefined).pages[0]?.items.filter(
      (item) => item.kind === "native",
    );
    expect(drawn.svg.match(/<rect [^>]*stroke="rgb\(200,60,60\)"/g)).toHaveLength(
      runs?.length ?? -1,
    );
    expect(drawn.glyphs).toEqual([]);
  });
});

/** Field texts straight from the spike's marked-up body, as the spike page read them. */
function fieldTexts(body: string): Map<string, string> {
  const texts = new Map<string, string>();
  for (const m of body.matchAll(/\\rtfield\{([^}]*)\}\{([^{}]*)\}/g))
    texts.set(m[1] ?? "", m[2] ?? "");
  return texts;
}

describe("letterSpaceOf", () => {
  it("reads XeTeX's letterspace from a font's features, in hundredths of the size", () => {
    expect(letterSpaceOf("mapping=tex-text;letterspace=6.0", 10.95)).toBeCloseTo(0.657, 6);
    expect(letterSpaceOf("letterspace=-2;mapping=tex-text", 10)).toBeCloseTo(-0.2, 6);
    for (const features of [
      undefined,
      "",
      "mapping=tex-text",
      "letterspace=x",
      "wordletterspace=5",
    ])
      expect(letterSpaceOf(features, 10), String(features)).toBe(0);
  });
});

describe("paperSize", () => {
  const special = (text: string) => ({ items: [{ kind: "special" as const, h: 0, v: 0, text }] });
  it("reads the size geometry and hyperref write", () => {
    expect(paperSize(special("papersize=614.295pt,794.96999pt"))).toEqual({
      width: 614.295,
      height: 794.96999,
    });
    expect(paperSize(special("papersize=210mm,297mm"))?.width).toBeCloseTo(597.508, 2);
  });
  it("reads the pdf:pagesize XeTeX and geometry's xetex driver write, keys in either order", () => {
    expect(paperSize(special("pdf:pagesize width 597.50787pt height 845.04684pt"))).toEqual({
      width: 597.50787,
      height: 845.04684,
    });
    // geometry may write the keys the other way round, and in other units.
    const swapped = paperSize(special("pdf:pagesize height 297mm width 210mm"));
    expect(swapped?.width).toBeCloseTo(597.508, 2);
    expect(swapped?.height).toBeCloseTo(845.047, 2);
  });
  it("gives up on anything else", () => {
    expect(paperSize(special("papersize=a4"))).toBeUndefined();
    // XeTeX writes this when the size is the default; it names no dimensions.
    expect(paperSize(special("pdf:pagesize default"))).toBeUndefined();
    expect(paperSize(special("pdf:pagesize width 210mm"))).toBeUndefined();
    expect(paperSize({ items: [] })).toBeUndefined();
  });
});

describe("fieldsShown", () => {
  it("is the fields with a glyph on the page, not one whose markers hold nothing", () => {
    const special = (text: string): PageItem => ({ kind: "special", h: 0, v: 0, text });
    const glyph: PageItem = { kind: "glyph", font: 0, code: 81, h: 0, v: 0, width: 1 };
    // A first name in a script the fonts lack sets no glyph, but its markers are on the page.
    const items = [
      special("rt:b:header.first"),
      special("rt:e:header.first"),
      special("rt:b:header.last"),
      glyph,
      special("rt:e:header.last"),
    ];
    const fields = collectFields({ counters: [], items }, () => "Q");
    expect([...fields.keys()]).toEqual(["header.first", "header.last"]);
    expect(fieldsShown({ fields })).toEqual(new Set(["header.last"]));
  });
});

describe("ruleCrossings", () => {
  // A page in TeX's units, the scaled point, with two rules 100pt long from the origin, an inch
  // in from the page's corner: one a point thick whose bottom edge is 20pt down, and one 40pt
  // down with no height, which the SVG does not draw.
  const SP = 2 ** 16;
  const doc: DviDocument = {
    id: 2,
    numerator: 25_400_000,
    denominator: 473_628_672,
    magnification: 1000,
    comment: "",
    fonts: new Map(),
    nativeFonts: new Map(),
    pages: [
      {
        counters: [],
        items: [
          { kind: "rule", h: 0, v: 20 * SP, width: 100 * SP, height: SP },
          { kind: "rule", h: 0, v: 40 * SP, width: 100 * SP, height: 0 },
        ],
      },
    ],
  };
  /** A glyph's box from `top` to `bottom` points down from the origin, and 10 to 16 across. */
  const glyph = (top: number, bottom: number, left = 10, right = 16): GlyphBox => ({
    x: INCH + left,
    y: INCH + bottom,
    left: INCH + left,
    top: INCH + top,
    right: INCH + right,
    bottom: INCH + bottom,
    font: "cmr10",
    size: 10,
  });

  it("finds each glyph a rule is drawn across, with the rule", () => {
    const struck = glyph(12, 21);
    const crossings = ruleCrossings(doc, [glyph(10, 18), struck, glyph(21, 30)]);
    expect(crossings.map((crossing) => crossing.glyph)).toEqual([struck]);
    const rule = crossings[0]?.rule;
    expect(rule?.left).toBeCloseTo(INCH, 6);
    expect(rule?.top).toBeCloseTo(INCH + 19, 6);
    expect(rule?.right).toBeCloseTo(INCH + 100, 6);
    expect(rule?.bottom).toBeCloseTo(INCH + 20, 6);
  });

  it("passes a glyph that only touches a rule, one past its end, an empty box, an undrawn rule", () => {
    const rule = ruleCrossings(doc, [glyph(12, 21)])[0]?.rule;
    if (!rule) throw new Error("the rule crossed nothing");
    const touching = { ...glyph(12, 21), bottom: rule.top };
    const past = glyph(12, 21, 101, 107);
    // A glyph with no outline has an empty box at its origin, here on the rule.
    const empty = glyph(19.5, 19.5, 50, 50);
    // And one across the rule with no height, which is not drawn.
    const undrawn = glyph(35, 45);
    expect(ruleCrossings(doc, [touching, past, empty, undrawn])).toEqual([]);
  });

  it("refuses a page the document does not have", () => {
    expect(() => ruleCrossings(doc, [], 1)).toThrow("the document has 1 pages, not 2");
  });
});

// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("drawPage", () => {
  let drawn: DrawnPage;
  let texts: Map<string, string>;
  let session: EngineSession;
  let fonts: FontLibrary;
  beforeAll(async () => {
    session = await startNodeSession();
    const dumped = session.dump("pdftex", "jake", spike("jake-preamble.tex"));
    if (!dumped.ok) throw new Error(dumped.error);
    const body = spike("body.tex");
    const compiled = session.compile("pdftex", "jake", body, { job: "jake" });
    if (!compiled.output) throw new Error(compiled.error);
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    texts = fieldTexts(body);
    drawn = await drawPage(compiled.output, fonts, texts);
  }, 60_000);

  it("draws every font the page uses", () => {
    expect(drawn.missingFonts).toEqual(new Map());
    expect(drawn.pageCount).toBe(1);
    expect(drawn.size).toEqual({ width: 614.295, height: 794.96999 });
  });

  it("finds all 30 fields, each with glyphs", () => {
    expect(drawn.fields.size).toBe(30);
    expect(texts.size).toBe(30);
    for (const field of drawn.fields.values()) expect(field.glyphs.length).toBeGreaterThan(0);
  });

  it("resolves every glyph to its own character", () => {
    expect(drawn.unmatched).toBe(0);
    for (const field of drawn.fields.values()) {
      const text = texts.get(field.id) ?? "";
      for (const glyph of field.glyphs) {
        if (glyph.inserted) {
          expect(glyph.text).toBe("-");
          continue;
        }
        const spellings = glyph.text === "--" ? ["--", "–"] : [glyph.text ?? "?"];
        expect(
          spellings.some((s) => text.startsWith(s, glyph.offset)),
          `${field.id} at ${glyph.offset}: glyph "${glyph.text}"`,
        ).toBe(true);
      }
    }
  });

  it("marks every field glyph in the SVG with its field and offset", () => {
    const marked = drawn.svg.match(/data-field="[^"]+" data-offset="\d+"/g) ?? [];
    const glyphs = [...drawn.fields.values()].reduce((n, f) => n + f.glyphs.length, 0);
    expect(marked.length).toBe(glyphs);
  });
  it("draws each glyph where its hit box says, with the same field and offset", () => {
    const uses = [
      ...drawn.svg.matchAll(/<use href="#g[^"]*" x="([\d.-]+)" y="([\d.-]+)"([^>]*)\/>/g),
    ];
    expect(uses.length).toBe(drawn.glyphs.length);
    uses.forEach((use, i) => {
      const box = drawn.glyphs[i] as GlyphBox;
      expect(use[1]).toBe(box.x.toFixed(3));
      expect(use[2]).toBe(box.y.toFixed(3));
      const field = /data-field="([^"]*)" data-offset="(\d+)"/.exec(use[3] ?? "");
      expect(field?.[1]).toBe(box.field);
      expect(field ? Number(field[2]) : undefined).toBe(box.offset);
    });
  });

  it("resolves every field from a click at the centre of its middle glyph", () => {
    for (const field of drawn.fields.values()) {
      const boxes = drawn.glyphs.filter((g) => g.field === field.id);
      const middle = boxes[Math.floor(boxes.length / 2)] as GlyphBox;
      expect(middle, field.id).toBeDefined();
      const hit = glyphAt(
        drawn.glyphs,
        (middle.left + middle.right) / 2,
        (middle.top + middle.bottom) / 2,
      );
      expect(hit, field.id).toBe(middle);
    }
  });

  it("pairs an accent with its letter however wide or tall, and never across a line", async () => {
    const draw = async (preamble: string, latex: string, text: string, job: string) => {
      const body = `\\documentclass{article}${preamble}\\begin{document}${latex}\\end{document}`;
      const compiled = session.compile("pdftex", "stock", body, { job, maxPasses: 1 });
      if (!compiled.output) throw new Error(compiled.error);
      const page = await drawPage(compiled.output, fonts, new Map([["f", text]]));
      return { page, texts: page.fields.get("f")?.glyphs.map((glyph) => glyph.text) };
    };
    const field = (latex: string) => `\\special{rt:b:f}${latex}\\special{rt:e:f}`;
    const t1 = "\\usepackage[T1]{fontenc}\\usepackage{lmodern}";
    // Letters neither encoding has a glyph for, which LaTeX sets with \accent: an I narrower
    // than its accent, which starts after it; a W and an M wider than the dot, which start before
    // it by more than its width; and capitals the accent is raised over.
    const cases: [string, string, string][] = [
      [t1, "\\=Ivo \\v{I} \\=a \\v{\\i} \\~I \\.W \\.M \\v{A}", "Īvo Ǐ ā ǐ Ĩ Ẇ Ṁ Ǎ"],
      ["", "\\'I\\'E \\^I \\\"I \\'l \\.W \\.M \\u{g}", "ÍÉ Î Ï ĺ Ẇ Ṁ ğ"],
    ];
    for (const [i, [preamble, latex, text]] of cases.entries()) {
      const { page, texts } = await draw(preamble, field(latex), text, `accents-${i}`);
      expect(texts?.join(""), text).toBe(text.replaceAll(" ", ""));
      expect(page.unmatched, text).toBe(0);
    }
    // The reviewers' \parbox cases, where an accent standing alone ends a line and the next line
    // starts at the left margin: OT1's ~, and TS1's ´ in T1.
    const ended: [string, string, string][] = [
      ["", "Cut build times by \\textasciitilde{} half across the monorepo", "by ~ half"],
      [t1, "Rated ´ marks as noise in scanned forms", "Rated ´ marks"],
    ];
    for (const [i, [preamble, latex, words]] of ended.entries()) {
      const text = latex.replace("\\textasciitilde{}", "~");
      const { page, texts } = await draw(
        preamble,
        `\\parbox{21mm}{${field(latex)}}`,
        text,
        `ended-${i}`,
      );
      expect(texts?.join(""), words).toBe(text.replaceAll(" ", ""));
      expect(page.unmatched, words).toBe(0);
      const accent = page.fields
        .get("f")
        ?.glyphs.find((glyph) => glyph.text === "~" || glyph.text === "´");
      const next = page.glyphs.find(
        (box) => box.field === "f" && box.offset === (accent?.offset ?? 0) + 2,
      );
      const at = page.glyphs.find((box) => box.field === "f" && box.offset === accent?.offset);
      // The accent ends its line, and the letter after it starts the next.
      expect(next && at && next.y > at.y, words).toBe(true);
    }
  }, 60_000);

  it("reads TS1's superior figures as themselves, in Times and in Latin Modern", async () => {
    // LaTeX sets ² from TS1, whose glyph lm-ts1.enc names two.superior: read as 2, it matched
    // nothing, and a click on it landed in the 20 after it.
    const text = "Cut floor space by 10² 20 m²";
    const families = ["\\renewcommand{\\rmdefault}{ptm}", "\\usepackage{lmodern}"];
    for (const [i, family] of families.entries()) {
      const body = `\\documentclass{article}\\usepackage[T1]{fontenc}${family}\\begin{document}\\special{rt:b:f}${text}\\special{rt:e:f}\\end{document}`;
      const compiled = session.compile("pdftex", "stock", body, {
        job: `superior-${i}`,
        maxPasses: 1,
      });
      if (!compiled.output) throw new Error(compiled.error);
      const page = await drawPage(compiled.output, fonts, new Map([["f", text]]));
      expect(page.missingFonts, family).toEqual(new Map());
      expect(page.unmatched, family).toBe(0);
      const glyphs = page.fields.get("f")?.glyphs ?? [];
      for (const offset of [text.indexOf("²"), text.lastIndexOf("²")])
        expect(glyphs.find((glyph) => glyph.offset === offset)?.text, family).toBe("²");
    }
  }, 60_000);

  it("finds a field's paragraph special and where its line starts, a rule included", async () => {
    // The special is read whatever the case of its id, past another field's, and only between
    // the begin marker and the field's first glyph.
    const body = [
      "\\documentclass{article}\\begin{document}",
      "\\noindent\\rule{12pt}{0.4pt} Label: \\special{rt:b:f}\\special{rt:p:g:other}",
      "\\special{RT:P:F:hsize=345.0pt}Text\\special{rt:e:f}\\par",
      "\\noindent\\special{rt:b:g}Lat\\special{rt:p:g:late}e\\special{rt:e:g}",
      "\\end{document}",
    ].join("\n");
    const compiled = session.compile("pdftex", "stock", body, { job: "layouts", maxPasses: 1 });
    if (!compiled.output) throw new Error(compiled.error);
    const page = await drawPage(
      compiled.output,
      fonts,
      new Map([
        ["f", "Text"],
        ["g", "Late"],
      ]),
    );
    const f = page.fields.get("f")?.layout;
    expect(f?.paragraph).toBe("RT:P:F:hsize=345.0pt");
    expect(f?.font.name).toBe("cmr10");
    expect(f?.size).toBeCloseTo(10, 5);
    // The baseline starts at the rule, before the label's glyphs and the field's.
    const label = Math.min(...page.glyphs.filter((glyph) => glyph.y === f?.y).map((g) => g.x));
    expect(f && label - (f.baseline[0] ?? Number.NaN)).toBeGreaterThan(12);
    expect(f && f.x - label).toBeGreaterThan(20);
    expect(f?.baseline).toContain(f?.x);
    const g = page.fields.get("g")?.layout;
    expect(g?.paragraph).toBeUndefined();
    expect(g?.baseline[0]).toBe(g?.x);
  }, 30_000);

  it("gives a field its letter font first, and where its second line starts", async () => {
    // LaTeX sets € from TS1 in a T1 paragraph: a field that starts with one is still measured and
    // set in the font of its letters. The field's second line starts at the paragraph's edge.
    const text =
      "\u20ac2.4M raised after building the first prototype, then hired and led a team of six engineers through launch and growth.";
    const body = [
      "\\documentclass{article}\\usepackage[T1]{fontenc}\\usepackage{lmodern}\\begin{document}",
      `\\noindent\\parbox{150pt}{\\special{rt:b:f}${text}\\special{rt:e:f}}`,
      "\\end{document}",
    ].join("\n");
    const compiled = session.compile("pdftex", "stock", body, { job: "letters", maxPasses: 1 });
    if (!compiled.output) throw new Error(compiled.error);
    const page = await drawPage(compiled.output, fonts, new Map([["f", text]]));
    const f = page.fields.get("f")?.layout;
    expect(f?.fonts.map((each) => [each.font.name, each.glyphs, each.letters])).toEqual([
      ["ec-lmr10", (page.fields.get("f")?.glyphs.length ?? 0) - 1, expect.any(Number)],
      ["ts1-lmr10", 1, 0],
    ]);
    expect(f?.font.name).toBe("ec-lmr10");
    const glyphs = page.glyphs.filter((glyph) => glyph.field === "f");
    const second = glyphs.find((glyph) => glyph.y > (f?.y ?? 0) + 5);
    expect(f?.secondLine).toBe(second?.x);
    expect(f?.secondLine).toBe(f?.x);
  }, 30_000);

  /**
   * The page of `count` fields of one glyph each, `cell` the LaTeX of the i-th, 40 to a line of
   * the source, each line ending in `line`, as the engine compiles it.
   */
  function crowded(job: string, count: number, cell: (i: number) => string, line: string) {
    const cells = Array.from({ length: count }, (_, i) => cell(i));
    const lines = Array.from(
      { length: Math.ceil(count / 40) },
      (_, i) => `${cells.slice(i * 40, i * 40 + 40).join("")}${line}`,
    );
    const body = [
      "\\documentclass{article}\\usepackage[margin=0.2in]{geometry}\\begin{document}\\tiny\\noindent",
      ...lines,
      "\\end{document}",
    ].join("\n");
    const compiled = session.compile("pdftex", "stock", body, { job, maxPasses: 1 });
    if (!compiled.output) throw new Error(compiled.error);
    return compiled.output;
  }

  /**
   * A page of 8,000 fields of one glyph each (`crowded`), and the same page with a tenth of them:
   * each drawn once to load its fonts, then five times, in turn, and the fastest draw of each in
   * CPU time (`fastestAsync`), with the larger page as first drawn.
   */
  async function tenfold(job: string, cell: (i: number) => string, line: string) {
    const [small, large] = [800, 8000].map((count) =>
      crowded(`${job}-${count}`, count, cell, line),
    );
    if (!small || !large) throw new Error("no pages");
    await drawPage(small, fonts, new Map());
    const page = await drawPage(large, fonts, new Map());
    const [smallMs = 0, largeMs = 0] = await fastestAsync(
      [small, large].map((output) => () => drawPage(output, fonts, new Map())),
      5,
    );
    expect(page.fields.size, job).toBe(8000);
    expect(page.pageCount, job).toBe(1);
    expect(
      [...page.fields.values()].every((field) => field.layout),
      job,
    ).toBe(true);
    return { page, small: smallMs, large: largeMs };
  }

  it("lays out thousands of fields in time proportional to the page", async () => {
    // The reviewers' page: 8,000 fields of one glyph each, which a template could mark. Laid out
    // field by field over the whole page, it drew in 636 to 726 ms, after every edit's compile.
    // Ten times the fields cost 11.0 to 12.5 times the CPU time of the page's tenth now, and cost
    // 74 to 95 times in the two ways this was quadratic. So the page is bound by its tenth, drawn
    // on the same machine in the same way, rather than in milliseconds, which a slow shared
    // machine may not meet; and by five times ten times it, since a shared runner's ratios run as
    // much as twice this machine's, which still fails either quadratic way. 500 ms stays as a
    // ceiling, should the tenth go slow too.
    const { small, large } = await tenfold(
      "many",
      (i) => `\\special{rt:b:f${i}}x\\special{rt:e:f${i}}`,
      " ",
    );
    expect(large).toBeLessThan(bound(5 * 10, small));
    expect(large).toBeLessThan(500);
  }, 60_000);

  it("gathers each baseline once, however close a page's baselines lie", async () => {
    // The verifier's page: the 8,000 fields on one line, each raised a scaled point more than the
    // one before, so that each glyph has a baseline of its own within half a point of every other.
    // Gathered and sorted anew for each baseline, what shares a field's baseline took 2.2 s, and
    // 95 times the CPU time of the page's tenth where it now takes 10.6 to 11.6 times; bound as
    // above.
    const { page, small, large } = await tenfold(
      "close",
      (i) => `\\special{rt:b:f${i}}\\rlap{\\raisebox{${i}sp}{x}}\\special{rt:e:f${i}}`,
      "%",
    );
    const baselines = new Set([...page.fields.values()].map((field) => field.layout?.baseline));
    expect(baselines.size).toBe(1);
    expect([...baselines][0]).toHaveLength(8000);
    expect(large).toBeLessThan(bound(5 * 10, small));
    expect(large).toBeLessThan(500);
  }, 60_000);

  it("pairs OT1 typewriter's circumflex and tilde with the letter under them", async () => {
    // cmtt has the ASCII ^ and ~ at 94 and 126, where cmr has the accents, and OT1's \^ and \~
    // set them: î is \^\i, the ^ over a dotless i, and ñ is \~n. A dotless i alone is ı, and the
    // same ^ and ~ standing alone stay themselves, the letter after each starting where it ends.
    const latex = new Map([
      ["a", "Resmî ılık"],
      ["b", "Millî ırmak"],
      ["c", "Año niño"],
      ["d", "x\\textasciicircum{}y \\textasciitilde{}z"],
    ]);
    const texts = new Map([...latex, ["d", "x^y ~z"]]);
    const fields = [...latex]
      .map(([id, source]) => `\\special{rt:b:${id}}${source}\\special{rt:e:${id}} `)
      .join("");
    const body = `\\documentclass{article}\\begin{document}\\texttt{${fields}}\\end{document}`;
    const compiled = session.compile("pdftex", "stock", body, { job: "typewriter", maxPasses: 1 });
    if (!compiled.output) throw new Error(compiled.error);
    const page = await drawPage(compiled.output, fonts, texts);
    expect(page.missingFonts).toEqual(new Map());
    expect(page.unmatched).toBe(0);
    for (const [id, text] of texts) {
      const glyphs = page.fields.get(id)?.glyphs ?? [];
      // Each character but the space is one glyph, at its own offset.
      const characters = [...text].flatMap((char, offset) =>
        char === " " ? [] : [{ char, offset }],
      );
      expect(
        glyphs.map((glyph) => glyph.text),
        text,
      ).toEqual(characters.map((c) => c.char));
      expect(
        glyphs.map((glyph) => glyph.offset),
        text,
      ).toEqual(characters.map((c) => c.offset));
    }
  }, 30_000);

  describe("on the invented XeTeX template's page", () => {
    const { package: pkg, sample } = INVENTED_XETEX;
    const values = defaultControls(pkg);
    let xetex: DrawnPage;
    let xetexTexts: Map<string, string>;
    beforeAll(async () => {
      const format = generateFormat(pkg, values);
      const dumped = session.dump("xetex", format.name, format.preamble, format.files);
      if (!dumped.ok) throw new Error(dumped.error);
      const body = generateBody(pkg, sample, values);
      const compiled = session.compile("xetex", format.name, body.latex, { job: "xetex" });
      if (!compiled.output) throw new Error(compiled.error);
      xetexTexts = body.texts;
      // A library of its own, so that the draw reads and parses every font file as a first does.
      const manifest = JSON.parse(
        readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
      ) as EngineManifest;
      const cold = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
        readFileSync(join(ENGINE_DIR, "files", path)),
      );
      const started = performance.now();
      xetex = await drawPage(compiled.output, cold, xetexTexts);
      const first = performance.now() - started;
      const again = performance.now();
      await drawPage(compiled.output, cold, xetexTexts);
      console.log(
        `invented XeTeX page: first draw ${first.toFixed(0)} ms, again ${(performance.now() - again).toFixed(0)} ms`,
      );
    }, 60_000);

    it("draws every native font, and finds every field with its glyphs", () => {
      expect(xetex.missingFonts).toEqual(new Map());
      expect(xetex.pageCount).toBe(1);
      expect(xetex.fields.size).toBe(xetexTexts.size);
      for (const field of xetex.fields.values())
        expect(field.glyphs.length, field.id).toBeGreaterThan(0);
      expect(xetex.unmatched).toBe(0);
    });

    it("gives each glyph of a run its own character, ligatures and tex-text's quotes included", () => {
      const text = xetexTexts.get("harbor-1.text") ?? "";
      const glyphs = xetex.fields.get("harbor-1.text")?.glyphs ?? [];
      // Roboto's fi, an apostrophe XeTeX curls, and a dash it makes of two hyphens.
      const at = (spelling: string) => glyphs.find((g) => g.offset === text.indexOf(spelling));
      expect(at("fice")?.text).toBe("fi");
      expect(at("'s")?.text).toBe("\u{2019}");
      expect(at("--")?.text).toBe("\u{2013}");
      for (const glyph of glyphs) expect(glyph.glyph, String(glyph.offset)).toBeDefined();
    });

    it("draws each native glyph where its hit box says, with its field and offset", () => {
      const uses = [
        ...xetex.svg.matchAll(/<use href="#n[^"]*" x="([\d.-]+)" y="([\d.-]+)"([^>]*)\/>/g),
      ];
      expect(uses.length).toBe(xetex.glyphs.length);
      uses.forEach((use, i) => {
        const box = xetex.glyphs[i] as GlyphBox;
        expect(use[1]).toBe(box.x.toFixed(3));
        expect(use[2]).toBe(box.y.toFixed(3));
        const field = /data-field="([^"]*)" data-offset="(\d+)"/.exec(use[3] ?? "");
        expect(field?.[1]).toBe(box.field);
        expect(field ? Number(field[2]) : undefined).toBe(box.offset);
        // A letter's box has ink in it, around its origin on the baseline.
        expect(box.right).toBeGreaterThan(box.left);
        expect(box.bottom).toBeGreaterThan(box.top);
      });
      // The icon in the header is drawn, and belongs to no field.
      const icon = uses.filter((use) => use[3]?.includes("FontAwesome5Free-Solid-900.otf"));
      expect(icon).toHaveLength(1);
      expect(icon[0]?.[3]).not.toContain("data-field");
    });

    it("resolves every field from a click at the centre of its middle glyph", () => {
      for (const field of xetex.fields.values()) {
        const boxes = xetex.glyphs.filter((g) => g.field === field.id);
        const middle = boxes[Math.floor(boxes.length / 2)] as GlyphBox;
        expect(middle, field.id).toBeDefined();
        const hit = glyphAt(
          xetex.glyphs,
          (middle.left + middle.right) / 2,
          (middle.top + middle.bottom) / 2,
        );
        expect(hit, field.id).toBe(middle);
      }
    });

    /** The invented template's page for another resume, compiled in a job of its own. */
    const drawnFor = async (resume: Resume, job: string) => {
      const format = generateFormat(pkg, values);
      const body = generateBody(pkg, resume, values);
      const compiled = session.compile("xetex", format.name, body.latex, { job });
      if (!compiled.output) throw new Error(compiled.error);
      return { page: await drawPage(compiled.output, fonts, body.texts), texts: body.texts };
    };

    it("reads a Source Sans glyph its map gives several characters as the one the text holds", async () => {
      // The headings are Source Sans Pro bold, whose map gives one glyph U+2019 and U+02BC, which
      // tex-text makes of every ', one U+2018 and U+02BB, which it makes of `, one U+00B5 and
      // U+03BC, and one U+002D, U+00AD, U+2010 and U+2011.
      const resume = structuredClone(sample);
      const titles = [
        "Maker's Summary",
        "`Chosen' Work in 5 \u{b5}m and 5 \u{3bc}m",
        "Non\u{2011}stop Skills",
      ];
      resume.sections.forEach((section, i) => {
        section.title = titles[i] ?? section.title;
      });
      const { page, texts } = await drawnFor(resume, "aliases");
      expect(page.missingFonts).toEqual(new Map());
      expect(page.unmatched).toBe(0);
      const glyphAtOffset = (id: string, spelling: string) =>
        page.fields.get(id)?.glyphs.find((g) => g.offset === texts.get(id)?.indexOf(spelling));
      expect(glyphAtOffset("summary.title", "'s")?.text).toBe("\u{2019}");
      expect(glyphAtOffset("work.title", "`")?.text).toBe("\u{2018}");
      expect(glyphAtOffset("work.title", "\u{b5}")?.text).toBe("\u{b5}");
      expect(glyphAtOffset("work.title", "\u{3bc}")?.text).toBe("\u{b5}");
      // U+2011 is the character the text holds, not a hyphen TeX inserted before it.
      const hyphen = glyphAtOffset("skills.title", "\u{2011}");
      expect(hyphen?.text).toBe("-");
      expect(hyphen?.inserted).toBeUndefined();
    }, 30_000);

    it("reads a ligature of the ccmp feature as its letters, composed where one is a mark", async () => {
      // HarfBuzz applies ccmp unasked: Source Sans's makes one glyph of l·l, and Roboto, which has
      // no ṛ, ṣ, ṇ or ḍ, sets each as its letter and U+0323, which its ccmp joins into one glyph.
      const resume = structuredClone(sample);
      const [summary] = resume.sections;
      if (summary?.kind !== "paragraph") throw new Error("the sample starts with its summary");
      summary.title = "Col\u{b7}laboraci\u{f3} amb la Paral\u{b7}lel";
      summary.text = [
        { text: "Read the K\u{1e5b}\u{1e63}\u{1e47}a and \u{100}\u{1e0d}hya folios." },
      ];
      const { page, texts } = await drawnFor(resume, "ccmp");
      expect(page.missingFonts).toEqual(new Map());
      expect(page.unmatched).toBe(0);
      const glyphAtOffset = (id: string, spelling: string) =>
        page.fields.get(id)?.glyphs.find((g) => g.offset === texts.get(id)?.indexOf(spelling));
      expect(glyphAtOffset("summary.title", "l\u{b7}l")?.text).toBe("l\u{b7}l");
      expect(glyphAtOffset("summary.text", "\u{1e5b}")?.text).toBe("\u{1e5b}");
      expect(glyphAtOffset("summary.text", "\u{1e0d}")?.text).toBe("\u{1e0d}");
    }, 30_000);

    it("sets the base of an accented letter its fonts lack, where the letter is", async () => {
      // Roboto has neither ǎ nor the combining caron: the body sets the a, which the page reads
      // at the ǎ, rather than leave the letter out.
      const resume = structuredClone(sample);
      const [summary] = resume.sections;
      if (summary?.kind !== "paragraph") throw new Error("the sample starts with its summary");
      summary.text = [{ text: "Taught Xi\u{1ce}oming to set type." }];
      const { covers } = await fonts.coverage(fontFiles(pkg));
      const format = generateFormat(pkg, values);
      const body = generateBody(pkg, resume, values, { covers });
      expect(body.dropped).toEqual(["\u{1ce}"]);
      const compiled = session.compile("xetex", format.name, body.latex, { job: "base" });
      if (!compiled.output) throw new Error(compiled.error);
      const page = await drawPage(compiled.output, fonts, body.texts);
      expect(page.unmatched).toBe(0);
      const text = body.texts.get("summary.text") ?? "";
      const letter = page.fields
        .get("summary.text")
        ?.glyphs.find((g) => g.offset === text.indexOf("\u{1ce}"));
      expect(letter?.text).toBe("a");
    }, 30_000);

    it("lays each field out in the native font and size of its first glyphs", () => {
      const layout = (id: string) => xetex.fields.get(id)?.layout;
      const name = layout("header.first");
      expect(name?.font.kind).toBe("native");
      expect(name?.font.name).toBe("Roboto-Bold.otf");
      expect(name?.size).toBeCloseTo(17.28, 2);
      expect(layout("work.title")?.font.name).toBe("SourceSansPro-Bold.otf");
      expect(layout("work.title")?.size).toBeCloseTo(12, 2);
      const bullet = layout("harbor-1.text");
      expect(bullet?.font.name).toBe("Roboto-Regular.otf");
      expect(bullet?.size).toBeCloseTo(10.95, 2);
      expect(bullet?.paragraph).toMatch(/^rt:p:harbor-1\.text:hsize=/);
      // The bullet takes two lines, whose second starts at the paragraph's edge.
      const first = xetex.glyphs.find((g) => g.field === "harbor-1.text");
      expect([bullet?.x, bullet?.y]).toEqual([first?.x, first?.y]);
      expect(bullet?.secondLine).toBeDefined();
      expect(bullet?.secondLine).toBeCloseTo(bullet?.x ?? 0, 3);
    });
  });

  it("aligns a title a heading sets in capitals, and says the page folds it, on pdfTeX and XeTeX", async () => {
    // An invented preamble whose section macro uppercases its argument, as AltaCV's does, set in
    // T1 and Latin Modern with the prelude, on pdfTeX; and the invented XeTeX template with its
    // heading made to do the same (decision 0021).
    const title = "Stra\u{df}enbahn planning";
    const body = [
      "\\documentclass{article}\\usepackage[T1]{fontenc}\\usepackage{lmodern}",
      PRELUDE,
      "\\newcommand{\\heading}[1]{\\section*{\\MakeUppercase{#1}}}",
      "\\begin{document}",
      `\\heading{\\rtfield{work.title}{${title}}}`,
      "\\rtfield{tern-1.text}{Set the quarterly report}\\par",
      "\\end{document}",
    ].join("\n");
    const compiled = session.compile("pdftex", "stock", body, { job: "folded", maxPasses: 1 });
    if (!compiled.output) throw new Error(compiled.error);
    const texts = new Map([
      ["work.title", title],
      ["tern-1.text", "Set the quarterly report"],
    ]);
    const page = await drawPage(compiled.output, fonts, texts);
    expect(page.missingFonts).toEqual(new Map());
    expect(page.unmatched).toBe(0);
    const heading = page.fields.get("work.title");
    expect(heading?.glyphs.map((g) => g.text).join("")).toBe("STRASSENBAHNPLANNING");
    expect(heading?.layout?.folded).toBe("upper");
    expect(page.fields.get("tern-1.text")?.layout?.folded).toBeUndefined();
    // ß's two capitals S both stand at its offset, so a click on either lands on it.
    const sharp = title.indexOf("\u{df}");
    expect(heading?.glyphs.filter((g) => g.offset === sharp).map((g) => g.text)).toEqual([
      "S",
      "S",
    ]);

    const { package: pkg, sample } = INVENTED_XETEX;
    const capitals = parsePackage({
      ...pkg,
      id: "invented-xetex-capitals",
      preamble: pkg.preamble.replace(
        "\\color{rtaccent}#1}",
        "\\color{rtaccent}\\MakeUppercase{#1}}",
      ),
    });
    const values = defaultControls(capitals);
    const format = generateFormat(capitals, values);
    const dumped = session.dump("xetex", format.name, format.preamble, format.files);
    if (!dumped.ok) throw new Error(dumped.error);
    const covers = (await fonts.coverage(fontFiles(capitals))).covers;
    const generated = generateBody(capitals, sample, values, { covers });
    const xetex = session.compile("xetex", format.name, generated.latex, { job: "xefolded" });
    if (!xetex.output) throw new Error(xetex.error);
    const xePage = await drawPage(xetex.output, fonts, generated.texts);
    expect(xePage.unmatched).toBe(0);
    const titles = ["summary.title", "work.title", "skills.title"];
    for (const id of generated.texts.keys()) {
      const field = xePage.fields.get(id);
      expect(field?.layout?.folded, id).toBe(titles.includes(id) ? "upper" : undefined);
    }
    expect(
      xePage.fields
        .get("work.title")
        ?.glyphs.map((g) => g.text)
        .join(""),
    ).toBe("EXPERIENCE");
  }, 60_000);

  it("aligns a title TeX breaks between the capitals of ß, the hyphen at ß's offset", async () => {
    // At a narrow measure TeX breaks MASSEINHEIT, Maßeinheit in capitals, between the two S of ß:
    // the hyphen is one TeX inserted, and it and both S stand at ß's offset (decision 0021).
    const text = "Die Ma\u{df}einheit";
    const body = [
      "\\documentclass{article}\\usepackage[T1]{fontenc}\\usepackage{lmodern}",
      PRELUDE,
      "\\begin{document}\\hsize=0.5in\\parindent=0pt",
      `{\\MakeUppercase{\\rtfield{caps.text}{${text}}}\\par}`,
      "\\end{document}",
    ].join("\n");
    const compiled = session.compile("pdftex", "stock", body, { job: "sharp-break", maxPasses: 1 });
    if (!compiled.output) throw new Error(compiled.error);
    const page = await drawPage(compiled.output, fonts, new Map([["caps.text", text]]));
    expect(page.missingFonts).toEqual(new Map());
    expect(page.unmatched).toBe(0);
    const field = page.fields.get("caps.text");
    expect(field?.glyphs.map((g) => g.text).join("")).toBe("DIEMAS-SEINHEIT");
    expect(field?.layout?.folded).toBe("upper");
    const sharp = text.indexOf("\u{df}");
    expect(
      field?.glyphs.filter((g) => g.offset === sharp).map((g) => [g.text, g.inserted === true]),
    ).toEqual([
      ["S", false],
      ["-", true],
      ["S", false],
    ]);
  }, 60_000);

  it("names a native font XeTeX emboldens, and draws its runs as boxes", async () => {
    const body = String.raw`\documentclass{article}\pagestyle{empty}\begin{document}
\font\bolded="[Roboto-Regular.otf]:embolden=2" {\bolded Boxed} \font\plain="[Roboto-Regular.otf]" {\plain Drawn}
\end{document}`;
    const compiled = session.compile("xetex", "stock", body, { job: "bolded", maxPasses: 1 });
    if (!compiled.output) throw new Error(compiled.error);
    const drawn = await drawPage(compiled.output, fonts, new Map());
    expect(drawn.missingFonts.get("Roboto-Regular.otf")).toBe(
      "XeTeX emboldens it, which the page draws as boxes",
    );
    expect(drawn.svg.match(/<rect [^>]*stroke="rgb\(200,60,60\)"/g)).toHaveLength(1);
    expect(drawn.svg.match(/<use href="#n/g)).toHaveLength("Drawn".length);
  }, 30_000);

  it("gives a later page the size the first page set", async () => {
    const compiled = session.compile(
      "pdftex",
      "stock",
      "\\documentclass{article}\\usepackage[a4paper]{geometry}\\begin{document}One\\newpage Two\\end{document}",
      { job: "a4" },
    );
    const output = compiled.output as Uint8Array;
    const first = await drawPage(output, fonts, new Map(), 0);
    const second = await drawPage(output, fonts, new Map(), 1);
    expect(first.pageCount).toBe(2);
    expect(first.size.width).toBeCloseTo(597.51, 2);
    expect(second.size).toEqual(first.size);
  }, 30_000);
});
