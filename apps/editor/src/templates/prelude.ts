/**
 * The editor's own LaTeX, which the generator appends to every template's preamble before the
 * session adds `\dump`. The markers are the editor's, never a package's (decision 0006), and they
 * come after the template's preamble, so that `\texorpdfstring` is hyperref's when the template
 * loads it and the plain one below when it does not.
 */

import { MARKER_BEGIN, MARKER_END } from "../tex/fields";

/**
 * The prefix of the special that carries the paragraph a field is set in, next to `MARKER_BEGIN`
 * and `MARKER_END` in `fields.ts`. Item 9's overlay reads it; decision 0007 gives its format.
 */
export const PARAGRAPH_MARKER = "rt:p:";

/**
 * The prefix of the special written before and after a locked part of an imported resume, with
 * its section's id (decision 0025), and before the id a `/` after it (`LOCK_END`, decision 0041):
 * item 15's page reads them to show a lock over the part, and the import's comparison of glyph
 * streams already leaves them out, as it does the other markers (decision 0019).
 */
export const LOCK_MARKER = "rt:l:";

/**
 * What the special after a locked part writes between `LOCK_MARKER` and the id, so that the page
 * tells the part's end from its start where the output sets the two out of the source's order, as
 * two columns set side by side by paracol may (decision 0041).
 */
export const LOCK_END = "/";

