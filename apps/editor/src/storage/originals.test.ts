import type { Section } from "@resume-tools/resume-model";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apply, type Document, newDocument } from "../editor/document";
import type { Imported, ImportReport } from "../import/run";
import { curated } from "../templates/curated";
import type { TemplatePackage } from "../templates/package";
import { resolveTemplate } from "../templates/resolve";
import { FakeAccounts } from "./fake-server";
import { FILES_NOT_THERE, FilesUnavailable, OPEN_WHEN_ONLINE, Originals } from "./originals";
import type { OriginalsBucket } from "./originals-bucket";
import { type OriginalFiles, unpackOriginals } from "./originals-pack";
import { ServerUnavailable } from "./server";
import { DocumentStore } from "./store";
import { SEND_INTERVAL, type SyncEvent, SyncQueue } from "./sync";

// Item 8's originals on the fake account: the queue's hooks over an in-memory bucket. Every word and
// file is invented.

const ADA = "00000000-0000-4000-8000-00000000000a";
const BO = "00000000-0000-4000-8000-00000000000b";
const TEMPLATE = "import-0123456789ab";

/** The account's buckets, in memory: each account's folder, by document. */
class FakeBuckets {
  readonly folders = new Map<string, Map<string, OriginalFiles>>();

  bucket(user: string): FakeBucket {
    return new FakeBucket(this, user);
  }

  files(user: string, document: string): OriginalFiles | undefined {
    return this.folders.get(user)?.get(document);
  }
}

class FakeBucket implements OriginalsBucket {
  offline = false;
  puts = 0;
  constructor(
    private readonly buckets: FakeBuckets,
    readonly user: string,
  ) {}
  private folder() {
    if (this.offline) throw new ServerUnavailable();
    let folder = this.buckets.folders.get(this.user);
    if (folder === undefined) {
      folder = new Map();
      this.buckets.folders.set(this.user, folder);
    }
    return folder;
  }
  async put(document: string, files: OriginalFiles) {
    await Promise.resolve();
    this.folder().set(document, files);
    this.puts++;
  }
  async get(document: string) {
    await Promise.resolve();
    return this.folder().get(document) ?? null;
  }
  async remove(document: string) {
    await Promise.resolve();
    this.folder().delete(document);
  }
}

let devices = 0;
const cleanups: (() => Promise<void>)[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.useRealTimers();
});

/** A device: a store on an IndexedDB of its own, its queue, and the originals as its hooks. */
function device() {
  const idb = { indexedDB: new IDBFactory(), IDBKeyRange };
  const store = new DocumentStore({ name: `originals-test-${++devices}`, idb });
  const originals = new Originals(store);
  const queue = new SyncQueue({ store, locks: null, page: null, hooks: originals });
  const events: SyncEvent[] = [];
  queue.on((event) => events.push(event));
  cleanups.push(async () => {
    queue.close();
    await store.close();
  });
  return { store, originals, queue, events };
}

