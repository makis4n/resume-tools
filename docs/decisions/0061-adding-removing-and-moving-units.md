# 0061. Adding, removing and moving an outline's units

Date: 2026-10-05 · Status: accepted; the second pass's item 8, under decisions 0049 and 0055

## Context

Item 8 of `docs/milestone-3-overhaul.md`: a bullet or an entry of an imported outline gains a
sibling from the page, with Enter at its end, and from the side panel; either is removed or moved
among its siblings. A new unit is a copy of the one beside it with its fields emptied, or holding
the placeholder where a field is required. The step is held until its compile shows, and taken
back with a plain message when it stops. A group the checks found fixed (decision 0055) neither
gains nor loses units, and its buttons say why. The checks proved the copy of a group's last unit
put in after it, and the removal of its first and its last; they did not try a move.

## Decision

- **Three ops** (`StructureOp`, `restructureUnits` in `src/editor/document.ts`): `addUnit` puts a
  copy of its group's last unit in after the unit `after`, `removeUnit` takes the unit `id` out,
  and `moveUnit` moves it to `to` among its group's units, which it never leaves. Each is one step
  of the history, which undo takes back and redo does again.
- **The copy is check 3's.** `emptiedCopy` moves from `src/import/checks.ts` to
  `src/editor/outline.ts`, and check 3 imports it, so that the editor makes the very copy the checks
  tried: every field, group and unit in it under a new id, every field emptied, or holding
  `OUTLINE_PLACEHOLDER` where it is required, which it stays; its kept text and its gap the same
  strings as the unit's, byte for byte; a group in it keeps its units, each copied so, and why it is
  fixed, if it is. A copy of an entry so holds a copy of each of its bullets, emptied.
- **A copy of the last unit, after any unit of its shape.** The plan says "a copy of the one beside
  it". The editor departs from that: it always copies the group's last unit, the one check 3 proved,
  and puts it in after the unit asked for only where that unit is of the last's shape
  (`unitShape`: its own parts outside the groups within it, kept text as TeX reads its spaces,
  fields by kind, a group by its place), or is the last. Kept text is compared with a line's end
  and the spaces and tabs around it, and any run of spaces, read as one space, and a blank line as
  a paragraph's break, distinct from one line's end (`texSpaces`), so that units differing in their
  indentation alone, as Jake's sample's experience entries, are of one shape; kept text that sets
  its spaces as typed, `\verb` or a verbatim environment, is compared byte for byte. Why: a unit beside it may be written otherwise, and
  a copy of it that sets the page otherwise without stopping the compile would be kept. After a
  unit of another shape the step is refused, and the person reads "These are not all written alike
  in your file, so they keep their order, and a new one goes after the last" (`NOT_ALIKE`); "Add
  another" still adds after the last. An entry so gets the last entry's number of bullets, emptied.
- **Moves only among units of one shape.** A unit carries its gap when it moves, as the model has it
  (`OutlineUnit`), and the builder gives a group's first unit the gap beside the second. But the
  builder often leaves what parts two units inside them, a line break `\\` or a comma ending each
  but the last, and the last unit of a run holds everything to its level's end, a closing
  paragraph among it: a move there would set a page that compiles and is wrong. So a group's units
  move only where they are all of one shape (`alike`): then what parts them is in their gaps, and
  the last holds nothing the others lack. Otherwise the arrows are disabled with `NOT_ALIKE`. A
  move and its move back give the body back to the byte.
- **Ids.** Each id of a copy is minted as a new node's is (`mintId`), `copy-` and six random
  letters and digits, drawn again while any node of the document holds it: its links, sections,
  entries, bullets, items, and the outline's fields, groups and units (`idsOf`). Random, as decision
  0006's are, so that a page a compile behind never opens a new unit's field for a removed one's.
  Undo and redo bring back documents the history kept, each with the ids it had.
- **Refused, with why in plain words** (`UnitRefused`, whose `plain` the message line shows): any
  of the three on a unit of a fixed group, the move with the copy and the removal, since its units
  were found not to stand apart from the page around them, or were not tried (`refuseFixed`); the
  removal of a group's only unit (decision 0050's first rule); a move, or an add after a unit, as
  above. Any other structural step refused says "That change cannot be made here, so nothing
  changed." (`REFUSED_STEP`) where it was only in the console before. A move outside the group, a
  unit the outline has not, and an outline the model would refuse after it, as one past
  `MAX_OUTLINE`, are refused so. A group inside a unit of a fixed group is a group of its own.
- **Why a group is fixed, one more reason.** Decision 0055's `fixed` gains `stops`, additively in
  the model (`OUTLINE_FIXED`): a group whose copy or removal stopped the compile, which check 3 now
  tells apart from one whose trial set the page otherwise (`copy`, `removal`). `corpus run`'s table
  gains its row.
- **Held.** Every change to an outline is held until a page of it shows, and taken back to the last
  document a page showed when its compile stops, with the message structural steps have, "That
  change stopped the page from being made, so it was taken back." (item 7's `StructureGuard` with
  `every`): the three ops need nothing more.
- **Enter at a field's end** (`OverlayProps.onEnd`, `endsField`, and the rich editor's Enter): with
  nothing selected, the caret after the field's last character and no key held with it, it adds a
  copy after the unit whose own parts, outside the groups within it, end with that field among the
  fields the page writes (`unitEnding`): a bullet's text adds a bullet, and an entry's last field
  before its bullets, as its place or its dates, adds an entry. It never adds a section
  (`enterAdds`): a unit of a group at the outline's own level whose units hold groups, as a run of
  sections holds entries, or a unit whose own parts write one field and after it a group or kept
  words, as a section's title before its entries or its paragraph (`sectionLike`). The cost: an
  outline whose entries stand at its own level, in no section, gains entries from the side panel
  alone, where "Add after" and "Add another" add sections too. Anywhere else Enter inserts nothing,
  as before. The add is a step of its own after the visit to the field, which then closes. An empty
  field is not on the page (decision 0007), so the new unit's first field takes the focus in the
  side panel (`PanelProps.focus`), where it has an input. A refused add adds nothing, the field
  stays open, and the message line says why.
