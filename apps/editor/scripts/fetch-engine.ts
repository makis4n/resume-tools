/**
 * Build `.engine/`: the TeX engine and a TeX Live 2023 tree, for development and CI.
 *
 * Downloads the pinned BusyTeX release, the WebAssembly build of TeX Live 2023 the spike measured,
 * and checks every file against the hash recorded below. The release packs TeX Live into bundles
 * that only the engine can unpack, so the script mounts them in the engine under Node and copies
 * every file out, one file per path, with a manifest of paths and sizes. The worker fetches files
 * from that tree one at a time, the first time TeX opens each.
 *
 *   node scripts/fetch-engine.ts [--from <dir>] [--force]
 *
 *   --from <dir>  take the release files from a folder instead of downloading them
 *   --force       rebuild even when `.engine/` is already up to date
 *
 * Output, all ignored by git:
 *
 *   .engine/package.json     marks the folder CommonJS, which the release's loaders are written as
 *   .engine/downloads/       the release files as downloaded
 *   .engine/busytex.js       the engine's loader, for Node
 *   .engine/busytex.mjs      the same loader as an ES module, for the worker
 *   .engine/busytex.wasm     the engine: pdfTeX, XeTeX, LuaHBTeX and xdvipdfmx in one binary
 *   .engine/files/<path>     every TeX Live file, at the path the engine sees it under
 *   .engine/manifest.json    { release, layout, bundles, files: { <path>: <size> } }, written last
 *
 * One run at a time: a run holds `.engine/.lock` while it builds, and a second run stops. Each run
 * writes its downloads and its staging folder under names that carry its process id, so even
 * runs that both got past the lock cannot overwrite each other's half-written files.
 */

