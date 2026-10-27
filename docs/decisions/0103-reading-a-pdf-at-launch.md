# 0103. Reading a PDF at launch

Date: 2026-10-21 · Status: accepted, approved by the owner on 27 October 2026 with the plan for
milestone 5 (docs/milestone-5.md); the providers are the owner's choice of 21 October 2026, Claude
first and the school's gateway behind it (decision 0109); extends 0028 and 0056, and amends 0036 and
0044, which asked for the school's leave before launch

## Context

The route that reads a PDF's lines (decision 0056) is written and has never answered anyone off a
developer's machine. It asks the school's gateway, which decision 0036 said would need the
school's leave to read real people's resumes, and the plan left the provider at launch open
(sections 6.4 and 11). The route has no bot check yet, and its KV limiter stops counting after
the free plan's 1,000 writes a day (decision 0028), past which the route refuses everything it
cannot count (decision 0056).

## Decision

- **Claude reads first, the school's gateway behind it** (decision 0109). The route asks
  Anthropic's Claude Haiku 5.5 (`claude-haiku-5-5`), and asks SoCLaaS, the school's gateway, for
  `qwen3.8:27b` when Claude fails or answers in a wrong form within the same 14 s, both with their
  thinking off, as in development. The owner chose the gateway alone on 21 October 2026, over
  Cloudflare's Workers AI and the paid services the plan's first draft weighed, and put Claude in
  front of it the same day, to spend $200 of Anthropic API credit. Haiku read 95.7% of fields
  right on invented resumes from other tools, as `qwen3.8:27b` did, at about 2 s a call against
  its 4 to 7 s (decisions 0064 and 0109). Both providers' code is written. Claude costs well under
  a tenth of a cent a PDF, paid from the credit; the gateway bills nothing. The owner set aside
  what either provider keeps.
- **No leave is sought.** The owner also set aside the school's leave to read real people's
  resumes on the gateway, which section 6.4 and decisions 0036 and 0044 asked for before launch.
- **Keys of their own for the launch**, a Claude key and a SoCLaaS key apart from the development
  keys, held as the Worker's secrets, so development never spends the launch's allowance. The
  Claude credit is prepaid with auto-reload off, so when it is spent Claude fails, and the gateway
  reads alone.
- **Measured from where it will run.** The accuracy is measured already; what launch changes is
  the caller. With the route run on Cloudflare's network, Claude and the gateway must each answer
  the Worker, the invented sets' replies must come within the 15 s budget, a fallback's included,
  and the launch keys' limits are read. A record holds the numbers. If one provider does not
  answer a Worker, the other reads alone; if neither does, the rules read every PDF until the
  owner decides again.
- **The bot check comes first.** The route has a Turnstile widget of its own, rendered when the
  person has said yes and a PDF is being sent, its script fetched then and not before. The token,
  good once and for five minutes, goes with the request. The route checks it with Siteverify, with
  its hostname and action, before it counts the request or calls the model, and refuses a missing
  or failed one; the page's rules then read the PDF, as after a timeout.
- **The limits**: decision 0056's per address stay (10 a minute, 100 a day, 2 million prompt
  characters a day; IPv6 by its /48). A ceiling for everyone each UTC day is added, set under the
  gateway's launch key's own limits (decision 0036 names 90 requests a minute, and reference prices
  of $80 a day and $800 a month), which also bounds a day's spend of the Claude credit; past it the
  rules read every PDF until the day ends.
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
- **The consent and the privacy page name Anthropic and the school's gateway** as who reads the
  text, Anthropic first and the gateway when Claude gives no answer, so a request that falls back,
  which reaches both, is covered. As today, they promise only what the editor's own service does:
  it keeps none of the text.
- **Development and the launch ask the same models in the same order**, so `pdf-model` and the
  route's `labelModels` (decision 0109) stay as they are.
- **No model in CI**, and no corpus resume sent to one, as now.

## Consequences

- Reading PDFs costs well under a tenth of a cent each on Claude, from the owner's $200 of credit,
  and nothing on the gateway; past the day's ceiling the rules read until the day ends. When the
  credit is spent, the gateway reads alone, and costs nothing.
- An outage of either provider, such as the hours the gateway's sign-in failed every call on
  1 October 2026 (decision 0044), is met by the other; when both fail, people get PDFs read by the
  rules, which the review says.
- What either provider keeps of the text is not established, and the privacy page does not claim
  they keep nothing.
- The school has not been asked to agree to the gateway reading real people's resumes. If it
  objects or withdraws the launch key, Claude reads alone, and once the credit is spent too, the
  rules read every PDF until the owner chooses again.
- The free plan gives the route 10 ms of CPU a request. Parsing and checking a large PDF's lines
  may need more; the item that puts the route live measures it, and past it the request fails and
  the rules read, or the owner takes the paid plan.
- People behind one address, an office or a campus, share its 100 a day.
- Turnstile's script runs on the page while it checks; Cloudflare's advice is to load it early, so
  loading it late is the item's to prove.
