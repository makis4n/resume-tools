# 00XX. A field a line

Date: 2026-10-07 · Status: accepted, lane F2 of decision 0074 (its fix 1); amends 0049 and 0050

## Context

The outline made no field of an editable candidate whose text breaks its line with `\\`: a field
is one paragraph, and the generator would set the lines on one (decision 0050 found it in the
skills block of Jake's sample). Decision 0074 found every one of the outline's `shape` words to be
that rule, 3,250 words in 36 resumes, and chose to make a field of each line instead, the break kept
as kept text between them, as decision 0070 kept a table's `&` and its rows' ends. It also asked
whether the `differs` words of kind `glyph`, 425, come from how the outline writes a field back
(its fix 6).

## Decision

### A field a line

- **A text that breaks its line is read again and cut at its breaks.** Where a text's source holds
  a `\\`, the outline reads it again as the parser read it, item by item, in the marks and the group
  that give the text's own runs back, and cuts it at each `\\` among its own items, or among a
  group's where that group is all the text holds, as `\item{...}` holds Jake's skills. Each line's
  text runs from its first item that is not a space, a comment or a break to its last, as a
  paragraph's does, so the break, the spaces around it and a comment between are kept text, and a
  field's markers hold its own line and never a break. A line of nothing, between two breaks, is no
  field. A reading that does not give the text's runs back keeps the text whole, as before.
- **What cannot be cut is kept as before.** A break inside a mark's argument or inside a group beside
  other text (`\textbf{a \\ b}`, `c {a \\ b}`), which a field's markers could only part with braces
  between them, so a rich run across a break stays kept text; so does a date, and a text that ends
  a paragraph. `\\*`, `\\[2pt]`, `\newline` and `\linebreak` were already raw between two texts,
  each a field; they are unchanged. A text whose only `\\` is in a comment is one field, as any
  text with a comment is.
- **A first line that may begin its line stays kept text.** Emptied, a first line would leave its
  break nothing to end where TeX is still between paragraphs, as after `\item` or at an argument's
  start, and LaTeX stops with "There's no line here to end". Check 2 then finds the candidate
  required, but its bisection of the empty text has to find it first: tried with every first line a
  field, `other-0010`'s bisection, among 1,172 fields, found 3 such candidates within its 48 compiles
  and left 741 fields untested, 2,938 words fewer in place. So the first line is a field only where
  a text or a date certainly stands before it on its line, with nothing between but spacing,
  `\newline` and `\linebreak`; otherwise it is kept text, and its candidate's other lines are
  fields. A raw `\\*` or `\\[2pt]` before it does not count: where text is centred or ragged it ends
  the paragraph. A candidate whose kept first line is not its start is kept whole.
- **Lines after a break are fields, and some of them are required.** Outside centred and ragged
  text, a line after a break is set in the paragraph its break ends a line of, and emptied sets
  nothing amiss. In `center`, `flushleft` and `flushright`, and after `\centering`, `\raggedright`
  or `\raggedleft`, `\\` ends the paragraph, so a line between two breaks begins one: emptied, it
  leaves the next `\\` nothing to end, and LaTeX stops as above. Check 2 finds it, so the page and
  the editor stay safe, but it judges a candidate required as a whole, so every field of that
  candidate is required, the last line and a first line after text among them, which empty
  harmlessly. Jake's template sets `\raggedright` for its whole document, so its skills block's
  lines after the first are all required (three in its sample), and resume headers often set their
  lines centred: this is where the person meets it most, and part of the required fields measured
  below. Judging each field of a split candidate on its own is a change to check 2's bisection,
  left for later.
- **The report counts a kept first line as kept text.** The probe's runs give a candidate's glyphs to
  it whole, so the count (`ownersOf`, `reachOf`) gives the first glyphs of a candidate the outline
  holds in part to kept text, `shape`, and the rest to its field. The kept line's glyphs are those
  that spell its text from the candidate's first glyph on the reference's page, a hyphen TeX added
  among them, as the retype lines a run up (decision 0042), so a ligature or a word broken many
  times is counted to its last glyph. Where they do not spell it, as where OT1 sets an accent apart
  from its letter, the count takes the most the line can set: every character but a space, one
  more for a letter past ASCII, two more for an ellipsis, and a hyphen a word, which errs towards
  kept text unless TeX breaks one word twice. On an invented look-alike of Jake's skills block it
  counts the 12 kept words as kept and none after them; on a narrow box whose kept line TeX
  hyphenates many times, and on a paragraph set with thirty-odd ligatures, every kept word is one
  the retype reaches and every field's word is in place.
- **Check 1 guards each new field, as any field.** A split candidate whose fields move the page is
  kept whole as text (`differs`), with every field of it, as before.

### `differs` of kind `glyph`, reproduced, not fixed here

A local diagnostic (never committed) compared, for each field check 1 kept for `glyph` in the 15
resumes that have one, the first glyph that differs, by font and by kind of character only. None of
the causes is in how the outline places or writes a field; each is in the model, the generator or the
parser, outside this lane's files:

- `\url` sets its address in the typewriter font, and the model has no typewriter mark: the field
  holds it as a linked text, which the generator writes in the body font (`moderncv-0007`,
  `moderncv-0024`, `other-0002`, `other-0028`, `other-0044`, `other-0060`, and the europecv two).
  Cutting a text around its `\url` would win the words beside it, but would lose the address's words
  where a document sets URLs in its body font, which the outline cannot tell.
- `\textsc` keeps its text with no mark (decision 0020), so the field is written without small caps
  (`moderncv-0018`); reproduced on an invented article.
- On XeTeX, Awesome-CV's fonts are loaded without TeX's ligatures, so the source's `'`, `--` and
  ` `` ` set as themselves, while the parser reads them as a curly quote and a dash
  (`awesome-cv-0003`, `-0018`, `-0025`).
- A document read in an 8-bit input encoding gets the field's letter past ASCII as UTF-8 bytes
  (`other-0006`, `other-0015`), and a long run with no space gets the generator's `\allowbreak`,
  which parts a ligature (`other-0010`).

### Measured

`corpus run --json` over all 220 documents on a merge of D3's diagnostics (decision 0073) and this
change and its review fixes, never pushed, four at a time at a load of 3.2 to 13.3, against main's
run (`ad0a73e`): `corpus compare` and a count over both runs find no document with a worse outcome
or fewer words in place. The review fixes change no field on the corpus; they change only the count
of kept first lines, 18 words more in place than before them.

| | Main | This change |
|---|--:|--:|
| Words editable in place, of the 110 imported | 84.6% (69,803) | 87.3% (72,012) |
| Jake's, Awesome-CV, AltaCV | 94.8%, 93.5%, 83.0% | 97.2%, 94.2%, 84.5% |
| europecv, moderncv, the others | 78.1%, 83.8%, 76.2% | 78.1%, 87.0%, 80.0% |
| Imported resumes at 90% or more in place | 61 | 74 |
| Imported resumes under 50% in place | 5 | 3 |
| Successes | 56 | 68 |
| Words kept for `shape` | 3,250 | 916 |
| Words kept for `differs` | 2,317 | 2,442 |
| Fields, and of them required | 9,480, 211 | 9,733, 284 |
| All compiles, all imports | 5,845 | 6,037 |

- 34 resumes gain 2,209 words in place: `other-0059` 742 to 1,026 of 1,068, a success;
  `other-0009` 594 to 827; `moderncv-0023` 211 to 434 of 631 and `other-0043` 187 to 352 of
  412, both past 50%; `jake-0031` 1,286 to 1,415, a success; `other-0063`, `altacv-0005`,
  `jake-0045`, `other-0060`, `other-0040`, `other-0070` and `jake-0016` 60 to 120 each; 12 of
  Jake's forks in all.
- Of the 3,250 `shape` words, 800 are first lines kept as text and 116 texts that cannot be cut.
  125 more words are `differs`: lines whose fields moved the page, kept whole by check 1.
- The checks take 192 more compiles, most of them check 2's bisection of the empty text, which now
  finds the candidates whose first line is a field after another text that is a field too: emptied
  together, they leave the break nothing to end, and the candidate is required:
  `other-0043` 42 to 60, `altacv-0005` 81 to 97, `moderncv-0023` 72 to 75; `jake-0004` is
  unchanged. The run before the review fixes, at a load of 4.7 to 5.8, held the time targets of
  decision 0074 but the slowest whole import, 135.8 s, which is F1's; the run after them, with the
  same compiles, all 6,037, ran beside other lanes' work at a load of 3.2 to 13.3, so its times
  (62 pages of 91 within 8 s on pdfTeX, 13 of 19 within 20 s on XeTeX) measure the machine, not
  this change.
- Typing on the 36 resumes of `shape-top.txt` (`measure --typing-imports`, at a load of 4.9 to
  2.4, against the investigation's run at 1.2 to 4.1): 35 within 300 ms either way, median 90 ms
  against 96 ms, slowest `altacv-0005` 310 ms against 302 ms.

## Consequences

- A skills block or a description written as lines is a field a line in the editor; its first
  line, where it begins the line, stays kept text the retype reaches (decision 0042). Each field is
  one line: Enter still inserts nothing (decision 0004), so no edit adds or removes a line.
- More fields reach check 2, and some are required: a first line that is a field after another
  field on its line stops the compile when both are emptied, and so does a line between two breaks
  in centred or ragged text, which makes every field of its candidate required. Check 2's
  bisections meet more fields, which F1 (decision 0074) changes.
- The outline's `line-break` rule (decision 0073's diagnostics) now names only texts it cannot
  cut; its kept first lines are counted as `shape` with no rule of their own.
- `differs` of kind `glyph` is left for a change to the model's marks, the generator or the parser:
  a typewriter mark for `\url`, a small-caps mark, XeTeX's ligatures read as the font sets them, and
  the document's input encoding.
- The change is in `src/import/`, so a corpus run is worth doing, by the owner's choice:
  `gh workflow run corpus.yml --ref waikin/perf2-outline`. It could move the words in place and the
  `shape` and `differs` words of resumes with line breaks, the required fields and the checks'
  compiles.