import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { copyFile, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
// Node runs this file by stripping its types, so the type import needs its real extension.
import type { EngineManifest } from "../src/engine/manifest.ts";

const RELEASE = "build_wasm_4499aa69fd3cf77ad86a47287d9a5193cf5ad993_7936974349_1";
const RELEASE_URL = `https://github.com/busytex/busytex/releases/download/${RELEASE}/`;

/**
 * The version of what this script writes. Bump it whenever the output changes (the files, the
 * loaders, the manifest's shape), so a `.engine/` built by an older version is rebuilt.
 */
const LAYOUT = 1;

/** Release files with their SHA-256 and size, recorded from the copies the spike measured. */
const ASSETS: Record<string, { sha256: string; size: number }> = {
  "busytex.js": {
    sha256: "f381d9ba816d9a4389d429f54fe85f13396aa2f822973d9b66e1f527ced3434b",
    size: 295606,
  },
  "busytex.wasm": {
    sha256: "a7785b59bfddb8667e7738443f111430e3ee2bd3ec0c1c26629267849e091415",
    size: 30363063,
  },
  "texlive-basic.js": {
    sha256: "23cc4ce427d27d555fe2a050b97ff8c95bb331425018e9159130e74b62373ff1",
    size: 2068492,
  },
  "texlive-basic.data": {
    sha256: "c955651ca293f09b2e57d6360fa2cb61ad710b4ae51e9fbc04b049477a8aeb71",
    size: 104576512,
  },
  "ubuntu-texlive-latex-base.js": {
    sha256: "807f0bfbe66ff919c1799737acd751dfba6c1ca2afd8d71db2bb30c3c5c62144",
    size: 299539,
  },
  "ubuntu-texlive-latex-base.data": {
    sha256: "0dd2dfaaa2e6a9674090cbf8cf3a01419ce37063080f762aee0d82ad7263ead8",
    size: 5741806,
  },
  "ubuntu-texlive-latex-recommended.js": {
    sha256: "bbd975921a74adae9119988ae8a740ca9f4837db772061d313c67729fba1d9ee",
    size: 337892,
  },
  "ubuntu-texlive-latex-recommended.data": {
    sha256: "fa9a03f928a0af0e9c5a24e2ce2956e64db9d580dd2c3a7517176aac16dc9006",
    size: 9058527,
  },
  "ubuntu-texlive-latex-extra.js": {
    sha256: "a99a68b79e6a93f3ca9d94f46afe8a62e7e06b6d4c5e90a705ec15fc42d8ecda",
    size: 1398581,
  },
  "ubuntu-texlive-latex-extra.data": {
    sha256: "fb4dc0440f4b2bd2d5138dbb5689e6a33cd20c9704934422436cb97af5d623c4",
    size: 49513577,
  },
  "ubuntu-texlive-fonts-recommended.js": {
    sha256: "708f60e5fc46b64204e8361a0d0939b3f8f0713f9b7fae379baa67e5dbe0c37a",
    size: 353109,
  },
  "ubuntu-texlive-fonts-recommended.data": {
    sha256: "3154397a58db2ac62d6bcf99e44786c6ea62cc31c2343adc42d51f2088b6a3f1",
    size: 10264033,
  },
};

/**
 * The TeX Live bundles, in mounting order. `texlive-basic` holds TeX Live's own scheme-basic
 * with the LaTeX and XeTeX collections and the stock formats, under /texlive; the Ubuntu
 * bundles add LaTeX packages and fonts under /texmf, which the engine searches second.
 */
const BUNDLES = [
  "texlive-basic",
  "ubuntu-texlive-latex-base",
  "ubuntu-texlive-latex-recommended",
  "ubuntu-texlive-latex-extra",
  "ubuntu-texlive-fonts-recommended",
];

/** Top-level folders of the engine's file system that hold files TeX may read. */
const ROOTS = ["/texlive", "/texmf", "/etc", "/bin"];

/** Files the editor cannot work without; the build fails if any is missing. */
const REQUIRED = [
  "/texlive/texmf-dist/texmf-var/web2c/pdftex/pdflatex.fmt",
  "/texlive/texmf-dist/texmf-var/web2c/xetex/xelatex.fmt",
  "/texlive/texmf-dist/texmf-var/fonts/map/pdftex/updmap/pdftex.map",
  "/texlive/texmf-dist/web2c/texmf.cnf",
  "/texlive/texmf-dist/ls-R",
  "/texlive/texmf-dist/tex/latex/base/article.cls",
  "/texlive/texmf-dist/fonts/tfm/public/cm/cmr10.tfm",
  "/texmf/texmf-dist/tex/latex/xcolor/xcolor.sty",
  "/texmf/texmf-dist/tex/latex/enumitem/enumitem.sty",
];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".engine");
const DOWNLOADS = join(ROOT, "downloads");
const FILES = join(ROOT, "files");
const MANIFEST = join(ROOT, "manifest.json");
const LOCK = join(ROOT, ".lock");

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

/** True when the file exists and matches its recorded hash and size. */
async function verified(file: string, name: string): Promise<boolean> {
  const want = ASSETS[name];
  if (!want || !existsSync(file)) return false;
  if ((await stat(file)).size !== want.size) return false;
  return (await sha256(file)) === want.sha256;
}

/** Put one release file into `downloads/`, from `from` or from GitHub, and check it. */
async function obtain(name: string, from: string | undefined): Promise<void> {
  const target = join(DOWNLOADS, name);
  if (await verified(target, name)) return;
  const partial = `${target}.partial-${process.pid}`;
  if (from) {
    await copyFile(join(from, name), partial);
  } else {
    const response = await fetch(RELEASE_URL + name);
    if (!response.ok || !response.body)
      throw new Error(`${name}: HTTP ${response.status} from ${RELEASE_URL}`);
    // The DOM and Node type the same stream differently; at run time they are one object.
    const body = response.body as unknown as NodeReadableStream<Uint8Array>;
    await pipeline(Readable.fromWeb(body), createWriteStream(partial));
  }
  if (!(await verified(partial, name))) {
    await rm(partial, { force: true });
    throw new Error(`${name} does not match the recorded SHA-256 and size; refusing to use it`);
  }
  await rename(partial, target);
  console.log(`  ${name}, ${((ASSETS[name]?.size ?? 0) / 1e6).toFixed(1)} MB`);
}

