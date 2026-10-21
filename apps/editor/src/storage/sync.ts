/**
 * The sync queue (decision 0092): it sends each signed-in document's latest save from the browser's
 * store to the account, and brings the account's newer documents into the store. It sits beside the
 * store, never in its write path: every save goes to IndexedDB first, as before, and the editor
 * never waits on the network. The account is reached through `SyncServer` (`server.ts`), which
 * item 7 implements over Supabase and `fake-server.ts` in memory.
 *
 * - **Sending.** A document's whole row goes, at most once every `SEND_INTERVAL` per document, at
 *   once when the page is hidden, and after a failure with a growing wait up to `MAX_WAIT`. A new
 *   document is inserted under its own id; an update names the account's revision the row was last
 *   in step with (`serverRevision`), and the account writes it only over that revision.
 * - **One tab sends**, the one holding the Web Lock `SYNC_LOCK`. A hidden tab, once it has sent,
 *   lets the lock go to a visible one, whose timers the browser does not slow. Without Web Locks
 *   the one tab there is sends.
 * - **A conflict never loses work.** The account's version keeps the id and is written into the
 *   store; this device's version is kept as a new document whose title ends in " (from this
 *   device)", pending like any other (`DocumentStore.bringIn`), and a `copied` event says so.
 * - **Bringing in**, on sign-in, when the page becomes visible, when the connection comes back and
 *   every `REFRESH_INTERVAL` while visible: the account's list, then each row newer than this
 *   browser's, written through the store so that every tab hears of it. A document open in a tab
 *   that the account changed is `changed` there. One the account no longer lists, which this
 *   browser was in step with, is removed, or kept as a copy if it has pending saves.
 * - **The first sign-in's question**: while documents are only in this browser and the person has
 *   not said "Not now" on it, `asking` counts them and a `question` event asks. Nothing of theirs is
 *   uploaded until `answer("add")` or `addToAccount`.
 * - **Signing out** sends what is pending, and names what could not be sent before removing
 *   anything; then removes the account's documents and their imports from this browser.
 * - **What is sent is cleaned, and a refusal is not tried again** (decision 0098). Every string
 *   loses U+0000 and its lone surrogates and the title is cut to fit (`cleanUpload`); a document
 *   too large is refused without a request. A refusal sending again cannot change
 *   (`ServerRefused`) marks the document's revision in the store (`refused`): it stays in this
 *   browser, a `refused` event says so, and it is sent again only once a save changes it.
 *
 * - **An imported `.tex` document's two files** (`original.zip`, `import.bin`, decision 0090) go
 *   through `OriginalsHooks`, which item 8's `Originals` implements: uploaded once the account has
 *   taken the row, and the store marked once they are there (`filesSent`); until then the document
 *   waits, is sent again by the next round, and is not in the account. Deleted before the row is;
 *   files owed by a document another device deleted meanwhile are deleted, not left behind.
 */

import { cleanUpload, ServerRefused, ServerUnavailable, type SyncServer } from "./server";
import type { BroughtIn, DocumentStore, Gone, PageEvents, SyncRow, Where } from "./store";

/** The Web Lock the tabs take the queue in turn with. */
export const SYNC_LOCK = "resume-tools-sync";

/** A document is sent at most this often. */
export const SEND_INTERVAL = 2_000;

/** The longest wait after failures, which grows from `SEND_INTERVAL` to it, doubling. */
export const MAX_WAIT = 60_000;

/** How often the account's documents are brought in while the page is visible. */
export const REFRESH_INTERVAL = 5 * 60_000;

/** How long to wait after `failures` failures in a row. */
export const waitAfter = (failures: number) =>
  Math.min(MAX_WAIT, SEND_INTERVAL * 2 ** Math.max(0, failures - 1));

/** What the queue needs of the Web Locks API: `navigator.locks`, or a test's stand-in. */
export interface Locks {
  /** Run `callback` once the lock is granted, and hold it until what it returns settles. */
  request(name: string, callback: () => Promise<unknown>): Promise<unknown>;
}

