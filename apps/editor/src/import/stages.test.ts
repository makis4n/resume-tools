import type { OutlinePart } from "@resume-tools/resume-model";
import { describe, expect, it } from "vitest";
import { inventedOutline, outlineParts } from "../test/invented-outline";
import type { CheckEnd } from "./checks";
import { type Outline, outlineResume } from "./outline";
import type { ImportStage } from "./run";
import { resumeKey, type StagedCompiler, stagedDocument, stagesOf } from "./stages";

/** An outline as a check's end gives it: its parts are all the stages read. */
const outlineOf = (parts: OutlinePart[]) => ({ parts }) as unknown as Outline;

/** The invented outline's parts with the field `id` kept as its text, as a check keeps one. */
const keptField = (id: string): OutlinePart[] => {
  const keep = (parts: readonly OutlinePart[]): OutlinePart[] =>
    parts.map((part): OutlinePart => {
      if (part.kind === "group")
        return { ...part, units: part.units.map((unit) => ({ ...unit, parts: keep(unit.parts) })) };
      if (part.kind === "text" && part.id === id) return { kind: "kept", latex: part.text };
      return part;
    });
  return keep(outlineParts());
};

const end = (
  check: 1 | 2 | 3,
  parts: OutlinePart[],
  holds = true,
  required: string[] = [],
): CheckEnd => ({
  check,
  outline: outlineOf(parts),
  kept: new Map(),
  required: new Set(required),
  holds,
});

/** The stages heard over some check ends, given the outputs the checks' compiler kept, by parts. */
async function heard(ends: CheckEnd[], compiled: OutlinePart[][]) {
  const { pkg } = await inventedOutline();
  const outputs = new Map(
    compiled.map((parts, i) => [resumeKey(outlineResume(parts)), new Uint8Array([0xf7, i])]),
  );
  const compiler = {
    outputOf: (key: string) => outputs.get(key),
    release: () => {},
  } as unknown as StagedCompiler;
  const stages: ImportStage[] = [];
  let n = 0;
  const hear = stagesOf((stage) => stages.push(stage), {
    pkg,
    job: { files: {}, images: [] },
    compiler,
    now: () => ({ ms: ++n * 100, compiles: n }),
  });
  for (const each of ends) hear(each);
  return stages.map(({ phase, output, ms, document }) => ({
    phase,
    output: output === undefined ? undefined : [...output],
    ms,
    document,
  }));
}

describe("an import's stages (decision 00XX)", () => {
  it("brings the page after check 1, and the fields after check 2 with no page where it is the same", async () => {
    const parts = outlineParts();
    const stages = await heard(
      [end(1, parts), end(2, parts, true, ["mill-dates"]), end(3, parts)],
      [parts],
    );
    expect(stages.map(({ phase, output, ms }) => ({ phase, output, ms }))).toEqual([
      { phase: "page", output: [0xf7, 0], ms: 100 },
      { phase: "fields", output: undefined, ms: 200 },
    ]);
    const { pkg } = await inventedOutline();
    expect(stages[1]?.document).toEqual(stagedDocument(pkg, parts, new Set(["mill-dates"])));
  });

  it("brings check 2's page where check 2 kept a field, and none where it has no output", async () => {
    const parts = outlineParts();
    const fewer = keptField("mill-dates");
    expect(
      (await heard([end(1, parts), end(2, fewer)], [parts, fewer])).map(({ phase, output }) => ({
        phase,
        output,
      })),
    ).toEqual([
      { phase: "page", output: [0xf7, 0] },
      { phase: "fields", output: [0xf7, 1] },
    ]);
    // The page shown is another outline's: its fields stay locked until the outcome.
    expect(
      (await heard([end(1, parts), end(2, fewer)], [parts])).map((each) => each.phase),
    ).toEqual(["page"]);
  });

  it("opens nothing after check 1 on a page that does not hold, or was not compiled", async () => {
    const parts = outlineParts();
    expect(await heard([end(1, parts, false)], [parts])).toEqual([]);
    expect(await heard([end(1, parts)], [])).toEqual([]);
    // Check 2 then brings the page with the fields.
    const late = await heard([end(1, parts, false), end(2, parts, false)], [parts]);
    expect(late.map(({ phase, output }) => ({ phase, output }))).toEqual([
      { phase: "fields", output: [0xf7, 0] },
    ]);
  });

  it("changes nothing the import does when what hears it throws", async () => {
    const { pkg } = await inventedOutline();
    const parts = outlineParts();
    const output = new Uint8Array([0xf7]);
    const hear = stagesOf(
      () => {
        throw new Error("a listener that fails");
      },
      {
        pkg,
        job: { files: {}, images: [] },
        compiler: { outputOf: () => output, release: () => {} } as unknown as StagedCompiler,
        now: () => ({ ms: 0, compiles: 0 }),
      },
    );
    expect(() => hear(end(1, parts))).not.toThrow();
  });

  it("lets the outputs go once check 2 has ended, whether it brought a page or not", async () => {
    const { pkg } = await inventedOutline();
    const parts = outlineParts();
    for (const ends of [
      [end(1, parts), end(2, parts)],
      [end(1, parts, false), end(2, keptField("mill-dates"))],
    ]) {
      const released: number[] = [];
      let n = 0;
      const hear = stagesOf(() => {}, {
        pkg,
        job: { files: {}, images: [] },
        compiler: {
          outputOf: () => (released.length > 0 ? undefined : new Uint8Array([0xf7])),
          release: () => released.push(++n),
        } as unknown as StagedCompiler,
        now: () => ({ ms: 0, compiles: 0 }),
      });
      for (const each of ends) {
        hear(each);
        expect(released.length).toBe(each.check === 2 ? 1 : 0);
      }
      hear(end(3, parts));
      expect(released).toEqual([1]);
    }
  });

  it("keys a resume by its JSON, so that two alike take one key and two unlike two", () => {
    const one = outlineResume(outlineParts());
    const again = outlineResume(outlineParts());
    const other = outlineResume(keptField("mill-dates"));
    expect(resumeKey(one)).toBe(resumeKey(again));
    expect(resumeKey(one)).not.toBe(resumeKey(other));
  });
});