/**
 * - `\rtfield{<id>}{<content>}` marks a field, as decision 0003 found it must: `\leavevmode` so a
 *   field that starts a list item keeps the item's label, and `\texorpdfstring` so a bookmark
 *   holds the text and never the markers. Every special writes the id through `\detokenize`, so a
 *   character a template makes active, as underscore.sty does `_`, cannot expand inside a marker.
 *   A marker is a whatsit, a node, and TeX and LaTeX look at the list's last node or at the next
 *   token in two places a field's markers would stand in, so the macro keeps out of their way, and
 *   a marked page sets every glyph where the unmarked one does (decision 00XX):
 *   - A text command, `\textbf{...}`, corrects with `\maybe@ic`: after its group, for its own last
 *     glyph, unless the font after it is slanted or `,` or `.` follows; and at its start, for the
 *     glyph before it, where it sets an upright font and its text does not start with `,` or `.`.
 *     It sets `\/`, the italic correction of the glyph that ends the list, and TeX's `\/` corrects
 *     nothing after a whatsit. So where the field's last glyph has a correction (`\rt@f@measure`:
 *     set, read and taken off again), a field's end (`\rt@f@end`) holds its end marker back
 *     (`\rt@f@held`) and reads what follows, past spaces and the ends of simple groups, as
 *     `\small{...}` or `{\itshape ...}` close round a field, which set nothing a correction cannot
 *     pass and go back as they were: where it is the `\check@icr` of a text command whose argument
 *     the field ends, that runs, and the marker comes back after the group, behind `\maybe@ic`
 *     (`\rt@f@resume`); where it is a text command of LaTeX's whose text is neither empty nor
 *     starts with `\nocorr`, the marker waits for that command's `\maybe@ic` at its start, which
 *     reads past `\rt@f@argstart`, put before its text, and where a class's own command of that
 *     name never reads it, `\rt@f@argstart` writes the marker before the text. Where a text command
 *     inside the field ends it, its `\maybe@ic` reads past the field's end and holds the marker.
 *     Each time LaTeX decides on the token the unmarked page has there, its `\/` corrects the glyph
 *     that ends the list, and only then is the end marker written. Anything else writes it at once,
 *     as does a last glyph with no correction, where LaTeX's `\/` would set a kern of nothing.
 *     Nothing is stored but the held markers, global to pass a group's end, and they are written
 *     and cleared before the text after them is set, whether LaTeX corrects or not: no state
 *     outlives the text command. A token read ahead may be `\fi`, as where a class sets a field in
 *     a conditional's branch, so it is compared and never skipped.
 *   - microtype's `\leftprotrusion`, which `\@item` ends with, reads the next token and protrudes
 *     the item's first glyph only after a command it knows. It learns `\rtfield`
 *     (`\MT@prot@check@R`, where microtype is loaded) and goes to the start of the field's text,
 *     after the markers, where it protrudes the same glyph by the same kern; inside a text command
 *     it reads on past the field's id.
 *   The names are `\rt@f@...`, since the Awesome-CV port's class has an `\rt@end` of its own.
 *   XeTeX's margin protrusion at a line's start stops at the first whatsit, the begin marker, which
 *   no macro can put after the line's first glyph: there a field still moves the page, as it does
 *   where anything but a space comes between it and the text command whose correction it would
 *   take, or where a command a document defines corrects it.
 * - `\rt@par{<id>}` writes the paragraph special right after the begin marker. It is measured by
 *   TeX rather than derived from the template (decision 0004), and item 9's overlay parses it to
 *   break the field's lines where TeX will. `\parshape` has as many lines as the template gave it,
 *   so they are gathered with e-TeX's `\parshapeindent` and `\parshapelength` into a macro first;
 *   `\special` expands its argument fully, so `\the` of each parameter expands inside it. `inner`
 *   is `\ifinner`, true in a tabular cell or an `\mbox`, where TeX never breaks the line.
 *   `spaceskip` and `xspaceskip` come last: the glue between words is built from them when they
 *   are not zero, as ragged2e's `\RaggedRight` sets them to make its spaces rigid. The group
 *   keeps the loop's counter and the macro to itself. It is protected, so a moving argument,
 *   such as a section title bound for the table of contents, writes the command instead of
 *   expanding it: nothing the loop assigns happens in a write, so the loop could run forever.
 * - `\rtlocked{<id>}{<latex>}` writes a locked section (decision 0025): its LaTeX, kept as the
 *   upload had it, between two lock markers, `rt:l:<id>` before it and `rt:l:/<id>` after it
 *   (decision 0041). It is `\rtfield` without the paragraph special, since nothing in it is
 *   edited, and without `\texorpdfstring`'s second copy, since it never stands in a PDF string;
 *   and without `\leavevmode`, since a locked part stands between sections, in vertical mode,
 *   where starting a paragraph would set an empty line. A
 *   marker is a whatsit, which hides the list's last skip from LaTeX's `\addvspace` and
 *   `\addpenalty`: the skip before a section that follows a list would then be added to the
 *   list's own rather than merged with it, 10 pt further down in `article`. So each marker takes
 *   the last skip off and puts it back after itself (`\rt@lock`), in either mode. And glue after a
 *   whatsit is a legal breakpoint, where after glue or a penalty it is not: a marker there would
 *   let a page, a column or a line break where it could not, which moved every glyph of a
 *   two-page, two-column AltaCV sample's right column. So after glue or a penalty a `\nobreak`
 *   follows the marker (`\rt@mark`); after a kern or a math node none does, since each is a
 *   breakpoint where glue follows it, which the glue after the marker takes over, and a `\nobreak`
 *   would take it away. The part and what follows it are set, and broken, where they would be
 *   with no marker.
 * - A character LaTeX's UTF-8 input has no definition for, such as an emoji or a letter of a
 *   script the template's fonts do not cover, is left out with a warning in the log, rather than
 *   stopping the compile with an error, so every character a user types either typesets or is
 *   dropped. The kernel puts its own definition back at the start of every job from a saved copy,
 *   so the copy is replaced as well. XeTeX has a definition for every character but sets a font's
 *   `.notdef` box for one the font lacks, so for a XeTeX package the generator leaves out what its
 *   declared fonts lack (`BodyOptions.covers`, decision 0014).
 * - So is a character the UTF-8 input defines only for T1, such as `ą` (`\k a`), `Đ` (`\DJ`) or
 *   `«` (`\guillemetleft`): in OT1, the encoding of LaTeX's default fonts, which has no glyph for
 *   them, LaTeX would stop with `\TextSymbolUnavailable`'s error. A symbol sets nothing and an
 *   accented letter its base letter, since the accent's argument still follows. Item 16's T1
 *   fonts are the real fix.
 */
