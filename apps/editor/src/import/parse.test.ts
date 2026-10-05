import { readFileSync } from "node:fs";
import { join } from "node:path";
import type * as Ast from "@unified-latex/unified-latex-types";
import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { bound, fastest } from "../test/timing";
import { MAX_DELIMITED } from "./arguments";
import { readTree } from "./fonts";
import { encodeLike, type Intake, intake } from "./intake";
import {
  type Body,
  bodyOf,
  bodyOfText,
  buildTree,
  type CallNode,
  maskedForParse,
  type Node,
  nestsPast,
  PARSE_CAPS,
  PARSE_REFUSALS,
  parseBody,
  readBody,
  type Signatures,
  type Tree,
  usesOf,
} from "./parse";
import { print, regenerate, spellingOf } from "./print";
import { compileLikeReference, type Reference, reference, sameGlyphs } from "./reference";
import { isRefusal } from "./refusal";
import { signatures } from "./signatures";

// Every body, class and signature here is invented for these tests: invented commands with
// invented names that say so.

/** What the engine would say of the invented template's commands and environments. */
const SIGNATURES: Signatures = {
  commands: {
    cventry: { kind: "template", spec: "m m m m" },
    cvopt: { kind: "template", spec: "o m" },
    cvstar: { kind: "template", spec: "s m" },
    cvnone: { kind: "template", spec: "" },
    cvdelim: { kind: "template" },
    cvlength: { kind: "register" },
    today: { kind: "standard", spec: "" },
    cvwhat: { kind: "undefined" },
  },
  environments: {
    cvitems: { kind: "template", spec: "o" },
    cvbox: { kind: "template", spec: "m" },
  },
};

/** A body's tree, which must print back to the body byte for byte. */
function treeOf(text: string, signatures: Signatures | undefined = SIGNATURES): Tree {
  const tree = parseBody(bodyOfText(text), signatures);
  if (isRefusal(tree)) throw new Error(tree.message);
  expect(print(tree)).toBe(text);
  return tree;
}

/** A node's text, from its span of the body. */
const sourceOf = (tree: Tree, node: { start: number; end: number }) =>
  tree.source.slice(node.start, node.end);

/** The kinds of a list of nodes, a raw one with its name. */
const kinds = (nodes: readonly Node[]) =>
  nodes.map((node) => (node.kind === "raw" ? `raw ${node.name ?? node.why}` : node.kind));

describe("sections", () => {
  test("reads \\section and its kin, their star and their titles", () => {
    const tree = treeOf(
      String.raw`\section{Invented Experience}
\section*{Unnumbered}
\subsection[Short]{A \textbf{bold} title}
\paragraph{Deep}`,
    );
    expect(tree.content).toMatchObject([
      { kind: "section", name: "section", level: 1, star: false },
      { kind: "section", name: "section", level: 1, star: true },
      { kind: "section", name: "subsection", level: 2, star: false },
      { kind: "section", name: "paragraph", level: 4 },
    ]);
    const [first, , third] = tree.content;
    expect(first).toMatchObject({
      title: [{ kind: "text", runs: [{ text: "Invented Experience" }] }],
    });
    expect(third).toMatchObject({
      args: [{ present: false }, { present: true, content: [{ kind: "text" }] }, { present: true }],
      title: [
        { kind: "text", runs: [{ text: "A " }, { text: "bold", bold: true }, { text: " title" }] },
      ],
    });
  });

  test("places a title that is not all text, as one with an icon", () => {
    const tree = treeOf(String.raw`\section{\cvnone Invented}`);
    expect(tree.content).toMatchObject([
      { kind: "section", title: [{ kind: "call", name: "cvnone" }, { kind: "text" }] },
    ]);
  });
});

describe("lists", () => {
  test("reads itemize, enumerate and description, each \\item with its content", () => {
    const tree = treeOf(
      String.raw`\begin{itemize}[leftmargin=*]
  \setlength{\itemsep}{0pt}
  \item First invented thing
  \item[--] Second \emph{one}
\end{itemize}
\begin{enumerate}\item One\item Two\end{enumerate}
\begin{description}
  \item[Label] Described
\end{description}`,
    );
    const [itemize, enumerate, description] = tree.content;
    expect(itemize).toMatchObject({
      kind: "list",
      name: "itemize",
      args: [{ kind: "optional", present: true }],
    });
    expect(kinds((itemize as { content: Node[] }).content)).toEqual([
      "raw setlength",
      "item",
      "item",
    ]);
    expect(itemize).toMatchObject({
      content: [
        {},
        {
          kind: "item",
          args: [{ present: false }],
          content: [{ kind: "text", runs: [{ text: "First invented thing" }] }],
        },
        {
          kind: "item",
          args: [{ present: true, content: [{ kind: "text", runs: [{ text: "\u2013" }] }] }],
          content: [{ kind: "text", runs: [{ text: "Second " }, { text: "one", italic: true }] }],
        },
      ],
    });
    expect(kinds((enumerate as { content: Node[] }).content)).toEqual(["item", "item"]);
    expect(description).toMatchObject({
      kind: "list",
      content: [{ kind: "item", args: [{ present: true }] }],
    });
  });

  test("nests a list in an item", () => {
    const tree = treeOf(
      String.raw`\begin{itemize}\item Outer \begin{itemize}\item Inner\end{itemize}\end{itemize}`,
    );
    expect(tree.content).toMatchObject([
      {
        kind: "list",
        content: [
          {
            kind: "item",
            content: [{ kind: "text" }, { kind: "list", content: [{ kind: "item" }] }],
          },
        ],
      },
    ]);
  });

  test("gives an \\item outside a list the text after it, up to the next or a call", () => {
    const tree = treeOf(String.raw`\cvnone
\item One invented \vspace{1pt}
\item Two
\cvnone`);
    expect(kinds(tree.content)).toEqual(["call", "item", "item", "call"]);
    expect(tree.content[1]).toMatchObject({
      content: [{ kind: "text" }, { kind: "raw", name: "vspace" }],
    });
  });
});

