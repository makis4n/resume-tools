import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Account, type Place } from "./account";
import { createAccountClient, hasStoredSession, type SessionStorage } from "./client";
import {
  CONFIRM_FIRST,
  messageFor,
  PASSWORD_RULE,
  SAME_PASSWORD,
  TOO_MANY,
  WRONG_CURRENT,
  WRONG_PASSWORD,
} from "./messages";

// Signing up and in with a password on the local Supabase stack (milestone 4 item 5, decisions
// 0094, 0096 and 0099), with the editor's own client and account in Node, as the email link's test
// does: a browser is a client and an account on a storage of its own, the page's address a string.
// Confirmation and reset links are read from Mailpit and followed without their redirect, and the
// code in the address they lead to is exchanged as the page would on load. Every address and
// password is invented. Skips without the stack (`test:integration`).

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const mailpit = process.env.MAILPIT_URL;

/** Where the dev server serves the editor, which `site_url` allows links back to. */
const EDITOR = "http://localhost:5173/";

const CONFIRM = "Confirm your email for the resume editor";
const SIGN_IN = "Your link to sign in to the resume editor";
const RESET = "Set a new password for the resume editor";

/** A storage in memory, standing for one browser's local storage. */
function memory(): SessionStorage {
  const kept = new Map<string, string>();
  return {
    getItem: (name) => kept.get(name) ?? null,
    setItem: (name, value) => void kept.set(name, value),
    removeItem: (name) => void kept.delete(name),
  };
}

