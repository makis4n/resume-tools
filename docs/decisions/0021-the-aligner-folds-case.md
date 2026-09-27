# 0021. The aligner folds case

Date: 2026-09-27 · Status: proposed

## Context

A class that sets a field through `\MakeUppercase`, as AltaCV sets its name and section titles,
shows capitals where the resume holds small letters. The page finds such a field, since it reads
the markers whatever their case (decision 0007), but its aligner matched a glyph only to the
character it spells, so every capital of a letter typed small matched nothing, and the harness
failed the field. Decision 0007 left case folding to a later item, and decision 0013 took
`\MakeUppercase` out of AltaCV's port for that reason and for its cost. Milestone 3 item 5's probe
runs upstream templates as they stand, capitals and all, so the aligner has to fold case first.
This record is that part of item 5; the probe is the rest.

## Decision

### The rule

- **A glyph matches a character in capitals or in small letters.** `alignField` compares a
  glyph's text with the resume's text folded to capitals, and then to small letters, a character
  at a time, by JavaScript's `toUpperCase` and `toLowerCase`: Unicode's default full mappings, the
  ones LaTeX's `\MakeUppercase` and `\MakeLowercase` apply through expl3 when no locale is set.
  Both sides are compared decomposed (NFD), so a glyph É, set whole or as an accent over E,
  matches é whether the resume holds it composed or decomposed. In small letters a glyph ς is
  taken for σ, since Unicode lowers Σ to ς at a word's end, which a character alone does not say.
- **Exact matches keep priority.** At each place the walk tries a glyph, it tries the glyph's
  spellings as they stand, then an accented letter set without its accents (`accentedAt`), and
  only when both fail the text in capitals, then in small letters; and it folds at a place at
  most once for each glyph, since the walk may come back to one. A text folds only where the fold
  changes a character the glyph spells, the first or another, so a ligature fl matches fL in small
  letters, as `\MakeLowercase` sets SelfLess; a text typed in the page's case never folds, digits
  and punctuation never do, and a compatibility form that is its own small letter, such as the
  ligature ﬁ a text pasted from a PDF holds, is never taken for the glyph fi by folding. The walk
  stays nearest first, as it was: a glyph takes the first place that matches either way.
- **Where the walk folds.** Where it stands; in the run of characters that may set no glyph after
  it, such as an emoji, where a glyph spelled in printable ASCII now tries the first letter of the
  run whose base, capital or small letter begins with printable ASCII, as é's base is e, ı's
  capital I and ß's capitals SS, before the run's end, which also finds a letter set without its
  accent right after such a character, which the walk used to miss; and in the resynchronisation a
  few code units on, as it stands or folded.

### Letters whose folded form is longer

Measured on the engine, `\MakeUppercase` sets ß as two glyphs S, ﬁ as F and I, and ı as I, on
pdfTeX in OT1 and T1 and on XeTeX; ǰ as J and a combining caron, which pdfTeX drops, since LaTeX
defines no lone caron; and `\MakeLowercase` sets İ as i and a combining dot, which pdfTeX drops the
same way.

- **Several glyphs for one letter are handled as a ligature is, the other way round.** The glyphs
  from the one that begins the letter's folded form on spell it between them, each taking it up
  where the one before stopped, and every one of them gets the letter's offset, so a click on
  either S of STRASSE lands on ß. The chain ends with the letter: a glyph that would go on past its
  folded form, into the next character's, does not go on with it, so no chain is longer than one
  letter's form, and each glyph's offset is the letter it spells. It is all or nothing: an S not
  followed by the other S of ß does not match it, and counts as unmatched, so of the glyphs S, SS
  and S, as a font that joins two S might set ßß, SS takes the first ß whole, each S alone matches
  nothing, and the offsets are 0, 0 and 1.
- **A hyphen TeX inserted between two glyphs of one letter**, as it breaks MASSEINHEIT, Maßeinheit
  in capitals, as MAS-SEINHEIT at a narrow measure, is skipped as inserted, and takes the letter's
  offset, as both S do.
- **A glyph that spells whole characters ends inside another only before accents** the page leaves
  out, as a ligature fi ends inside İ's small letters, i and a dot: no glyph after it goes on with
  that character, since the glyphs of one letter's form begin with it.
- **An accent the folded form has that the page leaves out** is left out as `accentedAt` leaves
  one out of an unfolded letter: J matches ǰ in capitals, and i matches İ in small letters.
- **Not folded:** a locale's own mappings, such as Turkish capitals, where i is İ. Neither
  `toUpperCase` nor LaTeX without the locale makes them; a template that selects such a locale
  sets its capitals where the page fails them, as before.

### The case the alignment records

`Alignment.folded` is recorded when some glyph matched only folded: `upper` when no glyph of the
field has a small letter, a letter whose capital is not one character, as ß's is SS, counting as
none, since a primitive `\uppercase`, which XeTeX may set a title through, leaves it among
capitals, so STRAßE UND BRÜCKE is in capitals; `lower` when none has a capital; and `mixed` when
the glyphs are of both cases, as when a class capitalises only a word's first letter. Such a field
aligns just the same, and item 5's probe can see that it needed folding, but no one case shows it,
so the overlay shows its text as typed. The case is undefined when every glyph matched as it
stands. `drawPage` aligns each field with `alignField` and puts the case on the field's layout,
`FieldLayout.folded`, where the overlay reads it.

### Small capitals