describe("template calls", () => {
  test("reads a call's arguments by its signature, each a subtree", () => {
    const tree = treeOf(String.raw`\cventry
  {Invented Role}{Invented Labs}%
  {Harbour City}
  {Jan 2020 -- Present}`);
    const call = tree.content[0] as CallNode;
    expect(call).toMatchObject({ kind: "call", name: "cventry", star: false });
    expect(call.args.map((arg) => arg.kind)).toEqual([
      "mandatory",
      "mandatory",
      "mandatory",
      "mandatory",
    ]);
    expect(call.args.map((arg) => sourceOf(tree, arg))).toEqual([
      "{Invented Role}",
      "{Invented Labs}",
      "{Harbour City}",
      "{Jan 2020 -- Present}",
    ]);
    expect(call.args[3]?.content).toMatchObject([
      {
        kind: "date",
        dates: { start: "2020-01", end: "present" },
        text: "Jan 2020 \u2013 Present",
      },
    ]);
    expect(sourceOf(tree, call)).toBe(tree.source);
  });

  test("marks an optional argument, given or not, and the star", () => {
    const tree = treeOf(
      String.raw`\cvopt{Plain} \cvopt [Other]{Plain} \cvstar*{Starred} \cvstar{Not}`,
    );
    expect(tree.content).toMatchObject([
      {
        kind: "call",
        name: "cvopt",
        args: [{ kind: "optional", present: false }, { kind: "mandatory" }],
      },
      {
        kind: "call",
        name: "cvopt",
        args: [
          {
            kind: "optional",
            present: true,
            content: [{ kind: "text", runs: [{ text: "Other" }] }],
          },
          {},
        ],
      },
      { kind: "call", name: "cvstar", star: true, args: [{ kind: "star", present: true }, {}] },
      { kind: "call", name: "cvstar", star: false },
    ]);
  });

  test("takes one token for an argument that is not braced, as TeX does", () => {
    const tree = treeOf(String.raw`\cvopt Quill`);
    expect(tree.content).toMatchObject([
      {
        kind: "call",
        args: [
          { present: false },
          { open: "", content: [{ kind: "text", runs: [{ text: "Q" }] }] },
        ],
      },
      { kind: "text", runs: [{ text: "uill" }] },
    ]);
  });

  test("keeps a call raw when a mandatory argument is missing, or its signature is unknown", () => {
    const tree = treeOf(String.raw`\cventry{a}{b}

\cvdelim Stop. \cvwhat{x} \cvunknown`);
    // The braces after a command the parser keeps raw are a group, which holds text here.
    expect(kinds(tree.content)).toEqual([
      "raw cventry",
      "raw cvdelim",
      "text",
      "raw cvwhat",
      "text",
      "raw cvunknown",
    ]);
    expect(tree.content[0]).toMatchObject({ why: "unresolved" });
    expect(tree.content[1]).toMatchObject({ why: "unresolved" });
    expect(tree.content[3]).toMatchObject({ why: "unknown" });
  });

  test("finds nothing the engine said for a name a plain object's prototype holds", () => {
    const tree = treeOf(String.raw`\constructor{x} \toString`);
    expect(tree.content).toMatchObject([
      { kind: "raw", why: "unknown", name: "constructor" },
      { kind: "text" },
      { kind: "raw", why: "unknown", name: "toString" },
    ]);
  });

  test("places a call in a group with a size, and a call in another's argument", () => {
    const tree = treeOf(String.raw`{\small \cvopt{a}} \cvopt{\cvstar{b}}`);
    expect(tree.content).toMatchObject([
      { kind: "group", content: [{ kind: "raw", name: "small" }, { kind: "call" }] },
      { kind: "call", args: [{}, { content: [{ kind: "call", name: "cvstar" }] }] },
    ]);
  });
});

describe("template environments and blocks", () => {
  test("reads a template environment's arguments and body, items among it", () => {
    const tree = treeOf(String.raw`\begin{cvitems}[Invented]
  \item One
  \item Two
\end{cvitems}
\begin{cvbox}{Title}Inside\end{cvbox}`);
    expect(tree.content).toMatchObject([
      {
        kind: "environment",
        name: "cvitems",
        args: [{ present: true, content: [{ kind: "text" }] }],
        content: [{ kind: "item" }, { kind: "item" }],
      },
      {
        kind: "environment",
        name: "cvbox",
        args: [{ content: [{ kind: "text" }] }],
        content: [{ kind: "text" }],
      },
    ]);
  });

  test("places a standard block's body, and keeps its options as they are", () => {
    const tree = treeOf(String.raw`\begin{center}\textbf{Quill Invented}\end{center}
\begin{minipage}[t]{0.5\textwidth}Left\end{minipage}`);
    expect(tree.content).toMatchObject([
      { kind: "block", name: "center", content: [{ kind: "text" }] },
      {
        kind: "block",
        name: "minipage",
        args: [{ present: true }, { present: false }, { present: false }, { present: true }],
        content: [{ kind: "text" }],
      },
    ]);
    expect((tree.content[1] as { args: { content?: unknown }[] }).args[3]?.content).toBeUndefined();
  });
});

describe("raw chunks", () => {
  test("keeps the smallest node the parser cannot place raw, and no more", () => {
    const tree = treeOf(String.raw`An invented paragraph.

\vspace{2pt}

Another one.`);
    expect(kinds(tree.content)).toEqual(["text", "raw vspace", "text"]);
    expect(sourceOf(tree, tree.content[1] as Node)).toBe(String.raw`\vspace{2pt}`);
  });

  test("keeps mathematics, verbatim, a tabular and an unknown environment raw", () => {
    const tree = treeOf(String.raw`$x^2$ \verb|a%b| \[y\]
\begin{tabular}{ll} a & b \\ \end{tabular}
\begin{unknownenv}x\end{unknownenv}`);
    expect(tree.content).toMatchObject([
      { kind: "raw", why: "math" },
      { kind: "raw", why: "verbatim" },
      { kind: "raw", why: "math" },
      { kind: "raw", why: "environment", name: "tabular" },
      { kind: "raw", why: "environment", name: "unknownenv" },
    ]);
  });

  test("keeps a command's non-text arguments with it, and places text it shows", () => {
    const tree = treeOf(String.raw`\textcolor{red}{Coloured \cvnone} \hfill \rule{1pt}{2pt}`);
    expect(tree.content).toMatchObject([
      {
        kind: "raw",
        name: "textcolor",
        args: [{ present: false }, {}, { content: [{ kind: "text" }, { kind: "call" }] }],
      },
      { kind: "raw", name: "hfill" },
      { kind: "raw", name: "rule" },
    ]);
    const colour = (tree.content[0] as { args: object[] }).args[1];
    expect(colour !== undefined && "content" in colour).toBe(false);
  });

  test("keeps a definition in TeX's syntax and a quantity with their commands", () => {
    const tree = treeOf(
      String.raw`\def\quill#1{#1!} \let\wort=\relax \vskip 3pt plus 1pt minus 2pt\cvlength=4pt Text \penalty-100 end`,
    );
    expect(tree.content.map((node) => sourceOf(tree, node))).toEqual([
      String.raw`\def\quill#1{#1!}`,
      String.raw`\let\wort=\relax`,
      String.raw`\vskip 3pt plus 1pt minus 2pt`,
      String.raw`\cvlength=4pt`,
      "Text",
      String.raw`\penalty-100`,
      "end",
    ]);
  });

  test("keeps a standard command the engine resolved with its arguments", () => {
    const tree = treeOf(String.raw`Dated \today.`);
    expect(kinds(tree.content)).toEqual(["text", "raw today", "text"]);
  });
});

describe("conditionals whose branch is known", () => {
  test("keeps what \\iffalse skips raw, to its \\fi, nesting counted", () => {
    const text = String.raw`Before.
\iffalse
\cventry{Old}{Role}{City}{2019}
An old invented paragraph. \ifx\a\b x\else y\fi
\fi
After.`;
    const tree = treeOf(text);
    expect(tree.content).toMatchObject([
      { kind: "text" },
      { kind: "raw", why: "skipped", name: "iffalse" },
      { kind: "text", runs: [{ text: "After." }] },
    ]);
    expect(sourceOf(tree, tree.content[1] as Node)).toMatch(/^\\iffalse[\s\S]*\\fi$/);
    expect(sourceOf(tree, tree.content[1] as Node).endsWith("y\\fi\n\\fi")).toBe(true);
  });

  test("places \\iffalse's \\else branch, and \\iftrue's own, keeping what either skips raw", () => {
    const tree = treeOf(
      String.raw`\iffalse Skipped \else Taken\fi{} and \iftrue Kept\else Gone\fi`,
    );
    expect(tree.content).toMatchObject([
      { kind: "raw", why: "skipped", name: "iffalse" },
      { kind: "text", runs: [{ text: "Taken" }] },
      { kind: "raw", name: "fi" },
      { kind: "text", runs: [{ text: "and" }] },
      { kind: "raw", why: "command", name: "iftrue" },
      { kind: "text", runs: [{ text: "Kept" }] },
      { kind: "raw", why: "skipped", name: "else" },
    ]);
  });

  test("counts a conditional \\newif makes, which the engine says is a primitive", () => {
    const signatures: Signatures = {
      commands: { ifcvdraft: { kind: "primitive" } },
      environments: {},
    };
    const tree = treeOf(String.raw`\iffalse a \ifcvdraft b \fi c \fi d`, signatures);
    expect(kinds(tree.content)).toEqual(["raw iffalse", "text"]);
    expect(tree.content[1]).toMatchObject({ runs: [{ text: "d" }] });
  });

  test("leaves one whose \\fi is not among the nodes after it, and the others, as they are", () => {
    expect(kinds(treeOf(String.raw`{\iffalse a} b\fi`).content)).toEqual([
      "group",
      "text",
      "raw fi",
    ]);
    expect(kinds(treeOf(String.raw`\ifx\a\b yes\fi`, SIGNATURES).content)).toContain("text");
  });
});

