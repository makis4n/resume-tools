import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apply, type Document, newDocument } from "../editor/document";
import { curated } from "../templates/curated";
import {
  CANNOT_OPEN,
  canLeave,
  DocumentRefused,
  DocumentStore,
  type Flushed,
  MAX_FORMATS,
  MAX_PATHS,
  type PageEvents,
  RETRY_DELAY,
  SAVE_DELAY,
  type Stored,
  titleOf,
} from "./store";

const { sample } = curated("jake");

/** A page whose going away the test decides. */
class FakePage implements PageEvents {
  window = new EventTarget();
  document = Object.assign(new EventTarget(), { visibilityState: "visible" });

  /** The tab is switched away from, or the window minimised. */
  hide() {
    this.document.visibilityState = "hidden";
    this.document.dispatchEvent(new Event("visibilitychange"));
  }

  show() {
    this.document.visibilityState = "visible";
    this.document.dispatchEvent(new Event("visibilitychange"));
  }

  /** The page is closed, reloaded or navigated away from. */
  leave() {
    this.window.dispatchEvent(new Event("pagehide"));
  }
}

let databases = 0;
const opened: DocumentStore[] = [];

/** A store over a database of its own, on a page of its own. */
function storeForTest() {
  const name = `resume-tools-test-${++databases}`;
  return { ...anotherTab(name), name };
}

/** A store over the database `name`, as another tab of the editor would open it. */
function anotherTab(name: string) {
  const page = new FakePage();
  const store = new DocumentStore({ name, page });
  opened.push(store);
  return { store, page };
}

/** What a table holds, read past the store over a connection of its own, as another tab would. */
async function inDatabase<T>(name: string, read: (db: Dexie) => Promise<T>): Promise<T> {
  const db = new Dexie(name);
  await db.open();
  try {
    return await read(db);
  } finally {
    db.close();
  }
}

/** A document's row as the database holds it, whatever the store has waiting. */
const storedRow = (name: string, id: string) =>
  inDatabase(name, (db) => db.table("documents").get(id));

/** The first name of a document as the database holds it, whatever the store has waiting. */
const storedName = async (name: string, id: string) =>
  ((await storedRow(name, id))?.document as Document | undefined)?.resume.header.name.first;

/** Wait for `check` to hold, without asking the store to write. */
async function eventually(check: () => Promise<boolean> | boolean) {
  for (let tries = 0; tries < 200; tries++) {
    if (await check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("what was expected never came about");
}

/** A document as the store reads it, which must be there. */
async function read(store: DocumentStore, id: string): Promise<Stored> {
  const stored = await store.get(id);
  if (stored === undefined) throw new Error(`${id} is not stored`);
  return stored;
}

const text = (doc: Document, field: string, value: string) =>
  apply(doc, { type: "text", field, text: value });
const named = (doc: Document, first: string) => text(doc, "header.first", first);

/** What a flush says it did. */
const flushed = (written: number, failed: string[] = [], conflicts: string[] = []): Flushed => ({
  written,
  failed,
  conflicts,
});

/**
 * Have IndexedDB refuse the next put into `table`, or every one, as it does once the site's
 * storage is full; returns how many it has refused.
 */
function diskFull(table: string, { always = false } = {}) {
  const put = IDBObjectStore.prototype.put;
  let refused = 0;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore["put"]>
  ) {
    if (this.name === table && (always || refused === 0)) {
      refused++;
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    }
    return put.apply(this, args);
  });
  return () => refused;
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const store of opened.splice(0)) await store.close();
});

