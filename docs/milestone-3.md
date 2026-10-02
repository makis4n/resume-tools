# Milestone 3: import

Written 26 September 2026, as milestone 2 closes. This is the working plan for the third
milestone in [editor-plan.md](editor-plan.md) section 9. It turns the curated editor into one
that takes the `.tex` resume a person already has, and says in what order. Each numbered item is
one pull request, or a few if it grows past ten minutes of reading. Tick the item in the same pull
request that finishes it.

## The goal

From the plan: intake, parser, probes, model step, validation, locked chunks, cache, the import
report, and the generic style controls on imported templates.

**Done means** a corpus of at least 200 public resumes imports through the pipeline, the
editable rate is reported and tracked, page size, margins and font size work on every successful
import, and a cached template imports in under 8 seconds, the plan's 5 as decision 0045 raised it.

Not in this milestone: accounts and the private storage of originals (milestone 4), hosting the
app, the engine and the naming service (milestone 5), the pre-warmed cache beyond what the corpus
leaves behind (milestone 5), fonts a user supplies, images in the PDF, LuaTeX templates, Overleaf
links, and importing from a PDF alone. The pipeline runs on a laptop with the dev server, which
answers the naming route itself.

## Where milestone 2 left us

What import can take as it is:

- **A template package is data** (decision 0006), and one generator renders every package
  (decision 0007). An imported package is the same value: preamble, files, controls, snippets and,
  on XeTeX, fonts (decision 0014). The plan's promise that the editor cannot tell a curated
  package from an imported one holds by construction, and every typeset slot is marked, so the
  marker strategy of plan section 5.1 is one rule the probe checks.
- **The validation harness** runs eleven checks over a package and a resume, in Node and on the
  editor's engine session: dump, compile, converges, controls, edits, pages, fields, alignment,
  fonts, special and pdf. Plan section 5.7 wants the same code path at import time, in the
  browser; decision 0008 asks that it then run in a worker the app can terminate.
- **The engine session** runs pdfTeX and XeTeX from a dumped format and from the stock formats,
  in named jobs with files of their own (`dump`, `compile`, `pdf`, `forget`), and refuses the
  specials that would read the tree (decision 0008). The scheduler keeps one compile in flight
  and a document opens in two passes, three at most.
- **The page and the fonts.** pdfTeX fonts resolve through `pdftex.map`, re-encoded, transformed
  and virtual ones included (decision 0009); XeTeX fonts are declared by file and drawn from the
  tree's OpenType files (decision 0014); fontconfig scans no folder (decision 0011), so a font is
  found by file, never by name.
- **The tree** is BusyTeX's TeX Live 2023 plus ten packages from the archive (decision 0011). It
  holds twelve CV classes, moderncv, europecv, europasscv and simplecv among them, and 189
  OpenType and TrueType files: Roboto, Lato, Source Sans Pro, Font Awesome 5 and Latin Modern.
- **The numbers** (decisions 0013 to 0016, M4 Pro): a format dumps in 350 to 500 ms, a body
  compiles in 80 to 110 ms, a whole XeTeX document from the stock format in about 150 ms a pass.
  Awesome-CV with fontspec, which an imported XeTeX resume has, took 10.2 s a compile in the spike
  (decision 0003), before the file databases that made every other compile several times faster.

What stands in the way:

- A document names its template by id and one whose template the editor does not have is refused
  (decision 0010), so imported packages need a store, and the app resolves templates from the
  curated map only.
- The app has no template chooser: a new document starts from Jake's Resume.
- A package cannot ship a font, since its files are text (decision 0014), and the tree has the
  fonts of three templates.
- The harness's `controls` check compiles each font but does not draw it; a curated package's
  round trip does, an imported one has none (decision 0012).
- The harness edits every field at once; an import has to find which field breaks.
- The ports patched their classes by hand wherever a macro defeats markers or alignment, and an
  import cannot patch a class: Awesome-CV colours a title's first three tokens, which come apart
  around a marker, builds each contact's address from the argument it also typesets, and stops
  on a blank name (decision 0015); AltaCV uppercases its name and titles, which the aligner
  cannot match to lowercase text, and places its skill tags through a transform the page does
  not apply (decision 0013). Each is a locked field in every fork unless the pipeline has the
  same fix.
- A glyph a font feature substitutes has no text (decision 0014): Awesome-CV's small capitals
  and Roboto's proportional figures, which the ports gave up and an import's reference compile
  sets.
