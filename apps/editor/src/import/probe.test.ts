import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { EngineSession } from "../engine/session";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { bound, fastestAsync } from "../test/timing";
import { type Candidate, candidatesOf, marked } from "./candidates";
import { readTree } from "./fonts";
import { type Intake, intake } from "./intake";
import {
  bodyOf,
  bodyOfText,
  buildTree,
  parseBody,
  readBody,
  type Signatures,
  usesOf,
} from "./parse";
import {
  type Aggregate,
  aggregate,
  type CompileSet,
  type GlyphPlace,
  kindOf,
  type Own,
  PROBE_PRELUDE,
  type Probe,
  type ProbeCandidate,
  probe,
  probeOrder,
  probeUses,
  settle,
  suspectsIn,
  type UncoveredRun,
  uncoveredRuns,
} from "./probe";
import type { GlyphStream, ReferenceItem } from "./reference";
import { reference } from "./reference";
import { isRefusal } from "./refusal";
import { type EngineSignatures, signatures } from "./signatures";

// Every document, class, tree and log here is invented for these tests: invented commands with
// invented names that say so, and invented words. Nothing is taken from a real resume.

/** An invented candidate: a call's argument of `name`, at `index`, from `start`. */
function candidate(
  id: string,
  name = "inventedcall",
  index = 1,
  extra: Partial<Candidate> = {},
): Candidate {
  return {
    id,
    kind: "argument",
    where: "body",
    of: "call",
    name,
    index,
    start: 0,
    end: 0,
    text: "Invented",
    empty: false,
    ...extra,
  };
}

/** How an invented candidate behaves when wrapped. */
type Behaviour = "ok" | "breaks" | "moves" | "torn" | NonNullable<Own["reason"]>;

/**
 * An invented engine: a compile of a set stops when it holds a candidate that `breaks`, moves the
 * page when it holds one that `moves`, and shows each candidate's own failure; `torn` is one whose
 * markers never come and leave torn ones behind. With `name`, a compile names the first
 * candidate that stopped or moved it, as the real one names what it read.
 */
function engine(behaviours: Record<string, Behaviour>, name = false) {
  const compiled: string[][] = [];
  const compile: CompileSet = async (set) => {
    compiled.push(set.map((each) => each.id));
    const breakers = set.filter((each) => behaviours[each.id] === "breaks");
    if (breakers.length > 0)
      return {
        broke: true,
        same: false,
        torn: false,
        own: new Map(),
        suspects: name ? [breakers[0]?.id ?? ""] : [],
      };
    const own = new Map<string, Own>(
      set.map((each, i) => {
        const behaviour = behaviours[each.id] ?? "ok";
        const glyphs: GlyphPlace[] = [[0, i]];
        if (behaviour === "ok" || behaviour === "moves") return [each.id, { ok: true, glyphs }];
        if (behaviour === "torn") return [each.id, { ok: false, reason: "vanished" }];
        return [each.id, { ok: false, reason: behaviour, glyphs }];
      }),
    );
    const movers = set.filter((each) => behaviours[each.id] === "moves");
    return {
      broke: false,
      same: movers.length === 0,
      ...(movers.length === 0 ? {} : { difference: "position" as const }),
      torn: set.some((each) => behaviours[each.id] === "torn"),
      own,
      ...(name && movers.length > 0 ? { suspects: [movers[0]?.id ?? ""] } : {}),
    };
  };
  return { compile, compiled };
}

const verdictsOf = (settlement: Awaited<ReturnType<typeof settle>>) =>
  Object.fromEntries(
    [...settlement.verdicts].map(([id, { verdict, settled }]) => [id, `${verdict} ${settled}`]),
  );

