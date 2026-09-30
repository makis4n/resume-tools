# 0036. The naming step runs on SoCLaaS

Date: 2026-09-30 · Status: accepted; amends 0027 and 0028

## Context

Decision 0027 put the naming step on Gemini, `gemini-3.8-flash` by default, with its key in
`GOOGLE_GENERATIVE_AI_API_KEY`, and left milestone 3's item 18 to benchmark Gemini against a
Claude model. We will use SoCLaaS instead: the School of Computing's LLM gateway for its students
and staff, OpenAI-compatible, serving open models on the school's own servers, and billing
nothing. Its reference prices count only toward a key's limits: 90 requests a minute, and $80 a
day and $800 a month at those prices. With cost gone, only the answers' quality and their speed
tell the candidates apart; the naming service gives a call two minutes (decision 0028).

## Decision

- `packages/naming/src/providers.ts` makes the model with `soclaasModel(key, id)`, the AI SDK's
  OpenAI-compatible provider (`@ai-sdk/openai-compatible`) at
  `https://soclaas-api.comp.nus.edu.sg/v1`, over chat completions, with the answer's schema sent
  as a JSON schema response format. `name` validates the answer whatever the gateway does with it.
- The key is `SOCLAAS_API_KEY` for all three readers: the dev server's naming route, the Pages
  Function and `corpus name --model`. The Gemini names are no longer read.
- The default model is `qwen3.8:27b`, the gateway's all-round model, until item 18's benchmark of
  `qwen3.8:27b`, `qwen3.6:35b` and `qwen3-coder-next` picks the highest editable rate whose
  slowest part fits the service's two minutes. `NAMING_MODEL` still picks any id, and each
  model's answers keep their own cache folder.
- `googleModel` stays in the package, unused, as the fallback should the public launch not use
  the school's gateway.
- The runner's price table gives the candidates the gateway's reference prices, so the cost it
  prints is what the same tokens would count toward the key's limits.

## Consequences

- What leaves the browser is unchanged: template code with placeholders, never the resume's text
  (decision 0033). It now goes to the school's servers instead of Google's.
- Whether the gateway enforces the JSON schema, and how a Qwen model's reasoning comes back, is
  not yet known: no key has made a call. Item 18 checks both before its benchmark.
- A key belongs to one SoC account, and every import that misses the cache counts against it.
  The public launch (milestone 5) needs the school's leave to run the naming service on it, or
  moves to Gemini's paid tier.
- A key set as `GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY` now does nothing; the dev
  server says it serves the cache alone.
