import { describe, expect, it } from "vitest";
import { hideFontFolders, packageFontFolders } from "./fontconfig";

/** The release's `fonts.conf`, as the tree holds it. */
const RELEASE = [
  '<?xml version="1.0"?>',
  '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
  "<fontconfig>",
  "<dir>/texlive/texmf-dist/fonts/opentype</dir>",
  "<dir>/texlive/texmf-dist/fonts/type1</dir>",
  "</fontconfig>",
  "",
].join("\n");

/** Some of the bundles' files, under the folders fontconfig scans and elsewhere. */
const BUNDLED = [
  "/texlive/texmf-dist/fonts/opentype/public/lm/lmroman10-regular.otf",
  "/texlive/texmf-dist/fonts/type1/public/amsfonts/cm/cmr10.pfb",
  "/texlive/texmf-dist/fonts/type1/urw/symbol/usyr.pfb",
  "/texmf/texmf-dist/fonts/type1/public/marvosym/marvosym.pfb",
];

/** What invented packages add, laid out as Roboto, Lato and Font Awesome lay theirs out. */
const ADDED = new Map([
  [
    "quiltmark",
    [
      "/texlive/texmf-dist/fonts/map/dvips/quiltmark/quiltmark.map",
      "/texlive/texmf-dist/fonts/opentype/invented/quiltmark/Quilt-Bold.otf",
      "/texlive/texmf-dist/fonts/opentype/invented/quiltmark/Quilt-Regular.otf",
      "/texlive/texmf-dist/fonts/tfm/invented/quiltmark/quilt-t1.tfm",
      "/texlive/texmf-dist/fonts/type1/invented/quiltmark/quilt.pfb",
      "/texlive/texmf-dist/tex/latex/quiltmark/quiltmark.sty",
    ],
  ],
  [
    "stitchsym",
    [
      "/texlive/texmf-dist/fonts/truetype/public/stitchsym/stitchsym.ttf",
      "/texlive/texmf-dist/fonts/type1/public/stitchsym/stitchsym.pfb",
    ],
  ],
  ["stitchkeys", ["/texlive/texmf-dist/tex/latex/stitchkeys/stitchkeys.sty"]],
]);

/**
 * Whether a text is well-formed XML, as far as a conf goes: a declaration and a doctype, then one
 * element, whose elements close in the order they open, around text with no markup characters of
 * its own, and comments.
 */
function wellFormed(xml: string): boolean {
  const open: string[] = [];
  let roots = 0;
  const body = xml
    .replace(/^<\?xml [^?]*\?>/, "")
    .replace(/<!DOCTYPE [^>]*>/, "")
    .replace(/<!--(?:(?!--)[\s\S])*-->/g, "");
  for (const token of body.split(/(<[^<>]*>)/)) {
    const tag = /^<(\/?)([A-Za-z][\w.-]*)(?:\s[^<>]*?)?(\/?)>$/.exec(token);
    if (!tag) {
      if (/[<>]|&(?!(?:amp|lt|gt|quot|apos);)/.test(token)) return false;
      if (open.length === 0 && token.trim() !== "") return false;
      continue;
    }
    const [, closing, name, empty] = tag;
    if (closing) {
      if (open.pop() !== name) return false;
    } else {
      if (open.length === 0) roots++;
      if (!empty) open.push(name as string);
    }
  }
  return open.length === 0 && roots === 1;
}

