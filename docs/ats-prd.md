# ATS Resume Optimiser Product Requirements

Status: Draft for review  
Owner: @keaenlim  
Last updated: 25 September 2026

## 1. Purpose

Build a candidate-facing resume analyser and optimiser that tells a job seeker whether their
finished PDF is readable by common applicant-tracking workflows, how well it matches a target job,
and what they can improve without inventing experience.

The optimiser is the Python product in `apps/ats`. A user reaches it in two ways: as a panel inside
the browser editor in `apps/editor`, and as a check page in the editor app that accepts any PDF.
The two products remain independent: the editor sends a PDF to the ATS over HTTP, and the ATS
returns JSON defined in `packages/contracts`.

This document covers the ATS product and its editor integration. The editor itself remains
governed by `docs/editor-plan.md` and the decisions in `docs/decisions/`. The HTTP service is
decision 0030; the editor's side of the integration is decision 0031.

## 2. Current state

- Milestone 0 is built. `apps/ats/src/ats/service.py` serves `POST /v1/analyze` and
  `GET /health` (`uv run ats-serve`); `apps/ats/src/ats/analyze.py` behind it checks the PDF
  signature, opens the file with pypdfium2 (decision 0032) and refuses an encrypted or unreadable
  one. `apps/editor/src/features/ats` holds the client, which validates replies against the
  contract, and a panel that nothing mounts yet.
- Milestone 1's first slice has landed: `analyze` now returns a real, deterministic
  ATS-readiness score with findings, under the versioned rubric in decision 0033. The checks are
  text layer (including text exported as outlines and image-only pages), page count and
  glyph-mapping (unmapped, icon-font and ligature characters); each finding carries an origin, and
  the producing tool is classified from the PDF's metadata. There are no contact, section or
  reading-order checks yet, and no job matching: those are later PRs within milestone 1 and
  milestone 3.
- The editor's milestone 2 has landed: three curated templates, the side panel, documents kept in
  the browser and PDF download. `Compiler.pdf()` in `apps/editor/src/editor/compiler.ts` returns the
  bytes the download button saves, which are the bytes the panel sends.
- The editor's validation harness (`apps/editor/src/validate/harness.ts`) already fails a curated
  template in CI when its PDF has no ToUnicode map or its extracted text differs from the page.
- `packages/contracts/ats/v1/analysis.schema.json` defines a draft response containing `contract`,
  `score` and `findings`.
- `apps/editor/.env.example` already declares `VITE_ATS_SERVICE_URL=http://localhost:8000`.
- `docs/editor-plan.md` does not yet mention the ATS panel or the check page; decision 0031
  proposes them. `docs/milestone-2.md` already requires the PDF's text to be extractable because
  the ATS reads it.

The first milestone is therefore an end-to-end integration with placeholder analysis, not an AI
feature.

## 3. Problem

Most resume checkers return one unexplained "ATS score" even though applicant-tracking products do
not share one parser or ranking algorithm. Their advice often mixes document readability, keyword
matching, writing style and job fit into a number that cannot be reproduced or defended. Generative
systems may also encourage keyword stuffing or invent qualifications.

Users need two answers instead:

1. **ATS readiness:** can ordinary recruiting software extract and understand this PDF?
2. **Job match:** does the resume clearly demonstrate the requirements in a particular job
   description?

The product should make both answers explainable and actionable. It must not claim to reproduce a
named vendor's proprietary algorithm.

## 4. Users and jobs to be done

### 4.1 Users

- **Editor user:** a job seeker editing a resume in our editor who wants to improve it before
  applying, without learning LaTeX or understanding how ATS products work.
- **Check-page user:** a job seeker with a PDF from another tool, such as Word, Google Docs or
  Canva, who wants to know whether it will survive an ATS and how it compares with a job.

### 4.2 User needs

- Verify that the PDF has extractable text and a sensible reading order.
- Find missing or unclear conventional resume sections.
- Compare the resume with an optional job description.
- See and correct the requirements the product read from the job description.
- Understand which requirements are supported, weakly supported or not demonstrated.
- Know whether a finding is something they can fix in their content or comes from the layout.
- Re-run the analysis after editing and see whether the result improved.

## 5. Product principles

1. **Explain the evidence.** Every finding has a stable category, plain-language reason and, where
   possible, the page or extracted text that caused it.