describe("DocumentStore", () => {
  it("keeps a document, and gives it back as last saved, with its revision", async () => {
    const { store } = storeForTest();
    const id = await store.create("jake", sample, "en-GB");
    const created = await read(store, id);
    expect(created).toEqual({ document: newDocument("jake", sample, "en-GB"), revision: 1 });
    const edited = named(created.document, "Ada");
    store.save(id, edited, created.revision);
    // A read writes what waits first, so it sees the save, one revision on.
    expect(await store.get(id)).toEqual({ document: edited, revision: 2 });
    expect(await store.list()).toEqual([
      {
        id,
        title: "Ada Quist",
        template: "jake",
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      },
    ]);
    expect(await store.get("nowhere")).toBeUndefined();
    await expect(store.create("nope", sample)).rejects.toThrow("no curated template has the id");
  });

  it("titles a document after the name in its header", () => {
    const withName = (first: string, last: string) =>
      titleOf({ ...sample, header: { ...sample.header, name: { first, last } } });
    expect(withName("Mara", "Quist")).toBe("Mara Quist");
    expect(withName(" Mara ", "")).toBe("Mara");
    expect(withName("Jo\nAnn", " Lee ")).toBe("Jo Ann Lee");
    expect(withName(" ", "")).toBe("Untitled");
  });

  it("lists documents most recently edited first", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { store } = storeForTest();
    vi.setSystemTime(1_000);
    const first = await store.create("jake", sample);
    vi.setSystemTime(2_000);
    const second = await store.create("jake", sample);
    expect((await store.list()).map((summary) => summary.id)).toEqual([second, first]);
    vi.setSystemTime(3_000);
    store.save(first, named(newDocument("jake", sample), "Ada"), 1);
    const listed = await store.list();
    expect(listed.map((summary) => summary.id)).toEqual([first, second]);
    // Edited, not made again.
    expect(listed[0]).toMatchObject({ createdAt: 1_000, updatedAt: 3_000 });
  });

  it("leaves out of the list a row it cannot show, and says so once", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store, name } = storeForTest();
    const id = await store.create("jake", sample);
    // Rows another writer on the origin put there: a title React cannot render, and times the
    // list cannot tell, which sort first.
    await inDatabase(name, async (db) => {
      const documents = db.table("documents");
      await documents.put({
        id: "object-title",
        title: { text: "Ada" },
        template: "jake",
        createdAt: 1,
        updatedAt: Number.POSITIVE_INFINITY,
        document: { version: 2 },
      });
      await documents.put({
        id: "no-time",
        title: "Bo",
        template: "jake",
        createdAt: 1,
        updatedAt: Number.NEGATIVE_INFINITY,
        document: { version: 2 },
      });
    });
    expect((await store.list()).map((summary) => summary.id)).toEqual([id]);
    expect(warned).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalledWith(expect.stringContaining("2 stored documents"));
  });

  it("deletes a document, and a save of it still waiting", async () => {
    const { store, name } = storeForTest();
    const kept = await store.create("jake", sample);
    const id = await store.create("jake", sample);
    store.save(id, named(newDocument("jake", sample), "Ada"), 1);
    await store.remove(id);
    await store.flush();
    expect(await store.get(id)).toBeUndefined();
    expect(await storedName(name, id)).toBeUndefined();
    expect((await store.list()).map((summary) => summary.id)).toEqual([kept]);
  });

  it("deletes a document asked for while a write of it is on its way", async () => {
    const { store, name } = storeForTest();
    const id = await store.create("jake", sample);
    store.save(id, named(newDocument("jake", sample), "Ada"), 1);
    const flushing = store.flush();
    const removing = store.remove(id);
    expect(await flushing).toEqual(flushed(1));
    await removing;
    expect(await storedRow(name, id)).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it("writes saves at most twice a second, and at once when the page is hidden or left", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { store, name, page } = storeForTest();
    const id = await store.create("jake", sample);
    const doc = newDocument("jake", sample);

    // Two saves within the delay are one write, of the second, when the delay is up.
    store.save(id, named(doc, "Ada"), 1);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY / 2);
    store.save(id, named(doc, "Bo"), 1);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY / 2 - 1);
    expect(await storedName(name, id)).toBe("Mara");
    await vi.advanceTimersByTimeAsync(1);
    await eventually(async () => (await storedName(name, id)) === "Bo");

    // Hidden: written at once. Shown again: nothing to do.
    store.save(id, named(doc, "Cy"), 1);
    page.show();
    expect(vi.getTimerCount()).toBe(1);
    page.hide();
    expect(vi.getTimerCount()).toBe(0);
    await eventually(async () => (await storedName(name, id)) === "Cy");

    // Left: written at once.
    store.save(id, named(doc, "Di"), 1);
    page.leave();
    expect(vi.getTimerCount()).toBe(0);
    await eventually(async () => (await storedName(name, id)) === "Di");

    // A flush writes what waits, and settles once it is written.
    store.save(id, named(doc, "Ed"), 1);
    expect(await store.flush()).toEqual(flushed(1));
    expect(await storedName(name, id)).toBe("Ed");

    // Closing writes what waits, and stops listening to the page.
    store.save(id, named(doc, "Flo"), 1);
    await store.close();
    expect(await storedName(name, id)).toBe("Flo");
    page.leave();
  });

  it.each([
    ["left", (page: FakePage) => page.leave()],
    ["hidden", (page: FakePage) => page.hide()],
  ])("puts and commits what waits before its next task, when the page is %s", async (_, away) => {
    const { store, name, page } = storeForTest();
    const id = await store.create("jake", sample);
    const { document, revision } = await read(store, id);
    const asked: string[] = [];
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      asked.push(`put ${this.name}`);
      return put.apply(this, args);
    });
    const commit = IDBTransaction.prototype.commit;
    vi.spyOn(IDBTransaction.prototype, "commit").mockImplementation(function (
      this: IDBTransaction,
    ) {
      asked.push("commit");
      commit.call(this);
    });
    store.save(id, named(document, "Ada"), revision);
    away(page);
    // A page going away runs what its events asked for, and perhaps not one task more.
    const beforeNextTask = await new Promise<string[]>((resolve) =>
      setImmediate(() => resolve([...asked])),
    );
    expect(beforeNextTask).toEqual(["put documents", "commit"]);
    await eventually(async () => (await storedName(name, id)) === "Ada");
  });

  it("refuses a document the model refuses, as a newer editor's, and leaves it stored", async () => {
    const { store, name } = storeForTest();
    const id = await store.create("jake", sample);
    await inDatabase(name, async (db) => {
      const row = await db.table("documents").get(id);
      await db.table("documents").put({ ...row, document: { ...row.document, version: 2 } });
    });
    const refused = await store.get(id).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(DocumentRefused);
    expect((refused as Error).message).toBe(CANNOT_OPEN);
    expect((await store.list()).map((summary) => summary.id)).toEqual([id]);
    expect(await inDatabase(name, (db) => db.table("documents").count())).toBe(1);
  });

  it("reads a row written before revisions as revision 0, and saves it on from there", async () => {
    const { store, name } = storeForTest();
    const id = await store.create("jake", sample);
    await inDatabase(name, async (db) => {
      const { revision: _, ...row } = await db.table("documents").get(id);
      await db.table("documents").put(row);
    });
    const old = await read(store, id);
    expect(old.revision).toBe(0);
    store.save(id, named(old.document, "Ada"), old.revision);
    expect(await store.flush()).toEqual(flushed(1));
    expect(await storedRow(name, id)).toMatchObject({ revision: 1, title: "Ada Quist" });
  });
});

