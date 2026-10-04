import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
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
    // What the first load fetches: the page's entry and every chunk it imports statically, and
    // every worker one of those starts, the compile worker among them, with what each of those
    // imports statically. A dynamic import is fetched only when it runs.
    const firstLoad = new Set<string>();
    const visit = (key: string) => {
      const chunk = manifest[key];
      if (chunk === undefined || firstLoad.has(chunk.file)) return;
      firstLoad.add(chunk.file);
      for (const css of chunk.css ?? []) firstLoad.add(css);
      for (const imported of chunk.imports ?? []) visit(imported);
    };
    visit("index.html");
    const entry = new Set(firstLoad);
    for (const file of [...firstLoad])
      for (const named of startsOrImports(out, file)) {
        if (firstLoad.has(named)) continue;
        firstLoad.add(named);
        for (const more of closure(out, named)) firstLoad.add(more);
      }
    const workersAtStart = [...firstLoad].filter((file) => !entry.has(file));
    expect(workersAtStart.some((file) => /worker/.test(file))).toBe(true);
    const holdsPdfJs = (path: string) => {
      const text = readFileSync(join(out, path), "latin1");
      return PDFJS_MARKS.filter((mark) => text.includes(mark));
    };
    for (const file of firstLoad) expect(holdsPdfJs(file), `pdf.js in ${file}`).toEqual([]);
    // The reader is a chunk of its own, loaded by a dynamic import...
    const reader = manifest["src/pdf/browser.ts"];
    expect(reader?.isDynamicEntry).toBe(true);
    const readerFile = reader?.file ?? "";
    expect(firstLoad.has(readerFile)).toBe(false);
    // ...which starts a worker of its own, which holds pdf.js, its worker code with it, and is the
    // editor's own file, not a CDN's.
    const readerWorkers = workersOf(out, readerFile);
    expect(readerWorkers).toHaveLength(1);
    const [readerWorker = ""] = readerWorkers;
    expect(readerWorker).toMatch(/reader-worker/);
    const readerOwn = closure(out, readerWorker).filter((file) => !firstLoad.has(file));
    expect(readerOwn).toContain(readerWorker);
    expect(readerOwn.flatMap(holdsPdfJs)).toEqual(expect.arrayContaining(PDFJS_MARKS));
    for (const file of [readerFile, ...readerOwn])
      expect(readFileSync(join(out, file), "latin1"), file).not.toMatch(/cdn\.|unpkg|jsdelivr/i);
  });
});

/** A path a built file names, `./x.js` beside it or `/assets/x.js`, as the build's own path. */
const builtPath = (from: string, named: string) =>
  named.startsWith("/") ? named.slice(1) : join(dirname(from), named);

/** The workers a built file starts: each `new Worker(...)` with the build's own file in it. */
function workersOf(out: string, file: string): string[] {
  const text = readFileSync(join(out, file), "latin1");
  return [...text.matchAll(/new Worker\(\s*(?:new URL\(\s*)?["'`]([^"'`]+\.js)["'`]/g)].map(
    ([, named = ""]) => builtPath(file, named),
  );
}

/** The chunks a built file imports or exports from statically; a dynamic `import(` is not one. */
function importsOf(out: string, file: string): string[] {
  const text = readFileSync(join(out, file), "latin1");
  return [
    ...text.matchAll(
      /\b(?:import|export)\s*(?:[^"'`;()]*?\bfrom\s*)?["'`](\.{1,2}\/[^"'`]+\.js)["'`]/g,
    ),
  ].map(([, named = ""]) => builtPath(file, named));
}

/** What a built file starts or imports statically. */
const startsOrImports = (out: string, file: string) => [
  ...workersOf(out, file),
  ...importsOf(out, file),
];

/** A built file and every file it starts or imports statically, and theirs in turn. */
function closure(out: string, file: string): string[] {
  const seen = new Set<string>();
  const visit = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    for (const named of startsOrImports(out, path)) visit(named);
  };
  visit(file);
  return [...seen];
}
