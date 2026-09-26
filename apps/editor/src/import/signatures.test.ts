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
import { encodeLike, type Intake, intake } from "./intake";
import { bodyOf, buildTree, readBody, usesOf } from "./parse";
import { print } from "./print";
import { compileLikeReference, type Reference, reference, sameGlyphs } from "./reference";
import { isRefusal } from "./refusal";
import {
  closure,
  type EngineSignatures,
  MAX_CLOSURE_MACROS,
  meaningsCode,
  nameLines,
  namesIn,
  type Printed,
  readMeaning,
  readPrintout,
  resolve,
  signatures,
  xparseSpec,
} from "./signatures";

// Every meaning, document and macro here is invented for these tests; the meanings are as TeX
// prints them, written out by hand.

describe("reading a meaning", () => {
  test("reads a macro's prefixes, parameters and replacement", () => {
    expect(readMeaning("macro:#1#2->#1 and #2")).toEqual({
      kind: "macro",
      long: false,
      protected: false,
      outer: false,
      parameters: "#1#2",
      replacement: "#1 and #2",
    });
    expect(readMeaning("\\protected\\long macro:->\\relax ")).toMatchObject({
      kind: "macro",
      long: true,
      protected: true,
      parameters: "",
      replacement: "\\relax ",
    });
    expect(readMeaning("\\long macro:[#1]#2->x")).toMatchObject({ parameters: "[#1]#2" });
  });

  test("records what is not a macro as such", () => {
    expect(readMeaning("undefined")).toEqual({ kind: "undefined" });
    expect(readMeaning('\\char"41')).toEqual({ kind: "char" });
    expect(readMeaning("\\skip50")).toEqual({ kind: "register" });
    expect(readMeaning("\\count12")).toEqual({ kind: "register" });
    expect(readMeaning("\\hskip")).toEqual({ kind: "primitive" });
    expect(readMeaning("\\relax")).toEqual({ kind: "primitive" });
    expect(readMeaning('\\mathchar"3236')).toEqual({ kind: "other" });
    expect(readMeaning("select font cmr10")).toEqual({ kind: "other" });
    expect(readMeaning("the letter A")).toEqual({ kind: "other" });
  });
});

