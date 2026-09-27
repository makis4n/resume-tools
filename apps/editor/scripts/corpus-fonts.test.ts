import { describe, expect, test } from "vitest";
import { type FontsRow, fontsTable, rowName } from "./corpus-fonts";

// Every row here is invented for these tests.

const row = (id: string, family: FontsRow["family"], changes: Partial<FontsRow>): FontsRow => ({
  id,
  family,
  taken: "xetex",
  outcome: "rewritten",
  wall: 1000,
  ...changes,
});

/** A row of a document whose child timed out or died before it said whether it took it. */
const unsaid = (id: string, family: FontsRow["family"], outcome: "timeout" | "crashed") => {
  const { taken: _, ...left } = row(id, family, { outcome });
  return left;
};

const rewritten = (id: string, family: FontsRow["family"], changes: Partial<FontsRow> = {}) =>
  row(id, family, {
    families: 3,
    shapes: 12,
    features: { mapping: 3, smcp: 2 },
    referenceMs: 2000,
    wholeMs: 600,
    dumpMs: 500,
    bodyMs: 200,
    formatBytes: 9_000_000,
    ...changes,
  });

describe("the fonts table", () => {
  const rows: FontsRow[] = [
    rewritten("awesome-cv-0001", "awesome-cv", { maths: true }),
    rewritten("awesome-cv-0002", "awesome-cv", {
      dumpMs: 900,
      bodyMs: 400,
      formatBytes: 11_000_000,
      features: { pnum: 1 },
    }),
    rewritten("altacv-0001", "altacv", { taken: "either", families: 1, shapes: 4 }),
    row("altacv-0002", "altacv", { outcome: "difference", name: "layout", families: 2 }),
    row("other-0001", "other", { outcome: "font", name: "Invented Sans" }),
    row("other-0002", "other", { outcome: "feature", name: "\\addfontfeatures" }),
    row("other-0003", "other", { outcome: "stopped", name: "stopped" }),
    row("jake-0001", "jake", { taken: "either", outcome: "no-reference" }),
    unsaid("other-0004", "other", "timeout"),
    unsaid("other-0005", "other", "crashed"),
  ];
  const table = fontsTable(rows);
  const cells = (label: string) =>
    table
      .split("\n")
      .find((line) => line.startsWith(`| ${label} |`))
      ?.split("|")
      .slice(2, -1)
      .map((cell) => cell.trim());

  test("counts the documents taken per family and in all, and what became of them", () => {
    // A document whose child timed out or died is not counted as taken, whatever it was.
    expect(cells("Documents taken: XeTeX, with a reference")).toEqual([
      "0",
      "2",
      "1",
      "0",
      "0",
      "3",
      "6",
    ]);
    expect(
      cells("Documents taken: pdfTeX guarded on the engine, with font packages, on XeTeX")?.at(-1),
    ).toBe("2");
    expect(cells("Rewritten, dumped, and matched the reference twice")).toEqual([
      "0",
      "2",
      "1",
      "0",
      "0",
      "0",
      "3",
    ]);
    expect(cells("... with mathematics alone set otherwise")?.at(-1)).toBe("1");
    expect(cells("Refused: a font the tree lacks")?.at(-1)).toBe("1");
    expect(cells("Refused: a feature or package the rewrite cannot reproduce")?.at(-1)).toBe("1");
    expect(cells("Refused: glyphs that come out otherwise")?.at(-1)).toBe("1");
    expect(cells("Refused: a compile or dump that stopped once rewritten")?.at(-1)).toBe("1");
    expect(cells("No reference on XeTeX")?.at(-1)).toBe("1");
    expect(cells("Timed out, or its child died")?.at(-1)).toBe("2");
  });

  test("measures the rewritten documents alone: the dump, the format and the compiles", () => {
    expect(cells("Dump, median")).toEqual(["", "700 ms", "500 ms", "", "", "", "500 ms"]);
    expect(cells("Dump, slowest")?.at(-1)).toBe("900 ms");
    expect(cells("Format, median size")?.at(-1)).toBe("9.00 MB");
    expect(cells("Body from the format, median")?.at(-1)).toBe("200 ms");
    expect(cells("Whole document from the stock format, median")?.at(-1)).toBe("600 ms");
    expect(cells("Reference compile, median")?.at(-1)).toBe("2000 ms");
  });

  test("sums the families, shapes and features of the rewritten documents, by kind", () => {
    // The refused document's two families are not counted.
    expect(cells("Families declared")?.at(-1)).toBe("7");
    expect(cells("Shapes declared")?.at(-1)).toBe("28");
    expect(cells("`mapping`")?.at(-1)).toBe("6");
    expect(cells("`pnum`")?.at(-1)).toBe("1");
    expect(cells("`smcp`")?.at(-1)).toBe("4");
  });

  test("names what each refusal names, and keeps every line one line", () => {
    expect(cells("`Invented Sans`")?.at(-1)).toBe("1");
    expect(cells("`\\addfontfeatures`")?.at(-1)).toBe("1");
    expect(cells("`layout`")?.at(-1)).toBe("1");
    const hostile = fontsTable([
      row("other-0009", "other", { outcome: "font", name: rowName("a\nb\u001b[2J") }),
    ]);
    expect(hostile).not.toContain("\u001b");
    expect(hostile.split("\n").every((line) => line === "" || line.startsWith("|"))).toBe(true);
  });

  test("shows a command's name as it is, and any other name only when it is plainly a name", () => {
    expect(rowName("\\addfontfeatures")).toBe("\\addfontfeatures");
    expect(rowName("Invented Sans")).toBe("Invented Sans");
    // An option by its key alone, whether the name gives its value or not: the value is the
    // document's, and may be anything.
    expect(rowName("Numbers=Proportional")).toBe("Numbers");
    expect(rowName("Numbers")).toBe("Numbers");
    expect(rowName("Color=a\nb\u001b[2J;{}")).toBe("Color");
    expect(rowName("RawFeature=+smcp;+onum")).toBe("RawFeature");
    expect(rowName("a\nb")).not.toContain("\n");
    expect(rowName(undefined)).toBeUndefined();
  });
});
