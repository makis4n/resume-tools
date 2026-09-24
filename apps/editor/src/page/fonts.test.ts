import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable } from "../engine/node";
import { FontLibrary } from "./fonts";
import { TexLiveIndex } from "./texlive";

// Needs `.engine/` (pnpm --filter @resume-tools/editor fetch-engine).
describe.skipIf(!engineAvailable())("FontLibrary", () => {
  const index = () =>
    new TexLiveIndex(
      JSON.parse(readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8")) as EngineManifest,
    );
  /** Reads from the engine tree, except that it fails once for a path ending in `failing`. */
  const flaky = (failing: string) => {
    let failed = false;
    return async (path: string) => {
      if (path.endsWith(failing) && !failed) {
        failed = true;
        throw new Error(`dropped ${failing}`);
      }
      return readFileSync(join(ENGINE_DIR, "files", path));
    };
  };

  it("loads Computer Modern with its metrics and outlines", async () => {
    const font = await new FontLibrary(index(), flaky("never")).load("cmr10");
    expect(font?.tfm.designSize).toBe(10);
    expect(font?.outlines?.glyphs.A).toBeDefined();
  });

  it("reads the font map again after a failed read", async () => {
    const fonts = new FontLibrary(index(), flaky("pdftex.map"));
    await expect(fonts.load("cmr10")).rejects.toThrow("dropped pdftex.map");
    expect((await fonts.load("cmr10"))?.outlines).toBeDefined();
  });

  it("reads a font again after a failed read", async () => {
    const fonts = new FontLibrary(index(), flaky("cmbx12.tfm"));
    await expect(fonts.load("cmbx12")).rejects.toThrow("dropped cmbx12.tfm");
    expect((await fonts.load("cmbx12"))?.outlines).toBeDefined();
  });
});