describe("alignments", () => {
  /**
   * What the engine would say of an invented class's `skilltable`, which wraps a `tabular`, and of
   * its `\skill`, which sets a row: the class's meanings no longer count, only the body's `&`.
   */
  const TABLES: Signatures = {
    commands: { ...SIGNATURES.commands, skill: { kind: "template", spec: "m m" } },
    environments: { ...SIGNATURES.environments, skilltable: { kind: "template", spec: "" } },
  };

  test("places the calls in a template environment's body, and keeps it raw where it holds an & of its own", () => {
    const tree = treeOf(
      String.raw`\begin{skilltable}
\skill{Languages}{Quill, Wort}
\skill{Tools}{Invented}
\end{skilltable}
\begin{skilltable}
Languages & Quill, Wort \\
Tools & Invented \\
\end{skilltable}`,
      TABLES,
    );
    expect(tree.content).toMatchObject([
      {
        kind: "environment",
        name: "skilltable",
        content: [
          {
            kind: "call",
            name: "skill",
            args: [
              { content: [{ kind: "text", runs: [{ text: "Languages" }] }] },
              { content: [{ kind: "text", runs: [{ text: "Quill, Wort" }] }] },
            ],
          },
          { kind: "call", name: "skill" },
        ],
      },
      { kind: "environment", name: "skilltable", content: [{ kind: "raw", why: "alignment" }] },
    ]);
    const [, table] = tree.content;
    const body = table?.kind === "environment" ? table.content[0] : undefined;
    expect(body && sourceOf(tree, body)).toBe(
      "Languages & Quill, Wort \\\\\nTools & Invented \\\\",
    );
  });

  test("keeps the body placed where its & is in a call's argument or in mathematics", () => {
    const tree = treeOf(
      String.raw`\begin{skilltable}
\skill{Languages}{Quill & Wort}
\cvopt[Tools & Made-up]{Invented}
\skill{Invented}{$a & b$}
\end{skilltable}`,
      TABLES,
    );
    expect(tree.content).toMatchObject([
      {
        kind: "environment",
        content: [
          { kind: "call", args: [{}, { content: [{ kind: "raw", why: "alignment" }] }] },
          {
            kind: "call",
            name: "cvopt",
            args: [
              { kind: "optional", content: [{ kind: "raw", why: "alignment" }] },
              { content: [{ kind: "text", runs: [{ text: "Invented" }] }] },
            ],
          },
          { kind: "call", args: [{}, { content: [{ kind: "raw", why: "math" }] }] },
        ],
      },
    ]);
    // The tree counts what it keeps, and none of what a table's body lets go.
    const table = treeOf(
      String.raw`\begin{skilltable}\skill{a}{b} x & y \\ \end{skilltable}`,
      TABLES,
    );
    expect(table.content).toMatchObject([
      { kind: "environment", content: [{ kind: "raw", why: "alignment" }] },
    ]);
    expect(table.nodes).toBe(2);
  });

  test("keeps a paragraph with an alignment's & raw, but not one with \\&", () => {
    const tree = treeOf(String.raw`\cvopt{t} Languages & Quill \\ Tools & Wort

Quill \& Wort`);
    expect(tree.content).toMatchObject([
      { kind: "call" },
      { kind: "raw", why: "alignment" },
      { kind: "text", runs: [{ text: "Quill & Wort" }] },
    ]);
  });

  test("keeps raw a paragraph whose \\\\ ends a table's row, and reads one elsewhere as a space", () => {
    // The argument holds an & of its own, so the \\ with text after it in its second paragraph
    // ends a row; the body around it holds none, so its \\ breaks a line, a space in a field.
    const tree = treeOf(String.raw`\cvopt{Languages & Quill \\

Certified \\ Invented}

Quill \\ Wort`);
    expect(tree.content).toMatchObject([
      {
        kind: "call",
        args: [
          { present: false },
          {
            content: [
              { kind: "raw", why: "alignment" },
              { kind: "raw", name: "\\" },
              { kind: "raw", why: "alignment" },
            ],
          },
        ],
      },
      { kind: "text", runs: [{ text: "Quill Wort" }] },
    ]);
    const [call] = tree.content;
    const certified = call?.kind === "call" ? call.args[1]?.content?.[2] : undefined;
    expect(certified && sourceOf(tree, certified)).toBe("Certified \\\\ Invented");
  });
});

describe("declarations used as environments", () => {
  test("places a size's, a shape's and a series' body, and marks bold and italic", () => {
    const tree = treeOf(String.raw`\begin{footnotesize}
\section{Invented}
\cvopt{a}
\end{footnotesize}
\begin{bfseries}Bold \begin{em}and emphasised\end{em}\end{bfseries}
\begin{itshape}Italic \begin{em}upright\end{em}\end{itshape}
\begin{raggedright}Ragged\end{raggedright}\begin{samepage}Same\end{samepage}`);
    expect(tree.content).toMatchObject([
      { kind: "block", name: "footnotesize", content: [{ kind: "section" }, { kind: "call" }] },
      {
        kind: "block",
        name: "bfseries",
        content: [
          { kind: "text", runs: [{ text: "Bold", bold: true }] },
          { kind: "block", content: [{ kind: "text", runs: [{ bold: true, italic: true }] }] },
        ],
      },
      {
        kind: "block",
        name: "itshape",
        content: [
          { kind: "text", runs: [{ text: "Italic", italic: true }] },
          { kind: "block", content: [{ kind: "text", runs: [{ text: "upright" }] }] },
        ],
      },
      { kind: "block", name: "raggedright" },
      { kind: "block", name: "samepage" },
    ]);
  });

  test("asks the engine about none of them", () => {
    const read = readBody(
      bodyOfText(String.raw`\begin{small}a\end{small}\begin{sloppypar}b\end{sloppypar}\iffalse\fi`),
    );
    if (isRefusal(read)) throw new Error(read.message);
    expect(usesOf(read)).toEqual({ commands: [], environments: [] });
  });
});

