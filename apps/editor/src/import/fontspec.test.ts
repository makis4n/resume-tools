import { describe, expect, it } from "vitest";
import type { TreeFontFile } from "./fonts";
import {
  type FamilySpec,
  FontIndex,
  familyFor,
  fileKeyOf,
  fontKey,
  htmlColour,
  initialDefaults,
  keyVals,
  setDefaults,
  splitList,
  unbrace,
} from "./fontspec";

// Every font and option here is invented for these tests: two families, "Quire Sans", with a light
// and a regular upright and italic, a bold without small capitals and its italic, and "Quire Mono",
// which has no Latin script.

const FEATURES = ["c2sc", "kern", "liga", "lnum", "onum", "pnum", "smcp", "tnum"];

/** A font file of the invented tree, as the manifest's table would describe it. */
function face(
  file: string,
  family: string,
  style: string,
  more: Partial<TreeFontFile> = {},
): TreeFontFile {
  return {
    path: `/texlive/texmf-dist/fonts/opentype/invented/quire/${file}`,
    file,
    family,
    style,
    fontFamily: family,
    fontSubfamily: style,
    fullName: style === "Regular" ? family : `${family} ${style}`,
    postScriptName: `${family.replaceAll(" ", "")}-${style.replaceAll(" ", "")}`,
    weight: 400,
    width: 5,
    scripts: ["DFLT", "latn"],
    features: FEATURES,
    ...more,
  };
}

const ITALIC = { italic: true as const, slant: 212 };
const FONTS = [
  face("QuireSans-Light.otf", "Quire Sans", "Light", { weight: 300 }),
  face("QuireSans-LightItalic.otf", "Quire Sans", "Light Italic", { weight: 300, ...ITALIC }),
  face("QuireSans-Regular.otf", "Quire Sans", "Regular", { regular: true }),
  face("QuireSans-Italic.otf", "Quire Sans", "Italic", ITALIC),
  face("QuireSans-Bold.otf", "Quire Sans", "Bold", {
    weight: 700,
    bold: true,
    features: FEATURES.filter((tag) => tag !== "smcp" && tag !== "pnum"),
  }),
  face("QuireSans-BoldItalic.otf", "Quire Sans", "Bold Italic", {
    weight: 700,
    bold: true,
    ...ITALIC,
  }),
  face("QuireMono-Regular.otf", "Quire Mono", "Regular", { scripts: ["DFLT"], features: ["kern"] }),
];
const index = new FontIndex(FONTS);

/** The family fontspec would declare, with fontspec.cfg's defaults and those given, or why not. */
function family(
  name: string,
  options = "",
  kind?: "rm" | "sf" | "tt",
  defaults = initialDefaults(),
) {
  return familyFor({ name, options, ...(kind ? { kind } : {}) }, defaults, index, new Map());
}

/** Each shape's file and features, as `key: file features`, for a family that was declared. */
function shapes(
  spec: FamilySpec | { unreproducible: string; name: string },
): Record<string, string> {
  if ("unreproducible" in spec) throw new Error(`${spec.unreproducible} ${spec.name}`);
  return Object.fromEntries(
    [...spec.shapes].map(([key, shape]) => [key, `${shape.font.file} ${shape.features.join(";")}`]),
  );
}

const LATIN = "script=latn;language=dflt";