/** The part of Emscripten's file system API the walk uses. */
interface EmscriptenFs {
  readdir(path: string): string[];
  stat(path: string): { mode: number };
  isDir(mode: number): boolean;
  isFile(mode: number): boolean;
  readFile(path: string): Uint8Array;
  analyzePath(path: string): { exists: boolean };
}

/**
 * Mount the bundles in the engine and return its file system. The bundle loaders were written
 * for a browser page, so Node has to supply what they look for: a `self` and a `location`, an
 * IndexedDB whose `open` fails, after which they read their data file from disk, and a global
 * named `BusytexPipeline` that they bind to and that forwards to the engine.
 */
async function mount(): Promise<EmscriptenFs> {
  const g = globalThis as Record<string, unknown>;
  g.self = globalThis;
  g.location = { href: "file:///" };
  const noIndexedDb = new Error("no IndexedDB in Node");
  g.indexedDB = {
    open() {
      const request: { onerror?: (e: Error) => void } = {};
      setImmediate(() => request.onerror?.(noIndexedDb));
      return request;
    },
  };
  // The loaders report that failure on the console before falling back; nothing is wrong.
  const error = console.error;
  console.error = (...args: unknown[]) => {
    if (args[0] !== noIndexedDb && args[0] !== "falling back to default preload behavior")
      error(...args);
  };
  const bundlePipeline = {
    preRun: [] as (() => void)[],
    calledRun: false,
    locateFile: (name: string) => join(DOWNLOADS, basename(name)),
  };
  g.BusytexPipeline = bundlePipeline;
  const require = createRequire(import.meta.url);
  for (const bundle of BUNDLES) require(join(DOWNLOADS, `${bundle}.js`));
  const busytex = require(join(DOWNLOADS, "busytex.js")) as (
    module: Record<string, unknown>,
  ) => Promise<{ FS: EmscriptenFs }>;
  const engine: Record<string, unknown> = {
    thisProgram: "/bin/busytex",
    noInitialRun: true,
    locateFile: (name: string) => join(DOWNLOADS, basename(name)),
    preRun: [
      () => {
        Object.setPrototypeOf(bundlePipeline, engine);
        for (const run of bundlePipeline.preRun) run();
      },
    ],
    print: () => {},
    printErr: () => {},
  };
  try {
    return (await busytex(engine)).FS;
  } finally {
    console.error = error;
  }
}

/** Copy every file under the roots out of the engine into `dir`, and list it. */
function copyOut(fs: EmscriptenFs, dir: string): Record<string, number> {
  const files: Record<string, number> = {};
  const walk = (path: string) => {
    for (const name of fs.readdir(path)) {
      if (name === "." || name === "..") continue;
      const child = `${path}/${name}`;
      const { mode } = fs.stat(child);
      if (fs.isDir(mode)) walk(child);
      else if (fs.isFile(mode)) {
        const data = fs.readFile(child);
        const target = join(dir, child);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, data);
        files[child] = data.length;
      }
    }
  };
  for (const root of ROOTS) if (fs.analyzePath(root).exists) walk(root);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** True when `.engine/` holds a finished build of this release, layout and set of bundles. */
