import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BLANKS,
  CONTACT_FIELDS,
  HOLDS,
  MACRO_KINDS,
  MEANINGS,
  type ModelNaming,
  NAMING_VERSION,
  type NamingRequest,
  SLOTS_BY_KIND,
  sha256,
  storedAnswersOf,
} from "@resume-tools/naming";
import { LINK_KINDS, SECTION_ROLES } from "@resume-tools/resume-model";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import type { EngineManifest } from "../src/engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../src/engine/node";
import type { EngineSession } from "../src/engine/session";
import { readTree } from "../src/import/fonts";
import { type Intake, intake } from "../src/import/intake";
import { inLatinModern } from "../src/import/latin-modern";
import * as naming from "../src/import/naming";
import { bodyOf, bodyOfText, buildTree, readBody, type Tree } from "../src/import/parse";
import { probe, probeUses } from "../src/import/probe";
import { reference } from "../src/import/reference";
import { isRefusal } from "../src/import/refusal";
import { signatures } from "../src/import/signatures";
import { validate } from "../src/import/validate";
import { FontLibrary } from "../src/page/fonts";
import { TexLiveIndex } from "../src/page/texlive";
import { FileAnswerCache } from "./answer-cache";
import { answersFor } from "./corpus-assemble";
import {
  asCallSite,
  type Carrier,
  type Checked,
  carriersOf,
  coverOf,
  exportPlan,
  type KeptText,
  leaksIn,
  linked,
  MIN_SHARED,
  macroAt,
  NO_REQUEST_NOTE,
  type RunDocument,
  redefinitionVerdicts,
  reviewNotesOf,
  runMismatch,
  templatesOf,
  verdictLine,
} from "./corpus-review";
import { outcomeOf, type RunRecord } from "./corpus-run";

// Every document, template, key, answer and text here is invented for these tests, and no test
// reads the corpus: the words of the invented documents stand for the text of a person's, which
// nothing the export writes may hold.

const made: string[] = [];

/** A new empty folder under the system's temporary one, removed after the test. */
function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "resume-tools-review-"));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** An invented key: 64 hex digits from a letter. */
const key = (letter: string) => letter.repeat(64);

