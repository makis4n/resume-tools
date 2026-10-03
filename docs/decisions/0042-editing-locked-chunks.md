# 0042. Editing locked chunks: the retype, with no model

Date: 2026-10-03 · Status: accepted, the owner's decision of 2 October 2026; amends milestone 3's
"Editing locked chunks waits for the corpus", 0041's "A click opens nothing" and its lock's line,
and 0025's rule that kept LaTeX never holds what anyone typed

## Context

Milestone 3 item 16. Plan section 6.1 edits a locked chunk by a sentence typed at it, which a model
rewrites. That sends part of the resume to the model, which the product rule in AGENTS.md forbids
as written: the pipeline sends only macro definitions and placeholdered call sites, never the
resume's text (decision 0033). The milestone left the choice to the corpus: nothing if the locked
share is small, a text substitution with no model if it is material, and the model's rewrite under
a per-edit consent only if that is not enough. Locked chunks render, and are removed and moved, in
every case (decisions 0025 and 0041).

### The corpus's number

- **The recorded number: the saved answers and the SoCLaaS model, live, 3 October 2026** (`corpus
  run --allow-model` over the whole corpus, decision 0044's model `qwen3.8:27b` with thinking off,
  on the branch with item 17's 144 reviewed answers, 20.7 minutes): 220 documents, 1 timed out; of
  the 219 others, 0 succeeded, 92 partial (42.0%), 127 refused or stopped (12 refused, 103 with no
  reference, 12 with no answer). Of 989 macros, 648 were answered from the committed answers, 314
  from the model's cache and 27 by the model then (17 calls, 9 answers stored, 6 invalid), and 18
  were missing. **22.3% of the 66,453 body words of the 92 documents assembled are editable; 51,452
  words, 77.4%, are locked**, by kind: `unmapped` 39,992, `shape` 7,562, `moved` 1,253, `untested`
  765, `date` 625, `differs` 565, `misaligned` 336, `vanished` 306, `text` 48.
- **The saved answers and the model's cache alone, 2 October 2026**, the run the owner decided on:
  21.3% editable of 61,511 body words; locked by kind `unmapped` 38,611, `shape` 6,452, `moved`
  938, `untested` 765, `differs` 561, `date` 518, `misaligned` 318, `text` 48, `breaks` 5.
- **The committed answers alone** (decision 0043's run, `corpus run --committed-only`): 19.42% of
  41,631 words editable.

The owner decided on 2 October 2026 that the share is **material**, and the live run bears it out:
with more than three words in four locked, a resume imported is mostly words its owner cannot
change. So the first form follows, the substitution with no model; the rewrite does not.

## Decision

### What is retyped

- **A locked part on the page, wherever its words are plain text.** A locked section, the part the
  page draws with its lock (decision 0041) on any page (decision 0046), is LaTeX kept as the upload
  wrote it, and much of what it sets is still plain text there: a heading's name and contacts, a
  skills list, a paragraph. Where the page's glyphs of the part line up with runs of plain text in
  its LaTeX, the person may type new words over those runs, and nothing else
  (`src/editor/retype.ts`). It goes by the alignment, whatever the report's reason for keeping the
  part (decision 0039): nearly every locked section is `unmapped`, a part no answer places, whose
  words are often plain text all the same, and every part the done-test retypes below, Jake's
  heading and skills, AltaCV's chart and Awesome-CV's summary, is one.
- **A run of plain text** (`piecesOf`) ends at whatever TeX reads otherwise: a command, a brace, a
  bracket, a comment, math, an alignment tab, `#`, `^`, `_` and a blank line; an escaped character,
  `\&` and the like, is part of it. What commands read is no run: a command's name and its bracketed
  options; the arguments of those that set no text where they stand, as `\href`'s address,
  `\vspace`, `\color`, `\label`, `\setlength`, a definition, and of those that read their argument as
  it stands, `\url`, `\path`, `\nolinkurl` and `\verb`; an environment's name and a table's columns;
  and math and verbatim environments whole. A run right after a command's name or an accent, with no
  space between, as `\small555` or `\'e`, is never offered: what is typed there would run into the
  name. Nor is what an accent goes over, braced or not, `\"{u}`, `\c{c}`, `\v r` (the review's
  finding): in OT1, the encoding most imports set, the accent is a glyph of its own, outside every
  run, so that a run under it retyped printed the accent over another letter or over nothing, and
  was kept; the run after a braced accent is joined to it, and the one before it is offered.
- **Lined up with the page** (`alignPieces`): the part's glyphs, every page's, in the order the
  pages paint them, are read as the aligner reads a field's (`canonical`: case folded, as a class
  that sets a part in capitals or small capitals shows it; TeX's dashes and quotes and the
  characters they set alike; a ligature its letters; a hyphen TeX added at a line's end with its
  word), and each run is found, in order, at the first glyph from where the last ended that spells
  it, within 48 glyphs for a run under 12 characters, anywhere after for a longer one; a run spelled
  as the next and found at the same glyph is left to the next, as a link's address written as its
  label. A run that does not line up is left as it is; a glyph no run takes, a separator, an icon, a
  date a class sets first, is the template's.
- **Offered** (`retypeOf`): the runs that line up and hold a letter or a digit. A part none of whose
  runs line up offers nothing, and its row and its lock say why in plain words (`NOT_RETYPED`): "Its
  words are not written as plain text in your file, so they cannot be changed here.", or "It shows
  no words on the page." for a part with no glyph drawn, as AltaCV's bibliography part.

### What is typed, and where it goes

- **Escaped as a field's text is** (`escapeTyped`, decision 0007's `escapeText`): whitespace one
  space and none at its ends, so that a blank line, a new paragraph, never comes of it; and each of
  `\ { } $ & # ^ _ % ~`, `< > |`, `[ ] *` written so that it prints, `\textbackslash{}`, `\{`, `\$`,
  `\textasciicircum{}` and the like, as decision 0007's escaper writes them for every field, with
  the template's input encoding's dashes and quotes as it passes them. Nothing typed can call a
  command, open or close a group, start a comment or enter math, whatever the part does with it.