describe("reading a command's arguments from its meaning", () => {
  const printed = (entries: Record<string, string | Printed>) =>
    new Map<string, Printed>(
      Object.entries(entries).map(([name, value]) => [
        name,
        typeof value === "string" ? { meaning: value } : value,
      ]),
    );

  test("reads a plain macro's parameters", () => {
    const records = printed({
      cvthree: "\\long macro:#1#2#3->\\textbf {#1}#2#3",
      cvnone: "macro:->\\par ",
    });
    expect(resolve("cvthree", records)).toEqual({ spec: "m m m", how: "meaning" });
    expect(resolve("cvnone", records)).toEqual({ spec: "", how: "meaning" });
  });

  test("reads the optional-argument form through its second macro", () => {
    const records = printed({
      cvopt: "macro:->\\@protected@testopt \\cvopt \\\\cvopt {Invented}",
      "\\cvopt": "\\long macro:[#1]#2#3->#1 #2 #3",
    });
    expect(resolve("cvopt", records)).toEqual({ spec: "o m m", how: "optional" });
    expect(
      resolve(
        "cvlost",
        printed({ cvlost: "macro:->\\@protected@testopt \\cvlost \\\\cvlost {x}" }),
      ),
    ).toEqual({
      how: "unresolved",
      why: "optional",
    });
  });

  test("reads the robust form through its real macro, whose name ends in a space", () => {
    const records = printed({
      cvrobust: "macro:->\\protect \\cvrobust  ",
      "cvrobust ": "\\long macro:#1->\\textsc {#1}",
      cvboth: "macro:->\\protect \\cvboth  ",
      "cvboth ": "macro:->\\@protected@testopt \\cvboth  \\\\cvboth  {x}",
      "\\cvboth ": "\\long macro:[#1]#2->#1#2",
      ",": "macro:->\\x@protect \\,\\protect \\,  ",
      ", ": "\\long macro:->\\kern 1pt",
    });
    expect(resolve("cvrobust", records)).toEqual({ spec: "m", how: "robust" });
    expect(resolve("cvboth", records)).toEqual({ spec: "o m", how: "robust" });
    expect(resolve(",", records)).toEqual({ spec: "", how: "robust" });
  });

  test("reads an alias of a standard command through the table", () => {
    expect(resolve("cvbold", printed({ cvbold: "macro:->\\protect \\textbf  " }))).toEqual({
      spec: "m",
      how: "robust",
    });
    expect(
      resolve(
        "cvsection",
        printed({ cvsection: "macro:->\\@protected@testopt \\section \\\\section {}" }),
      ),
    ).toEqual({ spec: "s o m", how: "optional" });
  });

  test("takes xparse's own specification", () => {
    const records = printed({
      cvxp: {
        meaning: "\\protected macro:->\\__cmd_start:nNNnnn {s o m}\\cvxp  \\cvxp code ",
        spec: "s o m ",
      },
      cvsplit: {
        meaning: "\\protected macro:->\\__cmd_start:nNNnnn",
        spec: ">{\\SplitArgument {1}{,}}m o",
      },
      cvverb: { meaning: "\\protected macro:->\\__cmd_start:nNNnnn", spec: "v" },
    });
    expect(resolve("cvxp", records)).toEqual({ spec: "s o m", how: "xparse" });
    expect(resolve("cvsplit", records)).toEqual({ spec: "m o", how: "xparse" });
    expect(resolve("cvverb", records)).toEqual({ how: "unresolved", why: "specification" });
  });

  test("reads a look ahead by hand through the branch it hands to", () => {
    const records = printed({
      cvahead: "macro:->\\@ifnextchar [\\cv@a \\cv@b ",
      "cv@a": "\\long macro:[#1]#2#3->#1#2#3",
      cvbraced: "macro:->\\@ifnextchar [{\\cv@a }{\\cv@a [x]}",
      cvstar: "macro:->\\@ifstar {\\cv@s }{\\cv@n }",
      "cv@s": "\\long macro:#1->#1",
    });
    expect(resolve("cvahead", records)).toEqual({ spec: "o m m", how: "optional" });
    expect(resolve("cvbraced", records)).toEqual({ spec: "o m m", how: "optional" });
    expect(resolve("cvstar", records)).toEqual({ spec: "s m", how: "optional" });
  });

  test("resolves nothing it cannot read", () => {
    const records = printed({
      cvdelim: "macro:#1.#2\\par ->#1",
      cvahead: "macro:->\\@ifnextchar [\\cv@a \\cv@b ",
      cvstar: "macro:->\\@ifstar \\cv@s \\cv@n ",
      cvpeek: "macro:->\\futurelet \\cv@token \\cv@next ",
      cvchar: '\\char"41',
      cvgone: "undefined",
    });
    expect(resolve("cvdelim", records)).toEqual({ how: "unresolved", why: "delimited" });
    expect(resolve("cvahead", records)).toEqual({ how: "unresolved", why: "looks ahead" });
    expect(resolve("cvstar", records)).toEqual({ how: "unresolved", why: "looks ahead" });
    expect(resolve("cvpeek", records)).toEqual({ how: "unresolved", why: "looks ahead" });
    expect(resolve("cvchar", records)).toEqual({ how: "unresolved", why: "char" });
    expect(resolve("cvgone", records)).toEqual({ how: "unresolved", why: "undefined" });
    expect(resolve("cvnever", records)).toEqual({ how: "unresolved", why: "not printed" });
  });

  test("takes an xparse specification's processors out", () => {
    expect(xparseSpec(">{\\SplitList {;}}m >{\\TrimSpaces}O{d}")).toBe("m O{d}");
    expect(xparseSpec("+m !o t+ D<>{x}")).toBe("+m !o t+ D<>{x}");
    expect(xparseSpec("u{\\par}")).toBeUndefined();
  });
});

describe("the names a meaning names", () => {
  test("reads each name as TeX printed it", () => {
    expect(namesIn("\\textbf {#1}\\cv@inner \\hfill \\a \\,x\\\\ \\cv-dash x")).toEqual([
      "textbf",
      "cv@inner",
      "hfill",
      "a",
      ",",
      "\\",
      "cv-dash",
    ]);
    expect(namesIn("no names #1")).toEqual([]);
  });
});

describe("a definition's closure", () => {
  test("follows the template macros a meaning names, and those it hands its work to", () => {
    const meanings = new Map([
      ["cventry", "macro:#1->\\cvtitle {#1}\\hfill \\cvdate "],
      ["cvtitle", "macro:#1->\\textbf {#1}\\cvfont "],
      ["cvfont", "macro:->\\bfseries "],
      ["cvdate", "macro:->\\protect \\cvdate  "],
      ["cvdate ", "macro:->\\today "],
      ["cvlonely", "macro:->x"],
    ]);
    expect(closure("cventry", meanings)).toEqual({
      dependencies: ["cvtitle", "cvdate", "cvfont", "cvdate "],
      capped: false,
    });
  });

  test("stops at its caps of macros and bytes", () => {
    const chain = new Map<string, string>();
    for (let i = 0; i < 100; i++) chain.set(`cv${i}`, `macro:->\\cv${i + 1} `);
    const long = closure("cv0", chain);
    expect(long.capped).toBe(true);
    expect(long.dependencies).toHaveLength(MAX_CLOSURE_MACROS - 1);
    const big = new Map([
      ["cvbig", "macro:->\\cvhuge \\cvother "],
      ["cvhuge", `macro:->${"x".repeat(70_000)}`],
      ["cvother", "macro:->y"],
    ]);
    expect(closure("cvbig", big)).toEqual({ dependencies: [], capped: true });
  });
});