describe("calls a group after them belies", () => {
  const signatures: Signatures = {
    commands: {
      cvding: { kind: "template", spec: "" },
      cvopen: { kind: "template", spec: "m o" },
      cvstarred: { kind: "template", spec: "s" },
      cvfine: { kind: "template", spec: "o m" },
      cvtail: { kind: "template", spec: "s o m m", tail: "unresolved" },
    },
    environments: {},
  };

  test("keeps a call raw, with the groups after it, where its signature takes no mandatory one", () => {
    const tree = treeOf(
      String.raw`\cvding{51} Skill. \cvstarred* {a}%
{b} c`,
      signatures,
    );
    expect(tree.content).toMatchObject([
      { kind: "raw", why: "unresolved", name: "cvding", suspect: true, args: [{ present: true }] },
      { kind: "text" },
      {
        kind: "raw",
        name: "cvstarred",
        suspect: true,
        args: [{ kind: "star" }, { open: "{" }, { open: "{" }],
      },
      { kind: "text", runs: [{ text: "c" }] },
    ]);
    expect(sourceOf(tree, tree.content[0] as Node)).toBe(String.raw`\cvding{51}`);
  });

  test("keeps one raw whose signature ends in an optional argument a group follows", () => {
    const tree = treeOf(String.raw`\cvopen{a}[b]{c} \cvopen{a} end`, signatures);
    expect(tree.content).toMatchObject([
      { kind: "raw", name: "cvopen", suspect: true },
      { kind: "call", name: "cvopen" },
      { kind: "text" },
    ]);
  });

  test("keeps a call no group follows, or whose signature ends in a mandatory argument", () => {
    const tree = treeOf(String.raw`\cvding Skill. \cvfine{a} {b}`, signatures);
    expect(kinds(tree.content)).toEqual(["call", "text", "call", "text"]);
  });

  test("keeps raw a call a group follows whose tail could not be read, whatever it takes", () => {
    // As europecv's `\ecvitem`, `s o m m` and a look ahead at its end: a third group is suspect.
    const tree = treeOf(String.raw`\cvtail{a}{b} {c} then \cvtail[x]{a}{b} end`, signatures);
    expect(tree.content).toMatchObject([
      {
        kind: "raw",
        why: "unresolved",
        name: "cvtail",
        suspect: true,
        args: [{ kind: "star" }, { kind: "optional" }, {}, {}, { open: "{" }],
      },
      { kind: "text" },
      { kind: "call", name: "cvtail" },
      { kind: "text" },
    ]);
    expect(sourceOf(tree, tree.content[0] as Node)).toBe(String.raw`\cvtail{a}{b} {c}`);
  });
});

describe("dates", () => {
  test("reads a whole argument or a whole text run as dates, and nothing else", () => {
    const tree = treeOf(String.raw`\textbf{Invented Labs} \hfill Jan 2020 -- May 2021

\cvopt{2019}

Worked there Jan 2020 -- May 2021.

\textbf{Jan 2020}`);
    expect(tree.content).toMatchObject([
      { kind: "text" },
      { kind: "raw", name: "hfill" },
      { kind: "date", dates: { start: "2020-01", end: "2021-05" } },
      { kind: "call", args: [{}, { content: [{ kind: "date", dates: { start: "2019" } }] }] },
      { kind: "text" },
      { kind: "text", runs: [{ text: "Jan 2020", bold: true }] },
    ]);
  });
});

describe("what the body uses", () => {
  test("names the commands and environments the table does not know, outside mathematics", () => {
    const read = readBody(
      bodyOfText(
        String.raw`\cventry{a}{b}{c}{d} \textbf{x} $\alpha$ \begin{cvitems}\item y\end{cvitems}\begin{itemize}\end{itemize}`,
      ),
    );
    if (isRefusal(read)) throw new Error(read.message);
    expect(usesOf(read)).toEqual({ commands: ["cventry"], environments: ["cvitems"] });
  });
});

