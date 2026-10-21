import type { Section } from "@resume-tools/resume-model";
import Dexie from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apply, type Document, newDocument } from "../editor/document";
import type { Imported, ImportReport } from "../import/run";
import { curated } from "../templates/curated";
import type { TemplatePackage } from "../templates/package";
import { FakeAccounts, FakeLocks } from "./fake-server";
import {
  cleanUpload,
  MAX_DOCUMENT_BYTES,
  MAX_SENT_TITLE,
  ServerRefused,
  ServerUnavailable,
  type SyncServer,
} from "./server";
import { COPY_SUFFIX, DocumentStore, type PageEvents, type Stored } from "./store";
import {
  type Locks,
  MAX_WAIT,
  type OriginalsHooks,
  REFRESH_INTERVAL,
  SEND_INTERVAL,
  type SyncEvent,
  SyncQueue,
  waitAfter,
} from "./sync";

const { sample } = curated("jake");
const ADA = "00000000-0000-4000-8000-00000000000a";
const BO = "00000000-0000-4000-8000-00000000000b";

/** A page whose visibility and connection the test decides. */
class FakePage implements PageEvents {
  window = new EventTarget();
  document = Object.assign(new EventTarget(), { visibilityState: "visible" });

  hide() {
    this.document.visibilityState = "hidden";
    this.document.dispatchEvent(new Event("visibilitychange"));
  }

  show() {
    this.document.visibilityState = "visible";
    this.document.dispatchEvent(new Event("visibilitychange"));
  }

  /** The connection is back. */
  online() {
    this.window.dispatchEvent(new Event("online"));
  }
}

let devices = 0;
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * A browser: an IndexedDB of its own, on which each `tab` opens a store over one database, with a
 * queue beside it on a page of its own. Two devices share nothing but the account.
 */
function device() {
  const idb = { indexedDB: new IDBFactory(), IDBKeyRange };
  const name = `sync-test-${++devices}`;
  return {
    name,
    idb,
    tab({ locks = null, hooks }: { locks?: Locks | null; hooks?: OriginalsHooks } = {}) {
      const page = new FakePage();
      const store = new DocumentStore({ name, page, idb });
      const queue = new SyncQueue({
        store,
        locks,
        page,
        ...(hooks === undefined ? {} : { hooks }),
      });
      const events: SyncEvent[] = [];
      queue.on((event) => events.push(event));
      cleanups.push(async () => {
        queue.close();
        await store.close();
      });
      return { store, queue, page, events };
    },
    /** A table as the database holds it, read past the stores. */
    async table<T>(table: string): Promise<T[]> {
      const db = new Dexie(name, idb);
      await db.open();
      try {
        return (await db.table(table).toArray()) as T[];
      } finally {
        db.close();
      }
    },
  };
}

