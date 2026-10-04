import { describe, expect, test } from "vitest";
import { type Candidate, candidatesOf, marked } from "../src/import/candidates";
import { bodyOfText, parseBody, type Tree } from "../src/import/parse";
import type { ProbeCandidate, UncoveredRun } from "../src/import/probe";
import type { GlyphStream, ReferenceGlyph } from "../src/import/reference";
import { isRefusal } from "../src/import/refusal";
import type { EngineSignatures } from "../src/import/signatures";
import { signaturesOf } from "../src/test/invented-import";
import {
  batchesOf,
  bisect,
  brokenBy,
  deletedAsSet,
  deletedOnly,
  emptied,
  glyphKeys,
  groupsOf,
  insertedAsSet,
  insertedOnly,
  judged,
  leavesOf,
  regenerated,
  rolesOf,
  trialsOf,
  wordsOf,
  writeOutline,
} from "./spike-outline-build";

// Every body, command, word and page here is invented for these tests: no real resume's.

/** An invented template in Jake's Resume's shape: lists opened and closed by macros of its own. */
const FLAT = signaturesOf(
  {
    inventedentry: "m m",
    inventedbullet: "m",
    inventedlist: "",
    inventedlistend: "",
    inventedbullets: "",
    inventedbulletsend: "",
  },
  {},
  {
    inventedlist: "macro:->\\begin {itemize}",
    inventedlistend: "macro:->\\end {itemize}",
    inventedbullets: "macro:->\\begin {itemize}",
    inventedbulletsend: "macro:->\\end {itemize}\\vspace {-5pt}",
    inventedentry: "macro:#1#2->\\item \\textbf {#1} #2",
    inventedbullet: "macro:#1->\\item \\small {#1}",
  },
);

const FLAT_BODY = String.raw`\section{Invented Studies}
  \inventedlist
    \inventedentry{Quill Academy}{Wrenford}
    \inventedentry{Heron College}{Lark Bay}
  \inventedlistend
\section{Invented Work}
  \inventedlist
    \inventedentry{Invented Role}{Invented Place}
      \inventedbullets
        \inventedbullet{Tended invented bees}
        \inventedbullet{Wrote {\bfseries invented} words -- often}
      \inventedbulletsend
  \inventedlistend
\section{Invented Skills}
\begin{itemize}
  \item Invented skill one
  \item Invented skill two
\end{itemize}
`;

/** An invented template in AltaCV's shape: its sections and entries are its own commands. */
const ALTA = signaturesOf(
  {
    inventedsection: "m",
    inventedevent: "m m",
    inventedtag: "m",
    inventedref: "m m",
    inventeddivider: "",
  },
  {},
  {
    inventedsection: "macro:#1->\\par \\textbf {#1}",
    inventedevent: "macro:#1#2->\\textbf {#1} #2\\par ",
    inventedtag: "macro:#1->\\fbox {#1}",
    inventedref: "macro:#1#2->#1, #2\\par ",
    inventeddivider: "macro:->\\par \\hrule ",
  },
);

const ALTA_BODY = String.raw`\inventedsection{Invented Work}
\inventedevent{Role One}{Org One}
\begin{itemize}
\item Did invented thing one
\item Did invented thing two
\end{itemize}
\inventeddivider
\inventedevent{Role Two}{Org Two}
\inventedsection{Invented Strengths}
\inventedtag{Patience}
\inventedtag{Whistling}
\inventedsection{Invented Referees}
\inventedref{Ref One}{Place One}
\inventeddivider
\inventedref{Ref Two}{Place Two}
`;

function treeOf(text: string, signatures: EngineSignatures): Tree {
  const tree = parseBody(bodyOfText(text), signatures);
  if (isRefusal(tree)) throw new Error(tree.message);
  return tree;
}

/** The source each unit of each group spans, its own content alone, as `[kind name: units]`. */
function shown(text: string, signatures: EngineSignatures) {
  const tree = treeOf(text, signatures);
  return groupsOf(tree, signatures.macros).map(
    (group) =>
      `${group.kind} ${group.name}: ${group.units.map((unit) => text.slice(unit.start, unit.end).split("\n")[0]).join(" | ")}`,
  );
}

