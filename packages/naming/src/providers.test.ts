import { describe, expect, test } from "vitest";
import { DEFAULT_MODEL, googleModel } from "./providers";

// No test here calls a provider: a model is made, and never asked.

describe("Gemini's model", () => {
  test("is made by its id, the current free-tier Flash when none is given, with the key given", () => {
    const model = googleModel("invented-key");
    expect(DEFAULT_MODEL).toBe("gemini-3.8-flash");
    expect(model).toMatchObject({ modelId: DEFAULT_MODEL, specificationVersion: "v4" });
    expect(String((model as { provider: string }).provider)).toMatch(/^google/);
    expect(googleModel("invented-key", "gemini-3.7-flash")).toMatchObject({
      modelId: "gemini-3.7-flash",
    });
  });

  test("needs a key, and never falls back on one of the environment's", () => {
    expect(() => googleModel("")).toThrow("Gemini's model needs an API key");
    expect(() => googleModel("   ")).toThrow("Gemini's model needs an API key");
  });
});
