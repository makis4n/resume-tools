import { LINK_KINDS, SECTION_ROLES } from "@resume-tools/resume-model";
import { describe, expect, test } from "vitest";
import {
  BLANKS,
  CONTACT_FIELDS,
  HOLDS,
  MACRO_KINDS,
  MEANINGS,
  SLOTS,
  STYLE_PARAMETERS,
} from "./answer";
import { inventedRequest } from "./invented";
import { PROMPT_HASH, sha256 } from "./key";
import {
  askedOf,
  commandsOf,
  definitionOrder,
  INSTRUCTIONS,
  layOut,
  measure,
  retryText,
} from "./prompt";
import { ARGUMENT_KINDS, NamingRequest, VERDICTS } from "./request";

// The template, its macros and its calls here are invented; nothing is anyone's.

/**
 * The commands the prompt may write: `\begin` and `\end`, and the macros it names as examples.
 * Anything else it wrote would be LaTeX of its own, which the contract's package never holds.
 */
const EXAMPLES = new Set([
  "begin",
  "end",
  "@firstname",
  "resumeItemListStart",
  "resumeItemListEnd",
  "resumeSubheading",
]);

/**
 * A request with a signature whose default holds text, as a request the schema would refuse but a
 * caller might still pass: `layOut` is safe on its own, whatever the request's builder did.
 */
function withDefault(request: NamingRequest, name: string, signature: string): NamingRequest {
  return {
    ...request,
    macros: request.macros.map((macro) => (macro.name === name ? { ...macro, signature } : macro)),
  };
}

describe("the instructions", () => {
  test("hold no LaTeX but the contract's names: no backslash but before an example's name", () => {
    const names = [...INSTRUCTIONS.matchAll(/\\([A-Za-z@]*)/g)].map((found) => found[1] ?? "");
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(EXAMPLES.has(name), name).toBe(true);
  });

  test("name every word the answer's lists hold, so that the prompt and the schema agree", () => {
    const lists = {
      MACRO_KINDS,
      MEANINGS,
      SLOTS,
      BLANKS,
      HOLDS,
      CONTACT_FIELDS,
      STYLE_PARAMETERS,
      SECTION_ROLES,
      LINK_KINDS,
      VERDICTS,
      ARGUMENT_KINDS,
    };
    for (const [list, words] of Object.entries(lists))
      for (const word of words) expect(INSTRUCTIONS, `${list}: ${word}`).toContain(`\`${word}\``);
  });

  test("say that the model never writes LaTeX, and what a redefinition is", () => {
    expect(INSTRUCTIONS).toContain("You never write LaTeX.");
    expect(INSTRUCTIONS).toContain("keeps upstream's output");
    expect(INSTRUCTIONS).toContain("never invent LaTeX");
  });
});