describe("fontspec's options", () => {
  it("splits a list at the commas outside braces, and a key from its value, braces off", () => {
    expect(splitList(" a, {b,c} ,, d={e,f} ")).toEqual(["a", "{b,c}", "d={e,f}"]);
    expect(keyVals("Numbers={Proportional,OldStyle}, Letters=SmallCaps ,FakeBold")).toEqual([
      { key: "Numbers", value: "Proportional,OldStyle" },
      { key: "Letters", value: "SmallCaps" },
      { key: "FakeBold" },
    ]);
    expect(unbrace(" {{ Quire Sans }} ")).toBe("Quire Sans");
    expect(unbrace("{a}{b}")).toBe("{a}{b}");
  });

  it("keeps \\defaultfontfeatures for every font, a family's command and a font, adding with +", () => {
    const defaults = initialDefaults();
    setDefaults(defaults, false, undefined, "Numbers=OldStyle");
    setDefaults(defaults, true, undefined, "Color=00FF00");
    setDefaults(defaults, true, "\\rmfamily, Quire Sans", "Letters=SmallCaps");
    setDefaults(defaults, false, "\\headingfont,QuireSans-Light.otf", "Numbers=Lining");
    expect(defaults.all).toEqual([
      { key: "Numbers", value: "OldStyle" },
      { key: "Color", value: "00FF00" },
    ]);
    expect(defaults.labels.get("rmfamily")?.map((each) => each.key)).toEqual([
      "Ligatures",
      "Letters",
    ]);
    // A font's name keeps its spaces, as fontspec compares it, and loses its extension.
    expect(defaults.fonts.get("Quire Sans")).toEqual([{ key: "Letters", value: "SmallCaps" }]);
    expect(defaults.fonts.get("QuireSans")).toBeUndefined();
    expect(defaults.fonts.get("QuireSans-Light")).toEqual([{ key: "Numbers", value: "Lining" }]);
    // A command that is not a family command keys the family \newfontfamily defines with it.
    expect(defaults.labels.get("headingfont")).toEqual([{ key: "Numbers", value: "Lining" }]);
    // Without the +, a family's defaults are replaced.
    setDefaults(defaults, false, "\\rmfamily", "Numbers=Lining");
    expect(defaults.labels.get("rmfamily")).toEqual([{ key: "Numbers", value: "Lining" }]);
    expect(fontKey("Quire Sans.otf")).toBe("Quire Sans");
  });

  it("gives a family the defaults of its command's label and of its font's name, as fontspec", () => {
    const defaults = initialDefaults();
    setDefaults(defaults, false, "\\headingfont", "Numbers=OldStyle");
    setDefaults(defaults, false, "Quire Sans", "Letters=SmallCaps");
    const heading = familyFor(
      { name: "QuireSans-Light", options: "Extension=.otf", label: "headingfont" },
      defaults,
      index,
      new Map(),
    );
    expect(shapes(heading)["m/n"]).toBe(`QuireSans-Light.otf ${LATIN};+onum`);
    // A font of the same family under another name, or a family of another label, has none.
    const other = familyFor(
      { name: "QuireSans-Light", options: "Extension=.otf", label: "otherfont" },
      defaults,
      index,
      new Map(),
    );
    expect(shapes(other)["m/n"]).toBe(`QuireSans-Light.otf ${LATIN}`);
    expect(
      shapes(familyFor({ name: "Quire Sans", options: "" }, defaults, index, new Map()))["m/n"],
    ).toBe(`QuireSans-Regular.otf ${LATIN};+smcp`);
  });

  it("reads an xcolor colour as fontspec converts it to HTML", () => {
    expect(htmlColour("HTML", "1f4e79")).toBe("1F4E79");
    expect(htmlColour("RGB", "31, 78, 121")).toBe("1F4E79");
    expect(htmlColour("rgb", "1,0,0.5")).toBe("FF0080");
    expect(htmlColour("gray", "0.5")).toBe("808080");
    expect(htmlColour("cmyk", "0,0,0,1")).toBeUndefined();
    expect(htmlColour("RGB", "256,0,0")).toBeUndefined();
  });
});

describe("FontIndex, as XeTeX's font manager finds a font", () => {
  const found = (name: string, variant?: string) => index.find(name, variant)?.file;

  it("finds a font by its full name, as Family-Style, by its PostScript name, and by its family", () => {
    expect(found("Quire Sans Bold")).toBe("QuireSans-Bold.otf");
    expect(found("Quire Sans-Light Italic")).toBe("QuireSans-LightItalic.otf");
    expect(found("QuireSans-BoldItalic")).toBe("QuireSans-BoldItalic.otf");
    // A family's name gives its regular face, the one its OS/2 table flags so.
    expect(found("Quire Sans")).toBe("QuireSans-Regular.otf");
    expect(found("Quire Serif")).toBeUndefined();
    expect(index.byFile("quiresans-bold")?.file).toBe("QuireSans-Bold.otf");
    expect(index.byFile("fonts/QuireSans-Bold.ttf")?.file).toBe("QuireSans-Bold.otf");
    expect(fileKeyOf("/a/b/QuireSans-Bold.OTF")).toBe("quiresans-bold");
  });

  it("gives /B, /I and /BI as XeTeX does: by weight and half the family's range, and by slant", () => {
    expect(found("Quire Sans", "B")).toBe("QuireSans-Bold.otf");
    expect(found("Quire Sans", "I")).toBe("QuireSans-Italic.otf");
    expect(found("Quire Sans", "BI")).toBe("QuireSans-BoldItalic.otf");
    expect(found("Quire Sans Light", "I")).toBe("QuireSans-LightItalic.otf");
    // 300 and half of 400 and 1 is 501, nearer the regular's 400 than the bold's 700.
    expect(found("Quire Sans Light", "B")).toBe("QuireSans-Regular.otf");
    // A bold face has no bolder one, and a family of one face gives it for every variant.
    expect(found("Quire Sans Bold", "B")).toBe("QuireSans-Bold.otf");
    expect(found("Quire Mono", "BI")).toBe("QuireMono-Regular.otf");
  });
});

