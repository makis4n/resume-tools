import { describe, expect, test } from "vitest";
import {
  type Candidate,
  candidatesOf,
  isSetter,
  marked,
  reissued,
  storedIn,
  tightened,
} from "./candidates";
import { bodyOfText, parseBody, type Signatures, type Tree } from "./parse";
import { isRefusal } from "./refusal";

// Every body, class and signature here is invented for these tests: invented commands with
// invented names that say so.

/** What the engine would say of the invented template's commands and environments. */
const SIGNATURES: Signatures = {
  commands: {
    inventedentry: { kind: "template", spec: "m m" },
    inventedopt: { kind: "template", spec: "o m" },
    inventedicon: { kind: "template", spec: "" },
    inventedname: { kind: "template", spec: "m m" },
    inventedpost: { kind: "template", spec: "m" },
  },
  environments: {
    inventeditems: { kind: "template", spec: "m" },
  },
};

function treeOf(text: string, signatures: Signatures = SIGNATURES): Tree {
  const tree = parseBody(bodyOfText(text), signatures);
  if (isRefusal(tree)) throw new Error(tree.message);
  return tree;
}

/** A candidate's id, kind, name, argument, text and why it is not probed, for comparing. */
const summary = (each: Candidate) => ({
  id: each.id,
  kind: each.kind,
  name: each.name,
  ...(each.index === undefined ? {} : { index: each.index }),
  text: each.text,
  ...(each.unprobed === undefined ? {} : { unprobed: each.unprobed }),
  ...(each.within === undefined ? {} : { within: each.within }),
});

/** The source a candidate wraps. */
const spanned = (tree: Tree, each: Candidate) => tree.source.slice(each.start, each.end);

