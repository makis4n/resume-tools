import type { AnalyzeFailure, AnalyzeResult } from "./client";
import type { Analysis, Finding, Severity } from "./contract";

/**
 * The panel's states for milestone 0. Later milestones add preparing, stale and the
 * job-description states from docs/ats-prd.md, section 7.3.
 */
export type PanelState =
  | { status: "idle" }
  | { status: "analysing"; request: number }
  | { status: "complete"; analysis: Analysis; finishedAt: Date }
  | { status: "error"; message: string };

export type PanelEvent =
  | { type: "start"; request: number }
  | { type: "settle"; request: number; result: AnalyzeResult; at: Date };

export const initialPanelState: PanelState = { status: "idle" };

export function panelReducer(state: PanelState, event: PanelEvent): PanelState {
  switch (event.type) {
    case "start":
      return { status: "analysing", request: event.request };
    case "settle": {
      // Only the newest request may settle the panel; an older one finishing late is ignored.
      if (state.status !== "analysing" || state.request !== event.request) return state;
      if (event.result.ok) {
        return { status: "complete", analysis: event.result.analysis, finishedAt: event.at };
      }
      if (event.result.failure.kind === "cancelled") return initialPanelState;
      return { status: "error", message: failureMessage(event.result.failure) };
    }
  }
}

/** Plain-language text for a failure. Never includes status codes or response bodies. */
export function failureMessage(failure: AnalyzeFailure): string {
  switch (failure.kind) {
    case "service":
      return failure.message;
    case "network":
      return "The analysis service could not be reached. Check your connection and try again.";
    case "not-configured":
      return "Resume analysis is not available right now.";
    case "cancelled":
      return "The analysis was cancelled.";
    case "unexpected":
      return "The analysis service sent a reply we could not read. Please try again.";
  }
}

const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info"];

/** Findings grouped by severity, most severe first, leaving out empty groups. */
export function groupFindings(findings: Finding[]): { severity: Severity; findings: Finding[] }[] {
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    findings: findings.filter((finding) => finding.severity === severity),
  })).filter((group) => group.findings.length > 0);
}
