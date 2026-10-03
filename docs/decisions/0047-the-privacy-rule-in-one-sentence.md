# 0047. The privacy rule in one sentence

Date: 2026-10-03 · Status: accepted, the owner's decision of 3 October 2026; restates the rule
0033 serves, and amends AGENTS.md's product rule and the plan's section 6.3

## Context

The plan's rule was a promise with exceptions: resume content stays in the browser, except when the
person saves it to their account or sends a PDF to the checker, and an import's naming request
carries only the template's code (decisions 0024 and 0033). The second pass of milestone 3
(docs/milestone-3-overhaul.md) proposes reading a PDF with a hosted model, which would have been a
third exception. A list that grows by an exception for each feature stops reading as a rule. The
owner considered dropping the rule, and kept it as one principle.

## Decision

- The rule: resume content leaves the browser only when the person asks for something that needs
  it and is told what is sent, and whoever receives it keeps only what the person asked to be kept.
- Saving to an account sends the document and keeps it, since keeping it is what was asked.
  Sending a PDF to the checker sends the PDF and keeps nothing, as the checker's own requirements
  already say (docs/ats-prd.md, section 11).
- A feature that sends resume content to a service asks the first time, in plain words that say
  what is sent and what is kept. The answer is remembered in that browser, and a setting changes
  it. Each later use says in one line that the content is being sent.
- In code: no request carries resume content without that agreement; a service that receives it
  writes it to no cache and no log; and a test holds each, for every feature that sends anything.
- The naming request of the first pass's import is unchanged while it exists. It carries only
  macro definitions and placeholdered call sites, never the resume's text, and decision 0033's gate
  and leak check stand until the naming step is retired.

## Consequences

- AGENTS.md's product rule, and the plan's decisions table and section 6.3, carry the sentence.
- The promise is looser than "never leaves": a feature can now send resume content once the person
  agrees. Each such feature needs its own question, its own test, and a receiver that keeps nothing
  it was not asked to keep.
- A remembered answer is easy to forget, which is why each use says that it sends and the setting
  sits beside it.
- Nothing in the code changes with this record. No feature sends resume content yet beyond the two
  the old rule already named.