describe("the candidates of a body", () => {
  test("are every argument of every call, and the standard nodes, with ids from their place", () => {
    const tree = treeOf(
      String.raw`\section{Invented Title}
\inventedentry{Invented role}{Jan 2020 -- Present}
\inventedopt[Invented option]{Invented text}
\begin{itemize}
  \item Invented bullet
  \item[Invented label] Invented labelled text
\end{itemize}
Invented paragraph words.`,
    );
    const { candidates } = candidatesOf(tree);
    expect(candidates.map(summary)).toEqual([
      { id: "s1", kind: "section", name: "section", text: "Invented Title" },
      { id: "c1-1", kind: "argument", name: "inventedentry", index: 1, text: "Invented role" },
      { id: "c1-2", kind: "argument", name: "inventedentry", index: 2, text: "Jan 2020 – Present" },
      { id: "c2-1", kind: "argument", name: "inventedopt", index: 1, text: "Invented option" },
      { id: "c2-2", kind: "argument", name: "inventedopt", index: 2, text: "Invented text" },
      { id: "i1", kind: "item", name: "itemize", text: "Invented bullet" },
      { id: "i2-l", kind: "label", name: "itemize", text: "Invented label" },
      { id: "i2", kind: "item", name: "itemize", text: "Invented labelled text" },
      { id: "t1", kind: "paragraph", name: "", text: "Invented paragraph words." },
    ]);
    expect(candidates.map((each) => spanned(tree, each))).toEqual([
      "Invented Title",
      "Invented role",
      "Jan 2020 -- Present",
      "Invented option",
      "Invented text",
      "Invented bullet",
      "Invented label",
      "Invented labelled text",
      "Invented paragraph words.",
    ]);
    expect(candidates.every((each) => /^[a-z0-9-]{1,64}$/.test(each.id))).toBe(true);
    // The same tree gives the same ids.
    expect(candidatesOf(treeOf(tree.source)).candidates).toEqual(candidates);
  });

  test("lock one that holds a raw chunk, whose paragraphs are candidates of their own", () => {
    const tree = treeOf(String.raw`\inventedpost{\textbf{Invented} $|$ \emph{Invented subtitle}}`);
    const { candidates, raw } = candidatesOf(tree);
    expect(candidates.map(summary)).toEqual([
      { id: "c1-1", kind: "argument", name: "inventedpost", index: 1, text: "", unprobed: "raw" },
      { id: "t1", kind: "paragraph", name: "", text: "Invented", within: "c1-1" },
      { id: "t2", kind: "paragraph", name: "", text: "Invented subtitle", within: "c1-1" },
    ]);
    // The mathematics is a raw chunk that may set glyphs no field covers.
    expect(raw.map((chunk) => tree.source.slice(chunk.start, chunk.end))).toEqual(["$|$"]);
  });

  test("take a table's cells as paragraphs, and its rows' marks as raw chunks that set nothing", () => {
    const tree = treeOf(
      String.raw`\inventedpost{\begin{tabular}{ll}\hline Invented & Words \\ \cline{1-2} \multicolumn{2}{r}{Spanning} \\ \end{tabular}}`,
    );
    const { candidates, raw } = candidatesOf(tree);
    expect(candidates.map(summary)).toEqual([
      { id: "c1-1", kind: "argument", name: "inventedpost", index: 1, text: "", unprobed: "raw" },
      { id: "t1", kind: "paragraph", name: "", text: "Invented", within: "c1-1" },
      { id: "t2", kind: "paragraph", name: "", text: "Words", within: "c1-1" },
      { id: "t3", kind: "paragraph", name: "", text: "Spanning", within: "c1-1" },
    ]);
    // A cell's markers go around its text alone, the & and the row's end outside them.
    expect(marked(tree.source, candidates.slice(1))).toBe(
      String.raw`\inventedpost{\begin{tabular}{ll}\hline \rtfield{t1}{Invented} & \rtfield{t2}{Words} \\ \cline{1-2} \multicolumn{2}{r}{\rtfield{t3}{Spanning}} \\ \end{tabular}}`,
    );
    // Only the spanning command, whose text is placed inside it, may set glyphs of its own.
    expect(raw.map((chunk) => chunk.name)).toEqual(["multicolumn"]);
    // A table of one row, with no mark to keep, is still its cells, never one field across the &.
    const row = candidatesOf(
      treeOf(String.raw`\inventedpost{\begin{tabular}{ll} Invented & Words\end{tabular}}`),
    );
    expect(row.candidates.map(summary)).toEqual([
      { id: "c1-1", kind: "argument", name: "inventedpost", index: 1, text: "", unprobed: "raw" },
      { id: "t1", kind: "paragraph", name: "", text: "Invented", within: "c1-1" },
      { id: "t2", kind: "paragraph", name: "", text: "Words", within: "c1-1" },
    ]);
  });

  test("take one that holds structure as a container, whose parts are candidates of their own", () => {
    const tree = treeOf(
      String.raw`\inventedentry{Invented role}{\begin{inventeditems}{Invented heading}
  \item Invented first
  \item Invented second
\end{inventeditems}}`,
    );
    expect(candidatesOf(tree).candidates.map(summary)).toEqual([
      { id: "c1-1", kind: "argument", name: "inventedentry", index: 1, text: "Invented role" },
      {
        id: "c1-2",
        kind: "argument",
        name: "inventedentry",
        index: 2,
        text: "",
        unprobed: "container",
      },
      {
        id: "e1-1",
        kind: "argument",
        name: "inventeditems",
        index: 1,
        text: "Invented heading",
        within: "c1-2",
      },
      { id: "i1", kind: "item", name: "inventeditems", text: "Invented first", within: "c1-2" },
      { id: "i2", kind: "item", name: "inventeditems", text: "Invented second", within: "c1-2" },
    ]);
  });

  test("probe an empty argument, and one that holds an icon, a call that takes nothing", () => {
    const tree = treeOf(String.raw`\inventedentry{}{\inventedicon Invented}`);
    const { candidates } = candidatesOf(tree);
    expect(candidates.map(summary)).toEqual([
      { id: "c1-1", kind: "argument", name: "inventedentry", index: 1, text: "" },
      { id: "c1-2", kind: "argument", name: "inventedentry", index: 2, text: "Invented" },
    ]);
    expect(candidates[0]?.empty).toBe(true);
    expect(candidates[1]?.empty).toBe(false);
    // An empty argument is wrapped where its content would start.
    expect(marked(tree.source, candidates)).toBe(
      String.raw`\inventedentry{\rtfield{c1-1}{}}{\rtfield{c1-2}{\inventedicon Invented}}`,
    );
  });

  test("wrap a group's text inside it, past the space TeX passes over in vertical mode", () => {
    const tree = treeOf(String.raw`\begin{itemize}\item{
    Invented skills text}
\end{itemize}`);
    const [item] = candidatesOf(tree).candidates;
    expect(item && spanned(tree, item)).toBe("Invented skills text");
    // Inside a group that is all of it, past a comment and spaces, and again inside the next.
    expect(tightened("{ %invented\n {x} }", { start: 0, end: 18 })).toEqual({ start: 14, end: 15 });
    expect(tightened("{a}{b}", { start: 0, end: 6 })).toEqual({ start: 0, end: 6 });
    expect(tightened("{\\{}", { start: 0, end: 4 })).toEqual({ start: 1, end: 3 });
  });

  test("wrap an argument given as one token in braces, and keep the spaces after a control word inside", () => {
    const tree = treeOf(String.raw`\inventedpost x and \inventedpost{Stra\ss   }`);
    const { candidates } = candidatesOf(tree);
    expect(marked(tree.source, candidates)).toBe(
      String.raw`\inventedpost {\rtfield{c1-1}{x}} \rtfield{t1}{and} \inventedpost{\rtfield{c2-1}{Stra\ss   }}`,
    );
  });
});

