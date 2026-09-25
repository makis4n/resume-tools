/**
 * What the editor keeps in the browser, in IndexedDB through Dexie (plan section 8.1): the user's
 * documents, the formats templates dump, which save a dump in every later session, and the TeX
 * Live files each template reads, which a later session fetches ahead of TeX. Documents stay in
 * the browser, as the product rules have it, until milestone 4 adds accounts.
 *
 * A document is saved whole after every command, so saves are gathered and written at most twice
 * a second, and written at once when the page is hidden or going away, the last moment a page is
 * sure to run. A save that fails costs nothing the next one does not repair, since each is the
 * whole document. A document is checked against the model when it is read, not when it is
 * written: one that a newer editor wrote, which the model's strict schemas refuse, is refused
 * whole and left as it is, never read in part or deleted (decision 0006).
 */

import type { Resume } from "@resume-tools/resume-model";
import Dexie, { type EntityTable } from "dexie";
import type { FormatStore, PrefetchStore } from "../editor/compiler";
import { Document, newDocument } from "../editor/document";
import type { Engine } from "../engine/session";

/** A document as stored: the list's columns beside the document, so listing parses nothing. */
interface DocumentRow {
  id: string;
  /** The name in the resume's header, or "Untitled", as of the last save. */
  title: string;
  template: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
  updatedAt: number;
  /** The document as the editor holds it, checked against `Document` when it is read. */
  document: unknown;
}

/** What the document list shows of a document. */
export type Summary = Omit<DocumentRow, "document">;

interface FormatRow {
  /** `<tag>:<engine>:<name>`. */
  key: string;
  /** The engine build that dumped it (`src/engine/urls.ts`), since no other can load it. */
  tag: string;
  engine: Engine;
  name: string;
  bytes: Uint8Array;
  usedAt: number;
}

interface PrefetchRow {
  template: string;
  /** The TeX Live paths the template's dumps and compiles have read, first read first. */
  paths: string[];
}

type Database = Dexie & {
  documents: EntityTable<DocumentRow, "id">;
  formats: EntityTable<FormatRow, "key">;
  prefetch: EntityTable<PrefetchRow, "template">;
};

/** A save waits this long for the ones after it, so documents are written at most twice a second. */
export const SAVE_DELAY = 500;

/**
 * Formats kept at most. A format is 6 to 9 MB, so twenty is up to 180 MB: every template and
 * format-bound choice a user is likely to try, and a small part of what browsers allow a site.
 */
export const MAX_FORMATS = 20;

/** Paths kept per template at most; Jake's Resume reads about seventy. */
export const MAX_PATHS = 2_000;

/** What the user reads when a stored document cannot be opened. */
export const CANNOT_OPEN = "This document cannot be opened by this version of the editor.";

/** A stored document the model refuses, as it would one a newer editor wrote. */
export class DocumentRefused extends Error {
  constructor(
    readonly id: string,
    cause: unknown,
  ) {
    super(CANNOT_OPEN, { cause });
    this.name = "DocumentRefused";
  }
}

/** Where a page says it is going away: the window and its document, or a test's stand-ins. */
export interface PageEvents {
  window: EventTarget;
  document: EventTarget & { readonly visibilityState: string };
}

export interface StoreOptions {
  /** The database's name; tests give each store its own. */
  name?: string;
  /** Where to listen for the page going away; the page's own, when there is one. */
  page?: PageEvents;
}

/** The title a document is listed under: the name in its header, or "Untitled". */
export function titleOf(resume: Resume): string {
  const { first, last } = resume.header.name;
  return `${first} ${last}`.replace(/\s+/g, " ").trim() || "Untitled";
}

export class DocumentStore {
  private readonly db: Database;
  /** Saves not written yet, by document id; only the newest of each is written. */
  private readonly pending = new Map<string, Document>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Every write to the documents, in the order asked, so none overtakes one asked before it. */
  private writes: Promise<void> = Promise.resolve();
  private readonly stopListening: () => void;

  constructor(options: StoreOptions = {}) {
    this.db = new Dexie(options.name ?? "resume-tools") as Database;
    this.db.version(1).stores({
      documents: "id, updatedAt",
      formats: "key, usedAt, tag",
      prefetch: "template",
    });
    const page = options.page ?? (typeof window === "undefined" ? undefined : { window, document });
    const flush = () => void this.flush();
    const hidden = () => {
      if (page?.document.visibilityState === "hidden") flush();
    };
    page?.window.addEventListener("pagehide", flush);
    page?.document.addEventListener("visibilitychange", hidden);
    this.stopListening = () => {
      page?.window.removeEventListener("pagehide", flush);
      page?.document.removeEventListener("visibilitychange", hidden);
    };
  }

  /** Every document, the most recently edited first, with what was saved but not yet written. */
  async list(): Promise<Summary[]> {
    await this.flush();
    const rows = await this.db.documents.orderBy("updatedAt").reverse().toArray();
    return rows.map(({ document: _, ...summary }) => summary);
  }