describe("settling the candidates", () => {
  test("settles a set that passes whole in one compile", async () => {
    const set = Array.from({ length: 10 }, (_, i) => candidate(`c${i + 1}-1`));
    const { compile, compiled } = engine({});
    const found = await settle(set, compile, 64);
    expect(compiled).toHaveLength(1);
    expect(found.compiles).toBe(1);
    expect(Object.values(verdictsOf(found))).toEqual(Array(10).fill("editable together"));
    expect(found.evidence.get("c3-1")).toEqual([[0, 2]]);
  });

  test("takes what a candidate's own markers show as its own, beside the rest", async () => {
    const set = ["ok", "twice", "case", "misaligned", "split", "vanished"].map((behaviour, i) =>
      candidate(`c${i + 1}-1`, `inventedcall${i}`),
    );
    const { compile, compiled } = engine({
      "c2-1": "twice",
      "c3-1": "case",
      "c4-1": "misaligned",
      "c5-1": "split",
      "c6-1": "vanished",
    });
    const found = await settle(set, compile, 64);
    // The set, and the one editable candidate alone, as item 7 would mark it.
    expect(compiled).toEqual([set.map((each) => each.id), ["c1-1"]]);
    expect(verdictsOf(found)).toEqual({
      "c1-1": "editable together",
      "c2-1": "twice together",
      "c3-1": "case together",
      "c4-1": "misaligned together",
      "c5-1": "split together",
      "c6-1": "vanished together",
    });
  });

  test("splits a set a candidate stops until it stops one alone, and tries first one it names", async () => {
    const set = Array.from({ length: 16 }, (_, i) => candidate(`c${i + 1}-1`));
    const blind = engine({ "c11-1": "breaks" });
    const found = await settle(set, blind.compile, 64);
    expect(found.verdicts.get("c11-1")).toEqual({ verdict: "breaks", settled: "alone" });
    expect([...found.verdicts.values()].filter((each) => each.verdict === "editable")).toHaveLength(
      15,
    );
    // Halving finds one of sixteen in two compiles a level, and the fifteen left take one more
    // together, since no half held just them.
    expect(found.compiles).toBeLessThanOrEqual(1 + 2 * Math.log2(16) + 1);
    const named = engine({ "c11-1": "breaks" }, true);
    const quick = await settle(set, named.compile, 64);
    const only = (settlement: typeof found) =>
      Object.fromEntries([...settlement.verdicts].map(([id, { verdict }]) => [id, verdict]));
    expect(only(quick)).toEqual(only(found));
    // The whole set, the named one alone, and the rest.
    expect(named.compiled).toEqual([
      set.map((each) => each.id),
      ["c11-1"],
      set.filter((each) => each.id !== "c11-1").map((each) => each.id),
    ]);
  });

  test("finds a candidate that moves the page, and tries again without those that failed", async () => {
    const set = Array.from({ length: 8 }, (_, i) => candidate(`c${i + 1}-1`, `inventedcall${i}`));
    const { compile } = engine({ "c3-1": "moves", "c6-1": "twice" });
    const found = await settle(set, compile, 64);
    expect(verdictsOf(found)).toMatchObject({ "c3-1": "moved alone", "c6-1": "twice together" });
    for (const id of ["c1-1", "c2-1", "c4-1", "c5-1", "c7-1", "c8-1"])
      expect(found.verdicts.get(id)?.verdict).toBe("editable");
    expect(found.verdicts.get("c3-1")?.detail).toBe("position");
  });

  test("tries alone one whose markers never came when others were torn, where the torn ones are its own", async () => {
    const set = [candidate("c1-1", "inventedtorn"), candidate("c2-1", "inventedplain")];
    const { compile, compiled } = engine({ "c1-1": "torn" });
    const found = await settle(set, compile, 64);
    expect(found.verdicts.get("c1-1")).toEqual({
      verdict: "misaligned",
      detail: "torn",
      settled: "alone",
    });
    expect(found.verdicts.get("c2-1")?.verdict).toBe("editable");
    expect(compiled).toEqual([["c1-1", "c2-1"], ["c1-1"], ["c2-1"]]);
  });

  test("tries again without the mover a field a move split across pages or set twice", async () => {
    // `a` moves the page and its paragraph gains a line: with `a` wrapped, `b`'s field straddles
    // the page's end, and a running head brings `c`'s onto the page. Without `a`, both are fine.
    const set = ["a", "b", "c"].map((id) => candidate(id, `invented${id}`));
    const compiled: string[][] = [];
    const compile: CompileSet = async (given) => {
      const ids = given.map((each) => each.id);
      compiled.push(ids);
      const moved = ids.includes("a");
      const own = new Map<string, Own>(
        given.map((each): [string, Own] => {
          if (moved && each.id === "b") return [each.id, { ok: false, reason: "split" }];
          if (moved && each.id === "c")
            return [each.id, { ok: false, reason: "twice", detail: "page", glyphs: [] }];
          return [each.id, { ok: true, glyphs: [] }];
        }),
      );
      return {
        broke: false,
        same: !moved,
        ...(moved ? { difference: "pages" as const, suspects: ["a"] } : {}),
        torn: false,
        own,
      };
    };
    const found = await settle(set, compile, 64);
    expect(verdictsOf(found)).toEqual({
      a: "moved alone",
      b: "editable together",
      c: "editable together",
    });
    expect(compiled).toEqual([["a", "b", "c"], ["a"], ["b", "c"]]);
    // In an output that sets the reference's glyphs, a field on two pages is its own doing.
    const still: CompileSet = async (given) => ({
      broke: false,
      same: true,
      torn: false,
      own: new Map(
        given.map((each): [string, Own] => [
          each.id,
          each.id === "b" ? { ok: false, reason: "split" } : { ok: true, glyphs: [] },
        ]),
      ),
    });
    expect((await settle(set, still, 64)).verdicts.get("b")).toEqual({
      verdict: "split",
      settled: "together",
    });
  });

  test("compiles every editable candidate together, and locks the one that fails beside the others", async () => {
    // `a` and `c` move nothing alone, and the page together, as two fields whose markers each take
    // a little from one line would.
    const set = ["a", "b", "c", "d"].map((id) => candidate(id, `invented${id}`));
    const clash = (ids: readonly string[]) => ids.includes("a") && ids.includes("c");
    const engineOf = () => {
      const compiled: string[][] = [];
      const compile: CompileSet = async (given) => {
        const ids = given.map((each) => each.id);
        compiled.push(ids);
        return {
          broke: false,
          same: !clash(ids),
          ...(clash(ids) ? { difference: "position" as const, suspects: ["c"] } : {}),
          torn: false,
          own: new Map(given.map((each): [string, Own] => [each.id, { ok: true, glyphs: [] }])),
        };
      };
      return { compile, compiled };
    };
    const { compile, compiled } = engineOf();
    const found = await settle(set, compile, 64);
    expect(verdictsOf(found)).toEqual({
      a: "editable together",
      b: "editable together",
      c: "moved union",
      d: "editable together",
    });
    expect(found.verdicts.get("c")?.detail).toBe("position");
    // What item 7 marks, every editable candidate together, is a set a compile passed.
    const editable = set.filter((each) => found.verdicts.get(each.id)?.verdict === "editable");
    expect(compiled).toContainEqual(editable.map((each) => each.id));
    expect(clash(editable.map((each) => each.id))).toBe(false);
    // With too little budget to find which, the largest set known to pass stays editable.
    const short = engineOf();
    const left = await settle(set, short.compile, 4);
    expect(short.compiled).toHaveLength(4);
    expect(verdictsOf(left)).toEqual({
      a: "editable together",
      b: "editable together",
      c: "untested budget",
      d: "editable together",
    });
  });

  test("tries the others of a kind one of which stopped a compile alone among themselves", async () => {
    const bad = Array.from({ length: 6 }, (_, i) => candidate(`c${i + 1}-2`, "inventedbad", 2));
    const good = Array.from({ length: 6 }, (_, i) => candidate(`c${i + 1}-1`, "inventedgood", 1));
    const behaviours = Object.fromEntries(bad.map((each) => [each.id, "breaks" as const]));
    const { compile } = engine(behaviours);
    const found = await settle(probeOrder([...bad, ...good]), compile, 64);
    const bads = bad.map((each) => found.verdicts.get(each.id));
    expect(bads.every((each) => each?.verdict === "breaks")).toBe(true);
    expect(bads.filter((each) => each?.settled === "alone")).toHaveLength(1);
    expect(bads.filter((each) => each?.settled === "like")).toHaveLength(5);
    expect(good.every((each) => found.verdicts.get(each.id)?.verdict === "editable")).toBe(true);
    expect(found.compiles).toBeLessThanOrEqual(8);
  });

  test("leaves what the budget does not reach untested", async () => {
    const set = Array.from({ length: 8 }, (_, i) => candidate(`c${i + 1}-1`, `inventedcall${i}`));
    const { compile, compiled } = engine(
      Object.fromEntries(set.map((each) => [each.id, "breaks" as const])),
    );
    const found = await settle(set, compile, 3);
    expect(compiled).toHaveLength(3);
    expect(found.compiles).toBe(3);
    const untested = [...found.verdicts.values()].filter((each) => each.verdict === "untested");
    expect(untested.length).toBeGreaterThan(0);
    expect(untested.every((each) => each.settled === "budget")).toBe(true);
    expect(found.verdicts.size).toBe(8);
  });

  test("orders candidates by kind, a paragraph inside an argument with that argument's kind", () => {
    const owner = candidate("c1-1", "inventedraw", 1, { unprobed: "raw" });
    const part = candidate("t1", "", undefined, { kind: "paragraph", within: "c1-1" });
    const loose = candidate("t2", "", undefined, { kind: "paragraph" });
    const second = candidate("c2-1", "inventedraw", 1, { unprobed: "raw" });
    const other = candidate("t3", "", undefined, { kind: "paragraph", within: "c2-1" });
    const owners = new Map([owner, second].map((each) => [each.id, each]));
    expect(kindOf(part, owners)).toBe(kindOf(other, owners));
    expect(kindOf(loose, owners)).not.toBe(kindOf(part, owners));
    expect(probeOrder([part, loose, other], owners).map((each) => each.id)).toEqual([
      "t1",
      "t3",
      "t2",
    ]);
  });

  test("orders the probe's kinds that hold the most words first, each kind's in the source's order", () => {
    const words = (n: number) => Array.from({ length: n }, () => "Invented").join(" ");
    const set = [
      candidate("c1-1", "inventedshort", 1, { text: words(2) }),
      candidate("c1-2", "inventedlong", 2, { text: words(5) }),
      candidate("c2-1", "inventedshort", 1, { text: words(2) }),
      candidate("c2-2", "inventedlong", 2, { text: words(4) }),
      candidate("c3-1", "inventedtie", 1, { text: words(4) }),
      candidate("c4-1", "inventedempty", 1, { text: "", empty: true }),
      candidate("c5-1", "inventedother", 1, { text: words(4) }),
    ];
    // inventedlong 9 words, then the three kinds of 4 in the order each first came, the empty one
    // last.
    expect(probeOrder(set, undefined, true).map((each) => each.id)).toEqual([
      "c1-2",
      "c2-2",
      "c1-1",
      "c2-1",
      "c3-1",
      "c5-1",
      "c4-1",
    ]);
    // In another source order, each kind's candidates follow it, and kinds of as many words follow
    // the order each first came in it.
    expect(probeOrder([...set].reverse(), undefined, true).map((each) => each.id)).toEqual([
      "c2-2",
      "c1-2",
      "c5-1",
      "c3-1",
      "c2-1",
      "c1-1",
      "c4-1",
    ]);
    // The checks' bisections keep each kind where it first came in the source.
    expect(probeOrder(set).map((each) => each.id)).toEqual([
      "c1-1",
      "c2-1",
      "c1-2",
      "c2-2",
      "c3-1",
      "c4-1",
      "c5-1",
    ]);
  });

  test("spends the budget on the kinds with the most words, and leaves the fewest untested", async () => {
    // Four short kinds come first in the source, each of whose calls stops a compile, and one long
    // kind last that passes: in the source's order the budget would go to the short ones.
    const short = Array.from({ length: 4 }, (_, i) =>
      candidate(`c${i + 1}-1`, `inventedshort${i}`, 1, { text: "Invented" }),
    );
    const long = Array.from({ length: 6 }, (_, i) =>
      candidate(`c${i + 5}-1`, "inventedlong", 1, {
        text: "Invented words for an invented line of a long invented entry",
      }),
    );
    const behaviours = Object.fromEntries(short.map((each) => [each.id, "breaks" as const]));
    const inSourceEngine = engine(behaviours);
    const inSource = await settle([...short, ...long], inSourceEngine.compile, 4);
    const orderedEngine = engine(behaviours);
    const ordered = await settle(
      probeOrder([...short, ...long], undefined, true),
      orderedEngine.compile,
      4,
    );
    const editable = (found: Awaited<ReturnType<typeof settle>>) =>
      [...found.verdicts].filter(([, each]) => each.verdict === "editable").map(([id]) => id);
    expect(editable(inSource)).toEqual([]);
    expect(editable(ordered).sort()).toEqual(long.map((each) => each.id).sort());
    // The whole set stops; its first half, the long kind, passes; the short calls stop together,
    // and the budget's last compile goes to the first half of them.
    expect(orderedEngine.compiled).toEqual([
      ["c5-1", "c6-1", "c7-1", "c8-1", "c9-1", "c10-1", "c1-1", "c2-1", "c3-1", "c4-1"],
      ["c5-1", "c6-1", "c7-1", "c8-1", "c9-1", "c10-1"],
      ["c1-1", "c2-1", "c3-1", "c4-1"],
      ["c1-1", "c2-1"],
    ]);
    const untested = [...ordered.verdicts].filter(([, each]) => each.verdict === "untested");
    expect(untested.every(([id]) => short.some((each) => each.id === id))).toBe(true);
  });

  test.each([
    ["holds no word, after the rest", ""],
    ["holds fewer words than the rest, after the rest's first compile", "Invented"],
  ])("tries a kind held apart that %s", async (_, text) => {
    // Calls of one kind each move the page alone, and the first is found alone first; the others
    // of its kind are held apart, and the long kind is the rest of the set.
    const movers = Array.from({ length: 6 }, (_, i) =>
      candidate(`c${i + 1}-1`, "inventedgap", 1, { text, empty: text === "" }),
    );
    const long = Array.from({ length: 4 }, (_, i) =>
      candidate(`c${i + 7}-1`, "inventedlong", 1, {
        text: "Invented words for an invented line of a long invented entry",
      }),
    );
    const behaviours = Object.fromEntries(movers.map((each) => [each.id, "moves" as const]));
    const set = probeOrder([...movers, ...long], undefined, true);
    const editable = (found: Awaited<ReturnType<typeof settle>>) =>
      long.filter((each) => found.verdicts.get(each.id)?.verdict === "editable").length;
    // Held apart first, the movers take the budget one by one and the long kind is left.
    const heldFirst = engine(behaviours, true);
    const before = await settle(set, heldFirst.compile, 6);
    expect(editable(before)).toBe(0);
    // The long kind's compile comes before the movers', which settles it.
    const wordsFirst = engine(behaviours, true);
    const after = await settle(set, wordsFirst.compile, 6, undefined, true);
    expect(editable(after)).toBe(4);
    // The whole set moves and names the first mover, which moves alone; the long kind's compile
    // comes next and passes; then the movers held apart, until the budget runs out.
    expect(wordsFirst.compiled).toEqual([
      ["c7-1", "c8-1", "c9-1", "c10-1", "c1-1", "c2-1", "c3-1", "c4-1", "c5-1", "c6-1"],
      ["c1-1"],
      ["c7-1", "c8-1", "c9-1", "c10-1"],
      ["c2-1", "c3-1", "c4-1", "c5-1", "c6-1"],
      ["c2-1"],
      ["c3-1", "c4-1", "c5-1", "c6-1"],
    ]);
    // With the budget to settle everything, the order changes no verdict.
    const all = await settle(set, engine(behaviours, true).compile, 64);
    const allWordsFirst = await settle(set, engine(behaviours, true).compile, 64, undefined, true);
    expect(verdictsOf(allWordsFirst)).toEqual(verdictsOf(all));
    expect(allWordsFirst.compiles).toBe(all.compiles);
  });

  test("tries a kind held apart that holds more words than the rest before the rest, as before", async () => {
    // Long calls of one kind each move the page alone, and the first is found alone first; the
    // others of its kind are held apart, and the rest, a short kind, holds fewer words.
    const movers = Array.from({ length: 5 }, (_, i) =>
      candidate(`c${i + 1}-1`, "inventedlong", 1, {
        text: "Invented words for an invented line of a long invented entry",
      }),
    );
    const rest = Array.from({ length: 3 }, (_, i) =>
      candidate(`c${i + 6}-1`, "inventedshort", 1, { text: "Invented" }),
    );
    const behaviours = Object.fromEntries(movers.map((each) => [each.id, "moves" as const]));
    const set = probeOrder([...movers, ...rest], undefined, true);
    const before = engine(behaviours, true);
    const found = await settle(set, before.compile, 64);
    const after = engine(behaviours, true);
    const wordsFirst = await settle(set, after.compile, 64, undefined, true);
    // The kind held apart goes first, so the compiles are the same ones in the same order.
    expect(after.compiled).toEqual(before.compiled);
    expect(verdictsOf(wordsFirst)).toEqual(verdictsOf(found));
    expect(wordsFirst.compiles).toBe(found.compiles);
    expect(verdictsOf(wordsFirst)).toEqual({
      "c1-1": "moved alone",
      "c2-1": "moved alone",
      "c3-1": "moved alone",
      "c4-1": "moved alone",
      "c5-1": "moved alone",
      "c6-1": "editable together",
      "c7-1": "editable together",
      "c8-1": "editable together",
    });
  });

  test("keeps the one with more words of two that pass alone and fail together", async () => {
    // Each passes alone; together they move the page, so the union locks the later one of them.
    const set = [
      candidate("c1-1", "inventedshort", 1, { text: "Invented" }),
      candidate("c2-1", "inventedlong", 1, { text: "Invented words of an invented line" }),
    ];
    const compile: CompileSet = async (given) => ({
      broke: false,
      same: given.length < 2,
      ...(given.length < 2 ? {} : { difference: "position" as const }),
      torn: false,
      own: new Map(given.map((each) => [each.id, { ok: true, glyphs: [] }])),
    });
    // With the budget to spare, the order of the kinds still decides which of the two is locked.
    const inSource = await settle(probeOrder(set), compile, 64);
    expect(verdictsOf(inSource)).toEqual({ "c1-1": "editable alone", "c2-1": "moved union" });
    const ordered = await settle(probeOrder(set, undefined, true), compile, 64, undefined, true);
    expect(verdictsOf(ordered)).toEqual({ "c1-1": "moved union", "c2-1": "editable alone" });
  });

  /**
   * An invented engine whose compiles name the wrong candidate: a set that holds `mover` moves the
   * page, and its compile names the candidate just before the mover in the set, which passes alone,
   * as a field whose markers come last before where the output parts from the reference's may.
   */
  function misnaming(mover: string) {
    const compiled: string[][] = [];
    const compile: CompileSet = async (set) => {
      const ids = set.map((each) => each.id);
      compiled.push(ids);
      const at = ids.indexOf(mover);
      const before = at > 0 ? ids[at - 1] : undefined;
      return {
        broke: false,
        same: at < 0,
        ...(at < 0 ? {} : { difference: "position" as const }),
        torn: false,
        own: new Map(
          set.map((each, i): [string, Own] => [each.id, { ok: true, glyphs: [[0, i]] }]),
        ),
        ...(before === undefined ? {} : { suspects: [before] }),
      };
    };
    return { compile, compiled };
  }

  test("halves a set once a candidate its compile names passes alone", async () => {
    const set = Array.from({ length: 16 }, (_, i) => candidate(`c${i + 1}-1`));
    const wrong = misnaming("c11-1");
    const found = await settle(set, wrong.compile, 64);
    // The verdicts are those of halving with no name at all.
    const plain = await settle(set, engine({ "c11-1": "moves" }).compile, 64);
    const only = (settlement: typeof found) =>
      Object.fromEntries([...settlement.verdicts].map(([id, { verdict }]) => [id, verdict]));
    expect(only(found)).toEqual(only(plain));
    expect(found.verdicts.get("c11-1")).toEqual({
      verdict: "moved",
      detail: "position",
      settled: "alone",
    });
    // The whole set names `c10-1`, which passes alone; the rest moves and is halved, not tried
    // without the next name. A half that moves is trusted again, and halved when its name is wrong
    // too: at most four compiles a level, where trusting each next name took two a candidate.
    const ids = (from: number, to: number, but?: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => `c${from + i}-1`).filter(
        (id) => id !== `c${but}-1`,
      );
    expect(wrong.compiled).toEqual([
      ids(1, 16),
      ["c10-1"],
      ids(1, 16, 10),
      ids(1, 7),
      ids(8, 16, 10),
      ["c9-1"],
      ["c8-1", ...ids(11, 16)],
      ["c8-1", "c11-1", "c12-1"],
      ["c8-1"],
      ["c11-1", "c12-1"],
      ["c11-1"],
      ["c12-1"],
      ids(13, 16),
      ids(1, 16, 11),
    ]);
    expect(found.compiles).toBe(14);
  });

  test("settles within the budget a long set whose compiles name the wrong candidate", async () => {
    // Sixty-four calls, one of which moves the page; trusting each name took the whole budget on
    // the calls before the mover, two at a time, and left the rest untested.
    const set = Array.from({ length: 64 }, (_, i) => candidate(`c${i + 1}-1`));
    const wrong = misnaming("c60-1");
    const found = await settle(set, wrong.compile, 24);
    const verdicts = [...found.verdicts.values()];
    expect(verdicts.filter((each) => each.verdict === "untested")).toEqual([]);
    expect(found.verdicts.get("c60-1")?.verdict).toBe("moved");
    expect(verdicts.filter((each) => each.verdict === "editable")).toHaveLength(63);
    // Nothing is editable that a compile without the mover did not pass: the last compile holds
    // every editable candidate and passed.
    const last = wrong.compiled.at(-1) ?? [];
    expect(last).toHaveLength(63);
    expect(last).not.toContain("c60-1");
    // At most four compiles a level of six, and the union's: 22 of the budget's 24.
    expect(found.compiles).toBe(22);
  });

  test("trusts the names when one of several it names bears them out alone", async () => {
    // Two calls move the page; a compile names the one just before the first mover, wrongly, and
    // the first mover, rightly. One right name of the two keeps the names' trust.
    const set = Array.from({ length: 16 }, (_, i) => candidate(`c${i + 1}-1`));
    const movers = ["c5-1", "c11-1"];
    const compiled: string[][] = [];
    const compile: CompileSet = async (given) => {
      const ids = given.map((each) => each.id);
      compiled.push(ids);
      const first = ids.find((id) => movers.includes(id));
      const at = first === undefined ? -1 : ids.indexOf(first);
      const before = at > 0 ? ids[at - 1] : undefined;
      return {
        broke: false,
        same: first === undefined,
        ...(first === undefined ? {} : { difference: "position" as const }),
        torn: false,
        own: new Map(
          given.map((each, i): [string, Own] => [each.id, { ok: true, glyphs: [[0, i]] }]),
        ),
        ...(first === undefined ? {} : { suspects: before ? [before, first] : [first] }),
      };
    };
    const found = await settle(set, compile, 64);
    const but = (...out: string[]) => set.map((each) => each.id).filter((id) => !out.includes(id));
    // Each compile that moves: its two names alone, then the rest as it was left.
    expect(compiled).toEqual([
      but(),
      ["c4-1"],
      ["c5-1"],
      but("c4-1", "c5-1"),
      ["c10-1"],
      ["c11-1"],
      but("c4-1", "c5-1", "c10-1", "c11-1"),
      but("c5-1", "c11-1"),
    ]);
    expect(verdictsOf(found)).toMatchObject({ "c5-1": "moved alone", "c11-1": "moved alone" });
    expect(
      Object.values(verdictsOf(found)).filter((each) => each.startsWith("editable")),
    ).toHaveLength(14);
  });

  test("still trusts a name the candidate bears out alone", async () => {
    // Each named mover moves alone, so the names keep their trust: the named one alone, the rest.
    const set = Array.from({ length: 8 }, (_, i) => candidate(`c${i + 1}-1`, `inventedcall${i}`));
    const named = engine({ "c3-1": "moves", "c6-1": "moves" }, true);
    const found = await settle(set, named.compile, 64);
    expect(named.compiled).toEqual([
      ids8(),
      ["c3-1"],
      ids8("c3-1"),
      ["c6-1"],
      ids8("c3-1", "c6-1"),
    ]);
    expect(verdictsOf(found)).toMatchObject({ "c3-1": "moved alone", "c6-1": "moved alone" });
  });
});

