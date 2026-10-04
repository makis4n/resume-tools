import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Manifest } from "vite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// The page is built once, with the app's own config, into a folder of its own, with invented values
// in the naming key's variables, as a developer's .env or a deploy's environment would hold them,
// and with Vite's manifest of its chunks, which says what the first load fetches.

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

/** The invented values the build is made with, which nothing of it may hold. */
const VALUES = {
  SOCLAAS_API_KEY: "invented-provider-key-9c2e",
  NAMING_MODEL: "invented-naming-model",
};

/** What pdf.js's code holds however it is minified: its messages' names and its errors'. */
const PDFJS_MARKS = ["GetDocRequest", "PasswordException", "InvalidPDFException"];

describe("the page's build", () => {
  let out = "";

  beforeAll(async () => {
    out = mkdtempSync(join(tmpdir(), "resume-tools-build-"));
    made.push(out);
    const saved = Object.keys(VALUES).map((name) => [name, process.env[name]] as const);
    Object.assign(process.env, VALUES);
    try {
      await build({
        root: APP,
        configFile: join(APP, "vite.config.ts"),
        logLevel: "silent",
        build: { outDir: out, emptyOutDir: true, manifest: true },
      });
    } finally {
      for (const [name, value] of saved)
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
  }, 300_000);

  test("holds neither the naming key's variables nor the functions folder", () => {
    const files = filesUnder(out);
    expect(files.map((file) => relative(out, file))).toContain("index.html");
    for (const file of files) {
      const path = relative(out, file);
      expect(path).not.toMatch(/functions/);
      const text = readFileSync(file, "latin1");
      for (const needle of [
        ...Object.keys(VALUES),
        ...Object.values(VALUES),
        // What the Pages Function alone names: its export, its binding and its address header.
        "onRequestPost",
        "NAMING_KV",
        "CF-Connecting-IP",
      ])
        expect(text.includes(needle), `${needle} in ${path}`).toBe(false);
    }
  });

  test("the main bundle holds no PDF reader, which a chunk and a worker of its own hold", () => {
    const manifest = JSON.parse(
      readFileSync(join(out, ".vite", "manifest.json"), "utf8"),
    ) as Manifest;
    // The main bundle: the page's entry and every chunk it imports statically, what the first
    // load fetches; a dynamic import is fetched only when it runs.
    const main = new Set<string>();
    const visit = (key: string) => {
      const chunk = manifest[key];
      if (chunk === undefined || main.has(chunk.file)) return;
      main.add(chunk.file);
      for (const css of chunk.css ?? []) main.add(css);
      for (const imported of chunk.imports ?? []) visit(imported);
    };
    visit("index.html");
    expect(main.size).toBeGreaterThan(0);
    const holdsPdfJs = (path: string) => {
      const text = readFileSync(join(out, path), "latin1");
      return PDFJS_MARKS.filter((mark) => text.includes(mark));
    };
    for (const file of main) expect(holdsPdfJs(file), `pdf.js in ${file}`).toEqual([]);
    // The reader is a chunk of its own, loaded by a dynamic import, which holds pdf.js...
    const reader = manifest["src/pdf/browser.ts"];
    expect(reader?.isDynamicEntry).toBe(true);
    expect(main.has(reader?.file ?? "")).toBe(false);
    const readerFiles = new Set<string>();
    const gather = (key: string) => {
      const chunk = manifest[key];
      if (chunk === undefined || readerFiles.has(chunk.file)) return;
      readerFiles.add(chunk.file);
      for (const imported of chunk.imports ?? []) gather(imported);
    };
    gather("src/pdf/browser.ts");
    const readerOwn = [...readerFiles].filter((file) => !main.has(file));
    expect(readerOwn.flatMap(holdsPdfJs)).toEqual(expect.arrayContaining(PDFJS_MARKS));
    // ...and pdf.js's worker is a file of its own beside it, the editor's own copy, not a CDN's.
    const workers = filesUnder(out)
      .map((file) => relative(out, file))
      .filter((path) => /pdf\.worker/.test(path) && path.endsWith(".js"));
    expect(workers).toHaveLength(1);
    const [worker = ""] = workers;
    expect(main.has(worker)).toBe(false);
    expect(holdsPdfJs(worker)).toContain("GetDocRequest");
    const readerText = readerOwn.map((file) => readFileSync(join(out, file), "latin1")).join("");
    expect(readerText).toContain(worker.split("/").pop());
    for (const file of [...readerOwn, worker])
      expect(readFileSync(join(out, file), "latin1"), file).not.toMatch(/cdn\.|unpkg|jsdelivr/i);
  });
});
