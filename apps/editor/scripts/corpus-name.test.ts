import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  keyOf,
  type ModelNaming,
  NAMING_VERSION,
  NamingRequest,
  requestKey,
  StoredAnswer,
  sha256,
} from "@resume-tools/naming";
import { DEFAULT_MODEL } from "@resume-tools/naming/providers";
import { MockLanguageModelV4 } from "ai/test";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import type { EngineManifest } from "../src/engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../src/engine/node";
import type { EngineSession } from "../src/engine/session";
import { readTree } from "../src/import/fonts";
import { type Intake, intake } from "../src/import/intake";
import { assertNoText, buildRequest } from "../src/import/naming";
import { bodyOf, bodyOfText, buildTree, readBody } from "../src/import/parse";
import { probe, probeUses } from "../src/import/probe";
import { reference } from "../src/import/reference";
import { isRefusal } from "../src/import/refusal";
import { keysOf, signatures } from "../src/import/signatures";
import { FontLibrary } from "../src/page/fonts";
import { TexLiveIndex } from "../src/page/texlive";
import { FileAnswerCache } from "./answer-cache";
import {
  answerDocument,
  costOf,
  LIST_PRICES,
  missingNames,
  type NameRow,
  nameLine,
  nameTable,
  namingConfig,
} from "./corpus-name";

// Every template, document, request, answer and key here is invented, and no test calls a
// provider: the model is the AI SDK's mock, which answers what each test gives it.

type Result = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

/** A reply the mock gives: a text, and the tokens it counts. */
function reply(text: string): Result {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: { total: 1200, noCache: 1000, cacheRead: 200, cacheWrite: undefined },
      outputTokens: { total: 400, text: 300, reasoning: 100 },
    },
    warnings: [],
  };
}

/** A mock that answers every call with `naming`. */
const answering = (naming: unknown) =>
  new MockLanguageModelV4({ doGenerate: async () => reply(JSON.stringify(naming)) });

/** A mock that must not be asked. */
const idle = () =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("the model was asked");
    },
  });

const made: string[] = [];

/** A new empty folder under the system's temporary one, removed after the test. */
function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "resume-tools-name-"));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A cache over two new folders, as the runner's is over the committed answers and the ignored. */
const freshCache = () => new FileAnswerCache({ committed: folder(), writable: folder() });

const TEXTS = {
  cvsection: "macro:#1->\\section *{#1}",
  cventry: "macro:#1#2->\\cv@row {#1}{#2}",
  "cv@row": "macro:#1#2->\\textbf {#1}\\hfill #2",
};

/** An invented request: a section, an entry that hands its work to a row, and a data macro. */
async function inventedRequest(): Promise<NamingRequest> {
  const hash = {
    cvsection: await sha256(TEXTS.cvsection),
    cventry: await sha256(TEXTS.cventry),
    "cv@row": await sha256(TEXTS["cv@row"]),
  };
  const argument = (index: number) => ({ index, kind: "mandatory", verdict: "editable" });
  return NamingRequest.parse({
    version: NAMING_VERSION,
    engine: "pdftex",
    preamble: { settings: ["\\usepackage[margin=1in]{geometry}"] },
    macros: [
      {
        of: "command",
        name: "cvsection",
        signature: "m",
        key: await keyOf(NAMING_VERSION, hash.cvsection, []),
        dependencies: [],
        capped: false,
        arguments: [argument(1)],
        sites: [{ arguments: ["Xxxxxxxxxx"] }],
        calls: 1,
      },
      {
        of: "command",
        name: "cventry",
        signature: "m m",
        key: await keyOf(NAMING_VERSION, hash.cventry, [["cv@row", hash["cv@row"]]]),
        dependencies: ["cv@row"],
        capped: false,
        arguments: [argument(1), argument(2)],
        sites: [{ arguments: ["Xxxxxxxx Xxxx", "0000"] }],
        calls: 2,
      },
      {
        of: "command",
        name: "cvdata",
        signature: "",
        dependencies: [],
        capped: false,
        arguments: [],
        sites: [{ arguments: [] }],
        calls: 1,
      },
    ],
    definitions: [
      { kind: "definition", name: "cvsection", hash: hash.cvsection, text: TEXTS.cvsection },
      { kind: "definition", name: "cventry", hash: hash.cventry, text: TEXTS.cventry },
      { kind: "definition", name: "cv@row", hash: hash["cv@row"], text: TEXTS["cv@row"] },
      { kind: "data", name: "cvdata" },
    ],
  });
}

