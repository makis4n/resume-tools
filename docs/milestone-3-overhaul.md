# Milestone 3, second pass: imports without the shared structure

Written 3 October 2026, after milestone 3 closed, and approved by the owner the same day.
It changes what importing a `.tex` resume means, and adds a second way in, from a PDF. Each numbered
item is one pull request, or a few if it grows past ten minutes of reading. Tick the item in the
pull request that finishes it.

## What the owner asked for

1. **A PDF comes in, and its content lands on a built-in template.** A person drops a PDF. The
   editor reads its text, works out the name, the sections, the entries and the bullets, shows what
   it read so the person can correct it, and opens it in Jake's Resume, AltaCV or Awesome-CV. The
   look is the template's, not the PDF's.
2. **A `.tex` file comes in, keeps its own look, and takes simple edits.** The person clicks text
   and types over it, and adds or removes a bullet. The import no longer fits the resume into the
   editor's shared structure.

## Why the first pass fell short

The first pass (docs/milestone-3.md) made a piece of text editable only when it could be filed into
the editor's one shared structure for a resume: contact details, then sections of entries with a
title, a subtitle, a place, dates and bullets, or simple lists. A language model named each
template command so that its arguments could be filed. Measured on the 220 public resumes of the
corpus, with the saved answers and the model:

| | Resumes | What it means |
|---|--:|---|
| Never compile here | 103 | 38 need a package the engine lacks, 21 a font, 27 stop for another reason, 9 lack a file, 5 a template, 3 need LuaTeX |
| Refused, no answer, or timed out | 25 | 12 got no answer for any command they call, all of them resumes outside the five template families |
| Import as partial | 92 | 22% of their words are editable |
| Reach the 90% bar | 0 | |

Two facts from the records say where the words are lost:

- **The safety test passes far more than ends up editable.** Before any structure is involved, the
  probe tests which pieces of text can safely carry the editor's markers. Over the resumes that
  compile, the pieces it passed cover 73% of what is on the page: 93% for Jake's forks, 92% for
  Awesome-CV's, 88% for AltaCV's, 82% for Europe CV's, 65% for moderncv's and 51% for the rest
  (decision 0022). After fitting, 22% of words are editable.
- **Almost every locked word is locked for not fitting.** Of 51,452 locked words, 48,179 (94%) are
  locked because they have no slot in the structure, or their slot wants plain text or a date the
  structure can hold. Only 3,273 (6%) are locked because a safety check failed.

So the mechanism that makes text safely editable works. The fitting discards most of what it
proves.

## The idea

Four words used below:

- A **field** is text a person clicks and types into, on the page.
- **Kept text** is the upload's own LaTeX, written back byte for byte, which nothing edits.
- A **unit** is something that repeats, a bullet or an entry, which can be copied, removed and
  moved.
- An **outline** is an imported resume in its own shape: kept text, fields, and groups of units.

**A `.tex` import becomes an outline.** Every piece of text the probe proves is a field, where it
stands in the person's own LaTeX. Everything else is kept text. What repeats is found from the
source itself: a list's items, and a run of calls to the same command. Adding a bullet is copying
the bullet beside it with its text emptied; the editor never needs to know which argument is the
company and which is the date. No command is named, so no language model is asked and a `.tex`
import sends nothing.

**A PDF import fills the shared structure.** A PDF has no source to keep, so its content is read
and filed into the structure the built-in templates already use, and one of them typesets it. The
shared structure therefore stays, for the three built-in templates and for PDF imports. It is only
`.tex` imports that stop using it.

**Reading a PDF is two jobs, and a hosted model does one of them.** Rules always do the geometry:
lines, columns, bullets and reading order, from where each piece of text sits. Saying what each
line is, a name, a heading, an entry's head, a date, is where rules are weakest. Once the person
has agreed, a hosted model does it. For a person who has not, or when the service fails, rules do.
The owner chose the hosted model on 3 October 2026, over a model on the person's device, which
would reach only some browsers and machines.

### The privacy rule, in one sentence

Until 3 October 2026 the rule was a promise with a list of exceptions: resume content stays in the
browser, except when the person saves it to their account or sends a PDF to the checker, and the
import's model sees only the template's code. This pass would have added a third exception. The
owner restated the rule as one principle instead (decision 0047), and AGENTS.md and the plan page
now carry it:

> Resume content leaves the browser only when the person asks for something that needs it and is
> told what is sent, and whoever receives it keeps only what the person asked to be kept.

Every case fits under it without another exception:

| What the person asks for | What is sent | What the receiver keeps |
|---|---|---|
| Save to my account | the document | the document, since keeping it is what was asked |
| Check this resume | its PDF, to the checker | nothing |
| Read this PDF | its text, to the reading service and its model | nothing |
| Import a `.tex` file | nothing | nothing |

A feature that sends resume content asks the first time, remembers the answer in that browser with
a setting to change it, and says each time that it sends. It keeps nothing it was not asked to
keep. The checker's own requirements already work this way and do not change.

### What happens to the first pass's work

| | First pass | This pass |
|---|---|---|
| Intake, the reference compile, images and stand-ins | built | kept as it is |
| The parser and the body's tree | built | kept as it is |
| The probe | built | kept; on XeTeX it runs after the fonts are rewritten, from a saved format |
| XeTeX fonts by file | built | kept, moved before the probe |
| Naming request, privacy gate, cache, answers, review, benchmark | built | retired, with 209 answer files |
| The model's provider code and the naming service's shell | built | kept, and reused by the service that labels a PDF's lines |
| Assembly into the shared structure | built | replaced by the outline's builder |
| The four checks | built | kept, without answers |
| Report, success bar | built | kept, counting fields, retyped text and locked text |
| Controls, locked parts on the page, every page, the retype | built | kept; the retype becomes the fallback for kept text |
| The corpus, its run, the oracle and the hand counts | built | kept; one mode, a new baseline |
| The shared structure and the built-in templates | built in milestone 2 | untouched |

The naming step is about 23,500 lines with its tests. All of it leaves the `.tex` import, and most
of it leaves the repository.

## Done means

The owner set these targets on 4 October 2026 from what item 2 and item 3 measured (decisions
0050 and 0051), in place of the provisional numbers this plan was approved with. Each figure in
brackets is the spike's.

**For a `.tex` import**

- Every corpus resume that compiles and is probed imports. The outcome "no answer" no longer
  exists.
- At least 60% of body words are editable in place over those resumes, and at least 90% on Jake's,
  Awesome-CV's and AltaCV's forks (67.7% and 95.3% on the twenty, before check 2; the first pass
  reached 22%). The targets leave room for check 2, which the spike did not run.
- At least 45 resumes reach the 90% bar (12 of the twenty, about 58 to 70 scaled to the 117 that
  compile; the first pass reached none).
- On each upstream sample, a bullet can be added to a list and removed from it, and a field on the
  last page opens in place.
- A `.tex` import makes no network request, which a test proves.
- A pdfTeX import stays under 8 s on this machine, judged on Jake's sample; the other families'
  times are reported (Jake's forks 2.7 to 7.1 s before checks 2 and 4, AltaCV's and moderncv's
  6.5 to 23 s). A XeTeX import is reported, with 20 s as the aim (an estimate of 11 to 18 s from a
  saved format, not yet measured; about 75 s on the Awesome-CV sample today).

**For a PDF import**

- Once the person has agreed to send PDFs' text, on invented resumes made in other tools: at least
  90% of fields are right against their hand-written truth (92.4% to 94.3% over three passes).
- With rules alone, which is what a person who says no gets:
  - on PDFs the editor's own engine makes from the three built-in templates with invented resumes,
    every word read lands in the resume; the name, email, phone, links, section titles and roles
    come back exactly; at least 95% of entries have the right title, place and dates, counting an
    entry's title and subtitle as a pair, since Awesome-CV sets the employer above the role (100%
    so counted, 73.3% otherwise); bullets come back exactly (all met);
  - on PDFs of the corpus's resumes that compile, every word read lands in the resume, and at
    least 95% of words land in a recognised place and not in the catch-all section (97.6% of the
    73 read);
  - on invented resumes made in other tools, at least 80% of fields are right (91.9% over eight,
    68.8% on the two the rules were not tuned on, which is why this one stays at 80%).
- With rules a PDF import takes under 1 s (232 ms at most). With the model it finishes inside a
  time budget of 15 s, after which the rules answer (every answered call took 8.1 s at most; one
  failed call hung for 70.3 s).