/** Every candidate of a body that holds no raw chunk and no structure, as the probe's fields. */
const fieldsOf = (tree: Tree): Candidate[] =>
  candidatesOf(tree).candidates.filter((each) => each.unprobed === undefined);

describe("the groups of units", () => {
  test("are a list's items, and runs of calls whose lists macros open and close", () => {
    expect(shown(FLAT_BODY, FLAT)).toEqual([
      "run section:section: \\section{Invented Studies} | \\section{Invented Work} | \\section{Invented Skills}",
      "run inventedentry: \\inventedentry{Quill Academy}{Wrenford} | \\inventedentry{Heron College}{Lark Bay}",
      "run inventedbullet: \\inventedbullet{Tended invented bees} | \\inventedbullet{Wrote {\\bfseries invented} words -- often}",
      "list item: \\item Invented skill one | \\item Invented skill two",
    ]);
  });

  test("give each unit what follows it up to the next, and the last a section's whole end", () => {
    const tree = treeOf(FLAT_BODY, FLAT);
    const [sections, entries, bullets] = groupsOf(tree, FLAT.macros);
    // The last section runs to the body's end, its list with it.
    expect(FLAT_BODY.slice(sections?.units.at(-1)?.start, sections?.units.at(-1)?.end)).toMatch(
      /^\\section\{Invented Skills\}[\s\S]*\\end\{itemize\}$/,
    );
    // An entry's run ends inside the list its macros open: the closer is no unit's.
    expect(FLAT_BODY.slice(entries?.units.at(-1)?.start, entries?.units.at(-1)?.end)).toBe(
      "\\inventedentry{Heron College}{Lark Bay}",
    );
    expect(entries?.gap).toBe("\n    ");
    // The first unit reaches to where the next begins.
    expect(FLAT_BODY.slice(bullets?.units[0]?.start, bullets?.units[0]?.next)).toBe(
      "\\inventedbullet{Tended invented bees}\n        ",
    );
  });

  test("run a command's last unit to the level's end where its units hold others' runs", () => {
    expect(shown(ALTA_BODY, ALTA)).toEqual([
      "run inventedsection: \\inventedsection{Invented Work} | \\inventedsection{Invented Strengths} | \\inventedsection{Invented Referees}",
      "run inventedevent: \\inventedevent{Role One}{Org One} | \\inventedevent{Role Two}{Org Two}",
      "list item: \\item Did invented thing one | \\item Did invented thing two",
      "run inventedtag: \\inventedtag{Patience} | \\inventedtag{Whistling}",
      "run inventedref: \\inventedref{Ref One}{Place One} | \\inventedref{Ref Two}{Place Two}",
    ]);
    const tree = treeOf(ALTA_BODY, ALTA);
    const [sections, events] = groupsOf(tree, ALTA.macros);
    expect(ALTA_BODY.slice(sections?.units.at(-1)?.start, sections?.units.at(-1)?.end)).toBe(
      "\\inventedsection{Invented Referees}\n\\inventedref{Ref One}{Place One}\n\\inventeddivider\n\\inventedref{Ref Two}{Place Two}",
    );
    // An event's unit holds its list and the divider after it.
    expect(ALTA_BODY.slice(events?.units[0]?.start, events?.units[0]?.end)).toMatch(
      /^\\inventedevent\{Role One\}\{Org One\}\n\\begin\{itemize\}[\s\S]*\\end\{itemize\}\n\\inventeddivider$/,
    );
  });

  test("stop a run of leaves before another command's run", () => {
    const signatures = signaturesOf({ inventeditem: "m m", inventedentry: "m m" }, {}, {});
    expect(
      shown(
        String.raw`\inventeditem{One}{Words one}
\inventeditem{Two}{Words two}
\inventedentry{Three}{Words three}
\inventedentry{Four}{Words four}
`,
        signatures,
      ),
    ).toEqual([
      "run inventeditem: \\inventeditem{One}{Words one} | \\inventeditem{Two}{Words two}",
      "run inventedentry: \\inventedentry{Three}{Words three} | \\inventedentry{Four}{Words four}",
    ]);
  });

  test("find items outside a list, and no run in a call made once", () => {
    const signatures = signaturesOf({ inventedonce: "m" }, {}, {});
    expect(
      shown(
        String.raw`\inventedonce{Only words}
\begin{itemize}[label={}]
  \small{\item{Invented first} \item{Invented second}}
\end{itemize}
`,
        signatures,
      ),
    ).toEqual(["list item: \\item{Invented first} | \\item{Invented second}"]);
  });
});

