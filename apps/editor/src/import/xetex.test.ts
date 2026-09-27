import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineManifest, TreeFont } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { type FontFamily, shapeFeatures, shapeFile } from "../templates/package";
import { bound, fastest } from "../test/timing";
import { readTree, type Tree } from "./fonts";
import { decodeText, type Intake, intake } from "./intake";
import { reference } from "./reference";
import { isRefusal, type Refusal } from "./refusal";
import { rewriteForXetex, TRANSLATED_PACKAGES, type XetexRewrite } from "./xetex";
import { checkRewrite } from "./xetex-check";

// Every document, class and font here is invented for these tests: "Quire Sans", a family of four
// faces with small capitals and proportional figures, and a mono face, alongside invented tables
// for the file names the font packages load, Roboto's among them.

const FONTS = "/texlive/texmf-dist/fonts/opentype/invented";

/** A font of the invented tree, as the manifest's table would describe it. */
const font = (family: string, style: string, more: Partial<TreeFont> = {}): TreeFont => ({
  family,
  style,
  fontFamily: family,
  fontSubfamily: style,
  fullName: style === "Regular" ? family : `${family} ${style}`,
  postScriptName: `${family.replaceAll(" ", "")}-${style.replaceAll(" ", "")}`,
  weight: 400,
  width: 5,
  scripts: ["DFLT", "latn"],
  features: ["kern", "liga", "lnum", "onum", "pnum", "smcp", "tnum"],
  ...more,
});

const ITALIC = { italic: true as const, slant: 212 };
const BOLD = { weight: 700, bold: true as const };
const TABLE: Record<string, TreeFont> = {
  [`${FONTS}/quire/QuireSans-Regular.otf`]: font("Quire Sans", "Regular", { regular: true }),
  [`${FONTS}/quire/QuireSans-Italic.otf`]: font("Quire Sans", "Italic", ITALIC),
  [`${FONTS}/quire/QuireSans-Bold.otf`]: font("Quire Sans", "Bold", BOLD),
  [`${FONTS}/quire/QuireSans-BoldItalic.otf`]: font("Quire Sans", "Bold Italic", {
    ...BOLD,
    ...ITALIC,
  }),
  [`${FONTS}/quire/QuireMono-Regular.otf`]: font("Quire Mono", "Regular", { features: ["kern"] }),
  [`${FONTS}/roboto/Roboto-Regular.otf`]: font("Roboto", "Regular", { regular: true }),
  [`${FONTS}/roboto/Roboto-Italic.otf`]: font("Roboto", "Italic", ITALIC),
  [`${FONTS}/roboto/Roboto-Bold.otf`]: font("Roboto", "Bold", BOLD),
  [`${FONTS}/roboto/Roboto-BoldItalic.otf`]: font("Roboto", "Bold Italic", { ...BOLD, ...ITALIC }),
};

const TREE: Tree = readTree(
  {
    ...Object.fromEntries(Object.keys(TABLE).map((path) => [path, 1])),
    "/texlive/texmf-dist/tex/latex/fontspec/fontspec.sty": 1,
    "/texlive/texmf-dist/tex/latex/roboto/roboto.sty": 1,
    "/texlive/texmf-dist/tex/latex/fontawesome5/fontawesome5.sty": 1,
  },
  TABLE,
);

/** The intake of an invented upload: a main file, and a class or package of its own if given. */
function taken(main: string, others: Record<string, string> = {}): Intake {
  const files = { "cv.tex": main, ...others };
  const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([n, t]) => [n, strToU8(t)])));
  const result = intake({ name: "cv.zip", bytes }, { tree: TREE });
  if (isRefusal(result)) throw new Error(`refused: ${result.message}`);
  return result;
}

/** A document of an invented preamble and a line of body. */
const doc = (...preamble: string[]) =>
  [...preamble, "\\begin{document}", "An invented line of text.", "\\end{document}", ""].join("\n");

/** The rewrite of an invented document, which must be taken. */
function rewritten(main: string, others: Record<string, string> = {}): XetexRewrite {
  const result = rewriteForXetex(taken(main, others), TREE);
  if (isRefusal(result)) throw new Error(`refused: ${result.message}`);
  return result;
}

/** The refusal of an invented document, which must be refused. */
function refused(main: string, others: Record<string, string> = {}): Refusal {
  const result = rewriteForXetex(taken(main, others), TREE);
  if (!isRefusal(result)) throw new Error("taken");
  return result;
}

const text = (rewrite: XetexRewrite, path: string) => {
  const bytes = rewrite.files[path];
  if (bytes === undefined) throw new Error(`the rewrite has no ${path}`);
  return decodeText(bytes);
};

const LATIN = "script=latn;language=dflt";

/** Each shape of a family as `file features`, its family's features and its own. */
const declared = (family: FontFamily | undefined): Record<string, string> =>
  Object.fromEntries(
    Object.entries(family?.shapes ?? {}).map(([key, shape]) => [
      key,
      `${shapeFile(shape)} ${family ? (shapeFeatures(family, shape) ?? "") : ""}`,
    ]),
  );

/** A control word's name for a number, in letters, as TeX reads one. */
const letters = (n: number): string =>
  (n >= 26 ? letters(Math.floor(n / 26) - 1) : "") + String.fromCharCode(97 + (n % 26));

