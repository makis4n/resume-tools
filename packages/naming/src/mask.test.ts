import { describe, expect, test } from "vitest";
import {
  datePlaceholder,
  defaultHoldsText,
  holdsText,
  maskDefinition,
  placeholder,
  specDefaults,
} from "./mask";

// Every name, address and number here is invented.

/**
 * Node's CPU clock for this thread, which the package's types, written for the browser, do not
 * declare; the tests run in Node.
 */
declare const process: {
  threadCpuUsage(previous?: { user: number; system: number }): { user: number; system: number };
};

/**
 * The fastest of `runs` timings of one run of each of `works`, in milliseconds of this thread's
 * CPU time, each timing as many runs in a row as span 20 ms: the editor's `fastest`
 * (`apps/editor/src/test/timing.ts`), which a package cannot import.
 */
function fastest(works: (() => void)[], runs: number): number[] {
  const cpuMs = (work: () => void) => {
    const started = process.threadCpuUsage();
    work();
    const { user, system } = process.threadCpuUsage(started);
    return (user + system) / 1000;
  };
  const counts = works.map(() => 1);
  const best = works.map(() => Number.POSITIVE_INFINITY);
  for (let run = 0; run < runs; run++)
    works.forEach((work, i) => {
      for (let count = counts[i] ?? 1; count <= 2 ** 24; count *= 2) {
        const ms = cpuMs(() => {
          for (let k = 0; k < count; k++) work();
        });
        if (ms < 20) continue;
        counts[i] = count;
        best[i] = Math.min(best[i] ?? Number.POSITIVE_INFINITY, ms / count);
        break;
      }
    });
  return best;
}

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
    // Symbols and spaces are no text of anyone's, and stay; a mark tells which letter it sits
    // on, and goes as the letters do.
    expect(placeholder("e\u0301 → ★")).toBe("xx → ★");
    expect(holdsText(placeholder(text))).toBe(false);
  });

  test("masks the marks of scripts whose vowels are signs, and enclosed letters", () => {
    // Invented names: Quill Invented in Devanagari, Quill in Tamil, a decomposed accent, and
    // circled letters, whose vowel signs, viramas and accents are marks, and whose circles are
    // symbols that `Alphabetic` counts as letters.
    for (const text of ["क्विल इन्वेन्टेड", "க்வில்", "Que\u0301ll", "Ⓠⓤⓘⓛⓛ"]) {
      const out = placeholder(text);
      expect([...out], text).toHaveLength([...text].length);
      expect(out, text).toMatch(/^[xX0 ]+$/);
      expect(holdsText(text), text).toBe(true);
      expect(holdsText(out), text).toBe(false);
    }
    expect(placeholder("Ⓠⓤⓘⓛⓛ")).toBe("xxxxx");
    // A mark alone, or after a control word's name, is still the text's.
    expect(holdsText("x\u0301")).toBe(true);
    expect(holdsText("\\x\u0301")).toBe(true);
    expect(holdsText("\\Ⓠ")).toBe(true);
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
    // An address is masked whole, underscores, dots and all, and a host of several labels.
    for (const email of ["quill_invented@example.invalid", "q.i+cv@mail.example.co.uk"])
      expect(maskDefinition(`macro:->{${email}}`)).toBe(`macro:->{${hidden("email", email)}}`);
  });

  test("masks a postcode of letters and digits, and none of a class's code with numbers", () => {
    for (const code of [
      "QV1A 2ZX",
      "QX1A 1BZ",
      "Q1 1QX",
      "QX33 8XQ",
      "XQ2 6QX",
      "X9Q 0Q9",
      "Q5V 3Q9",
    ])
      expect(maskDefinition(`macro:->Harbour City\\\\ ${code}\\par `), code).toBe(
        `macro:->Harbour City\\\\ ${"_".repeat(code.length)}\\par `,
      );
    // A postcode of digits alone is a number as code writes one, and one written without its
    // capitals or its space is no shape a pattern can tell: both are left to the document's values.
    const code = [
      "macro:->\\penalty 10000 \\hskip 12345sp \\@M 10000\\relax 94103\\par ",
      "macro:->\\fontencoding {T1}\\fontsize {10}{12}\\selectfont \\usefont {LY1}{ptm}{m}{n}",
      'macro:->\\DeclareFontShape {T1}{lmr}{m}{n}{<-> ec-lmr10}{}\\char "1F600 ',
      "macro:->\\definecolor {accent}{HTML}{1F4E79}\\setcounter {secnumdepth}{0}",
      "macro:->\\ProvidesClass {inventedcv}[v1.2 an invented class]\\LoadClass [11pt]{article}",
      "macro:->\\geometry {a4paper, margin=1.5cm, top=2cm}\\pgfmathsetmacro \\x {360*0.25}",
      "macro:->A4 paper, T1 OT1 TS1 TU, LY1 A5 B5, \\hyphenpenalty =10000 \\exhyphenpenalty 50",
      "macro:->\\node [minimum width=3cm] at (0,4.5) {X1}; \\draw (A1) -- (B2);",
      "macro:->qv1a 2zx QV1A2ZX X9Q0Q9",
    ];
    for (const text of code) expect(maskDefinition(text), text).toBe(text);
  });

  test("takes time linear in a definition's length, however it is spelled", () => {
    // Runs of what an address is made of, which unbounded patterns tried from every start: each
    // costs about ten times what a tenth of it costs, in CPU time, where it cost 90 times before
    // the patterns were bounded, and seconds at the full length. So each is bound by three times
    // ten times its tenth, and by 250 ms.
    const shapes: [string, (length: number) => string][] = [
      ["letters", (length) => "a".repeat(length)],
      ["dotted letters", (length) => "a.".repeat(length / 2)],
      ["dotted pairs", (length) => "aa.".repeat(length / 3)],
      ["hyphenated labels", (length) => "a-a.".repeat(length / 4)],
      ["spaced digits", (length) => `${"1 ".repeat(length / 2)}x`],
      ["digits among spaces", (length) => `1${" ".repeat(50)}`.repeat(length / 51)],
    ];
    for (const [shape, make] of shapes) {
      const [short = 0, long = 0] = fastest(
        [6_400, 64_000].map((length) => {
          const text = make(length);
          return () => maskDefinition(text);
        }),
        5,
      );
      expect(long, shape).toBeLessThan(Math.max(3 * 10 * short, 1));
      expect(long, shape).toBeLessThan(250);
    }
  }, 60_000);
});