describe("a request laid out", () => {
  test("gives each macro its heading, signature, definition, dependencies, verdicts and calls", async () => {
    const request = await inventedRequest();
    const text = layOut(request);
    expect(
      text.startsWith(
        [
          "A template for the pdfTeX engine, which its class or its macros say is Jake's Resume or a fork of it.",
          'The template\'s commands, one of which a list\'s `closedBy` or `openedBy` names: "cvname", "cvheader", "cvsection", "cventry".',
        ].join("\n\n"),
      ),
    ).toBe(true);
    expect(text).toContain(
      [
        '### command "cventry"',
        "Signature: #1 mandatory, #2 mandatory, #3 optional with no default.",
        "The document calls it 3 times.",
        "Its own definition:",
        "macro:#1#2#3->\\cv@row {#1}{#3}\\par \\cv@style {#2}",
        'It hands its work to "cv@row", "cv@style".',
        "What the probe found of each argument:",
        "#1, mandatory: editable",
        "#2, mandatory: moved",
        "#3, optional: editable; its empty calls: moved",
        "Call 1:",
        "#1 {Xxxxxxxx Xxxx}",
        "#2 {0000-00 -- xxxxxxx}",
        "#3 not given",
        "Call 2:",
        "#1 {\\textbf{Xxxx} $|$ \\emph{Xxxxx}}",
        "#2 {0000}",
        "#3 [Xxxxxx, XX]",
      ].join("\n"),
    );
    expect(text).toContain(
      [
        '### environment "cvitems"',
        "Signature: it takes no arguments.",
        "The document opens it once.",
        "Its own definition, its begin code:",
        "macro:->\\begin {itemize}\\setlength \\itemsep {0pt}",
        'It hands its work to "endcvitems", the first its end code.',
        "Call 1:",
        "Its body begins: \\item Xxxxx xxx xxxxxxxx xxxxxxxxxx.",
      ].join("\n"),
    );
    // A definition that holds the person's data goes by its name alone.
    expect(text).toContain(`Definition "@firstname": holds the person's data, which is not sent.`);
    expect(text).toContain(
      [
        "## The preamble's settings, numbered from 0",
        'The class: "xxxxxxxxxx", with the options 11pt, a4paper.',
        "[0] \\usepackage[margin=0.5in, top=1cm]{geometry}",
        "[1] \\definecolor{accent}{HTML}{1F4E79}",
        "[2] \\setlength{\\parskip}{2pt}",
      ].join("\n"),
    );
  });

  test("lays a signature out by its arguments' kinds, and never a default's text", async () => {
    const request = withDefault(await inventedRequest(), "cventry", "m m O{Quill Inventedsurname}");
    const text = layOut(request);
    expect(text).toContain(
      '### command "cventry"\nSignature: #1 mandatory, #2 mandatory, #3 optional with a default.',
    );
    for (const leak of ["Quill", "Inventedsurname", "O{"]) expect(text).not.toContain(leak);
    // A star, a token and a delimited default are kinds too; the spec's text never goes.
    const starred = withDefault(request, "cvname", "s D<>{Harbour City}");
    const named = starred.macros.find((macro) => macro.name === "cvname");
    if (named === undefined) throw new Error("no cvname");
    named.arguments = [
      { index: 1, kind: "star", verdict: "editable" },
      { index: 2, kind: "optional", verdict: "editable" },
    ];
    named.sites = named.sites.map(() => ({ arguments: [null, "Xxxxx"] }));
    const laid = layOut(starred);
    expect(laid).toContain("Signature: #1 star, #2 optional with a default.");
    expect(laid).not.toContain("Harbour");
    // A signature the editor reads no argument of says so, and shows none of it either.
    const unread = withDefault(request, "cvheader", "v");
    expect(layOut(unread)).toContain(
      '### command "cvheader"\nSignature: it takes arguments the editor does not read, and its calls show none.',
    );
  });

  test("lays a definition out once, and an asked macro's own in its heading's piece alone", async () => {
    const request = await inventedRequest();
    const text = layOut(request);
    // `cv@style` is handed work by two macros; `endcvitems` by the environment.
    expect(text.split('Definition "cv@style":').length).toBe(2);
    expect(text.split('Definition "endcvitems":').length).toBe(2);
    // An asked macro's definition is in its own piece, never among the shared ones.
    for (const macro of askedOf(request)) expect(text).not.toContain(`Definition "${macro.name}"`);
    // The shared definitions come first, those most macros hand work to before the rest.
    const order = definitionOrder(request);
    expect(order.get("cv@style")).toBe(0);
    expect(text.indexOf('Definition "cv@style"')).toBeLessThan(text.indexOf('Definition "cv@row"'));
    expect(text.indexOf("## The definitions")).toBeLessThan(text.indexOf("## The macros"));
  });

  test("leaves the preamble to another part when asked to, and writes no LaTeX of its own", async () => {
    const request = await inventedRequest();
    const part = layOut(request, { preamble: false });
    expect(part).not.toContain("\\usepackage");
    expect(part).not.toContain("The class:");
    expect(part).toContain("Its settings are asked in another part of this request");
    // A request whose own texts hold no backslash is laid out with none, whatever its signatures'
    // defaults hold: they are the definition's text, which may be the person's.
    const plain = withDefault(
      NamingRequest.parse({
        ...request,
        preamble: { settings: ["geometry margin 1in"] },
        macros: request.macros.map((macro) => ({
          ...macro,
          sites: macro.sites.map((site) => ({
            arguments: site.arguments.map((each) => (each === null ? null : "Xxxx")),
            ...(site.body === undefined ? {} : { body: "Xxxx" }),
          })),
        })),
        definitions: request.definitions.map((each) =>
          each.kind === "data" ? each : { ...each, text: "macro:#1->#1" },
        ),
      }),
      "cventry",
      "m m O{\\textbf{Quill Inventedsurname}}",
    );
    const laid = layOut(plain);
    expect(laid.includes("\\")).toBe(false);
    expect(laid).not.toContain("Inventedsurname");
  });

  test("names the commands a list's partner may be, the request's and those the caller adds", async () => {
    const request = await inventedRequest();
    expect(commandsOf(request)).toEqual(["cvname", "cvheader", "cvsection", "cventry"]);
    expect(commandsOf(request, ["cvsection", "cvlistend"])).toEqual([
      "cvname",
      "cvheader",
      "cvsection",
      "cventry",
      "cvlistend",
    ]);
    const text = layOut(request, { commands: ["cvsection", "cvlistend"] });
    expect(text).toContain(
      'The template\'s commands, one of which a list\'s `closedBy` or `openedBy` names: "cvsection", "cvlistend".',
    );
  });

  test("is sized before it is laid out, to the character", async () => {
    const request = await inventedRequest();
    const shared = ["cv@style", "cv@row", "@firstname", "@lastname", "endcvitems"];
    for (const commands of [undefined, ["cvsection", "cvlistend"], []])
      for (const preamble of [true, false]) {
        const size = measure(request, commands);
        const expected =
          size.fixed(preamble) +
          askedOf(request).reduce((sum, macro) => sum + size.macro(macro), 0) +
          shared.reduce((sum, name) => sum + size.definition(name), 0);
        expect(
          INSTRUCTIONS.length +
            layOut(request, { preamble, ...(commands === undefined ? {} : { commands }) }).length,
        ).toBe(expected);
      }
  });

  test("quotes an answer's problems back, a few dozen at most", () => {
    const problems = Array.from({ length: 45 }, (_, i) => `problem ${i + 1}`);
    const text = retryText(problems);
    expect(text).toContain("- problem 40");
    expect(text).not.toContain("- problem 41");
    expect(text).toContain("- and 5 more");
    expect(text).toContain("Answer again, the whole answer");
  });
});