describe("templates", () => {
  test("link two requests that share enough keys, and never by one key alone", () => {
    const set = (...letters: string[]) => new Set(letters.map(key));
    expect(MIN_SHARED).toBe(2);
    // Two of three shared: half of the smaller's, and two.
    expect(linked(set("a", "b", "c"), set("a", "b", "d", "e"))).toBe(true);
    // A fork that calls two of its template's six macros is its template's.
    expect(linked(set("a", "b"), set("a", "b", "c", "d", "e", "f"))).toBe(true);
    // One key, a bare closer's, links nothing, however small the request.
    expect(linked(set("a"), set("a", "b"))).toBe(false);
    expect(linked(set("a", "x"), set("a", "b"))).toBe(false);
    // Two of ten and two of twelve: under half of the smaller's.
    expect(
      linked(
        set("a", "b", "c", "d", "e", "f", "g", "h", "i", "j"),
        set("a", "b", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t"),
      ),
    ).toBe(false);
  });

  const documents = [
    { id: "jake-0002", family: "jake" as const, keys: ["a", "b", "c", "d"].map(key) },
    { id: "jake-0001", family: "jake" as const, keys: ["a", "b", "c", "e"].map(key) },
    // Linked to jake-0002 alone, and so to its template through it.
    { id: "other-0009", family: "other" as const, keys: ["c", "d", "f"].map(key) },
    { id: "altacv-0001", family: "altacv" as const, keys: ["p", "q", "r"].map(key) },
    { id: "altacv-0002", family: "altacv" as const, keys: ["p", "q", "s"].map(key) },
    // A bare closer's key shared with a Jake fork, and nothing else.
    { id: "other-0001", family: "other" as const, keys: ["a", "z"].map(key) },
    { id: "other-0002", family: "other" as const, keys: [] },
  ];

  test("are the documents linked, directly or through others, ranked by the documents they cover", () => {
    const templates = templatesOf(documents);
    expect(templates.map((each) => [each.folder, each.documents])).toEqual([
      ["01-jake", ["jake-0001", "jake-0002", "other-0009"]],
      ["02-altacv", ["altacv-0001", "altacv-0002"]],
      ["03-other", ["other-0001"]],
    ]);
    // Keys by how many of the template's documents hold them, most first.
    expect(templates[0]?.keys.slice(0, 3)).toEqual([key("c"), key("a"), key("b")]);
  });

  test("are the same whatever order the documents come in", () => {
    const reversed = templatesOf([...documents].reverse());
    expect(reversed).toEqual(templatesOf(documents));
  });

  test("are covered by the fewest requests that hold every key, the first by id among equals", () => {
    const requests = [
      { id: "jake-0003", keys: new Set(["a", "b"]) },
      { id: "jake-0001", keys: new Set(["a", "b", "c"]) },
      { id: "jake-0002", keys: new Set(["c", "d"]) },
      { id: "jake-0004", keys: new Set(["d"]) },
    ];
    expect(coverOf(requests, new Set(["a", "b", "c", "d"]))).toEqual(["jake-0001", "jake-0002"]);
    expect(coverOf(requests, new Set())).toEqual([]);
  });
});

/** A body of invented text, one text node, as the parser gives the leak check a tree. */
function treeOf(text: string): Tree {
  return {
    kind: "body",
    source: text,
    start: 0,
    end: text.length,
    nodes: 1,
    levels: 1,
    content: [{ kind: "text", start: 0, end: text.length, runs: [{ text }] }],
  };
}

/** A document's text as the run keeps it, from an invented body and header. */
function kept(body: string, first: string, last: string): KeptText {
  return {
    tree: treeOf(body),
    header: { first, last },
    stored: [],
    sources: [],
    page: { words: [], pairs: [], identifiers: [], numbers: [], runs: [], glyphs: 0, readable: 0 },
    names: [],
  };
}

describe("the macro a locked part belongs to", () => {
  test("is the innermost call of the request's that holds its start", () => {
    const source = "\\cventry{\\textbf{Tide}}{x} and more";
    const nodes = [
      {
        kind: "call" as const,
        name: "cventry",
        star: false,
        start: 0,
        end: 26,
        args: [
          {
            kind: "mandatory" as const,
            present: true,
            open: "{",
            close: "}",
            start: 8,
            end: 23,
            innerStart: 9,
            innerEnd: 22,
            content: [
              {
                kind: "call" as const,
                name: "textbf",
                star: false,
                start: 9,
                end: 22,
                args: [],
              },
            ],
          },
        ],
      },
      { kind: "text" as const, start: 26, end: source.length, runs: [{ text: " and more" }] },
    ];
    const known = (macro: string) => macro === "command|cventry";
    expect(macroAt(nodes, 12, known)).toBe("command|cventry");
    expect(macroAt(nodes, 0, known)).toBe("command|cventry");
    expect(macroAt(nodes, 30, known)).toBeUndefined();
    expect(macroAt(nodes, 12, (macro) => macro.startsWith("command|"))).toBe("command|textbf");
  });
});

describe("a document's notes for the review", () => {
  test("give each macro's fate by the request's name, never the document's own", async () => {
    const hash = await sha256("macro:#1->\\textbf {#1}");
    const request = {
      macros: [
        {
          of: "command",
          name: "rtxa",
          key: key("a"),
          dependencies: [],
          capped: false,
          arguments: [{ index: 1, kind: "mandatory" }],
          sites: [],
          calls: 2,
        },
        {
          of: "command",
          name: "cventry",
          key: key("b"),
          dependencies: [],
          capped: false,
          arguments: [{ index: 1, kind: "mandatory" }],
          sites: [],
          calls: 3,
        },
      ],
    } as unknown as NamingRequest;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // `\Larkfield`, a macro named after the person's surname, goes as `rtxa` (decision 0033).
    const realName = (name: string) => (name === "rtxa" ? "Larkfield" : name);
    const body = "\\Larkfield{x}\\cventry{y}";
    const notes = await reviewNotesOf({
      request,
      realName,
      cache: { get: () => undefined },
      probe: {
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
            name: "Larkfield",
            index: 1,
            calls: 2,
            verdict: "misaligned",
            counts: { misaligned: 2 },
          },
        ],
      },
      assembled: {
        checks: {
          all: [
            {
              at: "b14.1",
              slot: "command|cventry|1",
              field: "ent-1.title",
              node: "ent-1",
              type: "text",
              lockable: true,
              words: 2,
              mode: "typeset",
            },
            {
              at: "b0.1",
              slot: "command|Larkfield|1",
              field: "sec-1.text",
              node: "sec-1",
              type: "rich",
              lockable: true,
              words: 1,
              mode: "locked",
              reason: "misaligned",
            },
          ],
          findings: [
            { check: "pdf", message: "Larkfield", field: "ent-1.title" },
            { check: "untested", message: "Larkfield" },
          ],
          required: ["command|cventry|1"],
          redefinitions: { applied: ["cvtag"], dropped: [], placement: "class" },
        },
        extras: [{ at: "b0", reason: "unmapped", words: 4 }],
      },
      trees: {
        body: {
          ...treeOf(body),
          content: [
            { kind: "call", name: "Larkfield", star: false, start: 0, end: 13, args: [] },
            { kind: "call", name: "cventry", star: false, start: 13, end: body.length, args: [] },
          ],
        },
      },
    });
    expect(notes.macros.map((each) => [each.name, each.answer, each.calls])).toEqual([
      ["rtxa", "none", 2],
      ["cventry", "none", 3],
    ]);
    const [masked, entry] = notes.macros;
    expect(masked?.verdicts).toEqual({ "1": { misaligned: 2 } });
    expect(masked?.fields.locked).toEqual({ misaligned: 1 });
    expect(masked?.parts).toEqual({ unmapped: { parts: 1, words: 4 } });
    expect(entry?.fields).toEqual({ editable: 1, raw: 0, required: 1, locked: {} });
    expect(entry?.findings).toEqual({ pdf: 1 });
    expect(notes.elsewhere.findings).toEqual({ untested: 1 });
    expect(notes.checks).toEqual(["untested"]);
    expect(notes.redefinitions).toEqual({ applied: ["cvtag"], dropped: [] });
    expect(JSON.stringify(notes)).not.toContain("Larkfield");
  });
});