A small-caps font's encoding may name the glyphs at the small letters' codes after the capitals
they are drawn from, with a suffix: Roboto's `A.c2sc`, Source Sans Pro's `A.s`, and `A.sc`,
`A.smcp` and `A.small` in other fonts, or `small` joined, as fontinst names Adobe's expert
glyphs, `Asmall`. Decision 0009's rule drops the suffix and reads them as capitals, so the aligner
folded a `\textsc` field in those fonts to capitals, the harness passed it, and the overlay
measured and drew it in capitals, wider than the page's small capitals. Such a name reads instead
as the small letter it stands for, when the name before the suffix is one capital whose small
letter is one character, read as a single letter, through the glyph list or as `uniXXXX`:
`A.c2sc` is a, `Eacute.s` é and `uni0162.c2sc` ţ (`glyphText`). A `\textsc` field in Roboto or
Source Sans Pro then matches as typed and folds nothing, the web font types each small letter as its
own code, which draws the small capital, and the overlay's rows start where TeX's lines do, where
measured in capitals they break elsewhere; xdvipdfmx reads the glyphs as small letters in the PDF
too. Every other name reads by decision 0009's rule, Latin Modern's `a.sc` as before; in the
tree, only small-caps fonts give capitals those suffixes.

### The overlay

- **It shows the field in the page's case.** The plain overlay's rows and the rich editor's text
  take CSS's `text-transform`, `uppercase` or `lowercase`, from `FieldLayout.folded`
  (`textTransform`), and none for a `mixed` field, which is shown and measured as typed. The
  DOM's text stays the resume's, so offsets, the caret, selections, the
  commands and undo are all in the resume's case, and what the user types keeps the case it is
  typed in, as the resume holds it.
- **It measures the field in the page's case.** Capitals are wider than small letters, and TeX
  sets the space after a capital's period as an ordinary one, since a capital's space factor is
  999. So the breaker is given the text with each character mapped to its folded form before
  `paragraphNodes` and `richParagraphNodes` (`shownCase`), wherever that form is as long in UTF-16,
  so that every offset in the rows is still the resume's. `Setting.folded` carries the case, and
  the measuring script of decision 0016 lays rows out with it too. A paragraph set through
  `\MakeUppercase` in Latin Modern breaks into the overlay's rows where TeX breaks its lines,
  every row ending within 0.01 pt of TeX's, where the same text measured in its own case breaks
  elsewhere.
- **A letter whose folded form is longer is measured as it stands**, since mapping it would move
  every offset after it: ß in capitals is measured an S or so short, where the browser's
  `text-transform` draws SS, and so are ﬁ, ǰ and, in small letters, İ.

### The harness

- **`alignment`** passes a field set in capitals or small letters, and still reports a field that
  does not align. Its test of a field that does not align sets the title in a symbol font, OMS's
  `cmsy`, whose glyphs at the small letters' codes stand for other characters, in place of
  `\MakeUppercase`, which now aligns.
- **`pdf`** looks for a field's first word as the page sets it (`wordAsSet`): each letter in the
  case of the glyph that matched it, which is the word as typed, in capitals or in small letters
  where the page folds the field to one of them, and a mix where it folds some letters and not
  others; never whatever its case, so a first word the PDF lacks is reported even where the PDF
  shows the same word elsewhere in another case, as a bullet may hold it in small letters. It
  judges whether the word is set with a ligature in the same case, since small letters join where
  capitals do not.
- A plain package that sets the name and every title through `\MakeUppercase`, and the invented
  XeTeX template with its heading doing the same, pass every check, `edits` and `pdf` included.

## Consequences

- What stays open is `\MakeUppercase`'s cost, which decision 0013 measured: built on expl3's
  `\text_uppercase:n`, it takes time that grows with the square of its argument's length, 0.2 s a
  pass for a title of 2,000 characters and 2.2 s for 8,000. An import keeps its class's capitals,
  since an answer's redefinitions must keep upstream's output (item 6), so a field it sets through
  `\MakeUppercase` is editable and aligned, and costs that on every compile when the user makes it
  very long. A cheaper uppercase that sets the same glyphs, or a bound on such a field, is a later
  item's, and AltaCV's port stays without its capitals until then.
- The walk's cost keeps its shape. Folding at a place costs a bound: each character's folded form
  and each glyph text's spellings are read once for the field, a glyph folds at a place at most
  once, and a chain stops with its letter. Of each run of characters that set no glyph the walk
  tries only the first letter that folds or decomposes to printable ASCII, and the run's end, so a
  later such letter in the same run, as a dotless ı after an é right after an emoji, is not found;
  and a glyph spelled outside ASCII that misses walks the run a place at a time, as it did before
  folding, which folding makes cost about twice as much, a field of such glyphs that all miss
  costing the square of its length. Measured in CPU time on an M4 Pro: the timing test's 18,000
  periods that miss cost 6 ms, where they cost 2.4 ms before folding, and its 6,000 ß that glyphs
  S and X never spell, 7 ms; the reviews' shapes, glyphs SS against 8,000 ß, 1.5 ms, and a glyph a
  font maps from S and a bullet walking a run of 2,000 ß whose glyphs SS match at once, 0.8 ms,
  where chains that ran to the text's end made them cost 74 and 312 times their tenths; each of
  these costs ten times its tenth. Glyphs ՒԵ against 400 of the Armenian ligature և cost 14 ms, a
  hundred times their tenth, as the walk alone makes it.
- On XeTeX a mark a font sets in a form its character map does not name, as Roboto sets ǰ's caron
  over a capital J, matches nothing; and a font that sets i and a dot above as a dotless ı and
  the dot, as Roboto does for İ in small letters, does not align.
- Decisions 0007 and 0013 say where they left case folding that it is done, and decision 0009 says
  where it drops a name's suffix that a small capital named after its capital reads otherwise.
