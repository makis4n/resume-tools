/**
 * What the sync queue needs of an account (decision 0092): its documents, listed by id, revision
 * and time; one document whole; and writes that the server takes only over the revision they name.
 * Item 7 implements it over Supabase's `documents` table, whose trigger counts the revision and
 * stamps the time; `fake-server.ts` implements it in memory for tests. Times are milliseconds since
 * the epoch, as the store's are.
 */

/** What a document was made from (decision 0091): a built-in template, a `.tex` or a PDF import. */
export type DocumentKind = "template" | "tex" | "pdf";

/** A document as the account lists it, without its content. */
export interface ServerEntry {
  id: string;
  /** The account's count of the document's writes: 1 when inserted, one more for each update. */
  revision: number;
  updatedAt: number;
}

/** A document as the account keeps it. */
export interface ServerDocument extends ServerEntry {
  kind: DocumentKind;
  templateId: string;
  title: string;
  document: unknown;
  createdAt: number;
}

/** What the queue sends of a document: its whole row, under the id it already has. */
export interface Upload {
  id: string;
  kind: DocumentKind;
  templateId: string;
  title: string;
  document: unknown;
}

/**
 * What a write came to: written, at the account's new revision and time; or refused, because the
 * row moved on from the revision the write named, or an insert's id is taken (`conflict`), or the
 * row is gone (`missing`).
 */
export type WriteResult =
  | { ok: true; revision: number; updatedAt: number }
  | { ok: false; reason: "conflict" | "missing" };

export interface SyncServer {
  /** The signed-in account's documents, and only its own. */
  list(): Promise<ServerEntry[]>;
  /** One of the account's documents, or null when it has none with this id. */
  get(id: string): Promise<ServerDocument | null>;
  /** Insert a new document under its own id; a conflict when the id exists. */
  insert(doc: Upload): Promise<WriteResult>;
  /**
   * Write a document over the revision this device was last in step with: a conflict when the
   * account's revision has moved on, missing when the document is gone.
   */
  update(doc: Upload, expectedRevision: number): Promise<WriteResult>;
  /** Delete one of the account's documents; nothing happens when it has none with this id. */
  remove(id: string): Promise<void>;
}

/**
 * The account could not be reached, or did not answer as it should: offline, or a failure on its
 * side. The queue keeps what it was sending, waits and tries again; nothing is lost.
 */
export class ServerUnavailable extends Error {
  constructor(message = "the account could not be reached", options?: ErrorOptions) {
    super(message, options);
    this.name = "ServerUnavailable";
  }
}

/**
 * The account refused a document in a way that sending it again cannot change (decision 0098): a
 * check it breaks (`23514`), a string it cannot keep (`22P05`, `22P02`), a write its policies can
 * never let through (`42501`), or one over the size the browser keeps a document to, refused here
 * without a request. The queue does not try it again: the document stays in this browser, marked
 * as not saved to the account, until a later save changes it. `code` is the database's code, or
 * `too-large`; it is for the console, never for the person.
 */
export class ServerRefused extends Error {
  constructor(
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(`the account refused the document (${code})`, options);
    this.name = "ServerRefused";
  }
}

/** The most a document may be as compact JSON, in UTF-8 bytes (decision 0098). */
export const MAX_DOCUMENT_BYTES = 2_000_000;

/** The most characters of a title the account keeps; a longer one is cut to it (decision 0098). */
export const MAX_SENT_TITLE = 1000;

/**
 * What goes to the account of an upload (decision 0098): every string in it, the document's and its
 * keys included, without U+0000 and with each lone surrogate replaced by U+FFFD, which `jsonb` and
 * `text` cannot hold; the title cut to `MAX_SENT_TITLE` characters. Throws `ServerRefused` for a
 * document over `MAX_DOCUMENT_BYTES` as compact JSON, which is never sent.
 */
export function cleanUpload(upload: Upload): Upload {
  const document = cleanJson(upload.document);
  const bytes = new TextEncoder().encode(JSON.stringify(document) ?? "null").length;
  if (bytes > MAX_DOCUMENT_BYTES) throw new ServerRefused("too-large");
  return {
    id: upload.id,
    kind: upload.kind,
    templateId: cleanString(upload.templateId),
    // Cut by code points, as Postgres counts characters, so no surrogate pair is split.
    title: Array.from(cleanString(upload.title)).slice(0, MAX_SENT_TITLE).join(""),
    document,
  };
}

/** A string without U+0000, and with U+FFFD for each lone surrogate. */
export function cleanString(text: string): string {
  const kept = text.includes("\0") ? text.replaceAll("\0", "") : text;
  const wellFormed = (kept as { toWellFormed?: () => string }).toWellFormed;
  return typeof wellFormed === "function"
    ? wellFormed.call(kept)
    : kept.replace(LONE_SURROGATE, "\uFFFD");
}

/** A surrogate with no partner, for browsers without `toWellFormed`. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** A JSON value with every string in it, keys included, cleaned (`cleanString`). */
export function cleanJson(value: unknown): unknown {
  if (typeof value === "string") return cleanString(value);
  if (Array.isArray(value)) return value.map(cleanJson);
  if (typeof value !== "object" || value === null) return value;
  // No prototype, so that a key named `__proto__` is a key like any other.
  const cleaned: Record<string, unknown> = Object.create(null);
  for (const [key, each] of Object.entries(value)) cleaned[cleanString(key)] = cleanJson(each);
  return cleaned;
}
