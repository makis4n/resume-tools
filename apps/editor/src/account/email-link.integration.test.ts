import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Account, type Place } from "./account";
import { createAccountClient, hasStoredSession, type SessionStorage } from "./client";
import { ANOTHER_BROWSER } from "./messages";

// Signing in by email link on the local Supabase stack (milestone 4 item 4, decisions 0094 and
// 0096), with the editor's own client and account in Node: a browser is a client and an account on
// a storage of its own, and the page's address a string. The link is read from Mailpit, followed
// without its redirect, and the code in the address it leads to is exchanged as the page would on
// load. Skips without the stack (`test:integration`).

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const mailpit = process.env.MAILPIT_URL;

/** Where the dev server serves the editor, which `site_url` allows links back to. */
const EDITOR = "http://localhost:5173/";

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

describe.skipIf(!url || !key || !mailpit)("signing in by email link on the local stack", () => {
  const config = { url: url ?? "", key: key ?? "" };
  const email = `link.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
  const clients: SupabaseClient[] = [];

  /** One browser: its storage, and a page loaded at `href` with a client of its own. */
  async function browser(storage: SessionStorage, href = EDITOR) {
    const client = await createAccountClient(config, { storage });
    clients.push(client);
    const place = placeAt(href);
    const account = new Account({ load: async () => client, storage, place });
    return { client, place, account };
  }

  /** Mailpit's messages to the address, newest first. */
  async function mail(): Promise<{ ID: string; Subject: string }[]> {
    const query = encodeURIComponent(`to:"${email}"`);
    const found = await fetch(`${mailpit}/api/v1/search?query=${query}`);
    expect(found.ok).toBe(true);
    return ((await found.json()) as { messages: { ID: string; Subject: string }[] }).messages;
  }

  const clear = async () => {
    const query = encodeURIComponent(`to:"${email}"`);
    await fetch(`${mailpit}/api/v1/search?query=${query}`, { method: "DELETE" });
  };

  /** The link in the newest email with `subject`, waited for; the email is then deleted. */
  async function linkIn(subject: string): Promise<string> {
    for (let tries = 0; tries < 50; tries++) {
      const message = (await mail()).find((each) => each.Subject === subject);
      if (message !== undefined) {
        const read = await fetch(`${mailpit}/api/v1/message/${message.ID}`);
        const { HTML } = (await read.json()) as { HTML: string };
        await clear();
        const href = /href="([^"]*\/auth\/v1\/verify[^"]*)"/.exec(HTML)?.[1];
        if (href === undefined) throw new Error("the email holds no sign-in link");
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
    return location;
  }

  /** The account once it has read the page's address and storage. */
  async function settled(account: Account) {
    account.start();
    for (let tries = 0; tries < 100 && account.state().status === "checking"; tries++)
      await pause(50);
    return account.state();
  }

  beforeAll(clear);
  afterAll(async () => {
    for (const client of clients) await client.auth.stopAutoRefresh();
    await clear();
  });

  it("signs a new address in by the link in its email, and signs out", async () => {
    const storage = memory();
    const asking = await browser(storage);
    expect(await asking.account.sendLink(email)).toBeUndefined();
    // A new address's first link confirms it, in the editor's own email.
    const back = await follow(await linkIn("Confirm your email for the resume editor"));

    // The page the link opens, in the browser that asked.
    const page = await browser(storage, back);
    expect(await settled(page.account)).toEqual({ status: "signed-in", email });
    expect(page.place.now()).toBe(EDITOR);
    expect(hasStoredSession(storage)).toBe(true);

    expect(await page.account.signOut()).toBeUndefined();
    expect(page.account.state()).toEqual({ status: "signed-out" });
    expect((await page.client.auth.getSession()).data.session).toBeNull();
    expect(hasStoredSession(storage)).toBe(false);
  });

  it("signs an account in again by a link, which another browser cannot use", async () => {
    // Supabase spaces emails to one address by a second (`max_frequency`).
    await pause(1100);
    const storage = memory();
    const asking = await browser(storage);
    expect(await asking.account.sendLink(email)).toBeUndefined();
    const back = await follow(await linkIn("Your link to sign in to the resume editor"));

    // Opened in another browser, which has no verifier: it says so, and exchanges nothing.
    const elsewhere = memory();
    const other = await browser(elsewhere, back);
    expect(await settled(other.account)).toEqual({ status: "signed-out", notice: ANOTHER_BROWSER });
    expect(other.place.now()).toBe(EDITOR);
    expect(hasStoredSession(elsewhere)).toBe(false);

    // The code was not used up there, so the browser that asked signs in with it.
    const page = await browser(storage, back);
    expect(await settled(page.account)).toEqual({ status: "signed-in", email });
    expect(await page.account.signOut()).toBeUndefined();
    expect(hasStoredSession(storage)).toBe(false);
  });
});
