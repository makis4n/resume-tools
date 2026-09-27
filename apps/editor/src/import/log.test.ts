import { describe, expect, test } from "vitest";
import {
  asksForRerun,
  babelPackage,
  bibliographyLeftOut,
  fontName,
  missingGraphic,
  needsPdfMode,
  needsXetex,
  refusalOf,
  unsizedGraphic,
  warningsOf,
} from "./log";
import { REFUSAL_REASONS } from "./refusal";

// Every log here is invented, in the shape the engine's logs take (checked against it): the
// source lines they quote hold SECRET, which no message may show.

const SECRET = "Quillwort";

/** A log that stops on an error, with TeX's context quoting an invented source line. */
const stopped = (...error: string[]) =>
  [
    "This is pdfTeX, Version 3.141592653-2.6-1.40.25 (TeX Live 2023) (preloaded format=pdflatex)",
    "(./import.tex",
    "LaTeX2e <2022-11-01> patch level 1",
    ...error,
    `l.12 \\cvsection{${SECRET} Invented}`,
    "",
    "Here is how much of TeX's memory you used:",
    "No pages of output.",
  ].join("\n");

/** LaTeX's error for a file it asks for by name, as `\usepackage` and `\input` give it. */
const asked = (file: string) => [
  `! LaTeX Error: File \`${file}' not found.`,
  "",
  "Type X to quit or <RETURN> to proceed,",
  "or enter new name. (Default extension: sty)",
  "",
  "Enter file name: ",
  "! Emergency stop.",
  "<read *> ",
];

/** graphicx's error for an image it cannot find. */
const graphic = (file: string) => [
  `! LaTeX Error: File \`${file}' not found.`,
  "",
  "See the LaTeX manual or LaTeX Companion for explanation.",
  "Type  H <return>  for immediate help.",
  " ...                                              ",
];

