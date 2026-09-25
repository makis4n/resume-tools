import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { engineTag, engineUrl, fileUrl, manifestUrl } from "../src/engine/urls";
import { IMMUTABLE, serveEngine, serveFolder } from "./serve-folder";

let folder: string;
const servers: ViteDevServer[] = [];

const RELEASE = "build_wasm_0123abcd_1";

/** Write the manifest as fetch-engine does, whole: written beside it, then renamed over it. */
function writeManifest(text: string) {
  const partial = join(folder, "manifest.json.partial");
  writeFileSync(partial, text);
  renameSync(partial, join(folder, "manifest.json"));
}

const manifest = (layout: number) =>
  JSON.stringify({ release: RELEASE, layout, bundles: [], files: { "/texmf/a b.sty": 6 } });

/** A dev server with only `plugin`, and the origin it listens at. */
async function serve(plugin: Plugin): Promise<string> {
  const server = await createServer({
    configFile: false,
    root: folder,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
    plugins: [plugin],
  });
  servers.push(server);
  await server.listen();
  const { port } = server.httpServer?.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "serve-folder-"));
  mkdirSync(join(folder, "files", "texmf"), { recursive: true });
  writeFileSync(join(folder, "files", "article.cls"), "\\ProvidesClass{article}");
  writeFileSync(join(folder, "files", "texmf", "a b.sty"), "\\relax");
  writeFileSync(join(folder, "notes.txt"), "not served");
  writeManifest(manifest(1));
  writeFileSync(join(folder, "busytex.wasm"), "\0asm");
});

afterAll(async () => {
  for (const server of servers) await server.close();
  rmSync(folder, { recursive: true, force: true });
});

describe("serveFolder", () => {
  let base: string;

  beforeAll(async () => {
    const origin = await serve(
      serveFolder("test", "/engine/", folder, (path) => path.startsWith("files/")),
    );
    base = `${origin}/engine/`;
  });

  test("serves a file with its type and length", async () => {
    const response = await fetch(`${base}files/article.cls`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("23");
    expect(await response.text()).toBe("\\ProvidesClass{article}");
  });

  test("answers 404 for what it does not serve", async () => {
    for (const path of ["notes.txt", "files/missing.sty", "files", "files/..%2F..%2Fnotes.txt"])
      expect((await fetch(`${base}${path}`)).status, path).toBe(404);
  });

  test("answers 404 for a path that is not valid percent-encoding", async () => {
    expect((await fetch(`${base}files/%E0%A4%A`)).status).toBe(404);
  });

  test("reads no tag and sets no Cache-Control unless asked to", async () => {
    const response = await fetch(`${base}files/article.cls`);
    expect(response.headers.get("cache-control")).toBeNull();
    expect((await fetch(`${base}anything/files/article.cls`)).status).toBe(404);
  });

  // The file can go between the stat and the read, as when fetch-engine swaps a new tree in; one
  // the server cannot open fails the same way, and every time.
  test.skipIf(process.getuid?.() === 0)(
    "answers 404 for a file it cannot open, and keeps serving",
    async () => {
      const locked = join(folder, "files", "locked.sty");
      writeFileSync(locked, "\\relax");
      chmodSync(locked, 0);
      const response = await fetch(`${base}files/locked.sty`);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
      expect((await fetch(`${base}files/article.cls`)).status).toBe(200);
    },
  );
});

describe("serveEngine", () => {
  let origin: string;
  const tag = engineTag({ release: RELEASE, layout: 1 });

  beforeAll(async () => {
    origin = await serve(serveEngine(folder));
  });

  test("serves the manifest untagged, to be revalidated on every load", async () => {
    const response = await fetch(`${origin}${manifestUrl()}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });

  // The browser keeps the manifest and asks each load whether it has changed, which costs a few
  // hundred bytes rather than its 1.8 MB, so that it is cached afterwards as a first load assumes.
  test("answers a revalidation of the manifest it holds with 304, and a changed one anew", async () => {
    const url = `${origin}${manifestUrl()}`;
    const first = await fetch(url);
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"[^"]+"$/);
    expect(Number.isNaN(Date.parse(first.headers.get("last-modified") ?? ""))).toBe(false);
    const again = await fetch(url, { headers: { "If-None-Match": etag ?? "" } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("etag")).toBe(etag);
    expect(again.headers.get("cache-control")).toBe("no-cache");
    // A list of tags matches if one does, and a weak one as a strong one.
    const listed = await fetch(url, { headers: { "If-None-Match": `"other", W/${etag}` } });
    expect(listed.status).toBe(304);
    try {
      // A tree swapped in writes a new manifest, which the same request is sent whole.
      writeManifest(manifest(2));
      const changed = await fetch(url, { headers: { "If-None-Match": etag ?? "" } });
      expect(changed.status).toBe(200);
      expect(JSON.parse(await changed.text()).layout).toBe(2);
      expect(changed.headers.get("etag")).not.toBe(etag);
    } finally {
      writeManifest(manifest(1));
    }
  });

  test("serves the engine and the tree under the tag its manifest names, for good", async () => {
    const engine = await fetch(`${origin}${engineUrl(tag, "busytex.wasm")}`);
    expect(engine.status).toBe(200);
    expect(engine.headers.get("content-type")).toBe("application/wasm");
    expect(engine.headers.get("cache-control")).toBe(IMMUTABLE);
    const response = await fetch(`${origin}${fileUrl(tag, "/texmf/a b.sty")}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(await response.text()).toBe("\\relax");
  });

  // A browser would keep this tree's bytes under another tree's URLs for a year.
  test("answers 404, with nothing to keep, under any other tag", async () => {
    for (const url of [
      engineUrl("another-2", "busytex.wasm"),
      fileUrl("another-2", "/texmf/a b.sty"),
      fileUrl(engineTag({ release: RELEASE, layout: 2 }), "/texmf/a b.sty"),
    ]) {
      const response = await fetch(`${origin}${url}`);
      expect(response.status, url).toBe(404);
      expect(response.headers.get("cache-control"), url).toBeNull();
      expect(response.headers.get("etag"), url).toBeNull();
    }
  });

  test("serves a tree swapped in under its new tag only, and none it cannot read", async () => {
    const next = engineTag({ release: RELEASE, layout: 2 });
    const status = async (url: string) => (await fetch(`${origin}${url}`)).status;
    try {
      writeManifest(manifest(2));
      expect(await status(fileUrl(next, "/texmf/a b.sty"))).toBe(200);
      expect(await status(fileUrl(tag, "/texmf/a b.sty"))).toBe(404);
      // A manifest cut short, or not a manifest, names no tag.
      for (const text of ["{", JSON.stringify({ release: RELEASE })]) {
        writeManifest(text);
        expect(await status(fileUrl(next, "/texmf/a b.sty")), text).toBe(404);
        expect(await status(engineUrl("undefined-undefined", "busytex.wasm")), text).toBe(404);
      }
    } finally {
      writeManifest(manifest(1));
    }
    expect(await status(fileUrl(tag, "/texmf/a b.sty"))).toBe(200);
  });

  test("answers 404, with nothing to keep, for a file outside its place", async () => {
    for (const path of [
      "files/article.cls",
      "busytex.wasm",
      `${tag}/manifest.json`,
      `${tag}/notes.txt`,
      `${tag}/files/missing.sty`,
      `${tag}/`,
      `${tag}/files/..%2F..%2Fnotes.txt`,
    ]) {
      const response = await fetch(`${origin}/engine/${path}`);
      expect(response.status, path).toBe(404);
      expect(response.headers.get("cache-control"), path).toBeNull();
    }
  });
});
