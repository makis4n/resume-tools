import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keyOf, NAMING_VERSION, sha256 } from "@resume-tools/naming";
import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { readTree } from "./fonts";
import { encodeLike, type Intake, intake } from "./intake";
import { environmentKeysOf, keyInputs, keysOf } from "./keys";
import { buildRequest } from "./naming";
import { bodyOf, bodyOfText, buildTree, parseBody, readBody, type Uses, usesOf } from "./parse";
import { print } from "./print";
import { compileLikeReference, type Reference, reference, sameGlyphs } from "./reference";
import { isRefusal } from "./refusal";
import {
  closure,
  type EngineSignatures,
  isData,
  isScratch,
  LAYOUT_TYPEOUT,
  layoutOfLog,
  linesOf,
  MAX_CLOSURE_MACROS,
  masked,
  meaningsCode,
  nameLines,
  namesIn,
  type Printed,
  readLayout,
  readMeaning,
  readPrintout,
  resolve,
  signatures,
  type TemplateMacro,
  tokensOf,
  xparseSpec,
} from "./signatures";

// Every meaning, document and macro here is invented for these tests; the meanings are as the
// signature compile prints them, every printable character a letter, written out by hand.

const printed = (entries: Record<string, string | Printed>) =>
  new Map<string, Printed>(
    Object.entries(entries).map(([name, value]) => [
      name,
      typeof value === "string" ? { meaning: value } : value,
    ]),
  );

/** A template macro that is a definition, or a failure naming it. */
function definition(found: Pick<EngineSignatures, "macros">, name: string): TemplateMacro {
  const macro = found.macros[name];
  if (macro === undefined || macro.kind === "data") throw new Error(`${name} is no definition`);
  return macro;
}

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

  test("reads a meaning's tokens as the compile prints them", () => {
    expect(tokensOf("\\textbf {#1}\\ \\' e##2\\2\\cvtwo x")).toEqual([
      { kind: "cs", name: "textbf" },
      { kind: "open" },
      { kind: "parameter", text: "#1" },
      { kind: "close" },
      { kind: "cs", name: " " },
      { kind: "cs", name: "'" },
      { kind: "char", text: "e" },
      { kind: "parameter", text: "##" },
      { kind: "char", text: "2" },
      { kind: "cs", name: "2\\cvtwo" },
      { kind: "char", text: "x" },
    ]);
  });
});

describe("reading a command's arguments from its meaning", () => {
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
      "?": "macro:->\\x@protect \\? \\protect \\?  ",
      "? ": "\\long macro:->\\kern 1pt",
    });
    expect(resolve("cvrobust", records)).toEqual({ spec: "m", how: "robust" });
    expect(resolve("cvboth", records)).toEqual({ spec: "o m", how: "robust" });
    expect(resolve("?", records)).toEqual({ spec: "", how: "robust" });
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

describe("a look ahead by hand", () => {
  test("reads a look ahead through the branch it hands to", () => {
    const records = printed({
      cvahead: "macro:->\\@ifnextchar [\\cv@a \\cv@b ",
      "cv@a": "\\long macro:[#1]#2#3->#1#2#3",
      "cv@b": "macro:#1#2->\\cv@a [x]{#1}{#2}",
      cvbraced: "macro:->\\@ifnextchar [{\\cv@a }{\\cv@a [x]}",
      cvstar: "macro:->\\@ifstar {\\cv@s }{\\cv@n }",
      "cv@s": "\\long macro:#1->#1",
      "cv@n": "\\long macro:#1->\\textbf {#1}",
      cvnextstar: "macro:->\\@ifnextchar *{\\cv@takestar }{\\cv@n }",
      "cv@takestar": "macro:*#1->#1",
    });
    expect(resolve("cvahead", records)).toEqual({ spec: "o m m", how: "optional" });
    expect(resolve("cvbraced", records)).toEqual({ spec: "o m m", how: "optional" });
    expect(resolve("cvstar", records)).toEqual({ spec: "s m", how: "optional" });
    expect(resolve("cvnextstar", records)).toEqual({ spec: "s m", how: "optional" });
  });

  test("reads europecv's \\ecvitem past the flag its star sets: s o m m", () => {
    const records = printed({
      ecvitem:
        "\\long macro:->\\@ifstar {\\@ecvitemstartrue \\@ecvitem }{\\@ecvitemstarfalse \\@ecvitem }",
      "@ecvitemstartrue": "macro:->\\let \\if@ecvitemstar \\iftrue ",
      "@ecvitemstarfalse": "macro:->\\let \\if@ecvitemstar \\iffalse ",
      "@ecvitem": "macro:->\\@protected@testopt \\@ecvitem \\\\@ecvitem {2pt}",
      "\\@ecvitem":
        "\\long macro:[#1]#2#3->\\if@ecvitemstar \\ecvbullet \\ \\fi #2\\vspace {#1} & #3 \\vspace {#1}",
    });
    expect(resolve("ecvitem", records)).toEqual({ spec: "s o m m", how: "optional" });
    // Ending with `\tabularnewline`, as europecv's does, which is `\relax` when the preamble ends
    // and looks ahead for `[` inside the table: the arguments are read, and the tail marked.
    records.set("\\@ecvitem", {
      meaning: "\\long macro:[#1]#2#3->#2\\vspace {#1} & #3 \\vspace {#1}\\tabularnewline ",
    });
    expect(resolve("ecvitem", records)).toEqual({
      spec: "s o m m",
      how: "optional",
      tail: "unresolved",
    });
  });

  test("walks a branch past `\\def`, `\\let`, `\\relax` and `\\global`", () => {
    const records = printed({
      cvlet:
        "\\long macro:->\\@ifstar {\\let \\cv@style \\bfseries \\cv@entry }{\\let \\cv@style =\\relax \\cv@entry }",
      cvdef:
        "\\long macro:->\\@ifstar {\\def \\cv@mark {*}\\cv@entry }{\\def \\cv@mark {}\\cv@entry }",
      cvrelax:
        "\\long macro:->\\@ifstar {\\relax \\cv@entry }{\\global \\@cvfalse \\relax \\cv@entry }",
      cvscratch: "macro:->\\@ifnextchar [{\\def \\cv@scratch {x}\\cv@opt }{\\cv@opt []}",
      cvsetup: "\\long macro:->\\@ifstar {\\cv@bold \\cv@entry }{\\cv@entry }",
      "cv@entry": "\\long macro:#1#2->#1#2",
      "cv@opt": "macro:[#1]#2->#1#2",
      "cv@bold": "macro:->\\bfseries ",
    });
    for (const name of ["cvlet", "cvdef", "cvrelax", "cvsetup"])
      expect(resolve(name, records)).toEqual({ spec: "s m m", how: "optional" });
    expect(resolve("cvscratch", records)).toEqual({ spec: "o m", how: "optional" });
  });

  test("never reads a star alone: a branch that takes nothing, or two that differ, are unresolved", () => {
    const records = printed({
      cvflags: "macro:->\\@ifstar {\\@cvtrue }{\\@cvfalse }",
      cvsetups: "macro:->\\@ifstar {\\cv@bold }{\\cv@bold }",
      cvdiffer: "macro:->\\@ifstar {\\cv@one }{\\cv@two }",
      cvbib: "macro:->\\@ifstar {\\cv@one {}}{\\cv@one }",
      "cv@bold": "macro:->\\bfseries ",
      "cv@one": "macro:#1->#1",
      "cv@two": "macro:#1#2->#1#2",
    });
    for (const name of ["cvflags", "cvsetups", "cvdiffer", "cvbib"])
      expect(resolve(name, records)).toEqual({ how: "unresolved", why: "looks ahead" });
  });
});

