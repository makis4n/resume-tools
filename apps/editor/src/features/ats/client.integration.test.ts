import { describe, expect, it } from "vitest";
import { analyzeResume } from "./client";
import { samplePdf } from "./sample-pdf";

// Runs against a live ATS service when ATS_INTEGRATION_URL is set, for example:
//   (cd apps/ats && uv run ats-serve)
//   ATS_INTEGRATION_URL=http://localhost:8000 pnpm --filter @resume-tools/editor test
const baseUrl = process.env.ATS_INTEGRATION_URL;

describe.skipIf(!baseUrl)("analyzeResume against the ATS service", () => {
  it("gets a schema-valid analysis for a PDF", async () => {
    const result = await analyzeResume(samplePdf(), { baseUrl });
    expect(result.ok).toBe(true);
  });

  it("gets the contract's error for something that is not a PDF", async () => {
    const notPdf = new Blob(["plain text"], { type: "application/pdf" });
    const result = await analyzeResume(notPdf, { baseUrl });
    expect(result).toMatchObject({ ok: false, failure: { kind: "service", code: "not-a-pdf" } });
  });
});
