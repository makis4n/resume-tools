import { describe, expect, it } from "vitest";
import { escapeText, escapeUrl, isBlank } from "./escape";

describe("escapeText", () => {
  it("escapes each of the ten characters TeX gives a meaning", () => {
    const escaped = {
      "\\": "\\textbackslash{}",
      "{": "\\{",
      "}": "\\}",
      $: "\\$",
      "&": "\\&",
      "#": "\\#",
      "^": "\\textasciicircum{}",
      _: "\\_",
      "%": "\\%",
      "~": "\\textasciitilde{}",
    };
    for (const [char, latex] of Object.entries(escaped)) expect(escapeText(char)).toBe(latex);
  });

  it("escapes the three characters OT1 fonts hold other glyphs for", () => {
    expect(escapeText("<")).toBe("\\textless{}");
    expect(escapeText(">")).toBe("\\textgreater{}");
    expect(escapeText("|")).toBe("\\textbar{}");
  });

  it("escapes all of them in one string, keeping the spaces between them", () => {
    expect(escapeText("\\ { } $ & # ^ _ % ~ < > | end")).toBe(
      String.raw`\textbackslash{} \{ \} \$ \& \# \textasciicircum{} \_ \% \textasciitilde{} \textless{} \textgreater{} \textbar{} end`,
    );
  });

  it("turns a non-breaking space into a tie, and escapes a tilde the user typed", () => {
    expect(escapeText("10 km ~ 6 mi")).toBe("10~km \\textasciitilde{} 6 mi");
  });

  it("drops controls and zero-width characters, and turns line breaks and tabs into spaces", () => {
    expect(escapeText("a\u0000b\u0007c\u007fd​e‍f﻿g­h")).toBe("abcdefgh");
    expect(escapeText("one\ntwo\r\nthree\tfour five six")).toBe("one two  three four five six");
  });

  it("drops a lone surrogate and keeps a character outside the Basic Multilingual Plane", () => {
    expect(escapeText("a\ud800b\udc00c")).toBe("abc");
    expect(escapeText("ok \u{1f642} done")).toBe("ok \u{1f642} done");
  });

  it("passes letters, dashes and curly quotes through, and a straight double quote", () => {
    const text = 'A naïve façade – “quoted” and ‘single’ — ok -- 3, 50/50 @ (1) + 2 = "3"';
    expect(escapeText(text)).toBe(text);
  });

  it("turns every space separator into a space, and a no-break one into a tie", () => {
    for (const space of ["\u{2009}", "\u{3000}", "\u{1680}", "\u{2003}", "\u{205f}"])
      expect(escapeText(`a${space}b`), JSON.stringify(space)).toBe("a b");
    for (const space of ["\u{a0}", "\u{202f}", "\u{2007}"])
      expect(escapeText(`a${space}b`), JSON.stringify(space)).toBe("a~b");
  });

  it("braces brackets and the asterisk, which raw text after \\\\ or \\item gives up", () => {
    expect(escapeText("[")).toBe("{[}");
    expect(escapeText("]")).toBe("{]}");
    expect(escapeText("*")).toBe("{*}");
    expect(escapeText("[3 people] led a team*")).toBe("{[}3 people{]} led a team{*}");
  });

  it("puts an empty group before a backtick, so that ? or ! before it makes no ligature", () => {
    expect(escapeText("`?`")).toBe("{}`?{}`");
    expect(escapeText("Rust's `!` too")).toBe("Rust's {}`!{}` too");
  });

  it("composes an accent typed as a combining mark with its letter", () => {
    expect(escapeText("e\u{301}")).toBe("\u{e9}");
    expect(escapeText("Nguye\u{302}\u{303}n")).toBe("Nguy\u{1ec5}n");
  });
});

describe("escapeUrl", () => {
  it("percent-encodes what an address may not hold and escapes what TeX would read", () => {
    expect(escapeUrl("https://example.com/a b/%20/café_x/~me?q=1&r=2#top")).toBe(
      String.raw`https://example.com/a\%20b/\%20/caf\%C3\%A9\_x/\%7Eme?q=1\&r=2\#top`,
    );
  });

  it("encodes the characters TeX gives a meaning that an address may not hold, and $", () => {
    expect(escapeUrl('/\\{}^|<>"`$')).toBe(String.raw`/\%5C\%7B\%7D\%5E\%7C\%3C\%3E\%22\%60\%24`);
  });

  it("keeps the rest of RFC 3986's characters as they are", () => {
    const kept = "https://user@example.com:8080/a-b.c/[x]!'()*+,;=?y=z";
    expect(escapeUrl(kept)).toBe(kept);
  });

  it("drops invisible characters and the whitespace around an address", () => {
    expect(escapeUrl(" \thttps://example.com/​pa\nth \n")).toBe("https://example.com/path");
  });
});

describe("isBlank", () => {
  it("is true for text that would show nothing", () => {
    for (const text of ["", "  ", "\t\n", " ", "​", " ‍﻿ "])
      expect(isBlank(text), JSON.stringify(text)).toBe(true);
    for (const text of ["a", " . ", "​x", "\u{1f642}", "e\u{301}"])
      expect(isBlank(text), JSON.stringify(text)).toBe(false);
  });
});