/** Wait for `check` to hold, giving IndexedDB and the queue turns of the event loop meanwhile. */
async function eventually(check: () => Promise<boolean> | boolean) {
  for (let tries = 0; tries < 500; tries++) {
    if (await check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("what was expected never came about");
}

/** Let IndexedDB and the queue run until nothing more happens of itself. */
async function quiet(...queues: SyncQueue[]) {
  for (let turn = 0; turn < 20; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.all(queues.map((queue) => queue.settled()));
  }
}

async function read(store: DocumentStore, id: string): Promise<Stored> {
  const stored = await store.get(id);
  if (stored === undefined) throw new Error(`${id} is not stored`);
  return stored;
}

const named = (doc: Document, first: string) =>
  apply(doc, { type: "text", field: "header.first", text: first });

/** Edit a document's first name, as the editor would, and write it at once. */
async function rename(store: DocumentStore, id: string, first: string) {
  const { document, revision } = await read(store, id);
  store.save(id, named(document, first), revision);
  await store.flush();
}

const firstName = (doc: { document: unknown } | null | undefined) =>
  (doc?.document as Document | undefined)?.resume.header.name.first;

const titles = async (store: DocumentStore) =>
  (await store.list()).map((summary) => summary.title).sort();

/** An invented `.tex` import of Jake's package under an imported id (decision 0038). */
function imported(first = "Quill"): Imported {
  const id = "import-0123456789ab";
  const OUTLINE: Section = {
    kind: "outline",
    id: "outline",
    title: "",
    role: "other",
    parts: [
      { kind: "kept", latex: "\\begin{document}\n\\section*{" },
      { kind: "rich", id: "s1", text: [{ text: "Invented heading" }] },
      { kind: "kept", latex: "}\n\\end{document}" },
    ],
  };
  const pkg = { ...curated("jake").package, id, name: "Invented import" } as TemplatePackage;
  const made = { ...named(newSample(), first), template: id };
  return {
    package: pkg,
    document: { ...made, resume: { ...made.resume, sections: [OUTLINE] } },
    report: { compiles: 3 } as unknown as ImportReport,
    upload: { files: [{ name: "cv.tex", bytes: new TextEncoder().encode("% invented") }] },
    job: { files: {}, images: [] },
  };
}

const newSample = () => newDocument("jake", sample);

describe("DocumentStore version 3 (decision 0092)", () => {
  it("records each document's kind, owner, account revision and pending, and marks every save of an owned one pending", async () => {
    const browser = device();
    const { store } = browser.tab();
    const local = await store.create("jake", sample);
    const pdf = await store.create("jake", sample, "en-GB", "pdf");
    const tex = await store.importDocument(imported());
    store.setAccount(ADA);
    const owned = await store.create("jake", sample);
    const rows = new Map((await store.syncRows()).map((row) => [row.id, row]));
    expect(rows.get(local)).toMatchObject({ kind: "template", pending: false });
    expect(rows.get(local)?.owner).toBeUndefined();
    expect(rows.get(pdf)).toMatchObject({ kind: "pdf", pending: false });
    expect(rows.get(tex)).toMatchObject({ kind: "tex", pending: false });
    expect(rows.get(owned)).toMatchObject({ kind: "template", owner: ADA, pending: true });
    expect(rows.get(owned)?.serverRevision).toBeUndefined();

    // The account took it: in step, nothing pending. A save makes it pending again, and keeps the
    // account's revision for the next update to name.
    await store.markSent(owned, 1, 1);
    expect(await store.syncRow(owned)).toMatchObject({ pending: false, serverRevision: 1 });
    await rename(store, owned, "Ada");
    expect(await store.syncRow(owned)).toMatchObject({
      pending: true,
      serverRevision: 1,
      revision: 2,
    });
    // A save of a document of no account leaves it so.
    await rename(store, local, "Bo");
    expect(await store.syncRow(local)).toMatchObject({ pending: false, revision: 2 });
    const places = await store.places();
    expect(places.get(local)).toBe("only-here");
    expect(places.get(owned)).toBe("waiting");
  });

  it("reads a row from before version 3 as a document only in this browser, of its template's kind", async () => {
    const browser = device();
    const old = new Dexie(browser.name, browser.idb);
    old.version(2).stores({
      documents: "id, updatedAt, template",
      formats: "key, usedAt, tag",
      prefetch: "template",
      packages: "id, lastUsed",
    });
    await old.table("documents").add({
      id: "old-1",
      title: "Mara Quist",
      template: "jake",
      createdAt: 1,
      updatedAt: 2,
      revision: 1,
      document: newSample(),
    });
    old.close();
    const { store } = browser.tab();
    expect(await store.syncRow("old-1")).toMatchObject({
      kind: "template",
      pending: false,
      removed: false,
    });
    expect((await store.places()).get("old-1")).toBe("only-here");
  });

  it("carries the queue's marks made in another tab into the next save of a document a tab holds", async () => {
    const browser = device();
    const tabOne = browser.tab();
    const one = tabOne.store;
    const { store: two } = browser.tab();
    one.setAccount(ADA);
    two.setAccount(ADA);
    const id = await one.create("jake", sample);
    const held = await read(one, id);
    // The sending tab marks what the account took; the first tab saves from its reading.
    await two.markSent(id, 1, 1);
    one.save(id, named(held.document, "Ada"), held.revision);
    await one.flush();
    expect(await one.syncRow(id)).toMatchObject({ serverRevision: 1, pending: true, revision: 2 });
    // Heard, the mark goes with a write that cannot read the row first: the page's last, as it is
    // hidden.
    const heard = new Promise<void>((resolve) => {
      const stop = one.onStored((stored) => {
        if (stored !== id) return;
        stop();
        resolve();
      });
    });
    await two.markSent(id, 2, 2);
    await heard;
    one.save(id, named(held.document, "Bo"), held.revision);
    tabOne.page.hide();
    await eventually(async () => (await one.syncRow(id))?.revision === 3);
    expect(await one.syncRow(id)).toMatchObject({ serverRevision: 2, pending: true });
  });
});

describe("SyncQueue (decision 0092)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  it("inserts a new document under its own id, then updates it naming the account's revision", async () => {
    const accounts = new FakeAccounts();
    const { store, queue } = device().tab();
    await queue.signIn(ADA, accounts.server(ADA));
    const id = await store.create("jake", sample);
    await eventually(() => accounts.document(ADA, id)?.revision === 1);
    expect(accounts.document(ADA, id)).toMatchObject({ kind: "template", templateId: "jake" });
    await eventually(async () => (await store.syncRow(id))?.serverRevision === 1);
    expect((await store.places()).get(id)).toBe("in-account");

    await vi.advanceTimersByTimeAsync(SEND_INTERVAL);
    await rename(store, id, "Ada");
    await eventually(() => accounts.document(ADA, id)?.revision === 2);
    expect(firstName(accounts.document(ADA, id))).toBe("Ada");
    expect(accounts.document(ADA, id)?.title).toBe("Ada Quist");
    await eventually(async () => (await store.syncRow(id))?.pending === false);
    expect(await store.syncRow(id)).toMatchObject({ serverRevision: 2 });
    expect(accounts.count("insert")).toBe(1);
    expect(accounts.count("update")).toBe(1);
  });

  it(`sends a document at most every ${SEND_INTERVAL} ms, and at once when the page is hidden`, async () => {
    const accounts = new FakeAccounts();
    const { store, queue, page } = device().tab();
    await queue.signIn(ADA, accounts.server(ADA));
    const id = await store.create("jake", sample);
    await eventually(() => accounts.count("insert") === 1);
    await quiet(queue);

    // Three saves within the interval: one update, of the last, once the interval is up.
    await rename(store, id, "Ada");
    await rename(store, id, "Bo");
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL / 2);
    await rename(store, id, "Cy");
    await quiet(queue);
    expect(accounts.count("update")).toBe(0);
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL / 2);
    await eventually(() => accounts.count("update") === 1);
    expect(firstName(accounts.document(ADA, id))).toBe("Cy");

    // Hidden: sent at once, whatever the interval.
    await rename(store, id, "Di");
    await quiet(queue);
    expect(accounts.count("update")).toBe(1);
    page.hide();
    await eventually(() => accounts.count("update") === 2);
    expect(firstName(accounts.document(ADA, id))).toBe("Di");
  });

  it(`waits longer after each failure, up to ${MAX_WAIT} ms, keeps saving in the browser, and sends when back`, async () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(waitAfter)).toEqual([
      2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000,
    ]);
    const accounts = new FakeAccounts();
    const { store, queue, page } = device().tab();
    const local = await store.create("jake", sample);
    const server = accounts.server(ADA);
    await queue.signIn(ADA, server);
    await queue.answer("not-now");
    server.goOffline();
    const id = await store.create("jake", sample);
    await eventually(() => server.tries === 2);
    await rename(store, id, "Ada");
    // The save is in the browser, and waits for the account.
    expect(firstName(await store.get(id))).toBe("Ada");
    const places = await queue.places();
    expect(places.get(id)).toBe("waiting");
    expect(places.get(local)).toBe("only-here");
    // Tried again after 2, 4, 8, 16, 32, 60 and 60 seconds.
    for (const wait of [2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]) {
      const tries = server.tries;
      await vi.advanceTimersByTimeAsync(wait - 1);
      await quiet(queue);
      expect(server.tries).toBe(tries);
      await vi.advanceTimersByTimeAsync(1);
      await eventually(() => server.tries === tries + 1);
    }
    // Back: sent at once, without waiting out the minute.
    server.goOnline();
    page.online();
    await eventually(() => firstName(accounts.document(ADA, id)) === "Ada");
    await eventually(async () => (await queue.places()).get(id) === "in-account");
    expect(accounts.count("insert")).toBe(1);
  });

  it("sends from one tab only, the one holding the lock, which a hidden tab hands on", async () => {
    const accounts = new FakeAccounts();
    const locks = new FakeLocks();
    const browser = device();
    const one = browser.tab({ locks });
    const two = browser.tab({ locks });
    await one.queue.signIn(ADA, accounts.server(ADA, "one"));
    await two.queue.signIn(ADA, accounts.server(ADA, "two"));
    // Made in the second tab, sent by the first, which took the lock first.
    const id = await two.store.create("jake", sample);
    await eventually(() => accounts.count("insert") === 1);
    await quiet(one.queue, two.queue);
    expect(accounts.calls.filter((call) => call.method === "insert")).toEqual([
      { account: ADA, device: "one", method: "insert", id },
    ]);
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL);

    // The first tab is hidden: it sends what waits, and the visible tab takes the lock.
    await rename(two.store, id, "Ada");
    one.page.hide();
    await eventually(() => firstName(accounts.document(ADA, id)) === "Ada");
    await quiet(one.queue, two.queue);
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL);
    await rename(two.store, id, "Bo");
    await eventually(() => firstName(accounts.document(ADA, id)) === "Bo");
    const updates = accounts.calls.filter((call) => call.method === "update");
    expect(updates.map((call) => call.device)).toEqual(["one", "two"]);
  });

  it("keeps this device's version as a copy when the account's moved on, and gives the account's the id", async () => {
    const accounts = new FakeAccounts();
    const a = device().tab();
    const b = device().tab();
    const serverB = accounts.server(ADA, "b");
    await a.queue.signIn(ADA, accounts.server(ADA, "a"));
    const id = await a.store.create("jake", sample);
    await eventually(() => accounts.count("insert") === 1);
    await b.queue.signIn(ADA, serverB);
    expect(firstName(await b.store.get(id))).toBe("Mara");

    // B edits offline; meanwhile A's edit reaches the account.
    serverB.goOffline();
    await rename(b.store, id, "Bo");
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL);
    await rename(a.store, id, "Ada");
    await eventually(() => firstName(accounts.document(ADA, id)) === "Ada");

    serverB.goOnline();
    b.page.online();
    await eventually(() => accounts.documents(ADA).length === 2);
    await quiet(b.queue);
    // The account's version has the id in B's browser; B's is a copy, sent like any other.
    expect(firstName(await b.store.get(id))).toBe("Ada");
    const copied = b.events.find((event) => event.type === "copied");
    expect(copied).toEqual({
      type: "copied",
      id,
      copy: expect.any(String),
      title: `Bo Quist${COPY_SUFFIX}`,
      why: "conflict",
    });
    const copy = (copied as { copy: string }).copy;
    expect(firstName(await b.store.get(copy))).toBe("Bo");
    expect(accounts.document(ADA, copy)).toMatchObject({ title: "Bo Quist (from this device)" });
    expect(await titles(b.store)).toEqual(["Ada Quist", "Bo Quist (from this device)"]);
    // Edited, the copy still says what it is.
    await rename(b.store, copy, "Cy");
    expect(await titles(b.store)).toEqual(["Ada Quist", "Cy Quist (from this device)"]);
  });

  it(`brings the account's newer documents in on sign-in, when shown, and every ${REFRESH_INTERVAL / 60_000} minutes while visible`, async () => {
    const accounts = new FakeAccounts();
    const other = accounts.anotherDevice(ADA);
    other.insert({
      id: "doc-1",
      kind: "template",
      templateId: "jake",
      title: "Mara Quist",
      document: newSample(),
    });
    const { store, queue, page } = device().tab();
    await queue.signIn(ADA, accounts.server(ADA));
    expect(await titles(store)).toEqual(["Mara Quist"]);
    expect(await store.syncRow("doc-1")).toMatchObject({
      owner: ADA,
      serverRevision: 1,
      pending: false,
    });
    const renamed = (first: string) => () => ({
      title: `${first} Quist`,
      document: named(newSample(), first),
    });

    // Shown again after another device's change.
    other.change("doc-1", renamed("Ada"));
    page.hide();
    page.show();
    await eventually(async () => firstName(await store.syncRow("doc-1")) === "Ada");

    // Five minutes on, while visible.
    other.change("doc-1", renamed("Bo"));
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL - 1);
    await quiet(queue);
    expect(firstName(await store.syncRow("doc-1"))).toBe("Ada");
    await vi.advanceTimersByTimeAsync(1);
    await eventually(async () => firstName(await store.syncRow("doc-1")) === "Bo");

    // Hidden, it asks nothing.
    page.hide();
    const lists = accounts.count("list");
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL * 2);
    await quiet(queue);
    expect(accounts.count("list")).toBe(lists);
    // Nothing brought in is sent back.
    expect(accounts.count("update")).toBe(0);
    expect(accounts.document(ADA, "doc-1")?.revision).toBe(3);
  });

  it("tells a tab holding a document the account changed, with nothing pending here, that it changed on another device", async () => {
    const accounts = new FakeAccounts();
    const browser = device();
    const locks = new FakeLocks();
    const one = browser.tab({ locks });
    const two = browser.tab({ locks });
    await one.queue.signIn(ADA, accounts.server(ADA));
    await two.queue.signIn(ADA, accounts.server(ADA));
    const id = await one.store.create("jake", sample);
    await eventually(() => accounts.count("insert") === 1);
    await eventually(async () => (await one.store.syncRow(id))?.pending === false);
    // The document is open in both tabs; the account gets another device's change.
    await read(one.store, id);
    await read(two.store, id);
    const heard = new Promise<[string, string | undefined]>((resolve) =>
      two.store.onChanged((changed, by) => resolve([changed, by])),
    );
    accounts.anotherDevice(ADA).change(id, () => ({ document: named(newSample(), "Ada") }));
    one.page.hide();
    one.page.show();
    // Written through the store: the tab that brought it in, and the other, both hear it.
    expect(await heard).toEqual([id, "device"]);
    await eventually(() => one.events.some((event) => event.type === "changed"));
    expect(one.events).toContainEqual({ type: "changed", id });
    expect(two.events).toContainEqual({ type: "changed", id });
    expect(firstName(await two.store.get(id))).toBe("Ada");
    expect(one.events.some((event) => event.type === "copied")).toBe(false);
  });

  it("asks on the first sign-in whether to add the documents only in this browser, and uploads none until told", async () => {
    const accounts = new FakeAccounts();
    const { store, queue, events } = device().tab();
    const first = await store.create("jake", sample);
    const second = await store.create("jake", sample, "en-GB", "pdf");
    await queue.signIn(ADA, accounts.server(ADA));
    expect(events).toContainEqual({ type: "question", count: 2 });
    expect(queue.asking).toBe(2);
    await quiet(queue);
    expect(accounts.count("insert")).toBe(0);
    expect((await queue.places()).get(first)).toBe("only-here");

    await queue.answer("add");
    expect(queue.asking).toBe(0);
    await eventually(() => accounts.documents(ADA).length === 2);
    expect(accounts.document(ADA, second)?.kind).toBe("pdf");
    await eventually(async () => (await queue.places()).get(first) === "in-account");
  });

  it('remembers "Not now" for the account, and adds a document later when asked to', async () => {
    const accounts = new FakeAccounts();
    const { store, queue, events } = device().tab();
    const first = await store.create("jake", sample);
    const second = await store.create("jake", sample);
    await queue.signIn(ADA, accounts.server(ADA));
    await queue.answer("not-now");
    await quiet(queue);
    expect(accounts.count("insert")).toBe(0);
    expect(await queue.signOut()).toEqual({ done: true });
    // The documents only in this browser stay; signed in again, nothing is asked.
    expect((await store.list()).length).toBe(2);
    await queue.signIn(ADA, accounts.server(ADA));
    expect(events.filter((event) => event.type === "question")).toHaveLength(1);
    // Another account is asked for itself.
    queue.stop();
    await queue.signIn(BO, accounts.server(BO));
    expect(events.filter((event) => event.type === "question")).toHaveLength(2);
    queue.stop();

    await queue.signIn(ADA, accounts.server(ADA));
    await queue.addToAccount(first);
    await eventually(() => accounts.document(ADA, first) !== undefined);
    await quiet(queue);
    expect(accounts.document(ADA, second)).toBeUndefined();
    expect((await queue.places()).get(second)).toBe("only-here");
  });

  it("signs out by sending what is pending, then removing the account's documents and imports; those of no account stay", async () => {
    const accounts = new FakeAccounts();
    const browser = device();
    const { store, queue } = browser.tab();
    const local = await store.create("jake", sample);
    await queue.signIn(ADA, accounts.server(ADA));
    await queue.answer("not-now");
    const id = await store.create("jake", sample);
    const tex = await store.importDocument(imported());
    await eventually(() => accounts.documents(ADA).length === 2);
    await quiet(queue);
    // Saved within the interval: still pending when the person signs out.
    await rename(store, id, "Ada");
    await quiet(queue);
    expect(firstName(accounts.document(ADA, id))).toBe("Mara");

    expect(await queue.signOut()).toEqual({ done: true });
    expect(firstName(accounts.document(ADA, id))).toBe("Ada");
    expect(accounts.document(ADA, tex)?.kind).toBe("tex");
    expect((await store.syncRows()).map((row) => row.id)).toEqual([local]);
    expect(await browser.table("packages")).toEqual([]);
    expect(await titles(store)).toEqual(["Mara Quist"]);
    expect(queue.account).toBeUndefined();
  });

  it("names the documents it could not send at sign-out, and removes nothing until told to go on", async () => {
    const accounts = new FakeAccounts();
    const { store, queue } = device().tab();
    const server = accounts.server(ADA);
    await queue.signIn(ADA, server);
    const id = await store.create("jake", sample);
    await eventually(() => accounts.count("insert") === 1);
    server.goOffline();
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL);
    await rename(store, id, "Ada");
    const unsent = await store.create("jake", sample);

    expect(await queue.signOut()).toEqual({
      done: false,
      unsent: expect.arrayContaining([
        { id, title: "Ada Quist" },
        { id: unsent, title: "Mara Quist" },
      ]),
    });
    expect((await store.list()).length).toBe(2);
    expect(queue.account).toBe(ADA);

    expect(await queue.signOut({ discard: true })).toEqual({ done: true });
    expect(await store.syncRows()).toEqual([]);
    expect(firstName(accounts.document(ADA, id))).toBe("Mara");
  });

  it("shows another account only its own documents and those of none, and drops the first's that hold nothing pending", async () => {
    const accounts = new FakeAccounts();
    const { store, queue } = device().tab();
    const local = await store.create("jake", sample);
    const serverA = accounts.server(ADA, "ada");
    await queue.signIn(ADA, serverA);
    await queue.answer("not-now");
    const sent = await store.create("jake", sample);
    await eventually(() => accounts.count("insert") === 1);
    await quiet(queue);
    serverA.goOffline();
    const waiting = await store.create("jake", sample);
    await rename(store, waiting, "Ada");
    // Ada's session ends without a sign-out, and Bo signs in on the same browser.
    queue.stop();
    await queue.signIn(BO, accounts.server(BO, "bo"));
    const bos = await store.create("jake", sample);
    await rename(store, bos, "Bo");
    expect((await store.list()).map((each) => each.id).sort()).toEqual([bos, local].sort());
    expect(await store.get(waiting)).toBeUndefined();
    // Ada's sent document went; the one with pending saves stays, out of sight.
    const left = (await store.syncRows()).map((row) => row.id);
    expect(left).not.toContain(sent);
    expect(left).toContain(waiting);
    await eventually(() => accounts.document(BO, bos) !== undefined);
    await quiet(queue);
    expect(
      accounts.calls.filter((call) => call.device === "bo").map((call) => call.id),
    ).not.toContain(waiting);

    // Ada signs in again: her pending document is hers to see and send.
    queue.stop();
    serverA.goOnline();
    await queue.signIn(ADA, serverA);
    expect((await store.list()).map((each) => each.id)).toContain(waiting);
    await eventually(() => firstName(accounts.document(ADA, waiting)) === "Ada");
  });

  it("deletes a document from the account and this browser, and another device lets it go once the account lists it no more", async () => {
    const accounts = new FakeAccounts();
    const a = device().tab();
    const b = device().tab();
    const serverA = accounts.server(ADA, "a");
    await a.queue.signIn(ADA, serverA);
    const id = await a.store.create("jake", sample);
    await eventually(() => accounts.count("insert") === 1);
    await b.queue.signIn(ADA, accounts.server(ADA, "b"));
    expect(await titles(b.store)).toEqual(["Mara Quist"]);

    // Deleted offline: gone from A's list at once, and not brought back meanwhile.
    serverA.goOffline();
    await a.queue.remove(id);
    expect(await a.store.list()).toEqual([]);
    expect(await a.store.get(id)).toBeUndefined();
    expect((await a.store.syncRow(id))?.removed).toBe(true);
    serverA.goOnline();
    a.page.hide();
    a.page.show();
    await eventually(() => accounts.document(ADA, id) === undefined);
    await eventually(async () => (await a.store.syncRow(id)) === undefined);
    expect(a.events).toContainEqual({ type: "removed", id });

    // B learns of it from the list.
    await read(b.store, id);
    b.page.hide();
    b.page.show();
    await eventually(async () => (await b.store.syncRow(id)) === undefined);
    expect(b.events).toContainEqual({ type: "removed", id });
    expect(b.events.some((event) => event.type === "copied")).toBe(false);
    expect(await b.store.list()).toEqual([]);
  });

  it("keeps as a copy a document deleted on another device that has pending saves here", async () => {
    const accounts = new FakeAccounts();
    const a = device().tab();
    const b = device().tab();
    const serverB = accounts.server(ADA, "b");
    await a.queue.signIn(ADA, accounts.server(ADA, "a"));
    const id = await a.store.create("jake", sample);
    await eventually(() => accounts.count("insert") === 1);
    await b.queue.signIn(ADA, serverB);
    serverB.goOffline();
    await rename(b.store, id, "Bo");
    await a.queue.remove(id);
    // A deletion is sent as a save is, at most every interval.
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL);
    await eventually(() => accounts.document(ADA, id) === undefined);

    serverB.goOnline();
    b.page.online();
    await eventually(() => b.events.some((event) => event.type === "copied"));
    const copied = b.events.find((event) => event.type === "copied") as Extract<
      SyncEvent,
      { type: "copied" }
    >;
    expect(copied).toMatchObject({ id, why: "deleted", title: `Bo Quist${COPY_SUFFIX}` });
    await eventually(() => firstName(accounts.document(ADA, copied.copy)) === "Bo");
    expect(await b.store.syncRow(id)).toBeUndefined();
    expect(await titles(b.store)).toEqual([`Bo Quist${COPY_SUFFIX}`]);
  });

  it("takes the account's version as its own when it holds the same document, making no copy", async () => {
    const accounts = new FakeAccounts();
    const { store, queue } = device().tab();
    const server = accounts.server(ADA);
    await queue.signIn(ADA, server);
    // An insert whose answer was lost: the account has the row, the browser does not know it.
    server.goOffline();
    const id = await store.create("jake", sample);
    const row = await store.syncRow(id);
    accounts.anotherDevice(ADA).insert({
      id,
      kind: "template",
      templateId: "jake",
      title: "Mara Quist",
      document: row?.document,
    });
    server.goOnline();
    await queue.signIn(ADA, server);
    await eventually(async () => (await store.syncRow(id))?.serverRevision === 1);
    await quiet(queue);
    expect(await store.syncRow(id)).toMatchObject({ pending: false });
    expect(accounts.documents(ADA)).toHaveLength(1);
    expect((await store.list()).length).toBe(1);
  });

  it("calls item 8's hooks for an imported .tex document: after it is sent, before it is deleted, after it is brought in", async () => {
    const accounts = new FakeAccounts();
    const hooks = { sent: vi.fn(async () => {}), removing: vi.fn(async () => {}) };
    const broughtIn = vi.fn(async () => {});
    const a = device().tab({ hooks });
    const b = device().tab({ hooks: { broughtIn } });
    await a.queue.signIn(ADA, accounts.server(ADA, "a"));
    const tex = await a.store.importDocument(imported());
    const plain = await a.store.create("jake", sample);
    await eventually(() => hooks.sent.mock.calls.length === 1);
    await eventually(() => accounts.documents(ADA).length === 2);
    expect(hooks.sent.mock.calls).toEqual([[tex, true]]);
    await b.queue.signIn(ADA, accounts.server(ADA, "b"));
    expect(broughtIn.mock.calls).toEqual([[tex]]);
    await a.queue.remove(tex);
    await a.queue.remove(plain);
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL);
    await eventually(() => accounts.documents(ADA).length === 0);
    expect(hooks.removing.mock.calls).toEqual([[tex]]);
  });
});