- Nothing serves a request: the first two milestones needed no service, and the model step is
  the first.

## How the work is laid out

| Where | What |
|---|---|
| `apps/editor/src/import/` | The pipeline in the browser and in Node: intake, parse, probe, the naming client, validate, assemble, the report. It runs on the editor's engine session in a job of its own |
| `packages/naming/` | The naming step's contract and logic: the request and answer schemas, the prompt, `name(request)` on the AI SDK, a cache interface. The Worker and the corpus runner both call it |
| `apps/editor/functions/` | The naming service, inside the editor's own project: `POST /v1/name` as a Cloudflare Pages Function with a KV cache, or as the app's Worker if milestone 5 hosts the app as a Worker with static assets. In development the dev server answers the same route through a middleware |
| `apps/editor/corpus/` | The manifest of public resumes (sources and hashes, never content), the reviewed answers, and the baseline the corpus run is held to |
| `apps/editor/.corpus/` | Ignored: the fetched documents, the runner's results and the uncommitted answer cache |
| `apps/editor/scripts/corpus.ts` | The runner: `fetch`, `survey`, `run` and `bench` |
| `.github/workflows/corpus.yml` | The corpus run, when a person starts it (decision 0035) |
| `packages/resume-model` | Locked content and the extras the pipeline fills: additions to version 1 |

## The work, in order

The order removes the biggest unknown first, as the plan's milestones do. A fork of Jake's
Resume goes end to end first, on pdfTeX, from answers written by hand and no model, so that
the probe-and-validate loop is proven before a model or a server exists; then moderncv, the most
used class the tree already has; then forks of Awesome-CV, which take the XeTeX path. The
three upstream samples are the oracle throughout: the pipeline importing the upstream `.tex`
of each launch template must find editable what the hand-written port marks.

### Stage 1. The corpus, before the pipeline

1. [x] **Collect the corpus.** `apps/editor/corpus/manifest.json` names at least 200 public
   `.tex` resumes: for each, its files at a pinned commit on GitHub (the main file, class and
   style files, a fonts folder), a SHA-256 for each file, the licence the repository states, if
   any, and its family: `jake`, `awesome-cv`, `altacv`, `moderncv`, `europecv` or `other`.
   GitHub has plenty: code search finds about 11,000 files that call `\resumeSubheading`, 4,200
   that load moderncv, 2,100 Awesome-CV forks' files and 670 AltaCV ones, and sb2nov/resume,
   Awesome-CV, AltaCV and moderncv have 1,900, 5,300, 390 and 610 forks. The manifest caps each
   family so that hand-rolled and messy documents are a third of it, since those decide the
   editable rate. The content is never committed: these are real people's resumes, public by
   their owners' choice, and most repositories state no licence. `corpus.ts fetch` downloads
   them into the ignored `.corpus/`, checks every hash, and CI fetches the same way. Tests never
   quote a corpus document, and the runner's output holds counts and macro names, never text.
   Done when the fetch reproduces the manifest on a clean machine.
2. [x] **Survey the corpus, and grow the tree from it.** `corpus.ts survey` reads every
   document's class, packages, engine, font loading (fontspec by name, by file, or font
   packages), custom macro count, and what it needs that the engine has not: a package or font
   the tree lacks, LuaTeX, biber or bibtex, shell escape, images. It prints one table, which goes
   into the decision record with the manifest. Then decision 0011's mechanism, `WANTED`,
   `--resolve` and a `LAYOUT` bump, takes the packages and fonts the most documents need, within
   a budget on the tree's size, since the session mounts every file at start-up. Needs the
   archive's mirror, which this development environment does not reach, as item 19 of milestone 2
   found. Done when the survey runs in CI's job and the tree holds what the top families need.

### Stage 2. Intake and the parse

