/**
 * Where an account keeps a `.tex` import's two files (milestone 4 item 8, decisions 0090 and 0093):
 * the private bucket `originals`, under the owner's folder, `<user id>/<document id>/original.zip`
 * and `<user id>/<document id>/import.bin`. `SupabaseOriginals` reaches it through Storage's API with
 * the person's session, as `SupabaseServer` reaches the table: every request is made as the user it
 * was made for, whose token is pinned onto it (`authorizationOf`), and the bucket's policies keep
 * each account to its own folder. No signed or public link is ever made (decision 0090). Only the
 * client's type is imported here, so a page that makes no bucket loads none of supabase-js.
 *
 * Errors are mapped as item 7 maps the table's: a request that never reached the account, a failure
 * on its side, a session it does not take, a timeout or too many requests is `ServerUnavailable`,
 * which the queue waits on and tries again; a refusal sending again cannot change, a write the
 * policies refuse (403) or a file over the bucket's limit (413), is `ServerRefused`, not retried;
 * anything else an error of its own, retried after a wait. None of Supabase's text goes further than
 * the console.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OriginalFiles } from "./originals-pack";
import { ServerRefused, ServerUnavailable } from "./server";
import { authorizationOf } from "./supabase-server";

/** The bucket the files are kept in. */
export const BUCKET = "originals";

/** The two files' names in a document's folder. */
export const ORIGINAL = "original.zip";
export const IMPORT_FILES = "import.bin";

/** What the originals need of the account's bucket, for the user it was made for. */
export interface OriginalsBucket {
  /** The account's user id, whose folder this is. */
  readonly user: string;
  /** Keep a document's two files, over any it had. */
  put(document: string, files: OriginalFiles): Promise<void>;
  /** A document's two files, or null when the account lacks either. */
  get(document: string): Promise<OriginalFiles | null>;
  /** Delete a document's two files; nothing happens for files the account lacks. */
  remove(document: string): Promise<void>;
}

/** A file's path in the bucket: under its owner's folder and its document's (decision 0090). */
export const pathOf = (user: string, document: string, name: string) =>
  `${user}/${document}/${name}`;

/** What a storage error says of itself, read as loosely as an error from outside must be. */
interface StorageFailure {
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
}

/**
 * What a storage error means, as a status: Storage answers most failures with HTTP 400 and the
 * status it means in its body (`statusCode`), "404" for a file that is not there, as for one the
 * policies hide, and "403" for a write they refuse; the HTTP status where the body gives none; 0
 * for an error with neither, as a fetch that never reached the account. `code` is Storage's own
 * name for it, as `NoSuchKey` or `InvalidJWT`.
 */
function statusOf(error: unknown): { status: number; code: string } {
  const failure = (typeof error === "object" && error !== null ? error : {}) as StorageFailure;
  const http = typeof failure.status === "number" ? failure.status : 0;
  const meant = typeof failure.statusCode === "string" ? Number(failure.statusCode) : Number.NaN;
  const status = Number.isInteger(meant) && meant > 0 ? meant : http;
  return { status, code: typeof failure.code === "string" ? failure.code : "" };
}

/** Whether a storage error says the file is not there. */
const isMissing = (error: unknown) => statusOf(error).status === 404;

/**
 * What an error answer means to the queue (see the module's comment). A session Storage does not
 * take, as one that ran out, passes, as the table's 401 does.
 */
function failureOf(error: unknown, what: string): Error {
  const { status, code } = statusOf(error);
  if (
    status === 0 ||
    status >= 500 ||
    status === 401 ||
    status === 408 ||
    status === 429 ||
    code === "InvalidJWT"
  )
    return new ServerUnavailable(`the account's files could not be reached (${status} ${code})`, {
      cause: error,
    });
  if (status === 403 || status === 413)
    return new ServerRefused(`storage-${status}`, { cause: error });
  return new Error(`the account did not ${what} (${status} ${code})`, { cause: error });
}

export class SupabaseOriginals implements OriginalsBucket {
  constructor(
    private readonly client: SupabaseClient,
    readonly user: string,
  ) {}

  /** The bucket, for one request made as `user`. */
  private async bucket() {
    const authorization = await authorizationOf(this.client, this.user);
    return this.client.storage.from(BUCKET).setHeader("Authorization", authorization);
  }

  async put(document: string, files: OriginalFiles): Promise<void> {
    const uploads: [string, Uint8Array, string][] = [
      [ORIGINAL, files.original, "application/zip"],
      [IMPORT_FILES, files.import, "application/octet-stream"],
    ];
    for (const [name, bytes, contentType] of uploads) {
      const { error } = await (await this.bucket()).upload(
        pathOf(this.user, document, name),
        bytes,
        { upsert: true, contentType },
      );
      if (error) throw failureOf(error, "keep the document's files");
    }
  }

  async get(document: string): Promise<OriginalFiles | null> {
    const original = await this.download(document, ORIGINAL);
    if (original === null) return null;
    const bin = await this.download(document, IMPORT_FILES);
    if (bin === null) return null;
    return { original, import: bin };
  }

  async remove(document: string): Promise<void> {
    const { error } = await (await this.bucket()).remove([
      pathOf(this.user, document, ORIGINAL),
      pathOf(this.user, document, IMPORT_FILES),
    ]);
    if (error) throw failureOf(error, "delete the document's files");
  }

  /** One file, or null when the account lacks it. */
  private async download(document: string, name: string): Promise<Uint8Array | null> {
    const { data, error } = await (await this.bucket()).download(pathOf(this.user, document, name));
    if (error) {
      if (isMissing(error)) return null;
      throw failureOf(error, "give the document's files");
    }
    try {
      return new Uint8Array(await data.arrayBuffer());
    } catch (cause) {
      throw new ServerUnavailable("the document's files could not be read", { cause });
    }
  }
}
