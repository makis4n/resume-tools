import { describe, expect, test } from "vitest";
import type { ImportJob, ImportReport } from "../import/run";
import { PackageRefused, type StoredTemplate } from "../storage/store";
import { curated } from "./curated";
import type { TemplatePackage } from "./package";
import { resolveTemplate, type TemplateStore } from "./resolve";

// An imported template here is Jake's package under an invented imported id, with an invented job.

const ID = "import-0123456789ab";
const IMPORTED = { ...curated("jake").package, id: ID } as TemplatePackage;
const JOB: ImportJob = { files: { "photo.png": new Uint8Array([1]) }, images: ["photo.png"] };
/** The import's report, which only its identity matters to here. */
const REPORT = { engine: "pdftex", compiles: 3 } as unknown as ImportReport;

/** A store that keeps the one imported template, with the document `doc-1`'s import, and notes what it is asked. */
function storeOf(asked: string[]): TemplateStore {
  return {
    templateOf: async (id, document) => {
      asked.push(`${id} ${document ?? ""}`);
      if (id !== ID) return undefined;
      const found: StoredTemplate = { package: IMPORTED };
      return document === "doc-1"
        ? { ...found, import: { upload: { files: [] }, job: JOB, report: REPORT, made: 0 } }
        : found;
    },
  };
}

describe("resolveTemplate", () => {
  test("gives a curated template from the map, and never asks the store", async () => {
    const asked: string[] = [];
    expect(await resolveTemplate("jake", "doc-1", storeOf(asked))).toEqual({
      package: curated("jake").package,
    });
    expect(asked).toEqual([]);
  });

  test("gives an imported template from the store, with the document's own job and report", async () => {
    const asked: string[] = [];
    const store = storeOf(asked);
    const found = await resolveTemplate(ID, "doc-1", store);
    expect(found).toEqual({ package: IMPORTED, job: JOB, report: REPORT });
    // The report as the store keeps it, which names the document's locked parts (decision 0041).
    expect(found?.report).toBe(REPORT);
    expect(await resolveTemplate(ID, "doc-2", store)).toEqual({ package: IMPORTED });
    expect(asked).toEqual([`${ID} doc-1`, `${ID} doc-2`]);
  });

  test("gives none for an id neither has, asking the store only under the imported prefix", async () => {
    const asked: string[] = [];
    const store = storeOf(asked);
    expect(await resolveTemplate("later-template", "doc-1", store)).toBeUndefined();
    expect(await resolveTemplate("import-ba9876543210", "doc-1", store)).toBeUndefined();
    expect(await resolveTemplate(ID, "doc-1")).toBeUndefined();
    expect(asked).toEqual(["import-ba9876543210 doc-1"]);
  });

  test("passes on the store's refusal", async () => {
    const refusing: TemplateStore = {
      templateOf: async (id) => {
        throw new PackageRefused(id, "the package's schema refuses it");
      },
    };
    await expect(resolveTemplate(ID, "doc-1", refusing)).rejects.toBeInstanceOf(PackageRefused);
  });
});