describe("a refusal from the log", () => {
  test("names the template, package or file LaTeX asked for", () => {
    expect(refusalOf(stopped(...asked("inventedcv.cls")))).toMatchObject({
      reason: "class",
      name: "inventedcv",
      message: "This resume needs the template inventedcv, which this editor does not have.",
    });
    expect(refusalOf(stopped(...asked("inventedpkg.sty")))).toMatchObject({
      reason: "package",
      name: "inventedpkg",
      message: "This resume needs the package inventedpkg, which this editor does not have.",
    });
    expect(refusalOf(stopped(...asked("sections/invented.tex")))).toMatchObject({
      reason: "file",
      message: "This resume needs the file sections/invented.tex, which is not in the upload.",
    });
    expect(refusalOf(stopped(...asked("invented.def"))).message).toBe(
      "This resume needs the file invented.def, which this editor does not have.",
    );
    expect(refusalOf(stopped("! I can't find file `inventedpart'."))).toMatchObject({
      reason: "file",
      name: "inventedpart",
    });
  });

  test("names the font fontspec or TeX could not load", () => {
    expect(
      refusalOf(stopped('! Package fontspec Error: The font "Invented Sans" cannot be found.')),
    ).toMatchObject({
      reason: "font",
      name: "Invented Sans",
      message: "This resume needs the font Invented Sans, which this editor does not have.",
    });
    expect(
      refusalOf(
        stopped("! Font \\x=inventedfont at 10.0pt not loadable: Metric (TFM) file not found."),
      ).name,
    ).toBe("inventedfont");
    expect(
      refusalOf(
        stopped(
          '! Font \\TU/Invented(0)/m/n/10="Invented Serif:mapping=tex-text" at 10.0pt not loadable: Metric (TFM) file or installed font not found.',
        ),
      ).name,
    ).toBe("Invented Serif");
    expect(fontName('"[fonts/Invented-Bold.otf]:mapping=tex-text"')).toBe("Invented-Bold.otf");
    expect(fontName("[Invented-Regular.otf]/OT:script=latn;language=dflt;")).toBe(
      "Invented-Regular.otf",
    );
  });

  test("names a long font whose name fontspec's message wraps, and a font asked for by its path", () => {
    // expl3 wraps fontspec's messages at about 79 columns, between words, whatever
    // max_print_line says, and goes on in lines that start with `(fontspec)`.
    expect(
      refusalOf(
        stopped(
          '! Package fontspec Error: The font "Invented Grotesk Condensed Display" cannot',
          "(fontspec)                be found.",
          "",
          "For immediate help type H <return>.",
        ),
      ),
    ).toMatchObject({
      reason: "font",
      name: "Invented Grotesk Condensed Display",
      message:
        "This resume needs the font Invented Grotesk Condensed Display, which this editor does not have.",
    });
    expect(
      refusalOf(
        stopped(
          '! Package fontspec Error: The font "Invented Grotesk Condensed Display Extra',
          '(fontspec)                Wide" cannot be found.',
        ),
      ).name,
    ).toBe("Invented Grotesk Condensed Display Extra Wide");
    expect(
      refusalOf(
        stopped('! Package fontspec Error: The font "fonts/InventedGrotesk" cannot be found.'),
      ),
    ).toMatchObject({ reason: "font", name: "InventedGrotesk" });
  });

  test("names the package a biblatex style or a babel language is in", () => {
    expect(
      refusalOf(stopped("! Package biblatex Error: Style 'inventedstyle' not found.")),
    ).toMatchObject({
      reason: "package",
      name: "biblatex-inventedstyle",
    });
    expect(
      refusalOf(
        stopped(
          "! Package babel Error: Unknown option 'ngerman'. Either you misspelled it",
          "(babel)                or the language definition file ngerman.ldf",
        ),
      ),
    ).toMatchObject({
      reason: "package",
      name: "babel-german",
      message: "This resume needs the package babel-german, which this editor does not have.",
    });
    expect(babelPackage("frenchb")).toBe("babel-french");
    expect(babelPackage("brazilian")).toBe("babel-portuges");
    expect(babelPackage("inventedlang")).toBe("babel-inventedlang");
  });

  test("says a file outside the main file's folder is out of reach, template or graphic", () => {
    expect(refusalOf(stopped(...asked("../common/inventedcv.cls")))).toMatchObject({
      reason: "class",
      message:
        "This resume loads ../common/inventedcv from outside its own folder, which this editor cannot reach.",
    });
    expect(refusalOf(stopped(...graphic("../photos/invented")))).toMatchObject({
      reason: "file",
      message:
        "This resume loads ../photos/invented from outside its own folder, which this editor cannot reach.",
    });
    expect(refusalOf(stopped(...asked("/usr/share/invented/cv.cls"))).message).toMatch(
      /outside its own folder/,
    );
    // XeTeX's error for a picture it cannot load, and the job's graphics configuration's.
    expect(
      refusalOf(stopped("! Unable to load picture or PDF file '../photos/invented.png'.")),
    ).toMatchObject({ reason: "file", name: "../photos/invented.png" });
    expect(
      refusalOf(stopped("! Package resume-tools Error: No size for `../photos/invented.pdf'.")),
    ).toMatchObject({ reason: "file", name: "../photos/invented.pdf" });
  });

  test("says LuaTeX when an error says only it will do", () => {
    expect(
      refusalOf(
        stopped("! Package luacode Error: LuaTeX is required for this package. Aborting.."),
      ),
    ).toMatchObject({ reason: "luatex", message: expect.stringContaining("LuaTeX") });
  });

  test("says LuaTeX when the command a compile stops on undefined is one of LuaTeX's own", () => {
    for (const command of ["pdfvariable", "pdfextension", "pdffeedback", "directlua"])
      expect(
        refusalOf(
          stopped("! Undefined control sequence.", `l.4 \\${command}`, "   compresslevel=0"),
        ),
        command,
      ).toMatchObject({
        reason: "luatex",
        message: "This resume needs LuaTeX, which this editor does not have.",
      });
    expect(refusalOf(stopped("! Undefined control sequence.", "l.4 \\pdfvariables"))).toMatchObject(
      { reason: "stopped", name: "\\pdfvariables" },
    );
  });

  test("says only that it could not compile otherwise, keeping an undefined command for developers", () => {
    const undefinedCommand = refusalOf(
      stopped("! Undefined control sequence.", `\\cvhead ->\\inventedthing `, "{x}"),
    );
    expect(undefinedCommand).toMatchObject({
      reason: "stopped",
      name: "\\inventedthing",
      message: "This resume could not be compiled by this editor.",
    });
    expect(refusalOf(stopped("! Missing $ inserted."))).toMatchObject({ reason: "stopped" });
    expect(refusalOf("No pages of output.")).toMatchObject({ reason: "stopped" });
  });

  test("keeps the log, for developers, and never shows a line of it", () => {
    for (const log of [
      stopped(...asked(`${SECRET}.sty`)),
      stopped("! Undefined control sequence.", `l.3 \\${SECRET}`),
      stopped(`! Package fontspec Error: The font "${SECRET}\u001b[2J" cannot be found.`),
      stopped(`! Invented error: ${SECRET}.`),
    ]) {
      const refused = refusalOf(log);
      expect(refused.log).toBe(log);
      expect(refused.message).not.toContain("l.12");
      expect(refused.message).not.toContain("\u001b");
      if (refused.reason === "stopped") expect(refused.message).not.toContain(SECRET);
    }
  });

  test("has a message for every reason, naming no command", () => {
    expect(REFUSAL_REASONS).toContain("timeout");
    expect(refusalOf(stopped(...asked("x.cls"))).message).not.toMatch(/\\/);
  });
});

