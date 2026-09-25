import { describe, expect, it } from "vitest";
import type { AnalyzeResult } from "./client";
import { groupFindings, type PanelState, panelReducer } from "./panel-state";

const AT = new Date("2026-09-25T10:00:00Z");
const EMPTY: AnalyzeResult = {
  ok: true,
  analysis: { contract: "ats/v1", score: null, findings: [] },
};

function settle(state: PanelState, request: number, result: AnalyzeResult): PanelState {
  return panelReducer(state, { type: "settle", request, result, at: AT });
}

describe("panelReducer", () => {
  it("shows the analysis of the request it is waiting for", () => {
    const waiting = panelReducer({ status: "idle" }, { type: "start", request: 1 });
    expect(settle(waiting, 1, EMPTY)).toEqual({
      status: "complete",
      analysis: EMPTY.ok && EMPTY.analysis,
      finishedAt: AT,
    });
  });

  it("ignores an older request that finishes after a newer one started", () => {
    const first = panelReducer({ status: "idle" }, { type: "start", request: 1 });
    const second = panelReducer(first, { type: "start", request: 2 });
    expect(settle(second, 1, EMPTY)).toBe(second);
  });

  it("shows a plain-language message on failure", () => {
    const waiting = panelReducer({ status: "idle" }, { type: "start", request: 1 });
    const state = settle(waiting, 1, { ok: false, failure: { kind: "unexpected", status: 500 } });
    expect(state).toEqual({
      status: "error",
      message: "The analysis service sent a reply we could not read. Please try again.",
    });
  });

  it("returns to idle when the request was cancelled", () => {
    const waiting = panelReducer({ status: "idle" }, { type: "start", request: 1 });
    expect(settle(waiting, 1, { ok: false, failure: { kind: "cancelled" } })).toEqual({
      status: "idle",
    });
  });
});

describe("groupFindings", () => {
  it("groups by severity, most severe first, without empty groups", () => {
    const groups = groupFindings([
      { id: "a", severity: "info", message: "A" },
      { id: "b", severity: "critical", message: "B" },
      { id: "c", severity: "info", message: "C" },
    ]);
    expect(groups.map((group) => [group.severity, group.findings.map((f) => f.id)])).toEqual([
      ["critical", ["b"]],
      ["info", ["a", "c"]],
    ]);
  });
});
