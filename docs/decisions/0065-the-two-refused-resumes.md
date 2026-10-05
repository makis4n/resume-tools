# 0065. The two refused resumes

Date: 2026-10-05 · Status: accepted, the owner's decision 5 of 5 October 2026; amends decision
0020's split of the main file, and the outline's rule that an upload whose braces do not balance is
refused (decision 0049)

## Context

Decision 0060's run over the corpus had two documents probed and then refused by the import's
checks: `other-0006`, whose outline with every field kept stopped the compile (`stopped`), and
`other-0052`, whose outline the model did not hold (`keep`). Why needed the documents read on the
engine, which that item could not do. The owner asked for the cause found without anyone reading
either document's text, and for a fix where the cause is in the checks, or in the outline they
test, and the fix is small; otherwise for the cause and what a fix takes.

## Decision

### The diagnostic

- **`corpus checks --only <id>`** (`scripts/corpus-checks.ts`, its child `corpus-checks-child.ts`)
  takes a document, from the corpus or one of the three upstream samples, through the import a
  browser runs, and then through the same steps again up to the checks. It asks the model whether
  it holds the outline with its fields and with every field kept, and where not, which rule each
  breaks and where. It compiles both outlines as the checks do, and the one with every field kept
  five other ways, to tell which of the package's preamble, its format, the generator's writing of
  the body and the body's encoding stops it. It also says what follows the body, and what the
  reference's log says of groups left open.
- **It prints no word of a document**: ids, reasons, counts, command and environment names, line
  numbers and kinds of error. A log's error is read only against fixed patterns, and a package's own
  words are withheld; of TeX's context it reads only `l.<n>`, a command's name and the macros being
  expanded. It writes nothing. Its tests use invented logs and texts (`corpus-checks.test.ts`).
- On the three upstream samples it prints what an import that comes through looks like: both
  outlines held, both compiling to the reference's page, the one with every field kept the upload's
  body byte for byte.

### `other-0006`: an `\end{document}` in a verbatim ended its body

What the diagnostic printed, on main:

```
the import: refused at validate: stopped
after the body's end: 270 line ends, naming \end{verbatim} \ref \begin{verbatim} % (a comment) \moderncvtheme \begin{figure} \centering \fbox \includegraphics \textwidth \caption \label \end{figure} \section \verb \begin{document} \end{document} \subsection \closesection \emptysection
at the body's end: left open: {document} in {verbatim} in {document}
the outline with every field kept, compiled: stops: file ended while scanning use of \@xverbatim, after a runaway argument, reading \par again
  the upload's body from the document's own preamble, as the probe's baseline: sets the page the checks want
  the upload's body byte for byte, from the package's format: stops: file ended while scanning use of \@xverbatim, after a runaway argument, reading \par again
```

- **The cause.** The resume shows a LaTeX document's code in a `verbatim`, with the code's own
  `\begin{document}` and `\end{document}`. The body was split at the first `\end{document}`
  outside comments (decision 0020), which was the code's. The body stopped inside the verbatim,
  and the 270 lines after it went to what follows the body: the verbatim's end and the rest of
  the resume. The reference compile and the probe read the main file to its real end, so they set
  the page. The outline holds only the body and writes `\end{document}` itself, so TeX read on in
  the verbatim to the end of the file.
- **The fix.** The body ends at the first `\end{document}` that is outside comments and outside
  what TeX reads verbatim (`maskedVerbatim` in `src/import/parse.ts`). That means the text of
  `verbatim`, `verbatim*`, `filecontents`, `comment`, `lstlisting` and `minted`, the environments
  unified-latex reads verbatim, up to the first `\end` of the same name; and a `\verb`'s text, up
  to its delimiter on its line. An environment that nothing closes, or a `\verb` whose line lacks
  its delimiter, is read as before.
- **The tests.** `parse.test.ts` splits an invented main file of that shape past the code's
  `\end{document}`, and reads a verbatim in a comment, or one that is never closed, as before.
  `run.test.ts` imports an invented resume of that shape, which is refused `stopped` on main: its
  outline holds the verbatim's end and the sections after it, and it compiles.
- **What it imports now.** Partial, on pdfTeX: 1,409 words, none in place, 874 through the retype
  and 535 locked (`raw` 492, `differs` 31, `moved` 11, `misaligned` 1). The probe finds 147 of 196
  candidates editable in the whole body, where it found 66 of 108 in the cut one. The checks keep
  all 147 as text:
  - 35 stop the compile;
  - 48 stop on check 2's special characters;
  - 62 are left untried when the bisection's budget runs out;
  - 2 move the page.

  The diagnostic says why:

  ```
  the main file: UTF-8, 0 bytes past ASCII; inputenc loaded with latin1
  the outline with its fields, compiled: stops: inputenc: keyboard character used is undefined, at line 9 of the body as written, naming \rtfield
  ```

  The main file is ASCII and declares the `latin1` input encoding. The parser reads `--` as an en
  dash and quotation marks as curly ones, and the generator writes a field's text in UTF-8. A
  field holding one of those characters, like check 2's `ğ`, then has bytes `latin1` does not
  define, and inputenc stops.

### `other-0052`: groups TeX leaves open to `\end{document}`

What the diagnostic printed, on main:

