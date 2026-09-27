import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NAMING_VERSION } from "@resume-tools/naming";
import { describe, expect, test } from "vitest";
import type { EngineManifest } from "../src/engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../src/engine/node";
import { candidatesOf, isSetter } from "../src/import/candidates";
import { readTree } from "../src/import/fonts";
import { type Intake, intake } from "../src/import/intake";
import { buildRequest } from "../src/import/naming";
import { bodyOf, bodyOfText, buildTree, readBody } from "../src/import/parse";
import { probeUses } from "../src/import/probe";
import { reference } from "../src/import/reference";
import { isRefusal } from "../src/import/refusal";
import { keysOf, signatures } from "../src/import/signatures";
import { FontLibrary } from "../src/page/fonts";
import { TexLiveIndex } from "../src/page/texlive";
import { ORACLE_DIR, ORACLE_FILE, Oracle, oracleDocument } from "./corpus-oracle";
import { uploadOf } from "./corpus-reference";
import {
  answerState,
  answersFolder,
  keyOfFile,
  redefinitionsOf,
  SEED_EXTRAS,
  type SeedMacro,
  type SeedRow,
  seedMacros,
  seedTable,
} from "./corpus-seed";

// The macros, keys and answers here are invented, but for the last block's, which the committed
// seed's are, read from the oracle's samples when a machine has fetched them.

const KEY = "a".repeat(64);
const HASH = "b".repeat(64);

/** An invented macro as the seed checks it. */
const macro = (extra: Partial<SeedMacro> = {}): SeedMacro => ({
  of: "command",
  name: "cventry",
  hash: HASH,
  key: KEY,
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
  test("takes an answer filed under its key, for its name, with its hash", () => {
    expect(answerState(macro(), () => stored())).toEqual({ state: "ok" });
  });

  test("names what is wrong, and never needs an answer for a macro that holds data", () => {
    expect(answerState(macro(), () => undefined)).toEqual({ state: "missing" });
    expect(answerState(macro(), () => "{").state).toBe("invalid");
    expect(answerState(macro(), () => stored({ reviewed: false })).state).toBe("invalid");
    expect(answerState(macro(), () => stored({ key: "c".repeat(64) })).state).toBe("key");
    expect(answerState(macro(), () => stored({ hash: "c".repeat(64) })).state).toBe("hash");
    expect(answerState(macro(), () => stored({ name: "cvitem" })).state).toBe("name");
    expect(answerState(macro(), () => stored({ of: "environment" })).state).toBe("name");
    expect(answerState(macro({ key: undefined, hash: undefined }), () => undefined).state).toBe(
      "data",
    );
    // A reason a schema gives names the field, never a text.
    expect(answerState(macro(), () => stored({}, { kind: "chapter" })).why).toMatch(/^answer/);
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

  test("tables each sample's macros, the answers no macro claims, and the problems", () => {
    const rows: SeedRow[] = [
      {
        id: "jake-0000",
        family: "jake",
        outcome: "requested",
        engine: "pdftex",
        macros: [
          macro(),
          macro({ name: "cvitem", key: "c".repeat(64), extra: true, arguments: [] }),
          macro({ name: "cvname", key: undefined, hash: undefined }),
        ],
        redefinitions: { names: ["cventry"], regenerated: "keeps", raw: "position" },
      },
      { id: "altacv-0000", family: "altacv", outcome: "no reference" },
    ];
    const { table, problems } = seedTable(rows, (key) => (key === KEY ? stored() : undefined), [
      KEY,
      "d".repeat(64),
    ]);
    expect(problems).toBe(2);
    expect(table).toContain(
      "| jake | `\\cventry` | `bbbbbbbbbbbb` | `aaaaaaaaaaaa` | #1 editable, #2 twice | ok |",
    );
    expect(table).toContain("| jake | `\\cvitem` (not called) |");
    expect(table).toContain("no arguments | **missing** |");
    expect(table).toContain("| data |");
    expect(table).toContain("| altacv | no reference | | | | **missing** |");
    expect(table).toContain("Answer files no sample's macro claims: `dddddddddddd`.");
    expect(table).toContain(
      "jake: 1 redefinition (\\cventry); its calls they serve regenerated, with them against without them: keeps; the sample as it is, against its reference: moves it (position).",
    );
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

  /**
   * A sample's request as the pipeline builds it, but with no probe: its preamble's storing calls
   * found as the probe finds them, and no verdicts, which the seed's keys do not depend on.
   */
  async function requested(id: string) {
    const doc = oracle.documents.find((each) => each.id === id);
    if (doc === undefined) throw new Error(`${id} is no oracle sample`);
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    const session = await startNodeSession();
    const fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
    const zip = uploadOf(
      oracleDocument(doc),
      (path) => new Uint8Array(readFileSync(join(ORACLE_DIR, doc.id, ...path.split("/")))),
      () => undefined,
    );
    const taken = intake({ name: `${id}.zip`, bytes: zip }, { tree: readTree(manifest.files) });
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
    const request = await buildRequest(
      built,
      found,
      {
        macros: [],
        candidates: candidates.map((each) => ({
          ...each,
          verdict: "untested" as const,
          settled: "budget" as const,
        })),
      },
      body.preamble,
      extras === undefined ? {} : { also: extras },
    );
    return { doc, macros: seedMacros(request, await keysOf(found), extras) };
  }

  for (const id of ["jake-0000", "altacv-0000", "awesome-cv-0000"])
    test(`has an answer for each of ${id}'s macros, filed under its key, with its hash`, async () => {
      const { macros } = await requested(id);
      const folder = answersFolder();
      expect(macros.length).toBeGreaterThan(5);
      for (const each of macros) {
        // Nothing of the sample's text moved a key: each is item 4's.
        expect(each.item4, each.name).toBeUndefined();
        expect(answerState(each, folder.read).state, each.name).toMatch(/^(?:ok|data)$/);
      }
    }, 60_000);
});