describe("the review's check of redefinitions", () => {
  const carriers: Carrier[] = [
    { key: key("a"), of: "command", name: "email", redefinitions: ["printinfo"] },
    { key: key("b"), of: "command", name: "phone", redefinitions: ["printinfo"] },
    { key: key("c"), of: "command", name: "cvevent", redefinitions: ["cvevent"] },
    { key: key("d"), of: "environment", name: "cvskills", redefinitions: ["cvskills"] },
  ];
  const checked = (id: string, changes: Partial<Checked>): Checked => ({
    id,
    outcome: "partial",
    applied: [],
    dropped: [],
    checks: [],
    ...changes,
  });
  const results = new Map<string, Checked>([
    ["altacv-0001", checked("altacv-0001", { applied: ["printinfo", "cvevent"] })],
    ["altacv-0002", checked("altacv-0002", { applied: ["printinfo"], dropped: ["cvevent"] })],
    // Refused before the checks, by item 8's check of its fonts: the redefinition never runs there.
    [
      "altacv-0003",
      checked("altacv-0003", {
        outcome: "refused",
        refused: { step: "fonts", reason: "difference" },
      }),
    ],
  ]);
  const verdicts = redefinitionVerdicts({
    carriers,
    holders: new Map([
      [key("a"), ["altacv-0001", "altacv-0003"]],
      [key("b"), ["altacv-0002"]],
      [key("c"), ["altacv-0001", "altacv-0002"]],
    ]),
    results,
    templates: new Map([[key("a"), ["02-altacv"]]]),
  });

  test("keeps one every document that reaches the checks applies, and drops one that moves a page", () => {
    expect(verdicts.map((each) => [each.name, each.verdict])).toEqual([
      ["cvevent", "dropped"],
      ["cvskills", "unproven"],
      ["printinfo", "kept"],
    ]);
    const [cvevent, cvskills, printinfo] = verdicts;
    expect(printinfo).toMatchObject({ documents: 3, applied: 2, unreached: 1 });
    expect(printinfo?.why).toBe(
      "Kept: applied, the page kept and the checks run through, on all 2 documents that reached the checks, of 3 that hold its keys.",
    );
    expect(cvevent?.why).toBe("Dropped: it moves the page of 1.");
    expect(cvskills?.why).toBe("Unproven: no corpus document's request holds its keys.");
    expect(verdictLine(printinfo as (typeof verdicts)[number])).toBe(
      "KEPT \\printinfo, carried by the answers of \\email, \\phone (02-altacv): 3 documents hold their keys; 2 applied it, 0 had their page moved, 0 proved none, 0 stopped, 0 were refused by the checks, 0 timed out or died, 1 were not reached. Kept: applied, the page kept and the checks run through, on all 2 documents that reached the checks, of 3 that hold its keys.",
    );
  });

  test("drops one the checks stop on, could prove none on, or whose document dies", () => {
    const [verdict] = redefinitionVerdicts({
      carriers: [carriers[0] as Carrier],
      holders: new Map([[key("a"), ["a-1", "a-2", "a-3"]]]),
      results: new Map([
        ["a-1", checked("a-1", { applied: ["printinfo"], checks: ["stopped"] })],
        ["a-2", checked("a-2", { dropped: ["printinfo"], checks: ["unproven"] })],
        ["a-3", checked("a-3", { outcome: "timeout" })],
      ]),
      templates: new Map(),
    });
    expect(verdict).toMatchObject({ verdict: "dropped", stopped: 1, unprovable: 1, died: 1 });
    expect(verdict?.why).toBe(
      "Dropped: the checks could prove no redefinition on 1; the checks stopped on 1; 1 timed out or died.",
    );
  });

  test("drops one whose documents the validation refuses, which its answer may cause", () => {
    // The review's repro: every document that holds the key is refused by the assembly or its
    // reading back (`keep`), with nothing applied or dropped: that proves nothing kept.
    const refusedBy = (step: "checks" | "fonts", reason: string) =>
      redefinitionVerdicts({
        carriers: [{ key: key("k"), of: "command", name: "cvtag", redefinitions: ["cvtag"] }],
        holders: new Map([[key("k"), ["altacv-0101", "altacv-0102"]]]),
        results: new Map(
          ["altacv-0101", "altacv-0102"].map((id) => [
            id,
            checked(id, { outcome: "refused", refused: { step, reason } }),
          ]),
        ),
        templates: new Map(),
      })[0];
    expect(refusedBy("checks", "keep")).toMatchObject({
      verdict: "dropped",
      refused: 2,
      why: "Dropped: the checks refused 2.",
    });
    // A font the page cannot draw refuses a document whatever its answers are, and a refusal
    // before the checks never runs the redefinition: neither drops it, and neither proves it.
    for (const [step, reason] of [
      ["checks", "font"],
      ["fonts", "difference"],
    ] as const)
      expect(refusedBy(step, reason)).toMatchObject({
        verdict: "unproven",
        unreached: 2,
        why: "Unproven: none of the 2 documents that hold its keys reaches the checks.",
      });
  });

  test("reads the reviewed answers that carry redefinitions, and names a file that does not validate", async () => {
    const request = {
      version: NAMING_VERSION,
      engine: "pdftex",
      preamble: { settings: [] },
      macros: [
        {
          of: "command",
          name: "cvtag",
          key: await keyOfText("macro:#1->\\fbox {#1}"),
          dependencies: [],
          capped: false,
          arguments: [{ index: 1, kind: "mandatory" }],
          sites: [],
          calls: 1,
        },
      ],
      definitions: [
        {
          kind: "definition",
          name: "cvtag",
          hash: await sha256("macro:#1->\\fbox {#1}"),
          text: "macro:#1->\\fbox {#1}",
        },
      ],
    } as unknown as NamingRequest;
    const filing = await storedAnswersOf(
      request,
      {
        macros: [
          {
            of: "command",
            name: "cvtag",
            answer: {
              kind: "bullet",
              arguments: [{ index: 1, meaning: "text", slot: "text", blank: "empty" }],
              repeatable: true,
            },
          },
        ],
        preamble: { parameters: [] },
      },
      "model:invented-model",
    );
    const [answer] = filing.answers;
    if (answer === undefined) throw new Error("no answer filed");
    const reviewed = {
      ...answer,
      reviewed: true,
      source: "seed",
      answer: {
        ...answer.answer,
        reviewed: true,
        notes: "Reviewed by the review model, from invented-model's answer.",
        redefinitions: [{ name: "cvtag", latex: "\\renewcommand{\\cvtag}[1]{\\fbox{#1}}" }],
      },
    };
    const found = await carriersOf([
      { key: answer.key, text: JSON.stringify(reviewed) },
      // The model's answer, which no review wrote, carries nothing to check.
      { key: answer.key, text: JSON.stringify(answer) },
      // Filed under a key its dependencies do not give, and no answer at all.
      { key: key("e"), text: JSON.stringify({ ...answer, key: key("e") }) },
      { key: key("f"), text: "{" },
    ]);
    expect(found.carriers).toEqual([
      { key: answer.key, of: "command", name: "cvtag", redefinitions: ["cvtag"] },
    ]);
    expect(found.others).toBe(0);
    expect(found.invalid).toEqual([key("e"), key("f")]);
  });
});

