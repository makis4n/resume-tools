import { type Analysis, isAnalysis, isServiceError, prepareValidators } from "./contract";

/**
 * The largest PDF sent, matching the service's default ATS_MAX_UPLOAD_BYTES. Checked here as well
 * because a browser usually sees the service's early 413 as a reset connection, not a reply.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Why an analysis did not arrive. `service` carries the service's own code and a message safe to
 * show; the other kinds carry nothing from the response, so no internal detail can reach the UI.
 */
export type AnalyzeFailure =
  | { kind: "not-configured" }
  | { kind: "cancelled" }
  | { kind: "network" }
  | { kind: "too-large"; maxBytes: number }
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
  /** Defaults to MAX_UPLOAD_BYTES. */
  maxUploadBytes?: number;
}

/** Send a PDF to `POST /v1/analyze` and return the validated analysis or why there is none. */
export async function analyzeResume(
  pdf: Blob,
  options: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const url = endpoint(options.baseUrl ?? import.meta.env.VITE_ATS_SERVICE_URL, "v1/analyze");
  if (!url) return fail({ kind: "not-configured" });

  const maxBytes = options.maxUploadBytes ?? MAX_UPLOAD_BYTES;
  if (pdf.size > maxBytes) return fail({ kind: "too-large", maxBytes });

  // Compile the reply's validators before the resume leaves the browser: if the page's security
  // policy forbids the code Ajv generates, nothing is uploaded only to be unreadable.
  try {
    prepareValidators();
  } catch {
    return fail({ kind: "not-configured" });
  }

  const body = new FormData();
  body.append("file", new Blob([pdf], { type: "application/pdf" }), "resume.pdf");

  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
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

/**
 * The endpoint's URL under the service's base URL, keeping any path the base has, so that
 * `https://example.com/ats` gives `https://example.com/ats/v1/analyze`. The base's query and
 * fragment belong to no endpoint and are dropped. Null when the base URL is missing or is not an
 * http or https URL; `localhost:8000` parses, but as the scheme `localhost:`.
 */
export function endpoint(baseUrl: string | undefined, path: string): URL | null {
  if (!baseUrl) return null;
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") return null;
  base.search = "";
  base.hash = "";
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL(path, base);
}

function fail(failure: AnalyzeFailure): AnalyzeResult {
  return { ok: false, failure };
}
