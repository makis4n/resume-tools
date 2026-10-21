// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import Dexie from "dexie";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { AccountEntry } from "./AccountEntry";
import { Account } from "./account";
import { type SessionStorage, STORAGE_KEY, VERIFIER_KEY, verifierKeyOf } from "./client";
import {
  ANOTHER_BROWSER,
  BAD_ADDRESS,
  LINK_EXPIRED,
  LINK_SUPERSEDED,
  NOT_SENT,
  NOT_SIGNED_OUT,
  TOO_MANY,
} from "./messages";
import { TYPE_EMAIL } from "./SignInPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The account's entry in the editor's header, with a fake client in place of Supabase's, which is
// never loaded here: its module is replaced by one that notes being imported and makes nothing.
// Every address and every word is invented; Supabase's own words, which the fake's errors carry,
// must never show.

const real = vi.hoisted(() => ({ imported: false }));
vi.mock("@supabase/supabase-js", () => {
  real.imported = true;
  return {
    createClient: () => {
      throw new Error("the real client is never made in these tests");
    },
  };
});

const URL_ = "http://127.0.0.1:54321";
const KEY = "sb_publishable_invented";
const EMAIL = "someone@example.test";
/** What Supabase's own error text stands for here; it must never reach the page. */
const THEIRS = "SUPABASE OWN WORDS";

const session = (email = EMAIL) =>
  ({
    access_token: "invented.access.token",
    refresh_token: "invented-refresh",
    expires_at: 4102444800,
    expires_in: 3600,
    token_type: "bearer",
    user: { id: "00000000-0000-4000-8000-000000000001", email },
  }) as unknown as Session;

/** Flow ids of two requests for a link, as the client makes them. */
const FLOW = "0123456789abcdef0123456789abcdef";
const OTHER_FLOW = "fedcba9876543210fedcba9876543210";

const authError = (code: string) => ({ name: "AuthApiError", code, status: 400, message: THEIRS });

/** A fake client: what it was asked, and what it answers. */
function fake(
  options: {
    session?: Session;
    sendError?: unknown;
    exchangeError?: unknown;
    email?: string;
    /** Signing out fails as the real client's does when it cannot read the session first. */
    signOutError?: unknown;
  } = {},
) {
  let now: Session | null = options.session ?? null;
  let listener: ((event: string, session: Session | null) => void) | undefined;
  const asked = {
    loads: 0,
    otp: [] as { email: string; options?: { emailRedirectTo?: string } }[],
    exchanged: [] as string[],
    exchangedWith: [] as unknown[],
    signOuts: [] as unknown[],
  };
  const auth = {
    initialize: async () => ({ error: null }),
    getSession: async () => ({ data: { session: now }, error: null }),
    onAuthStateChange: (callback: typeof listener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    signInWithOtp: async (args: (typeof asked.otp)[number]) => {
      asked.otp.push(args);
      return { data: {}, error: options.sendError ?? null };
    },
    exchangeCodeForSession: async (code: string, with_?: unknown) => {
      asked.exchanged.push(code);
      asked.exchangedWith.push(with_);
      if (options.exchangeError !== undefined)
        return { data: { session: null, user: null }, error: options.exchangeError };
      now = session(options.email);
      listener?.("SIGNED_IN", now);
      return { data: { session: now, user: now.user }, error: null };
    },
    signOut: async (args: unknown) => {
      asked.signOuts.push(args);
      // As the real client: when it could not read the session (its access token ran out and the
      // server cannot be reached), it says so and leaves the session where it is stored; it reads
      // as none, all the same, since it cannot be refreshed.
      if (options.signOutError !== undefined) {
        now = null;
        return { error: options.signOutError };
      }
      localStorage.removeItem(STORAGE_KEY);
      now = null;
      listener?.("SIGNED_OUT", null);
      return { error: null };
    },
  };
  const client = { auth } as unknown as SupabaseClient;
  const load = async () => {
    asked.loads++;
    return client;
  };
  return { asked, load };
}

let host: HTMLElement;
let root: Root;
let fetched: string[];

beforeEach(() => {
  real.imported = false;
  fetched = [];
  // The editor's own requests answer nothing; any request at all is noted.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    fetched.push(String(input instanceof Request ? input.url : input));
    return new Response(null, { status: 404 });
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  await Dexie.delete("resume-tools");
});

const settle = async () => {
  for (let i = 0; i < 20; i++) await act(async () => new Promise((done) => setTimeout(done, 2)));
};

const button = (text: string) =>
  [...host.querySelectorAll("button")].find((each) => each.textContent === text);

const click = async (text: string) => {
  const found = button(text);
  if (found === undefined) throw new Error(`no button "${text}"`);
  await act(async () => found.click());
  await settle();
};

/** Type into the email field and ask for the link. */
const sendTo = async (email: string) => {
  const input = host.querySelector<HTMLInputElement>('input[type="email"]');
  if (input === null) throw new Error("no email field");
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(input, email);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Email me a link");
};

const toSupabase = () => fetched.filter((url) => url.startsWith(URL_));

/** Render the account's entry alone, on `account`. */
const entry = async (account: Account) => {
  act(() => root.render(<AccountEntry account={account} />));
  await settle();
};

describe("a signed-out editor", () => {
  it("has no account entry, loads nothing and asks Supabase nothing, without accounts", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    act(() => root.render(<App />));
    await settle();
    expect(button("Sign in")).toBeUndefined();
    expect(host.querySelector("header")).toBeNull();
    expect(real.imported).toBe(false);
    expect(toSupabase()).toEqual([]);
    expect(fetched.every((url) => url.startsWith("/engine/"))).toBe(true);
  });

  it("offers sign-in but loads no client and asks Supabase nothing, with accounts", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", URL_);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", KEY);
    act(() => root.render(<App />));
    await settle();
    expect(button("Sign in")).toBeDefined();
    expect(real.imported).toBe(false);
    expect(toSupabase()).toEqual([]);
    expect(fetched.every((url) => url.startsWith("/engine/"))).toBe(true);
  });

  it("never calls the loader until sign-in is opened, which loads the client", async () => {
    const { asked, load } = fake();
    act(() => root.render(<App account={new Account({ load })} />));
    await settle();
    expect(asked.loads).toBe(0);
    await click("Sign in");
    expect(asked.loads).toBe(1);
    expect(host.querySelector('input[type="email"]')).not.toBeNull();
    expect(real.imported).toBe(false);
  });
});

