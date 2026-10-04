/**
 * How well a PDF reads, tracked (milestone 3 second pass, items 12 and 15): item 3's two sets with
 * a truth, read as the editor reads a PDF, with the targets the owner set on 4 October 2026 as the
 * thresholds, exactly (docs/milestone-3-overhaul.md, "Done means", "For a PDF import"):
 *
 * - by rules, the built-in templates' round trip: every word read lands; the name, email, phone,
 *   links, section titles and roles, and bullets come back exactly; at least 95% of entries have
 *   the right title, place and dates, an entry's title and subtitle counted as a pair;
 * - by rules, the invented resumes from other tools: at least 80% of fields right;
 * - by rules, under 1 s a PDF, pdf.js's reading with them, in the CPU time of this thread
 *   (`src/test/timing.ts`), a ceiling no load on the machine can reach;
 * - with the model, the other tools' PDFs read through the page's labeller and the service's route
 *   from the model's recorded replies (`fixtures/model-replies.json`, roles by line id, no text):
 *   at least 90% of fields right, with `fetch` stubbed so that nothing reaches a network.
 *
 * The third set, the corpus's, is counts only and runs by hand (`pdf-corpus`), as the model's
 * reading with the key does (`pdf-model`); no model is called here.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resume } from "@resume-tools/resume-model";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { handleLabel, LABEL_LIMITS } from "../service/label";
import { MemoryRateStore } from "../service/rate";
import { CURATED } from "../templates/curated";
import { generateBody, generateFormat } from "../templates/generate";
import { defaultControls, fontFiles } from "../templates/package";
import { cpuMsAsync } from "../test/timing";
import { memoryConsent } from "./consent";
import { everyWordLands } from "./file";
import { modelLabeller } from "./model-labeller";
import { readPdf } from "./node";
import type { PdfReading, ReadPdf } from "./read";
import { isPdfRefusal } from "./refusals";
import { type PdfResume, resumeOfPdf } from "./resume";
import { type Score, scoreResume, type Tally } from "./score";

/** The owner's targets, as fractions and milliseconds. */
const TARGETS = {
  builtinEntries: 0.95,
  otherRules: 0.8,
  otherModel: 0.9,
  rulesMs: 1_000,
} as const;

const readOf = (result: PdfReading): ReadPdf => {
  if (isPdfRefusal(result)) throw new Error(`refused: ${result.reason}`);
  return result;
};

const share = (tally: Tally) => (tally.total === 0 ? 1 : tally.right / tally.total);
const sum = (tallies: readonly Tally[]): Tally => ({
  total: tallies.reduce((total, each) => total + each.total, 0),
  right: tallies.reduce((right, each) => right + each.right, 0),
});
const said = (tally: Tally) =>
  `${tally.right}/${tally.total} (${(100 * share(tally)).toFixed(1)}%)`;

/** Read a PDF by rules as the editor does, and the CPU time its reading and the rules took. */
async function readByRules(bytes: Uint8Array): Promise<{ reading: PdfResume; cpuMs: number }> {
  let reading: PdfResume | undefined;
  const cpuMs = await cpuMsAsync(async () => {
    reading = await resumeOfPdf(readOf(await readPdf(bytes)));
  });
  if (reading === undefined) throw new Error("no reading");
  return { reading, cpuMs };
}

