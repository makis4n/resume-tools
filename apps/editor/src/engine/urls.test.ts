import { describe, expect, it } from "vitest";
import { engineTag, engineUrl, fileUrl, manifestUrl } from "./urls";

const TAG = engineTag({ release: "build_wasm_0123abcd_1", layout: 2 });

describe("the engine's URLs", () => {
  it("keeps the manifest untagged, since it is what names the tag", () => {
    expect(manifestUrl()).toBe("/engine/manifest.json");
  });

  it("tags a tree with its release and layout", () => {
    expect(TAG).toBe("build_wasm_0123abcd_1-2");
  });

  it("puts the engine's own files under the tag", () => {
    expect(engineUrl(TAG, "busytex.wasm")).toBe("/engine/build_wasm_0123abcd_1-2/busytex.wasm");
  });

  it("puts TeX Live files under the tag at their path, each segment encoded", () => {
    expect(fileUrl(TAG, "/texlive/texmf-dist/tex/latex/base/article.cls")).toBe(
      "/engine/build_wasm_0123abcd_1-2/files/texlive/texmf-dist/tex/latex/base/article.cls",
    );
    expect(fileUrl(TAG, "/texmf/a b/c#d?.sty")).toBe(
      "/engine/build_wasm_0123abcd_1-2/files/texmf/a%20b/c%23d%3F.sty",
    );
  });

  it("encodes a tag that would read as a path", () => {
    expect(engineUrl("a/b", "busytex.mjs")).toBe("/engine/a%2Fb/busytex.mjs");
  });
});
