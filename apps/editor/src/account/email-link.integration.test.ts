import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Account, type Place } from "./account";
import { createAccountClient, hasStoredSession, type SessionStorage } from "./client";
import { ANOTHER_BROWSER, LINK_EXPIRED, LINK_SUPERSEDED, TOO_MANY } from "./messages";

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
  const invent = (name: string) =>
    `${name}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
  const email = invent("link");
  const otherAddress = invent("other");
  const first = invent("first");
  const second = invent("second");
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
  async function mail(to = email): Promise<{ ID: string; Subject: string }[]> {
    const query = encodeURIComponent(`to:"${to}"`);
    const found = await fetch(`${mailpit}/api/v1/search?query=${query}`);
    expect(found.ok).toBe(true);
    return ((await found.json()) as { messages: { ID: string; Subject: string }[] }).messages;
  }

  const clearTo = async (to: string) => {
    const query = encodeURIComponent(`to:"${to}"`);
    await fetch(`${mailpit}/api/v1/search?query=${query}`, { method: "DELETE" });
  };
  const clear = async () => {
    for (const to of [email, otherAddress, first, second]) await clearTo(to);
  };

  /**
   * The link in the newest email to `to` with `subject` (any subject when none is given), waited
   * for; the address's emails are then deleted.
   */
  async function linkIn(subject: string | undefined, to = email): Promise<string> {
    for (let tries = 0; tries < 50; tries++) {
      const message = (await mail(to)).find(
        (each) => subject === undefined || each.Subject === subject,
      );
      if (message !== undefined) {
        const read = await fetch(`${mailpit}/api/v1/message/${message.ID}`);
        const { HTML } = (await read.json()) as { HTML: string };
        await clearTo(to);
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
    // The link names the request it answers, so its code meets that request's own verifier.
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

  it("says another browser's link cannot sign in here, though this one asked for a link of its own", async () => {
    // This browser asked for a link once and never opened it, so it keeps a verifier of its own.
    const here = memory();
    const unopened = await browser(here);
    expect(await unopened.account.sendLink(otherAddress)).toBeUndefined();
    await linkIn(undefined, otherAddress);

    // A link asked for in another browser, opened here: it is not this browser's, and says so.
    await pause(1100);
    const asked = memory();
    const asking = await browser(asked);
    expect(await asking.account.sendLink(email)).toBeUndefined();
    const back = await follow(await linkIn(undefined));
    const opened = await browser(here, back);
    expect(await settled(opened.account)).toEqual({
      status: "signed-out",
      notice: ANOTHER_BROWSER,
    });
    expect(hasStoredSession(here)).toBe(false);

    // The browser that asked still signs in with it.
    const page = await browser(asked, back);
    expect(await settled(page.account)).toEqual({ status: "signed-in", email });
    expect(await page.account.signOut()).toBeUndefined();
  });

  it("says a link replaced by a refused request is from an earlier one, not another browser's", async () => {
    await pause(1100);
    const storage = memory();
    const asking = await browser(storage);
    expect(await asking.account.sendLink(email)).toBeUndefined();
    // Asked again at once, the second is refused; Supabase ties the address's next code to that
    // later request all the same, so the first link cannot sign in, but it was asked for here.
    expect(await asking.account.sendLink(email)).toBe(TOO_MANY);
    const back = await follow(await linkIn(undefined));

    const page = await browser(storage, back);
    expect(await settled(page.account)).toEqual({ status: "signed-out", notice: LINK_SUPERSEDED });
    expect(hasStoredSession(storage)).toBe(false);
  });

  it("signs in by the newer of two links to one address, after the earlier one says so", async () => {
    await pause(1100);
    const storage = memory();
    const asking = await browser(storage);
    expect(await asking.account.sendLink(email)).toBeUndefined();
    const earlierLink = await linkIn(undefined);
    await pause(1100);
    expect(await asking.account.sendLink(email)).toBeUndefined();
    const newerLink = await linkIn(undefined);

    // Both emails opened after both were asked for: the newer request ended the earlier link,
    // which comes back with an error, and trying it leaves the newer link's verifier here.
    const response = await fetch(earlierLink, { redirect: "manual" });
    const earlierBack = response.headers.get("location") ?? "";
    expect(earlierBack.startsWith(EDITOR)).toBe(true);
    const earlier = await browser(storage, earlierBack);
    expect(await settled(earlier.account)).toEqual({ status: "signed-out", notice: LINK_EXPIRED });

    const newer = await browser(storage, await follow(newerLink));
    expect(await settled(newer.account)).toEqual({ status: "signed-in", email });
    expect(await newer.account.signOut()).toBeUndefined();
  });

  it("signs in by an earlier link, and then by the newer one, both asked for here", async () => {
    const storage = memory();
    const asking = await browser(storage);
    expect(await asking.account.sendLink(first)).toBeUndefined();
    expect(await asking.account.sendLink(second)).toBeUndefined();
    const firstBack = await follow(await linkIn(undefined, first));
    const secondBack = await follow(await linkIn(undefined, second));

    // The earlier link's code meets its own verifier, and leaves the newer link's.
    const earlier = await browser(storage, firstBack);
    expect(await settled(earlier.account)).toEqual({ status: "signed-in", email: first });
    const newer = await browser(storage, secondBack);
    expect(await settled(newer.account)).toEqual({ status: "signed-in", email: second });
    expect(await newer.account.signOut()).toBeUndefined();
    expect(hasStoredSession(storage)).toBe(false);
  });
});