/** `doc` with its first name set as it is, past the editor's commands and their bounds. */
const withFirst = (doc: Document, first: string): Document => ({
  ...doc,
  resume: {
    ...doc.resume,
    header: { ...doc.resume.header, name: { ...doc.resume.header.name, first } },
  },
});

/** Save `doc` with its first name set as it is, and write it at once. */
async function saveFirst(store: DocumentStore, id: string, first: string) {
  const { document, revision } = await read(store, id);
  store.save(id, withFirst(document, first), revision);
  await store.flush();
}

describe("what is sent, and what the account refuses (decision 0098)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  it("cleans every string of an upload: no U+0000, lone surrogates replaced, the title cut", () => {
    const upload = {
      id: "doc-1",
      kind: "template" as const,
      templateId: "ja\u0000ke",
      title: `${"\u{1F600}".repeat(MAX_SENT_TITLE)}tail`,
      document: {
        "na\u0000me": ["Ada\u0000", "\uD800x", "y\uDC00", "\uD83D\uDE00"],
        n: 1,
        ok: true,
      },
    };
    const cleaned = cleanUpload(upload);
    expect(cleaned.templateId).toBe("jake");
    // Characters, not UTF-16 units: no pair is split.
    expect(Array.from(cleaned.title)).toHaveLength(MAX_SENT_TITLE);
    expect(cleaned.title).toBe("\u{1F600}".repeat(MAX_SENT_TITLE));
    expect(JSON.stringify(cleaned.document)).toBe(
      JSON.stringify({ name: ["Ada", "\uFFFDx", "y\uFFFD", "\uD83D\uDE00"], n: 1, ok: true }),
    );
    // What it was given is left as it was.
    expect(upload.templateId).toBe("ja\u0000ke");
    // A document over the bound, as compact JSON in UTF-8 bytes, is refused unsent.
    const large = { ...upload, document: "é".repeat(MAX_DOCUMENT_BYTES / 2) };
    expect(() => cleanUpload(large)).toThrow(ServerRefused);
    expect(() =>
      cleanUpload({ ...upload, document: "é".repeat(MAX_DOCUMENT_BYTES / 2 - 2) }),
    ).not.toThrow();
  });

  it("sends a document holding U+0000 and a lone surrogate cleaned, which the account takes", async () => {
    const accounts = new FakeAccounts();
    const { store, queue } = device().tab();
    await queue.signIn(ADA, accounts.server(ADA));
    const id = await store.create("jake", sample);
    await eventually(() => accounts.count("insert") === 1);
    await quiet(queue);
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL);
    await saveFirst(store, id, "A\u0000da\uD800");
    await eventually(() => accounts.document(ADA, id)?.revision === 2);
    expect(firstName(accounts.document(ADA, id))).toBe("Ada\uFFFD");
    expect(accounts.document(ADA, id)?.title).toBe("Ada\uFFFD Quist");
    await eventually(async () => (await store.places()).get(id) === "in-account");
  });

  it("refuses a document too large without a request, and sends it again only once a save changes it", async () => {
    const accounts = new FakeAccounts();
    const { store, queue, events } = device().tab();
    const server = accounts.server(ADA);
    await queue.signIn(ADA, server);
    const id = await store.create("jake", sample);
    await eventually(() => accounts.count("insert") === 1);
    await quiet(queue);
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL);
    const tries = server.tries;
    await saveFirst(store, id, "x".repeat(MAX_DOCUMENT_BYTES));
    await eventually(() => events.some((event) => event.type === "refused"));
    expect(events).toContainEqual({ type: "refused", id, title: expect.any(String) });
    expect(server.tries).toBe(tries);
    expect((await store.places()).get(id)).toBe("refused");
    // Never tried again, however long it waits; the account keeps what it had.
    await vi.advanceTimersByTimeAsync(MAX_WAIT * 3);
    await quiet(queue);
    expect(accounts.count("update")).toBe(0);
    expect(firstName(accounts.document(ADA, id))).toBe("Mara");

    // A save that brings it within the bound is sent.
    await saveFirst(store, id, "Ada");
    await eventually(() => accounts.count("update") === 1);
    expect(firstName(accounts.document(ADA, id))).toBe("Ada");
    await eventually(async () => (await store.places()).get(id) === "in-account");
  });

  it("takes the account's refusal as final: kept here, not retried, not by another tab, and named at sign-out", async () => {
    const accounts = new FakeAccounts();
    const browser = device();
    const { store, queue, events } = browser.tab();
    const server = accounts.server(ADA);
    server.refuse("23514");
    await queue.signIn(ADA, server);
    const id = await store.create("jake", sample);
    await eventually(() => events.some((event) => event.type === "refused"));
    expect(accounts.count("insert")).toBe(1);
    expect(accounts.documents(ADA)).toEqual([]);
    expect((await store.places()).get(id)).toBe("refused");
    expect(await titles(store)).toEqual(["Mara Quist"]);

    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL);
    await quiet(queue);
    expect(accounts.count("insert")).toBe(1);
    // Another tab, or the page loaded again, does not send it either: the mark is in the store.
    const other = browser.tab();
    await other.queue.signIn(ADA, accounts.server(ADA, "other"));
    await quiet(queue, other.queue);
    expect(accounts.count("insert")).toBe(1);
    other.queue.stop();

    // Signing out names it, since the account does not have it, and removes nothing.
    expect(await queue.signOut()).toEqual({
      done: false,
      unsent: [{ id, title: "Mara Quist", refused: true }],
    });
    expect(accounts.count("insert")).toBe(1);

    // A later save is sent again, and taken once the account takes it.
    server.accept();
    await rename(store, id, "Ada");
    await eventually(() => firstName(accounts.document(ADA, id)) === "Ada");
    expect(accounts.count("insert")).toBe(2);
    await eventually(async () => (await store.places()).get(id) === "in-account");
  });

  it("sends a deletion made while a refused update was on its way", async () => {
    const accounts = new FakeAccounts();
    const { store, queue } = device().tab();
    const server = accounts.server(ADA);
    await queue.signIn(ADA, server);
    const id = await store.create("jake", sample);
    await eventually(() => accounts.count("insert") === 1);
    await quiet(queue);
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL);

    // An update the account will refuse is on its way when the person deletes the document.
    server.refuse("23514");
    const release = server.pause();
    const tries = server.tries;
    await rename(store, id, "Ada");
    await eventually(() => server.tries > tries);
    await queue.remove(id);
    release();
    await eventually(() => accounts.count("update") === 1);
    await quiet(queue);
    server.accept();
    await vi.advanceTimersByTimeAsync(MAX_WAIT * 3);
    await quiet(queue);

    // The refusal was of the content; the deletion goes, and nothing is left behind.
    expect(accounts.count("remove")).toBe(1);
    expect(accounts.document(ADA, id)).toBeUndefined();
    expect(await store.syncRows()).toEqual([]);
    expect(await queue.signOut()).toEqual({ done: true });
  });

  it("takes its own cleaned write, come back as a conflict, as the same document and not a copy", async () => {
    const accounts = new FakeAccounts();
    const { store, queue, events } = device().tab();
    const inner = accounts.server(ADA);
    // The account takes an update, and the answer is lost on the way back.
    let loseAnswer = false;
    const server: SyncServer = {
      list: () => inner.list(),
      get: (id) => inner.get(id),
      insert: (doc) => inner.insert(doc),
      update: async (doc, expected) => {
        const result = await inner.update(doc, expected);
        if (loseAnswer) {
          loseAnswer = false;
          throw new ServerUnavailable();
        }
        return result;
      },
      remove: (id) => inner.remove(id),
    };
    await queue.signIn(ADA, server);
    const id = await store.create("jake", sample);
    await eventually(() => accounts.count("insert") === 1);
    await quiet(queue);
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL);

    loseAnswer = true;
    await saveFirst(store, id, "A\u0000da");
    await eventually(() => accounts.count("update") === 1);
    // Tried again over the revision it last knew: a conflict, with what it sent itself, cleaned.
    await vi.advanceTimersByTimeAsync(MAX_WAIT);
    await eventually(() => accounts.count("update") === 2);
    await quiet(queue);
    expect(events.filter((event) => event.type === "copied")).toEqual([]);
    expect(await store.list()).toHaveLength(1);
    expect(firstName(accounts.document(ADA, id))).toBe("Ada");
    expect(accounts.documents(ADA)).toHaveLength(1);
    await eventually(async () => (await store.places()).get(id) === "in-account");
  });
});
