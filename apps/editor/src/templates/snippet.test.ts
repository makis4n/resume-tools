import { describe, expect, it } from "vitest";
import { bound, fastest } from "../test/timing";
import {
  checkAddresses,
  checkSnippet,
  parseSnippet,
  SnippetError,
  type SnippetNode,
} from "./snippet";

const text = (text: string): SnippetNode => ({ kind: "text", text });
const slot = (name: string, raw = false): SnippetNode => ({ kind: "slot", name, raw });
const block = (name: string, children: SnippetNode[], present = true): SnippetNode => ({
  kind: "block",
  name,
  present,
  children,
});

/** The error a snippet throws, as its message and offset. */
function errorOf(source: string) {
  try {
    parseSnippet(source);
  } catch (error) {
    if (error instanceof SnippetError) return { message: error.message, offset: error.offset };
    throw error;
  }
  throw new Error(`no error from ${source}`);
}

describe("parseSnippet", () => {
  it("reads a snippet with no tags as text", () => {
    expect(parseSnippet("\\section{Skills}")).toEqual([text("\\section{Skills}")]);
    expect(parseSnippet("")).toEqual([]);
  });

  it("begins a tag at the last two of a run of braces", () => {
    expect(parseSnippet("\\textbf{{{title}}}")).toEqual([
      text("\\textbf{"),
      slot("title"),
      text("}"),
    ]);
    expect(parseSnippet("{{{title}}}{{{dates}}}")).toEqual([
      text("{"),
      slot("title"),
      text("}{"),
      slot("dates"),
      text("}"),
    ]);
  });

  it("reads a raw slot", () => {
    expect(parseSnippet("\\hypersetup{pdfauthor={{{&last}}}}{{{last}}}")).toEqual([
      text("\\hypersetup{pdfauthor={"),
      slot("last", true),
      text("}}{"),
      slot("last"),
      text("}"),
    ]);
  });

  it("nests blocks, and reads an inverted block", () => {
    const source =
      "{{#dates}}({{#place}}{{place}}, {{/place}}{{dates}}){{/dates}}{{^dates}}undated{{/dates}}";
    expect(parseSnippet(source)).toEqual([
      block("dates", [
        text("("),
        block("place", [slot("place"), text(", ")]),
        slot("dates"),
        text(")"),
      ]),
      block("dates", [text("undated")], false),
    ]);
  });

  it("takes out the whole line of a block tag that stands alone", () => {
    expect(parseSnippet("A\n{{#bullets}}\nB\n{{/bullets}}\nC")).toEqual([
      text("A\n"),
      block("bullets", [text("B\n")]),
      text("C"),
    ]);
    // Spaces and tabs around the tag, the first and last lines, and Windows line breaks.
    expect(parseSnippet("  {{#b}}\t\nB\n  {{/b}}")).toEqual([block("b", [text("B\n")])]);
    expect(parseSnippet("A\r\n{{^b}}\r\nB\r\n{{/b}}\r\nC")).toEqual([
      text("A\r\n"),
      block("b", [text("B\r\n")], false),
      text("C"),
    ]);
  });

  it("keeps the line of a slot, and of a block tag that shares its line", () => {
    expect(parseSnippet("A\n{{title}}\nC")).toEqual([text("A\n"), slot("title"), text("\nC")]);
    expect(parseSnippet("A\n{{#b}}{{/b}}\nC")).toEqual([text("A\n"), block("b", []), text("\nC")]);
    expect(parseSnippet("A\n{{#b}}B\n{{/b}}")).toEqual([text("A\n"), block("b", [text("B\n")])]);
  });

  it("allows whitespace inside the braces", () => {
    expect(parseSnippet("{{ title }}")).toEqual([slot("title")]);
    expect(parseSnippet("{{# dates }}{{ & dates }}{{/ dates }}")).toEqual([
      block("dates", [slot("dates", true)]),
    ]);
  });

  it("reads braces that begin no well-formed tag as text", () => {
    expect(parseSnippet("{{\\bf x}}")).toEqual([text("{{\\bf x}}")]);
    expect(parseSnippet("{{}{word}}")).toEqual([text("{{}{word}}")]);
  });

  it("throws for a block that is not closed properly, saying where", () => {
    expect(errorOf("a{{#bullets}}b")).toEqual({
      message: "{{#bullets}} at offset 1 is never closed",
      offset: 1,
    });
    expect(errorOf("a{{/bullets}}")).toEqual({
      message: "{{/bullets}} at offset 1 closes no block",
      offset: 1,
    });
    expect(errorOf("{{#title}}x{{/place}}")).toEqual({
      message: "{{/place}} at offset 11 cannot close {{#title}} at offset 0",
      offset: 11,
    });
  });
});

