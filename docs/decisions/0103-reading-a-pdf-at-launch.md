# 0103. Reading a PDF at launch

Date: 2026-10-21 · Status: proposed, with the plan for milestone 5 (docs/milestone-5.md); the
provider is the owner's choice; extends 0028, 0047 and 0056

## Context

The route that reads a PDF's lines (decision 0056) is written and has never answered anyone off a
developer's machine. It asks the school's gateway, which needs the school's leave to read real
people's resumes (decision 0036), and the plan leaves the provider at launch open, asking of a paid
one only that it not train on what it is sent (section 6.4). The privacy rule asks more of
"whoever receives it" (decision 0047): that it keep "only what the person asked to be kept", which
for a PDF read is nothing. The route has no bot check yet, and its KV limiter stops counting after
the free plan's 1,000 writes a day (decision 0028), past which the route refuses everything it
cannot count (decision 0056).

## Decision

- **The provider is the owner's**, from these, read on 21 October 2026:

  | Provider | Trains on it | Keeps it | One PDF costs |
  |---|---|---|---|
  | Workers AI, `@cf/qwen/qwen3.8-27b` | no | not past the reply | about $0.002 to $0.003; free within 10,000 Neurons a day |
  | SoCLaaS, the school's gateway, `qwen3.8:27b` | not established | not established | nothing |
  | Gemini API, paid tier | no | 55 days, for abuse checks | about $0.0006 on 2.5 Flash-Lite |
  | OpenAI API | no | up to 30 days | about $0.0004 on gpt-5-nano |
  | Anthropic API | no | 30 days | about $0.0006 on Claude Haiku 5.5 |
  | Groq | no | logs up to 30 days | about $0.0004 on gpt-oss-20b |

  Costs are for the most tokens any of decision 0051's calls took, 3,400 in and 580 out. Only the
  first two run the model the reading was measured with (decision 0064). Zero retention is a
  contract or a setting at OpenAI, Anthropic and Groq, and at Google only through Vertex AI.
- **The recommendation is Workers AI** with `@cf/qwen/qwen3.8-27b`: the measured model; no
  training and no keeping, so the consent can say no one keeps the text; Cloudflare, which already
  serves every byte of the editor, so no new party sees a resume; a binding in the Worker, so no
  key. Its free 10,000 Neurons a day read about 30 to 60 PDFs; past them the free plan answers
  nothing until 00:00 UTC, and the paid plan charges about $0.003 a PDF.
- **What a provider keeps decides as much as what it costs.** One that keeps what it is sent,
  even for abuse checks, breaks the privacy rule as written, that whoever receives resume content
  "keeps only what the person asked to be kept" (decision 0047), and section 6.3's promise that
  nothing is kept. It is taken only after the owner changes the rule, never by consent words
  alone. The school's gateway, if chosen, needs its word that it keeps nothing as well as its
  leave.
- **Measured before it answers anyone**: `pdf-model` on the invented sets against the owner's
  targets of 4 October 2026, at least 90% of fields right on resumes from other tools within the
  15 s budget. `pdf-model` and the route's `labelModel` build SoCLaaS's model alone today, so both
  gain a choice of provider; Workers AI is measured from the owner's machine through its REST
  address, with a token the owner makes. A record holds the numbers and the cost of a PDF in the
  provider's own unit. A provider that misses them does not go live.
- **The bot check comes first.** The route has a Turnstile widget of its own, rendered when the
  person has said yes and a PDF is being sent, its script fetched then and not before. The token,
  good once and for five minutes, goes with the request. The route checks it with Siteverify, with
  its hostname and action, before it counts the request or calls the model, and refuses a missing
  or failed one; the page's rules then read the PDF, as after a timeout.
- **The limits**: decision 0056's per address stay (10 a minute, 100 a day, 2 million prompt
  characters a day; IPv6 by its /48). A ceiling for everyone each UTC day is added, set from the
  measured cost of a PDF and, on Workers AI's free plan, under its allowance; past it the rules read
  every PDF until the day ends.
- **A Durable Object counts**: a SQLite-backed class in the Worker's script, one object for each
  address's buckets and one for the day's ceiling. The counting moves inside it: one call checks
  and takes from every bucket at once, so two requests at the same moment cannot both read the
  same count, which is why the KV store's limit held "roughly" (`src/service/rate.ts`).
  `RateStore`'s separate reads and writes give way to that one call. Its keys are a keyed hash of
  the address, with a secret of the Worker's, so the store holds no address. KV and `LABEL_KV`
  go.
- **Nothing kept by the route**: no cache and fixed log lines, as decision 0056 has it, and the
  Worker's observability off, with no tail consumer and no Logpush, so not even those lines are
  stored. They show only in a live tail someone is watching.
- **The consent and the privacy page** name who reads the text and say what it keeps, and change
  in the pull request that changes the provider.
- **The school's gateway stays the development model** under `pnpm dev` and for `pdf-model`
  (decision 0036), unless the owner picks it for launch too.
- **No model in CI**, and no corpus resume sent to one, as now.

## Consequences

- On the recommendation, reading PDFs costs nothing up to the free allowance and the rules read the
  rest of the day; the paid Workers plan, $5 a month, lifts it.
- The free plan gives the route 10 ms of CPU a request. Parsing and checking a large PDF's lines
  may need more; the item that puts the route live measures it, and past it the request fails and
  the rules read, or the owner takes the paid plan.
- People behind one address, an office or a campus, share its 100 a day.
- Turnstile's script runs on the page while it checks; Cloudflare's advice is to load it early, so
  loading it late is the item's to prove.
- With Workers AI the development model and the launch's differ in host, not in model; the
  measurement is taken on the launch's. Whether Workers AI holds Qwen 3.8 to the reply's schema is
  part of it; a reply outside the closed list of roles is refused as now, and the rules read.
