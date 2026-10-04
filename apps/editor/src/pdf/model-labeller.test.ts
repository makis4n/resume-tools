import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resume } from "@resume-tools/resume-model";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { handleLabel, LABEL_LIMITS } from "../service/label";
import { LABEL_ROUTE, LabelRequest } from "../service/label-contract";
import { MemoryRateStore } from "../service/rate";
import { browserConsent, memoryConsent, type StorageLike } from "./consent";
import { fileLines } from "./file";
import { featuresOf, labelByRules, labelLines } from "./label";
import { layOut } from "./layout";
import { type FetchLike, MODEL_BUDGET_MS, modelLabeller } from "./model-labeller";
import { readPdf } from "./node";
import type { ReadPdf, TextRun } from "./read";
import { isPdfRefusal } from "./refusals";
import { resumeOfPdf } from "./resume";
import { scoreResume } from "./score";

function run(text: string, x: number, baseline: number, options: Partial<TextRun> = {}): TextRun {
  const size = options.size ?? 10;
  return {
    text,
    x,
    baseline,
    size,
    width: options.width ?? 0.5 * size * text.length,
    font: options.font ?? "Invented-Regular",
    bold: options.bold ?? false,
    italic: options.italic ?? false,
  };
}

/** An invented resume, as a page sets it. */
const read: ReadPdf = {
  pages: [
    {
      number: 1,
      width: 612,
      height: 792,
      runs: [
        run("Tamsin Orlovane", 200, 60, { size: 22, bold: true }),
        run("tamsin@example.invalid", 230, 85),
        run("EXPERIENCE", 50, 120, { size: 12, bold: true }),
        run("Bellfounder", 50, 140, { bold: true }),
        run("Apr 2017 – Present", 480, 140),
        run("•", 55, 160),
        run("Cast eleven bells for the harbour chapels.", 65, 160),
      ],
      links: [],
      marks: [],
    },
  ],
  ms: 0,
};

const layout = layOut(read);
const RULES = labelByRules(layout);
/** The roles the stand-in service answers: the rules', but the date called a place. */
const MODEL_ROLES = RULES.map((role) => (role === "date" ? "place" : role));

/** A `fetch` that answers as the service would, and keeps every call. */
function service(answer: (init: RequestInit) => Response | Promise<Response>) {
  const calls: { input: string; init: RequestInit }[] = [];
  const fetch: FetchLike = async (input, init) => {
    calls.push({ input, init });
    return answer(init);
  };
  return { fetch, calls };
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

/** A `fetch` that answers only when its signal stops it, as a gateway that hangs does. */
const hanging = () =>
  service(
    (init) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );

describe("the hosted model's labeller and the person's answer", () => {
  it("nothing is sent to the model before a yes", async () => {
    // No answer yet, an answer of no, and a browser whose storage holds nothing or refuses.
    const refusing: StorageLike = {
      getItem: () => {
        throw new Error("storage refused");
      },
      setItem: () => {
        throw new Error("storage refused");
      },
    };
    const stores = [
      memoryConsent(),
      memoryConsent("no"),
      browserConsent(() => undefined),
      browserConsent(() => refusing),
      browserConsent(() => ({ getItem: () => "maybe", setItem: () => undefined })),
    ];
    for (const consent of stores) {
      const { fetch, calls } = service(() => ok({ roles: MODEL_ROLES }));
      const labels = await labelLines(layout, modelLabeller({ consent, fetch }));
      expect(labels).toEqual({ roles: RULES, by: "rules", fallback: "no consent" });
      const { filed } = await resumeOfPdf(read, { labeller: modelLabeller({ consent, fetch }) });
      expect(filed.resume.header.name).toEqual(fileLines(layout, RULES).resume.header.name);
      expect(calls).toHaveLength(0);
    }
  });

  it("nothing is sent after the setting is turned off", async () => {
    const consent = memoryConsent("yes");
    const { fetch, calls } = service(() => ok({ roles: MODEL_ROLES }));
    const labeller = modelLabeller({ consent, fetch });
    expect(await labelLines(layout, labeller)).toEqual({ roles: MODEL_ROLES, by: "model" });
    expect(calls).toHaveLength(1);
    // The setting turned off: the next import sends nothing, the same labeller and all.
    consent.set("no");
    expect(await labelLines(layout, labeller)).toEqual({
      roles: RULES,
      by: "rules",
      fallback: "no consent",
    });
    expect(calls).toHaveLength(1);
  });

  it("sends the lines' text and features alone, to the editor's own route, and takes the roles", async () => {
    const { fetch, calls } = service(() => ok({ roles: MODEL_ROLES }));
    const labels = await labelLines(
      layout,
      modelLabeller({ consent: memoryConsent("yes"), fetch }),
    );
    expect(labels).toEqual({ roles: MODEL_ROLES, by: "model" });
    expect(calls).toHaveLength(1);
    const [{ input, init } = { input: "", init: {} }] = calls;
    expect(input).toBe(LABEL_ROUTE);
    expect(LABEL_ROUTE).toBe("/v1/label");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body)).toEqual(["lines"]);
    expect(body.lines).toEqual(featuresOf(layout));
    expect(LabelRequest.safeParse(body).success).toBe(true);
  });
});

