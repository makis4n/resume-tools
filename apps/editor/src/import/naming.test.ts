import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkRequest,
  environmentKeyOf,
  holdsText,
  keyOf,
  NAMING_VERSION,
  type NamingRequest,
  placeholder,
  sha256,
} from "@resume-tools/naming";
import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { bound, fastestAsync } from "../test/timing";
import { readTree } from "./fonts";
import { type Intake, intake } from "./intake";
import {
  assertNoText,
  buildRequest,
  documentStart,
  type HeaderValues,
  isOwn,
  maskedSignature,
  ownNames,
  sourcesOf,
  visibleOfMeaning,
  visibleOfSource,
  withRedefinitions,
} from "./naming";
import { bodyOf, bodyOfText, buildTree, parseBody, readBody, type Tree } from "./parse";
import { type Aggregate, type ProbeCandidate, probe, probeUses } from "./probe";
import { reference } from "./reference";
import { isRefusal } from "./refusal";
import {
  closure,
  type EngineSignatures,
  keysOf,
  masked,
  type Signature,
  signatures,
} from "./signatures";

// Every template, document, name and address here is invented for these tests; nothing is taken
// from a real resume. Quill Invented is the person, and their details are invented too.

const HEADER: HeaderValues = {
  first: "Quill",
  last: "Invented",
  email: "quill@example.invalid",
  phone: "+44 20 7946 0000",
  location: "Harbour City",
  // A link's label is the class's word as often as the person's: its address is what masks.
  links: [{ label: "Portfolio", href: "https://quill.example" }],
};

/** A template command, as the engine resolves one from its meaning. */
const template = (spec: string): Signature => ({ kind: "template", spec, how: "meaning" });

/**
 * Invented signatures, as `signatures` gives them: each meaning masked by pattern as item 4 masks
 * it, hashed, and closed over the others; and the data macros by their length alone.
 */
async function signaturesOf(
  meanings: Record<string, string>,
  commands: Record<string, Signature>,
  environments: Record<string, Signature> = {},
  data: readonly string[] = [],
): Promise<EngineSignatures> {
  const printed = new Map(Object.entries(meanings).map(([name, text]) => [name, masked(text)]));
  const macros: EngineSignatures["macros"] = {};
  for (const [name, meaning] of printed)
    macros[name] = {
      meaning,
      hash: await sha256(meaning),
      ...closure(name, printed, new Set(data)),
    };
  for (const name of data) macros[name] = { kind: "data", length: 5 };
  return { engine: "pdftex", commands, environments, macros, truncated: false, ms: 0 };
}

/**
 * An invented template's macros as the engine would print them: an entry, a row it hands its work
 * to that an invented package of the tree defines, a setter and the header it stores, a list, and
 * five the class the person uploaded wrote holding their name and details the way item 4's
 * verifier found them hidden from the patterns: in `\Large`, `\textcolor` and `\mbox`, a bare
 * domain, and a phone written with `\,`.
 */
const MEANINGS: Record<string, string> = {
  cventry: "macro:#1#2#3#4->\\cv@row {#1}{#2}\\hfill {\\itshape #3}\\par #4",
  "cv@row": "macro:#1#2->\\textbf {#1}, #2\\enskip \\vspace {-2pt}",
  cvname: "macro:#1#2->\\def \\@firstname {#1}\\def \\@lastname {#2}",
  cvheader: "macro:->{\\Large \\@firstname \\ \\@lastname }\\par ",
  cvlist: "macro:->\\begin {itemize}\\setlength \\itemsep {0pt}",
  endcvlist: "macro:->\\end {itemize}\\bottomline ",
  bottomline: "macro:->\\hrule \\vskip 2pt bottom",
  cvsection: "macro:#1->\\section *{#1}",
  cvsign: "macro:#1->{\\Large Quill Invented}#1",
  cvcolour: "macro:#1->\\textcolor {accent}{Quill Invented}#1",
  cvbox: "macro:#1->\\mbox {Quill}\\mbox {Invented}#1",
  cvsite: "macro:#1->\\href {https://quill.example}{quill.example}#1",
  cvphone: "macro:#1->+44\\, 20\\, 7946\\, 0000#1",
};

const DATA = ["@firstname", "@lastname"];

/** The invented template's signatures. */
const inventedSignatures = () =>
  signaturesOf(
    MEANINGS,
    {
      cventry: template("m m m o"),
      cvname: template("m m"),
      cvheader: template(""),
      cvsection: template("m"),
      cvsign: template("m"),
      cvcolour: template("m"),
      cvbox: template("m"),
      cvsite: template("m"),
      cvphone: template("m"),
      Quill: { kind: "undefined", how: "unresolved", why: "undefined" },
    },
    { cvlist: template("") },
    DATA,
  );

const PREAMBLE = String.raw`\documentclass[11pt,a4paper]{inventedcv}
\usepackage[margin=0.5in, top=1cm]{geometry}
\usepackage{hyperref} % Quill Invented's links
\definecolor{quillblue}{HTML}{1F4E79}
\setlength{\parskip}{2pt}
\cvname{Quill}{Invented}
`;

/**
 * A body that holds the person's text in every place a request could take it from: letters of
 * other scripts, marks and escapes, a comment, typewriter text and verbatim, mathematics, a date,
 * an optional argument, an unknown command named like the person, a link in a list, and each of
 * the calls whose definitions hold their details.
 */
const BODY = String.raw`
\cvheader
\cvsection{Ωmega ÉTÉ 東京 ١٢٣ Straße}
\cventry{Quill's \textbf{Role} \& Co.}{\texttt{quill@example.invalid}}{2019-09 -- present}[Harbour~City] % Quill Invented wrote this
\cventry{\Quill}{$x^2 + 7946$}{Jun 2020}[\textsc{Quill}]
\cventry{Larkspur Labs}{Invented Role}{2018}
\begin{cvlist}
\item Built the \href{https://quill.example/type}{typesetter} for Quill Invented.
\end{cvlist}
\cvsign{} \cvcolour{} \cvbox{} \cvsite{} \cvphone{}
`;

/**
 * The invented class the person uploaded, whose definitions are the document's own (`ownNames`):
 * every macro of the template's but `\cv@row`, which an invented package of the tree's defines.
 */
