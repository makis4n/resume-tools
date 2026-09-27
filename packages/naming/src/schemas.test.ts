import { describe, expect, test } from "vitest";
import {
  ModelAnswer,
  ModelNaming,
  NamingAnswer,
  PreambleAnswer,
  ReviewedAnswer,
  StoredAnswer,
} from "./answer";
import { answerFor, checkRequest, requestKey } from "./cache";
import { keyOf, NAMING_VERSION, sha256 } from "./key";
import { NamingRequest } from "./request";

// Every template, macro, definition and call here is invented, and no text of anyone's is in it.

const ENTRY = "macro:#1#2#3->\\textbf {#1}\\hfill #3\\par \\cventry@style {#2}";
const STYLE = "macro:#1->{\\itshape #1}";
const START = "macro:->\\begin {itemize}";
const END = "macro:->\\end {itemize}";

/** A request as a test may break it: the schema's shape with every field loosely typed. */
interface Loose {
  version: number;
  engine: string;
  family?: string;
  preamble: { class?: { name: string; options: string[] }; settings: string[] };
  macros: {
    of: string;
    name: string;
    signature?: string;
    key?: string;
    dependencies: string[];
    capped: boolean;
    arguments: { index: number; kind: string; verdict?: string; empty?: string }[];
    sites: { arguments: (string | null)[]; body?: string }[];
    calls: number;
  }[];
  definitions: { kind: string; name: string; hash?: string; text?: string }[];
}

/** An invented request: a command, an environment, and a macro that holds data. */
async function example(): Promise<Loose> {
  const [entry, style, start, end] = await Promise.all([ENTRY, STYLE, START, END].map(sha256));
  const request: Loose = {
    version: NAMING_VERSION,
    engine: "pdftex",
    family: "jake",
    preamble: {
      class: { name: "article", options: ["11pt", "letterpaper"] },
      settings: ["\\usepackage[margin=0.5in]{geometry}", "\\definecolor{accent}{HTML}{1F4E79}"],
    },
    macros: [
      {
        of: "command",
        name: "cventry",
        signature: "m m o",
        key: await keyOf(NAMING_VERSION, entry ?? "", [["cventry@style", style ?? ""]]),
        dependencies: ["cventry@style", "cvname"],
        capped: false,
        arguments: [
          { index: 1, kind: "mandatory", verdict: "editable" },
          { index: 2, kind: "mandatory", verdict: "moved" },
          { index: 3, kind: "optional", verdict: "editable", empty: "moved" },
        ],
        sites: [
          { arguments: ["Xxxxx Xxxx", "0000-00 -- xxxxxxx", null] },
          { arguments: ["\\textbf{Xxxx} $|$ \\emph{Xxxxx}", "0000", "Xxxxx, XX"] },
        ],
        calls: 4,
      },
      {
        of: "environment",
        name: "cvlist",
        key: await keyOf(NAMING_VERSION, start ?? "", [["endcvlist", end ?? ""]]),
        dependencies: ["endcvlist"],
        capped: false,
        signature: "",
        arguments: [],
        sites: [{ arguments: [], body: "\\item Xxxx xxx. \\item Xxxxx" }],
        calls: 1,
      },
      {
        of: "command",
        name: "cvname",
        signature: "",
        dependencies: [],
        capped: false,
        arguments: [],
        sites: [{ arguments: [] }],
        calls: 1,
      },
    ],
    definitions: [
      { kind: "definition", name: "cventry", hash: entry, text: ENTRY },
      { kind: "definition", name: "cventry@style", hash: style, text: STYLE },
      { kind: "definition", name: "cvlist", hash: start, text: START },
      { kind: "definition", name: "endcvlist", hash: end, text: END },
      { kind: "data", name: "cvname" },
    ],
  };
  return request;
}

