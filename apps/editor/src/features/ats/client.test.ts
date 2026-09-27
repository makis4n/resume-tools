import { describe, expect, it } from "vitest";
import { analyzeResume, endpoint } from "./client";
import { samplePdf } from "./sample-pdf";

const BASE_URL = "http://ats.test";

function replying(status: number, body: unknown): typeof fetch {
  return async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

describe("analyzeResume", () => {
  it("posts the PDF as the file field of a multipart form", async () => {
    let sent: { url: string; body: FormData } | undefined;
    const fetch: typeof globalThis.fetch = async (url, init) => {
      sent = { url: String(url), body: init?.body as FormData };
      return new Response(JSON.stringify({ contract: "ats/v1", score: null, findings: [] }));
    };
    await analyzeResume(samplePdf(), { baseUrl: BASE_URL, fetch });
    expect(sent?.url).toBe(`${BASE_URL}/v1/analyze`);
    const file = sent?.body.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).type).toBe("application/pdf");
  });

  it("returns a schema-valid analysis", async () => {
    const analysis = {
      contract: "ats/v1",
      score: 72,
      findings: [
        { id: "pdf-reading-order", severity: "warning", message: "Out of order.", page: 1 },
      ],
    };
    const result = await analyzeResume(samplePdf(), {
      baseUrl: BASE_URL,
      fetch: replying(200, analysis),
    });
    expect(result).toEqual({ ok: true, analysis });
  });

  it("accepts a reply with properties the schema does not list", async () => {
    const result = await analyzeResume(samplePdf(), {
      baseUrl: BASE_URL,
      fetch: replying(200, { contract: "ats/v1", score: null, findings: [], added_later: true }),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a successful reply that breaks the contract", async () => {
    const result = await analyzeResume(samplePdf(), {
      baseUrl: BASE_URL,
      fetch: replying(200, { contract: "ats/v1", score: 140, findings: [] }),
    });
    expect(result).toEqual({ ok: false, failure: { kind: "unexpected", status: 200 } });
  });

  it("rejects a reply that is not JSON", async () => {
    const result = await analyzeResume(samplePdf(), {
      baseUrl: BASE_URL,
      fetch: replying(502, "<html>Bad gateway</html>"),
    });
    expect(result).toEqual({ ok: false, failure: { kind: "unexpected", status: 502 } });
  });

  it("passes on the service's error code and message", async () => {
    const result = await analyzeResume(samplePdf(), {
      baseUrl: BASE_URL,
      fetch: replying(415, { error: { code: "not-a-pdf", message: "This file is not a PDF." } }),
    });
    expect(result).toEqual({
      ok: false,
      failure: {
        kind: "service",
        status: 415,
        code: "not-a-pdf",
        message: "This file is not a PDF.",
      },
    });
  });

  it("does not pass on an error body outside the contract", async () => {
    const result = await analyzeResume(samplePdf(), {
      baseUrl: BASE_URL,
      fetch: replying(500, { detail: "Traceback (most recent call last): ..." }),
    });
    expect(result).toEqual({ ok: false, failure: { kind: "unexpected", status: 500 } });
  });

  it("reports a network failure", async () => {
    const fetch: typeof globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    const result = await analyzeResume(samplePdf(), { baseUrl: BASE_URL, fetch });
    expect(result).toEqual({ ok: false, failure: { kind: "network" } });
  });

  it("reports cancellation", async () => {
    const controller = new AbortController();
    const fetch: typeof globalThis.fetch = async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    };
    const result = await analyzeResume(samplePdf(), {
      baseUrl: BASE_URL,
      fetch,
      signal: controller.signal,
    });
    expect(result).toEqual({ ok: false, failure: { kind: "cancelled" } });
  });

  it("reports a missing service address", async () => {
    const result = await analyzeResume(samplePdf(), { baseUrl: "" });
    expect(result).toEqual({ ok: false, failure: { kind: "not-configured" } });
  });

  it("reports a service address that is not an absolute URL", async () => {
    const result = await analyzeResume(samplePdf(), { baseUrl: "localhost:8000" });
    expect(result).toEqual({ ok: false, failure: { kind: "not-configured" } });
  });
});

describe("endpoint", () => {
  it("keeps the path of the service address", () => {
    expect(endpoint("https://example.com/ats", "v1/analyze")?.href).toBe(
      "https://example.com/ats/v1/analyze",
    );
    expect(endpoint("https://example.com/ats/", "v1/analyze")?.href).toBe(
      "https://example.com/ats/v1/analyze",
    );
    expect(endpoint("http://localhost:8000", "v1/analyze")?.href).toBe(
      "http://localhost:8000/v1/analyze",
    );
  });

  it("keeps the path and drops the query and fragment of the service address", () => {
    expect(endpoint("https://example.com/ats?k=1#top", "v1/analyze")?.href).toBe(
      "https://example.com/ats/v1/analyze",
    );
  });
});