/**
 * A request that takes every path the layout has, written out, so that the prompt's pin moves with
 * how a request is laid out and nothing else: a star, a default and a token, a closure at its cap,
 * data by name, an environment with its body, a macro no call gives, the class and settings.
 */
const PINNED = NamingRequest.parse({
  version: 1,
  engine: "xetex",
  family: "awesome-cv",
  preamble: {
    class: { name: "xxxxxxxx", options: ["00xx", "xxxxxxx"] },
    settings: ["\\geometry{margin=0.5in}", "\\definecolor{accent}{HTML}{1F4E79}"],
  },
  macros: [
    {
      of: "command",
      name: "cvpinned",
      signature: "s m O{x} o t+",
      key: "a".repeat(64),
      dependencies: ["cv@pinned", "@pinned"],
      capped: true,
      arguments: [
        { index: 1, kind: "star" },
        { index: 2, kind: "mandatory", verdict: "editable" },
        { index: 3, kind: "optional", verdict: "vanished" },
        { index: 4, kind: "optional", verdict: "editable", empty: "moved" },
        { index: 5, kind: "token", verdict: "raw" },
      ],
      sites: [
        { arguments: [null, "Xxxx", null, "xxxx", "+"] },
        { arguments: ["*", "Xxx 0000", "x", null, null] },
      ],
      calls: 2,
    },
    {
      of: "environment",
      name: "cvpinlist",
      signature: "",
      key: "b".repeat(64),
      dependencies: ["endcvpinlist"],
      capped: false,
      arguments: [],
      sites: [{ arguments: [], body: "\\item Xxxx" }],
      calls: 1,
    },
    {
      of: "command",
      name: "cvpinnone",
      key: "c".repeat(64),
      dependencies: [],
      capped: false,
      arguments: [],
      sites: [],
      calls: 0,
    },
    {
      of: "command",
      name: "cvpindata",
      signature: "",
      dependencies: [],
      capped: false,
      arguments: [],
      sites: [],
      calls: 1,
    },
  ],
  definitions: [
    { kind: "definition", name: "cvpinned", hash: "d".repeat(64), text: "macro:->\\cv@pinned " },
    {
      kind: "definition",
      name: "cv@pinned",
      hash: "e".repeat(64),
      text: "macro:#1->\\textbf {#1}",
    },
    { kind: "data", name: "@pinned" },
    {
      kind: "definition",
      name: "cvpinlist",
      hash: "f".repeat(64),
      text: "macro:->\\begin {itemize}",
    },
    {
      kind: "definition",
      name: "endcvpinlist",
      hash: "0".repeat(64),
      text: "macro:->\\end {itemize}",
    },
    { kind: "definition", name: "cvpinnone", hash: "1".repeat(64), text: "macro:->\\relax " },
    { kind: "data", name: "cvpindata" },
  ],
});

describe("the prompt's pin", () => {
  test("is the hash of the instructions and how a request is laid out, beside NAMING_VERSION", async () => {
    const text = JSON.stringify([
      INSTRUCTIONS,
      layOut(PINNED),
      layOut(PINNED, { preamble: false, commands: ["cvpinned", "cvelsewhere"] }),
      retryText(["an invented problem"]),
    ]);
    // An edit to the prompt fails here until PROMPT_HASH, in key.ts, is this hash again; whoever
    // updates it decides whether the edit changes what the prompt asks, which bumps NAMING_VERSION
    // (decision 0027).
    expect(await sha256(text), "the prompt changed: see PROMPT_HASH in key.ts").toBe(PROMPT_HASH);
  });
});
