import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { EngineManifest, TreeFont } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable } from "../engine/node";
import { cpuMs } from "../test/timing";
import { familyInTree, fileInTree, fontsOf, readTree } from "./fonts";

// Every font and source here is invented for these tests but the tree's own families, whose names
// the manifest's table records. Nothing is taken from a real resume or template.

/**
 * A record of the manifest's font table for a file, named as its tables would name it: the family
 * and style, the four-style family, the full name and the PostScript name.
 */
const record = (
  family: string,
  style: string,
  names: Partial<
    Pick<TreeFont, "fontFamily" | "fontSubfamily" | "fullName" | "postScriptName">
  > = {},
): TreeFont => ({
  family,
  style,
  fontFamily: names.fontFamily ?? family,
  fontSubfamily: names.fontSubfamily ?? style,
  fullName: names.fullName ?? (style === "Regular" ? family : `${family} ${style}`),
  postScriptName:
    names.postScriptName ?? `${family.replaceAll(" ", "")}-${style.replaceAll(" ", "")}`,
  weight: 400,
  width: 5,
  scripts: ["latn"],
  features: [],
});

/** The tree's own families, as their files' tables name them, each by one file. */
const TABLE: Record<string, TreeFont> = {
  "/texlive/texmf-dist/fonts/opentype/google/roboto/Roboto-Regular.otf": record(
    "Roboto",
    "Regular",
  ),
  "/texlive/texmf-dist/fonts/opentype/google/roboto/Roboto-Bold.otf": record("Roboto", "Bold"),
  "/texlive/texmf-dist/fonts/opentype/google/roboto/Roboto-Light.otf": record("Roboto", "Light", {
    fontFamily: "Roboto Light",
    fontSubfamily: "Regular",
  }),
  "/texlive/texmf-dist/fonts/opentype/google/robotoslab/RobotoSlab-Regular.otf": record(
    "Roboto Slab",
    "Regular",
  ),
  "/texlive/texmf-dist/fonts/truetype/typoland/lato/Lato-Regular.ttf": record("Lato", "Regular"),
  "/texlive/texmf-dist/fonts/opentype/adobe/sourcesanspro/SourceSansPro-Regular.otf": record(
    "Source Sans Pro",
    "Regular",
  ),
  "/texlive/texmf-dist/fonts/opentype/public/fontawesome5/FontAwesome5Free-Solid-900.otf": record(
    "Font Awesome 5 Free",
    "Solid",
    { postScriptName: "FontAwesome5Free-Solid" },
  ),
  "/texlive/texmf-dist/fonts/opentype/public/fontawesome5/FontAwesome5Brands-Regular-400.otf":
    record("Font Awesome 5 Brands", "Regular", { postScriptName: "FontAwesome5Brands-Regular" }),
  "/texlive/texmf-dist/fonts/opentype/public/lm/lmroman10-regular.otf": record(
    "Latin Modern Roman",
    "Regular",
    { fontFamily: "LM Roman 10", fullName: "LMRoman10-Regular" },
  ),
  "/texlive/texmf-dist/fonts/opentype/public/lm/lmroman12-regular.otf": record(
    "Latin Modern Roman",
    "Regular",
    { fontFamily: "LM Roman 12", fullName: "LMRoman12-Regular" },
  ),
  "/texlive/texmf-dist/fonts/opentype/ibm/plex/IBMPlexSans-Text.otf": record(
    "IBM Plex Sans",
    "Text",
    {
      fontFamily: "IBM Plex Sans Text",
      fontSubfamily: "Regular",
    },
  ),
  "/texlive/texmf-dist/fonts/opentype/public/tex-gyre/texgyretermes-regular.otf": record(
    "TeX Gyre Termes",
    "Regular",
  ),
  "/texlive/texmf-dist/fonts/opentype/public/tex-gyre/texgyreheroscn-regular.otf": record(
    "TeX Gyre Heros Cn",
    "Regular",
  ),
};