2. **Say who can fix it.** Every finding states whether it comes from the content or from the
   layout. A finding the user cannot act on is either a bug for us or is labelled as such.
3. **Do not fabricate.** Suggestions may rephrase facts in the resume or ask the user to add a fact
   if true. They must never assert an unsupported skill, metric or achievement.
4. **Keep scoring reproducible.** `POST /v1/analyze` is deterministic: the same PDF, requirement
   list, rubric version and configuration produce the same result. A language model may read the
   job description before analysis, but never sits in the scoring path.
5. **Analyse the real output.** The ATS receives the same PDF bytes the editor offers for download,
   rather than the editor's internal resume model.
6. **Do not imply vendor access.** Present matching strategies as strict keyword, normalised search
   or semantic matching, not as exact simulations of Workday, Taleo or another proprietary system.
7. **Make transmission deliberate.** Analysis starts only after an explicit user action; it does
   not run on every keystroke.
8. **Keep the boundary narrow.** The editor never imports ATS code and the ATS never imports editor
   or resume-model code.

## 6. Scope

### 6.1 Version-one scope (milestones 0 to 3)

- `POST /v1/analyze` accepts a PDF and an optional requirement list.
- `POST /v1/job-requirements` turns pasted job-description text into a structured requirement
  list, which the user can review and edit.
- Reject unsupported, oversized, encrypted or unreadable files with a safe user-facing error.
- Extract text per page with pypdfium2 and keep position information to inspect reading order.
- Produce an ATS-readiness score with deterministic findings, each tagged with its origin.
- Detect the tool that produced the PDF and tailor suggestions to it.
- Detect conventional contact information and sections without storing their contents.
- Report exact and normalised matches between requirements and resume text, with evidence.
- Return a separate job-match score when a requirement list is supplied.
- Return actionable findings through a versioned JSON contract.
- Show progress, results and failure states in the editor's ATS panel and on its check page.
- Allow the user to re-run analysis after editing.
- Rate-limit both endpoints and cap daily model spending.

### 6.2 After version one

- **Milestone 4, semantic matching:** a pretrained sentence-embedding model comparing requirements
  with resume passages.
- **Milestone 5, grounded suggestions:** a language model rewriting phrasing from the resume's own
  evidence, with separate disclosure because resume text would leave our service.

### 6.3 Out of scope

- Ranking multiple candidates for an employer.
- Predicting whether a particular company will interview or hire the user.
- Claiming exact compatibility with a named ATS vendor.
- Automatically changing the resume without user review.
- Training a custom model before a labelled evaluation set exists.
- Reading directly from `packages/resume-model` or the editor's state.
- DOCX, image and plain-text uploads.
- OCR for image-only PDFs; version one identifies them and explains that no text layer was found.
- Accounts, scan history, analytics dashboards and recruiter workflows.
- GitHub, LinkedIn or other external-profile enrichment.
- Cover-letter and interview-question generation.
- Sending resume text to a language model. Only job-description text reaches one in version one.

## 7. User experience

### 7.1 Entry points

**Resume analysis panel.** A side-panel tab in the editor. It contains:

- An explanation that the current PDF will be sent to the ATS service.
- An optional job-description area (section 7.2).
- An **Analyse resume** button.
- The time or editor revision of the most recent result.

The button is disabled while the editor has no successfully compiled PDF. If the resume has changed
since the last compile, the editor compiles it before uploading.

**Check page.** A page in the editor app, working title `/check`, that accepts a PDF file from the
user's device. It reuses the panel's API client, job-description flow and results display. It does
not open the file in the editor.

Neither surface may expose LaTeX, compiler logs, Python errors or raw model responses.

### 7.2 Job description flow

1. The user pastes a job description and asks for its requirements.
2. The editor calls `POST /v1/job-requirements` and shows the list: each requirement with its kind
   and whether it is required or preferred.
3. The user can remove a requirement, change its importance or add one. The list states whether it
   came from the model or from the fallback rules.
4. **Analyse resume** sends the PDF and the list, as edited, to `POST /v1/analyze`.

The list stays in the browser for the session, so re-analysing after an edit reuses it without a
second model call.

### 7.3 Analysis states

1. `idle`: no analysis has run.
2. `extracting`: requirements are being read from the job description.
3. `reviewing`: the requirement list is shown and editable.
4. `preparing`: the editor is producing the current PDF (panel only).
5. `uploading`: the PDF is being sent.
6. `analysing`: the service is extracting and scoring it.
7. `complete`: results are grouped and displayed.
8. `error`: a plain-language recovery action is shown.
9. `stale`: the resume changed after the displayed analysis (panel only).

