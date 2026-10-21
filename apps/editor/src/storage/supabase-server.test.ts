import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { ServerRefused, ServerUnavailable, type Upload } from "./server";
import { SupabaseServer } from "./supabase-server";

// The server over the `documents` table, on a stand-in for the client's query builder: what it
// asks the table, and what each answer, PostgREST's or a failed request's, comes to for the queue.
// The table itself is tested against the local stack in `sync.integration.test.ts`.

interface Answer {
  data?: unknown;
  error?: { code: string; message: string } | null;
  status: number;
}

/** A client whose every query answers the next of `answers`, noting what each asked. */
function clientAnswering(...answers: Answer[]) {
  const asked: unknown[][][] = [];
  const client = {
    from(table: string) {
      const calls: unknown[][] = [["from", table]];
      asked.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "maybeSingle", "single", "insert", "update", "delete"])
        builder[method] = (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      builder.then = (done: (answer: unknown) => unknown, failed: (error: unknown) => unknown) => {
        const answer = answers.shift();
        if (answer === undefined)
          return Promise.reject(new Error("no answer left")).then(done, failed);
        return Promise.resolve({ data: null, error: null, ...answer }).then(done, failed);
      };
      return builder;
    },
  };
  return { server: new SupabaseServer(client as unknown as SupabaseClient), asked };
}

const UPLOAD: Upload = {
  id: "00000000-0000-4000-8000-0000000000d1",
  kind: "pdf",
  templateId: "jake",
  title: "Mara Quist",
  document: { invented: true },
};

const THEIRS = "SUPABASE OWN WORDS";
const failure = (code: string, status: number): Answer => ({
  error: { code, message: THEIRS },
  status,
});

const T1 = "2026-10-21T12:00:00.123456+00:00";
const T2 = "2026-10-21T12:05:00+00:00";

describe("SupabaseServer", () => {
  it("lists the account's documents by id, revision and time, without an owner filter", async () => {
    const { server, asked } = clientAnswering({
      data: [{ id: UPLOAD.id, revision: 3, updated_at: T1 }],
      status: 200,
    });
    expect(await server.list()).toEqual([
      { id: UPLOAD.id, revision: 3, updatedAt: Date.parse("2026-10-21T12:00:00.123Z") },
    ]);
    expect(asked).toEqual([
      [
        ["from", "documents"],
        ["select", "id, revision, updated_at"],
      ],
    ]);
  });

  it("reads one document whole, in the queue's names, and none when there is no row", async () => {
    const row = {
      id: UPLOAD.id,
      kind: "pdf",
      template_id: "jake",
      title: "Mara Quist",
      document: { invented: true },
      revision: 2,
      created_at: T1,
      updated_at: T2,
    };
    const { server } = clientAnswering({ data: row, status: 200 }, { data: null, status: 200 });
    expect(await server.get(UPLOAD.id)).toEqual({
      id: UPLOAD.id,
      kind: "pdf",
      templateId: "jake",
      title: "Mara Quist",
      document: { invented: true },
      revision: 2,
      createdAt: Date.parse(T1),
      updatedAt: Date.parse(T2),
    });
    expect(await server.get(UPLOAD.id)).toBeNull();
  });

  it("refuses to trust a row that is not as the table keeps them", async () => {
    const bad = [
      { id: UPLOAD.id, kind: "zip", template_id: "jake", title: "", document: {}, revision: 1 },
      { id: UPLOAD.id, revision: "1", updated_at: T1 },
      { id: UPLOAD.id, revision: 1, updated_at: "yesterday" },
    ];
    const { server } = clientAnswering(
      { data: { ...bad[0], created_at: T1, updated_at: T1 }, status: 200 },
      { data: [bad[1]], status: 200 },
      { data: [bad[2]], status: 200 },
    );
    await expect(server.get(UPLOAD.id)).rejects.toThrow("cannot read");
    await expect(server.list()).rejects.toThrow("cannot read");
    await expect(server.list()).rejects.toThrow("cannot read");
  });

  it("inserts the row without owner, revision or times, and takes a taken id as a conflict", async () => {
    const { server, asked } = clientAnswering(
      { data: { revision: 1, updated_at: T1 }, status: 201 },
      failure("23505", 409),
    );
    expect(await server.insert(UPLOAD)).toEqual({
      ok: true,
      revision: 1,
      updatedAt: Date.parse(T1),
    });
    expect(asked[0]).toEqual([
      ["from", "documents"],
      [
        "insert",
        {
          id: UPLOAD.id,
          kind: "pdf",
          template_id: "jake",
          title: "Mara Quist",
          document: { invented: true },
        },
      ],
      ["select", "revision, updated_at"],
      ["single"],
    ]);
    expect(await server.insert(UPLOAD)).toEqual({ ok: false, reason: "conflict" });
  });

  it("updates over the named revision, and tells a moved row from a gone one", async () => {
    const { server, asked } = clientAnswering(
      { data: [{ revision: 4, updated_at: T2 }], status: 200 },
      { data: [], status: 200 },
      { data: { id: UPLOAD.id }, status: 200 },
      { data: [], status: 200 },
      { data: null, status: 200 },
    );
    expect(await server.update(UPLOAD, 3)).toEqual({
      ok: true,
      revision: 4,
      updatedAt: Date.parse(T2),
    });
    expect(asked[0]).toEqual([
      ["from", "documents"],
      ["update", { template_id: "jake", title: "Mara Quist", document: { invented: true } }],
      ["eq", "id", UPLOAD.id],
      ["eq", "revision", 3],
      ["select", "revision, updated_at"],
    ]);
    expect(await server.update(UPLOAD, 3)).toEqual({ ok: false, reason: "conflict" });
    expect(await server.update(UPLOAD, 3)).toEqual({ ok: false, reason: "missing" });
  });

  it("deletes by id", async () => {
    const { server, asked } = clientAnswering({ status: 204 });
    await server.remove(UPLOAD.id);
    expect(asked[0]).toEqual([["from", "documents"], ["delete"], ["eq", "id", UPLOAD.id]]);
  });

  it("takes a failed request, a failure on the account's side, an ended session and too many requests as passing", async () => {
    for (const answer of [
      failure("", 0),
      failure("", 503),
      failure("PGRST301", 401),
      // Without a session the caller is `anon`, which has no grant: 42501, answered with 401.
      failure("42501", 401),
      failure("", 429),
    ]) {
      const { server } = clientAnswering(answer);
      await expect(server.insert(UPLOAD)).rejects.toBeInstanceOf(ServerUnavailable);
    }
  });

  it("takes decision 0098's refusals as final, with the code and never Supabase's words", async () => {
    for (const [code, status] of [
      ["23514", 400],
      ["22P05", 400],
      ["22P02", 400],
      ["42501", 403],
      ["PGRST102", 400],
    ] as const) {
      const { server } = clientAnswering(failure(code, status));
      const refused = await server.update(UPLOAD, 1).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(ServerRefused);
      expect((refused as ServerRefused).code).toBe(code);
      expect((refused as Error).message).not.toContain(THEIRS);
    }
  });

  it("reports anything else as an error of its own, which the queue tries again after a wait", async () => {
    const { server } = clientAnswering(failure("PGRST204", 400));
    const failed = await server.remove(UPLOAD.id).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(Error);
    expect(failed).not.toBeInstanceOf(ServerUnavailable);
    expect(failed).not.toBeInstanceOf(ServerRefused);
    expect((failed as Error).message).not.toContain(THEIRS);
  });
});