describe("the body of a main file", () => {
  const intakeOf = (
    main: string,
    files: Record<string, string> = {},
  ): Pick<Intake, "main" | "files"> => ({
    main: { path: "cv/cv.tex", text: main, bytes: new TextEncoder().encode(main) },
    files: Object.fromEntries(
      Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)]),
    ),
  });
  const bodyFrom = (main: string, files?: Record<string, string>): Body => {
    const body = bodyOf(intakeOf(main, files));
    if (isRefusal(body)) throw new Error(body.message);
    return body;
  };

  test("splits the main file at \\begin{document} and \\end{document}, outside comments", () => {
    const body = bodyFrom(
      "\\documentclass{article}\n% \\begin{document}\n\\begin{document}\nQuill\n\\end{document}\ntrailing",
    );
    expect(body.preamble).toBe("\\documentclass{article}\n% \\begin{document}\n");
    expect(body.before).toBe(`${body.preamble}\\begin{document}`);
    expect(body.text).toBe("\nQuill\n");
    expect(body.after).toBe("\\end{document}\ntrailing");
    expect(body.sources).toEqual([{ start: 0, end: 7, file: "cv.tex", offset: 59 }]);
  });

  test("ends the body at the \\end{document} TeX reads, past one a verbatim or a \\verb shows", () => {
    // An invented resume that shows a document's code, as `other-0006`'s shape does (the follow-up
    // to decision 0060): the body runs past the code's `\end{document}` to the document's own.
    const code =
      "\\begin{verbatim}\n\\begin{document}\nInvented sample\n\\end{document}\n\\end{verbatim}";
    const main = `\\documentclass{article}\n\\begin{document}\nQuill\n${code}\nAshgrove \\verb|\\end{document}| here\n\\section{Invented}\nTenterfield\n\\end{document}\n`;
    const body = bodyFrom(main);
    expect(body.text).toBe(
      `\nQuill\n${code}\nAshgrove \\verb|\\end{document}| here\n\\section{Invented}\nTenterfield\n`,
    );
    expect(body.after).toBe("\\end{document}\n");
    // A comment's verbatim is no verbatim, and one never closed is read as before.
    const commented = bodyFrom(
      "\\begin{document}\n% \\begin{verbatim}\nQuill\n\\end{document}\n\\end{verbatim}\n",
    );
    expect(commented.after).toBe("\\end{document}\n\\end{verbatim}\n");
    const open = bodyFrom("\\begin{document}\n\\begin{verbatim}\nQuill\n\\end{document}\n");
    expect(open.text).toBe("\n\\begin{verbatim}\nQuill\n");
  });

  test("refuses a main file that does not start and end its document", () => {
    expect(bodyOf(intakeOf("\\documentclass{article}\nQuill"))).toMatchObject({
      refused: true,
      reason: "parse",
      message: PARSE_REFUSALS.body,
    });
    expect(bodyOf(intakeOf("\\begin{document}Quill"))).toMatchObject({
      message: PARSE_REFUSALS.body,
    });
  });

  test("inlines the .tex files the job holds, and says where each part came from", () => {
    const main =
      "\\begin{document}\nA \\input{parts/one}B \\input two C \\input{missing} D \\input{style.sty}\\end{document}";
    const body = bodyFrom(main, {
      "parts/one.tex": "One\n",
      "two.tex": "Two, no newline",
      "style.sty": "not text",
    });
    expect(body.text).toBe("\nA One\nB Two, no newline\n C \\input{missing} D \\input{style.sty}");
    expect(
      body.sources.map((source) => [body.text.slice(source.start, source.end), source.file]),
    ).toEqual([
      ["\nA ", "cv.tex"],
      ["One\n", "parts/one.tex"],
      ["B ", "cv.tex"],
      ["Two, no newline", "two.tex"],
      ["\n", undefined],
      [" C \\input{missing} D \\input{style.sty}", "cv.tex"],
    ]);
  });

  test("honours \\endinput where it begins its line, and inputs within inputs", () => {
    const body = bodyFrom("\\begin{document}\\input{outer}\\end{document}", {
      "outer.tex": "Outer \\input{inner}after\n",
      "inner.tex": "Inner words\n  \\endinput rest of line\nnever read\n",
    });
    expect(body.text).toBe("Outer Inner words\nafter\n");
    // On a file's first line, it leaves nothing, and no newline is added.
    expect(
      bodyFrom("\\begin{document}A \\input{part}B\\end{document}", {
        "part.tex": "\\endinput\nnever read\n",
      }).text,
    ).toBe("A B");
  });

  test("inlines a file whole where \\endinput follows something on its line, as a guard does", () => {
    const part = "\\ifdefined\\partdone\\endinput\\fi\n\\def\\partdone{}\nCharlie.\n";
    const body = bodyFrom("\\begin{document}\\input{part}Next\\end{document}", {
      "part.tex": part,
    });
    expect(body.text).toBe(`${part}Next`);
  });

  test("keeps TeX's two spaces around a file whose input is the last thing on its line", () => {
    // The file's last line's end and the input's line's end: an empty group keeps the two from
    // making a blank line.
    expect(
      bodyFrom("\\begin{document}Opening\n\\input{part}\nclosing\\end{document}", {
        "part.tex": "inputted\n",
      }).text,
    ).toBe("Opening\ninputted\n{}\nclosing");
    expect(
      bodyFrom("\\begin{document}Opening\n\\input{part}  \nclosing\\end{document}", {
        "part.tex": "no newline",
      }).text,
    ).toBe("Opening\nno newline\n{}  \nclosing");
    expect(
      bodyFrom("\\begin{document}Opening\n\\input{outer}\nclosing\\end{document}", {
        "outer.tex": "outer\n\\input{inner}\n",
        "inner.tex": "inner\n",
      }).text,
    ).toBe("Opening\nouter\ninner\n{}\n{}\nclosing");
    // A comment after the input takes its line's end, and a file `\endinput` ends on its first
    // line leaves the input's line a space, not a blank line.
    expect(
      bodyFrom("\\begin{document}Opening\n\\input{part}% note\nclosing\\end{document}", {
        "part.tex": "inputted\n",
      }).text,
    ).toBe("Opening\ninputted\n% note\nclosing");
    expect(
      bodyFrom("\\begin{document}Opening\n\\input{part}\nclosing\\end{document}", {
        "part.tex": "\\endinput\n",
      }).text,
    ).toBe("Opening\n{}\nclosing");
  });

  test("reads an empty file as TeX does, one empty line, which ends a paragraph", () => {
    const empty = (main: string) =>
      bodyFrom(`\\begin{document}${main}\\end{document}`, { "part.tex": "" }).text;
    expect(empty("Opening\n\\input{part}\nclosing")).toBe("Opening\n\n{}\nclosing");
    expect(empty("Opening \\input{part} closing")).toBe("Opening \n\n closing");
  });

  test("takes a bare name's line end as TeX does, as the end of the name", () => {
    const bare = (part: string) =>
      bodyFrom("\\begin{document}Opening\n\\input part\nclosing\\end{document}", {
        "part.tex": part,
      }).text;
    expect(bare("inputted\n")).toBe("Opening\ninputted\nclosing");
    expect(bare("inputted")).toBe("Opening\ninputted\nclosing");
    expect(bare("")).toBe("Opening\n\nclosing");
  });

  test("inlines \\include between two \\clearpage, or leaves the one \\includeonly leaves out", () => {
    expect(
      bodyFrom("\\begin{document}\\include{part}\\end{document}", { "part.tex": "Part\n" }).text,
    ).toBe("\\clearpage\nPart\n\\clearpage\n");
    expect(
      bodyFrom("\\includeonly{other}\n\\begin{document}\\include{part}\\end{document}", {
        "part.tex": "Part\n",
      }).text,
    ).toBe("\\clearpage\n");
  });

  test("records the empty group it adds as the parser's", () => {
    const body = bodyFrom("\\begin{document}A\n\\input{part}\nB\\end{document}", {
      "part.tex": "P\n",
    });
    expect(
      body.sources.map((source) => [body.text.slice(source.start, source.end), source.file]),
    ).toEqual([
      ["A\n", "cv.tex"],
      ["P\n", "part.tex"],
      ["{}", undefined],
      ["\nB", "cv.tex"],
    ]);
  });

  test("leaves an input that inputs itself as it is", () => {
    const body = bodyFrom("\\begin{document}\\input{loop}\\end{document}", {
      "loop.tex": "L \\input{loop}\n",
    });
    expect(body.text).toBe("L \\input{loop}\n");
  });

  test("refuses a body past its cap, inlined", () => {
    const big = "x".repeat(PARSE_CAPS.bodyBytes / 4);
    const body = bodyOf(
      intakeOf(
        "\\begin{document}\\input{big}\\input{big}\\input{big}\\input{big}\\input{big}\\end{document}",
        { "big.tex": big },
      ),
    );
    expect(body).toMatchObject({ refused: true, message: PARSE_REFUSALS.long });
  });
});