describe("DocumentStore when a write fails", () => {
  it("keeps the save, says so, and writes it at the next flush", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, name } = storeForTest();
    const id = await store.create("jake", sample);
    const { document, revision } = await read(store, id);
    const refused = diskFull("documents");
    store.save(id, named(document, "Ada"), revision);
    expect(await store.flush()).toEqual(flushed(0, [id]));
    expect(refused()).toBe(1);
    expect(errors).toHaveBeenCalledWith(
      "The document could not be saved in this browser",
      expect.objectContaining({ name: "QuotaExceededError" }),
    );
    expect(await storedName(name, id)).toBe("Mara");
    // The disk has room again, and the save is still there to be written.
    expect(await store.flush()).toEqual(flushed(1));
    expect(await storedName(name, id)).toBe("Ada");
    expect((await store.list()).map((summary) => summary.title)).toEqual(["Ada Quist"]);
  });

  it(`tries a failed save again by itself, no sooner than ${RETRY_DELAY} ms on`, async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, name } = storeForTest();
    const id = await store.create("jake", sample);
    const { document, revision } = await read(store, id);
    const results: Flushed[] = [];
    store.onFlushed((result) => results.push(result));
    const refused = diskFull("documents");
    store.save(id, named(document, "Ada"), revision);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);
    await eventually(() => refused() === 1 && results.length === 1);
    expect(results).toEqual([flushed(0, [id])]);
    // A save meanwhile waits for the retry rather than bring it on.
    store.save(id, named(document, "Bo"), revision);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY - 1);
    expect(results).toHaveLength(1);
    expect(await storedName(name, id)).toBe("Mara");
    await vi.advanceTimersByTimeAsync(1);
    await eventually(() => results.length === 2);
    expect(results[1]).toEqual(flushed(1));
    expect(await storedName(name, id)).toBe("Bo");
  });

  it("writes in the same flush a save made while a failing write was on its way", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, name } = storeForTest();
    const id = await store.create("jake", sample);
    const { document, revision } = await read(store, id);
    diskFull("documents");
    store.save(id, named(document, "Ada"), revision);
    const flushing = store.flush();
    store.save(id, named(document, "Bo"), revision);
    expect(await flushing).toEqual(flushed(1));
    expect(await storedName(name, id)).toBe("Bo");
    // The failed save was the older one, so nothing waits.
    expect(await store.flush()).toEqual(flushed(0));
  });

  it("makes room for a document that does not fit by dropping a kept format", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, name } = storeForTest();
    await store.formatsFor("build-1").put("pdftex", "jake-0123abcd", new Uint8Array([1]));
    const id = await store.create("jake", sample);
    const { document, revision } = await read(store, id);
    diskFull("documents");
    store.save(id, named(document, "Ada"), revision);
    expect(await store.flush()).toEqual(flushed(0, [id]));
    await eventually(
      async () => (await inDatabase(name, (db) => db.table("formats").count())) === 0,
    );
    expect(await store.flush()).toEqual(flushed(1));
  });

  it("lets the editor leave a document only once nothing of it was left unwritten", () => {
    expect(canLeave(flushed(0))).toBe(true);
    expect(canLeave(flushed(2))).toBe(true);
    expect(canLeave(flushed(0, ["a"]))).toBe(false);
    expect(canLeave(flushed(1, [], ["a"]))).toBe(false);
  });
});