3. [x] **Intake and the reference compile.** A `.tex` file or a zip (fflate, one new dependency).
   The main file is the one with `\documentclass`; `\input` and `\include` are inlined from the
   zip; a zip past a size and file-count cap, or with a path that steps out of it, is refused as
   decision 0011 refuses containers. The engine is read from the class and packages: fontspec,
   polyglossia or a XeTeX-only package means XeTeX, anything that needs Lua is refused with a
   message that says so. Images are dropped at intake and named in the report, since version
   one's PDFs carry none (decision 0008). The original then compiles from the stock format in a
   job of its own on the editor's session, two passes, three at most, and for XeTeX with
   fontconfig given the tree's folders for this compile only, since fontspec finds a font by
   name and the loop's compiles never do (decision 0011). The reference is the output's glyph
   stream and fonts, read as the page reads them, its page count, and the log's missing files, so
   that a refusal names what is missing ("This resume needs the font Montserrat, which this
   editor does not have") and never a line of source. Done when every corpus document either
   compiles to a reference or is refused with a message that names why, and the runner counts
   both.
4. [x] **Parse the body.** unified-latex (`@unified-latex/unified-latex-util-parse`,
   `-util-arguments`, `-util-argspec`, `-util-macros`, `-util-to-string`, `-util-visit` and
   `-ctan`) parses the main file. Signatures come from the engine, not from parsing class files:
   one compile prints `\meaning` (and xparse's argument specification) of every control
   sequence the body uses that the parser's table of standard text commands does not know, and
   the parser attaches arguments from those specifications. The same compile prints each
   macro's `\meaning` from the stock format too: a macro the stock format lacks or defines
   differently is the template's, and its replacement text, which TeX has already normalised,
   is its definition, closed over the template macros it names, to a cap. The body becomes a
   tree: standard LaTeX becomes rich text, with bold, italic, links and lists, and `\section`
   and its kin become section titles; a call to a template macro becomes a typed call with each
   argument a subtree; dates become dates where the reader can read them (month names, numerals,
   ranges on any dash, Present, Current, Now, Ongoing); anything else is a raw chunk, kept byte
   for byte through the printer. Done when the tree printed back compiles to the reference's
   glyph stream for every corpus document that has one.

### Stage 3. Probe, name and validate, with no model

5. [x] **The probe.** Every argument of every template-macro call is wrapped in `\rtfield`, the
   prelude's marker macro (decision 0007), the original's preamble is dumped as a format, and the
   marked body compiles; the harness's `fields` and `alignment` checks say which arguments come
   out intact around exactly their text. Failures are bisected, halving the set of wrapped
   arguments until each failing one stands alone, and classified: the compile stopped, the
   marker vanished (a length, a colour, a key, an address), the marker came twice (an argument
   used twice), it moved (a running head), or the glyphs did not align. The result is per macro
   and argument, not per call, and text the reference sets that no marker covers is locked. The
   aligner learns to fold case, so that a title a class sets through `\MakeUppercase`, as AltaCV
   sets its name and section titles, aligns with the lowercase text the resume holds, and the
   overlay shows such a field in capitals; decisions 0007 and 0013 left this to a later item.
   Done when the probe, run on the three launch templates' upstream samples, finds editable
   every argument the ports' snippets mark, and locks what the ports leave out of the model.
6. [x] **The naming contract, and the seed answers.** `packages/naming` holds the request and the
   answer as Zod schemas. The request: each template macro's normalised definition and its
   dependencies, a few call sites with each argument's text replaced by a placeholder of the same
   length, the environments, and the preamble's candidate settings. The answer, for each macro
   or environment: its kind (entry, section, bullet, bullet list, header, contact, link, labelled
   item, paragraph, layout, other), each argument's meaning (title, subtitle, place, dates, text,
   label, address, icon, colour, length, key, other), whether it is a repeatable unit and what a
   blank one looks like, which pairs open and close a list, the mapping onto the model with a
   role for each section, and the style parameters in the preamble, page size, margins, base
   size, fonts and colours, with how each is set. It carries a version, which is part of the
   cache key. An answer may also carry redefinitions: LaTeX a person wrote, never the model,
   that redefines or adds macros after the document class, which the snippets it maps to may
   use, so that a macro that defeats markers or alignment gets the fix its port has. A
   redefinition must keep upstream's output: the reference check of item 7 proves it on every
   document, and one that changes the page, as AltaCV's port did by taking the capitals out, does
   not qualify. The seed: the answers for the three launch templates' macros, written by hand
   from the ports and committed under `corpus/answers/<hash>.json`, with the ports' class patches
   that keep upstream's output as their redefinitions: Awesome-CV's section colour, its header's
   blank lines and its contacts, AltaCV's contact text, tag frames and wrapping dates. They are
   the fixtures the pipeline's tests run on with no model, and the first cache entries, so that
   forks of the three hit the cache from day one, as plan section 7 wants. Done when the pipeline
   assembles a package for each upstream sample from the seed alone.
7. [x] **Validate and assemble.** Plan section 6's four checks, each a compile from the format,
   bisected as the probe is: the body generated from the model and the assembled snippets sets
   the reference's glyph stream with the markers stripped, a new harness check; every field
   mutated with long, empty and special-character text still compiles, the `edits` check grown
   to find the field that breaks: one that breaks only when empty becomes required, a slot the
   package marks and the editor refuses to empty, as a required form field is, since Awesome-CV
   stops on a blank name (decision 0015), and one that breaks on ordinary text is locked; an
   entry of each repeatable kind added and removed still compiles; and each style parameter
   overridden compiles and changes the output, or is dropped. Then assembly: the package, whose
   preamble is rewritten as decisions 0008 and 0009 have every pdfTeX port, geometry, hyperref's
   dvipdfmx driver, T1 and Latin Modern, and carries the answer's redefinitions after the
   document class, with the template's files in `files`, the proven controls, and snippets
   derived from the answer, under the id `import-` and a hash of the assembled package; the
   document, whose header is found without the model, since its text may not leave the browser:
   the block before the first section holding the largest text, contact strings by pattern, and
   `\href` calls as links by the kind their address gives; and the report. Done when the three
   upstream samples assemble into packages that pass the full harness and set the reference's
   glyphs, and a fork of Jake's Resume from the corpus goes through every step in Node; the
   harness holds an import to its upload's own pages and passes, and the one finding it keeps on
   the samples, Awesome-CV's entry titles in small capitals, which the PDF's text shows only in
   capitals, is a limit of the PDF's text layer (decision 0026, the owed table below).

### Stage 4. XeTeX imports

8. [x] **Fonts by file.** fontspec's `\setmainfont`, `\setsansfont`, `\setmonofont` and
   `\newfontfamily`, and the font packages that load it, roboto, sourcesanspro, lato and
   fontawesome5 among them, are translated at intake into the package's `fonts` (decision 0014)
   through a table from font names to the tree's files and shapes, with `Ligatures=TeX` becoming
   `mapping=tex-text`, files named through `Path=` matched to the tree by name and never kept,
   and the features upstream loads carried over. The reference compile sets them, so the loop
   must too, or the two glyph streams differ and the first check of item 7 fails on every
   Awesome-CV fork: its positions in small capitals (`+smcp`) and Roboto's proportional lining
   figures (`+pnum;+lnum`), which the port gave up. That takes the two additions decision 0014
   named: features per shape, so that `sc` loads with `+smcp` while the other shapes do not, and
   a text for a glyph a single substitution makes, read back through the font's substitution
   table, so that the page, the aligner and the overlay know it. fontspec goes out of the
   preamble before the dump, and unicode-math with it, its symbols taken from a plain family as
   decision 0003 did. A family the table cannot map refuses the import, naming the font. The
   rewritten preamble is checked as the body is: the whole document compiled from it must set the
   reference's glyph stream. Done when Awesome-CV's upstream example and its forks in the corpus
   import, and the survey says how many XeTeX resumes the table covers.

### Stage 5. The model, the service and privacy

9. [x] **The naming module on a model.** `name(request)` in `packages/naming`: the AI SDK (`ai`,
   `generateText` with `Output.object` against the answer's schema, since `generateObject` is
   deprecated in the current major) on `@ai-sdk/google` first, Gemini's free tier, as plan
   section 6.4 expects, with the model id from configuration so that a candidate swaps with a
   flag; the prompt in one file; a large class analysed macro by macro with the class text
   reused across calls. A cache interface, `get(key)` and `put(key, answer)`, with a file cache
   in Node: the committed `corpus/answers/` and the ignored `.corpus/cache/`. Done when the
   corpus runner, with a key in the environment, names every macro of a document outside the
   seed, and its import validates.
10. [x] **The naming service.** `POST /v1/name`, inside the editor's own project: it takes a
    request, checks the cache by key, calls the module on a miss and stores the answer, with a cap
    on the request's size and a rate limit per address. One handler, written against the fetch
    API, serves it in every setting: in development a middleware of the dev server, so that no
    second process runs and the key comes from a server-only variable of the editor's `.env`,
    listed in `.env.example` without the `VITE_` prefix that would expose it to the page, with
    the file cache of item 9; in production a Pages Function under `apps/editor/functions/`, or
    the app's Worker if milestone 5 hosts the app as a Worker with static assets, with KV. The
    browser calls a relative address, so there is no second origin. The function's folder has a
    TypeScript config of its own with the Workers types, and Vite's build never includes it, which
    a test asserts. Deploying it is milestone 5's, with the rest of hosting. Tests: the module's
    own, and the handler against a fake cache. Done when an import in the browser hits the dev
    server's route and the second import of the same template hits the cache.
11. [x] **What leaves the browser.** Before a request is built, names, emails, phone numbers,
    addresses and links found in definitions are replaced, by pattern and by the document's own
    header values; call sites carry placeholders of the same length and character class in place
    of their text, a few per macro; nothing of the body's text goes. A test runs every corpus
    document's request through the same detector plus the document's own header strings and
    fails on a leak. The import screen says so in a sentence. Done when the corpus-wide leak test
    passes.

### Stage 6. The document in the editor

12. [x] **Imported packages in the store, and the way in.** The store gains a `packages` table:
    the package, the original upload's files, the report, when it was made and last used; the
    app resolves a document's template from the curated map or the store; a package's formats
    are kept as any template's, and dropped with its last document. The document list gets
    "Import a resume", a file picker and a drop target, and a chooser for a new document's
    template, the three curated ones, which milestone 2 left out. The import runs on the editor's
    engine in its own job while the list shows, so one engine is loaded at a time, with a
    progress line that names each step (plan section 6.4), a cancel that terminates the worker
    and starts it afresh, which is also what a hung compile gets (decision 0008), and a plain
    message on refusal. Done when a Jake's Resume fork imports in the browser and opens, edits,
    saves, downloads, and opens again after a reload.
13. [ ] **The report and the success bar.** Body words are the reference's, read from its glyph
    stream as the aligner reads a field's; the editable rate is the share inside editable fields.
    At 90% and with the reference's glyph stream matched the import succeeds; below, it is
    partial: the report lists what is locked, each part named by its first words as the page
    shows them, and what was dropped, images and a bibliography the engine cannot build, and the
    user continues or stops. It never shows a macro name or a line of source. Done when the
    report's rate for each upstream sample matches a hand count within a word or two.
14. [x] **Generic controls on imports.** Page size and margins through geometry, in the body's
    preamble region, loaded there when the preamble did not and reissued when it did, proven by
    the fourth check; font size through the class option, format-bound (decision 0006), for a
    class whose sizes follow it, at the sizes it accepts, proven the same way; accent colour where
    the answer names a colour the preamble defines and the probe proves it; font and density
    only where proven; and date format, the generator's, wherever the reader read the dates.
    The `controls` check draws the sample in each proven font, as decision 0012 asked. Done when
    page size, margins and font size work on every successful corpus import, checked by the
    runner, which is the milestone's bar.

### Stage 7. Locked content

15. [x] **Locked chunks on the page.** The model gains what imports need, additively (decision
    0006's rule): a `locked` section kind holding LaTeX verbatim, and typed extras on sections
    and entries holding a call's non-text arguments and sub-chunks, which snippets re-emit
    through a raw extras slot, `{{&x.name}}`, an addition to the snippet language no curated
    package needs. They are the only bytes the generator writes that its escaper did not see:
    they come from the user's own upload, they compile in the user's own browser, and they never
    reach the cache. The generator wraps each in lock markers where the probe shows the wrapping
    survives, so the page draws the chunk where the original did and shows a lock on hover; a
    click opens nothing. The side panel lists a locked part as a row that can be removed or
    moved, not edited. Done when every locked chunk of the upstream samples draws where the
    reference drew it, and the harness passes on packages that hold them.
16. [ ] **Editing locked chunks, decided by the corpus.** Plan section 6.1's edit, a sentence
    typed at a locked chunk that a model rewrites, sends part of the resume to the model, which
    the product rule in AGENTS.md forbids as written. The rule stays absolute until the corpus
    says what is locked in practice: the corpus run (item 17) reports the share of body words
    locked and of what kind. If the share is small, the edit goes to the after-launch list and
    the plan's decision table gets a one-line revision. If it is material, the first form is a
    text substitution with no model: for a locked chunk whose glyphs align to source text, the
    user retypes the text, the bytes are substituted in the chunk, it recompiles in the import
    job, and the edit is accepted only when the document compiles and the glyph stream outside
    the chunk is unchanged, so nothing leaves the browser. Only if that leaves too much locked
    does the model rewrite follow, through a second endpoint with no cache, under a per-edit
    consent and a change to the rule. Locked chunks render, and can be removed or moved, in every
    case. Done when the corpus number is recorded with the choice it led to, and whatever form
    was chosen works on the upstream samples' locked chunks.

### Stage 8. The corpus loop and closing

17. [ ] **The corpus run.** `corpus.ts run` puts every document through the pipeline in Node,
    on the engine session, from the committed answers and the ignored cache, and calls the model
    only with a key and `--allow-model`. It writes one JSON of results, per document: refused,
    partial or success, the editable rate, locked words, the controls proven, the checks' findings
    and the times; and a summary. `.github/workflows/corpus.yml` runs it when a person starts it,
    never on a schedule (decision 0035; a full run takes about an hour on the free runner),
    on the cached `.engine/`, fetching the corpus from the manifest, with no key; the summary
    goes to the job summary and the JSON to an artifact; the run fails when the success rate falls
    more than a point under `corpus/baseline.json`, which a pull request raises by hand when the
    rate rises. A reviewed answer is one corrected under `corpus/answers/`, marked so, with any
    redefinitions it needs (item 6); the top twenty templates get that review, as plan section
    10 asks, from an Opus agent in Claude Code rather than a person (decision 0037). The runner
    writes each template's masked request, its current answers and the checks' findings to an
    ignored folder, the agent reads only those, never `.corpus/`, and writes corrected answers;
    a redefinition is kept only when the reference compile and the four checks pass on every
    corpus document with its key, and the pull request lists each one. The reviewed set seeds
    the service's cache in milestone 5. Done when three runs in a row agree.
18. [x] **Benchmark the candidates, on SoCLaaS.** The naming step runs on SoCLaaS, the School of
    Computing's OpenAI-compatible gateway for its students and staff, whose calls bill nothing
    (decision 0036): `soclaasModel` in `packages/naming/src/providers.ts`, the key in
    `SOCLAAS_API_KEY` and the model in `NAMING_MODEL`, `qwen3.8:27b` by default, asked with its
    thinking off, as this item picked it (decision 0044). The
    gateway holds each candidate's answer to its JSON schema and returns reasoning apart (0036).
    `corpus.ts bench --model <id>` runs the naming step over the corpus for three candidates:
    `qwen3.8:27b`, the gateway's all-round model and the likely best; `qwen3.6:35b`, described as
    efficient and priced under it, the likely fastest; and `qwen3-coder-next`, a code model, since
    naming reads template code; with `gemma4:26b`, another family, or `qwen3.6:27b`, which the
    key's catalog lists, as a fourth if the three fail on the same templates. The rest
    are left out: the 8B and 9B models are weak and their 64k context is tight for a full part,
    `qwen3-vl:32b` reads images, and `ornith:35b` is built for agent loops. The benchmark reports
    the editable rate, the refused and partial shares, each part's time, and the cost per import
    at the gateway's reference prices, which count only toward its limits. The default becomes
    the highest editable rate whose slowest part stays within the naming service's two minutes
    (decision 0028); a decision record holds the table and amends 0036. The key never reaches CI.
    The gateway serves the school's teaching and projects, so before the public launch milestone 5
    asks the school whether the naming service may use it, with Gemini's paid tier as the
    fallback.
19. [ ] **Measure the import, and close.** `measure` gains an import: a cached pdfTeX template,
    a Jake's Resume fork, from the file to the page, in Node and at `?measure=import` in the
    browser, with a warm HTTP cache; under 8 s on this machine is the bar, 5 s until decision
    0045 raised it, and the XeTeX number is reported beside it. The numbers go next to decision
    0016's, the slow laptop's column stays the owner's to fill with the same command, and
    milestone 2's owed table is closed out.

## Decisions this milestone makes

These are the defaults the work above assumes. Each gets a record in `docs/decisions/` in the
pull request that acts on it. The first two the owner settled on 26 September.

- **Editing locked chunks waits for the corpus** (item 16). The rule in AGENTS.md and the
  README says the pipeline sends only macro definitions and placeholdered call sites to the
  model, never the resume's text; plan section 6.1's edit sends a locked chunk's text. The rule
  stays absolute, and the corpus's locked share decides: nothing if it is small, a text
  substitution with no model if it is material, and the model rewrite under per-edit consent
  only if that is not enough. Locked chunks render and can be removed or moved either way.
- **The naming service lives inside the editor's project** (item 10), not in an app of its own:
  one handler on the fetch API, served by the dev server's middleware in development and by a
  Pages Function or the app's Worker in production, with the logic in `packages/naming` so that
  Node runs it for the corpus. One project, one origin and one deploy, at the cost of keeping the
  function's folder out of Vite's bundle and under its own TypeScript config, which a test
  asserts. The plan's hosting row names a separate Worker; milestone 5 revises it.
- **The corpus lives outside git** (item 1): a manifest of sources with hashes, content fetched
  and never committed; the answers are committed, since they name macros and never text.
- **The engine gives the parser its signatures and its definitions** (item 4): `\meaning` from a
  compile, which normalises what a fork changed only in spacing or comments, so class files are
  never parsed for definitions and the cache key is TeX's own reading of a macro. The key is the
  hash of the normalised definition, its dependencies' hashes and the naming version.
- **An imported package is a decision-0006 package under the prefix `import-`** (item 7), its id
  a hash of the assembled package, so the same template gets the same id and formats across
  documents and people; the loader refuses a curated id under the prefix and an imported one
  outside it, which closes what item 4's review left to this milestone.
- **Locked content is model data** (item 15): a `locked` section kind and typed extras the
  generator re-emits verbatim through raw extras slots; never in a snippet, never in the cache.
- **A field that breaks only when empty is required, not locked** (item 7): the package marks
  the slot and the editor refuses to empty it, as a required form field does; a field that
  breaks on ordinary text is locked. Plan section 6's step 5 demotes anything that fails a check
  to locked, and this is the one refinement.
- **Reviewed answers may carry redefinitions** (items 6 and 17): LaTeX a person or the review
  model wrote, an Opus agent in Claude Code (decision 0037), never the naming model, that redefines
  or adds macros after the document class, keyed as the answer is, and kept only when the
  reference check shows the page unchanged and the four checks pass on every corpus document whose
  command has the redefined key (`corpus review check`, decision 0043), so that a fix a port made
  by hand reaches every fork with the same macros. The naming step's model never writes LaTeX;
  only item 16's rewrite does, under its own rule.
- **XeTeX imports resolve fonts to the tree by name** (item 8) and refuse the rest, and carry
  the features the reference sets, per shape, with the page reading a substituted glyph's text
  through the font's substitution table, the two additions decision 0014 named; a font shipped
  in a zip is matched by file name and never kept. Fonts a user supplies wait for a package
  format that carries binary files, and for the storage to hold them.
- **The reference compile is the one compile that lets fontconfig see the tree** (item 3), since
  fontspec by name needs it; the loop's compiles never do (decision 0011).
- **Images are dropped at intake** (item 3) and named in the report; version one's PDFs carry
  none (decision 0008), and a template's photo is an extra.
- **The import runs on the editor's engine** (item 12), in a job of its own while the list
  shows, so one engine is loaded at a time on an old laptop; cancel and a hung compile terminate
  the worker, which starts afresh.
- **The import's bar is judged on pdfTeX** (item 19), on a cached template with a warm HTTP
  cache on this machine, and XeTeX is reported, as the plan already lets XeTeX feel slower. The
  bar is under 8 s: the owner raised it from the plan's 5 s on 2 October (decision 0045).
- **The provider is the AI SDK's, Gemini first** (item 9), as plan section 6.4 has it, then
  SoCLaaS (decision 0036), whose model item 18 picked (decision 0044). New dependencies this
  milestone expects: unified-latex's parse, arguments, argspec, macros, to-string, visit and ctan
  packages (editor), fflate (editor), `ai` with `@ai-sdk/google` and `@ai-sdk/openai-compatible`
  (naming), and wrangler as a dev dependency of the editor for the function. Each is named in
  the pull request that adds it.

## Risks

- **Real resumes are messier than the ports.** Arguments used twice, `\MakeUppercase`, tables
  and minipages around fields, headers written as plain text with `\href`, math for separators,
  `\\` inside a field, and macros defined in the body. The success bar keeps a bad import from
  looking like a good one, and the corpus number is the measure: a first rate well under the bar
  on hand-rolled documents is information, not failure, and the corpus run shows what each
  item wins.
- **A cold first import fetches a lot.** A whole-document compile from the stock format reads
  the 6.5 MB format and the class's packages, one synchronous request at a time (decision 0010),
  and the prefetch has no list for an unknown template. The import's bar, 8 s since decision 0045
  raised it from 5, assumes a warm HTTP cache; the first import on a machine takes longer, and
  the progress line has to say so. Prefetching the stock format and the files the reference
  compile read, before the dump, is the mitigation.
- **Compiles add up.** Probes, four checks and their bisections are a few dozen compiles, near
  the logarithm of the field count when few fail and linear when many do; on the M4 Pro that is
  two to three seconds for a Jake fork, on the slow laptop perhaps ten. Plan section 6.4's 60 s
  for a cache miss is generous; the 5 s for a hit was tight, and item 19 found by how much, after
  which decision 0045 raised it to 8 s.
- **XeTeX imports start slow.** fontspec's probing costs 200 to 350 ms a face (decision 0003),
  so the reference compile of an Awesome-CV fork costs seconds before the loop starts. Item 8
  measures it; if it is too much, a template whose rewrite validated once, on a cache hit, could
  skip the original compile, which a later record would have to accept.
- **Memory on old laptops.** An import's format sits beside the open document's, and every
  imported template adds formats to the store's twenty (decision 0010); dropping a package's
  formats with its last document keeps it bounded. Two engines never load at once.
- **The model on hand-rolled templates.** Per-macro caching, the locked fallback and the bar
  bound the damage, as the plan says; the benchmark makes the trade-off visible. SoCLaaS's
  models are open ones of 27 to 35 billion parameters, not frontier models, so the editable rate
  may come out lower than a larger model's would, and the locked fallback takes what they miss.
  Only definitions ever leave, whichever provider answers: Gemini's free tier may train on
  inputs, and SoCLaaS is the school's service, so the launch either has the school's leave or
  moves to Gemini's paid tier (plan section 8.3).
- **Licences.** The corpus is never redistributed and the answers name macros only. The shared
  cache keeps, with each answer, the stripped definitions it was given, for the audit plan
  section 6.3 asks for; whether that holds for an unlicensed fork is a launch question, and until
  milestone 5 the service runs only locally.
- **Network.** GitHub's API and raw files are reachable from this environment (item 1); the
  TeX Live mirror is not (item 2), so growing the tree needs a machine that reaches it, as
  milestone 2's item 19 did.
- **Server code inside the browser package.** The function's folder must never reach Vite's
  bundle, and the key must never reach the page: a build-output test and the `VITE_` prefix
  rule guard both, and the folder's own TypeScript config keeps the DOM and Workers types apart.
- **The endpoint is open once deployed.** A public route that calls a paid model needs the rate
  limit of item 10 and, before launch, a bot check; both are milestone 5's to finish.

## Owed from milestone 2, and where each lands

| Item | Where |
|---|---|
| Imported ids minted under a prefix no curated package uses, and a loader that refuses or re-mints the rest (decision 0006, item 4's review) | Item 7 for the curated loader (`checkCuratedId`, decision 0026); item 12 for the store's |
| The harness in a worker the browser can terminate (decision 0008) | Item 12 |
| The `controls` check draws each font an import proves (decision 0012) | Item 14 |
| A template chooser for a new document | Item 12 |
| The slow laptop's column in decision 0016 | The owner's, with the same command; item 19 adds the import to it |
| Small capitals and per-shape features for Awesome-CV (decision 0014's additions) | Item 8: an import's reference compile sets them, so the loop must too |
| Case folding in the aligner, for a field set through `\MakeUppercase` (decisions 0007 and 0013) | Item 5 |
| The first load at 42 to 44 MB uncompressed | Milestone 5 |
| The PDF's text layer showing a hyphen as U+2011 in some XeTeX fonts (decision 0014) | The ATS's reader; not this milestone |
| The PDF's text layer showing an import's small capitals, set with `+smcp`, as capitals: the Awesome-CV sample's seven entry titles and four Awesome-CV forks (decision 0026) | The ATS's reader, or the PDF driver; not this milestone |
| An imported section whose head opens its content's list, with the locked part that closes it, kept as one unit: removing the section alone stops the compile in 20 of Jake's forks (decision 0026) | The assembly, before item 12 stores an import |

Item 19 closes the table out in decision 0045: where each row landed, and where the four that stay
owed go.
