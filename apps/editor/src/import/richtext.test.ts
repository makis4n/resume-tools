import type { RichText } from "@resume-tools/resume-model";
import { describe, expect, test } from "vitest";
import { bodyOfText, type Node, parseBody, type Tree } from "./parse";
import { print } from "./print";
import { addressOf, changed, composed, ligatures, PLAIN, reproduces, runsOf } from "./richtext";

// Every body here is invented for these tests.

/** A body's tree, which must print back to the body. */
function treeOf(text: string): Tree {
  const tree = parseBody(bodyOfText(text));
  if ("refused" in tree) throw new Error(tree.message);
  expect(print(tree)).toBe(text);
  return tree;
}

/** The runs of a body that is one paragraph of text. */
function runsOfBody(text: string): RichText {
  const content = treeOf(text).content;
  expect(content.map((node) => node.kind)).toEqual(["text"]);
  return (content[0] as Extract<Node, { kind: "text" }>).runs;
}

/** The text of a body that is one paragraph, its marks dropped. */
const plain = (text: string) =>
  runsOfBody(text)
    .map((run) => run.text)
    .join("");

/** The kinds of a body's top-level nodes, a raw one with its name. */
const kindsOf = (text: string) =>
  treeOf(text).content.map((node) => (node.kind === "raw" ? `raw ${node.name}` : node.kind));

describe("the escapes and symbols", () => {
  test("decodes every escape", () => {
    expect(plain(String.raw`Quill \& Wort \% \$ \# \_ \{ \}`)).toBe("Quill & Wort % $ # _ { }");
    expect(plain(String.raw`a\textbackslash{}b`)).toBe("a\\b");
    expect(plain(String.raw`a\textbackslash b`)).toBe("a\\b");
  });

  test("decodes the tie and the bullet", () => {
    expect(plain("Dr.~Quill")).toBe("Dr.\u00a0Quill");
    expect(plain(String.raw`a \textbullet{} b`)).toBe("a \u2022 b");
  });

  test("decodes what the generator writes for the characters TeX reads as something else", () => {
    expect(
      plain(
        String.raw`\textasciitilde{}\textasciicircum{}\textless{}\textgreater{}\textbar{}{[}{]}{*}`,
      ),
    ).toBe("~^<>|[]*");
  });

  test("decodes the letters and a word's hyphenation point", () => {
    expect(plain(String.raw`Stra\ss e \ae\AE\oe\OE\aa\AA\o\O\l\L`)).toBe(
      "Stra\u00dfe \u00e6\u00c6\u0153\u0152\u00e5\u00c5\u00f8\u00d8\u0142\u0141",
    );
    expect(plain(String.raw`in\-vented`)).toBe("invented");
  });
});