/** A key as the naming package computes one for a macro of no dependencies. */
async function keyOfText(text: string): Promise<string> {
  const { keyOf } = await import("@resume-tools/naming");
  return keyOf(NAMING_VERSION, await sha256(text), []);
}

describe("REVIEW.md, which is all the review agent reads besides the export", () => {
  const text = readFileSync(new URL("../corpus/REVIEW.md", import.meta.url), "utf8");

  test("names every word of the answer's closed lists, so that the agent needs no other file", () => {
    const words = [
      ...MACRO_KINDS,
      ...MEANINGS,
      ...Object.values(SLOTS_BY_KIND).flat(),
      ...BLANKS,
      ...HOLDS,
      ...CONTACT_FIELDS,
      ...SECTION_ROLES,
      ...LINK_KINDS,
      "opens",
      "closes",
    ];
    for (const word of words) expect(text, word).toContain(`\`${word}\``);
  });

  test("files the review's answers under the review model, and points at no run's files", () => {
    expect(text).toContain('"source": "model:claude-opus-5-5"');
    expect(text).not.toContain(".corpus/run");
  });
});

describe("the last run, as the review reads it", () => {
  const record = (changes: Partial<RunRecord> = {}): RunRecord => ({
    version: 1,
    stamp: "2026-10-01T00:00:00.000Z-0a1b2c3d",
    answers: "cache",
    cache: "invented-model",
    asked: null,
    documents: "all",
    ids: ["jake-0001", "jake-0002"],
    complete: true,
    ...changes,
  });
  const stamped = (stamp = "2026-10-01T00:00:00.000Z-0a1b2c3d") =>
    new Map([
      ["jake-0001", stamp],
      ["jake-0002", stamp],
    ]);
  const mismatch = (
    changes: Partial<RunRecord> | undefined,
    purpose: "export" | "check" = "export",
    stamps = stamped(),
    fetched = ["jake-0001", "jake-0002"],
  ) =>
    runMismatch({
      record: changes === undefined ? undefined : record(changes),
      purpose,
      model: "invented-model",
      fetched,
      stamps,
    });

  test("serves the review when it read the review's answers, finished, and kept each document", () => {
    expect(mismatch({})).toBeUndefined();
    expect(mismatch({}, "check")).toBeUndefined();
  });

  test("refuses one that read other answers, did not finish, or left another run's documents", () => {
    expect(mismatch(undefined)).toBe("No run is recorded: run `corpus run` first.");
    expect(mismatch({ complete: false })).toBe(
      "The last run did not finish: run `corpus run` again.",
    );
    expect(mismatch({ answers: "committed", cache: null })).toBe(
      "The last run read the committed answers alone, and the review reads invented-model's cache too: run `corpus run` without --committed-only.",
    );
    expect(mismatch({ cache: "another-model" })).toBe(
      "The last run read another-model's cache, and NAMING_MODEL names invented-model: run `corpus run` with the one model.",
    );
    const mixed = new Map([
      ["jake-0001", "2026-10-01T00:00:00.000Z-0a1b2c3d"],
      ["jake-0002", "2026-09-30T00:00:00.000Z-99999999"],
    ]);
    expect(mismatch({}, "export", mixed)).toBe(
      "1 of the last run's 2 documents was kept by another run: run `corpus run` again.",
    );
  });

  test("lets the export take a run over some documents, and the check only one over all", () => {
    const some = { documents: "some" as const, ids: ["jake-0001"] };
    const fetched = ["jake-0001", "jake-0002", "jake-0003"];
    expect(mismatch(some, "export", stamped(), fetched)).toBeUndefined();
    expect(mismatch(some, "check", stamped(), fetched)).toBe(
      "The last run took 1 of the 3 fetched documents, and the check holds a redefinition to every one: run `corpus run` over the whole corpus.",
    );
  });
});