- **Replaces the run's bytes alone** (`retyped`): each changed run's bytes, its whitespace around it
  kept, become what was typed, escaped; every other byte of the part stays the upload's. A run typed
  as it was, or typed otherwise but escaped to its own bytes, as with a soft hyphen or a
  zero-width space escaping drops, or an accent pasted decomposed, changes nothing: no step, no
  check, and the editor closes (the review found such a retype once took back an earlier step).
- **One step of the history** (`Command` `retype`, `applyUnder`): the locked section's LaTeX
  replaced, refused (`CommandError`) for any other section and for LaTeX a locked part may not keep
  (`LockedLatex`, decision 0025): escaped text never unbalances the braces, but a run typed as the
  page's own marker texts, `rt:l:` and the like, is refused with "That text cannot be kept in this
  part." Undo takes the step back and redo does it again, as any step; both are documents the page
  showed and the check passed. A step taken back for good gives back the oldest step the history
  let go past its limit for it (`HISTORY_LIMIT`), so that no other step is lost.

### The check: kept only when nothing outside the part moved

- **The document's own compile path.** The retyped document compiles as any edit's does, through
  the compiler, in the document's job with the import's files (decision 0038), in the worker: in
  the job the import keeps for the document's compiles, never a job of its own. While it does, the
  document takes no other edit, no undo and no PDF (the page that comes is the retype's alone, and
  the compiler's output is the retype's until it passes), and the editor's "Cancel" takes it back:
  what its compile, in flight then, brings, a page or a stop, is dropped (`discards`).
- **Kept only when, all three** (`RetypeGuard`):
  - the document compiles: a compile that stops takes the retype back (`stopped`), as item 15's
    guard takes back a structural step, and so does one that brings no page for another reason
    (`failed`);
  - the page outside the part is the page before it, glyph for glyph: the import's own comparison of
    glyph streams (`difference`, decision 0019, the one its first check holds a regenerated body
    to), the same pages of the same size, the same glyphs in the same fonts, the same rules and the
    same specials, in the same order, each within a scaled point of its place, over the output
    before and after, each read as the import reads one (`readOutput`), with the part's own glyphs
    and rules (`lockedSets`) and the specials between its two markers, a link's or a colour's, left
    out of both (`retype-check.ts`, `streamWithout`). A line of the part broken at another place is
    the part's; a line more or fewer moves what follows the part, which is not (`moved`);
  - the part shows what was typed: its glyphs after are its glyphs before with each retyped run's
    replaced by the words typed, read as the alignment reads them, hyphens aside, since TeX may now
    break one of its words elsewhere (`showsTyped`); a run that lined up by chance with words some
    other command set, or a character the font cannot set, fails it (`shown`).
