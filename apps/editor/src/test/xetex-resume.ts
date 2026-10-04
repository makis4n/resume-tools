/**
 * An invented resume on XeTeX, for the import's tests (the second pass's item 5): its fonts set
 * through fontspec by name, the engine tree's, which the import rewrites to files before it probes
 * (decision 0023), and its name stored by a call of the preamble's that the header sets later, as
 * Awesome-CV stores it. Nothing here is a real person's resume.
 *
 * Only tests import this, and vitest collects only `*.test.ts` and `*.test.tsx` files, so it is
 * never run as one.
 */

/** The resume, whole. */
export const XETEX_RESUME = String.raw`\documentclass[11pt]{article}
\usepackage{fontspec}
\setmainfont{Roboto}
\newfontfamily\headingfont{Source Sans Pro}
\usepackage[letterpaper,margin=0.8in]{geometry}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\makeatletter
\newcommand*{\name}[2]{\def\@firstname{#1}\def\@lastname{#2}}
\newcommand*{\makeheader}{{\headingfont\LARGE\bfseries\@firstname\ \@lastname}\par\medskip}
\makeatother
\newcommand{\heading}[1]{\par\medskip{\headingfont\bfseries\large #1}\par\smallskip}
\newcommand{\role}[3]{{\bfseries #1}, #2\hfill #3\par}
\name{Quill}{Wren}
\begin{document}
\makeheader
\heading{Experience}
\role{Harbor Lane Press}{Bergen}{2021 -- 2024}
\begin{itemize}
\item Rebuilt the invented typesetting service for every title.
\item Cut a proof's turnaround from a day to forty minutes.
\end{itemize}
\role{Lantern Works}{Eastmere}{2019 -- 2021}
\begin{itemize}
\item Kept the invented presses running through two winters.
\end{itemize}
\heading{Skills}
Patience, whistling and invented typography.
\end{document}
`;
