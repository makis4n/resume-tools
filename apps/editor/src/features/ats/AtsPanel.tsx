import { useEffect, useReducer, useState } from "react";
import { analyzeResume } from "./client";
import { latestOnly } from "./latest-only";
import {
  failureMessage,
  groupFindings,
  initialPanelState,
  PREPARE_FAILED,
  panelReducer,
} from "./panel-state";

export interface AtsPanelProps {
  /** Produces the PDF to analyse. */
  getPdf: () => Promise<Blob>;
}

const SEVERITY_LABEL = { critical: "Critical", warning: "Warnings", info: "Notes" } as const;

/**
 * The Resume analysis panel, milestone 0: send a PDF and show the reply. A request still running
 * is cancelled when a newer one starts or the panel goes away.
 */
export function AtsPanel({ getPdf }: AtsPanelProps) {
  const [state, dispatch] = useReducer(panelReducer, initialPanelState);
  const [runs] = useState(latestOnly);

  useEffect(() => () => runs.cancel(), [runs]);

  async function analyse() {
    const run = runs.start();
    dispatch({ type: "start" });

    let pdf: Blob;
    try {
      pdf = await getPdf();
    } catch {
      if (run.isCurrent()) dispatch({ type: "fail", message: PREPARE_FAILED });
      return;
    }
    if (!run.isCurrent()) return;

    try {
      const result = await analyzeResume(pdf, { signal: run.signal });
      if (run.isCurrent()) dispatch({ type: "settle", result, at: new Date() });
    } catch {
      const message = failureMessage({ kind: "unexpected", status: 0 });
      if (run.isCurrent()) dispatch({ type: "fail", message });
    }
  }

  return (
    <section aria-labelledby="ats-panel-title">
      <h2 id="ats-panel-title">Resume analysis</h2>
      <p>Analysing sends the PDF of your resume to our analysis service. Nothing is kept.</p>
      <button type="button" onClick={analyse} disabled={state.status === "analysing"}>
        {state.status === "analysing" ? "Analysing…" : "Analyse resume"}
      </button>

      {state.status === "error" && <p role="alert">{state.message}</p>}

      {state.status === "complete" && (
        <div aria-live="polite">
          <p>
            ATS readiness:{" "}
            {state.analysis.score === null ? "no score yet" : `${state.analysis.score} / 100`}
          </p>
          <p>Analysed at {state.finishedAt.toLocaleTimeString()}.</p>
          {state.analysis.findings.length === 0 ? (
            <p>No findings.</p>
          ) : (
            groupFindings(state.analysis.findings).map((group) => (
              <div key={group.severity}>
                <h3>{SEVERITY_LABEL[group.severity]}</h3>
                <ul>
                  {group.findings.map((finding, index) => (
                    <li key={`${finding.id}-${index}`}>
                      {finding.message}
                      {finding.page !== undefined && ` (page ${finding.page})`}
                      {finding.suggestion && <p>{finding.suggestion}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
