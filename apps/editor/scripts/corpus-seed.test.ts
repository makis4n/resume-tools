import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  answerFor,
  type Dependency,
  keyOf,
  NAMING_VERSION,
  StoredAnswer,
} from "@resume-tools/naming";
import { describe, expect, test } from "vitest";
import type { EngineManifest } from "../src/engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../src/engine/node";
import { type Candidate, candidatesOf, isSetter } from "../src/import/candidates";
import { readTree } from "../src/import/fonts";
import { type Intake, intake } from "../src/import/intake";
import * as keysModule from "../src/import/keys";
import {
  buildRequest,
  type HeaderValues,
  type PageStrings,
  pageReadable,
  pageStrings,
  sourcesOf,
  withRedefinitions,
} from "../src/import/naming";
import { bodyOf, bodyOfText, buildTree, readBody } from "../src/import/parse";
import { PROBE_PRELUDE, type ProbeCandidate, probeUses } from "../src/import/probe";
import {
  compileLikeReference,
  difference,
  type GlyphStream,
  reference,
} from "../src/import/reference";
import { isRefusal } from "../src/import/refusal";
import { signatures } from "../src/import/signatures";
import { FontLibrary } from "../src/page/fonts";
import { TexLiveIndex } from "../src/page/texlive";
import { MARKER_BEGIN, MARKER_END } from "../src/tex/fields";
import { checkCorpus } from "./corpus-leak";
import {
  CORPUS_DIR,
  FETCH_REPORT_FILE,
  FetchReport,
  isLive,
  MANIFEST_FILE,
  Manifest,
  matchingEntries,
  parseJson,
} from "./corpus-manifest";
import { ORACLE_DIR, ORACLE_FILE, Oracle, oracleDocument } from "./corpus-oracle";
import { treeFonts, uploadOf } from "./corpus-reference";
import {
  ANSWERS_DIR,
  answerState,
  answersFolder,
  commandAnswers,
  type Filed,
  filingOf,
  formatAnswer,
  headerOf,
  keyOfFile,
  partnersOf,
  redefinitionsOf,
  SEED_EXTRAS,
  type SeedMacro,
  type SeedRow,
  seedMacros,
  seedPlan,
  seedStates,
  seedTable,
} from "./corpus-seed";

// The macros, keys and answers here are invented, but for the blocks that read the committed
// seed's, and those that run it on the oracle's samples when a machine has fetched them.

const KEY = "a".repeat(64);
const HASH = "b".repeat(64);

/** What an invented macro's answer is filed under: its key, from its hash and no dependencies. */
const filing = async (hash: string, dependencies: Dependency[] = []): Promise<Filed> => ({
  key: await keyOf(NAMING_VERSION, hash, dependencies),
  hash,
  dependencies,
});

/** An invented macro as the seed checks it, filed under its own key. */
const macro = (extra: Partial<SeedMacro> = {}): SeedMacro => ({
  of: "command",
  name: "cventry",
  hash: HASH,
  key: KEY,
  filed: { key: KEY, hash: HASH, dependencies: [] },
  signature: "m m",
  arguments: [
    { index: 1, kind: "mandatory", verdict: "editable" },
    { index: 2, kind: "mandatory", verdict: "twice" },
  ],
  calls: 2,
  extra: false,
  ...extra,
});

/** An invented stored answer, as the seed files one, as JSON. */
const stored = (extra: Record<string, unknown> = {}, answer: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: NAMING_VERSION,
    key: KEY,
    hash: HASH,
    of: "command",
    name: "cventry",
    family: "jake",
    answer: {
      kind: "entry",
      arguments: [
        { index: 1, meaning: "title", slot: "title" },
        { index: 2, meaning: "text", slot: "place" },
      ],
      repeatable: true,
      reviewed: true,
      ...answer,
    },
    reviewed: true,
    source: "seed",
    ...extra,
  });