describe("what the generator cannot write back", () => {
  test("keeps a control space, a thin space and \\@ raw, as the smallest node", () => {
    expect(kindsOf(String.raw`Dr.\ Quill`)).toEqual(["text", "raw  ", "text"]);
    expect(kindsOf(String.raw`10\,000 invented`)).toEqual(["text", "raw ,", "text"]);
    expect(kindsOf(String.raw`NASA\@. Then`)).toEqual(["text", "raw @", "text"]);
  });

  test("keeps an accent over nothing raw, with its argument", () => {
    const accents: [source: string, name: string][] = [
      [String.raw`a \~{} b`, "~"],
      [String.raw`a \^{} b`, "^"],
      [String.raw`a \'{} b`, "'"],
      [String.raw`a \"{} b`, '"'],
    ];
    for (const [source, name] of accents) {
      const content = treeOf(source).content;
      expect(
        content.map((node) => node.kind),
        source,
      ).toEqual(["text", "raw", "text"]);
      expect(content[1], source).toMatchObject({ name, args: [{ open: "{", present: true }] });
    }
  });

  test("keeps an accent raw where the generator decomposes its letter, and decodes the rest", () => {
    const accents: [source: string, name: string][] = [
      [String.raw`Nguy\d{a}`, "d"],
      [String.raw`in \b{a} it`, "b"],
      [String.raw`a \t{oo} b`, "t"],
      [String.raw`Nguy\~{\^e}n`, "~"],
    ];
    for (const [source, name] of accents) expect(kindsOf(source), source).toContain(`raw ${name}`);
    // LaTeX defines these past Latin Extended-A, and the generator writes them as they are.
    expect(plain(String.raw`\d{s} Zh\v{a}ng`)).toBe("\u1e63 Zh\u01ceng");
  });

  test("says which composed letters the generator writes back as they are", () => {
    expect(reproduces("\u00e9")).toBe(true);
    expect(reproduces("\u0151")).toBe(true);
    expect(reproduces("\u1e63")).toBe(true);
    expect(reproduces("\u1ea1")).toBe(false);
    expect(reproduces("\u1ec5")).toBe(false);
    expect(reproduces("o\u0361o")).toBe(false);
    expect(reproduces("a\u0331")).toBe(false);
  });

  test("keeps \\texttt and what \\ttfamily or \\tt sets raw, to the end of the group", () => {
    expect(treeOf(String.raw`Run \texttt{tool --verbose} daily.`).content).toMatchObject([
      { kind: "text" },
      { kind: "raw", name: "texttt", args: [{ present: true }] },
      { kind: "text" },
    ]);
    const texttt = treeOf(String.raw`\texttt{tool --verbose}`).content[0];
    expect(texttt).toMatchObject({ args: [{}] });
    expect((texttt as { args: { content?: unknown }[] }).args[0]?.content).toBeUndefined();
    expect(treeOf(String.raw`Run {plain \ttfamily tool --verbose} daily.`).content).toMatchObject([
      { kind: "text" },
      {
        kind: "group",
        content: [
          { kind: "text", runs: [{ text: "plain" }] },
          { kind: "raw", why: "typewriter", name: "ttfamily" },
        ],
      },
      { kind: "text" },
    ]);
    const group = treeOf(String.raw`{\tt a -- b} c`).content[0] as Extract<Node, { kind: "group" }>;
    expect(group.content).toMatchObject([{ kind: "raw", why: "typewriter", name: "tt" }]);
    expect(treeOf(String.raw`\begin{ttfamily}a -- b\end{ttfamily}`).content).toMatchObject([
      { kind: "raw", why: "environment", name: "ttfamily" },
    ]);
  });

  test("keeps a list's items after \\ttfamily raw, since they share its font", () => {
    const tree = treeOf(String.raw`\begin{itemize}
\item One \ttfamily two
\item Three
\end{itemize}`);
    expect(tree.content).toMatchObject([
      {
        kind: "list",
        content: [
          { kind: "item", content: [{ kind: "text" }, { kind: "raw", why: "typewriter" }] },
          { kind: "item", content: [{ kind: "raw", why: "typewriter" }] },
        ],
      },
    ]);
  });
});

describe("the ligatures", () => {
  test("makes the dashes and the curly quotes", () => {
    expect(plain("2019--2020 and---then")).toBe("2019\u20132020 and\u2014then");
    expect(plain("``quoted'' and `single' don't")).toBe(
      "\u201cquoted\u201d and \u2018single\u2019 don\u2019t",
    );
  });

  test("keeps two hyphens a group parts apart", () => {
    expect(plain("a-{}-b")).toBe("a--b");
  });

  test("makes them as a function too", () => {
    expect(ligatures("a---b--c``d''e`f'g~h")).toBe(
      "a\u2014b\u2013c\u201cd\u201de\u2018f\u2019g\u00a0h",
    );
  });
});

describe("the accents", () => {
  test("composes every accent command with its letter", () => {
    const accents: [string, string][] = [
      [String.raw`\'e`, "\u00e9"],
      [String.raw`\`e`, "\u00e8"],
      [String.raw`\^e`, "\u00ea"],
      [String.raw`\"o`, "\u00f6"],
      [String.raw`\~n`, "\u00f1"],
      [String.raw`\=a`, "\u0101"],
      [String.raw`\.z`, "\u017c"],
      [String.raw`\u{g}`, "\u011f"],
      [String.raw`\v{s}`, "\u0161"],
      [String.raw`\H{o}`, "\u0151"],
      [String.raw`\c{c}`, "\u00e7"],
      [String.raw`\k{a}`, "\u0105"],
      [String.raw`\d{s}`, "\u1e63"],
      [String.raw`\r{a}`, "\u00e5"],
    ];
    for (const [source, text] of accents) expect(plain(source), source).toBe(text);
  });

  test("takes the letter after a space, in braces, or as a word's first", () => {
    expect(plain(String.raw`Fran\c cois`)).toBe("Fran\u00e7ois");
    expect(plain(String.raw`\'{e}tude`)).toBe("\u00e9tude");
    expect(plain(String.raw`\'etude`)).toBe("\u00e9tude");
    expect(plain(String.raw`na\"\i ve`)).toBe("na\u00efve");
    expect(plain(String.raw`\'{\i}`)).toBe("\u00ed");
  });

  test("composes as a function too", () => {
    expect(composed("e", "\u0301", "\u00b4")).toBe("\u00e9");
    expect(composed("", "\u0301", "\u00b4")).toBe("\u00b4");
    expect(composed("\u0131", "\u0308", "\u00a8")).toBe("\u00ef");
  });
});

