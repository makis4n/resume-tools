import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const SCRIPT = new URL("./fetch-engine.ts", import.meta.url);
/** The pinned release and layout, so a manifest can match them and be read further. */
const [, RELEASE, LAYOUT] =
  /const RELEASE = "([^"]+)";[\s\S]*const LAYOUT = (\d+);/.exec(readFileSync(SCRIPT, "utf8")) ?? [];

/**
 * Run a copy of the script from a folder of its own, where `.engine/` holds only `manifest`, and
 * with an empty release folder, so a run that goes on to build stops at the first release file.
 */
function run(manifest: string) {
  const dir = mkdtempSync(join(tmpdir(), "fetch-engine-"));
  try {
    for (const folder of ["scripts", ".engine", "release"]) mkdirSync(join(dir, folder));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
    copyFileSync(SCRIPT, join(dir, "scripts/fetch-engine.ts"));
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
