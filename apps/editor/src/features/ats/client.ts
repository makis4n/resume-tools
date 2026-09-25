import { type Analysis, isAnalysis, isServiceError } from "./contract";

/**
 * Why an analysis did not arrive. `service` carries the service's own code and a message safe to
 * show; the other kinds carry nothing from the response, so no internal detail can reach the UI.
 */
export type AnalyzeFailure =
  | { kind: "not-configured" }
  | { kind: "cancelled" }
  | { kind: "network" }
  | { kind: "service"; status: number; code: string; message: string }
  | { kind: "unexpected"; status: number };

export type AnalyzeResult =
  | { ok: true; analysis: Analysis }
  | { ok: false; failure: AnalyzeFailure };

export interface AnalyzeOptions {
  /** Defaults to `VITE_ATS_SERVICE_URL`. */
  baseUrl?: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

/** Send a PDF to `POST /v1/analyze` and return the validated analysis or why there is none. */
export async function analyzeResume(
  pdf: Blob,
  options: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const baseUrl = options.baseUrl ?? import.meta.env.VITE_ATS_SERVICE_URL;
  if (!baseUrl) return fail({ kind: "not-configured" });

  const body = new FormData();
  body.append("file", new Blob([pdf], { type: "application/pdf" }), "resume.pdf");

  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(new URL("/v1/analyze", baseUrl), {
      method: "POST",
      body,
      signal: options.signal,
    });
  } catch {
    return fail({ kind: options.signal?.aborted ? "cancelled" : "network" });
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    if (options.signal?.aborted) return fail({ kind: "cancelled" });
    return fail({ kind: "unexpected", status: response.status });
  }

  if (response.ok) {
    if (isAnalysis(json)) return { ok: true, analysis: json };
    return fail({ kind: "unexpected", status: response.status });
  }
  if (isServiceError(json)) {
    const { code, message } = json.error;
    return fail({ kind: "service", status: response.status, code, message });
  }
  return fail({ kind: "unexpected", status: response.status });
}

function fail(failure: AnalyzeFailure): AnalyzeResult {
  return { ok: false, failure };
}