describe("the seed's check of an answer", () => {
  test("takes an answer filed under its key, for its name, with its hash", async () => {
    expect(await answerState(macro(), () => stored())).toEqual({ state: "ok" });
  });

  test("names what is wrong, and never needs an answer for a macro that holds data", async () => {
    const state = async (each: SeedMacro, read: (key: string) => string | undefined) =>
      (await answerState(each, read)).state;
    expect(await state(macro(), () => undefined)).toBe("missing");
    expect(await state(macro(), () => "{")).toBe("invalid");
    expect(await state(macro(), () => stored({ reviewed: false }))).toBe("invalid");
    expect(await state(macro(), () => stored({ key: "c".repeat(64) }))).toBe("key");
    expect(await state(macro(), () => stored({ hash: "c".repeat(64) }))).toBe("hash");
    expect(await state(macro(), () => stored({ name: "cvitem" }))).toBe("name");
    expect(await state(macro(), () => stored({ of: "environment" }))).toBe("name");
    expect(await state(macro({ key: undefined, hash: undefined }), () => undefined)).toBe("data");
    // Dependencies that do not give the key it is filed under.
    expect(await state(macro(), () => stored({ dependencies: [["cvrow", HASH]] }))).toBe("key");
    // A reason a schema gives names the field, never a text.
    expect((await answerState(macro(), () => stored({}, { kind: "chapter" }))).why).toMatch(
      /^answer/,
    );
  });

  test("finds a key a document's values moved off what its answer is filed under", async () => {
    const moved = macro({ filed: { key: "c".repeat(64), hash: HASH, dependencies: [] } });
    expect(await answerState(moved, () => stored())).toEqual({
      state: "moved",
      why: "filed under item 4's cccccccccccc",
    });
    expect((await answerState(macro({ filed: undefined }), () => stored())).state).toBe("moved");
  });

  test("finds a list's partner among the sample's macros by the key its answer holds", async () => {
    const opens = { list: { does: "opens", closedBy: "cvlistend", holds: "bullet" } };
    const list = { kind: "bulletList", arguments: [], repeatable: false };
    const closer = "d".repeat(64);
    const answer = stored({ partnerKeys: { closedBy: closer } }, { ...list, ...opens });
    const partners = (key: string) =>
      new Map([
        ["cventry", KEY],
        ["cvlistend", key],
      ]);
    expect(await answerState(macro(), () => answer, partners(closer))).toEqual({ state: "ok" });
    expect((await answerState(macro(), () => answer, partners("e".repeat(64)))).state).toBe(
      "partner",
    );
    // An answer that names its partner and holds no key for it.
    expect(
      (await answerState(macro(), () => stored({}, { ...list, ...opens }), partners(closer))).state,
    ).toBe("partner");
  });

  test("knows an answer file's key by its name", () => {
    expect(keyOfFile(`${KEY}.json`)).toBe(KEY);
    expect(keyOfFile(`${KEY}.txt`)).toBeUndefined();
    expect(keyOfFile("readme.json")).toBeUndefined();
  });

  test("gathers the redefinitions a request's answers carry, each once, and the macros they serve", () => {
    const latex = "\\renewcommand{\\cventry}[2]{#1}";
    const answers: Record<string, string> = {
      [KEY]: stored({}, { redefinitions: [{ name: "cventry", latex }] }),
      ["c".repeat(64)]: stored(
        { key: "c".repeat(64), name: "cvitem" },
        {
          redefinitions: [
            { name: "cventry", latex: "another" },
            { name: "cvitem", latex },
          ],
        },
      ),
    };
    const found = redefinitionsOf(
      [
        { of: "command", name: "cventry", key: KEY },
        { of: "command", name: "cvitem", key: "c".repeat(64) },
        { of: "command", name: "cvdata" },
      ],
      (key) => answers[key],
    );
    expect(found.redefinitions).toEqual([
      { name: "cventry", latex },
      { name: "cvitem", latex },
    ]);
    expect([...found.serving]).toEqual(["command|cventry", "command|cvitem"]);
  });

  test("tables each sample's macros, the answers no macro claims, and the problems", async () => {
    const rows: SeedRow[] = [
      {
        id: "jake-0000",
        family: "jake",
        outcome: "requested",
        engine: "pdftex",
        macros: [
          macro(),
          macro({
            name: "cvitem",
            key: "c".repeat(64),
            filed: { key: "c".repeat(64), hash: HASH, dependencies: [] },
            extra: true,
            arguments: [],
          }),
          macro({ name: "cvname", key: undefined, hash: undefined, filed: undefined }),
          macro({
            name: "cvhead",
            key: "e".repeat(64),
            filed: { key: "f".repeat(64), hash: HASH, dependencies: [] },
          }),
          macro({ of: "environment", name: "cvlist", key: undefined, hash: undefined }),
        ],
        redefinitions: {
          names: ["cventry"],
          regenerated: "keeps",
          raw: "position",
          placed: "preamble",
        },
      },
      { id: "altacv-0000", family: "altacv", outcome: "no reference" },
    ];
    const read = (key: string) => (key === KEY ? stored() : undefined);
    const { table, problems } = seedTable(rows, await seedStates(rows, read), [
      KEY,
      "d".repeat(64),
    ]);
    expect(problems).toBe(3);
    expect(table).toContain(
      "| jake | `\\cventry` | `bbbbbbbbbbbb` | `aaaaaaaaaaaa` | #1 editable, #2 twice | ok |",
    );
    expect(table).toContain("| jake | `\\cvitem` (not called) |");
    expect(table).toContain("no arguments | **missing** |");
    expect(table).toContain("| data |");
    expect(table).toContain(
      "| jake | `\\cvhead` | `bbbbbbbbbbbb` | `eeeeeeeeeeee`, item 4's `ffffffffffff` |",
    );
    expect(table).toContain("**moved** (filed under item 4's ffffffffffff) |");
    expect(table).toContain("| jake | `cvlist (environment)` |");
    expect(table).toContain("| altacv | no reference | | | | **missing** |");
    expect(table).toContain("Answer files no sample's macro claims: `dddddddddddd`.");
    expect(table).toContain(
      "jake: 1 redefinition (\\cventry) (placed before \\begin{document}); its calls they serve regenerated, with them against without them: keeps; the sample as it is, against its reference: moves it (position).",
    );
  });
});