- **Taken back** where any fails: the step is dropped from the history with nothing to redo
  (`History.takeBack`), the document before it compiles again, its page as it was, and nothing of
  the retype was saved. The editor says why in plain words (`RETYPE_REFUSED`) and keeps what was
  typed, so that it can be shortened: "That text stopped the page from being made, so it was taken
  back."; "That text moved what is around this part on the page, so it was taken back. Try fewer or
  shorter words."; "That text did not come out on the page as it was typed, so it was taken back.";
  "The page could not be checked with that text, so it was taken back."
- **Shown once it passes.** The retyped page is shown only once the check passes, and the document
  is saved then, as the app saves any edit (decision 0010), so it survives a reload; a refused
  retype's page is never shown.
- **The comparison loads on the first retype.** It reads the outputs as the import does, and the app
  loads `retype-check.ts` only when the first retype is checked.

### The page and the side panel

- **The lock says so.** Over a part with words to retype, the lock's line says "Kept as it was;
  click to change its words, or remove or move it from the side panel" (`RETYPE_TIP`); over any
  other, as before (`LOCKED_TIP`). The pointer over such a part shows a pointer's hand.
- **A click on it opens its small editor** (`RetypeEditor.tsx`), placed under the part's first block
  on the page where the part starts, over what follows it, as a field's overlay lies over the page:
  one line for each run offered, as the page shows it, never its LaTeX; "Keep" and "Cancel", and
  Escape. Its lines keep the browser's own undo while one is typed in (`NATIVE_UNDO`). It is mounted
  afresh whenever the part's LaTeX on the page changes (`retypeEditorKey`), and an undo or a redo
  closes it, so that what was typed is never sent over runs it was not typed over. A click on a
  part with nothing to retype still opens nothing (decision 0041).
- **The keyboard's way in.** The page still holds no tab stop (decision 0041): each locked part's row
  in the side panel gets "Change words", in the tab order, which opens the same editor and moves
  the focus to its first line; it is disabled, saying why when pointed at, for a part with nothing
  to retype, and before a page shows the document ("Wait for the page to show it").
- **The row's name follows the page.** The report names a part by its first words on the original
  page (decision 0041); once a kept retype has replaced them, the row is named by the first words of
  its runs as they are now (`namesOnPage`), and a part with no runs to name it by shows as kept as
  it was, before and after a reload.
- **Removing and moving stay** as decisions 0025 and 0041 made them, on every page.

### Nothing new leaves the browser

The words typed go into the document, which compiles in the browser's own worker and is kept in the
browser's own store, as every field's text is. No request carries them: the retype asks nothing
of any service, and its compile reads only what any edit's does, TeX Live's files and fonts from
the editor's own origin by their paths, in the browser and its HTTP cache; and the naming request
is never sent again for it, since the import's request was built from the upload, and is not
rebuilt. The AGENTS.md rule stays absolute: no text of the resume, typed or uploaded, goes to the
model, and the model writes no LaTeX.

## Done

- **The upstream samples** (`scripts/oracle-retype.test.ts`), each imported as the browser imports
  it, kept in a store and opened through the compiler on the engine, the part chosen by the
  template's commands it calls and every word typed made from the page's own by an invented change
  of its letters, so that no sample's text is in the test:
  - Jake's: its heading block's name and a line of its skills block retyped, each kept: the
    document compiles, the page outside the part is the page before it to the glyph, the part
    shows the words typed, and a new store over the same database reads the retyped part back; and
    the heading's name typed six times over, which runs onto more lines and moves the sections under
    it, taken back as `moved`, with nothing to redo, the page after it the page before to the byte.
  - AltaCV's: a wheel chart's label retyped and kept the same way; and its bibliography part,
    which sets no word of its own on the page, offering nothing, with its plain reason.
  - Awesome-CV's: a word of its summary paragraph retyped and kept the same way.
  - What each kept retype printed, on the engine in Node on the M4 Pro, the page's time being its
    compile and its drawing (`Shown.ms`): Jake's heading, the first of its 5 runs, a part of 69
    glyphs, 83 ms; its skills, the second of 8 runs, 261 glyphs, 82 ms; AltaCV's wheel chart, the
    first of its 2 runs, 20 glyphs, 936 ms, TikZ drawing the chart again; Awesome-CV's summary, a
    word of the first of its 2 runs, 670 glyphs, 201 ms on XeTeX. The test takes 12 s, 111 s and
    86 s, the imports most of it.
