import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { EngineManifest } from "../src/engine/manifest";
import { ENGINE_DIR, engineAvailable } from "../src/engine/node";
import { environmentToken } from "./corpus-github";
import { type CorpusFile, firstCounters, type LiveDocument, Manifest } from "./corpus-manifest";
import {
  type CorpusSurvey,
  classOptions,
  familyInTree,
  fileInTree,
  fontsOf,
  optionValues,
  readSource,
  readTree,
  type SourceFile,
  surveyCorpus,
  surveyDocument,
  surveyTable,
  TREE_FAMILIES,
} from "./corpus-survey";

// Every document here is invented for these tests: invented classes, packages, fonts and filler
// that say so. Nothing is taken from a real resume or template.

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

describe("the tree", () => {
  test("indexes classes and packages under tex/, and fonts by name, whatever their extension", () => {
    expect(tree.styles.has("moderncv.cls")).toBe(true);
    expect(tree.styles.has("geometry.sty")).toBe(true);
    expect(tree.styles.has("inventeddoc.sty")).toBe(false);
    expect(fileInTree(tree, "Roboto-Regular")).toBe(true);
    expect(fileInTree(tree, "fonts/roboto-regular.ttf")).toBe(true);
    expect(fileInTree(tree, "Lato-Regular.ttf")).toBe(true);
    expect(fileInTree(tree, "Roboto-Thin")).toBe(false);
    expect(fileInTree(tree, "cmr10")).toBe(false);
  });

  test("takes a package whose folder has a namesake holding OpenType or TrueType files for a font package", () => {
    expect([...tree.fontPackages].sort()).toEqual(["lato", "roboto", "roboto-mono"]);
  });

  test("knows the tree's families by name, with style words and design sizes, and no other", () => {
    const full = readTree(
      Object.fromEntries(
        Object.values(TREE_FAMILIES).map((file) => [
          `/texlive/texmf-dist/fonts/opentype/x/${file}`,
          1,
        ]),
      ),
    );
    for (const name of [
      "Roboto",
      "roboto slab",
      "Roboto Light",
      "SourceSansPro-Bold",
      "Source Sans Pro Semibold Italic",
      "Font Awesome 5 Free Solid",
      "FontAwesome5Brands-Regular-400",
      "Latin Modern Roman",
      "LM Roman 12",
      "Lato",
      "IBM Plex Sans Text",
      "texgyretermes",
      "TeX Gyre Heros Cn Bold",
    ])
      expect(familyInTree(full, name), name).toBe(true);
    for (const name of ["Source Sans 3", "Invented Serif", "Robotoish", "Lato Condensed", "Arial"])
      expect(familyInTree(full, name), name).toBe(false);
  });

  test("takes a family for the tree's only when the tree holds its file", () => {
    expect(familyInTree(tree, "Roboto Bold")).toBe(true);
    expect(familyInTree(tree, "Source Sans Pro")).toBe(false);
  });
});