async function eventually(check: () => Promise<boolean> | boolean) {
  for (let tries = 0; tries < 500; tries++) {
    if (await check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("what was expected never came about");
}

const { sample } = curated("jake");

/** `doc` with its first name set as it is: an outline's header is no field the editor edits. */
const named = (doc: Document, first: string): Document => ({
  ...doc,
  resume: {
    ...doc.resume,
    header: { ...doc.resume.header, name: { ...doc.resume.header.name, first } },
  },
});

/** An invented `.tex` import: Jake's package under an imported id, an upload, a job, a report. */
function imported(first = "Quill"): Imported {
  const outline: Section = {
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
  const pkg = {
    ...curated("jake").package,
    id: TEMPLATE,
    name: "Invented import",
  } as TemplatePackage;
  const made = {
    ...apply(newDocument("jake", sample), { type: "text", field: "header.first", text: first }),
    template: TEMPLATE,
  } as Document;
  const tex = new TextEncoder().encode(`\\documentclass{article} % ${first}`);
  return {
    package: pkg,
    document: { ...made, resume: { ...made.resume, sections: [outline] } },
    report: { compiles: 3, warnings: ["invented"] } as unknown as ImportReport,
    upload: { files: [{ name: "cv.tex", bytes: tex }] },
    job: {
      files: { "cv.tex": tex, "photo.png": new Uint8Array([1, 2, 3]) },
      images: ["photo.png"],
    },
  };
}

describe("an imported .tex document's files in the account (milestone 4 item 8)", () => {
  it("uploads both files once the row is in the account, and only then is it in the account", async () => {
    const accounts = new FakeAccounts();
    const buckets = new FakeBuckets();
    const a = device();
    const bucket = buckets.bucket(ADA);
    a.originals.connect(bucket);
    await a.queue.signIn(ADA, accounts.server(ADA, "a"));
    const id = await a.store.importDocument(imported());
    expect(await a.store.syncRow(id)).toMatchObject({ filesOwed: true });
    await eventually(async () => (await a.store.places()).get(id) === "in-account");
    expect(await a.store.syncRow(id)).toMatchObject({ filesOwed: false, pending: false });
    const files = buckets.files(ADA, id);
    if (files === undefined) throw new Error("no files in the account");
    const kept = await a.store.templateOf(TEMPLATE, id);
    const back = unpackOriginals(files);
    expect(back.record).toEqual(kept?.import);
    expect(back.package).toEqual(kept?.package);
    // A later save sends the row again, not the files.
    const { document, revision } = (await a.store.get(id)) ?? {};
    if (document === undefined || revision === undefined) throw new Error("not stored");
    a.store.save(id, named(document, "Rune"), revision);
    await a.store.flush();
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL);
    await eventually(async () => (await a.store.places()).get(id) === "in-account");
    expect(bucket.puts).toBe(1);
  });

  it("keeps the files owed while they cannot be uploaded, and sends them once they can", async () => {
    const accounts = new FakeAccounts();
    const buckets = new FakeBuckets();
    const a = device();
    const bucket = buckets.bucket(ADA);
    bucket.offline = true;
    a.originals.connect(bucket);
    await a.queue.signIn(ADA, accounts.server(ADA, "a"));
    const id = await a.store.importDocument(imported());
    // The row goes; the files cannot.
    await eventually(() => accounts.documents(ADA).length === 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(await a.store.syncRow(id)).toMatchObject({ pending: false, filesOwed: true });
    expect((await a.store.places()).get(id)).toBe("waiting");
    // Signing out names it, and removes nothing.
    const out = await a.queue.signOut();
    expect(out).toMatchObject({ done: false, unsent: [{ id }] });
    bucket.offline = false;
    await vi.advanceTimersByTimeAsync(60_000);
    await eventually(async () => (await a.store.places()).get(id) === "in-account");
    expect(buckets.files(ADA, id)).toBeDefined();
  });

  it("downloads the files when a document brought in is opened, not when the list refreshes", async () => {
    const accounts = new FakeAccounts();
    const buckets = new FakeBuckets();
    const a = device();
    a.originals.connect(buckets.bucket(ADA));
    await a.queue.signIn(ADA, accounts.server(ADA, "a"));
    const id = await a.store.importDocument(imported());
    await eventually(async () => (await a.store.places()).get(id) === "in-account");

    const b = device();
    const onB = buckets.bucket(ADA);
    const gets = vi.spyOn(onB, "get");
    b.originals.connect(onB);
    await b.queue.signIn(ADA, accounts.server(ADA, "b"));
    expect((await b.store.list()).map((each) => each.id)).toEqual([id]);
    expect(gets).not.toHaveBeenCalled();
    expect(await b.store.templateOf(TEMPLATE, id)).toBeUndefined();

    // Opened as the app opens a document: through `resolveTemplate`.
    const template = await resolveTemplate(TEMPLATE, id, b.originals);
    expect(gets).toHaveBeenCalledTimes(1);
    const onA = await a.store.templateOf(TEMPLATE, id);
    expect(template?.package).toEqual(onA?.package);
    expect(template?.job).toEqual(onA?.import?.job);
    expect(template?.report).toEqual(onA?.import?.report);
    expect((await b.store.templateOf(TEMPLATE, id))?.import).toEqual(onA?.import);
    // Kept now: opened again, nothing is downloaded.
    await resolveTemplate(TEMPLATE, id, b.originals);
    expect(gets).toHaveBeenCalledTimes(1);
    // Brought in, the files are in the account: nothing is owed.
    expect(await b.store.syncRow(id)).toMatchObject({ filesOwed: false });

    // Signing out removes the account's documents with their downloaded packages and imports.
    expect(await b.queue.signOut()).toEqual({ done: true });
    expect(await b.store.syncRows()).toEqual([]);
    expect(await b.store.templateOf(TEMPLATE, id)).toBeUndefined();
  });

  it("says in plain words that a document cannot open offline, or before its files arrive", async () => {
    const accounts = new FakeAccounts();
    const buckets = new FakeBuckets();
    const a = device();
    a.originals.connect(buckets.bucket(ADA));
    await a.queue.signIn(ADA, accounts.server(ADA, "a"));
    const id = await a.store.importDocument(imported());
    await eventually(async () => (await a.store.places()).get(id) === "in-account");

    const b = device();
    const onB = buckets.bucket(ADA);
    b.originals.connect(onB);
    await b.queue.signIn(ADA, accounts.server(ADA, "b"));
    onB.offline = true;
    const offline = b.originals.templateOf(TEMPLATE, id);
    await expect(offline).rejects.toBeInstanceOf(FilesUnavailable);
    await expect(b.originals.templateOf(TEMPLATE, id)).rejects.toThrow(OPEN_WHEN_ONLINE);
    // Signed out on this page since: none is connected.
    b.originals.connect(undefined);
    await expect(b.originals.templateOf(TEMPLATE, id)).rejects.toThrow(OPEN_WHEN_ONLINE);
    // The account lacks them.
    onB.offline = false;
    b.originals.connect(onB);
    buckets.folders.get(ADA)?.delete(id);
    await expect(b.originals.templateOf(TEMPLATE, id)).rejects.toThrow(FILES_NOT_THERE);
  });

  it("deletes both files before the row, and the other device loses the document", async () => {
    const accounts = new FakeAccounts();
    const buckets = new FakeBuckets();
    const a = device();
    a.originals.connect(buckets.bucket(ADA));
    await a.queue.signIn(ADA, accounts.server(ADA, "a"));
    const id = await a.store.importDocument(imported());
    await eventually(async () => (await a.store.places()).get(id) === "in-account");
    const b = device();
    b.originals.connect(buckets.bucket(ADA));
    await b.queue.signIn(ADA, accounts.server(ADA, "b"));
    await resolveTemplate(TEMPLATE, id, b.originals);

    await a.queue.remove(id);
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL);
    await eventually(() => accounts.documents(ADA).length === 0);
    expect(buckets.files(ADA, id)).toBeUndefined();
    await b.queue.signIn(ADA, accounts.server(ADA, "b"));
    expect(await b.store.syncRows()).toEqual([]);
    expect(await b.store.templateOf(TEMPLATE, id)).toBeUndefined();
  });

  it("never sends one account's files to another's folder", async () => {
    const accounts = new FakeAccounts();
    const buckets = new FakeBuckets();
    const a = device();
    // The bucket connected is Bo's, as after another account signed in on this page.
    a.originals.connect(buckets.bucket(BO));
    await a.queue.signIn(ADA, accounts.server(ADA, "a"));
    const id = await a.store.importDocument(imported());
    await eventually(() => accounts.documents(ADA).length === 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(buckets.folders.get(BO)?.size ?? 0).toBe(0);
    expect(await a.store.syncRow(id)).toMatchObject({ filesOwed: true });
  });

  it("keeps a conflict's copy of an import owing its own files, under its own id", async () => {
    const accounts = new FakeAccounts();
    const buckets = new FakeBuckets();
    const a = device();
    a.originals.connect(buckets.bucket(ADA));
    await a.queue.signIn(ADA, accounts.server(ADA, "a"));
    const id = await a.store.importDocument(imported());
    await eventually(async () => (await a.store.places()).get(id) === "in-account");
    const b = device();
    b.originals.connect(buckets.bucket(ADA));
    await b.queue.signIn(ADA, accounts.server(ADA, "b"));
    await resolveTemplate(TEMPLATE, id, b.originals);

    // Both edit; A sends first, and B's version becomes a copy.
    const onA = await a.store.get(id);
    const onB = await b.store.get(id);
    if (onA === undefined || onB === undefined) throw new Error("not on both devices");
    a.store.save(id, named(onA.document, "Asa"), onA.revision);
    await a.store.flush();
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL);
    await eventually(() => accounts.document(ADA, id)?.revision === 2);
    b.store.save(id, named(onB.document, "Bea"), onB.revision);
    await b.store.flush();
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL);
    await eventually(() => b.events.some((event) => event.type === "copied"));
    const copied = b.events.find((event) => event.type === "copied");
    if (copied?.type !== "copied") throw new Error("no copy");
    await eventually(async () => (await b.store.places()).get(copied.copy) === "in-account");
    const files = buckets.files(ADA, copied.copy);
    if (files === undefined) throw new Error("the copy's files are not in the account");
    expect(unpackOriginals(files).record).toEqual((await a.store.templateOf(TEMPLATE, id))?.import);
  });
});
