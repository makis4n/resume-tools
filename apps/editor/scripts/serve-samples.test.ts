import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SAMPLES_ROUTE, SampleMissing, sampleUpload, serveSamples } from "./serve-samples";

// An invented oracle naming two invented samples, in a folder of the test's own: nothing here is
// an upstream sample, and nothing reads `.corpus/`.

const MAIN = "\\documentclass{article}\\begin{document}Invented Quill\\end{document}\n";
const PART = "\\section{Invented}\n";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const file = (path: string, text: string) => ({
  path,
  sha256: sha256(text),
  bytes: Buffer.byteLength(text),
});

/** An oracle entry for an invented sample, with what the probe should find, as the schema asks. */
const sample = (id: string, files: { path: string; sha256: string; bytes: number }[]) => ({
  id,
  family: "other",
  repo: "invented/samples",
  repoId: 1,
  commit: "0".repeat(40),
  license: null,
  main: files[0]?.path,
  files,
  images: 0,
  expected: [{ standard: "section", port: "marks", expected: "editable", why: "Invented." }],
});

let dir: string;
let options: { oracleFile: string; dir: string };
const servers: ViteDevServer[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "serve-samples-"));
  const oracleFile = join(dir, "oracle.json");
  writeFileSync(
    oracleFile,
    JSON.stringify({
      version: 1,
      documents: [
        sample("other-0001", [file("cv.tex", MAIN), file("parts/one.tex", PART)]),
        // Named, but never fetched.
        sample("other-0002", [file("cv.tex", MAIN)]),
        // Fetched, but its file is not the one named.
        sample("other-0003", [file("cv.tex", MAIN)]),
      ],
    }),
  );
  mkdirSync(join(dir, "samples", "other-0001", "parts"), { recursive: true });
  writeFileSync(join(dir, "samples", "other-0001", "cv.tex"), MAIN);
  writeFileSync(join(dir, "samples", "other-0001", "parts", "one.tex"), PART);
  mkdirSync(join(dir, "samples", "other-0003"), { recursive: true });
  writeFileSync(join(dir, "samples", "other-0003", "cv.tex"), MAIN.replace("Quill", "Wren!"));
  options = { oracleFile, dir: join(dir, "samples") };
});

afterAll(async () => {
  for (const server of servers) await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("sampleUpload", () => {
  test("zips a sample's files at their paths, as corpus oracle gives them", () => {
    const upload = sampleUpload("other-0001", options);
    expect(upload.name).toBe("other-0001.zip");
    const files = unzipSync(upload.bytes);
    expect(Object.keys(files).sort()).toEqual(["cv.tex", "parts/one.tex"]);
    expect(strFromU8(files["cv.tex"] ?? new Uint8Array())).toBe(MAIN);
  });

  test("refuses a sample the oracle does not name, one not fetched, and one fetched otherwise", () => {
    expect(() => sampleUpload("other-0009", options)).toThrow(
      new SampleMissing("The oracle names no sample other-0009."),
    );
    expect(() => sampleUpload("other-0002", options)).toThrow(
      "The upstream sample other-0002 has not been fetched: run pnpm --filter @resume-tools/editor corpus oracle first.",
    );
    expect(() => sampleUpload("other-0003", options)).toThrow(
      "other-0003's cv.tex is not the file the oracle names",
    );
  });
});

describe("serveSamples", () => {
  let base: string;

  beforeAll(async () => {
    const server = await createServer({
      configFile: false,
      root: dir,
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
      plugins: [serveSamples(options)],
    });
    servers.push(server);
    await server.listen();
    const { port } = server.httpServer?.address() as AddressInfo;
    base = `http://127.0.0.1:${port}${SAMPLES_ROUTE}`;
  });

  test("serves a sample as its zip, never to be cached", async () => {
    const response = await fetch(`${base}other-0001.zip`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["cv.tex", "parts/one.tex"]);
    const head = await fetch(`${base}other-0001.zip`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(Number(head.headers.get("content-length"))).toBeGreaterThan(0);
  });

  test("answers 404, and why, for a sample it cannot take", async () => {
    const missing = await fetch(`${base}other-0002.zip`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("has not been fetched");
    expect((await fetch(`${base}other-0003.zip`)).status).toBe(404);
  });

  test("answers 404 for anything else under the route, and only reads", async () => {
    for (const path of [
      "other-0001",
      "other-0001.tex",
      "other-0001/cv.tex",
      "..%2Foracle.json",
      "%2E%2E/oracle.json",
      "",
    ])
      expect((await fetch(`${base}${path}`)).status, path).toBe(404);
    const posted = await fetch(`${base}other-0001.zip`, { method: "POST", body: "x" });
    expect(posted.status).toBe(405);
    expect(posted.headers.get("allow")).toBe("GET, HEAD");
  });
});