/**
 * Where item 8 keeps an imported `.tex` document's original files in step with its row. Each is
 * called only for a `tex` document; one that throws counts as a failed round, which waits and is
 * tried again, and one that throws `ServerRefused` marks the document refused, as a row's refusal
 * does.
 */
export interface OriginalsHooks {
  /**
   * The account holds the document's row, and not yet its files: upload them. `inserted` says the
   * row was inserted in this send. Once it settles the store marks the files sent; without this
   * hook they are taken as sent.
   */
  sent?(id: string, inserted: boolean): Promise<void>;
  /** The document is about to be deleted from the account. */
  removing?(id: string): Promise<void>;
  /** The document's row was brought into this browser from the account. */
  broughtIn?(id: string): Promise<void>;
}

/** What the queue tells the editor (item 9 shows it). */
export type SyncEvent =
  /** Documents are only in this browser: ask once whether to add them to the account. */
  | { type: "question"; count: number }
  /**
   * This device's version of `id` was kept as the new document `copy`, titled `title`: the account's
   * version took `id` (`conflict`), or the account no longer has it (`deleted`).
   */
  | { type: "copied"; id: string; copy: string; title: string; why: "conflict" | "deleted" }
  /** A document this tab holds was changed on another device: "This document was changed on another device." */
  | { type: "changed"; id: string }
  /** A document went from the account and this browser; `dropped` is a package that went with it. */
  | { type: "removed"; id: string; dropped?: string }
  /**
   * The account refused the document as it now is, and sending it again cannot change that
   * (decision 0098): it stays in this browser, not saved to the account, until a save changes it.
   */
  | { type: "refused"; id: string; title: string }
  /** Where documents are may have moved (`places`): the list's marks are worth reading again. */
  | { type: "places" };

/**
 * What signing out came to: done, or the documents not in the account, kept: their saves could not
 * be sent, or the account `refused` them as they are (decision 0098), which waiting cannot change.
 */
export type SignOut =
  | { done: true }
  | { done: false; unsent: { id: string; title: string; refused?: true }[] };

export interface SyncOptions {
  store: DocumentStore;
  /** The Web Locks to take turns with; `navigator.locks` by default, and null for none. */
  locks?: Locks | null;
  /** Where to hear the page hidden, shown and back online; the page's own by default. */
  page?: PageEvents | null;
  hooks?: OriginalsHooks;
}

/** One sign-in: the account, and the device's connection to it. */
interface Session {
  account: string;
  server: SyncServer;
}

export class SyncQueue {
  private readonly store: DocumentStore;
  private readonly locks: Locks | undefined;
  private readonly page: PageEvents | undefined;
  private readonly hooks: OriginalsHooks;
  private session: Session | undefined;
  /** Whether this tab holds the lock, and sends. */
  private sender = false;
  private release: (() => void) | undefined;
  /** When each document was last sent, or tried. */
  private readonly lastSent = new Map<string, number>();
  private failures = 0;
  /** No round sends before this, after a failure. */
  private blockedUntil = 0;
  private sendTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private round: Promise<void> | undefined;
  /** A round was asked for while one was under way; `urgent` if that one ignores the waits. */
  private again: { urgent: boolean } | undefined;
  private bringing: Promise<void> | undefined;
  /** Signing out sends a round of its own, which no other round runs beside. */
  private signingOut = false;
  private asked = 0;
  private readonly listeners = new Set<(event: SyncEvent) => void>();
  private readonly unsubscribe: (() => void)[] = [];

  constructor(options: SyncOptions) {
    this.store = options.store;
    this.locks =
      options.locks === undefined
        ? typeof navigator === "undefined"
          ? undefined
          : (navigator.locks ?? undefined)
        : (options.locks ?? undefined);
    this.page =
      options.page === undefined
        ? typeof window === "undefined"
          ? undefined
          : { window, document }
        : (options.page ?? undefined);
    this.hooks = options.hooks ?? {};
    this.unsubscribe.push(
      this.store.onStored(() => this.pump()),
      this.store.onChanged((id, by) => {
        if (by === "device") this.emit({ type: "changed", id });
      }),
    );
    const page = this.page;
    if (page !== undefined) {
      const visibility = () => this.visibility();
      const online = () => this.online();
      page.document.addEventListener("visibilitychange", visibility);
      page.window.addEventListener("online", online);
      this.unsubscribe.push(() => {
        page.document.removeEventListener("visibilitychange", visibility);
        page.window.removeEventListener("online", online);
      });
    }
  }

