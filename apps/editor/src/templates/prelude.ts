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
 * its section's id (decision 0025): item 15's page reads it to show a lock over the part, and the
 * import's comparison of glyph streams already leaves it out, as it does the other markers
 * (decision 0019).
 */
export const LOCK_MARKER = "rt:l:";

/**
 * - `\rtfield{<id>}{<content>}` marks a field, as decision 0003 found it must: `\leavevmode` so a
 *   field that starts a list item keeps the item's label, and `\texorpdfstring` so a bookmark
 *   holds the text and never the markers. Every special writes the id through `\detokenize`, so a
 *   character a template makes active, as underscore.sty does `_`, cannot expand inside a marker.
 *   Before its end marker, in a slanted font, comes the italic correction LaTeX's text commands
 *   add after their text (`\maybe@ic`'s test of `\fontdimen1`), since TeX's `\/` corrects only a
 *   letter that ends the list, which the end marker would otherwise be: `\textit{...}` around a
 *   field then sets the page as around its text alone. It comes only inside a text command,
 *   whose group has set `\check@icr` to correct after it, so that a field set slanted by a
 *   declaration, `{\slshape ...}`, which LaTeX never corrects, gets none either. An upright font
 *   gets none, and nor does vertical mode, where `\/` is an error (decision 0007).
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
 *   upload had it, between two lock markers, `rt:l:<id>` both. It is `\rtfield` without the
 *   paragraph special, since nothing in it is edited, and without `\texorpdfstring`'s second copy,
 *   since it never stands in a PDF string; and without `\leavevmode`, since a locked part stands
 *   between sections, in vertical mode, where starting a paragraph would set an empty line. A
 *   marker is a whatsit, which hides the list's last skip from LaTeX's `\addvspace` and
 *   `\addpenalty`: the skip before a section that follows a list would then be added to the
 *   list's own rather than merged with it, 10 pt further down in `article`. So each marker takes
 *   the last skip off and puts it back after itself (`\rt@lock`), in either mode, and the part and
 *   what follows it are set where they would be with no marker.
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
    \ifhmode\ifx\check@icr\@empty\else\ifdim\fontdimen\@ne\font>\z@\/\fi\fi\fi%
    \special{${MARKER_END}\detokenize{#1}}}{#2}}
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
% the page reads (decision 0025). Each marker takes the list's last skip off and puts it back
% after itself, so that \addvspace and \addpenalty, which read \lastskip, still find it last.
\newcommand{\rtlocked}[2]{\rt@lock{#1}#2\rt@lock{#1}}
\protected\def\rt@lock#1{%
  \begingroup
    \skip@\lastskip
    \ifdim\skip@=\z@
      \special{${LOCK_MARKER}\detokenize{#1}}%
    \else\ifvmode
      \vskip-\skip@\special{${LOCK_MARKER}\detokenize{#1}}\vskip\skip@
    \else
      \unskip\special{${LOCK_MARKER}\detokenize{#1}}\hskip\skip@
    \fi\fi
  \endgroup
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