Only one analysis request is active at a time. Starting a newer request cancels or ignores the
older result.

### 7.4 Results

Results distinguish rather than conflate:

- **ATS readiness:** text layer, reading order, structure and essential information.
- **Job match:** matched, weakly evidenced and missing requirements, shown only when a requirement
  list was sent.

Findings are grouped by `critical`, `warning` and `info`. Each finding contains a concise message
and may include a page and suggestion. Findings whose origin is `layout` are shown apart from
content findings:

- On the check page, the suggestion names the producing tool where known ("In Word, ...").
- In the panel, a layout finding on a curated template should not occur (section 12.1). On an
  imported template it says the finding comes from the template's design, without showing LaTeX.

The UI labels each score by what it measures; it never shows an unexplained universal "ATS score".

### 7.5 Re-analysis

Editing the resume marks the result stale but does not automatically submit it again. The user can
run a fresh analysis and compare the visible result with the previous score during the current
session. Persistent history is deferred.

## 8. Functional requirements

### 8.1 Editor

- The production compile path exposes the downloadable PDF as a `Uint8Array` or `Blob`.
- The ATS client sends multipart form data with a required `file` field and an optional
  `requirements` field.
- The client reads the base URL only from `VITE_ATS_SERVICE_URL`.
- The client validates every successful response against the shared schema before rendering it,
  and ignores properties it does not know.
- The panel and the check page share one client and one results component.
- Both handle cancellation, non-2xx responses, malformed responses, rate-limit responses and
  network failures.
- Tests use invented resume content and small synthetic PDF fixtures.

### 8.2 ATS HTTP service

Decision 0030 records the service's shape.

- Expose `POST /v1/analyze`, `POST /v1/job-requirements` and a lightweight health endpoint.
- `POST /v1/analyze` is deterministic and never calls a model provider.
- Accept only PDF input on `/v1/analyze`, and verify both declared type and file signature.
- Enforce configurable request-size, job-description-length and processing-time limits.
- Keep transport, extraction, scoring, requirement extraction and provider calls in separate
  modules.
- Return responses that validate against the shared contract.
- Use stable machine-readable error codes while keeping internal details out of user-facing text.
- Permit only the configured editor origins.
- Apply per-IP rate limits to both endpoints and a daily cap on model calls.

### 8.3 PDF extraction and readiness

Extraction uses pypdfium2, a permissively licensed library (Apache-2.0 / BSD-3-Clause); AGPL
libraries such as PyMuPDF are excluded (decision 0032). There is no second extractor, so reading
order is checked from pypdfium2's own character and rectangle positions rather than from
disagreement between two libraries.

The analyser must detect at least:

- Missing or unusable text layer, including text exported as outlines.
- Extraction failure or encrypted PDF.
- Page count and unexpected blank pages.
- Suspicious reading order, especially multi-column interleaving.
- Missing or unrecognised contact information.
- Missing conventional sections such as experience, education or skills where applicable.
- Excessive repetition or invisible text intended to manipulate scoring.
- Text that becomes meaningless after extraction, including unmapped glyphs, ligatures that extract
  as single characters and icon fonts without a Unicode mapping.
- Words split by hyphenation at line ends.

Every finding carries an origin:

- `content`: the user can fix it by changing what the resume says, such as a missing email.
- `layout`: it comes from the template or the tool that produced the PDF, such as reading order.

The analyser reads the PDF's `Producer` and `Creator` metadata to classify the producing tool as
LaTeX, Word, Google Docs, Canva or other, and uses it to choose suggestion text. It does not report
the raw metadata.

The first scoring rubric is versioned in code and covered by fixtures. The same input, rubric
version and configuration produce the same score.

### 8.4 Job-requirement extraction

`POST /v1/job-requirements` turns job-description text into a list of requirements, each with a
stable id, its text, a kind (skill, tool, qualification, experience or other), an importance
(required or preferred) and any years-of-experience constraint.

- Before anything else, the service strips email addresses, phone numbers and URLs from the text.
- The primary extractor is a language model asked for output against a strict schema. Its output is
  validated before it is returned.
- Results are cached by a hash of the normalised, stripped text and the extractor version, so the
  same job description always yields the same list. The cache stores the hash and the list, not the
  job description.
