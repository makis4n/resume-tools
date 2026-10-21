# 0109. Claude reads a PDF's lines first, SoCLaaS behind it

Date: 2026-10-21 · Status: accepted, the owner's decision of 21 October 2026, "for now"; amends
0036 and 0056, and the provider of 0103 (proposed, on the milestone 5 plan's branch)

## Context

The route that labels a PDF's lines asks SoCLaaS, the school's gateway, for `qwen3.8:27b`
(decisions 0036, 0044 and 0056), and the milestone 5 plan keeps it for launch (0103). The owner has
$200 of Anthropic API credit and wants it to serve the project without giving up the gateway. They
asked for Claude first and SoCLaaS behind it, with Haiku 5.5 and Sonnet 5.5 measured the way the
gateway's model was (decision 0059).

## Decision

- **Claude is asked first, SoCLaaS when Claude gives no answer.** `labelModels` (`config.ts`)
  makes Claude's model from `ANTHROPIC_API_KEY` and SoCLaaS's from `SOCLAAS_API_KEY`. With both
  set, the route asks Claude, and asks SoCLaaS when Claude fails (a 429, a 5xx, a refused key, no
  network) or answers in a wrong form, within the same 14 s (`limits.modelMs`). A Claude call that
  runs out the time is not followed by a second, since the page's 15 s budget would be spent; the
  rules read the PDF, as before. With one key alone, its model is asked alone, so development
  and the launch can run on either.
- **The model is `claude-haiku-5-5`**, `PDF_LABEL_CLAUDE_MODEL` picking another, which must be a
  Claude id, as `PDF_LABEL_MODEL` must be SoCLaaS's: the route refuses to start otherwise. It is
  asked with its thinking off, as the gateway's model is, and with no temperature, which Claude's
  current models refuse; an older one that takes a temperature (the 3 and 4 families up to 4.6)
  is asked at 0, as the gateway's is. Sonnet 5.5 cannot turn its thinking off, and is asked at its
  lowest setting.
- **Anthropic's API is named in the code**, so `ANTHROPIC_BASE_URL` in the environment, which the
  provider would otherwise follow, never sends the lines or the key elsewhere.
- **The dev server reads Claude's variables as it reads SoCLaaS's**: from the editor's `.env`
  files or the shell, the shell's over the files' (Vite's `loadEnv`), so a key kept in the
  keychain can be given for one run on the command line. The owner chose this over reading
  Claude's from the files alone, knowing that a Claude key exported in a shell profile for other
  tools turns Claude on in development too, and that a line in `.env` cannot turn it off.
- **The provider is the AI SDK's** (`@ai-sdk/anthropic` 4.0.82, a new dependency of
  `packages/naming`), so the label route's one call (`askRoles`) stays the same for both models,
  and the schema goes to the Messages API as a structured output.
- **`pdf-model` measures either**: the model its `--model` flag names, Claude's for an id that
  starts `claude-`, with Claude's key, and `qwen3.8:27b` when none is given; `--thinking` lets a
  Claude model think. It no longer reads `PDF_LABEL_MODEL`, the route's SoCLaaS id.
- **The suite's recorded replies are Haiku's** (`src/pdf/fixtures/model-replies.json`), since it
  answers first.
- **The privacy rule is unchanged** (decision 0047): the consent says a hosted language model reads
  the lines, which stays true. The milestone 5 item that names the provider in the consent and the
  privacy page now names Anthropic first and the school's gateway second.

## Measured

`pdf-model both --passes 3 --model <id>`, 21 October 2026, the key from the keychain, the invented sets alone:

| Model | Other tools: fields right | Held out | Built-in: fields right | A call: median, slowest |
|---|---|---|---|---|
| `claude-haiku-5-5` | 95.7% (202 of 211), each pass | 41 of 48 | 95.7% (330 of 345), each pass | 1.8 to 2.9 s; 9.1 s once, otherwise at most 4.1 s |
| `claude-sonnet-5-5` | 94.8% (200 of 211), each pass | 41 of 48 | 95.7 to 95.9% (330 to 331) | 2.6 to 3.8 s; at most 4.9 s |
| `qwen3.8:27b` (decision 0059, one pass) | 95.7% (202 of 211) | 41 of 48 | 95.7% (330 of 345) | 4.2 and 6.7 s; at most 9.3 s |

Both meet the owner's targets: at least 90% on the other tools' PDFs, every call within 15 s, no
fall back. Haiku is as accurate as the gateway's model and faster; Sonnet misses two more fields,
on one PDF, at about twenty times Haiku's price ($2 and $10 against $0.10 and $0.50 a million
tokens in and out). The fields all three miss are the same, so they are the filing step's and the
layout's, not the labels'.

## Consequences

- An import that reads well costs well under a tenth of a cent on Haiku (a few thousand tokens in,
  a few hundred out), so the credit lasts far beyond any launch's traffic; a call to the gateway
  costs nothing and keeps the reading up when Claude does not answer, or when the credit runs out.
- A request that falls back is sent twice, once to each provider; the route counts its characters
  once, as before.
- Anthropic's API, not only the school's gateway, now receives the text of the lines of a PDF whose
  owner said yes. The owner set aside what the gateway keeps (0103); what Anthropic's API keeps is
  set aside likewise, and the consent promises only what the editor's own service does.
- The milestone 5 plan's provider (0103 and its question 2) said SoCLaaS alone; the plan's own
  pull request, #150, brings it into line with this record.
- The route can be put back on the gateway alone by leaving `ANTHROPIC_API_KEY` unset.
