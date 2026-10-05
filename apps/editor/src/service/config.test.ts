import { DEFAULT_MODEL } from "@resume-tools/naming/providers";
import { describe, expect, test } from "vitest";
import { KEY_VARIABLE, LABEL_MODEL_VARIABLE, labelModel } from "./config";

// No test here calls a provider: a model is made, and never asked. Every key is invented.

describe("the label route's model", () => {
  test("is none without a key, so that the route refuses and the page's rules read the PDF", () => {
    expect(labelModel({})).toBeUndefined();
    expect(labelModel({ SOCLAAS_API_KEY: " ", PDF_LABEL_MODEL: "qwen3.6:35b" })).toBeUndefined();
  });

  test("takes the one key, SOCLAAS_API_KEY, and its id from PDF_LABEL_MODEL or the default", () => {
    expect(KEY_VARIABLE).toBe("SOCLAAS_API_KEY");
    expect(LABEL_MODEL_VARIABLE).toBe("PDF_LABEL_MODEL");
    expect(labelModel({ SOCLAAS_API_KEY: "invented-key" })).toMatchObject({
      modelId: DEFAULT_MODEL,
    });
    expect(
      labelModel({ SOCLAAS_API_KEY: "invented-key", PDF_LABEL_MODEL: " qwen3.6:35b " }),
    ).toMatchObject({ modelId: "qwen3.6:35b" });
  });

  test("refuses an id that is not one, and a key that is not one line, never saying the key", () => {
    expect(() => labelModel({ PDF_LABEL_MODEL: "an id with spaces" })).toThrow(
      "PDF_LABEL_MODEL is not a model's id",
    );
    let message = "";
    try {
      labelModel({ SOCLAAS_API_KEY: "invented secret-key" });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toBe("SOCLAAS_API_KEY holds a space or a line break: set it on one line");
  });
});
