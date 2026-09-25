import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { type DrawnPage, drawPage, type GlyphBox, glyphAt, paperSize } from "./draw";
import { FontLibrary } from "./fonts";
import { TexLiveIndex } from "./texlive";

const spike = (name: string) =>
  readFileSync(new URL(`../../spike/web/${name}`, import.meta.url), "utf8");

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../tex/fixtures/${name}`, import.meta.url)));

/** A library over a tree holding only cmr10, whose reads of a path ending in `failing` fail. */
function cmr10Library(failing = "never") {
  const files: Record<string, Uint8Array> = {
    "/texlive/texmf-dist/fonts/map/pdftex/pdftex.map": new TextEncoder().encode(
      "cmr10 CMR10 <cmr10.pfb\n",
    ),
    "/texlive/texmf-dist/fonts/tfm/cm/cmr10.tfm": fixture("cmr10.tfm"),
    "/texlive/texmf-dist/fonts/type1/cm/cmr10.pfb": fixture("cmr10.pfb"),
  };
  const manifest = { release: "test", layout: 2, bundles: [], files: {} } as EngineManifest;
  for (const path of Object.keys(files)) manifest.files[path] = 1;
  return new FontLibrary(new TexLiveIndex(manifest), async (path) => {
    if (path.endsWith(failing)) throw new Error(`could not read ${path}`);
    return files[path] as Uint8Array;
  });
}

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

  it("names a font whose files cannot be read, and draws the page without it", async () => {
    const drawn = await drawPage(fixture("accents.dvi"), cmr10Library("cmr10.pfb"), texts);
    expect(drawn.missingFonts).toEqual(
      new Map([["cmr10", "could not read /texlive/texmf-dist/fonts/type1/cm/cmr10.pfb"]]),
    );
    expect(drawn.glyphs).toEqual([]);
    expect(drawn.fields.get("word")?.glyphs.length).toBeGreaterThan(0);
  });
});

/** Field texts straight from the spike's marked-up body, as the spike page read them. */
function fieldTexts(body: string): Map<string, string> {
  const texts = new Map<string, string>();
  for (const m of body.matchAll(/\\rtfield\{([^}]*)\}\{([^{}]*)\}/g))
    texts.set(m[1] ?? "", m[2] ?? "");
  return texts;
}

describe("paperSize", () => {
  const special = (text: string) => ({ items: [{ kind: "special" as const, h: 0, v: 0, text }] });
  it("reads the size geometry and hyperref write", () => {
    expect(paperSize(special("papersize=614.295pt,794.96999pt"))).toEqual({
      width: 614.295,
      height: 794.96999,
    });
    expect(paperSize(special("papersize=210mm,297mm"))?.width).toBeCloseTo(597.508, 2);
  });
  it("gives up on anything else", () => {
    expect(paperSize(special("papersize=a4"))).toBeUndefined();
    expect(paperSize({ items: [] })).toBeUndefined();
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