describe("familyFor, as fontspec declares a family", () => {
  it("declares the four faces XeTeX finds, the slanted and bold extended shapes, and small capitals", () => {
    const declared = shapes(family("Quire Sans", "", "rm"));
    const regular = `${LATIN};mapping=tex-text`;
    expect(declared).toEqual({
      "m/n": `QuireSans-Regular.otf ${regular}`,
      // A face's small capitals are its file with +smcp, where the file has the feature.
      "m/sc": `QuireSans-Regular.otf ${regular.replace(";mapping", ";+smcp;mapping")}`,
      "b/n": `QuireSans-Bold.otf ${regular}`,
      "bx/n": `QuireSans-Bold.otf ${regular}`,
      "m/it": `QuireSans-Italic.otf ${regular}`,
      "m/scit": `QuireSans-Italic.otf ${regular.replace(";mapping", ";+smcp;mapping")}`,
      "m/sl": `QuireSans-Italic.otf ${regular}`,
      "b/it": `QuireSans-BoldItalic.otf ${regular}`,
      "b/scit": `QuireSans-BoldItalic.otf ${regular.replace(";mapping", ";+smcp;mapping")}`,
      "bx/it": `QuireSans-BoldItalic.otf ${regular}`,
      // fontspec's substitution for bold extended small capitals is the bold face, as it is.
      "bx/scit": `QuireSans-BoldItalic.otf ${regular}`,
      "b/sl": `QuireSans-BoldItalic.otf ${regular}`,
      "bx/sl": `QuireSans-BoldItalic.otf ${regular}`,
    });
    // No Ligatures=TeX for a family of no kind, as \newfontfamily's.
    expect(shapes(family("Quire Sans"))["m/n"]).toBe(`QuireSans-Regular.otf ${LATIN}`);
    // The mono family's spaces, fixed and with no hyphen, as fontspec.cfg sets them.
    const mono = family("Quire Mono", "", "tt");
    if ("unreproducible" in mono) throw new Error("Quire Mono");
    expect(shapes(mono)).toEqual({ "m/n": "QuireMono-Regular.otf script=DFLT;language=dflt" });
    expect(mono.shapes.get("m/n")?.adjust).toEqual({
      wordSpace: [1, 0, 0],
      hyphenChar: -1,
      punctuationSpace: { factor: 0, of: "space" },
    });
  });

  it("sets figures and letters where each face has the feature, each option taking out its rivals", () => {
    const declared = shapes(family("Quire Sans", "Numbers={Proportional,OldStyle},Numbers=Lining"));
    expect(declared["m/n"]).toBe(`QuireSans-Regular.otf ${LATIN};+pnum;+lnum`);
    // The bold has no pnum, which fontspec leaves out.
    expect(declared["b/n"]).toBe(`QuireSans-Bold.otf ${LATIN};+lnum`);
    const caps = shapes(family("Quire Sans", "Letters=SmallCaps,Numbers=Monospaced"));
    expect(caps["m/n"]).toBe(`QuireSans-Regular.otf ${LATIN};+smcp;+tnum`);
    expect(caps["b/n"]).toBe(`QuireSans-Bold.otf ${LATIN};+tnum`);
    // An option's Off and Reset.
    expect(shapes(family("Quire Sans", "Numbers=OldStyle,Numbers=LowercaseOff"))["m/n"]).toBe(
      `QuireSans-Regular.otf ${LATIN};-onum`,
    );
    expect(shapes(family("Quire Sans", "Numbers=OldStyle,Numbers=LowercaseReset"))["m/n"]).toBe(
      `QuireSans-Regular.otf ${LATIN}`,
    );
  });

  it("takes faces by name, * as the font's, and each face's own features after the family's", () => {
    const declared = shapes(
      family(
        "Quire Sans",
        "UprightFont=*-Light,BoldFont=*-Regular,ItalicFont={},BoldFeatures={Color=1F4E79},LetterSpace=2",
      ),
    );
    expect(declared["m/n"]).toBe(`QuireSans-Light.otf ${LATIN};letterspace=2`);
    expect(declared["b/n"]).toBe(`QuireSans-Regular.otf ${LATIN};letterspace=2;color=1F4E79`);
    // ItalicFont={} leaves the italics out.
    expect(declared["m/it"]).toBeUndefined();
    const fake = shapes(family("Quire Mono", "AutoFakeBold=2,FakeStretch=0.9"));
    expect(fake["b/n"]).toBe(
      "QuireMono-Regular.otf script=DFLT;language=dflt;extend=0.9;embolden=2",
    );
  });

  it("takes a font by file with Extension or a file's name, and small capitals from another font", () => {
    const byFile = shapes(
      family(
        "QuireSans-Light",
        "Extension=.otf,BoldFont=QuireSans-Bold,SmallCapsFont=QuireMono-Regular",
      ),
    );
    expect(byFile["m/n"]).toBe(`QuireSans-Light.otf ${LATIN}`);
    expect(byFile["b/n"]).toBe(`QuireSans-Bold.otf ${LATIN}`);
    // No autofonts by file: no italic unless one is named.
    expect(byFile["m/it"]).toBeUndefined();
    expect(byFile["m/sc"]).toBe(`QuireMono-Regular.otf ${LATIN}`);
    expect(shapes(family("QuireSans-Bold.otf"))["m/n"]).toBe(`QuireSans-Bold.otf ${LATIN}`);
  });

  it("scales a family, and adjusts its spaces and hyphen as fontspec does after loading it", () => {
    const spec = family(
      "Quire Sans",
      'Scale=0.9,WordSpace={1.2,0.5,0.3},PunctuationSpace=2,HyphenChar="2010',
    );
    if ("unreproducible" in spec) throw new Error(spec.name);
    expect(spec.shapes.get("m/n")?.scale).toBe(0.9);
    expect(spec.shapes.get("m/n")?.adjust).toEqual({
      wordSpace: [1.2, 0.5, 0.3],
      punctuationSpace: { factor: 2, of: "punctuation" },
      hyphenChar: 0x2010,
    });
    // What the runner counts, the small capitals' smcp among them.
    expect([...spec.kinds].sort()).toEqual(["hyphenchar", "punctuationspace", "smcp", "wordspace"]);
  });

  it("writes a colour unless it is fontspec's default black, whose opacity was never set", () => {
    const colour = (options: string) => shapes(family("Quire Sans", options))["m/n"];
    expect(colour("Color=black")).toBe(`QuireSans-Regular.otf ${LATIN}`);
    expect(colour("Color=000000")).toBe(`QuireSans-Regular.otf ${LATIN}`);
    expect(colour("Color=red,Color=black")).toBe(`QuireSans-Regular.otf ${LATIN}`);
    // An opacity given, a full one too, writes it, as fontspec's comparison has it.
    expect(colour("Color=000000FF")).toBe(`QuireSans-Regular.otf ${LATIN};color=000000FF`);
    expect(colour("Opacity=0.5")).toBe(`QuireSans-Regular.otf ${LATIN};color=0000007F`);
    expect(colour("Color=1f4e79")).toBe(`QuireSans-Regular.otf ${LATIN};color=1F4E79`);
    const black = family("Quire Sans", "Color=black");
    if ("unreproducible" in black) throw new Error(black.name);
    expect(black.kinds.has("color")).toBe(false);
  });

  it("refuses what it cannot reproduce, naming the font as given or the option by its key", () => {
    const refused = (name: string, options = "") => family(name, options);
    expect(refused("Quire Serif")).toEqual({ unreproducible: "font", name: "Quire Serif" });
    expect(refused("\\myfont")).toEqual({ unreproducible: "font", name: "\\myfont" });
    expect(refused("Quire Sans", "BoldFont=Quire Serif Bold")).toEqual({
      unreproducible: "font",
      name: "Quire Serif Bold",
    });
    for (const [options, name] of [
      ["Scale=MatchLowercase", "Scale"],
      ["Numbers=Roman", "Numbers"],
      ["Frobnicate=Yes", "Frobnicate"],
      ["Renderer=AAT", "Renderer"],
      ["Script=Greek", "Script"],
      ["Language=Turkish", "Language"],
      ["Mapping=tex-ansi", "Mapping"],
      ["RawFeature={+smcp=2}", "RawFeature"],
      ["Color=\\accent", "Color"],
      ["WordSpace={1,2}", "WordSpace"],
      ["LetterSpace=\\myspace", "LetterSpace"],
      ["SizeFeatures={{Size=-10}}", "SizeFeatures"],
    ])
      expect(refused("Quire Sans", options), options).toEqual({ unreproducible: "option", name });
    // A raw feature a plain + or - makes is taken as it is.
    expect(shapes(family("Quire Sans", "RawFeature={+zero;-kern}"))["m/n"]).toBe(
      `QuireSans-Regular.otf ${LATIN};+zero;-kern`,
    );
  });
});
