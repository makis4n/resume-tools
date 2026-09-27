import { describe, expect, test } from "vitest";
import { packageSignature, twooptSpec } from "./packages";

// The meanings here are the packages' own, as the signature compile prints them (TeX Live 2023);
// the documents' are invented.

describe("the arguments of packages' commands", () => {
  test("reads ulem's underlines, pifont's ding, ifthen's test and soul's commands", () => {
    expect(
      packageSignature(
        "uline",
        "\\protected macro:->\\relax \\ifmmode \\expandafter \\underline \\else \\bgroup \\expandafter \\ULset \\fi ",
      ),
    ).toEqual({ spec: "m", package: "ulem" });
    expect(
      packageSignature(
        "xout",
        "\\protected macro:->\\leavevmode \\bgroup \\markoverwith {\\hbox to.35em{\\hss /\\hss }}\\ULon ",
      ),
    ).toEqual({ spec: "m", package: "ulem" });
    expect(packageSignature("ding", "\\long macro:->\\Pisymbol {pzd}")).toEqual({
      spec: "m",
      package: "pifont",
    });
    expect(
      packageSignature("ifthenelse", "\\long macro:#1->\\toks@ {#1}\\TE@repl \\or \\TE@or "),
    ).toEqual({ spec: "m m m", package: "ifthen" });
    expect(packageSignature("so", "macro:->\\protect \\textso  ")).toEqual({
      spec: "m",
      package: "soul",
    });
    expect(packageSignature("textul", "macro:->\\protect \\textul  ")).toEqual({
      spec: "m",
      package: "soul",
    });
  });

  test("leaves a document's own command of the same name to its meaning", () => {
    expect(packageSignature("uline", "macro:->\\underline ")).toBeUndefined();
    expect(packageSignature("ding", "\\long macro:#1->\\textbullet ")).toBeUndefined();
    expect(packageSignature("so", "macro:->\\protect \\textul  ")).toBeUndefined();
    expect(packageSignature("cventry", "macro:->\\ULon ")).toBeUndefined();
  });

  test("reads twoopt's commands: two optional arguments and the rest of `\\2\\x`'s", () => {
    const meanings = new Map([
      ["2\\cvtwo", "\\long macro:#1#2#3#4->#1#2#3#4"],
      ["2\\cvpair", "macro:#1#2->#1#2"],
      ["2\\cvone", "macro:#1->#1"],
      ["2\\cvdelimited", "macro:#1#2.->#1#2"],
    ]);
    const meaningOf = (name: string) => meanings.get(name);
    expect(twooptSpec("\\to@ScanSecondOptArg \\2\\cvtwo {#1}{b}", meaningOf)).toBe("o o m m");
    expect(twooptSpec("\\to@ScanSecondOptArg \\2\\cvpair {#1}{}", meaningOf)).toBe("o o");
    expect(twooptSpec("\\to@ScanSecondOptArg \\2\\cvone {#1}{}", meaningOf)).toBeUndefined();
    expect(twooptSpec("\\to@ScanSecondOptArg \\2\\cvdelimited {#1}{}", meaningOf)).toBeUndefined();
    expect(twooptSpec("\\to@ScanSecondOptArg \\2\\cvlost {#1}{}", meaningOf)).toBeUndefined();
    expect(twooptSpec("#1\\textbf {x}", meaningOf)).toBeUndefined();
  });
});