describe("the request", () => {
  test("takes an invented request, and its keys are the ones its definitions give", async () => {
    const request = NamingRequest.parse(await example());
    expect(await checkRequest(request)).toEqual([]);
    expect(await requestKey(request, request.macros[0] ?? { name: "", dependencies: [] })).toBe(
      request.macros[0]?.key,
    );
    // A macro that holds data has no key.
    expect(requestKey(request, { name: "cvname", dependencies: [] })).toBeUndefined();
  });

  test("refuses a call site that holds any letter but x and X, or any digit but 0", async () => {
    for (const text of ["Quill", "Xxxxx Invented", "0000-12", "Xxxxé", "\\textbf{Wren}", "东"]) {
      const request = await example();
      const [site] = request.macros[0]?.sites ?? [];
      if (site !== undefined) site.arguments[0] = text;
      const result = NamingRequest.safeParse(request);
      expect(result.success, text).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(["macros", 0, "sites", 0, "arguments", 0]);
    }
    const body = await example();
    const environment = body.macros[1]?.sites[0];
    if (environment !== undefined) environment.body = "\\item Quill";
    expect(NamingRequest.safeParse(body).success).toBe(false);
  });

  test("refuses what the contract does not hold, and definitions that do not add up", async () => {
    const broken: ((request: Awaited<ReturnType<typeof example>>) => void)[] = [
      (request) => {
        request.version = NAMING_VERSION + 1;
      },
      (request) => {
        request.engine = "luatex";
      },
      (request) => {
        request.family = "other";
      },
      (request) => {
        Object.assign(request, { text: "a field the contract has not" });
      },
      (request) => {
        const [first] = request.definitions;
        if (first !== undefined) first.hash = "ABC";
      },
      (request) => {
        request.definitions.push({ kind: "data", name: "cventry" });
      },
      (request) => {
        request.macros[0]?.dependencies.push("nowhere");
      },
      (request) => {
        if (request.macros[0] !== undefined) delete request.macros[0].key;
      },
      (request) => {
        if (request.macros[2] !== undefined) request.macros[2].key = "a".repeat(64);
      },
      (request) => {
        const [first] = request.macros;
        if (first !== undefined) request.macros.push({ ...first });
      },
      (request) => {
        const argument = request.macros[0]?.arguments[1];
        if (argument !== undefined) argument.index = 3;
      },
      (request) => {
        request.macros[0]?.sites[0]?.arguments.pop();
      },
      (request) => {
        if (request.definitions[4] !== undefined) request.definitions[4].text = "Quill";
      },
      (request) => {
        const argument = request.macros[0]?.arguments[0];
        if (argument !== undefined) argument.verdict = "fine";
      },
    ];
    for (const [i, change] of broken.entries()) {
      const request = await example();
      change(request);
      expect(NamingRequest.safeParse(request).success, `change ${i}`).toBe(false);
    }
  });

  test("finds a definition whose hash is not its text's, and a key its definitions do not give", async () => {
    const request = NamingRequest.parse(await example());
    const [first] = request.definitions;
    if (first?.kind === "definition") first.text = `${first.text} `;
    const [macro] = request.macros;
    if (macro !== undefined) macro.key = "0".repeat(64);
    expect(await checkRequest(request)).toEqual([
      { of: "definition", name: "cventry", problem: "hash" },
      { of: "macro", name: "cventry", problem: "key" },
    ]);
  });
});

/** An invented answer for an entry macro, as the model may give it. */
const ENTRY_ANSWER = {
  kind: "entry",
  arguments: [
    { index: 1, meaning: "title", slot: "title", blank: "empty" },
    { index: 2, meaning: "dates", slot: "dates" },
    { index: 3, meaning: "place", slot: "place", blank: "absent" },
  ],
  repeatable: true,
  variants: [
    {
      role: "education",
      arguments: [
        { index: 1, meaning: "title", slot: "title" },
        { index: 2, meaning: "place", slot: "place" },
        { index: 3, meaning: "dates", slot: "dates" },
      ],
    },
  ],
};

