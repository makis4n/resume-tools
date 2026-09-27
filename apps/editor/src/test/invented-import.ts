/**
 * Invented imports for the assembly's and the validation's tests (decision 0026): an upload of an
 * invented class and document, what the engine would say of their names, a probe whose verdicts a
 * test chooses, and the naming answer, without an engine. Every document, class, answer and verdict
 * here is invented, with invented commands whose names say so and invented words; nothing is taken
 * from a real resume.
 *
 * Only tests import this, and vitest collects only `*.test.ts` and `*.test.tsx` files, so it is
 * never run as one.
 */

import { NAMING_VERSION, type NamingAnswer, type StoredAnswer } from "@resume-tools/naming";
import { strToU8, zipSync } from "fflate";
import { candidatesOf, isSetter } from "../import/candidates";
import { type Intake, intake } from "../import/intake";
import { bodyOf, bodyOfText, parseBody, type Tree } from "../import/parse";
import type { Probe, ProbeCandidate, Verdict } from "../import/probe";
import type { Reference } from "../import/reference";
import { isRefusal } from "../import/refusal";
import type { EngineSignatures, Signature } from "../import/signatures";

/** What the engine would say of the invented template's commands and environments. */
export function signaturesOf(
  commands: Readonly<Record<string, string>>,
  environments: Readonly<Record<string, string>> = {},
  meanings: Readonly<Record<string, string>> = {},
): EngineSignatures {
  const signature = (spec: string): Signature => ({ kind: "template", spec, how: "meaning" });
  return {
    engine: "pdftex",
    commands: Object.fromEntries(
      Object.entries(commands).map(([name, spec]) => [name, signature(spec)]),
    ),
    environments: Object.fromEntries(
      Object.entries(environments).map(([name, spec]) => [name, signature(spec)]),
    ),
    macros: Object.fromEntries(
      Object.entries(meanings).map(([name, meaning]) => [
        name,
        { meaning, hash: "0".repeat(64), dependencies: [], capped: false },
      ]),
    ),
    truncated: false,
    ms: 0,
  };
}

/** An invented upload through the intake: its files, the main one `cv.tex`. */
export function upload(files: Readonly<Record<string, string>>): Intake {
  const zipped = Object.fromEntries(
    Object.entries(files).map(([path, text]) => [path, strToU8(text)]),
  );
  const taken = intake({ name: "invented.zip", bytes: zipSync(zipped) });
  if (isRefusal(taken)) throw new Error(taken.message);
  return taken;
}

/** The body's tree, as the parser reads it with the invented signatures. */
export function treeOf(taken: Intake, signatures: EngineSignatures): Tree {
  const body = bodyOf(taken);
  if (isRefusal(body)) throw new Error(body.message);
  const tree = parseBody(body, signatures);
  if (isRefusal(tree)) throw new Error(tree.message);
  return tree;
}

/**
 * A probe of the tree whose every candidate is editable but those `verdicts` names, by the
 * argument's macro and index (`name#index`) or a standard kind, each call's in turn, the last
 * given standing for the rest.
 */
export function probeOf(
  taken: Intake,
  tree: Tree,
  signatures: EngineSignatures,
  verdicts: Readonly<Record<string, Verdict[]>> = {},
): Probe {
  const body = bodyOf(taken);
  if (isRefusal(body)) throw new Error(body.message);
  const preamble = parseBody(bodyOfText(body.preamble), signatures);
  const setters = new Set(
    Object.keys(signatures.commands).filter((name) => isSetter(signatures.macros[name])),
  );
  const { candidates } = candidatesOf(tree, {
    ...(isRefusal(preamble) ? {} : { preamble }),
    setters,
  });
  const seen = new Map<string, number>();
  const probed: ProbeCandidate[] = candidates.map((candidate) => {
    const key =
      candidate.kind === "argument" ? `${candidate.name}#${candidate.index}` : candidate.kind;
    const at = seen.get(key) ?? 0;
    seen.set(key, at + 1);
    const given = verdicts[key];
    const verdict: Verdict = candidate.unprobed ?? given?.[at] ?? given?.at(-1) ?? "editable";
    return { ...candidate, verdict, settled: "together" };
  });
  return {
    engine: "pdftex",
    path: "format",
    baselineMs: 0,
    compiles: 0,
    budget: 64,
    compileMs: 0,
    passes: 0,
    ms: 0,
    signatures,
    candidates: probed,
    macros: [],
    standard: [],
    glyphs: { reference: 0, covered: 0 },
    uncovered: [],
  };
}

/** A reference of US Letter with nothing on it, which the assembly reads for the size alone. */
export const REFERENCE: Reference = {
  engine: "pdftex",
  pages: [],
  size: { width: 614.295, height: 794.97 },
  fonts: { tex: [], native: [], shipped: [] },
  specials: [],
  warnings: [],
  bibliographyLeftOut: false,
  images: [],
  passes: [],
  ms: 0,
  log: "",
};

/** An invented macro's answer: a command's or an environment's, by its name. */
export type AnswerRow = readonly [
  of: "command" | "environment",
  name: string,
  answer: StoredAnswer["answer"],
];