/** The ids `c1-1` to `c8-1`, but those given. */
const ids8 = (...but: string[]) =>
  Array.from({ length: 8 }, (_, i) => `c${i + 1}-1`).filter((id) => !but.includes(id));

/** An invented candidate with a verdict. */
function decided(
  id: string,
  verdict: ProbeCandidate["verdict"],
  extra: Partial<ProbeCandidate> = {},
): ProbeCandidate {
  return { ...candidate(id), verdict, settled: "together", ...extra };
}

describe("gathering the verdicts", () => {
  const find = (list: Aggregate[], name: string, index?: number) =>
    list.find((each) => each.name === name && each.index === index);

  test("per macro and argument: editable when every call probed is, else the first failure", () => {
    const { macros, standard } = aggregate([
      decided("c1-1", "editable"),
      decided("c2-1", "editable"),
      decided("c1-2", "editable", { index: 2 }),
      decided("c2-2", "twice", { index: 2 }),
      decided("c3-2", "breaks", { index: 2 }),
      decided("c1-3", "raw", { index: 3, unprobed: "raw", settled: "unprobed" }),
      decided("c2-3", "editable", { index: 3 }),
      decided("s1", "editable", {
        kind: "section",
        name: "section",
        index: undefined,
        of: undefined,
      }),
    ]);
    expect(find(macros, "inventedcall", 1)).toMatchObject({
      verdict: "editable",
      calls: 2,
      counts: { editable: 2 },
    });
    expect(find(macros, "inventedcall", 2)).toMatchObject({
      verdict: "twice",
      counts: { editable: 1, twice: 1, breaks: 1 },
    });
    // A call that holds a raw chunk is locked alone; the rest decide.
    expect(find(macros, "inventedcall", 3)).toMatchObject({
      verdict: "editable",
      counts: { raw: 1, editable: 1 },
    });
    expect(standard).toEqual([
      expect.objectContaining({ of: "standard", name: "section", verdict: "editable" }),
    ]);
  });

  test("keeps an empty call's failure apart, and a container's parts and a raw argument's parts", () => {
    const { macros, standard } = aggregate([
      decided("c1-1", "editable"),
      decided("c2-1", "moved", { empty: true }),
      decided("c1-2", "container", { index: 2, unprobed: "container", settled: "unprobed" }),
      decided("c2-2", "moved", { index: 2, empty: true }),
      decided("c1-3", "raw", { index: 3, unprobed: "raw", settled: "unprobed" }),
      decided("t1", "editable", {
        kind: "paragraph",
        name: "",
        index: undefined,
        of: undefined,
        within: "c1-3",
      }),
      decided("t2", "misaligned", {
        kind: "paragraph",
        name: "",
        index: undefined,
        of: undefined,
        within: "c1-3",
      }),
      decided("i1", "editable", {
        kind: "item",
        name: "itemize",
        index: undefined,
        of: undefined,
        within: "c1-2",
      }),
    ]);
    expect(find(macros, "inventedcall", 1)).toMatchObject({ verdict: "editable", empty: "moved" });
    expect(find(macros, "inventedcall", 2)).toMatchObject({ verdict: "container", empty: "moved" });
    expect(find(macros, "inventedcall", 3)).toMatchObject({
      verdict: "raw",
      parts: { total: 2, editable: 1 },
    });
    // An item in a container is a standard node; a paragraph in an argument is among its parts.
    expect(standard.map((each) => each.name)).toEqual(["item"]);
  });

  test("an argument none of whose calls was settled is untested, and a failure outranks it", () => {
    const { macros } = aggregate([decided("c1-1", "untested"), decided("c2-1", "editable")]);
    expect(find(macros, "inventedcall", 1)?.verdict).toBe("untested");
    expect(
      aggregate([decided("c1-1", "untested"), decided("c2-1", "vanished")]).macros[0]?.verdict,
    ).toBe("vanished");
  });
});