export const PRELUDE = String.raw`\makeatletter
% The editor's field markers, which the generator appends to every template (decision 0007).
\providecommand{\texorpdfstring}[2]{#1}
\newcommand{\rtfield}[2]{%
  \texorpdfstring{\leavevmode\special{${MARKER_BEGIN}\detokenize{#1}}\rt@par{#1}#2%
    \rt@f@end{#1}}{#2}}
% A field's end: its marker is held back until LaTeX has decided the italic correction after it,
% where the field's last glyph has one. Where it has none, a correction is a kern of nothing, and
% the marker is written at once.
\newdimen\rt@f@ic
\protected\def\rt@f@end#1{%
  \rt@f@hold{#1}%
  \rt@f@ic\z@
  \ifhmode\rt@f@measure\fi
  \ifdim\rt@f@ic=\z@
    \expandafter\rt@f@flush
  \else
    \let\rt@f@pre\@empty
    \expandafter\rt@f@look
  \fi}
\global\let\rt@f@held\@empty
\protected\def\rt@f@hold#1{%
  \xdef\rt@f@held{\unexpanded\expandafter{\rt@f@held}\noexpand\rt@f@endmark{\detokenize{#1}}}}
\protected\def\rt@f@endmark#1{\special{${MARKER_END}#1}}
% The correction of the glyph that ends the list, a character, a ligature or XeTeX's text, which
% \/ sets as a kern, taken off again.
\protected\def\rt@f@measure{%
  \ifnum\lastnodetype=\z@\expandafter\rt@f@measure@\fi
  \ifnum\lastnodetype=7 \expandafter\rt@f@measure@\fi
  \ifnum\lastnodetype=9 \expandafter\rt@f@measure@\fi}
\protected\def\rt@f@measure@{\/\ifnum\lastnodetype=12 \rt@f@ic\lastkern\unkern\fi}
% What follows the field's end decides, read past the ends of simple groups and spaces, which set
% nothing a correction cannot pass, and which go back as they were (\rt@f@pre). The token read may
% be a \fi, as where a class sets the field in a conditional's branch, so it is compared and never
% left in skipped text, where it would close the conditional.
\protected\def\rt@f@look{\futurelet\rt@f@next\rt@f@look@}
\protected\def\rt@f@look@{%
  \let\rt@f@then\rt@f@other
  \ifx\rt@f@next\rt@f@end\let\rt@f@then\rt@f@pre\fi
  \ifx\rt@f@next\check@icr\ifx\check@icr\@empty\else\let\rt@f@then\rt@f@defer\fi\fi
  \ifx\rt@f@next\@sptoken\let\rt@f@then\rt@f@space\fi
  \ifx\rt@f@next\egroup\let\rt@f@then\rt@f@group\fi
  \ifx\rt@f@next\textrm\let\rt@f@then\rt@f@text\fi
  \ifx\rt@f@next\textsf\let\rt@f@then\rt@f@text\fi
  \ifx\rt@f@next\texttt\let\rt@f@then\rt@f@text\fi
  \ifx\rt@f@next\textnormal\let\rt@f@then\rt@f@text\fi
  \ifx\rt@f@next\textbf\let\rt@f@then\rt@f@text\fi
  \ifx\rt@f@next\textmd\let\rt@f@then\rt@f@text\fi
  \ifx\rt@f@next\textit\let\rt@f@then\rt@f@text\fi
  \ifx\rt@f@next\textsl\let\rt@f@then\rt@f@text\fi
  \ifx\rt@f@next\textsc\let\rt@f@then\rt@f@text\fi
  \ifx\rt@f@next\textup\let\rt@f@then\rt@f@text\fi
  \ifx\rt@f@next\emph\let\rt@f@then\rt@f@text\fi
  \rt@f@then}
% Anything else: the markers now, then what was read past.
\protected\def\rt@f@other{\rt@f@flush\rt@f@pre}
% A space in a paragraph, or a simple group's end, is read past and goes back after.
\protected\def\rt@f@space{%
  \ifhmode\expandafter\rt@f@take\expandafter\space\else\expandafter\rt@f@other\fi}
\protected\def\rt@f@group{%
  \let\rt@f@then\rt@f@other
  \ifhmode\ifnum\currentgrouptype=\@ne\let\rt@f@then\rt@f@takegroup\fi\fi
  \rt@f@then}
\protected\def\rt@f@takegroup{\rt@f@take\egroup}
\protected\def\rt@f@take#1{%
  \expandafter\def\expandafter\rt@f@pre\expandafter{\rt@f@pre#1}%
  \afterassignment\rt@f@look\let\rt@f@next= }
% The \check@icr of a text command whose argument the field ends: it sets LaTeX's \maybe@ic after
% the group, and the markers come back after that.
\protected\def\rt@f@defer{\rt@f@pre\rt@f@defer@}
\protected\def\rt@f@defer@#1{#1\aftergroup\rt@f@resume}
% A text command of LaTeX's corrects the field's last glyph as it starts, unless its text is empty
% or starts with \nocorr: the markers wait for its \maybe@ic there, which reads past
% \rt@f@argstart at its text's start, and are written after the correction; where the command is
% a class's own of that name, which never reads it, \rt@f@argstart writes them before its text.
\protected\long\def\rt@f@text#1#2{%
  \rt@f@ifcorrects{#2}{\rt@f@pre#1{\rt@f@argstart#2}}{\rt@f@flush\rt@f@pre#1{#2}}}
\long\def\rt@f@ifcorrects#1{%
  \begingroup
    \text@command{#1}%
    \aftergroup\@secondoftwo
    \ifhmode\ifx\check@icl\@empty\else\aftergroup\@gobble\aftergroup\@firstoftwo\fi\fi
  \endgroup}
\protected\def\rt@f@argstart{\rt@f@flush}
% After a group, or wherever LaTeX's \maybe@ic has decided: the next token decides again.
\protected\def\rt@f@resume{\rt@f@settle}
\protected\def\rt@f@settle{\ifx\rt@f@held\@empty\else\expandafter\rt@f@settle@\fi}
\protected\def\rt@f@settle@{\let\rt@f@pre\@empty\rt@f@look}
\protected\def\rt@f@flush{\let\rt@f@do\rt@f@held\global\let\rt@f@held\@empty\rt@f@do}
% LaTeX's \maybe@ic looks past a field's end and past the markers' return after a group, decides
% on the token after them, and then lets the held markers settle.
\ifdefined\maybe@ic@
  \let\rt@f@maybe@ic@\maybe@ic@
  \def\maybe@ic@{%
    \let\rt@f@ic@then\rt@f@icdecide
    \ifx\@let@token\rt@f@end\let\rt@f@ic@then\rt@f@icend\fi
    \ifx\@let@token\rt@f@resume\let\rt@f@ic@then\rt@f@icresume\fi
    \ifx\@let@token\rt@f@argstart\let\rt@f@ic@then\rt@f@icresume\fi
    \rt@f@ic@then}
  \protected\def\rt@f@icend\rt@f@end#1{\rt@f@hold{#1}\futurelet\@let@token\maybe@ic@}
  \protected\def\rt@f@icresume#1{\futurelet\@let@token\maybe@ic@}
  \protected\def\rt@f@icdecide{\rt@f@maybe@ic@\rt@f@settle}
\fi
% microtype's \leftprotrusion, at an item's start, protrudes a field's first glyph from inside it.
% Inside a text command it has already kept the command and its argument to set again after its
% kern, so it reads on past the field's id into its text.
\ifdefined\MT@prot@check@cmds
  \protected\def\MT@prot@check@R{%
    \ifx\MT@prot@l\MT@prot@l@tc
      \def\MT@temp*##1##2{\MT@prot@get@firstgroup@tc}%
    \else
      \the\MT@toks\def\MT@temp*##1##2##3{##1{##2}{\leftprotrusion##3}}%
    \fi}
  \g@addto@macro\MT@prot@check@cmds{{R\rtfield}}
\fi
% The paragraph a field is set in, as TeX has it where the field begins, so that the editor's
% overlay can break the field's lines where TeX will; item 9's overlay parses this special.
\protected\def\rt@par#1{%
  \begingroup
    \count@\z@
    \let\rt@shape\@empty
    \@whilenum\count@<\parshape\do{%
      \advance\count@\@ne
      \edef\rt@shape{\rt@shape\ifnum\count@>\@ne|\fi%
        \the\parshapeindent\count@,\the\parshapelength\count@}%
    }%
    \special{${PARAGRAPH_MARKER}\detokenize{#1}:%
      hsize=\the\hsize;leftskip=\the\leftskip;rightskip=\the\rightskip;%
      parfillskip=\the\parfillskip;pretolerance=\the\pretolerance;tolerance=\the\tolerance;%
      emergencystretch=\the\emergencystretch;hangindent=\the\hangindent;%
      hangafter=\the\hangafter;parshape=\the\parshape;inner=\ifinner1\else0\fi;%
      shape=\rt@shape;spaceskip=\the\spaceskip;xspaceskip=\the\xspaceskip}%
  \endgroup
}
% A locked part of an imported resume, LaTeX kept as the upload had it, between two lock markers
% the page reads (decision 0025), the second's id after a / (decision 0041). Each marker takes the
% list's last skip off and puts it back after itself, so that \addvspace and \addpenalty, which
% read \lastskip, still find it last.
\newcommand{\rtlocked}[2]{\rt@lock{#1}#2\rt@lock{${LOCK_END}#1}}
\protected\def\rt@lock#1{%
  \begingroup
    \skip@\lastskip
    \ifdim\skip@=\z@
      \rt@mark{#1}%
    \else\ifvmode
      \vskip-\skip@\rt@mark{#1}\vskip\skip@
    \else
      \unskip\rt@mark{#1}\hskip\skip@
    \fi\fi
  \endgroup
}
% The marker itself, and after it a \nobreak where the node before it is glue or a penalty: glue
% after a whatsit is a legal breakpoint, which after glue or a penalty it is not. After a kern or
% a math node, glue is none either, but the kern or the math node is one where glue follows it,
% and the glue after the marker breaks as it did, so the marker adds and takes away none there.
\def\rt@mark#1{%
  \count@\lastnodetype
  \special{${LOCK_MARKER}\detokenize{#1}}%
  \ifnum\count@=11 \nobreak\else\ifnum\count@=13 \nobreak\fi\fi
}
% A character LaTeX has no definition for is left out rather than stopping the compile. The
% kernel restores its own handler from the saved copy at the start of every job, so both change.
\def\UTFviii@undefined@err#1{%
  \@latex@warning{Unicode character \expandafter\UTFviii@splitcsname\string#1\relax
    \MessageBreak is left out, since LaTeX has no definition for it}%
}
\let\UTFviii@undefined@err@@\UTFviii@undefined@err
% So is one the UTF-8 input defines only for T1, such as \k or \guillemetleft, which OT1 has no
% glyph for: LaTeX's own definition is an error. An accent's argument still follows and is set.
\def\TextSymbolUnavailable#1{%
  \@latex@warning{Command \protect#1 unavailable in encoding \cf@encoding;
    \MessageBreak the character is left out}%
}
\makeatother
`;