- A deterministic extractor (section headings such as "Requirements" and "Nice to have", the skills
  taxonomy and patterns such as "5+ years") runs when the provider is disabled, unavailable or over
  its daily cap.
- The response states which extractor produced the list.
- Job-description text is data, not instructions. Text inside it cannot change the schema, the
  prompt's rules or the service's behaviour.

### 8.5 Job matching

When `POST /v1/analyze` receives a requirement list, the analyser must:

- Normalise aliases and obvious variants through the skills taxonomy before matching.
- Report exact and normalised matches as deterministic evidence, with the resume passage and page.
- Distinguish matched, weakly evidenced and not demonstrated requirements.
- Weight required requirements above preferred ones in the job-match score.
- Treat absence as "not demonstrated in this resume", not proof that the user lacks the skill.

Semantic matching with embeddings is milestone 4 and not part of version one. It must not bring
torch into the service image, and its memory use must fit the host chosen for the service; the
runtime and model are decided at that milestone.

### 8.6 Suggestions

- In version one, deterministic templates generate every suggestion, chosen by finding and
  producing tool.
- Milestone 5 may add model-written phrasing. It follows the rules in section 11 and must leave the
  analysis useful when the provider is disabled or unavailable.

## 9. Analysis pipeline

```text
Job description text                      PDF bytes
  -> strip contact details                  -> validation and limits
  -> cache lookup                           -> text and layout from pypdfium2
  -> model extraction, or rules             -> producer detection
  -> schema validation                      -> structured resume sections
  -> requirement list                       -> deterministic readiness findings
       |                                    -> exact and taxonomy matching (if requirements)
       +-- user reviews and edits --------> -> readiness and job-match scores
                                            -> contract validation
                                            -> editor panel or check page
```

This is a hybrid system:

- Rules handle facts that should not vary, such as whether selectable text exists.
- A small skills taxonomy handles aliases and canonical names.
- A language model reads job descriptions, where hand-written rules are weakest and no personal
  data is involved. Its output is cached, shown to the user and editable before scoring.
- The scoring authority is deterministic code. No model output reaches a score without passing
  through the user-visible requirement list.

## 10. Contract and integration

### 10.1 Boundary

```text
Editor -> job description -> POST /v1/job-requirements -> requirement list -> Editor
Editor -> multipart PDF + requirement list -> POST /v1/analyze -> analysis JSON -> Editor
```

Milestone 0 uses the `ats/v1` response shape unchanged, and adds `error.schema.json` for every
non-2xx reply except a refused CORS preflight, which the CORS layer answers in plain text.

### 10.2 v1 revision

The contract is still a draft, and its only client is the editor's milestone 0 client. Decision
0030 sets out these changes within `ats/v1`; the first has landed with milestone 0:

- **Tolerate additions (landed).** Remove `additionalProperties: false` from the response and from
  `finding`, and require clients to ignore unknown properties. Without this, deploying a new field
  to the service before the editor updates breaks every response, so "additive changes stay in v1"
  would not hold.
- **Name the score.** Redefine `score` as the ATS-readiness score, and add an optional `match`
  object, present only when requirements were sent, carrying its own score and the per-requirement
  results with evidence.
- **Finding origin.** Add `origin`: `content` or `layout`.
- **Producer.** Add `producer`: `latex`, `word`, `google-docs`, `canva` or `other`.
- **Versions.** Add the rubric version and analyser version.
- **Requests.** Add a schema for the requirement list and document both endpoints' request fields.
- **Errors.** Add a stable error response schema with a machine-readable code.

The score and origin changes land in milestone 1, when the first real score appears; the match and
requirement shapes land in milestone 3. Any breaking shape goes in `ats/v2` while `v1` remains
available.

## 11. Privacy, safety and security

- Resume submission is user initiated.
- The UI states that the PDF leaves the browser for analysis.
- Resume files, extracted text and job-description text are not written to application logs.
- The service discards request content after producing the response. This applies equally to PDFs
  from the panel and from the check page.
- The requirement cache holds only a hash and the extracted list.
- In version one, resume content never reaches an external model provider. Only stripped
  job-description text does, and the job-description area says so.
- Any later feature that sends resume content to a provider needs its own disclosure. The ATS cannot
  forward resume content merely because the user agreed to send it to the ATS service.
