import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { EngineManifest } from "../src/engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../src/engine/node";
import { drawPage } from "../src/page/draw";
import { FontLibrary } from "../src/page/fonts";
import { TexLiveIndex } from "../src/page/texlive";
import { generateBody, generateFormat } from "../src/templates/generate";
import { INVENTED_XETEX } from "../src/templates/invented";
import { defaultControls } from "../src/templates/package";
import { parseDvi } from "../src/tex/dvi";
import { withoutFontFolders } from "./fontconfig";

const SCRIPT = new URL("./fetch-engine.ts", import.meta.url);
/** The pinned release and layout, so a manifest can match them and be read further. */
const [, RELEASE, LAYOUT] =
  /const RELEASE = "([^"]+)";[\s\S]*const LAYOUT = (\d+);/.exec(readFileSync(SCRIPT, "utf8")) ?? [];

/** The script and the modules it imports, by their paths from the editor's folder. */
const SOURCES = [
  "scripts/fetch-engine.ts",
  "scripts/containers.ts",
  "scripts/fontconfig.ts",
  "scripts/fontmaps.ts",
  "scripts/tlpdb.ts",
  "src/page/fontmap.ts",
];

/**
 * Run a copy of the script from a folder of its own, where `.engine/` holds only `manifest`, and
 * with an empty release folder, so a run that goes on to build stops at the first release file.
 */
function run(manifest: string) {
  const dir = mkdtempSync(join(tmpdir(), "fetch-engine-"));
  try {
    for (const folder of ["scripts", "src/page", ".engine", "release"])
      mkdirSync(join(dir, folder), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
    for (const source of SOURCES)
      copyFileSync(new URL(`../${source}`, import.meta.url), join(dir, source));
    writeFileSync(join(dir, ".engine/manifest.json"), manifest);
    return spawnSync(
      process.execPath,
      [join(dir, "scripts/fetch-engine.ts"), "--from", join(dir, "release")],
      { encoding: "utf8" },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("fetch-engine", () => {
  // A run stopped while it wrote the manifest, or one written by some other means, must not stop
  // every later run: the build it describes cannot be trusted, so it is built again.
  test.each([
    ["cut short", `{"release":"${RELEASE}","layout":${LAYOUT},"bund`],
    ["that is not an object", "null"],
    ["without its bundles", JSON.stringify({ release: RELEASE, layout: Number(LAYOUT) })],
  ])("builds again over a manifest %s", (_, manifest) => {
    const { status, stdout, stderr } = run(manifest);
    expect(stdout).toContain("Copying the release from");
    expect(stderr).toContain("busytex.js");
    expect(status).toBe(1);
  });
});

// These run the real engine on the tree the script built, and need `.engine/`.
describe.skipIf(!engineAvailable())("the tree fetch-engine builds", () => {
  // tcolorbox's skins library, which Awesome-CV's class and AltaCV's load, loads tikzfill.image,
  // which the bundles lack and `WANTED` names for it.
  test("loads tcolorbox's skins library", async () => {
    const session = await startNodeSession();
    const result = session.compile(
      "pdftex",
      "stock",
      String.raw`\documentclass{article}\usepackage[skins]{tcolorbox}\begin{document}\tcbox[enhanced]{Quilt}\end{document}`,
      { job: "skins" },
    );
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.pages).toBe(1);
  }, 60_000);

  // fontconfig scans whatever folders its configuration lists, on every XeTeX run, and nothing
  // needs it to: every font a XeTeX template sets is declared by file (decision 0014).
  test("gives fontconfig no font folder to scan", () => {
    const conf = readFileSync(join(ENGINE_DIR, "files/etc/fonts/fonts.conf"), "utf8");
    expect(conf).toMatch(/<fontconfig>/);
    expect(conf).not.toMatch(/<dir\b/);
    expect(withoutFontFolders(conf)).toBe(conf);
  });

  test("finds every font file the templates declare, by file, with no folder to scan", async () => {
    const session = await startNodeSession();
    const files = [
      "Roboto-Regular.otf",
      "Lato-Regular.ttf",
      "SourceSansPro-Regular.otf",
      "FontAwesome5Free-Solid-900.otf",
    ];
    const body = [
      String.raw`\documentclass{article}\pagestyle{empty}\begin{document}`,
      ...files.map((file, i) => `\\font\\f${"abcd"[i]}="[${file}]" {\\f${"abcd"[i]} Quilt}\\par`),
      String.raw`\end{document}`,
    ].join("\n");
    const result = session.compile("xetex", "stock", body, { job: "byfile", maxPasses: 1 });
    expect(result.error).toBeUndefined();
    const doc = parseDvi(result.output ?? new Uint8Array(), () => undefined);
    const loaded = [...doc.nativeFonts.values()].map((font) => font.name.split("/").pop());
    expect(new Set(loaded)).toEqual(new Set(files));
  }, 60_000);

  // The worker reads each file with a synchronous request of its own, within the compile's time
  // limit, so a first compile that read the tree's 565 fonts could cost the page.
  test("reads a handful of files on a XeTeX template's first compile, for the same page", async () => {
    const session = await startNodeSession();
    const { package: pkg, sample } = INVENTED_XETEX;
    const values = defaultControls(pkg);
    const format = generateFormat(pkg, values);
    const dumped = session.dump("xetex", format.name, format.preamble, format.files);
    expect(dumped.error).toBeUndefined();
    const body = generateBody(pkg, sample, values);
    const first = session.compile("xetex", format.name, body.latex, { job: "firstread" });
    expect(first.error).toBeUndefined();
    console.log(
      `invented XeTeX template's first compile: ${first.fetched.files} files, ${(first.fetched.bytes / 1e6).toFixed(2)} MB, passes ${first.passes.map((ms) => ms.toFixed(0)).join(" + ")} ms`,
    );
    expect(first.fetched.files).toBeLessThan(20);
    // The declared fonts are among them, read by file.
    const read = first.fetched.paths.map((path) => path.split("/").pop());
    for (const file of ["Roboto-Regular.otf", "SourceSansPro-Bold.otf"])
      expect(read).toContain(file);
    // And the page is the one the template sets: every field, every font drawn, every glyph read.
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    const fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    const page = await drawPage(first.output ?? new Uint8Array(), fonts, body.texts);
    expect(page.missingFonts).toEqual(new Map());
    expect(page.fields.size).toBe(body.texts.size);
    expect(page.unmatched).toBe(0);
  }, 60_000);
});