describe("the glyphs no editable field covers", () => {
  /** An invented page: a glyph for each character of `texts`, named by it unless `unnamed`. */
  const page = (texts: readonly string[], unnamed = false): GlyphStream => ({
    pages: [
      {
        items: [...texts.join("")].map(
          (text, i): ReferenceItem => ({
            kind: "glyph",
            font: "cmr10",
            size: 655360,
            code: text.charCodeAt(0) % 128,
            ...(unnamed ? {} : { text }),
            h: i * 1000,
            v: 100,
          }),
        ),
      },
    ],
    size: { width: 612, height: 792 },
    fonts: { tex: ["cmr10"], native: [], shipped: [] },
    specials: [],
  });
  /** Where `text` is in `source`. */
  const spanOf = (source: string, text: string) => {
    const start = source.indexOf(text);
    if (start < 0) throw new Error(`no ${text} in the source`);
    return { start, end: start + text.length };
  };
  /** The first page's glyphs from `from` to before `to`. */
  const places = (from: number, to: number): GlyphPlace[] =>
    Array.from({ length: to - from }, (_, i): GlyphPlace => [0, from + i]);
  const shown = (runs: readonly UncoveredRun[]) =>
    runs.map(({ from, to, by, candidate: id, raw }) => ({
      from,
      to,
      by,
      ...(id === undefined ? {} : { id }),
      ...(raw === undefined ? {} : { raw: raw.why }),
    }));

  test("are set down to what sets them by the text their source sets, and the rest to the template", () => {
    // `\inventedslant` sets `Label:` before its argument and a period after it, which the source
    // does not hold; its argument stopped TeX, so no compile placed its glyphs.
    const source = String.raw`\inventedentry{Alpha}\texttt{Typed}\inventedslant{Beta}\inventedentry{Omega}`;
    const { runs, covered, all } = uncoveredRuns(
      page(["Alpha", "Typed", "Label:", "Beta", ".", "Omega"]),
      [
        decided("c1-1", "editable", spanOf(source, "Alpha")),
        decided("c2-1", "breaks", { ...spanOf(source, "Beta"), name: "inventedslant" }),
        decided("c3-1", "editable", spanOf(source, "Omega")),
      ],
      new Map([
        ["c1-1", places(0, 5)],
        ["c3-1", places(21, 26)],
      ]),
      [{ ...spanOf(source, String.raw`\texttt{Typed}`), why: "typewriter" }],
      { body: source, preamble: "" },
    );
    expect(covered).toBe(10);
    expect(shown(runs)).toEqual([
      { from: 5, to: 10, by: "raw", raw: "typewriter" },
      { from: 10, to: 16, by: "chrome" },
      { from: 16, to: 20, by: "candidate", id: "c2-1" },
      { from: 20, to: 21, by: "chrome" },
    ]);
    expect(runs[0]?.first).toEqual({ h: 5000, v: 100 });
    expect(runs[0]?.last).toEqual({ h: 9000, v: 100 });
    // Every run, the editable candidates' among them, each its candidate's, for item 13's report.
    expect(shown(all)).toEqual([
      { from: 0, to: 5, by: "candidate", id: "c1-1" },
      ...shown(runs),
      { from: 21, to: 26, by: "candidate", id: "c3-1" },
    ]);
  });

  test("are a part's whose pieces the page shows nowhere whole but whose words it shows, as a parsed list's labels", () => {
    // `\inventedchart` parses `value/label` pairs and sets each label alone, so its one piece, the
    // values and the commas with the labels, is nowhere on the page, and its labels' words are; and
    // its argument moved the page when marked, so no compile placed its glyphs (item 13's review).
    const source = String.raw`\inventedentry{Alpha}\inventedchart{8/Tending bees, 6/Rowing on}`;
    const chart = spanOf(source, "8/Tending bees, 6/Rowing on");
    const { runs } = uncoveredRuns(
      page(["Alpha", "Tending", "bees", "Rowing", "on", "Page"]),
      [
        decided("c1-1", "editable", spanOf(source, "Alpha")),
        decided("c2-1", "moved", { ...chart, name: "inventedchart" }),
      ],
      new Map([["c1-1", places(0, 5)]]),
      [],
      { body: source, preamble: "" },
    );
    // The labels are the chart's; what the source sets nowhere, a page's label, the template's.
    expect(shown(runs)).toEqual([
      { from: 5, to: 24, by: "candidate", id: "c2-1" },
      { from: 24, to: 28, by: "chrome" },
    ]);
    // The same where one label is braced, a piece the page shows whole, and the rest are not.
    const braced = String.raw`\inventedentry{Alpha}\inventedchart{8/{Tending bees}, 6/Rowing on}`;
    const again = uncoveredRuns(
      page(["Alpha", "Tending", "bees", "Rowing", "on", "Page"]),
      [
        decided("c1-1", "editable", spanOf(braced, "Alpha")),
        decided("c2-1", "breaks", {
          ...spanOf(braced, "8/{Tending bees}, 6/Rowing on"),
          name: "x",
        }),
      ],
      new Map([["c1-1", places(0, 5)]]),
      [],
      { body: braced, preamble: "" },
    );
    expect(shown(again.runs)).toEqual(shown(runs));
  });

  test("are a raw chunk's or a locked candidate's whole when their source lies in it", () => {
    // A raw chunk with two parts, and a locked argument with two, a separator between each two.
    const source = String.raw`\inventedraw{One $|$ Two}\inventedpair{Three $|$ Four}`;
    const pair = spanOf(source, "Three $|$ Four");
    const parts = ["One", "Two", "Three", "Four"].map((text, i) =>
      decided(`t${i + 1}`, "editable", {
        ...spanOf(source, text),
        kind: "paragraph",
        name: "",
        index: undefined,
        of: undefined,
        ...(i >= 2 ? { within: "c1-1" } : {}),
      }),
    );
    const { runs } = uncoveredRuns(
      page(["One", "|", "Two", "Three", "|", "Four"]),
      [decided("c1-1", "raw", { ...pair, name: "inventedpair", unprobed: "raw" }), ...parts],
      new Map([
        ["t1", places(0, 3)],
        ["t2", places(4, 7)],
        ["t3", places(7, 12)],
        ["t4", places(13, 17)],
      ]),
      [
        { ...spanOf(source, String.raw`\inventedraw{One $|$ Two}`), why: "unknown" },
        { start: pair.start + 6, end: pair.start + 9, why: "math" },
      ],
      { body: source, preamble: "" },
    );
    expect(shown(runs)).toEqual([
      { from: 3, to: 4, by: "raw", raw: "unknown" },
      { from: 12, to: 13, by: "candidate", id: "c1-1" },
    ]);
  });

  test("are set down to a locked header field between the header's, and beside the body's to the header", () => {
    const preamble = String.raw`\inventedname{Quill}\inventedtitle{Invented Title}\inventedplace{Nowhere}`;
    const body = String.raw`\inventedentry{Alpha}`;
    const header = (id: string, verdict: ProbeCandidate["verdict"], text: string) =>
      decided(id, verdict, { ...spanOf(preamble, text), where: "preamble" });
    // The header: the name, a separator, the title, the place, and a caption the class sets.
    const { runs } = uncoveredRuns(
      page(["Quill", "·", "InventedTitle", "Nowhere", "Contents", "Alpha"]),
      [
        header("h1-1", "editable", "Quill"),
        header("h2-1", "moved", "Invented Title"),
        header("h3-1", "editable", "Nowhere"),
        decided("c1-1", "editable", spanOf(body, "Alpha")),
      ],
      new Map([
        ["h1-1", places(0, 5)],
        ["h3-1", places(19, 26)],
        ["c1-1", places(34, 39)],
      ]),
      [],
      { body, preamble },
    );
    expect(shown(runs)).toEqual([
      { from: 5, to: 6, by: "chrome" },
      { from: 6, to: 19, by: "candidate", id: "h2-1" },
      { from: 26, to: 34, by: "chrome" },
    ]);
  });

  test("are found among the other arguments of a call that sets them in another order", () => {
    // `\inventedrow` sets its third argument between its first and its second, as a date at a
    // row's end; its third stopped TeX, and its fourth, `Beta words`, holds its second's text.
    const source = String.raw`\inventedrow{Alpha}{Beta}{Gamma}{Beta words}\inventedentry{Omega}`;
    const { runs } = uncoveredRuns(
      page(["Alpha", "Gamma", "Beta", "Betawords", "Omega"]),
      [
        decided("c1-1", "editable", { ...spanOf(source, "Alpha"), name: "inventedrow" }),
        decided("c1-2", "editable", { ...spanOf(source, "{Beta}"), name: "inventedrow", index: 2 }),
        decided("c1-3", "breaks", { ...spanOf(source, "Gamma"), name: "inventedrow", index: 3 }),
        decided("c1-4", "breaks", {
          ...spanOf(source, "Beta words"),
          name: "inventedrow",
          index: 4,
        }),
        decided("c2-1", "editable", { ...spanOf(source, "Omega"), name: "inventedentry" }),
      ],
      new Map([
        ["c1-1", places(0, 5)],
        ["c1-2", places(10, 14)],
        ["c2-1", places(23, 28)],
      ]),
      [],
      { body: source, preamble: "" },
    );
    expect(shown(runs)).toEqual([
      { from: 5, to: 10, by: "candidate", id: "c1-3" },
      { from: 14, to: 23, by: "candidate", id: "c1-4" },
    ]);
  });

  test("are shared in proportion to their source when the page names none of their glyphs", () => {
    const source = String.raw`\inventedentry{Alpha}\inventedgap{Beta}\texttt{Gamma}\inventedentry{Omega}`;
    const { runs } = uncoveredRuns(
      page(["Alpha", "12345678", "Omega"], true),
      [
        decided("c1-1", "editable", spanOf(source, "Alpha")),
        decided("c2-1", "breaks", { ...spanOf(source, "Beta"), name: "inventedgap" }),
        decided("c3-1", "editable", spanOf(source, "Omega")),
      ],
      new Map([
        ["c1-1", places(0, 5)],
        ["c3-1", places(13, 18)],
      ]),
      [{ ...spanOf(source, String.raw`\texttt{Gamma}`), why: "typewriter" }],
      { body: source, preamble: "" },
    );
    // Four characters of source and fourteen: two glyphs of the eight and six.
    expect(shown(runs)).toEqual([
      { from: 5, to: 7, by: "candidate", id: "c2-1" },
      { from: 7, to: 13, by: "raw", raw: "typewriter" },
    ]);
  });
});

