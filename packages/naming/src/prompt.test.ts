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
import { askedOf, definitionOrder, INSTRUCTIONS, layOut, measure, retryText } from "./prompt";
import { NamingRequest, VERDICTS } from "./request";

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
        "A template for the pdfTeX engine, which its class or its macros say is Jake's Resume or a fork of it.",
      ),
    ).toBe(true);
    expect(text).toContain(
      [
        '### command "cventry"',
        "Signature: m m o",
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
    // A request whose own texts hold no backslash is laid out with none.
    const plain = NamingRequest.parse({
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
    });
    expect(layOut(plain).includes("\\")).toBe(false);
  });

  test("is sized before it is laid out, to the character", async () => {
    const request = await inventedRequest();
    const size = measure(request);
    const asked = askedOf(request);
    const shared = ["cv@style", "cv@row", "@firstname", "@lastname", "endcvitems"];
    for (const preamble of [true, false]) {
      const expected =
        size.fixed(preamble) +
        asked.reduce((sum, macro) => sum + size.macro(macro), 0) +
        shared.reduce((sum, name) => sum + size.definition(name), 0);
      expect(INSTRUCTIONS.length + layOut(request, { preamble }).length).toBe(expected);
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
