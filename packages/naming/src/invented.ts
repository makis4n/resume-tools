/**
 * An invented template's naming request, and answers to it, for the package's tests alone: no module
 * the package exports imports this file. Every class, macro, definition, call and setting here is
 * invented, and no text of anyone's is in it.
 */

import type { ModelAnswer, ModelNaming } from "./answer.ts";
import { keyOf, NAMING_VERSION, sha256 } from "./key.ts";
import { NamingRequest, type RequestMacro } from "./request.ts";

/** An invented definition: its text, or none for one that holds the person's data. */
interface Definition {
  name: string;
  text?: string;
}

/** The invented class's definitions, as the engine would print them, masked. */
const DEFINITIONS: Definition[] = [
  { name: "cventry", text: "macro:#1#2#3->\\cv@row {#1}{#3}\\par \\cv@style {#2}" },
  { name: "cv@row", text: "macro:#1#2->\\textbf {#1}\\hfill #2" },
  { name: "cv@style", text: "macro:#1->{\\itshape #1}" },
  { name: "cvsection", text: "macro:#1->\\section *{\\cv@style {#1}}\\vspace {2pt}" },
  { name: "cvitems", text: "macro:->\\begin {itemize}\\setlength \\itemsep {0pt}" },
  { name: "endcvitems", text: "macro:->\\end {itemize}" },
  { name: "cvname", text: "macro:#1#2->\\def \\@firstname {#1}\\def \\@lastname {#2}" },
  { name: "cvheader", text: "macro:->{\\Large \\@firstname \\ \\@lastname }\\par " },
  { name: "@firstname" },
  { name: "@lastname" },
];

/** A macro of the invented request, before its key. */
type Macro = Omit<RequestMacro, "key">;

/** The invented class's macros and environments, as a document calls them. */
const MACROS: Macro[] = [
  {
    of: "command",
    name: "cvname",
    signature: "m m",
    dependencies: [],
    capped: false,
    arguments: [
      { index: 1, kind: "mandatory", verdict: "editable" },
      { index: 2, kind: "mandatory", verdict: "editable" },
    ],
    sites: [{ arguments: ["Xxxxx", "Xxxxxxxx"] }],
    calls: 1,
  },
  {
    of: "command",
    name: "cvheader",
    signature: "",
    dependencies: ["@firstname", "@lastname"],
    capped: false,
    arguments: [],
    sites: [{ arguments: [] }],
    calls: 1,
  },
  {
    of: "command",
    name: "cvsection",
    signature: "m",
    dependencies: ["cv@style"],
    capped: false,
    arguments: [{ index: 1, kind: "mandatory", verdict: "editable" }],
    sites: [{ arguments: ["Xxxxxxxxxx"] }, { arguments: ["Xxxxxxxxx"] }],
    calls: 2,
  },
  {
    of: "command",
    name: "cventry",
    signature: "m m o",
    dependencies: ["cv@row", "cv@style"],
    capped: false,
    arguments: [
      { index: 1, kind: "mandatory", verdict: "editable" },
      { index: 2, kind: "mandatory", verdict: "moved" },
      { index: 3, kind: "optional", verdict: "editable", empty: "moved" },
    ],
    sites: [
      { arguments: ["Xxxxxxxx Xxxx", "0000-00 -- xxxxxxx", null] },
      { arguments: ["\\textbf{Xxxx} $|$ \\emph{Xxxxx}", "0000", "Xxxxxx, XX"] },
    ],
    calls: 3,
  },
  {
    of: "environment",
    name: "cvitems",
    signature: "",
    dependencies: ["endcvitems"],
    capped: false,
    arguments: [],
    sites: [{ arguments: [], body: "\\item Xxxxx xxx xxxxxxxx xxxxxxxxxx." }],
    calls: 1,
  },
];

/** The invented preamble's class and settings, masked as a request holds them. */
const PREAMBLE: NamingRequest["preamble"] = {
  class: { name: "xxxxxxxxxx", options: ["11pt", "a4paper"] },
  settings: [
    "\\usepackage[margin=0.5in, top=1cm]{geometry}",
    "\\definecolor{accent}{HTML}{1F4E79}",
    "\\setlength{\\parskip}{2pt}",
  ],
};

/** Options for an invented request, to make it larger than one call's budget. */
export interface InventedOptions {
  /** How many more entry-like macros to add, each handing its work to a large shared definition. */
  extra?: number;
  /** How many characters each extra macro's own definition runs to, and the shared one's. */
  size?: number;
}

/** A definition's text of about `size` characters: code, as a class's is, and nobody's text. */
const padded = (head: string, size: number) =>
  `${head}${"\\hskip 1pt \\relax ".repeat(Math.max(0, Math.ceil((size - head.length) / 18)))}`;

