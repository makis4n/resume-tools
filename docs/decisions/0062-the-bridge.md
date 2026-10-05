# 0062. The bridge between the two ways in

> Accepted by 00YY: the 42 compiling resumes xdvipdfmx makes no PDF of, which the move cannot
> take, are a known limit; their way across is the person's own PDF.

Date: 2026-10-05 · Status: accepted; the second pass's item 16, under decisions 0047, 0049 and 0051; the 42 pages it cannot move are accepted by 00YY

## Context

Item 16 of `docs/milestone-3-overhaul.md`: a `.tex` import that is refused offers the person "its
PDF" instead, and one that compiles but ends under the bar offers to move its content onto a
built-in template through the PDF path, run on the import's own reference page, under the same
consent as item 13. Decision 0049 left an imported `.tex` no other way onto a built-in template,
and decision 0051 found that xdvipdfmx makes no PDF of 42 of the 117 corpus documents that compile.
Two things were open: what "its PDF" is for a resume the editor could not compile, and which page
the move reads, and when it is made.

## Decision

- **A refused `.tex` is offered the person's own PDF of it.** A refused import has no reference
  page, or none the import could read, so the editor has no PDF to give. Under the refusal's notice,
  the documents screen says that a PDF of the same resume can be imported instead, and gives a
  picker that takes a PDF. What it picks runs the ordinary PDF import: the question the first time,
  the reading, the labels, the filing and the review. Every refusal makes the offer, since a PDF is
  the way in for anything the `.tex` path cannot take, the 103 resumes that do not compile among
  them.
- **The move reads the import's own reference page, made again when the person asks.** The report
  of a partial import under the bar (90% of the body's words editable in place) offers "Move onto a
  built-in template". On that click the compile worker makes the page again as the import made it:
  the intake, its stand-ins at plain paths, the reference compile in a job of its own, Latin Modern
  where the import swapped it in, and xdvipdfmx's PDF of that output with the stand-ins it may show,
  as item 15's corpus set made its PDFs. The PDF goes to the PDF import as if the person had picked
  it. An import at the bar or over it offers no move, and neither does one whose page moved but
  whose share reached the bar.
- **Nothing is made in advance.** The PDF is not made during the import, so an import is no slower
  for the bridge; a move costs one reference compile and one xdvipdfmx run.
- **Nothing new is sent.** The move is a PDF import, under its question and its setting (decision
  0047): with a no, rules read the page and nothing leaves the browser; with a yes, the page's text
  goes to the reading service as any PDF's does, and the line that says so shows.
- **A page xdvipdfmx cannot make a PDF of** leaves the import waiting as it was, with a notice that
  the content cannot be moved, and that a PDF of the resume the person has can be imported instead.

## Consequences

- The 42 documents of decision 0051 that compile but get no PDF cannot be moved by the bridge until
  their fonts' outlines are in the engine's tree, or the page's own glyph stream is read in place
  of a PDF; their way across is the person's own PDF.
- On the upstream samples, Jake's (89%) and AltaCV's (72%) imports are offered the move, and their
  pages come through the PDF path by rules to a resume that each built-in template sets
  (`src/import/bridge.test.ts`); Awesome-CV's (96%) is not offered it.
- The move discards the partial import: the person keeps the document made from the page, not the
  outline. Continue and Stop stay beside the offer for a person who wants the outline.
- The compile worker gains one request, `referencePdf`, which holds the engine as an import does,
  and is cancelled and timed as an import is.
