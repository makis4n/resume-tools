import { describe, expect, test } from "vitest";
import { DEFAULT_MODEL, GEMINI_MODEL, googleModel, soclaasModel } from "./providers";

// No test here calls a provider: a model is made, and never asked.

/** The message `make` throws with, or undefined when it throws nothing. */
function thrownBy(make: () => unknown): string | undefined {
  try {
    make();
  } catch (thrown) {
    return (thrown as Error).message;
  }
  return undefined;
}

describe("SoCLaaS's model", () => {
  test("is made by its id, the gateway's all-round model when none is given, with the key given", () => {
    const model = soclaasModel("invented-key");
    expect(DEFAULT_MODEL).toBe("qwen3.8:27b");
    expect(model).toMatchObject({ modelId: DEFAULT_MODEL, specificationVersion: "v4" });
    expect(String((model as { provider: string }).provider)).toMatch(/^soclaas/);
    expect(soclaasModel("invented-key", "qwen3.6:35b")).toMatchObject({ modelId: "qwen3.6:35b" });
  });

  test("needs a key, and never falls back on one of the environment's", () => {
    expect(() => soclaasModel("")).toThrow("SoCLaaS's model needs an API key");
    expect(() => soclaasModel("   ")).toThrow("SoCLaaS's model needs an API key");
  });

  test("refuses a key that is not one word, and never says what it is", () => {
    for (const key of ["invented-key\n# a second line", "invented key"]) {
      const message = thrownBy(() => soclaasModel(key));
      expect(message).toBe("SoCLaaS's key is one line with no spaces");
      expect(message).not.toContain("invented");
    }
  });
});

describe("Gemini's model", () => {
  test("is made by its id, 3.8 Flash when none is given, with the key given", () => {
    const model = googleModel("invented-key");
    expect(GEMINI_MODEL).toBe("gemini-3.8-flash");
    expect(model).toMatchObject({ modelId: GEMINI_MODEL, specificationVersion: "v4" });
    expect(String((model as { provider: string }).provider)).toMatch(/^google/);
    expect(googleModel("invented-key", "gemini-3.7-flash")).toMatchObject({
      modelId: "gemini-3.7-flash",
    });
  });

  test("needs a key, and refuses one that is not one word without saying what it is", () => {
    expect(() => googleModel("")).toThrow("Gemini's model needs an API key");
    const message = thrownBy(() => googleModel("invented key"));
    expect(message).toBe("Gemini's key is one line with no spaces");
    expect(message).not.toContain("invented");
  });
});
