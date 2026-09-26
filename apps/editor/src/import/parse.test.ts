import { describe, expect, test } from "vitest";
import { bound, fastest } from "../test/timing";
import type { Intake } from "./intake";
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
import { print } from "./print";
import { isRefusal } from "./refusal";

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

  test("honours \\endinput, reading the rest of its line, and inputs within inputs", () => {
    const body = bodyFrom("\\begin{document}\\input{outer}\\end{document}", {
      "outer.tex": "Outer \\input{inner}after\n",
      "inner.tex": "Inner \\endinput rest of line\nnever read\n",
    });
    expect(body.text).toBe("Outer Inner  rest of line\nafter\n");
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

  test("reads a group of a great many pieces, and a great many paragraphs", () => {
    const group = `{${"quill ".repeat(150_000)}}`;
    expect(treeOf(group, undefined).content).toMatchObject([{ kind: "text" }]);
    const paragraphs = "Invented.\n\n".repeat(150_000);
    expect(treeOf(paragraphs, undefined).content).toHaveLength(150_000);
  }, 60_000);

  test("refuses a tree of more nodes than its cap", () => {
    const many = "\\cvopt{a}\n".repeat(PARSE_CAPS.nodes / 2 + 1);
    expect(parseBody(bodyOfText(many), SIGNATURES)).toMatchObject({
      refused: true,
      message: PARSE_REFUSALS.many,
    });
  }, 60_000);

  test("parses in time that grows linearly with the body, nested groups and short calls", () => {
    // Groups nested 50 deep, around invented words, and short calls to an invented macro, each
    // body a megabyte, against a tenth of it.
    const groups = (bytes: number) =>
      `${"{".repeat(50)}Quill wort ${"}".repeat(50)}\n`.repeat(Math.floor(bytes / 112));
    const calls = (bytes: number) =>
      "\\cventry{Invented}{Labs}{City}{Jan 2020 -- Present}\n".repeat(Math.floor(bytes / 52));
    for (const make of [groups, calls]) {
      const small = make(100_000);
      const large = make(1_000_000);
      const parse = (text: string) => () => {
        const tree = parseBody(bodyOfText(text), SIGNATURES);
        if (isRefusal(tree)) throw new Error(tree.message);
      };
      const [short = 0, long = 0] = fastest([parse(small), parse(large)], 3);
      expect(long).toBeLessThan(bound(20, short));
      expect(long).toBeLessThan(15_000);
    }
  }, 120_000);
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

  test("builds one tree from a body read once", () => {
    const read = readBody(bodyOfText(String.raw`\cvopt{a}`));
    if (isRefusal(read)) throw new Error(read.message);
    const tree = buildTree(read, SIGNATURES);
    if (isRefusal(tree)) throw new Error(tree.message);
    expect(tree).toMatchObject({ nodes: 2, levels: 1 });
  });
});