describe("what a compile that stopped names", () => {
  test("is the candidates whose markers its first error's context shows TeX reading", () => {
    const log = [
      "(./import.tex",
      "! Missing number, treated as zero.",
      "<to be read again> ",
      "                   \\rtfield ",
      "l.12 \\inventedgap{\\rtfield{c4-1}{2em}}",
      "                                    Invented words \\rtfield{c5-1}{x}",
      "More words, \\rtfield{c6-1}{later}",
    ].join("\n");
    expect(suspectsIn(log, new Set(["c4-1", "c5-1", "c6-1"]))).toEqual(["c4-1", "c5-1"]);
    expect(suspectsIn(log, new Set(["c9-1"]))).toEqual([]);
    expect(suspectsIn("No error at all.", new Set(["c4-1"]))).toEqual([]);
  });
});

describe("the probe's work outside TeX", () => {
  /** An invented body of `calls` entries, every tenth's second argument a length. */
  const body = (calls: number) =>
    Array.from(
      { length: calls },
      (_, i) =>
        `\\inventedentry{Invented role ${i}}{${i % 10 === 0 ? "2em" : `Invented place ${i}`}}\n`,
    ).join("");
  const SIGNATURES: Signatures = {
    commands: { inventedentry: { kind: "template", spec: "m m" } },
    environments: {},
  };

  test("grows with the body, compiles aside", async () => {
    const run = (calls: number) => {
      const tree = parseBody(bodyOfText(body(calls)), SIGNATURES);
      if (isRefusal(tree)) throw new Error(tree.message);
      return async () => {
        const { candidates, raw } = candidatesOf(tree);
        marked(tree.source, candidates);
        const behaviours = Object.fromEntries(
          candidates
            .filter((each) => each.text === "2em")
            .map((each) => [each.id, "breaks" as const]),
        );
        const settled = await settle(
          probeOrder(candidates),
          engine(behaviours, true).compile,
          Number.POSITIVE_INFINITY,
        );
        const results = candidates.map((each) => ({
          ...each,
          ...(settled.verdicts.get(each.id) ?? {
            verdict: "untested" as const,
            settled: "budget" as const,
          }),
        }));
        aggregate(results);
        uncoveredRuns(
          {
            pages: [],
            size: { width: 0, height: 0 },
            fonts: { tex: [], native: [], shipped: [] },
            specials: [],
          },
          results,
          settled.evidence,
          raw,
          { body: tree.source, preamble: "" },
        );
      };
    };
    const small = run(200);
    const large = run(2000);
    const [tenth = 0, whole = 0] = await fastestAsync([small, large], 5);
    // Ten times the calls, with ten times the lengths, costs about ten times as much.
    expect(whole).toBeLessThan(bound(50, tenth));
  }, 60_000);
});