describe("caps", () => {
  test("refuses a body nested past the tree's levels before it is parsed", () => {
    const deep = `${"{".repeat(PARSE_CAPS.levels + 1)}x${"}".repeat(PARSE_CAPS.levels + 1)}`;
    expect(nestsPast(deep, PARSE_CAPS.levels)).toBe(true);
    expect(nestsPast("{x}".repeat(1000), PARSE_CAPS.levels)).toBe(false);
    expect(nestsPast(`\\verb|${"{".repeat(100)}|`, PARSE_CAPS.levels)).toBe(false);
    expect(nestsPast(`%${"{".repeat(100)}\nx`, PARSE_CAPS.levels)).toBe(false);
    expect(parseBody(bodyOfText(deep))).toMatchObject({
      refused: true,
      message: PARSE_REFUSALS.deep,
    });
    const envs = `${"\\begin{cvbox}{t}".repeat(PARSE_CAPS.levels + 1)}${"\\end{cvbox}".repeat(PARSE_CAPS.levels + 1)}`;
    expect(parseBody(bodyOfText(envs), SIGNATURES)).toMatchObject({
      refused: true,
      message: PARSE_REFUSALS.deep,
    });
  });

  test("refuses a tree deeper than its levels, though the body nests less", () => {
    const depth = PARSE_CAPS.levels / 2 + 1;
    const lists = `${"\\begin{itemize}\\item ".repeat(depth)}x${"\\end{itemize}".repeat(depth)}`;
    expect(nestsPast(lists, PARSE_CAPS.levels)).toBe(false);
    expect(parseBody(bodyOfText(lists))).toMatchObject({
      refused: true,
      message: PARSE_REFUSALS.deep,
    });
  });

  /** unified-latex's nodes for a body, as `readBody` gives them. */
  const readNodes = (text: string): Ast.Node[] => {
    const read = readBody(bodyOfText(text));
    if (isRefusal(read)) throw new Error(read.message);
    return read.root.content;
  };

  /**
   * The nodes unified-latex gives `unit` repeated `count` times, in a group when `grouped`: for
   * each time, a copy of its nodes for the unit alone, moved to where that time starts. They are
   * the nodes it gives the unit three times, but for their lines and columns, which nothing reads.
   * Its parse keeps about 2 KB of heap for each byte of the body while it runs, since its grammar
   * keeps what each of its rules read at each place: 150,000 paragraphs parsed whole took more
   * than 3 GB.
   */
  const repeated = (unit: string, count: number, grouped = false): Ast.Node[] => {
    const one = readNodes(unit);
    const made = (times: number): Ast.Node[] => {
      const nodes: Ast.Node[] = [];
      for (let i = 0; i < times; i++) {
        const by = (grouped ? 1 : 0) + i * unit.length;
        for (const node of one)
          nodes.push(
            JSON.parse(JSON.stringify(node), (key, value) =>
              key === "offset" ? value + by : value,
            ),
          );
      }
      if (!grouped) return nodes;
      const end = times * unit.length + 2;
      const position = {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: end, line: 1, column: end + 1 },
      };
      return [{ type: "group", content: nodes, position }];
    };
    const offsets = (nodes: Ast.Node[]) =>
      JSON.stringify(nodes, (key, value) =>
        key === "line" || key === "column" ? undefined : value,
      );
    const three = unit.repeat(3);
    expect(offsets(made(3))).toBe(offsets(readNodes(grouped ? `{${three}}` : three)));
    return made(count);
  };

  /** The tree built from unified-latex's nodes for a body, which must print back to the body. */
  const treeOfNodes = (text: string, content: Ast.Node[]): Tree => {
    const tree = buildTree({ body: bodyOfText(text), root: { type: "root", content } });
    if (isRefusal(tree)) throw new Error(tree.message);
    expect(print(tree)).toBe(text);
    return tree;
  };

  test("reads a group of a great many pieces, and a great many paragraphs", () => {
    // 150,000 of each, more than a spread passes as arguments, about 125,000: each tree is built
    // from the nodes unified-latex gives the body (`repeated`), which parsed whole took gigabytes.
    const group = `{${"quill ".repeat(150_000)}}`;
    expect(treeOfNodes(group, repeated("quill ", 150_000, true)).content).toMatchObject([
      { kind: "text" },
    ]);
    const paragraphs = "Invented.\n\n".repeat(150_000);
    expect(treeOfNodes(paragraphs, repeated("Invented.\n\n", 150_000)).content).toHaveLength(
      150_000,
    );
  }, 60_000);

  test("refuses a tree of more nodes than its cap", () => {
    // Tried at a cap of a hundred nodes, given in the place of PARSE_CAPS.nodes: a body of 200,000
    // takes gigabytes of heap to parse. Each call is two nodes, itself and its argument's text.
    expect(PARSE_CAPS.nodes).toBe(200_000);
    const calls = (count: number) =>
      parseBody(bodyOfText("\\cvopt{a}\n".repeat(count)), SIGNATURES, 100);
    expect(calls(50)).toMatchObject({ kind: "body", nodes: 100 });
    expect(calls(51)).toMatchObject({ refused: true, message: PARSE_REFUSALS.many });
  });

  // The bounds on how the parse grows are ratios alone, the fastest of five runs of each size, in
  // CPU time (`src/test/timing.ts`): a tenth costs a tenth, 9 to 14 times at rest, and up to 16
  // times while the whole suite runs beside it; the openers below cost 88 to 141 times before
  // their look ahead was bounded. A bound of 50 times holds under that load and fails the square,
  // as the snippet parse's does; no ceiling in milliseconds, which a loaded machine could pass.
  // Every body parsed here is 128 KB or less: unified-latex's parse keeps about 2 KB of heap for
  // each byte of the body while it runs, and bodies of a megabyte and more ran a CI runner's
  // worker out of heap.

  test("parses in time that grows linearly with the body, nested groups and short calls", () => {
    // Groups nested 50 deep, around invented words, and short calls to an invented macro, each
    // body 100 KB, against a tenth of it.
    const groups = (bytes: number) =>
      `${"{".repeat(50)}Quill wort ${"}".repeat(50)}\n`.repeat(Math.floor(bytes / 112));
    const calls = (bytes: number) =>
      "\\cventry{Invented}{Labs}{City}{Jan 2020 -- Present}\n".repeat(Math.floor(bytes / 52));
    for (const make of [groups, calls]) {
      const small = make(10_000);
      const large = make(100_000);
      const parse = (text: string) => () => {
        const tree = parseBody(bodyOfText(text), SIGNATURES);
        if (isRefusal(tree)) throw new Error(tree.message);
      };
      const [short = 0, long = 0] = fastest([parse(small), parse(large)], 5);
      expect(long).toBeLessThan(bound(50, short));
    }
  }, 180_000);

  test("looks for a closer a bounded way, so that openers that never close cost linear time", () => {
    // `\\[` and `\item[` whose `]` never comes, the whole parse; `\url{` whose `}` never comes on
    // a long line, and many `\verb` on one, the reading before unified-latex parses: each against
    // a tenth of it, those parsed at half the size the review timed. Each cost the square of its
    // size before its look ahead was bounded: 192 KB of `\\[` 25 s, 256 KB of `\item[x ` 15 s,
    // 400 KB of `\url{` 24 s. Unbounded again, 96 KB of `\\[` costs 87 times a tenth of it and
    // 128 KB of `\item[x ` 76 times; 100 KB of `\iftrue`, its conditionals matched one at a time,
    // 118 times.
    const openers = (unit: string) => (bytes: number) =>
      unit.repeat(Math.floor(bytes / unit.length));
    const parse = (text: string) => () => {
      const tree = parseBody(bodyOfText(text));
      if (isRefusal(tree)) throw new Error(tree.message);
    };
    const mask = (text: string) => () => nestsPast(maskedForParse(text), PARSE_CAPS.levels);
    const shapes: [(bytes: number) => string, number, (text: string) => () => void][] = [
      [openers("\\\\["), 96_000, parse],
      [openers("\\item[x "), 128_000, parse],
      [openers("\\iftrue x "), 100_000, parse],
      [openers("\\url{"), 400_000, mask],
      [openers("\\verb!x! "), 1_400_000, mask],
    ];
    for (const [make, bytes, work] of shapes) {
      const [short = 0, long = 0] = fastest([work(make(bytes / 10)), work(make(bytes))], 5);
      expect(long, make(9)).toBeLessThan(bound(50, short));
    }
  }, 180_000);

  test("reads an opener that closes within its bound, and not one past it", () => {
    const near = String.raw`\\[${"x".repeat(MAX_DELIMITED - 16)}] after`;
    expect(treeOf(near).content).toMatchObject([
      { kind: "raw", name: "\\", args: [{ present: false }, { present: true }] },
      { kind: "text", runs: [{ text: "after" }] },
    ]);
    const far = String.raw`\cvopt[${"x ".repeat(MAX_DELIMITED)}]{y}`;
    expect(treeOf(far).content[0]).toMatchObject({
      kind: "call",
      args: [{ present: false }, { open: "" }],
    });
    // An address that does not close within its bound marks no `%` in it.
    expect(maskedForParse(`\\url{a%b${"c".repeat(MAX_DELIMITED)}}`)).not.toContain("\ue000");
    expect(maskedForParse("\\url{a%b}")).toContain("\ue000");
  });
});

describe("the text unified-latex reads", () => {
  test("hides a % in an address from the comment reader, and reads \\r\\n as one line end", () => {
    const masked = maskedForParse("\\href{a%20b}{t} %real\r\n\\url{c%d} \\verb|%| \\url{e%f}");
    expect(masked).toBe("\\href{a\ue00020b}{t} %real \n\\url{c\ue000d} \\verb|%| \\url{e\ue000f}");
    expect(masked.length).toBe("\\href{a%20b}{t} %real\r\n\\url{c%d} \\verb|%| \\url{e%f}".length);
  });
});

