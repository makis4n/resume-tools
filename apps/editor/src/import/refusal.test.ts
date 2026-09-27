import { describe, expect, it } from "vitest";
import { plainFontName, refusal, unreproduced } from "./refusal";

// Every name here is invented for these tests.

describe("plainFontName", () => {
  it("shows a font by the name the document gave, an escaped character's backslash taken off", () => {
    expect(plainFontName("Invented Sans")).toBe("Invented Sans");
    expect(plainFontName("Invented\\ Sans")).toBe("Invented Sans");
    expect(plainFontName("Invented \\& Co")).toBe("Invented & Co");
    expect(plainFontName("fonts/Invented-Regular.otf")).toBe("fonts/Invented-Regular.otf");
  });

  it("shows none for a name only TeX could read", () => {
    for (const name of ["\\headfont", "Invented\\space Sans", "#1", "{Invented}", "", "  "])
      expect(plainFontName(name), name).toBeUndefined();
  });
});

describe("the rewrite's refusals", () => {
  it("names a font plainly, or as one a command sets", () => {
    expect(refusal("font", "Invented\\ Sans").message).toBe(
      "This resume needs the font Invented Sans, which this editor does not have.",
    );
    const byCommand = refusal("font", "\\headfont");
    expect(byCommand.message).toBe(
      "This resume needs a font set by a command, which this editor cannot reproduce.",
    );
    // The name as the document gave it stays for developers.
    expect(byCommand.name).toBe("\\headfont");
  });

  it("names an option by its key, a command without its backslash, and a package", () => {
    expect(unreproduced({ option: "Scale" })).toEqual({
      refused: true,
      reason: "feature",
      message:
        "This resume sets its fonts with the font option Scale, which this editor cannot reproduce.",
      name: "Scale",
    });
    expect(refusal("feature", "Numbers").message).toBe(
      "This resume sets its fonts with the font option Numbers, which this editor cannot reproduce.",
    );
    expect(unreproduced({ option: "\\inventedoptions" }).message).toBe(
      "This resume sets its fonts with options a command gives, which this editor cannot reproduce.",
    );
    const command = unreproduced({ command: "\\addfontfeatures" }, "an invented log");
    expect([command.message, command.name, command.log]).toEqual([
      "This resume sets its fonts with the font command addfontfeatures, which this editor cannot reproduce.",
      "\\addfontfeatures",
      "an invented log",
    ]);
    expect(unreproduced({ package: "polyglossia" }).message).toBe(
      "This resume sets its fonts with the package polyglossia, which this editor cannot reproduce.",
    );
    for (const document of ["begin", "class"] as const)
      expect(unreproduced({ document }).message).not.toMatch(/[\\{}]/);
  });
});