  /**
   * A document as stored, with any save not yet written; undefined when there is none with this
   * id. Throws `DocumentRefused` for a document the model refuses, and leaves it stored.
   */
  async get(id: string): Promise<Document | undefined> {
    await this.flush();
    const row = await this.db.documents.get(id);
    if (row === undefined) return undefined;
    const read = Document.safeParse(row.document);
    if (!read.success) throw new DocumentRefused(id, read.error);
    return read.data;
  }

  /**
   * Store a new document for a curated template (`newDocument`), and return its id. Throws for a
   * template no curated package has.
   */
  async create(template: string, resume: Resume, locale?: string): Promise<string> {
    const document = newDocument(template, resume, locale);
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.queue(() =>
      this.db.documents.add({
        id,
        title: titleOf(document.resume),
        template: document.template,
        createdAt: now,
        updatedAt: now,
        document,
      }),
    );
    return id;
  }

  /**
   * Keep a document as it now is. The app calls this after every command; the write waits up to
   * `SAVE_DELAY` for the saves after it, so a burst of typing is one write.
   */
  save(id: string, document: Document): void {
    this.pending.set(id, document);
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, SAVE_DELAY);
  }

  /**
   * Write every save now, and settle once they and every write before them are done. It never
   * fails: a save that cannot be written is reported on the console.
   */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const saves = [...this.pending];
    this.pending.clear();
    if (saves.length > 0)
      void this.queue(() => this.write(saves)).catch((error: unknown) =>
        console.error("The document could not be saved in this browser", error),
      );
    return this.writes;
  }

  /** Delete a document, and any save of it not written yet. */
  async remove(id: string): Promise<void> {
    this.pending.delete(id);
    await this.queue(() => this.db.documents.delete(id));
  }

  /**
   * The formats kept for the engine build `tag` names. A format is good only for the build that
   * dumped it, so each is kept under its build's tag, and keeping one drops those of every other
   * build, which this one can never load. Past `MAX_FORMATS`, the least recently used goes.
   */
  formatsFor(tag: string): FormatStore {
    return {
      get: async (engine, name) => {
        const row = await this.db.formats.get(formatKey(tag, engine, name));
        if (row === undefined) return undefined;
        // Marked used after the answer, which need not wait for the format to be written again.
        void this.db.formats
          .put({ ...row, usedAt: Date.now() })
          .catch((error: unknown) => console.warn("A kept format could not be marked used", error));
        return row.bytes;
      },
      put: (engine, name, bytes) =>
        this.db.transaction("rw", this.db.formats, async () => {
          const formats = this.db.formats;
          await formats.bulkDelete(await formats.where("tag").notEqual(tag).primaryKeys());
          await formats.put({
            key: formatKey(tag, engine, name),
            tag,
            engine,
            name,
            bytes,
            usedAt: Date.now(),
          });
          const over = (await formats.count()) - MAX_FORMATS;
          if (over > 0)
            await formats.bulkDelete(await formats.orderBy("usedAt").limit(over).primaryKeys());
        }),
    };
  }

  /**
   * The TeX Live files each template is known to read: every path its dumps and compiles have
   * read, first read first, up to `MAX_PATHS`, past which new paths are not kept.
   */
  readonly prefetch: PrefetchStore = {
    get: async (template) => (await this.db.prefetch.get(template))?.paths ?? [],
    add: (template, paths) =>
      this.db.transaction("rw", this.db.prefetch, async () => {
        const known = (await this.db.prefetch.get(template))?.paths ?? [];
        const union = [...new Set([...known, ...paths])].slice(0, MAX_PATHS);
        if (union.length > known.length) await this.db.prefetch.put({ template, paths: union });
      }),
  };

  /** Stop listening to the page, write what is waiting, and close the database. */
  async close(): Promise<void> {
    this.stopListening();
    await this.flush();
    this.db.close();
  }

  /**
   * Write documents saved since the last write. A document another tab deleted meanwhile is
   * written again rather than losing what was typed into it here.
   */
  private write(saves: [string, Document][]): Promise<void> {
    const now = Date.now();
    return this.db.transaction("rw", this.db.documents, async () => {
      for (const [id, document] of saves) {
        const createdAt = (await this.db.documents.get(id))?.createdAt ?? now;
        const title = titleOf(document.resume);
        const { template } = document;
        await this.db.documents.put({ id, title, template, createdAt, updatedAt: now, document });
      }
    });
  }

  /** Run a write after every write asked for before it, and settle as it does. */
  private queue<T>(write: () => Promise<T>): Promise<T> {
    const written = this.writes.then(write);
    this.writes = written.then(
      () => undefined,
      () => undefined,
    );
    return written;
  }
}

const formatKey = (tag: string, engine: Engine, name: string) => `${tag}:${engine}:${name}`;
