import { storedAnswersOf } from "@resume-tools/naming";
import { afterEach, describe, expect, test, vi } from "vitest";
import { inventedNaming, inventedRequest } from "../service/invented";
import { type FetchLike, NAMING_ROUTE, NamingServiceError, nameOnService } from "./service";

// The request and the answers are invented, and nothing here reaches a network: `fetch` is a fake
// that records what it is asked and answers what each test gives it.

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fake fetch that answers `response` and records each call. */
function fakeFetch(response: () => Response | Promise<Response>) {
  const calls: { input: string; init: RequestInit }[] = [];
  const fetchLike: FetchLike = async (input, init) => {
    calls.push({ input, init });
    return response();
  };
  return { calls, fetchLike };
}

/** A reply the service would give the invented request: every macro answered by the model. */
async function inventedReply() {
  const request = await inventedRequest();
  const macros = await storedAnswersOf(request, inventedNaming(), "model:invented-model");
  return {
    request,
    reply: {
      version: 1,
      macros,
      preamble: inventedNaming().preamble,
      hits: 0,
      asked: 3,
      missing: [],
    },
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

describe("the naming service's client", () => {
  test("posts the request as JSON to the route on the page's own origin, and gives back the reply", async () => {
    const { request, reply } = await inventedReply();
    const { calls, fetchLike } = fakeFetch(() => json(reply));
    expect(await nameOnService(request, fetchLike)).toEqual(reply);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(NAMING_ROUTE);
    expect(NAMING_ROUTE).toBe("/v1/name");
    expect(calls[0]?.init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(request);
  });

  test("calls the page's fetch when given none", async () => {
    const { request, reply } = await inventedReply();
    const { calls, fetchLike } = fakeFetch(() => json(reply));
    vi.stubGlobal("fetch", fetchLike);
    expect(await nameOnService(request)).toEqual(reply);
    expect(calls[0]?.input).toBe("/v1/name");
  });

  test("says what a refusal means from its status alone, never quoting the reply, and never in LaTeX", async () => {
    const request = await inventedRequest();
    const cases: [number, Record<string, string>, string][] = [
      [
        400,
        {},
        "The naming service could not read what the editor sent it. This is a fault in the editor, not in your resume.",
      ],
      [413, {}, "This template is too large for the naming service."],
      [422, {}, "The naming service could not work out what this template's parts are."],
      [429, { "Retry-After": "30" }, "Too many imports in a short time. Try again in 30 seconds."],
      [429, { "Retry-After": "1" }, "Too many imports in a short time. Try again in 1 second."],
      [429, { "Retry-After": "864" }, "Too many imports in a short time. Try again in 15 minutes."],
      [429, { "Retry-After": "28710" }, "Too many imports in a short time. Try again in 8 hours."],
      [429, {}, "Too many imports in a short time. Try again in a minute."],
      [500, {}, "The naming service failed. Try again later."],
      [502, {}, "The naming service could not reach its model. Try again later."],
      [404, {}, "The naming service answered with an error (HTTP 404)."],
    ];
    for (const [status, headers, message] of cases) {
      const { fetchLike } = fakeFetch(() =>
        json({ error: "\\cventry{Quill Invented} was refused" }, status, headers),
      );
      const error = await nameOnService(request, fetchLike).catch((thrown: unknown) => thrown);
      expect(error, `${status}`).toBeInstanceOf(NamingServiceError);
      expect(error).toMatchObject({ status, message });
      expect((error as Error).message).not.toMatch(/Quill|\\/);
    }
    const limited = fakeFetch(() => json({}, 429, { "Retry-After": "30" }));
    await expect(nameOnService(request, limited.fetchLike)).rejects.toMatchObject({
      retryAfter: 30,
    });
  });

  test("says so when no reply comes, or the reply is not one it reads, and lets a cancel through as it is", async () => {
    const { request, reply } = await inventedReply();
    const offline: FetchLike = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(nameOnService(request, offline)).rejects.toMatchObject({
      status: 0,
      message: "The naming service could not be reached. Check the connection and try again.",
    });
    for (const body of [{ ...reply, extra: "a field the reply has not" }, { error: "no" }]) {
      const { fetchLike } = fakeFetch(() => json(body));
      await expect(nameOnService(request, fetchLike)).rejects.toMatchObject({
        status: 200,
        message: "The naming service's answer could not be read.",
      });
    }
    const notJson = fakeFetch(() => new Response("<html>", { status: 200 }));
    await expect(nameOnService(request, notJson.fetchLike)).rejects.toMatchObject({ status: 200 });
    const controller = new AbortController();
    const aborting: FetchLike = async (_, init) => {
      controller.abort();
      throw init.signal?.reason;
    };
    const error = await nameOnService(request, aborting, controller.signal).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).not.toBeInstanceOf(NamingServiceError);
    expect(error).toMatchObject({ name: "AbortError" });
  });
});
