import { describe, expect, it } from "vitest";
import type { AnalyzeResult } from "./client";
import type { Analysis } from "./contract";
import { groupFindings, type PanelState, panelReducer } from "./panel-state";

const AT = new Date("2026-09-25T10:00:00Z");
const ANALYSIS: Analysis = { contract: "ats/v1", score: null, findings: [] };
const ANALYSING: PanelState = { status: "analysing" };

function settle(state: PanelState, result: AnalyzeResult): PanelState {
  return panelReducer(state, { type: "settle", result, at: AT });
}

describe("panelReducer", () => {
  it("shows the analysis when it arrives", () => {
    const waiting = panelReducer({ status: "idle" }, { type: "start" });
    expect(settle(waiting, { ok: true, analysis: ANALYSIS })).toEqual({
      status: "complete",
      analysis: ANALYSIS,
      finishedAt: AT,
    });
  });

  it("ignores a result when nothing is waiting for one", () => {
    const idle: PanelState = { status: "idle" };
    expect(settle(idle, { ok: true, analysis: ANALYSIS })).toBe(idle);
    expect(panelReducer(idle, { type: "fail", message: "Late." })).toBe(idle);
  });

  it("shows a plain-language message when the request fails", () => {
    const state = settle(ANALYSING, { ok: false, failure: { kind: "unexpected", status: 500 } });
    expect(state).toEqual({
      status: "error",
      message: "The analysis service sent a reply we could not read. Please try again.",
    });
  });

  it("shows the given message when something before the request fails", () => {
    expect(panelReducer(ANALYSING, { type: "fail", message: "Could not prepare." })).toEqual({
      status: "error",
      message: "Could not prepare.",
    });
  });

  it("returns to idle when the request was cancelled", () => {
    expect(settle(ANALYSING, { ok: false, failure: { kind: "cancelled" } })).toEqual({
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