const CLASS = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{inventedcv}[2026/09/27 an invented class for the naming step's tests]
\LoadClass{article}
\RequirePackage{inventedrows}
\newcommand{\cventry}[4][]{\cv@row{#1}{#2}\hfill{\itshape #3}\par #4}
\newcommand*\cvname[2]{\def\@firstname{#1}\def\@lastname{#2}}
\def\cvheader{{\Large\@firstname\ \@lastname}\par}
\newenvironment{cvlist}{\begin{itemize}\setlength\itemsep{0pt}}{\end{itemize}\bottomline}
\gdef\bottomline{\hrule\vskip 2pt bottom}
\DeclareRobustCommand{\cvsection}[1]{\section*{#1}}
\newcommand{\cvsign}[1]{{\Large Quill Invented}#1}
\newcommand{\cvcolour}[1]{\textcolor{accent}{Quill Invented}#1}
\newcommand{\cvbox}[1]{\mbox{Quill}\mbox{Invented}#1}
\newcommand{\cvsite}[1]{\href{https://quill.example}{quill.example}#1}
\newcommand{\cvphone}[1]{+44\,20\,7946\,0000#1}
`;

/** The upload's sources: the main file, and the class. */
const SOURCES = [`${PREAMBLE}\\begin{document}${BODY}\\end{document}\n`, CLASS];

/** An invented probe's candidate, as the probe gives one. */
function candidate(extra: Partial<ProbeCandidate> & Pick<ProbeCandidate, "id">): ProbeCandidate {
  return {
    kind: "argument",
    where: "body",
    of: "call",
    name: "cventry",
    index: 1,
    start: 0,
    end: 0,
    text: "",
    empty: false,
    verdict: "editable",
    settled: "together",
    ...extra,
  };
}

/** The invented probe: the entry's verdicts, and the preamble's stored name. */
const PROBE: { macros: Aggregate[]; candidates: ProbeCandidate[] } = {
  macros: [
    {
      of: "call",
      name: "cventry",
      index: 1,
      calls: 3,
      verdict: "editable",
      counts: { editable: 3 },
    },
    {
      of: "call",
      name: "cventry",
      index: 2,
      calls: 3,
      verdict: "misaligned",
      counts: { misaligned: 3 },
    },
    {
      of: "call",
      name: "cventry",
      index: 3,
      calls: 3,
      verdict: "editable",
      counts: { editable: 3 },
      empty: "moved",
    },
    {
      of: "call",
      name: "cvname",
      index: 1,
      calls: 1,
      verdict: "editable",
      counts: { editable: 1 },
    },
  ],
  candidates: [
    candidate({ id: "h1-1", where: "preamble", name: "cvname", text: "Quill" }),
    candidate({ id: "h1-2", where: "preamble", name: "cvname", index: 2, text: "Invented" }),
  ],
};

/** No probe: no verdicts, and nothing stored. */
const NO_PROBE = { macros: [], candidates: [] };

/** A body's tree, parsed with the signatures given. */
function treeOf(body: string, found: EngineSignatures): Tree {
  const tree = parseBody(bodyOfText(body), found);
  if (isRefusal(tree)) throw new Error(tree.message);
  return tree;
}

async function invented(
  header: HeaderValues | undefined = HEADER,
  sources: readonly string[] = SOURCES,
) {
  const found = await inventedSignatures();
  const tree = treeOf(BODY, found);
  const request = await buildRequest(tree, found, PROBE, PREAMBLE, {
    ...(header === undefined ? {} : { header }),
    sources,
  });
  const document = {
    tree,
    ...(header === undefined ? {} : { header }),
    stored: PROBE.candidates.map((each) => each.text),
    sources,
  };
  return { found, tree, request, document };
}

const macroOf = (request: NamingRequest, name: string) =>
  request.macros.find((macro) => macro.name === name);
const definitionOf = (request: NamingRequest, name: string) =>
  request.definitions.find((definition) => definition.name === name);
const textOf = (request: NamingRequest, name: string) => {
  const definition = definitionOf(request, name);
  return definition?.kind === "definition" ? definition.text : undefined;
};

/** Every text a request holds that the model reads: definitions, signatures, call sites, settings. */
function textsOf(request: NamingRequest): string[] {
  return [
    ...request.definitions.flatMap((each) => (each.kind === "definition" ? [each.text] : [])),
    ...request.macros.flatMap((macro) => [
      ...(macro.signature === undefined ? [] : [macro.signature]),
      ...macro.sites.flatMap((site) => [
        ...site.arguments.flatMap((each) => (each === null ? [] : [each])),
        ...(site.body === undefined ? [] : [site.body]),
      ]),
    ]),
    ...request.preamble.settings,
    ...(request.preamble.class === undefined
      ? []
      : [request.preamble.class.name, ...request.preamble.class.options]),
  ];
}

/** Whether the check throws on a request, and its message, which never holds the text. */
function checked(request: NamingRequest, document: Parameters<typeof assertNoText>[1]) {
  try {
    assertNoText(request, document);
    return "passes";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("the request builder, on an invented template", () => {
  test("describes each macro and environment the body and the preamble call", async () => {
    const { request } = await invented();
    expect(request.version).toBe(NAMING_VERSION);
    expect(request.engine).toBe("pdftex");
    expect(request.family).toBeUndefined();
    expect(request.macros.map((macro) => `${macro.of} ${macro.name}`)).toEqual([
      "command cvname",
      "command cvheader",
      "command cvsection",
      "command cventry",
      "environment cvlist",
      "command cvsign",
      "command cvcolour",
      "command cvbox",
      "command cvsite",
      "command cvphone",
    ]);
    const entry = macroOf(request, "cventry");
    expect(entry).toMatchObject({ signature: "m m m o", calls: 3, capped: false });
    expect(entry?.dependencies).toEqual(["cv@row"]);
    expect(entry?.arguments).toEqual([
      { index: 1, kind: "mandatory", verdict: "editable" },
      { index: 2, kind: "mandatory", verdict: "misaligned" },
      { index: 3, kind: "mandatory", verdict: "editable", empty: "moved" },
      { index: 4, kind: "optional" },
    ]);
    // An environment's own definition is its `\begin` code, and its `\end` code the first of its
    // dependencies, closed over.
    expect(macroOf(request, "cvlist")?.dependencies).toEqual(["endcvlist", "bottomline"]);
    // A macro that holds data goes by its name and kind alone.
    expect(macroOf(request, "cvheader")?.dependencies).toEqual(["@firstname", "@lastname"]);
    expect(definitionOf(request, "@firstname")).toEqual({ kind: "data", name: "@firstname" });
  });

  test("shows each call site as placeholders, dates as their shapes, and commands by name", async () => {
    const { request } = await invented();
    const [first, second, third] = macroOf(request, "cventry")?.sites ?? [];
    expect(first?.arguments).toEqual([
      "Xxxxx'x \\textbf{Xxxx} \\& Xx.",
      "\\texttt{xxxxx@xxxxxxx.xxxxxxx}",
      "0000-00 -- xxxxxxx",
      "Xxxxxxx~Xxxx",
    ]);
    // An unknown command's name is the person's as likely as the template's, and is masked;
    // mathematics and digits are masked as text is.
    expect(second?.arguments).toEqual(["\\Xxxxx", "$x^0 + 0000$", "0000-00", "\\textsc{Xxxxx}"]);
    expect(third?.arguments).toEqual(["Xxxxxxxx Xxxx", "Xxxxxxxx Xxxx", "0000", null]);
    expect(macroOf(request, "cvsection")?.sites[0]?.arguments).toEqual(["Xxxxx XXX xx 000 Xxxxxx"]);
    expect(macroOf(request, "cvlist")?.sites[0]?.body).toBe(
      "\\item Xxxxx xxx \\href{xxxxx://xxxxx.xxxxxxx/xxxx}{xxxxxxxxxx} xxx Xxxxx Xxxxxxxx.",
    );
    // The preamble's storing call is shown as the body's are.
    expect(macroOf(request, "cvname")?.sites).toEqual([{ arguments: ["Xxxxx", "Xxxxxxxx"] }]);
    for (const macro of request.macros)
      for (const site of macro.sites)
        for (const argument of [...site.arguments, site.body])
          if (argument !== null && argument !== undefined) expect(holdsText(argument)).toBe(false);
  });

  test("masks the document's own definitions by its values, and nothing else", async () => {
    const { found, request } = await invented();
    for (const name of ["cvsign", "cvcolour", "cvbox", "cvsite", "cvphone"]) {
      const definition = definitionOf(request, name);
      expect(definition?.kind).toBe("definition");
      if (definition?.kind !== "definition") continue;
      for (const text of ["Quill", "Invented", "quill.example", "7946"])
        expect(definition.text.includes(text), `${name} holds ${text}`).toBe(false);
      // What is sent is hashed, so that no hash of the person's text leaves the browser.
      expect(definition.hash).toBe(await sha256(definition.text));
      const macro = found.macros[name];
      expect(macro?.kind !== "data" && definition.hash !== macro?.hash).toBe(true);
    }
    expect(textOf(request, "cvsign")).toBe("macro:#1->{\\Large Xxxxx Xxxxxxxx}#1");
    expect(textOf(request, "cvbox")).toBe("macro:#1->\\mbox {Xxxxx}\\mbox {Xxxxxxxx}#1");
    expect(textOf(request, "cvphone")).toBe("macro:#1->+00\\, 00\\, 0000\\, 0000#1");
    // A colour's name is code, and the class's.
    expect(textOf(request, "cvcolour")).toBe("macro:#1->\\textcolor {accent}{Xxxxx Xxxxxxxx}#1");
    // A bare domain is masked by the link's host, though the link's label is not the domain.
    expect(textOf(request, "cvsite")).toMatch(/\{xxxxx\.xxxxxxx\}#1$/);
    // The own definitions that hold none of the person's text go as item 4 hashed them, so their
    // keys are item 4's, and `bottom` is no first name's word; the tree's go so whatever they hold.
    const keys = await keysOf(found);
    for (const name of ["cventry", "cvsection", "cvheader", "cvname"]) {
      const macro = found.macros[name];
      expect(textOf(request, name)).toBe(macro?.kind === "data" ? undefined : macro?.meaning);
      expect(macroOf(request, name)?.key, name).toBe(keys[name]);
    }
    expect(textOf(request, "bottomline")).toBe(MEANINGS.bottomline);
    expect(textOf(request, "cv@row")).toBe(MEANINGS["cv@row"]);
    expect(await checkRequest(request)).toEqual([]);
    // Nothing the model reads holds any of the person's details, in any case, but the first name
    // inside the name of a colour the preamble gives, `quillblue`, which is no whole word of theirs.
    const everything = textsOf(request).join("\n").toLowerCase();
    for (const text of ["invented", "harbour", "example.invalid", "7946", "larkspur"])
      expect(everything.includes(text), text).toBe(false);
    expect(everything.replaceAll("quillblue", "").includes("quill")).toBe(false);
  });

  test("masks no definition by the document's values without the upload's sources", async () => {
    // Without the sources every definition is the tree's: public, and sent as item 4 hashed it.
    const { found, request } = await invented(HEADER, []);
    const keys = await keysOf(found);
    for (const macro of request.macros)
      if (macro.of === "command") expect(macro.key, macro.name).toBe(keys[macro.name]);
    for (const [name, meaning] of Object.entries(MEANINGS))
      expect(textOf(request, name), name).toBe(masked(meaning));
  });

  test("masks the preamble's settings but for numbers, lengths, colours and keywords", async () => {
    const { request } = await invented();
    expect(request.preamble).toEqual({
      class: { name: "xxxxxxxxxx", options: ["11pt", "a4paper"] },
      settings: [
        "\\usepackage[margin=0.5in, top=1cm]{geometry}",
        // A colour the preamble names is kept, as the class's code that sets it is: a word of the
        // person's name inside it is not a whole word (decision 0024).
        "\\definecolor{quillblue}{HTML}{1F4E79}",
        "\\setlength{\\parskip}{2pt}",
      ],
    });
  });

  test("masks a setting by whole words, and an identifier of six characters or more anywhere", async () => {
    const found = await inventedSignatures();
    const tree = treeOf(BODY, found);
    const preamble = String.raw`\documentclass[11pt,letterpaper]{article}
\usepackage[top=0.5in, bottom=0.5in, left=0.6in, right=0.6in]{geometry}
\setmainfont{Source Sans Pro}[ItalicFont=*-Italic]
\definecolor{quill}{HTML}{1F4E79}
\definecolor{quillinvblue}{HTML}{1F4E79}
`;
    const options = (header: HeaderValues) => ({ header, sources: SOURCES });
    const plain = await buildRequest(tree, found, NO_PROBE, preamble, { sources: SOURCES });
    expect(plain.preamble.settings).toEqual([
      "\\usepackage[top=0.5in, bottom=0.5in, left=0.6in, right=0.6in]{geometry}",
      "\\setmainfont{Source Sans Pro}[ItalicFont=*-Italic]",
      "\\definecolor{quill}{HTML}{1F4E79}",
      "\\definecolor{quillinvblue}{HTML}{1F4E79}",
    ]);
    // A short first name never rewrites a keyword it is inside: `bottom`, `ItalicFont`, `article`.
    for (const first of ["Tom", "Ali", "Art"]) {
      const request = await buildRequest(tree, found, NO_PROBE, preamble, options({ first }));
      expect(request.preamble, first).toEqual(plain.preamble);
    }
    // A whole word of the name is masked, and a handle inside a colour's name.
    const quill = await buildRequest(
      tree,
      found,
      NO_PROBE,
      preamble,
      options({ first: "Quill", links: [{ href: "https://github.com/quillinv" }] }),
    );
    expect(quill.preamble.settings.slice(2)).toEqual([
      "\\definecolor{xxxxx}{HTML}{1F4E79}",
      "\\definecolor{xxxxxxxxblue}{HTML}{1F4E79}",
    ]);
  });

  test("keys an environment by its `\\begin` code, its `\\end` code first of its closure", async () => {
    const { request } = await invented();
    const hashOf = (name: string) => {
      const definition = definitionOf(request, name);
      return definition?.kind === "definition" ? definition.hash : "";
    };
    const rest = [["bottomline", hashOf("bottomline")] as const];
    const key = macroOf(request, "cvlist")?.key;
    expect(key).toBe(
      await environmentKeyOf(
        NAMING_VERSION,
        hashOf("cvlist"),
        "endcvlist",
        hashOf("endcvlist"),
        rest,
      ),
    );
    expect(key).toBe(
      await keyOf(NAMING_VERSION, hashOf("cvlist"), [["endcvlist", hashOf("endcvlist")], ...rest]),
    );
    expect(await checkRequest(request)).toEqual([]);
  });

  test("keys an environment whose `\\end` code holds data over the rest of its closure", async () => {
    // Its `\end` code is text alone, as Awesome-CV's `cvparagraph` has: data, named in the closure
    // and left out of the key, never keyed with no hash.
    const found = await signaturesOf(
      { cvnote: "macro:->\\begin {quote}\\cv@style ", "cv@style": "macro:->\\small " },
      {},
      { cvnote: template("") },
      ["endcvnote"],
    );
    const tree = treeOf("\\begin{cvnote}\nInvented note.\n\\end{cvnote}\n", found);
    const request = await buildRequest(tree, found, NO_PROBE, "\\documentclass{article}\n");
    const note = macroOf(request, "cvnote");
    expect(note?.dependencies).toEqual(["endcvnote", "cv@style"]);
    expect(definitionOf(request, "endcvnote")).toEqual({ kind: "data", name: "endcvnote" });
    const hashOf = (name: string) => {
      const definition = definitionOf(request, name);
      return definition?.kind === "definition" ? definition.hash : "";
    };
    expect(note?.key).toBe(
      await keyOf(NAMING_VERSION, hashOf("cvnote"), [["cv@style", hashOf("cv@style")]]),
    );
    expect(await checkRequest(request)).toEqual([]);
  });

  test("passes the leak check, which finds the person's text wherever a request would hold it", async () => {
    const { request, document } = await invented();
    expect(checked(request, document)).toBe("passes");
    const own = (name: string, text: string) => (changed: NamingRequest) => {
      const definition = changed.definitions.find((each) => each.name === name);
      if (definition?.kind === "definition") definition.text += text;
    };
    const leaks: [string, (request: NamingRequest) => void][] = [
      ["an own definition, a word of the name", own("cvsection", "\\mbox {Quill}")],
      ["an own definition, an email", own("cventry", "\\texttt {quill@example.invalid}")],
      ["the tree's definition, a phrase", own("cv@row", "{Larkspur Labs}")],
      ["the tree's definition, an identifier", own("cv@row", "{quill.example}")],
      [
        "a call site",
        (changed) => {
          const site = changed.macros.find((each) => each.name === "cvsection")?.sites[0];
          if (site !== undefined) site.arguments[0] = "Harbour City";
        },
      ],
      [
        "a signature",
        (changed) => {
          const macro = changed.macros.find((each) => each.name === "cvsection");
          if (macro !== undefined) macro.signature = "O{Larkspur Labs} m";
        },
      ],
      [
        "a setting",
        (changed) => {
          changed.preamble.settings.push("\\newcommand{\\where}{Harbour~City}");
        },
      ],
      [
        "a date",
        (changed) => {
          changed.preamble.settings.push("{2019-09 -- present}");
        },
      ],
      [
        "a link's address",
        (changed) => {
          changed.preamble.settings.push("quill.example/type");
        },
      ],
      [
        "the class's name",
        (changed) => {
          if (changed.preamble.class !== undefined) changed.preamble.class.name = "Invented";
        },
      ],
    ];
    for (const [where, leak] of leaks) {
      const changed = structuredClone(request);
      leak(changed);
      const message = checked(changed, document);
      expect(message, where).toMatch(/holds the document's text/);
      // The message names the kind of text and where, never the text.
      for (const text of ["Quill", "Harbour", "quill.example", "Larkspur", "2019"])
        expect(message.includes(text), `${where}: ${message}`).toBe(false);
    }
    // A single word of the person's in public code is no leak: the tree's words are everyone's.
    const single = structuredClone(request);
    own("cv@row", "\\mbox {Quill}")(single);
    expect(checked(single, document)).toBe("passes");
  });

  test("finds a short name only as a whole word, in a definition and in a setting", async () => {
    const found = await signaturesOf(
      { bottomline: MEANINGS.bottomline ?? "" },
      { bottomline: template("") },
    );
    const tree = treeOf("\\bottomline\n", found);
    const sources = [String.raw`\gdef\bottomline{\hrule\vskip 2pt bottom}`];
    const preamble = "\\documentclass{article}\n\\usepackage[top=1in, bottom=1in]{geometry}\n";
    const header: HeaderValues = { first: "Tom", last: "Lee" };
    const request = await buildRequest(tree, found, NO_PROBE, preamble, { header, sources });
    // `bottom` in the class's own `\bottomline` keeps its letters: Tom is no word of it.
    expect(textOf(request, "bottomline")).toBe(MEANINGS.bottomline);
    expect(request.preamble.settings).toEqual(["\\usepackage[top=1in, bottom=1in]{geometry}"]);
    const document = { tree, header, sources };
    expect(checked(request, document)).toBe("passes");
    const inDefinition = structuredClone(request);
    const definition = inDefinition.definitions.find((each) => each.name === "bottomline");
    if (definition?.kind === "definition") definition.text += " Tom";
    expect(checked(inDefinition, document)).toMatch(/\(header\) in the definition of bottomline/);
    const inSetting = structuredClone(request);
    inSetting.preamble.settings.push("\\geometry{bottom=1in}");
    expect(checked(inSetting, document)).toBe("passes");
    // A colour named after the person, which the builder masks, is found, though a setting keeps
    // the names of the colours it defines.
    inSetting.preamble.settings.push("\\definecolor{Tom}{HTML}{000000}");
    expect(checked(inSetting, document)).toMatch(/\(header\) in setting 3/);
  });

  test("reads a definition's letters and digits, not its commands, environments or parameters", () => {
    const letters = (visible: { text: string[] }) => visible.text.join("");
    expect(letters(visibleOfMeaning("macro:#1->\\textbf {Quill}\\ \\begin {itemize}#1 é-2"))).toBe(
      "quille2",
    );
    expect(letters(visibleOfMeaning("\\long macro:#1[#2]->#1 A\\& B"))).toBe("ab");
    expect(letters(visibleOfMeaning('\\char"41'))).toBe("");
    expect(
      letters(visibleOfSource("\\textbf{Quill} % Invented\n\\begin{itemize}\\item \\'e\\\\x")),
    ).toBe("quillex");
    // A pattern's placeholder names what it hid, in the contract's words, not the text's.
    expect(letters(visibleOfMeaning("macro:->\\href {<link______>}{Quill}"))).toBe("quill");
    expect(letters(visibleOfSource("\\href{<email______>}{Quill}"))).toBe("quill");
  });

  test("reads the arguments of code as code, not as text a page shows", () => {
    const letters = (text: string) => visibleOfMeaning(`macro:#1->${text}`).text.join("");
    // Each holds `quill` where it is code, and `Visible` where it is text.
    const code = [
      "\\color {quill}Visible",
      "\\color [HTML]{quill}Visible",
      "\\textcolor {quill}{Visible}",
      "\\pagecolor {quill}Visible",
      "\\colorlet {quill}{quill!50}Visible",
      "\\definecolor {quill}{HTML}{quill}Visible",
      "\\newcounter {quill}[quill]Visible",
      "\\setcounter {quill}{2}Visible",
      "\\addtocounter {quill}{1}Visible",
      "\\stepcounter {quill}Visible",
      "\\refstepcounter {quill}Visible",
      "\\value {quill}Visible",
      "\\usecounter {quill}Visible",
      "\\newlength {quill}Visible",
      "\\setlength {quill}{2pt}Visible",
      "\\addtolength \\quill {quill}Visible",
      "\\csname quill\\endcsname Visible",
      "\\@nameuse {quill}Visible",
      "\\@namedef {quill}{Visible}",
      "\\begin {quill}Visible\\end {quill}",
      "\\usepackage [quill]{quill}Visible",
      "\\RequirePackage {quill}[2026/09/27]Visible",
      "\\documentclass [quill]{quill}Visible",
      "\\input {quill}Visible",
      "\\include {quill}Visible",
      "\\label {quill}Visible",
      "\\ref {quill}Visible",
      "\\pageref {quill}Visible",
      "\\hypersetup {quill, linkcolor=quill}Visible",
      "\\pgfkeys {/quill/.code=quill}Visible",
      "\\tikzset {quill/.style={draw=quill}}Visible",
      "\\pgfkeysvalueof {/quill}Visible",
      "\\setbool {quill}{true}Visible",
      "\\ifbool {quill}{Visible}{Visible}",
      "\\newbool {quill}Visible",
      "\\boolean {quill}Visible",
      "\\ifthenelse {\\boolean {quill}}{Visible}{Visible}",
      "\\equal {quill}{quill}Visible",
      "\\fontspec [Scale=quill]{quill}Visible",
      "\\setmainfont {quill}[quill]Visible",
      "\\setsansfont {quill}Visible",
      "\\setmonofont {quill}Visible",
      "\\newfontfamily \\quillfont [quill]{quill}Visible",
      "\\PackageWarning {quill}{quill}Visible",
      "\\PackageError {quill}{quill}{quill}Visible",
      "\\PackageInfo {quill}{quill}Visible",
      "\\ClassWarning {quill}{quill\\MessageBreak quill}Visible",
      "\\ClassError {quill}{quill}{quill}Visible",
      "\\ClassInfo {quill}{quill}Visible",
      "\\typeout {quill}Visible",
      "\\message {quill}Visible",
      "\\wlog {quill}Visible",
      "\\GenericWarning {quill}{quill}Visible",
      "\\@latex@warning {quill}Visible",
      "\\@latex@error {quill}{quill}Visible",
      '\\pgfmathparse {(#1>180?"quill":"quill")}Visible',
      "\\pgfmathsetmacro \\x {quill}Visible",
      // A key of a key list is code, and in an option list's brackets its value too.
      "\\setlist [itemize]{quill=2pt}Visible",
      "\\node [anchor=quill, draw=quill!30, quill sep=1ex, fill={quill}]{Visible}",
    ];
    for (const text of code) {
      expect(letters(text), text).not.toContain("quill");
      expect(letters(text), text).toContain("visible");
    }
    // What a command sets as text is read, and so is a value outside an option list's brackets.
    expect(letters("\\textbf {Quill}\\mbox {Invented}")).toBe("quillinvented");
    expect(letters("\\BeginAccSupp {ActualText=Quill}")).toBe("quill");
  });
});

describe("the request builder, telling the document's own definitions from the tree's", () => {
  test("reads which macros and environments the upload's sources define", () => {
    const source = String.raw`\ProvidesClass{inventedforms}
\newcommand{\cvone}{} \renewcommand*\cvtwo{} \providecommand{\cvthree}{}
\DeclareRobustCommand*{\cvfour}[1]{#1} \newcommandx{\cvfive}[2][1=x]{#1#2}
\def\cvsix#1{#1} \edef\cvseven{x} \long\gdef\cveight{x} \xdef\cvnine{x}
\let\cvten\relax \global\let\cveleven=\relax
\NewDocumentCommand{\cvtwelve}{m}{#1} \RenewDocumentCommand\cvthirteen{m}{#1}
\ProvideDocumentCommand{\cvfourteen}{m}{#1} \DeclareDocumentCommand{\cvfifteen}{m}{#1}
\newenvironment{cvenvone}{}{} \renewenvironment*{cvenvtwo}{}{}
\NewDocumentEnvironment{cvenvthree}{m}{}{} \RenewDocumentEnvironment{cvenvfour}{}{}{}
\DeclareDocumentEnvironment{cvenvfive}{}{}{} \newtcolorbox[auto counter]{cvenvsix}{}
\ExplSyntaxOn
\cs_new:Npn \cv_sixteen:n #1 {#1} \cs_set_protected:Npn \cv_seventeen: {}
\cs_new_protected_nopar:Npx \cv_eighteen: {}
\ExplSyntaxOff
\@namedef{cvnineteen}{x} \expandafter\def\csname cvtwenty\endcsname{x}
% \newcommand{\cvcommented}{}
\expandafter\newcommand\csname cv#1\endcsname{x}
`;
    const owned = ownNames([source]);
    const commands = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
    for (const name of [
      ...commands.map((each) => `cv${each}`),
      ...["cvten", "cveleven", "cvtwelve", "cvthirteen", "cvfourteen", "cvfifteen"],
      ...["cv_sixteen:n", "cv_seventeen:", "cv_eighteen:", "cvnineteen", "cvtwenty"],
      ...["one", "two", "three", "four", "five", "six"].flatMap((each) => [
        `cvenv${each}`,
        `endcvenv${each}`,
      ]),
    ])
      expect(owned.has(name), name).toBe(true);
    // A comment defines nothing, and a name built from an argument is not read: the tree's.
    expect(owned.has("cvcommented")).toBe(false);
    expect([...owned].some((name) => name.includes("#"))).toBe(false);
    // The macros a command hands its work to, as the engine prints them, are its own too.
    expect(isOwn("cvfour ", owned)).toBe(true);
    expect(isOwn("\\cvfive", owned)).toBe(true);
    expect(isOwn("cvtwelve code", owned)).toBe(true);
    expect(isOwn("environment cvenvthree end code", owned)).toBe(true);
    expect(isOwn("faMobile", owned)).toBe(false);
  });

  test("takes the upload's main file and its classes, packages and inputs as its sources", () => {
    const text = (value: string) => strToU8(value);
    const taken: Pick<Intake, "main" | "files"> = {
      main: { path: "cv.tex", text: "\\documentclass{inventedcv}", bytes: text("") },
      files: {
        "inventedcv.cls": text("\\newcommand{\\cvclass}{}"),
        "inventedrows.sty": text("\\newcommand{\\cvstyle}{}"),
        "sections/work.tex": text("\\newcommand{\\cvinput}{}"),
        "inventedcv.def": text("\\newcommand{\\cvdef}{}"),
        "refs.bib": text("@misc{cvbib, title={\\newcommand{\\cvbib}{}}}"),
        "photo.png": new Uint8Array([137, 80, 78, 71]),
      },
    };
    const owned = ownNames(sourcesOf(taken));
    expect([...owned].sort()).toEqual(["cvclass", "cvdef", "cvinput", "cvstyle"]);
    expect(sourcesOf(taken)[0]).toBe("\\documentclass{inventedcv}");
  });

  /**
   * An invented class the person uploaded, holding each of the reviewers' words in its code, and one
   * definition that holds `Page` as text; and invented packages of the tree's that hold each word as
   * public code does, which a class's macro names.
   */
  const OWN_MEANINGS: Record<string, string> = {
    cvfooter: "macro:->\\par \\hfill Page \\thepage \\par ",
    cvcode: [
      "macro:#1->{\\color {white}\\faMobile }\\textcolor {box}{#1}",
      "\\ClassWarning {inventedcv}{Page Link Box White West East Line Xing}",
      "\\PackageInfo {inventedcv}{Mobile Developer, Harbour Square, Full Stack}",
      '\\pgfmathparse {(#1>180?"west":"east")}\\edef \\cv@anchor {\\pgfmathresult }',
      "\\tikz \\node [anchor=west, draw=white, line width=0.3mm]{#1};",
      "\\hypersetup {linkcolor=white}\\label {line}\\setbool {link}{true}",
      "\\href {https://www.xing.com/profile/quillinv}{\\faXingSquare }\\faGithubSquare ",
      "\\cv@public \\faGithub \\ GitHub",
    ].join(""),
    faMobile: "macro:->\\faIcon {mobile}",
    faXingSquare: "macro:->\\faIcon {xing-square}",
    faGithubSquare: "macro:->\\faIcon {github-square}",
    faGithub: "macro:->\\faIcon {github}",
    faIcon: "macro:#1->\\cv@glyph {#1}",
    "cv@glyph": "macro:#1->\\char \\csname cv@code@#1\\endcsname ",
    "cv@public":
      "macro:->Page Link Box White West East Line Xing Developer Mobile Square Harbour Stack Full",
  };

  const OWN_CLASS = String.raw`\ProvidesClass{inventedcv}
\RequirePackage{fontawesome5}
\newcommand{\cvfooter}{\par\hfill Page \thepage\par}
\newcommand{\cvcode}[1]{{\color{white}\faMobile}\textcolor{box}{#1}}
`;

  test("never moves a key of the tree's, and moves an own one only for the text it holds", async () => {
    const found = await signaturesOf(OWN_MEANINGS, {
      cvfooter: template(""),
      cvcode: template("m"),
      faMobile: template(""),
      faGithubSquare: template(""),
    });
    const body = "\\cvfooter \\cvcode{Invented text} \\faMobile \\faGithubSquare\n";
    const tree = treeOf(body, found);
    const sources = [
      `\\documentclass{inventedcv}\n\\begin{document}\n${body}\\end{document}\n`,
      OWN_CLASS,
    ];
    const keys = await keysOf(found);
    const stored = (texts: readonly string[]) => ({
      macros: [],
      candidates: texts.map((text, i) =>
        candidate({ id: `h${i}`, where: "preamble", name: "cvname", text }),
      ),
    });
    const build = (header: HeaderValues, texts: readonly string[] = []) =>
      buildRequest(tree, found, stored(texts), "\\documentclass{inventedcv}\n", {
        header,
        sources,
      });
    const base = await build({ first: "Quill", last: "Invented" });
    const words = ["Page", "Link", "Box", "White", "West", "East", "Line", "Xing"];
    const cases: [string, HeaderValues, readonly string[]][] = [
      ...words.flatMap((word): [string, HeaderValues, readonly string[]][] => [
        [`first name ${word}`, { first: word, last: "Invented" }, []],
        [`last name ${word}`, { first: "Quill", last: word }, []],
        [`stored ${word}`, { first: "Quill", last: "Invented" }, [word]],
      ]),
      ...["Mobile Developer", "Harbour Square", "Full Stack"].flatMap(
        (phrase): [string, HeaderValues, readonly string[]][] => [
          [`headline ${phrase}`, { first: "Quill", last: "Invented", headline: phrase }, []],
          [`location ${phrase}`, { first: "Quill", last: "Invented", location: phrase }, []],
          [`stored ${phrase}`, { first: "Quill", last: "Invented" }, [phrase]],
        ],
      ),
      [
        "a link labelled GitHub",
        {
          first: "Quill",
          last: "Invented",
          links: [{ label: "GitHub", href: "https://github.com/quillinv" }],
        },
        [],
      ],
    ];
    const packaged = [
      "faMobile",
      "faXingSquare",
      "faGithubSquare",
      "faGithub",
      "faIcon",
      "cv@glyph",
    ];
    for (const [label, header, texts] of cases) {
      const request = await build(header, texts);
      // Every definition of the tree's goes as item 4 hashed it, whoever the person is, so that a
      // masked word of it could tell no one who has the package what the person's details hold.
      for (const name of [...packaged, "cv@public"]) {
        const macro = found.macros[name];
        expect(textOf(request, name), `${label}: ${name}`).toBe(
          macro?.kind === "data" ? undefined : macro?.meaning,
        );
      }
      for (const name of ["faMobile", "faGithubSquare"])
        expect(macroOf(request, name)?.key, `${label}: ${name}`).toBe(keys[name]);
      // An own definition that holds a word only in its code keeps its key.
      expect(macroOf(request, "cvcode")?.key, label).toBe(macroOf(base, "cvcode")?.key);
      // The one that holds `Page` as text moves for a person whose name is Page, and only then.
      const page = header.first === "Page" || header.last === "Page";
      expect(macroOf(request, "cvfooter")?.key === macroOf(base, "cvfooter")?.key, label).toBe(
        !page,
      );
      if (page)
        expect(textOf(request, "cvfooter")).toBe("macro:->\\par \\hfill Xxxx \\thepage \\par ");
    }
    expect(macroOf(base, "cvcode")?.key).toBe(keys.cvcode);
    expect(macroOf(base, "cvfooter")?.key).toBe(keys.cvfooter);
    const owned = ownNames(sources);
    for (const name of [...packaged, "cv@public"]) expect(isOwn(name, owned), name).toBe(false);
    for (const name of ["cvcode", "cvfooter"]) expect(isOwn(name, owned), name).toBe(true);
  });
});

describe("the request builder, masking the document's own definitions", () => {
  test("masks each pair of an own definition's words that a longer text of the body holds", async () => {
    const found = await signaturesOf(
      {
        cvsign: "macro:#1->{\\Large Quill Invented}#1",
        cvfirm: "macro:#1->\\textbf {Larkspur Labs}#1",
        cvtitle: "macro:->\\textbf {Senior Typesetter at Larkspur Labs}",
        cvword: "macro:#1->\\textbf {Larkspur}#1",
      },
      {
        cvsign: template("m"),
        cvfirm: template("m"),
        cvtitle: template(""),
        cvword: template("m"),
      },
    );
    const body = String.raw`\cvsign{} \cvfirm{} \cvtitle \cvword{}

Quill Invented, typesetter at Larkspur Labs in Harbour City.
`;
    const tree = treeOf(body, found);
    const sources = [
      String.raw`\documentclass{article}
\newcommand{\cvsign}[1]{{\Large Quill Invented}#1}
\newcommand{\cvfirm}[1]{\textbf{Larkspur Labs}#1}
\newcommand{\cvtitle}{\textbf{Senior Typesetter at Larkspur Labs}}
\newcommand{\cvword}[1]{\textbf{Larkspur}#1}
\begin{document}${body}\end{document}`,
    ];
    const request = await buildRequest(tree, found, NO_PROBE, "\\documentclass{article}\n", {
      sources,
    });
    expect(textOf(request, "cvsign")).toBe("macro:#1->{\\Large Xxxxx Xxxxxxxx}#1");
    expect(textOf(request, "cvfirm")).toBe("macro:#1->\\textbf {Xxxxxxxx Xxxx}#1");
    expect(textOf(request, "cvtitle")).toBe(
      "macro:->\\textbf {Senior Xxxxxxxxxx xx Xxxxxxxx Xxxx}",
    );
    // A single word of the body's is no needle.
    expect(textOf(request, "cvword")).toBe("macro:#1->\\textbf {Larkspur}#1");
    expect(await checkRequest(request)).toEqual([]);
  });

  test("masks identifiers, but never a link's label, a stored text's word or the body's", async () => {
    const found = await signaturesOf(
      {
        cvsite: "macro:#1->\\textbf {quill.example}#1",
        cvhandle: "macro:#1->\\texttt {@quillinv}#1",
        cvmail: "macro:#1->\\texttt {wren{@}quill.example}#1",
        cvcall: "macro:#1->+44\\, 20\\, 7946\\, 0000#1",
        cvlabel: "macro:#1->\\faGithub \\ GitHub #1",
        cvstored: "macro:#1->\\textbf {Quill}#1",
        cvbody: "macro:#1->\\textbf {Larkspur}#1",
      },
      Object.fromEntries(
        ["cvsite", "cvhandle", "cvmail", "cvcall", "cvlabel", "cvstored", "cvbody"].map((name) => [
          name,
          template("m"),
        ]),
      ),
    );
    const body = String.raw`\cvsite{} \cvhandle{} \cvmail{} \cvcall{} \cvlabel{} \cvstored{} \cvbody{Larkspur}
`;
    const tree = treeOf(body, found);
    const sources = [
      Object.keys(found.commands)
        .map((name) => `\\newcommand{\\${name}}[1]{#1}`)
        .join("\n"),
    ];
    const header: HeaderValues = {
      links: [
        { label: "Portfolio", href: "https://quill.example" },
        { label: "GitHub", href: "https://github.com/quillinv" },
        { label: "Mail", href: "mailto:wren@quill.example" },
        { label: "Call", href: "tel:+44-20-7946-0000" },
      ],
    };
    const probed = {
      macros: [],
      candidates: [candidate({ id: "h1", where: "preamble", name: "cvname", text: "Quill" })],
    };
    const request = await buildRequest(tree, found, probed, "\\documentclass{article}\n", {
      header,
      sources,
    });
    expect(textOf(request, "cvsite")).toBe("macro:#1->\\textbf {xxxxx.xxxxxxx}#1");
    expect(textOf(request, "cvhandle")).toBe("macro:#1->\\texttt {@xxxxxxxx}#1");
    expect(textOf(request, "cvmail")).toBe("macro:#1->\\texttt {xxxx{@}xxxxx.xxxxxxx}#1");
    expect(textOf(request, "cvcall")).toBe("macro:#1->+00\\, 00\\, 0000\\, 0000#1");
    expect(textOf(request, "cvlabel")).toBe("macro:#1->\\faGithub \\ GitHub #1");
    expect(textOf(request, "cvstored")).toBe("macro:#1->\\textbf {Quill}#1");
    expect(textOf(request, "cvbody")).toBe("macro:#1->\\textbf {Larkspur}#1");
    const document = { tree, header, stored: ["Quill"], sources };
    // The check is stricter than the masking, on purpose: the stored word and the body's are found.
    expect(checked(request, document)).toMatch(/\((?:stored|text)\) in the definition of cv/);
  });
});

describe("the request builder, sending signatures", () => {
  test("writes each default of a signature as its placeholder", () => {
    expect(maskedSignature("O{Quill Invented} m", placeholder)).toBe("O{Xxxxx Xxxxxxxx} m");
    expect(maskedSignature("D<>{+44 20 7946 0000} m", placeholder)).toBe("D<>{+00 00 0000 0000} m");
    expect(
      maskedSignature("G{Quill} R(){Invented} E{^_}{{Quill}{Wren}} t+ d() r<> s o m", placeholder),
    ).toBe("G{Xxxxx} R(){Xxxxxxxx} E{^_}{{Xxxxx}{Xxxx}} t+ d() r<> s o m");
    expect(maskedSignature("D\\cvopen\\cvclose{Quill} u{Quill} m", placeholder)).toBe(
      "D\\cvopen\\cvclose{Xxxxx} u{Quill} m",
    );
    expect(maskedSignature("m o s", placeholder)).toBe("m o s");
  });

  test("sends a signature's defaults as placeholders, and the check reads signatures", async () => {
    const meaning = "macro:#1#2->#1 #2";
    const found = await signaturesOf(
      { cvmail: meaning, cvphone: meaning, cvsign: meaning, cvglyph: meaning },
      {
        cvmail: template("O{quill@example.invalid} m"),
        cvphone: template("D<>{+44 20 7946 0000} m"),
        cvsign: template("O{Quill Invented} m"),
        cvglyph: template("s O{\\str_use:N\\l_invented_style_str} m"),
      },
    );
    const body = "\\cvmail{Xy} \\cvphone{Xy} \\cvsign{Xy} \\cvglyph{Xy} \\textbf{Larkspur}\n";
    const tree = treeOf(body, found);
    const request = await buildRequest(tree, found, NO_PROBE, "\\documentclass{article}\n", {
      header: HEADER,
    });
    expect(macroOf(request, "cvsign")?.signature).toBe("O{Xxxxx Xxxxxxxx} m");
    expect(macroOf(request, "cvglyph")?.signature).toMatch(/^s O\{\\xxx_xxx:X\\[lx]_[x_]+\} m$/);
    const keys = await keysOf(found);
    for (const macro of request.macros) {
      const signature = macro.signature ?? "";
      expect(signature.toLowerCase(), macro.name).not.toMatch(/quill|invented|7946|str_use/);
      for (const inner of signature.match(/\{[^{}]*\}/g) ?? [])
        expect(holdsText(inner), `${macro.name}: ${inner}`).toBe(false);
      // A signature takes no part in a key.
      expect(macro.key, macro.name).toBe(keys[macro.name]);
    }
    expect(macroOf(request, "cvmail")?.signature).toMatch(/^O\{<xxxxx_+>\} m$/);
    expect(macroOf(request, "cvphone")?.signature).toMatch(/^D<>\{<xxxxx_+>\} m$/);
    const document = { tree, header: HEADER };
    expect(checked(request, document)).toBe("passes");
    const leaked = structuredClone(request);
    const sign = leaked.macros.find((each) => each.name === "cvsign");
    if (sign !== undefined) sign.signature = "O{Larkspur} m";
    expect(checked(leaked, document)).toMatch(/\(text\) in the signature of cvsign/);
  });
});

describe("the leak check", () => {
  /** An invented document with the reviewers' shapes of text, and a class of its own. */
  const MEANINGS_CHECKED: Record<string, string> = {
    cvrole: "macro:#1#2->\\textbf {#1}\\hfill #2\\par ",
    cvpage: "macro:->\\hfill \\thepage ",
  };
  const BODY_CHECKED = String.raw`
\begin{center}
\textsc{Wrenfield} \\
+44 20 7946 0000 $|$ quillinv
\end{center}
\cvrole{Invented Role}{Larkspur}
\cvrole{Typesetter}{2019-09 -- 2021-06}
\cvpage
`;

  test("finds any text of the document's in a call site or an own definition, single words too", async () => {
    const found = await signaturesOf(MEANINGS_CHECKED, {
      cvrole: template("m m"),
      cvpage: template(""),
    });
    const tree = treeOf(BODY_CHECKED, found);
    // `\cvrole` is the document's own; `\cvpage` an invented package's of the tree's.
    const sources = [String.raw`\newcommand{\cvrole}[2]{\textbf{#1}\hfill #2\par}`];
    const request = await buildRequest(tree, found, NO_PROBE, "\\documentclass{article}\n", {
      sources,
    });
    const document = { tree, sources };
    expect(checked(request, document)).toBe("passes");
    const planted = (where: "site" | "own" | "tree", text: string) => {
      const changed = structuredClone(request);
      if (where === "site") {
        const site = changed.macros.find((each) => each.name === "cvrole")?.sites[0];
        if (site !== undefined) site.arguments[0] = text;
      } else {
        const name = where === "own" ? "cvrole" : "cvpage";
        const definition = changed.definitions.find((each) => each.name === name);
        if (definition?.kind === "definition") definition.text += ` ${text}`;
      }
      return checked(changed, document);
    };
    const shapes = ["Wrenfield", "+44 20 7946 0000", "quillinv", "Larkspur", "Typesetter"];
    for (const text of [...shapes, "2019-09 -- 2021-06"])
      for (const where of ["site", "own"] as const)
        expect(planted(where, text), `${text} in ${where}`).toMatch(/holds the document's text/);
    // In public code, a single word of the body's is no leak; a phrase or an identifier is.
    expect(planted("tree", "Larkspur")).toBe("passes");
    expect(planted("tree", "{Invented Role}")).toMatch(/\(text\) in the definition of cvpage/);
    expect(planted("tree", "+44\\, 20\\, 7946\\, 0000")).toMatch(/in the definition of cvpage/);
  });
});

describe("the request builder, placing redefinitions", () => {
  const MAIN = String.raw`\documentclass{article}
% \begin{document} in a comment
\usepackage{xspace}
\begin{document}
Invented text\xspace here.
\end{document}
`;
  const REDEFINITIONS = [
    { name: "xspace", latex: String.raw`\renewcommand{\xspace}{ }` },
    { name: "xspace", latex: String.raw`\renewcommand{\xspace}{}` },
  ];

  test("puts them after the class, or right before the document", () => {
    expect(withRedefinitions(MAIN, REDEFINITIONS)).toBe(
      MAIN.replace("{article}\n", "{article}\n\\renewcommand{\\xspace}{ }\n\n"),
    );
    expect(withRedefinitions(MAIN, REDEFINITIONS, { placement: "class" })).toBe(
      withRedefinitions(MAIN, REDEFINITIONS),
    );
    expect(documentStart(MAIN)).toBe(MAIN.indexOf("\\begin{document}\nInvented"));
    expect(withRedefinitions(MAIN, REDEFINITIONS, { placement: "preamble" })).toBe(
      MAIN.replace(
        "\\begin{document}\nInvented",
        "\\renewcommand{\\xspace}{ }\n\\begin{document}\nInvented",
      ),
    );
    expect(
      withRedefinitions("\\documentclass{article}\n", REDEFINITIONS, { placement: "preamble" }),
    ).toBeUndefined();
    expect(withRedefinitions(MAIN, [], { placement: "preamble" })).toBe(MAIN);
  });
});

test("grows with the body, as its calls and texts do", async () => {
  const found = await inventedSignatures();
  const body = (calls: number) =>
    Array.from(
      { length: calls },
      (_, i) => `\\cventry{Invented role ${i}}{Invented place ${i}}{20${10 + (i % 10)}}\n`,
    ).join("");
  const run = (calls: number) => {
    const tree = treeOf(body(calls), found);
    return async () => {
      await buildRequest(tree, found, PROBE, PREAMBLE, { header: HEADER, sources: SOURCES });
    };
  };
  const [tenth = 0, whole = 0] = await fastestAsync([run(200), run(2000)], 5);
  // Ten times the calls, and their texts, cost about ten times as much.
  expect(whole).toBeLessThan(bound(50, tenth));
}, 60_000);

describe.skipIf(!engineAvailable())("the request builder, on the engine", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  let tree: ReturnType<typeof readTree>;
  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    tree = readTree(manifest.files, manifest.fonts);
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
  }, 60_000);

  /**
   * An invented class whose macros the probe's own tests use, and a header's setter; one that holds
   * the person's name as text, and takes a parameter, so that it is code, not data; and one that
   * holds their surname as a colour's name and in a warning, both code.
   */
  const CLASS = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{inventedprobe}[2026/09/27 an invented class for the naming step's tests]
\LoadClass{article}
\RequirePackage[hidelinks]{hyperref}
\RequirePackage{xcolor}
\definecolor{invented}{HTML}{1F4E79}
\newcommand{\cvname}[2]{\def\@cvfirst{#1}\def\@cvlast{#2}}
\newcommand{\cvheader}{{\Large\@cvfirst\ \@cvlast}\par}
\newcommand{\cvplain}[1]{\textbf{#1}\par}
\newcommand{\cvmail}[1]{\href{mailto:#1}{#1}\par}
\newcommand{\cvgap}[1]{\hspace{#1}Invented gap\par}
\newcommand{\cventry}[3]{\textbf{#1}\hfill\textit{#3}\par #2\par}
\newcommand{\cvsign}[1]{\par\textit{Signed, Quill Invented}#1\par}
\newcommand{\cvrule}{{\color{invented}\rule{\linewidth}{0.4pt}}\ClassWarning{inventedprobe}{Invented rule drawn}\par}
\newenvironment{cvitems}{\begin{itemize}}{\end{itemize}}
`;

  const BODY = String.raw`\begin{document}
\cvheader
\cvplain{Invented plain words}
\cvmail{quill@example.invalid}
\cventry{Invented Role}{Larkspur Labs, Harbour City}{June 2020 -- Present}
\begin{cvitems}
\item Built the invented typesetter.
\end{cvitems}
\cvgap{2em}
\cvsign{}
\cvrule
\end{document}
`;

  /** An invented upload through the whole pipeline to the request, and what it was built from. */
  async function requested(main: string) {
    const zipped = { "cv.tex": strToU8(main), "inventedprobe.cls": strToU8(CLASS) };
    const taken = intake({ name: "invented.zip", bytes: zipSync(zipped) }, { tree });
    if (isRefusal(taken)) throw new Error(`refused at intake: ${taken.message}`);
    const made = await reference(session, fonts, taken as Intake);
    if (isRefusal(made)) throw new Error(`refused: ${made.message}`);
    const body = bodyOf(taken);
    if (isRefusal(body)) throw new Error(body.message);
    const read = readBody(body);
    if (isRefusal(read)) throw new Error(read.message);
    const preamble = readBody(bodyOfText(body.preamble));
    const found = await signatures(
      session,
      taken,
      made,
      body,
      probeUses(read, isRefusal(preamble) ? undefined : preamble),
    );
    if (isRefusal(found)) throw new Error("no signatures");
    const built: Tree | ReturnType<typeof buildTree> = buildTree(read, found);
    if (isRefusal(built)) throw new Error(built.message);
    const probed = await probe(session, fonts, taken, made, built, found);
    if (probed.format !== undefined) session.dropFormat("pdftex", probed.format);
    const header = { first: "Quill", last: "Invented", email: "quill@example.invalid" };
    const sources = sourcesOf(taken);
    const request = await buildRequest(built, found, probed, body.preamble, { header, sources });
    const stored = probed.candidates
      .filter((each) => each.where === "preamble")
      .map((each) => each.text);
    return { request, found, document: { tree: built, header, stored, sources } };
  }

  /** What an end-to-end request must be: valid, keyed as item 4 keys, and holding no text. */
  async function check(main: string, engine: "pdftex" | "xetex") {
    const { request, found, document } = await requested(main);
    expect(request.engine).toBe(engine);
    expect(await checkRequest(request)).toEqual([]);
    expect(checked(request, document)).toBe("passes");
    const keys = await keysOf(found);
    // The class's own macros that hold none of the person's text keep item 4's keys: the surname
    // `\cvrule` holds as a colour's name and in a warning is code, and no text of theirs.
    for (const name of ["cvheader", "cvplain", "cvmail", "cventry", "cvname", "cvrule"])
      expect(request.macros.find((macro) => macro.name === name)?.key, name).toBe(keys[name]);
    const rule = found.macros.cvrule;
    expect(textOf(request, "cvrule")).toBe(rule?.kind === "data" ? undefined : rule?.meaning);
    // The one that holds the person's name as text is masked, and its key is the document's own.
    expect(request.macros.find((macro) => macro.name === "cvsign")?.key).not.toBe(keys.cvsign);
    expect(textOf(request, "cvsign")).toMatch(/Signed, Xxxxx Xxxxxxxx/);
    const byName = (name: string) => request.macros.find((macro) => macro.name === name);
    expect(byName("cvname")?.sites).toEqual([{ arguments: ["Xxxxx", "Xxxxxxxx"] }]);
    expect(byName("cvplain")?.arguments).toEqual([
      { index: 1, kind: "mandatory", verdict: "editable" },
    ]);
    expect(byName("cvmail")?.arguments[0]?.verdict).toBe("twice");
    expect(byName("cvgap")?.arguments[0]?.verdict).toBe("breaks");
    expect(byName("cventry")?.sites[0]?.arguments).toEqual([
      "Xxxxxxxx Xxxx",
      "Xxxxxxxx Xxxx, Xxxxxxx Xxxx",
      "0000-00 -- xxxxxxx",
    ]);
    expect(byName("cvitems")).toMatchObject({ of: "environment", calls: 1 });
    expect(byName("cvitems")?.dependencies[0]).toBe("endcvitems");
    expect(byName("cvitems")?.sites[0]?.body).toBe("\\item Xxxxx xxx xxxxxxxx xxxxxxxxxx.");
    expect(request.preamble.class).toEqual({ name: "xxxxxxxxxxxxx", options: [] });
    return request;
  }

  test("builds a request end to end on an invented pdfTeX document", async () => {
    await check(`\\documentclass{inventedprobe}\n\\cvname{Quill}{Invented}\n${BODY}`, "pdftex");
  }, 60_000);

  test("builds a request end to end on an invented XeTeX document", async () => {
    const request = await check(
      `\\documentclass{inventedprobe}\n\\usepackage{fontspec}\n\\cvname{Quill}{Invented}\n${BODY}`,
      "xetex",
    );
    expect(request.preamble.settings).toContain("\\usepackage{fontspec}");
  }, 60_000);

  test("redefines a package's macro before the document, where after the class it stops", async () => {
    const main = String.raw`\documentclass{article}
\usepackage{xspace}
\begin{document}
Invented text\xspace here.
\end{document}
`;
    const redefinitions = [{ name: "xspace", latex: String.raw`\renewcommand{\xspace}{ }` }];
    const compiles = async (text: string | undefined) => {
      if (text === undefined) throw new Error("no place for the redefinitions");
      const taken = intake({ name: "invented.tex", bytes: strToU8(text) }, { tree });
      if (isRefusal(taken)) throw new Error(taken.message);
      return !isRefusal(await reference(session, fonts, taken as Intake));
    };
    expect(await compiles(main)).toBe(true);
    expect(await compiles(withRedefinitions(main, redefinitions, { placement: "class" }))).toBe(
      false,
    );
    expect(await compiles(withRedefinitions(main, redefinitions, { placement: "preamble" }))).toBe(
      true,
    );
  }, 60_000);
});
