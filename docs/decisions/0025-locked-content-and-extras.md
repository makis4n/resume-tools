# 0025. Locked content and extras

Date: 2026-09-27 · Status: proposed

## Context

Milestone 3 item 7 assembles a package and a document from an imported resume, and item 15 draws
the parts of it the editor cannot edit. Both need the model to hold what an upload has and version
1 lacks: the parts of a body the model has no place for, which decision 0020's parser keeps as raw
chunks, and the arguments of a template's macros that decision 0022's probe locks, a length, a key,
an icon or text a macro takes apart. Plan section 5.2 keeps such fields as extras so that nothing is
lost on import, and decision 0006 kept extras on the header, a section and an entry, never typeset
until the pipeline needed them, which it now does. A class whose header commands belong in the
preamble, as Awesome-CV's and moderncv's `\name` and `\position` do, also needs its header set
before `\begin{document}`. This record is item 7's part A: the model, the snippet language, the
generator and the prelude. The assembly that fills them is part B's, and the page's lock item 15's.
The code is `packages/resume-model/src/index.ts` and, under `apps/editor/src/`,
`templates/snippet.ts`, `package.ts`, `generate.ts` and `prelude.ts`, with the commands in
`editor/document.ts` and the panel's row in `editor/Panel.tsx`.

## Decision

### A locked section