/** The name of the extra macro `i`: letters only, as a command's name is. */
const extraName = (i: number) =>
  `cvextra${[...i.toString(26)].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 26))).join("")}`;

/**
 * The invented request: a header's setter and the header it stores, a section, an entry, a list
 * environment, and the extra macros asked for, each with its key as `keysOf` would give it, checked
 * against the contract's schema.
 */
export async function inventedRequest(options: InventedOptions = {}): Promise<NamingRequest> {
  const size = options.size ?? 2000;
  const definitions = [...DEFINITIONS];
  const macros = [...MACROS];
  if ((options.extra ?? 0) > 0) {
    definitions.push({ name: "cv@shared", text: padded("macro:#1->\\cv@style {#1}", size) });
    for (let i = 0; i < (options.extra ?? 0); i++) {
      const name = extraName(i);
      // Each its own definition, as a class's macros have, so that each has a key of its own.
      definitions.push({
        name,
        text: padded(`macro:#1#2->\\cv@shared {#1}\\hfill #2\\kern ${i}sp `, size),
      });
      macros.push({
        of: "command",
        name,
        signature: "m m",
        dependencies: ["cv@shared", "cv@style"],
        capped: false,
        arguments: [
          { index: 1, kind: "mandatory", verdict: "editable" },
          { index: 2, kind: "mandatory", verdict: "editable" },
        ],
        sites: [{ arguments: ["Xxxxxxxx", "0000"] }],
        calls: 1,
      });
    }
  }
  const hashes = new Map<string, string>();
  for (const definition of definitions)
    if (definition.text !== undefined) hashes.set(definition.name, await sha256(definition.text));
  const keyed = await Promise.all(
    macros.map(async (macro) => {
      const hash = hashes.get(macro.name);
      if (hash === undefined) return macro;
      const dependencies = macro.dependencies.flatMap((name) => {
        const found = hashes.get(name);
        return found === undefined ? [] : [[name, found] as const];
      });
      return { ...macro, key: await keyOf(NAMING_VERSION, hash, dependencies) };
    }),
  );
  return NamingRequest.parse({
    version: NAMING_VERSION,
    engine: "pdftex",
    family: "jake",
    preamble: PREAMBLE,
    macros: keyed,
    definitions: definitions.map((definition) =>
      definition.text === undefined
        ? { kind: "data", name: definition.name }
        : {
            kind: "definition",
            name: definition.name,
            hash: hashes.get(definition.name),
            text: definition.text,
          },
    ),
  });
}

/** An invented answer that validates for each of the invented macros, by name. */
export function inventedAnswer(macro: Pick<RequestMacro, "of" | "name">): ModelAnswer {
  if (macro.name.startsWith("cvextra"))
    return {
      kind: "entry",
      arguments: [
        { index: 1, meaning: "title", slot: "title", blank: "empty" },
        { index: 2, meaning: "dates", slot: "dates", blank: "empty" },
      ],
      repeatable: true,
    };
  switch (macro.name) {
    case "cvname":
      return {
        kind: "header",
        arguments: [
          { index: 1, meaning: "title", slot: "first", blank: "empty" },
          { index: 2, meaning: "title", slot: "last", blank: "empty" },
        ],
        repeatable: false,
      };
    case "cvheader":
      return { kind: "header", arguments: [], repeatable: false };
    case "cvsection":
      return {
        kind: "section",
        arguments: [{ index: 1, meaning: "title", slot: "title", blank: "empty" }],
        repeatable: true,
      };
    case "cvitems":
      return {
        kind: "bulletList",
        arguments: [],
        repeatable: false,
        list: { does: "opens", holds: "bullet" },
      };
    default:
      return {
        kind: "entry",
        arguments: [
          { index: 1, meaning: "title", slot: "title", blank: "empty" },
          { index: 2, meaning: "dates", slot: "dates", blank: "empty" },
          { index: 3, meaning: "place", slot: "place", blank: "absent" },
        ],
        repeatable: true,
      };
  }
}

/** An invented answer to a request: one for each macro that has a key, and the preamble's. */
export function inventedNaming(request: Pick<NamingRequest, "macros">): ModelNaming {
  return {
    macros: request.macros
      .filter((macro) => macro.key !== undefined)
      .map((macro) => ({ of: macro.of, name: macro.name, answer: inventedAnswer(macro) })),
    preamble: {
      parameters: [
        { parameter: "margins", setting: 0, command: "usepackage", key: "margin" },
        { parameter: "fontSize", command: "documentclass", key: "11pt" },
      ],
    },
  };
}
