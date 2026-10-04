/**
 * How well the rules read a PDF into the resume (item 12), on two of item 3's three sets, with the
 * targets the owner set on 4 October 2026 as the thresholds (docs/milestone-3-overhaul.md, "Done
 * means", "With rules alone"). The third set, the corpus's, is counts only and runs by hand
 * (`spike-pdf corpus`).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resume } from "@resume-tools/resume-model";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { CURATED } from "../templates/curated";
import { generateBody, generateFormat } from "../templates/generate";
import { defaultControls, fontFiles } from "../templates/package";
import { everyWordLands } from "./file";
import { readPdf } from "./node";
import type { PdfReading, ReadPdf } from "./read";
import { isPdfRefusal } from "./refusals";
import { type PdfResume, resumeOfPdf } from "./resume";
import { type Score, scoreResume, type Tally } from "./score";

const readOf = (result: PdfReading): ReadPdf => {
  if (isPdfRefusal(result)) throw new Error(`refused: ${result.reason}`);
  return result;
};

const share = (tally: Tally) => (tally.total === 0 ? 1 : tally.right / tally.total);
const sum = (tallies: readonly Tally[]): Tally => ({
  total: tallies.reduce((total, each) => total + each.total, 0),
  right: tallies.reduce((right, each) => right + each.right, 0),
});

describe.skipIf(!engineAvailable())("the built-in templates' PDFs, read back by rules", () => {
  /** Each template's PDF of each curated sample, read back, with its truth and its score. */
  const read = new Map<string, { truth: Resume; reading: PdfResume; score: Score }>();
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
        const reading = await resumeOfPdf(readOf(await readPdf(pdf.pdf)));
        read.set(`${pkg.id}--${id}`, {
          truth: sample,
          reading,
          score: scoreResume(sample, reading.filed.resume),
        });
      }
    }
  }, 120_000);

  const all = () => [...read.entries()];

  it("reads nine PDFs, every word of each landing, none in the catch-all", () => {
    expect(read.size).toBe(9);
    for (const [id, { reading }] of all()) {
      expect(reading.labels.by, id).toBe("rules");
      expect(everyWordLands(reading.filed.words), id).toBe(true);
      expect(reading.filed.words.unfiled, id).toBe(0);
    }
  });

  it("gives back the name, email, phone, links, section titles and roles, and bullets exactly", () => {
    for (const [id, { score }] of all()) {
      expect(
        score.fields.filter((field) => !field.right && field.kind !== "entry title"),
        id,
      ).toEqual([]);
      expect(score.headerExact, id).toBe(true);
      expect(score.sectionsExact, id).toBe(true);
      expect(score.bulletsExact, id).toBe(true);
    }
  });

  it("gets at least 95% of entries' title, place and dates right, title and subtitle a pair", () => {
    const entries = sum(all().map(([, { score }]) => score.entriesSwapped));
    expect(entries.total).toBe(45);
    expect(share(entries)).toBeGreaterThanOrEqual(0.95);
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

describe("invented resumes from other tools, read by rules", () => {
  const fixtures = readdirSync(OTHER_DIR).sort();
  const scores = new Map<string, Score>();

  beforeAll(async () => {
    for (const name of fixtures) {
      const folder = join(OTHER_DIR, name);
      const truth = Resume.parse(JSON.parse(readFileSync(join(folder, "truth.json"), "utf8")));
      const reading = await resumeOfPdf(
        readOf(await readPdf(new Uint8Array(readFileSync(join(folder, "resume.pdf"))))),
      );
      expect(everyWordLands(reading.filed.words), name).toBe(true);
      scores.set(name, scoreResume(truth, reading.filed.resume));
    }
  }, 60_000);

  it("reads the eight, every word of each landing", () => {
    expect(fixtures).toHaveLength(8);
    expect(scores.size).toBe(8);
  });

  it("gets at least 80% of their fields right", () => {
    const fields = sum([...scores.values()].map((score) => score.all));
    expect(fields.total).toBe(211);
    expect(share(fields)).toBeGreaterThanOrEqual(0.8);
  });
});
