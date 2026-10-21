/**
 * The editor's Supabase client (milestone 4 item 4, decisions 0094 and 0097): the browser's client
 * for sign-in, and later for the `documents` table and Storage (item 7), made with the PKCE flow and
 * the session kept in this browser's local storage under a key of the editor's own.
 *
 * `@supabase/supabase-js` is loaded on demand, as a chunk of its own, and only when the person opens
 * sign-in, when a session is stored, or when the page's address carries a sign-in callback. Whether
 * a session is stored is read from local storage alone, without loading the client, so a signed-out
 * person's editor sends nothing to Supabase and loads none of it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Where the client keeps the session in local storage, and the prefix of its PKCE verifiers. */
export const STORAGE_KEY = "resume-tools-auth";

/**
 * The key the client mirrors the latest sign-in's PKCE code verifier under: what a link without a
 * flow id (`sb_flow_id`) is exchanged with. Links the editor asks for carry their flow id.
 */
export const VERIFIER_KEY = `${STORAGE_KEY}-code-verifier`;

/**
 * The key the client keeps one sign-in's own PKCE code verifier under, by its flow id: each link
 * asked for has a slot of its own, so asking again, or a send that failed, leaves earlier links'.
 */
export function verifierKeyOf(flowId: string): string {
  return `${STORAGE_KEY}-flow-${flowId}-code-verifier`;
}

/** What a flow id looks like, as the client makes and checks them; anything else is none. */
const FLOW_ID = /^[a-zA-Z0-9_-]{8,64}$/;

/** `flowId` when it looks like one the client makes, or none. */
export function flowIdOf(flowId: string | null | undefined): string | undefined {
  return typeof flowId === "string" && FLOW_ID.test(flowId) ? flowId : undefined;
}

/** Where the editor's accounts are: the project's address and its publishable key. */
export interface AccountsConfig {
  url: string;
  key: string;
}

/** The variables the editor reads them from, as Vite gives them. */
export interface AccountsEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

/** The accounts the editor is built with, or none when either variable is unset or empty. */
export function accountsConfig(env: AccountsEnv = import.meta.env): AccountsConfig | undefined {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && key ? { url, key } : undefined;
}

/** Whether the editor has accounts at all; without them it shows no way to sign in. */
export function accountsConfigured(env: AccountsEnv = import.meta.env): boolean {
  return accountsConfig(env) !== undefined;
}

/** The storage the client keeps the session in: local storage in a browser, any such in Node. */
export type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** This browser's local storage, or none where it cannot be reached (a sandbox, a blocked one). */
export function browserStorage(): SessionStorage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** The value kept under `key`, or none when the storage is missing or refuses the read. */
function read(storage: SessionStorage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether a session is kept in `storage`, read without loading the client: the session the client
 * stores under `STORAGE_KEY`, as JSON with a refresh token. An expired access token still counts,
 * since the client refreshes it; one the server no longer takes shows as signed out once loaded.
 */
export function hasStoredSession(storage: SessionStorage | undefined = browserStorage()): boolean {
  const kept = read(storage, STORAGE_KEY);
  if (kept === null) return false;
  try {
    const session: unknown = JSON.parse(kept);
    return (
      typeof session === "object" &&
      session !== null &&
      typeof (session as { refresh_token?: unknown }).refresh_token === "string" &&
      (session as { refresh_token: string }).refresh_token !== ""
    );
  } catch {
    return false;
  }
}

/**
 * Whether this browser asked for the sign-in link with `flowId` and has not used it: the PKCE
 * verifier the client kept for that link, which its code is exchanged with. A link opened where
 * there is none was asked for in another browser, and cannot sign in here; a verifier kept for some
 * other link this browser asked for does not count. Without a flow id, the latest link's verifier.
 */
export function hasStoredVerifier(
  storage: SessionStorage | undefined = browserStorage(),
  flowId?: string,
): boolean {
  return read(storage, flowId === undefined ? VERIFIER_KEY : verifierKeyOf(flowId)) !== null;
}

/**
 * Take the stored session out of `storage`, as the client does when it signs out: what signing out
 * of this browser comes to when the client could not finish it, as when the session's access token
 * has run out and the server cannot be reached to refresh it. Needs no server. Returns whether the
 * session is gone.
 */
export function forgetStoredSession(
  storage: SessionStorage | undefined = browserStorage(),
): boolean {
  try {
    storage?.removeItem(STORAGE_KEY);
    storage?.removeItem(`${STORAGE_KEY}-user`);
  } catch {
    // A storage that refuses the removal keeps the session; the check below says so.
  }
  return !hasStoredSession(storage);
}

/** What makes the client: the browser's, or one with its own storage in Node's tests. */
export interface ClientOptions {
  /** Where the session is kept; local storage when none is given, as in the browser. */
  storage?: SessionStorage;
}

/**
 * Make a client: `@supabase/supabase-js` is imported here, on demand, and nowhere else in the
 * editor. The session is kept and refreshed by the client; the sign-in callback in the address is
 * exchanged by the account (`Account`), not by the client, so that the browser and the tests in Node
 * take the same path and every message about it is the editor's own.
 */
export async function createAccountClient(
  config: AccountsConfig,
  options: ClientOptions = {},
): Promise<SupabaseClient> {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(config.url, config.key, {
    auth: {
      flowType: "pkce",
      storageKey: STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      // Each link leads back with its flow id (`sb_flow_id`), so its code is exchanged with its own
      // verifier, and a link opened where it was not asked for is known by its missing slot.
      experimental: { appendPkceFlowIdToRedirects: true },
      ...(options.storage === undefined ? {} : { storage: options.storage }),
    },
  });
}

/** Loads the client, once; what the account calls, and what DOM tests replace with a fake. */
export type ClientLoader = () => Promise<SupabaseClient>;

let shared: { config: AccountsConfig; client: Promise<SupabaseClient> } | undefined;

/**
 * The editor's one client, made the first time it is asked for and the same after: sign-in, and
 * later the table and Storage (item 7), share its session. A failed load is forgotten, so the next
 * ask tries again.
 */
export function loadClient(
  config: AccountsConfig | undefined = accountsConfig(),
): Promise<SupabaseClient> {
  if (config === undefined) return Promise.reject(new Error("accounts are not configured"));
  if (shared?.config.url === config.url && shared.config.key === config.key) return shared.client;
  const client = createAccountClient(config);
  const made = { config, client };
  shared = made;
  client.catch(() => {
    if (shared === made) shared = undefined;
  });
  return client;
}