describe("reading a source as the engines take it", () => {
  test("leaves out comments, \\iffalse blocks up to their \\else, and comment environments", () => {
    const reading = readSource(
      [
        "\\usepackage{kept} % \\usepackage{commented}",
        "\\iffalse \\usepackage{skipped} \\ifnum1=1 nested \\fi \\else \\usepackage{elsekept} \\fi",
        "\\begin{comment} \\usepackage{hidden} \\end{comment}",
        "\\iftrue \\usepackage{truekept} \\else \\usepackage{truedropped} \\fi",
      ].join("\n"),
    );
    for (const name of ["kept", "elsekept", "truekept"]) expect(reading.live).toContain(name);
    for (const name of ["commented", "skipped", "hidden", "truedropped"])
      expect(reading.live).not.toContain(name);
    expect(reading.guarded).toBe(false);
  });

  test("reads each guard on the engine as each engine takes it", () => {
    const reading = readSource(
      [
        "\\ifxetex \\usepackage{onxetex} \\else \\usepackage{onpdftex} \\fi",
        "\\ifPDFTeX \\usepackage{pdfonly} \\fi",
        "\\iftutex \\usepackage{unicodeonly} \\fi",
        "\\unless\\ifluatex \\usepackage{notlua} \\fi",
        "\\ifdefined\\XeTeXversion \\usepackage{definedxe} \\fi",
        "\\ifx\\directlua\\undefined \\usepackage{nolua} \\else \\usepackage{lua} \\fi",
        "\\newif\\ifxetexorluatex \\ifxetexorluatex \\usepackage{either} \\else \\usepackage{neither} \\fi",
      ].join("\n"),
    );
    expect(reading.guarded).toBe(true);
    const has = (view: string, name: string) => new RegExp(`\\{${name}\\}`).test(view);
    for (const name of ["onpdftex", "pdfonly", "notlua", "nolua", "neither"]) {
      expect(has(reading.pdftex, name), name).toBe(true);
      expect(has(reading.xetex, name), name).toBe(
        !["onpdftex", "pdfonly", "neither"].includes(name),
      );
    }
    for (const name of ["onxetex", "unicodeonly", "definedxe", "either"]) {
      expect(has(reading.pdftex, name), name).toBe(false);
      expect(has(reading.xetex, name), name).toBe(true);
    }
    expect(has(reading.pdftex, "lua")).toBe(false);
    expect(has(reading.xetex, "lua")).toBe(false);
    for (const name of ["onxetex", "onpdftex", "lua"]) expect(has(reading.live, name)).toBe(true);
    // A probe is the guard's own, never a need of the branch taken.
    expect(reading.pdftex).not.toContain("\\directlua");
  });

  test("pairs each \\fi with its conditional, whatever the macro-style conditionals around it", () => {
    const reading = readSource(
      [
        "\\newif\\ifshowphoto",
        "\\def\\ifinvented#1{#1}",
        "\\let\\ifmine\\iftrue",
        "\\ifxetex",
        "  \\ifthenelse{\\equal{a}{b}}{one}{two}",
        "  \\ifbool{x}{three}{four}",
        "  \\ifdef\\invented{five}{six}",
        "  \\ifinvented{seven}",
        "  \\ifshowphoto{\\usepackage{photo}}\\fi",
        "  \\ifnum1=1 \\ifdim1pt=1pt \\fi \\fi",
        "  \\usepackage{onxetex}",
        "\\else",
        "  \\usepackage{onpdftex}",
        "\\fi",
        "\\usepackage{after}",
      ].join("\n"),
    );
    expect(reading.pdftex).toContain("{onpdftex}");
    expect(reading.pdftex).not.toContain("{onxetex}");
    expect(reading.pdftex).toContain("{after}");
    expect(reading.xetex).toContain("{onxetex}");
    expect(reading.xetex).not.toContain("{onpdftex}");
    expect(reading.xetex).toContain("{after}");
  });

  test("does not take a guard in code TeX never reads for guarding", () => {
    expect(readSource("\\iffalse \\ifxetex \\usepackage{a} \\fi \\fi").guarded).toBe(false);
  });

  test("reads a conditional whose value it is given as every engine takes it", () => {
    const reading = readSource(
      "\\if@invented \\usepackage{on} \\else \\usepackage{off} \\fi \\unless\\if@other \\usepackage{unless} \\fi",
      new Map([
        ["if@invented", false],
        ["if@other", true],
      ]),
    );
    expect(reading.live).toContain("{off}");
    expect(reading.live).not.toContain("{on}");
    expect(reading.live).not.toContain("{unless}");
  });
});

describe("a class's options", () => {
  const cls = [
    "\\newif\\if@invented",
    "\\newif\\if@photo",
    "\\newif\\if@elsewhere",
    "\\newif\\if@booleaned",
    "\\DeclareOption{invented}{\\@inventedtrue}",
    "\\DeclareOption{nophoto}{\\@photofalse}",
    "\\DeclareOption{photo}{\\@phototrue}",
    "\\DeclareOption{elsewhere}{\\@elsewheretrue}",
    "\\DeclareOption{booleaned}{\\@booleanedtrue}",
    "\\ExecuteOptions{photo}",
    "\\ProcessOptions\\relax",
    "\\@elsewheretrue",
    "\\setboolean{@booleaned}{true}",
  ].join("\n");

  test("are read from \\documentclass, without their values", () => {
    expect(classOptions("\\documentclass[10pt, a4paper,invented,key=value]{cls}")).toEqual([
      "10pt",
      "a4paper",
      "invented",
      "key",
    ]);
    expect(classOptions("\\documentclass{cls}")).toEqual([]);
  });

  test("give the conditionals only they set what the options run leave them", () => {
    const values = optionValues(
      [
        { text: cls, isClass: true },
        { text: "\\documentclass[nophoto]{cls}", isClass: false },
      ],
      ["nophoto"],
    );
    expect(Object.fromEntries(values)).toEqual({ "if@invented": false, "if@photo": false });
    expect(optionValues([{ text: cls, isClass: true }], ["invented"]).get("if@invented")).toBe(
      true,
    );
    expect(optionValues([{ text: cls, isClass: true }], []).get("if@photo")).toBe(true);
  });

  test("are a class's only, not a package's", () => {
    expect(optionValues([{ text: cls, isClass: false }], []).size).toBe(0);
  });
});