describe("the marks", () => {
  test("marks bold, italic and emphasis, and keeps small capitals as text", () => {
    expect(
      runsOfBody(String.raw`An \textbf{invented} \textit{quill} \emph{wort} \textsc{Moss}`),
    ).toEqual([
      { text: "An " },
      { text: "invented", bold: true },
      { text: " " },
      { text: "quill", italic: true },
      { text: " " },
      { text: "wort", italic: true },
      { text: " Moss" },
    ]);
  });

  test("turns italic over for emphasis inside italic", () => {
    expect(runsOfBody(String.raw`\textit{an \emph{upright} word}`)).toEqual([
      { text: "an ", italic: true },
      { text: "upright" },
      { text: " word", italic: true },
    ]);
  });

  test("marks the rest of a group after a declaration, and its two-letter form", () => {
    expect(runsOfBody(String.raw`a {\bf b} {\bfseries c} {\it d} {\itshape e} {\em f} g`)).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " " },
      { text: "c", bold: true },
      { text: " " },
      { text: "d", italic: true },
      { text: " " },
      { text: "e", italic: true },
      { text: " " },
      { text: "f", italic: true },
      { text: " g" },
    ]);
    expect(runsOfBody(String.raw`\textbf{a \itshape b}`)).toEqual([
      { text: "a ", bold: true },
      { text: "b", bold: true, italic: true },
    ]);
  });

  test("has \\bf and \\it clear the other mark first, as \\normalfont and one of them", () => {
    expect(runsOfBody(String.raw`{\it a \bf b} {\bf c \it d} {\bfseries\itshape e}`)).toEqual([
      { text: "a ", italic: true },
      { text: "b", bold: true },
      { text: " " },
      { text: "c ", bold: true },
      { text: "d", italic: true },
      { text: " " },
      { text: "e", bold: true, italic: true },
    ]);
  });

  test("keeps the other font declarations raw, and clears the marks they clear", () => {
    const content = treeOf(String.raw`{\it a \sc b} {\bf c \rm d} {\bf\it e \upshape f}`).content;
    expect(content).toMatchObject([
      {
        kind: "group",
        content: [
          { kind: "text", runs: [{ text: "a", italic: true }] },
          { kind: "raw", name: "sc" },
          { kind: "text", runs: [{ text: "b" }] },
        ],
      },
      {
        kind: "group",
        content: [
          { kind: "text", runs: [{ text: "c", bold: true }] },
          { kind: "raw", name: "rm" },
          { kind: "text", runs: [{ text: "d" }] },
        ],
      },
      {
        kind: "group",
        content: [
          { kind: "text", runs: [{ text: "e", italic: true }] },
          { kind: "raw", name: "upshape" },
          { kind: "text", runs: [{ text: "f" }] },
        ],
      },
    ]);
    expect(
      changed({ bold: true, italic: true, href: "x" }, { clear: "all", mark: "bold" }),
    ).toEqual({ bold: true, italic: false, href: "x" });
    expect(changed(PLAIN, { clear: "italic" })).toEqual(PLAIN);
  });

  test("reads an \\item's label in a state of its own, so that its declaration marks it alone", () => {
    const tree = treeOf(String.raw`\begin{description}
\item[\bf Languages:] Python, Go
\item[\it Tools:] Git
\end{description}`);
    expect(tree.content).toMatchObject([
      {
        kind: "list",
        content: [
          {
            kind: "item",
            args: [{ content: [{ kind: "text", runs: [{ text: "Languages:", bold: true }] }] }],
            content: [{ kind: "text", runs: [{ text: "Python, Go" }] }],
          },
          {
            kind: "item",
            args: [{ content: [{ kind: "text", runs: [{ text: "Tools:", italic: true }] }] }],
            content: [{ kind: "text", runs: [{ text: "Git" }] }],
          },
        ],
      },
    ]);
    expect(treeOf(String.raw`\item[\bf One] two`).content).toMatchObject([
      { kind: "item", content: [{ kind: "text", runs: [{ text: "two" }] }] },
    ]);
  });

  test("keeps a declaration outside a group raw, since it runs on past the text", () => {
    const content = treeOf(String.raw`\bfseries Quill`).content;
    expect(content.map((node) => node.kind)).toEqual(["raw", "text"]);
  });
});