- **The side panel.** Each unit's row has ↑, ↓, Remove and "Add after", and each group "Add
  another", which adds a copy of its last unit after it, check 3's very trial. A disabled button
  says why in its title, and in words written under its group, which it names as its description
  (`aria-describedby`), so that why is read without a pointer: `FIXED_WHY` for a fixed group,
  "Adding one here changed the rest of the page when your resume was imported, so these stay as
  they are", "Removing one here …", "A change here stopped the page from being made when your
  resume was imported, so these stay as they are", or "These could not be tried when your resume
  was imported, so they stay as they are"; `NOT_ALIKE`; and, for a group's only unit, "This is the
  only one here, and there must be at least one" (`ONLY_UNIT`).

## Consequences

- **On the three upstream samples** (`scripts/oracle-units.test.ts`), imported as the browser
  imports them and compiled as the app compiles: a bullet added after the first of a list, as Enter
  at its end adds one, and removed; then an entry with bullets, of its group's last entry's shape,
  added after itself, as Enter at the end of its last field before its bullets adds one, and
  removed. After each add, every glyph of the page before is there, of the same text, font and
  size, at the same distance across, and on its page no higher or on a later page, and what is new
  sets no letter or digit (`movedDown`, which holds the order where the two pages share a run of
  glyphs, so that a line moved onto the next page past its page's foot is read as moved); after
  each removal, the page is the first to the glyph. No group of the three is fixed.

  | Sample | Unit added | Its group | After | Its glyphs | Glyphs moved | Most up | Add's page | Removal's page |
  |---|---|---|--:|--:|--:|--:|--:|--:|
  | jake-0000 | a bullet | the first experience's bullets, group 4 of 10, 3 | 1st | 1 | 1,843 of 2,266 | 0 pt | 81 ms | 80 ms |
  | jake-0000 | an entry with bullets | the experience entries, group 3 of 10, 3 | 1st | 6 | 2,197 of 2,266 | 8.0 pt | 81 ms | 80 ms |
  | altacv-0000 | a bullet | the first job's description, group 4 of 12, 2 | 1st | 1 | 307 of 1,302 | 0 pt | 885 ms | 892 ms |
  | altacv-0000 | an entry with bullets | the jobs, group 3 of 12, 2 | 2nd, the last | 2 | 231 of 1,302 | 0 pt | 883 ms | 889 ms |
  | awesome-cv-0000 | a bullet | the first job with a description's items, group 3 of 14, 7 | 1st | 1 | 6,386 of 7,616 | 0 pt | 196 ms | 198 ms |
  | awesome-cv-0000 | an entry with bullets | the work entries, group 2 of 14, 8 | 2nd | 2 | 5,179 of 7,616 | 0 pt | 181 ms | 191 ms |

  Jake's sample fills its page, and TeX shrinks the page's glue to keep the new entry on it, so the
  glyphs above it rise by up to 8 pt: the comparison takes that rise, up to 12 pt, for an entry,
  and none for a bullet. AltaCV's first job is not of its last's shape, so its new entry goes after
  the last, as `NOT_ALIKE` says.

  The new units set their bullets and the kept text around their emptied fields; the glyphs moved
  are those of the pages before that stand nowhere they stood after. The compiles are the editor's,
  on the engine in Node, under the load of other lanes' runs.

- **Sections on the samples.** Enter at any field of a unit that begins with the template's
  section command adds nothing: 4 fields of Jake's 4 sections, 11 of AltaCV's 10, and 6 of
  Awesome-CV's 5, whose titles are kept text. Jake's experience entries, differing in their
  indentation alone, are of one shape, move, and each takes a copy of the last after it.
- **A fixed group, invented** (`src/test/invented-fixed-group.tex`): its two roles stop TeX at a
  third, so the checks fix their run, `stops`, while each role's bullets take all three steps
  (`units-import.test.ts`). None of the three samples has a fixed group to show. The review's two
  invented runs, the awards ending in `\\` and the skills ending in commas, import as groups not
  all of one shape, which take no move and a new unit after the last alone.
- **A move is not proven.** Check 3 tries no move. Among units of one shape a move that stops the
  compile is taken back, and one that sets the rest of the page otherwise, as a unit's declared
  size moved first would, is the person's to undo.
- **Fewer moves and fewer places to add.** Groups whose units are written differently, as one of
  AltaCV's sample's whose units end in a line break but some, take no move, and a new unit only
  after their last.
- **An empty unit shows as little.** A new bullet's emptied text sets its bullet alone, and a new
  entry its kept text alone, until the person types in the side panel's inputs; a required field's
  placeholder shows and is marked there.
- `StructureOp` gains `addUnit`, `removeUnit` and `moveUnit`; `OverlayProps` and
  `RichOverlayProps` `onEnd`; `PanelProps` `focus`; `src/editor/outline.ts` `emptiedCopy`,
  `unitPlace`, `outlineIds`, `unitEnding`, `unitShape`, `texSpaces`, `alike` and the plain
  reasons; `src/editor/enter.ts` `enterAdds` and `sectionLike`;
  `src/editor/document.ts` `UnitRefused` and `REFUSED_STEP`; the model's `OUTLINE_FIXED` `stops`.
  `src/import/checks.ts` re-exports `emptiedCopy` and sets `stops`.
