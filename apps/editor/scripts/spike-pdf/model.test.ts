import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CORPUS_DIR } from "../corpus-manifest.ts";
import { layOut } from "./layout.ts";
import { minimalPdf } from "./minimal-pdf.ts";
import {
  assertInvented,
  failureOf,
  labelByModel,
  MODEL,
  NotInvented,
  rolesOf,
  schemaOf,
} from "./model.ts";
import { OTHER_DIR } from "./print.ts";
import { readPdf } from "./read.ts";
import { featuresOf, ROLES } from "./roles.ts";

const FIXTURE = join(OTHER_DIR, "chrome-table", "resume.pdf");

/** A folder of the test's own, with a PDF and its truth, a corpus-named folder, and a link out. */
const scratch = mkdtempSync(join(tmpdir(), "spike-pdf-model-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const root = join(scratch, "invented");
const outside = join(scratch, "outside");
for (const folder of [root, outside, join(root, ".corpus")]) mkdirSync(folder, { recursive: true });
const pdf = minimalPdf([{ texts: [{ x: 72, y: 80, size: 12, text: "Invented resume text" }] }]);
for (const folder of [root, outside, join(root, ".corpus")]) {
  writeFileSync(join(folder, "resume.pdf"), pdf);
  writeFileSync(join(folder, "truth.json"), "{}");
}
writeFileSync(join(root, "notes.txt"), "invented");
mkdirSync(join(root, "alone"));
writeFileSync(join(root, "alone", "resume.pdf"), pdf);
symlinkSync(join(outside, "resume.pdf"), join(root, "linked.pdf"));

/** A `fetch` that fails the test if anything calls it, and counts the calls. */
function forbiddenFetch() {
  const calls: unknown[] = [];
  const fetch = (async (...args: unknown[]) => {
    calls.push(args);
    throw new Error("nothing may be sent");
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("the model reads only the invented sets", () => {
  it("takes a PDF of the invented sets' folders with its truth beside it", () => {
    expect(assertInvented(FIXTURE)).toMatch(/chrome-table\/resume\.pdf$/);
    expect(assertInvented(join(root, "resume.pdf"), [root])).toMatch(/resume\.pdf$/);
  });

  it("refuses a corpus document, a path outside the folders, a link out, a climb up and a PDF with no truth", () => {
    const refused = [
      join(CORPUS_DIR, "jake-0001", "resume.pdf"),
      join(root, ".corpus", "resume.pdf"),
      join(outside, "resume.pdf"),
      join(root, "linked.pdf"),
      join(root, "..", "outside", "resume.pdf"),
      join(root, "notes.txt"),
      join(root, "alone", "resume.pdf"),
      join(OTHER_DIR, "..", "..", "..", "package.json"),
    ];
    for (const path of refused)
      expect(() => assertInvented(path, [root, OTHER_DIR]), path).toThrow(NotInvented);
  });

  it("sends nothing for a path it refuses, before it reads the file", async () => {
    const { fetch, calls } = forbiddenFetch();
    for (const path of [join(CORPUS_DIR, "jake-0001", "resume.pdf"), join(outside, "resume.pdf")])
      await expect(labelByModel(path, { apiKey: "invented-key", fetch })).rejects.toThrow(
        NotInvented,
      );
    expect(calls).toHaveLength(0);
  });
});

describe("asking the model", () => {
  it("asks for one role a line from the closed list, with the model's thinking off", async () => {
    const read = await readPdf(new Uint8Array(readFileSync(FIXTURE)));
    if ("refused" in read) throw new Error("refused");
    const features = featuresOf(layOut(read));
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      const content = JSON.stringify(
        Object.fromEntries(features.map((line) => [`L${line.id}`, "running text"])),
      );
      return new Response(
        JSON.stringify({
          id: "invented",
          object: "chat.completion",
          created: 0,
          model: MODEL,
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;
    const { call } = await labelByModel(FIXTURE, { apiKey: "invented-key", fetch });
    expect(call.failure).toBeUndefined();
    expect(call.roles).toHaveLength(features.length);
    expect(call.tokens).toMatchObject({ input: 100, output: 20 });
    expect(sent).toHaveLength(1);
    const body = sent[0]?.body ?? {};
    expect(sent[0]?.url).toMatch(/^https:\/\/soclaas-api\.comp\.nus\.edu\.sg\/v1\//);
    expect(body.model).toBe("qwen3.8:27b");
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    const format = body.response_format as { type: string; json_schema: { schema: unknown } };
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.schema).toEqual(schemaOf(features));
  }, 60_000);

  it("says a call's failure by its kind", async () => {
    const answer = (status: number) =>
      (async () => new Response("{}", { status })) as unknown as typeof globalThis.fetch;
    for (const [status, failure] of [
      [503, "gateway down"],
      [429, "rate limited"],
      [401, "key refused"],
    ] as const) {
      const { call } = await labelByModel(FIXTURE, {
        apiKey: "invented-key",
        fetch: answer(status),
      });
      expect(call, String(status)).toMatchObject({ failure, status });
    }
    expect(failureOf(new Error("anything"), true)).toEqual({ failure: "timeout" });
  }, 60_000);

  it("takes a reply only in the schema's form", () => {
    const features = [{ id: 0 }, { id: 1 }] as unknown as Parameters<typeof rolesOf>[0];
    expect(rolesOf(features, { L0: "name", L1: "bullet" })).toEqual(["name", "bullet"]);
    expect(rolesOf(features, { L0: "name" })).toBeUndefined();
    expect(rolesOf(features, { L0: "name", L1: "heading" })).toBeUndefined();
    expect(rolesOf(features, { L0: "name", L1: "bullet", L2: "date" })).toBeUndefined();
    expect(rolesOf(features, ["name", "bullet"])).toBeUndefined();
    const schema = schemaOf(features);
    expect(schema.required).toEqual(["L0", "L1"]);
    expect(schema.properties.L0?.enum).toEqual([...ROLES]);
  });
});
