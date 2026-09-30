import { DEFAULT_MODEL } from "@resume-tools/naming/providers";
import { describe, expect, test } from "vitest";
import { KEY_VARIABLE, type NamingEnv, namingModel } from "./config";

// No test here calls a provider: a model is made, and never asked. Every key is invented.

describe("the service's model", () => {
  test("is none without a key, so that the route answers from the cache alone", () => {
    expect(namingModel({})).toBeUndefined();
    expect(namingModel({ SOCLAAS_API_KEY: "  ", NAMING_MODEL: "qwen3.6:35b" })).toBeUndefined();
  });

  test("takes its key from SOCLAAS_API_KEY alone, the runner's name, and its id from NAMING_MODEL", () => {
    expect(KEY_VARIABLE).toBe("SOCLAAS_API_KEY");
    expect(namingModel({ SOCLAAS_API_KEY: "invented-key" })).toMatchObject({
      modelId: DEFAULT_MODEL,
    });
    expect(
      namingModel({
        SOCLAAS_API_KEY: "invented-key",
        NAMING_MODEL: " qwen3.6:35b ",
      }),
    ).toMatchObject({ modelId: "qwen3.6:35b" });
    // The service's own name for it is gone: one key, one variable.
    expect(namingModel({ NAMING_API_KEY: "invented-key" } as NamingEnv)).toBeUndefined();
  });

  test("refuses an id no stored answer's source could name, and a key that is not one line, never saying the key", () => {
    expect(() => namingModel({ NAMING_MODEL: "an id with spaces" })).toThrow(
      "NAMING_MODEL is not a model's id: letters, digits and ._:/@- only",
    );
    for (const key of ["invented key", "invented-\nkey"]) {
      let message = "";
      try {
        namingModel({ SOCLAAS_API_KEY: key });
      } catch (error) {
        message = error instanceof Error ? error.message : "";
      }
      expect(message).toBe("SOCLAAS_API_KEY holds a space or a line break: set it on one line");
    }
  });
});
