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
 *
 * Item 9 adds the first save's notice (decision 0091): the first time an account is signed in on
 * this browser, the queue does not start until the person has read what saving to the account
 * sends and keeps (`telling`, answered by `tell`), which the store then remembers for the account.
 * Until then nothing is sent or brought in, and the editor works as signed out. The state also
 * carries where each document is (`places`), for the list's marks and the header's line.
 *
 * An imported `.tex` document's two files (item 8) go through the queue's hooks, `Originals`, which
 * reach the signed-in account's bucket (`SupabaseOriginals`); the editor opens a document through
 * them (`originals`), so that one brought in from the account downloads its files first.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { Originals } from "../storage/originals";
import { type OriginalsBucket, SupabaseOriginals } from "../storage/originals-bucket";
import type { SyncServer } from "../storage/server";
import type { DocumentStore, Where } from "../storage/store";
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
  /**
   * The first save's notice is due (decision 0091): the account is signed in, and has not been told
   * in this browser what saving to it sends; the queue waits for `tell`.
   */
  telling?: true;
  /** The queue is syncing the signed-in account's documents. */
  syncing?: true;
  /** Where each document the list shows is, by its id, once read. */
  places?: ReadonlyMap<string, Where>;
}

/** Makes the server the queue sends to as `user`, from the account's client. */
export type ServerMaker = (client: SupabaseClient, user: string) => SyncServer;

/** Makes the bucket an import's files go to as `user`, from the account's client. */
export type BucketMaker = (client: SupabaseClient, user: string) => OriginalsBucket;

const NOTHING: SyncState = { question: 0 };

export class AccountSync {
  readonly #account: Account;
  readonly #makeServer: ServerMaker;
  readonly #makeBucket: BucketMaker;
  #queue: SyncQueue | undefined;
  #originals: Originals | undefined;
  /** The user the queue was last told to sign in as, or none. */
  #target: string | undefined;
  #state: SyncState = NOTHING;
  /** The store the queue is over, while one is attached. */
  #store: DocumentStore | undefined;
  /** Whether the places are being read, and whether to read them again once they are. */
  #placing = false;
  #placeAgain = false;
  readonly #listeners = new Set<() => void>();
  readonly #events = new Set<(event: SyncEvent) => void>();

