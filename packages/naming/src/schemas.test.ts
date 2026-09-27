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
import { NamingRequest, REQUEST_CAPS } from "./request";

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

  test("refuses a signature whose default holds text, or that is no signature", async () => {
    const refused = [
      "O{quill@example.invalid} m",
      "D<>{+44 20 7946 0000} m",
      "O{Quill Invented} m",
      "R(){Wren} m",
      "E{^_}{{Quill}{}} m",
      "O{\\textbf{Quill}} m",
      "Quill Invented",
    ];
    for (const signature of refused) {
      const request = await example();
      if (request.macros[0] !== undefined) request.macros[0].signature = signature;
      const result = NamingRequest.safeParse(request);
      expect(result.success, signature).toBe(false);
      expect(result.error?.issues[0]?.path, signature).toEqual(["macros", 0, "signature"]);
    }
    // A default the builder sent as its placeholder, an empty one, and one that is code.
    const taken = [
      "O{Xxxxx Xxxxxxxx} m",
      "D<>{0000} m",
      "O{} m",
      "O{\\@empty} m",
      "s O{\\str_use:N \\l_fontawesome_style_str } m",
    ];
    for (const signature of taken) {
      const request = await example();
      if (request.macros[0] !== undefined) request.macros[0].signature = signature;
      expect(NamingRequest.safeParse(request).success, signature).toBe(true);
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

  test("answers each macro once, and a command that opens a list names what closes it", () => {
    const opens = { kind: "bulletList", arguments: [], repeatable: false };
    const naming = (macros: unknown[]) => ({ macros, preamble: { parameters: [] } });
    const entry = { of: "command", name: "cventry", answer: ENTRY_ANSWER };
    // A command and an environment may share a name; a macro may not be answered twice.
    expect(ModelNaming.safeParse(naming([entry, { ...entry, of: "environment" }])).success).toBe(
      true,
    );
    const twice = ModelNaming.safeParse(naming([entry, entry]));
    expect(twice.success).toBe(false);
    expect(twice.error?.issues[0]?.path).toEqual(["macros", 1, "name"]);
    // A command that opens a list names its closer; an environment's `\end` is its own.
    const opener = (of: string, list: Record<string, unknown>) => ({
      of,
      name: "cvliststart",
      answer: { ...opens, list },
    });
    const unclosed = ModelNaming.safeParse(
      naming([opener("command", { does: "opens", holds: "bullet" })]),
    );
    expect(unclosed.success).toBe(false);
    expect(unclosed.error?.issues[0]?.path).toEqual(["macros", 0, "answer", "list", "closedBy"]);
    for (const [of, list] of [
      ["command", { does: "opens", closedBy: "cvlistend", holds: "bullet" }],
      ["environment", { does: "opens", holds: "bullet" }],
      ["command", { does: "closes", openedBy: "cvliststart" }],
    ] as const)
      expect(ModelNaming.safeParse(naming([opener(of, list)])).success, `${of} ${list.does}`).toBe(
        true,
      );
  });

  test("names a setting by its index in the request, and no index past the last", () => {
    const setting = (index: number) =>
      PreambleAnswer.safeParse({
        parameters: [{ parameter: "margins", setting: index, command: "geometry" }],
      }).success;
    expect(setting(REQUEST_CAPS.settings - 1)).toBe(true);
    expect(setting(REQUEST_CAPS.settings)).toBe(false);
    expect(setting(-1)).toBe(false);
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

  test("takes the dependencies its key was computed from, and its list's partners by key", () => {
    const dependencies = [
      ["cventry@style", "c".repeat(64)],
      ["cvmissing", null],
    ];
    expect(StoredAnswer.parse(stored({ dependencies })).dependencies).toEqual(dependencies);
    const closer = stored({
      name: "cvlistend",
      answer: {
        kind: "bulletList",
        arguments: [],
        repeatable: false,
        list: { does: "closes", openedBy: "cvliststart" },
        reviewed: true,
      },
      partnerKeys: { openedBy: "d".repeat(64) },
    });
    expect(StoredAnswer.parse(closer).partnerKeys).toEqual({ openedBy: "d".repeat(64) });
    const refused = [
      stored({ dependencies: [["cventry@style", "C"]] }),
      stored({ dependencies: [["cventry@style"]] }),
      // A partner's key for a partner the answer does not name.
      { ...closer, partnerKeys: { closedBy: "d".repeat(64) } },
      stored({ partnerKeys: { openedBy: "d".repeat(64) } }),
      // A command that opens a list names its closer.
      stored({
        answer: {
          kind: "bulletList",
          arguments: [],
          repeatable: false,
          list: { does: "opens", holds: "bullet" },
          reviewed: true,
        },
      }),
    ];
    for (const [i, answer] of refused.entries())
      expect(StoredAnswer.safeParse(answer).success, `stored ${i}`).toBe(false);
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

  test("gives an answer whose dependencies give its key, and none whose dependencies do not", async () => {
    const hash = await sha256(ENTRY);
    const dependencies = [["cventry@style", await sha256(STYLE)]] as [string, string][];
    const key = await keyOf(NAMING_VERSION, hash, dependencies);
    const held = stored({ key, hash, dependencies });
    expect(await answerFor(cacheOf({ [key]: held }), key)).toMatchObject({ key });
    // The same answer filed under a key its closure does not give, as a hand-edited file may be.
    const other = "e".repeat(64);
    expect(await answerFor(cacheOf({ [other]: { ...held, key: other } }), other)).toBeUndefined();
  });

  /**
   * A list's two macros as one template defines them, `\cvliststart` and `\cvlistend`, their
   * answers filed under their keys with each other's key as their partner's.
   */
  async function listCache() {
    const [start, end] = await Promise.all([START, END].map(sha256));
    const keys = {
      start: await keyOf(NAMING_VERSION, start ?? "", []),
      end: await keyOf(NAMING_VERSION, end ?? "", []),
    };
    const answer = (list: Record<string, unknown>) => ({
      kind: "bulletList",
      arguments: [],
      repeatable: false,
      list,
      reviewed: true,
    });
    const entries = {
      [keys.start]: stored({
        key: keys.start,
        hash: start,
        dependencies: [],
        name: "cvliststart",
        answer: answer({ does: "opens", closedBy: "cvlistend", holds: "bullet" }),
        partnerKeys: { closedBy: keys.end },
      }),
      [keys.end]: stored({
        key: keys.end,
        hash: end,
        dependencies: [],
        name: "cvlistend",
        answer: answer({ does: "closes", openedBy: "cvliststart" }),
        partnerKeys: { openedBy: keys.start },
      }),
    };
    return { keys, cache: cacheOf(entries) };
  }

  test("gives a document's macro the answer as its own, its list's partners found by key", async () => {
    const { keys, cache } = await listCache();
    // A fork that renames the two macros and keeps their bodies keeps their answers, named as it
    // names them.
    const partners = new Map([
      ["itemsstart", keys.start],
      ["itemsend", keys.end],
    ]);
    expect(
      await answerFor(cache, keys.start, { name: "itemsstart", of: "command", partners }),
    ).toMatchObject({
      name: "itemsstart",
      answer: { list: { does: "opens", closedBy: "itemsend", holds: "bullet" } },
    });
    expect(
      await answerFor(cache, keys.end, { name: "itemsend", of: "command", partners }),
    ).toMatchObject({
      name: "itemsend",
      answer: { list: { does: "closes", openedBy: "itemsstart" } },
    });
    // Two macros of one key are one definition: the answer's own name is taken where it is there.
    const both = new Map([...partners, ["cvlistend", keys.end]]);
    expect(
      await answerFor(cache, keys.start, { name: "cvliststart", of: "command", partners: both }),
    ).toMatchObject({ answer: { list: { closedBy: "cvlistend" } } });
    // Asked with no macro, the answer is as it was filed.
    expect(await answerFor(cache, keys.start)).toMatchObject({
      name: "cvliststart",
      answer: { list: { closedBy: "cvlistend" } },
    });
  });

  test("finds a partner by the name the answer gives it where no macro of the request has its key", async () => {
    const { keys, cache } = await listCache();
    // A fork that keeps the list's names and changes its closer's definition, as a Jake fork whose
    // `\resumeItemListEnd` is a bare `\end{itemize}` does: no macro of it has the closer's key.
    const closer = await keyOf(NAMING_VERSION, await sha256("macro:->\\end {itemize}\\par "), []);
    const partners = new Map([
      ["cvliststart", keys.start],
      ["cvlistend", closer],
    ]);
    expect(
      await answerFor(cache, keys.start, { name: "cvliststart", of: "command", partners }),
    ).toMatchObject({
      name: "cvliststart",
      answer: { list: { does: "opens", closedBy: "cvlistend", holds: "bullet" } },
    });
    // A key found among the request's macros is taken first: the name only where no key is.
    const both = new Map([...partners, ["cvitemsend", keys.end]]);
    expect(
      await answerFor(cache, keys.start, { name: "cvliststart", of: "command", partners: both }),
    ).toMatchObject({ answer: { list: { closedBy: "cvitemsend" } } });
    // The seed's check of its own files finds partners by key alone.
    expect(
      await answerFor(cache, keys.start, {
        name: "cvliststart",
        of: "command",
        partners,
        byName: false,
      }),
    ).toEqual({ answer: undefined, reason: "partner" });
  });

  test("refuses a partner no macro of the request is by key, and a kind that is not the macro's", async () => {
    const { keys, cache } = await listCache();
    // A bare `\end{itemize}` closes a list another template's opener opens: its closer's answer
    // names that opener, which this document has not.
    const opener = await keyOf(
      NAMING_VERSION,
      await sha256("macro:->\\begin {itemize}\\small "),
      [],
    );
    const partners = new Map([
      ["bulletsstart", opener],
      ["bulletsend", keys.end],
    ]);
    expect(
      await answerFor(cache, keys.end, { name: "bulletsend", of: "command", partners }),
    ).toEqual({ answer: undefined, reason: "partner" });
    expect(
      await answerFor(cache, keys.start, {
        name: "cvliststart",
        of: "environment",
        partners: new Map([["cvliststart", keys.start]]),
      }),
    ).toEqual({ answer: undefined, reason: "kind" });
    // An answer that names a partner and holds no key for it cannot be paired.
    const held = JSON.parse(JSON.stringify(await cache.get(keys.end)));
    delete held.partnerKeys;
    expect(
      await answerFor(cacheOf({ [keys.end]: held }), keys.end, {
        name: "cvlistend",
        of: "command",
        partners: new Map([
          ["cvliststart", keys.start],
          ["cvlistend", keys.end],
        ]),
      }),
    ).toEqual({ answer: undefined, reason: "partner" });
    // An answer that names no partner is the macro's under its own name.
    const key = "a".repeat(64);
    expect(
      await answerFor(cacheOf({ [key]: stored() }), key, {
        name: "cvjob",
        of: "command",
        partners: new Map(),
      }),
    ).toMatchObject({ name: "cvjob", answer: { kind: "entry" } });
  });
});