/** A page's address, which the account reads and replaces. */
function placeAt(href: string): Place & { now(): string } {
  let at = href;
  return { href: () => at, replace: (next) => void (at = next), now: () => at };
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe.skipIf(!url || !key || !mailpit)("signing in with a password on the local stack", () => {
  const config = { url: url ?? "", key: key ?? "" };
  const invent = (name: string) =>
    `${name}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
  const email = invent("password");
  const missing = invent("missing");
  const unconfirmed = invent("unconfirmed");
  const changer = invent("changer");
  const fresh = invent("fresh");
  const victim = invent("victim");
  const victim2 = invent("victim");
  const stranger = invent("stranger");
  const addresses = [email, missing, unconfirmed, changer, fresh, victim, victim2, stranger];
  const FIRST = "invented-first-pass";
  const SECOND = "invented-second-pass";
  const THIRD = "invented-third-pass";
  const THEIRS = "invented-someone-elses-pass";
  const clients: SupabaseClient[] = [];

  /** One browser: its storage, and a page loaded at `href` with a client of its own. */
  async function browser(storage: SessionStorage, href = EDITOR) {
    const client = await createAccountClient(config, { storage });
    clients.push(client);
    const place = placeAt(href);
    const account = new Account({ load: async () => client, storage, place });
    return { client, place, account };
  }

  const search = (to: string) =>
    `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`;

  /** Mailpit's messages to the address, newest first. */
  async function mail(to: string): Promise<{ ID: string; Subject: string }[]> {
    const found = await fetch(search(to));
    expect(found.ok).toBe(true);
    return ((await found.json()) as { messages: { ID: string; Subject: string }[] }).messages;
  }

  const clearTo = async (to: string) => {
    await fetch(search(to), { method: "DELETE" });
  };
  const clear = async () => {
    for (const to of addresses) await clearTo(to);
  };

  /**
   * The link in the newest email to `to` with one of `subjects`, waited for; its emails are then
   * deleted.
   */
  async function linkIn(subjects: string | string[], to: string): Promise<string> {
    const wanted = typeof subjects === "string" ? [subjects] : subjects;
    for (let tries = 0; tries < 50; tries++) {
      const message = (await mail(to)).find((each) => wanted.includes(each.Subject));
      if (message !== undefined) {
        const read = await fetch(`${mailpit}/api/v1/message/${message.ID}`);
        const { HTML } = (await read.json()) as { HTML: string };
        await clearTo(to);
        const href = /href="([^"]*\/auth\/v1\/verify[^"]*)"/.exec(HTML)?.[1];
        if (href === undefined) throw new Error("the email holds no link");
        return href.replaceAll("&amp;", "&");
      }
      await pause(200);
    }
    throw new Error(`no email "${wanted.join('" or "')}" reached Mailpit`);
  }

  /** Follow a link as the browser would, up to the editor's address it leads back to. */
  async function follow(link: string): Promise<string> {
    const response = await fetch(link, { redirect: "manual" });
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    const location = response.headers.get("location") ?? "";
    expect(location.startsWith(EDITOR)).toBe(true);
    expect(new URL(location).searchParams.get("code")).toBeTruthy();
    expect(new URL(location).searchParams.get("sb_flow_id")).toBeTruthy();
    return location;
  }

  /** The account once it has read the page's address and storage. */
  async function settled(account: Account) {
    account.start();
    for (let tries = 0; tries < 100 && account.state().status === "checking"; tries++)
      await pause(50);
    return account.state();
  }

  /**
   * Make an account for `to` in the editor, follow the emailed link, choose `password` there, and
   * sign out. `subjects` is the email the link comes in: a confirmation for an address not yet
   * confirmed.
   */
  async function makeAccount(to: string, password: string, subjects: string | string[] = CONFIRM) {
    const storage = memory();
    const asking = await browser(storage);
    expect(await asking.account.signUp(to)).toBeUndefined();
    const page = await browser(storage, await follow(await linkIn(subjects, to)));
    expect(await settled(page.account)).toEqual({ status: "recovering", email: to, first: true });
    expect(await page.account.setPassword(password)).toBeUndefined();
    expect(page.account.state()).toEqual({ status: "signed-in", email: to });
    expect(await page.account.signOut()).toBeUndefined();
  }

  /** Sign `to` up straight through the API with `password`, as anyone with the public key can. */
  async function signUpThroughTheApi(to: string, password: string) {
    const { client } = await browser(memory());
    const { error } = await client.auth.signUp({ email: to, password });
    expect(error).toBeNull();
    // Its confirmation goes to the address's owner, who does not follow it.
    await linkIn(CONFIRM, to);
    // Auth sends one address one email a second at most.
    await pause(1100);
  }

  /** What Auth answers a sign-up straight through its API, as anyone with the public key can. */
  async function signUpAnswer(to: string, password: string) {
    const response = await fetch(`${url}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: key ?? "", "content-type": "application/json" },
      body: JSON.stringify({ email: to, password }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    // Only the status and the names of the fields are compared, not their values (see the test).
    // Auth (2.197.0) also copies `recovery_sent_at` into its answer for an address that was sent a
    // sign-in or reset link, which no setting turns off: a gap decision 0099 records.
    const keys = Object.keys(body).filter((name) => name !== "recovery_sent_at");
    return { status: response.status, keys: keys.sort() };
  }

  beforeAll(clear);
  afterAll(async () => {
    for (const client of clients) await client.auth.stopAutoRefresh();
    await clear();
  });

  it("makes an account by the emailed link, chooses the password there, and signs in with it", async () => {
    const storage = memory();
    const asking = await browser(storage);
    expect(await asking.account.signUp(email)).toBeUndefined();
    const back = await follow(await linkIn(CONFIRM, email));

    // The page the link opens, in the browser that asked: signed in, the address cleaned, and
    // asked for a password.
    const page = await browser(storage, back);
    expect(await settled(page.account)).toEqual({ status: "recovering", email, first: true });
    expect(page.place.now()).toBe(EDITOR);

    // A reload before choosing comes back to it.
    const reloaded = await browser(storage);
    expect(await settled(reloaded.account)).toEqual({ status: "recovering", email, first: true });

    // A short password is refused by the editor, and by the server in the same words.
    expect(await reloaded.account.setPassword("seven77")).toBe(PASSWORD_RULE);
    const { error } = await reloaded.client.auth.updateUser({ password: "seven77" });
    expect(error?.code).toBe("weak_password");
    expect(messageFor(error, "password")).toBe(PASSWORD_RULE);

    expect(await reloaded.account.setPassword(FIRST)).toBeUndefined();
    expect(reloaded.account.state()).toEqual({ status: "signed-in", email });
    expect(await reloaded.account.signOut()).toBeUndefined();
    expect(hasStoredSession(storage)).toBe(false);

    const again = await browser(memory());
    expect(await again.account.signIn(email, FIRST)).toBeUndefined();
    expect(again.account.state()).toEqual({ status: "signed-in", email });
    expect(await again.account.signOut()).toBeUndefined();
  });

  it("gives an address that has an account the same reply as a new one in the editor, and the same status and fields in the API", async () => {
    await pause(1100);
    const { account } = await browser(memory());
    expect(await account.signUp(email)).toBeUndefined();
    expect(await account.signUp(fresh)).toBeUndefined();
    await linkIn(SIGN_IN, email);
    await linkIn(CONFIRM, fresh);

    // Auth's own answer to a sign-up has the same status and fields for an address with an account
    // as for a new one. Its values still differ (an existing account's comes with no identities and
    // an empty role, Auth's own obfuscation), a gap no setting closes, which decision 0099 records.
    const known = await signUpAnswer(email, "invented-other-pass");
    const unknown = await signUpAnswer(stranger, "invented-other-pass");
    expect(known.status).toBe(200);
    expect(known).toEqual(unknown);
    // And the account's password did not change.
    expect(await account.signIn(email, "invented-other-pass")).toBe(WRONG_PASSWORD);
    expect(await account.signIn(email, FIRST)).toBeUndefined();
    expect(await account.signOut()).toBeUndefined();
  });

  it("drops a password someone else set before the owner confirmed by an email link", async () => {
    await signUpThroughTheApi(victim, THEIRS);
    // The owner signs in by email link, which confirms the address.
    const storage = memory();
    const asking = await browser(storage);
    expect(await asking.account.sendLink(victim)).toBeUndefined();
    const page = await browser(storage, await follow(await linkIn([CONFIRM, SIGN_IN], victim)));
    expect(await settled(page.account)).toEqual({ status: "signed-in", email: victim });

    const other = await browser(memory());
    expect(await other.account.signIn(victim, THEIRS)).toBe(WRONG_PASSWORD);
    expect(other.account.state()).toEqual({ status: "signed-out" });
  });

  it("drops a password someone else set before the owner made the account, and keeps the owner's", async () => {
    await signUpThroughTheApi(victim2, THEIRS);
    await makeAccount(victim2, FIRST);

    const other = await browser(memory());
    expect(await other.account.signIn(victim2, THEIRS)).toBe(WRONG_PASSWORD);
    expect(await other.account.signIn(victim2, FIRST)).toBeUndefined();
    expect(await other.account.signOut()).toBeUndefined();
  });

  it("gives one message for a wrong password and a missing account", async () => {
    const { account } = await browser(memory());
    expect(await account.signIn(email, "invented-wrong-pass")).toBe(WRONG_PASSWORD);
    expect(await account.signIn(missing, FIRST)).toBe(WRONG_PASSWORD);
    expect(account.state()).toEqual({ status: "signed-out" });
  });

  it("asks an unconfirmed address to confirm only once its password is right", async () => {
    await signUpThroughTheApi(unconfirmed, FIRST);
    const { account } = await browser(memory());
    expect(await account.signIn(unconfirmed, "invented-wrong-pass")).toBe(WRONG_PASSWORD);
    expect(await account.signIn(unconfirmed, FIRST)).toBe(CONFIRM_FIRST);
    expect(account.state()).toEqual({ status: "signed-out" });
  });

  it("resets: the same reply for an existing and a missing address, and the link sets a new password", async () => {
    await pause(1100);
    const storage = memory();
    const asking = await browser(storage);
    expect(await asking.account.sendReset(missing)).toBeUndefined();
    expect(await asking.account.sendReset(email)).toBeUndefined();
    const back = await follow(await linkIn(RESET, email));
    expect(await mail(missing)).toEqual([]);

    // The link opens the recovery state, signed in, and a reload comes back to it.
    const page = await browser(storage, back);
    expect(await settled(page.account)).toEqual({ status: "recovering", email });
    expect(page.place.now()).toBe(EDITOR);
    const reloaded = await browser(storage);
    expect(await settled(reloaded.account)).toEqual({ status: "recovering", email });

    expect(await reloaded.account.setPassword("seven77")).toBe(PASSWORD_RULE);
    // The server refuses its own password too long, over 72, in the rule's words.
    const { error } = await reloaded.client.auth.updateUser({ password: "a".repeat(73) });
    expect(messageFor(error, "password")).toBe(PASSWORD_RULE);
    expect(await reloaded.account.setPassword(FIRST)).toBe(SAME_PASSWORD);
    expect(await reloaded.account.setPassword(SECOND)).toBeUndefined();
    expect(reloaded.account.state()).toEqual({ status: "signed-in", email });
    expect(await reloaded.account.signOut()).toBeUndefined();

    const later = await browser(memory());
    expect(await later.account.signIn(email, FIRST)).toBe(WRONG_PASSWORD);
    expect(await later.account.signIn(email, SECOND)).toBeUndefined();
    expect(await later.account.signOut()).toBeUndefined();

    // Asked again at once, Auth sends nothing, and the editor says so rather than that it sent.
    await pause(1100);
    expect(await later.account.sendReset(email)).toBeUndefined();
    expect(await later.account.sendReset(email)).toBe(TOO_MANY);
    await linkIn(RESET, email);
  });

  it("changes the password with the current one, and not with a wrong one", async () => {
    await makeAccount(changer, FIRST);
    const { account, client } = await browser(memory());
    expect(await account.signIn(changer, FIRST)).toBeUndefined();

    expect(await account.changePassword("invented-wrong-pass", SECOND)).toBe(WRONG_CURRENT);
    // Nothing changed, and the person is still signed in.
    expect(account.state()).toEqual({ status: "signed-in", email: changer });
    expect((await client.auth.getSession()).data.session).not.toBeNull();
    const check = await browser(memory());
    expect(await check.account.signIn(changer, SECOND)).toBe(WRONG_PASSWORD);
    expect(await check.account.signIn(changer, FIRST)).toBeUndefined();
    expect(await check.account.signOut()).toBeUndefined();

    expect(await account.changePassword(FIRST, THIRD)).toBeUndefined();
    expect(account.state()).toEqual({ status: "signed-in", email: changer });
    expect(await account.signOut()).toBeUndefined();

    const after = await browser(memory());
    expect(await after.account.signIn(changer, FIRST)).toBe(WRONG_PASSWORD);
    expect(await after.account.signIn(changer, THIRD)).toBeUndefined();
    expect(await after.account.signOut()).toBeUndefined();
  });
});