describe("packageFontFolders", () => {
  it("lists each folder the packages put outline files in, once, in path order", () => {
    expect(packageFontFolders(ADDED, BUNDLED)).toEqual([
      "/texlive/texmf-dist/fonts/opentype/invented/quiltmark",
      "/texlive/texmf-dist/fonts/truetype/public/stitchsym",
      "/texlive/texmf-dist/fonts/type1/invented/quiltmark",
      "/texlive/texmf-dist/fonts/type1/public/stitchsym",
    ]);
  });

  it("lists nothing for packages that add no outline files", () => {
    expect(
      packageFontFolders(new Map([["stitchkeys", ADDED.get("stitchkeys") ?? []]]), BUNDLED),
    ).toEqual([]);
  });

  it("refuses a package whose fonts would land in a folder the bundles hold files in", () => {
    const into = (path: string) => packageFontFolders(new Map([["quiltmark", [path]]]), BUNDLED);
    expect(() => into("/texlive/texmf-dist/fonts/type1/public/amsfonts/cm/quilt.pfb")).toThrow(
      "quiltmark puts fonts in /texlive/texmf-dist/fonts/type1/public/amsfonts/cm, where the bundles hold /texlive/texmf-dist/fonts/type1/public/amsfonts/cm/cmr10.pfb; hiding the folder from fontconfig would hide the bundles' fonts too",
    );
    // Or under it: the folder's glob would keep fontconfig out of every folder below it.
    expect(() => into("/texlive/texmf-dist/fonts/type1/public/quilt.pfb")).toThrow(
      "quiltmark puts fonts in /texlive/texmf-dist/fonts/type1/public, where the bundles hold /texlive/texmf-dist/fonts/type1/public/amsfonts/cm/cmr10.pfb",
    );
    // A folder beside the bundles' ones, or one whose name only the other tree has, is the
    // package's own.
    expect(into("/texlive/texmf-dist/fonts/type1/public/amsfontsextra/quilt.pfb")).toEqual([
      "/texlive/texmf-dist/fonts/type1/public/amsfontsextra",
    ]);
    expect(into("/texlive/texmf-dist/fonts/type1/public/marvosym/marvosym.pfb")).toEqual([
      "/texlive/texmf-dist/fonts/type1/public/marvosym",
    ]);
  });
});

describe("hideFontFolders", () => {
  it("adds a glob naming each folder itself, and keeps the release's conf as it was", () => {
    const conf = hideFontFolders(RELEASE, packageFontFolders(ADDED, BUNDLED));
    expect(conf).toBe(
      [
        '<?xml version="1.0"?>',
        '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
        "<fontconfig>",
        "<dir>/texlive/texmf-dist/fonts/opentype</dir>",
        "<dir>/texlive/texmf-dist/fonts/type1</dir>",
        "<!-- The folders of the fonts added from TeX Live's archive, which XeTeX takes by file -->",
        "<selectfont>",
        "<rejectfont>",
        "<glob>/texlive/texmf-dist/fonts/opentype/invented/quiltmark</glob>",
        "<glob>/texlive/texmf-dist/fonts/truetype/public/stitchsym</glob>",
        "<glob>/texlive/texmf-dist/fonts/type1/invented/quiltmark</glob>",
        "<glob>/texlive/texmf-dist/fonts/type1/public/stitchsym</glob>",
        "</rejectfont>",
        "</selectfont>",
        "</fontconfig>",
        "",
      ].join("\n"),
    );
    expect(wellFormed(conf)).toBe(true);
  });

  it("writes well-formed XML whatever the folders are called", () => {
    const conf = hideFontFolders(RELEASE, ["/texlive/texmf-dist/fonts/type1/r&d/<quilt>"]);
    expect(conf).toContain("<glob>/texlive/texmf-dist/fonts/type1/r&amp;d/&lt;quilt&gt;</glob>");
    expect(wellFormed(conf)).toBe(true);
    // The check itself catches what it is there to catch.
    expect(wellFormed(conf.replace("&amp;", "&"))).toBe(false);
    expect(
      wellFormed(conf.replace("</rejectfont>\n</selectfont>", "</selectfont>\n</rejectfont>")),
    ).toBe(false);
  });

  it("leaves the conf as it is when there is nothing to hide", () => {
    expect(hideFontFolders(RELEASE, [])).toBe(RELEASE);
  });

  it("refuses a conf it cannot add to", () => {
    expect(() => hideFontFolders("<fontconfig/>", ["/texlive/texmf-dist/fonts/type1/q"])).toThrow(
      "fonts.conf has no </fontconfig>",
    );
  });
});
