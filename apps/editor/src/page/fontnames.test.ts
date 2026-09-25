import { describe, expect, it } from "vitest";
import { companionName, type FontVariant, variantFontNames } from "./fontnames";

/** The name of `variant` for each size, in a family `name` is of. */
const cuts = (name: string, variant: FontVariant, sizes: number[]) =>
  sizes.map((size) => variantFontNames(name, variant, size));

describe("variantFontNames", () => {
  it("cuts Latin Modern's roman at t1lmr.fd's bounds, each the lowest size of its range", () => {
    // <-5.5> 5, <5.5-6.5> 6, <6.5-7.5> 7, <7.5-8.5> 8, <8.5-9.5> 9, <9.5-11> 10, <11-15> 12, <15-> 17
    expect(
      cuts("ec-lmbxi10", "regular", [4, 5.49, 5.5, 6.49, 6.5, 7.49, 7.5, 8.18, 8.49, 8.5, 9.09]),
    ).toEqual(
      ["5", "5", "6", "6", "7", "7", "8", "8", "8", "9", "9"].map((cut) => [`ec-lmr${cut}`]),
    );
    expect(cuts("ec-lmbxi10", "regular", [9.49, 9.5, 10.95, 11, 14.99, 15, 24.88])).toEqual(
      ["9", "10", "10", "12", "12", "17", "17"].map((cut) => [`ec-lmr${cut}`]),
    );
    // The bold's are the regular's, without 17: <11-> 12.
    expect(cuts("ec-lmr10", "bold", [5.49, 5.5, 7.5, 8.5, 9.5, 11, 24.88])).toEqual(
      ["5", "6", "8", "9", "10", "12", "12"].map((cut) => [`ec-lmbx${cut}`]),
    );
    // The italic's: <-7.5> 7, <7.5-8.5> 8, <8.5-9.5> 9, <9.5-11> 10, <11-> 12.
    expect(cuts("ec-lmr10", "italic", [5, 7.49, 7.5, 8.49, 8.5, 9.49, 9.5, 10.99, 11])).toEqual(
      ["7", "7", "8", "8", "9", "9", "10", "10", "12"].map((cut) => [`ec-lmri${cut}`]),
    );
    // The bold italic has one cut, whatever the size.
    expect(cuts("ec-lmr8", "boldItalic", [5, 8.18, 24.88])).toEqual(
      [1, 2, 3].map(() => ["ec-lmbxi10"]),
    );
  });

  it("cuts Latin Modern's sans at t1lmss.fd's bounds", () => {
    // <-8.5> 8, <8.5-9.5> 9, <9.5-11> 10, <11-15.5> 12, <15.5-> 17, for upright and oblique alike.
    const sizes = [5, 8.49, 8.5, 9.49, 9.5, 10.99, 11, 15.49, 15.5];
    const expected = ["8", "8", "9", "9", "10", "10", "12", "12", "17"];
    expect(cuts("ec-lmssbx10", "regular", sizes)).toEqual(expected.map((c) => [`ec-lmss${c}`]));
    expect(cuts("ec-lmss10", "italic", sizes)).toEqual(expected.map((c) => [`ec-lmsso${c}`]));
    expect(cuts("ec-lmsso9", "bold", [5, 9, 20])).toEqual([1, 2, 3].map(() => ["ec-lmssbx10"]));
    expect(cuts("ec-lmss9", "boldItalic", [9])).toEqual([["ec-lmssbo10"]]);
  });

  it("names Computer Modern's cut for the size ot1cmr.fd lists nearest, the first of two as near", () => {
    expect(cuts("cmbxti10", "regular", [5, 9, 9.5, 10, 10.95, 11.5, 14.4, 17.28, 24.88])).toEqual(
      ["5", "9", "9", "10", "10", "12", "12", "17", "17"].map((cut) => [`cmr${cut}`]),
    );
    expect(cuts("cmr10", "italic", [5, 7, 8, 9, 10.95, 14.4])).toEqual(
      ["7", "7", "8", "9", "10", "12"].map((cut) => [`cmti${cut}`]),
    );
    expect(cuts("cmr10", "bold", [5, 9, 10.95, 12, 24.88])).toEqual(
      ["5", "9", "10", "12", "12"].map((cut) => [`cmbx${cut}`]),
    );
    expect(cuts("cmti9", "boldItalic", [9])).toEqual([["cmbxti10"]]);
  });

  it("names the text font, never a companion, for a variant", () => {
    expect(variantFontNames("ts1-lmbx10", "italic", 10)).toEqual(["ec-lmri10"]);
    expect(variantFontNames("pplb8c", "regular", 10)).toEqual(["pplr8t"]);
  });

  it("names the fontname scheme's variants whatever the size, italic or oblique as the family has them", () => {
    expect(variantFontNames("pplri8t", "regular", 8.18)).toEqual(["pplr8t"]);
    expect(variantFontNames("pplr8t", "bold", 10)).toEqual(["pplb8t"]);
    expect(variantFontNames("pplr8t", "italic", 10)).toEqual(["pplri8t", "pplro8t"]);
    expect(variantFontNames("phvro8t", "boldItalic", 9.09)).toEqual(["phvbo8t", "phvbi8t"]);
    expect(variantFontNames("phvr8tn", "bold", 10)).toEqual(["phvb8tn"]);
  });

  it("names nothing for a name no scheme gives", () => {
    for (const name of ["rm-lmr10", "ec-lmcsc10", "", "cmr", "lmr10"])
      expect(variantFontNames(name, "bold", 10), name).toEqual([]);
  });
});

describe("companionName", () => {
  it("names the TS1 font of a text font's own weight, shape and cut", () => {
    expect(companionName("ec-lmr10")).toBe("ts1-lmr10");
    expect(companionName("ec-lmbx10")).toBe("ts1-lmbx10");
    expect(companionName("ec-lmri8")).toBe("ts1-lmri8");
    expect(companionName("pplb8t")).toBe("pplb8c");
    expect(companionName("phvro8tn")).toBe("phvro8cn");
    for (const name of ["ts1-lmr10", "pplr8c", "cmr10", "ec-lmcsc10"])
      expect(companionName(name), name).toBeUndefined();
  });
});
