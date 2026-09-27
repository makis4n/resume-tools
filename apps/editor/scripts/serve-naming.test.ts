import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { createServer, type InlineConfig, type Logger, type ViteDevServer } from "vite";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { inventedNaming, inventedRequest } from "../src/service/invented";
import { LIMITS } from "../src/service/name";
import { NamingReply } from "../src/service/reply";
import { FileAnswerCache } from "./answer-cache";
import { CACHE_ALONE, type ServeNamingOptions, serveNaming } from "./serve-naming";

// The request, the answers and the keys here are invented, and no test calls a provider: the model
// is the AI SDK's mock, or a real one that is made and never asked.

const servers: ViteDevServer[] = [];
const made: string[] = [];

/** A new empty folder under the system's temporary one, removed after the tests. */
function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "resume-tools-serve-naming-"));
  made.push(dir);
  return dir;
}

afterAll(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * The variables the route reads, and the name it read before, taken out of this process's
 * environment for a test.
 */
const VARIABLES = ["NAMING_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "NAMING_MODEL"];
const saved = new Map(VARIABLES.map((name) => [name, process.env[name]]));
afterEach(() => {
  for (const [name, value] of saved)
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
});

/** A logger that keeps every line. */
function keeping(lines: string[]): Logger {
  const keep = (line: string) => {
    lines.push(line);
  };
  return {
    info: keep,
    warn: keep,
    warnOnce: keep,
    error: keep,
    clearScreen: () => undefined,
    hasErrorLogged: () => false,
    hasWarned: false,
  };
}

/**
 * A dev server with the naming route alone, over a new folder holding `files`, and the origin it
 * listens at, with the lines it logged.
 */
async function serve(
  options: ServeNamingOptions,
  files: Record<string, string> = {},
  config: InlineConfig = {},
) {
  const root = folder();
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  const lines: string[] = [];
  const server = await createServer({
    configFile: false,
    root,
    customLogger: keeping(lines),
    server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
    plugins: [serveNaming(options)],
    ...config,
  });
  servers.push(server);
  await server.listen();
  const { port } = server.httpServer?.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, lines };
}

type Result = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

/** A mock that answers every call with the invented answer. */
const answering = () =>
  new MockLanguageModelV4({
    modelId: "invented-model",
    doGenerate: async (): Promise<Result> => ({
      content: [{ type: "text", text: JSON.stringify(inventedNaming()) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: undefined },
        outputTokens: { total: 300, text: 300, reasoning: 0 },
      },
      warnings: [],
    }),
  });

/** A cache over two new folders, as the dev server's is over the committed answers and the ignored. */
const freshCache = () => new FileAnswerCache({ committed: folder(), writable: folder() });

/** A POST to the route on `origin`, as JSON. */
const post = (origin: string, body: BodyInit, path = "/v1/name") =>
  fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);

describe("the naming route on the dev server", () => {
  test("answers a request, files the model's answers in the cache's folder, and answers the same request from it next", async () => {
    const cache = freshCache();
    const model = answering();
    const { origin } = await serve({ env: {}, model, cache });
    const request = JSON.stringify(await inventedRequest());
    const first = await post(origin, request);
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(NamingReply.parse(await first.json())).toMatchObject({ hits: 0, asked: 3, missing: [] });
    expect(readdirSync(cache.writable)).toHaveLength(3);
    expect(readdirSync(cache.committed)).toEqual([]);
    const second = await post(origin, request);
    expect(NamingReply.parse(await second.json())).toMatchObject({ hits: 3, asked: 0 });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  test("refuses a body past the cap, by its length or as it streams, and goes on serving", async () => {
    const limits = { ...LIMITS, bytes: 64 * 1024 };
    const { origin } = await serve({ env: {}, cache: freshCache(), limits });
    // Declared by its length.
    expect((await post(origin, " ".repeat(64 * 1024 + 1))).status).toBe(413);
    // Sent in chunks with no length: read to the cap, and the rest drained.
    let chunks = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunks++ === 12) controller.close();
        else controller.enqueue(new Uint8Array(16 * 1024).fill(0x20));
      },
    });
    const streamed = await post(origin, stream);
    expect(streamed.status).toBe(413);
    expect(await streamed.json()).toEqual({
      error: "The request is larger than the naming route takes.",
    });
    const request = JSON.stringify(await inventedRequest());
    expect((await post(origin, request)).status).toBe(200);
  });

  test("answers its own path alone, with any query, and a POST alone", async () => {
    const { origin } = await serve({ env: {}, cache: freshCache() });
    const request = JSON.stringify(await inventedRequest());
    expect((await post(origin, request, "/v1/name?from=import")).status).toBe(200);
    for (const path of ["/v1/name/other", "/v1/name.json", "/v1/names"])
      expect((await post(origin, request, path)).status, path).toBe(404);
    const get = await fetch(`${origin}/v1/name`);
    expect([get.status, get.headers.get("allow")]).toEqual([405, "POST"]);
  });

  test("serves the cache alone with no key, and says so in one line", async () => {
    delete process.env.NAMING_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    const { origin, lines } = await serve({ cache: freshCache() });
    expect(lines.filter((line) => line.includes("naming route"))).toEqual([CACHE_ALONE]);
    const reply = NamingReply.parse(
      await (await post(origin, JSON.stringify(await inventedRequest()))).json(),
    );
    expect(reply).toMatchObject({ macros: [], hits: 0, asked: 0 });
    expect(reply.missing.map((each) => each.name)).toEqual(["cvsection", "cventry", "cvitems"]);
  });

  test("reads its key from the editor's .env on the server side, under the runner's name alone, never under the VITE_ prefix, and never says it", async () => {
    delete process.env.NAMING_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.NAMING_MODEL;
    expect(CACHE_ALONE).toContain("set GOOGLE_GENERATIVE_AI_API_KEY in apps/editor/.env");
    const prefixed = await serve(
      { cache: freshCache() },
      { ".env": "VITE_GOOGLE_GENERATIVE_AI_API_KEY=invented-key-0001\n" },
    );
    expect(prefixed.lines).toContain(CACHE_ALONE);
    // The service's own name for the key is gone: one key, one variable, the runner's.
    const dropped = await serve(
      { cache: freshCache() },
      { ".env": "NAMING_API_KEY=invented-key-0004\n" },
    );
    expect(dropped.lines).toContain(CACHE_ALONE);
    // A key makes a model, which nothing here asks.
    const keyed = await serve(
      { cache: freshCache() },
      {
        ".env": "GOOGLE_GENERATIVE_AI_API_KEY=invented-key-0002\nNAMING_MODEL=gemini-3.7-flash\n",
      },
    );
    expect(keyed.lines).toContain(
      "The naming route, /v1/name, asks gemini-3.7-flash for what the cache does not hold.",
    );
    expect(keyed.lines.join("\n")).not.toContain("invented-key");
  });

  test("will not start with a model's id that is none, and never runs in vitest's own server", async () => {
    await expect(
      serve({
        env: {
          GOOGLE_GENERATIVE_AI_API_KEY: "invented-key-0003",
          NAMING_MODEL: "an id with spaces",
        },
      }),
    ).rejects.toThrow("NAMING_MODEL is not a model's id");
    const { origin, lines } = await serve({ env: {}, cache: freshCache() }, {}, { mode: "test" });
    expect(lines).not.toContain(CACHE_ALONE);
    expect((await post(origin, JSON.stringify(await inventedRequest()))).status).toBe(404);
  });
});
