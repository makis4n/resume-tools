import { CLAUDE_MODEL, DEFAULT_MODEL } from "@resume-tools/naming/providers";
import { describe, expect, test } from "vitest";
import {
  CLAUDE_KEY_VARIABLE,
  CLAUDE_MODEL_VARIABLE,
  isClaude,
  KEY_VARIABLE,
  LABEL_MODEL_VARIABLE,
  labelModels,
} from "./config";

// No test here calls a provider: a model is made, and never asked. Every key is invented.

describe("the label route's models", () => {
  test("are none without a key, so that the route refuses and the page's rules read the PDF", () => {
    expect(labelModels({})).toEqual({ model: undefined, fallback: undefined });
    expect(
      labelModels({ SOCLAAS_API_KEY: " ", ANTHROPIC_API_KEY: "", PDF_LABEL_MODEL: "qwen3.6:35b" }),
    ).toEqual({ model: undefined, fallback: undefined });
  });

  test("ask Claude first and SoCLaaS behind it, each by its key and its id", () => {
    expect([KEY_VARIABLE, CLAUDE_KEY_VARIABLE]).toEqual(["SOCLAAS_API_KEY", "ANTHROPIC_API_KEY"]);
    expect([LABEL_MODEL_VARIABLE, CLAUDE_MODEL_VARIABLE]).toEqual([
      "PDF_LABEL_MODEL",
      "PDF_LABEL_CLAUDE_MODEL",
    ]);
    const both = labelModels({
      SOCLAAS_API_KEY: "invented-key",
      ANTHROPIC_API_KEY: "invented-key",
    });
    expect(both.model).toMatchObject({ modelId: CLAUDE_MODEL });
    expect(both.fallback).toMatchObject({ modelId: DEFAULT_MODEL });
    const named = labelModels({
      SOCLAAS_API_KEY: "invented-key",
      ANTHROPIC_API_KEY: "invented-key",
      PDF_LABEL_MODEL: " qwen3.6:35b ",
      PDF_LABEL_CLAUDE_MODEL: "claude-sonnet-5-5",
    });
    expect(named.model).toMatchObject({ modelId: "claude-sonnet-5-5" });
    expect(named.fallback).toMatchObject({ modelId: "qwen3.6:35b" });
  });

  test("ask the one model whose key is set, with no fallback", () => {
    const soclaas = labelModels({ SOCLAAS_API_KEY: "invented-key" });
    expect(soclaas.model).toMatchObject({ modelId: DEFAULT_MODEL });
    expect(soclaas.fallback).toBeUndefined();
    const claude = labelModels({ ANTHROPIC_API_KEY: "invented-key" });
    expect(claude.model).toMatchObject({ modelId: CLAUDE_MODEL });
    expect(claude.fallback).toBeUndefined();
  });

  test("refuse an id that is not one, and a key that is not one line, never saying the key", () => {
    expect(() => labelModels({ PDF_LABEL_MODEL: "an id with spaces" })).toThrow(
      "PDF_LABEL_MODEL is not a model's id",
    );
    expect(() => labelModels({ PDF_LABEL_CLAUDE_MODEL: "an id with spaces" })).toThrow(
      "PDF_LABEL_CLAUDE_MODEL is not a model's id",
    );
    for (const variable of [KEY_VARIABLE, CLAUDE_KEY_VARIABLE]) {
      let message = "";
      try {
        labelModels({ [variable]: "invented secret-key" });
      } catch (error) {
        message = error instanceof Error ? error.message : "";
      }
      expect(message).toBe(`${variable} holds a space or a line break: set it on one line`);
    }
  });

  test("refuse a variable that names the other provider's model", () => {
    expect(() => labelModels({ PDF_LABEL_MODEL: "claude-haiku-5-5" })).toThrow(
      "PDF_LABEL_MODEL names SoCLaaS's model: set a Claude model as PDF_LABEL_CLAUDE_MODEL",
    );
    expect(() => labelModels({ PDF_LABEL_CLAUDE_MODEL: DEFAULT_MODEL })).toThrow(
      "PDF_LABEL_CLAUDE_MODEL names a Claude model",
    );
  });

  test("tell a Claude model by its id, for pdf-model", () => {
    expect(isClaude("claude-haiku-5-5")).toBe(true);
    expect(isClaude(DEFAULT_MODEL)).toBe(false);
  });
});