- Nothing is sent unless the person has agreed, which a test proves. The question is asked once
  and the answer remembered, with a setting to change it. The service keeps no text, in a cache or
  in a log.
- A scanned or password-protected PDF is refused in plain English.

**Not in this pass**

- Keeping a PDF's own look, reading scanned PDFs, and Word files.
- A language model in a `.tex` import.
- A model on the person's device. The one a browser carries reaches only desktop Chrome, and one
  the editor ships would cost each person a download of about 700 MB and a capable machine.
- Switching an imported `.tex` resume to another template. Without the shared structure, its text
  has no meaning the editor could carry across. The bridge of item 16 is the way to move content.
- More packages and fonts for the 103 resumes that do not compile. The PDF path is their way in for
  now; growing the engine's tree is the next milestone's question.
- Loosening the retype so that a longer text may push later text down.
- Accounts and cloud save (the plan's milestone 4), hosting and launch (milestone 5). Until the
  service is hosted, the hosted reading works where the dev server answers its route, as the naming
  service did.

## The work, in order

Stage 0 comes first and is small. Stages 1 and 2 share no code and can run side by side. Stage 3
closes.

### Stage 0. Decide, then measure before building

1. [x] **The decision.** One record says: an imported `.tex` keeps its own shape as an outline; the
   shared structure stays for the built-in templates and is what a PDF import fills; the naming
   step leaves the import; importing from a PDF comes into scope; and a PDF's text may be sent to
   be read once the person has agreed, under the privacy rule as decision 0047 restates it. It
   names the records it supersedes (0024, 0027, 0036, 0037 and 0044's choice for naming; the
   assembly of 0025 and 0026; the answer modes of 0043) and the ones it amends (0028, whose
   service gains a route and loses naming's; 0033, whose gate and leak check go with the naming
   step). Its pull request revises the plan page, docs/editor-plan.md, in the places listed under
   "What the owner does", since the plan now lives in the repository (decision 0048). Done when the
   record and the revised plan page are merged.
2. [x] **Spike: the outline on the samples.** A script and no editor work. For the three upstream
   samples and a twenty-resume sample of the corpus, it builds the outline from the tree and the
   probe's verdicts, compiles it, and counts: words in fields, words in kept text the retype
   reaches, words locked, the groups of units found, and how many take a copy and a removal. It
   prints the table by template family beside the first pass's. Done when the table is recorded and
   the owner has set this plan's `.tex` targets from it.
3. [x] **Spike: reading PDFs, by rules and by the hosted model.** With the reader named below, a
   script reads three sets and reports on each:
   - PDFs the editor's engine makes from the three built-in templates and invented resumes, where
     the truth is known exactly: words, header fields, section titles, entries, bullets.
   - PDFs of the corpus's resumes that compile, printed by the engine, as counts only and never
     text: words kept, the share that lands in a recognised place and not in the catch-all,
     sections and columns found, files refused. This set is read by rules alone and says how good
     the reading is for a person who says no.
   - A few invented resumes made in other tools, each with its truth written down as it is made.
     An agent makes them with a browser's print and with macOS's own text system, since the machine
     has no word processor or design tool (the owner's choice of 3 October 2026). The owner may add
     PDFs from other tools later.

   On the two invented sets it also asks the hosted model, the school's, starting from decision
   0044's choice, to say what each line is, and records how many fields come out right beside the
   rules', and how long a call takes. No corpus resume is given to the hosted model. It records the
   reader's size and how it loads. It needs the owner's leave for the dependency before it starts.
   Done when the tables are recorded with the rules' and the model's results side by side, and the
   owner has set this plan's PDF targets and the model's time budget.

### Stage 1. A `.tex` import that keeps its own shape

4. [x] **The outline in the shared model.** `packages/resume-model` gains, additively, a section
   kind that holds an outline: kept LaTeX, fields of plain or rich text, and groups whose units
   repeat. The generator writes it: kept text byte for byte, each field escaped inside the editor's
   marker, as it writes a slot today. Nothing of the built-in templates changes, and no second type
   for the same thing is added elsewhere. Done when a hand-written outline of an invented resume
   goes through the store and the generator, compiles, and the page marks every field, with the
   existing suite green.
5. [ ] **Building the outline, in place of naming and assembly.** After the probe, the import walks
   the body's tree. Each piece the probe judged editable is a field. The rest of a call, an
   environment or a paragraph is kept text. A list's items are a group of units, and so is a run of
   calls to the same command, each with what follows it up to the next. A value the preamble
   stores, as Awesome-CV's name, stays a field through a slot in the preamble, as today. No request
   is built and no service is called. On XeTeX the fonts are rewritten to files first, so the probe
   compiles from a saved format. Done when the three samples import with no naming call, and a test
   proves a `.tex` import makes no network request.
6. [ ] **The checks, without answers.** Check 1: the outline compiled sets the reference's page; a
   field whose rewriting moves it becomes kept text. Check 2: every field takes a long text, no
   text and special characters; one that stops the compile when empty is required, and one that
   stops on text becomes kept text. Check 3: every group gains a copy of its last unit with its
   fields emptied, and loses its first and its last; a group that cannot is fixed, and the editor
   neither adds to it nor removes from it. Check 4, the controls, is unchanged. The report counts
   three shares, editable in place, changeable through the retype, and locked, with each locked
   part's reason in plain words. `corpus run` has one mode. Done when the twenty-resume sample runs
   through and the report's shares on the three samples are pinned.
7. [ ] **Typing in an imported resume.** A field of an outline opens in place on any page, as a
   built-in template's does: the typing box, undo and redo, and bold, italic and links where the
   field is rich text. Kept text that lines up with the page keeps the retype. The side panel shows
   the outline, its parts in order by their first words, in place of the labelled form. Done when,
   on each sample, a field on the first page and one on the last open in place and an edit is still
   there after a reload.
8. [ ] **Adding, removing and moving units.** A bullet gains a sibling from the page, with Enter at
   its end, and from the side panel; an entry likewise; either can be removed or moved among its
   siblings. A new unit is a copy of the one beside it with its fields emptied, or holding a
   placeholder where a field is required. The step is held until its compile shows and taken back
   with a plain message when it fails, as a structural step is today. Done when, on each sample, a
   bullet is added to a list and removed from it with the rest of the page unchanged but for moving
   down, and a fixed group's button is disabled with its reason.
9. [ ] **The corpus on the new import.** The whole corpus runs on the new import. The baseline is
   reset. The run is compared resume by resume with the first pass's last run. The hand counts on
   the three samples are taken again and pinned. The import is timed on pdfTeX and on XeTeX. Done
   when three runs in a row agree and the `.tex` targets are met, or each gap is recorded with its
   cause.

### Stage 2. A PDF onto a built-in template

10. [ ] **Reading a PDF in the browser.** The reader loads only when a person imports a PDF, in a
    chunk and a worker of its own, and fetches nothing. It gives each page's runs of text with
    their position, size, font and weight, and each link's rectangle and address. It refuses, in
    plain English, a file that is not a PDF, one with a password, one with no text, and one past a
    size cap. Done when PDFs from the three built-in templates and from a browser's print are read,
    a build test shows the main bundle holds no reader, and a test proves no network request.
11. [ ] **Lines, columns and reading order.** Rules, always. Runs become lines and lines become
    blocks. Columns are found from the gaps between them and read one after the other. A bullet's
    glyph marks a bullet. An icon is dropped and its drop noted. A hyphen at a line's end joins its
    word only where the next line carries on in small letters. Done when AltaCV's two-column PDF
    reads in the order a person reads it, and the corpus set's column counts are recorded.
12. [ ] **From layout to the resume, by rules.** Two steps with a seam between them. The first says
    what each line is: the name, a contact, a section's heading, an entry's head, a date, a place,
    a bullet, or running text. It is given each line's text and its features, its size, its weight,
    where it sits and what stands around it, and gives back one role from a closed list. Rules do
    this here, and they stay the answer for a person who does not agree to send the PDF's text. The
    second step files the labelled lines into the resume: the header's fields, with links'
    addresses from the PDF's own links; sections with the role their heading's words give; entries
    with their title, place, dates and bullets; lists, labelled lists and paragraphs. Bold, italic
    and links inside a text are kept. A date the structure cannot hold stays as text in its entry
    and is flagged. What fits nowhere goes to a last section and is flagged, so nothing is dropped:
    a check counts every word read against the resume built. Done when the targets item 3 set for
    rules are met on the three sets.
13. [ ] **The hosted model for the labels, with consent.** It replaces only the first step of
    item 12. The first time a person imports a PDF, they are asked whether PDFs' text may be sent
    to the reading service, in plain words that say what is sent and that nothing is kept. The
    answer is remembered in that browser, a setting changes it, and every later import says in one
    line that the text is being sent. With a yes on record, the labelling step sends the lines'
    text and features to a route of the editor's own service. The service asks the hosted model,
    with the roles as a closed list so that a reply is valid by construction, and returns the
    roles. It holds the key, limits the rate, and keeps no text in a cache or in a log. With a no,
    a failure, a reply of the wrong form or a call past its time budget, the rules answer, and the
    review says which read the PDF. It reuses the first pass's provider code and service shell. It
    is the first feature built under the one-sentence privacy rule (decision 0047). Done when the
    model's labels on the invented sets meet the target item 3 set, the fall back to rules is
    tested for each cause, and a test proves nothing is sent before a yes or after the setting is
    turned off.
14. [ ] **The review, and the way in.** The documents screen takes a PDF as it takes a `.tex`. The
    review shows the PDF's pages beside the resume as read, the flagged items first, with the
    template to open it in and its page as that template sets it. The person corrects, picks, and
    creates the document, which is then an ordinary one of that template. Done when the flow works
    in the browser on a PDF of each built-in template, with a yes and with a no.
15. [ ] **How well it reads, tracked.** Item 3's three sets become tests of the rules: the built-in
    templates' round trip and the invented resumes from other tools with the targets as their
    thresholds, and the corpus set as a command that reports counts and never text, run by hand as
    the corpus run is. The model's reading is measured by a command run by hand with the key, on
    the invented sets only; the suite tests its path with a recorded reply, and no model is called
    in CI. Done when the numbers are recorded and the thresholds hold in the suite.
16. [ ] **The bridge between the two ways in.** A `.tex` import that is refused offers the person
    its PDF instead. One that compiles but ends under the bar offers to move its content onto a
    built-in template, which runs the PDF path on the import's own reference page, under the same
    consent. Done when both offers show in the report and each produces a document on the three
    samples.

### Stage 3. Retire and close

17. [ ] **Retire the naming step.** Once item 9's numbers beat the first pass's and item 13 has
    landed. The naming package's prompt, request, masking, cache and answers, the import's request
    and privacy gate, the service's naming route, the committed answers, and the review, seed,
    benchmark, leak and naming commands all go. The model's provider code and the service's shell,
    its rate limit and its key handling, stay and serve the PDF reader. The line about the naming
    request leaves AGENTS.md, and the README's paragraph on naming is rewritten to say that a
    `.tex` import sends nothing. The superseded records are marked so. Done when the build and the
    suite are green, nothing in a `.tex` import reaches the service, and the corpus workflow runs
    the one command that is left.
18. [ ] **Measure and close.** The measuring page times a `.tex` import on both engines and a PDF
    import by rules; the model's time comes from item 15's command. One record holds the numbers
    beside decision 0045's. docs/milestone-3.md gets a line pointing here. The status page gets a
    section for each item that changed the product.

## How an import runs after this pass

**A `.tex` file:** read the files; compile the original; on XeTeX, rewrite the fonts to files; read
the body as a tree; probe which pieces can be fields; build the outline; run the four checks; show
the report; open the document. Nothing is sent anywhere.

**A PDF:** the first time, ask whether PDFs' text may be sent, and remember the answer; read its
text and links; find lines, columns and order; say what each line is, by the hosted model where
the person has agreed and by rules otherwise; file the lines into the header, the sections, the
entries and the bullets; count the words in against the words out; show the review; open the
document in the template the person picked. Nothing is sent without that agreement.

## Decisions this pass makes

These are the decisions the work above assumes. Each gets a record in `docs/decisions/` in the pull
request that acts on it, numbered from 0049 in the order they land. The owner approved the first
nine with this plan on 3 October 2026, having given the fourth and the fifth earlier that day.

- **An imported `.tex` keeps its own shape.** The outline replaces the fit into the shared
  structure. The cost is everything that needs to know what a piece of text means: switching an
  import to another template, the date format control on imports, and a labelled form in the side
  panel.
- **The naming step leaves the `.tex` import and is deleted, not kept asleep** (item 17). The
  history keeps it. The other choice is to leave it unused, which costs its upkeep at every change
  to the import. What stays is the model's provider code and the service's shell, which the PDF
  reader's labelling uses.
- **The PDF reader is pdf.js**, Mozilla's, under the Apache 2.0 licence: one new dependency, named
  in item 10's pull request, loaded on demand so the first load does not grow. The other choice is
  the reader the checker uses, built for the browser, which would read exactly what the checker
  reads; it is less common in browsers and has not been tried here. Item 3 settles it.
- **A hosted model says what each line of a PDF is, with the person's consent, asked once and
  remembered.** The owner chose this on 3 October 2026. It reads best and works on every browser
  and device. It sends the PDF's text out, which the privacy rule allows once the person asks and
  is told. The question comes the first time a person imports a PDF; the answer is kept in that
  browser, a setting changes it, and each later import says that the text is being sent. The
  service keeps none of it. A person who says no gets the rules. The choices set aside: a model
  the browser carries, which reaches only desktop Chrome on a capable machine; a model the editor
  ships, which costs each person a download of about 700 MB; and rules alone, which stay as the
  fallback.
- **The privacy rule is one sentence**, already recorded as decision 0047: resume content leaves
  the browser only when the person asks for something that needs it and is told what is sent, and
  whoever receives it keeps only what the person asked to be kept. AGENTS.md and the plan page
  carry it in place of the promise with its list of exceptions. It is kept and not dropped,
  because it is what stops a change from logging, caching or forwarding a resume for convenience.
  In code it means that no request carries resume content without the person's agreement, that a
  service which receives it writes it to no cache and no log, and that a test holds each.
- **The hosted model is the school's during development**, starting from the model decision 0044
  chose for naming, which item 3 measures on this task. Who provides it at launch stays where the
  plan has it (section 8.3): the school's leave for real people's resumes, or a paid service whose
  terms rule out training on what it is sent.
- **A PDF import promises the content, not the look.** The review screen says so before the person
  creates the document.
- **Imports made by the first pass are not migrated.** The editor is not online, so they exist only
  on developers' machines. The store refuses them with a plain message and the person imports
  again.
- **Agents may read the three upstream samples**, under `.corpus/oracle/`, for this pass's
  done-checks and hand counts, and no other resume of the corpus, as before. No corpus resume is
  given to a hosted model.
- **Rules always do the geometry.** Lines, columns, bullets and reading order come from positions,
  whoever labels the lines.
- **Fields are proven once, at import, and then trusted.** The probe and check 2 prove that a piece
  takes any text; after that an edit is any length and reflows as TeX sets it. Kept text is edited
  only through the retype, which checks every edit.
- **What repeats is found by shape and proven by a compile.** A group is fixed unless check 3 adds
  to it and removes from it. No meaning is guessed.
- **The success bar stays at 90% of words editable in place.** Words the retype reaches are
  reported beside it and do not count toward it.

## Risks

- **The probe's 73% may not survive.** It counts letters before the checks ran, and the outline
  must also write each field back exactly. Item 2 measures it before anything is built on it.
- **More fields mean more compiles.** The checks bisect, so the cost grows slowly while few fields
  fail and fast when many do. The probe's budget of 64 compiles leaves what it did not reach
  untested, which is locked. Item 9 times it against the 8 s bar.
- **A copy is not always a valid unit.** Units that share a counter, or a list whose closing
  command sits in a later part, break when copied. Check 3 and the editor's guard catch it, and the
  person sees a disabled button with its reason.
- **A field can be a fragment.** A title holding a link or an underlined word becomes two or three
  fields either side of the kept piece. Each works, and typing across them is clumsy until they
  open as one box, which is polish for a later pass.
- **Two kinds of document in one editor.** A built-in template's document has a labelled form and
  meaning-aware controls; an imported one has an outline. The page behaves the same; the side
  panel does not.
- **Deleting the naming step closes a door.** Template switching for imports, and any feature that
  needs meaning, would have to be rebuilt from the history.
- **The privacy rule is looser than the promise it replaces.** It goes from "your resume never
  leaves" to "it leaves only when you ask and are told". One sentence is easier to keep than a list
  of exceptions, and easier to stretch: each feature that sends anything needs its own question to
  the person, its own test, and a receiver that keeps nothing. A remembered yes is also easy to
  forget, which is why each import says that it sends and the setting sits beside it.
- **People may say no, and then the rules read the PDF.** Vendors of resume parsers put rule-based
  readers at about 65 to 70% of fields right on clean resumes, and model-based ones in the high
  nineties. Those are their own figures for a wider task, so they give the direction and not our
  number. The rules still have to be decent, and item 3 measures them on the corpus's own PDFs.
- **The hosted reading depends on a service.** During the first pass's benchmark the school's
  gateway was down for a day, and slow calls ran past a minute. Hence the time budget, the fall
  back to rules, and the review saying which read the PDF.
- **An open route that calls a model invites abuse.** The rate limit comes with item 13. A bot
  check and the hosting itself are milestone 5's.
- **The provider at launch is unsettled.** The school's service needs the school's leave before it
  reads real people's resumes; a paid service costs money for each import.
- **A silent mistake in a PDF import is worse than a locked part.** A merged date or a bullet filed
  under the wrong entry reads as fine. The word count catches a drop, the flags point at doubt, and
  everything is editable afterwards, which is the remedy.
- **The reader parses files a stranger made.** It runs in a worker with script evaluation off, and
  item 10 gets an adversarial review.

## What the owner does

- Approved the first nine decisions above with this plan, on 3 October 2026.
- May add a few PDFs made in other tools, from invented resumes, with their truth written down;
  item 3's agent makes the first ones.
- After items 2 and 3: set the targets and the model's time budget, on 4 October 2026.
- Reviews item 1's revision of the plan page: the canonical model's row and section 5.2, which say
  every document is stored in one model; section 6's steps 4 and 5 and sections 6.1 to 6.4, on
  naming, locked content, the cache and the model; the scope line that leaves importing from a PDF
  out; and milestone 3's "Done means". The privacy rule is already there.
- Settles, before launch, who provides the hosted model.

## How the work is run

As the first pass was: one branch and one worktree an item, an implementer on each, checks run
before the pull request, squash merge when the editor's check is green. Items 5, 6, 8, 10, 13 and
17 are the risky ones and get an adversarial review once before they are pushed: they put typed
bytes into TeX, parse files a stranger made, send a resume's text, or delete at scale. Whole-corpus
runs and full suites run one at a time. A change to the import's paths says in its pull request
that a corpus run is worth doing, and leaves starting one to the owner. No model is called in CI.

| Item | Size | Depends on |
|---|---|---|
| 1 The decision | small | the owner |
| 2 Spike, outline | small | 1 |
| 3 Spike, PDFs by rules and by the model | medium | 1, the dependency's approval, the owner's PDFs |
| 4 Outline in the model | small | 2 |
| 5 Building the outline | large | 4 |
| 6 The checks | large | 5 |
| 7 Typing | medium | 6 |
| 8 Units | medium | 7 |
| 9 Corpus on the new import | small | 8 |
| 10 Reading a PDF | medium | 3 |
| 11 Lines and columns | medium | 10 |
| 12 Layout to resume, by rules | large | 11 |
| 13 The hosted model, with consent | medium | 12 |
| 14 Review and the way in | medium | 13 |
| 15 Accuracy tracked | small | 13 |
| 16 The bridge | small | 9, 14 |
| 17 Retire the naming step | medium | 9, 13 |
| 18 Measure and close | small | 16, 17 |

## Sources for the outside figures

- Rule-based and model-based accuracy, and what breaks each:
  <https://www.thehirehub.ai/blog/ai-resume-parsing-in-2026-how-it-works-how-accurate-it-actually-is-and-what-breaks-it>
- Rules for the geometry and a model for the labels:
  <https://hackernoon.com/building-a-deterministic-ai-resume-parser-with-pdf-preprocessing-and-schema-validation>
- The model desktop Chrome carries, and which browsers have it:
  <https://developer.chrome.com/docs/ai/prompt-api>
- The size of a small model an editor could ship to the browser:
  <https://pinggy.io/blog/run_llm_in_browser_webgpu/>
