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

  it("passes letters, dashes and curly quotes through", () => {
    const text = "A naïve façade – “quoted” and ‘single’ — ok -- 3, 50/50 @ [1] + (2) = *";
    expect(escapeText(text)).toBe(text);
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
    for (const text of ["a", " . ", "​x", "\u{1f642}"])
      expect(isBlank(text), JSON.stringify(text)).toBe(false);
  });
});
