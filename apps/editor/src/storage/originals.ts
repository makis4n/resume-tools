/**
 * An imported `.tex` document's two files in the account (milestone 4 item 8, decisions 0090 and
 * 0091): the sync queue's `OriginalsHooks`, and the way a document brought in from the account
 * gets its package and import when it is opened.
 *
 * - **Sent**: once the account holds the document's row, the store's package and import record of
 *   it are packed (`packOriginals`) and both files uploaded under the owner's folder; the queue then
 *   marks them sent. A failure leaves them owed, and the queue tries again.
 * - **Removed**: both files are deleted before the row is.
 * - **Brought in**: nothing is downloaded when the list refreshes (decision 0091). The document is
 *   known to need its files by what the store lacks: an account's `.tex` document whose import
 *   the store does not keep.
 * - **Opened** (`templateOf`, which `resolveTemplate` calls as it would the store's): a document
 *   that needs its files downloads both, unpacks them, and the store keeps the package and the
 *   record (`DocumentStore.keepImport`), after which it opens as any import. Offline, or signed out
 *   since, it cannot open yet, and `FilesUnavailable` says so in the editor's words.
 *
 * Each call checks that the document is the connected account's, so that one account's files never
 * go under another's folder, whatever signed in since the queue began sending. The packing module,
 * and fflate with it, loads only when files are first packed or unpacked.
 */

import type { OriginalsBucket } from "./originals-bucket";
import { ServerRefused, ServerUnavailable } from "./server";
import type { DocumentStore, StoredTemplate } from "./store";
import type { OriginalsHooks } from "./sync";

/** What a person reads when a document's files cannot be downloaded now. */
export const OPEN_WHEN_ONLINE = "This document cannot be opened until you are online.";

/** What a person reads when the account does not hold a document's files yet. */
export const FILES_NOT_THERE =
  "This document's files have not reached your account yet. Try again in a moment.";

/**
 * A document brought in from the account cannot be opened now: its files could not be downloaded,
 * as offline, or the account does not hold them yet. The message is what the person reads.
 */
export class FilesUnavailable extends Error {
  constructor(message: string = OPEN_WHEN_ONLINE, options?: ErrorOptions) {
    super(message, options);
    this.name = "FilesUnavailable";
  }
}

export class Originals implements OriginalsHooks {
  private bucket: OriginalsBucket | undefined;
  /** The downloads under way, by document, so that two openings of one document share one. */
  private readonly fetching = new Map<string, Promise<void>>();

  constructor(private readonly store: DocumentStore) {}

  /** Reach the signed-in account's bucket from now on, or none once no one is signed in. */
  connect(bucket: OriginalsBucket | undefined): void {
    this.bucket = bucket;
  }

  /** The bucket of the account `owner` names, or `ServerUnavailable` while another's is connected. */
  private bucketOf(owner: string | undefined): OriginalsBucket {
    const bucket = this.bucket;
    if (bucket === undefined || owner === undefined || bucket.user !== owner)
      throw new ServerUnavailable("the document's account is not the one connected");
    return bucket;
  }

  async sent(id: string): Promise<void> {
    const row = await this.store.syncRow(id);
    // Deleted meanwhile: its deletion deletes whatever was sent.
    if (row === undefined || row.removed) return;
    const bucket = this.bucketOf(row.owner);
    const stored = await this.store.templateOf(row.template, id);
    // The browser lacks what it would send, and waiting does not change that.
    if (stored?.import === undefined) throw new ServerRefused("no-import");
    const { packOriginals } = await import("./originals-pack");
    await bucket.put(id, packOriginals(stored.package, stored.import));
  }

  async removing(id: string): Promise<void> {
    const row = await this.store.syncRow(id);
    await this.bucketOf(row?.owner).remove(id);
  }

  async broughtIn(): Promise<void> {
    // Nothing is downloaded until the document is opened (decision 0091).
  }

  /**
   * An imported template as a document opens with it, as `DocumentStore.templateOf` gives it; for
   * an account's `.tex` document whose import the store lacks, once its files are downloaded and
   * kept. Throws `FilesUnavailable` when they cannot be downloaded now, and whatever the store or
   * the unpacking throws for files this editor cannot read.
   */
  async templateOf(id: string, document?: string): Promise<StoredTemplate | undefined> {
    const stored = await this.store.templateOf(id, document);
    if (stored?.import !== undefined || document === undefined) return stored;
    const row = await this.store.syncRow(document);
    if (row?.kind !== "tex" || row.owner === undefined || row.serverRevision === undefined)
      return stored;
    let fetching = this.fetching.get(document);
    if (fetching === undefined) {
      fetching = this.fetch(document, row.owner).finally(() => this.fetching.delete(document));
      this.fetching.set(document, fetching);
    }
    await fetching;
    return this.store.templateOf(id, document);
  }

  /** Download a document's files, unpack them, and keep what they hold in the store. */
  private async fetch(document: string, owner: string): Promise<void> {
    let bucket: OriginalsBucket;
    try {
      bucket = this.bucketOf(owner);
    } catch (error) {
      throw new FilesUnavailable(OPEN_WHEN_ONLINE, { cause: error });
    }
    let files: Awaited<ReturnType<OriginalsBucket["get"]>>;
    try {
      files = await bucket.get(document);
    } catch (error) {
      if (error instanceof ServerUnavailable)
        throw new FilesUnavailable(OPEN_WHEN_ONLINE, { cause: error });
      throw error;
    }
    if (files === null) throw new FilesUnavailable(FILES_NOT_THERE);
    const { unpackOriginals } = await import("./originals-pack");
    const unpacked = unpackOriginals(files);
    await this.store.keepImport(document, unpacked.package, unpacked.record);
  }
}