describe("writing the outline", () => {
  test("is what the probe compiles where nothing is written as the generator writes it", () => {
    const text = String.raw`\section{Invented Title}
\inventedentry Q{Invented {\itshape place}}
Invented words for a paragraph.
\begin{itemize}
  \item Invented bullet Gro\ss  
\end{itemize}
`;
    const signatures = signaturesOf({ inventedentry: "m m" }, {}, {});
    const tree = treeOf(text, signatures);
    const fields = fieldsOf(tree);
    expect(fields.some((field) => field.bare === true)).toBe(true);
    const plain = writeOutline({ source: text, leaves: leavesOf(tree) }, fields);
    expect(plain.latex).toBe(marked(text, fields));
    expect(plain.unclean).toBe(0);
  });

  test("writes each field's text as the generator writes a rich field, and keeps the rest", () => {
    const tree = treeOf(FLAT_BODY, FLAT);
    const fields = fieldsOf(tree);
    const { latex, unclean } = writeOutline(
      { source: FLAT_BODY, leaves: leavesOf(tree), regen: regenerated(FLAT_BODY, "pdftex") },
      fields,
    );
    expect(unclean).toBe(0);
    expect(latex).toContain(
      "\\inventedbullet{\\rtfield{c9-1}{Wrote \\textbf{invented} words – often}}",
    );
    expect(latex).toContain("\\inventedentry{\\rtfield{c2-1}{Quill Academy}}");
    // Kept text is the source's bytes: the list macros and the spaces between.
    expect(latex).toContain("\n  \\inventedlistend\n\\section{\\rtfield{s2}{Invented Work}}");
    // A field left out of the set is written as it was, unmarked.
    const some = writeOutline(
      { source: FLAT_BODY, leaves: leavesOf(tree), regen: regenerated(FLAT_BODY, "pdftex") },
      fields.filter((field) => field.id !== "c9-1"),
    );
    expect(some.latex).toContain("\\inventedbullet{Wrote {\\bfseries invented} words -- often}");
  });

  test("writes a date's text as plain text, and marks a text whose braces hold the field", () => {
    const signatures = signaturesOf({ inventeddates: "m" }, {}, {});
    const text = String.raw`\inventeddates{Jan 2020 -- Present}
\inventeddates{{Invented braced}}
`;
    const tree = treeOf(text, signatures);
    const fields = fieldsOf(tree);
    const { latex } = writeOutline(
      { source: text, leaves: leavesOf(tree), regen: regenerated(text, "pdftex") },
      fields,
    );
    expect(latex).toBe(
      "\\inventeddates{\\rtfield{c1-1}{Jan 2020 – Present}}\n\\inventeddates{\\rtfield{c2-1}{Invented braced}}\n",
    );
  });

  test("takes out a span with the fields in it, and puts text in after a field it falls in", () => {
    const tree = treeOf(FLAT_BODY, FLAT);
    const fields = fieldsOf(tree);
    const out = { source: FLAT_BODY, leaves: leavesOf(tree) };
    const first = FLAT_BODY.indexOf("\\inventedentry{Quill");
    const second = FLAT_BODY.indexOf("\\inventedentry{Heron");
    const removed = writeOutline(out, fields, [{ kind: "delete", start: first, end: second }]);
    expect(removed.latex).not.toContain("Quill Academy");
    expect(removed.latex).not.toContain("c2-1");
    expect(removed.latex).toContain("\\inventedlist\n    \\inventedentry{\\rtfield{c3-1}{Heron");
    const at = FLAT_BODY.indexOf("Lark Bay") + 3;
    const put = writeOutline(out, fields, [{ kind: "insert", at, text: "%invented" }]);
    expect(put.latex).toContain("{\\rtfield{c3-2}{Lark Bay}%invented}");
  });

  test("empties a copy's fields under new ids, and keeps its kept text", () => {
    const tree = treeOf(FLAT_BODY, FLAT);
    const fields = fieldsOf(tree).filter((field) => field.id !== "c2-2");
    let n = 0;
    const unit = {
      start: FLAT_BODY.indexOf("\\inventedentry{Quill"),
      end: FLAT_BODY.indexOf("{Wrenford}") + "{Wrenford}".length,
    };
    expect(emptied(FLAT_BODY, unit, fields, () => `n${++n}`)).toBe(
      "\\inventedentry{\\rtfield{n1}{}}{Wrenford}",
    );
  });
});

