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
        "",
        "\\DeclareFontSeriesDefault[rm]{bf}{\\bfdefault}\\def\\rmdefault{RtQuireSans}\\ignorespaces ",
        "\\usepackage[margin=1in]{geometry} % an invented comment, \\setmainfont{Nowhere}",
        "\\newcommand{\\invented}{\\textbf{x}}",
        "\\RequirePackage{rt-fontspec}",
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
    expect(text(rewrite, "rt-preamble.sty")).toContain("\\RequirePackage[OT1]{fontenc}");
    expect(text(rewrite, "rt-fontspec.sty")).toContain("\\renewcommand{\\encodingdefault}{TU}");
    // fontspec loaded without no-math sets mathematics up at \begin{document}, as it would.
    expect(text(rewrite, "rt-fontspec.sty")).toContain("\\rt@setupmaths");
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
    expect(rewrite.preamble).toContain("\\def\\sfdefault{quire}");
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
    expect(rewrittenClass).not.toContain("\\RequirePackage{fontspec}");
    expect(rewrittenClass).toContain("\\let\\inventednewfontfamily\\newfontfamily");
    expect(rewrittenClass).toContain(
      "\\NewDocumentCommand\\headerfont{}{\\fontfamily{RtQuireSans}\\fontencoding{TU}\\selectfont}",
    );
    // A font a definition asks for stops the compile only if the definition is used, as XeTeX's.
    expect(rewrittenClass).toContain("\\PackageError{rt-fonts}{missing font Nowhere Sans}{}");
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
    expect(TRANSLATED_PACKAGES).toEqual(
      expect.arrayContaining(["roboto", "sourcesanspro", "lato", "fontawesome5", "plex-sans"]),
    );
  });

  it("takes unicode-math out, and keeps it for the check to compile the mathematics apart", () => {
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
    expect(rewrite.preamble).toContain("\\usepackage{amsmath}");
    expect(rewrite.preamble).not.toContain("unicode-math");
    expect(rewrite.preamble).not.toContain("\\setmathfont");
    expect(rewrite.maths?.preamble).toContain("\\usepackage{amsmath,unicode-math}");
    expect(rewrite.maths?.preamble).toContain("\\setmathfont{Quire Math}");
    // The default math font, and the one named, which the tree does not have.
    expect(rewrite.mathFonts).toEqual(["latinmodern-math.otf", "Quire Math"]);
    // A symbol's command the document names sets its character in text, as unicode-math's does.
    expect(text(rewrite, "rt-fontspec.sty")).toContain("\\rt@want{cdotp}{cdotp}");
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
      "Scale=MatchLowercase",
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
  async function check(main: string) {
    const bytes = zipSync({ "cv.tex": strToU8(main) });
    const upload = intake({ name: "cv.zip", bytes }, { tree });
    if (isRefusal(upload)) throw new Error(`intake refused: ${upload.message}`);
    expect(upload.engine).toBe("xetex");
    const made = await reference(session, fonts, upload);
    if (isRefusal(made)) throw new Error(`reference refused: ${made.message}`);
    const rewrite = rewriteForXetex(upload, tree);
    if (isRefusal(rewrite)) throw new Error(`rewrite refused: ${rewrite.message}`);
    const checked = await checkRewrite(session, fonts, upload, made, rewrite);
    return { rewrite, checked, made };
  }

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
});
