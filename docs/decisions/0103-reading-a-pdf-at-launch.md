# 0103. Reading a PDF at launch

Date: 2026-10-21 · Status: proposed, with the plan for milestone 5 (docs/milestone-5.md); the
provider is the owner's choice of 21 October 2026; extends 0028 and 0056, and amends 0036 and 0044,
which asked for the school's leave before launch

## Context

The route that reads a PDF's lines (decision 0056) is written and has never answered anyone off a
developer's machine. It asks the school's gateway, which decision 0036 said would need the
school's leave to read real people's resumes, and the plan left the provider at launch open
(sections 6.4 and 11). The route has no bot check yet, and its KV limiter stops counting after
the free plan's 1,000 writes a day (decision 0028), past which the route refuses everything it
cannot count (decision 0056).

## Decision

- **The provider is SoCLaaS**, the school's gateway, with `qwen3.8:27b` asked with its thinking
  off, as in development (decisions 0036 and 0044). The owner chose it on 21 October 2026, over
  Cloudflare's Workers AI and the paid services the plan's first draft weighed, and set aside the
  question of what the gateway keeps. It is the model the reading was measured with, 93.4 to
  95.7% of fields right on invented resumes from other tools (decision 0064); its code is written;
  and it bills nothing.
- **No leave is sought.** The owner also set aside the school's leave to read real people's
  resumes on the gateway, which section 6.4 and decisions 0036 and 0044 asked for before launch.
- **A key of its own for the launch**, apart from the development key, held as the Worker's
  secret, so development never spends the launch's allowance.
- **Measured from where it will run.** The accuracy is measured already; what launch changes is
  the caller. With the route run on Cloudflare's network, the gateway must answer the Worker, the
  invented sets' replies must come within the 15 s budget, and the launch key's limits are read.
  A record holds the numbers. If the gateway does not answer a Worker, the rules read every PDF
  until the owner decides again.
- **The bot check comes first.** The route has a Turnstile widget of its own, rendered when the
  person has said yes and a PDF is being sent, its script fetched then and not before. The token,
  good once and for five minutes, goes with the request. The route checks it with Siteverify, with
  its hostname and action, before it counts the request or calls the model, and refuses a missing
  or failed one; the page's rules then read the PDF, as after a timeout.
- **The limits**: decision 0056's per address stay (10 a minute, 100 a day, 2 million prompt
  characters a day; IPv6 by its /48). A ceiling for everyone each UTC day is added, set under the
  launch key's own limits (decision 0036 names 90 requests a minute, and reference prices of $80 a
  day and $800 a month); past it the rules read every PDF until the day ends.
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
- **The consent and the privacy page name the school's gateway** as who reads the text. As today,
  they promise only what the editor's own service does: it keeps none of the text.
- **The gateway is the development model and the launch's**, so `pdf-model` and the route's
  `labelModel` stay as they are.
- **No model in CI**, and no corpus resume sent to one, as now.

## Consequences

- Reading PDFs costs nothing, within the launch key's limits; past the day's ceiling the rules
  read until the day ends.
- The gateway's outages, such as the hours its sign-in failed every call on 1 October 2026
  (decision 0044), reach people as PDFs read by the rules, which the review says.
- What the gateway keeps of the text is not established, and the privacy page does not claim it
  keeps nothing.
- The school has not been asked to agree to the gateway reading real people's resumes. If it
  objects or withdraws the launch key, the rules read every PDF until the owner chooses again.
- The free plan gives the route 10 ms of CPU a request. Parsing and checking a large PDF's lines
  may need more; the item that puts the route live measures it, and past it the request fails and
  the rules read, or the owner takes the paid plan.
- People behind one address, an office or a campus, share its 100 a day.
- Turnstile's script runs on the page while it checks; Cloudflare's advice is to load it early, so
  loading it late is the item's to prove.
