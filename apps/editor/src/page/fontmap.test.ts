import { describe, expect, it } from "vitest";
import { parseFontMaps, parseMapLine } from "./fontmap";

describe("parseMapLine", () => {
  it("reads a plain Type 1 entry", () => {
    expect(parseMapLine("cmr10 CMR10 <cmr10.pfb")).toEqual({
      tfm: "cmr10",
      psName: "CMR10",
      fontFile: "cmr10.pfb",
    });
  });

  it("reads a re-encoded, slanted font", () => {
    expect(
      parseMapLine(
        'pbkdo8r URWBookmanL-DemiBold " .167 SlantFont TeXBase1Encoding ReEncodeFont " <8r.enc <ubkd8a.pfb',
      ),
    ).toEqual({
      tfm: "pbkdo8r",
      psName: "URWBookmanL-DemiBold",
      slant: 0.167,
      encodingFile: "8r.enc",
      fontFile: "ubkd8a.pfb",
    });
  });

  it("reads a stretched font and the <[ and << forms", () => {
    expect(
      parseMapLine('pcrr8rn NimbusMonL-Regu " .85 ExtendFont " <[8r.enc <<ucrr8a.pfb'),
    ).toEqual({
      tfm: "pcrr8rn",
      psName: "NimbusMonL-Regu",
      extend: 0.85,
      encodingFile: "8r.enc",
      fontFile: "ucrr8a.pfb",
    });
  });

  it("skips font flags and entries with no PostScript name", () => {
    expect(parseMapLine("dummy-space <dummy-space.pfb")).toEqual({
      tfm: "dummy-space",
      fontFile: "dummy-space.pfb",
    });
    expect(parseMapLine("fxlr LinLibertineO 4 <fxlr.pfb")).toMatchObject({
      psName: "LinLibertineO",
      fontFile: "fxlr.pfb",
    });
  });

  it("ignores comments and blank lines", () => {
    expect(parseMapLine("% a comment")).toBeUndefined();
    expect(parseMapLine("   ")).toBeUndefined();
    expect(parseMapLine("# also a comment")).toBeUndefined();
  });
});

describe("parseFontMaps", () => {
  it("lets the first map win for a font two maps list", () => {
    const table = parseFontMaps(
      "cmr10 CMR10 <cmr10.pfb",
      "cmr10 Other <other.pfb\numvs Marvosym <marvosym.pfb",
    );
    expect(table.get("cmr10")?.fontFile).toBe("cmr10.pfb");
    expect(table.get("umvs")?.fontFile).toBe("marvosym.pfb");
  });
});
