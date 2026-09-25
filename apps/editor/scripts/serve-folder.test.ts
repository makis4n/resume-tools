import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { engineTag, engineUrl, fileUrl, manifestUrl } from "../src/engine/urls";
import { IMMUTABLE, serveEngine, serveFolder } from "./serve-folder";

let folder: string;
const servers: ViteDevServer[] = [];

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
  writeFileSync(join(folder, "manifest.json"), "{}");
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
  const tag = engineTag({ release: "build_wasm_0123abcd_1", layout: 1 });

  beforeAll(async () => {
    origin = await serve(serveEngine(folder));
  });

  test("serves the manifest untagged, to be revalidated on every load", async () => {
    const response = await fetch(`${origin}${manifestUrl()}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });

  test("serves the engine and the tree under any tag, for good", async () => {
    for (const url of [engineUrl(tag, "busytex.wasm"), engineUrl("another-2", "busytex.wasm")]) {
      const response = await fetch(`${origin}${url}`);
      expect(response.status, url).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/wasm");
      expect(response.headers.get("cache-control")).toBe(IMMUTABLE);
    }
    const response = await fetch(`${origin}${fileUrl(tag, "/texmf/a b.sty")}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(await response.text()).toBe("\\relax");
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