describe("check 3's trials", () => {
  test("copy each group's last unit after it, and take out its first and its last", () => {
    const tree = treeOf(FLAT_BODY, FLAT);
    const groups = groupsOf(tree, FLAT.macros);
    const trials = trialsOf(FLAT_BODY, groups, fieldsOf(tree));
    expect(trials.filter((each) => each.group === 1).map((each) => each.edit)).toEqual([
      {
        kind: "insert",
        at: FLAT_BODY.indexOf("{Lark Bay}") + "{Lark Bay}".length,
        text: "\n    \\inventedentry{\\rtfield{n4}{}}{\\rtfield{n5}{}}",
      },
      {
        kind: "delete",
        start: FLAT_BODY.indexOf("\\inventedentry{Quill"),
        end: FLAT_BODY.indexOf("\\inventedentry{Heron"),
      },
      {
        kind: "delete",
        start: FLAT_BODY.indexOf("{Wrenford}") + "{Wrenford}".length,
        end: FLAT_BODY.indexOf("{Lark Bay}") + "{Lark Bay}".length,
      },
    ]);
  });

  test("give a group of one unit one removal, both its first and its last", () => {
    const tree = treeOf("\\begin{itemize}\n\\item Only invented item\n\\end{itemize}\n", FLAT);
    const trials = trialsOf(tree.source, groupsOf(tree, FLAT.macros), fieldsOf(tree));
    expect(trials.map((each) => each.kind)).toEqual(["copy", "first"]);
  });

  test("go in batches that take out nothing twice", () => {
    const tree = treeOf(FLAT_BODY, FLAT);
    const trials = trialsOf(FLAT_BODY, groupsOf(tree, FLAT.macros), fieldsOf(tree));
    const copies = batchesOf(trials.filter((each) => each.kind === "copy"));
    expect(copies.map((batch) => batch.length)).toEqual([4]);
    // The first section's removal takes out its entries' first: two batches.
    const firsts = batchesOf(trials.filter((each) => each.kind === "first"));
    expect(firsts.map((batch) => batch.map((each) => each.group))).toEqual([[0, 2, 3], [1]]);
  });

  test("are bisected to the ones that fail alone", async () => {
    let compiles = 0;
    const results = await bisect(
      [1, 2, 3, 4, 5, 6, 7, 8],
      async (set) => {
        compiles++;
        return !set.includes(3) && !set.includes(6);
      },
      (ok) => ok,
    );
    expect([...results].filter(([, ok]) => ok === false).map(([n]) => n)).toEqual([3, 6]);
    expect([...results].filter(([, ok]) => ok === true)).toHaveLength(6);
    expect(compiles).toBe(11);
    // A budget spent leaves the rest undecided.
    let left = 3;
    const spent = await bisect(
      [1, 2, 3, 4],
      async (set) => (left-- > 0 ? !set.includes(1) : undefined),
      (ok) => ok,
    );
    expect(spent.get(1)).toBe(false);
    expect(spent.get(3)).toBe(undefined);
  });
});

