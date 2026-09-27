import { DEFAULT_MODEL } from "@resume-tools/naming/providers";
import { describe, expect, test } from "vitest";
import { namingModel } from "./config";

// No test here calls a provider: a model is made, and never asked. Every key is invented.

describe("the service's model", () => {
  test("is none without a key, so that the route answers from the cache alone", () => {
    expect(namingModel({})).toBeUndefined();
    expect(namingModel({ NAMING_API_KEY: "  ", NAMING_MODEL: "gemini-3.7-flash" })).toBeUndefined();
  });

  test("takes its key from NAMING_API_KEY, or the provider's own name for it, and its id from NAMING_MODEL", () => {
    expect(namingModel({ NAMING_API_KEY: "invented-key" })).toMatchObject({
      modelId: DEFAULT_MODEL,
    });
    expect(namingModel({ GOOGLE_GENERATIVE_AI_API_KEY: "invented-key" })).toMatchObject({
      modelId: DEFAULT_MODEL,
    });
    expect(
      namingModel({ NAMING_API_KEY: "invented-key", NAMING_MODEL: " gemini-3.7-flash " }),
    ).toMatchObject({ modelId: "gemini-3.7-flash" });
  });

  test("refuses an id no stored answer's source could name, and a key that is not one line, never saying the key", () => {
    expect(() => namingModel({ NAMING_MODEL: "an id with spaces" })).toThrow(
      "NAMING_MODEL is not a model's id: letters, digits and ._:/@- only",
    );
    for (const key of ["invented key", "invented-\nkey"]) {
      let message = "";
      try {
        namingModel({ NAMING_API_KEY: key });
      } catch (error) {
        message = error instanceof Error ? error.message : "";
      }
      expect(message).toBe(
        "The naming model's key holds a space or a line break: set it on one line",
      );
    }
  });
});
