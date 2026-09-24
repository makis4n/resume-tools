import { describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { TexLiveIndex } from "./texlive";

// The manifest lists files in path order, which is not the order the engine searches the trees.
const index = new TexLiveIndex({
  release: "test",
  layout: 1,
  bundles: [],
  files: Object.fromEntries(
    [
      "/other/fonts/tfm/stray.tfm",
      "/texlive/texmf-dist/fonts/map/dvips/lm/lm.map",
      "/texlive/texmf-dist/fonts/map/pdftex/pdftex.map",
      "/texlive/texmf-dist/fonts/tfm/public/cm/cmr10.tfm",
      "/texlive/texmf-dist/fonts/type1/public/amsfonts/cm/cmr10.pfb",
      "/texlive/texmf-dist/tex/latex/base/size10.tfm",
      "/texlive/texmf-dist/texmf-var/fonts/map/pdftex/updmap/pdftex.map",
      "/texmf/texmf-dist/fonts/map/dvips/tex-gyre/qbk.map",
      "/texmf/texmf-dist/fonts/tfm/public/cm/cmr10.tfm",
      "/texmf/texmf-dist/fonts/tfm/public/lm/lmr10.tfm",
    ].map((path) => [path, 1]),
  ),
} satisfies EngineManifest);

describe("TexLiveIndex", () => {
  it("takes a file from the first tree that has it, in the engine's order", () => {
    expect(index.find("tfm", "cmr10.tfm")).toBe(
      "/texlive/texmf-dist/fonts/tfm/public/cm/cmr10.tfm",
    );
    expect(index.find("map", "pdftex.map")).toBe(
      "/texlive/texmf-dist/texmf-var/fonts/map/pdftex/updmap/pdftex.map",
    );
    expect(index.find("tfm", "lmr10.tfm")).toBe("/texmf/texmf-dist/fonts/tfm/public/lm/lmr10.tfm");
  });

  it("looks only in the folder the kind of file belongs in, and only in the trees", () => {
    expect(index.find("type1", "cmr10.tfm")).toBeUndefined();
    expect(index.find("tfm", "size10.tfm")).toBeUndefined();
    expect(index.find("tfm", "stray.tfm")).toBeUndefined();
    expect(index.find("tfm", "nosuch.tfm")).toBeUndefined();
    expect(index.find("type1", "cmr10.pfb")).toBe(
      "/texlive/texmf-dist/fonts/type1/public/amsfonts/cm/cmr10.pfb",
    );
  });

  it("lists every file of a kind with a suffix, from every tree", () => {
    expect(index.all("map", ".map")).toEqual([
      "/texlive/texmf-dist/fonts/map/dvips/lm/lm.map",
      "/texlive/texmf-dist/fonts/map/pdftex/pdftex.map",
      "/texlive/texmf-dist/texmf-var/fonts/map/pdftex/updmap/pdftex.map",
      "/texmf/texmf-dist/fonts/map/dvips/tex-gyre/qbk.map",
    ]);
    expect(index.all("tfm", ".pfb")).toEqual([]);
  });
});
