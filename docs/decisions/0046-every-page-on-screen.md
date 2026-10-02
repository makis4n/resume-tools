# 0046. Every page on screen

Date: 2026-10-03 · Status: accepted, the owner's decision of 2 October 2026; amends 0041's
"A part past the first page" and its done-test's first page

## Context

Milestone 3 item 20. The editor drew a document's first page only: the compiler drew page index 0
of the output, so a resume of two pages or more showed one. Its later pages' fields were editable
only as inputs in the side panel, their locked parts were out of sight, and the import's report
still counted their words as editable on the page (decision 0039). Decision 0041 left it open: a
locked part past the first page "shows its lock once the editor draws its page, which it does not
yet". Item 13's hand count of the upstream samples found 474 of the Awesome-CV sample's words, all
of them its fields' on its second and third pages, on pages the editor did not draw, and 2 of
AltaCV's; Jake's sample is one page. The owner decided on 2 October 2026 that the editor draws
every page, before item 16, whose edit acts on a locked chunk wherever it is.

## Decision

- **Every page, one under the other.** The compiler draws every page of the output after each
  compile (`drawPages`), and `Shown` carries them all (`pages`), the first still as `page`, which
  says how many there are. The app shows them in a column (`Pages`), 16 pixels apart, each with a
  thin grey edge so that a page's end shows, and each page where the reference drew it: the same
  SVG `drawPage` makes of that page alone, with its fields, its locked parts and its own size.
- **Glyphs are addressed per page.** A field's glyphs, its layout, a locked part's blocks and every
  glyph's box are in TeX points from their own page's corner, as before; each page's element
  carries its index (`data-page`), and a page after the first names its glyphs' shapes apart
  (`p<index>-`), so that no id stands twice in the document and the first page's SVG is the same,
  byte for byte, as before.
- **A click on a field on any page opens it in place**, as on the first. The click reports the
  field, which is one id in the whole document; the overlay, the rich editor and the date picker
  are placed over the page that shows the field (`placementFor`, `pageShowing`, `pageSvg`), its
  first glyph's page for a field a page break splits, and read their place again from each new
  compile's pages, as before.
- **Locks on every page.** The pointer over a locked part on any page marks its blocks on every
  page that holds them, so that a part a page break splits shows whole, and puts the padlock and
  its line over the first of them only, on the page where the part starts. A part still takes no
  click and no focus, on any page (decision 0041).
- **What the side panel keeps.** It gives an input to a filled field only when no page shows it:
  one its template's variant has no place for, or whose text sets no glyph (`fieldsShown` over
  every page); a field on a later page is shown and gets none. A field's placeholder, an empty
  field, and every field while the first page cannot be made (decision 0013) keep theirs, and a
  locked part keeps its row, named by the report, on whatever page it is.
- **Fit to one page stays**, named as before: every page is now on screen, and the button still
  asks the compiler for the settings that bring the resume to one. The line beside it says how far
  the resume runs: "This resume runs onto a second page.", or onto `n` pages past two.
- **The report is unchanged.** It already counts a field on any page as editable on the page, as
  the hand count does once the later pages are drawn; this item makes the count true and changes
  no number of it.
- **Drawing costs no more for one page.** The output is read, and its fonts loaded, once for all
  its pages, and each page after the first costs only its own drawing, so a one-page resume draws
  as it did. A page whose SVG is the one it had is left as it is in the browser: React does not set
  the same SVG again. The compile's time limit for drawing covers all the pages. A draw given in
  the place of the editor's, as a test's or a measurement's, is called for each page in turn
  (`drawEach`).

## Done

- **The upstream samples** (`scripts/corpus-oracle.test.ts`): each imported as the browser imports
  it and drawn as the compiler draws it, every page of it: as many pages as the reference, Jake's
  one, AltaCV's two and Awesome-CV's three; on each page every glyph drawn where the reference set
  a glyph of its font on that page, within a hundredth of a point, and at least 95 in 100 of the
  reference's glyphs drawn; each part's kept glyphs on that page drawn as the part's, and every
  part with a glyph there in blocks; and on the last page a field with glyphs and a layout, which
  the overlay opens in place. The report's counts for the samples are unchanged (decision 0039's
  test).
- **On the engine** (`src/page/draw.test.ts`): an invented document of two pages, a field on each
  and a part a page break splits, drawn whole: each page as `drawPage` draws it alone, the second's
  shapes named apart, the last page's field with its layout and every glyph, both fields shown, and
  the part in blocks on both pages with all its glyphs between them; and a one-page document drawn
  as `drawPage` draws its page.
- **The DOM** (`src/page/Page.dom.test.tsx`, jsdom): an invented document of two pages, with the
  pages and the overlay put together as the app puts them: both pages drawn, no shape's id twice; a
  click on the second page's field opening the overlay over that page, a page's height below where
  it opens the first page's field; a part on the second page showing its lock there and opening
  nothing at a click; a part a page break splits marked on both pages, with one line, over its
  start; and no tab stop on any page.
- **The panel** (`src/editor/Panel.test.tsx`): on a document of two pages, an input for the field
  no page shows and none for one on the second page, which had one with the first page alone; the
  overlay's placement on the page that shows its field (`src/editor/Overlay.test.ts`); and the
  compiler's pages, each drawn by its index (`src/editor/compiler.test.ts`).

## Consequences

- `Shown` gains `pages`; `fieldsShown` and `shownFieldsOf` take every page; `placementFor` takes
  the pages and `Placement` gains `page`; `RenderOptions` gains `ids`. The compiler's `draw`
  option keeps its form, a page by its index.
- An update's time (`Shown.ms`, decisions 0016 and 0045) now includes drawing every page: the same
  for a one-page resume, and a page's drawing more for each page past it.
- **What stays open.** A field a page break splits opens over its first page and is set there from
  its first glyph, as the overlay sets any field; its glyphs on the next page are clicked to open
  it the same. The pages are drawn whole after each compile, unchanged ones too; only the browser
  skips setting an unchanged SVG again.
