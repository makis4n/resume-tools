import type { Resume } from "@resume-tools/resume-model";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Account, type Place } from "../account/account";
import { createAccountClient, type SessionStorage, STORAGE_KEY } from "../account/client";
import { apply, type Document } from "../editor/document";
import { curated } from "../templates/curated";
import {
  MAX_DOCUMENT_BYTES,
  ServerRefused,
  ServerUnavailable,
  type SyncServer,
  type Upload,
} from "./server";
import { COPY_SUFFIX, DocumentStore } from "./store";
import { LIST_PAGE, SupabaseServer } from "./supabase-server";
import { type SyncEvent, SyncQueue } from "./sync";

// The sync queue on the local Supabase stack (milestone 4 item 7, decisions 0092, 0093 and 0098):
// one account signed in on two devices, each a client with its own session storage and a store on
// an IndexedDB of its own, and a second account on a third. A device opening the editor again is
// its queue signing in again, which brings the account's documents in. Every address and every word
// is invented. Skips without the stack (`test:integration`).

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const mailpit = process.env.MAILPIT_URL;

const EDITOR = "http://localhost:5173/";

function memory(): SessionStorage {
  const kept = new Map<string, string>();
  return {
    getItem: (name) => kept.get(name) ?? null,
    setItem: (name, value) => void kept.set(name, value),
    removeItem: (name) => void kept.delete(name),
  };
}

function placeAt(href: string): Place {
  let at = href;
  return { href: () => at, replace: (next) => void (at = next) };
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Wait for `check` to hold, up to `ms`. */
async function eventually(check: () => Promise<boolean> | boolean, ms = 15_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await pause(50);
  }
  throw new Error("what was expected never came about");
}

/** A connection that a test can take offline, around the device's real one. */
class Switchable implements SyncServer {
  offline = false;
  constructor(readonly inner: SyncServer) {}
  private reach(): void {
    if (this.offline) throw new ServerUnavailable();
  }
  async list() {
    this.reach();
    return this.inner.list();
  }
  async get(id: string) {
    this.reach();
    return this.inner.get(id);
  }
  async insert(doc: Upload) {
    this.reach();
    return this.inner.insert(doc);
  }
  async update(doc: Upload, expected: number) {
    this.reach();
    return this.inner.update(doc, expected);
  }
  async remove(id: string) {
    this.reach();
    return this.inner.remove(id);
  }
}

const { sample } = curated("jake");

/** An invented resume, with the name given. */
const resumeOf = (first: string, last: string): Resume => ({
  ...sample,
  header: { ...sample.header, name: { ...sample.header.name, first, last } },
});

const named = (doc: Document, first: string) =>
  apply(doc, { type: "text", field: "header.first", text: first });

/** `doc` with its first name set as it is, past the editor's commands and their bounds. */
const withFirst = (doc: Document, first: string): Document => ({
  ...doc,
  resume: {
    ...doc.resume,
    header: { ...doc.resume.header, name: { ...doc.resume.header.name, first } },
  },
});

const firstName = (doc: { document: unknown } | null | undefined) =>
  (doc?.document as Document | undefined)?.resume.header.name.first;