/**
 * An answer of stored answers for the invented macros, each under a key of its own, and the
 * preamble's settings.
 */
export function answerOf(
  macros: readonly AnswerRow[],
  parameters: NamingAnswer["preamble"]["parameters"] = [],
): NamingAnswer {
  return {
    version: NAMING_VERSION,
    macros: macros.map(([of, name, answer], i) => ({
      version: NAMING_VERSION,
      key: i.toString(16).padStart(64, "0"),
      hash: "f".repeat(64),
      of,
      name,
      answer,
      reviewed: "reviewed" in answer,
      source: "reviewed" in answer ? "seed" : "model:invented",
    })),
    preamble: { parameters },
  };
}

/** An invented template's document, what the engine says of its names, and the answers. */
export interface Invented {
  source: string;
  /** The class's source, `inventedcv.cls`; an empty class of `article`'s by default. */
  cls?: string;
  commands: Readonly<Record<string, string>>;
  environments?: Readonly<Record<string, string>>;
  meanings?: Readonly<Record<string, string>>;
  answers: readonly AnswerRow[];
  /** The answer's preamble settings, none by default. */
  parameters?: NamingAnswer["preamble"]["parameters"];
  verdicts?: Readonly<Record<string, Verdict[]>>;
}

/** What the assembly takes of an invented import, the reference aside. */
export interface InventedInputs {
  intake: Intake;
  tree: Tree;
  signatures: EngineSignatures;
  probe: Probe;
  answer: NamingAnswer;
}

/** An invented import's inputs: the intake, the tree, the signatures, the probe and the answer. */
export function inputsOf(invented: Invented): InventedInputs {
  const taken = upload({ "cv.tex": invented.source, "inventedcv.cls": invented.cls ?? CLASS });
  const signatures = signaturesOf(invented.commands, invented.environments, invented.meanings);
  const tree = treeOf(taken, signatures);
  return {
    intake: taken,
    tree,
    signatures,
    probe: probeOf(taken, tree, signatures, invented.verdicts),
    answer: answerOf(invented.answers, invented.parameters),
  };
}

