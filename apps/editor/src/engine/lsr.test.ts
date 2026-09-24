import { describe, expect, it } from "vitest";
import { filenameDatabase } from "./lsr";

describe("filenameDatabase", () => {
  it("lists every folder under the root with what it holds", () => {
    const db = filenameDatabase(
      [
        "/t/tex/latex/base/article.cls",
        "/t/tex/latex/base/size10.clo",
        "/t/tex/generic/hyph.tex",
        "/t/README",
        "/other/x.sty",
      ],
      "/t",
    );
    expect(db).toBe(
      [
        "% ls-R -- filename database for kpathsea; do not change this line.",
        "",
        ".:",
        "README",
        "tex",
        "",
        "./tex:",
        "generic",
        "latex",
        "",
        "./tex/generic:",
        "hyph.tex",
        "",
        "./tex/latex:",
        "base",
        "",
        "./tex/latex/base:",
        "article.cls",
        "size10.clo",
        "",
      ].join("\n"),
    );
  });

  it("is empty but valid for a root with nothing under it", () => {
    expect(filenameDatabase(["/a/b"], "/c")).toBe(
      "% ls-R -- filename database for kpathsea; do not change this line.\n",
    );
  });
});