describe("checkSnippet", () => {
  const slots = { title: "text", href: "url", bullets: "list" } as const;
  const check = (source: string) => checkSnippet(parseSnippet(source), slots);

  it("passes a snippet that uses its slots as their types allow", () => {
    const source =
      "\\href{{{&href}}}{{{title}}}{{#bullets}}{{bullets}}{{/bullets}}{{^href}}{{&title}}{{/href}}";
    expect(check(source)).toEqual([]);
  });

  it("names a slot its place does not offer", () => {
    const offered = "the slots are title, href, bullets";
    expect(check("{{#place}}{{place}}{{/place}}")).toEqual([
      `there is no slot place here; ${offered}`,
    ]);
    expect(check("{{constructor}}")).toEqual([`there is no slot constructor here; ${offered}`]);
    expect(checkSnippet(parseSnippet("{{value}}"), {})).toEqual([
      "there is no slot value here; this snippet has none",
    ]);
  });

  it("needs a URL raw", () => {
    expect(check("\\url{{{href}}}")).toEqual(["href is a URL, so it goes in raw, as {{&href}}"]);
  });

  it("refuses a list raw", () => {
    expect(check("{{&bullets}}")).toEqual([
      "bullets is a list, so it goes in as {{bullets}} or names a block",
    ]);
  });
});

describe("checkAddresses", () => {
  const slots = { text: "text", href: "url", summary: "rich", dates: "date" } as const;
  const check = (source: string) => checkAddresses(source, slots);
  const refused = (name: string, type = "text", command = "href") =>
    `${name} is a ${type} slot; inside \\${command} use a url slot, such as href`;
  const backslashed = "a slot cannot follow a backslash; the text would become a command";

  it("passes a URL slot in an address, and any slot outside one", () => {
    expect(check("\\href{{{&href}}}{\\underline{{{text}}}}")).toEqual([]);
    expect(check("\\url {{{&href}}} \\hypersetup{pdftitle={{{&text}}}} {{&summary}}")).toEqual([]);
    // A name the place does not offer is checkSnippet's to report.
    expect(check("\\href{{{&nothing}}}{x}")).toEqual([]);
  });

  it("refuses any other slot in an address, raw or typeset, however deep, naming its type", () => {
    expect(check("\\href{mailto:{{&text}}}{{{text}}}")).toEqual([refused("text")]);
    expect(check("\\mbox{\\url{x{y{{{summary}}}}}}")).toEqual([refused("summary", "rich", "url")]);
    expect(check("\\href{{{#text}}{{&text}}{{/text}}}{x}")).toEqual([refused("text")]);
    expect(check("\\href\n  {tel:{{&text}}}{x} \\url{{{&summary}}}")).toEqual([
      refused("text"),
      refused("summary", "rich", "url"),
    ]);
    expect(check("\\href{{{&dates}}}{x}")).toEqual([
      "dates is a date slot; inside \\href use a url slot, such as href",
    ]);
  });

  it("reads the first argument of \\nolinkurl and \\hyperlink as an address too", () => {
    expect(check("\\nolinkurl{{{&text}}}")).toEqual([refused("text", "text", "nolinkurl")]);
    expect(check("\\hyperlink{{{&summary}}}{x}")).toEqual([
      refused("summary", "rich", "hyperlink"),
    ]);
    expect(check("\\nolinkurl{{{&href}}} \\hyperlink{top}{{{text}}}")).toEqual([]);
  });

  it("finds the address after an optional argument, counting braces inside it", () => {
    expect(check("\\href[pdfnewwindow]{mailto:{{&text}}}{{{text}}}")).toEqual([refused("text")]);
    expect(check("\\href [page=2] {mailto:{{&text}}}{x}")).toEqual([refused("text")]);
    // A ] inside braces does not end the optional argument.
    expect(check("\\href[pdfborder={]}]{{{&text}}}{x}")).toEqual([refused("text")]);
    expect(check("\\href[pdfnewwindow]{{{&href}}}{{{text}}}")).toEqual([]);
    // Only one optional argument: a second [ is the address itself, a token and no group.
    expect(check("\\href[a][{{&text}}]{x}")).toEqual([]);
  });

  it("reads no comment, but a \\% as the character", () => {
    expect(check("{{text}} % was \\href{mailto:{{&text}}}{x}")).toEqual([]);
    expect(check("% see \\href{\n{{&text}}")).toEqual([]);
    // The comment ends with its line, and the command it follows still takes its address.
    expect(check("\\href%\n{mailto:{{&text}}}{x}")).toEqual([refused("text")]);
    expect(check("\\href{mailto:%}\n{{&text}}}{x}")).toEqual([refused("text")]);
    expect(check("\\href{50\\%{{&text}}}{x}")).toEqual([refused("text")]);
    // A tag that runs past the line's end takes the comment with it.
    expect(check("% {{\n&text}} \\href{mailto:{{&text}}}\nx")).toEqual([]);
  });

  it("reads a backslash before a brace or a backslash as a control symbol", () => {
    // \\ is a line break, so the "href" after it is text, and \} closes no argument.
    expect(check("\\\\href{{{&text}}}")).toEqual([]);
    expect(check("\\href{a\\}{{&text}}}")).toEqual([refused("text")]);
    expect(check("\\href{a}{{&text}}")).toEqual([]);
  });

  it("refuses a slot right after a backslash, which would make its text a command", () => {
    expect(check("\\item \\{{&text}}")).toEqual([backslashed]);
    expect(check("\\item \\\\\\{{text}}")).toEqual([backslashed]);
    expect(check("\\item \\\\{{&text}}")).toEqual([]);
    expect(check("\\item \\{{{&text}}}")).toEqual([]);
    expect(check("% \\{{&text}}")).toEqual([]);
    // A block tag between sets nothing, so the backslash still reaches the slot.
    expect(check("\\{{#text}}{{&text}}{{/text}}")).toEqual([backslashed]);
    expect(check("\\\\{{#text}}{{&text}}{{/text}}")).toEqual([]);
  });

  it("reads an address \\url and \\nolinkurl take between any other character", () => {
    expect(check("\\url|{{text}}|")).toEqual([refused("text", "text", "url")]);
    expect(check("\\nolinkurl |{{&summary}}| after")).toEqual([
      refused("summary", "rich", "nolinkurl"),
    ]);
    expect(check("\\url|{{&href}}| {{text}}")).toEqual([]);
    expect(check("\\url|plain{}|{{text}}")).toEqual([]);
    expect(check("\\href|{{text}}|")).toEqual([]);
  });
});