describe("the email link", () => {
  it("is sent to the address typed, back to this page, and says to check that email", async () => {
    window.history.replaceState(null, "", "/editor/?measure=none#top");
    const { asked, load } = fake();
    await entry(new Account({ load }));
    await click("Sign in");
    await sendTo(` ${EMAIL} `);
    expect(asked.otp).toEqual([
      { email: EMAIL, options: { emailRedirectTo: `${window.location.origin}/editor/` } },
    ]);
    expect(host.textContent).toContain("Check your email");
    expect(host.querySelector("strong")?.textContent).toBe(EMAIL);
    // Another address can be typed after.
    await click("Use another email");
    expect(button("Email me a link")).toBeDefined();
  });

  it("asks for an address, and refuses one that is not one, before sending anything", async () => {
    const { asked, load } = fake();
    await entry(new Account({ load }));
    await click("Sign in");
    await sendTo("");
    expect(host.textContent).toContain(TYPE_EMAIL);
    await sendTo("not an address");
    expect(host.textContent).toContain(BAD_ADDRESS);
    expect(asked.otp).toEqual([]);
  });

  it("says what went wrong in the editor's words, never Supabase's", async () => {
    const limited = fake({ sendError: authError("over_email_send_rate_limit") });
    await entry(new Account({ load: limited.load }));
    await click("Sign in");
    await sendTo(EMAIL);
    expect(host.textContent).toContain(TOO_MANY);
    expect(host.textContent).not.toContain("Check your email");
    expect(host.textContent).not.toContain(THEIRS);
  });

  it("says a link could not be sent for a reason it does not know", async () => {
    const odd = fake({ sendError: authError("something_new") });
    await entry(new Account({ load: odd.load }));
    await click("Sign in");
    await sendTo(EMAIL);
    expect(host.textContent).toContain(NOT_SENT);
    expect(host.textContent).not.toContain(THEIRS);
  });

  it("closes, and opens again as it was", async () => {
    const { load } = fake();
    await entry(new Account({ load }));
    await click("Sign in");
    await click("Close");
    expect(host.querySelector('input[type="email"]')).toBeNull();
    expect(button("Sign in")).toBeDefined();
  });
});