- Version 1 gains a fifth kind of section, additively (decision 0006's rule): `{ kind: "locked",
  id, title: "", role: "other", latex, extras? }`, a part of an imported resume kept as the user's
  own upload had it (`LockedSection`). `latex` is kept LaTeX (below). An import mints its id under
  `lock-` with `mintId`, as the editor mints `sec-`, `ent-`, `bul-`, `itm-` and `lnk-`.
- It renders where it sits among the sections, through no snippet, the same in every package. It
  has no field: `fieldsOf` gives none, so the page opens nothing on it and no text command reaches
  it. Its title stays empty and its role `other`, so that what reads any section's title and role
  reads it too, and `setSection` refuses it.
- It is removed and moved as any section is, and no other command touches it: it holds no entries
  or items, so `addEntry` and `addItem` refuse it, and `addSection` cannot make one, since
  `SECTION_KINDS`, the kinds a package sets through a snippet of its own and a user can add, stays
  the four. The side panel shows it as a row, "Kept as it was", with the buttons that move and
  remove it, asking first as for any section that holds something, and shows nothing of what it
  holds, which is LaTeX. The harness's `editEverything` leaves it as it is.

### Extras

- `extras`, on the header, a section or an entry, hold kept LaTeX under a key of a lowercase letter
  and up to 31 lowercase letters, digits and dashes, `^[a-z][a-z0-9-]{0,31}$` (`ExtraKey`), which a
  snippet names in an extras slot. Decision 0006 typed them as any value under any key, and nothing
  has written one since, no curated package, no command and no import, so narrowing them refuses no
  document an editor has saved, and the model stays version 1.
- An import puts a locked argument's bytes in its node's extras, under a key of its choosing, and
  the snippet it assembles writes them back where the argument was. Nothing else in the model
  changes for them.

### Kept LaTeX, and what the schema refuses

A locked section's `latex` and every extra are `KeptLatex`: bytes from the user's own upload, which
the generator writes as they are. The schema refuses, so that nothing ever writes:

- more than 65,536 characters (`MAX_KEPT_LATEX`);
- the editor's own macros and markers: `\rtfield`, `\rtlocked` and anything under `\rt@`, and the
  texts the page reads as markers, `rt:b:`, `rt:e:`, `rt:p:` and `rt:l:`, in any case, as the page
  reads them, which would give the page a field or a lock the model does not have. The check reads
  the text as it stands: LaTeX that builds a marker's text another way, through `\csname` or `^^`,
  fools only its own page, so the check guards against accidents and is no boundary;
- braces that do not balance as TeX reads a macro's argument: each `{` closed by a later `}`, where
  a brace after a backslash is a control symbol and a comment, from a `%` no backslash escapes to
  its line's end, is not read. The generator writes kept LaTeX inside an argument, `\rtlocked`'s or
  a template macro's, where an unbalanced one would end the argument inside itself or run on past
  it to the end of the document.

### Extras slots

- The snippet language gains one tag: `{{&x.<key>}}` writes the node's extra under `<key>` as it is,
  and nothing when the node has none; `{{#x.<key>}}` and `{{^x.<key>}}` test whether it has one. An
  extra is present when the node has the key, whatever it holds, since an empty argument in the
  upload, as `\item[]`'s, is not one left out. A tag's name is `x.` and letters, digits, `-` and
  `_`, so that a key the model refuses is named by the check rather than left in TeX as text; every
  other name reads as before.
- Only the header's, a section's and an entry's snippets have extras slots, since only their nodes
  keep extras: the document, contacts, links, bullets, items, the preamble and the controls have
  none, and `checkSnippet` refuses one there. It refuses an extras slot typeset, `{{x.<key>}}`,
  since what it holds was never escaped, and a key the model refuses. The address check lets an
  extras slot stand in `\href`'s first argument, since it writes the upload's own address where the
  upload had it; the rule that no slot follows a backslash holds for it as for any.
- When an extra's last line holds a comment, the generator writes a line's end after it, which the
  comment takes, so that TeX reads nothing the upload did not have there and the snippet's text
  after the slot is read.

### The generator

- **The one exception to decision 0007's rule** that user text enters LaTeX only through slots the
  generator escapes: kept LaTeX, a locked section's and every extra's, never passes through the
  escaper, nor through a XeTeX package's coverage (`BodyOptions.covers`). It is safe because the
  bytes come from the user's own upload, never from what anyone types in the editor or from another
  user's package, which holds only the slot; they compile only in the user's own browser, in the job
  their document compiles in; and they never reach the cache or the naming service, which see
  definitions and placeholdered call sites (decision 0024). What they can do to the page, the
  upload already did to the reference compile: a `\href` among them links where the upload's did,
  which `linkAddress`'s rule for typed addresses does not reach, and a special that would read a
  file is refused by the session as any template's is (decision 0008). A user never sees LaTeX: the
  panel names a locked part and never shows it.
- **A locked section** is written as `\rtlocked{<id>}{<latex>`, a line's end and `}`: in the
  prelude's macro, which writes a lock marker before and after it, with the line's end so that a
  comment on its last line ends before the brace. LaTeX that ends in a line's end of its own gets a
  blank line there, a `\par`, which does nothing between sections; the assembly gives it without.
- **Extras** are charged their length against `MAX_BODY`, as a slot's source is (decision 0007).
- **A header set before `\begin{document}`.** The document snippet may hold text before
  `\begin{document}`, and `{{header}}` may stand there. The body is the controls, then the document
  snippet (decision 0007), so a header set there comes after the format and the controls and before
  the document starts, as in `{{header}}` `\begin{document}` `\makecvheader` `{{sections}}`. Its
  typeset slots are `\rtfield`s the class's commands store, marked and found as any other where the
  class typesets them. The paragraph special is measured there, not left out: `\rt@par` is
  protected, so a stored `\rtfield` writes it only where it is typeset, and it reads the same, value
  for value, as for the same header set after `\begin{document}` (checked on the engine). The
  harness passes an invented package whose `\name` and `\position` store the header in the preamble
  for `\makeheader` to set, with a locked part and extras besides, with no finding
  (`harness.test.ts`). A snippet that typesets a field there, where nothing stores it, fails the
  compile check, since LaTeX sets nothing before `\begin{document}`.

### The lock markers

- `LOCK_MARKER` is `rt:l:`. A locked section's markers are `\special{rt:l:<id>}` before and after
  its LaTeX, which `\rtlocked{<id>}{<latex>}` writes: `\rtfield` without the paragraph special,
  since nothing in the part is edited, and without `\texorpdfstring`'s second copy, since it never
  stands in a PDF string. The page's fields (`collectFields`), the harness's checks and the import's
  comparison of glyph streams, which leaves `rt:[bepl]:` out (decision 0019), read nothing from
  them; item 15's page will read them for the lock.
- It is more than `\rtfield` without those two. `\rtfield` starts a paragraph (`\leavevmode`),
  which a locked part, standing between sections in vertical mode, must not: it would set an empty
  line before the part's heading. And a marker is a whatsit, which hides the list's last skip from
  LaTeX's `\addvspace` and `\addpenalty`, so that a heading after a list adds its skip to the
  list's where the two would merge. So each marker takes the last skip off and puts it back after
  itself (`\rt@lock`), in either mode, and the part and what follows it are set where they are with
  no marker.
- On the engine, with a part in twelve places, after a list, ending with a list, after `\vspace`, a
  paragraph, a table, at the top of the page, two parts in a row, a paragraph running on before it
  or after it, a part whose last line is a comment, one that ends in a blank line and one with an
  escaped `\#` in an address: markers alone moved the next heading 10 pt down in three of the first
  ten, and with `\leavevmode` 10 to 33 pt in six; `\rt@lock`'s moved nothing in any of the twelve.
  `generate.test.ts` holds two of the places, and fails on markers alone.
- What TeX cannot take in a macro's argument cannot be locked this way, as the engine showed: a `#`
  in `\href`'s address, which hyperref reads with category codes of its own only outside an
  argument ("Illegal parameter number"); a `%` in `\url`'s, which becomes a comment, and which the
  schema refuses since the braces then do not balance; `\verb`; and a category code the part changes
  for itself, as `\makeatletter` before an `\@` command. The compile stops, which item 7's checks
  report; item 15 decides how such a part is kept.

### The format hash

The prelude gains `\rtlocked` and `\rt@lock`, and is part of what is dumped, so every format's name
changes once, its form unchanged (decision 0007): Jake's `jake-3e1f45f3` becomes `jake-03c56b08`,
AltaCV's `altacv-8031c3bd` becomes `altacv-2e040f20`, Awesome-CV's `awesome-cv-81810baf` becomes
`awesome-cv-e393e768`, and the invented XeTeX template's and every `import-` format the probe dumps
change likewise. The store keeps formats by name (decision 0010), so a browser that kept an old one
asks for the new name, finds none, dumps once and keeps it: a redump, not a failure
(`compiler.test.ts`: a format the store kept is put, and one it lacks is dumped and kept). The old
one is never asked for again, and goes as the least recently used of the twenty. No curated
package changes, so their round trips and the harness pass as they did.

## Consequences

- Item 15 still owes the page's lock on hover over the glyphs between a part's markers, where a
  click opens nothing; the panel's label for a locked part, the first words the page shows of it,
  in place of "Kept as it was"; the side panel's input for a locked part, whatever item 16 decides
  editing one means; and marking a part only where the probe shows the wrapping survives, with a way
  to keep a part `\rtlocked` cannot take.
- Part B, the assembly, builds against `LockedSection`, `KeptLatex`, `ExtraKey` and `Extras` in the
  model, `extrasKey` in `snippet.ts` and `LOCK_MARKER` in `prelude.ts`: it mints `lock-` ids, keeps
  a locked argument's bytes under a key of its choosing, and gives a part's LaTeX without its last
  line's end. A part or an extra the schema refuses has to be kept another way, or the import
  refused.
- The header's snippet takes extras slots as a section's and an entry's do, since the header keeps
  extras too (decision 0006), so that an import can keep a header argument the probe locks, as
  Awesome-CV's positions in small capitals.
- An editor older than this record refuses a document that holds a locked section or extras, as it
  refuses any newer document (decision 0010), which the strict schema intends.