describe("DocumentStore across tabs", () => {
  it("refuses a save made over another tab's write, and leaves that write alone", async () => {
    // No channel: the write's own check is what finds the other tab's write.
    vi.stubGlobal("BroadcastChannel", undefined);
    const { store: one, name } = storeForTest();
    const { store: two } = anotherTab(name);
    const id = await one.create("jake", sample);
    const first = await read(one, id);
    // A new tab opens the most recent document, and is worked in.
    const second = await read(two, id);
    const work = text(second.document, "header.headline", "Staff engineer, payments");
    two.save(id, text(work, "header.email", "ada@example.test"), second.revision);
    expect(await two.flush()).toEqual(flushed(1));

    // Back in the first tab, which holds the document as it read it, one keystroke.
    const changed = vi.fn();
    one.onChanged(changed);
    one.save(id, text(first.document, "header.location", "Lisbon"), first.revision);
    expect(await one.flush()).toEqual(flushed(0, [], [id]));
    expect(changed.mock.calls).toEqual([[id]]);
    const row = await storedRow(name, id);
    expect(row).toMatchObject({ revision: 2 });
    expect(row.document.resume.header).toMatchObject({
      headline: "Staff engineer, payments",
      email: "ada@example.test",
    });
    expect(row.document.resume.header.location).toBeUndefined();

    // Nothing more of that reading is written; read again, the document takes saves again.
    one.save(id, text(first.document, "header.location", "Porto"), first.revision);
    expect(await one.flush()).toEqual(flushed(0, [], [id]));
    expect(changed).toHaveBeenCalledTimes(1);
    const again = await read(one, id);
    expect(again.revision).toBe(2);
    one.save(id, text(again.document, "header.location", "Lisbon"), again.revision);
    expect(await one.flush()).toEqual(flushed(1));
    expect((await storedRow(name, id)).document.resume.header).toMatchObject({
      headline: "Staff engineer, payments",
      location: "Lisbon",
    });
  });

  it("hears another tab write or delete a document it holds, and stops writing it", async () => {
    const { store: one, name } = storeForTest();
    const { store: two } = anotherTab(name);
    const id = await one.create("jake", sample);
    const first = await read(one, id);
    const second = await read(two, id);
    const heard = new Promise<string>((resolve) => one.onChanged(resolve));
    two.save(id, text(second.document, "header.headline", "Staff engineer"), second.revision);
    await two.flush();
    expect(await heard).toBe(id);

    // Told, the first tab refuses its save without asking the database.
    const puts = vi.spyOn(IDBObjectStore.prototype, "put");
    one.save(id, text(first.document, "header.location", "Lisbon"), first.revision);
    expect(await one.flush()).toEqual(flushed(0, [], [id]));
    expect(puts).not.toHaveBeenCalled();

    // Read again, it hears of a delete.
    await read(one, id);
    const deleted = new Promise<string>((resolve) => one.onChanged(resolve));
    await two.remove(id);
    expect(await deleted).toBe(id);
  });
});