- **Nothing leaves** (`src/editor/retype-leak.test.ts`): the invented fork of Jake's Resume
  imported, every naming request it sends recorded, kept and opened through the compiler, its
  heading's name retyped with invented words and kept: no `fetch` at all and no naming request
  while it is retyped, checked and saved, and the import's request holds none of the words typed;
  and the fork imported again with its heading saying them, through the import's request builder
  (`importRequest`) and its gate (`assertNoText`), which lets the request through, holding none of
  them.
- **The reading and the check** (`src/editor/retype.test.ts`, invented parts): the runs of a heading
  and a skills list, none of what commands read, escapes, ties, dashes and quotes, runs joined to a
  command; the alignment, a hyphen TeX added, a ligature, an address written as its label, the
  short run's reach; what a part offers, and why not, in plain words; every character LaTeX reads as
  markup typed and printing, the part still LaTeX a locked part may keep; `showsTyped`; and the
  guard over a history: kept once its page passes, taken back as `moved`, `shown`, `failed`,
  `stopped` and cancelled with nothing to redo, nothing started for words that change nothing, a
  stale page or a marker's text. `streamWithout` and the comparison on an invented output
  (`retype-check.test.ts`).
- **The DOM** (`src/editor/RetypeEditor.dom.test.tsx`, jsdom), the page, the side panel and the
  editor put together as the app puts them: the lock's line and a click opening the editor with the
  runs as the page shows them, focused, under the part, with no LaTeX; a part with nothing to retype
  opening nothing, its row's button disabled with its reason; words typed, checked, kept, saved once
  and undone; words that move the page taken back with the plain reason, what was typed kept; a
  compile that stops taken back; Escape; and the editor waiting while the page is not the
  document's.

- **The review's findings**, each with its test: a soft hyphen and a zero-width space typed into a
  run, no step and nothing popped by a cancel after; the braced and unbraced accents never offered,
  and on the engine the fork's heading with an accented name offering the run before the accent
  alone (`retype-leak.test.ts`); a retype taken back at the history's limit giving back the step
  let go; the guard holding while the page is checked, which keeps the PDF waiting, and dropping a
  cancelled retype's page; the row named by the runs after a kept retype; and the editor closing at
  an undo and opening again on the runs as they are (`RetypeEditor.dom.test.tsx`).

## What stays open

- **The model's rewrite**, plan section 6.1's sentence typed at a chunk, through a second endpoint
  with no cache, under a per-edit consent and a change to the rule: only if the retype leaves too
  much locked, which a corpus count of what it reaches would say (below), and the owner's to decide.
- **What no retype reaches.** A part's words that are not plain text in its LaTeX: built by a
  command from its arguments, as a chart's labels from a list it parses, a date a macro formats, or
  set in an order the alignment does not follow, as a class that sets an entry's date before its
  title, where the runs after the first out of order are left as they are. A part kept with no lock:
  a field's instance kept as the upload wrote it (`date`, `shape`, `differs`, `moved`, `misaligned`,
  `text`, `breaks`, `untested`), a list kept whole and the header's extras, which decision 0041
  draws as the template's own text; they hold most of the locked words that are not `unmapped`.
- **How much of the `unmapped` share it reaches.** The corpus's `unmapped` words are mostly locked
  sections, which the retype reaches wherever their words line up; the corpus run does not count
  that yet. Counting it is a corpus runner's change, left for when the rewrite's question comes.
- **A retype that grows the part.** Kept only where nothing outside the part moves, so a run typed
  longer than a line has room for, before other content, is taken back: the words a person can type
  are about as long as the ones they replace.
- **A link's address** is not retyped with its label: a `\href` whose label is retyped still links
  to the address the upload wrote.
- **A part set out of the source's order** keeps its specials in the comparison, and its runs after
  the first out of order unaligned.

## Consequences

- `Command` gains `retype`, and `History` `takeBack`; `GlyphBox` gains `text`, what the glyph
  stands for, for the alignment and the check; `Shown` gains `output`, the DVI or XDV its pages were
  drawn from; `PageProps` gains `retypable`, `onLocked` and `editing`, and `PanelProps` `retypes`
  and `onRetype`. No format, package or document changes, and the model's schema does not.
- Decision 0025's exception to decision 0007's rule narrows rather than widens: a locked part's
  LaTeX is still the upload's bytes but for runs of plain text, which now may hold what the person
  typed, escaped by decision 0007's escaper as every field's text is.
- A retype costs one compile and two readings of an output: on the samples, 82 to 936 ms for the
  page (above).
- The corpus's runners are unchanged: item 16 changes no import, and the corpus's numbers stand.