describe("the printer", () => {
  test("gives back the body's bytes, and what a caller puts at a node or an argument", () => {
    const text = String.raw`\section{Invented}
\cventry{Role}{Labs}{City}{2019 -- 2020} % trailing
\begin{itemize}\item One\end{itemize}`;
    const tree = treeOf(text);
    const call = tree.content[1] as CallNode;
    const wrapped = print(tree, (part) =>
      part === call.args[0]
        ? `{\\rtfield{x}{${sourceOf(tree, { start: part.start + 1, end: part.end - 1 })}}}`
        : undefined,
    );
    expect(wrapped).toBe(text.replace("{Role}", "{\\rtfield{x}{Role}}"));
    const dropped = print(tree, (part) => (part.kind === "list" ? "" : undefined));
    expect(dropped).toBe(text.replace(/\\begin\{itemize\}.*\\end\{itemize\}/, ""));
  });

  test("gives back every fixture's bytes, whatever it holds", () => {
    for (const text of [
      "",
      "   \n\n  ",
      "% only a comment",
      String.raw`\cvunknown{a}[b] \cvopt[x] \begin{cvbox}{y}\end{cvbox} {}{{}} \\ \\[1pt]`,
      "stray } brace and { another",
      String.raw`\begin{itemize} \item \end{itemize} \item \begin{cvitems}\end{cvitems}`,
      String.raw`\lstinline|x| \verb*|y| \begin{verbatim}z%\end{verbatim}`,
      "\u0000 \u007f \ue000 \ud83d\ude00 caf\u00e9",
    ]) {
      const tree = parseBody(bodyOfText(text), SIGNATURES);
      if (isRefusal(tree)) throw new Error(tree.message);
      expect(print(tree), JSON.stringify(text)).toBe(text);
    }
  });

  test("regenerates every text and date as the generator writes what the model holds of it", () => {
    const text = String.raw`\section{Invented \& Co}
\cventry{Role}{\textbf{Labs} \href{https://quill.example}{site}}{City}{Jan 2020 -- Present}
\cvopt{Sept 2019} \cvopt{2019 -- 2021} \cvopt{{\it Quill} wort}`;
    expect(regenerate(treeOf(text), "pdftex")).toBe(
      String.raw`\section{Invented \& Co}
\cventry{Role}{\textbf{Labs} \href{https://quill.example}{site}}{City}{Jan 2020 – Present}
\cvopt{Sept 2019} \cvopt{2019 – 2021} \cvopt{\textit{Quill} wort}`.replaceAll("\\u2013", "–"),
    );
  });

  test("puts regenerated text where TeX reads it as it read the body", () => {
    // A text that ended in a control word had the spaces after it skipped; one right after a
    // control word would join its name, or have its space skipped.
    const tree = treeOf(String.raw`Stra\ss \hfill{x}y and \hfill{ z}`);
    expect(regenerate(tree, "pdftex")).toBe(String.raw`Straß\relax \hfill{}xy and \hfill{} z`);
  });

  test("keeps a letter composed for XeTeX and decomposes it for pdfTeX, as the generator does", () => {
    const tree = treeOf("Nguyễn");
    expect(regenerate(tree, "xetex")).toBe("Nguyễn");
    expect(regenerate(tree, "pdftex")).toBe("Nguyễn");
  });

  test("finds the format a date is spelled in, of the generator's four", () => {
    expect(spellingOf({ start: "2020-01", end: "present" }, "Jan 2020 – Present")).toBe("MMM yyyy");
    expect(spellingOf({ start: "2020-01" }, "January 2020")).toBe("MMMM yyyy");
    expect(spellingOf({ start: "2020-01" }, "01/2020")).toBe("MM/yyyy");
    expect(spellingOf({ start: "2019", end: "2021" }, "2019 – 2021")).toBeDefined();
    expect(spellingOf({ start: "2019-09" }, "Sept 2019")).toBeUndefined();
    expect(spellingOf({ start: "2019", end: "2020" }, "2019-20")).toBeUndefined();
  });

  test("builds one tree from a body read once", () => {
    const read = readBody(bodyOfText(String.raw`\cvopt{a}`));
    if (isRefusal(read)) throw new Error(read.message);
    const tree = buildTree(read, SIGNATURES);
    if (isRefusal(tree)) throw new Error(tree.message);
    expect(tree).toMatchObject({ nodes: 2, levels: 1 });
  });
});