describe("the rules answer in the model's place, for each cause", () => {
  const yes = memoryConsent("yes");
  const rulesFor = (fallback: string) => ({ roles: RULES, by: "rules", fallback });

  it("a request that fails: no network, or a refusal from the service", async () => {
    const offline = service(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await labelLines(layout, modelLabeller({ consent: yes, fetch: offline.fetch }))).toEqual(
      rulesFor("failed"),
    );
    for (const status of [400, 413, 429, 500, 502, 503]) {
      const refusing = service(() => new Response('{"error":"refused"}', { status }));
      expect(
        await labelLines(layout, modelLabeller({ consent: yes, fetch: refusing.fetch })),
        String(status),
      ).toEqual(rulesFor("failed"));
    }
  });

  it("a reply of the wrong form", async () => {
    const replies = [
      () => new Response('{"error":"invalid"}', { status: 422 }),
      () => new Response("not json", { status: 200 }),
      () => ok({ roles: MODEL_ROLES.slice(1) }),
      () => ok({ roles: [...MODEL_ROLES.slice(1), "heading"] }),
      () => ok({ roles: MODEL_ROLES, extra: true }),
      () => ok(MODEL_ROLES),
    ];
    for (const reply of replies) {
      const { fetch } = service(reply);
      expect(await labelLines(layout, modelLabeller({ consent: yes, fetch }))).toEqual(
        rulesFor("wrong form"),
      );
    }
  });

  it("a call past its time budget, 15 s by default, or the service's own timeout", async () => {
    expect(MODEL_BUDGET_MS).toBe(15_000);
    const { fetch, calls } = hanging();
    const started = performance.now();
    expect(await labelLines(layout, modelLabeller({ consent: yes, fetch, budgetMs: 30 }))).toEqual(
      rulesFor("timeout"),
    );
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(calls[0]?.init.signal?.aborted).toBe(true);
    const late = service(() => new Response('{"error":"late"}', { status: 504 }));
    expect(await labelLines(layout, modelLabeller({ consent: yes, fetch: late.fetch }))).toEqual(
      rulesFor("timeout"),
    );
  });

  it("a stop the caller asks for is the caller's, and no fallback", async () => {
    const { fetch } = hanging();
    const stop = new AbortController();
    const labelling = labelLines(layout, modelLabeller({ consent: yes, fetch }), {
      signal: stop.signal,
    });
    stop.abort();
    await expect(labelling).rejects.toBeDefined();
  });
});

describe("the whole path, with a recorded reply", () => {
  const OTHER = fileURLToPath(new URL("../../scripts/spike-pdf/fixtures/other/", import.meta.url));
  const RECORDED = fileURLToPath(
    new URL("./fixtures/model-reply.chrome-table.json", import.meta.url),
  );

  it("the page's labeller, the route and the model's recorded reply read an invented PDF", async () => {
    const reading = await readPdf(
      new Uint8Array(readFileSync(join(OTHER, "chrome-table", "resume.pdf"))),
    );
    if (isPdfRefusal(reading)) throw new Error("refused");
    const truth = Resume.parse(
      JSON.parse(readFileSync(join(OTHER, "chrome-table", "truth.json"), "utf8")),
    );
    const recorded = JSON.parse(readFileSync(RECORDED, "utf8")) as { content: string };
    const model = new MockLanguageModelV4({
      modelId: "recorded",
      doGenerate: async () => ({
        content: [{ type: "text", text: recorded.content }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: undefined },
          outputTokens: { total: 0, text: 0, reasoning: 0 },
        },
        warnings: [],
      }),
    });
    const deps = {
      model,
      address: "127.0.0.1",
      rates: new MemoryRateStore(),
      limits: LABEL_LIMITS,
      now: () => 0,
    };
    const labeller = modelLabeller({
      consent: memoryConsent("yes"),
      fetch: (url, init) => handleLabel(new Request(new URL(url, "http://localhost"), init), deps),
    });
    const { labels, filed } = await resumeOfPdf(reading, { labeller });
    expect(labels.by).toBe("model");
    expect(model.doGenerateCalls).toHaveLength(1);
    const score = scoreResume(truth, filed.resume);
    expect(score.all.right / score.all.total).toBeGreaterThanOrEqual(0.9);
  }, 60_000);
});