describe("DocumentStore's formats", () => {
  it(`keeps at most ${MAX_FORMATS}, and lets the least recently used go`, async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { store, name } = storeForTest();
    const formats = store.formatsFor("build-1");
    for (let i = 0; i < MAX_FORMATS; i++) {
      vi.setSystemTime(1_000 * (i + 1));
      await formats.put("pdftex", `jake-${i}`, new Uint8Array([i]));
    }
    // The oldest, used again, is no longer the least recently used; the second one is.
    vi.setSystemTime(100_000);
    expect(await formats.get("pdftex", "jake-0")).toEqual(new Uint8Array([0]));
    vi.setSystemTime(200_000);
    await formats.put("pdftex", "jake-new", new Uint8Array([99]));
    expect(await inDatabase(name, (db) => db.table("formats").count())).toBe(MAX_FORMATS);
    expect(await formats.get("pdftex", "jake-1")).toBeUndefined();
    expect(await formats.get("pdftex", "jake-0")).toEqual(new Uint8Array([0]));
    expect(await formats.get("pdftex", "jake-new")).toEqual(new Uint8Array([99]));
    expect(await formats.get("xetex", "jake-new")).toBeUndefined();
  });

  it("keeps formats by engine build, and drops another build's when one is kept", async () => {
    const { store } = storeForTest();
    const before = store.formatsFor("build-1");
    const after = store.formatsFor("build-2");
    await before.put("pdftex", "jake-0123abcd", new Uint8Array([1]));
    expect(await after.get("pdftex", "jake-0123abcd")).toBeUndefined();
    await after.put("pdftex", "jake-0123abcd", new Uint8Array([2]));
    expect(await before.get("pdftex", "jake-0123abcd")).toBeUndefined();
    expect(await after.get("pdftex", "jake-0123abcd")).toEqual(new Uint8Array([2]));
  });

  it("makes room for a format that does not fit, and tries it once more", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { store, name } = storeForTest();
    const formats = store.formatsFor("build-1");
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(1_000 * (i + 1));
      await formats.put("pdftex", `jake-${i}`, new Uint8Array([i]));
    }
    const refused = diskFull("formats");
    vi.setSystemTime(10_000);
    await formats.put("pdftex", "jake-new", new Uint8Array([9]));
    expect(refused()).toBe(1);
    const kept = await inDatabase(name, (db) => db.table("formats").toCollection().primaryKeys());
    expect(kept.sort()).toEqual([
      "build-1:pdftex:jake-1",
      "build-1:pdftex:jake-2",
      "build-1:pdftex:jake-new",
    ]);
  });

  it("frees another build's formats even when the new one does not fit", async () => {
    const { store, name } = storeForTest();
    const old = store.formatsFor("build-1");
    for (let i = 0; i < 5; i++) await old.put("pdftex", `jake-${i}`, new Uint8Array(16));
    diskFull("formats", { always: true });
    await expect(
      store.formatsFor("build-2").put("pdftex", "jake-0123abcd", new Uint8Array(16)),
    ).rejects.toMatchObject({ name: "QuotaExceededError" });
    expect(await inDatabase(name, (db) => db.table("formats").count())).toBe(0);
  });
});

describe("DocumentStore's prefetch", () => {
  it(`keeps every path a template read, first read first, up to ${MAX_PATHS}`, async () => {
    const { store } = storeForTest();
    expect(await store.prefetch.get("jake")).toEqual([]);
    await store.prefetch.add("jake", ["/texlive/a.sty", "/texlive/b.cls"]);
    await store.prefetch.add("jake", ["/texlive/b.cls", "/texmf/c.tfm"]);
    expect(await store.prefetch.get("jake")).toEqual([
      "/texlive/a.sty",
      "/texlive/b.cls",
      "/texmf/c.tfm",
    ]);
    const many = Array.from({ length: MAX_PATHS + 500 }, (_, i) => `/texmf/${i}.tfm`);
    await store.prefetch.add("big", many.slice(0, 1_500));
    await store.prefetch.add("big", many.slice(1_000));
    expect(await store.prefetch.get("big")).toEqual(many.slice(0, MAX_PATHS));
    expect(await store.prefetch.get("jake")).toHaveLength(3);
  });

  it("reads only paths from a row, whatever wrote it", async () => {
    const { store, name } = storeForTest();
    expect(await store.prefetch.get("jake")).toEqual([]);
    await inDatabase(name, async (db) => {
      await db.table("prefetch").put({ template: "jake", paths: [1, "/texmf/a.sty", {}] });
      await db.table("prefetch").put({ template: "other", paths: "/texmf/a.sty" });
    });
    expect(await store.prefetch.get("jake")).toEqual(["/texmf/a.sty"]);
    expect(await store.prefetch.get("other")).toEqual([]);
    await store.prefetch.add("other", ["/texmf/b.sty"]);
    expect(await store.prefetch.get("other")).toEqual(["/texmf/b.sty"]);
  });
});
