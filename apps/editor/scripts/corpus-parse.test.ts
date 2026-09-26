import { describe, expect, test } from "vitest";
import { bodyOfText, parseBody, type Signatures } from "../src/import/parse";
import { isRefusal } from "../src/import/refusal";
import type { EngineSignatures } from "../src/import/signatures";
import {
  charactersOf,
  datesOf,
  type ParseRow,
  parseNames,
  parseTable,
  shownMacro,
  signatureCounts,
} from "./corpus-parse";

// Every row, body and macro here is invented for these tests; SECRET stands for a document's
// text, which nothing the runner prints may show.

const SECRET = "Quillwort";

const row = (id: string, family: ParseRow["family"], changes: Partial<ParseRow>): ParseRow => ({
  id,
  family,
  outcome: "parsed",
  wall: 1000,
  ...changes,
});

const templates = (meaning: number, unresolved = 0) => ({
  meaning,
  optional: 1,
  robust: 0,
  xparse: 0,
  unresolved,
});

describe("the table", () => {
  const rows: ParseRow[] = [
    row("jake-0001", "jake", {
      engine: "pdftex",
      printed: true,
      roundTrip: "same",
      templates: templates(4),
      environments: 0,
      macros: 9,
      chars: { body: 1000, text: 200, calls: 600, raw: 100 },
      dates: 3,
      parseMs: 20,
      signaturesMs: 150,
    }),
    row("jake-0002", "jake", {
      engine: "pdftex",
      printed: true,
      roundTrip: "differs",
      difference: "position",
      templates: templates(2, 1),
      unresolved: [{ name: "cvinvented", why: "delimited" }],
      macros: 5,
      chars: { body: 1000, text: 400, calls: 400, raw: 100 },
      dates: 1,
      parseMs: 40,
      signaturesMs: 250,
    }),
    row("awesome-cv-0001", "awesome-cv", {
      engine: "xetex",
      printed: true,
      roundTrip: "differs",
      difference: "pages",
      templates: templates(6, 2),
      unresolved: [
        { name: "cvinvented", why: "delimited" },
        { name: `evil\n${SECRET}`, why: "looks ahead" },
      ],
      environments: 2,
      undefined: 1,
      undefinedNames: ["cvbodydefined"],
      chars: { body: 2000, text: 100, calls: 1500, raw: 200 },
      parseMs: 100,
    }),
    row("other-0001", "other", { outcome: "no reference" }),
    row("other-0002", "other", { outcome: "refused", refused: "deep" }),
    row("other-0003", "other", { outcome: "signatures" }),
    row("other-0004", "other", { outcome: "timeout" }),
    row("other-0005", "other", { printed: true, roundTrip: "stopped" }),
  ];
  const table = parseTable(rows);
  const cells = (label: string) =>
    table
      .split("\n")
      .find((line) => line.startsWith(`| ${label} |`))
      ?.split("|")
      .slice(2, -1)
      .map((cell) => cell.trim());

  test("counts what became of the documents that reached the parser", () => {
    expect(cells("Documents with a reference")).toEqual(["2", "1", "0", "0", "0", "4", "7"]);
    expect(cells("Parsed")?.at(-1)).toBe("4");
    expect(cells("Refused by the parser")?.at(-1)).toBe("1");
    expect(cells("No signatures: the compile that prints them stopped")?.at(-1)).toBe("1");
    expect(cells("Timed out or died")?.at(-1)).toBe("1");
    expect(cells("Printed back byte for byte")?.at(-1)).toBe("4");
    expect(cells("Round trip sets the reference's glyphs")?.at(-1)).toBe("1");
    expect(cells("Round trip differs")?.at(-1)).toBe("2");
    expect(cells("Round trip differs first in a position")?.at(-1)).toBe("1");
    expect(cells("Round trip differs first otherwise: pages, size, count, rule")?.at(-1)).toBe("1");
    expect(cells("Round trip did not compile")?.at(-1)).toBe("1");
  });

  test("counts the template macros, how their arguments were read, and per document", () => {
    expect(cells("In all")).toEqual(["9", "9", "0", "0", "0", "0", "18"]);
    expect(cells("Arguments read from its meaning")?.at(-1)).toBe("12");
    expect(cells("Arguments read unresolved")?.at(-1)).toBe("3");
    expect(cells("Per document, median")).toEqual(["5", "9", "", "", "", "0", "5"]);
    expect(cells("Template environments the body opens")?.at(-1)).toBe("2");
    expect(cells("Names undefined when the preamble ends")?.at(-1)).toBe("1");
  });

  test("gives the share of the bodies' characters in text, calls and raw chunks", () => {
    expect(cells("In rich text and dates")).toEqual(["30%", "5%", "", "", "", "", "18%"]);
    expect(cells("In template calls' arguments")?.at(-1)).toBe("63%");
    expect(cells("In raw chunks")?.at(-1)).toBe("10%");
    expect(cells("Dates read")?.at(-1)).toBe("4");
    expect(cells("Parse time, median")?.at(-1)).toBe("40 ms");
    expect(cells("Parse time, slowest")?.at(-1)).toBe("100 ms");
  });

  test("names the unresolved macros that are plainly names, and nothing else", () => {
    expect(cells("delimited")?.at(-1)).toBe("2");
    expect(cells("looks ahead")?.at(-1)).toBe("1");
    expect(cells("`\\cvinvented`")?.at(-1)).toBe("2");
    expect(table).not.toContain(SECRET);
    expect(parseNames(rows)).toEqual({
      unresolved: { "\\cvinvented": 2 },
      undefined: { "\\cvbodydefined": 1 },
    });
    expect(cells("`\\cvbodydefined`")?.at(-1)).toBe("1");
    expect(table.split("\n").every((line) => line === "" || line.startsWith("|"))).toBe(true);
    expect(shownMacro("cv@entry")).toBe("\\cv@entry");
    expect(shownMacro(`a b`)).toBeUndefined();
  });
});

