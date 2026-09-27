/**
 * An invented template's naming request, a model's answer to it and a cache in memory, for the
 * naming service's tests alone: nothing the app or a host loads imports this file. Every class,
 * macro, definition, call and setting here is invented, and no text of anyone's is in it.
 */

import {
  type AnswerCache,
  keyOf,
  type ModelNaming,
  NAMING_VERSION,
  NamingRequest,
  type StoredAnswer,
  sha256,
  storable,
} from "@resume-tools/naming";

/** The invented class's definitions, as the engine would print them, masked. */
export const TEXTS: Readonly<Record<string, string>> = {
  cvsection: "macro:#1->\\section *{\\cv@title {#1}}\\vspace {3pt}",
  cventry: "macro:#1#2#3->\\cv@row {#1}{#3}\\par \\cv@title {#2}",
  "cv@row": "macro:#1#2->\\textbf {#1}\\hfill \\textit {#2}",
  "cv@title": "macro:#1->{\\scshape #1}",
  cvitems: "macro:->\\begin {itemize}\\setlength \\itemsep {1pt}",
  endcvitems: "macro:->\\end {itemize}",
};

/** The invented preamble's class and settings, masked as a request holds them. */
export const SETTINGS = ["\\geometry{margin=0.7in}", "\\definecolor{cvaccent}{HTML}{2A6F97}"];

/** The invented calls, placeholders as the builder writes them. */
export const SITES = {
  cvsection: ["Xxxxxxxxxx"],
  cventry: ["Xxxxxxx Xxxxxxxx", "Xxxxxx Xxxxx, XX", "0000-00 -- xxxxxxx"],
  cvtagline: ["Xxxxxxxx xx xxxxxxxxxx"],
  cvitems: "\\item Xxxxxxx xxx xxxxxxxx xxxxxx.",
};

const argument = (index: number) => ({ index, kind: "mandatory", verdict: "editable" });

/**
 * The invented request: a section and an entry, which share a definition they hand their work to,
 * a list environment, and a tagline whose own definition holds data, which has no key and is never
 * answered; each key as `keysOf` gives it, checked against the contract's schema.
 */
export async function inventedRequest(): Promise<NamingRequest> {
  const hash = new Map<string, string>();
  for (const [name, text] of Object.entries(TEXTS)) hash.set(name, await sha256(text));
  const key = (name: string, dependencies: string[]) =>
    keyOf(
      NAMING_VERSION,
      hash.get(name) ?? "",
      dependencies.map((each) => [each, hash.get(each) ?? null] as const),
    );
  return NamingRequest.parse({
    version: NAMING_VERSION,
    engine: "pdftex",
    family: "jake",
    preamble: {
      class: { name: "xxxxxxxxx", options: ["10pt", "letterpaper"] },
      settings: SETTINGS,
    },
    macros: [
      {
        of: "command",
        name: "cvsection",
        signature: "m",
        key: await key("cvsection", ["cv@title"]),
        dependencies: ["cv@title"],
        capped: false,
        arguments: [argument(1)],
        sites: [{ arguments: SITES.cvsection }],
        calls: 2,
      },
      {
        of: "command",
        name: "cventry",
        signature: "m m m",
        key: await key("cventry", ["cv@row", "cv@title"]),
        dependencies: ["cv@row", "cv@title"],
        capped: false,
        arguments: [argument(1), argument(2), argument(3)],
        sites: [{ arguments: SITES.cventry }],
        calls: 3,
      },
      {
        of: "environment",
        name: "cvitems",
        signature: "",
        key: await key("cvitems", ["endcvitems"]),
        dependencies: ["endcvitems"],
        capped: false,
        arguments: [],
        sites: [{ arguments: [], body: SITES.cvitems }],
        calls: 3,
      },
      {
        of: "command",
        name: "cvtagline",
        signature: "m",
        dependencies: [],
        capped: false,
        arguments: [argument(1)],
        sites: [{ arguments: SITES.cvtagline }],
        calls: 1,
      },
    ],
    definitions: [
      ...Object.entries(TEXTS).map(([name, text]) => ({
        kind: "definition",
        name,
        hash: hash.get(name),
        text,
      })),
      { kind: "data", name: "cvtagline" },
    ],
  });
}

/** A model's invented answer to the invented request: each macro with a key, and the preamble. */
export function inventedNaming(): ModelNaming {
  return {
    macros: [
      {
        of: "command",
        name: "cvsection",
        answer: {
          kind: "section",
          arguments: [{ index: 1, meaning: "title", slot: "title", blank: "empty" }],
          repeatable: true,
        },
      },
      {
        of: "command",
        name: "cventry",
        answer: {
          kind: "entry",
          arguments: [
            { index: 1, meaning: "title", slot: "title", blank: "empty" },
            { index: 2, meaning: "subtitle", slot: "subtitle", blank: "empty" },
            { index: 3, meaning: "dates", slot: "dates", blank: "empty" },
          ],
          repeatable: true,
        },
      },
      {
        of: "environment",
        name: "cvitems",
        answer: {
          kind: "bulletList",
          arguments: [],
          repeatable: false,
          list: { does: "opens", holds: "bullet" },
        },
      },
    ],
    preamble: {
      parameters: [{ parameter: "margins", setting: 0, command: "geometry", key: "margin" }],
    },
  };
}

/** A cache in memory that files what `storable` takes, as every cache does, and counts its use. */
export function memoryCache(): AnswerCache & {
  held: Map<string, unknown>;
  gets: number;
  puts: number;
} {
  const held = new Map<string, unknown>();
  return {
    held,
    gets: 0,
    puts: 0,
    get(key) {
      this.gets++;
      return held.get(key);
    },
    put(key, answer: StoredAnswer) {
      this.puts++;
      held.set(key, storable(key, answer));
    },
  };
}