  constructor(
    account: Account,
    makeServer: ServerMaker = (client, user) => new SupabaseServer(client, user),
    makeBucket: BucketMaker = (client, user) => new SupabaseOriginals(client, user),
  ) {
    this.#account = account;
    this.#makeServer = makeServer;
    this.#makeBucket = makeBucket;
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
   * Where the editor resolves an imported template while a store is attached: the store's, and for
   * a document brought in from the account, once its files are downloaded (`Originals.templateOf`).
   */
  get originals(): Originals | undefined {
    return this.#originals;
  }

  /**
   * Make the page's queue over `store`, and have it follow the account from now on. Returns what
   * closes the queue and stops following, as the store closes.
   */
  attach(store: DocumentStore, options: Omit<SyncOptions, "store"> = {}): () => void {
    this.#queue?.close();
    const originals = new Originals(store);
    const queue = new SyncQueue({ hooks: originals, ...options, store });
    this.#queue = queue;
    this.#originals = originals;
    this.#store = store;
    this.#target = undefined;
    const stopEvents = queue.on((event) => this.#heard(event));
    const stopStored = store.onStored(() => this.#readPlaces());
    const stopFollowing = this.#account.subscribe(() => this.#follow());
    this.#follow();
    this.#readPlaces();
    return () => {
      stopFollowing();
      stopStored();
      stopEvents();
      queue.close();
      originals.connect(undefined);
      if (this.#queue === queue) {
        this.#queue = undefined;
        this.#originals = undefined;
        this.#store = undefined;
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

  /** Give one document only in this browser to the account, as the list's "Add to account" does. */
  async addToAccount(id: string): Promise<void> {
    await this.#queue?.addToAccount(id);
  }

  /**
   * The person has read the first save's notice: the store remembers it for the account, and the
   * queue starts. A store that cannot keep it starts the queue all the same; the notice was read.
   */
  async tell(): Promise<void> {
    const queue = this.#queue;
    const store = this.#store;
    const user = this.#target;
    if (!this.#state.telling || queue === undefined || store === undefined || user === undefined)
      return;
    try {
      await store.markTold(user);
    } catch (error) {
      console.error("That the person was told could not be kept:", error);
    }
    if (this.#queue !== queue || this.#target !== user) return;
    this.#set(without(this.#state, "telling"));
    this.#start(queue, user);
  }

  /** The person chose to stay signed in, over the sign-out warning: it goes. */
  stay(): void {
    if (this.#state.unsent !== undefined) this.#set(without(this.#state, "unsent"));
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
    this.#set(this.#nothing());
    const problem = await this.#account.signOut();
    // Still signed in: the queue, stopped by its own sign-out, starts again.
    if (problem !== undefined) {
      this.#target = undefined;
      this.#follow();
    }
    return problem;
  }

  /**
   * Bring the queue in line with the account: signed in as its user, once the person has been told
   * what saving to it sends, or stopped.
   */
  #follow(): void {
    const queue = this.#queue;
    const store = this.#store;
    if (queue === undefined || store === undefined) return;
    const user = this.#account.userId();
    if (user === this.#target) return;
    this.#target = user;
    const originals = this.#originals;
    if (queue.account !== undefined) {
      queue.stop();
      this.#readPlaces();
    }
    // Until the new account's bucket is reached, none is: the old one's must take nothing more.
    originals?.connect(undefined);
    this.#set(this.#nothing());
    if (user === undefined) return;
    store.wasTold(user).then(
      (told) => {
        if (this.#queue !== queue || this.#target !== user) return;
        if (told) this.#start(queue, user);
        else this.#set({ ...this.#state, telling: true });
      },
      (error: unknown) => {
        console.error("Whether the person was told could not be read:", error);
        if (this.#queue === queue && this.#target === user)
          this.#set({ ...this.#state, telling: true });
      },
    );
  }

  /** Sign the queue in as `user`, on the account's client, with its bucket for the originals. */
  #start(queue: SyncQueue, user: string): void {
    const originals = this.#originals;
    this.#set({ ...this.#state, syncing: true });
    this.#account
      .client()
      .then((client) => {
        // Overtaken: another user, a sign-out, or another store, since this was asked.
        if (this.#queue !== queue || this.#target !== user) return;
        originals?.connect(this.#makeBucket(client, user));
        return queue.signIn(user, this.#makeServer(client, user));
      })
      .then(() => this.#readPlaces())
      .catch((error: unknown) => {
        console.error("Syncing with the account could not start:", error);
        if (this.#target === user) {
          this.#target = undefined;
          this.#set(without(this.#state, "syncing"));
        }
      });
  }

  /** The state with nothing asked and nothing syncing, keeping the places as last read. */
  #nothing(): SyncState {
    const { places } = this.#state;
    return places === undefined ? NOTHING : { ...NOTHING, places };
  }

  /** Read where each document is again, once the reading under way, if any, is done. */
  #readPlaces(): void {
    const queue = this.#queue;
    if (queue === undefined) return;
    if (this.#placing) {
      this.#placeAgain = true;
      return;
    }
    this.#placing = true;
    queue
      .places()
      .then((places) => {
        if (this.#queue === queue) this.#set({ ...this.#state, places });
      })
      .catch((error: unknown) => console.error("Where the documents are could not be read:", error))
      .finally(() => {
        this.#placing = false;
        if (this.#placeAgain) {
          this.#placeAgain = false;
          this.#readPlaces();
        }
      });
  }

  #heard(event: SyncEvent): void {
    if (event.type === "question") this.#set({ ...this.#state, question: event.count });
    this.#readPlaces();
    for (const listener of this.#events) {
      try {
        listener(event);
      } catch (error) {
        console.error("A listener to the account's sync failed", error);
      }
    }
  }

  #set(next: SyncState): void {
    const now = this.#state;
    if (
      next.question === now.question &&
      next.unsent === now.unsent &&
      next.telling === now.telling &&
      next.syncing === now.syncing &&
      samePlaces(next.places, now.places)
    )
      return;
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }
}

/** The state without one of its optional fields. */
function without(state: SyncState, field: "unsent" | "telling" | "syncing"): SyncState {
  const { [field]: _, ...rest } = state;
  return rest;
}

/** Whether two readings of where the documents are say the same. */
function samePlaces(
  a: ReadonlyMap<string, Where> | undefined,
  b: ReadonlyMap<string, Where> | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.size !== b.size) return false;
  for (const [id, where] of a) if (b.get(id) !== where) return false;
  return true;
}
