import { describe, expect, it } from "vitest";
import { hasToUnicode, mediaBoxes, shownStrings, shownTexts, strokedPaths } from "./pdf";

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

describe("shownTexts", () => {
  it("places each operator's first glyph by the text matrix, the kerns before it and each cm", () => {
    const pdf = pdfWith(
      [
        // One inch in from the lower left corner, as xdvipdfmx starts a page.
        "q 1 0 0 1 72 720 cm",
        "BT /F1 10 Tf 10 20 Td[(Hel)-27(lo)]TJ 0 -12 Td[-500(Two)]TJ ET",
        // A move in a saved state, as a transform special makes one: a show after a show is not
        // placed, since it follows the first's glyphs.
        "q 1 0 0 1 -23.5 0 cm BT /F1 10 Tf 5 -40 Td(Moved)Tj (After)Tj ET Q",
        "q 2 0 0 2 0 0 cm BT 1 0 0 1 3 4 Tm (Scaled)Tj 14 TL (Next)' ET Q",
        "BT /F1 10 Tf 0 0 Td (Back)Tj ET Q",
      ].join(" "),
    );
    expect(shownTexts(pdf)).toEqual([
      { text: "Hello", parts: ["Hel", -27, "lo"], x: 82, y: 740 },
      { text: "Two", parts: [-500, "Two"], x: 87, y: 728 },
      { text: "Moved", parts: ["Moved"], x: 53.5, y: 680 },
      { text: "After", parts: ["After"], x: Number.NaN, y: Number.NaN },
      { text: "Scaled", parts: ["Scaled"], x: 78, y: 728 },
      { text: "Next", parts: ["Next"], x: 78, y: 700 },
      { text: "Back", parts: ["Back"], x: 72, y: 720 },
    ]);
  });
});

describe("strokedPaths", () => {
  it("gives the box of each stroked path through the matrix, its line's width, and whether it curves", () => {
    const pdf = pdfWith(
      [
        "q 1 0 0 1 72 720 cm",
        // A rule, as xdvipdfmx draws one: a thick line.
        "q 2 w 0 -10 m 100 -10 l S Q",
        // A frame with rounded corners, as TikZ draws a tag's, moved and in a thinner line.
        "q 1 0 0 1 20 -40 cm 0.4 w 4 0 m 36 0 l 38 0 40 2 40 4 c 40 12 l 40 14 38 16 36 16 c",
        "4 16 l 2 16 0 14 0 12 c 0 4 l 0 2 2 0 4 0 c h S Q",
        // Filled, and only clipped: neither is stroked.
        "0 0 10 10 re f 0 0 5 5 re W n",
        // A rectangle stroked at twice the size, whose line is twice as wide.
        "q 2 0 0 2 0 0 cm 1 w 0 0 10 5 re S Q",
        "Q",
      ].join(" "),
    );
    expect(strokedPaths(pdf)).toEqual([
      { left: 72, bottom: 710, right: 172, top: 710, width: 2, curved: false },
      { left: 92, bottom: 680, right: 132, top: 696, width: 0.4, curved: true },
      { left: 72, bottom: 720, right: 92, top: 730, width: 2, curved: false },
    ]);
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
