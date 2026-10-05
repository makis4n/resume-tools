import { describe, expect, it } from "vitest";
import {
  addedKind,
  balances,
  braceScan,
  checksLines,
  commandBefore,
  errorLine,
  insertions,
  lineAt,
  lineSpan,
  namesOn,
  texError,
  verdictWords,
} from "./corpus-checks.ts";

/** Invented words a log's context might echo, none of which a line may print. */
const SECRET = ["Quillon", "Marrowby", "Tenterfield", "Ashgrove"];

const printsNoText = (text: string) => {
  for (const word of SECRET) expect(text).not.toContain(word);
};

describe("texError", () => {
  it("reads an undefined command by name and its line, never the context's words", () => {
    const log = [
      "(./import.tex",
      "! Undefined control sequence.",
      "\\cventry #1#2->\\textbfx ",
      "                        {#1} Quillon {#2}",
      "l.12 \\cventry{Quillon Marrowby}",
      "                                {Tenterfield}",
      "",
    ].join("\n");
    const error = texError(log, "import");
    expect(error).toEqual({
      kind: "undefined control sequence",
      command: "\\textbfx",
      inside: ["\\cventry"],
      runaway: false,
      line: 12,
      file: "main",
    });
    printsNoText(errorLine(error as NonNullable<typeof error>));
  });

  it("names a runaway argument without echoing it", () => {
    const log = [
      "(./import.tex",
      "Runaway argument?",
      "{Quillon Marrowby lives in Tenterfield \\par \\item Ashgrove",
      "! Paragraph ended before \\resumeItem was complete.",
      "<to be read again> ",
      "                   \\par ",
      "l.30 ",
      "     ",
    ].join("\n");
    const error = texError(log, "import");
    expect(error?.kind).toBe("paragraph ended before \\resumeItem was complete");
    expect(error?.runaway).toBe(true);
    expect(error?.token).toBe("\\par");
    expect(error?.line).toBe(30);
    printsNoText(errorLine(error as NonNullable<typeof error>));
  });

  it("withholds the words of a package's error, naming the package only where the tree has it", () => {
    const log = (owner: string) =>
      `(./import.tex\n! Package ${owner} Error: Quillon Marrowby is not allowed.\n\nl.4 x`;
    const tree = { path: () => false, name: (file: string) => file === "geometry.sty" };
    const error = texError(log("Ashgrove"), "import", tree);
    expect(error?.kind).toBe("the error of a package not in the tree, its words withheld");
    printsNoText(errorLine(error as NonNullable<typeof error>));
    expect(texError(log("geometry"), "import", tree)?.kind).toBe(
      "the error of package geometry, its words withheld",
    );
  });

  it("names no class or package of the upload's own, as its author may name it after themselves", () => {
    // The review of ef7da1f's two invented logs: an upload's class's `\ClassError`, and an option
    // clash for an upload's package; and a package of the tree, still named.
    const tree = { path: () => false, name: (file: string) => file === "geometry.sty" };
    const classError = texError(
      "(./import.tex\n! Class zorbinklatch-cv Error: Invented words.\n\nl.3 x",
      "import",
      tree,
    );
    expect(classError?.kind).toBe("the error of a class not in the tree, its words withheld");
    const clash = texError(
      "(./import.tex\n! LaTeX Error: Option clash for package zorbinklatch.\n\nl.5 x",
      "import",
      tree,
    );
    expect(clash?.kind).toBe("LaTeX: option clash for a package not in the tree");
    for (const error of [classError, clash])
      expect(errorLine(error as NonNullable<typeof error>)).not.toMatch(/zorbin|klatch/i);
    expect(
      texError(
        "(./import.tex\n! LaTeX Error: Option clash for package geometry.\n\nl.5 x",
        "import",
        tree,
      )?.kind,
    ).toBe("LaTeX: option clash for package geometry");
  });

  it("withholds an error of a kind it does not know", () => {
    const error = texError("! Quillon Marrowby went wrong.\nl.2 Tenterfield", "import");
    expect(error?.kind).toBe("an error of another kind, its words withheld");
    expect(error?.line).toBe(2);
    printsNoText(errorLine(error as NonNullable<typeof error>));
  });

  it("names a file of the upload by its extension and a job's file as the job's", () => {
    const log = "(./import.tex (./import.aux\n! Missing } inserted.\nl.3 \\@writefile";
    expect(texError(log, "import")?.file).toBe("a file of the job's (.aux)");
    const input = "(./import.tex (./Quillon.tex\n! Missing } inserted.\nl.3 x";
    expect(texError(input, "import")?.file).toBe("a file of the upload's (.tex)");
    const closed =
      "(./import.tex (./Quillon.tex) (/texmf/tex/latex/base/size10.clo)\n! Missing } inserted.";
    expect(texError(closed, "import")?.file).toBe("main");
    // An extension that is no file's kind is a word of the upload's, and is not printed.
    const odd = "(./import.tex (./Quillon.Ashgrove\n! Missing } inserted.";
    expect(texError(odd, "import")?.file).toBe("a file of the upload's");
  });

  it("names a file of the tree only where the tree holds it", () => {
    const tree = "/texlive/texmf-dist/tex/latex/base/size10.clo";
    const log = `(./import.tex (${tree}\n! Missing } inserted.`;
    const files = { path: (path: string) => path === tree, name: () => false };
    expect(texError(log, "import", files)?.file).toBe("TeX Live's size10.clo");
    expect(texError(log, "import")?.file).toBe("a file of TeX Live's");
  });

  it("prints no word of a runaway argument's echo or a box's display as a file", () => {
    // The two invented logs of the review of 13099bf: a word in `(/...` before the error.
    const logs = [
      [
        "(./import.tex",
        "Runaway argument?",
        "{Zorbin Klatch (/u/Weltermoor \\par \\item Fennelby",
        "! Paragraph ended before \\resumeItem was complete.",
        "<to be read again> ",
        "                   \\par ",
        "l.30 ",
      ],
      [
        "(./import.tex",
        "Overfull \\hbox (3.2pt too wide) in paragraph at lines 12--14",
        "[]\\T1/lmr/m/n/10 See (/in/zorbin-klatch on the site",
        " []",
        "",
        "! Undefined control sequence.",
        "l.15 \\foo",
      ],
    ];
    for (const lines of logs) {
      const error = texError(lines.join("\n"), "import");
      expect(error?.file).toBe("main");
      const printed = errorLine(error as NonNullable<typeof error>);
      for (const word of ["Weltermoor", "zorbin", "klatch", "Fennelby", "Zorbin"])
        expect(printed).not.toContain(word);
    }
    // Even where a word stays open and is taken for a file, it is never printed as a name.
    const unskipped = "(./import.tex See (/in/zorbin-klatch\n! Undefined control sequence.";
    expect(texError(unskipped, "import")?.file).toBe("a file of TeX Live's");
  });

  it("finds no error in a log without one", () => {
    expect(texError("Output written on import.dvi (1 page, 100 bytes).", "import")).toBeUndefined();
  });
});

