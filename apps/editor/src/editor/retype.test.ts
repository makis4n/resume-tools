import { LockedLatex } from "@resume-tools/resume-model";
import { describe, expect, test } from "vitest";
import type { GlyphBox } from "../page/draw";
import { curated } from "../templates/curated";
import { type Document, History, newDocument } from "./document";
import {
  alignPieces,
  canonical,
  escapeTyped,
  isRetype,
  NOT_RETYPED,
  piecesOf,
  RETYPE_REFUSED,
  type Retype,
  RetypeGuard,
  retyped,
  retypeOf,
  retypesOf,
  showsTyped,
} from "./retype";

// Every text here is invented: an invented person's heading and skills, kept as an import keeps a
// part it has no place for (decision 0025), and a page of their glyphs.

const HEADING = String.raw`\begin{center}
    \textbf{\Huge \scshape Quill Invented} \\ \vspace{1pt}
    \small 555-0100 $|$ \href{mailto:quill@example.invalid}{\underline{quill@example.invalid}} $|$
    \href{https://quill.example}{\underline{quill.example}}
\end{center}%`;

const SKILLS = String.raw`
 \begin{itemize}[leftmargin=0.15in, label={}]
    \small{\item{
     \textbf{Languages}{: Invented, Words, Other} \\
     \textbf{Tools}{: Quill, Wren \& Sons}
    }}
 \end{itemize}%`;

/** The texts of the runs of plain text a part's LaTeX holds. */
const texts = (latex: string) => piecesOf(latex).map((piece) => piece.text);

describe("piecesOf", () => {
  test("reads a heading's words, and none of what its commands read", () => {
    expect(texts(HEADING)).toEqual([
      "Quill Invented",
      "555-0100",
      "quill@example.invalid",
      "quill.example",
    ]);
    // Each run's bytes are its own, its whitespace around it left out.
    for (const piece of piecesOf(HEADING))
      expect(HEADING.slice(piece.start, piece.end).replace(/\s+/g, " ")).toBe(piece.text);
  });

  test("reads an escaped character as the character, and a list's options as no text", () => {
    expect(texts(SKILLS)).toEqual([
      "Languages",
      ": Invented, Words, Other",
      "Tools",
      ": Quill, Wren & Sons",
    ]);
  });

  test("leaves out comments, math, URLs, \\verb, lengths, labels and a table's columns", () => {
    const latex = String.raw`Plain words % a comment
$x^2$ more words \url{https://quill.example/a} \verb|raw text|
\vspace*{2pt}\label{part} \begin{tabular}{l r} Cell one & Cell two \end{tabular}
\[ y = 1 \] \( z \) \begin{equation} e = mc \end{equation} last`;
    expect(texts(latex)).toEqual(["Plain words", "more words", "Cell one", "Cell two", "last"]);
  });

  test("parts runs at a blank line, a line break, a brace and a bracket", () => {
    expect(texts("One para\n\nTwo para\\\\[2pt]Three {Four} [Five] Six")).toEqual([
      "One para",
      "Two para",
      "Three",
      "Four",
      "Five",
      "Six",
    ]);
  });

  test("reads ties, dashes and quotes as the page sets them", () => {
    expect(texts("Sept~2001 -- June 2002, ``quoted'' --- done")).toEqual([
      "Sept 2001 – June 2002, “quoted” — done",
    ]);
  });

  test("marks a run joined to a command's name or an accent, and none after a space or a brace", () => {
    const pieces = piecesOf(String.raw`\small555-0100 \small 555-0101 Caf\'e \textbf{Bold}`);
    expect(pieces.map((piece) => [piece.text, piece.joined])).toEqual([
      ["555-0100", true],
      ["555-0101 Caf", false],
      ["e", true],
      ["Bold", false],
    ]);
  });
});

describe("canonical", () => {
  test("folds case and space, and reads TeX's dashes and quotes as the characters they set", () => {
    expect(canonical("Sept 2001 -- June")).toBe(canonical("sept2001–june"));
    expect(canonical("``Quoted''")).toBe(canonical("“quoted”"));
    expect(canonical("it's")).toBe(canonical("it’s"));
    expect(canonical("A B")).toBe("ab");
  });
});

/** Glyph boxes of a part, one for each glyph text, of `part`. */
function glyphs(part: string, spelled: readonly (string | undefined)[]): GlyphBox[] {
  return spelled.map((text, index) => ({
    x: index,
    y: 0,
    left: index,
    top: -1,
    right: index + 1,
    bottom: 0,
    font: "cmr10",
    size: 10,
    locked: part,
    ...(text === undefined ? {} : { text }),
  }));
}

