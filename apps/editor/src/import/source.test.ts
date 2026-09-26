import { describe, expect, test } from "vitest";
import { bound, fastest } from "../test/timing";
import { classOptions, engineFrom, optionValues, readSource, viewNeeds } from "./source";

// Every source here is invented for these tests: invented classes, packages and conditionals that
// say so. Nothing is taken from a real resume or template. The corpus's survey reads with these
// (`scripts/corpus-survey.test.ts` tests it on whole invented documents), and the intake too
// (`intake.test.ts`).

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

  test("reads LuaTeX's PDF settings as LuaTeX's, set or asked after", () => {
    const needs = (source: string) => {
      const reading = readSource(source);
      return engineFrom(
        viewNeeds([reading.pdftex], []),
        viewNeeds([reading.xetex], []),
        reading.guarded,
      );
    };
    for (const command of ["pdfvariable", "pdfextension", "pdffeedback"])
      expect(needs(`\\${command} compresslevel=0`), command).toBe("luatex");
    // Asked after, it is a guard like `\directlua`: the branch for LuaTeX is LuaTeX's alone.
    expect(
      needs(
        "\\ifdefined\\pdfvariable \\pdfvariable compresslevel=0 \\else \\pdfcompresslevel=0 \\fi",
      ),
    ).toBe("both");
    expect(needs("\\ifx\\pdfextension\\undefined \\usepackage{invented} \\fi")).toBe("both");
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
    // cube of their number. Each list of 300 options fits the readers' window (`WINDOW`).
    const hostile = (declared: number) => {
      const names = Array.from({ length: declared }, (_, i) => letters(i));
      const list = Array.from({ length: declared * 10 }, (_, i) => `o${names[i % declared]}`);
      return [
        ...names.map((name) => `\\newif\\if@x${name}`),
        ...names.map((name) => `\\DeclareOption{o${name}}{\\@x${name}true}`),
        ...Array.from(
          { length: list.length / 300 },
          (_, i) => `\\ExecuteOptions{${list.slice(i * 300, (i + 1) * 300).join(",")}}`,
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
