import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Account, type Place } from "./account";
import { createAccountClient, hasStoredSession, type SessionStorage } from "./client";
import {
  CONFIRM_FIRST,
  messageFor,
  PASSWORD_RULE,
  SAME_PASSWORD,
  WRONG_CURRENT,
  WRONG_PASSWORD,
} from "./messages";

// Signing up and in with a password on the local Supabase stack (milestone 4 item 5, decisions
// 0094 and 0096), with the editor's own client and account in Node, as the email link's test does:
// a browser is a client and an account on a storage of its own, and the page's address a string.
// Confirmation and reset links are read from Mailpit and followed without their redirect, and the
// code in the address they lead to is exchanged as the page would on load. Every address and
// password is invented. Skips without the stack (`test:integration`).

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const mailpit = process.env.MAILPIT_URL;

/** Where the dev server serves the editor, which `site_url` allows links back to. */
const EDITOR = "http://localhost:5173/";

const CONFIRM = "Confirm your email for the resume editor";
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
  const addresses = [email, missing, unconfirmed, changer];
  const FIRST = "invented-first-pass";
  const SECOND = "invented-second-pass";
  const THIRD = "invented-third-pass";
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

  /** The link in the newest email to `to` with `subject`, waited for; its emails are then deleted. */
  async function linkIn(subject: string, to: string): Promise<string> {
    for (let tries = 0; tries < 50; tries++) {
      const message = (await mail(to)).find((each) => each.Subject === subject);
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
    throw new Error(`no email "${subject}" reached Mailpit`);
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

  /** Sign `to` up with `password` and follow the confirmation link, signed in, then out. */
  async function signUpAndConfirm(to: string, password: string) {
    const storage = memory();
    const asking = await browser(storage);
    expect(await asking.account.signUp(to, password)).toBeUndefined();
    const page = await browser(storage, await follow(await linkIn(CONFIRM, to)));
    expect(await settled(page.account)).toEqual({ status: "signed-in", email: to });
    expect(await page.account.signOut()).toBeUndefined();
  }

  beforeAll(clear);
  afterAll(async () => {
    for (const client of clients) await client.auth.stopAutoRefresh();
    await clear();
  });

  it("signs up, confirms by the emailed link, signs out, and signs in with the password", async () => {
    const storage = memory();
    const asking = await browser(storage);
    expect(await asking.account.signUp(email, FIRST)).toBeUndefined();
    const back = await follow(await linkIn(CONFIRM, email));

    // The page the link opens, in the browser that asked: signed in, the address cleaned.
    const page = await browser(storage, back);
    expect(await settled(page.account)).toEqual({ status: "signed-in", email });
    expect(page.place.now()).toBe(EDITOR);
    expect(await page.account.signOut()).toBeUndefined();
    expect(hasStoredSession(storage)).toBe(false);

    const again = await browser(memory());
    expect(await again.account.signIn(email, FIRST)).toBeUndefined();
    expect(again.account.state()).toEqual({ status: "signed-in", email });
    expect(await again.account.signOut()).toBeUndefined();
  });

  it("gives an address that has an account the same reply as a new one, and sends it nothing", async () => {
    await pause(1100);
    const { account } = await browser(memory());
    expect(await account.signUp(email, SECOND)).toBeUndefined();
    await pause(500);
    expect(await mail(email)).toEqual([]);
    // The password did not change.
    expect(await account.signIn(email, SECOND)).toBe(WRONG_PASSWORD);
  });

  it("refuses a short password in the editor, and the server refuses it in the same words", async () => {
    const { client, account } = await browser(memory());
    expect(await account.signUp(invent("short"), "seven77")).toBe(PASSWORD_RULE);
    const { error } = await client.auth.signUp({ email: invent("short"), password: "seven77" });
    expect(error?.code).toBe("weak_password");
    expect(messageFor(error, "signUp")).toBe(PASSWORD_RULE);
  });

  it("gives one message for a wrong password and a missing account", async () => {
    const { account } = await browser(memory());
    expect(await account.signIn(email, "invented-wrong-pass")).toBe(WRONG_PASSWORD);
    expect(await account.signIn(missing, FIRST)).toBe(WRONG_PASSWORD);
    expect(account.state()).toEqual({ status: "signed-out" });
  });

  it("asks an unconfirmed address to confirm only once its password is right", async () => {
    const { account } = await browser(memory());
    expect(await account.signUp(unconfirmed, FIRST)).toBeUndefined();
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

    // The link opens the recovery state, signed in.
    const page = await browser(storage, back);
    expect(await settled(page.account)).toEqual({ status: "recovering", email });
    expect(page.place.now()).toBe(EDITOR);
    expect(await page.account.setPassword("seven77")).toBe(PASSWORD_RULE);
    // The server refuses its own password too long, over 72, in the rule's words.
    const { error } = await page.client.auth.updateUser({ password: "a".repeat(73) });
    expect(messageFor(error, "password")).toBe(PASSWORD_RULE);
    expect(await page.account.setPassword(FIRST)).toBe(SAME_PASSWORD);
    expect(await page.account.setPassword(SECOND)).toBeUndefined();
    expect(page.account.state()).toEqual({ status: "signed-in", email });
    expect(await page.account.signOut()).toBeUndefined();

    const later = await browser(memory());
    expect(await later.account.signIn(email, FIRST)).toBe(WRONG_PASSWORD);
    expect(await later.account.signIn(email, SECOND)).toBeUndefined();
    expect(await later.account.signOut()).toBeUndefined();
  });

  it("changes the password with the current one, and not with a wrong one", async () => {
    await signUpAndConfirm(changer, FIRST);
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