/** Each character of a text a glyph, spaces left out, as TeX sets a run. */
const spelled = (text: string) => [...text.replace(/\s/g, "")];

describe("alignPieces", () => {
  test("lines up runs with the glyphs between them that commands set, and skips what no glyph shows", () => {
    const pieces = [
      { text: "Quill Invented" },
      { text: "1pt" },
      { text: "555-0100" },
      { text: "mailto:quill@example.invalid" },
      { text: "quill@example.invalid" },
    ];
    const page = [
      ...spelled("QUILL INVENTED"),
      ...spelled("555-0100"),
      "|",
      ...spelled("quill@example.invalid"),
    ];
    expect(alignPieces(pieces, page.map(canonical))).toEqual([
      { from: 0, to: 13 },
      undefined,
      { from: 13, to: 21 },
      undefined,
      { from: 22, to: 43 },
    ]);
  });

  test("takes a hyphen TeX added at a line's end with the run, and a ligature's letters", () => {
    expect(alignPieces([{ text: "inventing" }], ["in", "-", "vent", "i", "n", "g"])).toEqual([
      { from: 0, to: 6 },
    ]);
    expect(alignPieces([{ text: "office" }], ["o", "ffi", "c", "e"])).toEqual([{ from: 0, to: 4 }]);
  });

  test("leaves a run spelled as the next one to the next, as an address written as its label", () => {
    const page = spelled("quill.example").map(canonical);
    expect(alignPieces([{ text: "quill.example" }, { text: "quill.example" }], page)).toEqual([
      undefined,
      { from: 0, to: 13 },
    ]);
  });

  test("looks for a short run only a few glyphs on, and a long one anywhere", () => {
    const far = [...Array(60).fill("�"), ...spelled("Wren")].map(canonical);
    expect(alignPieces([{ text: "Wren" }], far)).toEqual([undefined]);
    const long = [...Array(60).fill("�"), ...spelled("Invented Words")].map(canonical);
    expect(alignPieces([{ text: "Invented Words" }], long)).toEqual([{ from: 60, to: 73 }]);
  });
});

/** A document whose resume holds one locked part of `latex`. */
function documentWith(latex: string, id = "lock-heading"): Document {
  const document = newDocument("jake", curated("jake").sample);
  return {
    ...document,
    resume: {
      ...document.resume,
      sections: [{ kind: "locked", id, title: "", role: "other", latex }],
    },
  };
}

/** The page of the heading part, as `drawPage` reads its glyphs: an icon between its runs. */
const HEADING_PAGE = [
  {
    glyphs: glyphs("lock-heading", [
      ...spelled("QUILL INVENTED"),
      ...spelled("555-0100"),
      undefined,
      ...spelled("quill@example.invalid"),
      "|",
      ...spelled("quill.example"),
    ]),
  },
];

describe("retypeOf", () => {
  test("offers each run the page shows, with its glyphs", () => {
    const found = retypeOf({ id: "lock-heading", latex: HEADING }, HEADING_PAGE);
    if (!isRetype(found)) throw new Error(found.reason);
    expect(found.pieces.map((piece) => [piece.text, piece.from, piece.to])).toEqual([
      ["Quill Invented", 0, 13],
      ["555-0100", 13, 21],
      ["quill@example.invalid", 22, 43],
      ["quill.example", 44, 57],
    ]);
    expect(found.glyphs).toHaveLength(57);
  });

  test("says in plain words why a part offers nothing", () => {
    expect(retypeOf({ id: "lock-heading", latex: HEADING }, [{ glyphs: [] }])).toEqual({
      reason: NOT_RETYPED.notShown,
    });
    // A chart whose labels a macro builds from its arguments: no run is what the page shows.
    const chart = String.raw`\wheelchart{1.5cm}{0.5cm}{6/8em/accent!30/Sleep}`;
    expect(
      retypeOf({ id: "lock-chart", latex: chart }, [{ glyphs: glyphs("lock-chart", ["○", "○"]) }]),
    ).toEqual({ reason: NOT_RETYPED.notPlain });
    for (const reason of Object.values(NOT_RETYPED)) expect(reason).not.toMatch(/[\\{}]/);
  });

  test("reads a document's locked parts by id", () => {
    const found = retypesOf(documentWith(HEADING), HEADING_PAGE);
    expect([...found.keys()]).toEqual(["lock-heading"]);
    expect(isRetype(found.get("lock-heading") as Retype)).toBe(true);
  });
});

/** The heading's retype, which must be offered. */
function headingRetype(): Retype {
  const found = retypeOf({ id: "lock-heading", latex: HEADING }, HEADING_PAGE);
  if (!isRetype(found)) throw new Error(found.reason);
  return found;
}

