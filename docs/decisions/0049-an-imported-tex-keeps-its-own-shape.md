# 0049. An imported `.tex` keeps its own shape, and a PDF lands on a built-in template

Date: 2026-10-04 · Status: accepted, the owner's decision of 3 October 2026 (approved with
docs/milestone-3-overhaul.md)

## Context

The first pass of milestone 3 (docs/milestone-3.md) made a piece of an imported resume editable
only when it could be filed into the canonical model, the one structure the plan stored every
document in: contact details, then sections of entries and lists. A language model named each
template command so that its arguments could be filed (decisions 0024, 0027, 0036 and 0044), and
the assembly built a package and a document from the answers (decisions 0025 and 0026). Over the
220 public resumes of the corpus, none reached the 90% bar, and 22% of the words of the 92 that
imported were editable. Yet the probe had passed pieces covering 73% of what the pages show
(decision 0022), and 94% of the 51,452 locked words were locked for having no place in the
structure, against 6% for failing a safety check. The mechanism that proves text safe to edit
works; the fitting discards most of what it proves.

The owner also asked for a second way in: a person drops a PDF, and its content opens in Jake's
Resume, AltaCV or Awesome-CV. The plan had left importing from a PDF out of version one (section
4.2). The second pass of milestone 3, docs/milestone-3-overhaul.md, plans both, and the owner
approved it on 3 October 2026.

## Decision

### An imported `.tex` keeps its own shape

- It becomes an outline: kept text, the upload's own LaTeX written back byte for byte, which only
  the retype changes; fields, text the person clicks and types into on the page; and groups of
  units, the bullets and entries that repeat, which can be copied, removed and moved.
- Every piece of text the probe proves is a field, where it stands in the person's own LaTeX.
  Everything else is kept text. What repeats is found from the source itself: a list's items, and
  a run of calls to the same command. A new unit is a copy of the one beside it with its fields
  emptied, so the editor never needs to know which argument is the company and which the date.
- The four checks stay, and run without answers. A field whose rewriting moves the page, or whose
  text stops the compile, becomes kept text. A group is fixed unless the third check can add to it
  and remove from it. No meaning is guessed.
- A field is proven once, at import, and then trusted. Kept text is changed only through the
  retype (decision 0042), which checks every edit.
- The success bar stays at 90% of body words editable in place. Words the retype reaches are
  reported beside it and do not count toward it.
- The outline is a kind of section that `packages/resume-model` gains, additively, so one
  definition of resume data still covers every document.

### The canonical model stays for the built-in templates, and a PDF import fills it

- The canonical model stays as it is, and so do the three built-in templates that use it.
- A PDF has no source to keep, so a PDF import is filed into the canonical model, and a built-in
  template sets it. Only a `.tex` import stops using it.

### The naming step leaves the import

- A `.tex` import names no command, asks no language model and sends nothing. A test proves that
  it makes no network request.
- The naming step is deleted, not kept unused (the second pass's item 17): the naming package's
  prompt, request, masking, cache and answers, the import's request and privacy gate, the
  service's naming route, the committed answers, and the review, seed, benchmark, leak and naming
  commands. The history keeps them. Keeping them unused would cost their upkeep at every change to
  the import. The same item takes the naming request's line out of AGENTS.md, and rewrites the
  README's paragraph on naming to say that a `.tex` import sends nothing.
- The model's provider code and the service's shell, with its rate limit and its key handling,
  stay. The PDF reading reuses them.
- Until item 17 lands, the naming step's code stays as the records it supersedes describe it, and
  decision 0033's gate and leak check guard any request it sends, as decision 0047 has it.

### Importing from a PDF comes into scope

- A person drops a PDF. The editor reads its text, works out the name, the sections, the entries
  and the bullets, shows what it read so the person can correct it, and opens it in the built-in
  template the person picks.
- It promises the content, not the look, which is the template's. The review screen says so
  before the person creates the document.
- Rules always do the geometry: lines, columns, bullets and reading order, from where each piece
  of text sits. Saying what each line is, a name, a heading, an entry's head or a date, is a hosted
  model's job once the person has agreed. For a person who has not, or when the service fails or
  runs past its time budget, rules do it.
- The hosted model is the school's during development, on its SoCLaaS gateway, starting from the
  model decision 0044 chose for naming. Who provides it at launch stays where the plan has it
  (section 8.3): the school's service, with the school's leave to read real people's resumes, or a
  paid service whose terms rule out training on what it is sent.
- The choices set aside: a model the browser carries, which reaches only desktop Chrome on a
  capable machine; a model the editor ships, which costs each person a download of about 700 MB;
  and rules alone, which stay as the fallback.

### A PDF's text is sent only once the person agrees

- This is the privacy rule as decision 0047 restates it: the person asks for something that needs
  the text, and is told what is sent.
- The question comes the first time a person imports a PDF, in plain words that say what is sent
  and that nothing is kept. The answer is remembered in that browser, a setting changes it, and
  each later import says in one line that the text is being sent.
- The service keeps none of the text, in a cache or in a log. A test proves that nothing is sent
  before a yes, or after the setting is turned off.
- No resume of the corpus is given to a hosted model.

### The records this changes

- **Superseded:** 0024, the naming contract and the seed answers; 0027, the naming step on a
  model, but for its provider code; 0036, the naming step on SoCLaaS; 0037, the review of the top
  templates' answers; 0044's choice of a model for naming; the assembly of 0025 and 0026, which
  filled the shared structure from the answers; and the answer modes of 0043, which leave the
  corpus run one mode.
- **Amended:** 0028, whose service gains a route that labels a PDF's lines and loses its naming
  route; 0033, whose gate and leak check go with the naming step; and 0002, whose promise that
  every template package keeps a mapping onto the canonical model no longer holds for an imported
  `.tex`.
- Each of these records' status lines says so.

## Consequences

- **An imported `.tex` loses what needs meaning.** It cannot be switched to another template,
  since its text has no meaning the editor could carry across; its content moves onto a built-in
  template only through the PDF path, run on its own reference page (the second pass's item 16).
  It has no date format control. Its side panel shows the outline, its parts in order by their
  first words, in place of the labelled form.
- **Two kinds of document in one editor.** A built-in template's has a labelled form and controls
  that know what its text means; an imported `.tex` has an outline. The page behaves the same for
  both, and the side panel does not.
- **Deleting the naming step closes a door.** Template switching for imports, and any later
  feature that needs meaning, would have to be rebuilt from the history.
- **Imports made by the first pass are not migrated.** The editor is not online, so they exist only
  on developers' machines. The store refuses them with a plain message, and the person imports
  again.
- **A PDF import is the first feature to send resume content under the one-sentence rule.** It
  needs its own question, its own test, and a receiver that keeps nothing. A remembered yes is easy
  to forget, which is why each import says that it sends, with the setting beside it.
- **A person who says no gets the rules**, which read less well than a model. The review shows what
  was read so that it can be corrected, and a check counts every word read against the resume
  built.
- **The hosted reading depends on a service** that can be down or slow, hence the time budget, the
  fall back to rules, and the review saying which read the PDF.
- **The provider at launch is unsettled.** The school's service needs the school's leave before it
  reads real people's resumes, and a paid service costs money for each import. The owner settles
  it before launch.
- **The plan page changes with this record**: the canonical model's key term, the template
  switching row, the document state row and section 5.2; section 6's steps 4 and 5 and sections
  6.1 to 6.4; the scope lines of sections 4.1 and 4.2; and milestone 3's entry in section 9.
