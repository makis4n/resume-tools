import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { serveFolder } from "./serve-folder";

let folder: string;
let server: ViteDevServer;
let base: string;

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "serve-folder-"));
  mkdirSync(join(folder, "files"));
  writeFileSync(join(folder, "files", "article.cls"), "\\ProvidesClass{article}");
  writeFileSync(join(folder, "notes.txt"), "not served");
  server = await createServer({
    configFile: false,
    root: folder,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
    plugins: [serveFolder("test", "/engine/", folder, (path) => path.startsWith("files/"))],
  });
  await server.listen();
  const { port } = server.httpServer?.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/engine/`;
});

afterAll(async () => {
  await server?.close();
  rmSync(folder, { recursive: true, force: true });
});

describe("serveFolder", () => {
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
