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
  a text or a date certainly stands before it on its line, with nothing between but spacing and
  breaks; otherwise it is kept text, and its candidate's other lines are fields. A candidate whose
  kept first line is not its start is kept whole. Lines after a break set nothing amiss when
  emptied, and are fields.
- **The report counts a kept first line as kept text.** The probe's runs give a candidate's glyphs to
  it whole, so the count (`ownersOf`, `reachOf`) gives the first glyphs of a candidate the outline
  holds in part to kept text, `shape`, and the rest to its field. It counts the glyphs the kept
  line sets as at most every character but a space, one more for a letter past ASCII, two more for
  an ellipsis and two for hyphens TeX may add, so it errs towards kept text and never counts a kept
  word as in place. On an invented look-alike of Jake's skills block it counts the 12 kept words
  as kept, and one short word after them.
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

`corpus run --json` over the 56 resumes of `shape-top.txt`, `differs-top.txt`, `jake-0004`,
`other-0043` and `moderncv-0023`, on a merge of D3's diagnostics (decision 0073) and this change,
never pushed, four at a time, against main's run (`ad0a73e`): no resume has a worse outcome or fewer
words in place.

| On the 56 resumes | Main | This change |
|---|--:|--:|
| Words editable in place, of 51,194 | 40,375 | 42,589 (+2,214) |
| Words kept for `shape` | 3,250 | 911 |
| Words kept for `differs` | 2,317 | 2,442 |
| Fields | 5,497 | 5,750 |
| Required fields | 118 | 191 |
| Compiles | 3,136 | 3,328 |

- 34 resumes gain: `other-0059` 742 to 1,026 words in place, a success; `other-0009` 594 to 827;
  `moderncv-0023` 211 to 434; `other-0043` 187 to 352; `jake-0031` 1,286 to 1,415, a success;
  `other-0063`, `altacv-0005`, `jake-0045`, `other-0060`, `other-0070` and `other-0040` 76 to 120
  each; 12 of Jake's forks.
- Of the 3,250 `shape` words, 795 are first lines kept as text and 116 texts that cannot be cut. 125
  more words are `differs`: lines whose fields moved the page, kept whole by check 1.

The whole corpus, on the same merge: in the consequences below.

## Consequences

- A skills block or a description written as lines is a field a line in the editor; its first
  line, where it begins the line, stays kept text the retype reaches (decision 0042). Each field is
  one line: Enter still inserts nothing (decision 0004), so no edit adds or removes a line.
- More fields reach check 2, and some are required: a line's field that leaves its candidate's
  first line empty is one. Check 2's bisections meet more fields, which F1 (decision 0074) changes.
- The outline's `line-break` rule (decision 0073's diagnostics) now names only texts it cannot
  cut; its kept first lines are counted as `shape` with no rule of their own.
- `differs` of kind `glyph` is left for a change to the model's marks, the generator or the parser:
  a typewriter mark for `\url`, a small-caps mark, XeTeX's ligatures read as the font sets them, and
  the document's input encoding.
- The change is in `src/import/`, so a corpus run is worth doing, by the owner's choice:
  `gh workflow run corpus.yml --ref waikin/perf2-outline`. It could move the words in place and the
  `shape` and `differs` words of resumes with line breaks, the required fields and the checks'
  compiles.
