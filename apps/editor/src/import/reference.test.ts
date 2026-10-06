import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { readTree } from "./fonts";
import { type Intake, intake, treeImages } from "./intake";
import {
  COMPATIBILITY,
  compileLikeReference,
  difference,
  firstDifference,
  type GlyphStream,
  GRAPHICS_CFG,
  glyphStream,
  type Reference,
  type ReferenceItem,
  reference,
  referenceFiles,
  sameGlyphs,
  specialCommand,
} from "./reference";
import { isRefusal, type Refusal } from "./refusal";

// Every document here is invented for these tests, and every stream: invented classes, fonts and
// filler that say so. Nothing is taken from a real resume or template.

const glyph = (code: number, h: number, font = "cmr10"): ReferenceItem => ({
  kind: "glyph",
  font,
  size: 655360,
  code,
  h,
  v: 3_000_000,
});

/** An invented stream: one page of glyphs, a rule, and the specials a page carries. */
const stream = (items: ReferenceItem[]): GlyphStream => ({
  pages: [{ items }],
  size: { width: 614.295, height: 794.97 },
  fonts: { tex: ["cmr10"], native: [], shipped: [] },
  specials: [],
});

const base: ReferenceItem[] = [
  { kind: "special", h: 0, v: 0, text: "papersize=614.295pt,794.97pt" },
  glyph(73, 100),
  glyph(110, 300_000),
  { kind: "rule", h: 0, v: 3_100_000, width: 20_000_000, height: 26_214 },
  glyph(118, 600_000),
];