describe("rewriteForXetex", () => {
  it("takes fontspec out, declares the main font by file, and keeps the rest byte for byte", () => {
    const main = doc(
      "\\documentclass[11pt]{article}",
      "\\usepackage{fontspec}",
      "\\setmainfont{Quire Sans}",
      "\\usepackage[margin=1in]{geometry} % an invented comment, \\setmainfont{Nowhere}",
      "\\newcommand{\\invented}{\\textbf{x}}",
    );
    const rewrite = rewritten(main);
    expect(rewrite.preamble).toBe(
      [
        "\\RequirePackage{rt-preamble}",
        "\\documentclass[11pt]{article}",
        // fontspec's stand-in where fontspec was, which does what loading fontspec does.
        "\\usepackage{rt-fontspec}",
        // \setmainfont's stand-in, which ends in \normalfont as fontspec's command does.
        "\\csname rt@setfamily\\endcsname{rm}{RtQuireSans}\\ignorespaces ",
        "\\usepackage[margin=1in]{geometry} % an invented comment, \\setmainfont{Nowhere}",
        "\\newcommand{\\invented}{\\textbf{x}}",
        "",
      ].join("\n"),
    );
    expect(rewrite.body).toBe(main.slice(main.indexOf("\\begin{document}")));
    const [family] = rewrite.fonts;
    expect(rewrite.fonts).toHaveLength(1);
    expect(family?.family).toBe("RtQuireSans");
    // What every shape shares is the family's; what a shape adds after it, the shape's.
    expect(family?.features).toBe(LATIN);
    expect(family?.shapes["m/n"]).toEqual({
      file: "QuireSans-Regular.otf",
      features: "mapping=tex-text",
    });
    const shapes = declared(family);
    expect(shapes["m/n"]).toBe(`QuireSans-Regular.otf ${LATIN};mapping=tex-text`);
    expect(shapes["b/n"]).toBe(`QuireSans-Bold.otf ${LATIN};mapping=tex-text`);
    expect(shapes["bx/n"]).toBe(`QuireSans-Bold.otf ${LATIN};mapping=tex-text`);
    expect(shapes["m/it"]).toBe(`QuireSans-Italic.otf ${LATIN};mapping=tex-text`);
    expect(shapes["m/sc"]).toBe(`QuireSans-Regular.otf ${LATIN};+smcp;mapping=tex-text`);
    // The rewrite's own style files, and no file of the upload's, which it did not change.
    expect(Object.keys(rewrite.files).sort()).toEqual(["rt-fontspec.sty", "rt-preamble.sty"]);
    // Until \begin{document}, a font asked for in TU is a TFM font in OT1, with TU's em and ex.
    const preamble = text(rewrite, "rt-preamble.sty");
    expect(preamble).toContain("\\rt@fontencoding{OT1}");
    expect(preamble).toContain("\\fontdimen6\\font=\\rt@size");
    expect(preamble).toContain("\\AddToHook{begindocument/before}[rt-preamble]");
    expect(preamble).toContain("\\def\\rt@setfamily#1#2");
    // What loading fontspec does: the Latin Modern defaults, TU, the normal size.
    const fontspec = text(rewrite, "rt-fontspec.sty");
    expect(fontspec).toContain("\\def\\rmdefault{lmr}\\def\\sfdefault{lmss}\\def\\ttdefault{lmtt}");
    expect(fontspec).toContain("\\RequirePackage[TU]{fontenc}");
    expect(fontspec).toContain("\\normalsize");
    // fontspec loaded without no-math sets mathematics up at \begin{document}, as it would.
    expect(fontspec).toContain("\\rt@setupmaths");
    expect(rewrite.deferred).toEqual([]);
    expect(rewrite.features).toEqual({ mapping: 1, smcp: 1 });
    expect(rewrite.warnings).toEqual([]);
  });

  it("defines a command for each font family, with its features, and declares one family once", () => {
    const rewrite = rewritten(
      doc(
        "\\documentclass{article}",
        "\\usepackage[no-math]{fontspec}",
        "\\newfontfamily\\headingfont[Numbers=Proportional, Letters=SmallCaps]{Quire Sans}",
        "\\newfontfamily{\\labelfont}{Quire Sans}[Numbers=Proportional,Letters=SmallCaps]",
        "\\newfontfamily\\otherfont{Quire Sans}[Letters=SmallCaps,Numbers=Proportional]",
        "\\newfontface\\codefont{Quire Mono}",
        "\\setsansfont{Quire Sans}[NFSSFamily=quire]",
      ),
    );
    expect(rewrite.preamble).toContain(
      "\\NewDocumentCommand\\headingfont{}{\\fontfamily{RtQuireSans}\\fontencoding{TU}\\selectfont}",
    );
    // The same font with the same options, given after the name, is the same family.
    expect(rewrite.preamble).toContain(
      "\\NewDocumentCommand\\labelfont{}{\\fontfamily{RtQuireSans}\\fontencoding{TU}\\selectfont}",
    );
    expect(rewrite.preamble).toContain(
      "\\NewDocumentCommand\\codefont{}{\\fontfamily{RtQuireMono}\\fontencoding{TU}\\selectfont}",
    );
    // The same features in another order are another font to XeTeX, and so another family.
    expect(rewrite.preamble).toContain(
      "\\NewDocumentCommand\\otherfont{}{\\fontfamily{RtQuireSans2}\\fontencoding{TU}\\selectfont}",
    );
    expect(rewrite.preamble).toContain("\\csname rt@setfamily\\endcsname{sf}{quire}");
    expect(rewrite.fonts.map((each) => each.family)).toEqual([
      "RtQuireSans",
      "RtQuireSans2",
      "RtQuireMono",
      "quire",
    ]);
    const [heading, other, code, sans] = rewrite.fonts;
    expect(declared(heading)["m/n"]).toBe(`QuireSans-Regular.otf ${LATIN};+pnum;+smcp`);
    expect(declared(other)["b/it"]).toBe(`QuireSans-BoldItalic.otf ${LATIN};+smcp;+pnum`);
    // A face has no bold, italic or small capitals.
    expect(declared(code)).toEqual({ "m/n": `QuireMono-Regular.otf ${LATIN}` });
    expect(declared(sans)["m/n"]).toBe(`QuireSans-Regular.otf ${LATIN};mapping=tex-text`);
    // no-math: fontspec leaves mathematics alone.
    expect(text(rewrite, "rt-fontspec.sty")).not.toContain("\\rt@setupmaths");
  });

  it("follows \\defaultfontfeatures, and selects a font the body asks for by \\fontspec", () => {
    const main = [
      "\\documentclass{article}",
      "\\usepackage{fontspec}",
      "\\defaultfontfeatures{Numbers=OldStyle}",
      "\\setmainfont{Quire Sans}",
      "\\begin{document}",
      "Invented {\\fontspec{Quire Mono}code} text.",
      "\\end{document}",
      "",
    ].join("\n");
    const rewrite = rewritten(main);
    expect(rewrite.preamble).not.toContain("\\defaultfontfeatures");
    // Every font's defaults, and fontspec.cfg's for the main family.
    expect(declared(rewrite.fonts[0])["m/n"]).toBe(
      `QuireSans-Regular.otf ${LATIN};+onum;mapping=tex-text`,
    );
    expect(rewrite.body).toContain(
      "{\\fontfamily{RtQuireMono}\\fontencoding{TU}\\selectfont\\ignorespaces code}",
    );
  });

  it("rewrites fontspec's commands in the upload's class, and leaves one a definition only names", () => {
    const cls = [
      "\\NeedsTeXFormat{LaTeX2e}",
      "\\ProvidesClass{invented}",
      "\\LoadClass{article}",
      "\\RequirePackage{fontspec}",
      "\\let\\inventednewfontfamily\\newfontfamily",
      "\\newfontfamily\\headerfont{Quire Sans}",
      "\\newcommand{\\missing}{\\fontspec{Nowhere Sans}}",
      "",
    ].join("\n");
    const rewrite = rewritten(doc("\\documentclass{invented}"), { "invented.cls": cls });
    const rewrittenClass = text(rewrite, "invented.cls");
    expect(rewrittenClass).toContain("\\RequirePackage{rt-fontspec}");
    expect(rewrittenClass).toContain("\\let\\inventednewfontfamily\\newfontfamily");
    expect(rewrittenClass).toContain(
      "\\NewDocumentCommand\\headerfont{}{\\fontfamily{RtQuireSans}\\fontencoding{TU}\\selectfont}",
    );
    // A font a definition asks for stops the compile only if the definition is used, as XeTeX's,
    // with the refusal the rewrite keeps for it.
    expect(rewrittenClass).toContain(
      "\\PackageError{rt-fonts}{Unreproducible font or feature 0}{}",
    );
    expect(rewrite.deferred.map((each) => [each.reason, each.name, each.message])).toEqual([
      [
        "font",
        "Nowhere Sans",
        "This resume needs the font Nowhere Sans, which this editor does not have.",
      ],
    ]);
  });

  it("puts a stand-in of its own in the place of a font package that loads fontspec", () => {
    const rewrite = rewritten(
      doc(
        "\\documentclass{article}",
        "\\usepackage[sfdefault]{roboto}",
        "\\usepackage[fixed]{fontawesome5}",
        "\\newcommand{\\invented}{\\roboto\\robotoLF}",
      ),
    );
    expect(rewrite.preamble).toContain("\\usepackage{rt-roboto}");
    expect(rewrite.preamble).toContain("\\usepackage{rt-fontawesome5}");
    const roboto = text(rewrite, "rt-roboto.sty");
    expect(roboto).toContain("\\ProvidesPackage{rt-roboto}");
    expect(roboto).toContain("\\renewcommand*\\familydefault{\\robotofamily}");
    // The commands the document names, and those alone.
    expect(roboto).toContain("\\NewDocumentCommand\\roboto{}");
    expect(roboto).toContain("\\NewDocumentCommand\\robotolf{}");
    expect(roboto).not.toContain("\\NewDocumentCommand\\robotothin{}");
    expect(rewrite.fonts.every((each) => each.shapes["m/n"] !== undefined)).toBe(true);
    // roboto.sty's lining, proportional figures, from its files by name.
    expect(declared(rewrite.fonts[0])["m/n"]).toBe(
      `Roboto-Regular.otf ${LATIN};+pnum;+lnum;mapping=tex-text`,
    );
    expect(text(rewrite, "rt-fontawesome5.sty")).toContain(
      "\\bool_set_true:N \\l__rtfa_fixed_bool",
    );
    // roboto.sty loads fontspec on XeTeX, and its stand-in fontspec's, with its mathematics set-up;
    // roboto's \setsansfont ends in \normalfont too. fontawesome5 loads no fontspec.
    expect(roboto).toContain("\\RequirePackage{rt-fontspec}");
    expect(roboto).toContain("\\rt@setfamily{sf}{RtRoboto}");
    expect(text(rewrite, "rt-fontspec.sty")).toContain("\\rt@setupmaths");
    expect(text(rewrite, "rt-fontawesome5.sty")).not.toContain("rt-fontspec");
    expect(TRANSLATED_PACKAGES).toEqual(
      expect.arrayContaining(["roboto", "sourcesanspro", "lato", "fontawesome5", "plex-sans"]),
    );
  });

  it("puts unicode-math's stand-in where it was, and records the math fonts it set", () => {
    const rewrite = rewritten(
      doc(
        "\\documentclass{article}",
        "\\usepackage{fontspec}",
        "\\usepackage{amsmath,unicode-math}",
        "\\setmainfont{Quire Sans}",
        "\\setmathfont{Quire Math}",
        "\\newcommand{\\sep}{\\cdotp}",
      ),
    );
    // The packages load in the order given, the stand-in where unicode-math was.
    expect(rewrite.preamble).toContain("\\usepackage{amsmath}\\usepackage{rt-unicode-math}");
    expect(rewrite.preamble).not.toContain("{unicode-math}");
    expect(rewrite.preamble).not.toContain("\\setmathfont");
    // The default math font, and the one named, which the tree does not have.
    expect(rewrite.mathFonts).toEqual(["latinmodern-math.otf", "Quire Math"]);
    // What unicode-math loads, fontspec among them; and a symbol's command the document names set
    // as its character in text at \begin{document}, as unicode-math's is.
    const unicodeMath = text(rewrite, "rt-unicode-math.sty");
    expect(unicodeMath).toContain("\\RequirePackage{rt-fontspec}");
    expect(unicodeMath).toContain("\\RequirePackage{amsmath}");
    expect(unicodeMath).toContain("\\rt@want{cdotp}{cdotp}");
    expect(unicodeMath).toContain("\\AtBeginDocument{\\rt@umchars}");
    // unicode-math sets mathematics up itself, so fontspec's set-up stays out.
    expect(text(rewrite, "rt-fontspec.sty")).not.toContain("\\rt@setupmaths");
    expect(rewrite.warnings).toEqual([
      "unicode-math is left out: mathematics is set in TeX's own math fonts, not the resume's.",
    ]);
  });

  it("refuses a font the tree lacks, and what fontspec's emulation cannot reproduce, by name", () => {
    const refusedFor = (...preamble: string[]) => {
      const why = refused(doc("\\documentclass{article}", "\\usepackage{fontspec}", ...preamble));
      return [why.reason, why.name];
    };
    expect(refusedFor("\\setmainfont{Nowhere Sans}")).toEqual(["font", "Nowhere Sans"]);
    expect(refusedFor("\\setmainfont{Quire Sans}[Scale=MatchLowercase]")).toEqual([
      "feature",
      "Scale",
    ]);
    expect(refusedFor("\\usepackage{polyglossia}")).toEqual(["feature", "polyglossia"]);
    expect(refusedFor("\\setmainfont{Quire Sans}", "\\addfontfeatures{Numbers=OldStyle}")).toEqual([
      "feature",
      "\\addfontfeatures",
    ]);
    expect(refusedFor("\\newfontfeature{Invented}{+smcp}")).toEqual([
      "feature",
      "\\newfontfeature",
    ]);
    expect(refusedFor("\\setmainfont{Quire Sans}[NFSSFamily=a b]")).toEqual([
      "feature",
      "NFSSFamily",
    ]);
  });

  it("names what it refuses in plain words, never a line of source", () => {
    const messageFor = (...preamble: string[]) =>
      refused(
        doc(
          "\\documentclass{article}",
          "\\usepackage{fontspec}",
          "\\usepackage{xcolor}",
          ...preamble,
        ),
      ).message;
    const option = (key: string) =>
      `This resume sets its fonts with the font option ${key}, which this editor cannot reproduce.`;
    const messages = [
      messageFor(
        "\\setmainfont{Quire Sans}",
        "\\newcommand{\\emph}[1]{{\\addfontfeatures{Letters=SmallCaps}#1}}",
      ),
      messageFor("\\newcommand{\\headfont}{Quire Sans}\\setmainfont{\\headfont}"),
      messageFor(
        "\\definecolor{accent}{HTML}{0395DE}\\newcommand{\\accentname}{accent}",
        "\\setmainfont[Color=\\accentname]{Quire Sans}",
      ),
      messageFor("\\newcommand{\\myscale}{0.9}\\setmainfont[Scale=\\myscale]{Quire Sans}"),
      messageFor("\\setmainfont[Numbers=\\mynumbers]{Quire Sans}"),
      messageFor("\\setmainfont[\\inventedoptions]{Quire Sans}"),
      messageFor("\\setmainfont{Nowhere\\ Sans}"),
      messageFor("\\usepackage{polyglossia}"),
    ];
    expect(messages).toEqual([
      "This resume sets its fonts with the font command addfontfeatures, which this editor cannot reproduce.",
      "This resume needs a font set by a command, which this editor cannot reproduce.",
      option("Color"),
      option("Scale"),
      option("Numbers"),
      "This resume sets its fonts with options a command gives, which this editor cannot reproduce.",
      "This resume needs the font Nowhere Sans, which this editor does not have.",
      "This resume sets its fonts with the package polyglossia, which this editor cannot reproduce.",
    ]);
    // A document whose main file loads its class from another file, which the rewrite cannot
    // follow, as an intake the corpus's children build takes it.
    const text = "\\input{preamble}\n\\begin{document}\nx\n\\end{document}\n";
    const noClass = rewriteForXetex(
      {
        engine: "xetex",
        source: "xetex",
        main: { path: "cv.tex", text, bytes: strToU8(text) },
        files: {},
        fonts: [],
        images: { replaced: [], dropped: [] },
        warnings: [],
      },
      TREE,
    );
    if (!isRefusal(noClass)) throw new Error("taken");
    expect(noClass.message).toBe(
      "This resume loads its template from another file than its main one, so this editor cannot rewrite its fonts.",
    );
    for (const message of [...messages, noClass.message]) expect(message).not.toMatch(/[\\{}=#]/);
  });

  it("declares only families the package's schema takes, naming the option that makes one it does not", () => {
    const why = (line: string) => {
      const refusal = refused(doc("\\documentclass{article}", "\\usepackage{fontspec}", line));
      return [refusal.reason, refusal.name];
    };
    // A series of more letters than NFSS takes, which only FontFace can give.
    expect(why("\\setmainfont[FontFace={extrabold}{n}{Quire Sans Bold}]{Quire Sans}")).toEqual([
      "feature",
      "FontFace",
    ]);
    expect(why("\\setmainfont[Scale=12]{Quire Sans}")).toEqual(["feature", "Scale"]);
    expect(why("\\setmonofont[WordSpace=200]{Quire Mono}")).toEqual(["feature", "WordSpace"]);
    // A family it takes is the schema's.
    const rewrite = rewritten(
      doc(
        "\\documentclass{article}",
        "\\usepackage{fontspec}",
        "\\setmainfont[Scale=0.9]{Quire Sans}",
      ),
    );
    expect(rewrite.fonts[0]?.scale).toBe(0.9);
  });

  it("keeps each shape's own adjustments, and a family's where every shape has the same", () => {
    const rewrite = rewritten(
      doc(
        "\\documentclass{article}",
        "\\usepackage{fontspec}",
        "\\setmonofont{Quire Mono}",
        "\\newfontfamily\\spaced{Quire Sans}[BoldFeatures={WordSpace=2}]",
      ),
    );
    const [mono, spaced] = rewrite.fonts;
    // fontspec.cfg's spaces for the mono family are every shape's.
    expect(mono?.adjust).toEqual({
      wordSpace: [1, 0, 0],
      hyphenChar: -1,
      punctuationSpace: { factor: 0, of: "space" },
    });
    // The bold's own word space is the bold's alone.
    expect(spaced?.adjust).toBeUndefined();
    expect(spaced?.shapes["m/n"]).toBe("QuireSans-Regular.otf");
    expect(spaced?.shapes["b/n"]).toEqual({
      file: "QuireSans-Bold.otf",
      adjust: { wordSpace: [2, 2, 2] },
    });
  });

  it("gives a family the defaults of the command that sets it and of its font's name", () => {
    const rewrite = rewritten(
      doc(
        "\\documentclass{article}",
        "\\usepackage{fontspec}",
        "\\defaultfontfeatures[\\headingfont]{Numbers=OldStyle}",
        "\\defaultfontfeatures[Quire Sans]{Letters=SmallCaps}",
        // fontspec compares a font's name with its spaces: this names no font of the document's.
        "\\defaultfontfeatures[QuireMono]{Numbers=OldStyle}",
        "\\newfontfamily\\headingfont{Quire Sans}",
        "\\newfontfamily\\otherfont{Quire Sans}",
        "\\setmonofont{Quire Mono}",
      ),
    );
    const [heading, other, mono] = rewrite.fonts;
    expect(declared(heading)["m/n"]).toBe(`QuireSans-Regular.otf ${LATIN};+onum;+smcp`);
    expect(declared(other)["m/n"]).toBe(`QuireSans-Regular.otf ${LATIN};+smcp`);
    expect(declared(mono)["m/n"]).toBe(`QuireMono-Regular.otf ${LATIN}`);
  });

  it("loads the packages of a list in their order, and its own before a fontspec before the class", () => {
    const rewrite = rewritten(
      [
        "\\RequirePackage{fontspec}",
        "\\documentclass{article}",
        "\\usepackage[final]{xcolor,fontspec,geometry}[2020/01/01]",
        "\\setmainfont{Quire Sans}",
        "\\begin{document}",
        "An invented line of text.",
        "\\end{document}",
        "",
      ].join("\n"),
    );
    expect(rewrite.preamble).toMatch(
      /^\\RequirePackage\{rt-preamble\}\n\\RequirePackage\{rt-fontspec\}\n\\documentclass\{article\}\n/,
    );
    expect(rewrite.preamble).toContain(
      "\\usepackage[final]{xcolor}[2020/01/01]\\usepackage{rt-fontspec}\\usepackage[final]{geometry}[2020/01/01]",
    );
  });

  it("rewrites a preamble in time linear in its fontspec commands", () => {
    // Each command reads its arguments where it stands, and a family is found by its shapes'
    // signature, not by comparing it with every family before it.
    const many = (count: number) =>
      taken(
        doc(
          "\\documentclass{article}",
          "\\usepackage{fontspec}",
          ...Array.from(
            { length: count },
            (_, i) => `\\newfontfamily\\invented${letters(i)}[LetterSpace=${i}]{Quire Sans}`,
          ),
        ),
      );
    const small = many(20);
    const large = many(200);
    const [short = 0, long = 0] = fastest(
      [() => rewriteForXetex(small, TREE), () => rewriteForXetex(large, TREE)],
      3,
    );
    expect(long).toBeLessThan(bound(10 * 3, short));
    const rewrite = rewriteForXetex(large, TREE);
    expect(isRefusal(rewrite) ? [] : rewrite.fonts).toHaveLength(200);
  }, 60_000);

  it("rewrites in time linear in the spans XeTeX skips and the environments of the body", () => {
    // Each command's place is looked up among the skipped spans by a binary search, and the
    // body's environments are no commands of the rewrite's.
    const many = (count: number) =>
      taken(
        [
          "\\documentclass{article}",
          "\\usepackage{fontspec}",
          ..."\\iffalse\\fi\n".repeat(count).split("\n"),
          "\\setmainfont{Quire Sans}",
          "\\begin{document}",
          ..."\\begin{x}\n".repeat(count).split("\n"),
          "\\end{document}",
          "",
        ].join("\n"),
      );
    const small = many(2_000);
    const large = many(20_000);
    const [short = 0, long = 0] = fastest(
      [() => rewriteForXetex(small, TREE), () => rewriteForXetex(large, TREE)],
      3,
    );
    expect(long).toBeLessThan(bound(10 * 3, short));
  }, 60_000);

  it("rewrites in time linear in definitions that ask for a font the tree lacks", () => {
    // Where a command stands in a definition is a binary search among the definitions' bodies.
    const many = (count: number) =>
      taken(
        doc(
          "\\documentclass{article}",
          "\\usepackage{fontspec}",
          `\\defaultfontfeatures{${"Scale=1,".repeat(200)}}`,
          ..."\\newcommand{\\x}{\\fontspec{Nowhere Sans}}\n".repeat(count).split("\n"),
        ),
      );
    const small = many(500);
    const large = many(5_000);
    const [short = 0, long = 0] = fastest(
      [() => rewriteForXetex(small, TREE), () => rewriteForXetex(large, TREE)],
      3,
    );
    expect(long).toBeLessThan(bound(10 * 3, short));
    const rewrite = rewriteForXetex(large, TREE);
    expect(isRefusal(rewrite) ? undefined : rewrite.deferred.length).toBe(5_000);
    // Defaults piled up past what any family should read are refused as they pile up.
    const piled = refused(
      doc(
        "\\documentclass{article}",
        "\\usepackage{fontspec}",
        ...`\\defaultfontfeatures+{${"Scale=1,".repeat(200)}}\n`.repeat(2).split("\n"),
      ),
    );
    expect([piled.reason, piled.name]).toEqual(["feature", "\\defaultfontfeatures"]);
  }, 60_000);
});

// These compile with the real engine and read the tree's fonts, and need `.engine/`.
describe.skipIf(!engineAvailable())("the rewrite through the engine", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  let tree: Tree;
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

  /**
   * A document's reference compile, its rewrite, and the rewrite's check: the whole document from
   * the stock format against the reference, the dump, and the body from the format again.
   */
  async function check(main: string, others: Record<string, string> = {}) {
    const files = { "cv.tex": main, ...others };
    const bytes = zipSync(
      Object.fromEntries(Object.entries(files).map(([n, t]) => [n, strToU8(t)])),
    );
    const taken = intake({ name: "cv.zip", bytes }, { tree });
    if (isRefusal(taken)) throw new Error(`intake refused: ${taken.message}`);
    // A document that runs on either engine is taken on XeTeX, as the corpus runner takes one.
    const upload: Intake = { ...taken, engine: "xetex" };
    const made = await reference(session, fonts, upload);
    if (isRefusal(made)) throw new Error(`reference refused: ${made.message}`);
    const rewrite = rewriteForXetex(upload, tree);
    if (isRefusal(rewrite)) throw new Error(`rewrite refused: ${rewrite.message}`);
    const checked = await checkRewrite(session, fonts, upload, made, rewrite);
    return { rewrite, checked, made };
  }

  /** A document the check must take exactly, its body from the format as the reference. */
  async function matches(main: string, others: Record<string, string> = {}) {
    const { checked, rewrite } = await check(main, others);
    if (isRefusal(checked)) throw new Error(`check refused: ${checked.message}\n${checked.log}`);
    expect(checked.warnings).toEqual([]);
    return rewrite;
  }

  /** An invented document of a preamble's lines and a short body. */
  const short = (...preamble: string[]) =>
    [
      "\\documentclass{article}",
      ...preamble,
      "\\pagestyle{empty}",
      "\\begin{document}",
      "{\\bfseries An invented heading}\\par",
      "Invented text for a check, from 2021 -- 2024, and \\textsf{some in the sans family}.\\par",
      "More invented text, in a second paragraph.",
      "\\end{document}",
      "",
    ].join("\n");

  /** An invented body: a name, a heading, an entry with a bullet, an icon and figures. */
  const BODY = String.raw`\begin{document}
{\LARGE\bfseries Invented Heading}\par\smallskip
{\itshape Typesetting engineer}\par
\mailicon~\href{mailto:someone@example.com}{someone@example.com} \textbullet{} 555-0142\par
\heading{Experience}
{\bfseries Harbor Lane Press}, Bergen\hfill 2021 -- 2024\par
{\itshape Senior engineer}\par
\begin{itemize}
\item Rebuilt the office's typesetting service -- the one every title goes through -- and cut a
proof's turnaround from a day to forty minutes, for 1,200 titles.
\end{itemize}
\end{document}
`;

  it("takes decision 0014's invented template, as fontspec sets it, and sets its glyphs by file", async () => {
    const main = String.raw`\documentclass[11pt]{article}
\usepackage{fontspec}
\setmainfont{Roboto}
\newfontfamily\headingfont{Source Sans Pro}
\newfontfamily\iconfont{Font Awesome 5 Free Solid}
\usepackage[letterpaper,margin=0.8in]{geometry}
\usepackage{xcolor}
\usepackage[hidelinks,bookmarks=false]{hyperref}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\definecolor{rtaccent}{HTML}{1F4E79}
\newcommand{\heading}[1]{\par\medskip{\headingfont\bfseries\large\color{rtaccent}#1}\par\smallskip}
\newcommand{\mailicon}{{\iconfont\symbol{"F0E0}}}
${BODY}`;
    const { rewrite, checked, made } = await check(main);
    if (isRefusal(checked)) throw new Error(`check refused: ${checked.message}\n${checked.log}`);
    expect(checked.warnings).toEqual([]);
    expect(rewrite.fonts.map((each) => each.family)).toEqual([
      "RtRoboto",
      "RtSourceSansPro",
      "RtFontAwesome5FreeSolid",
    ]);
    const [roboto, sans, icons] = rewrite.fonts;
    expect(declared(roboto)["b/n"]).toBe(`Roboto-Bold.otf ${LATIN};mapping=tex-text`);
    expect(declared(sans)["b/n"]).toBe(`SourceSansPro-Bold.otf ${LATIN}`);
    expect(declared(icons)).toEqual({ "m/n": `FontAwesome5Free-Solid-900.otf ${LATIN}` });
    // The reference's native fonts are the files the declarations name.
    expect(made.fonts.native.map((name) => name.split("/").pop()).sort()).toEqual(
      expect.arrayContaining(["Roboto-Regular.otf", "SourceSansPro-Bold.otf"]),
    );
    expect(checked.formatBytes).toBeGreaterThan(0);
  }, 60_000);

  it("takes a main font and a family of proportional figures and small capitals", async () => {
    const main = String.raw`\documentclass[11pt]{article}
\usepackage{fontspec}
\setmainfont{Roboto}
\newfontfamily\headingfont[Numbers=Proportional, Letters=SmallCaps]{Source Sans Pro}
\newfontfamily\iconfont{Font Awesome 5 Free Solid}
\usepackage[margin=1in]{geometry}
\pagestyle{empty}
\newcommand{\heading}[1]{\par\medskip{\headingfont #1 \scshape 2021}\par\smallskip}
\newcommand{\mailicon}{{\iconfont\symbol{"F0E0}}}
\usepackage{hyperref}
${BODY}`;
    const { rewrite, checked } = await check(main);
    if (isRefusal(checked)) throw new Error(`check refused: ${checked.message}\n${checked.log}`);
    const heading = rewrite.fonts.find((each) =>
      declared(each)["m/n"]?.startsWith("SourceSansPro"),
    );
    expect(declared(heading)["m/n"]).toBe(`SourceSansPro-Regular.otf ${LATIN};+pnum;+smcp`);
    expect(declared(heading)["m/sc"]).toBe(`SourceSansPro-Regular.otf ${LATIN};+pnum;+smcp`);
    // The main family's small capitals carry smcp too, one family each.
    expect(rewrite.features).toEqual({ mapping: 1, pnum: 1, smcp: 2 });
  }, 60_000);

  it("does what loading fontspec does: TU after T1, Latin Modern's sans after helvet's", async () => {
    // fontspec makes TU the default encoding even after T1, which would set the body in TFM fonts.
    await matches(
      short("\\usepackage[T1]{fontenc}", "\\usepackage{fontspec}", "\\setmainfont{Roboto}"),
    );
    // It sets the sans family to Latin Modern's again, where helvet had set Helvetica's.
    await matches(short("\\usepackage{helvet}", "\\usepackage{fontspec}", "\\setmainfont{Roboto}"));
  }, 60_000);

  it("sets lengths in em and ex as XeTeX's Latin Modern, the preamble's font, has them", async () => {
    // fontspec's normal size selects TU's Latin Modern, whose x-height the preamble's TFM font
    // takes, at 11 pt as at 10.
    await matches(
      short(
        "\\usepackage{fontspec}",
        "\\setlength{\\parskip}{1ex}",
        "\\setlength{\\parindent}{2em}",
        "\\setmainfont{Roboto}",
      ).replace("{article}", "[11pt]{article}"),
    );
    // A length set in ex while a font only the body can load is current, the main font once
    // \setmainfont selects it, differs, and the check refuses it rather than take it.
    const { checked } = await check(
      short("\\usepackage{fontspec}", "\\setmainfont{Roboto}", "\\setlength{\\parskip}{1ex}"),
    );
    expect(isRefusal(checked) ? [checked.reason, checked.name] : "taken").toEqual([
      "difference",
      "roboto-regular",
    ]);
  }, 60_000);

  it("selects the normal font again after \\setmainfont, as fontspec's command ends", async () => {
    await matches(
      short("\\usepackage{fontspec}", "\\setmainfont{Roboto}").replace(
        "More invented text",
        "{\\bfseries Bold \\setmainfont{Source Sans Pro}invented text} and more invented text",
      ),
    );
  }, 60_000);

  it("sets mathematics up as fontspec does where a font package loads it", async () => {
    // roboto.sty loads fontspec on XeTeX, whose set-up puts \sin in the main font's upright.
    const rewrite = await matches(
      short("\\usepackage[sfdefault]{roboto}").replace(
        "More invented text",
        "A formula, $x_1 = 2^{10} + \\sin\\alpha$, in invented text",
      ),
    );
    expect(text(rewrite, "rt-fontspec.sty")).toContain("\\rt@setupmaths");
  }, 60_000);

  it("gives the upload's bibliography to every compile of the check, under its job's name", async () => {
    const main = short("\\usepackage{fontspec}", "\\setmainfont{Roboto}").replace(
      "More invented text, in a second paragraph.",
      "Citing an invented paper \\cite{inv1}.\n\\bibliographystyle{plain}\n\\bibliography{refs}",
    );
    await matches(main, {
      "cv.bbl": String.raw`\begin{thebibliography}{1}
\bibitem{inv1} A.~Inventor. \newblock An invented paper. \newblock 2020.
\end{thebibliography}
`,
    });
  }, 60_000);

  it("lets pass as mathematics alone a difference in math fonts' glyphs that moves nothing", async () => {
    // T1 before unicode-math, which loads fontspec, which makes TU the default again: no
    // difference at all, where the maths exemption once hid a body in the wrong font.
    await matches(
      short("\\usepackage[T1]{fontenc}", "\\usepackage{unicode-math}", "\\setmainfont{Roboto}"),
    );
    const formula = (math: string) =>
      short("\\usepackage{unicode-math}", "\\setmainfont{Roboto}").replace(
        "More invented text",
        `Invented title${math}another invented title, and more text`,
      );
    // A centre dot in a box of its own width: only the dot's glyph differs, a math font's.
    const boxed = await check(formula("\\makebox[1em][l]{$\\cdot$}"));
    if (isRefusal(boxed.checked)) throw new Error(`refused: ${boxed.checked.log}`);
    expect(boxed.checked.warnings).toEqual([
      "The resume's mathematics comes out in TeX's own math fonts, not in unicode-math's: nothing else differs.",
    ]);
    // Set in the line, the dot's width moves the text after it: a difference, refused.
    const inline = await check(formula(" $\\cdot$ "));
    expect(isRefusal(inline.checked) ? [inline.checked.reason, inline.checked.name] : []).toEqual([
      "difference",
      "roboto-regular",
    ]);
  }, 60_000);

  it("refuses as stopped a preamble that cannot be kept, and by its key a feature a body uses", async () => {
    // A file in a folder cannot go with a dump, so a preamble that reads one does not dump.
    const folder = await check(
      short("\\usepackage{fontspec}", "\\input{parts/settings}", "\\setmainfont{Roboto}"),
      { "parts/settings.tex": "\\newcommand{\\inventedname}{an invented name}\n" },
    );
    if (!isRefusal(folder.checked)) throw new Error("taken");
    expect([folder.checked.reason, folder.checked.name]).toEqual(["stopped", undefined]);
    expect(folder.checked.message).toBe(
      "This resume's preamble could not be kept with its fonts declared by file.",
    );
    expect(folder.checked.log).toContain("parts/settings");
    // An option a definition asks for, which the rewrite put off: the body uses it.
    const deferred = await check(
      short(
        "\\usepackage{fontspec}",
        "\\setmainfont{Roboto}",
        "\\newcommand{\\oddfont}{\\fontspec[Scale=MatchLowercase]{Source Sans Pro}}",
      ).replace("More invented text", "{\\oddfont Odd} invented text"),
    );
    if (!isRefusal(deferred.checked)) throw new Error("taken");
    expect([deferred.checked.reason, deferred.checked.name, deferred.checked.message]).toEqual([
      "feature",
      "Scale",
      "This resume sets its fonts with the font option Scale, which this editor cannot reproduce.",
    ]);
  }, 60_000);
});
