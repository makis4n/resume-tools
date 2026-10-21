/**
 * The account and the sync queue, joined (milestone 4 item 7, decision 0092): the page's one
 * `SyncQueue`, over the editor's `DocumentStore`, follows the account. When the account is signed in
 * (`Account.userId`), the queue is signed in as that user, on the account's one client through
 * `SupabaseServer`; when it is signed out, as by another tab, the queue stops and removes nothing;
 * when another user signs in, the queue moves to them. A signed-out page never makes a server,
 * so it asks Supabase nothing and loads none of its client.
 *
 * Signing out goes through here: the queue sends what is pending first, and the account signs out
 * only once it has; otherwise the person stays signed in and the unsent documents are named.
 * The first sign-in's question is kept on this state, unanswered, for item 9 to ask: nothing only
 * in this browser is uploaded until the person answers.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyncServer } from "../storage/server";
import type { DocumentStore } from "../storage/store";
import { SupabaseServer } from "../storage/supabase-server";
import { type SyncEvent, type SyncOptions, SyncQueue } from "../storage/sync";
import type { Account } from "./account";
import { unsentNotice } from "./messages";

/** What the account's screens read of the queue (item 9 shows it). */
export interface SyncState {
  /**
   * How many documents only in this browser the first sign-in's question is about, until the
   * person answers it; 0 when there is no question.
   */
  question: number;
  /**
   * The documents not in the account when signing out was asked for: saves not sent yet, or
   * `refused` by the account as they are (decision 0098).
   */
  unsent?: { id: string; title: string; refused?: true }[];
}

/** Makes the server the queue sends to as `user`, from the account's client. */
export type ServerMaker = (client: SupabaseClient, user: string) => SyncServer;

const NOTHING: SyncState = { question: 0 };

export class AccountSync {
  readonly #account: Account;
  readonly #makeServer: ServerMaker;
  #queue: SyncQueue | undefined;
  /** The user the queue was last told to sign in as, or none. */
  #target: string | undefined;
  #state: SyncState = NOTHING;
  readonly #listeners = new Set<() => void>();
  readonly #events = new Set<(event: SyncEvent) => void>();

  constructor(
    account: Account,
    makeServer: ServerMaker = (client, user) => new SupabaseServer(client, user),
  ) {
    this.#account = account;
    this.#makeServer = makeServer;
  }

  /** The state now; the same object until it changes, as `useSyncExternalStore` asks. */
  readonly state = (): SyncState => this.#state;

  /** Be told when the state changes; returns what stops it. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Be told of each of the queue's events; returns what stops it. */
  on(listener: (event: SyncEvent) => void): () => void {
    this.#events.add(listener);
    return () => this.#events.delete(listener);
  }

  /** The queue, while a store is attached. */
  get queue(): SyncQueue | undefined {
    return this.#queue;
  }

  /**
   * Make the page's queue over `store`, and have it follow the account from now on. Returns what
   * closes the queue and stops following, as the store closes.
   */
  attach(store: DocumentStore, options: Omit<SyncOptions, "store"> = {}): () => void {
    this.#queue?.close();
    const queue = new SyncQueue({ ...options, store });
    this.#queue = queue;
    this.#target = undefined;
    const stopEvents = queue.on((event) => this.#heard(event));
    const stopFollowing = this.#account.subscribe(() => this.#follow());
    this.#follow();
    return () => {
      stopFollowing();
      stopEvents();
      queue.close();
      if (this.#queue === queue) {
        this.#queue = undefined;
        this.#target = undefined;
      }
    };
  }

  /**
   * Delete a document through the queue, which deletes it from the account too when it is the
   * account's; or from the store alone when no queue is attached. Returns the package that went
   * with it, as `DocumentStore.remove` does.
   */
  remove(id: string, store: DocumentStore): Promise<string | undefined> {
    return (this.#queue ?? store).remove(id);
  }

  /** The person's answer to the first sign-in's question. */
  async answer(answer: "add" | "not-now"): Promise<void> {
    await this.#queue?.answer(answer);
    this.#set({ ...this.#state, question: 0 });
  }

  /**
   * Sign out: what is pending is sent first, then the account's documents leave this browser and
   * the account signs out. When some could not be sent, nothing is removed, the person stays signed
   * in, and the notice names them; `discard` signs out all the same. Returns what went wrong, in
   * the editor's words, or none.
   */
  async signOut({ discard = false }: { discard?: boolean } = {}): Promise<string | undefined> {
    const queue = this.#queue;
    if (queue?.account !== undefined) {
      const result = await queue.signOut({ discard });
      if (!result.done) {
        this.#set({ ...this.#state, unsent: result.unsent });
        return unsentNotice(result.unsent);
      }
    }
    this.#set(NOTHING);
    const problem = await this.#account.signOut();
    // Still signed in: the queue, stopped by its own sign-out, starts again.
    if (problem !== undefined) {
      this.#target = undefined;
      this.#follow();
    }
    return problem;
  }

  /** Bring the queue in line with the account: signed in as its user, or stopped. */
  #follow(): void {
    const queue = this.#queue;
    if (queue === undefined) return;
    const user = this.#account.userId();
    if (user === this.#target) return;
    this.#target = user;
    if (user === undefined) {
      queue.stop();
      this.#set(NOTHING);
      return;
    }
    this.#account
      .client()
      .then((client) => {
        // Overtaken: another user, a sign-out, or another store, since this was asked.
        if (this.#queue !== queue || this.#target !== user) return;
        return queue.signIn(user, this.#makeServer(client, user));
      })
      .catch((error: unknown) => {
        console.error("Syncing with the account could not start:", error);
        if (this.#target === user) this.#target = undefined;
      });
  }

  #heard(event: SyncEvent): void {
    if (event.type === "question") this.#set({ ...this.#state, question: event.count });
    for (const listener of this.#events) {
      try {
        listener(event);
      } catch (error) {
        console.error("A listener to the account's sync failed", error);
      }
    }
  }

  #set(next: SyncState): void {
    if (next.question === this.#state.question && next.unsent === this.#state.unsent) return;
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }
}
