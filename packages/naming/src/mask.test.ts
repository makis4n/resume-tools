import { describe, expect, test } from "vitest";
import { datePlaceholder, holdsText, maskDefinition, placeholder } from "./mask";

// Every name, address and number here is invented.

describe("the placeholder", () => {
  test("writes capitals X, other letters x and digits 0, and keeps everything else", () => {
    expect(placeholder("Quill Invented, 42 Wren Row")).toBe("Xxxxx Xxxxxxxx, 00 Xxxx Xxx");
    expect(placeholder("quill@example.invalid")).toBe("xxxxx@xxxxxxx.xxxxxxx");
    expect(placeholder("+1 (555) 010-0000")).toBe("+0 (000) 000-0000");
    expect(placeholder("C++ & Go -- 2021")).toBe("X++ & Xx -- 0000");
    expect(placeholder("")).toBe("");
  });

  test("masks every script's letters and digits, a character for a character", () => {
    const text = "Ωmega ÉTÉ ǅemal Straße 東京 ١٢٣ Ⅻ ½";
    const out = placeholder(text);
    expect(out).toBe("Xxxxx XXX Xxxxx Xxxxxx xx 000 0 0");
    expect([...out]).toHaveLength([...text].length);
    // A letter past the Basic Multilingual Plane is one character, as is its placeholder.
    expect(placeholder("𝐀𝐛")).toBe("Xx");
    // Marks, symbols and spaces are no text of anyone's, and stay.
    expect(placeholder("é → ★")).toBe("x́ → ★");
    expect(holdsText(placeholder(text))).toBe(false);
  });

  test("shapes a date as it is spelled, and never as its digits", () => {
    expect(datePlaceholder({ start: "2021" })).toBe("0000");
    expect(datePlaceholder({ start: "2021-06" })).toBe("0000-00");
    expect(datePlaceholder({ start: "2019-09", end: "2021-06" })).toBe("0000-00 -- 0000-00");
    expect(datePlaceholder({ start: "2019", end: "2021" })).toBe("0000 -- 0000");
    expect(datePlaceholder({ start: "2021-06", end: "present" })).toBe("0000-00 -- xxxxxxx");
    expect(holdsText(datePlaceholder({ start: "2021-06", end: "present" }))).toBe(false);
  });
});

describe("a call site's text", () => {
  test("holds no text when every letter is x or X and every digit 0", () => {
    expect(holdsText("Xxxxx Xxxxxxxx")).toBe(false);
    expect(holdsText("0000-00 -- xxxxxxx")).toBe(false);
    expect(holdsText("$|$, --- & ~ … ★")).toBe(false);
    expect(holdsText("")).toBe(false);
  });

  test("holds text when any other letter or digit is there", () => {
    expect(holdsText("Xxxxx Invented")).toBe(true);
    expect(holdsText("xxxx 7")).toBe(true);
    expect(holdsText("Xxxxé")).toBe(true);
    expect(holdsText("东")).toBe(true);
    expect(holdsText("٣")).toBe(true);
    expect(holdsText("y")).toBe(true);
  });

  test("passes over the names of commands and environments, but not what they hold", () => {
    expect(holdsText("\\textbf{Xxxxx} \\& \\emph{xxxx}\\\\ \\hspace{0.0xx}")).toBe(false);
    expect(holdsText("\\begin{cvitems} \\item Xxxx. \\end{cvitems}")).toBe(false);
    expect(holdsText("\\begin {itemize*}\\item[--] xx\\end{itemize*}")).toBe(false);
    expect(holdsText("\\textbf{Quill}")).toBe(true);
    expect(holdsText("\\begin{cvitems} \\item Wren \\end{cvitems}")).toBe(true);
    // A control symbol is a backslash and a character that is not a letter or a digit: `\é` is a
    // backslash before a letter, which is text.
    expect(holdsText("\\é")).toBe(true);
    expect(holdsText("\\2")).toBe(true);
    // A command's name is ASCII letters: what follows `@` is text again.
    expect(holdsText("\\cv@Quill")).toBe(true);
  });
});

describe("masking a definition", () => {
  const hidden = (kind: string, found: string) =>
    `<${kind}${"_".repeat(found.length - kind.length - 2)}>`;

  test("masks emails, links and phone numbers by placeholders of their own length", () => {
    const [email, link, bare, phone] = [
      "quill@example.invalid",
      "https://example.invalid/quill",
      "github.com/quill",
      "+1 (555) 010-0000",
    ] as const;
    const text = `macro:#1->#1 ${email} \\href {${link}}{${bare}} ${phone}`;
    const out = maskDefinition(text);
    expect(out).toHaveLength(text.length);
    expect(out).toBe(
      `macro:#1->#1 ${hidden("email", email)} \\href {${hidden("link", link)}}{${hidden("link", bare)}} ${hidden("phone", phone)}`,
    );
    expect(maskDefinition("macro:->wrens@example.invalid")).toBe(
      maskDefinition("macro:->quill@example.invalid"),
    );
  });

  test("leaves lengths, short numbers and code alone, and masks seven digits and more", () => {
    expect(maskDefinition("macro:->\\kern 2pt \\hskip 1.5em 2020-12")).toBe(
      "macro:->\\kern 2pt \\hskip 1.5em 2020-12",
    );
    expect(maskDefinition("macro:->2020-12-31")).toBe(`macro:->${hidden("phone", "2020-12-31")}`);
    // A link the pattern finds is masked whoever's it is, the class's own template of one among
    // them, as item 4 hashes it: the model sees that a macro links, and not to where.
    expect(maskDefinition("macro:#1->\\href {mailto:#1}{#1}")).toBe(
      "macro:#1->\\href {<link___>}{#1}",
    );
    // A placeholder too short to name its kind is underscores.
    expect(maskDefinition("macro:->a@b.de")).toBe("macro:->______");
    expect(maskDefinition("macro:->a@bc.de")).toBe("macro:-><email>");
  });
});