describe("crafted snippets", () => {
  it("checks deep nesting without recursing", () => {
    const depth = 100_000;
    const nodes = parseSnippet("{{#x}}".repeat(depth) + "{{/x}}".repeat(depth));
    expect(checkSnippet(nodes, { title: "text" })).toEqual([
      "there is no slot x here; the slots are title",
    ]);
  });

  it("costs time in proportion to the snippet's length, whatever it holds", () => {
    // Both took seconds while the tag regex and the standalone-line test scanned quadratically.
    // Each now costs 8.9 to 11.9 times what it costs at a tenth of its length, in CPU time
    // (`fastest`); with the regex and the line test they first had, 95 and 99 times. So each is
    // bound by five times ten times its tenth, as draw.test.ts bounds a page, and by 1,000 ms.
    const blanks = (count: number) => `{{${"\n".repeat(count)}\\relax}}`;
    const tags = (count: number) => "{{#a}}{{/a}}".repeat(count);
    expect(parseSnippet(blanks(200_000))).toEqual([text(blanks(200_000))]);
    expect(parseSnippet(tags(50_000))).toHaveLength(50_000);
    for (const [snippet, count] of [
      [blanks, 200_000],
      [tags, 50_000],
    ] as const) {
      const [short = 0, long = 0] = fastest(
        [count / 10, count].map((each) => {
          const source = snippet(each);
          return () => parseSnippet(source);
        }),
        5,
      );
      expect(long).toBeLessThan(bound(5 * 10, short));
      expect(long).toBeLessThan(1000);
    }
  }, 60_000);

  it("checks addresses in one pass, however deep they nest or often they open", () => {
    // Each costs 9.7 to 14.2 times what it costs at a tenth of its length, in CPU time, and is
    // bound by five times ten times its tenth, as a parse is above, and by 1,000 ms. The check
    // was one pass from its first version, so there is no quadratic one to measure.
    const deep = (count: number) => `${"\\href{".repeat(count)}{{&text}}${"}".repeat(count)}`;
    const unclosed = (count: number) => "\\href{\\url{ {{#text}}".repeat(count);
    // Comments, optional arguments and runs of backslashes, each read once.
    const commented = (count: number) => "%\\href{{{&text}}\n".repeat(count);
    const optional = (count: number) => "\\href[{[".repeat(count);
    // An odd run of backslashes, so that the last of them reaches the slot.
    const backslashes = (count: number) =>
      `${"\\".repeat(10 * count + 1)}{{&text}}${"\\{{&text}}".repeat(count)}`;
    const check = (source: string) => checkAddresses(source, { text: "text" });
    expect(check(deep(100_000))).toEqual([
      "text is a text slot; inside \\href use a url slot, such as href",
    ]);
    expect(check(unclosed(50_000))).toEqual([]);
    expect(check(commented(50_000))).toEqual([]);
    expect(check(optional(100_000))).toEqual([]);
    expect(check(backslashes(50_000))).toEqual([
      "a slot cannot follow a backslash; the text would become a command",
    ]);
    for (const [snippet, count] of [
      [deep, 100_000],
      [unclosed, 50_000],
      [commented, 50_000],
      [optional, 100_000],
      [backslashes, 50_000],
    ] as const) {
      const [short = 0, long = 0] = fastest(
        [count / 10, count].map((each) => {
          const source = snippet(each);
          return () => check(source);
        }),
        5,
      );
      expect(long).toBeLessThan(bound(5 * 10, short));
      expect(long).toBeLessThan(1000);
    }
  }, 60_000);
});