async function upToDate(): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(MANIFEST, "utf8")) as EngineManifest;
    return (
      manifest.release === RELEASE &&
      manifest.layout === LAYOUT &&
      manifest.bundles.join() === BUNDLES.join() &&
      ["busytex.js", "busytex.mjs", "busytex.wasm"].every((f) => existsSync(join(ROOT, f))) &&
      REQUIRED.every((path) => existsSync(join(FILES, path)))
    );
  } catch {
    // No manifest, or one that is cut short or not of this shape: build again.
    return false;
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** A lock this old is stale even if its process id now belongs to a live process. */
const STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * Take `.engine/.lock`, which names the process holding it, and return what releases it. A lock
 * whose process is gone, or that is over an hour old, was left by a run that stopped and is taken
 * over; a live one stops this run.
 */
async function lock(): Promise<() => Promise<void>> {
  const mine = String(process.pid);
  for (;;) {
    try {
      await writeFile(LOCK, mine, { flag: "wx" });
      // Release the lock only while it is still this run's.
      return async () => {
        if ((await readFile(LOCK, "utf8").catch(() => "")) === mine)
          await rm(LOCK, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const holder = Number(await readFile(LOCK, "utf8").catch(() => ""));
      const age =
        Date.now() -
        (await stat(LOCK).then(
          (s) => s.mtimeMs,
          () => 0,
        ));
      if (holder && holder !== process.pid && alive(holder) && age < STALE_AFTER_MS)
        throw new Error(
          `fetch-engine is already running (process ${holder}). If it is not, delete ${LOCK} and run it again.`,
        );
      await rm(LOCK, { force: true });
    }
  }
}

/** Remove what runs that are no longer alive left behind: part-written files and old trees. */
async function sweep() {
  const folders = [ROOT, DOWNLOADS].filter((folder) => existsSync(folder));
  for (const folder of folders) {
    for (const name of readdirSync(folder)) {
      const leftover = /\.(?:partial|old)(?:-(\d+))?$/.exec(name);
      if (leftover && !(leftover[1] && alive(Number(leftover[1]))))
        await rm(join(folder, name), { recursive: true, force: true });
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const fromAt = args.indexOf("--from");
  const from = fromAt >= 0 ? resolve(args[fromAt + 1] ?? ".") : undefined;
  if (!args.includes("--force") && (await upToDate())) {
    console.log(`.engine/ is up to date (${RELEASE}); --force rebuilds it`);
    return;
  }
  mkdirSync(ROOT, { recursive: true });
  const unlock = await lock();
  try {
    await sweep();
    await build(from);
  } finally {
    await unlock();
  }
}

async function build(from: string | undefined) {
  console.log(from ? `Copying the release from ${from}` : `Downloading ${RELEASE_URL}`);
  mkdirSync(DOWNLOADS, { recursive: true });
  // The editor's package is an ES module package, which would make Node load the release's
  // CommonJS loaders as ES modules; this folder says otherwise.
  await writeFile(join(ROOT, "package.json"), `${JSON.stringify({ type: "commonjs" })}\n`);
  for (const name of Object.keys(ASSETS)) await obtain(name, from);

  console.log("Unpacking TeX Live");
  const started = performance.now();
  // A new manifest is written last, so a build that stops half way is never taken as done.
  await rm(MANIFEST, { force: true });
  const staging = `${FILES}.partial-${process.pid}`;
  const old = `${FILES}.old-${process.pid}`;
  let files: Record<string, number>;
  try {
    files = copyOut(await mount(), staging);
    const missing = REQUIRED.filter((path) => files[path] === undefined);
    if (missing.length) throw new Error(`the TeX Live tree lacks ${missing.join(", ")}`);
    // Swap the trees by renaming, so no run deletes files another run has put in place.
    await rename(FILES, old).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rename(staging, FILES);
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(old, { recursive: true, force: true });
  }

  const loader = await readFile(join(DOWNLOADS, "busytex.js"), "utf8");
  await writeFile(join(ROOT, "busytex.js"), loader);
  // The worker is an ES module and cannot use importScripts, so it imports this copy.
  await writeFile(join(ROOT, "busytex.mjs"), `${loader}\nexport default busytex;\n`);
  await copyFile(join(DOWNLOADS, "busytex.wasm"), join(ROOT, "busytex.wasm"));
  const manifest: EngineManifest = { release: RELEASE, layout: LAYOUT, bundles: BUNDLES, files };
  // Written under another name and renamed, so a run stopped while writing it leaves no
  // manifest rather than part of one.
  const partial = `${MANIFEST}.partial-${process.pid}`;
  await writeFile(partial, JSON.stringify(manifest));
  await rename(partial, MANIFEST);

  const bytes = Object.values(files).reduce((a, b) => a + b, 0);
  console.log(
    `${Object.keys(files).length} files, ${(bytes / 1e6).toFixed(1)} MB, in ${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