describe("retyped", () => {
  test("replaces a changed run's bytes alone, its spaces and the commands around it kept", () => {
    const retype = headingRetype();
    const latex = retyped(HEADING, retype, [
      "Wren Invented",
      "555-0100",
      "quill@example.invalid",
      "quill.example",
    ]);
    expect(latex).toBe(HEADING.replace("Quill Invented", "Wren Invented"));
    // Nothing changed is no retype.
    expect(
      retyped(
        HEADING,
        retype,
        retype.pieces.map((piece) => piece.text),
      ),
    ).toBeUndefined();
    expect(
      retyped(HEADING, retype, [" Quill  Invented ", ...retype.pieces.slice(1).map((p) => p.text)]),
    ).toBeUndefined();
  });

  test("writes every character LaTeX reads as markup so that it prints, and never a command", () => {
    const typed = String.raw`\textbf{x} $5 & #1 ^ _ % ~ {y} \end{center}`;
    const escaped = escapeTyped(typed);
    expect(escaped).toBe(
      String.raw`\textbackslash{}textbf\{x\} \$5 \& \#1 \textasciicircum{} \_ \% \textasciitilde{} \{y\} \textbackslash{}end\{center\}`,
    );
    const retype = headingRetype();
    const latex = retyped(HEADING, retype, [typed, "555-0100", "x", "y"]);
    if (latex === undefined) throw new Error("no change");
    // The part's braces still balance, and its LaTeX is one a locked part may keep.
    expect(LockedLatex.safeParse(latex).success).toBe(true);
    // The runs it reads back are what was typed, as text: no command, group, comment or math.
    const runs = piecesOf(latex).map((piece) => piece.text);
    expect(runs).toContain("x");
    // A line's end typed is a space, so that no blank line, a new paragraph, comes of it.
    expect(escapeTyped("one\n\ntwo")).toBe("one two");
  });
});

describe("showsTyped", () => {
  test("holds the part's glyphs after to what was typed in place of the run's, hyphens aside", () => {
    const retype = headingRetype();
    const typed = ["Wren Invented", "555-0100", "quill@example.invalid", "quill.example"];
    const after = [
      {
        glyphs: glyphs("lock-heading", [
          ...spelled("WREN IN-VENTED"),
          ...spelled("555-0100"),
          undefined,
          ...spelled("quill@example.invalid"),
          "|",
          ...spelled("quill.example"),
        ]),
      },
    ];
    expect(showsTyped(retype, typed, after)).toBe(true);
    // The old words still shown, or a character left out, is not what was typed.
    expect(showsTyped(retype, typed, HEADING_PAGE)).toBe(false);
    const short = [{ glyphs: after[0]?.glyphs.slice(1) ?? [] }];
    expect(showsTyped(retype, typed, short)).toBe(false);
  });
});