describe("comparing glyph streams", () => {
  test("finds a stream the same as itself, and as one a point of scaled points off", () => {
    expect(sameGlyphs(stream(base), stream(base))).toBe(true);
    const moved = base.map((item) => (item.kind === "glyph" ? { ...item, h: item.h + 1 } : item));
    expect(sameGlyphs(stream(base), stream(moved))).toBe(true);
  });

  test("tells one glyph, one place, one font and one rule apart", () => {
    const change = (i: number, to: Partial<ReferenceItem>) =>
      stream(base.map((item, j) => (j === i ? ({ ...item, ...to } as ReferenceItem) : item)));
    expect(sameGlyphs(stream(base), change(2, { code: 111 }))).toBe(false);
    expect(sameGlyphs(stream(base), change(2, { h: 300_002 }))).toBe(false);
    expect(sameGlyphs(stream(base), change(4, { v: 3_000_002 }))).toBe(false);
    expect(sameGlyphs(stream(base), change(1, { font: "cmbx10" }))).toBe(false);
    expect(sameGlyphs(stream(base), change(1, { size: 720_896 }))).toBe(false);
    expect(sameGlyphs(stream(base), change(3, { width: 19_000_000 }))).toBe(false);
    expect(sameGlyphs(stream(base), stream(base.slice(0, 4)))).toBe(false);
    expect(firstDifference(stream(base), change(2, { code: 111 }))).toBe(
      "page 1, item 3: code 110 of cmr10 at 655360 sp at (300000, 3000000) sp against code 111 of cmr10 at 655360 sp at (300000, 3000000) sp",
    );
  });

  test("ignores the editor's markers and the specials of a whole compile's first shipout", () => {
    const marked: ReferenceItem[] = [
      base[0] as ReferenceItem,
      { kind: "special", h: 100, v: 3_000_000, text: "rt:b:header.first" },
      { kind: "special", h: 100, v: 3_000_000, text: "rt:p:header.first:hsize=100pt" },
      { kind: "special", h: 100, v: 3_000_000, text: "rt:l:locked.1" },
      ...base.slice(1, 3),
      { kind: "special", h: 400_000, v: 3_000_000, text: "rt:e:header.first" },
      ...base.slice(3),
    ];
    expect(sameGlyphs(stream(base), stream(marked))).toBe(true);
    // A whole compile's first shipout: the PDF's version, dvipdfmx's configuration, and xcolor's
    // black, which no `color pop` takes off, under a colour the page pushes and pops.
    const whole: ReferenceItem[] = [
      { kind: "special", h: 0, v: 0, text: "pdf:majorversion 1" },
      { kind: "special", h: 0, v: 0, text: "pdf:minorversion 5" },
      { kind: "special", h: 0, v: 0, text: "dvipdfmx:config C 0x0010" },
      base[0] as ReferenceItem,
      { kind: "special", h: 90, v: 3_000_000, text: "color push gray 0" },
      ...base.slice(1, 2),
      { kind: "special", h: 200_000, v: 3_000_000, text: "color push rgb 1 0 0" },
      ...base.slice(2, 3),
      { kind: "special", h: 400_000, v: 3_000_000, text: "color pop" },
      ...base.slice(3),
    ];
    const body: ReferenceItem[] = whole.filter(
      (item) => item.kind !== "special" || !/version|config|gray/.test(item.text),
    );
    expect(sameGlyphs(stream(whole), stream(body))).toBe(true);
    // A black that a pop takes off is the page's, and counts.
    const popped: ReferenceItem[] = [
      ...body,
      { kind: "special", h: 600_000, v: 3_000_000, text: "color push gray 0" },
      { kind: "special", h: 700_000, v: 3_000_000, text: "color pop" },
    ];
    expect(sameGlyphs(stream(body), stream(popped))).toBe(false);
    // A white page's background, which \pagecolor{white} writes at the first shipout, counts
    // for nothing; another colour's does.
    const white = { kind: "special" as const, h: 0, v: 0, text: "background rgb 1 1 1" };
    expect(sameGlyphs(stream([white, ...whole]), stream(body))).toBe(true);
    expect(
      sameGlyphs(stream([{ ...white, text: "background rgb 1 0 0" }, ...whole]), stream(body)),
    ).toBe(false);
    // xcolor's black is RGB's or CMYK's in a document of that colour model, as AltaCV's is.
    for (const black of ["color push rgb 0 0 0", "color push cmyk 0 0 0 1"]) {
      const model = whole.map((item) =>
        item.kind === "special" && item.text === "color push gray 0"
          ? { ...item, text: black }
          : item,
      );
      expect(sameGlyphs(stream(model), stream(body)), black).toBe(true);
    }
  });

  test("leaves out the first shipout's black in whatever colour model xcolor writes it", () => {
    // xcolor's black follows the model a document asks for: gray, rgb or cmyk, or the dvips
    // driver's name for it.
    const withFirst = (text: string): ReferenceItem[] => [
      base[0] as ReferenceItem,
      base[1] as ReferenceItem,
      { kind: "special", h: 90, v: 3_000_000, text },
      ...base.slice(2),
    ];
    for (const black of [
      "color push gray 0",
      "color push rgb 0 0 0",
      "color push rgb 0.0 0.0 0.0",
      "color push cmyk 0 0 0 1",
      "color push  Black",
    ])
      expect(sameGlyphs(stream(withFirst(black)), stream(base)), black).toBe(true);
    // Another colour is the page's, and so is a black a pop takes off.
    for (const colour of [
      "color push rgb 0 0 1",
      "color push cmyk 0 0 0 0.5",
      "color push gray 0.5",
      "color push Blue",
    ])
      expect(sameGlyphs(stream(withFirst(colour)), stream(base)), colour).toBe(false);
    const popped: ReferenceItem[] = [
      ...withFirst("color push rgb 0 0 0"),
      { kind: "special", h: 700_000, v: 3_000_000, text: "color pop" },
    ];
    expect(sameGlyphs(stream(popped), stream(base))).toBe(false);
  });

  test("tells a colour, an image or a link apart, naming only its command", () => {
    const special = (text: string): ReferenceItem => ({
      kind: "special",
      h: 90,
      v: 3_000_000,
      text,
    });
    const coloured = [special("color push rgb 1 0 0"), ...base, special("color pop")];
    const black = [special("color push gray 0.5"), ...base, special("color pop")];
    expect(sameGlyphs(stream(coloured), stream(black))).toBe(false);
    expect(sameGlyphs(stream(coloured), stream(base))).toBe(false);
    const photo = [...base, special("pdf:image bbox 0 0 57 57 (photo.png)")];
    expect(sameGlyphs(stream(photo), stream(base))).toBe(false);
    const moved = [...base, { ...special("pdf:image bbox 0 0 57 57 (photo.png)"), h: 92 }];
    expect(sameGlyphs(stream(photo), stream(moved))).toBe(false);
    const link = (address: string) => [
      ...base,
      special(`pdf:bann << /Type /Annot /A << /URI (${address}) >> >>`),
    ];
    expect(
      firstDifference(
        stream(link("https://invented.example/a")),
        stream(link("https://invented.example/b")),
      ),
    ).toBe(
      "page 1, item 6: a special pdf:bann at (90, 3000000) sp against a special pdf:bann at (90, 3000000) sp",
    );
  });

  test("tells a native font's face, colour, slant, emboldening and extent apart", () => {
    const native = (drawn: Partial<ReferenceItem>): ReferenceItem =>
      ({ ...glyph(52, 100, "Invented-Regular.otf"), native: true, ...drawn }) as ReferenceItem;
    const plain = stream([native({})]);
    for (const drawn of [
      { index: 1 },
      { rgba: 0xff0000ff },
      { slant: 19_661 },
      { embolden: 131_072 },
      { extend: 55_705 },
    ]) {
      expect(sameGlyphs(plain, stream([native(drawn)])), JSON.stringify(drawn)).toBe(false);
      expect(sameGlyphs(stream([native(drawn)]), stream([native(drawn)]))).toBe(true);
    }
    expect(firstDifference(plain, stream([native({ slant: 19_661 })]))).toBe(
      "page 1, item 1: glyph 52 of Invented-Regular.otf at 655360 sp at (100, 3000000) sp against glyph 52 of Invented-Regular.otf (slant 19661) at 655360 sp at (100, 3000000) sp",
    );
  });

  test("tells pages and their sizes apart", () => {
    expect(
      sameGlyphs(stream(base), { ...stream(base), pages: [{ items: base }, { items: [] }] }),
    ).toBe(false);
    expect(
      sameGlyphs(stream(base), { ...stream(base), size: { width: 595.3, height: 841.9 } }),
    ).toBe(false);
  });

  test("says what kind of difference comes first", () => {
    const change = (i: number, to: Partial<ReferenceItem>) =>
      stream(base.map((item, j) => (j === i ? ({ ...item, ...to } as ReferenceItem) : item)));
    const kindOf = (other: GlyphStream) => difference(stream(base), other)?.kind;
    expect(kindOf(stream(base))).toBeUndefined();
    expect(kindOf(change(2, { code: 111 }))).toBe("glyph");
    expect(kindOf(change(2, { font: "cmbx10" }))).toBe("glyph");
    expect(kindOf(change(2, { h: 400_000 }))).toBe("position");
    expect(kindOf(change(3, { width: 1 }))).toBe("rule");
    expect(kindOf(change(0, { text: "papersize=1pt,1pt" }))).toBe("special");
    expect(kindOf(stream([...base.slice(0, 1), ...base.slice(2)]))).toBe("glyph");
    expect(kindOf(stream(base.slice(0, 4)))).toBe("count");
    expect(kindOf({ ...stream(base), pages: [{ items: base }, { items: [] }] })).toBe("pages");
    expect(kindOf({ ...stream(base), size: { width: 1, height: 1 } })).toBe("size");
    expect(kindOf(stream(base.map((item, j) => (j === 3 ? glyph(1, 1) : item))))).toBe("kind");
  });

  test("says where the second stream parts from the first, markers and all", () => {
    // The probe reads the field whose begin marker comes last before this item as the one that
    // moved the page, so the item is the second stream's own, found among its markers.
    const marker: ReferenceItem = { kind: "special", h: 100, v: 3_000_000, text: "rt:b:c1-1" };
    const moved = { ...base[4], h: 600_100 } as ReferenceItem;
    const other = stream([
      ...base.slice(0, 2),
      marker,
      base[2] as ReferenceItem,
      base[3] as ReferenceItem,
      moved,
    ]);
    const found = difference(stream(base), other);
    expect(found?.kind).toBe("position");
    expect(found?.page).toBe(0);
    expect(found?.item).toBe(moved);
    expect(other.pages[0]?.items.indexOf(found?.item as ReferenceItem)).toBe(5);
    // A page with fewer items gives its last; a page more or fewer gives no place.
    const short = stream(base.slice(0, 4));
    expect(difference(stream(base), short)?.item).toBe(base[3]);
    expect(difference(stream(base), { ...stream(base), pages: [] })?.page).toBeUndefined();
  });

  test("lists a special by its command", () => {
    const commands = [
      "pdf:image bbox 0 0 1 1 (invented.png)",
      "papersize=614.295pt,794.97pt",
      "color push rgb 1 0 0",
      "x:gsave",
      "rt:b:header.first",
      "ps:SDict begin",
    ].flatMap((text) => specialCommand({ kind: "special", h: 0, v: 0, text }));
    expect(commands).toEqual(["pdf:image", "papersize=", "color", "x:gsave", "rt:b", "ps:"]);
  });
});

