import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { readTree } from "../src/import/fonts";
import { environmentToken } from "./corpus-github";
import { type CorpusFile, firstCounters, type LiveDocument, Manifest } from "./corpus-manifest";
import {
  type CorpusSurvey,
  type SourceFile,
  shownName,
  surveyCorpus,
  surveyDocument,
  surveyTable,
  UNPRINTABLE,
} from "./corpus-survey";

// Every document here is invented for these tests: invented classes, packages, fonts and filler
// that say so. Nothing is taken from a real resume or template. How a source is read, and its
// fonts, is tested beside the reader, in `src/import/source.test.ts` and `src/import/fonts.test.ts`.

/** A word the invented bodies hold, which nothing the survey prints may show. */
const SECRET = "Quillwort";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const bytes = (text: string) => new TextEncoder().encode(text);

/** A small tree: a few classes and packages under `tex/`, and Roboto's and Lato's font files. */
const tree = readTree({
  "/texlive/texmf-dist/tex/latex/base/article.cls": 1,
  "/texlive/texmf-dist/tex/latex/geometry/geometry.sty": 1,
  "/texlive/texmf-dist/tex/latex/fontspec/fontspec.sty": 1,
  "/texlive/texmf-dist/tex/latex/hyperref/hyperref.sty": 1,
  "/texlive/texmf-dist/tex/latex/roboto/roboto.sty": 1,
  "/texlive/texmf-dist/tex/latex/roboto/roboto-mono.sty": 1,
  "/texlive/texmf-dist/fonts/opentype/google/roboto/Roboto-Regular.otf": 1,
  "/texlive/texmf-dist/fonts/opentype/google/roboto/Roboto-Bold.otf": 1,
  "/texlive/texmf-dist/tex/latex/lato/lato.sty": 1,
  "/texlive/texmf-dist/fonts/truetype/typoland/lato/Lato-Regular.ttf": 1,
  "/texlive/texmf-dist/tex/latex/amsfonts/amssymb.sty": 1,
  "/texlive/texmf-dist/fonts/type1/public/amsfonts/cm/cmr10.pfb": 1,
  "/texlive/texmf-dist/source/latex/invented/inventeddoc.sty": 1,
  "/texmf/texmf-dist/tex/latex/moderncv/moderncv.cls": 1,
});

/** An invented document of the given files, the first the main file, and what the survey reads. */
function invented(
  files: Record<string, string>,
  changes: Partial<LiveDocument> = {},
): [LiveDocument, SourceFile[]] {
  const entries = Object.entries(files);
  const doc: LiveDocument = {
    id: "other-0001",
    family: "other",
    repo: "example/example",
    repoId: 1,
    commit: "a".repeat(40),
    license: null,
    main: entries[0]?.[0] ?? "cv.tex",
    files: entries.map(([path, text]) => ({
      path,
      sha256: sha256(text),
      bytes: bytes(text).length,
    })),
    assets: [],
    images: 0,
    ...changes,
  };
  return [doc, entries.map(([path, text]) => ({ path, text }))];
}

/** A whole invented document around a preamble and a body. */
const whole = (preamble: string[], body: string[] = [`${SECRET} filler of an invented body.`]) =>
  [...preamble, "\\begin{document}", ...body, "\\end{document}", ""].join("\n");

const survey = (files: Record<string, string>, changes: Partial<LiveDocument> = {}) =>
  surveyDocument(...invented(files, changes), tree);

