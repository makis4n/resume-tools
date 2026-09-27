import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkRequest,
  holdsText,
  NAMING_VERSION,
  type NamingRequest,
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
  type HeaderValues,
  visibleOfMeaning,
  visibleOfSource,
} from "./naming";
import { bodyOf, bodyOfText, buildTree, parseBody, readBody, type Tree } from "./parse";
import { type Aggregate, type ProbeCandidate, probe, probeUses } from "./probe";
import { reference } from "./reference";
import { isRefusal } from "./refusal";
import { closure, type EngineSignatures, keysOf, masked, signatures } from "./signatures";

// Every template, document, name and address here is invented for these tests; nothing is taken
// from a real resume. Quill Invented is the person, and their details are invented too.

const HEADER: HeaderValues = {
  first: "Quill",
  last: "Invented",
  email: "quill@example.invalid",
  phone: "+44 20 7946 0000",
  location: "Harbour City",
  links: [{ label: "quill.example", href: "https://quill.example" }],
};

/**
 * An invented template's macros as the engine would print them, masked by pattern as item 4 masks
 * them: an entry, a row it hands its work to, a setter and the header it stores, a list, and five
 * a person's own preamble wrote holding their name and details the way item 4's verifier found
 * them hidden from the patterns: in `\Large`, `\textcolor` and `\mbox`, a bare domain, and a
 * phone written with `\,`.
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

/** The invented template's signatures, as `signatures` gives them, with each macro's closure. */
async function inventedSignatures(): Promise<EngineSignatures> {
  const meanings = new Map(Object.entries(MEANINGS).map(([name, text]) => [name, masked(text)]));
  const macros: EngineSignatures["macros"] = {};
  for (const [name, meaning] of meanings)
    macros[name] = {
      meaning,
      hash: await sha256(meaning),
      ...closure(name, meanings, new Set(DATA)),
    };
  for (const name of DATA) macros[name] = { kind: "data", length: 5 };
  const command = (spec: string) => ({ kind: "template" as const, spec, how: "meaning" as const });
  return {
    engine: "pdftex",
    commands: {
      cventry: command("m m m o"),
      cvname: command("m m"),
      cvheader: command(""),
      cvsection: command("m"),
      cvsign: command("m"),
      cvcolour: command("m"),
      cvbox: command("m"),
      cvsite: command("m"),
      cvphone: command("m"),
      Quill: { kind: "undefined", how: "unresolved", why: "undefined" },
    },
    environments: { cvlist: command("") },
    macros,
    truncated: false,
    ms: 0,
  };
}

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

async function invented(header: HeaderValues | undefined = HEADER) {
  const found = await inventedSignatures();
  const tree = parseBody(bodyOfText(BODY), found);
  if (isRefusal(tree)) throw new Error(tree.message);
  const request = await buildRequest(
    tree,
    found,
    PROBE,
    PREAMBLE,
    header === undefined ? {} : { header },
  );
  const document = {
    tree,
    ...(header === undefined ? {} : { header }),
    stored: PROBE.candidates.map((each) => each.text),
  };
  return { found, tree, request, document };
}

const macroOf = (request: NamingRequest, name: string) =>
  request.macros.find((macro) => macro.name === name);
const definitionOf = (request: NamingRequest, name: string) =>
  request.definitions.find((definition) => definition.name === name);