describe("the preamble's calls that store a header's text", () => {
  const macro = (meaning: string) => ({ meaning, hash: "", dependencies: [], capped: false });

  test("are those to a macro that stores each argument once, whatever it does with it after", () => {
    expect(isSetter(macro("macro:#1#2->\\def \\@firstname {#1}\\def \\@lastname {#2}"))).toBe(true);
    expect(isSetter(macro("\\long macro:#1->\\gdef \\@invented {#1}"))).toBe(true);
    expect(isSetter(macro("macro:#1->\\global \\def \\@invented {#1}"))).toBe(true);
    // Awesome-CV's \mobile makes the address from the number it stored.
    expect(
      isSetter(
        macro(
          "macro:#1-> \\def \\@mobile {#1} \\def \\@teluri {tel:\\@mobile }\\StrDel {\\@teluri }{ }[\\@teluri ]",
        ),
      ),
    ).toBe(true);
    expect(isSetter(macro("macro:#1->\\textbf {#1}"))).toBe(false);
    expect(isSetter(macro("macro:#1#2->\\def \\@invented {#1}"))).toBe(false);
    expect(isSetter(macro("macro:#1->\\def \\@invented {#1}\\typeout {#1}"))).toBe(false);
    expect(isSetter(macro("macro:#1->\\edef \\@invented {#1}"))).toBe(false);
    expect(isSetter(macro("macro:->\\@protected@testopt \\invented \\\\invented {}"))).toBe(false);
    expect(isSetter({ kind: "data" })).toBe(false);
    expect(isSetter(undefined)).toBe(false);
  });

  test("store each argument in a macro, which then holds the person's text", () => {
    expect(storedIn(macro("macro:#1#2->\\def \\@firstname {#1}\\def \\@lastname {#2}"))).toEqual([
      "@firstname",
      "@lastname",
    ]);
    expect(storedIn(macro("macro:#1->\\global \\def \\ecv@rfoot {#1}"))).toEqual(["ecv@rfoot"]);
    // What a setter makes of what it stored is its own code, not an argument's store.
    expect(
      storedIn(macro("macro:#1-> \\def \\@mobile {#1} \\def \\@teluri {tel:\\@mobile }")),
    ).toEqual(["@mobile"]);
    expect(storedIn(macro("macro:#1->\\textbf {#1}"))).toEqual([]);
    expect(storedIn({ kind: "data" })).toEqual([]);
    expect(storedIn(undefined)).toEqual([]);
  });

  test("are candidates, issued again with their arguments in their markers", () => {
    const preamble = String.raw`\documentclass{inventedcv}
\inventedname{Quill}{Invented}
{\inventedname{Grouped}{Never}}
\inventedpost{Not a setter}`;
    const tree = treeOf("Invented body.");
    const pre = treeOf(preamble);
    const { candidates, setters } = candidatesOf(tree, {
      preamble: pre,
      setters: new Set(["inventedname"]),
    });
    // Only the call at the preamble's top level, to a setter, is one.
    expect(setters).toEqual([{ start: 27, end: 57 }]);
    const ours = candidates.filter((each) => each.where === "preamble");
    expect(ours.map(summary)).toEqual([
      { id: "h1-1", kind: "argument", name: "inventedname", index: 1, text: "Quill" },
      { id: "h1-2", kind: "argument", name: "inventedname", index: 2, text: "Invented" },
    ]);
    expect(ours.every((each) => each.call === 0)).toBe(true);
    expect(reissued(preamble, setters, [ours[1] as Candidate])).toBe(
      "\\inventedname{Quill}{\\rtfield{h1-2}{Invented}}\n",
    );
    expect(
      reissued(
        preamble,
        setters,
        candidates.filter((each) => each.where === "body"),
      ),
    ).toBe("");
  });
});