describe("a document", () => {
  test("names its class and packages and where each is, and the classes its class loads", () => {
    const row = survey({
      "cv.tex": whole([
        "\\documentclass[11pt]{inventedcv}",
        "\\usepackage{geometry, hyperref}",
        "\\usepackage{style/inventedstyle}",
        "\\RequirePackage{inventedmissing}",
      ]),
      "inventedcv.cls": "\\LoadClass{article}\\RequirePackage{geometry}\\LoadClass{inventedbase}",
      "style/inventedstyle.sty": "\\RequirePackage{hyperref}",
    });
    expect(row.class).toEqual({ name: "inventedcv", held: "document" });
    expect(row.baseClasses).toEqual([
      { name: "article", held: "tree" },
      { name: "inventedbase", held: "missing" },
    ]);
    expect(row.packages).toEqual([
      { name: "geometry", held: "tree" },
      { name: "hyperref", held: "tree" },
      { name: "inventedmissing", held: "missing" },
      { name: "style/inventedstyle", held: "document" },
    ]);
    expect(row.needs.classes).toEqual(["inventedbase"]);
    expect(row.needs.packages).toEqual(["inventedmissing"]);
    expect(row.size.files).toBe(3);
    expect(row.size.pages).toBeNull();
    expect(row.size.main).toBeGreaterThan(100);
  });

  test("needs XeTeX for fontspec or its commands, LuaTeX for Lua, and pdfTeX otherwise", () => {
    const engine = (...preamble: string[]) =>
      survey({ "cv.tex": whole(["\\documentclass{article}", ...preamble]) }).engine;
    expect(engine()).toBe("pdftex");
    expect(engine("\\usepackage{fontspec}")).toBe("xetex");
    expect(engine("\\setmainfont{Roboto}")).toBe("xetex");
    expect(engine('\\XeTeXlinebreaklocale "en"')).toBe("xetex");
    expect(engine("\\usepackage{fontspec}", "\\directlua{tex.print(1)}")).toBe("luatex");
    expect(engine("\\usepackage{luacode}")).toBe("luatex");
    expect(engine("\\ifxetex\\usepackage{fontspec}\\else\\usepackage{roboto}\\fi")).toBe("both");
    // Guarding one XeTeX package does not make a document that loads another either.
    expect(engine("\\usepackage{polyglossia}", "\\ifxetex\\usepackage{fontspec}\\fi")).toBe(
      "xetex",
    );
    // Guarding its Lua makes a XeTeX document one XeTeX runs.
    expect(engine("\\usepackage{fontspec}", "\\ifluatex\\directlua{x}\\fi")).toBe("xetex");
  });

  test("needs what the branches of its engine need: pdfTeX's when it is either", () => {
    const row = survey({
      "cv.tex": whole([
        "\\documentclass{article}",
        "\\iftutex \\setmainfont{Invented Serif} \\usepackage{inventedxe} \\else \\usepackage{roboto} \\usepackage{inventedpdf} \\fi",
      ]),
    });
    expect(row.engine).toBe("both");
    expect(row.fonts.loading).toEqual(["fontspec-name", "package"]);
    expect(row.fonts.families).toEqual([{ name: "Invented Serif", inTree: false }]);
    expect(row.needs.packages).toEqual(["inventedpdf"]);
    expect(row.needs.fonts).toEqual([]);
  });

  test("needs either engine when an \\ifnum asks which, as pandoc's templates do", () => {
    const row = survey({
      "cv.tex": whole([
        "\\documentclass{article}",
        "\\ifnum 0\\ifxetex 1\\fi\\ifluatex 1\\fi=0 % if pdftex",
        "  \\usepackage{lato}",
        "\\else % if luatex or xetex",
        "  \\usepackage{fontspec}",
        "  \\setsansfont{Invented Sans}",
        "\\fi",
      ]),
    });
    expect(row.engine).toBe("both");
    expect(row.fonts.families).toEqual([{ name: "Invented Sans", inTree: false }]);
    expect(row.needs.fonts).toEqual([]);
  });

  test("reads its class past a conditional the class passes as an argument", () => {
    const row = survey({
      "cv.tex": whole(["\\documentclass{inventedcv}"]),
      "inventedcv.cls": [
        "\\LoadClass{article}",
        "\\ifundef{\\iftutex}{\\newif\\iftutex}{}",
        "\\iftutex \\RequirePackage{fontspec} \\else \\RequirePackage{inventedpdf} \\fi",
        "\\RequirePackage{inventedlater}",
      ].join("\n"),
    });
    expect(row.engine).toBe("both");
    expect(row.needs.packages).toEqual(["inventedlater", "inventedpdf"]);
  });

  test("counts a package loaded only if present apart from what it needs", () => {
    const row = survey({
      "cv.tex": whole([
        "\\documentclass{article}",
        "\\IfFileExists{inventedicons.sty}{\\usepackage{inventedicons}}{\\usepackage{inventedelse}}",
        "\\IfFileExists{inventedboth.sty}{\\usepackage{inventedboth}}{}",
        "\\usepackage{inventedboth}",
        "\\IfFileExists{geometry.sty}{\\RequirePackage{geometry}}{}",
        "\\ifdef{\\inventedicon}{}{\\usepackage{inventedfallback}}",
      ]),
    });
    expect(row.needs.packages).toEqual(["inventedboth", "inventedelse", "inventedfallback"]);
    expect(row.optional).toEqual([
      { name: "geometry", held: "tree" },
      { name: "inventedicons", held: "missing" },
    ]);
    expect(row.packages.map((each) => each.name)).toContain("inventedicons");
    const table = surveyTable({ documents: [row], skipped: [] });
    expect(table).toContain("| `inventedicons` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |");
    expect(table).toContain("| `inventedboth` | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |");
    // One the tree has is loaded all the same, so it counts for the engine.
    const engine = survey({
      "cv.tex": whole([
        "\\documentclass{article}",
        "\\IfFileExists{fontspec.sty}{\\usepackage{fontspec}}{}",
      ]),
    }).engine;
    expect(engine).toBe("xetex");
  });

  test("names a class, package or font only when it is plainly a name", () => {
    for (const name of ["Source Sans Pro", "fonts/Roboto-Regular.otf", "x".repeat(64)])
      expect(shownName(name)).toBe(name);
    for (const name of ["", "a|b", "a`b", "line\nbreak", "x".repeat(65), "Invented & Co"])
      expect(shownName(name)).toBe(UNPRINTABLE);
    const row = survey({
      "cv.tex": whole([
        "\\documentclass{article}",
        "\\usepackage{fontspec}",
        "\\usepackage{!invented",
        `[Invented link](https://example.invalid/${SECRET})}`,
        "\\setmainfont{Invented",
        `![Invented image](https://example.invalid/pixel.png) ${SECRET}`,
        "===}",
        `\\setsansfont{${"Invented".repeat(9)}}`,
      ]),
    });
    expect(row.needs.packages).toEqual([UNPRINTABLE]);
    expect(row.needs.fonts).toEqual([UNPRINTABLE]);
    expect(row.fonts.families).toEqual([{ name: UNPRINTABLE, inTree: false }]);
    const table = surveyTable({ documents: [row], skipped: [] });
    const lines = table.trimEnd().split("\n");
    expect(lines.every((line) => line.startsWith("|") && line.endsWith("|"))).toBe(true);
    for (const text of [table, JSON.stringify(row)]) {
      expect(text).not.toContain("example.invalid");
      expect(text).not.toContain(SECRET);
    }
  });

  test("reads its class's options before it reads the class", () => {
    const cls = [
      "\\newif\\if@icons",
      "\\DeclareOption{icons}{\\@iconstrue}",
      "\\ProcessOptions\\relax",
      "\\if@icons \\RequirePackage{fontspec} \\newfontfamily\\icons{InventedIcons} \\fi",
    ].join("\n");
    const without = survey({
      "cv.tex": whole(["\\documentclass{inventedcv}"]),
      "inventedcv.cls": cls,
    });
    expect(without.engine).toBe("pdftex");
    expect(without.packages).toEqual([]);
    const withIcons = survey({
      "cv.tex": whole(["\\documentclass[icons]{inventedcv}"]),
      "inventedcv.cls": cls,
    });
    expect(withIcons.engine).toBe("xetex");
    expect(withIcons.needs.fonts).toEqual(["InventedIcons"]);
  });

  test("says how it loads its fonts, and which the tree lacks, a file it ships among them", () => {
    const row = survey(
      {
        "cv.tex": whole([
          "\\documentclass{article}",
          "\\usepackage{fontspec}",
          "\\usepackage{lato, fontawesome}",
          "\\setmainfont{Roboto Light}",
          "\\setsansfont{Invented Grotesk}",
          "\\newfontfamily\\icons[Path=fonts/]{InventedIcons}",
          "\\newfontfamily\\body[Path=fonts/, Extension=.ttf, UprightFont=*-Regular]{Roboto}",
        ]),
      },
      { assets: ["fonts/InventedIcons.ttf"] },
    );
    expect(row.engine).toBe("xetex");
    expect(row.fonts).toEqual({
      loading: ["fontspec-name", "fontspec-file", "package"],
      packages: ["fontawesome", "lato"],
      families: [
        { name: "Invented Grotesk", inTree: false },
        { name: "Roboto Light", inTree: true },
      ],
      files: [
        { name: "InventedIcons", inTree: false, shipped: true },
        { name: "Roboto-Regular.ttf", inTree: true, shipped: false },
      ],
    });
    expect(row.needs.fonts).toEqual(["Invented Grotesk", "InventedIcons"]);
    expect(row.needs.packages).toEqual(["fontawesome"]);
  });

  test("loads no font when it names none", () => {
    expect(survey({ "cv.tex": whole(["\\documentclass{article}"]) }).fonts.loading).toEqual([
      "default",
    ]);
  });

  test("counts its definitions in its main file and sources, and in its classes and styles", () => {
    const row = survey({
      "cv.tex": whole([
        "\\documentclass{inventedcv}",
        "\\newcommand{\\a}{a}\\renewcommand*{\\b}{b}\\providecommand\\c{c}",
        "\\def\\d{d}\\defaultfontfeatures{}% \\def\\commented{}",
        "\\input{parts}",
      ]),
      "parts.tex": "\\NewDocumentCommand{\\e}{m}{#1}\\newenvironment{f}{}{}",
      "inventedcv.cls": "\\DeclareDocumentCommand{\\g}{}{}\\def\\h{}\\newcommand\\i{}",
    });
    expect(row.macros).toEqual({ main: 6, styles: 3 });
  });

  test("needs a bibliography tool, shell escape and images when its code says so", () => {
    const needs = (files: Record<string, string>, images = 0) => survey(files, { images }).needs;
    const plain = needs({ "cv.tex": whole(["\\documentclass{article}"]) });
    expect(plain).toMatchObject({
      bibliography: false,
      shellEscape: null,
      images: false,
      includesGraphics: false,
      imageFiles: 0,
    });
    expect(
      needs({ "cv.tex": whole(["\\documentclass{article}", "\\addbibresource{a.bib}"]) })
        .bibliography,
    ).toBe(true);
    expect(
      needs({ "cv.tex": whole(["\\documentclass{article}"], ["\\bibliography{a}"]) }).bibliography,
    ).toBe(true);
    expect(
      needs({ "cv.tex": whole(["\\documentclass{article}", "\\usepackage{minted}"]) }).shellEscape,
    ).toBe("calls");
    expect(
      needs({ "cv.tex": whole(["\\documentclass{article}", "\\immediate\\write18{ls}"]) })
        .shellEscape,
    ).toBe("calls");
    expect(
      needs({ "cv.tex": `% !TEX options = -shell-escape\n${whole(["\\documentclass{article}"])}` })
        .shellEscape,
    ).toBe("hint");
    expect(
      needs({ "cv.tex": whole(["\\documentclass{article}"], ["\\includegraphics{photo}"]) }),
    ).toMatchObject({ images: true, includesGraphics: true });
    expect(needs({ "cv.tex": whole(["\\documentclass{article}"]) }, 2)).toMatchObject({
      images: true,
      includesGraphics: false,
      imageFiles: 2,
    });
    // A class that can show a photo does not make every document that loads it show one.
    expect(
      needs({
        "cv.tex": whole(["\\documentclass{inventedcv}"]),
        "inventedcv.cls": "\\def\\photo#1{\\includegraphics{#1}}",
      }).images,
    ).toBe(false);
  });

  test("reads nothing of a bibliography's entries", () => {
    const row = survey({
      "cv.tex": whole([
        "\\documentclass{article}",
        "\\usepackage{biblatex}",
        "\\addbibresource{refs.bib}",
      ]),
      "refs.bib": "@misc{a, note = {\\usepackage{frombib} \\setmainfont{FromBib}}}",
    });
    expect(row.packages.map((each) => each.name)).toEqual(["biblatex"]);
    expect(row.fonts.families).toEqual([]);
  });
});