describe("the links", () => {
  test("makes a link of \\href's text, with its address as hyperref reads it", () => {
    expect(
      runsOfBody(String.raw`See \href{https://quill.example/a\_b\#c}{the \textbf{quill}}.`),
    ).toEqual([
      { text: "See " },
      { text: "the ", href: "https://quill.example/a_b#c" },
      { text: "quill", bold: true, href: "https://quill.example/a_b#c" },
      { text: "." },
    ]);
  });

  test("reads a % in an address as a character, as hyperref does", () => {
    expect(
      runsOfBody(
        String.raw`\href{https://quill.example/a%20b}{wort} and \url{https://q.example/%7E} end`,
      ),
    ).toEqual([
      { text: "wort", href: "https://quill.example/a%20b" },
      { text: " and " },
      { text: "https://q.example/%7E", href: "https://q.example/%7E" },
      { text: " end" },
    ]);
  });

  test("makes \\url its address linked, and \\nolinkurl its address alone", () => {
    expect(runsOfBody(String.raw`\url{https://quill.example} \nolinkurl{quill.example}`)).toEqual([
      { text: "https://quill.example", href: "https://quill.example" },
      { text: " quill.example" },
    ]);
  });

  test("keeps an \\href raw when its text is not text, with that text placed inside it", () => {
    const content = treeOf(
      String.raw`\href{mailto:q@quill.example}{\underline{q@quill.example}}`,
    ).content;
    expect(content).toMatchObject([
      {
        kind: "raw",
        name: "href",
        args: [
          { present: false },
          { present: true },
          {
            content: [{ kind: "raw", name: "underline", args: [{ content: [{ kind: "text" }] }] }],
          },
        ],
      },
    ]);
  });

  test("reads an address as hyperref turns it back", () => {
    expect(addressOf(" https://q.example/\\%20\\&x\\_y ")).toBe("https://q.example/%20&x_y");
  });
});

describe("whitespace, as TeX reads it", () => {
  test("makes a run of spaces and a line's end one space", () => {
    expect(plain("Quill   invented\n   wort\t moss")).toBe("Quill invented wort moss");
  });

  test("ends a paragraph at a blank line, and makes each its own text", () => {
    const content = treeOf("One invented line.\n\n  \nAnother invented one.").content;
    expect(content).toMatchObject([
      { kind: "text", runs: [{ text: "One invented line." }] },
      { kind: "text", runs: [{ text: "Another invented one." }] },
    ]);
  });

  test("takes a comment's line end with it, and the spaces that start the next line", () => {
    expect(plain("Quill%comment\n   wort")).toBe("Quillwort");
    expect(plain("Quill %comment\n   wort")).toBe("Quill wort");
    expect(plain("Quill\n%comment\nwort")).toBe("Quill wort");
  });

  test("sets no space for a comment on its own line after a line whose end a comment took", () => {
    expect(plain("Python,%\n% Java,\nC++")).toBe("Python,C++");
    expect(plain("Quill%\n   % note\n   wort")).toBe("Quillwort");
    expect(plain("Quill%\n%\n%\nwort")).toBe("Quillwort");
    expect(plain("Quill\n%\n%\nwort")).toBe("Quill wort");
  });

  test("skips the spaces after a control word, not after a control symbol", () => {
    expect(plain(String.raw`\ss  e`)).toBe("\u00dfe");
    expect(plain(String.raw`\ss{} e`)).toBe("\u00df e");
    expect(plain(String.raw`a\&  b`)).toBe("a& b");
  });

  test("takes a group that sets nothing for no text at a paragraph's edge", () => {
    expect(treeOf("Quill wort.\n{}\n\nMoss.").content).toMatchObject([
      { kind: "text", runs: [{ text: "Quill wort." }], end: "Quill wort.".length },
      { kind: "text", runs: [{ text: "Moss." }] },
    ]);
    expect(plain("Quill\n{}\nwort")).toBe("Quill wort");
  });

  test("makes \\\\ a space inside a paragraph, and keeps one at its edge raw", () => {
    expect(plain(String.raw`Quill \\ wort\\moss`)).toBe("Quill wort moss");
    const content = treeOf(String.raw`\\ Quill wort \\`).content;
    expect(content.map((node) => node.kind)).toEqual(["raw", "text", "raw"]);
    expect(treeOf(String.raw`Quill\\[4pt] wort`).content.map((node) => node.kind)).toEqual([
      "text",
      "raw",
      "text",
    ]);
  });

  test("reads a line's end in \\r\\n as TeX does, one line's end", () => {
    expect(plain("Quill\r\nwort\r\n")).toBe("Quill wort");
    expect(treeOf("Quill\r\n\r\nwort").content).toHaveLength(2);
  });
});

describe("runs", () => {
  test("joins pieces of the same marks, and makes one space of soft spaces", () => {
    expect(
      runsOf([
        { kind: "text", text: "a", marks: { bold: false, italic: false } },
        { kind: "space", hard: false, marks: { bold: false, italic: false } },
        { kind: "break", marks: { bold: false, italic: false } },
        { kind: "text", text: "b", marks: { bold: true, italic: false } },
      ]),
    ).toEqual([{ text: "a " }, { text: "b", bold: true }]);
  });
});