describe("the export, over invented documents", () => {
  const SECRETS = ["quillwort", "larkfield", "wrenfield", "kestrel", "tidal ledger"];

  /** The invented template's sources, which make its three macros the documents' own. */
  const SOURCES = [
    "\\newcommand{\\cvsection}[1]{\\section*{#1}}\n\\newcommand{\\cventry}[2]{\\textbf{#1}\\hfill #2}\n\\newcommand{\\cvitem}[1]{#1}\n",
  ];

  /** A document's text as the run keeps it, its sources the template's. */
  const ownText = (body: string, first: string, last: string): KeptText => ({
    ...kept(body, first, last),
    sources: SOURCES,
  });

  /** An invented request of a template with three macros, whose entry's definition holds `extra`. */
  async function inventedRequest(extra = ""): Promise<NamingRequest> {
    const texts = {
      cvsection: "macro:#1->\\section *{#1}",
      cventry: `macro:#1#2->\\textbf {#1}\\hfill #2${extra}`,
      cvitem: "macro:#1->#1",
    };
    const { keyOf } = await import("@resume-tools/naming");
    const macro = async (name: keyof typeof texts, args: number, site: (string | null)[]) => ({
      of: "command",
      name,
      key: await keyOf(NAMING_VERSION, await sha256(texts[name]), []),
      dependencies: [],
      capped: false,
      arguments: Array.from({ length: args }, (_, i) => ({
        index: i + 1,
        kind: "mandatory",
        verdict: "editable",
      })),
      sites: [{ arguments: site }],
      calls: 2,
    });
    return {
      version: NAMING_VERSION,
      engine: "pdftex",
      preamble: { settings: [] },
      macros: [
        await macro("cvsection", 1, ["Xxxxxxxxxx"]),
        await macro("cventry", 2, ["Xxxx Xxxxxx", "0000"]),
        await macro("cvitem", 1, ["Xxxxx xxx"]),
      ],
      definitions: await Promise.all(
        (Object.keys(texts) as (keyof typeof texts)[]).map(async (name) => ({
          kind: "definition",
          name,
          hash: await sha256(texts[name]),
          text: texts[name],
        })),
      ),
    } as NamingRequest;
  }

  /** A document the run kept, of the invented template. */
  function documentOf(
    id: string,
    request: NamingRequest,
    text: KeptText,
    gate: "passes" | "withholds" = "passes",
  ): RunDocument {
    return { id, family: "other", outcome: "partial", request, gate, text, rate: 0.5 };
  }

  /** The model's answers for the invented template's section and entry, as the cache files them. */
  async function answersOf(request: NamingRequest) {
    const filing = await storedAnswersOf(
      request,
      {
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
        preamble: { parameters: [] },
      },
      "model:invented-model",
    );
    return filing.answers;
  }

  test("writes the requests the gate passes, the answers, and a summary, none of the documents' text", async () => {
    const request = await inventedRequest();
    // A request whose own entry holds another document's words, as a fork that pasted its owner's
    // line into the class would: its own document's gate passed it, and the export's check against
    // the template's other documents does not.
    const pasted = await inventedRequest(" Tidal ledger");
    const documents = [
      documentOf(
        "other-0001",
        request,
        ownText("Quillwort keeps the tidal ledger", "Quillwort", "Larkfield"),
      ),
      documentOf("other-0002", pasted, ownText("Wrenfield of Kestrel Bay", "Wrenfield", "Kestrel")),
      documentOf(
        "other-0003",
        request,
        ownText("Another invented body", "Wren", "Harbour"),
        "withholds",
      ),
    ];
    // The cache holds the model's answer for the section and, under the entry's key, a reviewed
    // one whose notes name a person: that one is not written.
    const [section, entry] = await answersOf(request);
    if (section === undefined || entry === undefined) throw new Error("no answers");
    const answers = new Map([
      [section.key, JSON.stringify(section)],
      [
        entry.key,
        JSON.stringify({
          ...entry,
          reviewed: true,
          source: "seed",
          answer: {
            ...entry.answer,
            reviewed: true,
            notes: "Seen in Quillwort Larkfield's resume.",
          },
        }),
      ],
    ]);
    const plan = await exportPlan({
      documents,
      top: 20,
      cache: (asked) => answers.get(asked),
      findLeaks: naming.findLeaks,
      fetched: 3,
    });
    expect(plan.templates.map((each) => each.documents)).toEqual([
      ["other-0001", "other-0002", "other-0003"],
    ]);
    expect(plan.files.map((file) => file.path).sort()).toEqual([
      `01-other/answers/${section.key}.json`,
      "01-other/requests/other-0001.json",
      "01-other/template.json",
      "index.json",
    ]);
    const summary = JSON.parse(
      plan.files.find((file) => file.path === "01-other/template.json")?.text ?? "{}",
    );
    expect(summary.requests).toEqual({ written: 1, withheld: 2 });
    expect(summary.documents.map((each: { gate: string }) => each.gate)).toEqual([
      "passes",
      "passes",
      "withholds",
    ]);
    const byKey = new Map(
      summary.macros.map((each: { key: string }) => [each.key, each] as const),
    ) as Map<string, { name: string | null; answer: string; documents: number; filing?: unknown }>;
    expect(byKey.get(section.key)).toMatchObject({
      name: "cvsection",
      answer: "model",
      documents: 3,
    });
    expect(byKey.get(section.key)?.filing).toEqual({
      hash: await sha256("macro:#1->\\section *{#1}"),
      dependencies: [],
    });
    expect(byKey.get(entry.key)).toMatchObject({ name: "cventry", answer: "none", documents: 2 });
    // The pasted entry's key is held by a request not written: it goes without a name.
    const pastedKey = pasted.macros[1]?.key ?? "";
    expect(byKey.get(pastedKey)).toMatchObject({ name: null, documents: 1 });
    for (const file of plan.files) {
      const text = file.text.toLowerCase();
      for (const secret of SECRETS)
        expect(text, `${file.path} holds ${secret}`).not.toContain(secret);
    }
  });

  test("writes no request of a template whose every request the gate withholds, and says so", async () => {
    const request = await inventedRequest();
    const plan = await exportPlan({
      documents: [
        documentOf(
          "other-0001",
          request,
          ownText("Quillwort", "Quillwort", "Larkfield"),
          "withholds",
        ),
        documentOf(
          "other-0002",
          request,
          ownText("Wrenfield", "Wrenfield", "Kestrel"),
          "withholds",
        ),
      ],
      top: 20,
      cache: () => undefined,
      findLeaks: naming.findLeaks,
      fetched: 2,
    });
    expect(plan.files.map((file) => file.path).sort()).toEqual([
      "01-other/template.json",
      "index.json",
    ]);
    const summary = JSON.parse(plan.files[0]?.text ?? "{}");
    expect(summary.requests).toEqual({
      written: 0,
      withheld: 2,
      note: "No request of this template is written: the privacy gate withholds every one, or it holds another document's text.",
    });
    expect(summary.macros.every((each: { name: unknown }) => each.name === null)).toBe(true);
  });

  test("reads an answer's notes and LaTeX as the gate reads a call site, and its names as code", () => {
    const document = textOf("Quillwort Larkfield wrote this", "Quillwort", "Larkfield");
    const answer = (value: unknown) => ({ text: JSON.stringify(value), kind: "answer" as const });
    expect(
      leaksIn(answer({ notes: "\\textbf{Quillwort} % Larkfield" }), [document], naming.findLeaks),
    ).toEqual(["header in call site"]);
    // A single word of the body's, as the contract's own words are, is no leak beside a request.
    expect(leaksIn(answer({ notes: "wrote" }), [document], naming.findLeaks)).toEqual([]);
    // Names are code, which the gate reads by its own rule for names, and a redefinition's LaTeX is
    // read as source, as the gate reads a call site's: a command's name is no text.
    const named = answer({
      name: "Quillwort",
      dependencies: [["Larkfield", null]],
      answer: {
        list: { closedBy: "Larkfield" },
        redefinitions: [{ name: "Quillwort", latex: "\\Larkfield" }],
      },
    });
    expect(leaksIn(named, [document], naming.findLeaks)).toEqual([]);
    const latex = answer({
      answer: { redefinitions: [{ name: "x", latex: "\\textbf{Larkfield}" }] },
    });
    expect(leaksIn(latex, [document], naming.findLeaks)).toEqual(["header in call site"]);
    expect(asCallSite("a\\b%c").macros[0]?.sites[0]?.arguments[0]).toBe("a b c");
  });

  test("reads a summary's every string but the export's own words, values and names", () => {
    // A document whose body links to its owner's fork of Awesome-CV: the detector finds a link's
    // path anywhere, inside a word too, and the export's own `02-awesome-cv` is no text of it.
    const text = kept("My work", "Quillwort", "Larkfield");
    const document = {
      ...textOf("My work", "Quillwort", "Larkfield"),
      tree: {
        ...text.tree,
        content: [
          {
            kind: "text" as const,
            start: 0,
            end: 7,
            runs: [{ text: "My work", href: "https://github.com/quillwort/awesome-cv" }],
          },
        ],
      },
    };
    const summary = (value: unknown) => ({
      text: JSON.stringify(value),
      kind: "summary" as const,
      names: new Set(["cventry"]),
    });
    const own = {
      template: "02-awesome-cv",
      family: "awesome-cv",
      documents: [{ id: "awesome-cv-0003", outcome: "partial", gate: "passes" }],
      requests: { written: 0, withheld: 1, note: NO_REQUEST_NOTE },
      macros: [{ key: key("a"), of: "command", name: "cventry", calls: 3 }],
      redefinitions: { applied: { makecvheader: 1 }, dropped: {} },
    };
    expect(leaksIn(summary(own), [document], naming.findLeaks)).toEqual([]);
    // Anything else is read: a value the export does not write is found.
    expect(
      leaksIn(
        summary({ ...own, family: "the awesome-cv of quillwort" }),
        [document],
        naming.findLeaks,
      ),
    ).toEqual(["link in call site"]);
  });
});

