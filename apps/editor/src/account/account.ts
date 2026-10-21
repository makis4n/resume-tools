/**
 * The person's account as the editor knows it (milestone 4 item 4, decision 0094): signed out,
 * being checked, or signed in with an email. It is the one place that listens to the client's
 * session (`onAuthStateChange`), which the header reads, and the one that loads the client: when
 * the person opens sign-in, when a session is stored, or when the address carries a sign-in link's
 * callback. A signed-out person with none of those never loads it, and sends Supabase nothing.
 *
 * A sign-in link comes back to the editor with a code and the flow id of the request it answers,
 * and the code is exchanged here for a session with the PKCE verifier this browser kept for that
 * request; one opened in another browser has no verifier for it, whatever others it keeps, and says
 * so. Every message is the editor's own (`messageFor`), never Supabase's text.
 *
 * Item 5 adds the email and password: making an account, which emails a link to confirm the address
 * that comes back through the same callback and then asks for a password (decision 0099); signing
 * in; a reset link, which comes back the same way but opens the recovery state, where the person
 * sets a new password; and changing the password while signed in, after checking the current one.
 */
import type { AuthChangeEvent, Session, SupabaseClient } from "@supabase/supabase-js";
import { type Callback, CHOOSE_PASSWORD, callbackOf, THEN, withoutCallback } from "./callback";
import {
  accountsConfig,
  browserStorage,
  type ClientLoader,
  forgetStoredSession,
  hasStoredSession,
  hasStoredVerifier,
  loadClient,
  type SessionStorage,
  STORAGE_KEY,
} from "./client";
import {
  ANOTHER_BROWSER,
  codeOf,
  type Moment,
  messageFor,
  NOT_SIGNED_OUT,
  PASSWORD_RULE,
  SESSION_ENDED,
  UNREACHABLE,
  WRONG_PASSWORD,
} from "./messages";
import { keepsRule } from "./password";

/** A sign-in link that came back with a code to exchange. */
type LinkBack = Exclude<Callback, { error: string }>;

/** Where the account stands, as the header shows it. */
export interface AccountState {
  /**
   * Signed out; being checked, while a stored session or a link is read; signed in; or recovering,
   * signed in by a reset link and asked to set a new password, or by the link of "Make an account"
   * and asked to choose one.
   */
  status: "signed-out" | "checking" | "signed-in" | "recovering";
  /** The signed-in account's email. */
  email?: string;
  /** Recovering after "Make an account", choosing a password, rather than after a reset. */
  first?: true;
  /** What a sign-in link that came back could not do, in the editor's words, until dismissed. */
  notice?: string;
}

/** The page's address: read, and replaced without a reload once a callback is read from it. */
export interface Place {
  href(): string;
  replace(href: string): void;
}

/** The browser's own address bar. */
export const browserPlace: Place = {
  href: () => window.location.href,
  replace: (href) => window.history.replaceState(window.history.state, "", href),
};

export interface AccountOptions {
  /** Loads the client; the editor's one client, or a fake in DOM tests. */
  load: ClientLoader;
  /** Where a stored session and a verifier are looked for; local storage when none is given. */
  storage?: SessionStorage;
  /** The page's address; the browser's when none is given. */
  place?: Place;
}