describe("a document's row", () => {
  const SIGNATURES: Signatures = {
    commands: { cvinvented: { kind: "template", spec: "m m" } },
    environments: {},
  };

  test("counts a body's characters in text, calls' arguments and raw chunks, and its dates", () => {
    const text = String.raw`Some text. \cvinvented{Quill}{2020} \vspace{2pt} \textcolor{red}{Jan 2021}`;
    const tree = parseBody(bodyOfText(text), SIGNATURES);
    if (isRefusal(tree)) throw new Error(tree.message);
    expect(charactersOf(tree)).toEqual({
      body: text.length,
      text: "Some text.".length + "Jan 2021".length,
      calls: "{Quill}{2020}".length,
      // A raw command's text it shows is placed, and counted where it is placed.
      raw: String.raw`\vspace{2pt}`.length + String.raw`\textcolor{red}`.length,
    });
    expect(datesOf(tree)).toBe(2);
  });

  test("counts what the signatures say of the body's macros", () => {
    const signatures: EngineSignatures = {
      engine: "pdftex",
      commands: {
        cvone: { kind: "template", how: "meaning", spec: "m" },
        cvtwo: { kind: "template", how: "unresolved", why: "delimited" },
        cvgone: { kind: "undefined", how: "unresolved", why: "undefined" },
        today: { kind: "standard", how: "meaning", spec: "" },
      },
      environments: { cvbox: { kind: "template", how: "meaning", spec: "m" } },
      macros: {
        cvone: { meaning: "macro:#1->#1", hash: "0", dependencies: [], capped: false },
      },
      truncated: false,
      ms: 100,
    };
    expect(signatureCounts(signatures)).toEqual({
      templates: { meaning: 1, optional: 0, robust: 0, xparse: 0, unresolved: 1 },
      unresolved: [{ name: "cvtwo", why: "delimited" }],
      environments: 1,
      macros: 1,
      undefined: 1,
      undefinedNames: ["cvgone"],
      truncated: false,
    });
  });
});
