# 00XX. Adding, removing and moving an outline's units

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
  copy of the unit `after` in after it, `removeUnit` takes the unit `id` out, and `moveUnit` moves
  it to `to` among its group's units, which it never leaves. Each is one step of the history, which
  undo takes back and redo does again.
- **The copy is check 3's.** `emptiedCopy` moves from `src/import/checks.ts` to
  `src/editor/outline.ts`, and check 3 imports it, so that the editor makes the very copy the checks
  tried: every field, group and unit in it under a new id, every field emptied, or holding
  `OUTLINE_PLACEHOLDER` where it is required, which it stays; its kept text and its gap the same
  strings as the unit's, byte for byte; a group in it keeps its units, each copied so, and why it is
  fixed, if it is. A copy of an entry so holds a copy of each of its bullets, emptied.
- **Ids.** Each id of a copy is minted as a new node's is (`mintId`), `copy-` and six random
  letters and digits, drawn again while any node of the document holds it: its links, sections,
  entries, bullets, items, and the outline's fields, groups and units (`idsOf`). Random, as decision
  0006's are, so that a page a compile behind never opens a new unit's field for a removed one's.
  Undo and redo bring back documents the history kept, each with the ids it had.
- **Refused** (`CommandError`): any of the three on a unit of a fixed group, the move with the copy
  and the removal, since its units were found not to stand apart from the page around them, or were
  not tried (`refuseFixed`); the removal of a group's only unit (decision 0050's first rule); a move
  outside the group; a unit the outline has not; and an outline the model would refuse after it, as
  one past `MAX_OUTLINE` (`OutlineSection`). A group inside a unit of a fixed group is a group of its
  own, and takes them unless it is fixed itself.
- **Gaps.** A unit carries its gap when it moves, as the model has it (`OutlineUnit`): every gap the
  page writes is one the upload had, a unit moved first writes none and keeps its own for when it
  moves on, and the builder gives a group's first unit the gap beside the second. A move and its
  move back give the body back to the byte.
- **Held.** Every change to an outline is held until a page of it shows, and taken back to the last
  document a page showed when its compile stops, with the message structural steps have, "That
  change stopped the page from being made, so it was taken back." (item 7's `StructureGuard` with
  `every`): the three ops need nothing more.
- **Enter at a field's end** (`OverlayProps.onEnd`, `endsField`, and the rich editor's Enter): with
  nothing selected, the caret after the field's last character and no key held with it, it adds a
  copy after the innermost unit that holds the field, where no field of that unit the page writes
  comes after it (`unitEnding`): the last bullet of an entry adds a bullet, and an entry adds an
  entry from its last written field only where it has no bullets after it. Anywhere else Enter
  inserts nothing, as before. The field closes, ending its visit, and the add is a step of its own.
  An empty field is not on the page (decision 0007), so the new unit's first field takes the focus
  in the side panel (`PanelProps.focus`), where it has an input. In a fixed group, nothing is added
  and the message line says why.
- **The side panel.** Each unit's row has ↑, ↓ and Remove, and each group "Add another", which adds
  a copy of its last unit after it, check 3's very trial. In a fixed group all four are disabled and
  say why when pointed at (`FIXED_WHY`): "Adding one here changed the rest of the page when your
  resume was imported, so these stay as they are", "Removing one here …", or "These could not be
  tried when your resume was imported, so they stay as they are". A group's only unit's Remove says
  "This is the only one here, and there must be at least one" (`ONLY_UNIT`).

## Consequences

- **On the three upstream samples** (`scripts/oracle-units.test.ts`), imported as the browser
  imports them and compiled as the app compiles: a bullet added after the first of a list, as Enter
  at its end adds one, and removed. After the add, every glyph of the page before is there, of the
  same text, font and size, at the same distance across, and on its page no higher or on a later
  page, and what is new sets no letter or digit (`movedDown`); after the removal, the page is the
  first to the glyph. No group of the three is fixed.

  | Sample | The list | Its bullets | Glyphs of the new bullet | Glyphs moved down | Add's page | Removal's page |
  |---|---|--:|--:|--:|--:|--:|
  | jake-0000 | the first experience's, group 4 of 10 | 3 | 1 | 1,843 of 2,266 | 90 ms | 88 ms |
  | altacv-0000 | the first job's, group 4 of 12 | 2 | 1 | 307 of 1,302 | 874 ms | 883 ms |
  | awesome-cv-0000 | the first job with a description's, group 3 of 14 | 7 | 1 | 6,386 of 7,616 | 193 ms | 196 ms |

  The new bullet sets its bullet alone, its text emptied; the glyphs moved are those of the pages
  before that stand nowhere they stood after it. The compiles are the editor's, on the engine in
  Node, under the load of other lanes' runs.

- **A fixed group, invented** (`src/test/invented-fixed-group.tex`): its two roles stop TeX at a
  third, so the checks fix their run for its copy, while each role's bullets take all three steps
  (`units-import.test.ts`). None of the three samples has a fixed group to show.
- **A move is not proven.** Check 3 tries no move, so a move that stops the compile is taken back,
  and one that sets the rest of the page otherwise, as a unit's declared size moved first would, is
  the person's to undo. Moves of a fixed group's units are refused for that reason.
- **An empty unit shows as little.** A new bullet's emptied text sets its bullet alone, and a new
  entry its kept text alone, until the person types in the side panel's inputs; a required field's
  placeholder shows and is marked there.
- **Enter adds after the unit; "Add another" at the end.** The first is a copy beside a unit check 3
  did not try in that place; its shape is the last unit's, and the guard takes back one that stops.
- `StructureOp` gains `addUnit`, `removeUnit` and `moveUnit`; `OverlayProps` and
  `RichOverlayProps` `onEnd`; `PanelProps` `focus`; `src/editor/outline.ts` `emptiedCopy`,
  `unitPlace`, `outlineIds` and `unitEnding`. `src/import/checks.ts` re-exports `emptiedCopy`, its
  behaviour unchanged.