describe.skipIf(!engineAvailable())("the probe, on the engine", () => {
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

  /**
   * An invented upload through the intake, the reference, the signatures, the parse and the probe,
   * the engine asked of the preamble's commands with the body's, or, with `bodyOnly`, of the
   * body's alone, as a caller that leaves the preamble's to the probe does; and the signatures the
   * probe was given.
   */
  async function pipeline(
    files: Record<string, string>,
    options: { budget?: number; bodyOnly?: boolean } = {},
  ): Promise<{ found: Probe; given: EngineSignatures; source: string }> {
    const zipped = Object.fromEntries(
      Object.entries(files).map(([path, text]) => [path, strToU8(text)]),
    );
    const taken = intake({ name: "invented.zip", bytes: zipSync(zipped) }, { tree });
    if (isRefusal(taken)) throw new Error(`refused at intake: ${taken.message}`);
    const made = await reference(session, fonts, taken as Intake);
    if (isRefusal(made)) throw new Error(`refused: ${made.message}`);
    const body = bodyOf(taken);
    if (isRefusal(body)) throw new Error(body.message);
    const read = readBody(body);
    if (isRefusal(read)) throw new Error(read.message);
    const preamble = readBody(bodyOfText(body.preamble));
    const uses =
      options.bodyOnly === true
        ? usesOf(read)
        : probeUses(read, isRefusal(preamble) ? undefined : preamble);
    const given = await signatures(session, taken, made, body, uses);
    if (isRefusal(given)) throw new Error("no signatures");
    const built = buildTree(read, given);
    if (isRefusal(built)) throw new Error(built.message);
    const budget = options.budget === undefined ? {} : { budget: options.budget };
    return {
      found: await probe(session, fonts, taken, made, built, given, budget),
      given,
      source: built.source,
    };
  }
  const probed = async (files: Record<string, string>, budget?: number) =>
    (await pipeline(files, budget === undefined ? {} : { budget })).found;

  const verdict = (found: Probe, name: string, index = 1) =>
    found.macros.find((each) => each.name === name && each.index === index);

  /** An invented class whose macros show each of the probe's verdicts. */
  const CLASS = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{inventedprobe}[2026/09/27 an invented class for the probe's tests]
\LoadClass{article}
\RequirePackage[hidelinks]{hyperref}
\pagestyle{myheadings}
\newcommand{\cvname}[1]{\def\@cvname{#1}}
\newcommand{\cvheader}{{\Large\@cvname}\par}
\newcommand{\cvplain}[1]{\textbf{#1}\par}
\newcommand{\cvmail}[1]{\href{mailto:#1}{#1}\par}
\newcommand{\cvlink}[1]{\href{#1}{Invented link}\par}
\newcommand{\cvtwice}[1]{#1, and again #1\par}
\newcommand{\cvshout}[1]{\MakeUppercase{#1}\par}
\newcommand{\cvlocale}[1]{\MakeUppercase[lang=de-x-eszett]{#1}\par}
\newcommand{\cvgap}[1]{\hspace{#1}Invented gap\par}
\newcommand{\cvhead}[1]{\markright{#1}#1\par}
\newcommand{\cvmaybe}[1]{\ifx&#1&\else(#1)\fi\par}
`;
  const BODY = String.raw`\begin{document}
\cvheader
\cvplain{Invented plain words}
\cvmail{quill@example.invalid}
\cvlink{https://example.invalid/quill}
\cvtwice{Invented twice}
\cvshout{Invented loud}
\cvgap{2em}
\cvhead{Invented head}
\cvmaybe{}
\cvmaybe{Invented maybe}
\cvplain{}
\end{document}
`;

  test("finds each verdict on an invented pdfTeX document, from its format", async () => {
    const found = await probed({
      "cv.tex": `\\documentclass{inventedprobe}\n\\cvname{Quill Invented}\n${BODY}`,
      "inventedprobe.cls": CLASS,
    });
    expect(found.engine).toBe("pdftex");
    expect(found.path).toBe("format");
    expect(found.format).toMatch(/^import-[0-9a-f]{8}$/);
    expect(found.baseline).toBeUndefined();
    expect(found.compiles).toBeLessThanOrEqual(found.budget);
    // The preamble's call that stores the name is issued again, marked.
    expect(verdict(found, "cvname")).toMatchObject({ verdict: "editable" });
    expect(verdict(found, "cvplain")).toMatchObject({ verdict: "editable", calls: 2 });
    expect(verdict(found, "cvmail")?.verdict).toBe("twice");
    expect(verdict(found, "cvlink")?.verdict).toBe("vanished");
    expect(verdict(found, "cvtwice")?.verdict).toBe("twice");
    // Set through `\MakeUppercase`, whose capitals the aligner folds (decision 0021).
    expect(verdict(found, "cvshout")?.verdict).toBe("editable");
    expect(verdict(found, "cvgap")?.verdict).toBe("breaks");
    expect(["twice", "moved"]).toContain(verdict(found, "cvhead")?.verdict);
    // An empty argument the macro tests moves the page; the others of it are editable.
    expect(verdict(found, "cvmaybe")).toMatchObject({ verdict: "editable", empty: "moved" });
    expect(found.candidates.find((each) => each.name === "cvplain" && each.empty)?.verdict).toBe(
      "editable",
    );
    expect(found.glyphs.covered).toBeGreaterThan(0);
    expect(found.glyphs.covered).toBeLessThan(found.glyphs.reference);
  }, 60_000);

  test("finds the same on an invented XeTeX document, compiled whole, and a case the aligner does not fold", async () => {
    // Source Sans Pro has the capital ẞ, which German's `de-x-eszett` capitals set for ß.
    const found = await probed({
      "cv.tex": `\\documentclass{inventedprobe}\n\\usepackage{fontspec}\n\\setmainfont{Source Sans Pro}\n\\cvname{Quill Invented}\n\\begin{document}\n\\cvheader\n\\cvplain{Invented plain words}\n\\cvmail{quill@example.invalid}\n\\cvshout{Invented loud}\n\\cvlocale{Invented große words}\n\\cvgap{2em}\n\\end{document}\n`,
      "inventedprobe.cls": CLASS,
    });
    expect(found.engine).toBe("xetex");
    expect(found.path).toBe("whole");
    expect(found.fallback).toBeUndefined();
    expect(verdict(found, "cvname")?.verdict).toBe("editable");
    expect(verdict(found, "cvplain")?.verdict).toBe("editable");
    expect(verdict(found, "cvmail")?.verdict).toBe("twice");
    expect(verdict(found, "cvshout")?.verdict).toBe("editable");
    // The aligner takes ß's capitals for SS, so ẞ matches only once glyphs and text are both
    // folded whole to small letters, where it is ß.
    expect(verdict(found, "cvlocale")?.verdict).toBe("case");
    expect(verdict(found, "cvgap")?.verdict).toBe("breaks");
  }, 60_000);

  test("compiles whole a pdfTeX document whose preamble does not dump, and probes nothing of one the prelude stops", async () => {
    // A preamble that ends inside a group cannot be dumped.
    const grouped = await probed({
      "cv.tex": `\\documentclass{inventedprobe}\n\\begingroup\n\\begin{document}\n\\cvplain{Invented plain words}\n\\end{document}\n`,
      "inventedprobe.cls": CLASS,
    });
    expect(grouped.path).toBe("whole");
    expect(grouped.fallback).toBe("dump");
    expect(verdict(grouped, "cvplain")?.verdict).toBe("editable");
    // A document that defines the marker macro's name for itself stops the prelude.
    const taken = await probed({
      "cv.tex": `\\documentclass{inventedprobe}\n\\newcommand{\\rtfield}{Invented}\n\\begin{document}\n\\cvplain{Invented plain words}\n\\end{document}\n`,
      "inventedprobe.cls": CLASS,
    });
    expect(taken.baseline).toBe("stopped");
    expect(taken.compiles).toBe(0);
    expect(taken.candidates.every((each) => each.verdict === "untested")).toBe(true);
  }, 60_000);

  test("leaves what its budget does not reach untested", async () => {
    const found = await probed(
      {
        "cv.tex": `\\documentclass{inventedprobe}\n\\begin{document}\n\\cvgap{1em}\n\\cvgap{2em}\n\\cvplain{Invented}\n\\cvtwice{Invented}\n\\end{document}\n`,
        "inventedprobe.cls": CLASS,
      },
      1,
    );
    expect(found.compiles).toBe(1);
    expect(found.candidates.every((each) => each.verdict === "untested")).toBe(true);
  }, 60_000);

  test("sets twice a title a table of contents repeats, from the pass that reads what the first wrote", async () => {
    const found = await probed({
      "cv.tex": String.raw`\documentclass{article}
\begin{document}
\tableofcontents
\section{Invented Heading}
Invented words for an invented page.
\end{document}
`,
    });
    expect(found.path).toBe("format");
    expect(found.candidates.find((each) => each.kind === "section")).toMatchObject({
      verdict: "twice",
      detail: "page",
    });
    expect(found.candidates.find((each) => each.kind === "paragraph")?.verdict).toBe("editable");
    // The compile that wrapped the title rewrote the contents, and took the pass that reads them;
    // the one of the paragraph alone changed nothing, and took one.
    expect(found.passes).toBe(found.compiles + 1);
  }, 60_000);

  test("keeps the italic correction a text command adds after a field, and adds none a declaration lacks", async () => {
    const found = await probed({
      "cv.tex": String.raw`\documentclass{article}
\newcommand{\cvwhen}[1]{\textit{#1} and after\par}
\newcommand{\cvdated}[1]{Invented {\slshape #1} and after\par}
\newcommand{\cvslant}[1]{\textit{#1}. And after\par}
\begin{document}
\cvwhen{Invented half}
\cvdated{Invented half}
\cvslant{Invented half}
\end{document}
`,
    });
    expect(verdict(found, "cvwhen")?.verdict).toBe("editable");
    // A declaration's slanted text gets no correction, from LaTeX or from the field.
    expect(verdict(found, "cvdated")?.verdict).toBe("editable");
    // LaTeX leaves the correction out before a period, and the field's own moves the period.
    expect(verdict(found, "cvslant")).toMatchObject({ verdict: "moved" });
  }, 60_000);

  test("sets what no editable field covers down to the raw chunk, the locked argument or the template that sets it", async () => {
    const found = await probed({
      "cv.tex": String.raw`\documentclass{article}
\newcommand{\cvplain}[1]{\textbf{#1}\par}
\newcommand{\cvslant}[1]{Invented label: \textit{#1}. Done\par}
\begin{document}
\cvplain{Invented alpha}
$x+y=z$ \par
\cvslant{Invented half}
\cvplain{Invented omega}
\end{document}
`,
    });
    const slant = found.candidates.find((each) => each.name === "cvslant");
    expect(slant?.verdict).toBe("moved");
    const glyphs = (by: UncoveredRun["by"], id?: string) =>
      found.uncovered
        .filter((run) => run.by === by && (id === undefined || run.candidate === id))
        .reduce((sum, run) => sum + run.to - run.from, 0);
    // The mathematics, a raw chunk: x, +, y, = and z.
    expect(glyphs("raw")).toBe(5);
    // The locked argument's twelve letters, which a compile placed though it moved the period.
    expect(glyphs("candidate", slant?.id)).toBe(12);
    // The label, the period and the word after, which only the macro sets, and the page's number.
    expect(glyphs("chrome")).toBe(14 + 1 + 4 + 1);
    expect(found.glyphs.covered).toBe(found.glyphs.reference - 5 - 12 - 20);
  }, 60_000);

  test("gives back the signatures of the header's macros a caller asked only of the body's", async () => {
    const { found, given } = await pipeline(
      {
        "cv.tex": `\\documentclass{inventedprobe}\n\\cvname{Quill Invented}\n${BODY}`,
        "inventedprobe.cls": CLASS,
      },
      { bodyOnly: true },
    );
    expect(given.commands.cvname).toBeUndefined();
    expect(found.signaturesMs).toBeGreaterThan(0);
    expect(found.signatures.commands.cvname?.kind).toBe("template");
    const macro = found.signatures.macros.cvname;
    expect(macro?.kind === "data" ? undefined : macro?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verdict(found, "cvname")?.verdict).toBe("editable");
    // What the caller gave stays.
    expect(found.signatures.commands.cvplain).toEqual(given.commands.cvplain);
  }, 60_000);

  /**
   * An invented document compiled whole, the prelude after its preamble as the probe has it, and
   * its glyphs and rules where the page sets them: each one's page, font, code and place, exact.
   */
  async function placed(text: string) {
    const withPrelude = text.replace("\\begin{document}", `${PROBE_PRELUDE}\\begin{document}`);
    const taken = intake(
      { name: "invented.zip", bytes: zipSync({ "cv.tex": strToU8(withPrelude) }) },
      { tree },
    );
    if (isRefusal(taken)) throw new Error(`refused at intake: ${taken.message}`);
    const made = await reference(session, fonts, taken as Intake);
    if (isRefusal(made)) throw new Error(`refused: ${made.message}`);
    return made.pages.map((page) =>
      page.items.flatMap((item) =>
        item.kind === "special"
          ? []
          : [[item.kind, item.h, item.v, item.kind === "glyph" ? `${item.font}:${item.code}` : ""]],
      ),
    );
  }

  test("ends a field's markers before a break that ends a ragged paragraph, and leaves the page as it was", async () => {
    // `\\` under `\raggedright` ends the paragraph: an end marker after it would be set on the
    // vertical list, between the item and the next, and move every line after it. The item's
    // text is in a group of its own, so that the item is probed alone, its span ending in `\\`.
    const ITEM = String.raw`\textbf{Invented}{: quill words}`;
    const document = (item: string) => String.raw`\documentclass{article}
\raggedright
\begin{document}
\begin{itemize}
\item{ ${item} }
\item Invented fern words
\end{itemize}
Invented words after the list.
\end{document}
`;
    const { found, source } = await pipeline({ "cv.tex": document(String.raw`${ITEM} \\`) });
    const quill = found.candidates.find(
      (each) => each.kind === "item" && each.text.includes("quill"),
    );
    expect(quill).toMatchObject({ verdict: "editable" });
    if (quill === undefined) return;
    expect(source.slice(quill.start, quill.end)).toBe(String.raw`${ITEM} \\`);
    // Where the probe puts the markers: before the break and the space before it.
    const now = String.raw`\rtfield{${quill.id}}{${ITEM}} \\`;
    expect(marked(source, [quill])).toBe(source.replace(String.raw`${ITEM} \\`, now));
    const page = await placed(document(String.raw`${ITEM} \\`));
    expect(page.flat().length).toBeGreaterThan(30);
    // There, the page is the reference's, glyph for glyph.
    expect(await placed(document(now))).toEqual(page);
    // Where they went before, after the break, every line after it moved.
    expect(await placed(document(String.raw`\rtfield{${quill.id}}{${ITEM} \\}`))).not.toEqual(page);
  }, 60_000);

  test("leaves its format in the session for the assembled package's check, for its caller to drop", async () => {
    const files = {
      "cv.tex": `\\documentclass{inventedprobe}\n\\begin{document}\n\\cvplain{Invented plain words}\n\\end{document}\n`,
      "inventedprobe.cls": CLASS,
    };
    const found = await probed(files);
    const name = found.format ?? "";
    expect(name).toMatch(/^import-[0-9a-f]{8}$/);
    const body = "\\begin{document}\\cvplain{Invented}\\end{document}";
    expect(session.compile("pdftex", name, body, { job: "kept" }).ok).toBe(true);
    session.dropFormat("pdftex", name);
    expect(() => session.compile("pdftex", name, body, { job: "kept" })).toThrow(
      `no pdftex format named ${name}`,
    );
    session.forget("kept");
  }, 60_000);
});
