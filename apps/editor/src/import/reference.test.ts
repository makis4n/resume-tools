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
import { type Intake, intake } from "./intake";
import {
  firstDifference,
  type GlyphStream,
  type Reference,
  type ReferenceItem,
  reference,
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
      "page 1, item 2: code 110 of cmr10 at 655360 sp at (300000, 3000000) sp against code 111 of cmr10 at 655360 sp at (300000, 3000000) sp",
    );
  });

  test("ignores the editor's markers, and every other special", () => {
    const marked: ReferenceItem[] = [
      base[0] as ReferenceItem,
      { kind: "special", h: 100, v: 3_000_000, text: "rt:b:header.first" },
      { kind: "special", h: 100, v: 3_000_000, text: "rt:p:header.first:hsize=100pt" },
      ...base.slice(1, 3),
      { kind: "special", h: 400_000, v: 3_000_000, text: "rt:e:header.first" },
      ...base.slice(3),
      { kind: "special", h: 0, v: 0, text: "color push gray 0" },
    ];
    expect(sameGlyphs(stream(base), stream(marked))).toBe(true);
  });

  test("tells pages and their sizes apart", () => {
    expect(
      sameGlyphs(stream(base), { ...stream(base), pages: [{ items: base }, { items: [] }] }),
    ).toBe(false);
    expect(
      sameGlyphs(stream(base), { ...stream(base), size: { width: 595.3, height: 841.9 } }),
    ).toBe(false);
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
    tree = readTree(manifest.files);
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
  });

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
  });

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
  });

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
  });

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
    });

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
  });

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
  });

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
    expect(result.passes).toHaveLength(3);
  });

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
  });
});