describe.skipIf(!engineAvailable())("the built-in templates' PDFs, read back by rules", () => {
  /** Each template's PDF of each curated sample, read back, with its truth and its score. */
  const read = new Map<
    string,
    { truth: Resume; reading: PdfResume; score: Score; cpuMs: number }
  >();
  let engine: Awaited<ReturnType<typeof startNodeSession>>;
  const manifest = (): EngineManifest =>
    JSON.parse(readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8")) as EngineManifest;

  beforeAll(async () => {
    engine = await startNodeSession();
    const fonts = new FontLibrary(new TexLiveIndex(manifest()), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    const samples = [...CURATED.values()].map(({ package: pkg, sample }) => ({
      id: pkg.id,
      sample,
    }));
    for (const { package: pkg } of CURATED.values()) {
      const values = defaultControls(pkg);
      const files = fontFiles(pkg);
      const covers = files.length === 0 ? undefined : (await fonts.coverage(files)).covers;
      const format = generateFormat(pkg, values);
      expect(engine.dump(pkg.engine, format.name, format.preamble, format.files).ok).toBe(true);
      for (const { id, sample } of samples) {
        const job = `round-trip-${pkg.id}`;
        engine.forget(job);
        const body = generateBody(pkg, sample, values, covers === undefined ? {} : { covers });
        const result = engine.compile(pkg.engine, format.name, body.latex, { job, maxPasses: 3 });
        expect(result.ok, `${pkg.id} with ${id}'s sample`).toBe(true);
        const pdf = engine.pdf(job);
        if (!pdf.ok || pdf.pdf === undefined) throw new Error(`${pkg.id} made no PDF`);
        const { reading, cpuMs } = await readByRules(pdf.pdf);
        read.set(`${pkg.id}--${id}`, {
          truth: sample,
          reading,
          score: scoreResume(sample, reading.filed.resume),
          cpuMs,
        });
      }
    }
    const all = [...read.values()];
    console.log(
      `built-in templates by rules: fields ${said(sum(all.map(({ score }) => score.all)))}; entries as a pair ${said(sum(all.map(({ score }) => score.entriesSwapped)))}, title alone ${said(sum(all.map(({ score }) => score.entries)))}; CPU time a PDF at most ${Math.round(Math.max(...all.map(({ cpuMs }) => cpuMs)))} ms`,
    );
  }, 120_000);

  const all = () => [...read.entries()];

  it("reads nine PDFs, every word read of each landing in the resume", () => {
    expect(read.size).toBe(9);
    for (const [id, { reading }] of all()) {
      expect(reading.labels.by, id).toBe("rules");
      expect(everyWordLands(reading.filed.words), id).toBe(true);
    }
  });

  it("gives back the name, email, phone, links, section titles and roles, and bullets exactly", () => {
    for (const [id, { score }] of all()) {
      const wrong = (kinds: readonly string[]) =>
        score.fields.filter((field) => kinds.includes(field.kind) && !field.right);
      expect(wrong(["name", "email", "phone", "link"]), id).toEqual([]);
      expect(wrong(["section title", "section role"]), id).toEqual([]);
      expect(wrong(["bullet"]), id).toEqual([]);
      expect(score.headerExact && score.sectionsExact && score.bulletsExact, id).toBe(true);
    }
  });

  it("gets at least 95% of entries' title, place and dates right, title and subtitle a pair", () => {
    const entries = sum(all().map(([, { score }]) => score.entriesSwapped));
    expect(entries.total).toBe(45);
    expect(share(entries)).toBeGreaterThanOrEqual(TARGETS.builtinEntries);
  });

  it("reads each PDF by rules in under 1 s, pdf.js's reading with them, in CPU time", () => {
    for (const [id, { cpuMs }] of all()) expect(cpuMs, id).toBeLessThan(TARGETS.rulesMs);
  });

  it("files a resume each template typesets again", () => {
    for (const [id, { reading }] of all()) {
      const pkg = CURATED.get(id.slice(0, id.indexOf("--")))?.package;
      if (pkg === undefined) throw new Error(`no template for ${id}`);
      const values = defaultControls(pkg);
      const format = generateFormat(pkg, values);
      expect(engine.dump(pkg.engine, format.name, format.preamble, format.files).ok).toBe(true);
      const body = generateBody(pkg, Resume.parse(reading.filed.resume), values);
      const job = `round-trip-again-${pkg.id}`;
      engine.forget(job);
      expect(
        engine.compile(pkg.engine, format.name, body.latex, { job, maxPasses: 3 }).ok,
        id,
      ).toBe(true);
    }
  }, 120_000);
});

/** The invented resumes printed by other tools, with their truths (decision 0051). */
const OTHER_DIR = fileURLToPath(
  new URL("../../scripts/spike-pdf/fixtures/other/", import.meta.url),
);
const OTHER = readdirSync(OTHER_DIR).sort();
/** The two the rules were not tuned on (decision 0051), reported apart. */
const HELD_OUT = new Set(["chrome-right-sidebar", "textutil-table"]);

const otherPdf = (name: string) =>
  new Uint8Array(readFileSync(join(OTHER_DIR, name, "resume.pdf")));
const otherTruth = (name: string) =>
  Resume.parse(JSON.parse(readFileSync(join(OTHER_DIR, name, "truth.json"), "utf8")));

describe("invented resumes from other tools, read by rules", () => {
  const read = new Map<string, { reading: PdfResume; score: Score; cpuMs: number }>();

  beforeAll(async () => {
    for (const name of OTHER) {
      const { reading, cpuMs } = await readByRules(otherPdf(name));
      read.set(name, {
        reading,
        score: scoreResume(otherTruth(name), reading.filed.resume),
        cpuMs,
      });
    }
    const of = (held: boolean) =>
      sum(
        [...read].filter(([name]) => HELD_OUT.has(name) === held).map(([, { score }]) => score.all),
      );
    console.log(
      `other tools by rules: fields ${said(sum([...read.values()].map(({ score }) => score.all)))}; debugged on ${said(of(false))}, held out ${said(of(true))}; CPU time a PDF at most ${Math.round(Math.max(...[...read.values()].map(({ cpuMs }) => cpuMs)))} ms`,
    );
  }, 60_000);

  it("reads the eight, every word read of each landing in the resume", () => {
    expect(OTHER).toHaveLength(8);
    expect(read.size).toBe(8);
    for (const [name, { reading }] of read) {
      expect(reading.labels.by, name).toBe("rules");
      expect(everyWordLands(reading.filed.words), name).toBe(true);
    }
  });

  it("gets at least 80% of their fields right", () => {
    const fields = sum([...read.values()].map(({ score }) => score.all));
    expect(fields.total).toBe(211);
    expect(share(fields)).toBeGreaterThanOrEqual(TARGETS.otherRules);
  });

  it("reads each PDF by rules in under 1 s, pdf.js's reading with them, in CPU time", () => {
    for (const [name, { cpuMs }] of read) expect(cpuMs, name).toBeLessThan(TARGETS.rulesMs);
  });
});

/** The model's recorded replies on the other tools' PDFs: the roles by line id, no text. */
const RECORDED = fileURLToPath(new URL("./fixtures/model-replies.json", import.meta.url));

describe("invented resumes from other tools, read with the model's recorded replies", () => {
  const recorded = JSON.parse(readFileSync(RECORDED, "utf8")) as {
    model: string;
    replies: Record<string, string>;
  };
  /** Stands in for the platform's `fetch`: nothing here may reach a network. */
  const network = vi.fn(async () => {
    throw new Error("nothing may be sent");
  });
  const scores = new Map<string, Score>();
  const calls = new Map<string, number>();

  beforeAll(async () => {
    vi.stubGlobal("fetch", network);
    for (const name of OTHER) {
      const content = recorded.replies[name];
      if (content === undefined) throw new Error(`no recorded reply for ${name}`);
      const model = new MockLanguageModelV4({
        modelId: recorded.model,
        doGenerate: async () => ({
          content: [{ type: "text", text: content }],
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
      // The page's labeller, with a yes on record, posting to the service's route in this process.
      const labeller = modelLabeller({
        consent: memoryConsent("yes"),
        fetch: (url, init) =>
          handleLabel(new Request(new URL(url, "http://localhost"), init), deps),
      });
      const reading = await resumeOfPdf(readOf(await readPdf(otherPdf(name))), { labeller });
      expect(reading.labels.by, `${name}: ${reading.labels.fallback}`).toBe("model");
      expect(everyWordLands(reading.filed.words), name).toBe(true);
      scores.set(name, scoreResume(otherTruth(name), reading.filed.resume));
      calls.set(name, model.doGenerateCalls.length);
    }
    console.log(
      `other tools with ${recorded.model}'s recorded replies: fields ${said(sum([...scores.values()].map((score) => score.all)))}`,
    );
  }, 60_000);

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("asks the recorded model once a PDF, through the route, and sends nothing out", () => {
    expect(scores.size).toBe(8);
    for (const name of OTHER) expect(calls.get(name), name).toBe(1);
    expect(globalThis.fetch).toBe(network);
    expect(network).not.toHaveBeenCalled();
  });

  it("gets at least 90% of their fields right", () => {
    const fields = sum([...scores.values()].map((score) => score.all));
    expect(fields.total).toBe(211);
    expect(share(fields)).toBeGreaterThanOrEqual(TARGETS.otherModel);
  });
});
