import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, describe, expect, test } from "vitest";

// The page is built with the app's own config into a folder of its own, with invented values in
// the naming key's variables, as a developer's .env or a deploy's environment would hold them.

const APP = fileURLToPath(new URL("..", import.meta.url));
const made: string[] = [];

afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Every file under a folder, by its path. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe("the page's build", () => {
  test("holds neither the naming key's variables nor the functions folder", async () => {
    const out = mkdtempSync(join(tmpdir(), "resume-tools-build-"));
    made.push(out);
    const values = {
      SOCLAAS_API_KEY: "invented-provider-key-9c2e",
      NAMING_MODEL: "invented-naming-model",
    };
    const saved = Object.keys(values).map((name) => [name, process.env[name]] as const);
    Object.assign(process.env, values);
    try {
      await build({
        root: APP,
        configFile: join(APP, "vite.config.ts"),
        logLevel: "silent",
        build: { outDir: out, emptyOutDir: true },
      });
    } finally {
      for (const [name, value] of saved)
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    const files = filesUnder(out);
    expect(files.map((file) => relative(out, file))).toContain("index.html");
    for (const file of files) {
      const path = relative(out, file);
      expect(path).not.toMatch(/functions/);
      const text = readFileSync(file, "latin1");
      for (const needle of [
        ...Object.keys(values),
        ...Object.values(values),
        // What the Pages Function alone names: its export, its binding and its address header.
        "onRequestPost",
        "NAMING_KV",
        "CF-Connecting-IP",
      ])
        expect(text.includes(needle), `${needle} in ${path}`).toBe(false);
    }
  });
});