```
the import: refused at validate: keep
the reference: TeX ends it inside a group at level 7
the model: the outline with its fields is refused: an outline's braces do not balance as TeX reads them
  deepest group 1; 19271 characters; 0 pieces ending in an escaping backslash; 0 holding the editor's macros or markers; 0 units not balanced
  7 { left open: a group's {, at main file line 283, on a line naming % (a comment); inside {document}, the next } in a comment at main file line 283, its line's comment has 1 { and 0 } before its %, 0 { and 1 } after it, a { before the % and a space after it; [the same at main file lines 288, 290, 292, 440, 447 and 486]
the model: the outline with every field kept is refused: an outline's braces do not balance as TeX reads them
the model: 92 of 92 candidates, each kept alone, break it
```

- **The cause.** Seven lines of the resume each open a group with a `{` right before a comment,
  and close it only inside that comment, where TeX does not read it. TeX opens seven groups and
  never closes them, and ends the document inside them, as it allows at `\end{document}`; its log
  says so. The model holds an outline only where its braces balance as TeX reads them
  (`OutlineSection`). So it refused the outline whatever its fields were, and the checks' first
  step answered `keep`.
- **The fix.** The outline closes the braces its parts leave open, as the model reads them, after
  `\end{document}` (`closeOpenBraces` in `src/import/outline.ts`). The model gains
  `outlineOpenBraces` for this, additively (`packages/resume-model`). It closes them only where
  every `}` closes a `{` before it, the text does not end in a comment or an address, and at most
  64 are open; any other outline the model refuses as before.
- **Why after it.** TeX stops reading at `\end{document}`, so it never reads the braces: the model
  holds the outline, and TeX reads the upload's own LaTeX. A first version closed them just before
  `\end{document}`, where TeX reads them, and the review of that commit (13099bf) showed two
  ways that goes wrong:
  - A group's settings were undone before the last page was set. An invented resume with a
    `{\raggedright\small %...}` group and a last paragraph running into `\end{document}` imported
    partial, its page moved; a `\pagestyle{empty}` in such a group lost its effect.
  - A `{` the model counts but TeX never opens, as in `\verb|{|`, a skipped `\iffalse{\fi` or
    `{...\egroup`, got a `}` TeX read as one too many. A resume that compiles went from refused
    `keep` to refused `stopped`.

  After `\end{document}`, the engine's output is the same, byte for byte, and both of those import
  with the reference's page. The checks compile the outline against the reference and judge its
  page, as for any outline.
- **The tests.** `index.test.ts` (resume-model) counts the braces left open. `outline.test.ts`
  closes them after `\end{document}` on an invented body, and leaves refused one whose `}` closes
  nothing. `run.test.ts` imports three invented resumes, each with the reference's page: one of
  this shape, refused `keep` on main; and the review's two, a group's settings held to the last
  paragraph (partial at 13099bf) and a `\verb|{|` (refused `stopped` at 13099bf).
- **What it imports now.** Partial, on XeTeX: 1,400 words, 418 in place (29.9%), 971 through the
  retype (69.4%), 11 locked (0.8%); 84 fields, 2 required; 4 groups, none fixed; 17.3 s. The
  outline with every field kept sets the reference's page, its seven braces added after
  `\end{document}`.

### Nothing else moved

`corpus run --ids sample-20.txt` on main's `parse.ts` and `outline.ts` and on this change: 7
successes, 11 partial and 2 refused (`awesome-cv-0009` and `-0027`, by the XeTeX rewrite) both
times; 13,919 words of the 18 imported, 64.7% in place, 33.5% through the retype and 1.8% locked.
`corpus compare` says the two runs agree on all 20 documents, times aside.

## Consequences

- **What an import refuses changes for documents of the two shapes, beyond these two.**
  - A main file whose body holds an `\end{document}` in a verbatim or a `\verb` now has its whole
    body read, probed and kept.
  - A document whose own braces TeX leaves open at `\end{document}` now imports. Its outline, and
    the document the store keeps, hold the closing braces the upload lacks, after
    `\end{document}`, where TeX never reads them.
  - So does a document whose braces only the model misreads as left open: a `{` in a `\verb`, in
    a skipped conditional, or closed by `\egroup`. Its page is checked, as any import's is.
  - The model's rule that a whole outline's braces balance is met, for these documents, by braces
    TeX never reads. Each unit still balances on its own, so a unit is still copied, removed and
    moved whole; what the rule guards in the rest of the outline the checks' compiles now guard.
  - A document of either shape whose page the checks then find different imports as partial, as
    any does.
- **Decision 0020's split now reads:** at the first `\begin{document}` and the `\end{document}`
  after it, outside comments, and for the end outside what TeX reads verbatim. An upload whose
  braces do not balance is still refused (decision 0049), except for braces it only leaves open,
  which the outline closes after `\end{document}`.
- **The next run over the corpus should count both as imported, partial,** where decision 0060
  counted them refused: 110 imported of 117 that compile, 7 refused, all by the XeTeX rewrite.
- **Two follow-ups for `other-0006`, left open.**
  - A document that declares an input encoding other than UTF-8 gets its fields' text in UTF-8. A
    fix writes a field's characters past ASCII as LaTeX commands where the document's encoding
    lacks them, or has the outline's package read UTF-8 after the document's own encoding. It
    should be measured over the corpus's documents that load inputenc with another encoding.
  - Its check 1 ran out of budget with 62 fields untried: the same budget question decision 0060
    names for AltaCV's long document.
- **`corpus checks` stays** for the next document the checks refuse, and prints what an import
  that comes through looks like for comparison.