- Secrets live only in environment configuration and never in the repository or response.
- Uploaded PDFs are untrusted input. Extraction runs with file, memory and time limits.
- Resume and job text are treated as data, not model instructions. Prompt injection inside either
  document must not grant tools, alter the rubric or override output validation.
- Findings concerning protected characteristics are out of scope. The product does not infer age,
  gender, ethnicity, disability or other sensitive attributes.

### 11.1 Abuse

The service is public and anonymous in version one, because sign-in does not exist until the
editor's accounts milestone.

- Per-IP rate limits on both endpoints, configurable, returning a stable error code the UI explains.
- A daily cap on model calls. Past it, requirement extraction falls back to rules for the rest of
  the day rather than failing.
- Cross-origin requests only from the configured editor origins.
- Request-size, job-description-length and processing-time limits on every request.

## 12. Quality and evaluation

### 12.1 Test corpus

Use only public, appropriately licensed or fully synthetic material. Repository fixtures contain
invented people and experience. The corpus should include:

- Valid one- and two-column textual PDFs.
- Image-only, encrypted, malformed and blank PDFs.
- PDFs with headers, footers, icon fonts, ligatures and unusual reading order.
- Exports from Word, Google Docs and Canva, including Canva's text-as-outlines output.
- Each curated template compiled with invented content.
- Job descriptions from several role families, with a hand-checked requirement list for each.
- Controlled resume variants with known added and removed requirements.
- Prompt-injection and invisible-text adversarial fixtures, in both resumes and job descriptions.

**Curated templates are a gate.** Each curated template, compiled with invented content, must pass
the readiness checks with no `critical` finding and no `layout` warning. A failure is a template
bug for the editor to fix, not something a user should see. The editor's validation harness
already checks that each curated PDF's text can be extracted and matches the page; the ATS gate
adds what it cannot see, such as reading order, sections and contact details. Decision 0031 covers
how this runs.

### 12.2 Initial success measures

- 100% of successful API responses validate against the shared contract.
- Repeated analysis of the same PDF and requirement list produces identical findings and scores.
- All critical extraction failures have a specific, tested user-facing finding or error.
- Every curated template passes the readiness gate.
- Model requirement extraction beats the rule-based fallback on the hand-checked job-description
  set, and the fallback alone still produces a usable list.
- Exact and alias matches pass a curated requirement-to-evidence test set.
- Every suggestion is tied to extracted evidence or explicitly conditional.
- No test finds resume or job-description contents in normal application logs.
- A complete local editor-to-ATS request works without either app importing from the other.

Latency targets should be set from measurements. The first working budgets, excluding editor PDF
compilation, are:

- `POST /v1/analyze`: under three seconds, with or without requirements.
- `POST /v1/job-requirements`: under 300 ms on a cache hit, under ten seconds on a miss.
- Cold start: measured on the chosen host and given its own target then. It is not excluded.

## 13. Delivery plan

Version one is milestones 0 to 3.

### Milestone 0: integration skeleton

- Add the FastAPI service around the placeholder `analyze` function (decision 0030).
- Add the editor API client and a minimal analysis panel.
- Send a synthetic fixture PDF and display the empty response.
- Add contract validation and integration tests.

**Exit:** one command starts each app locally, and the editor displays a schema-valid response from
the Python service.

### Milestone 1: real PDF readiness

- Adopt pypdfium2 as the PDF extractor (decision 0032).
- Implement text-layer, page, contact, section, glyph-mapping and reading-order checks.
- Add finding origins and producer detection.
- Define and version the first deterministic rubric.
- Land the contract's score, origin and producer changes.
- Add rate limits and request limits.

**Exit:** the fixtures, including outside-tool exports, produce stable, explainable results without
a job description or model provider.

### Milestone 2: production editor connection and check page

- Take the PDF from `Compiler.pdf()`, the same bytes the download button saves.
- Analyse the latest successful compile and mark results stale after edits.
- Add the check page, sharing the panel's client and results display.
- Complete loading, cancellation, rate-limit and failure states.
- Run the curated-template readiness gate in CI.

**Exit:** a user can edit, compile, analyse, act on a finding and re-analyse the same resume, and
can check a PDF made elsewhere.

### Milestone 3: job requirements and lexical matching

- Add `POST /v1/job-requirements` with the provider interface, cache, fallback rules and spend cap.
- Build the initial skills taxonomy.
- Add the requirement review step to the panel and the check page.
- Add exact and normalised matching with evidence, and the job-match score.
- Land the contract's requirement and match shapes.

