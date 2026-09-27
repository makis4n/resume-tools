import type { AnalyzeFailure, AnalyzeResult } from "./client";
import type { Analysis, Finding, Severity } from "./contract";

/**
 * The panel's states for milestone 0. Later milestones add preparing, stale and the
 * job-description states from docs/ats-prd.md, section 7.3.
 */
export type PanelState =
  | { status: "idle" }
  | { status: "analysing" }
  | { status: "complete"; analysis: Analysis; finishedAt: Date }
  | { status: "error"; message: string };

export type PanelEvent =
  | { type: "start" }
  | { type: "settle"; result: AnalyzeResult; at: Date }
  /** Something before the request failed, such as producing the PDF. */
  | { type: "fail"; message: string };

export const initialPanelState: PanelState = { status: "idle" };

export const PREPARE_FAILED = "Your resume could not be prepared for analysis. Please try again.";

export function panelReducer(state: PanelState, event: PanelEvent): PanelState {
  switch (event.type) {
    case "start":
      return { status: "analysing" };
    case "settle":
    case "fail":
      // A result that arrives when nothing is waiting, such as after a reset, is ignored.
      if (state.status !== "analysing") return state;
      if (event.type === "fail") return { status: "error", message: event.message };
      if (event.result.ok) {
        return { status: "complete", analysis: event.result.analysis, finishedAt: event.at };
      }
      if (event.result.failure.kind === "cancelled") return initialPanelState;
      return { status: "error", message: failureMessage(event.result.failure) };
  }
}

/** Plain-language text for a failure. Never includes status codes or response bodies. */
export function failureMessage(failure: Exclude<AnalyzeFailure, { kind: "cancelled" }>): string {
  switch (failure.kind) {
    case "service":
      return failure.message;
    case "network":
      return "The analysis service could not be reached. Check your connection and try again.";
    case "not-configured":
      return "Resume analysis is not available right now.";
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