/** An invented document's text as the leak check reads it. */
function textOf(body: string, first: string, last: string) {
  const text = kept(body, first, last);
  return {
    tree: text.tree,
    header: text.header,
    stored: [],
    sources: [],
    page: text.page,
    names: new Map(),
  };
}

describe.skipIf(!engineAvailable())(
  "the export of an invented document, through the pipeline",
  () => {
    let session: EngineSession;
    let fonts: FontLibrary;
    let tree: ReturnType<typeof readTree>;
    beforeAll(async () => {
      session = await startNodeSession();
      const manifest = JSON.parse(
        readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
      ) as EngineManifest;
      tree = readTree(manifest.files, manifest.fonts);
      fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
        readFileSync(join(ENGINE_DIR, "files", path)),
      );
    }, 60_000);

    /** An invented class, whose macros hold none of the person's words. */
    const CLASS = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{demoprobe}[2026/09/30 a made-up class for the review's tests]
\LoadClass{article}
\RequirePackage[hidelinks]{hyperref}
\newcommand{\cvname}[2]{\def\@cvfirst{#1}\def\@cvlast{#2}}
\newcommand{\cvheader}{{\Large\@cvfirst\ \@cvlast}\par}
\newcommand{\cvmail}[1]{\href{mailto:#1}{#1}\par}
\newcommand{\cventry}[3]{\textbf{#1}\hfill\textit{#3}\par #2\par}
\newenvironment{cvitems}{\begin{itemize}}{\end{itemize}}
`;

    /** An invented resume: every word of it is the person's, for these tests. */
    const MAIN = String.raw`\documentclass{demoprobe}
\cvname{Quillwort}{Larkfield}
\begin{document}
\cvheader
\cvmail{quillwort@example.invalid}
\cventry{Tide Keeper}{Wrenfield Labs, Kestrel Bay}{June 2020 -- Present}
\begin{cvitems}
\item Kept the tidal ledger.
\end{cvitems}
\end{document}
`;

    /** The words of the resume that the export must never hold. */
    const TEXTS = [
      "quillwort",
      "larkfield",
      "tide keeper",
      "wrenfield",
      "kestrel",
      "tidal",
      "ledger",
    ];

    /** The answers a model would give for the invented class's macros. */
    const NAMING: ModelNaming = {
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
      ],
      preamble: { parameters: [] },
    };

    test("writes the request, the answers and the summary, and none of the resume's text", async () => {
      const zipped = { "cv.tex": strToU8(MAIN), "demoprobe.cls": strToU8(CLASS) };
      const uploaded = intake({ name: "invented.zip", bytes: zipSync(zipped) }, { tree });
      if (isRefusal(uploaded)) throw new Error(`refused at intake: ${uploaded.message}`);
      const first = await reference(session, fonts, uploaded as Intake);
      if (isRefusal(first)) throw new Error(`refused: ${first.message}`);
      // Read in Latin Modern, as the pipeline reads a document whose Computer Modern in TS1, the
      // itemize bullet's, the page cannot draw (decision 0026).
      const swap = await inLatinModern(session, fonts, uploaded as Intake, first);
      if (swap !== undefined && "refused" in swap) throw new Error(swap.message);
      const taken = swap?.intake ?? (uploaded as Intake);
      const made_ = swap?.reference ?? first;
      const body = bodyOf(taken);
      if (isRefusal(body)) throw new Error(body.message);
      const read = readBody(body);
      if (isRefusal(read)) throw new Error(read.message);
      const preamble = readBody(bodyOfText(body.preamble));
      const found = await signatures(
        session,
        taken,
        made_,
        body,
        probeUses(read, isRefusal(preamble) ? undefined : preamble),
      );
      if (isRefusal(found)) throw new Error("no signatures");
      const built = buildTree(read, found);
      if (isRefusal(built)) throw new Error(built.message);
      const probed = await probe(session, fonts, taken, made_, built, found);
      if (probed.format !== undefined) session.dropFormat("pdftex", probed.format);
      // The request as the run builds it, the import's own, without the header's values
      // (`importRequest`, decision 0038), and the answers a model gave, filed in a cache of this
      // test's own; the check is given the header's values they find besides, as the run gives it.
      const sent = await naming.importRequest({
        tree: built,
        signatures: found,
        probe: probed,
        preamble: body.preamble,
        intake: taken,
        reference: made_,
        fonts,
      });
      if ("refused" in sent) throw new Error(sent.message);
      const cache = new FileAnswerCache({ committed: folder(), writable: folder() });
      const filing = await storedAnswersOf(sent.request, NAMING, "model:invented-model");
      for (const each of filing.answers) cache.put(each.key, each);
      const { request, names } = sent;
      const header = { first: "Quillwort", last: "Larkfield" };
      const document = { ...sent.document, header };
      expect(naming.findLeaks(request, sent.document)).toEqual([]);
      expect(naming.findLeaks(request, document)).toEqual([]);
      const realName = (name: string) => naming.realName(names, name);
      const asked = request.macros.map((macro) => ({ ...macro, name: realName(macro.name) }));
      const assembling = await answersFor(asked, cache);
      expect(assembling.found.length).toBe(5);
      const validated = await validate({
        session,
        fonts,
        intake: taken,
        reference: made_,
        tree: built,
        signatures: found,
        probe: probed,
        answer: { version: NAMING_VERSION, macros: assembling.found, preamble: { parameters: [] } },
        ...(swap === undefined ? {} : { latinModern: swap.swapped }),
      });
      if ("refused" in validated) throw new Error(validated.message);
      const notes = await reviewNotesOf({
        request,
        realName,
        cache,
        probe: probed,
        assembled: validated,
        trees: { body: built },
      });
      expect(notes.macros.map((each) => [each.name, each.answer])).toEqual([
        ["cvname", "model"],
        ["cvheader", "model"],
        ["cvmail", "model"],
        ["cventry", "model"],
        ["cvitems", "model"],
      ]);
      const doc: RunDocument = {
        id: "other-0001",
        family: "other",
        outcome: outcomeOf(validated, made_).outcome,
        request,
        gate: "passes",
        text: {
          tree: built,
          header,
          stored: [...(document.stored ?? [])],
          sources: [...(document.sources ?? [])],
          page: document.page ?? {
            words: [],
            pairs: [],
            identifiers: [],
            numbers: [],
            runs: [],
            glyphs: 0,
            readable: 0,
          },
          names: [...names],
        },
        notes,
      };
      // The document as the run keeps it goes through JSON, as the export reads it back.
      const plan = await exportPlan({
        documents: [JSON.parse(JSON.stringify(doc)) as RunDocument],
        top: 20,
        cache: (asked_) => cache.get(asked_),
        findLeaks: naming.findLeaks,
        fetched: 1,
      });
      expect(plan.withheld).toEqual([]);
      expect(plan.files.map((file) => file.path)).toContain("01-other/requests/other-0001.json");
      expect(plan.files.filter((file) => file.path.includes("/answers/")).length).toBe(5);
      for (const file of plan.files) {
        const text = file.text.toLowerCase();
        for (const secret of TEXTS)
          expect(text, `${file.path} holds ${secret}`).not.toContain(secret);
        // The leak detector, fed the document's text, finds none in any file either, each read as
        // the export reads it.
        const names_ = new Set([
          ...request.macros.map((macro) => macro.name),
          ...request.definitions.map((definition) => definition.name),
        ]);
        expect(
          leaksIn(
            file.path.includes("/requests/")
              ? { text: file.text, kind: "request", request: JSON.parse(file.text) }
              : file.path.includes("/answers/")
                ? { text: file.text, kind: "answer" }
                : { text: file.text, kind: "summary", names: names_ },
            [textOf("", "Quillwort", "Larkfield"), { ...document, names }],
            naming.findLeaks,
          ),
        ).toEqual([]);
      }
    }, 60_000);
  },
);