describe("the records a compile writes", () => {
  test("reads names, meanings, specifications and the end", () => {
    const printout = readPrintout(
      [
        "N:cvxp",
        "M:\\protected macro:->x",
        "S:s o m",
        "N:cvgone ",
        "M:undefined",
        "T:",
        "E:",
        "",
      ].join("\n"),
    );
    expect([...printout.records]).toEqual([
      ["cvxp", { meaning: "\\protected macro:->x", spec: "s o m" }],
      ["cvgone ", { meaning: "undefined" }],
    ]);
    expect(printout).toMatchObject({ ended: true, truncated: true });
  });

  test("writes names a line each, with a mark for the spaces TeX drops", () => {
    expect(nameLines(["cvrobust ", "cvopt"])).toBe("cvrobust |\ncvopt|\n");
  });

  test("prints, in the kernel's compile, only the names it is given", () => {
    expect(meaningsCode(false)).toContain("\\bool_set_false:N \\l__rtsig_follow_bool");
    expect(meaningsCode(true)).toContain("\\bool_set_true:N \\l__rtsig_follow_bool");
  });
});

describe.skipIf(!engineAvailable())("the signatures from the engine", () => {
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

  /** An invented preamble that defines each of the three shapes, an xparse command and more. */
  const PREAMBLE = String.raw`
\newcommand{\cventry}[4]{\textbf{#1} \hfill \cvdate{#4}\\ \emph{#2}, #3\par}
\newcommand{\cvdate}[1]{\textit{#1}}
\newcommand{\cvopt}[2][Invented]{[#1] #2\par}
\DeclareRobustCommand{\cvrobust}[1]{\textsc{#1}}
\NewDocumentCommand{\cvxp}{s o m}{\IfBooleanTF{#1}{*}{}#3\par}
\NewDocumentEnvironment{cvitems}{o}{\begin{itemize}}{\end{itemize}}
\newenvironment{cvbox}[1]{\par\textbf{#1}\par}{\par}
\def\cvdelim#1.{#1}
\newlength{\cvgap}
\newcommand{\cvlong}{\iffalse ${"invented ".repeat(3_000)}\fi}
`;
  const BODY = String.raw`\begin{document}
\section{Invented Experience}
\cventry{Invented Role}{Invented Labs}{Harbour City}{Jan 2020 -- Present}
\cvopt{Plain} \cvopt[Other]{Plain}
\cvrobust{Quill}
\cvxp*[x]{Wort}
\begin{cvitems}
  \item One invented thing
  \item Another \textbf{invented} thing
\end{cvitems}
\begin{cvbox}{Box}Inside\end{cvbox}
\cvdelim Stop. \cvgap=2pt \copyright \cvlong
\end{document}
`;
  const take = (main: string): Intake => {
    const taken = intake(
      { name: "invented.zip", bytes: zipSync({ "cv.tex": strToU8(main) }) },
      { tree },
    );
    if (isRefusal(taken)) throw new Error(`refused at intake: ${taken.message}`);
    return taken;
  };

  /** Part A and the parse of an invented document, and its printed body compiled again. */
  async function run(main: string) {
    const taken = take(main);
    const made = await reference(session, fonts, taken);
    if (isRefusal(made)) throw new Error(`refused: ${made.message}`);
    const body = bodyOf(taken);
    if (isRefusal(body)) throw new Error(body.message);
    const read = readBody(body);
    if (isRefusal(read)) throw new Error(read.message);
    const found = await signatures(session, taken, made, body, usesOf(read));
    if (isRefusal(found)) throw new Error(`no signatures: ${found.log?.slice(-2000)}`);
    const built = buildTree(read, found);
    if (isRefusal(built)) throw new Error(built.message);
    const printed = print(built);
    expect(printed).toBe(body.text);
    const again = await compileLikeReference(
      session,
      fonts,
      taken,
      made,
      encodeLike(taken.main.bytes, body.before + printed + body.after) ?? new Uint8Array(),
    );
    if (isRefusal(again)) throw new Error(`the round trip stopped: ${again.message}`);
    return { made, found, built, same: sameGlyphs(made as Reference, again.stream) };
  }

  const expectShapes = (found: EngineSignatures) => {
    expect(found.commands.cventry).toEqual({ kind: "template", how: "meaning", spec: "m m m m" });
    expect(found.commands.cvopt).toEqual({ kind: "template", how: "optional", spec: "o m" });
    expect(found.commands.cvrobust).toEqual({ kind: "template", how: "robust", spec: "m" });
    expect(found.commands.cvxp).toEqual({ kind: "template", how: "xparse", spec: "s o m" });
    expect(found.commands.cvdelim).toEqual({
      kind: "template",
      how: "unresolved",
      why: "delimited",
    });
    expect(found.commands.cvgap).toEqual({ kind: "register", how: "unresolved", why: "register" });
    expect(found.commands.copyright).toMatchObject({ kind: "standard", how: "robust", spec: "" });
    expect(found.environments.cvitems).toEqual({ kind: "template", how: "xparse", spec: "o" });
    expect(found.environments.cvbox).toEqual({ kind: "template", how: "meaning", spec: "m" });
    // The template's macros, and those they hand their work to; none of the kernel's.
    expect(Object.keys(found.macros)).toEqual(
      expect.arrayContaining([
        "cventry",
        "cvdate",
        "cvopt",
        "\\cvopt",
        "cvrobust",
        "cvrobust ",
        "cvxp",
        "cvxp code",
      ]),
    );
    expect(Object.keys(found.macros)).not.toContain("@protected@testopt");
    expect(found.macros.cventry?.dependencies).toEqual(["cvdate"]);
    expect(found.macros.cvopt?.dependencies).toEqual(["\\cvopt"]);
    expect(found.macros.cventry?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(found.truncated).toBe(false);
    // A meaning of 27,000 characters comes back whole, one line of the file.
    expect(found.macros.cvlong?.meaning.length).toBeGreaterThan(27_000);
  };

  test("reads the three shapes, xparse's and an environment's on pdfTeX, and the tree compiles back", async () => {
    const { made, found, built, same } = await run(`\\documentclass{article}\n${PREAMBLE}${BODY}`);
    expect(made.engine).toBe("pdftex");
    expectShapes(found);
    expect(built.content.map((node) => node.kind)).toEqual([
      "section",
      "call",
      "call",
      "call",
      "call",
      "call",
      "environment",
      "environment",
      "raw",
      "text",
      "raw",
      "raw",
      "call",
    ]);
    expect(same).toBe(true);
  }, 60_000);

  test("reads them on XeTeX the same, each macro to the same hash, and the tree compiles back", async () => {
    const pdftex = await run(`\\documentclass{article}\n${PREAMBLE}${BODY}`);
    const { made, found, same } = await run(
      `\\documentclass{article}\n\\usepackage{fontspec}\n\\setmainfont{Roboto}\n${PREAMBLE}${BODY}`,
    );
    expect(made.engine).toBe("xetex");
    expectShapes(found);
    expect(found.macros.cventry?.hash).toBe(pdftex.found.macros.cventry?.hash);
    expect(same).toBe(true);
  }, 60_000);

  test("gives a class's macros from the engine, never from reading the class", async () => {
    const cls = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{inventedcv}
\LoadClass{article}
\newcommand{\cvname}[2]{{\Large #1 \textbf{#2}}\par}
`;
    const taken = intake(
      {
        name: "invented.zip",
        bytes: zipSync({
          "cv.tex": strToU8(
            "\\documentclass{inventedcv}\n\\begin{document}\n\\cvname{Quill}{Invented}\n\\end{document}\n",
          ),
          "inventedcv.cls": strToU8(cls),
        }),
      },
      { tree },
    );
    if (isRefusal(taken)) throw new Error(taken.message);
    const made = await reference(session, fonts, taken);
    if (isRefusal(made)) throw new Error(made.message);
    const body = bodyOf(taken);
    if (isRefusal(body)) throw new Error(body.message);
    const read = readBody(body);
    if (isRefusal(read)) throw new Error(read.message);
    const found = await signatures(session, taken, made, body, usesOf(read));
    if (isRefusal(found)) throw new Error("no signatures");
    expect(found.commands.cvname).toEqual({ kind: "template", how: "meaning", spec: "m m" });
    expect(found.macros.cvname?.meaning).toBe(
      "\\long macro:#1#2->{\\Large #1 \\textbf {#2}}\\par ",
    );
  }, 60_000);
});