describe("what a compile can go on from", () => {
  test("a graphic graphicx could not find, and not a file LaTeX asked for", () => {
    expect(missingGraphic(stopped(...graphic("./photos/invented")))).toBe("./photos/invented");
    expect(missingGraphic(stopped(...graphic("invented.jpg")))).toBe("invented.jpg");
    expect(missingGraphic(stopped(...graphic("invented.eps")))).toBeUndefined();
    expect(missingGraphic(stopped(...asked("invented.tex")))).toBeUndefined();
    expect(missingGraphic("No pages of output.")).toBeUndefined();
  });

  test("a picture XeTeX could not load, which graphicx names with its extension", () => {
    for (const name of ["photos/invented.png", "invented.jpg", "invented.pdf"])
      expect(
        missingGraphic(
          stopped(`! Unable to load picture or PDF file '${name}'.`, "<to be read again>"),
        ),
      ).toBe(name);
    expect(
      missingGraphic(stopped("! Unable to load picture or PDF file 'invented.eps'.")),
    ).toBeUndefined();
  });

  test("a graphic named with its extension, which graphicx only warns of and asks a pipe to size", () => {
    const log = stopped(
      "LaTeX Warning: File `other.png' not found on input line 3.",
      "LaTeX Warning: File `photos/invented.png' not found on input line 9.",
      "! LaTeX Error: Cannot run pipe command. Try --shell-escape",
      "(or --enable-pipes in MikTeX) option.",
    );
    expect(missingGraphic(log)).toBe("photos/invented.png");
    expect(
      missingGraphic(stopped("! LaTeX Error: Cannot run pipe command. Try --shell-escape")),
    ).toBeUndefined();
  });

  test("a graphic the job's graphics configuration found and could not size", () => {
    expect(
      unsizedGraphic(stopped("! Package resume-tools Error: No size for `invented-logo.pdf'.")),
    ).toBe("invented-logo.pdf");
    expect(unsizedGraphic(stopped(...graphic("invented")))).toBeUndefined();
  });

  test("a primitive pdfTeX takes only when it writes PDF", () => {
    expect(
      needsPdfMode(
        stopped("! pdfTeX error (\\pdfmapline): not allowed in DVI mode (\\pdfoutput <= 0)."),
      ),
    ).toBe(true);
    expect(needsPdfMode(stopped(...asked("x.sty")))).toBe(false);
  });

  test("an error that says pdfTeX will not do", () => {
    expect(
      needsXetex(
        stopped(
          "! Fatal Package fontspec Error: The fontspec package requires either XeTeX or",
          "(fontspec)                      LuaTeX.",
        ),
      ),
    ).toBe(true);
    expect(needsXetex(stopped(...asked("x.sty")))).toBe(false);
  });
});

describe("a finished compile's log", () => {
  const biber = [
    "Package biblatex Warning: Please (re)run Biber on the file:",
    "(biblatex)                import",
    "(biblatex)                and rerun LaTeX afterwards.",
  ].join("\n");

  test("asks for another pass for anything but a bibliography tool", () => {
    expect(asksForRerun(`${biber}\nOutput written on import.dvi (1 page, 100 bytes).`)).toBe(false);
    expect(
      asksForRerun(
        `${biber}\nLaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.`,
      ),
    ).toBe(true);
  });

  test("says when the bibliography was left out", () => {
    expect(bibliographyLeftOut("No file import.bbl.", "import")).toBe(true);
    expect(bibliographyLeftOut(biber, "import")).toBe(true);
    expect(bibliographyLeftOut(biber, "import")).toBe(true);
    expect(bibliographyLeftOut("No file import.aux.", "import")).toBe(false);
  });

  test("names the files, font shapes and fonts it went on without, once each", () => {
    const log = [
      "No file import.aux.",
      "No file invented-part.tex.",
      "LaTeX Font Warning: Font shape `T1/inventedfam/m/n' undefined",
      "(Font)              using `T1/cmr/m/n' instead on input line 1.",
      'Package fontspec Warning: Could not resolve font "Invented/BI" (it probably',
      "Missing character: There is no ☎ (U+260E) in font [Invented-Regular.otf]/OT:script=latn;language=dflt;mapping=tex-text;!",
      "Missing character: There is no x in font inventedfont!",
      "Missing character: There is no y in font inventedfont!",
      `LaTeX Warning: Citation \`${SECRET}' on page 1 undefined on input line 1.`,
    ].join("\n");
    expect(warningsOf(log, "import")).toEqual([
      { kind: "file", name: "invented-part.tex" },
      { kind: "font", name: "T1/inventedfam/m/n" },
      { kind: "font", name: "Invented/BI" },
      { kind: "character", name: "Invented-Regular.otf" },
      { kind: "character", name: "inventedfont" },
    ]);
  });
});