describe("braceScan", () => {
  it("places the first } that closes nothing and each { left open", () => {
    const text = "a}b{c{d}";
    expect(braceScan(text)).toEqual({ under: 1, open: [3] });
    expect(balances(braceScan("{a}{b}"))).toBe(true);
  });

  it("reads a % in an address as a character, and elsewhere as a comment", () => {
    expect(balances(braceScan("\\href{https://quill.example/a%20b}{x}"))).toBe(true);
    expect(balances(braceScan("\\textbf{a % }\n}"))).toBe(true);
    expect(braceScan("\\url|a{b").delimited).toBe(4);
  });
});

describe("lines and names", () => {
  it("finds a place's line and a line's span", () => {
    expect(lineAt("a\nb\nc", 4)).toBe(3);
    expect(lineSpan("a\nbc\nd", 2)).toEqual({ start: 2, end: 4 });
  });

  it("names commands and environments, never words", () => {
    const line = "\\begin{itemize} \\item Quillon \\textbf{Marrowby} % Tenterfield \\\\";
    const names = namesOn(line);
    expect(names).toEqual(["\\begin{itemize}", "\\item", "\\textbf", "% (a comment)", "\\\\"]);
    printsNoText(names.join(" "));
  });

  it("names the command a brace belongs to", () => {
    const text = "x \\cventry[a]{b}{Quillon";
    expect(commandBefore(text, text.lastIndexOf("{"))).toBe("\\cventry");
    expect(commandBefore("Quillon {Marrowby}", 8)).toBeUndefined();
  });
});

describe("insertions", () => {
  it("finds what a writing adds to the body, and where", () => {
    const expected = "\\begin{document}\nA % c\nB\n\\end{document}";
    const written = "\\catcode`\\@=11\n\\begin{document}\nA % c\n\nB\n\\end{document}\n";
    const start = written.indexOf("\\begin");
    const found = insertions(expected, written, start);
    expect(found.added).toEqual([{ at: expected.indexOf("B"), text: "\n" }]);
    expect(found.parted).toBeUndefined();
    expect(addedKind("\n")).toBe("a line's end");
    expect(addedKind("Quillon")).toBe("7 characters of other kinds");
  });
});

describe("the lines", () => {
  it("prints a verdict's kinds and a row's lines, its control characters escaped", () => {
    expect(verdictWords({ outcome: "differs", difference: { kind: "glyph", page: 2 } })).toBe(
      "sets another page: glyph on page 2",
    );
    expect(verdictWords({ outcome: "stops", rerun: true })).toBe(
      "stops: it asked for another pass after its third",
    );
    expect(checksLines({ id: "other-0000", lines: ["a\u001bb"] })).toEqual([
      "other-0000:",
      "  a\\u001bb",
    ]);
  });
});

describe("inputenc's errors", () => {
  it("reads the kind from the error's first line, which inputenc goes on from", () => {
    const log =
      "(./import.tex\n! Package inputenc Error: Keyboard character used is undefined\n(inputenc)                in inputencoding `latin1'.\n\nl.9 Quillon";
    expect(texError(log, "import")?.kind).toBe("inputenc: keyboard character used is undefined");
  });
});
