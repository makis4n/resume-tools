import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { BUCKET, IMPORT_FILES, ORIGINAL, pathOf, SupabaseOriginals } from "./originals-bucket";
import { ServerRefused, ServerUnavailable } from "./server";

// The bucket over a stand-in for supabase-js: the paths it writes, the session it pins, and how it
// reads Storage's errors (shaped as the local stack answers them). Every id is invented.

const ADA = "00000000-0000-4000-8000-00000000000a";
const DOC = "11111111-2222-4333-8444-555555555555";

interface Call {
  method: string;
  bucket: string;
  path: string | string[];
  authorization?: string;
  options?: unknown;
}

/** A Storage error as supabase-js gives one: HTTP 400, and the status it means in `statusCode`. */
const storageError = (statusCode: string, code: string) => ({
  name: "StorageApiError",
  message: "Supabase's own words, never shown",
  status: 400,
  statusCode,
  code,
});

function client({
  user = ADA,
  failWith,
  files = {},
}: {
  user?: string | null;
  failWith?: unknown;
  files?: Record<string, Uint8Array>;
} = {}) {
  const calls: Call[] = [];
  const answer = <T>(data: T) =>
    failWith === undefined ? { data, error: null } : { data: null, error: failWith };
  const stub = {
    auth: {
      getSession: async () => ({
        data: {
          session: user === null ? null : { user: { id: user }, access_token: `token-of-${user}` },
        },
        error: null,
      }),
    },
    storage: {
      from: (bucket: string) => {
        let authorization: string | undefined;
        const api = {
          setHeader(name: string, value: string) {
            if (name === "Authorization") authorization = value;
            return api;
          },
          async upload(path: string, _bytes: Uint8Array, options: unknown) {
            calls.push({
              method: "upload",
              bucket,
              path,
              options,
              ...(authorization ? { authorization } : {}),
            });
            return answer({ path });
          },
          async download(path: string) {
            calls.push({
              method: "download",
              bucket,
              path,
              ...(authorization ? { authorization } : {}),
            });
            const bytes = files[path];
            if (failWith === undefined && bytes === undefined)
              return { data: null, error: storageError("404", "NoSuchKey") };
            return answer(new Blob([(bytes ?? new Uint8Array()).slice()]));
          },
          async remove(paths: string[]) {
            calls.push({
              method: "remove",
              bucket,
              path: paths,
              ...(authorization ? { authorization } : {}),
            });
            return answer([]);
          },
        };
        return api;
      },
    },
  };
  return { client: stub as unknown as SupabaseClient, calls };
}

const FILES = { original: new Uint8Array([1, 2]), import: new Uint8Array([3, 4, 5]) };

describe("the originals bucket on Supabase (milestone 4 item 8)", () => {
  it("writes both files under the owner's folder, as the owner, over any there", async () => {
    const { client: stub, calls } = client();
    await new SupabaseOriginals(stub, ADA).put(DOC, FILES);
    expect(calls).toEqual([
      {
        method: "upload",
        bucket: BUCKET,
        path: `${ADA}/${DOC}/original.zip`,
        authorization: `Bearer token-of-${ADA}`,
        options: { upsert: true, contentType: "application/zip" },
      },
      {
        method: "upload",
        bucket: BUCKET,
        path: `${ADA}/${DOC}/import.bin`,
        authorization: `Bearer token-of-${ADA}`,
        options: { upsert: true, contentType: "application/octet-stream" },
      },
    ]);
  });

  it("reads both files back, and null when the account lacks one", async () => {
    const files = {
      [pathOf(ADA, DOC, ORIGINAL)]: FILES.original,
      [pathOf(ADA, DOC, IMPORT_FILES)]: FILES.import,
    };
    expect(await new SupabaseOriginals(client({ files }).client, ADA).get(DOC)).toEqual(FILES);
    const half = { [pathOf(ADA, DOC, ORIGINAL)]: FILES.original };
    expect(await new SupabaseOriginals(client({ files: half }).client, ADA).get(DOC)).toBeNull();
  });

  it("deletes both files", async () => {
    const { client: stub, calls } = client();
    await new SupabaseOriginals(stub, ADA).remove(DOC);
    expect(calls).toMatchObject([
      { method: "remove", path: [pathOf(ADA, DOC, ORIGINAL), pathOf(ADA, DOC, IMPORT_FILES)] },
    ]);
  });

  it("makes no request while the session is another account's, or there is none", async () => {
    for (const user of [null, "00000000-0000-4000-8000-00000000000b"]) {
      const { client: stub, calls } = client({ user });
      await expect(new SupabaseOriginals(stub, ADA).put(DOC, FILES)).rejects.toBeInstanceOf(
        ServerUnavailable,
      );
      expect(calls).toEqual([]);
    }
  });

  it("waits on what passes, refuses what cannot change, and shows none of Supabase's words", async () => {
    const passing = [
      { status: 0 },
      storageError("500", "InternalError"),
      storageError("429", "SlowDown"),
      storageError("403", "InvalidJWT"),
      { name: "StorageUnknownError", message: "Failed to fetch" },
    ];
    for (const failWith of passing)
      await expect(
        new SupabaseOriginals(client({ failWith }).client, ADA).put(DOC, FILES),
      ).rejects.toBeInstanceOf(ServerUnavailable);
    for (const failWith of [
      storageError("403", "AccessDenied"),
      storageError("413", "EntityTooLarge"),
    ]) {
      const refused = new SupabaseOriginals(client({ failWith }).client, ADA).put(DOC, FILES);
      await expect(refused).rejects.toBeInstanceOf(ServerRefused);
      await expect(refused).rejects.not.toThrow(/Supabase/);
    }
    const other = new SupabaseOriginals(
      client({ failWith: storageError("400", "InvalidKey") }).client,
      ADA,
    ).remove(DOC);
    await expect(other).rejects.toThrow(/did not delete/);
    await expect(other).rejects.not.toThrow(/Supabase/);
  });
});
