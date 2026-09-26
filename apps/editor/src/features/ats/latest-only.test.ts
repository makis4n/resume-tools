import { describe, expect, it } from "vitest";
import { latestOnly } from "./latest-only";

describe("latestOnly", () => {
  it("keeps a run current until another starts", () => {
    const runs = latestOnly();
    const first = runs.start();
    expect(first.isCurrent()).toBe(true);
    expect(first.signal.aborted).toBe(false);
  });

  it("cancels the older run when a newer one starts", () => {
    const runs = latestOnly();
    const first = runs.start();
    const second = runs.start();
    expect(first.isCurrent()).toBe(false);
    expect(first.signal.aborted).toBe(true);
    expect(second.isCurrent()).toBe(true);
  });

  it("ends the current run when cancelled", () => {
    const runs = latestOnly();
    const run = runs.start();
    runs.cancel();
    expect(run.isCurrent()).toBe(false);
    expect(run.signal.aborted).toBe(true);
  });
});