/** Every text a request holds that the model reads: definitions, call sites, settings. */
function textsOf(request: NamingRequest): string[] {
  return [
    ...request.definitions.flatMap((each) => (each.kind === "definition" ? [each.text] : [])),
    ...request.macros.flatMap((macro) =>
      macro.sites.flatMap((site) => [
        ...site.arguments.flatMap((each) => (each === null ? [] : [each])),
        ...(site.body === undefined ? [] : [site.body]),
      ]),
    ),
    ...request.preamble.settings,
    ...(request.preamble.class === undefined
      ? []
      : [request.preamble.class.name, ...request.preamble.class.options]),
  ];
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

  test("masks what the patterns miss in a definition by the document's own values, and nothing else", async () => {
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
    expect(definitionOf(request, "cvsign")).toMatchObject({
      text: "macro:#1->{\\Large Xxxxx Xxxxxxxx}#1",
    });
    expect(definitionOf(request, "cvbox")).toMatchObject({
      text: "macro:#1->\\mbox {Xxxxx}\\mbox {Xxxxxxxx}#1",
    });
    expect(definitionOf(request, "cvphone")).toMatchObject({
      text: "macro:#1->+00\\, 00\\, 0000\\, 0000#1",
    });
    // The template's own definitions go as item 4 hashed them, so their keys are item 4's, and
    // `bottom` is no first name's word.
    const keys = await keysOf(found);
    for (const name of ["cventry", "cvsection", "cvheader", "cvname"]) {
      const macro = found.macros[name];
      const definition = definitionOf(request, name);
      expect(definition?.kind === "definition" && definition.text).toBe(
        macro?.kind === "data" ? undefined : macro?.meaning,
      );
      expect(macroOf(request, name)?.key, name).toBe(keys[name]);
    }
    expect(definitionOf(request, "bottomline")).toMatchObject({ text: MEANINGS.bottomline });
    expect(await checkRequest(request)).toEqual([]);
    // Nothing the model reads holds any of the person's details, in any case.
    const everything = textsOf(request).join("\n").toLowerCase();
    for (const text of ["quill", "invented", "harbour", "example.invalid", "7946", "larkspur"])
      expect(everything.includes(text), text).toBe(false);
  });

  test("masks the preamble's settings but for numbers, lengths, colours and keywords", async () => {
    const { request } = await invented();
    expect(request.preamble).toEqual({
      class: { name: "xxxxxxxxxx", options: ["11pt", "a4paper"] },
      settings: [
        "\\usepackage[margin=0.5in, top=1cm]{geometry}",
        "\\definecolor{xxxxxblue}{HTML}{1F4E79}",
        "\\setlength{\\parskip}{2pt}",
      ],
    });
  });

  test("passes the leak check, which finds the person's text wherever a request would hold it", async () => {
    const { request, document } = await invented();
    expect(() => assertNoText(request, document)).not.toThrow();
    const leaks: [string, (request: NamingRequest) => void][] = [
      [
        "a definition",
        (changed) => {
          const definition = changed.definitions.find((each) => each.name === "cv@row");
          if (definition?.kind === "definition") definition.text += "\\mbox {Quill}";
        },
      ],
      [
        "a call site",
        (changed) => {
          const site = changed.macros.find((each) => each.name === "cvsection")?.sites[0];
          if (site !== undefined) site.arguments[0] = "Harbour City";
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
        "a raw chunk",
        (changed) => {
          const definition = changed.definitions.find((each) => each.name === "cventry");
          if (definition?.kind === "definition")
            definition.text += "\\texttt {quill@example.invalid}";
        },
      ],
      [
        "a link's address",
        (changed) => {
          changed.preamble.settings.push("https://quill.example/type");
        },
      ],
      [
        "a text run",
        (changed) => {
          changed.preamble.settings.push("{Larkspur Labs}");
        },
      ],
      [
        "the class's name",
        (changed) => {
          if (changed.preamble.class !== undefined) changed.preamble.class.name = "quillcv";
        },
      ],
    ];
    for (const [where, leak] of leaks) {
      const changed = structuredClone(request);
      leak(changed);
      expect(() => assertNoText(changed, document), where).toThrow(/holds the document's text/);
      // The message names the kind of text and where, never the text.
      try {
        assertNoText(changed, document);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        for (const text of ["Quill", "Harbour", "quill.example", "Larkspur", "2019"])
          expect(message.includes(text), `${where}: ${message}`).toBe(false);
      }
    }
  });

  test("finds a short name only as a word in a definition, but anywhere in a setting", async () => {
    const found = await inventedSignatures();
    const tree = parseBody(bodyOfText(BODY), found);
    if (isRefusal(tree)) throw new Error(tree.message);
    const header: HeaderValues = { first: "Tom", last: "Lee" };
    const request = await buildRequest(tree, found, { macros: [], candidates: [] }, PREAMBLE, {
      header,
    });
    // `bottom` in the invented `\bottomline` keeps its letters: Tom is no word of it.
    expect(definitionOf(request, "bottomline")).toMatchObject({ text: MEANINGS.bottomline });
    expect(() => assertNoText(request, { tree, header })).not.toThrow();
    const withTom = structuredClone(request);
    const definition = withTom.definitions.find((each) => each.name === "bottomline");
    if (definition?.kind === "definition") definition.text += " Tom";
    expect(() => assertNoText(withTom, { tree, header })).toThrow(/header/);
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
  });

  test("grows with the body, as its calls and texts do", async () => {
    const found = await inventedSignatures();
    const body = (calls: number) =>
      Array.from(
        { length: calls },
        (_, i) => `\\cventry{Invented role ${i}}{Invented place ${i}}{20${10 + (i % 10)}}\n`,
      ).join("");
    const run = (calls: number) => {
      const tree = parseBody(bodyOfText(body(calls)), found);
      if (isRefusal(tree)) throw new Error(tree.message);
      return async () => {
        await buildRequest(tree, found, PROBE, PREAMBLE, { header: HEADER });
      };
    };
    const [tenth = 0, whole = 0] = await fastestAsync([run(200), run(2000)], 5);
    // Ten times the calls, and their texts, cost about ten times as much.
    expect(whole).toBeLessThan(bound(50, tenth));
  }, 60_000);
});

describe.skipIf(!engineAvailable())("the request builder, on the engine", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  let tree: ReturnType<typeof readTree>;
  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    tree = readTree(manifest.files);
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
  }, 60_000);

  /** An invented class whose macros the probe's own tests use, and a header's setter. */
  const CLASS = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{inventedprobe}[2026/09/27 an invented class for the naming step's tests]
\LoadClass{article}
\RequirePackage[hidelinks]{hyperref}
\newcommand{\cvname}[2]{\def\@cvfirst{#1}\def\@cvlast{#2}}
\newcommand{\cvheader}{{\Large\@cvfirst\ \@cvlast}\par}
\newcommand{\cvplain}[1]{\textbf{#1}\par}
\newcommand{\cvmail}[1]{\href{mailto:#1}{#1}\par}
\newcommand{\cvgap}[1]{\hspace{#1}Invented gap\par}
\newcommand{\cventry}[3]{\textbf{#1}\hfill\textit{#3}\par #2\par}
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
    const header = { first: "Quill", last: "Invented", email: "quill@example.invalid" };
    const request = await buildRequest(built, found, probed, body.preamble, { header });
    const stored = probed.candidates
      .filter((each) => each.where === "preamble")
      .map((each) => each.text);
    return { request, found, document: { tree: built, header, stored } };
  }

  /** What an end-to-end request must be: valid, keyed as item 4 keys, and holding no text. */
  async function check(main: string, engine: "pdftex" | "xetex") {
    const { request, found, document } = await requested(main);
    expect(request.engine).toBe(engine);
    expect(await checkRequest(request)).toEqual([]);
    expect(() => assertNoText(request, document)).not.toThrow();
    const keys = await keysOf(found);
    for (const name of ["cvheader", "cvplain", "cvmail", "cventry", "cvname"])
      expect(request.macros.find((macro) => macro.name === name)?.key, name).toBe(keys[name]);
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
});