/** The address a sign-in link leads back to: the editor's own, without its query or fragment. */
export function redirectOf(href: string): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}`;
}

/** The state a session gives: signed in with its email, or signed out with none. */
function stateOf(session: Session | null): AccountState {
  return session === null
    ? { status: "signed-out" }
    : { status: "signed-in", email: session.user.email ?? "" };
}

/** The recovery state for `email`: after a reset, or choosing a first password. */
function recovering(email: string, first: boolean): AccountState {
  return { status: "recovering", email, ...(first ? { first: true as const } : {}) };
}

/**
 * Where the recovery state is kept in this browser's storage, so that a reload before the new
 * password is set comes back to it rather than to a plain sign-in: the account's email, and whether
 * it is a first password. It grants nothing; it only says which panel to show the same session.
 */
export const RECOVERING_KEY = `${STORAGE_KEY}-recovering`;

/** The recovery state kept in `storage`, or none. */
function keptRecovery(
  storage: SessionStorage | undefined,
): { email: string; first: boolean } | undefined {
  try {
    const kept: unknown = JSON.parse(storage?.getItem(RECOVERING_KEY) ?? "null");
    if (typeof kept !== "object" || kept === null) return undefined;
    const { email, first } = kept as { email?: unknown; first?: unknown };
    return typeof email === "string" && email !== "" ? { email, first: first === true } : undefined;
  } catch {
    return undefined;
  }
}

export class Account {
  readonly #load: ClientLoader;
  readonly #storage: SessionStorage | undefined;
  readonly #place: Place;
  #state: AccountState = { status: "signed-out" };
  /** The signed-in session's user id, kept beside the state, which shows only what the header does. */
  #userId: string | undefined;
  readonly #listeners = new Set<() => void>();
  #client: Promise<SupabaseClient> | undefined;
  #started = false;

  constructor({ load, storage, place }: AccountOptions) {
    this.#load = load;
    this.#storage = storage ?? browserStorage();
    this.#place = place ?? browserPlace;
  }

  /** The state now; the same object until it changes, as `useSyncExternalStore` asks. */
  readonly state = (): AccountState => this.#state;

  /**
   * The user id of the session the account is signed in with, while there is one (signed in, or
   * recovering): the account the sync queue sends documents to (item 7). Listeners are told when it
   * changes, as when the state does.
   */
  readonly userId = (): string | undefined => this.#userId;

  /** Be told when the state changes; returns what stops it. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /**
   * Move to `next`, with the user id of the session it comes from; a state read from no session
   * keeps the one there was, and signed out has none.
   */
  #set(next: AccountState, userId: string | undefined = this.#userId): void {
    this.#keep(next);
    const id = next.status === "signed-out" ? undefined : userId;
    const now = this.#state;
    if (
      now.status === next.status &&
      now.email === next.email &&
      now.notice === next.notice &&
      now.first === next.first &&
      this.#userId === id
    )
      return;
    this.#userId = id;
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }

  /**
   * Keep the recovery state in this browser's storage while it lasts, and forget it once the person
   * is signed in without it or signed out; while the account is being checked, it stays as it is.
   */
  #keep(next: AccountState): void {
    try {
      if (next.status === "recovering")
        this.#storage?.setItem(
          RECOVERING_KEY,
          JSON.stringify({ email: next.email ?? "", first: next.first === true }),
        );
      else if (next.status !== "checking") this.#storage?.removeItem(RECOVERING_KEY);
    } catch {
      // A storage that refuses it leaves the state in memory, which holds until a reload.
    }
  }

  /** The recovery state for the session of `email`, kept in memory or, across a reload, stored. */
  #recoveringAs(email: string): AccountState | undefined {
    const { status, first } = this.#state;
    if (status === "recovering" && this.#state.email === email)
      return recovering(email, first === true);
    const kept = keptRecovery(this.#storage);
    return kept?.email === email ? recovering(email, kept.first) : undefined;
  }

  /**
   * The client, loaded the first time it is asked for, with the session listener on it: what
   * sign-in uses, and what item 7 will use for the table and Storage. A failed load is forgotten,
   * so the next ask tries again.
   */
  client(): Promise<SupabaseClient> {
    if (this.#client === undefined) {
      const loading = this.#load().then((client) => {
        // The client tells of a sign-in, a sign-out, a refresh; its first word, the session it
        // started with, is read once it is ready (`#connect`), so the header does not flicker.
        client.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
          if (event === "INITIAL_SESSION") return;
          this.#set(this.#after(event, session), session?.user.id);
        });
        return client;
      });
      this.#client = loading;
      loading.catch(() => {
        if (this.#client === loading) this.#client = undefined;
      });
    }
    return this.#client;
  }

  /**
   * The state an event of the client's leads to. A reset link's exchange tells `PASSWORD_RECOVERY`,
   * which opens the recovery state; that state stays while the session is the same person's, as
   * the client refreshes it or tells of it again, and across a reload, until a new password is set
   * or the person leaves it or signs out.
   */
  #after(event: AuthChangeEvent, session: Session | null): AccountState {
    if (session !== null) {
      const email = session.user.email ?? "";
      if (event === "PASSWORD_RECOVERY") return recovering(email, false);
      const kept = this.#recoveringAs(email);
      if (kept !== undefined) return kept;
    }
    return { ...stateOf(session), ...this.#keptNotice(session) };
  }

  /** The notice kept while signed out; signing in leaves it behind. */
  #keptNotice(session: Session | null): Pick<AccountState, "notice"> {
    const { notice } = this.#state;
    return session === null && notice !== undefined ? { notice } : {};
  }

  /**
   * Read the address and the storage, once: a sign-in link's callback, or a stored session, loads
   * the client and reads the session; with neither, nothing is loaded and the person is signed out.
   * A link opened where no verifier is kept, or one that came back with an error, says why.
   */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    const href = this.#place.href();
    const callback = callbackOf(href);
    let link: LinkBack | undefined;
    let notice: string | undefined;
    if (callback !== undefined && "error" in callback) {
      console.warn("A sign-in link came back with an error:", callback.error);
      notice = messageFor(callback.error, "link");
    } else if (callback !== undefined && !hasStoredVerifier(this.#storage, callback.flowId)) {
      notice = ANOTHER_BROWSER;
    } else if (callback !== undefined) {
      link = callback;
    }
    // A callback that will not be exchanged leaves the address now; one that will, once it is.
    if (callback !== undefined && link === undefined) this.#place.replace(withoutCallback(href));
    if (link !== undefined || hasStoredSession(this.#storage)) void this.#connect(link, notice);
    else if (notice !== undefined) this.#set({ status: "signed-out", notice });
  }

  /** Load the client, exchange the link's code if there is one, and read the session. */
  async #connect(link: LinkBack | undefined, notice: string | undefined): Promise<void> {
    this.#set({ status: "checking", ...(notice === undefined ? {} : { notice }) });
    let said = notice;
    let session: Session | null = null;
    let choose = false;
    try {
      const client = await this.client();
      // The stored session, read and refreshed if it needs to be.
      const started = await client.auth.initialize();
      if (started.error) console.warn("The stored session could not be read:", started.error);
      if (link !== undefined) {
        // By its flow id, the code is exchanged with its own request's verifier, and a failure
        // takes only that one out of this browser, leaving the other links asked for here.
        const { error } = await client.auth.exchangeCodeForSession(
          link.code,
          link.flowId === undefined ? undefined : { flowId: link.flowId },
        );
        if (error) {
          console.warn("The sign-in link could not be exchanged:", error);
          said = messageFor(error, "link");
        }
        // A reset link's request kept its verifier marked as one, and its exchange tells
        // `PASSWORD_RECOVERY` rather than `SIGNED_IN`, which the listener has made the state. The
        // link of "Make an account" says so in its address, and asks for a password once in.
        choose = !error && link.choosePassword === true;
      }
      session = (await client.auth.getSession()).data.session;
    } catch (error) {
      console.error("The account could not be read:", error);
      if (link !== undefined) said = UNREACHABLE;
    } finally {
      if (link !== undefined) this.#place.replace(withoutCallback(this.#place.href()));
    }
    const state = stateOf(session);
    if (state.status === "signed-in") {
      const email = state.email ?? "";
      const kept = choose ? recovering(email, true) : this.#recoveringAs(email);
      if (kept !== undefined) return this.#set(kept, session?.user.id);
    }
    this.#set(
      state.status === "signed-out" && said !== undefined ? { ...state, notice: said } : state,
      session?.user.id,
    );
  }

  /** Load the client in the background, as sign-in opens, so that sending waits less. */
  prepare(): void {
    this.client().catch((error: unknown) =>
      console.error("The account client did not load:", error),
    );
  }

  /** Forget what a sign-in link could not do, as the person closes sign-in. */
  dismiss(): void {
    if (this.#state.notice !== undefined) this.#set({ ...this.#state, notice: undefined });
  }

  /**
   * Email a sign-in link to `email`, which leads back to the editor here, in this browser, where
   * the verifier the client keeps now is. Returns what went wrong, in the editor's words, or none.
   */
  async sendLink(email: string): Promise<string | undefined> {
    try {
      const client = await this.client();
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectOf(this.#place.href()) },
      });
      if (error) {
        console.warn("The sign-in link was not sent:", error);
        return messageFor(error, "send");
      }
    } catch (error) {
      console.error("The sign-in link was not sent:", error);
      return codeOf(error) === undefined ? UNREACHABLE : messageFor(error, "send");
    }
    this.dismiss();
    return undefined;
  }

  /**
   * Call `act` with the client, and say what went wrong in the editor's words for `moment`, or none:
   * an error it returns, or one thrown, as when the client cannot be loaded or reached.
   */
  async #ask(
    moment: Moment,
    what: string,
    act: (client: SupabaseClient) => Promise<{ error: unknown }>,
  ): Promise<string | undefined> {
    try {
      const { error } = await act(await this.client());
      if (!error) return undefined;
      console.warn(`${what}:`, error);
      return messageFor(error, moment);
    } catch (error) {
      console.error(`${what}:`, error);
      return codeOf(error) === undefined ? UNREACHABLE : messageFor(error, moment);
    }
  }

  /**
   * Make an account with `email` (decision 0099): Supabase emails a link that confirms the address,
   * or signs in to the account it has already, which leads back here, in this browser, signed in and
   * asked to choose a password. No password goes now: Auth would keep one set before the address
   * is confirmed, whoever set it, so the database drops it at confirmation, and the password is
   * chosen once the link proves the address. The reply is the same whether or not the address has
   * an account. Returns what went wrong, or none; an email that could not be sent, even for being
   * asked again too soon, is said, never read as sent.
   */
  async signUp(email: string): Promise<string | undefined> {
    const back = new URL(redirectOf(this.#place.href()));
    back.searchParams.set(THEN, CHOOSE_PASSWORD);
    const problem = await this.#ask("signUp", "The account was not made", (client) =>
      client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: back.toString(), shouldCreateUser: true },
      }),
    );
    if (problem === undefined) this.dismiss();
    return problem;
  }

  /**
   * Sign in with `email` and `password`. A wrong email, a wrong password and an address with no
   * account get one message; a password that breaks the rule cannot be anyone's, and gets the same
   * without a request. Returns what went wrong, or none.
   */
  async signIn(email: string, password: string): Promise<string | undefined> {
    if (!keepsRule(password)) return WRONG_PASSWORD;
    let session: Session | null = null;
    const problem = await this.#ask("signIn", "The sign-in failed", async (client) => {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      session = data.session;
      return { error };
    });
    if (problem === undefined) this.#set(stateOf(session), (session as Session | null)?.user.id);
    return problem;
  }

  /**
   * Email a link to set a new password for `email`, which leads back here in the recovery state.
   * Supabase answers the same whether or not the address has an account. An email it could not
   * send (`over_email_send_rate_limit`: too many for the project, or this address asked again too
   * soon) is said as such, never read as sent (decision 0099). Returns what went wrong, or none.
   */
  async sendReset(email: string): Promise<string | undefined> {
    return this.#ask("reset", "The reset link was not sent", (client) =>
      client.auth.resetPasswordForEmail(email, { redirectTo: redirectOf(this.#place.href()) }),
    );
  }

  /**
   * Set a new password in the recovery state, which then ends, signed in. Returns what went wrong,
   * or none.
   */
  async setPassword(password: string): Promise<string | undefined> {
    if (!keepsRule(password)) return PASSWORD_RULE;
    const problem = await this.#ask("password", "The new password was not set", (client) =>
      client.auth.updateUser({ password }),
    );
    if (problem === undefined) this.endRecovery();
    return problem;
  }

  /** Leave the recovery state without a new password, signed in as the reset link left it. */
  endRecovery(): void {
    const { status, email } = this.#state;
    if (status === "recovering") this.#set({ status: "signed-in", email: email ?? "" });
  }

  /**
   * Change the signed-in account's password from `current` to `next`. The current one is checked
   * first by signing in with it: the local stack's Auth accepts `current_password` on `updateUser`
   * but ignores it unless its `security_update_password_require_current_password` is on, which the
   * CLI's `config.toml` cannot set (CLI 2.121.0, Auth 2.197.0). A wrong one changes nothing. The
   * server's own guard is `secure_password_change` (decision 0099): a session more than a day old
   * cannot set a password without an emailed code, and the sign-in here makes a new one.
   * Returns what went wrong, or none.
   */
  async changePassword(current: string, next: string): Promise<string | undefined> {
    if (!keepsRule(next)) return PASSWORD_RULE;
    const { email } = this.#state;
    if (this.#state.status !== "signed-in" || !email) return SESSION_ENDED;
    // No password that breaks the rule can be the current one.
    if (!keepsRule(current)) return messageFor("invalid_credentials", "current");
    const wrong = await this.#ask("current", "The current password was not taken", (client) =>
      client.auth.signInWithPassword({ email, password: current }),
    );
    if (wrong !== undefined) return wrong;
    return this.#ask("password", "The password was not changed", (client) =>
      client.auth.updateUser({ password: next }),
    );
  }

  /**
   * Sign out of this browser only: the session goes from it, and other devices stay signed in.
   * Returns what went wrong, in the editor's words, if the session is still here.
   */
  async signOut(): Promise<string | undefined> {
    try {
      const client = await this.client();
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) console.warn("Signing out could not reach the server:", error);
      // The client keeps the session when it could not read it first, as when its access token has
      // run out and the server cannot be reached to refresh it; leaving this browser needs no
      // server, so the session is taken out here, and the person is signed out only once it is.
      if (this.#storage !== undefined) {
        if (!forgetStoredSession(this.#storage)) return NOT_SIGNED_OUT;
      } else if ((await client.auth.getSession()).data.session !== null) {
        return NOT_SIGNED_OUT;
      }
    } catch (error) {
      console.error("Signing out failed:", error);
      return NOT_SIGNED_OUT;
    }
    this.#set({ status: "signed-out" });
    return undefined;
  }
}

/** The account the editor is built with, or none when it has no accounts (`accountsConfigured`). */
export function accountFromEnv(env?: Parameters<typeof accountsConfig>[0]): Account | undefined {
  const config = accountsConfig(env);
  return config === undefined ? undefined : new Account({ load: () => loadClient(config) });
}