describe("coming back from a link", () => {
  it("signs in with the code, where this browser asked for it, and takes it out of the address", async () => {
    localStorage.setItem(verifierKeyOf(FLOW), JSON.stringify("invented-verifier"));
    window.history.replaceState(null, "", `/?code=invented-code&sb_flow_id=${FLOW}`);
    const { asked, load } = fake();
    await entry(new Account({ load }));
    expect(asked.exchanged).toEqual(["invented-code"]);
    // With that request's own verifier, not whichever link this browser asked for last.
    expect(asked.exchangedWith).toEqual([{ flowId: FLOW }]);
    expect(host.textContent).toContain(`Signed in as ${EMAIL}`);
    expect(window.location.search).toBe("");
  });

  it("says a link opened in another browser cannot sign in here, and offers a new one", async () => {
    window.history.replaceState(null, "", "/?code=invented-code");
    const { asked, load } = fake();
    await entry(new Account({ load }));
    expect(host.textContent).toContain(ANOTHER_BROWSER);
    expect(button("Email me a link")).toBeDefined();
    expect(asked.exchanged).toEqual([]);
    expect(window.location.search).toBe("");
    // A new link sent from here clears the message.
    await sendTo(EMAIL);
    expect(host.textContent).toContain("Check your email");
    expect(host.textContent).not.toContain(ANOTHER_BROWSER);
  });

  it("says another browser's link cannot sign in here, though this browser asked for one of its own", async () => {
    // This browser asked for a link once and kept its verifier; the link opened is another's.
    localStorage.setItem(VERIFIER_KEY, JSON.stringify("invented-verifier"));
    localStorage.setItem(verifierKeyOf(OTHER_FLOW), JSON.stringify("invented-verifier"));
    window.history.replaceState(null, "", `/?code=invented-code&sb_flow_id=${FLOW}`);
    const { asked, load } = fake();
    await entry(new Account({ load }));
    expect(host.textContent).toContain(ANOTHER_BROWSER);
    expect(host.textContent).not.toContain(LINK_SUPERSEDED);
    expect(asked.exchanged).toEqual([]);
    expect(window.location.search).toBe("");
  });

  it("says a link that came back with an error has expired, never in Supabase's words", async () => {
    const words = encodeURIComponent(THEIRS);
    window.history.replaceState(
      null,
      "",
      `/?error=access_denied&error_code=otp_expired&error_description=${words}#error=access_denied&error_code=otp_expired&error_description=${words}`,
    );
    const { asked, load } = fake();
    await entry(new Account({ load }));
    expect(host.textContent).toContain(LINK_EXPIRED);
    expect(host.textContent).not.toContain(THEIRS);
    expect(asked.exchanged).toEqual([]);
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("says a link from an earlier request cannot sign in, by the exchange's code", async () => {
    localStorage.setItem(VERIFIER_KEY, JSON.stringify("invented-verifier"));
    window.history.replaceState(null, "", "/?code=invented-code");
    const { load } = fake({ exchangeError: authError("bad_code_verifier") });
    await entry(new Account({ load }));
    expect(host.textContent).toContain(LINK_SUPERSEDED);
    expect(host.textContent).not.toContain(THEIRS);
    expect(button("Email me a link")).toBeDefined();
    expect(window.location.search).toBe("");
  });
});

describe("a stored session", () => {
  it("loads the client at once, shows the account's email, and signs out of this browser", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session()));
    const { asked, load } = fake({ session: session() });
    await entry(new Account({ load }));
    expect(asked.loads).toBe(1);
    expect(host.textContent).toContain(`Signed in as ${EMAIL}`);
    expect(button("Sign in")).toBeUndefined();
    await click("Sign out");
    expect(asked.signOuts).toEqual([{ scope: "local" }]);
    expect(button("Sign in")).toBeDefined();
    expect(host.textContent).not.toContain(EMAIL);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("signs out of this browser when the server cannot be reached to refresh the session", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session()));
    const { load } = fake({
      session: session(),
      signOutError: { name: "AuthRetryableFetchError", status: 0, message: THEIRS },
    });
    await entry(new Account({ load }));
    await click("Sign out");
    // The session the client left is taken out here, so the next load does not sign in again.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(button("Sign in")).toBeDefined();
    expect(host.textContent).not.toContain(EMAIL);
    expect(host.textContent).not.toContain(THEIRS);
  });

  it("says signing out did not finish while the session is still stored here", async () => {
    const kept = new Map([[STORAGE_KEY, JSON.stringify(session())]]);
    const stubborn: SessionStorage = {
      getItem: (key) => kept.get(key) ?? null,
      setItem: (key, value) => void kept.set(key, value),
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const { load } = fake({
      session: session(),
      signOutError: { name: "AuthRetryableFetchError", status: 0, message: THEIRS },
    });
    await entry(new Account({ load, storage: stubborn }));
    await click("Sign out");
    expect(host.textContent).toContain(NOT_SIGNED_OUT);
    expect(host.textContent).toContain(`Signed in as ${EMAIL}`);
    expect(host.textContent).not.toContain(THEIRS);
  });
});