describe("what a macro hands its arguments on to", () => {
  const records = printed({
    cvsymbol: "\\long macro:->\\Pisymbol {pzd}",
    Pisymbol: "\\long macro:#1#2->{\\Pifont {#1}\\char #2}",
    cvpart: "\\long macro:#1->\\cvthree {#1}",
    cvthree: "\\long macro:#1#2#3->#1#2#3",
    cvhand: "macro:->\\cvtwoargs ",
    cvtwoargs: "macro:#1#2->#1#2",
    cvsect: "\\long macro:->\\section ",
    cvnote: "macro:->\\footnote ",
    cvbold: "macro:#1->\\textbf {#1}",
    cvcolour: "macro:#1->\\textcolor {accent}{#1}",
  });

  test("takes what the command its replacement text ends with takes beyond the groups there", () => {
    expect(resolve("cvsymbol", records)).toEqual({ spec: "m", how: "meaning" });
    expect(resolve("cvpart", records)).toEqual({ spec: "m m m", how: "meaning" });
    expect(resolve("cvhand", records)).toEqual({ spec: "m m", how: "meaning" });
    expect(resolve("cvsect", records)).toEqual({ spec: "s o m", how: "meaning" });
    expect(resolve("cvnote", records)).toEqual({ spec: "o m", how: "meaning" });
    expect(resolve("cvbold", records)).toEqual({ spec: "m", how: "meaning" });
    expect(resolve("cvcolour", records)).toEqual({ spec: "m", how: "meaning" });
  });

  test("follows tails three deep, and marks one that goes further", () => {
    const chain = printed({
      cvd0: "macro:->\\cvd1 ",
      cvd1: "macro:->\\cvd2 ",
      cvd2: "macro:->\\cvd3 ",
      cvd3: "macro:#1->#1",
    });
    expect(resolve("cvd0", chain)).toEqual({ spec: "m", how: "meaning" });
    chain.set("cvd3", { meaning: "macro:->\\cvd4 " });
    chain.set("cvd4", { meaning: "macro:#1->#1" });
    expect(resolve("cvd0", chain)).toEqual({ spec: "", how: "meaning", tail: "unresolved" });
  });

  test("marks a tail it cannot read, and keeps the macro's own arguments", () => {
    const marked = printed({
      cvmissing: "macro:#1->\\textbf {#1}\\cvnowhere ",
      cvlater: "macro:#1->#1\\@ifnextchar [{\\cv@opt }{\\cv@opt [x]}",
      cvbranch: "macro:#1->\\@ifstar {\\cv@opt }{\\cv@opt }",
      cvbuilt: "macro:#1->\\csname cv@#1\\endcsname ",
      cvexpand: "macro:->\\expandafter \\cvtwoargs \\cvvalue ",
      cvhalf: "macro:#1->\\ifx \\relax #1\\expandafter \\cvtwoargs \\fi ",
      cvquantity: "macro:->\\vskip ",
      cvtwoargs: "macro:#1#2->#1#2",
      "cv@opt": "macro:[#1]#2->#1#2",
      "@ifstar": "macro:#1->\\@ifnextchar *{\\@firstoftwo {#1}}",
    });
    expect(resolve("cvmissing", marked)).toEqual({
      spec: "m",
      how: "meaning",
      tail: "unresolved",
    });
    for (const name of ["cvlater", "cvbranch", "cvbuilt", "cvhalf"])
      expect(resolve(name, marked)).toEqual({ spec: "m", how: "meaning", tail: "unresolved" });
    for (const name of ["cvexpand", "cvquantity"])
      expect(resolve(name, marked)).toEqual({ spec: "", how: "meaning", tail: "unresolved" });
  });

  test("hands nothing on from a name another command takes, or a quantity's unit", () => {
    const quiet = printed({
      cvdefines: "macro:#1->\\def \\cv@x {#1}",
      cvlets: "macro:->\\let \\cv@x \\cvtwoargs ",
      cvlength: "macro:->\\setlength \\cv@gap \\cvtwoargs ",
      cvkern: "macro:->\\hfill \\kern \\z@ ",
      cvunit: "macro:->\\kern 2\\p@ ",
      cvbox: "macro:#1->\\hbox {#1}",
      cvtwoargs: "macro:#1#2->#1#2",
    });
    for (const name of ["cvlets", "cvlength", "cvkern", "cvunit"])
      expect(resolve(name, quiet)).toEqual({ spec: "", how: "meaning" });
    for (const name of ["cvdefines", "cvbox"])
      expect(resolve(name, quiet)).toEqual({ spec: "m", how: "meaning" });
  });

  test("reads a conditional whose branches all hand on alike, and expl3's functions", () => {
    const records = printed({
      cvifempty:
        "\\long macro:#1->\\ifx \\relax #1\\relax \\expandafter \\@firstoftwo \\else \\expandafter \\@secondoftwo \\fi ",
      cvunlike:
        "macro:#1->\\ifx \\relax #1\\expandafter \\@firstoftwo \\else \\expandafter \\@firstofone \\fi ",
      cvvalue: "\\long macro:#1->\\__cmd_if_no_value:nTF {#1}",
      cvexpl: "macro:->\\cs_set:Npn ",
      "@firstoftwo": "\\long macro:#1#2->#1",
      "@secondoftwo": "\\long macro:#1#2->#2",
      "@firstofone": "\\long macro:#1->#1",
    });
    expect(resolve("cvifempty", records)).toEqual({ spec: "m m m", how: "meaning" });
    expect(resolve("cvunlike", records)).toEqual({
      spec: "m",
      how: "meaning",
      tail: "unresolved",
    });
    expect(resolve("cvvalue", records)).toEqual({ spec: "m m m", how: "meaning" });
    expect(resolve("cvexpl", records)).toEqual({ spec: "", how: "meaning", tail: "unresolved" });
  });

  test("takes a package's table before the meaning, but not for a document's own command", () => {
    const records = printed({
      uline:
        "\\protected macro:->\\relax \\ifmmode \\expandafter \\underline \\else \\bgroup \\expandafter \\ULset \\fi ",
      ifthenelse: "\\long macro:#1->\\toks@ {#1}\\TE@repl \\or \\TE@or ",
      so: "macro:->\\protect \\textso  ",
      "textso ": "macro:->\\SOUL@sosetup \\SOUL@ ",
      ding: "\\long macro:->\\Pisymbol {pzd}",
      Pisymbol: "\\long macro:#1#2->{\\Pifont {#1}\\char #2}",
      sout: "macro:->\\cvtwoargs ",
      cvtwoargs: "macro:#1#2->#1#2",
    });
    expect(resolve("uline", records)).toEqual({ spec: "m", how: "meaning", package: "ulem" });
    expect(resolve("ifthenelse", records)).toEqual({
      spec: "m m m",
      how: "meaning",
      package: "ifthen",
    });
    expect(resolve("so", records)).toEqual({ spec: "m", how: "robust", package: "soul" });
    expect(resolve("ding", records)).toEqual({ spec: "m", how: "meaning", package: "pifont" });
    expect(resolve("sout", records)).toEqual({ spec: "m m", how: "meaning" });
  });

  test("reads twoopt's commands: two optional arguments and the rest", () => {
    const records = printed({
      cvtwo: "macro:->\\@protected@testopt \\cvtwo \\\\cvtwo {a}",
      "\\cvtwo": "\\long macro:[#1]->\\to@ScanSecondOptArg \\2\\cvtwo {#1}{b}",
      "2\\cvtwo": "\\long macro:#1#2#3#4->#1#2#3#4",
    });
    expect(resolve("cvtwo", records)).toEqual({
      spec: "o o m m",
      how: "optional",
      package: "twoopt",
    });
  });
});

