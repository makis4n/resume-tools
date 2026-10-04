# 00XX. The checks without answers

Date: 2026-10-04 · Status: accepted

## Context

Item 6 of `docs/milestone-3-overhaul.md`: an imported `.tex` is an outline (decision 0049), and the
first pass's four checks (decision 0026) decided what was safe to edit from the naming step's
answers. Without answers, each check must decide from compiles alone what is a field, what is
required, and which groups of units take a copy and a removal; decision 0050's "Consequences" give
check 3 three rules. `corpus run` read the first pass's answers in three modes, none of which an
outline needs.

## Decision

- **The checks compile the outline as the editor will** (`src/import/checks.ts`): its package's
  format dumped once, every trial a body the generator makes from it, compared with the reference's
  glyphs and rules, the specials aside. Bisections are the probe's (`settle`) within 48 compiles,
  check 3's within 64.
- **Check 1.** Where the outline with its fields does not set the reference's page, the outline
  with every field kept is compiled: if that stops, the import is refused; if it sets another page,
  the import is partial and that page is what the fields must keep. Each field that moves the page
  becomes kept text (`differs`), one that stops the compile too (`compile`, item 5's plain reason),
  and one the budget leaves (`untested`). A field is switched with every field of its candidate.
- **Check 2.** Every field takes the long text, the special characters and nothing, each in one
  compile, bisected where it stops: a field that stops on text becomes kept text (`text`), one that
  stops only when empty is marked `required`. Two changes from the first pass:
  - A field the bisection's budget leaves untried becomes kept text (`untested`), where the first
    pass left it editable: nothing proved it takes any text.
  - Greek and Cyrillic letters are each tried once, in every field together, and not field by
    field: Greek in one compile, Cyrillic in another, so that a document whose fonts set one script
    is never said to lack it. On the twenty they stop TeX in two documents whatever field holds
    them, since the document's fonts lack them (`europecv-0002`, `other-0001`), which as one more
    special character locked every field of both: 50 and 56 fields, 86% and 77% of their words.
    The report names the script the fonts cannot set instead. The special text is the first pass's
    less `ω` and `Ж`.
- **Check 3, with decision 0050's three rules.** Every group gains a copy of its last unit, its
  fields emptied and a required field holding `OUTLINE_PLACEHOLDER`, and loses its first and its
  last, batched where the changes do not overlap and halved where a batch breaks the page.
  1. A group of one unit is not tried without it: the editor never removes a group's only unit.
  2. A trial keeps the page when the compile goes through and every other glyph of the reference is
     still there in the same font, size and code, and a removal takes out every glyph the probe's
     runs give to a part inside the unit: a unit that sets the rest of the page in other glyphs
     fixes its group.
  3. Glyphs may come in another order, as paracol's columns and later pages reflow.

  The removals that set a few glyphs more than the reference has stay failures, so their groups
  are fixed, until invented documents of their shape are read on the engine. A group any trial of
  which fails is `fixed` (`copy`, `removal`, or `untried` where the budget ran out or the page sets
  other glyphs than the reference's). Where the page differs only in where glyphs stand, the trials
  are judged all the same.
- **Check 4** is unchanged: it tries each control a package offers, and an outline's package
  offers none.
- **The model gains, additively,** `required` on an outline's fields, `fixed` on its groups with why
  (`OUTLINE_FIXED`), and `OUTLINE_PLACEHOLDER` (`packages/resume-model`).
- **The report has three shares** of the resume's words, for an outline: editable in place,
  changeable through the retype, and locked. Kept text the retype reaches is its own share and no
  locked part, and each locked part keeps its reason in plain words (`LOCK_WHY`). The success bar
  still reads the first share. The summary shows the three in whole per cent adding up to 100
  (`wholeShares`): the editable share rounded down, as the rate always is, so that it never reads
  as more than it is or as the bar when it is under it; the points that leaves go to the retype's
  and the locked share, the larger remainder first. AltaCV's sample, 168, 51 and 13 of 232 words,
  shows 72%, 22% and 6%.
- **`corpus run` has one mode** (`scripts/corpus-import.ts`, `corpus-import-child.ts`): every
  document through `importResume`, as a browser imports it. `--committed-only` and `--allow-model`
  are gone, with the run's naming columns and item 14's bar on controls, which an outline cannot
  meet since it offers none. Each document's row, counts only, goes to `.corpus/import-run/`. A
  run over the whole corpus is held to `corpus/baseline.json`, and the corpus workflow runs
  `corpus run --json run.json`. Its JSON is version 2; `--write-baseline --from` takes only a file
  of that version, and refuses a first pass's, version 1, in plain words. `bench`, `assemble` and
  the other first-pass commands stay until item 17.
- **`corpus review export` and `review check` stay, reading what is there.** They read what the
  first pass's run kept under `.corpus/run/`, which nothing writes since `corpus run` took the
  outline's import, so it cannot be refreshed. Removing them now would take the naming step's
  review, its tests and `corpus/REVIEW.md` with them, which is item 17's retirement. Until then
  each says, before anything and in every refusal, that it reads the first pass's run as it stands
  and that it cannot be refreshed, and none sends the person to a `corpus run` that would not help
  (`REVIEW_FIRST_PASS`).

## Consequences

- **The three upstream samples, pinned** (`scripts/oracle-outline.test.ts`), in words, editable in
  place, through the retype, and locked:

  | Sample | Words | In place | Retype | Locked | Required | Fixed groups | Import |
  |---|--:|--:|--:|--:|--:|--:|--:|
  | jake-0000 | 389 | 349 (89.7%) | 40 (10.3%) | 0 | 0 | 0 of 10 | 2.6 s |
  | altacv-0000 | 232 | 168 (72.4%) | 51 (22.0%) | 13 (5.6%) | 10 | 0 of 12 | 48.4 s |
  | awesome-cv-0000 | 1,287 | 1,246 (96.8%) | 23 (1.8%) | 18 (1.4%) | 3 | 0 of 14 | 18.3 s |

  Check 2 keeps no field of the samples as text, and every group takes its trials. The checks took
  10, 25 and 37 compiles: 1.1, 17.1 and 6.6 s. AltaCV's whole import takes 48 s, past the 34 to
  40 s item 5 measured, within the 180 s each sample's test now has.
- **The twenty-resume sample** (`corpus run --ids sample-20.txt`):
  - 7 succeed, 11 are partial, and 2 are refused: `awesome-cv-0009` and `-0027`, whose fonts the
    XeTeX rewrite sets otherwise (decision 0023, item 5).
  - Of 13,919 words in the 18 imported, 64.7% are editable in place, 33.5% through the retype, and
    1.8% locked. Eight reach 90% in place; `jake-0021`, at 100%, is partial: its package's page
    differs in where glyphs stand, before any field.
  - The checks keep 18 fields as text for moving the page (`differs`); no field stops on text, and
    23 are required. Every one of the 259 groups takes a copy; 15 are fixed for a removal and 29
    untried. The 29, and 5 of the 15, are `other-0028`'s, whose 114 groups outrun the budget of 64.
  - Times under heavy load from the other lanes: 4.5 to 160 s, Jake's forks 4.5 to 39 s; on a
    lighter machine an hour before, Jake's forks took 2.9 to 5.6 s. Item 9 times the import
    against the 8 s bar.
- **Fields are proven once at import and then trusted**, as the plan has it, with two limits:
  - Letters of a script a document's fonts lack, which the report names. A field holding one does
    not compile.
  - TeX's own limits on length. Check 2 proves a field takes a 300-character text, and "any length"
    holds only up to them: about 199,000 characters in one field stop pdfTeX for main memory, and
    then its 200,000-character line buffer, well under an outline's 1 MiB. Item 7 caps a field's
    length below that.
- **The editor (items 7 and 8) must keep** a required field non-empty, and put the placeholder in a
  new unit's required field. It must not add to or remove from a fixed group, and must not remove
  a group's only unit. Item 7 must guard a field's typed text as a structural step is guarded,
  taking the step back with a plain message when its compile stops, as typing a script the fonts
  lack, or past the length cap, would: today an edit of a field's text is not guarded, and the
  document saved would no longer compile.