  /** The signed-in account's user id, or undefined. */
  get account(): string | undefined {
    return this.session?.account;
  }

  /** How many documents only in this browser the first sign-in's question is about; 0 for none. */
  get asking(): number {
    return this.asked;
  }

  /** Call `listener` with each event. Returns a function that stops the calls. */
  on(listener: (event: SyncEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Where each document the list shows is, by its id. */
  places(): Promise<Map<string, Where>> {
    return this.store.places();
  }

  /**
   * Start syncing `account`'s documents, on load with a session or at sign-in, through `server`.
   * The store shows only its documents and those of none from now on; another account's left in
   * this browser with nothing pending go. Settles once the account's documents are brought in, or
   * could not be; sending starts once this tab holds the lock.
   */
  async signIn(account: string, server: SyncServer): Promise<void> {
    if (this.session !== undefined) this.stop();
    const session: Session = { account, server };
    this.session = session;
    this.failures = 0;
    this.blockedUntil = 0;
    this.lastSent.clear();
    this.store.setAccount(account);
    // Another account's documents, left by a sign-in that did not sign out, go once they hold
    // nothing pending, files owed included; those that do stay, out of sight, until it signs in
    // again.
    for (const row of await this.store.syncRows())
      if (
        row.owner !== undefined &&
        row.owner !== account &&
        !row.pending &&
        !row.removed &&
        !row.filesOwed
      )
        await this.store.remove(row.id);
    if (this.session !== session) return;
    const ownerless = (await this.store.syncRows()).filter(onlyHere).length;
    if (ownerless > 0 && !(await this.store.saidNotNow(account)) && this.session === session) {
      this.asked = ownerless;
      this.emit({ type: "question", count: ownerless });
    }
    await this.bringIn();
    if (this.session !== session) return;
    this.scheduleRefresh();
    this.takeLock(session);
  }

  /**
   * The person's answer to the first sign-in's question: "add" gives every document only in this
   * browser to the account, to be sent; "not-now" leaves them, and is remembered for the account.
   */
  async answer(answer: "add" | "not-now"): Promise<void> {
    const session = this.session;
    if (session === undefined) return;
    this.asked = 0;
    if (answer === "add") await this.store.adopt(session.account);
    else await this.store.notNow(session.account);
    this.emit({ type: "places" });
  }

  /** Give one document only in this browser to the account, as the list's "Add" does. */
  async addToAccount(id: string): Promise<void> {
    const session = this.session;
    if (session === undefined) return;
    await this.store.adopt(session.account, [id]);
    this.emit({ type: "places" });
  }

  /**
   * Delete a document, from this browser at once and from the account when it can be reached: an
   * account's document stays hidden in the store until the account has taken the deletion. Returns
   * the package that went with a document of no account, as `DocumentStore.remove` does; an
   * account's says so in its `removed` event.
   */
  async remove(id: string): Promise<string | undefined> {
    const row = await this.store.syncRow(id);
    const session = this.session;
    if (
      session !== undefined &&
      row?.owner === session.account &&
      (await this.store.markRemoved(id))
    )
      return undefined;
    return this.store.remove(id);
  }

  /**
   * Sign out: send what is pending, and then remove the account's documents and their imports
   * from this browser; documents only in this browser stay. When some could not be sent, nothing is
   * removed, and their titles come back, so that the person is asked; `discard` then goes on.
   */
  async signOut({ discard = false }: { discard?: boolean } = {}): Promise<SignOut> {
    const session = this.session;
    if (session === undefined) return { done: true };
    await this.store.flush();
    if (!discard) {
      this.signingOut = true;
      try {
        while (this.round !== undefined) await this.round;
        // This tab may not hold the lock: sending what another tab also sends meets a conflict
        // on the same document, which the store takes as the same (`bringIn`), never as a copy.
        await this.sendRound(session, true);
      } finally {
        this.signingOut = false;
      }
      const left = (await this.store.syncRows()).filter(
        (row) =>
          row.owner === session.account &&
          (row.pending || row.removed || row.filesOwed) &&
          !row.firstPass,
      );
      if (left.length > 0) {
        this.pump();
        return {
          done: false,
          unsent: left.map(({ id, title, refused }) => ({
            id,
            title,
            ...(refused ? { refused: true as const } : {}),
          })),
        };
      }
    }
    this.stop();
    for (const row of await this.store.syncRows())
      if (row.owner === session.account) await this.store.remove(row.id);
    this.emit({ type: "places" });
    return { done: true };
  }

  /**
   * Stop syncing, removing nothing: the session ended elsewhere, as a sign-out in another tab. The
   * store shows only documents of no account.
   */
  stop(): void {
    this.session = undefined;
    this.asked = 0;
    this.again = undefined;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.letGo();
    this.store.setAccount(undefined);
  }

  /** Stop, and stop listening to the store and the page. */
  close(): void {
    this.stop();
    for (const stop of this.unsubscribe.splice(0)) stop();
    this.listeners.clear();
  }

  /** Settle once the round of sending and the bringing in under way, if any, have. */
  async settled(): Promise<void> {
    while (this.round !== undefined || this.bringing !== undefined)
      await Promise.all([this.round, this.bringing]);
  }

  /**
   * Send what is due: a round, unless this tab does not send or no one is signed in; after the
   * round under way, if there is one. `urgent` sends everything pending now, whatever the waits.
   */
  private pump(urgent = false) {
    const session = this.session;
    if (!this.sender || session === undefined || this.signingOut) return;
    if (this.round !== undefined) {
      this.again = { urgent: urgent || this.again?.urgent === true };
      return;
    }
    clearTimeout(this.sendTimer);
    this.sendTimer = undefined;
    this.round = this.sendRound(session, urgent).finally(() => {
      this.round = undefined;
      const again = this.again;
      this.again = undefined;
      if (again !== undefined) this.pump(again.urgent);
    });
  }

  /**
   * Send each of the account's pending documents that is due, one at a time, and set the timer for
   * the next one due. The first failure stops the round, and every send waits for `blockedUntil`.
   */
  private async sendRound(session: Session, urgent: boolean): Promise<void> {
    const rows = (await this.store.syncRows()).filter(
      (row) =>
        row.owner === session.account &&
        (row.pending || row.removed || row.filesOwed) &&
        !row.firstPass &&
        !row.refused,
    );
    let next = Number.POSITIVE_INFINITY;
    let tried = false;
    for (const row of rows) {
      if (this.session !== session) return;
      const now = Date.now();
      const due = urgent
        ? now
        : Math.max(
            this.blockedUntil,
            (this.lastSent.get(row.id) ?? -SEND_INTERVAL) + SEND_INTERVAL,
          );
      if (due > now) {
        next = Math.min(next, due);
        continue;
      }
      this.lastSent.set(row.id, now);
      tried = true;
      try {
        try {
          await this.send(row, session);
        } catch (error) {
          if (!(error instanceof ServerRefused)) throw error;
          // The account answered, and will answer the same to this revision whenever it is sent.
          console.warn("The account refused a document; it stays in this browser", error.code);
          await this.store.markRefused(row.id, row.revision);
          this.emit({ type: "refused", id: row.id, title: row.title });
        }
        this.failures = 0;
        this.blockedUntil = 0;
      } catch (error) {
        if (!(error instanceof ServerUnavailable))
          console.error("A document could not be sent to the account", error);
        this.failures++;
        this.blockedUntil = Date.now() + waitAfter(this.failures);
        next = this.blockedUntil;
        break;
      }
    }
    if (tried) this.emit({ type: "places" });
    if (next !== Number.POSITIVE_INFINITY && this.session === session && this.sender) {
      clearTimeout(this.sendTimer);
      this.sendTimer = setTimeout(
        () => {
          this.sendTimer = undefined;
          this.pump();
        },
        Math.max(0, next - Date.now()),
      );
    }
  }

  /**
   * Send one row as the store held it at the round's start, and keep what the account said; then an
   * imported `.tex` document's files, while the account lacks them.
   */
  private async send(row: SyncRow, session: Session): Promise<void> {
    if (row.removed) {
      if (row.kind === "tex") await this.hooks.removing?.(row.id);
      await session.server.remove(row.id);
      const dropped = await this.store.remove(row.id);
      this.emit({ type: "removed", id: row.id, ...(dropped === undefined ? {} : { dropped }) });
      return;
    }
    const inserted = row.pending ? await this.sendRow(row, session) : false;
    if (inserted === undefined || !row.filesOwed || this.session !== session) return;
    if (this.hooks.sent !== undefined) {
      // Sent before, and still owing its files: another device may have deleted it since.
      if (!row.pending && !(await this.stillInAccount(row.id, session))) return;
      await this.hooks.sent(row.id, inserted);
      // Deleted elsewhere while they went up, which that deletion could not have taken.
      if (!(await this.stillInAccount(row.id, session))) return;
    }
    await this.store.markFilesSent(row.id);
  }

  /**
   * Whether the account still holds a document whose files this browser owes. When it does not,
   * whatever of its files went up is deleted, and the document goes from this browser as any the
   * account no longer has; until the files are deleted, it stays to be tried again.
   */
  private async stillInAccount(id: string, session: Session): Promise<boolean> {
    if ((await session.server.get(id)) !== null) return true;
    const row = await this.store.syncRow(id);
    if (row === undefined || this.session !== session) return false;
    await this.hooks.removing?.(id);
    this.gone(id, await this.store.goneFromAccount(id, session.account, row.serverRevision));
    return false;
  }

  /**
   * Send a row, and keep what the account said. Returns whether the account took it, as an insert
   * or not, or undefined when it refused it over another device's version, which the store then
   * holds.
   */
  private async sendRow(row: SyncRow, { account, server }: Session): Promise<boolean | undefined> {
    // Cleaned as the account can keep it; a document too large is refused here, unsent.
    const upload = cleanUpload({
      id: row.id,
      kind: row.kind,
      templateId: row.template,
      title: row.title,
      document: row.document,
    });
    const inserting = row.serverRevision === undefined;
    const result =
      row.serverRevision === undefined
        ? await server.insert(upload)
        : await server.update(upload, row.serverRevision);
    if (result.ok) {
      await this.store.markSent(row.id, row.revision, result.revision);
      return inserting;
    }
    // Refused: the account's version, if it has one, keeps the id.
    const theirs = result.reason === "missing" ? null : await server.get(row.id);
    if (theirs === null) {
      this.gone(row.id, await this.store.goneFromAccount(row.id, account, row.serverRevision));
      return undefined;
    }
    await this.broughtIn(theirs.id, theirs.kind, await this.store.bringIn(theirs, account));
    return undefined;
  }

  /**
   * Bring the account's newer documents into the store, and let go of those it no longer has; once
   * at a time. A failure to reach the account waits for the next occasion.
   */
  private bringIn(): Promise<void> {
    const session = this.session;
    if (session === undefined) return Promise.resolve();
    if (this.bringing !== undefined) return this.bringing;
    const bringing = this.bringInNow(session)
      .catch((error: unknown) => {
        if (!(error instanceof ServerUnavailable))
          console.error("The account's documents could not be brought in", error);
      })
      .finally(() => {
        this.bringing = undefined;
      });
    this.bringing = bringing;
    return bringing;
  }

  private async bringInNow(session: Session): Promise<void> {
    const { account, server } = session;
    // The editor's last saves are written first, so that a document with saves the account has
    // not taken is seen as pending, and kept as a copy rather than written over.
    await this.store.flush();
    // Read before the list, so that a document sent meanwhile is not taken as deleted.
    const before = (await this.store.syncRows()).filter((row) => row.owner === account);
    const entries = await server.list();
    if (this.session !== session) return;
    const here = new Map(before.map((row) => [row.id, row]));
    for (const entry of entries) {
      const row = here.get(entry.id);
      if (row?.removed === true) continue;
      if (row?.serverRevision !== undefined && row.serverRevision >= entry.revision) continue;
      const doc = await server.get(entry.id);
      if (this.session !== session) return;
      if (doc === null) continue;
      await this.broughtIn(doc.id, doc.kind, await this.store.bringIn(doc, account));
    }
    const listed = new Set(entries.map((entry) => entry.id));
    for (const row of before) {
      // A deletion of this browser's own the queue has still to send stays for it.
      if (row.serverRevision === undefined || row.removed || listed.has(row.id)) continue;
      this.gone(row.id, await this.store.goneFromAccount(row.id, account, row.serverRevision));
    }
    this.emit({ type: "places" });
  }

  /** What bringing a document in did: a copy kept, and an imported one's originals to fetch. */
  private async broughtIn(id: string, kind: string, brought: BroughtIn) {
    if (brought.outcome === "copied")
      this.emit({ type: "copied", id, copy: brought.copy, title: brought.title, why: "conflict" });
    if (kind === "tex" && brought.outcome !== "none" && brought.outcome !== "same")
      await this.hooks.broughtIn?.(id);
  }

  /** What the account no longer having a document did here. */
  private gone(id: string, gone: Gone) {
    if (gone.copy !== undefined)
      this.emit({ type: "copied", id, copy: gone.copy.id, title: gone.copy.title, why: "deleted" });
    if (gone.removed)
      this.emit({
        type: "removed",
        id,
        ...(gone.dropped === undefined ? {} : { dropped: gone.dropped }),
      });
  }

  /** Ask for the lock, and send once it is granted, holding it until let go of. */
  private takeLock(session: Session) {
    if (this.locks === undefined) {
      this.sender = true;
      this.pump();
      return;
    }
    this.locks
      .request(
        SYNC_LOCK,
        () =>
          new Promise<void>((release) => {
            // Granted after a sign-out or a new sign-in: let it go at once.
            if (this.session !== session || this.sender) {
              release();
              return;
            }
            this.release = release;
            this.sender = true;
            this.pump();
          }),
      )
      .catch((error: unknown) => console.error("The sync lock could not be taken", error));
  }

  /** Stop sending, and let the lock go to another tab. */
  private letGo() {
    this.sender = false;
    clearTimeout(this.sendTimer);
    this.sendTimer = undefined;
    const release = this.release;
    this.release = undefined;
    release?.();
  }

  private hidden(): boolean {
    return this.page?.document.visibilityState === "hidden";
  }

  /**
   * The page was hidden: send everything now, the last moment a page can count on, then let the
   * lock go to a visible tab, asking for it again behind it. Shown: bring the account's documents
   * in, and every five minutes again.
   */
  private visibility() {
    const session = this.session;
    if (session === undefined) return;
    if (!this.hidden()) {
      this.scheduleRefresh(true);
      return;
    }
    clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.pump(true);
    if (this.locks === undefined || !this.sender) return;
    void (async () => {
      while (this.round !== undefined) await this.round;
      if (this.session !== session || !this.sender || !this.hidden()) return;
      this.letGo();
      this.takeLock(session);
    })();
  }

  /** The connection is back: send now, what failed meanwhile, and bring in what changed. */
  private online() {
    if (this.session === undefined) return;
    this.failures = 0;
    this.blockedUntil = 0;
    // A document tried while offline was not sent, so its interval does not hold it back.
    this.lastSent.clear();
    this.pump();
    void this.bringIn();
  }

  /** Bring in every `REFRESH_INTERVAL` while the page is visible; now too, if `now`. */
  private scheduleRefresh(now = false) {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    if (this.session === undefined || this.hidden()) return;
    if (now) void this.bringIn();
    this.refreshTimer = setTimeout(() => this.scheduleRefresh(true), REFRESH_INTERVAL);
  }

  private emit(event: SyncEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("A listener to the sync queue failed", error);
      }
    }
  }
}

/** A document only in this browser that the question is about. */
const onlyHere = (row: SyncRow) => row.owner === undefined && !row.removed && !row.firstPass;
