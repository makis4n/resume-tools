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
 * - `\rtfield{<id>}{<content>}` marks a field, as decision 0003 found it must: `\leavevmode` so a
 *   field that starts a list item keeps the item's label, and `\texorpdfstring` so a bookmark
 *   holds the text and never the markers. Every special writes the id through `\detokenize`, so a
 *   character a template makes active, as underscore.sty does `_`, cannot expand inside a marker.
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