**Exit:** controlled job/resume pairs report the expected matches and gaps, and the analysis works
with the provider disabled.

### After version one

- **Milestone 4, semantic matching.** Choose an embedding runtime and model by evaluation, within
  the host's memory ceiling and without torch. Match requirements to resume passages, set confidence
  thresholds and measure against the lexical baseline. **Exit:** semantic matching passes the
  agreed quality and latency thresholds and every match keeps its supporting evidence.
- **Milestone 5, grounded suggestions.** Add model-written rewrites grounded in the resume's own
  passages, with the separate disclosure section 11 requires, and prompt-injection, hallucination
  and provider-failure tests. **Exit:** disabling or failing the provider leaves the core analysis
  intact, and the evaluation set contains no accepted unsupported claims.

## 14. Dependencies and sequencing

- ATS milestones 0 and 1 can proceed before the curated editor is complete by using synthetic PDFs.
- The panel tab, the check page and the PDF exposure are editor changes; decision 0031 needs the
  editor owner's agreement before milestone 2.
- The editor's PDF export, which milestone 2 needs, has landed.
- Contract changes affect both products. Decision 0005 means no review is requested automatically,
  so the author tells the other owner directly.
- Milestone 3 needs a model provider chosen and an API key held by the ATS service.
- Semantic matching requires a labelled comparison set, a benchmark harness and a chosen host.
- Hosting remains open; the selected platform must run the Python dependencies, respect the
  content-retention policy and fit a zero budget.

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A score is mistaken for a hiring prediction | Label readiness and match separately; explain the rubric and evidence |
| PDF reading order differs from visual order | Keep layout data, test multi-column fixtures |
| Users see findings they cannot act on | Tag each finding's origin; gate curated templates in CI |
| Model misreads a job description | Show the list for review and editing; cache it; keep a rule-based fallback |
| Job-description text contains prompt injection | Strict output schema, no tools, validation before return |
| The public endpoint becomes a free model proxy | Per-IP limits, a daily model cap that falls back to rules, origin restriction |
| Users keyword-stuff invisible text | Inspect rendering and extraction signals and report suspicious content |
| Outside PDFs vary more than our own output | Fixtures from each named tool; producer-specific suggestions |
| The service does not fit a free host | No torch in version one; measure memory and cold start per milestone |
| A named-vendor simulation overstates accuracy | Use neutral matching strategies and publish limitations |
| ATS development blocks on editor progress | Develop and test against synthetic PDF fixtures first |
| Contract changes break the panel | Clients ignore unknown fields; breaking changes go under a new version |

## 16. Open decisions

These require measurements or an accepted decision record before they become architecture:

- The sandboxing approach.
- The first skills taxonomy and its licence.
- The model provider for requirement extraction, its data-retention terms and the daily cap.
- Score dimensions, weights and thresholds for readiness findings landed in decision 0033; a
  per-dimension score breakdown, and weights for any later job-match score, remain open.
- The embedding runtime, model and memory ceiling (milestone 4).
- ATS hosting platform, cost ceiling and regional data handling.
- How much evidence the response exposes without returning unnecessary personal data.
- Whether session-only comparison is enough after version one.

## 17. Reference projects

These projects are research inputs, not dependencies:

- [Resume Matcher](https://github.com/srbhr/Resume-Matcher): closest candidate-facing workflow;
  useful for resume-plus-job-description analysis and provider-neutral AI integration.
- [ATS Screener](https://github.com/sunnypatell/ats-screener): useful hybrid of parsing,
  deterministic scoring, TF-IDF, taxonomy matching and a language model; named-vendor simulations
  should not be copied as factual representations.
- [Hiring Agent](https://github.com/interviewstreet/hiring-agent): useful separation of extraction,
  structured data, role rubrics and evidence; its employer-side candidate ranking and GitHub-centric
  scoring are outside this product's purpose.

Before copying implementation rather than ideas, verify the source file's licence and retain all
required notices. Dependencies added to this repository must be named in the pull request.

## 18. Immediate next actions

1. Agree decision 0031 with the editor owner: panel tab, check page and where the panel gets the
   PDF.
2. Accept decision 0030.
3. Mount the panel with a `getPdf` that wraps `Compiler.pdf()`, and try it in a real browser.
4. Collect the hand-checked job-description set before choosing a model provider.
