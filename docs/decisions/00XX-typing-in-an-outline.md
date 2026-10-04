# 00XX. Typing in an imported outline

Date: 2026-10-05 · Status: accepted; the second pass's item 7, under decision 0049; amends 0042's
retype for an outline's kept text, and 0041's guard for an outline's every change

## Context

Item 7 of `docs/milestone-3-overhaul.md`: a field of an imported outline opens in place on any page
as a built-in template's does, kept text that lines up with the page keeps the retype (decision
0042), and the side panel shows the outline in place of the labelled form. An outline has no
locked section, so its kept text carries no lock marker, and its pieces are fragments of the
person's LaTeX, a command and the brace that opens its argument, where no marker could stand.
Its kept text and preamble can also set the editor's markers by spellings the model does not
refuse (item 5's review). And item 6's review found that a letter the document's fonts lack, or a
field of about 199,000 characters, stops the compile, which a field's edit could then save.

## Decision

- **Fields.** Each field of an outline is `<id>.text`, a plain or a rich text, which the overlay,
  the rich editor, undo and redo take as any field (`fieldsOf`). A document that holds an outline
  has no header's field or link's.
- **Only the outline's markers.** An outline's page is read with the ids the outline writes, in the
  order it writes them (`writtenFields`, `DrawOptions.outline`): of each id only its first begin
  marker and its first end marker after it, and every other marker, of another id or a second of
  the same, is no marker (`acceptedMarkers`). The paragraph special counts only after an accepted
  begin. No lock marker is read on an outline's page.
- **Kept text by segment.** The kept text between two fields the generator writes one after the
  other, or before the first or after the last, is a segment, read on the page between the first
  field's end marker and the second's begin marker where the output sets them in that order
  (`keptSets`); what the output sets between fields out of the outline's order, as paracol's
  columns or a class's header, is no segment's. A segment is shown and retyped as a locked part is
  (decisions 0041 and 0042): its lock, one block a line, says "Kept as your file wrote it", with
  "click to change its words" where it has runs to retype; a run is offered only where it lies
  within one piece of kept text, a kept part or a unit's gap, which the retype changes and nothing
  else (`retypeKept`); and the check leaves the segment's glyphs, rules and specials out of both
  outputs.
- **Every change held.** An outline's every change, a field's text among them, is saved only once
  a page of the history's present shows it (`StructureGuard` with `every`); a compile that stops on
  it is taken back to the last document a page showed, within a visit to a field or not
  (`History.restore`), with the message structural steps have, "That change stopped the page from
  being made, so it was taken back.", and the field open closes.
- **A field's length.** An edit that would make a field longer than 20,000 characters, its runs'
  text and links together, is refused (`MAX_FIELD`, `FieldTooLong`), the field open closes, and the
  page says "That text is too long for one field, so the last of it was not kept." A field already
  longer may still be shortened.
- **The side panel.** In place of the labelled form, the outline's parts in order: kept text that
  sets words, named by its runs of plain text with "Change words"; each field by its first words,
  with an input where the page does not show it; and each group's units, named by their first
  words, opening to show their parts, an input for a field that needs one shown even when closed.
  Nothing of the LaTeX shows.

## Consequences

- The retype reaches less of an outline's kept text than the import's report counts (decision
  0050): the report reads kept text by the probe's runs on the reference, the editor by segments
  between fields in order. On the samples, Jake's skills, AltaCV's contacts and tags, and
  Awesome-CV's header contacts are offered; AltaCV's wheel chart, in paracol's column, is not.
- A field's edit on an outline is saved a compile later than a built-in template's; a tab closed in
  that second loses it, as a structural step's (decision 0041).
- `isRequired` reads no requirement of an outline's field yet; item 6's mark is wired when this
  rebases onto it.
- `DrawOptions` gains `outline`, `collectFields` an accepted set, `Command` `retypeKept`, `History`
  `restore`, `StructureGuard.changed` `every`, `FieldSlot.snippet` `outline`, and the page's lock
  its lines (`LockTips`).
