import { expect, it, vi } from "vitest";
import { analyzeResume } from "./client";
import { samplePdf } from "./sample-pdf";

// As if a Content-Security-Policy forbade the code Ajv generates.
vi.mock("./contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./contract")>()),
  prepareValidators: () => {
    throw new EvalError("Refused to evaluate a string as JavaScript");
  },
}));

it("uploads nothing when the reply could not be validated", async () => {
  let sent = false;
  const fetch: typeof globalThis.fetch = async () => {
    sent = true;
    return new Response("{}");
  };
  const result = await analyzeResume(samplePdf(), { baseUrl: "http://ats.test", fetch });
  expect(result).toEqual({ ok: false, failure: { kind: "not-configured" } });
  expect(sent).toBe(false);
});
