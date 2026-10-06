import { describe, expect, test } from "vitest";
import { earlyClock, earlyHeadline, earlyOf } from "./corpus-early";
import type { ImportRow } from "./corpus-import";

// When an imported document opens, and its fields (decision 00XX). Every row is invented: ids and
// counts, as the run keeps them.

/** An invented row of a document imported on `engine`, which took `ms`, its page and fields as given. */
function row(
  id: string,
  engine: "pdftex" | "xetex",
  ms: number,
  early: { page?: number; unlocked?: number } = {},
): ImportRow {
  return {
    id,
    family: "other",
    outcome: "partial",
    engine,
    times: Object.assign({ import: ms, wall: ms + 50 }, early),
  };
}

describe("an import's early times", () => {
  test("take the first stage as the page and the fields' as every field open, into an imported row", () => {
    const clock = earlyClock();
    clock.hear({ phase: "page", ms: 1234.4 });
    clock.hear({ phase: "fields", ms: 2345.6 });
    const into = clock.into({ outcome: "success", times: { import: 5000 } });
    expect(earlyOf(into as unknown as ImportRow)).toEqual({
      import: 5000,
      page: 1234,
      unlocked: 2346,
    });
    // A page that came with the fields is both; an import that said nothing opens with its outcome.
    const late = earlyClock();
    late.hear({ phase: "fields", ms: 4000 });
    expect(late.into({ outcome: "partial", times: { import: 6000 } }).times).toEqual({
      import: 6000,
      page: 4000,
      unlocked: 4000,
    });
    expect(earlyClock().into({ outcome: "success", times: { import: 7000 } }).times).toEqual({
      import: 7000,
      page: 7000,
      unlocked: 7000,
    });
    // A refusal opens nothing.
    const refused = { outcome: "refused", times: { import: 900 } };
    expect(earlyClock().into(refused)).toBe(refused);
  });

  test("say per engine how many opened within its wait, their median and the slowest", () => {
    const rows = [
      row("other-0001", "pdftex", 30_000, { page: 4_000, unlocked: 9_000 }),
      row("other-0002", "pdftex", 6_000, { page: 2_000, unlocked: 5_000 }),
      row("other-0003", "pdftex", 3_000),
      row("other-0004", "xetex", 25_000, { page: 12_000, unlocked: 21_000 }),
      { id: "other-0005", family: "other", outcome: "refused", times: { wall: 10 } } as ImportRow,
    ];
    expect(earlyHeadline(rows)).toEqual([
      "pdfTeX: the page opened in 3 of 3 under 8 s, median 3.0 s, slowest 4.0 s; every field open in 2 of 3 under 8 s, median 5.0 s, slowest 9.0 s; the whole import in 2 of 3 under 8 s, median 6.0 s, slowest 30.0 s.",
      "XeTeX: the page opened in 1 of 1 under 20 s, median 12.0 s, slowest 12.0 s; every field open in 0 of 1 under 20 s, median 21.0 s, slowest 21.0 s; the whole import in 0 of 1 under 20 s, median 25.0 s, slowest 25.0 s.",
    ]);
  });
});
