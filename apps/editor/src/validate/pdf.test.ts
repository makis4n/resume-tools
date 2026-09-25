import { describe, expect, it } from "vitest";
import { hasToUnicode, mediaBoxes, shownStrings } from "./pdf";

/** A PDF's text as its bytes, one byte per character, as xdvipdfmx writes a PDF at level 0. */
const bytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

/** A stream object, its /Length the data's, with more of its dictionary when given. */
const stream = (object: number, data: string, dict = "") =>
  `${object} 0 obj\n<<${dict}/Length ${data.length}>>\nstream\n${data}\nendstream\nendobj`;

/**
 * A hand-made one-page PDF laid out as xdvipdfmx lays one out, whose page shows `content`, with
 * more objects after it when given.
 */
const pdfWith = (content: string, ...objects: string[]) =>
  bytes(
    [
      "%PDF-1.5",
      stream(4, content),
      "3 0 obj\n<</Type/Page/Parent 2 0 R/Contents[4 0 R]/Resources<</Font<</F1 5 0 R>>>>>>\nendobj",
      "2 0 obj\n<</Type/Pages/Count 1/Kids[3 0 R]/MediaBox[0 0 612 792]>>\nendobj",
      ...objects,
      "%%EOF",
    ].join("\n"),
  );

describe("shownStrings", () => {
  it("reads what each text-showing operator shows, a TJ's strings joined without its kerns", () => {
    const pdf = pdfWith(
      "q 1 0 0 1 72 720 cm BT /F1 9.96 Tf 10 20 Td[(Hel)-27(lo)]TJ (world)Tj 0 -12 Td(again)' 1 2 (quoted)\" ET Q",
    );
    expect(shownStrings(pdf)).toEqual(["Hello", "world", "again", "quoted"]);
  });

  it("decodes escapes, octal codes, nested parentheses and hexadecimal strings", () => {
    const pdf = pdfWith(
      String.raw`BT /F1 10 Tf (a\(b\)c\\d)Tj (\101\1027C\014rst)Tj (x(y)z)Tj <4D 61 72 61>Tj [<4D61>-50(ra)]TJ <4>Tj (one\
line)Tj ET`,
    );
    expect(shownStrings(pdf)).toEqual([
      "a(b)c\\d",
      "AB7C\x0crst",
      "x(y)z",
      "Mara",
      "Mara",
      "@",
      "oneline",
    ]);
  });

  it("reads the pages' content and forms, and no other stream", () => {
    const form = stream(
      6,
      "BT /F1 10 Tf (In a form)Tj ET",
      "/Type/XObject/Subtype/Form/BBox[0 0 9 9]",
    );
    // A ToUnicode map, and a font whose bytes happen to spell a text operator: neither is content.
    const cmap = stream(7, "1 beginbfchar\n<0C> <FB01>\nendbfchar (Not text)Tj");
    const font = stream(8, "\x00\xff(Mara)Tj endobj endstream \x80", "/Subtype/Type1C");
    const pdf = pdfWith("BT /F1 10 Tf (On the page)Tj ET /Fm1 Do", form, cmap, font);
    expect(shownStrings(pdf)).toEqual(["On the page", "In a form"]);
  });

  it("skips a stream with a filter, which it cannot read", () => {
    const pdf = bytes(
      [
        stream(4, "x\x9c\x0b\xc9\xcf", "/Filter/FlateDecode"),
        "3 0 obj\n<</Type/Page/Contents 4 0 R>>\nendobj",
      ].join("\n"),
    );
    expect(shownStrings(pdf)).toEqual([]);
  });

  it("cuts a stream to its /Length, and passes over an inline image's data", () => {
    // What follows the data within the object is not the stream's, whatever it looks like.
    const content = "BT (Before)Tj ET BI /W 1 /H 1 /BPC 8 /CS /G ID \x28)(\x5d EI BT (After)Tj ET";
    const pdf = bytes(
      `${stream(4, content).replace("\nendstream", " (Past the end)Tj\nendstream")}\n3 0 obj\n<</Type/Page/Contents 4 0 R>>\nendobj`,
    );
    expect(shownStrings(pdf)).toEqual(["Before", "After"]);
  });
});

describe("mediaBoxes and hasToUnicode", () => {
  it("read every page size, in big points, and whether a font has a ToUnicode map", () => {
    const letter = pdfWith("");
    expect(mediaBoxes(letter)).toEqual([{ width: 612, height: 792 }]);
    expect(hasToUnicode(letter)).toBe(false);
    const a4 = pdfWith(
      "",
      "5 0 obj\n<</Type/Font/Subtype/Type1/ToUnicode 9 0 R/BaseFont/CMR10>>\nendobj",
      "6 0 obj\n<</Type/Page/MediaBox [ 0 0 595.28 841.89 ]>>\nendobj",
    );
    expect(mediaBoxes(a4)).toEqual([
      { width: 612, height: 792 },
      { width: 595.28, height: 841.89 },
    ]);
    expect(hasToUnicode(a4)).toBe(true);
  });
});
