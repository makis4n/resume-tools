# 0007. Generating LaTeX from the model

Date: 2026-09-25 · Status: accepted

## Context

Milestone 2 item 5 writes the generator decision 0006 calls for, the one program between the
model, a template package and TeX, in `apps/editor/src/templates/`. Decision 0006 left it what
data cannot say: how user text is escaped, how dates read, where the markers come from, how
formats are named and how much a package may make; decision 0004 asked for a special beside each
begin marker carrying the paragraph TeX sets the field in.

## Decision

- **Text.** User text enters LaTeX only through slots, and every character of it typesets or is
  dropped. It is composed (NFC), so that an accent typed as a combining mark reaches LaTeX as the
  letter it has a definition for, as every letter of Latin-1 and Latin Extended-A has; then it
  is decomposed again (NFD) past Latin Extended-A, from U+0180 on, except for the 48 composed
  letters there that LaTeX's UTF-8 input defines, in the `t1enc.dfu` every pdfTeX format loads,
  such as Romanian's `ș` and `ț` and Pinyin's `ǎ`. A letter LaTeX has no definition for, such as
  Vietnamese's `ễ`, then sets its base letter, and the prelude drops the combining marks, where
  it would drop the letter whole. That is pdfTeX's reach today; item 21 may keep text composed for
  XeTeX, whose fonts set such letters whole. Dropped: Unicode's controls, format characters such
  as zero-width joiners and U+FEFF, lone surrogates, which UTF-8 cannot encode, and the line and
  paragraph separators, except that tab, newline, carriage return, U+2028 and U+2029 become a
  space, since a field is one paragraph. Every space separator becomes a space, since LaTeX
  defines none of them and would join the words on either side, except the no-break ones, U+00A0,
  U+202F and U+2007, which become `~`. Of the ten characters TeX gives a meaning, `\` is
  `\textbackslash{}`, `^` and `~` are `\textasciicircum{}` and `\textasciitilde{}`, which are the
  ASCII characters in T1 and XeTeX's TU and accents in OT1, and the rest take a backslash. `<`,
  `>` and `|` are `\textless{}`, `\textgreater{}` and `\textbar{}`, because OT1, the encoding of
  LaTeX's default fonts, holds ¡, ¿ and an em dash at their codes. `[`, `]` and `*` are braced,
  as `{[}`, `{]}` and `{*}`, so that raw text right after `\\` or `\item` is never read as an
  optional argument or a star; and an empty group goes between a `?` or `!` and a backtick right
  after it, in one text or across two runs of rich text, so that the two cannot make OT1's ¿ or
  ¡, and the backtick still sets as OT1's opening quote. Any other backtick is left alone, so
  that two of them still make OT1's opening double quote. Everything else passes through: letters
  outside ASCII, dashes and curly quotes, which LaTeX's UTF-8 input and XeTeX set; `--` and the
  like, which become ligatures; and a straight double quote, which OT1 sets as a closing quote, as
  LaTeX does, and T1 (item 16) as itself. A character LaTeX has no definition for, such as an
  emoji, the prelude drops with a warning in the log where LaTeX would stop with an error, and so
  it does with a command the UTF-8 input maps a character onto that the font encoding has no glyph
  for, such as `\k` for `ą` or `\guillemetleft` for `«` in OT1: a symbol sets nothing, and an
  accented letter its base letter. XeTeX drops a character its font lacks by itself.
- **Presence.** A text is present when more than whitespace is left after the drops. A typeset
  slot that is absent renders nothing, markers included, and `{{#name}}` keeps its block only when
  the slot is present: text by that rule, a date that exists, a list with items. Presence is
  decided once, when a slot's value is built. A link with neither a label nor an address, as a
  new one starts, is left out of `{{links}}` and `{{contacts}}`, so that no separator is left
  with nothing after it.
- **Addresses.** A URL slot drops the same characters and the whitespace around the address, and
  percent-encodes as UTF-8 anything outside RFC 3986's unreserved and reserved characters and
  `%`, and `$` and `~`, which hyperref does not turn back. It then writes `%`, `#`, `&` and `_` as
  `\%`, `\#`, `\&` and `\_`, which hyperref turns back inside `\href` and `\url` whether or not
  they sit in another macro's argument, as a link in rich text always does. A `%` already there is
  kept, since an address may be encoded already. Rich runs are bold outside italic and a link
  outside both: `\href{...}{\textbf{\textit{...}}}`. A contact snippet's `href` is the address the
  generator builds: `mailto:` and the email, trimmed; `tel:` and the phone with its whitespace
  taken out; and none for the location. The field is typed as text, so its `#`, `?`, `&`, `%` and
  `/` are percent-encoded before the URL slot's own encoding, since an address reads them as its
  syntax: in `mailto:a#b@example.com` the address would be `a`, and the rest a fragment. An
  address from the resume, a link's `href` or a rich run's, links only to the web, an email or a
  phone, because hyperref reads its scheme to choose the link's PDF action: under the dvipdfmx
  driver a `run:` address becomes a Launch action, which asks the reader to run a program; a
  `file:` address, or one with no scheme, a GoToR link to a file, with `.pdf` added when it has no
  extension, so that the everyday `github.com/mara` would open `github.com/mara.pdf`; `#name` a
  GoTo within the document; and any other scheme, `javascript:` among them, a URI. So the
  generator reads such an address as the URL slot writes it, without the dropped characters and
  the whitespace around it (`linkAddress`): one with a scheme is kept when the scheme is `http`,
  `https`, `mailto` or `tel`, in any case, and is not linked otherwise; one without gets `mailto:`
  when it reads as an email, with one `@` and no whitespace, slash or colon, `https:` when it
  begins with `//`, and `https://` otherwise; and one that is blank, or begins with `#`, is not
  linked. A link's `href` that is not linked is absent, as a blank one is, so `{{#href}}` is false
  and `{{&href}}` sets nothing; a rich run with such an address is set without `\href`. The
  contacts' addresses, which the generator builds, are not read this way.
- **Long runs.** A text, or an address `\href` shows as its text, gets `\allowbreak` before a letter
  that would take a run with no space past 200 characters that set a glyph, accents included, as
  XeTeX fails on a word of about 1,100, but never right after a hyphen, whose discretionary is a
  break already, and a ragged line sets an empty one between the two; a letter keeps 30 accents, as
  Unicode's stream-safe form does, and the rest are left out and named in `surplus` (`runBreaks`).
- **Dates** are the generator's, never TeX's, with English month names: `Jun 2020`, `June 2020`,
  `06/2020` or `2020`, and a date stored as a year is the year in every format. A range is joined
  by an en dash between spaces, an ongoing one ends in `Present`, and a single date stands alone.
- **The prelude** follows the template's preamble, so `\texorpdfstring` is hyperref's when the
  template loads hyperref. `\rtfield{<id>}{<content>}` is
  `\texorpdfstring{\leavevmode\special{rt:b:<id>}\rt@par{<id>}<content>\special{rt:e:<id>}}{<content>}`,
  where each special writes the id through `\detokenize`, so that a character a template makes
  active, as underscore.sty does `_`, cannot expand inside a marker. `\rt@par` is protected, so a
  moving argument writes it rather than running it.
- **The paragraph special**, the contract item 9's overlay reads, follows the begin marker
  directly and is measured by TeX at the field's start. It is `rt:p:<id>:` and then `key=value`
  pairs joined by `;`, always these and in this order:

  | Keys | Values |
  |---|---|
  | `hsize`, `leftskip`, `rightskip`, `parfillskip` | dimensions and glue as `\the` prints them, such as `0.0pt plus 1.0fil` |
  | `pretolerance`, `tolerance` | integers |
  | `emergencystretch`, `hangindent` | dimensions |
  | `hangafter`, `parshape` | integers |
  | `inner` | `1` in restricted horizontal mode, such as a tabular cell or an `\mbox`, where TeX never breaks a line (`\ifinner`), and `0` elsewhere |
  | `shape` | each line of `\parshape` as `<indent>,<length>`, joined by `\|`, and empty when `parshape` is 0 |
  | `spaceskip`, `xspaceskip` | glue, which sets the space between words and after a sentence in place of the font's when not zero, as ragged2e's `\RaggedRight` makes its spaces rigid |

  A bullet in `article`'s itemize at 11 pt ends
  `parshape=1;inner=0;shape=27.37506pt,471.28752pt;spaceskip=0.0pt;xspaceskip=0.0pt`. Item 9
  breaks a field's lines where TeX would when `inner` is 0 and keeps them whole when it is 1, and
  reads the id case-insensitively, as the page reads the markers. Item 9's review added
  `spaceskip` and `xspaceskip`, last, since the glue between words is built from them.
- **Fields** are named `<node id>.<slot>`, and the header's `header.<slot>`; a contact snippet's
  `text` is the header field. The body comes with `texts`, the page's source for each field's
  text: the model's text, so offsets are the model's, a rich field's runs joined, or the dates as
  formatted. Every render is marked; the page keeps the first copy that reaches it, which is the
  editable one. A render in a PDF string, such as `pdfauthor`, or in a box `\settowidth` only
  measures never reaches the page, so a field set there first is found where the page shows it;
  and a later copy, such as the second of a link a header sets through both `{{contacts}}` and
  `{{links}}`, sets glyphs that belong to no field, and the validation harness (item 7) reports
  a package that marks a field more than once, since only the first copy is editable and a copy
  in a running head would come first. The page reads the markers case-insensitively,
  since a template may set a field in `\MakeUppercase`, which uppercases its markers too, and ids
  are lowercase (decision 0006).
- **Formats** are named `<id cut to 55 characters>-<8 hex digits>`, the digits the FNV-1a 32-bit
  hash of the JSON of exactly what is dumped: the preamble as the session gets it, and the
  package's files by name. The same dump has the same name; anything that changes what is dumped
  changes it, be it the template's preamble, a format-bound value the preamble uses, the prelude
  or a file; and a format-bound value the preamble does not use keeps it. A name fits the
  session's 64 characters however long the id, and every name ends in the suffix, so no package's
  id can be another package's format name. The dumped preamble is the package's with its slots
  filled, then the prelude.
- **The body** is each offered control's snippet for its value, a line each, in the schema's
  order (`pageSize`, `margins`, `fontSize`, `font`, `accent`, `density`), format-bound or not;
  then the `document` snippet, which runs from `\begin{document}` to `\end{document}` as decision
  0006 has it, and a newline. A value the document leaves out is the package's default; margins
  and sizes render to the tenth, a colour as six capital hex digits, a choice as its id. A value
  with no snippet, such as a font the package no longer lists, is a `GenerateError`.
- **The cap.** A body stops at `MAX_BODY`, 1,048,576 characters, with a `GenerateError`: a package
  may repeat a list slot any number of times, and packages will come from other users. Each tag
  and list item rendered costs a character too, so slots repeated around nothing stop as soon;
  each slot rendered also costs its source's length, charged before it is escaped, so a package
  that repeats a long field stops in proportion however little the field sets; and a block reads
  a presence decided once, so testing a long field costs a step. The walk keeps its own stack, so
  blocks nested past a call stack's depth still render.

## Consequences

- The aligner does not yet pair an accented letter with its two OT1 glyphs (item 16). A typed
  `^` or `~` sets OT1's circumflex and tilde accent glyphs, which `glyphs.ts` reads as the
  characters.
- In OT1 the characters LaTeX's UTF-8 input defines only for T1, such as `ą`, `Đ`, `Þ`, `ŋ`,
  guillemets and low quotes, set nothing or their base letter, with a warning in the log, and a
  field that holds one does not align with the model's text. T1 fonts (item 16) fix both.
- A field set in `\MakeUppercase` is found, but its glyphs do not align with the model's text
  until the aligner learns case folding (item 9). Decision 0021 later taught it to.
- Two texts can share a body, since a soft hyphen or a zero-width space changes only `texts`:
  item 8 must treat a body and its `texts` as one unit when it drops a stale compile.
- LaTeX 2023 sets `\$`, its itemize bullet and characters such as `•`, `°` and `€` from TS1, even
  in an OT1 document. The engine tree has no Type 1 fonts for TS1, and `tfm.ts` refuses its TFMs,
  which are padded past the length their header gives, so the page cannot draw them yet.
- An address is only ever a URL slot: the schema refuses any other slot, raw or typeset, in the
  first argument of `\href`, `\url`, `\nolinkurl` or `\hyperlink`, where the escapes for
  typesetting break, and names the slot's type; contact snippets get `href` from the generator.
  The check skips comments and finds the address past an optional argument, as TeX does, and it
  refuses a slot right after a backslash as well, since its text would become a command's name.
  It reads a snippet's own text, so a class whose own macro builds an address from a slot's
  text, as a template's email macro may, is outside it: a port has to link the contact through
  `href` instead.
- A template that needs a separator only between the contacts present uses `{{contacts}}`.
- Anything a package cannot express is still a generator feature or a new record, never package
  code.
- The prelude replaces LaTeX's error for an undefined character, and the copy the kernel restores
  at the start of every job, and its error for a text command the font encoding lacks,
  `\TextSymbolUnavailable`. A newer LaTeX may rename them; the round trip in `generate.test.ts`
  fails if such a character stops the compile again.