describe("judging a trial's page", () => {
  test("a copy keeps every glyph of the reference in order, whatever it adds", () => {
    expect(insertedOnly(["a", "b", "c"], ["a", "b", "x", "y", "c"])).toBe(true);
    expect(insertedOnly(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
    expect(insertedOnly(["a", "b", "c"], ["a", "c", "b"])).toBe(false);
    expect(insertedOnly(["a", "b", "c"], ["a", "b"])).toBe(false);
  });

  test("a removal takes out what it must, keeps what it must, and may take the template's", () => {
    const roles = (list: string) => (at: number) =>
      ({ d: "delete", k: "keep", e: "either" })[list[at] as "d" | "k" | "e"] as
        | "delete"
        | "keep"
        | "either";
    expect(deletedOnly(["a", "b", "c", "d"], ["a", "d"], roles("kddk"))).toBe(true);
    expect(deletedOnly(["a", "b", "c", "d"], ["a", "c", "d"], roles("kddk"))).toBe(false);
    expect(deletedOnly(["a", "b", "c", "d"], ["a", "b", "d"], roles("kedk"))).toBe(true);
    // A bullet of the template's like one of a kept part's: either may be the one taken out.
    expect(deletedOnly(["x", "x"], ["x"], roles("ek"))).toBe(true);
    expect(deletedOnly(["x", "y"], ["x", "y", "z"], roles("kk"))).toBe(false);
  });

  test("a page whose columns broke elsewhere keeps every glyph, out of the reference's order", () => {
    const keep = () => "keep" as const;
    // A copy that pushed a left column's last line past the right column's.
    expect(judged("copy", ["a", "b", "r"], ["a", "x", "r", "b"], keep)).toBe("reflows");
    expect(judged("copy", ["a", "b", "r"], ["a", "b", "x", "r"], keep)).toBe("holds");
    expect(judged("copy", ["a", "b", "r"], ["a", "x", "r"], keep)).toBe("breaks");
    expect(judged("copy", ["a"], undefined, keep)).toBe("stops");
    const roles = (list: string) => (at: number) =>
      ({ d: "delete", k: "keep", e: "either" })[list[at] as "d" | "k" | "e"] as
        | "delete"
        | "keep"
        | "either";
    expect(judged("first", ["a", "b", "r", "c"], ["a", "c", "r"], roles("kdkk"))).toBe("reflows");
    expect(judged("first", ["a", "b", "r", "c"], ["a", "r", "c"], roles("kdkk"))).toBe("holds");
    // A glyph it must keep lost, one it must take out kept, or one the reference lacks.
    expect(judged("first", ["a", "b", "r", "c"], ["a", "b"], roles("kdkk"))).toBe("breaks");
    expect(judged("first", ["a", "b", "r", "c"], ["a", "b", "c", "r"], roles("kdkk"))).toBe(
      "breaks",
    );
    expect(judged("last", ["a", "b"], ["z"], roles("dd"))).toBe("breaks");
    expect(deletedAsSet(["x", "x", "y"], ["y", "x"], roles("edk"))).toBe(true);
    expect(insertedAsSet(["x", "x"], ["x"])).toBe(false);
    // Why: glyphs it had to keep gone, glyphs it had to take out left, and glyphs it set anew.
    expect(brokenBy("first", ["a", "b", "r", "c"], ["a", "b"], roles("kdkk"))).toEqual({
      lost: 2,
      left: 1,
      added: 0,
    });
    expect(brokenBy("last", ["a", "b"], ["a", "z", "z"], roles("kd"))).toEqual({
      lost: 0,
      left: 0,
      added: 2,
    });
    expect(brokenBy("copy", ["a", "b"], ["a", "z", "z"], roles("kk"))).toEqual({
      lost: 1,
      left: 0,
      added: 0,
    });
  });

  test("a glyph's role is where its setter stands against what is taken out", () => {
    const page = (n: number) => ({ items: line("x".repeat(n), 0) });
    const reference = { pages: [page(4), page(2)] };
    const candidates = new Map<string, Pick<Candidate, "where" | "start" | "end">>([
      ["c1-1", { where: "body", start: 10, end: 20 }],
      ["c2-1", { where: "body", start: 30, end: 40 }],
      ["h1-1", { where: "preamble", start: 10, end: 20 }],
    ]);
    const runs: UncoveredRun[] = [
      run(0, 0, 1, { by: "candidate", candidate: "c1-1" }),
      run(0, 1, 2, { by: "raw", raw: { start: 25, end: 45, why: "math" } }),
      run(0, 2, 3, { by: "chrome" }),
      run(0, 3, 4, { by: "candidate", candidate: "h1-1" }),
      run(1, 0, 2, { by: "candidate", candidate: "c2-1" }),
    ];
    const role = rolesOf(reference, runs, candidates, [{ start: 28, end: 50 }]);
    expect([0, 1, 2, 3, 4, 5].map(role)).toEqual([
      "keep",
      "either",
      "either",
      "keep",
      "delete",
      "delete",
    ]);
    expect(glyphKeys(reference)).toHaveLength(6);
  });
});

/** Scaled points in a TeX point, and an invented font's size of ten points. */
const PT = 65536;
const SIZE = 10 * PT;

/** An invented line of glyphs at `v`, each half the size wide, a space a gap of three tenths. */
function line(text: string, v: number, h = 0): ReferenceGlyph[] {
  const glyphs: ReferenceGlyph[] = [];
  let at = h;
  for (const character of text) {
    if (character === " ") {
      at += 0.3 * SIZE;
      continue;
    }
    glyphs.push({
      kind: "glyph",
      font: "invented10",
      size: SIZE,
      code: character.codePointAt(0) ?? 0,
      text: character,
      h: at,
      v,
      width: SIZE / 2,
    });
    at += SIZE / 2;
  }
  return glyphs;
}

/** A run of a page's glyphs, from `from` to before `to`, and what sets it. */
function run(
  page: number,
  from: number,
  to: number,
  setter: Pick<UncoveredRun, "by" | "candidate" | "raw">,
): UncoveredRun {
  return { page, from, to, first: { h: 0, v: 0 }, last: { h: 0, v: 0 }, ...setter };
}

describe("the words", () => {
  // Page one: a field's two words, a locked part's two in plain text, a demoted field's one, a
  // raw chunk's one in mathematics, and the template's footer; page two the footer again.
  const body = "Quill Wren\n\\inventedlocked{Lark Heron}\nFinch $Sparrow$";
  /** Where a piece of the body is. */
  const at = (piece: string) => ({
    start: body.indexOf(piece),
    end: body.indexOf(piece) + piece.length,
  });
  const candidates: Pick<ProbeCandidate, "id" | "where" | "start" | "end" | "verdict">[] = [
    { id: "t1", where: "body", start: 0, end: 10, verdict: "editable" },
    { id: "c1-1", where: "body", ...at("Lark Heron"), verdict: "moved" },
    { id: "t2", where: "body", ...at("Finch"), verdict: "editable" },
  ];
  const first = [
    ...line("Quill Wren", 0),
    ...line("Lark Heron", 20 * PT),
    ...line("Finch Sparrow", 40 * PT),
    ...line("Invented 1", 60 * PT),
  ];
  const second = line("Invented 2", 60 * PT);
  const reference: Pick<GlyphStream, "pages"> = { pages: [{ items: first }, { items: second }] };
  const runs: UncoveredRun[] = [
    run(0, 0, 9, { by: "candidate", candidate: "t1" }),
    run(0, 9, 18, { by: "candidate", candidate: "c1-1" }),
    run(0, 18, 23, { by: "candidate", candidate: "t2" }),
    run(0, 23, 30, { by: "raw", raw: { ...at("$Sparrow$"), why: "math" } }),
    run(0, 30, 39, { by: "chrome" }),
    run(1, 0, 9, { by: "chrome" }),
  ];

  test("are set down to a field, kept text the retype reaches, locked text or the template", () => {
    expect(
      wordsOf({
        reference,
        runs,
        candidates,
        fields: new Set(["t1"]),
        sources: { body, preamble: "" },
      }),
    ).toEqual({ body: 6, probe: 3, fields: 2, retype: 3, locked: 1, template: 4 });
  });

  test("give a running line a kept part sets to it on every page", () => {
    // The footer's first copy set by a locked part's call, as a footer macro called once sets it.
    const footer = runs.map((each) =>
      each.page === 0 && each.by === "chrome"
        ? { ...each, by: "candidate" as const, candidate: "c1-1" }
        : each,
    );
    const words = wordsOf({
      reference,
      runs: footer,
      candidates,
      fields: new Set(["t1"]),
      sources: { body, preamble: "" },
    });
    expect(words.template).toBe(0);
    expect(words.body).toBe(10);
  });
});