describe("the answer", () => {
  test("takes an entry, a list's two ends, a contact, a link and a heading of two parts", () => {
    const answers = [
      ENTRY_ANSWER,
      {
        kind: "bulletList",
        arguments: [],
        repeatable: false,
        list: { does: "opens", closedBy: "cvlistend", holds: "bullet" },
      },
      {
        kind: "bulletList",
        arguments: [],
        repeatable: false,
        list: { does: "closes", openedBy: "cvliststart" },
      },
      {
        kind: "contact",
        contact: "email",
        arguments: [{ index: 1, meaning: "text", slot: "text" }],
        repeatable: false,
      },
      {
        kind: "link",
        link: "github",
        arguments: [
          { index: 1, meaning: "icon", blank: "kept" },
          { index: 2, meaning: "text", slot: "label" },
        ],
        repeatable: true,
      },
      {
        kind: "entry",
        role: "projects",
        arguments: [
          {
            index: 1,
            meaning: "title",
            parts: [
              { meaning: "title", slot: "title" },
              { meaning: "subtitle", slot: "subtitle" },
            ],
          },
          { index: 2, meaning: "dates", slot: "dates" },
        ],
        repeatable: true,
      },
      {
        kind: "section",
        arguments: [{ index: 1, meaning: "title", slot: "title" }],
        repeatable: true,
      },
      { kind: "other", arguments: [{ index: 1, meaning: "length" }], repeatable: false },
    ];
    for (const answer of answers) expect(ModelAnswer.parse(answer)).toEqual(answer);
  });

  test("refuses a slot the kind has not, a slot filled twice, and fields that do not fit", () => {
    const refused = [
      { ...ENTRY_ANSWER, kind: "bullet" },
      {
        ...ENTRY_ANSWER,
        arguments: [
          { index: 1, meaning: "title", slot: "title" },
          { index: 2, meaning: "title", slot: "title" },
        ],
      },
      {
        ...ENTRY_ANSWER,
        arguments: [
          { index: 2, meaning: "title", slot: "title" },
          { index: 1, meaning: "dates", slot: "dates" },
        ],
      },
      { ...ENTRY_ANSWER, contact: "email" },
      { ...ENTRY_ANSWER, link: "github" },
      { ...ENTRY_ANSWER, kind: "chapter" },
      { ...ENTRY_ANSWER, arguments: [{ index: 1, meaning: "name" }] },
      { ...ENTRY_ANSWER, role: "hobbies" },
      { ...ENTRY_ANSWER, variants: [ENTRY_ANSWER.variants[0], ENTRY_ANSWER.variants[0]] },
      { ...ENTRY_ANSWER, list: { does: "closes", closedBy: "cvlistend" } },
      { ...ENTRY_ANSWER, list: { does: "opens", openedBy: "cvliststart" } },
      { ...ENTRY_ANSWER, arguments: [{ index: 0, meaning: "title" }] },
      {
        ...ENTRY_ANSWER,
        arguments: [
          {
            index: 1,
            meaning: "title",
            slot: "title",
            parts: [{ meaning: "title", slot: "title" }],
          },
        ],
      },
      { ...ENTRY_ANSWER, repeatable: "yes" },
    ];
    for (const [i, answer] of refused.entries())
      expect(ModelAnswer.safeParse(answer).success, `answer ${i}`).toBe(false);
  });

  test("never takes LaTeX from the model: redefinitions and review are a person's", () => {
    const redefinitions = [{ name: "cventry", latex: "\\renewcommand{\\cventry}[3]{#1}" }];
    expect(ModelAnswer.safeParse({ ...ENTRY_ANSWER, redefinitions }).success).toBe(false);
    expect(ModelAnswer.safeParse({ ...ENTRY_ANSWER, reviewed: true }).success).toBe(false);
    expect(
      ReviewedAnswer.parse({ ...ENTRY_ANSWER, reviewed: true, redefinitions, notes: "Invented." }),
    ).toMatchObject({ reviewed: true, redefinitions });
    expect(ReviewedAnswer.safeParse({ ...ENTRY_ANSWER, reviewed: false }).success).toBe(false);
    expect(ReviewedAnswer.safeParse(ENTRY_ANSWER).success).toBe(false);
    expect(
      ReviewedAnswer.safeParse({
        ...ENTRY_ANSWER,
        reviewed: true,
        redefinitions: [{ name: "cventry", latex: "" }],
      }).success,
    ).toBe(false);
  });

  test("takes the preamble's style parameters, and what the model answers for a request", () => {
    const preamble = {
      parameters: [
        { parameter: "margins", setting: 0, command: "usepackage", key: "margin" },
        { parameter: "fontSize", command: "documentclass", key: "11pt" },
        { parameter: "accent", setting: 1, command: "definecolor", key: "accent" },
      ],
    };
    expect(PreambleAnswer.parse(preamble)).toEqual(preamble);
    expect(
      PreambleAnswer.safeParse({ parameters: [{ parameter: "colour", command: "definecolor" }] })
        .success,
    ).toBe(false);
    expect(
      PreambleAnswer.safeParse({ parameters: [{ parameter: "accent", command: "\\definecolor" }] })
        .success,
    ).toBe(false);
    const naming = {
      macros: [{ of: "command", name: "cventry", answer: ENTRY_ANSWER }],
      preamble,
    };
    expect(ModelNaming.parse(naming)).toEqual(naming);
    expect(
      ModelNaming.safeParse({
        ...naming,
        macros: [{ ...naming.macros[0], answer: { ...ENTRY_ANSWER, reviewed: true } }],
      }).success,
    ).toBe(false);
  });
});

