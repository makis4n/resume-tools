import { MAX_KEPT_LATEX } from "@resume-tools/resume-model";
import { describe, expect, test } from "vitest";
import { parseSnippet } from "../templates/snippet";
import {
  asLocked,
  collapsed,
  comparable,
  extrasSlot,
  isKept,
  sameTemplate,
  snippetText,
  templateText,
  withoutComments,
  wordsIn,
} from "./templating";

// Every text here is invented for these tests.

describe("template text", () => {
  test("drops a comment with its line's end and the next line's spaces, as TeX does", () => {
    expect(withoutComments("a% note\n  b")).toBe("ab");
    expect(withoutComments("a% note")).toBe("a");
    expect(withoutComments("a\\% b")).toBe("a\\% b");
    expect(withoutComments("a\\\\% note\nb")).toBe("a\\\\b");
    // A blank line after a comment is still a paragraph's end.
    expect(withoutComments("a% note\n\nb")).toBe("a\n\nb");
  });

  test("reads whitespace as TeX does: a space, a line's end, or a paragraph's end", () => {
    expect(collapsed("a  \t b")).toBe("a b");
    expect(collapsed("a \n   b")).toBe("a\nb");
    expect(collapsed("a\n \n\n b")).toBe("a\n\nb");
  });

  test("breaks a `{{` that would begin a tag, and nothing else", () => {
    expect(snippetText("\\textbf{{Invented}}")).toBe("\\textbf{{}{Invented}}");
    expect(snippetText("{{&x.key}}")).toBe("{{}{&x.key}}");
    expect(snippetText("{{\\bf x}}")).toBe("{{\\bf x}}");
    expect(parseSnippet(snippetText("\\cv{{title}}"))).toEqual([
      { kind: "text", text: "\\cv{{}{title}}" },
    ]);
    // Control characters, which the escaper drops from typed text, are left out.
    expect(snippetText("a\u0001b\tc")).toBe("ab\tc");
  });

  test("copies source as a snippet holds it, and compares it as TeX reads it", () => {
    expect(templateText("\\cvsection{x} % Invented note\n\n\\begin{list}")).toBe(
      "\\cvsection{x}\n\n\\begin{list}",
    );
    expect(templateText("\\cvsection{x} % Invented note\n  \\begin{list}")).toBe(
      "\\cvsection{x} \\begin{list}",
    );
    expect(sameTemplate("\\a {x}\n\\b", "\\a {x} \\b")).toBe(true);
    expect(sameTemplate("\\a\n\n\\b", "\\a \\b")).toBe(false);
    expect(comparable("\\a % note\n  \\b")).toBe("\\a \\b");
  });

  test("counts words as runs of letters and digits", () => {
    expect(wordsIn("Invented role, 2024 — at Quill & Co.")).toBe(6);
    expect(wordsIn("  ")).toBe(0);
  });
});

describe("kept LaTeX", () => {
  test("is what the model keeps: balanced as TeX reads an argument, comments and control symbols aside", () => {
    expect(isKept("{a}{b}")).toBe(true);
    expect(isKept("\\{ a")).toBe(true);
    expect(isKept("{a % }\n}")).toBe(true);
    expect(isKept("a}")).toBe(false);
    expect(isKept("{a")).toBe(false);
  });

  test("refuses the editor's own macros and markers, and past its length", () => {
    expect(isKept("\\vspace{2pt}")).toBe(true);
    expect(isKept("\\rtfield{x}{y}")).toBe(false);
    expect(isKept("\\special{RT:L:x}")).toBe(false);
    expect(isKept("x".repeat(MAX_KEPT_LATEX))).toBe(true);
    expect(isKept("x".repeat(MAX_KEPT_LATEX + 1))).toBe(false);
  });

  test("names an extra in a slot that writes it as it is", () => {
    expect(extrasSlot("title")).toBe("{{&x.title}}");
    expect(parseSnippet(extrasSlot("lead"))).toEqual([{ kind: "slot", name: "x.lead", raw: true }]);
  });

  test("keeps a part for `\\rtlocked`, escaping what an address holds, or refuses what it cannot take", () => {
    expect(asLocked("\\href{https://example.invalid/#part}{Invented}")).toBe(
      "\\href{https://example.invalid/\\#part}{Invented}",
    );
    expect(asLocked("\\url{https://example.invalid/a%20b}")).toBe(
      "\\url{https://example.invalid/a\\%20b}",
    );
    expect(asLocked("\\href[pdfnewwindow]{https://example.invalid/\\#a}{b}")).toBe(
      "\\href[pdfnewwindow]{https://example.invalid/\\#a}{b}",
    );
    expect(asLocked("Invented \\verb|x| words")).toBeUndefined();
    expect(asLocked("\\makeatletter\\@invented\\makeatother")).toBeUndefined();
    expect(asLocked("\\begin{verbatim}x\\end{verbatim}")).toBeUndefined();
    // A command that only mentions the words in a comment is kept.
    expect(asLocked("Invented % \\verb in a comment\n")).toBe("Invented % \\verb in a comment\n");
    expect(asLocked("{unbalanced")).toBeUndefined();
  });
});
