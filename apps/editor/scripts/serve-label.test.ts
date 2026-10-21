import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { createServer, type Logger, type ViteDevServer } from "vite";
import { afterAll, describe, expect, test, vi } from "vitest";
import type { Features } from "../src/pdf/roles";
import { LABEL_SAYS } from "../src/service/label";
import { LabelReply } from "../src/service/label-contract";
import { fileEnv, NO_MODEL, type ServeLabelOptions, serveLabel } from "./serve-label";

// The lines here are invented, and no test calls a provider: the model is the AI SDK's mock.

const servers: ViteDevServer[] = [];
const made: string[] = [];

afterAll(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
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

/** A dev server with the label route alone, and the origin it listens at, with what it logged. */
async function serve(options: ServeLabelOptions) {
  const root = mkdtempSync(join(tmpdir(), "resume-tools-serve-label-"));
  made.push(root);
  const lines: string[] = [];
  const server = await createServer({
    configFile: false,
    root,
    customLogger: keeping(lines),
    server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
    plugins: [serveLabel(options)],
  });
  servers.push(server);
  await server.listen();
  const { port } = server.httpServer?.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, lines };
}

const LINE: Features = {
  id: 0,
  text: "Odile Brackenmoor",
  page: 1,
  column: 0,
  columns: 1,
  indent: 0,
  width: 160,
  size: 2,
  bold: true,
  italic: false,
  caps: false,
  bullet: false,
  rowIndex: 0,
  rowSize: 1,
  rule: false,
  links: 0,
  rows: 1,
};

const post = (origin: string, path = "/v1/label") =>
  fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lines: [LINE] }),
  });

const answering = () =>
  new MockLanguageModelV4({
    modelId: "invented-model",
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify({ L0: "name" }) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: undefined },
        outputTokens: { total: 5, text: 5, reasoning: 0 },
      },
      warnings: [],
    }),
  });

describe("the label route on the dev server", () => {
  test("answers through the handler, on the page's own origin, and logs none of the text", async () => {
    const model = answering();
    const { origin, lines } = await serve({ model });
    const response = await post(origin);
    expect(response.status).toBe(200);
    expect(LabelReply.parse(await response.json())).toEqual({ roles: ["name"] });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(lines.join("\n")).toContain("asks invented-model");
    expect(lines.join("\n")).not.toContain(LINE.text);
    // Only the route itself: another path under it is not the route.
    expect((await post(origin, "/v1/label/more")).status).not.toBe(200);
  });

  test("with no key, refuses with 503 and says so when it starts", async () => {
    const { origin, lines } = await serve({ env: {} });
    expect(lines).toContain(NO_MODEL);
    const response = await post(origin);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: LABEL_SAYS.none });
  });

  test("never reads the key from a VITE_ variable", async () => {
    const { lines } = await serve({ env: { VITE_SOCLAAS_API_KEY: "invented-key" } as never });
    expect(lines).toContain(NO_MODEL);
  });
});

describe("Claude's variables on the dev server", () => {
  test("come from the editor's .env files alone, a later file's over an earlier's", () => {
    const dir = mkdtempSync(join(tmpdir(), "label-env-"));
    made.push(dir);
    vi.stubEnv("ANTHROPIC_API_KEY", "invented-shell-key");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://gateway.invalid/v1");
    try {
      // No file names the key: the shell's is not taken.
      expect(fileEnv("development", dir, "ANTHROPIC_")).toEqual({});
      writeFileSync(join(dir, ".env"), "ANTHROPIC_API_KEY=invented-file-key\nSOCLAAS_API_KEY=x\n");
      expect(fileEnv("development", dir, "ANTHROPIC_")).toEqual({
        ANTHROPIC_API_KEY: "invented-file-key",
      });
      // An empty line in a later file turns it off, whatever the shell holds.
      writeFileSync(join(dir, ".env.development.local"), "ANTHROPIC_API_KEY=\n");
      expect(fileEnv("development", dir, "ANTHROPIC_")).toEqual({ ANTHROPIC_API_KEY: "" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