describe("the names a meaning names", () => {
  test("reads each name as TeX printed it", () => {
    expect(
      namesIn("\\textbf {#1}\\cv@inner \\hfill \\a \\, x\\\\ \\cv-dash x\\2\\cvtwo {y}"),
    ).toEqual(["textbf", "cv@inner", "hfill", "a", ",", "\\", "cv-dash", "2\\cvtwo"]);
    expect(namesIn("no names #1")).toEqual([]);
  });
});

describe("data and definitions", () => {
  const data = (text: string, calls?: (name: string) => boolean) =>
    isData(readMeaning(text), calls);

  test("reads a macro that holds text, a name, an address, a link or a list of contacts as data", () => {
    expect(data("macro:->Quill")).toBe(true);
    expect(data("macro:->")).toBe(true);
    expect(data("macro:->Jos\\' e Qu\\\" ill\\\\ Invented")).toBe(true);
    expect(data("macro:->Invented Engineer{\\enskip \\cdotp \\enskip }Invented Writer")).toBe(true);
    expect(data("macro:->+1~(555)~010~0000")).toBe(true);
    expect(data("macro:->C\\# and F\\# ")).toBe(true);
    expect(data("macro:->\\href {mailto:quill@example.invalid}{quill@example.invalid}")).toBe(true);
    expect(data("macro:->\\textsc {Quill}\\vspace {1pt}\\relax ")).toBe(true);
    const calls = (name: string) => name === "email" || name === "cvphone";
    expect(data("macro:->\\email {quill@example.invalid}\\smallskip \\cvphone {555}", calls)).toBe(
      true,
    );
  });

  test("reads a macro that takes a parameter, or names code, as a definition", () => {
    expect(data("macro:#1->Quill #1")).toBe(false);
    expect(data("macro:->\\cvrule ")).toBe(false);
    expect(data("macro:->\\@firstname \\ \\@lastname ")).toBe(false);
    expect(data("macro:->\\email {quill@example.invalid}")).toBe(false);
    expect(data("macro:->\\email \\cvphone ", (name) => name === "email")).toBe(false);
    expect(data("macro:->\\begin {itemize}")).toBe(false);
    expect(data('\\char"41')).toBe(false);
  });

  test("masks emails, links and phone numbers by placeholders of their own length", () => {
    const hidden = (kind: string, found: string) =>
      `<${kind}${"_".repeat(found.length - kind.length - 2)}>`;
    const [email, link, bare, phone] = [
      "quill@example.invalid",
      "https://example.invalid/quill",
      "github.com/quill",
      "+1 (555) 010-0000",
    ] as const;
    const text = `macro:#1->#1 ${email} \\href {${link}}{${bare}} ${phone}`;
    const out = masked(text);
    expect(out).toHaveLength(text.length);
    expect(out).toBe(
      `macro:#1->#1 ${hidden("email", email)} \\href {${hidden("link", link)}}{${hidden("link", bare)}} ${hidden("phone", phone)}`,
    );
    expect(masked("macro:->wrens@example.invalid")).toBe(masked("macro:->quill@example.invalid"));
    // Six digits are no phone number; seven with separators are, a date's among them.
    expect(masked("macro:->\\kern 2pt \\hskip 1.5em 2020-12")).toBe(
      "macro:->\\kern 2pt \\hskip 1.5em 2020-12",
    );
    expect(masked("macro:->2020-12-31")).toBe(`macro:->${hidden("phone", "2020-12-31")}`);
  });

  test("knows LaTeX's, xkeyval's and expl3's scratch macros", () => {
    for (const name of ["@tempa", "@tempdima", "reserved@a", "Gin@tempa", "XKV@tfam"])
      expect(isScratch(name)).toBe(true);
    for (const name of ["LTXcmds@x", "@gtempa", "@currenvir", "CurrentOption", "@xifnch"])
      expect(isScratch(name)).toBe(true);
    for (const name of ["l__cv_tl", "g_cv_int", "c_cv_str", "ver@xkeyval.sty", "opt@cv.cls"])
      expect(isScratch(name)).toBe(true);
    for (const name of ["cventry", "@firstname", "cv@temperature", "makecvheader", "next@cv"])
      expect(isScratch(name)).toBe(false);
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

  test("names a macro that holds data, follows it no further, and counts it against no cap", () => {
    const meanings = new Map([
      ["cvhead", "macro:->\\textsc {\\@firstname }\\cvsep \\@email "],
      ["cvsep", "macro:->\\enskip \\cvrule "],
      ["cvrule", "macro:->\\rule {1pt}{1em}"],
    ]);
    expect(closure("cvhead", meanings, new Set(["@firstname", "@email"]))).toEqual({
      dependencies: ["@firstname", "cvsep", "@email", "cvrule"],
      capped: false,
    });
    const chain = new Map<string, string>();
    const held = new Set<string>();
    for (let i = 0; i < 100; i++) {
      chain.set(`cv${i}`, `macro:->\\@held${i} \\cv${i + 1} `);
      held.add(`@held${i}`);
    }
    const long = closure("cv0", chain, held);
    expect(long.capped).toBe(true);
    expect(long.dependencies.filter((name) => chain.has(name))).toHaveLength(
      MAX_CLOSURE_MACROS - 1,
    );
  });

  test("keys a definition by its hash and its dependencies', data taking no part", async () => {
    const macros: EngineSignatures["macros"] = {
      cvhead: { meaning: "a", hash: "h1", dependencies: ["@firstname", "cvsep"], capped: false },
      cvsep: { meaning: "b", hash: "h2", dependencies: [], capped: false },
      "@firstname": { kind: "data", length: 5 },
    };
    const keys = await keysOf({ macros });
    expect(Object.keys(keys)).toEqual(["cvhead", "cvsep"]);
    expect(keys.cvhead).toMatch(/^[0-9a-f]{64}$/);
    const renamed = { ...macros, "@firstname": { kind: "data" as const, length: 9 } };
    expect((await keysOf({ macros: renamed })).cvhead).toBe(keys.cvhead);
    const unset = {
      cvhead: { ...definition({ macros }, "cvhead"), dependencies: ["cvsep"] },
      cvsep: definition({ macros }, "cvsep"),
    };
    expect((await keysOf({ macros: unset })).cvhead).toBe(keys.cvhead);
    const changed = { ...macros, cvsep: { ...definition({ macros }, "cvsep"), hash: "h3" } };
    expect((await keysOf({ macros: changed })).cvhead).not.toBe(keys.cvhead);
  });
});

describe("an environment's key", () => {
  /**
   * An invented template: an entry, a list whose `\begin` and `\end` codes both hand their work to
   * one gap, and a note whose `\end` code is empty, which holds data as the engine reads it.
   */
  const MEANINGS: Record<string, string> = {
    cventry: "macro:#1#2->\\textbf {#1}\\hfill {\\color {gray}#2}\\par ",
    cvlist: "macro:->\\begin {itemize}\\cvlist@gap ",
    endcvlist: "macro:->\\end {itemize}\\cvlist@gap \\cvlist@rule ",
    "cvlist@gap": "macro:->\\vspace {-2pt}",
    "cvlist@rule": "macro:->\\hrule ",
    cvnote: "macro:->\\par \\small \\itshape ",
  };

  async function inventedSignatures(meanings = MEANINGS): Promise<EngineSignatures> {
    const texts = new Map(Object.entries(meanings));
    const macros: EngineSignatures["macros"] = {};
    for (const [name, meaning] of texts)
      macros[name] = { meaning, hash: await sha256(meaning), ...closure(name, texts) };
    macros.endcvnote = { kind: "data", length: 0 };
    const template = (spec: string) => ({
      kind: "template" as const,
      spec,
      how: "meaning" as const,
    });
    return {
      engine: "pdftex",
      commands: { cventry: template("m m") },
      environments: { cvlist: template(""), cvnote: template("") },
      macros,
      truncated: false,
      ms: 0,
    };
  }

  const BODY = String.raw`
\begin{cvlist}
\item Invented a thing for an invented client.
\end{cvlist}
\begin{cvnote}
An invented note.
\end{cvnote}
\cventry{Invented Role}{Invented Labs}
`;

  test("is the one the request gives it, its end code first and both closures after", async () => {
    const found = await inventedSignatures();
    const tree = parseBody(bodyOfText(BODY), found);
    if (isRefusal(tree)) throw new Error(tree.message);
    const built = await buildRequest(tree, found, { macros: [], candidates: [] }, "");
    if (isRefusal(built)) throw new Error(built.message);
    const { request } = built;
    const keys = await keysOf(found);
    for (const [of, name] of [
      ["environment", "cvlist"],
      ["environment", "cvnote"],
      ["command", "cventry"],
    ] as const) {
      const macro = request.macros.find((each) => each.of === of && each.name === name);
      expect(macro?.key, name).toMatch(/^[0-9a-f]{64}$/);
      expect(keys[name], name).toBe(macro?.key);
    }
    expect(await environmentKeysOf(found)).toEqual({ cvlist: keys.cvlist, cvnote: keys.cvnote });
    // The list's key covers its end code and the rule only that hands its work to, the gap once.
    const inputs = keyInputs(found, "environment", "cvlist");
    expect(inputs?.dependencies.map(([name]) => name)).toEqual([
      "endcvlist",
      "cvlist@gap",
      "cvlist@rule",
    ]);
    expect(await keyOf(NAMING_VERSION, inputs?.hash ?? "", inputs?.dependencies ?? [])).toBe(
      keys.cvlist,
    );
    // An end code that holds data is left out, as every dependency that holds data is: the note's
    // key is its begin code's alone.
    expect(keyInputs(found, "environment", "cvnote")?.dependencies).toEqual([]);
    expect(keys.cvnote).toBe((await keysOf({ macros: found.macros })).cvnote);
    // Its begin code alone, as a command, is keyed without the end.
    expect(keys.cvlist).not.toBe((await keysOf({ macros: found.macros })).cvlist);
  });

  test("moves when the end code does, which the begin code's own key never sees", async () => {
    const found = await inventedSignatures();
    const moved = await inventedSignatures({
      ...MEANINGS,
      endcvlist: "macro:->\\end {itemize}\\cvlist@gap \\bigskip ",
    });
    expect((await keysOf(moved)).cvlist).not.toBe((await keysOf(found)).cvlist);
    expect((await keysOf({ macros: moved.macros })).cvlist).toBe(
      (await keysOf({ macros: found.macros })).cvlist,
    );
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

  test("reads each line as UTF-8 where it is and Latin-1 where it is not", () => {
    const bytes = new Uint8Array([
      ...strToU8("N:cva\nM:macro:->Zo"),
      0xc3,
      0xab,
      ...strToU8("\nN:cvb\nM:macro:->Zo"),
      0xeb,
      ...strToU8("\nE:\n"),
    ]);
    expect(linesOf(bytes)).toBe("N:cva\nM:macro:->Zoë\nN:cvb\nM:macro:->Zoë\nE:\n");
  });

  test("writes names a line each, with a mark for the spaces TeX drops", () => {
    expect(nameLines(["cvrobust ", "cvopt"])).toBe("cvrobust |\ncvopt|\n");
  });

  test("prints, in the kernel's compile, only the names it is given, each meaning escaped", () => {
    expect(meaningsCode(false)).toContain("\\bool_set_false:N \\l__rtsig_follow_bool");
    expect(meaningsCode(true)).toContain("\\bool_set_true:N \\l__rtsig_follow_bool");
    expect(meaningsCode(true)).toContain("\\__rtsig_escape:N \\l__rtsig_meaning_str");
  });

  test("reads the document's layout, written first, and none it did not write whole", () => {
    // The document's compile writes it, and the kernel's does not (decision 0040).
    expect(meaningsCode(true)).toContain("L:");
    expect(meaningsCode(false)).not.toContain("L:");
    const printout = readPrintout(
      [
        "L:36.135,36.135,542.02501,722.7,614.295,794.96999,10.95",
        "N:cvx",
        "M:undefined",
        "E:",
      ].join("\n"),
    );
    expect(printout.layout).toEqual({
      left: 36.135,
      top: 36.135,
      width: 542.02501,
      height: 722.7,
      paperWidth: 614.295,
      paperHeight: 794.96999,
      size: 10.95,
    });
    expect([...printout.records.keys()]).toEqual(["cvx"]);
    expect(readLayout("36.135,36.135,542.02501")).toBeUndefined();
    expect(readLayout("36.135,36.135,542.02501,722.7,614.295,794.96999,\\@xipt")).toBeUndefined();
    expect(readLayout("-7.2,0,1,1,1,1,9")?.left).toBe(-7.2);
    expect(readPrintout("N:cvx\nM:undefined\nE:\n").layout).toBeUndefined();
  });

  test("reads the layout a compile's log says, the last it says of each value, and none it says in part", () => {
    // What the fourth check reads of a page a control sets (decision 0040).
    expect(LAYOUT_TYPEOUT.startsWith("\\AtBeginDocument{\\typeout{rtimport:layout left=")).toBe(
      true,
    );
    const log = [
      "(./invented.tex",
      "rtimport:layout left=40.0pt",
      "rtimport:layout left=36.135pt",
      "rtimport:layout top=36.135pt",
      "rtimport:layout width=542.02501pt",
      "rtimport:layout height=722.7pt",
      "rtimport:layout paperWidth=614.295pt",
      "rtimport:layout paperHeight=794.96999pt",
      "rtimport:layout size=10.95",
      ")",
    ].join("\n");
    expect(layoutOfLog(log)).toEqual({
      left: 36.135,
      top: 36.135,
      width: 542.02501,
      height: 722.7,
      paperWidth: 614.295,
      paperHeight: 794.96999,
      size: 10.95,
    });
    expect(layoutOfLog(log.replace("rtimport:layout size=10.95", ""))).toBeUndefined();
    expect(layoutOfLog("rtimport:layout left=36.135pt and more")).toBeUndefined();
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
    tree = readTree(manifest.files, manifest.fonts);
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
  const take = (files: Record<string, string>): Intake => {
    const zipped = Object.fromEntries(
      Object.entries(files).map(([path, text]) => [path, strToU8(text)]),
    );
    const taken = intake({ name: "invented.zip", bytes: zipSync(zipped) }, { tree });
    if (isRefusal(taken)) throw new Error(`refused at intake: ${taken.message}`);
    return taken;
  };

  /** Part A of an invented upload: its reference, and the signatures of what `uses` names. */
  async function signaturesOf(files: Record<string, string>, uses?: Uses) {
    const taken = take(files);
    const made = await reference(session, fonts, taken);
    if (isRefusal(made)) throw new Error(`refused: ${made.message}`);
    const body = bodyOf(taken);
    if (isRefusal(body)) throw new Error(body.message);
    const read = readBody(body);
    if (isRefusal(read)) throw new Error(read.message);
    const found = await signatures(session, taken, made, body, uses ?? usesOf(read));
    if (isRefusal(found)) throw new Error(`no signatures: ${found.log?.slice(-2000)}`);
    return { taken, made, body, read, found };
  }

  /** Part A and the parse of an invented document, and its printed body compiled again. */
  async function run(main: string) {
    const { taken, made, body, read, found } = await signaturesOf({ "cv.tex": main });
    const built = buildTree(read, found);
    if (isRefusal(built)) throw new Error(built.message);
    const printedBody = print(built);
    expect(printedBody).toBe(body.text);
    const again = await compileLikeReference(
      session,
      fonts,
      taken,
      made,
      encodeLike(taken.main.bytes, body.before + printedBody + body.after) ?? new Uint8Array(),
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
    expect(definition(found, "cventry").dependencies).toEqual(["cvdate"]);
    expect(definition(found, "cvopt").dependencies).toEqual(["\\cvopt"]);
    expect(definition(found, "cventry").hash).toMatch(/^[0-9a-f]{64}$/);
    expect(found.truncated).toBe(false);
    // A meaning of 27,000 characters comes back whole, one line of the file.
    expect(definition(found, "cvlong").meaning.length).toBeGreaterThan(27_000);
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
    expect(definition(found, "cventry").hash).toBe(definition(pdftex.found, "cventry").hash);
    expect(same).toBe(true);
  }, 60_000);

  test("gives a class's macros from the engine, never from reading the class", async () => {
    const cls = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{inventedcv}
\LoadClass{article}
\newcommand{\cvname}[2]{{\Large #1 \textbf{#2}}\par}
`;
    const { found } = await signaturesOf({
      "cv.tex":
        "\\documentclass{inventedcv}\n\\begin{document}\n\\cvname{Quill}{Invented}\n\\end{document}\n",
      "inventedcv.cls": cls,
    });
    expect(found.commands.cvname).toEqual({ kind: "template", how: "meaning", spec: "m m" });
    expect(definition(found, "cvname").meaning).toBe(
      "\\long macro:#1#2->{\\Large #1 \\textbf {#2}}\\par ",
    );
  }, 60_000);

  test("writes a meaning holding line breaks, tabs and every control character whole, the same on both engines", async () => {
    const hat = (code: number) => (code < 64 ? `^^${String.fromCharCode(code + 64)}` : "^^?");
    const codes = [...Array.from({ length: 31 }, (_, i) => i + 1), 127];
    const nameOf = (code: number) =>
      `cvcontrol${String.fromCharCode(97 + Math.floor(code / 26))}${String.fromCharCode(97 + (code % 26))}`;
    const defined = codes
      .map(
        (code) =>
          `\\begingroup\\catcode ${code}=12 \\gdef\\${nameOf(code)}#1{A${hat(code)}B#1}\\endgroup\n`,
      )
      .join("");
    // The reviewer's case: a line break in a meaning, and what would read as records after it.
    const preamble = `${defined}\\begingroup\\catcode 10=12 \\gdef\\cvnl#1{A^^JN:fake^^JM:\\relax #1}\\endgroup
\\newcommand{\\cvuse}{${codes.map((code) => `\\${nameOf(code)}{x}`).join("")}\\cvnl{x}}
\\begin{document}
Invented text.
\\end{document}
`;
    const uses: Uses = { commands: ["cvuse"], environments: [] };
    const pdftex = await signaturesOf({ "cv.tex": `\\documentclass{article}\n${preamble}` }, uses);
    const xetex = await signaturesOf(
      { "cv.tex": `\\documentclass{article}\n\\usepackage{fontspec}\n${preamble}` },
      uses,
    );
    expect(pdftex.made.engine).toBe("pdftex");
    expect(xetex.made.engine).toBe("xetex");
    for (const { found } of [pdftex, xetex]) {
      expect(definition(found, "cvnl").meaning).toBe("macro:#1->A^^JN:fake^^JM:\\relax #1");
      expect(Object.keys(found.macros)).not.toContain("fake");
      for (const code of codes)
        expect(definition(found, nameOf(code)).meaning).toBe(`macro:#1->A${hat(code)}B#1`);
    }
    for (const name of ["cvnl", ...codes.map(nameOf)])
      expect(definition(xetex.found, name).hash).toBe(definition(pdftex.found, name).hash);
  }, 60_000);

  /** An invented class in Awesome-CV's style: the person's header in macros, and one that sets it. */
  const HEADER_CLASS = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{inventedheader}
\LoadClass{article}
\RequirePackage{hyperref}
\newcommand*{\name}[2]{\def\@firstname{#1}\def\@lastname{#2}}
\newcommand*{\position}[1]{\def\@position{#1}}
\newcommand*{\mobile}[1]{\def\@mobile{#1}}
\newcommand*{\email}[1]{\def\@email{#1}}
\newcommand*{\personalinfo}[1]{\def\@personalinfo{#1}}
\newcommand{\cvfield}[1]{\mbox{#1}\quad}
\newcommand{\headerstyle}[1]{{\Large\bfseries #1}}
\newcommand{\makecvheader}{%
  \headerstyle{\@firstname\ \@lastname}\par
  \@position\par
  \href{mailto:\@email}{\@email}\quad\@mobile\par
  \@personalinfo\par}
\newcommand{\cvsection}[1]{\section*{#1}}
`;
  const headerDocument = (preamble: string) => ({
    "cv.tex": `\\documentclass{inventedheader}
${preamble}
\\begin{document}
\\makecvheader
\\cvsection{Invented Experience}
\\cvfooter{Invented}
\\end{document}
`,
    "inventedheader.cls": HEADER_CLASS,
  });

  test("keeps a person's header as data, and gives the class's header one hash whoever it names", async () => {
    const quill = await signaturesOf(
      headerDocument(String.raw`\name{Quill}{Invented}
\position{Invented Engineer{\enskip$\cdotp$\enskip}Invented Writer}
\mobile{+1~(555)~010~0000}
\email{quill@example.invalid}
\personalinfo{\cvfield{Harbour City}\smallskip\cvfield{Quillsite}}
\newcommand{\cvfooter}[1]{#1 --- write to quill@example.invalid or call +1 555 010 0000}`),
    );
    const wren = await signaturesOf(
      headerDocument(String.raw`\name{Jos\'e}{Wr\"en}
\position{Other Invented Role}
\mobile{+44 20 7946 0000}
\email{wrens@example.invalid}
\personalinfo{\cvfield{Other Town}}
\newcommand{\cvfooter}[1]{#1 --- write to wrens@example.invalid or call +1 555 010 9999}`),
    );
    expect(quill.found.macros["@firstname"]).toEqual({ kind: "data", length: "Quill".length });
    expect(quill.found.macros["@email"]).toEqual({
      kind: "data",
      length: "quill@example.invalid".length,
    });
    expect(quill.found.macros["@mobile"]).toEqual({
      kind: "data",
      length: "+1~(555)~010~0000".length,
    });
    for (const found of [quill.found, wren.found])
      for (const name of ["@firstname", "@lastname", "@position", "@email", "@personalinfo"])
        expect(found.macros[name]).toMatchObject({ kind: "data" });
    // No definition holds the person's text.
    for (const [name, macro] of Object.entries(quill.found.macros))
      if (macro.kind !== "data")
        for (const text of ["Quill", "Invented", "Harbour", "example.invalid", "555"])
          expect(macro.meaning.includes(text), `${name} holds ${text}`).toBe(false);
    // The class's header hashes the same, and so does its closure, whoever it names.
    const header = definition(quill.found, "makecvheader");
    expect(definition(wren.found, "makecvheader").hash).toBe(header.hash);
    expect(definition(wren.found, "makecvheader").dependencies).toEqual(header.dependencies);
    expect(header.dependencies).toEqual(expect.arrayContaining(["@firstname", "headerstyle"]));
    for (const name of header.dependencies)
      expect(wren.found.macros[name]).toEqual(
        quill.found.macros[name]?.kind === "data"
          ? expect.objectContaining({ kind: "data" })
          : quill.found.macros[name],
      );
    expect((await keysOf(wren.found)).makecvheader).toBe((await keysOf(quill.found)).makecvheader);
    // A definition holding an email and a phone number hashes the same as one holding others of
    // the same length.
    const footer = definition(quill.found, "cvfooter");
    expect(definition(wren.found, "cvfooter").hash).toBe(footer.hash);
    expect(footer.meaning).toContain("<email");
    expect(footer.meaning).toContain("<phone");
  }, 60_000);

  test("keeps moderncv's header as data", async () => {
    const { found } = await signaturesOf({
      "cv.tex": String.raw`\documentclass[11pt,a4paper,sans]{moderncv}
\moderncvstyle{classic}
\moderncvcolor{blue}
\name{Quill}{Invented}
\title{Invented Engineer}
\address{1 Invented Road}{Harbour City}{Nowhere}
\phone[mobile]{+1~(555)~010~0000}
\email{quill@example.invalid}
\begin{document}
\makecvtitle
\section{Experience}
\cventry{2020--2021}{Invented Role}{Invented Labs}{Harbour City}{}{Did invented things.}
\end{document}
`,
    });
    for (const name of ["@firstname", "@lastname", "@email", "@title", "@addressstreet"])
      expect(found.macros[name]).toMatchObject({ kind: "data" });
    for (const [name, macro] of Object.entries(found.macros))
      if (macro.kind !== "data")
        for (const text of ["Quill", "Invented", "Harbour", "example.invalid", "555"])
          expect(macro.meaning.includes(text), `${name} holds ${text}`).toBe(false);
    expect(found.commands.cventry).toMatchObject({ kind: "template", how: "optional" });
  }, 60_000);

  /** An invented class that keeps settings in keys, as many do with xkeyval. */
  const KEYS_CLASS = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{inventedkeys}
\LoadClass{article}
\RequirePackage{xkeyval}
\define@key{cvinfo}{icon}{\def\cv@icon{#1}}
\define@key{cvinfo}{sep}{\def\cv@sep{#1}}
\newcommand*{\name}[2]{\def\@firstname{#1}\def\@lastname{#2}}
\newcommand{\cvinfo}[2][]{\setkeys{cvinfo}{#1}\cv@icon\cv@sep\textbf{#2}}
\newcommand{\cvhead}{\textsc{\@firstname}~\@lastname\par}
\def\cv@icon{}
\def\cv@sep{}
`;

  test("keys a class's macros the same in two documents that differ in their settings and names", async () => {
    const document = (preamble: string) => ({
      "cv.tex": `\\documentclass{inventedkeys}\n${preamble}\n\\begin{document}\n\\cvhead\n\\cvinfo{Invented}\n\\end{document}\n`,
      "inventedkeys.cls": KEYS_CLASS,
    });
    const one = await signaturesOf(
      document("\\setkeys{cvinfo}{sep={, }}\n\\name{Quill}{Invented}"),
    );
    const two = await signaturesOf(document("\\setkeys{cvinfo}{icon={*}}\n\\name{Wren}{Other}"));
    const keysOne = await keysOf(one.found);
    const keysTwo = await keysOf(two.found);
    for (const name of ["cvinfo", "\\cvinfo", "cvhead"]) {
      expect(keysOne[name], name).toMatch(/^[0-9a-f]{64}$/);
      expect(keysTwo[name], name).toBe(keysOne[name]);
    }
    for (const found of [one.found, two.found]) {
      expect(Object.keys(found.macros).filter(isScratch)).toEqual([]);
      for (const name of ["cv@icon", "cv@sep", "@firstname", "@lastname"])
        expect(found.macros[name]).toMatchObject({ kind: "data" });
    }
  }, 60_000);

  test("reads europecv's entries, packages' commands, a star's flags and twoopt through the engine", async () => {
    const europecv = await signaturesOf({
      "cv.tex": String.raw`\documentclass[helvetica,english,notitle,nologo]{europecv}
\usepackage[T1]{fontenc}
\usepackage[english]{babel}
\usepackage{hyperref}
\ecvname{Invented Person}
\begin{document}
\begin{europecv}
\ecvitem{Invented label}{Invented value}
\ecvitem[4pt]{Other label}{Other value}
\end{europecv}
\end{document}
`,
    });
    // `\tabularnewline` ends the entry, and looks ahead inside the table: the tail is marked.
    expect(europecv.found.commands.ecvitem).toEqual({
      kind: "template",
      how: "optional",
      spec: "s o m m",
      tail: "unresolved",
    });
    const { found } = await signaturesOf({
      "cv.tex": String.raw`\documentclass{article}
\usepackage[normalem]{ulem}
\usepackage{pifont}
\usepackage{ifthen}
\usepackage{soul}
\usepackage{twoopt}
\makeatletter
\newif\if@cvflag
\newcommand\cvflagged{\@ifstar{\@cvflagtrue\cv@flagged}{\@cvflagfalse\cv@flagged}}
\newcommand\cv@flagged[2]{#1#2}
\newcommandtwoopt{\cvtwo}[4][a][b]{#1#2#3#4}
\newcommand\cvpart[1]{\cvthree{#1}}
\newcommand\cvthree[3]{#1#2#3}
\makeatother
\begin{document}
\cvflagged{a}{b} \cvtwo{a}{b} \cvpart{a}{b}{c}
\uline{x} \sout{x} \ding{51} \ifthenelse{\equal{a}{a}}{x}{y} \so{x}
\end{document}
`,
    });
    expect(found.commands.cvflagged).toEqual({ kind: "template", how: "optional", spec: "s m m" });
    expect(found.commands.cvtwo).toEqual({
      kind: "template",
      how: "optional",
      spec: "o o m m",
      package: "twoopt",
    });
    expect(found.commands.cvpart).toEqual({ kind: "template", how: "meaning", spec: "m m m" });
    for (const [name, spec, pkg] of [
      ["uline", "m", "ulem"],
      ["sout", "m", "ulem"],
      ["ding", "m", "pifont"],
      ["ifthenelse", "m m m", "ifthen"],
      ["so", "m", "soul"],
    ] as const)
      expect(found.commands[name]).toMatchObject({ kind: "template", spec, package: pkg });
  }, 60_000);

  test("reads the layout the document sets by hand or through geometry, and the class's size", async () => {
    // Margins set by hand, as Jake's Resume sets them, half an inch on every side of US Letter; and
    // geometry's on A4 at 12 points; each in points, as TeX finds them at \begin{document}
    // (decision 0040).
    const byHand = await signaturesOf({
      "cv.tex": String.raw`\documentclass[letterpaper,11pt]{article}
\usepackage[empty]{fullpage}
\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\textwidth}{1in}
\addtolength{\topmargin}{-.5in}
\addtolength{\textheight}{1.0in}
\begin{document}
Invented words.
\end{document}
`,
    });
    const hand = byHand.found.layout;
    expect(hand?.left).toBeCloseTo(36.135, 3);
    expect(hand?.top).toBeCloseTo(36.135, 3);
    expect(hand?.width).toBeCloseTo(542.025, 3);
    expect(hand?.paperWidth).toBeCloseTo(614.295, 3);
    expect(hand?.size).toBe(10.95);
    const geometry = await signaturesOf({
      "cv.tex": String.raw`\documentclass[a4paper,12pt]{article}
\usepackage[left=2cm,right=2cm,top=1.5cm,bottom=1.5cm]{geometry}
\begin{document}
Invented words.
\end{document}
`,
    });
    const set = geometry.found.layout;
    expect(set?.left).toBeCloseTo((2 / 2.54) * 72.27, 2);
    expect(set?.top).toBeCloseTo((1.5 / 2.54) * 72.27, 2);
    expect(set?.paperWidth).toBeCloseTo(597.508, 3);
    expect(set?.size).toBe(12);
  }, 60_000);
});
