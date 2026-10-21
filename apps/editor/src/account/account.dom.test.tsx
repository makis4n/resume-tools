// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import Dexie from "dexie";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { DocumentStore } from "../storage/store";
import { curated } from "../templates/curated";
import { AccountEntry } from "./AccountEntry";
import { Account, RECOVERING_KEY } from "./account";
import { type SessionStorage, STORAGE_KEY, VERIFIER_KEY, verifierKeyOf } from "./client";
import {
  ANOTHER_BROWSER,
  BAD_ADDRESS,
  CONFIRM_FIRST,
  LINK_EXPIRED,
  LINK_SUPERSEDED,
  NOT_SENT,
  NOT_SIGNED_OUT,
  PASSWORD_HINT,
  PASSWORD_RULE,
  SAME_PASSWORD,
  SIGNED_IN_TOO_LONG_AGO,
  TOO_MANY,
  unsentNotice,
  WRONG_CURRENT,
  WRONG_PASSWORD,
} from "./messages";
import { PASSWORD_SET } from "./NewPassword";
import { MAKE_ACCOUNT_NOTE, TYPE_EMAIL, TYPE_PASSWORD } from "./SignInPanel";

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

// The account's server for the sync queue (item 7), replaced by one that counts how often it is
// made and answers as an empty account would, or as one that cannot be reached.
const servers = vi.hoisted(() => ({ made: 0, unreachable: false, inserted: [] as string[] }));
vi.mock("../storage/supabase-server", async () => {
  const { ServerUnavailable } = await import("../storage/server");
  return {
    SupabaseServer: class {
      constructor() {
        servers.made++;
      }
      async list() {
        return [];
      }
      async get() {
        return null;
      }
      async insert({ id }: { id: string }) {
        if (servers.unreachable) throw new ServerUnavailable();
        servers.inserted.push(id);
        return { ok: true, revision: 1, updatedAt: Date.now() };
      }
      async update() {
        if (servers.unreachable) throw new ServerUnavailable();
        return { ok: true, revision: 2, updatedAt: Date.now() };
      }
      async remove() {}
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

/** An invented password that keeps the rule, the fake account's own. */
const PASSWORD = "invented-pass-1";

/** A fake client: what it was asked, and what it answers. */
function fake(
  options: {
    session?: Session;
    sendError?: unknown;
    exchangeError?: unknown;
    email?: string;
    /** Signing out fails as the real client's does when it cannot read the session first. */
    signOutError?: unknown;
    /** The account's password, which signing in with a password checks. */
    password?: string;
    signUpError?: unknown;
    /** Signing in with a password fails with this, whatever the password. */
    signInError?: unknown;
    resetError?: unknown;
    updateError?: unknown;
    /** The code comes from a reset link: its exchange tells `PASSWORD_RECOVERY`. */
    recovery?: boolean;
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
    signUps: [] as { email: string; password: string; options?: { emailRedirectTo?: string } }[],
    signIns: [] as { email: string; password: string }[],
    resets: [] as { email: string; options?: { redirectTo?: string } }[],
    updates: [] as { password?: string }[],
  };
  const password = options.password ?? PASSWORD;
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
      listener?.(options.recovery ? "PASSWORD_RECOVERY" : "SIGNED_IN", now);
      return { data: { session: now, user: now.user }, error: null };
    },
    signUp: async (args: (typeof asked.signUps)[number]) => {
      asked.signUps.push(args);
      return { data: { user: null, session: null }, error: options.signUpError ?? null };
    },
    signInWithPassword: async (args: (typeof asked.signIns)[number]) => {
      asked.signIns.push(args);
      const error =
        options.signInError ??
        (args.password === password ? null : authError("invalid_credentials"));
      if (error !== null) return { data: { user: null, session: null }, error };
      now = session(args.email);
      listener?.("SIGNED_IN", now);
      return { data: { session: now, user: now.user }, error: null };
    },
    resetPasswordForEmail: async (email: string, with_?: { redirectTo?: string }) => {
      asked.resets.push({ email, ...(with_ === undefined ? {} : { options: with_ }) });
      return { data: options.resetError ? null : {}, error: options.resetError ?? null };
    },
    updateUser: async (args: { password?: string }) => {
      asked.updates.push(args);
      if (options.updateError !== undefined)
        return { data: { user: null }, error: options.updateError };
      listener?.("USER_UPDATED", now);
      return { data: { user: now?.user ?? null }, error: null };
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
  servers.made = 0;
  servers.unreachable = false;
  servers.inserted = [];
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

/** The input in the label whose words start with `label`, or in the password form's email. */
const field = (label: string) => {
  const found = [...host.querySelectorAll("label")].find((each) =>
    each.textContent?.trim().startsWith(label),
  );
  const input = found?.querySelector("input");
  if (!input) throw new Error(`no field "${label}"`);
  return input;
};

const typeInto = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

/** The email field of the password way in, not the email link's. */
const passwordEmail = () => {
  const input = host.querySelector<HTMLInputElement>('input[name="password-email"]');
  if (input === null) throw new Error("no password email field");
  return input;
};

/** Fill the password way in and press its button. */
const withPassword = async (email: string, password: string | undefined, press: string) => {
  await typeInto(passwordEmail(), email);
  if (password !== undefined) await typeInto(field("Password"), password);
  await click(press);
};

/** A password one byte over the 72 bytes bcrypt reads: 36 characters of two bytes each, and one. */
const TOO_LONG = `${"é".repeat(36)}a`;

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

describe("the email and password", () => {
  it("makes an account by email alone, back to this page, and asks for the password after the link", async () => {
    window.history.replaceState(null, "", "/editor/?x=1");
    const { asked, load } = fake();
    await entry(new Account({ load }));
    await click("Sign in");
    // Signing in states no rule; making an account takes no password before the link (0099).
    expect(host.textContent).not.toContain(PASSWORD_HINT);
    await click("Make an account");
    expect(host.textContent).toContain(MAKE_ACCOUNT_NOTE);
    expect(host.querySelector('input[type="password"]')).toBeNull();

    await withPassword("", undefined, "Make account");
    expect(host.textContent).toContain(TYPE_EMAIL);
    await withPassword("not an address", undefined, "Make account");
    expect(host.textContent).toContain(BAD_ADDRESS);
    expect(asked.otp).toEqual([]);

    await withPassword(` ${EMAIL} `, undefined, "Make account");
    expect(asked.otp).toEqual([
      {
        email: EMAIL,
        options: {
          emailRedirectTo: `${window.location.origin}/editor/?then=password`,
          shouldCreateUser: true,
        },
      },
    ]);
    // No password is ever sent to sign up with: one set before the address is confirmed is not kept.
    expect(asked.signUps).toEqual([]);
    expect(host.textContent).toContain("Check your email to confirm");
    expect(host.querySelector("[role=status] strong")?.textContent).toBe(EMAIL);
    expect(host.textContent).toContain("choose your password");
    expect(host.textContent).not.toContain(THEIRS);
  });

  it("says an email that could not be sent, and never that it was", async () => {
    const limited = fake({
      sendError: authError("over_email_send_rate_limit"),
      resetError: authError("over_email_send_rate_limit"),
    });
    await entry(new Account({ load: limited.load }));
    await click("Sign in");
    await click("Make an account");
    await withPassword(EMAIL, undefined, "Make account");
    expect(host.querySelector("[role=alert]")?.textContent).toBe(TOO_MANY);
    expect(host.textContent).not.toContain("Check your email");

    await click("Forgot your password?");
    await withPassword(EMAIL, undefined, "Email me a reset link");
    expect(host.querySelector("[role=alert]")?.textContent).toBe(TOO_MANY);
    expect(host.textContent).not.toContain("If there is an account");
    expect(host.textContent).not.toContain(THEIRS);
  });

  it("signs in with the password, and closes", async () => {
    const { asked, load } = fake();
    await entry(new Account({ load }));
    await click("Sign in");
    expect(field("Password").getAttribute("autocomplete")).toBe("current-password");
    await withPassword(EMAIL, PASSWORD, "Sign in");
    expect(asked.signIns).toEqual([{ email: EMAIL, password: PASSWORD }]);
    expect(host.textContent).toContain(`Signed in as ${EMAIL}`);
    expect(passwordEmailGone()).toBe(true);
  });

  it("gives one message for a wrong password, a missing account and a short password", async () => {
    const { asked, load } = fake();
    await entry(new Account({ load }));
    await click("Sign in");
    await withPassword(EMAIL, "wrong-password-1", "Sign in");
    const wrong = host.querySelector("[role=alert]")?.textContent;
    expect(wrong).toBe(WRONG_PASSWORD);
    // A password shorter than any account's gets the same, and asks nothing.
    await withPassword(EMAIL, "short", "Sign in");
    expect(host.querySelector("[role=alert]")?.textContent).toBe(WRONG_PASSWORD);
    expect(asked.signIns).toHaveLength(1);
    expect(host.textContent).not.toContain(THEIRS);
  });

  it("asks an unconfirmed address with the right password to confirm it first", async () => {
    const { load } = fake({ signInError: authError("email_not_confirmed") });
    await entry(new Account({ load }));
    await click("Sign in");
    await withPassword(EMAIL, PASSWORD, "Sign in");
    expect(host.textContent).toContain(CONFIRM_FIRST);
    expect(host.textContent).not.toContain(THEIRS);
  });

  it("sends a reset link back to this page and says the same whether or not there is an account", async () => {
    window.history.replaceState(null, "", "/editor/");
    const { asked, load } = fake();
    await entry(new Account({ load }));
    await click("Sign in");
    await click("Forgot your password?");
    expect(host.querySelector('input[type="password"]')).toBeNull();
    await withPassword(EMAIL, undefined, "Email me a reset link");
    expect(asked.resets).toEqual([
      { email: EMAIL, options: { redirectTo: `${window.location.origin}/editor/` } },
    ]);
    const reply = host.querySelector("[role=status]")?.textContent;
    expect(reply).toContain("If there is an account for");
    expect(reply).toContain(EMAIL);
  });

  it("says a reset link could not be sent in the editor's words", async () => {
    const { load } = fake({ resetError: authError("something_new") });
    await entry(new Account({ load }));
    await click("Sign in");
    await click("Forgot your password?");
    await withPassword(EMAIL, undefined, "Email me a reset link");
    expect(host.textContent).toContain(NOT_SENT);
    expect(host.textContent).not.toContain(THEIRS);
  });
});

/** Whether the sign-in panel's password form is gone. */
function passwordEmailGone(): boolean {
  return host.querySelector('input[name="password-email"]') === null;
}

describe("the recovery state", () => {
  const openReset = async (options: Parameters<typeof fake>[0] = {}) => {
    localStorage.setItem(verifierKeyOf(FLOW), JSON.stringify("invented-verifier/recovery"));
    window.history.replaceState(null, "", `/?code=invented-code&sb_flow_id=${FLOW}`);
    const made = fake({ recovery: true, ...options });
    await entry(new Account({ load: made.load }));
    return made;
  };

  it("opens from a reset link, states the rule, and sets a new password, signed in", async () => {
    const { asked } = await openReset();
    expect(asked.exchanged).toEqual(["invented-code"]);
    expect(window.location.search).toBe("");
    expect(host.textContent).toContain("Set a new password");
    expect(host.textContent).toContain(PASSWORD_HINT);
    expect(button("Change password")).toBeUndefined();

    await typeInto(field("New password"), "short");
    await click("Save password");
    expect(host.textContent).toContain(PASSWORD_RULE);
    await typeInto(field("New password"), TOO_LONG);
    await click("Save password");
    expect(host.textContent).toContain(PASSWORD_RULE);
    expect(asked.updates).toEqual([]);

    await typeInto(field("New password"), "a-new-invented-1");
    await click("Save password");
    expect(asked.updates).toEqual([{ password: "a-new-invented-1" }]);
    expect(host.textContent).not.toContain("Set a new password");
    expect(host.textContent).toContain(PASSWORD_SET);
    expect(host.textContent).toContain(`Signed in as ${EMAIL}`);
    expect(button("Change password")).toBeDefined();
  });

  it("says the server's refusal in the editor's words, and stays to try again", async () => {
    const { asked } = await openReset({ updateError: authError("same_password") });
    await typeInto(field("New password"), PASSWORD);
    await click("Save password");
    expect(asked.updates).toHaveLength(1);
    expect(host.textContent).toContain(SAME_PASSWORD);
    expect(host.textContent).not.toContain(THEIRS);
    expect(host.textContent).toContain("Set a new password");
  });

  it("can be left for now, signed in", async () => {
    const { asked } = await openReset();
    await click("Not now");
    expect(asked.updates).toEqual([]);
    expect(host.textContent).not.toContain("Set a new password");
    expect(host.textContent).toContain(`Signed in as ${EMAIL}`);
  });

  it("maps the server's refusal of a password, and of an old session, to the editor's words", async () => {
    await openReset({ updateError: authError("weak_password") });
    await typeInto(field("New password"), "a-new-invented-1");
    await click("Save password");
    expect(host.textContent).toContain(PASSWORD_RULE);

    act(() => root.unmount());
    root = createRoot(host);
    await openReset({ updateError: authError("reauthentication_needed") });
    await typeInto(field("New password"), "a-new-invented-1");
    await click("Save password");
    expect(host.textContent).toContain(SIGNED_IN_TOO_LONG_AGO);
    expect(host.textContent).not.toContain(THEIRS);
  });

  /** Load the page again in this browser, with the session still stored and nothing in the address. */
  const reload = async (options: Parameters<typeof fake>[0] = {}) => {
    act(() => root.unmount());
    root = createRoot(host);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session()));
    window.history.replaceState(null, "", "/");
    const made = fake({ session: session(), ...options });
    await entry(new Account({ load: made.load }));
    return made;
  };

  it("comes back after a reload until the new password is set, and not after", async () => {
    await openReset();
    expect(host.textContent).toContain("Set a new password");
    const { asked } = await reload();
    expect(host.textContent).toContain("Set a new password");
    expect(button("Change password")).toBeUndefined();
    await typeInto(field("New password"), "a-new-invented-1");
    await click("Save password");
    expect(asked.updates).toEqual([{ password: "a-new-invented-1" }]);
    await reload();
    expect(host.textContent).not.toContain("Set a new password");
    expect(button("Change password")).toBeDefined();
  });

  it("comes back after a reload until it is left for now, and only for the same account", async () => {
    await openReset();
    await reload();
    expect(host.textContent).toContain("Set a new password");
    await click("Not now");
    await reload();
    expect(host.textContent).not.toContain("Set a new password");

    // Kept for one account, it does not open for another signed in on this browser.
    await openReset();
    await reload({ session: session("another@example.test") });
    expect(host.textContent).not.toContain("Set a new password");
  });

  it("is forgotten on signing out", async () => {
    await openReset();
    await click("Sign out");
    expect(localStorage.getItem(RECOVERING_KEY)).toBeNull();
  });
});

describe("choosing the first password, after making an account", () => {
  const openMade = async (options: Parameters<typeof fake>[0] = {}) => {
    localStorage.setItem(verifierKeyOf(FLOW), JSON.stringify("invented-verifier"));
    window.history.replaceState(null, "", `/?code=invented-code&sb_flow_id=${FLOW}&then=password`);
    const made = fake(options);
    await entry(new Account({ load: made.load }));
    return made;
  };

  it("opens from the link, states the rule, refuses one that breaks it unsent, and saves one", async () => {
    const { asked } = await openMade();
    expect(asked.exchanged).toEqual(["invented-code"]);
    expect(window.location.search).toBe("");
    expect(host.textContent).toContain("Choose your password");
    expect(host.textContent).toContain(PASSWORD_HINT);
    const input = field("Password");
    expect(input.getAttribute("autocomplete")).toBe("new-password");
    const hint = document.getElementById(input.getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent).toBe(PASSWORD_HINT);

    await typeInto(field("Password"), "seven77");
    await click("Save password");
    expect(host.textContent).toContain(PASSWORD_RULE);
    // 37 characters, but 73 bytes: too long for bcrypt, so refused.
    await typeInto(field("Password"), TOO_LONG);
    await click("Save password");
    expect(host.textContent).toContain(PASSWORD_RULE);
    await typeInto(field("Password"), "");
    await click("Save password");
    expect(host.textContent).toContain(TYPE_PASSWORD);
    expect(asked.updates).toEqual([]);

    // 72 bytes is the most, and 8 characters the fewest, however many bytes they take.
    await typeInto(field("Password"), "é".repeat(36));
    await click("Save password");
    expect(asked.updates).toEqual([{ password: "é".repeat(36) }]);
    expect(host.textContent).not.toContain("Choose your password");
    expect(host.textContent).toContain(`Signed in as ${EMAIL}`);
  });

  it("takes 8 characters however many bytes they take, and comes back after a reload", async () => {
    await openMade();
    act(() => root.unmount());
    root = createRoot(host);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session()));
    window.history.replaceState(null, "", "/");
    const again = fake({ session: session() });
    await entry(new Account({ load: again.load }));
    expect(host.textContent).toContain("Choose your password");
    await typeInto(field("Password"), "ééééàààà");
    await click("Save password");
    expect(again.asked.updates).toEqual([{ password: "ééééàààà" }]);
  });

  it("asks for no password after an ordinary email link", async () => {
    localStorage.setItem(verifierKeyOf(FLOW), JSON.stringify("invented-verifier"));
    window.history.replaceState(null, "", `/?code=invented-code&sb_flow_id=${FLOW}`);
    const { load } = fake();
    await entry(new Account({ load }));
    expect(host.textContent).toContain(`Signed in as ${EMAIL}`);
    expect(host.textContent).not.toContain("Choose your password");
  });

  it("asks for no password when the link could not sign in", async () => {
    const { asked } = await openMade({ exchangeError: authError("otp_expired") });
    expect(asked.exchanged).toEqual(["invented-code"]);
    expect(host.textContent).toContain(LINK_EXPIRED);
    expect(host.textContent).not.toContain("Choose your password");
    expect(window.location.search).toBe("");
  });
});

describe("changing the password while signed in", () => {
  const signedIn = async (options: Parameters<typeof fake>[0] = {}) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session()));
    const made = fake({ session: session(), ...options });
    await entry(new Account({ load: made.load }));
    await click("Change password");
    return made;
  };

  const change = async (current: string, next: string) => {
    await typeInto(field("Current password"), current);
    await typeInto(field("New password"), next);
    await click("Change password");
  };

  it("checks the current password first, then sets the new one", async () => {
    const { asked } = await signedIn();
    expect(host.textContent).toContain(PASSWORD_HINT);
    await change(PASSWORD, "a-new-invented-1");
    expect(asked.signIns).toEqual([{ email: EMAIL, password: PASSWORD }]);
    expect(asked.updates).toEqual([{ password: "a-new-invented-1" }]);
    expect(host.textContent).toContain(PASSWORD_SET);
  });

  it("changes nothing with a wrong current password, and says so", async () => {
    const { asked } = await signedIn();
    await change("not-the-password", "a-new-invented-1");
    expect(asked.signIns).toHaveLength(1);
    expect(asked.updates).toEqual([]);
    expect(host.textContent).toContain(WRONG_CURRENT);
    expect(host.textContent).not.toContain(THEIRS);
    expect(host.textContent).toContain(`Signed in as ${EMAIL}`);
  });

  it("refuses a new password that breaks the rule before asking anything", async () => {
    const { asked } = await signedIn();
    await change(PASSWORD, "short");
    expect(host.textContent).toContain(PASSWORD_RULE);
    await change(PASSWORD, TOO_LONG);
    expect(host.textContent).toContain(PASSWORD_RULE);
    expect(asked.signIns).toEqual([]);
    expect(asked.updates).toEqual([]);
  });

  it("emails a link to set one, for an account without a password or one forgotten", async () => {
    const { asked } = await signedIn();
    await click("Email me a link to set one");
    expect(asked.resets.map((each) => each.email)).toEqual([EMAIL]);
    expect(host.textContent).toContain(`We sent a link to set a new password to ${EMAIL}`);
  });
});

