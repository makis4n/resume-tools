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
  dropped. Dropped: Unicode's controls, format characters such as zero-width joiners and U+FEFF,
  lone surrogates, which UTF-8 cannot encode, and the line and paragraph separators, except that
  tab, newline, carriage return, U+2028 and U+2029 become a space, since a field is one
  paragraph. A non-breaking space becomes `~`. Of the ten characters TeX gives a meaning, `\` is
  `\textbackslash{}`, `^` and `~` are `\textasciicircum{}` and `\textasciitilde{}`, which are the
  ASCII characters in T1 and XeTeX's TU and accents in OT1, and the rest take a backslash. `<`,
  `>` and `|` are `\textless{}`, `\textgreater{}` and `\textbar{}`, because OT1, the encoding of
  LaTeX's default fonts, holds ¡, ¿ and an em dash at their codes. Everything else passes
  through: letters outside ASCII, dashes and curly quotes, which LaTeX's UTF-8 input and XeTeX
  set, and `--` and the like, which become ligatures. A character LaTeX has no definition for,
  such as an emoji, the prelude drops with a warning in the log where LaTeX would stop with an
  error; XeTeX drops a character its font lacks by itself.
- **Presence.** A text is present when more than whitespace is left after the drops. A typeset
  slot that is absent renders nothing, markers included, and `{{#name}}` keeps its block only when
  the slot is present: text by that rule, a date that exists, a list with items.
- **Addresses.** A URL slot drops the same characters and the whitespace around the address, and
  percent-encodes as UTF-8 anything outside RFC 3986's unreserved and reserved characters and
  `%`, and `$` and `~`, which hyperref does not turn back. It then writes `%`, `#`, `&` and `_` as
  `\%`, `\#`, `\&` and `\_`, which hyperref turns back inside `\href` and `\url` whether or not
  they sit in another macro's argument, as a link in rich text always does. A `%` already there is
  kept, since an address may be encoded already. Rich runs are bold outside italic and a link
  outside both: `\href{...}{\textbf{\textit{...}}}`.
- **Dates** are the generator's, never TeX's, with English month names: `Jun 2020`, `June 2020`,
  `06/2020` or `2020`, and a date stored as a year is the year in every format. A range is joined
  by an en dash between spaces, an ongoing one ends in `Present`, and a single date stands alone.
- **The prelude** follows the template's preamble, so `\texorpdfstring` is hyperref's when the
  template loads hyperref. `\rtfield{<id>}{<content>}` is
  `\texorpdfstring{\leavevmode\special{rt:b:<id>}\rt@par{<id>}<content>\special{rt:e:<id>}}{<content>}`.
  `\rt@par` is protected, so a moving argument writes it rather than running it.
- **The paragraph special**, the contract item 9's overlay reads, follows the begin marker
  directly and is measured by TeX at the field's start. It is `rt:p:<id>:` and then `key=value`
  pairs joined by `;`, always these and in this order:

  | Keys | Values |
  |---|---|
  | `hsize`, `leftskip`, `rightskip`, `parfillskip` | dimensions and glue as `\the` prints them, such as `0.0pt plus 1.0fil` |
  | `pretolerance`, `tolerance` | integers |
  | `emergencystretch`, `hangindent` | dimensions |
  | `hangafter`, `parshape` | integers |
  | `shape` | each line of `\parshape` as `<indent>,<length>`, joined by `\|`, and empty when `parshape` is 0 |

  A bullet in `article`'s itemize at 11 pt ends `parshape=1;shape=27.37506pt,471.28752pt`.
- **Fields** are named `<node id>.<slot>`, and the header's `header.<slot>`; a contact snippet's
  `text` is the header field. The body comes with `texts`, the page's source for each field's
  text: the model's text, so offsets are the model's, a rich field's runs joined, or the dates as
  formatted.
- **Formats** are named by the package id when no control is format-bound, and otherwise
  `<id cut to 55 characters>-<8 hex digits>`, the digits the FNV-1a 32-bit hash of the JSON of the
  package id and the format-bound `[control, value]` pairs in the schema's order, each value as
  the preamble has it: one format for each combination, a name the session takes however long the
  id, and no name shared by two long ids that begin alike. The dumped preamble is the package's
  with its slots filled, then the prelude.
- **The body** is each offered control's snippet for its value, a line each, in the schema's
  order (`pageSize`, `margins`, `fontSize`, `font`, `accent`, `density`), format-bound or not;
  then the `document` snippet, which runs from `\begin{document}` to `\end{document}` as decision
  0006 has it, and a newline. A value the document leaves out is the package's default; margins
  and sizes render to the tenth, a colour as six capital hex digits, a choice as its id. A value
  with no snippet, such as a font the package no longer lists, is a `GenerateError`.
- **The cap.** A body stops at `MAX_BODY`, 1,048,576 characters, with a `GenerateError`: a package
  may repeat a list slot any number of times, and packages will come from other users. Each tag
  and list item rendered costs a character too, so slots repeated around nothing stop as soon, and
  the walk keeps its own stack, so blocks nested past a call stack's depth still render.

## Consequences

- The aligner does not yet pair an accented letter with its two OT1 glyphs (item 16). A typed
  `^` or `~` sets OT1's circumflex and tilde accent glyphs, which `glyphs.ts` reads as the
  characters.
- LaTeX 2023 sets `\$`, its itemize bullet and characters such as `•`, `°` and `€` from TS1, even
  in an OT1 document. The engine tree has no Type 1 fonts for TS1, and `tfm.ts` refuses its TFMs,
  which are padded past the length their header gives, so the page cannot draw them yet.
- Raw text in an address, as in `\href{mailto:{{&email}}}`, is escaped as text. hyperref turns
  back `\%`, `\#`, `\&` and `\_`, which covers what an email address usually holds; any other
  escape, a tilde's among them, reaches the address as written.
- A template that needs a separator only between the contacts present uses `{{contacts}}`.
- Anything a package cannot express is still a generator feature or a new record, never package
  code.
- The prelude replaces LaTeX's error for an undefined character, and the copy the kernel restores
  at the start of every job. A newer LaTeX may rename them; the round trip in `generate.test.ts`
  fails if such a character stops the compile again.