// These run the real engine and need `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("the reference compile", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  let tree: ReturnType<typeof readTree>;
  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    tree = readTree(manifest.files, manifest.fonts);
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
  }, 60_000);

  const take = (files: Record<string, string | Uint8Array>): Intake => {
    const bytes = zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, data]) => [
          name,
          typeof data === "string" ? strToU8(data) : data,
        ]),
      ),
    );
    const taken = intake({ name: "invented.zip", bytes }, { tree });
    if (isRefusal(taken)) throw new Error(`refused at intake: ${taken.message}`);
    return taken;
  };
  const made = (result: Reference | Refusal): Reference => {
    if (isRefusal(result)) throw new Error(`refused: ${result.message} ${result.name ?? ""}`);
    return result;
  };
  const textOf = (result: Reference) =>
    result.pages
      .flatMap((page) => page.items)
      .map((item) => (item.kind === "glyph" ? (item.text ?? "") : ""))
      .join("");

  const PDFTEX = String.raw`\documentclass{inventedcv}
\usepackage[a4paper,margin=2cm]{geometry}
\begin{document}
\cvname{Quill Invented}
Invented experience at an invented place.
\end{document}
`;
  const CLS = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{inventedcv}
\LoadClass{article}
\newcommand{\cvname}[1]{{\Large\bfseries #1}\par}
`;

  test("compiles an invented pdfTeX document to a reference", async () => {
    const result = made(
      await reference(session, fonts, take({ "cv/cv.tex": PDFTEX, "inventedcv.cls": CLS })),
    );
    expect(result.engine).toBe("pdftex");
    expect(result.pages).toHaveLength(1);
    expect(textOf(result)).toContain("QuillInvented");
    expect(textOf(result)).toContain("Inventedexperienceataninventedplace.");
    expect(result.size.width).toBeCloseTo(597.51, 1);
    expect(result.fonts.tex).toEqual(expect.arrayContaining(["cmbx12", "cmr10"]));
    expect(result.specials).toContain("papersize=");
    expect(result.passes).toHaveLength(2);
    expect(result.warnings).toEqual([]);
    expect(result.bibliographyLeftOut).toBe(false);
    // The same document compiled again sets the same glyphs.
    const again = made(
      await reference(session, fonts, take({ "cv/cv.tex": PDFTEX, "inventedcv.cls": CLS })),
    );
    expect(sameGlyphs(result, again)).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  }, 60_000);

  test("compiles an invented XeTeX document that asks fontspec for a font by name", async () => {
    const result = made(
      await reference(
        session,
        fonts,
        take({
          "cv.tex": String.raw`\documentclass{article}
\usepackage{fontspec}
\setmainfont{Roboto}
\newfontfamily\headingfont{Source Sans Pro}
\begin{document}
{\headingfont Invented Heading}
Invented text in Roboto.
\end{document}
`,
        }),
      ),
    );
    expect(result.engine).toBe("xetex");
    expect(result.fonts.native).toEqual(["Roboto-Regular.otf", "SourceSansPro-Regular.otf"]);
    expect(textOf(result)).toContain("InventedtextinRoboto.");
    expect(result.pages[0]?.items.some((item) => item.kind === "glyph" && item.native)).toBe(true);
  }, 60_000);

  test("refuses a document that needs a package the tree lacks, naming the package", async () => {
    const result = await reference(
      session,
      fonts,
      take({
        "cv.tex": `\\documentclass{article}\n\\usepackage{inventedmissingpkg}\n\\begin{document}Quillwort.\\end{document}\n`,
      }),
    );
    expect(result).toMatchObject({
      refused: true,
      reason: "package",
      name: "inventedmissingpkg",
      message: "This resume needs the package inventedmissingpkg, which this editor does not have.",
    });
    expect(isRefusal(result) && result.log).toContain("inventedmissingpkg.sty");
  }, 60_000);

  test("refuses a class the tree lacks, and a font, naming each", async () => {
    const cls = await reference(
      session,
      fonts,
      take({ "cv.tex": `\\documentclass{inventednocls}\n\\begin{document}x\\end{document}\n` }),
    );
    expect(cls).toMatchObject({ reason: "class", name: "inventednocls" });
    const font = await reference(
      session,
      fonts,
      take({
        "cv.tex": `\\documentclass{article}\n\\usepackage{fontspec}\n\\setmainfont{Invented Grotesk}\n\\begin{document}x\\end{document}\n`,
      }),
    );
    expect(font).toMatchObject({
      reason: "font",
      message: "This resume needs the font Invented Grotesk, which this editor does not have.",
    });
  }, 60_000);

  const PHOTO = String.raw`\documentclass{article}
\usepackage{graphicx}
\newcommand{\photo}{\includegraphics[width=1cm]{\photofile}}
\newcommand{\photofile}{portrait}
\begin{document}
Invented before \includegraphics[width=2cm]{photos/badge.png} and after.
\photo\ \includegraphics{logo.pdf}
\end{document}
`;
  const png = new Uint8Array([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...[0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 20, 8, 0, 0, 0, 0],
    ...[0, 0, 0, 0],
  ]);
  /** A PDF's page of the given box, which is all the intake reads of one. */
  const pdfOf = (box: string) =>
    strToU8(`%PDF-1.4\n1 0 obj\n<< /Type /Page /MediaBox [${box}] >>\nendobj\n%%EOF\n`);

  for (const engine of ["pdftex", "xetex"] as const)
    test(`stands in for images on ${engine}, and its PDF is made with them and without them in it`, async () => {
      const source =
        engine === "xetex"
          ? PHOTO.replace("{graphicx}", "{graphicx}\n\\usepackage{fontspec}")
          : PHOTO;
      const taken = take({ "cv.tex": source, "photos/badge.png": png });
      expect(taken.engine).toBe(engine);
      const result = made(await reference(session, fonts, taken));
      // The class's photo, named through a macro, ran into graphicx as the compile did.
      expect(result.images).toEqual([
        { name: "portrait", path: "portrait.png", kind: "png", missing: true },
      ]);
      expect(result.specials).toContain("pdf:image");
      const images = [...taken.images.replaced, ...result.images].map((image) => image.path);
      const pdf = session.pdf("import", { images });
      expect(pdf.error).toBeUndefined();
      expect(pdf.ok).toBe(true);
      // Without the list, or with another file in it, the PDF is refused as it always was.
      expect(session.pdf("import").error).toMatch(/pdf:(image|epdf)/);
      expect(session.pdf("import", { images: ["other.png"] }).ok).toBe(false);
    }, 60_000);

  test("compiles a document written for pdfTeX's PDF mode, its drivers and pdfx taken for DVI", async () => {
    const drivers = take({
      "cv.tex": String.raw`\documentclass{article}
\usepackage[pdftex]{graphicx}
\usepackage[pdftex]{xcolor}
\usepackage[pdftex,colorlinks]{hyperref}
\begin{document}
Invented \textcolor{blue}{text} \href{https://example.com}{link} \includegraphics[width=1cm]{photos/badge.png}.
\end{document}
`,
      "photos/badge.png": png,
    });
    const result = made(await reference(session, fonts, drivers));
    expect(result.engine).toBe("pdftex");
    expect(result.specials).toEqual(expect.arrayContaining(["color", "pdf:image"]));
    expect(
      session.pdf("import", { images: drivers.images.replaced.map((image) => image.path) }).ok,
    ).toBe(true);
    const pdfx = made(
      await reference(
        session,
        fonts,
        take({
          "cv.tex": `\\documentclass{article}\n\\usepackage[a-1b]{pdfx}\n\\begin{document}Invented \\href{https://example.com}{text}.\\end{document}\n`,
        }),
      ),
    );
    expect(pdfx.engine).toBe("pdftex");
    expect(textOf(pdfx)).toContain("Inventedtext.");
  }, 60_000);

  test("stands in for an image graphicx cannot size at the size the tree's has", async () => {
    const logo = new Uint8Array([
      ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      ...[0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 144, 0, 0, 0, 72, 8, 0, 0, 0, 0],
      ...[0, 0, 0, 0],
    ]);
    const taken = take({
      "cv.tex": String.raw`\documentclass{article}
\usepackage{graphicx}
\newcommand{\logo}{invented-logo.png}
\begin{document}
Invented \includegraphics{\logo} logo.
\end{document}
`,
    });
    const result = made(
      await reference(session, fonts, taken, {
        treeImage: (name) => (name === "invented-logo.png" ? logo : undefined),
      }),
    );
    expect(result.images).toEqual([
      { name: "invented-logo.png", path: "invented-logo.png", kind: "png", tree: true },
    ]);
    // The logo is 144 by 72 pixels at 72 dots per inch: two inches wide, where 1 by 1 would be
    // a point, so the text after it starts two inches, 144 bp, after the text before it.
    const glyphs = result.pages[0]?.items.filter((item) => item.kind === "glyph") ?? [];
    const before = glyphs.find((glyph) => glyph.text === "d");
    const after = glyphs.find((glyph) => glyph.text === "l");
    expect(((after?.h ?? 0) - (before?.h ?? 0)) / 65536).toBeGreaterThan(144);
  }, 60_000);

  test("gives back the files it compiled with, so that a document compiles as it did", async () => {
    const logo = new Uint8Array([
      ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      ...[0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 144, 0, 0, 0, 72, 8, 0, 0, 0, 0],
      ...[0, 0, 0, 0],
    ]);
    const main = String.raw`\documentclass{article}
\usepackage{graphicx}
\newcommand{\logo}{invented-logo.png}
\begin{document}
Invented \includegraphics{\logo} logo.
\end{document}
`;
    const taken = take({ "cv.tex": main });
    const treeImage = (name: string) => (name === "invented-logo.png" ? logo : undefined);
    const result = made(await reference(session, fonts, taken, { treeImage }));
    const files = referenceFiles(taken, result, { treeImage });
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        "invented-logo.png",
        "invented-logo.xbb",
        ...Object.keys(COMPATIBILITY.pdftex),
      ]),
    );
    const again = await compileLikeReference(session, fonts, taken, result, taken.main.bytes, {
      treeImage,
    });
    if (isRefusal(again)) throw new Error(again.message);
    expect(sameGlyphs(result, again.stream)).toBe(true);
    const changed = await compileLikeReference(
      session,
      fonts,
      taken,
      result,
      new TextEncoder().encode(main.replace("Invented", "Changed")),
      { treeImage },
    );
    if (isRefusal(changed)) throw new Error(changed.message);
    expect(difference(result, changed.stream)?.kind).toBe("glyph");
    const stopped = await compileLikeReference(
      session,
      fonts,
      taken,
      result,
      new TextEncoder().encode(main.replace("} logo.", "} \\inventedundefined.")),
    );
    expect(stopped).toMatchObject({
      refused: true,
      reason: "stopped",
      name: "\\inventedundefined",
    });
  }, 60_000);

  test("goes on without a bibliography it has no .bbl for, and says so", async () => {
    const result = made(
      await reference(
        session,
        fonts,
        take({
          "cv.tex": String.raw`\documentclass{article}
\usepackage{biblatex}
\addbibresource{invented.bib}
\begin{document}
Invented \cite{invented}.
\printbibliography
\end{document}
`,
          "invented.bib": "@misc{invented, title={Invented}}",
        }),
      ),
    );
    expect(result.bibliographyLeftOut).toBe(true);
    // Two: the second pass changes only biblatex's note of the .bbl's checksum, which sets no
    // page, so the third its log asks for, for Biber, is not run (decision 0068).
    expect(result.passes).toHaveLength(2);
  }, 60_000);

  test("runs a document again on XeTeX when pdfTeX will not do", async () => {
    const result = made(
      await reference(
        session,
        fonts,
        take({
          "cv.tex": `\\documentclass{inventedxecv}\n\\begin{document}Invented text.\\end{document}\n`,
          // A class that loads fontspec through a name the source reading cannot follow.
          "inventedxecv.cls": "\\LoadClass{article}\n\\def\\x{fontspec}\n\\RequirePackage{\\x}",
        }),
      ),
    );
    expect(result.engine).toBe("xetex");
  }, 60_000);

  /** The distance in points from the first glyph of `from` to the first of `to` after it. */
  const gap = (result: Reference, from: string, to: string) => {
    const glyphs = result.pages[0]?.items.flatMap((item) => (item.kind === "glyph" ? [item] : []));
    const before = glyphs?.find((glyph) => glyph.text === from);
    const after = glyphs?.find((glyph) => glyph.text === to && glyph.h > (before?.h ?? 0));
    return ((after?.h ?? 0) - (before?.h ?? 0)) / 65536;
  };

  for (const engine of ["pdftex", "xetex"] as const)
    test(`tells a coloured heading and a photo apart on ${engine}${engine === "pdftex" ? ", and the same body marked and compiled from its format the same" : ""}`, async () => {
      const xetex = engine === "xetex" ? "\\usepackage{fontspec}\n" : "";
      const preamble = `\\documentclass{article}\n${xetex}\\usepackage{graphicx}\n\\usepackage{xcolor}\n\\usepackage[colorlinks]{hyperref}`;
      const body = (heading: string, box: string, marks = false) =>
        [
          "\\begin{document}",
          `\\section*{${marks ? "\\special{rt:b:heading}" : ""}${heading}${marks ? "\\special{rt:e:heading}" : ""}}`,
          `\\noindent\\makebox[3cm][l]{${box}}Invented \\href{https://invented.example}{text}.`,
          "\\end{document}",
          "",
        ].join("\n");
      const photo = "\\raisebox{0pt}[0pt][0pt]{\\includegraphics[width=2cm]{photo}}";
      const of = async (heading: string, box: string) =>
        made(
          await reference(
            session,
            fonts,
            take({ "cv.tex": `${preamble}\n${body(heading, box)}`, "photo.png": png }),
          ),
        );
      const plain = await of("Invented Heading", photo);
      expect(plain.engine).toBe(engine);
      const coloured = await of("\\textcolor{red}{Invented} Heading", photo);
      expect(sameGlyphs(plain, coloured)).toBe(false);
      expect(firstDifference(plain, coloured)).toMatch(/a special color/);
      const empty = await of("Invented Heading", "");
      expect(sameGlyphs(plain, empty)).toBe(false);
      // The same body, marked as the editor marks it and compiled from a format of the preamble,
      // sets the same glyphs, rules and specials, the first shipout's among them, which each job
      // of a format puts back on its page (decision 0023).
      // XeTeX dumps no format with native fonts loaded, as fontspec loads them; its templates
      // declare theirs (decision 0014), and the unit tests above take its first shipout's.
      if (engine === "xetex") return;
      const taken = take({ "cv.tex": `${preamble}\n${body("x", photo)}`, "photo.png": png });
      const files = {
        ...COMPATIBILITY[engine],
        ...Object.fromEntries(
          Object.entries(taken.files).filter(([path]) => path.startsWith("photo.")),
        ),
      };
      expect(session.dump(engine, `inventedpre${engine}`, preamble, COMPATIBILITY[engine]).ok).toBe(
        true,
      );
      session.forget("marked");
      const compiled = session.compile(
        engine,
        `inventedpre${engine}`,
        body("Invented Heading", photo, true),
        { job: "marked", files, maxPasses: 3 },
      );
      expect(compiled.error).toBeUndefined();
      const marked = await glyphStream(fonts, compiled.output ?? new Uint8Array());
      expect(marked.specials).toContain("rt:b");
      // xcolor's black at the first shipout, which a body from a format once lacked, is in both.
      const blacks = (stream: GlyphStream) =>
        stream.pages
          .flatMap((page) => page.items)
          .filter((item) => item.kind === "special" && item.text === "color push gray 0").length;
      expect(blacks(marked)).toBe(blacks(plain));
      expect(firstDifference(plain, marked)).toBeUndefined();
    }, 60_000);

  test("tells XeTeX's fake bold, fake slant and font colour apart", async () => {
    const of = async (features: string) =>
      made(
        await reference(
          session,
          fonts,
          take({
            "cv.tex": `\\documentclass{article}\n\\usepackage{fontspec}\n\\setmainfont{Roboto-Regular.otf}${features}\n\\begin{document}Invented text.\\end{document}\n`,
          }),
        ),
      );
    const plain = await of("");
    for (const features of ["[FakeBold=2]", "[FakeSlant=0.3]", "[Color=FF0000]"]) {
      const drawn = await of(features);
      expect(sameGlyphs(plain, drawn), features).toBe(false);
      expect(sameGlyphs(drawn, await of(features)), features).toBe(true);
    }
  }, 60_000);

  test("stands in on XeTeX for a picture named through a macro with its extension, which it could not load", async () => {
    for (const name of ["portrait.png", "portrait.jpg", "portrait.pdf"]) {
      const result = made(
        await reference(
          session,
          fonts,
          take({
            "cv.tex": String.raw`\documentclass{article}
\usepackage{fontspec}
\usepackage{graphicx}
\newcommand{\photofile}{${name}}
\begin{document}
Invented \includegraphics[width=1cm]{\photofile} text.
\end{document}
`,
          }),
        ),
      );
      expect(result.engine).toBe("xetex");
      expect(result.images, name).toEqual([
        { name, path: name, kind: name.endsWith(".pdf") ? "pdf" : "png", missing: true },
      ]);
    }
  }, 60_000);

  test("stands in on XeTeX for a tree's image a macro names, so that no image of the tree is shown", async () => {
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    const treeImage = treeImages(manifest.files, (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    const taken = take({
      "cv.tex": String.raw`\documentclass{article}
\usepackage{fontspec}
\usepackage{graphicx}
\newcommand{\flag}{EuropeFlagBW.pdf}
\begin{document}
Invented \includegraphics[width=1cm]{\flag} text.
\end{document}
`,
    });
    const result = made(await reference(session, fonts, taken, { treeImage }));
    expect(result.images).toEqual([
      { name: "EuropeFlagBW.pdf", path: "EuropeFlagBW.pdf", kind: "pdf", tree: true },
    ]);
    const shown = result.pages
      .flatMap((page) => page.items)
      .flatMap((item) =>
        item.kind === "special" && /^pdf:image/.test(item.text) ? [item.text] : [],
      );
    expect(shown).toHaveLength(1);
    expect(shown[0]).not.toMatch(/\/texmf/);
    expect(session.pdf("import", { images: result.images.map((image) => image.path) }).ok).toBe(
      true,
    );
  }, 60_000);

  test("sizes two images of one name on pdfTeX by the one graphicx takes", async () => {
    const result = made(
      await reference(
        session,
        fonts,
        take({
          "cv.tex":
            "\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\noindent Invented\\includegraphics{logo}Quill.\n\\end{document}\n",
          "logo.pdf": pdfOf("0 0 200 100"),
          "logo.png": png,
        }),
      ),
    );
    // graphicx takes logo.pdf, 200 bp wide: 199.26 pt, less a hair of kerning either way.
    expect(gap(result, "d", "Q")).toBeGreaterThan(199);
  }, 60_000);

  test("reads what a path above the main file's folder names, at its size", async () => {
    const result = made(
      await reference(
        session,
        fonts,
        take({
          "src/cv.tex": String.raw`\documentclass{article}
\usepackage{graphicx}
\graphicspath{{../img/}}
\begin{document}
\noindent Invented\includegraphics{photo.png}Quill.
\end{document}
`,
          "img/photo.png": png,
        }),
      ),
    );
    expect(result.images).toEqual([]);
    // The photo is 40 by 20 pixels, 40 bp wide, where the 1 by 1 of a missing one would be 1 bp.
    expect(gap(result, "d", "Q")).toBeGreaterThan(40);
  }, 60_000);

  test("compiles a document that sets \\pdfoutput=1 for DVI", async () => {
    const result = made(
      await reference(
        session,
        fonts,
        take({
          "cv.tex":
            "\\pdfoutput=1\n\\documentclass{article}\n\\begin{document}Invented text.\\end{document}\n",
        }),
      ),
    );
    expect(result.engine).toBe("pdftex");
    expect(textOf(result)).toContain("Inventedtext.");
  }, 60_000);

  test("refuses a document that shows an image in a format with no stand-in, and not one that does not", async () => {
    const eps = "%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 200 100\n";
    for (const [name, shows] of [
      ["figure.eps", "\\includegraphics{figure}"],
      ["figure.eps", "\\includegraphics{figure.eps}"],
      ["chart.eps", "\\includegraphics{chart.eps}"],
    ] as const)
      expect(
        await reference(
          session,
          fonts,
          take({
            "cv.tex": `\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\nInvented ${shows}.\n\\end{document}\n`,
            "figure.eps": eps,
          }),
        ),
        shows,
      ).toMatchObject({
        reason: "image",
        name,
        message: `This resume shows the image ${name}, in a format this editor does not take: it takes PNG, JPEG and PDF images.`,
      });
    const unused = await reference(
      session,
      fonts,
      take({
        "cv.tex":
          "\\documentclass{article}\n\\usepackage{graphicx}\n\\newcommand{\\unused}{\\includegraphics{figure}}\n\\begin{document}Invented.\\end{document}\n",
        "figure.eps": eps,
      }),
    );
    expect(isRefusal(unused)).toBe(false);
  }, 60_000);

  test("refuses an upload holding a file of the job's name, or one it writes, unless the same", async () => {
    const main = "\\documentclass{article}\n\\begin{document}\\input{import}\\end{document}\n";
    expect(
      await reference(session, fonts, take({ "cv.tex": main, "import.tex": "Invented part." })),
    ).toMatchObject({
      reason: "intake",
      name: "import.tex",
      message:
        "This upload holds import.tex, whose name this editor gives its own copy of the resume. Rename it, and upload the resume again.",
    });
    const plain =
      "\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}Invented.\\end{document}\n";
    expect(
      await reference(session, fonts, take({ "cv.tex": plain, "graphics.cfg": "% invented" })),
    ).toMatchObject({ reason: "intake", name: "graphics.cfg" });
    expect(
      isRefusal(
        await reference(session, fonts, take({ "cv.tex": plain, "graphics.cfg": GRAPHICS_CFG })),
      ),
    ).toBe(false);
    expect(
      await reference(session, fonts, take({ "cv.tex": plain, "import.pdf": pdfOf("0 0 9 9") })),
    ).toMatchObject({ reason: "intake", name: "import.pdf" });
  }, 60_000);

  test("names a font whose long name fontspec's message wraps, and one asked for by its path", async () => {
    const asks = (font: string) =>
      take({
        "cv.tex": `\\documentclass{article}\n\\usepackage{fontspec}\n\\setmainfont{${font}}\n\\begin{document}x\\end{document}\n`,
      });
    expect(
      await reference(session, fonts, asks("Invented Grotesk Condensed Display Extra Wide")),
    ).toMatchObject({ reason: "font", name: "Invented Grotesk Condensed Display Extra Wide" });
    expect(await reference(session, fonts, asks("fonts/InventedGrotesk"))).toMatchObject({
      reason: "font",
      name: "InventedGrotesk",
    });
  }, 60_000);
});