describe("the account's documents (item 7)", () => {
  const USER = session().user.id;

  it("makes no server for a signed-out page, with or without the account's client", async () => {
    const { asked, load } = fake();
    act(() => root.render(<App account={new Account({ load })} />));
    await settle();
    expect(servers.made).toBe(0);
    expect(asked.loads).toBe(0);
    // Sign-in opened loads the client; still signed out, nothing is synced.
    await click("Sign in");
    expect(asked.loads).toBe(1);
    expect(servers.made).toBe(0);
    expect(toSupabase()).toEqual([]);
    expect(real.imported).toBe(false);
  });

  it("syncs a signed-in page's documents through one server, as the account's user", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session()));
    const store = new DocumentStore();
    store.setAccount(USER);
    // Told what saving to the account sends, on an earlier visit (item 9).
    await store.markTold(USER);
    const id = await store.create("jake", curated("jake").sample);
    await store.close();
    const account = new Account({ load: fake({ session: session() }).load });
    act(() => root.render(<App account={account} />));
    await settle();
    expect(account.userId()).toBe(USER);
    expect(servers.made).toBe(1);
    expect(servers.inserted).toEqual([id]);
  });

  it("signs out only once what is pending is sent, and names what could not be", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session()));
    const store = new DocumentStore();
    store.setAccount(USER);
    // Told what saving to the account sends, on an earlier visit (item 9).
    await store.markTold(USER);
    const id = await store.create("jake", curated("jake").sample);
    const title = (await store.syncRow(id))?.title ?? "";
    await store.close();
    servers.unreachable = true;
    const { asked, load } = fake({ session: session() });
    act(() => root.render(<App account={new Account({ load })} />));
    await settle();
    await click("Sign out");
    expect(host.textContent).toContain(unsentNotice([{ title }]));
    expect(host.textContent).toContain(`Signed in as ${EMAIL}`);
    expect(asked.signOuts).toEqual([]);

    // Back online: it is sent, the account's documents leave this browser, and it signs out.
    servers.unreachable = false;
    await click("Sign out");
    expect(servers.inserted).toEqual([id]);
    expect(asked.signOuts).toEqual([{ scope: "local" }]);
    expect(button("Sign in")).toBeDefined();
    const after = new DocumentStore();
    expect(await after.syncRows()).toEqual([]);
    await after.close();
  });
});