describe("fonts fontspec loads", () => {
  test("by name, with the faces named after it", () => {
    expect(
      fontsOf(
        [
          "\\setmainfont{Invented Serif}",
          "\\setsansfont[BoldFont={* Heavy}]{Invented Sans}",
          "\\newfontfamily\\headingfont{Roboto}[Scale=1.1]",
          "\\newfontfamily{\\iconfont}{Invented Icons}",
          "\\setmainfont{\\builtname}",
        ].join("\n"),
      ),
    ).toEqual({
      families: [
        "Invented Serif",
        "Invented Sans",
        "Invented Sans Heavy",
        "Roboto",
        "Invented Icons",
      ],
      files: [],
    });
  });

  test("by file: a name with an extension, Path= or Extension=, each face by its own name", () => {
    expect(
      fontsOf(
        [
          "\\newfontfamily\\headerfont[Path=\\@fontdir, UprightFont=*-Regular, BoldFont=*-Bold]{Roboto}",
          "\\newfontfamily\\FA[Path=fonts/]{InventedAwesome}",
          "\\setmainfont{Invented-Regular.ttf}[BoldFont=Invented-Bold.ttf]",
          "\\setsansfont[Extension=.otf, UprightFont=*-Light, FontFace={sb}{n}{Font=*-Semibold}]{InventedSans}",
        ].join("\n"),
      ),
    ).toEqual({
      families: [],
      files: [
        "Roboto-Regular",
        "Roboto-Bold",
        "InventedAwesome",
        "Invented-Regular.ttf",
        "Invented-Bold.ttf",
        "InventedSans-Light.otf",
        "InventedSans-Semibold.otf",
      ],
    });
  });

  test("by file whenever \\defaultfontfeatures gives a path", () => {
    expect(fontsOf("\\defaultfontfeatures{Path=fonts/}\\setmainfont{Invented}")).toEqual({
      families: [],
      files: ["Invented"],
    });
  });
});

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
    expect(lines[0]).toBe("|  | jake | awesome-cv | altacv | moderncv | europecv | other | all |");
    expect(lines.every((line) => line.startsWith("|") && line.endsWith("|"))).toBe(true);
    const row = (label: string) => lines.find((line) => line.startsWith(`| ${label} |`));
    expect(row("Documents surveyed")).toBe("| Documents surveyed | 2 | 0 | 0 | 0 | 0 | 1 | 3 |");
    expect(row("Skipped: not fetched, or changed on disk")).toBe(
      "| Skipped: not fetched, or changed on disk | 0 | 0 | 0 | 0 | 0 | 3 | 3 |",
    );
    expect(row("Engine: XeTeX")).toBe("| Engine: XeTeX | 1 | 0 | 0 | 0 | 0 | 0 | 1 |");
    expect(row("`inventedmissing`")).toBe("| `inventedmissing` | 1 | 0 | 0 | 0 | 0 | 1 | 2 |");
    expect(row("Needs a class the tree lacks")).toBe(
      "| Needs a class the tree lacks | 0 | 0 | 0 | 0 | 0 | 1 | 1 |",
    );
    expect(row("`article`")).toBe("| `article` | 2 | 0 | 0 | 0 | 0 | 0 | 2 |");
    expect(table).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  test("shows a name that would break the table as code", () => {
    const first = result.documents[0];
    if (!first) throw new Error("the corpus has no document surveyed");
    const table = surveyTable({
      documents: [{ ...first, needs: { ...first.needs, packages: ["a|b`c"] } }],
      skipped: [],
    });
    expect(table).toContain("| `a\\|b'c` |");
  });
});

describe("the token", () => {
  test("comes from GH_TOKEN, then GITHUB_TOKEN, when gh has none", () => {
    expect(environmentToken({ GH_TOKEN: "one", GITHUB_TOKEN: "two" })).toBe("one");
    expect(environmentToken({ GH_TOKEN: " ", GITHUB_TOKEN: "two" })).toBe("two");
    expect(environmentToken({})).toBeUndefined();
  });
});

// This reads the tree fetch-engine built, and needs `.engine/`.
describe.skipIf(!engineAvailable())("the family table", () => {
  const manifest = JSON.parse(
    readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
  ) as EngineManifest;
  const real = readTree(manifest.files);

  test("names the tree's files, and a family in every folder of the tree's OpenType and TrueType files", () => {
    for (const file of Object.values(TREE_FAMILIES))
      expect(fileInTree(real, file), file).toBe(true);
    const fonts = Object.keys(manifest.files).filter((path) =>
      /\/fonts\/(?:opentype|truetype)\/.*\.(?:otf|ttf)$/i.test(path),
    );
    const folderOf = (path: string) => path.split("/").at(-2) ?? "";
    const named = new Set(Object.values(TREE_FAMILIES));
    const covered = new Set(
      fonts.filter((path) => named.has(path.split("/").at(-1) ?? "")).map(folderOf),
    );
    expect([...new Set(fonts.map(folderOf))].filter((folder) => !covered.has(folder))).toEqual([]);
    for (const name of ["roboto", "lato", "sourcesanspro", "fontawesome5", "lmodern"])
      expect(real.fontPackages, name).toContain(name);
  });
});
