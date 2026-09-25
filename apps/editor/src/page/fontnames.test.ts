import { describe, expect, it } from "vitest";
import { companionName, variantFontNames } from "./fontnames";

describe("variantFontNames", () => {
  it("names Latin Modern's variants at the design size, and at 10 where a variant has only that", () => {
    expect(variantFontNames("ec-lmri10", "regular")).toEqual(["ec-lmr10"]);
    expect(variantFontNames("ec-lmr10", "bold")).toEqual(["ec-lmbx10"]);
    expect(variantFontNames("ec-lmbxi10", "bold")).toEqual(["ec-lmbx10"]);
    expect(variantFontNames("ec-lmr8", "italic")).toEqual(["ec-lmri8", "ec-lmri10"]);
    expect(variantFontNames("ec-lmr8", "boldItalic")).toEqual(["ec-lmbxi8", "ec-lmbxi10"]);
    expect(variantFontNames("ec-lmsso12", "bold")).toEqual(["ec-lmssbx12", "ec-lmssbx10"]);
    expect(variantFontNames("ts1-lmr10", "italic")).toEqual(["ts1-lmri10"]);
  });

  it("names the fontname scheme's variants, italic or oblique as the family has them", () => {
    expect(variantFontNames("pplri8t", "regular")).toEqual(["pplr8t"]);
    expect(variantFontNames("pplr8t", "bold")).toEqual(["pplb8t"]);
    expect(variantFontNames("pplr8t", "italic")).toEqual(["pplri8t", "pplro8t"]);
    expect(variantFontNames("phvro8t", "boldItalic")).toEqual(["phvbo8t", "phvbi8t"]);
    expect(variantFontNames("phvr8tn", "bold")).toEqual(["phvb8tn"]);
  });

  it("names Computer Modern's, and nothing for a name no scheme gives", () => {
    expect(variantFontNames("cmti10", "regular")).toEqual(["cmr10"]);
    expect(variantFontNames("cmr12", "boldItalic")).toEqual(["cmbxti12", "cmbxti10"]);
    for (const name of ["rm-lmr10", "ec-lmcsc10", "pagk8t", "", "cmr"])
      expect(variantFontNames(name, "bold"), name).toEqual(name === "pagk8t" ? ["pagb8t"] : []);
  });
});

describe("companionName", () => {
  it("names the TS1 font of a text font's own weight and shape", () => {
    expect(companionName("ec-lmr10")).toBe("ts1-lmr10");
    expect(companionName("ec-lmbx10")).toBe("ts1-lmbx10");
    expect(companionName("ec-lmri8")).toBe("ts1-lmri8");
    expect(companionName("pplb8t")).toBe("pplb8c");
    expect(companionName("phvro8tn")).toBe("phvro8cn");
    for (const name of ["ts1-lmr10", "pplr8c", "cmr10", "ec-lmcsc10"])
      expect(companionName(name), name).toBeUndefined();
  });
});