describe.skipIf(!url || !key || !mailpit)("syncing documents with the local stack", () => {
  const config = { url: url ?? "", key: key ?? "" };
  const invent = (name: string) =>
    `${name}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
  const email = invent("sync");
  const otherEmail = invent("sync-other");
  const thirdEmail = invent("sync-third");
  const clients: SupabaseClient[] = [];
  const closing: (() => Promise<void>)[] = [];
  let devices = 0;

  const clearTo = async (to: string) => {
    const query = encodeURIComponent(`to:"${to}"`);
    await fetch(`${mailpit}/api/v1/search?query=${query}`, { method: "DELETE" });
  };

  /** The sign-in link in the newest email to `to`, waited for; the address's mail is then cleared. */
  async function linkTo(to: string): Promise<string> {
    const query = encodeURIComponent(`to:"${to}"`);
    for (let tries = 0; tries < 50; tries++) {
      const found = await fetch(`${mailpit}/api/v1/search?query=${query}`);
      const { messages } = (await found.json()) as { messages: { ID: string }[] };
      const message = messages[0];
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
    throw new Error(`no email reached ${to}`);
  }

  /** Sign a new device in as `to` by the email link, as the page does; its client and user id. */
  async function signedIn(
    to: string,
  ): Promise<{ client: SupabaseClient; user: string; storage: SessionStorage }> {
    const storage = memory();
    const client = await createAccountClient(config, { storage });
    clients.push(client);
    const asking = new Account({ load: async () => client, storage, place: placeAt(EDITOR) });
    // Supabase spaces emails to one address by a second (`max_frequency`).
    let problem = await asking.sendLink(to);
    for (let tries = 0; problem !== undefined && tries < 5; tries++) {
      await pause(1100);
      problem = await asking.sendLink(to);
    }
    expect(problem).toBeUndefined();
    const response = await fetch(await linkTo(to), { redirect: "manual" });
    const back = response.headers.get("location") ?? "";
    const page = new Account({ load: async () => client, storage, place: placeAt(back) });
    page.start();
    await eventually(() => page.state().status !== "checking");
    expect(page.state().status).toBe("signed-in");
    const user = page.userId();
    if (user === undefined) throw new Error("signed in without a user id");
    return { client, user, storage };
  }

  /** A device: a store on an IndexedDB of its own, and a queue beside it, signed in as `user`. */
  function device(client: SupabaseClient, user: string) {
    const idb = { indexedDB: new IDBFactory(), IDBKeyRange };
    const store = new DocumentStore({ name: `sync-integration-${++devices}`, idb });
    const queue = new SyncQueue({ store, locks: null, page: null });
    const server = new Switchable(new SupabaseServer(client, user));
    const events: SyncEvent[] = [];
    queue.on((event) => events.push(event));
    closing.push(async () => {
      queue.close();
      await store.close();
    });
    return {
      store,
      queue,
      server,
      events,
      /** Open the editor: sign the queue in, which brings the account's documents in. */
      open: () => queue.signIn(user, server),
      /** Whether the account has taken every save of `id` this device made. */
      inStep: async (id: string) => (await store.places()).get(id) === "in-account",
    };
  }

  let ada: Awaited<ReturnType<typeof signedIn>>;
  let other: Awaited<ReturnType<typeof signedIn>>;

  beforeAll(async () => {
    await clearTo(email);
    await clearTo(otherEmail);
    await clearTo(thirdEmail);
    ada = await signedIn(email);
    other = await signedIn(otherEmail);
  });

  afterAll(async () => {
    for (const close of closing.splice(0).reverse()) await close();
    for (const client of clients) await client.auth.stopAutoRefresh();
    await clearTo(email);
    await clearTo(otherEmail);
    await clearTo(thirdEmail);
  });

  /** The two devices of the one account, each signed in on a client of its own. */
  async function twoDevices() {
    const second = await signedIn(email);
    expect(second.user).toBe(ada.user);
    const a = device(ada.client, ada.user);
    const b = device(second.client, ada.user);
    await a.open();
    await b.open();
    // Neither has documents only in it: no question.
    await a.queue.answer("not-now");
    await b.queue.answer("not-now");
    return { a, b };
  }

  let pair: Awaited<ReturnType<typeof twoDevices>>;
  const devicesOfAda = async () => {
    pair ??= await twoDevices();
    return pair;
  };

  it("opens on one device a built-in template's document saved on the other", async () => {
    const { a, b } = await devicesOfAda();
    const id = await a.store.create("jake", resumeOf("Ilse", "Varga"), "en-GB");
    await eventually(() => a.inStep(id));
    await b.open();
    const opened = await b.store.get(id);
    const saved = await a.store.get(id);
    expect(opened?.document).toEqual(saved?.document);
    expect((await b.store.list()).find((each) => each.id === id)?.title).toBe("Ilse Varga");
    expect(await b.store.syncRow(id)).toMatchObject({
      kind: "template",
      owner: ada.user,
      serverRevision: 1,
      pending: false,
    });
  });

  it("opens on one device a PDF import saved on the other, as its canonical document", async () => {
    const { a, b } = await devicesOfAda();
    // As a PDF's import is kept (`pdf-import.ts`): a draft on a curated template, of kind "pdf".
    const id = await a.store.create("jake", resumeOf("Oren", "Paley"), "en-GB", "pdf");
    await eventually(() => a.inStep(id));
    await b.open();
    expect((await b.store.get(id))?.document).toEqual((await a.store.get(id))?.document);
    expect(await b.store.syncRow(id)).toMatchObject({ kind: "pdf", title: "Oren Paley" });
  });

  it("ends a conflict in two documents, the account's keeping the id and this device's a copy", async () => {
    const { a, b } = await devicesOfAda();
    const id = await a.store.create("jake", resumeOf("Tove", "Rask"), "en-GB");
    await eventually(() => a.inStep(id));
    await b.open();
    // Both edit from revision 1; A sends first.
    const onA = await a.store.get(id);
    const onB = await b.store.get(id);
    if (onA === undefined || onB === undefined) throw new Error("not on both devices");
    a.store.save(id, named(onA.document, "Asa"), onA.revision);
    await a.store.flush();
    await eventually(() => a.inStep(id));
    b.store.save(id, named(onB.document, "Bea"), onB.revision);
    await b.store.flush();

    await eventually(() => b.events.some((event) => event.type === "copied" && event.id === id));
    const copied = b.events.find((event) => event.type === "copied" && event.id === id);
    if (copied?.type !== "copied") throw new Error("no copy");
    expect(copied.title).toBe(`Bea Rask${COPY_SUFFIX}`);
    expect(firstName(await b.store.get(id))).toBe("Asa");
    expect(firstName(await b.store.get(copied.copy))).toBe("Bea");
    await eventually(() => b.inStep(copied.copy));

    // The account holds both: A's under the id, B's as a new document.
    const account = new SupabaseServer(ada.client, ada.user);
    expect(firstName(await account.get(id))).toBe("Asa");
    const copy = await account.get(copied.copy);
    expect(copy).toMatchObject({ title: `Bea Rask${COPY_SUFFIX}`, revision: 1 });
    expect(firstName(copy)).toBe("Bea");
  });

  it("removes on the other device a document deleted on one, or keeps it as a copy with pending saves", async () => {
    const { a, b } = await devicesOfAda();
    const gone = await a.store.create("jake", resumeOf("Ulla", "Mott"), "en-GB");
    const edited = await a.store.create("jake", resumeOf("Vik", "Ness"), "en-GB");
    await eventually(async () => (await a.inStep(gone)) && (await a.inStep(edited)));
    await b.open();
    expect(await b.store.get(gone)).toBeDefined();

    // B edits one while offline; A deletes both.
    b.server.offline = true;
    const onB = await b.store.get(edited);
    if (onB === undefined) throw new Error("not on B");
    b.store.save(edited, named(onB.document, "Wim"), onB.revision);
    await b.store.flush();
    await a.queue.remove(gone);
    await a.queue.remove(edited);
    const account = new SupabaseServer(ada.client, ada.user);
    await eventually(async () => (await account.get(gone)) === null);
    await eventually(async () => (await account.get(edited)) === null);

    // Back online, B opens the editor again: the one in step goes; the edited one is kept as a copy.
    b.server.offline = false;
    await b.open();
    expect(await b.store.get(gone)).toBeUndefined();
    expect(await b.store.get(edited)).toBeUndefined();
    expect(b.events).toContainEqual({ type: "removed", id: gone });
    const copied = b.events.find((event) => event.type === "copied" && event.id === edited);
    if (copied?.type !== "copied") throw new Error("no copy");
    expect(copied.why).toBe("deleted");
    expect(firstName(await b.store.get(copied.copy))).toBe("Wim");
    await eventually(() => b.inStep(copied.copy));
    expect(firstName(await account.get(copied.copy))).toBe("Wim");
  });

  it("shows a second account, on a third device, none of the first's documents", async () => {
    const { a } = await devicesOfAda();
    const mine = await a.store.create("jake", resumeOf("Xan", "Holt"), "en-GB");
    await eventually(() => a.inStep(mine));
    const c = device(other.client, other.user);
    await c.open();
    expect(await c.store.syncRows()).toEqual([]);
    const theirs = new SupabaseServer(other.client, other.user);
    expect(await theirs.list()).toEqual([]);
    expect(await theirs.get(mine)).toBeNull();
    // Nor can it write over it, or delete it.
    const result = await theirs.update(
      { id: mine, kind: "template", templateId: "jake", title: "Taken", document: {} },
      1,
    );
    expect(result).toEqual({ ok: false, reason: "missing" });
    await theirs.remove(mine);
    expect(await new SupabaseServer(ada.client, ada.user).get(mine)).not.toBeNull();
  });

  it("saves a document holding U+0000 and a lone surrogate cleaned, which the table would refuse", async () => {
    const { a } = await devicesOfAda();
    const account = new SupabaseServer(ada.client, ada.user);
    // Sent as it is, the table refuses either, and the server says so as final.
    for (const first of ["Nul\u0000l", "Lone\uD800"]) {
      const refused = await account
        .insert({
          id: crypto.randomUUID(),
          kind: "template",
          templateId: "jake",
          title: "Refused",
          document: { first },
        })
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(ServerRefused);
    }

    const id = await a.store.create("jake", resumeOf("Yara", "Lind"), "en-GB");
    await eventually(() => a.inStep(id));
    const held = await a.store.get(id);
    if (held === undefined) throw new Error("not stored");
    a.store.save(id, withFirst(held.document, "Ya\u0000ra\uD800"), held.revision);
    await a.store.flush();
    await eventually(async () => (await account.get(id))?.revision === 2);
    const saved = await account.get(id);
    expect(firstName(saved)).toBe("Yara�");
    expect(saved?.title).toBe("Yara� Lind");
    await eventually(() => a.inStep(id));
  });

  it("refuses an oversize document without a request and never tries it again; the table's own refusals are final too", async () => {
    const { a } = await devicesOfAda();
    const account = new SupabaseServer(ada.client, ada.user);
    const id = await a.store.create("jake", resumeOf("Zeno", "Brix"), "en-GB");
    await eventually(() => a.inStep(id));
    const held = await a.store.get(id);
    if (held === undefined) throw new Error("not stored");
    const counted = new Map<string, number>();
    const inner = a.server.inner;
    // Every write that reaches the account, counted by document.
    const counting: SyncServer = {
      list: () => inner.list(),
      get: (each) => inner.get(each),
      insert: (doc) => {
        counted.set(doc.id, (counted.get(doc.id) ?? 0) + 1);
        return inner.insert(doc);
      },
      update: (doc, expected) => {
        counted.set(doc.id, (counted.get(doc.id) ?? 0) + 1);
        return inner.update(doc, expected);
      },
      remove: (each) => inner.remove(each),
    };
    await a.queue.signIn(ada.user, counting);
    a.store.save(id, withFirst(held.document, "z".repeat(MAX_DOCUMENT_BYTES)), held.revision);
    await a.store.flush();
    await eventually(() => a.events.some((event) => event.type === "refused" && event.id === id));
    expect((await a.store.places()).get(id)).toBe("refused");
    // Past the first wait a failure would bring, nothing was sent.
    await pause(2_500);
    expect(counted.get(id)).toBeUndefined();
    expect(firstName(await account.get(id))).toBe("Zeno");

    // A template's id past the table's bound: refused by Postgres (23514), and not tried again.
    const odd = crypto.randomUUID();
    const refused = await account
      .insert({
        id: odd,
        kind: "template",
        templateId: "t".repeat(101),
        title: "Odd",
        document: {},
      })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ServerRefused);
    expect((refused as ServerRefused).code).toBe("23514");
    await a.queue.signIn(ada.user, a.server);
  }, 30_000);

  it("asks nothing of the account as one user while the client holds another's session", async () => {
    // As when another tab of this browser has signed in as someone else: the client's session is
    // the other account's, and the queue still syncs the first's until it hears of it.
    const stale = new SupabaseServer(other.client, ada.user);
    const id = crypto.randomUUID();
    const upload: Upload = {
      id,
      kind: "template",
      templateId: "jake",
      title: "Not Theirs",
      document: {},
    };
    for (const call of [
      () => stale.list(),
      () => stale.get(id),
      () => stale.insert(upload),
      () => stale.update(upload, 1),
      () => stale.remove(id),
    ])
      await expect(call()).rejects.toBeInstanceOf(ServerUnavailable);
    expect(await new SupabaseServer(other.client, other.user).get(id)).toBeNull();
    expect(await new SupabaseServer(ada.client, ada.user).get(id)).toBeNull();
  });

  it("makes a request as the queue's user even when another account's session is stored under it", async () => {
    const mine = await signedIn(email);
    const third = await signedIn(thirdEmail);
    const theirSession = third.storage.getItem(STORAGE_KEY);
    if (theirSession === null) throw new Error("no session stored");
    // Once the server has read the session, another tab signs this browser in as the third
    // account: the client reads that session from storage for the request itself.
    const auth = mine.client.auth;
    const racing = new Proxy(mine.client, {
      get(target, property) {
        if (property !== "auth") return Reflect.get(target, property);
        return new Proxy(auth, {
          get(inner, name) {
            if (name !== "getSession") return Reflect.get(inner, name);
            return async () => {
              const read = await inner.getSession();
              mine.storage.setItem(STORAGE_KEY, theirSession);
              return read;
            };
          },
        });
      },
    });
    const id = crypto.randomUUID();
    const written = await new SupabaseServer(racing, ada.user).insert({
      id,
      kind: "template",
      templateId: "jake",
      title: "Whose Row",
      document: {},
    });
    expect(written).toMatchObject({ ok: true, revision: 1 });
    expect(await new SupabaseServer(third.client, third.user).list()).toEqual([]);
    expect((await new SupabaseServer(ada.client, ada.user).get(id))?.title).toBe("Whose Row");
  });

  it("lists every document of an account past what one answer of the account holds", async () => {
    const theirs = new SupabaseServer(other.client, other.user);
    const before = (await theirs.list()).length;
    // More than PostgREST's `max_rows` (1000) gives in one answer.
    const rows = Array.from({ length: 1005 }, (_, at) => ({
      id: crypto.randomUUID(),
      kind: "template",
      template_id: "jake",
      title: `Many ${at}`,
      document: {},
    }));
    const inserted = await other.client.from("documents").insert(rows);
    expect(inserted.error).toBeNull();
    const listed = await theirs.list();
    expect(listed).toHaveLength(before + rows.length);
    expect(listed.length).toBeGreaterThan(2 * LIST_PAGE);
    const ids = new Set(listed.map(({ id }) => id));
    expect(rows.every(({ id }) => ids.has(id))).toBe(true);
    await other.client.from("documents").delete().like("title", "Many %");
  }, 30_000);
});
