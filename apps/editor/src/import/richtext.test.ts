import type { RichText } from "@resume-tools/resume-model";
import { describe, expect, test } from "vitest";
import { bodyOfText, type Node, parseBody, type Tree } from "./parse";
import { print } from "./print";
import { addressOf, composed, ligatures, runsOf } from "./richtext";

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

describe("the escapes and symbols", () => {
  test("decodes every escape", () => {
    expect(plain(String.raw`Quill \& Wort \% \$ \# \_ \{ \}`)).toBe("Quill & Wort % $ # _ { }");
    expect(plain(String.raw`a\textbackslash{}b`)).toBe("a\\b");
    expect(plain(String.raw`a\textbackslash b`)).toBe("a\\b");
  });

  test("decodes the ties, the thin space and the bullet", () => {
    expect(plain("Dr.~Quill")).toBe("Dr. Quill");
    expect(plain(String.raw`10\,000`)).toBe("10 000");
    expect(plain(String.raw`a \textbullet{} b`)).toBe("a • b");
  });

  test("decodes what the generator writes for the characters TeX reads as something else", () => {
    expect(
      plain(
        String.raw`\textasciitilde{}\textasciicircum{}\textless{}\textgreater{}\textbar{}{[}{]}{*}`,
      ),
    ).toBe("~^<>|[]*");
  });

  test("decodes the letters and a word's hyphenation point", () => {
    expect(plain(String.raw`Stra\ss e \ae\AE\oe\OE\aa\AA\o\O\l\L`)).toBe("Straße æÆœŒåÅøØłŁ");
    expect(plain(String.raw`in\-vented`)).toBe("invented");
  });
});

describe("the ligatures", () => {
  test("makes the dashes and the curly quotes", () => {
    expect(plain("2019--2020 and---then")).toBe("2019–2020 and—then");
    expect(plain("``quoted'' and `single' don't")).toBe("“quoted” and ‘single’ don’t");
  });

  test("keeps two hyphens a group parts apart", () => {
    expect(plain("a-{}-b")).toBe("a--b");
  });

  test("makes them as a function too", () => {
    expect(ligatures("a---b--c``d''e`f'g~h")).toBe("a—b–c“d”e‘f’g h");
  });
});

describe("the accents", () => {
  test("composes every accent command with its letter", () => {
    const accents: [string, string][] = [
      [String.raw`\'e`, "é"],
      [String.raw`\`e`, "è"],
      [String.raw`\^e`, "ê"],
      [String.raw`\"o`, "ö"],
      [String.raw`\~n`, "ñ"],
      [String.raw`\=a`, "ā"],
      [String.raw`\.z`, "ż"],
      [String.raw`\u{g}`, "ğ"],
      [String.raw`\v{s}`, "š"],
      [String.raw`\H{o}`, "ő"],
      [String.raw`\c{c}`, "ç"],
      [String.raw`\k{a}`, "ą"],
      [String.raw`\d{s}`, "ṣ"],
      [String.raw`\b{b}`, "ḇ"],
      [String.raw`\r{a}`, "å"],
      [String.raw`\t{oo}`, "o͡o"],
    ];
    for (const [source, text] of accents) expect(plain(source), source).toBe(text);
  });

  test("takes the letter after a space, in braces, or as a word's first", () => {
    expect(plain(String.raw`Fran\c cois`)).toBe("François");
    expect(plain(String.raw`\'{e}tude`)).toBe("étude");
    expect(plain(String.raw`\'etude`)).toBe("étude");
    expect(plain(String.raw`na\"\i ve`)).toBe("naïve");
    expect(plain(String.raw`\'{\i}`)).toBe("í");
    expect(plain(String.raw`\^{}`)).toBe("^");
  });

  test("composes as a function too", () => {
    expect(composed("e", "́", "´")).toBe("é");
    expect(composed("", "́", "´")).toBe("´");
    expect(composed("ı", "̈", "¨")).toBe("ï");
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

  test("skips the spaces after a control word, not after a control symbol", () => {
    expect(plain(String.raw`\ss  e`)).toBe("ße");
    expect(plain(String.raw`\ss{} e`)).toBe("ß e");
    expect(plain(String.raw`a\&  b`)).toBe("a& b");
    expect(plain(String.raw`a\ \ b`)).toBe("a  b");
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
