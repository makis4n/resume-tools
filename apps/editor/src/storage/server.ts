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