describe("a retype, kept or taken back (RetypeGuard)", () => {
  const output = new Uint8Array([1]);
  const changed = ["Wren Invented", "555-0100", "quill@example.invalid", "quill.example"];
  /** The page after the heading's retype, showing what was typed. */
  const typedPage = [
    {
      glyphs: glyphs("lock-heading", [
        ...spelled("WREN INVENTED"),
        ...spelled("555-0100"),
        undefined,
        ...spelled("quill@example.invalid"),
        "|",
        ...spelled("quill.example"),
      ]),
    },
  ];
  /** A history over the heading's document, a guard with the outside check given, and the page. */
  function setUp(outside: boolean | Error) {
    const start = documentWith(HEADING);
    const history = new History(start);
    const asked: [Uint8Array, Uint8Array, string][] = [];
    const guard = new RetypeGuard(async (before, after, part) => {
      asked.push([before, after, part]);
      if (outside instanceof Error) throw outside;
      return outside;
    });
    return {
      start,
      history,
      guard,
      asked,
      shown: { document: start, pages: HEADING_PAGE, output },
    };
  }

  test("applies the retype as one step, unsaved, and keeps it once its page passes", async () => {
    const { start, history, guard, asked, shown } = setUp(true);
    const after = guard.start(history, headingRetype(), changed, shown);
    if (after === "unchanged" || "why" in after) throw new Error("not started");
    expect(history.present).toBe(after);
    expect(guard.holds()).toBe(true);
    expect(guard.waitsFor(after)).toBe(true);
    const section = after.resume.sections[0];
    expect(section?.kind === "locked" && section.latex).toBe(
      HEADING.replace("Quill Invented", "Wren Invented"),
    );
    // A page of another document is not the retype's.
    expect(await guard.paged({ document: start, pages: HEADING_PAGE, output })).toBeUndefined();
    const later = new Uint8Array([2]);
    expect(await guard.paged({ document: after, pages: typedPage, output: later })).toEqual({
      kept: true,
    });
    expect(asked).toEqual([[output, later, "lock-heading"]]);
    expect(guard.holds()).toBe(false);
    // Undo takes it back, and redo does it again, as any step.
    expect(history.undo()).toBe(start);
    expect(history.redo()).toBe(after);
  });

  test("takes back a retype that moves the page outside the part, with nothing to redo", async () => {
    const { start, history, guard, shown } = setUp(false);
    const after = guard.start(history, headingRetype(), changed, shown);
    if (after === "unchanged" || "why" in after) throw new Error("not started");
    expect(await guard.paged({ document: after, pages: typedPage, output })).toEqual({
      kept: false,
      why: "moved",
    });
    expect(history.present).toBe(start);
    expect(history.canRedo).toBe(false);
    expect(guard.holds()).toBe(false);
  });

  test("takes back one whose part does not show what was typed, or whose check fails", async () => {
    const shownWrong = setUp(true);
    const after = shownWrong.guard.start(
      shownWrong.history,
      headingRetype(),
      changed,
      shownWrong.shown,
    );
    if (after === "unchanged" || "why" in after) throw new Error("not started");
    expect(await shownWrong.guard.paged({ document: after, pages: HEADING_PAGE, output })).toEqual({
      kept: false,
      why: "shown",
    });
    expect(shownWrong.history.present).toBe(shownWrong.start);

    const failing = setUp(new Error("unreadable output"));
    const next = failing.guard.start(failing.history, headingRetype(), changed, failing.shown);
    if (next === "unchanged" || "why" in next) throw new Error("not started");
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(await failing.guard.paged({ document: next, pages: typedPage, output })).toEqual({
        kept: false,
        why: "failed",
      });
    } finally {
      console.error = quiet;
    }
    expect(failing.history.present).toBe(failing.start);
  });

  test("takes back one whose compile stopped or failed, and one cancelled", () => {
    for (const end of ["stopped", "failed", "cancel"] as const) {
      const { start, history, guard, shown } = setUp(true);
      const after = guard.start(history, headingRetype(), changed, shown);
      if (after === "unchanged" || "why" in after) throw new Error("not started");
      if (end === "stopped") {
        expect(guard.stopped(start)).toBeUndefined();
        expect(guard.stopped(after)).toEqual({ kept: false, why: "stopped" });
      } else if (end === "failed") expect(guard.failed()).toEqual({ kept: false, why: "failed" });
      else expect(guard.cancel()).toBe(true);
      expect(history.present).toBe(start);
      expect(history.canRedo).toBe(false);
      expect(guard.holds()).toBe(false);
    }
  });

  test("starts nothing for words that change nothing, a page of another document, or a marker", () => {
    const { history, guard, shown } = setUp(true);
    const retype = headingRetype();
    expect(
      guard.start(
        history,
        retype,
        retype.pieces.map((piece) => piece.text),
        shown,
      ),
    ).toBe("unchanged");
    const stale = { ...shown, document: documentWith(SKILLS) };
    expect(guard.start(history, retype, changed, stale)).toEqual({ why: "failed" });
    // The text of the page's lock marker, which a locked part may never hold (decision 0025).
    expect(guard.start(history, retype, ["rt:l:lock-other", ...changed.slice(1)], shown)).toEqual({
      why: "refused",
    });
    expect(history.canUndo).toBe(false);
    expect(guard.holds()).toBe(false);
    for (const message of Object.values(RETYPE_REFUSED)) expect(message).not.toMatch(/[\\{}]/);
  });
});

describe("the retype command and taking a step back", () => {
  test("sets a locked part's LaTeX, and refuses any other section or LaTeX it may not keep", () => {
    const start = documentWith(HEADING);
    const history = new History(start);
    const after = history.dispatch({ type: "retype", section: "lock-heading", latex: "New words" });
    expect(after.resume.sections[0]).toMatchObject({ kind: "locked", latex: "New words" });
    expect(() =>
      history.dispatch({ type: "retype", section: "lock-other", latex: "Words" }),
    ).toThrow(/no locked part/);
    expect(() =>
      history.dispatch({ type: "retype", section: "lock-heading", latex: "{unbalanced" }),
    ).toThrow(/cannot keep/);
    // Taken back for good: the step before, and nothing to redo.
    expect(history.takeBack()).toBe(start);
    expect(history.canRedo).toBe(false);
    expect(history.canUndo).toBe(false);
    expect(history.takeBack()).toBeUndefined();
  });
});