describe("the corpus", () => {
  const documentOf = (id: string, text: string): LiveDocument => ({
    ...invented({ "cv.tex": text })[0],
    id,
    family: id.startsWith("jake") ? "jake" : "other",
    repo: `example/${id}`,
    repoId: Number(id.slice(-4)) + (id.startsWith("jake") ? 100 : 0),
  });
  const texts: Record<string, string> = {
    "jake-0001": whole(["\\documentclass{article}", "\\usepackage{inventedmissing}"]),
    "jake-0002": whole(["\\documentclass{article}", "\\usepackage{fontspec}"]),
    "other-0001": whole(["\\documentclass{inventedclass}", "\\usepackage{inventedmissing}"]),
    "other-0002": whole(["\\documentclass{article}"]),
    "other-0003": whole(["\\documentclass{article}"]),
    "other-0004": whole(["\\documentclass{article}"]),
  };
  const documents = Object.entries(texts).map(([id, text]) => documentOf(id, text));
  const manifest = Manifest.parse({
    version: 1,
    collected: "2026-09-26",
    counters: { ...firstCounters(), jake: 3, other: 6 },
    documents: [...documents, { id: "other-0005", family: "other", withdrawn: true }],
  });
  const report = {
    version: 1 as const,
    documents: documents.map(({ id, repo, commit }) => ({
      id,
      repo,
      commit,
      state: id === "other-0002" ? ("unavailable" as const) : ("fetched" as const),
    })),
  };
  const read = (doc: LiveDocument, _file: CorpusFile) =>
    doc.id === "other-0003"
      ? bytes("changed on disk")
      : doc.id === "other-0004"
        ? undefined
        : bytes(texts[doc.id] ?? "");
  const result: CorpusSurvey = surveyCorpus({ manifest, report, tree, read });

  test("surveys what the fetch marks fetched, and skips the rest and what changed on disk", () => {
    expect(result.documents.map((row) => row.id)).toEqual(["jake-0001", "jake-0002", "other-0001"]);
    expect(result.skipped).toEqual([
      { id: "other-0002", family: "other", state: "unavailable" },
      { id: "other-0003", family: "other", state: "unreadable" },
      { id: "other-0004", family: "other", state: "unreadable" },
    ]);
    const pending = surveyCorpus({ manifest, report: undefined, tree, read });
    expect(pending.documents).toEqual([]);
    expect(pending.skipped.every((each) => each.state === "pending")).toBe(true);
  });

  test("prints one table of documents per family and in all, naming no document's text", () => {
    const table = surveyTable(result);
    const lines = table.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "|  | jake | awesome-cv | altacv | moderncv | europecv | other | all | loaded only if present |",
    );
    expect(lines.every((line) => line.startsWith("|") && line.endsWith("|"))).toBe(true);
    // Nine cells on every line, the heading and its rule among them.
    expect(new Set(lines.map((line) => line.split("|").length))).toEqual(new Set([11]));
    const row = (label: string) => lines.find((line) => line.startsWith(`| ${label} |`));
    expect(row("Documents surveyed")).toBe("| Documents surveyed | 2 | 0 | 0 | 0 | 0 | 1 | 3 |  |");
    expect(row("Skipped: not fetched, or changed on disk")).toBe(
      "| Skipped: not fetched, or changed on disk | 0 | 0 | 0 | 0 | 0 | 3 | 3 |  |",
    );
    expect(row("Engine: XeTeX")).toBe("| Engine: XeTeX | 1 | 0 | 0 | 0 | 0 | 0 | 1 |  |");
    expect(row("`inventedmissing`")).toBe("| `inventedmissing` | 1 | 0 | 0 | 0 | 0 | 1 | 2 | 0 |");
    expect(row("Needs a class the tree lacks")).toBe(
      "| Needs a class the tree lacks | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  |",
    );
    expect(row("Lacks nothing: no class, package or font the tree lacks, nor LuaTeX")).toBe(
      "| Lacks nothing: no class, package or font the tree lacks, nor LuaTeX | 1 | 0 | 0 | 0 | 0 | 0 | 1 |  |",
    );
    expect(row("`article`")).toBe("| `article` | 2 | 0 | 0 | 0 | 0 | 0 | 2 |  |");
    expect(table).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  test("shows a name that could break the table, or quote a document, as unprintable", () => {
    const first = result.documents[0];
    if (!first) throw new Error("the corpus has no document surveyed");
    const odd = ["a|b`c", "invented\n[Invented link](https://example.invalid)", "x".repeat(65)];
    const table = surveyTable({
      documents: [{ ...first, needs: { ...first.needs, packages: odd, fonts: ["tab\there"] } }],
      skipped: [],
    });
    const lines = table.trimEnd().split("\n");
    expect(lines.every((line) => line.startsWith("|") && line.endsWith("|"))).toBe(true);
    expect(table).toContain("| `(unprintable name)` | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |");
    for (const text of ["a|b", "example.invalid", "x".repeat(65), "there"])
      expect(table).not.toContain(text);
  });
});

describe("the token", () => {
  test("comes from GH_TOKEN, then GITHUB_TOKEN, when gh has none", () => {
    expect(environmentToken({ GH_TOKEN: "one", GITHUB_TOKEN: "two" })).toBe("one");
    expect(environmentToken({ GH_TOKEN: " ", GITHUB_TOKEN: "two" })).toBe("two");
    expect(environmentToken({})).toBeUndefined();
  });
});