/** A small tree: a few classes and packages under `tex/`, and Roboto's and Lato's font files. */
const tree = readTree(
  {
    "/texlive/texmf-dist/tex/latex/base/article.cls": 1,
    "/texlive/texmf-dist/tex/latex/geometry/geometry.sty": 1,
    "/texlive/texmf-dist/tex/latex/fontspec/fontspec.sty": 1,
    "/texlive/texmf-dist/tex/latex/hyperref/hyperref.sty": 1,
    "/texlive/texmf-dist/tex/latex/roboto/roboto.sty": 1,
    "/texlive/texmf-dist/tex/latex/roboto/roboto-mono.sty": 1,
    "/texlive/texmf-dist/fonts/opentype/google/roboto/Roboto-Regular.otf": 1,
    "/texlive/texmf-dist/fonts/opentype/google/roboto/Roboto-Bold.otf": 1,
    "/texlive/texmf-dist/tex/latex/lato/lato.sty": 1,
    "/texlive/texmf-dist/fonts/truetype/typoland/lato/Lato-Regular.ttf": 1,
    "/texlive/texmf-dist/tex/latex/amsfonts/amssymb.sty": 1,
    "/texlive/texmf-dist/fonts/type1/public/amsfonts/cm/cmr10.pfb": 1,
    "/texlive/texmf-dist/source/latex/invented/inventeddoc.sty": 1,
    "/texmf/texmf-dist/tex/latex/moderncv/moderncv.cls": 1,
  },
  TABLE,
);

describe("the tree", () => {
  test("indexes classes and packages under tex/, and fonts by name, whatever their extension", () => {
    expect(tree.styles.has("moderncv.cls")).toBe(true);
    expect(tree.styles.has("geometry.sty")).toBe(true);
    expect(tree.styles.has("inventeddoc.sty")).toBe(false);
    expect(fileInTree(tree, "Roboto-Regular")).toBe(true);
    expect(fileInTree(tree, "fonts/roboto-regular.ttf")).toBe(true);
    expect(fileInTree(tree, "Lato-Regular.ttf")).toBe(true);
    expect(fileInTree(tree, "Roboto-Thin")).toBe(false);
    expect(fileInTree(tree, "cmr10")).toBe(false);
  });

  test("takes a package whose folder has a namesake holding OpenType or TrueType files for a font package", () => {
    expect([...tree.fontPackages].sort()).toEqual(["lato", "roboto", "roboto-mono"]);
  });

  /** A tree holding every file of the table. */
  const full = readTree(Object.fromEntries(Object.keys(TABLE).map((path) => [path, 1])), TABLE);

  test("knows the tree's families by name, with style words and design sizes, and no other", () => {
    for (const name of [
      "Roboto",
      "roboto slab",
      "Roboto Light",
      "SourceSansPro-Bold",
      "Source Sans Pro Semibold Italic",
      "Font Awesome 5 Free Solid",
      "FontAwesome5Brands-Regular-400",
      "Latin Modern Roman",
      "LM Roman 12",
      "Lato",
      "IBM Plex Sans Text",
      "texgyretermes",
      "TeX Gyre Heros Cn Bold",
    ])
      expect(familyInTree(full, name), name).toBe(true);
    for (const name of ["Source Sans 3", "Invented Serif", "Robotoish", "Lato Condensed", "Arial"])
      expect(familyInTree(full, name), name).toBe(false);
  });

  test("takes a family for the tree's only when the tree holds a file the table names it for", () => {
    expect(familyInTree(tree, "Roboto Bold")).toBe(true);
    expect(familyInTree(tree, "Source Sans Pro")).toBe(false);
    expect(tree.fonts.map((font) => font.file)).toEqual([
      "Roboto-Bold.otf",
      "Roboto-Regular.otf",
      "Lato-Regular.ttf",
    ]);
  });

  test("reads style words in one pass, however a hostile name runs them together", () => {
    for (const name of ["Roboto Demibold Italic", "RobotoDemiboldDemibold", "Roboto Black 900"])
      expect(familyInTree(full, name), name).toBe(true);
    // A regular expression of the style words tried every way of splitting these before it
    // failed: hours for the digits, days for the `Demibold`s. The last is past the cap.
    for (const name of [
      `Roboto${"1".repeat(40)}x`,
      `Roboto ${"Demibold".repeat(15)}x`,
      `Roboto${"Demibold".repeat(24)}x`,
    ]) {
      let found: boolean | undefined;
      expect(cpuMs(() => (found = familyInTree(full, name)))).toBeLessThan(50);
      expect(found, name).toBe(false);
    }
    expect(familyInTree(full, `Roboto${" ".repeat(130)}`)).toBe(false);
  });
});