describe("the header's values a sample gives", () => {
  /** Invented answers: a name of two arguments, a headline, a contact, a link, and a name given whole. */
  const answers: Record<string, unknown> = {
    cvname: {
      kind: "header",
      arguments: [
        { index: 1, meaning: "title", slot: "first" },
        { index: 2, meaning: "title", slot: "last" },
      ],
    },
    cvrole: { kind: "header", arguments: [{ index: 1, meaning: "title", slot: "headline" }] },
    cvmail: {
      kind: "contact",
      contact: "email",
      arguments: [{ index: 1, meaning: "text", slot: "text" }],
    },
    cvgit: {
      kind: "link",
      link: "github",
      arguments: [
        { index: 1, meaning: "icon" },
        { index: 2, meaning: "label", slot: "label" },
      ],
    },
    cvwhole: {
      kind: "header",
      arguments: [
        {
          index: 1,
          meaning: "title",
          parts: [
            { meaning: "title", slot: "first" },
            { meaning: "title", slot: "last" },
          ],
        },
      ],
    },
    cventry: { kind: "entry", arguments: [{ index: 1, meaning: "title", slot: "title" }] },
  };
  const answerOf = (name: string) => {
    const answer = answers[name];
    return answer === undefined
      ? undefined
      : StoredAnswer.parse(JSON.parse(stored({ name }, { repeatable: false, ...answer })));
  };
  const call = (name: string, index: number, text: string): Candidate => ({
    id: `c${name}${index}`,
    kind: "argument",
    where: "preamble",
    of: "call",
    name,
    index,
    start: 0,
    end: 0,
    text,
    empty: text.trim() === "",
  });

  test("reads each argument by the slot its macro's answer says it fills", () => {
    expect(
      headerOf(
        [
          call("cvname", 1, "Quill"),
          call("cvname", 2, "Invented"),
          call("cvrole", 1, "Invented Typesetter"),
          call("cvmail", 1, "quill@example.invalid"),
          call("cvgit", 1, "\\faGithub"),
          call("cvgit", 2, "quill-invented"),
          call("cvmail", 1, "wren@example.invalid"),
          call("cventry", 1, "Invented Role"),
          call("cvunknown", 1, "Harbour City"),
        ],
        answerOf,
      ),
    ).toEqual({
      first: "Quill",
      last: "Invented",
      headline: "Invented Typesetter",
      email: "quill@example.invalid",
      links: [{ label: "quill-invented" }],
    });
  });

  test("splits a name given whole before its last word, where the answer maps it to both", () => {
    expect(headerOf([call("cvwhole", 1, "Quill Wren Invented")], answerOf)).toEqual({
      first: "Quill Wren",
      last: "Invented",
    });
    expect(headerOf([call("cvwhole", 1, "Quill")], answerOf)).toEqual({ first: "Quill" });
  });

  test("reads AltaCV's name as its port writes it, the first name and the last", () => {
    // The committed seed's answer for AltaCV's `\name`, which takes the whole name and which the
    // port writes as `{{first}} {{last}}`.
    const folder = answersFolder();
    const altacv = folder.keys
      .map((key) => StoredAnswer.parse(JSON.parse(folder.read(key) ?? "")))
      .find((each) => each.family === "altacv" && each.name === "name");
    expect(altacv).toBeDefined();
    expect(headerOf([call("name", 1, "Quill Invented")], () => altacv)).toEqual({
      first: "Quill",
      last: "Invented",
    });
  });
});