/** An invented answer to the invented request. */
const NAMING: ModelNaming = {
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
          { index: 2, meaning: "dates", slot: "dates", blank: "empty" },
        ],
        repeatable: true,
      },
    },
  ],
  preamble: { parameters: [{ parameter: "margins", setting: 0, command: "usepackage" }] },
};

const passes = () => undefined;

describe("answering a document's request", () => {
  test("counts what the cache does not answer missing, and asks nothing, without a model", async () => {
    const request = await inventedRequest();
    const answered = await answerDocument(request, { cache: freshCache(), gate: passes });
    expect(answered).toEqual({
      macros: 2,
      hits: { reviewed: 0, model: 0 },
      asked: 0,
      stored: 0,
      missing: ["\\cvsection", "\\cventry"],
      calls: 0,
      tokens: { input: 0, cached: 0, output: 0 },
    });
  });

  test("asks the model for what the cache does not answer, stores it, and hits it next time", async () => {
    const request = await inventedRequest();
    const cache = freshCache();
    // A person's reviewed answer for the section, as the committed folder holds the seed's.
    const [section] = NAMING.macros;
    const reviewed = {
      version: NAMING_VERSION,
      key: request.macros[0]?.key,
      hash: await sha256(TEXTS.cvsection),
      of: "command",
      name: "cvsection",
      answer: { ...section?.answer, reviewed: true },
      reviewed: true,
      source: "seed",
    };
    writeFileSync(join(cache.committed, `${reviewed.key}.json`), JSON.stringify(reviewed));
    const model = answering({ ...NAMING, macros: NAMING.macros.slice(1) });
    const answered = await answerDocument(request, {
      cache,
      gate: passes,
      model: { model, id: "invented-model" },
    });
    expect(answered).toEqual({
      macros: 2,
      hits: { reviewed: 1, model: 0 },
      asked: 1,
      stored: 1,
      missing: [],
      calls: 1,
      tokens: { input: 1200, cached: 200, output: 400 },
    });
    // Only the macro the cache did not answer was asked, and its answer filed under its key.
    const user = model.doGenerateCalls[0]?.prompt.find((message) => message.role === "user");
    const asked = JSON.stringify(user?.content);
    expect(asked).toContain('### command \\"cventry\\"');
    expect(asked).not.toContain('### command \\"cvsection\\"');
    const key = request.macros[1]?.key ?? "";
    expect(readdirSync(cache.writable)).toEqual([`${key}.json`]);
    expect(
      StoredAnswer.parse(JSON.parse(readFileSync(join(cache.writable, `${key}.json`), "utf8"))),
    ).toMatchObject({ key, name: "cventry", reviewed: false, source: "model:invented-model" });
    const again = await answerDocument(request, {
      cache,
      gate: passes,
      model: { model: idle(), id: "invented-model" },
    });
    expect(again).toMatchObject({ hits: { reviewed: 1, model: 1 }, asked: 0, calls: 0 });
  });

  test("asks nothing of a request the privacy gate refuses, or whose keys do not hold", async () => {
    const request = await inventedRequest();
    const model = idle();
    const refused = await answerDocument(request, {
      cache: freshCache(),
      gate: () => {
        throw new Error("The naming request holds the document's text (text) in setting 1.");
      },
      model: { model, id: "invented-model" },
    });
    expect(refused).toMatchObject({
      asked: 0,
      refused: "The naming request holds the document's text (text) in setting 1.",
      missing: ["\\cvsection", "\\cventry"],
    });
    // A definition changed after its hash was taken: the macros that name it would file an answer
    // under a key their definitions do not give.
    const changed = structuredClone(request);
    const row = changed.definitions.find((each) => each.name === "cv@row");
    if (row?.kind === "definition") row.text = `${row.text} `;
    const keys = await answerDocument(changed, {
      cache: freshCache(),
      gate: passes,
      model: { model, id: "invented-model" },
    });
    expect(keys.refused).toBe("The request's keys do not hold: definition \\cv@row (hash).");
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  test("stores nothing when the model's answer never validates, and says why", async () => {
    const request = await inventedRequest();
    const cache = freshCache();
    const answered = await answerDocument(request, {
      cache,
      gate: passes,
      model: { model: answering({ ...NAMING, macros: [] }), id: "invented-model" },
    });
    expect(answered).toMatchObject({
      asked: 2,
      stored: 0,
      calls: 2,
      failed: { reason: "invalid" },
      missing: ["\\cvsection", "\\cventry"],
    });
    expect(answered.failed?.message).toContain('no answer for command "cvsection"');
    expect(readdirSync(cache.writable)).toEqual([]);
  });
});

describe("the runner's configuration and prices", () => {
  test("takes the key under either name and the model's id from NAMING_MODEL", () => {
    expect(namingConfig({})).toEqual({ id: DEFAULT_MODEL });
    expect(DEFAULT_MODEL).toBe("gemini-3.8-flash");
    expect(namingConfig({ GEMINI_API_KEY: " invented-key " })).toEqual({
      key: "invented-key",
      id: DEFAULT_MODEL,
    });
    expect(
      namingConfig({
        GEMINI_API_KEY: "",
        GOOGLE_GENERATIVE_AI_API_KEY: "another-invented-key",
        NAMING_MODEL: "gemini-3.7-flash",
      }),
    ).toEqual({ key: "another-invented-key", id: "gemini-3.7-flash" });
  });

  test("estimates the cost of tokens at the default model's list price, with the day it was read", () => {
    const price = LIST_PRICES[DEFAULT_MODEL];
    expect(price?.read).toBe("2026-09-27");
    if (price === undefined) return;
    // 800,000 fresh tokens in, 200,000 from the cache, and 100,000 out.
    expect(costOf({ input: 1_000_000, cached: 200_000, output: 100_000 }, price)).toBeCloseTo(
      0.6 + 0.015 + 0.375,
      10,
    );
  });
});

describe("the runner's table", () => {
  const rows: NameRow[] = [
    {
      id: "jake-0001",
      family: "jake",
      outcome: "requested",
      engine: "pdftex",
      macros: 5,
      hits: { reviewed: 5, model: 0 },
      asked: 0,
      stored: 0,
      missing: [],
      calls: 0,
      tokens: { input: 0, cached: 0, output: 0 },
    },
    {
      id: "jake-0002",
      family: "jake",
      outcome: "requested",
      engine: "pdftex",
      macros: 6,
      hits: { reviewed: 4, model: 0 },
      asked: 2,
      stored: 2,
      missing: [],
      calls: 1,
      tokens: { input: 12_000, cached: 4000, output: 3000 },
    },
    {
      id: "altacv-0001",
      family: "altacv",
      outcome: "requested",
      engine: "pdftex",
      macros: 5,
      hits: { reviewed: 3, model: 0 },
      asked: 0,
      stored: 0,
      missing: ["\\cvevent", "\\cvtag"],
      refused: "The naming request holds the document's text (text) in setting 3.",
      calls: 0,
      tokens: { input: 0, cached: 0, output: 0 },
    },
    {
      id: "other-0001",
      family: "other",
      outcome: "requested",
      engine: "xetex",
      macros: 3,
      hits: { reviewed: 0, model: 1 },
      asked: 2,
      stored: 0,
      missing: ["\\cvevent", "cvlist (environment)"],
      failed: { reason: "invalid", message: "The model's answer did not validate after a retry" },
      calls: 2,
      tokens: { input: 8000, cached: 0, output: 1000 },
    },
    { id: "other-0002", family: "other", outcome: "no reference" },
    { id: "awesome-cv-0001", family: "awesome-cv", outcome: "timeout" },
  ];

  test("adds up each family's documents, answers, refusals, calls and tokens", () => {
    const table = nameTable(rows, DEFAULT_MODEL);
    expect(table).toContain(
      "|  | jake | awesome-cv | altacv | moderncv | europecv | other | all |",
    );
    expect(table).toContain("| Documents | 2 | 1 | 1 | 0 | 0 | 2 | 6 |");
    expect(table).toContain("| Requests built | 2 | 0 | 1 | 0 | 0 | 1 | 4 |");
    expect(table).toContain(
      "| Named: every macro and environment answered | 2 | 0 | 0 | 0 | 0 | 0 | 2 |",
    );
    expect(table).toContain("| Macros and environments to answer | 11 | 0 | 5 | 0 | 0 | 3 | 19 |");
    expect(table).toContain("| Answered from the cache: reviewed | 9 | 0 | 3 | 0 | 0 | 0 | 12 |");
    expect(table).toContain("| Answered from the cache: the model's | 0 | 0 | 0 | 0 | 0 | 1 | 1 |");
    expect(table).toContain("| Asked of the model now | 2 | 0 | 0 | 0 | 0 | 2 | 4 |");
    expect(table).toContain("| Stored now | 2 | 0 | 0 | 0 | 0 | 0 | 2 |");
    expect(table).toContain("| Asked, and not stored | 0 | 0 | 0 | 0 | 0 | 2 | 2 |");
    expect(table).toContain(
      "| Of them, invalid: the answer never validated | 0 | 0 | 0 | 0 | 0 | 2 | 2 |",
    );
    expect(nameLine(rows[3] as NameRow)).toContain("2 asked, 0 stored, 2 invalid; 2 calls");
    expect(table).toContain("| Missing: no answer | 0 | 0 | 2 | 0 | 0 | 2 | 4 |");
    expect(table).toContain("| Requests the privacy gate refused | 0 | 0 | 1 | 0 | 0 | 0 | 1 |");
    expect(table).toContain("| Model calls | 1 | 0 | 0 | 0 | 0 | 2 | 3 |");
    expect(table).toContain("| Input tokens | 12000 | 0 | 0 | 0 | 0 | 8000 | 20000 |");
    // The headline: documents named, macros answered, calls, tokens, and the cost at list price.
    const cost = costOf(
      { input: 20_000, cached: 4000, output: 4000 },
      LIST_PRICES[DEFAULT_MODEL] ?? { read: "", input: 0, cached: 0, output: 0 },
    );
    expect(table).toContain(
      `2 of 4 documents named; 15 macros answered, 2 of them by the model now; 3 model calls, 24000 tokens. About $${cost.toFixed(2)} at gemini-3.8-flash's list price, read 2026-09-27.`,
    );
    expect(table).toContain("Failed, by reason: invalid 1.");
    expect(table).toContain(
      "Missing, by the documents missing it: \\cvevent 2, \\cvtag 1, cvlist (environment) 1.",
    );
    expect(missingNames(rows)[0]).toEqual(["\\cvevent", 2]);
  });

  test("says no model was asked, without one, and prints a row as names and numbers", () => {
    expect(nameTable(rows)).toContain("No model was asked: --model asks it, with a key.");
    expect(nameTable(rows, "invented-model")).toContain(
      "No list price is recorded for invented-model.",
    );
    expect(nameLine(rows[1] as NameRow)).toBe(
      "pdftex, 6 macros, 4 from the cache; 2 asked, 2 stored, 0 invalid; 1 call, 12000 tokens in (4000 cached), 3000 out",
    );
    expect(nameLine(rows[2] as NameRow)).toBe(
      "pdftex, 5 macros, 3 from the cache; refused: The naming request holds the document's text (text) in setting 3.; 2 missing: \\cvevent, \\cvtag",
    );
    expect(nameLine(rows[5] as NameRow)).toBe("timeout");
  });
});

describe("the name command", () => {
  const SCRIPT = fileURLToPath(new URL("./corpus.ts", import.meta.url));
  /** The command, run with no naming key in its environment, whatever this machine's has. */
  const run = (env: Record<string, string>, ...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, GEMINI_API_KEY: "", GOOGLE_GENERATIVE_AI_API_KEY: "", ...env },
    });

  test("refuses to ask a model with no key, or one no source can name, before anything else", () => {
    const keyless = run({}, "name", "--model");
    expect(keyless.status).toBe(1);
    expect(keyless.stderr).toContain("name --model asks Gemini, which needs a key");
    const badId = run(
      { GEMINI_API_KEY: "invented-key", NAMING_MODEL: "an id with spaces" },
      "name",
      "--model",
    );
    expect(badId.status).toBe(1);
    expect(badId.stderr).toContain("NAMING_MODEL is not a model's id");
    expect(run({}, "probe", "--model").stderr).toContain("--model goes with name");
    expect(run({}, "--help").stdout).toContain("| name [--only <id>] [--json <file>] [--model]");
  });
});