/** An invented stored answer, as the seed files one. */
function stored(overrides: Record<string, unknown> = {}) {
  return {
    version: NAMING_VERSION,
    key: "a".repeat(64),
    hash: "b".repeat(64),
    of: "command",
    name: "cventry",
    family: "jake",
    answer: { ...ENTRY_ANSWER, reviewed: true },
    reviewed: true,
    source: "seed",
    ...overrides,
  };
}

describe("a stored answer", () => {
  test("takes the seed's reviewed answers and a model's", () => {
    expect(StoredAnswer.parse(stored())).toMatchObject({ source: "seed", reviewed: true });
    expect(
      StoredAnswer.parse(
        stored({ answer: ENTRY_ANSWER, reviewed: false, source: "model:gemini-2.5-flash" }),
      ),
    ).toMatchObject({ reviewed: false });
    expect(StoredAnswer.parse(stored({ source: "model:claude-sonnet-4-5" })).answer).toMatchObject({
      reviewed: true,
    });
    expect(
      NamingAnswer.parse({
        version: NAMING_VERSION,
        macros: [stored()],
        preamble: { parameters: [] },
      }),
    ).toBeDefined();
  });

  test("refuses a seed answer no person reviewed, and a flag that says otherwise than the answer", () => {
    const refused = [
      stored({ answer: ENTRY_ANSWER, reviewed: false }),
      stored({ reviewed: false }),
      stored({ answer: ENTRY_ANSWER, reviewed: true, source: "model:x" }),
      stored({ source: "person" }),
      stored({ source: "model:" }),
      stored({ version: NAMING_VERSION + 1 }),
      stored({ key: "a" }),
      stored({ of: "package" }),
      stored({ family: "other" }),
      stored({ extra: true }),
    ];
    for (const [i, answer] of refused.entries())
      expect(StoredAnswer.safeParse(answer).success, `stored ${i}`).toBe(false);
  });
});

describe("reading the cache", () => {
  const cacheOf = (entries: Record<string, unknown>) => ({
    get: async (key: string) => entries[key],
  });

  test("gives the answer filed under the key, as an object or its JSON", async () => {
    const key = "a".repeat(64);
    expect(await answerFor(cacheOf({ [key]: stored() }), key)).toMatchObject({ name: "cventry" });
    expect(await answerFor(cacheOf({ [key]: JSON.stringify(stored()) }), key)).toMatchObject({
      name: "cventry",
    });
    expect(
      await answerFor({ get: (asked) => (asked === key ? stored() : undefined) }, key),
    ).toBeDefined();
  });

  test("gives nothing for a miss, another key's answer, an older version's, or one that does not validate", async () => {
    const key = "a".repeat(64);
    const other = "c".repeat(64);
    expect(await answerFor(cacheOf({}), key)).toBeUndefined();
    expect(await answerFor(cacheOf({ [other]: stored() }), other)).toBeUndefined();
    expect(await answerFor(cacheOf({ [key]: stored({ version: 0 }) }), key)).toBeUndefined();
    expect(await answerFor(cacheOf({ [key]: stored({ reviewed: false }) }), key)).toBeUndefined();
    expect(await answerFor(cacheOf({ [key]: "{ not json" }), key)).toBeUndefined();
    expect(await answerFor(cacheOf({ [key]: null }), key)).toBeUndefined();
  });
});