describe("what `corpus seed --write` writes", () => {
  test("files each answer under its key, with its dependencies and its partners' keys", async () => {
    const opener = await filing("c".repeat(64), [["cvlist@gap", "d".repeat(64)]]);
    const closer = await filing("e".repeat(64));
    const list = { kind: "bulletList", arguments: [], repeatable: false };
    // The opener's file is under an older key, and found by its family, kind and name; the
    // closer's is under its key already, with no dependencies.
    const files: Record<string, string> = {
      ["f".repeat(64)]: stored(
        { key: "f".repeat(64), hash: opener.hash, name: "cvliststart" },
        { ...list, list: { does: "opens", closedBy: "cvlistend", holds: "bullet" } },
      ),
      [closer.key]: stored(
        { key: closer.key, hash: closer.hash, name: "cvlistend" },
        { ...list, list: { does: "closes", openedBy: "cvliststart" } },
      ),
    };
    const rows: SeedRow[] = [
      {
        id: "jake-0000",
        family: "jake",
        outcome: "requested",
        macros: [
          macro({ name: "cvliststart", key: opener.key, hash: opener.hash, filed: opener }),
          macro({ name: "cvlistend", key: closer.key, hash: closer.hash, filed: closer }),
        ],
      },
    ];
    const { writes, problems } = await seedPlan(rows, {
      read: (key) => files[key],
      keys: Object.keys(files),
    });
    expect(problems).toEqual([]);
    expect(writes.map(({ text: _, ...each }) => each)).toEqual([
      {
        family: "jake",
        of: "command",
        name: "cvliststart",
        from: "f".repeat(64),
        to: opener.key,
        changes: ["key", "dependencies", "partnerKeys"],
      },
      {
        family: "jake",
        of: "command",
        name: "cvlistend",
        from: closer.key,
        to: closer.key,
        changes: ["dependencies", "partnerKeys"],
      },
    ]);
    const [first, second] = writes.map((each) => JSON.parse(each.text));
    expect(first).toMatchObject({
      key: opener.key,
      dependencies: opener.dependencies,
      partnerKeys: { closedBy: closer.key },
    });
    expect(second).toMatchObject({ dependencies: [], partnerKeys: { openedBy: opener.key } });
    // What it writes validates, is served under its key, and is as Biome formats it.
    for (const each of writes) {
      expect(await answerFor({ get: () => each.text }, each.to)).toBeDefined();
      expect(formatAnswer(JSON.parse(each.text))).toBe(each.text);
    }
    // Written, there is nothing more to write.
    const after: Record<string, string> = Object.fromEntries(
      writes.map((each) => [each.to, each.text]),
    );
    const again = await seedPlan(rows, { read: (key) => after[key], keys: Object.keys(after) });
    expect(again).toEqual({ writes: [], problems: [] });
  });

  test("files an answer of an older naming version again, under this version's key", async () => {
    // What a bump of the naming version leaves: every file of the older version, under the key
    // the older version gave it, which its dependencies file again.
    const now = await filing("c".repeat(64), [["cvrow", "d".repeat(64)]]);
    const older = "0".repeat(64);
    const files: Record<string, string> = {
      [older]: stored({ version: NAMING_VERSION - 1, key: older, hash: now.hash, name: "cvrole" }),
    };
    const rows: SeedRow[] = [
      {
        id: "jake-0000",
        family: "jake",
        outcome: "requested",
        macros: [macro({ name: "cvrole", key: now.key, hash: now.hash, filed: now })],
      },
    ];
    const { writes, problems } = await seedPlan(rows, {
      read: (key) => files[key],
      keys: Object.keys(files),
    });
    expect(problems).toEqual([]);
    expect(writes.map((each) => [each.from, each.to, each.changes])).toEqual([
      [older, now.key, ["version", "key", "dependencies"]],
    ]);
    expect(await answerFor({ get: () => writes[0]?.text }, now.key)).toMatchObject({
      version: NAMING_VERSION,
      name: "cvrole",
    });
  });

  test("finds a moved key's answer among the seed's alone, never a reviewed fork's of its name", async () => {
    // What a tree's upgrade or a naming version's bump leaves: the sample's macro under a key no
    // file has. A fork's reviewed answer of the same family and name, filed after the seed's, is
    // another definition's, and is neither moved nor left out of the folder.
    const now = await filing("c".repeat(64), [["cvrow", "d".repeat(64)]]);
    const seed = "0".repeat(64);
    const fork = "1".repeat(64);
    const files: Record<string, string> = {
      [seed]: stored({ key: seed, hash: now.hash, name: "cvrole" }),
      [fork]: stored(
        { key: fork, hash: "e".repeat(64), name: "cvrole", source: "model:claude-opus-5-5" },
        { arguments: [{ index: 1, meaning: "title", slot: "title" }] },
      ),
    };
    const rows: SeedRow[] = [
      {
        id: "jake-0000",
        family: "jake",
        outcome: "requested",
        macros: [macro({ name: "cvrole", key: now.key, hash: now.hash, filed: now })],
      },
    ];
    const { writes, problems } = await seedPlan(rows, {
      read: (key) => files[key],
      keys: Object.keys(files),
    });
    expect(problems).toEqual([]);
    expect(writes.map((each) => [each.from, each.to])).toEqual([[seed, now.key]]);
    expect(JSON.parse(writes[0]?.text ?? "{}").answer.arguments).toHaveLength(2);
    // Two seed answers of one name stand for neither: it says so, and writes nothing.
    const twice = { ...files, [fork]: stored({ key: fork, hash: "e".repeat(64), name: "cvrole" }) };
    const ambiguous = await seedPlan(rows, {
      read: (key) => twice[key],
      keys: Object.keys(twice),
    });
    expect(ambiguous).toEqual({
      writes: [],
      problems: [
        "jake `\\cvrole`: more than one seed answer of its family and name, none under its key",
      ],
    });
  });

  test("says what it cannot write: a macro with no answer, or a partner the sample has not", async () => {
    const opener = await filing("c".repeat(64));
    const files: Record<string, string> = {
      [opener.key]: stored(
        { key: opener.key, hash: opener.hash, name: "cvliststart" },
        {
          kind: "bulletList",
          arguments: [],
          repeatable: false,
          list: { does: "opens", closedBy: "cvlistend", holds: "bullet" },
        },
      ),
    };
    const rows: SeedRow[] = [
      {
        id: "jake-0000",
        family: "jake",
        outcome: "requested",
        macros: [
          macro({ name: "cvliststart", key: opener.key, hash: opener.hash, filed: opener }),
          macro({ name: "cvrow", key: "9".repeat(64), filed: await filing("9".repeat(64)) }),
        ],
      },
    ];
    const { problems } = await seedPlan(rows, {
      read: (key) => files[key],
      keys: Object.keys(files),
    });
    expect(problems).toEqual([
      "jake `\\cvliststart`: its list names a macro the sample gives no key",
      `jake \`\\cvrow\`: no answer to file under ${(await filing("9".repeat(64))).key.slice(0, 12)}`,
    ]);
  });
});

