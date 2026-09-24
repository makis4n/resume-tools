import { describe, expect, it } from "vitest";
import { checkSnippet, parseSnippet, SnippetError, type SnippetNode } from "./snippet";

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
    expect(parseSnippet("\\href{mailto:{{&email}}}{{{email}}}")).toEqual([
      text("\\href{mailto:"),
      slot("email", true),
      text("}{"),
      slot("email"),
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