describe.skipIf(!engineAvailable())("the round trips, on the engine", () => {
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

  /**
   * An invented upload's tree, the engine's signatures read when `withSignatures`, and whether its
   * body printed byte for byte, and regenerated, sets the reference's glyphs, as the corpus runner
   * asks.
   */
  async function roundTrips(files: Record<string, string>, withSignatures: boolean) {
    const zipped = Object.fromEntries(
      Object.entries(files).map(([path, text]) => [path, strToU8(text)]),
    );
    const taken = intake({ name: "invented.zip", bytes: zipSync(zipped) }, { tree });
    if (isRefusal(taken)) throw new Error(`refused at intake: ${taken.message}`);
    const made = await reference(session, fonts, taken);
    if (isRefusal(made)) throw new Error(`refused: ${made.message}`);
    const split = bodyOf(taken);
    if (isRefusal(split)) throw new Error(split.message);
    const read = readBody(split);
    if (isRefusal(read)) throw new Error(read.message);
    const found = withSignatures
      ? await signatures(session, taken, made, split, usesOf(read))
      : undefined;
    if (found !== undefined && isRefusal(found)) throw new Error("no signatures");
    const built = buildTree(read, found);
    if (isRefusal(built)) throw new Error(built.message);
    const same = async (printed: string) => {
      const main = encodeLike(taken.main.bytes, split.before + printed + split.after);
      const again = await compileLikeReference(
        session,
        fonts,
        taken,
        made,
        main ?? new Uint8Array(),
      );
      if (isRefusal(again)) throw new Error(`the round trip stopped: ${again.message}`);
      return sameGlyphs(made as Reference, again.stream);
    };
    return {
      built,
      byte: await same(print(built)),
      regenerated: await same(regenerate(built, made.engine)),
    };
  }

  const main = (body: string, preamble = "") =>
    `\\documentclass{article}\n${preamble}\\begin{document}\n${body}\n\\end{document}\n`;

  test("inlines every shape of input as TeX reads it, spaces, paragraphs and \\endinput", async () => {
    // A paragraph for each: an input last on its line, nested, and ended by `\endinput`; a bare
    // name; an empty file, alone on its line and in one; a file with no final newline; and a
    // guarded file, read whole.
    const paragraph = (input: string) => `Invented words\n${input}\nclosing words.`;
    const { byte } = await roundTrips(
      {
        "cv.tex": main(
          [
            paragraph("\\input{outer}"),
            paragraph("\\input bare"),
            paragraph("\\input{empty}"),
            "Invented words \\input{empty} middle words.",
            paragraph("\\input{plain}"),
            "\\section{Alpha}\n\\input{guarded}\n\\section{Golf}",
          ].join("\n\n"),
        ),
        "outer.tex": "outer inputted words\n\\input{inner}\n",
        "inner.tex": "inner inputted words\n\\endinput\nnever read\n",
        "bare.tex": "bare inputted words\n",
        "empty.tex": "",
        "plain.tex": "no final newline",
        "guarded.tex": "\\ifdefined\\partdone\\endinput\\fi\n\\def\\partdone{}\nCharlie three.\n",
      },
      false,
    );
    expect(byte).toBe(true);
  }, 60_000);

  test("regenerates a declaration's body, and keeps what \\iffalse skips and an alignment raw", async () => {
    const { built, byte, regenerated } = await roundTrips(
      {
        "cv.tex": main(
          String.raw`\begin{small}
\section{Experience}
\job{Invented Role}{2020 -- 2021}
Did invented things with \textbf{care}.
\begin{itemize}
\item One invented thing
\end{itemize}
\end{small}
\begin{bfseries}Invented bold words\end{bfseries}
\iffalse
\job{Old Invented Role}{Old Invented Company}
An old invented paragraph that TeX skips.
\fi
\iftrue Kept invented words.\else Skipped invented words.\fi
\begin{skilltable}
Languages & Invented, Made-up \\
Tools & Pretend, Fictional \\
\end{skilltable}
\job{BSc Invented Studies}{2019-20}`,
          String.raw`\newcommand{\job}[2]{\textbf{#1} \hfill #2\par}
\newenvironment{skilltable}{\begin{tabular}{ll}}{\end{tabular}}
`,
        ),
      },
      true,
    );
    expect(built.content).toMatchObject([
      { kind: "block", name: "small" },
      { kind: "block", name: "bfseries", content: [{ kind: "text", runs: [{ bold: true }] }] },
      { kind: "raw", why: "skipped" },
      { kind: "raw", name: "iftrue" },
      { kind: "text" },
      { kind: "raw", why: "skipped" },
      { kind: "environment", content: [{ kind: "raw", why: "alignment" }] },
      { kind: "call", args: [{}, { content: [{ kind: "date" }] }] },
    ]);
    expect(byte).toBe(true);
    expect(regenerated).toBe(true);
  }, 60_000);

  test("places the calls in a class's environments that wrap a table, and keeps raw one whose body holds an & of its own", async () => {
    // An invented class: `skilltable` wraps a `tabular` and `\skill` sets a row of it, as a
    // hand-rolled class does; `cvskills` and `cvhonors` wrap a `tabular*` in a `center`, and
    // `\cvskill` and `\cvhonor` set their rows, as Awesome-CV's do.
    const cls = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{inventedtables}
\LoadClass{article}
\newenvironment{skilltable}{\begin{tabular}{ll}}{\end{tabular}}
\newcommand{\skill}[2]{\textbf{#1} & #2 \\}
\newenvironment{cvskills}{\begin{center}\setlength\tabcolsep{1ex}%
  \begin{tabular*}{\textwidth}{@{\extracolsep{\fill}} r p{0.7\textwidth}}}%
  {\end{tabular*}\end{center}}
\newcommand*{\cvskill}[2]{\textbf{#1} & #2 \\}
\newenvironment{cvhonors}{\begin{center}%
  \begin{tabular*}{\textwidth}{@{} l @{\extracolsep{\fill}} r}}%
  {\end{tabular*}\end{center}}
\newcommand*{\cvhonor}[2]{#1 & #2 \\}
`;
    const { built, byte, regenerated } = await roundTrips(
      {
        "inventedtables.cls": cls,
        "cv.tex": String.raw`\documentclass{inventedtables}
\begin{document}
\begin{skilltable}
\skill{Languages}{Quill, Wort}
\skill{Tools}{Invented, Made-up}
\end{skilltable}

\begin{skilltable}
Languages & Quill, Wort \\
Tools & Invented, Made-up \\
\end{skilltable}

\begin{cvskills}
  \cvskill{Languages}{Quill, Wort}
  \cvskill{Tools}{Invented, Made-up}
\end{cvskills}

\begin{cvhonors}
  \cvhonor{Invented Prize}{2019}
  \cvhonor{Made-up Award}{2020 -- 2021}
\end{cvhonors}
\end{document}
`,
      },
      true,
    );
    const calls = (name: string, count: number) =>
      Array.from({ length: count }, () => ({ kind: "call", name }));
    expect(built.content).toMatchObject([
      { kind: "environment", name: "skilltable", content: calls("skill", 2) },
      { kind: "environment", name: "skilltable", content: [{ kind: "raw", why: "alignment" }] },
      { kind: "environment", name: "cvskills", content: calls("cvskill", 2) },
      { kind: "environment", name: "cvhonors", content: calls("cvhonor", 2) },
    ]);
    // Each call's arguments are text, and an award's second a date.
    const [skills, , cvskills, honors] = built.content;
    const argument = (node: Node | undefined, call: number, index: number) =>
      node?.kind === "environment" && node.content[call]?.kind === "call"
        ? (node.content[call] as CallNode).args[index]?.content
        : undefined;
    expect(argument(skills, 0, 1)).toMatchObject([
      { kind: "text", runs: [{ text: "Quill, Wort" }] },
    ]);
    expect(argument(cvskills, 1, 0)).toMatchObject([{ kind: "text", runs: [{ text: "Tools" }] }]);
    expect(argument(honors, 0, 1)).toMatchObject([{ kind: "date", text: "2019" }]);
    expect(argument(honors, 1, 1)).toMatchObject([{ kind: "date", text: "2020 – 2021" }]);
    expect(byte).toBe(true);
    expect(regenerated).toBe(true);
  }, 60_000);

  /** Every node of a tree, arguments' and contents' too. */
  const nodesOf = (nodes: readonly Node[]): Node[] =>
    nodes.flatMap((node) => [
      node,
      ...("args" in node ? (node.args ?? []).flatMap((arg) => nodesOf(arg.content ?? [])) : []),
      ...("content" in node ? nodesOf(node.content) : []),
    ]);

  /** Letters the generator writes back as they are, whose accents are decoded. */
  const LETTERS = String.raw`Caf\'e na\"\i ve Fran\c cois \v{S}koda \H{o} \r{u} \u{g} \.z \=a.`;

  /**
   * One invented document, a paragraph for each shape the parser keeps raw, which decoded as the
   * generator's text set other glyphs or stopped the compile (decision 0020), and one of letters it
   * decodes: each shape is raw by its command's name, the letters are text, and the body with every
   * text regenerated sets the reference's glyphs.
   */
  async function expectKept(
    shapes: readonly [body: string, name: string][],
    preamble: string,
    letters: string,
  ) {
    const { built, regenerated } = await roundTrips(
      { "cv.tex": main([...shapes.map(([body]) => body), letters].join("\n\n"), preamble) },
      false,
    );
    const nodes = nodesOf(built.content);
    for (const [body, name] of shapes)
      expect(
        nodes.some((node) => node.kind === "raw" && node.name === name),
        body,
      ).toBe(true);
    expect(nodes.filter((node) => node.kind === "text").at(-1)).toMatchObject({
      runs: [{ text: expect.stringMatching(/^Caf\u00e9 na\u00efve Fran\u00e7ois/) }],
    });
    expect(regenerated).toBe(true);
  }

  test("keeps raw on OT1 what the generator cannot write back, and decodes the rest", async () => {
    await expectKept(
      [
        [String.raw`Worked with Dr.\ Quill Invented on it.`, " "],
        [String.raw`Served 10\,000 invented users.`, ","],
        [String.raw`Invented NASA\@. Then more words.`, "@"],
        [String.raw`An acute \'{} here.`, "'"],
        [String.raw`Invented Nguy\d{a} here.`, "d"],
        [String.raw`Invented \b{a} here.`, "b"],
        [String.raw`Invented \t{oo} here.`, "t"],
        [String.raw`Invented Nguy\~{\^e}n here.`, "~"],
        [String.raw`Run \texttt{tool --verbose} daily.`, "texttt"],
        [String.raw`Run {\ttfamily tool --verbose} daily.`, "ttfamily"],
      ],
      "",
      String.raw`${LETTERS} \d{s} Zh\v{a}ng.`,
    );
  }, 60_000);

  test("keeps an accent over nothing raw on T1, where the character sets another glyph", async () => {
    await expectKept(
      [
        [String.raw`Page: www.quill.example/\~{}moss here.`, "~"],
        [String.raw`A caret \^{} here.`, "^"],
      ],
      "\\usepackage[T1]{fontenc}\n",
      String.raw`${LETTERS} \k{a}.`,
    );
  }, 60_000);
});
