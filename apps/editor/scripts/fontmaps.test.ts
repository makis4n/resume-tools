import { describe, expect, it } from "vitest";
import { parseFontMaps } from "../src/page/fontmap";
import { mergeFontMaps } from "./fontmaps";

const BASE = [
  "% pdftex.map, as updmap wrote it",
  "cmr10 CMR10 <cmr10.pfb",
  'ptmr8r NimbusRomNo9L-Regu " TeXBase1Encoding ReEncodeFont " <8r.enc <utmr8a.pfb',
].join("\n");

/** The outline files the tree holds, as the fetch script finds them under `fonts/type1/`. */
const inTree = (file: string) =>
  ["cmr10.pfb", "utmr8a.pfb", "marvosym.pfb", "feymr10.pfb"].includes(file);

describe("mergeFontMaps", () => {
  it("appends the entries a map adds, as their lines are, under a comment naming the map", () => {
    const merged = mergeFontMaps(
      BASE,
      [
        {
          path: "/texmf/texmf-dist/fonts/map/dvips/marvosym/marvosym.map",
          text: "umvs MarVoSym <marvosym.pfb\n",
        },
      ],
      inTree,
    );
    expect(merged).toBe(`${BASE}\n% marvosym.map\numvs MarVoSym <marvosym.pfb\n`);
  });

  it("leaves out an entry for a font the map already has, or an earlier map added", () => {
    const merged = mergeFontMaps(
      BASE,
      [
        { path: "a/eurosym.map", text: "feymr10 TeX-feymr10 <feymr10.pfb\ncmr10 Other <cmr10.pfb" },
        { path: "b/again.map", text: "feymr10 Again <feymr10.pfb" },
      ],
      inTree,
    );
    expect(merged).toBe(`${BASE}\n% eurosym.map\nfeymr10 TeX-feymr10 <feymr10.pfb\n`);
  });

  it("leaves out an entry whose outline file the tree lacks, or that names none", () => {
    const merged = mergeFontMaps(
      BASE,
      [
        {
          path: "txr1.map",
          text: [
            'rtxptmr Times-Roman "TeXBase1Encoding ReEncodeFont" <tx8r.enc',
            'rtxptmri Times-Italic "TeXBase1Encoding ReEncodeFont" <tx8r.enc <tii_____.pfb',
          ].join("\n"),
        },
      ],
      inTree,
    );
    expect(merged).toBe(`${BASE}\n`);
  });

  it("skips comments, and ends with a newline", () => {
    const merged = mergeFontMaps(
      `${BASE}\n`,
      [
        {
          path: "eurosym.map",
          text: [
            "%",
            "% fonts not hinted:",
            "%feymr10 TeX-feymr10 <geymr10.pfb",
            "\r",
            "feymr10 TeX-feymr10 <feymr10.pfb\r",
            "",
          ].join("\n"),
        },
      ],
      inTree,
    );
    expect(merged).toBe(`${BASE}\n% eurosym.map\nfeymr10 TeX-feymr10 <feymr10.pfb\n`);
    expect(mergeFontMaps("", [], inTree)).toBe("\n");
  });

  it("writes a map parseFontMaps reads, with every entry the merge kept", () => {
    const merged = mergeFontMaps(
      BASE,
      [{ path: "marvosym.map", text: "umvs MarVoSym <marvosym.pfb" }],
      inTree,
    );
    const table = parseFontMaps(merged);
    expect([...table.keys()]).toEqual(["cmr10", "ptmr8r", "umvs"]);
    expect(table.get("ptmr8r")).toMatchObject({ encodingFile: "8r.enc", fontFile: "utmr8a.pfb" });
    expect(table.get("umvs")).toEqual({
      tfm: "umvs",
      psName: "MarVoSym",
      fontFile: "marvosym.pfb",
    });
  });
});
