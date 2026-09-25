import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apply, type Document, newDocument } from "../editor/document";
import { curated } from "../templates/curated";
import {
  CANNOT_OPEN,
  DocumentRefused,
  DocumentStore,
  MAX_FORMATS,
  MAX_PATHS,
  type PageEvents,
  SAVE_DELAY,
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
  const page = new FakePage();
  const store = new DocumentStore({ name, page });
  opened.push(store);
  return { store, name, page };
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

/** The first name of a document as the database holds it, whatever the store has waiting. */
const storedName = (name: string, id: string) =>
  inDatabase(name, async (db) => {
    const row = await db.table("documents").get(id);
    return (row?.document as Document | undefined)?.resume.header.name.first;
  });

/** Wait for the database to hold what `check` looks for, without asking the store to write. */
async function eventually(check: () => Promise<boolean>) {
  for (let tries = 0; tries < 200; tries++) {
    if (await check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("the database never held what was expected");
}

const named = (doc: Document, first: string) =>
  apply(doc, { type: "text", field: "header.first", text: first });

afterEach(async () => {
  vi.useRealTimers();
  for (const store of opened.splice(0)) await store.close();
});

describe("DocumentStore", () => {
  it("keeps a document, and gives it back as last saved", async () => {
    const { store } = storeForTest();
    const id = await store.create("jake", sample, "en-GB");
    const created = await store.get(id);
    expect(created).toEqual(newDocument("jake", sample, "en-GB"));
    if (created === undefined) throw new Error("the document was not kept");
    const edited = named(created, "Ada");
    store.save(id, edited);
    // A read sees a save that is still waiting to be written.
    expect(await store.get(id)).toEqual(edited);
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
    store.save(first, named(newDocument("jake", sample), "Ada"));
    const listed = await store.list();
    expect(listed.map((summary) => summary.id)).toEqual([first, second]);
    // Edited, not made again.
    expect(listed[0]).toMatchObject({ createdAt: 1_000, updatedAt: 3_000 });
  });

  it("deletes a document, and a save of it still waiting", async () => {
    const { store, name } = storeForTest();
    const kept = await store.create("jake", sample);
    const id = await store.create("jake", sample);
    store.save(id, named(newDocument("jake", sample), "Ada"));
    await store.remove(id);
    await store.flush();
    expect(await store.get(id)).toBeUndefined();
    expect(await storedName(name, id)).toBeUndefined();
    expect((await store.list()).map((summary) => summary.id)).toEqual([kept]);
  });

  it("writes saves at most twice a second, and at once when the page is hidden or left", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { store, name, page } = storeForTest();
    const id = await store.create("jake", sample);
    const doc = newDocument("jake", sample);

    // Two saves within the delay are one write, of the second, when the delay is up.
    store.save(id, named(doc, "Ada"));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY / 2);
    store.save(id, named(doc, "Bo"));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY / 2 - 1);
    expect(await storedName(name, id)).toBe("Mara");
    await vi.advanceTimersByTimeAsync(1);
    await eventually(async () => (await storedName(name, id)) === "Bo");

    // Hidden: written at once. Shown again: nothing to do.
    store.save(id, named(doc, "Cy"));
    page.show();
    expect(vi.getTimerCount()).toBe(1);
    page.hide();
    expect(vi.getTimerCount()).toBe(0);
    await eventually(async () => (await storedName(name, id)) === "Cy");

    // Left: written at once.
    store.save(id, named(doc, "Di"));
    page.leave();
    expect(vi.getTimerCount()).toBe(0);
    await eventually(async () => (await storedName(name, id)) === "Di");

    // A flush writes what waits, and settles once it is written.
    store.save(id, named(doc, "Ed"));
    await store.flush();
    expect(await storedName(name, id)).toBe("Ed");

    // Closing writes what waits, and stops listening to the page.
    store.save(id, named(doc, "Flo"));
    await store.close();
    expect(await storedName(name, id)).toBe("Flo");
    page.leave();
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
});