describe("the committed answers", () => {
  const files = readdirSync(ANSWERS_DIR).filter((name) => name.endsWith(".json"));

  test("each validate, and are served under the key their file is named by", async () => {
    // What a naming version's bump, or a change to the contract, would break for every one, which
    // no test that needs the engine or the oracle would see in CI.
    expect(files.length).toBeGreaterThanOrEqual(65);
    for (const file of files) {
      const key = keyOfFile(file);
      expect(key, file).toBeDefined();
      const text = readFileSync(join(ANSWERS_DIR, file), "utf8");
      const parsed = StoredAnswer.safeParse(JSON.parse(text));
      expect(parsed.success, `${file}: ${parsed.error?.issues[0]?.message ?? ""}`).toBe(true);
      // Every committed answer is reviewed: the seed's, a person's, or the review model's, which
      // names that model as its source (decision 0037); a naming model's is never committed.
      expect(parsed.data?.reviewed, file).toBe(true);
      expect(parsed.data?.source, file).toMatch(/^(?:seed|model:.+)$/);
      expect(
        await answerFor({ get: (asked) => (asked === key ? text : undefined) }, key ?? ""),
        file,
      ).toBeDefined();
      // As `corpus seed --write` writes it: Biome's format, the dependencies its key is computed
      // from, which `answerFor` checks, and its list's partners by their keys.
      expect(formatAnswer(JSON.parse(text)), file).toBe(text);
      expect(parsed.data?.dependencies, file).toBeDefined();
      for (const which of ["closedBy", "openedBy"] as const)
        if (parsed.data?.answer.list?.[which] !== undefined)
          expect(parsed.data.partnerKeys?.[which], `${file} ${which}`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("pair each command that opens a list with a closer of the seed, by name and by key", () => {
    const answers = files.map((file) =>
      StoredAnswer.parse(JSON.parse(readFileSync(join(ANSWERS_DIR, file), "utf8"))),
    );
    const byKey = new Map(answers.map((each) => [each.key, each]));
    for (const opener of answers) {
      const closedBy = opener.answer.list?.closedBy;
      if (opener.of !== "command" || opener.answer.list?.does !== "opens") continue;
      // The closer is found by the key the opener holds for it, not by its name: one family can
      // commit several definitions of a list's two macros under the same names (Jake's forks).
      const closer = byKey.get(opener.partnerKeys?.closedBy ?? "");
      expect(closer, `${opener.name} ${opener.key}`).toBeDefined();
      expect(closer?.of, closedBy).toBe("command");
      expect(closer?.name, closedBy).toBe(closedBy);
      expect(closer?.answer.list, closedBy).toEqual({ does: "closes", openedBy: opener.name });
      // A closer holds one opener's key. Where several openers of one name share its definition,
      // it names one of them, an opener of the same name that holds the closer's key back; the
      // others pair with it by name, as `answerFor` pairs a partner the request has no key of.
      const back = byKey.get(closer?.partnerKeys?.openedBy ?? "");
      expect(back?.name, `${closedBy} ${closer?.key}`).toBe(opener.name);
      expect(back?.of, `${closedBy} ${closer?.key}`).toBe("command");
      expect(back?.partnerKeys?.closedBy, `${closedBy} ${closer?.key}`).toBe(closer?.key);
      // A closer is of its opener's kind.
      expect(closer?.answer.kind, closedBy).toBe(opener.answer.kind);
    }
    // And every closer is named back by the opener it holds the key of.
    for (const closer of answers) {
      if (closer.of !== "command" || closer.answer.list?.does !== "closes") continue;
      const opener = byKey.get(closer.partnerKeys?.openedBy ?? "");
      expect(opener?.name, `${closer.name} ${closer.key}`).toBe(closer.answer.list.openedBy);
      expect(opener?.partnerKeys?.closedBy, `${closer.name} ${closer.key}`).toBe(closer.key);
    }
  });
});

/** Whether this machine has fetched the oracle's samples, which `corpus oracle` fetches. */
const fetched = existsSync(join(ORACLE_DIR, "jake-0000", "resume.tex"));
if (!fetched)
  console.info(
    "The seed's check of the oracle's samples is skipped: .corpus/oracle/ is absent, and `corpus oracle` fetches it",
  );

describe.skipIf(!fetched || !engineAvailable())("the seed, on the oracle's samples", () => {
  const oracle = Oracle.parse(JSON.parse(readFileSync(ORACLE_FILE, "utf8")));
  const manifest = JSON.parse(
    readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
  ) as EngineManifest;

  const pipelines = new Map<string, ReturnType<typeof takePipeline>>();

  /** A sample as the pipeline takes it (`takePipeline`), once for the file's tests. */
  function pipeline(id: string) {
    const taken = pipelines.get(id) ?? takePipeline(id);
    pipelines.set(id, taken);
    return taken;
  }

  /**
   * A sample as the pipeline takes it, but with no probe: the reference, the signatures, the tree,
   * its candidates as the probe finds them with no verdicts, which the seed's keys do not depend
   * on, and what each macro's answer is filed under. `change` rewrites its main file, all of what
   * it adds invented.
   */
  async function takePipeline(id: string, change?: (text: string) => string) {
    const doc = oracle.documents.find((each) => each.id === id);
    if (doc === undefined) throw new Error(`${id} is no oracle sample`);
    const session = await startNodeSession();
    const fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    const zip = uploadOf(
      oracleDocument(doc),
      (path) => {
        const bytes = new Uint8Array(readFileSync(join(ORACLE_DIR, doc.id, ...path.split("/"))));
        if (change === undefined || path !== doc.main) return bytes;
        const text = new TextDecoder().decode(bytes);
        const changed = change(text);
        if (changed === text) throw new Error(`the change leaves ${id}'s main file as it is`);
        return new TextEncoder().encode(changed);
      },
      () => undefined,
    );
    const taken = intake(
      { name: `${id}.zip`, bytes: zip },
      { tree: readTree(manifest.files, manifest.fonts) },
    );
    if (isRefusal(taken)) throw new Error(taken.message);
    const made = await reference(session, fonts, taken as Intake);
    if (isRefusal(made)) throw new Error(made.message);
    const body = bodyOf(taken);
    if (isRefusal(body)) throw new Error(body.message);
    const read = readBody(body);
    if (isRefusal(read)) throw new Error(read.message);
    const head = readBody(bodyOfText(body.preamble));
    const extras = SEED_EXTRAS[doc.family];
    const uses = probeUses(read, isRefusal(head) ? undefined : head);
    const found = await signatures(session, taken, made, body, {
      commands: [...new Set([...uses.commands, ...(extras?.commands ?? [])])].sort(),
      environments: [...new Set([...uses.environments, ...(extras?.environments ?? [])])].sort(),
    });
    if (isRefusal(found)) throw new Error(found.message);
    const built = buildTree(read, found);
    if (isRefusal(built)) throw new Error(built.message);
    const setters = new Set(
      Object.entries(found.commands)
        .filter(([name, each]) => each.kind === "template" && isSetter(found.macros[name]))
        .map(([name]) => name),
    );
    const preamble = isRefusal(head) ? undefined : buildTree(head, found);
    const { candidates } = candidatesOf(built, {
      ...(preamble === undefined || isRefusal(preamble) ? {} : { preamble }),
      setters,
    });
    const probed: ProbeCandidate[] = candidates.map((each) => ({
      ...each,
      verdict: "untested",
      settled: "budget",
    }));
    // The upload's sources, which say which definitions are the sample's own, its class among them,
    // and the page's strings, which mask those as the body's text does.
    const options = {
      ...(extras === undefined ? {} : { also: extras }),
      sources: sourcesOf(taken),
      page: await pageStrings(made, fonts, taken.files),
    };
    /**
     * The sample's request, with the header's values given, more stored values, and another page's
     * strings in place of its own, as a fork that ships the class unchanged shows its page.
     */
    const request = async (
      header?: HeaderValues,
      stored: readonly string[] = [],
      page: PageStrings = options.page,
    ) => {
      const result = await buildRequest(
        built,
        found,
        {
          macros: [],
          candidates: [
            ...probed,
            ...stored.map(
              (text, i): ProbeCandidate => ({
                id: `hx${i}`,
                kind: "paragraph",
                where: "preamble",
                name: "",
                start: 0,
                end: 0,
                text,
                empty: false,
                verdict: "untested",
                settled: "budget",
              }),
            ),
          ],
        },
        body.preamble,
        { ...options, ...(header === undefined ? {} : { header }), page },
      );
      if ("refused" in result) throw new Error(result.message);
      return result.request;
    };
    const filed = await filingOf(found, keysModule);
    return { doc, session, fonts, taken, made, candidates, extras, request, filed, found };
  }

  /** A sample's request as the seed checks it, with the header's values its own calls give. */
  async function seeded(id: string) {
    const sample = await pipeline(id);
    const folder = answersFolder();
    const plain = await sample.request();
    const header = headerOf(sample.candidates, commandAnswers(plain, folder.read));
    const request = await sample.request(header);
    return {
      ...sample,
      plain: seedMacros(plain, sample.filed, sample.extras),
      macros: seedMacros(request, sample.filed, sample.extras),
      header,
    };
  }

  /** Every key a sample's macros are asked by is item 4's, and each has its answer, as filed. */
  async function checkSeeded(macros: readonly SeedMacro[]) {
    const folder = answersFolder();
    expect(macros.length).toBeGreaterThan(5);
    const partners = partnersOf(macros);
    for (const each of macros) {
      if (each.key === undefined) continue;
      // Nothing of the sample's text moved a key, a command's or an environment's.
      expect(each.key, each.name).toBe(each.filed?.key);
      expect((await answerState(each, folder.read, partners)).state, each.name).toBe("ok");
      expect(
        await keyOf(NAMING_VERSION, each.filed?.hash ?? "", each.filed?.dependencies ?? []),
        each.name,
      ).toBe(each.key);
    }
  }

  for (const id of ["jake-0000", "altacv-0000", "awesome-cv-0000"])
    test(`has an answer for each of ${id}'s macros, filed under its key, with its hash`, async () => {
      const { plain, doc } = await seeded(id);
      await checkSeeded(plain);
      // The answers folder is as `corpus seed --write` writes it, for this sample's macros.
      const row: SeedRow = { id, family: doc.family, outcome: "requested", macros: plain };
      expect(await seedPlan([row], answersFolder())).toEqual({ writes: [], problems: [] });
    }, 60_000);

  for (const id of ["jake-0000", "awesome-cv-0000"])
    test(`keeps ${id}'s keys with the header's values its own calls give`, async () => {
      const { macros, header } = await seeded(id);
      if (id === "awesome-cv-0000") expect(header.first).toBeDefined();
      await checkSeeded(macros);
    }, 60_000);

  // The upstream AltaCV sample's placeholder name holds, as a whole word, the colour the class
  // passes to `\color` in `\makecvheader`'s closure, which the request builder once masked by the
  // header's words, moving the key off the seed's; it now reads `\color`'s argument as code.
  test("keeps altacv-0000's keys with the header's values its own calls give", async () => {
    const { macros, header } = await seeded("altacv-0000");
    expect(header.first).toBeDefined();
    await checkSeeded(macros);
  }, 60_000);

  // Names and stored values that are words of the launch templates' code, as the reviewers found:
  // each moved a seed key when the request builder masked a class's definitions by them. It now
  // leaves the tree's definitions to the patterns and reads code as code, and masks a class the
  // upload ships, as AltaCV's and Awesome-CV's samples do, only where its text is the person's.
  test("keeps every seed key whatever words the header's values and the stored text hold", async () => {
    const names = [
      ["Quill", "Page"],
      ["Quill", "Link"],
      ["Quill", "Box"],
      ["Quill", "White"],
      ["Quill", "West"],
      ["Quill", "East"],
      ["Line", "Invented"],
      ["Xing", "Invented"],
    ];
    const stored = ["Mobile Developer", "Harbour Square", "Full Stack", "Page", "Link"];
    for (const id of ["jake-0000", "altacv-0000", "awesome-cv-0000"]) {
      const sample = await pipeline(id);
      for (const [first, last] of names) {
        const request = await sample.request(
          {
            ...(first === undefined ? {} : { first }),
            ...(last === undefined ? {} : { last }),
            headline: "Mobile Developer",
            location: "Harbour Square",
            links: [{ label: "GitHub", href: "https://github.example/quill-invented" }],
          },
          stored,
        );
        for (const macro of request.macros)
          if (macro.key !== undefined)
            expect(macro.key, `${id} ${macro.name} with ${first} ${last}`).toBe(
              sample.filed(macro.of, macro.name)?.key,
            );
      }
    }
  }, 120_000);

  // Item 11's review: a stored text that names a command made the macro it filled code in the
  // engine's closures, so its dependents keyed otherwise than the request, which sends it as data,
  // and moved off the seed's answers. The signatures step now holds it as data too.
  test("keeps awesome-cv-0000's keys when a text the preamble stores names a command", async () => {
    const variants: [string, (text: string) => string][] = [
      ["a size", (text) => text.replace("\n\\position{", "\n\\position{\\small ")],
      ["an icon", (text) => text.replace("\n\\position{", "\n\\position{\\faCode\\ ")],
      [
        "an extra's icon",
        (text) =>
          text.replace(/(\n\\position\{[^\n]*\n)/, "$1\\extrainfo{\\faGlobe\\ Invented Harbour}\n"),
      ],
    ];
    for (const [label, change] of variants) {
      const sample = await takePipeline("awesome-cv-0000", change);
      const folder = answersFolder();
      const plain = await sample.request();
      const header = headerOf(sample.candidates, commandAnswers(plain, folder.read));
      const macros = seedMacros(await sample.request(header), sample.filed, sample.extras);
      for (const name of ["@position", "@extrainfo"])
        if (Object.hasOwn(sample.found.macros, name))
          expect(sample.found.macros[name], `${label}: ${name}`).toMatchObject({ kind: "data" });
      for (const each of macros)
        if (each.key !== undefined) {
          expect(each.key, `${label}: ${each.name}`).toBe(each.filed?.key);
          expect(
            (await answerState(each, folder.read, partnersOf(macros))).state,
            `${label}: ${each.name}`,
          ).toBe("ok");
        }
      sample.session.forget("import");
    }
  }, 300_000);

  // Item 11's review: a resume's words that are words of a class's code, tikz's `node` and `at`,
  // masked a shipped class's definition that holds them, as a pair of the page's.
  test("keeps every seed key with the reviewers' sentences in a sample's body", async () => {
    const sentences = [
      "Built invented services with Node at Larkspur.",
      "Invented Node at Larkspur with rounded corners in in-house plain in tools.",
    ];
    for (const id of ["jake-0000", "altacv-0000", "awesome-cv-0000"])
      for (const sentence of sentences) {
        const sample = await takePipeline(id, (text) =>
          text.replace("\\end{document}", `${sentence}\n\\end{document}`),
        );
        const request = await sample.request();
        for (const macro of request.macros)
          if (macro.key !== undefined)
            expect(macro.key, `${id} ${macro.name} with ${sentence}`).toBe(
              sample.filed(macro.of, macro.name)?.key,
            );
        sample.session.forget("import");
      }
  }, 300_000);

  // Item 11's review: a fork that ships a launch template's class unchanged shows a page of its
  // own, whose pairs and numbers the class's definitions must not match: each sample's request,
  // built with each corpus page's strings in place of its own, keeps every seed key.
  describe.skipIf(!existsSync(FETCH_REPORT_FILE))("against the corpus's pages", () => {
    test("keeps every seed key with each corpus page's strings", async () => {
      const report = parseJson(
        FetchReport,
        readFileSync(FETCH_REPORT_FILE, "utf8"),
        FETCH_REPORT_FILE,
      );
      const corpus = parseJson(Manifest, readFileSync(MANIFEST_FILE, "utf8"), MANIFEST_FILE);
      const entries = matchingEntries(corpus, report);
      const documents = corpus.documents
        .filter(isLive)
        .filter((doc) => entries.get(doc.id)?.state === "fetched");
      const byId = new Map(documents.map((doc) => [doc.id, doc]));
      const treeFont = treeFonts(manifest.files);
      // Each page holds its document's text: it is kept in memory, and never printed.
      const pages = new Map<string, PageStrings>();
      await checkCorpus({
        documents,
        upload: (id) => {
          const doc = byId.get(id);
          if (doc === undefined) throw new Error(`${id} is no fetched document`);
          return uploadOf(
            doc,
            (path) => new Uint8Array(readFileSync(join(CORPUS_DIR, doc.id, ...path.split("/")))),
            treeFont,
          );
        },
        onPage: (id, page) => pages.set(id, page),
      });
      expect(pages.size).toBeGreaterThan(100);
      for (const id of ["jake-0000", "altacv-0000", "awesome-cv-0000"]) {
        const sample = await pipeline(id);
        for (const [doc, page] of pages) {
          if (!pageReadable(page)) continue;
          const request = await sample.request(undefined, [], page);
          for (const macro of request.macros)
            if (macro.key !== undefined)
              expect(macro.key, `${id} ${macro.name} with ${doc}'s page`).toBe(
                sample.filed(macro.of, macro.name)?.key,
              );
        }
      }
    }, 1_800_000);
  });

  describe("Awesome-CV's section colour, redefined", () => {
    /**
     * The Awesome-CV sample with an invented body, highlighting off or on, and the editor's
     * markers defined where a body marks a field, compiled as the seed child compiles it; with
     * the seed's redefinitions of `\cvsection`'s answer after the class, or as upstream has it.
     */
    async function sectionPages() {
      const sample = await pipeline("awesome-cv-0000");
      const macros = seedMacros(await sample.request(), sample.filed, sample.extras);
      const { redefinitions } = redefinitionsOf(
        macros.filter((each) => each.name === "cvsection"),
        answersFolder().read,
      );
      expect(redefinitions.map((each) => each.name)).toContain("@sectioncolor");
      const main = sample.taken.main.text;
      const begin = main.indexOf("\\begin{document}");
      const end = main.indexOf("\\end{document}");
      return async (
        body: string,
        options: { off?: boolean; markers?: boolean; redefined?: boolean },
      ): Promise<GlyphStream | undefined> => {
        // The sample's preamble sets the highlighting itself, so it is turned off after it.
        const preamble = `${main.slice(0, begin)}${options.off ? "\\setbool{acvSectionColorHighlight}{false}\n" : ""}${options.markers ? PROBE_PRELUDE : ""}`;
        const text = `${preamble}\\begin{document}\n${body}\n${main.slice(end)}`;
        const redefined = options.redefined ? withRedefinitions(text, redefinitions) : text;
        const compiled = await compileLikeReference(
          sample.session,
          sample.fonts,
          sample.taken,
          sample.made,
          new TextEncoder().encode(redefined),
        );
        return isRefusal(compiled) ? undefined : compiled.stream;
      };
    }

    const markers = (stream: GlyphStream | undefined) =>
      (stream?.pages ?? []).flatMap((page) =>
        page.items.flatMap((item) =>
          item.kind === "special" &&
          (item.text.startsWith(MARKER_BEGIN) || item.text.startsWith(MARKER_END))
            ? [item.text]
            : [],
        ),
      );

    test("keeps upstream's page with highlighting off, a space among the first three dropped", async () => {
      const page = await sectionPages();
      const upstream = await page("\\cvsection{IT Invented}", { off: true });
      expect(upstream).toBeDefined();
      const redefined = await page("\\cvsection{IT Invented}", { off: true, redefined: true });
      expect(redefined && upstream && difference(upstream, redefined)).toBeUndefined();
      // Marked, the title is the field's whole, set as upstream sets it.
      const marked = await page("\\cvsection{\\rtfield{f1}{IT Invented}}", {
        off: true,
        markers: true,
        redefined: true,
      });
      expect(marked && upstream && difference(upstream, marked)).toBeUndefined();
      expect(markers(marked)).toEqual([`${MARKER_BEGIN}f1`, `${MARKER_END}f1`]);
    }, 120_000);

    test("keeps upstream's page for a letter's section, whose style passes the title unbraced", async () => {
      const page = await sectionPages();
      const upstream = await page("\\lettersection{Invented}", {});
      expect(upstream).toBeDefined();
      const redefined = await page("\\lettersection{Invented}", { redefined: true });
      expect(redefined && upstream && difference(upstream, redefined)).toBeUndefined();
      // Marked, it compiles, sets upstream's page, and the field's markers go round the title.
      const marked = await page("\\lettersection{\\rtfield{f1}{Invented}}", {
        markers: true,
        redefined: true,
      });
      expect(marked).toBeDefined();
      expect(marked && upstream && difference(upstream, marked)).toBeUndefined();
      expect(markers(marked)).toEqual([`${MARKER_BEGIN}f1`, `${MARKER_END}f1`]);
    }, 120_000);
  });
});
