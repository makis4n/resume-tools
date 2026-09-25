import { useReducer, useRef } from "react";
import { analyzeResume } from "./client";
import { groupFindings, initialPanelState, panelReducer } from "./panel-state";

export interface AtsPanelProps {
  /** Produces the PDF to analyse. */
  getPdf: () => Promise<Blob>;
}

const SEVERITY_LABEL = { critical: "Critical", warning: "Warnings", info: "Notes" } as const;

/** The Resume analysis panel, milestone 0: send a PDF and show the reply. */
export function AtsPanel({ getPdf }: AtsPanelProps) {
  const [state, dispatch] = useReducer(panelReducer, initialPanelState);
  const current = useRef<{ request: number; controller: AbortController } | null>(null);

  async function run() {
    current.current?.controller.abort();
    const request = (current.current?.request ?? 0) + 1;
    const controller = new AbortController();
    current.current = { request, controller };
    dispatch({ type: "start", request });

    const result = await analyzeResume(await getPdf(), { signal: controller.signal });
    dispatch({ type: "settle", request, result, at: new Date() });
  }

  return (
    <section aria-labelledby="ats-panel-title">
      <h2 id="ats-panel-title">Resume analysis</h2>
      <p>Analysing sends the PDF of your resume to our analysis service. Nothing is kept.</p>
      <button type="button" onClick={run} disabled={state.status === "analysing"}>
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