describe("a signature's defaults", () => {
  test("are read from every kind of argument that gives one, in order", () => {
    expect(specDefaults("")).toEqual([]);
    expect(specDefaults("m m o")).toEqual([]);
    expect(specDefaults("+m !o s t+ r() d<> e{^} u{;} >{\\SplitList{;}} ={key} m")).toEqual([]);
    expect(specDefaults("O{Xxxxx} m")).toEqual(["Xxxxx"]);
    expect(specDefaults("D<>{x} R(){0} G{} E{^_}{{a}{b}} O{{nested} group}")).toEqual([
      "x",
      "0",
      "",
      "{a}{b}",
      "{nested} group",
    ]);
    expect(specDefaults("s O{\\str_use:N \\l_fontawesome_style_str }")).toEqual([
      "\\str_use:N \\l_fontawesome_style_str ",
    ]);
    expect(specDefaults("D\\[\\]{x}")).toEqual(["x"]);
  });

  test("are undefined for a text that is no signature", () => {
    for (const text of ["Quill Invented", "O{x", "O", "D<>", "E{^}", "m 7"])
      expect(specDefaults(text), text).toBeUndefined();
  });

  test("hold text as a call site does, past the names of the commands they hold", () => {
    for (const text of ["quill@example.invalid", "Quill Invented", "+44 20 7946 0000", "{Wren}{}"])
      expect(defaultHoldsText(text), text).toBe(true);
    for (const text of ["Xxxxx Xxxxxxxx", "", "0000", "\\@empty", "\\str_use:N \\l_fa_style_str "])
      expect(defaultHoldsText(text), text).toBe(false);
    // What follows a name is the default's text again.
    expect(defaultHoldsText("\\textbf{Quill}")).toBe(true);
  });
});