/** An invented class, which loads `article` and defines nothing. */
export const CLASS = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{inventedcv}[2026/09/27 an invented class for the import's tests]
\LoadClass{article}
`;

// A template shaped like Jake's Resume: the name stored by the preamble and set by a call in the
// body, entries between an opener and a closer, each with bullets between their own, a standard
// list, spacing between two sections, and a paragraph.

export const PREAMBLE = String.raw`\documentclass[11pt,letterpaper]{inventedcv}
% Invented notes about the invented preamble.
\usepackage[margin=0.5in]{geometry}
\cvname{Quill Invented}
`;

export const BODY = String.raw`\begin{document}
\cvheader

\section{Invented experience}
\cvlistStart
  \cventry{Invented role}{Jan 2020 -- Present}{Quill Co}{Harbour City}
    \cvitemsStart
      \cvitem{Invented first bullet}
      \cvitem{Invented \textbf{second} bullet}
    \cvitemsEnd
  \cventry{Second role}{2018 -- 2019}{Other Co}{}
  \cventry{Third role}{Summer 2017}{Third Co}{Harbour City}
\cvlistEnd

\section{Invented skills}
\begin{itemize}
  \item Invented skill
  \item Another skill
\end{itemize}

\vspace{2pt}

\section{Summary}
Invented words of an invented summary.
\end{document}
`;

export const COMMANDS: Readonly<Record<string, string>> = {
  cvname: "m",
  cvheader: "",
  cventry: "m m m m",
  cvlistStart: "",
  cvlistEnd: "",
  cvitemsStart: "",
  cvitemsEnd: "",
  cvitem: "m",
};

export const MEANINGS: Readonly<Record<string, string>> = {
  cvname: "\\long macro:#1->\\def \\cv@name {#1}",
};

export const ANSWERS: readonly AnswerRow[] = [
  [
    "command",
    "cvname",
    {
      kind: "header",
      arguments: [{ index: 1, meaning: "title", slot: "first" }],
      repeatable: false,
    },
  ],
  ["command", "cvheader", { kind: "header", arguments: [], repeatable: false }],
  [
    "command",
    "cventry",
    {
      kind: "entry",
      arguments: [
        { index: 1, meaning: "title", slot: "title" },
        { index: 2, meaning: "dates", slot: "dates" },
        { index: 3, meaning: "subtitle", slot: "subtitle" },
        { index: 4, meaning: "place", slot: "place" },
      ],
      repeatable: true,
    },
  ],
  [
    "command",
    "cvlistStart",
    {
      kind: "layout",
      arguments: [],
      repeatable: false,
      list: { does: "opens", closedBy: "cvlistEnd", holds: "entry" },
    },
  ],
  [
    "command",
    "cvlistEnd",
    {
      kind: "layout",
      arguments: [],
      repeatable: false,
      list: { does: "closes", openedBy: "cvlistStart" },
    },
  ],
  [
    "command",
    "cvitemsStart",
    {
      kind: "bulletList",
      arguments: [],
      repeatable: false,
      list: { does: "opens", closedBy: "cvitemsEnd", holds: "bullet" },
    },
  ],
  [
    "command",
    "cvitemsEnd",
    {
      kind: "bulletList",
      arguments: [],
      repeatable: false,
      list: { does: "closes", openedBy: "cvitemsStart" },
    },
  ],
  [
    "command",
    "cvitem",
    {
      kind: "bullet",
      arguments: [{ index: 1, meaning: "text", slot: "text" }],
      repeatable: true,
    },
  ],
];

/**
 * What the engine says of the sizes `article` declares, which the invented class loads with the
 * document's options: `\ds@10pt`, `\ds@11pt` and `\ds@12pt` defined, as the signatures step reads
 * them when asked (`SIZE_OPTIONS`, decision 0026), and no other size.
 */
export const ARTICLE_SIZES: Readonly<Record<string, string>> = {
  "ds@10pt": "",
  "ds@11pt": "",
  "ds@12pt": "",
};

/** The template shaped like Jake's Resume, whole. */
export const JAKE_LIKE: Invented = {
  source: `${PREAMBLE}${BODY}`,
  commands: { ...COMMANDS, ...ARTICLE_SIZES },
  meanings: MEANINGS,
  answers: ANSWERS,
};

/**
 * A template shaped like Awesome-CV: the header's calls in the body, a contact and two links among
 * them; entries in an environment, each taking its bullets' environment in an argument; and
 * labelled items in another.
 */
export const ENVIRONMENTS: Invented = {
  source: String.raw`\documentclass[a4paper]{inventedcv}
\begin{document}
\cvname{Quill}{Invented}
\cvmail{quill@example.invalid}
\cvgit{quill-invented}
\cvweb{https://quill.example}{quill.example}
\makecvhead

\cvsection{Experience}
\begin{cvlist}
  \cvrow{Invented role}{Quill Co}{Harbour City}{Jan 2020 -- Present}{
    \begin{cvpoints}
      \item Invented point
      \item Another point
    \end{cvpoints}
  }
  \cvrow{Second role}{Other Co}{}{2019}{}
\end{cvlist}

\cvsection{Skills}
\begin{cvskills}
  \cvskill{Languages}{Invented, Words}
  \cvskill{Tools}{Other \emph{words}}
\end{cvskills}
\end{document}
`,
  commands: {
    cvname: "m m",
    cvmail: "m",
    cvgit: "m",
    cvweb: "m m",
    makecvhead: "",
    cvsection: "m",
    cvrow: "m m m m m",
    cvskill: "m m",
  },
  environments: { cvlist: "", cvpoints: "", cvskills: "" },
  answers: [
    [
      "command",
      "cvname",
      {
        kind: "header",
        arguments: [
          { index: 1, meaning: "title", slot: "first" },
          { index: 2, meaning: "title", slot: "last" },
        ],
        repeatable: false,
      },
    ],
    [
      "command",
      "cvmail",
      {
        kind: "contact",
        arguments: [{ index: 1, meaning: "text", slot: "text" }],
        repeatable: false,
        contact: "email",
      },
    ],
    [
      "command",
      "cvgit",
      {
        kind: "link",
        arguments: [{ index: 1, meaning: "text", slot: "label" }],
        repeatable: false,
        link: "github",
      },
    ],
    [
      "command",
      "cvweb",
      {
        kind: "link",
        arguments: [
          { index: 1, meaning: "address", slot: "href" },
          { index: 2, meaning: "text", slot: "label" },
        ],
        repeatable: false,
        link: "website",
      },
    ],
    ["command", "makecvhead", { kind: "header", arguments: [], repeatable: false }],
    [
      "command",
      "cvsection",
      {
        kind: "section",
        arguments: [{ index: 1, meaning: "title", slot: "title" }],
        repeatable: true,
      },
    ],
    [
      "command",
      "cvrow",
      {
        kind: "entry",
        arguments: [
          { index: 1, meaning: "title", slot: "title" },
          { index: 2, meaning: "subtitle", slot: "subtitle" },
          { index: 3, meaning: "place", slot: "place" },
          { index: 4, meaning: "dates", slot: "dates" },
          { index: 5, meaning: "other", slot: "bullets" },
        ],
        repeatable: true,
      },
    ],
    [
      "environment",
      "cvlist",
      {
        kind: "layout",
        arguments: [],
        repeatable: false,
        list: { does: "opens", holds: "entry" },
      },
    ],
    [
      "environment",
      "cvpoints",
      {
        kind: "bulletList",
        arguments: [],
        repeatable: false,
        list: { does: "opens", holds: "bullet" },
      },
    ],
    [
      "environment",
      "cvskills",
      {
        kind: "layout",
        arguments: [],
        repeatable: false,
        list: { does: "opens", holds: "labelledItem" },
      },
    ],
    [
      "command",
      "cvskill",
      {
        kind: "labelledItem",
        arguments: [
          { index: 1, meaning: "label", slot: "label" },
          { index: 2, meaning: "text", slot: "text" },
        ],
        repeatable: true,
      },
    ],
  ],
};
