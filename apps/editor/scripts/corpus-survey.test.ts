import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { EngineManifest } from "../src/engine/manifest";
import { ENGINE_DIR, engineAvailable } from "../src/engine/node";
import { bound, cpuMs, fastest } from "../src/test/timing";
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
  shownName,
  surveyCorpus,
  surveyDocument,
  surveyTable,
  TREE_FAMILIES,
  UNPRINTABLE,
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

  /** A tree holding the file of every family of the table. */
  const full = readTree(
    Object.fromEntries(
      Object.values(TREE_FAMILIES).map((file) => [
        `/texlive/texmf-dist/fonts/opentype/x/${file}`,
        1,
      ]),
    ),
  );

  test("knows the tree's families by name, with style words and design sizes, and no other", () => {
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

  test("reads style words in one pass, however a hostile name runs them together", () => {
    for (const name of ["Roboto Demibold Italic", "RobotoDemiboldDemibold", "Roboto Black 900"])
      expect(familyInTree(full, name), name).toBe(true);
    // A regular expression of the style words tried every way of splitting these before it
    // failed: hours for the digits, days for the `Demibold`s. The last is past the cap.
    for (const name of [
      `Roboto${"1".repeat(40)}x`,
      `Roboto ${"Demibold".repeat(15)}x`,
      `Roboto${"Demibold".repeat(24)}x`,
    ]) {
      let found: boolean | undefined;
      expect(cpuMs(() => (found = familyInTree(full, name)))).toBeLessThan(50);
      expect(found, name).toBe(false);
    }
    expect(familyInTree(full, `Roboto${" ".repeat(130)}`)).toBe(false);
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

  test("reads an \\ifnum or \\ifcase whose numbers ask the engine as each engine does", () => {
    const reading = readSource(
      [
        // pandoc's templates ask this way: 0, and 1 more on XeTeX or LuaTeX, is 0 on pdfTeX alone.
        "\\ifnum 0\\ifxetex 1\\fi\\ifluatex 1\\fi=0 % if pdftex",
        "  \\usepackage{onpdftex}",
        "\\else",
        "  \\usepackage{onxetex}",
        "\\fi",
        "\\unless\\ifnum 0\\ifxetex 1\\fi<1 \\usepackage{unlessxe}\\fi",
        "\\ifcase\\ifxetex 1\\else\\ifluatex 2\\else 0\\fi\\fi",
        "  \\usepackage{casepdf}\\or \\usepackage{casexe}\\or \\usepackage{caselua}\\fi",
        "\\ifcase 2\\ifxetex 1\\fi \\usepackage{zero}\\or \\usepackage{one}\\else \\usepackage{past}\\fi",
        "\\usepackage{after}",
      ].join("\n"),
    );
    expect(reading.guarded).toBe(true);
    const has = (view: string, name: string) => view.includes(`{${name}}`);
    for (const name of ["onpdftex", "casepdf", "past", "after"]) {
      expect(has(reading.pdftex, name), name).toBe(true);
      expect(has(reading.xetex, name), name).toBe(name === "past" || name === "after");
    }
    for (const name of ["onxetex", "unlessxe", "casexe"]) {
      expect(has(reading.pdftex, name), name).toBe(false);
      expect(has(reading.xetex, name), name).toBe(true);
    }
    for (const name of ["caselua", "zero", "one"]) {
      expect(has(reading.pdftex, name), name).toBe(false);
      expect(has(reading.xetex, name), name).toBe(false);
    }
    // One whose numbers do not ask the engine is read both ways.
    const plain = readSource(
      "\\ifnum\\value{page}>1 \\usepackage{a}\\else\\usepackage{b}\\fi\\ifnum 1=1 \\usepackage{c}\\fi",
    );
    expect(plain.guarded).toBe(false);
    for (const name of ["a", "b", "c"]) {
      expect(has(plain.pdftex, name), name).toBe(true);
      expect(has(plain.xetex, name), name).toBe(true);
    }
  });

  test("takes no conditional passed as an argument for one", () => {
    const reading = readSource(
      [
        "\\ifundef{\\iftutex}{\\newif\\iftutex}{}",
        "\\ifdef{ \\ifxetex }{}{}",
        "\\ifdefined\\ifluatex\\else\\newif\\ifluatex\\fi",
        "\\ifx\\ifPDFTeX\\undefined \\usepackage{inifx}\\fi",
        "\\expandafter\\ifx\\csname ifxetex\\endcsname\\relax \\usepackage{incsname}\\fi",
        "\\csname\\ifxetex\\endcsname",
        "\\iftutex \\usepackage{onxetex} \\else \\usepackage{onpdftex} \\fi",
        "\\usepackage{after}",
      ].join("\n"),
    );
    expect(reading.guarded).toBe(true);
    const has = (view: string, name: string) => view.includes(`{${name}}`);
    for (const name of ["inifx", "incsname", "after"]) {
      expect(has(reading.pdftex, name), name).toBe(true);
      expect(has(reading.xetex, name), name).toBe(true);
    }
    expect(has(reading.pdftex, "onpdftex")).toBe(true);
    expect(has(reading.pdftex, "onxetex")).toBe(false);
    expect(has(reading.xetex, "onxetex")).toBe(true);
    expect(has(reading.xetex, "onpdftex")).toBe(false);
    // One that starts a group but is not all of it is one, and TeX's own always are.
    const body = readSource(
      "\\newcommand{\\x}{\\ifxetex\\usepackage{inxe}\\else\\usepackage{inpdf}\\fi}{\\iffalse}\\fi\\usepackage{after}",
    );
    expect(has(body.pdftex, "inpdf") && has(body.pdftex, "after")).toBe(true);
    expect(has(body.pdftex, "inxe")).toBe(false);
    expect(has(body.xetex, "inxe") && has(body.xetex, "after")).toBe(true);
  });

  test("reads a source in time linear in its length, however deep its conditionals nest", () => {
    // Guards left open, each asking whether the walk was in dead code of all those under it, made
    // reading them take time that grew as the square of their number.
    const hostile = (bytes: number) =>
      "\\ifxetex ".repeat(bytes / 18) + "\\ifnum 0\\ifxetex 1\\fi=0 ".repeat(bytes / 50);
    const small = hostile(20_000);
    const large = hostile(200_000);
    const [short = 0, long = 0] = fastest([() => readSource(small), () => readSource(large)], 3);
    expect(long).toBeLessThan(bound(20, short));
    expect(long).toBeLessThan(2_000);
  }, 60_000);

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

  test("are read in time linear in the declarations, defaults and options", () => {
    const letters = (i: number) => {
      let name = "";
      for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
        name = String.fromCharCode(97 + ((n - 1) % 26)) + name;
      return name;
    };
    // A class declaring each conditional and an option that sets it, and running every option
    // ten times over in \ExecuteOptions: matching each against each took time that grew as the
    // cube of their number.
    const hostile = (declared: number) => {
      const names = Array.from({ length: declared }, (_, i) => letters(i));
      const list = Array.from({ length: declared * 10 }, (_, i) => `o${names[i % declared]}`);
      return [
        ...names.map((name) => `\\newif\\if@x${name}`),
        ...names.map((name) => `\\DeclareOption{o${name}}{\\@x${name}true}`),
        ...Array.from(
          { length: list.length / 500 },
          (_, i) => `\\ExecuteOptions{${list.slice(i * 500, (i + 1) * 500).join(",")}}`,
        ),
      ].join("\n");
    };
    const small = [{ text: hostile(150), isClass: true }];
    const large = [{ text: hostile(1_500), isClass: true }];
    expect([...optionValues(large, []).values()].filter(Boolean)).toHaveLength(1_500);
    const [short = 0, long = 0] = fastest(
      [() => optionValues(small, []), () => optionValues(large, [])],
      3,
    );
    expect(long).toBeLessThan(bound(30, short));
    expect(long).toBeLessThan(2_000);
  }, 60_000);
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

  test("drops a face whose name would pass the cap, and reads at most four option groups", () => {
    // Each star is the font's name: 8,000 of them and a name of 8,000 letters made a face of
    // 64,000,000 characters from 16 KB of source.
    const name = "Invented".repeat(1_000);
    const hostile = fontsOf(`\\setmainfont[BoldFont=${"*".repeat(8_000)}]{${name}}`);
    expect(hostile).toEqual({ families: [name], files: [] });
    expect(fontsOf("\\setmainfont[BoldFont=** Bold]{Invented}").families).toEqual([
      "Invented",
      "InventedInvented Bold",
    ]);
    expect(fontsOf("\\setmainfont[a=1][b=2][c=3][BoldFont=* Bold]{Invented}").families).toEqual([
      "Invented",
      "Invented Bold",
    ]);
    expect(fontsOf("\\setmainfont[a=1][b=2][c=3][d=4][BoldFont=* Bold]{Invented}")).toEqual({
      families: [],
      files: [],
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