describe("fonts fontspec loads", () => {
  test("by name, with the faces named after it", () => {
    expect(
      fontsOf(
        [
          "\\setmainfont{Invented Serif}",
          "\\setsansfont[BoldFont={* Heavy}]{Invented Sans}",
          "\\newfontfamily\\headingfont{Roboto}[Scale=1.1]",
          "\\newfontfamily{\\iconfont}{Invented Icons}",
          "\\setmainfont{\\builtname}",
        ].join("\n"),
      ),
    ).toEqual({
      families: [
        "Invented Serif",
        "Invented Sans",
        "Invented Sans Heavy",
        "Roboto",
        "Invented Icons",
      ],
      files: [],
    });
  });

  test("by file: a name with an extension, Path= or Extension=, each face by its own name", () => {
    expect(
      fontsOf(
        [
          "\\newfontfamily\\headerfont[Path=\\@fontdir, UprightFont=*-Regular, BoldFont=*-Bold]{Roboto}",
          "\\newfontfamily\\FA[Path=fonts/]{InventedAwesome}",
          "\\setmainfont{Invented-Regular.ttf}[BoldFont=Invented-Bold.ttf]",
          "\\setsansfont[Extension=.otf, UprightFont=*-Light, FontFace={sb}{n}{Font=*-Semibold}]{InventedSans}",
        ].join("\n"),
      ),
    ).toEqual({
      families: [],
      files: [
        "Roboto-Regular",
        "Roboto-Bold",
        "InventedAwesome",
        "Invented-Regular.ttf",
        "Invented-Bold.ttf",
        "InventedSans-Light.otf",
        "InventedSans-Semibold.otf",
      ],
    });
  });

  test("drops a face whose name would pass the cap, and reads at most four option groups", () => {
    // Each star is the font's name: 8,000 of them and a name of 8,000 letters made a face of
    // 64,000,000 characters from 16 KB of source. 2,000 of each, which the readers' window of
    // 2,048 characters takes in, make 4,000,000.
    const name = "Invented".repeat(250);
    const hostile = fontsOf(`\\setmainfont[BoldFont=${"*".repeat(2_000)}]{${name}}`);
    expect(hostile).toEqual({ families: [name], files: [] });
    expect(fontsOf("\\setmainfont[BoldFont=** Bold]{Invented}").families).toEqual([
      "Invented",
      "InventedInvented Bold",
    ]);
    expect(fontsOf("\\setmainfont[a=1][b=2][c=3][BoldFont=* Bold]{Invented}").families).toEqual([
      "Invented",
      "Invented Bold",
    ]);
    expect(fontsOf("\\setmainfont[a=1][b=2][c=3][d=4][BoldFont=* Bold]{Invented}")).toEqual({
      families: [],
      files: [],
    });
  });

  test("by file whenever \\defaultfontfeatures gives a path", () => {
    expect(fontsOf("\\defaultfontfeatures{Path=fonts/}\\setmainfont{Invented}")).toEqual({
      families: [],
      files: ["Invented"],
    });
  });
});

// This reads the tree fetch-engine built, and needs `.engine/`.
describe.skipIf(!engineAvailable())("the manifest's font table", () => {
  const manifest = JSON.parse(
    readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
  ) as EngineManifest;
  const real = readTree(manifest.files, manifest.fonts);

  test("records every OpenType and TrueType file of the tree, each with its names", () => {
    const fonts = Object.keys(manifest.files).filter((path) =>
      /\/fonts\/(?:opentype|truetype)\/.*\.(?:otf|ttf)$/i.test(path),
    );
    expect(Object.keys(manifest.fonts ?? {}).sort()).toEqual(fonts.sort());
    for (const font of real.fonts) {
      expect(font.family, font.path).not.toBe("");
      expect(font.fontFamily, font.path).not.toBe("");
      expect(font.fullName, font.path).not.toBe("");
    }
  });

  test("names the families the survey looks for, and a family in every folder of fonts", () => {
    for (const name of [
      "Roboto",
      "Roboto Light",
      "Lato",
      "Source Sans Pro",
      "Font Awesome 5 Free",
      "Font Awesome 5 Brands",
      "FontAwesome",
      "Academicons",
      "Latin Modern Roman",
      "LM Roman 12",
      "Latin Modern Math",
      "IBM Plex Sans",
      "TeX Gyre Termes",
    ])
      expect(familyInTree(real, name), name).toBe(true);
    const folderOf = (path: string) => path.split("/").at(-2) ?? "";
    const folders = new Set(real.fonts.map((font) => folderOf(font.path)));
    const named = new Set(
      real.fonts
        .filter((font) => familyInTree(real, font.family))
        .map((font) => folderOf(font.path)),
    );
    expect([...folders].filter((folder) => !named.has(folder))).toEqual([]);
    for (const name of ["roboto", "lato", "sourcesanspro", "fontawesome5", "lmodern"])
      expect(real.fontPackages, name).toContain(name);
  });
});