describe.skipIf(!engineAvailable())("corpus name, on the invented pdfTeX document", () => {
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

  /** The invented class and document of `naming.test.ts`'s end-to-end requests. */
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

  /** A fixed answer for the invented class's macros, as a model would give it. */
  const FIXED: ModelNaming = {
    macros: [
      {
        of: "command",
        name: "cvname",
        answer: {
          kind: "header",
          arguments: [
            { index: 1, meaning: "title", slot: "first", blank: "empty" },
            { index: 2, meaning: "title", slot: "last", blank: "empty" },
          ],
          repeatable: false,
        },
      },
      {
        of: "command",
        name: "cvheader",
        answer: { kind: "header", arguments: [], repeatable: false },
      },
      {
        of: "command",
        name: "cvplain",
        answer: {
          kind: "paragraph",
          arguments: [{ index: 1, meaning: "text", slot: "text", blank: "empty" }],
          repeatable: false,
        },
      },
      {
        of: "command",
        name: "cvmail",
        answer: {
          kind: "contact",
          contact: "email",
          arguments: [{ index: 1, meaning: "text", slot: "text", blank: "empty" }],
          repeatable: false,
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
      {
        of: "command",
        name: "cvgap",
        answer: {
          kind: "layout",
          arguments: [{ index: 1, meaning: "length", blank: "kept" }],
          repeatable: false,
        },
      },
    ],
    preamble: { parameters: [] },
  };

  /** The invented upload through the pipeline to its request, as the runner's child takes it. */
  async function requested() {
    const main = `\\documentclass{inventedprobe}\n\\cvname{Quill}{Invented}\n${BODY}`;
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
    const built = buildTree(read, found);
    if (isRefusal(built)) throw new Error(built.message);
    const probed = await probe(session, fonts, taken, made, built, found);
    const request = await buildRequest(built, found, probed, body.preamble);
    const stored = probed.candidates
      .filter((each) => each.where === "preamble")
      .map((each) => each.text);
    return { request, found, document: { tree: built, stored } };
  }

  test("stores a fixed model answer under the keys item 4 gives, and hits it the next time", async () => {
    const { request, found, document } = await requested();
    expect(request.macros.map((macro) => `${macro.of} ${macro.name}`)).toEqual(
      FIXED.macros.map((macro) => `${macro.of} ${macro.name}`),
    );
    const cache = freshCache();
    const model = answering(FIXED);
    const answered = await answerDocument(request, {
      cache,
      gate: () => assertNoText(request, document),
      model: { model, id: "invented-model" },
    });
    expect(answered).toMatchObject({ macros: 7, asked: 7, stored: 7, missing: [], calls: 1 });
    expect(answered.refused).toBeUndefined();
    expect(answered.failed).toBeUndefined();
    // Each answer is filed under its macro's key, the one its definitions give; a command's whose
    // definition the document's text left alone is the one item 4 gives, which a fork's request
    // finds. `\cvgap`'s holds the invented last name, which the request masks, so its key is the
    // document's own (decision 0024).
    const keys = await keysOf(found);
    const filed = readdirSync(cache.writable).map((file) => file.replace(/\.json$/, ""));
    const expected: string[] = [];
    for (const macro of request.macros) {
      const key = await requestKey(request, macro);
      expect(macro.key, macro.name).toBe(key);
      if (macro.of === "command")
        expect(key === keys[macro.name], macro.name).toBe(macro.name !== "cvgap");
      expected.push(key ?? "");
      const answer = StoredAnswer.parse(
        JSON.parse(readFileSync(join(cache.writable, `${key}.json`), "utf8")),
      );
      expect(answer).toMatchObject({ key, name: macro.name, of: macro.of, reviewed: false });
    }
    expect(filed.sort()).toEqual(expected.sort());
    const again = await answerDocument(request, {
      cache,
      gate: () => assertNoText(request, document),
      model: { model: idle(), id: "invented-model" },
    });
    expect(again).toMatchObject({ hits: { reviewed: 0, model: 7 }, asked: 0, calls: 0 });
  }, 60_000);
});
