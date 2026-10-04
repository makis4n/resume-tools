/**
 * What the editor keeps in the browser, in IndexedDB through Dexie (plan section 8.1): the user's
 * documents, the formats templates dump, which save a dump in every later session, and the TeX
 * Live files each template reads, which a later session fetches ahead of TeX. Documents stay in
 * the browser, as the product rules have it, until milestone 4 adds accounts.
 *
 * A document is saved whole after every command, so saves are gathered and written at most twice
 * a second, and written at once when the page is hidden or going away, the last moment a page is
 * sure to run. A save that cannot be written is kept and tried again, and a flush says which saves
 * it could not write, so that the editor keeps a document open, and says why, until its edits are
 * written (decision 0010). A document is checked against the model when it is read, not when it is
 * written: one that a newer editor wrote, which the model's strict schemas refuse, is refused
 * whole and left as it is, never read in part or deleted (decision 0006).
 *
 * Every tab of the editor shares the database, and each new one opens the most recent document,
 * so two tabs can hold the same document. Each row therefore carries a revision, which a write
 * checks: a save made from a document another tab has written since is refused rather than
 * written over it. And each write and delete is announced to the other tabs, which stop editing a
 * document that has changed under them.
 *
 * An imported template's package is kept too, in a table of its own (milestone 3 item 12, decision
 * 0038), with what each document imported onto it keeps: the original upload's files, what its
 * compiles need beside the package, its report, and when it was made; and when the package was
 * made and last used. A package's id is under the prefix no curated package takes, and the store
 * refuses one outside it, or one a curated package has; its formats are kept as any template's,
 * among the `MAX_FORMATS`, and go with its last document, the package with them. An import the
 * first pass of milestone 3 made, a document fitted into the shared structure rather than an
 * outline, is not migrated (decision 0049): the store refuses to open or keep one, with a message
 * that says to import it again (`IMPORT_AGAIN`), and leaves it stored.
 */

import { type OutlinePart, outlineNodes, type Resume } from "@resume-tools/resume-model";
import Dexie, { type EntityTable } from "dexie";
import { z } from "zod";
import type { FormatStore, PrefetchStore } from "../editor/compiler";
import { Document, newDocument } from "../editor/document";
import type { Engine } from "../engine/session";
import type { Upload } from "../import/intake";
import type { Imported, ImportJob, ImportReport } from "../import/run";
import { CURATED } from "../templates/curated";
import { IMPORTED_PREFIX, TemplatePackage } from "../templates/package";

/** A document as stored: the list's columns beside the document, so listing parses nothing. */
interface DocumentRow {
  id: string;
  /** The name in the resume's header, or "Untitled", as of the last save. */
  title: string;
  template: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
  updatedAt: number;
  /**
   * How many times the document has been written, which a write checks to find another tab's
   * write since its own read. A row written before revisions has none, which reads as 0.
   */
  revision?: number;
  /** The document as the editor holds it, checked against `Document` when it is read. */
  document: unknown;
}

/**
 * What the document list shows of a document. It is checked when the list is read, as a document
 * is when it is opened, since anything on the origin can write to the table: a title React cannot
 * render, or a time the list cannot tell (Zod's numbers are finite), would take the whole list
 * down with it.
 */
const Summary = z.object({
  id: z.string(),
  title: z.string(),
  template: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Summary = z.infer<typeof Summary> & {
  /** An imported template's name, as its package gives it, which the list shows. */
  templateName?: string;
};

/** A stored document as `get` reads it, with the revision that the app's saves of it name. */
export interface Stored {
  document: Document;
  revision: number;
}

/** What a flush did, with the saves it wrote and the writes it waited for. */
export interface Flushed {
  /** How many saves were written. */
  written: number;
  /** The documents whose newest save could not be written; each waits to be tried again. */
  failed: string[];
  /**
   * The documents another tab has changed since this one read them, whose saves were not written
   * and will not be.
   */
  conflicts: string[];
}

/**
 * Whether the editor may let an open document's history go after a flush: only once nothing was
 * left unwritten. The history holds the only copy of an edit whose save failed, and an edit that
 * met another tab's change is dropped only once the user has been told.
 */
export function canLeave({ failed, conflicts }: Flushed): boolean {
  return failed.length === 0 && conflicts.length === 0;
}

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

/** What the store keeps of one document's import (decision 0038). */
export interface ImportRecord {
  /** The original upload's files, as the person gave them, so that it can be imported again. */
  upload: { files: Upload[] };
  /** What the document's compiles need beside the package's own files. */
  job: ImportJob;
  /** What item 13's report is made of. */
  report: ImportReport;
  /** When it was imported, in milliseconds since the epoch. */
  made: number;
}

/**
 * An imported template's package as stored: the package, checked when it is read, as a document
 * is; when it was first stored and last used; and each document imported onto it, by the
 * document's id, with what its import keeps. Two uploads of one template whose preambles agree
 * share a package (decision 0026), and each keeps its own upload.
 */
interface PackageRow {
  id: string;
  package: unknown;
  made: number;
  lastUsed: number;
  imports: Record<string, ImportRecord>;
}

/** An imported template as the editor opens a document with it (`templateOf`). */
export interface StoredTemplate {
  package: TemplatePackage;
  /** The document's own import, when the store keeps it. */
  import?: ImportRecord;
}

type Database = Dexie & {
  documents: EntityTable<DocumentRow, "id">;
  formats: EntityTable<FormatRow, "key">;
  prefetch: EntityTable<PrefetchRow, "template">;
  packages: EntityTable<PackageRow, "id">;
};

/** What a tab tells the others once it has written or deleted a document. */
const Change = z.discriminatedUnion("type", [
  z.object({ type: z.literal("changed"), id: z.string(), revision: z.number() }),
  z.object({ type: z.literal("deleted"), id: z.string() }),
]);
type Change = z.infer<typeof Change>;

/** What the store knows of a document it has read or created, which its writes of it rely on. */
interface Held {
  /** The revision the document was read at, which the app's saves from that reading name. */
  opened: number;
  /** The row's revision as this tab last read or wrote it: what its next write expects to find. */
  revision: number;
  /** The highest revision this tab has asked to write, written yet or not. */
  issued: number;
  /** Kept here so that a write's put can go with its read rather than wait for it. */
  createdAt: number;
  /** Whether another tab has changed it since; nothing more of this reading is written. */
  stale: boolean;
}

/**
 * Who asked for a flush. The timer writes what waits and leaves a save made meanwhile to its next
 * tick, so that a document typed into while it is written is still written at most twice a
 * second. Anyone else, a caller or the page being hidden or going away, writes that too, so that
 * no answer leaves a newer save behind; the page's flush writes unchecked (see `write`).
 */
type Asker = "timer" | "caller" | "leaving";

/** A save not written yet. */
interface Save {
  document: Document;
  /** The revision of the reading it was made from (`Held.opened`). */
  revision: number;
  /** Which save this is, counted across the store, so a failed one can tell if a newer one came. */
  serial: number;
}

/** A save waits this long for the ones after it, so documents are written at most twice a second. */
export const SAVE_DELAY = 500;

/**
 * How long after a write fails the store waits before trying it again by itself, so that a full
 * disk is not asked twice a second. A flush that is asked for, as the Retry button does, tries at
 * once.
 */
export const RETRY_DELAY = 2_000;

/**
 * Formats kept at most. A format is 6 to 9 MB, so twenty is up to 180 MB: every template and
 * format-bound choice a user is likely to try, and a small part of what browsers allow a site.
 */
export const MAX_FORMATS = 20;

/** Paths kept per template at most; Jake's Resume reads about seventy. */
export const MAX_PATHS = 2_000;

/** What the user reads when a stored document cannot be opened. */
export const CANNOT_OPEN = "This document cannot be opened by this version of the editor.";

/**
 * What the user reads when a stored document was imported by the first pass of milestone 3, which
 * this editor does not migrate (decision 0049).
 */
export const IMPORT_AGAIN =
  "This resume was imported by an earlier version of the editor, which this one cannot open. Import it again to edit it.";

/**
 * A stored document the model refuses, as it would one a newer editor wrote; or one an earlier
 * editor imported, which this one does not migrate. Its message is what the user reads.
 */
export class DocumentRefused extends Error {
  constructor(
    readonly id: string,
    cause: unknown,
    message: string = CANNOT_OPEN,
  ) {
    super(message, { cause });
    this.name = "DocumentRefused";
  }
}

/**
 * Whether a document is an import the first pass of milestone 3 made (decision 0049): set with an
 * imported package, and holding no outline, the one section a `.tex` import now makes.
 */
export const madeByFirstPass = (document: Pick<Document, "template" | "resume">) =>
  document.template.startsWith(IMPORTED_PREFIX) &&
  !document.resume.sections.some((section) => section.kind === "outline");

/**
 * An imported package the store will not keep, or read back: one whose id is outside the prefix
 * imported ids take (`IMPORTED_PREFIX`), or is a curated package's, or that the package's schema
 * refuses, as a newer editor's; or a document that is not set with it. The message is for
 * developers; a person reads that the document cannot be opened, or could not be kept.
 */
export class PackageRefused extends Error {
  constructor(
    readonly id: string,
    why: string,
    cause?: unknown,
  ) {
    super(`the imported package ${id} is refused: ${why}`, { cause });
    this.name = "PackageRefused";
  }
}

/**
 * Why the store refuses a package by its id, or undefined when it takes it: an imported id is under
 * the prefix, and no curated package has it (decision 0026; `checkCuratedId` is the curated side).
 */
function refusedId(id: string): string | undefined {
  if (!id.startsWith(IMPORTED_PREFIX)) return `its id is not under ${IMPORTED_PREFIX}`;
  if (CURATED.has(id)) return "its id is a curated package's";
  return undefined;
}

/** A write's read found a revision other than the one its save was made from. */
class Conflict extends Error {}

/** Where a page says it is going away: the window and its document, or a test's stand-ins. */
export interface PageEvents {
  window: EventTarget;
  document: EventTarget & { readonly visibilityState: string };
}

export interface StoreOptions {
  /**
   * The database's name, which also names the channel its tabs talk on; tests give each store
   * its own.
   */
  name?: string;
  /** Where to listen for the page going away; the page's own, when there is one. */
  page?: PageEvents;
}

/** The most characters of an imported resume's first line its title takes. */
export const MAX_TITLE = 60;

/**
 * The title a document is listed under: the name in its header; for an imported `.tex`, whose
 * header holds no name (decision 0049), the words of its outline's first fields on one line, which
 * are its name on nearly every resume, as Jake's heading's or Awesome-CV's `\name{...}{...}`, cut at
 * `MAX_TITLE` characters; or "Untitled".
 */
export function titleOf(resume: Resume): string {
  const { first, last } = resume.header.name;
  const named = `${first} ${last}`.replace(/\s+/g, " ").trim();
  if (named !== "") return named;
  const outline = resume.sections.find((section) => section.kind === "outline");
  const line = outline === undefined ? "" : firstLine(outline.parts);
  return line === ""
    ? "Untitled"
    : line.length > MAX_TITLE
      ? `${line.slice(0, MAX_TITLE - 1).trimEnd()}…`
      : line;
}

/**
 * The text of an outline's first fields on one line: from its first field that holds text, each
 * field's text in turn, until kept text that ends the line.
 */
function firstLine(parts: readonly OutlinePart[]): string {
  const words: string[] = [];
  for (const step of outlineNodes(parts)) {
    if (step.kind === "unit") continue;
    const { part } = step;
    if (part.kind === "kept") {
      if (words.length > 0 && /[\n\r]/.test(part.latex)) break;
      continue;
    }
    if (part.kind === "group") continue;
    const text =
      typeof part.text === "string" ? part.text : part.text.map((run) => run.text).join("");
    if (text.trim() !== "") words.push(text);
  }
  return words.join(" ").replace(/\s+/g, " ").trim();
}

export class DocumentStore {
  private readonly db: Database;
  /** The documents this store has read or created, by id. */
  private readonly held = new Map<string, Held>();
  /** Saves not written yet, by document id; only the newest of each is written. */
  private readonly pending = new Map<string, Save>();
  /** The serial of each document's newest save, which a failed write compares with its own. */
  private readonly newest = new Map<string, number>();
  private serials = 0;
  /** The writes in flight, each settling with what it did. */
  private readonly writing = new Set<Promise<Flushed>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** When the timer may next write, after a write failed (`RETRY_DELAY`). */
  private retryAt = 0;
  private closed = false;
  /** Where this tab and the others on the database announce their writes; none in old browsers. */
  private channel: BroadcastChannel | undefined;
  private readonly changedListeners = new Set<(id: string) => void>();
  private readonly flushedListeners = new Set<(result: Flushed) => void>();
  private readonly stopListening: () => void;

  constructor(options: StoreOptions = {}) {
    const name = options.name ?? "resume-tools";
    this.db = new Dexie(name) as Database;
    this.db.version(1).stores({
      documents: "id, updatedAt",
      formats: "key, usedAt, tag",
      prefetch: "template",
    });
    // Version 2 keeps imported packages, and finds a template's documents by it (decision 0038).
    this.db.version(2).stores({
      documents: "id, updatedAt, template",
      formats: "key, usedAt, tag",
      prefetch: "template",
      packages: "id, lastUsed",
    });
    // A browser without channels still refuses a write over another tab's; it only hears of the
    // change at its next write rather than at once.
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(name);
      this.channel.onmessage = (event: MessageEvent) => this.heard(event.data);
    }
    const page = options.page ?? (typeof window === "undefined" ? undefined : { window, document });
    // The page may run no task after either, so what waits is written unchecked (see `write`).
    const leaving = () => void this.flushAll("leaving");
    const hidden = () => {
      if (page?.document.visibilityState === "hidden") leaving();
    };
    page?.window.addEventListener("pagehide", leaving);
    page?.document.addEventListener("visibilitychange", hidden);
    this.stopListening = () => {
      page?.window.removeEventListener("pagehide", leaving);
      page?.document.removeEventListener("visibilitychange", hidden);
    };
  }

  /**
   * Every document the list can show, the most recently edited first, with what was saved but not
   * yet written. A row whose summary cannot be read is left out, and the console hears of it.
   */
  async list(): Promise<Summary[]> {
    await this.flush();
    const rows = await this.db.documents.orderBy("updatedAt").reverse().toArray();
    const summaries = rows.flatMap((row) => {
      const read = Summary.safeParse(row);
      return read.success ? [read.data] : [];
    });
    const unread = rows.length - summaries.length;
    if (unread > 0)
      console.warn(`${unread} stored documents are left out of the list: it cannot read them`);
    // An imported template is named as its package names it, which the curated map does not know.
    const imported = [
      ...new Set(
        summaries.map((each) => each.template).filter((id) => refusedId(id) === undefined),
      ),
    ];
    if (imported.length === 0) return summaries;
    const names = new Map<string, string>();
    for (const row of await this.db.packages.bulkGet(imported)) {
      const name = (row?.package as { name?: unknown } | undefined)?.name;
      if (row !== undefined && typeof name === "string") names.set(row.id, name);
    }
    return summaries.map((each) => {
      const templateName = names.get(each.template);
      return templateName === undefined ? each : { ...each, templateName };
    });
  }

  /**
   * A document as stored, after writing what waits to be; undefined when there is none with this
   * id. Throws `DocumentRefused` for a document the model refuses, or one the first pass of
   * milestone 3 imported (`madeByFirstPass`), and leaves it stored. Reading a
   * document starts a new reading of it, which the app's saves then name by its revision.
   */
  async get(id: string): Promise<Stored | undefined> {
    await this.flush();
    const row = await this.db.documents.get(id);
    if (row === undefined) return undefined;
    const read = Document.safeParse(row.document);
    if (!read.success) throw new DocumentRefused(id, read.error);
    if (madeByFirstPass(read.data))
      throw new DocumentRefused(id, "imported by the first pass", IMPORT_AGAIN);
    const revision = revisionOf(row) ?? 0;
    this.held.set(id, {
      opened: revision,
      revision,
      issued: revision,
      createdAt: row.createdAt,
      stale: false,
    });
    return { document: read.data, revision };
  }

  /**
   * Store a new document for a curated template (`newDocument`), and return its id. Throws for a
   * template no curated package has.
   */
  async create(template: string, resume: Resume, locale?: string): Promise<string> {
    const document = newDocument(template, resume, locale);
    const id = crypto.randomUUID();
    const now = Date.now();
    const row: DocumentRow = {
      id,
      title: titleOf(document.resume),
      template: document.template,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      document,
    };
    // Every write to the documents makes a transaction of its own, as `write` has to, so that
    // they reach the database in the order they were asked for.
    await this.db.transaction("rw", this.db.documents, () => this.db.documents.add(row));
    this.held.set(id, { opened: 1, revision: 1, issued: 1, createdAt: now, stale: false });
    this.announce({ type: "changed", id, revision: 1 });
    return id;
  }

  /**
   * Keep a document as it now is, made from the reading `revision` names (`get`). The app calls
   * this after every command; the write waits up to `SAVE_DELAY` for the saves after it, so a
   * burst of typing is one write.
   */
  save(id: string, document: Document, revision: number): void {
    const serial = ++this.serials;
    this.newest.set(id, serial);
    this.pending.set(id, { document, revision, serial });
    this.schedule();
  }

  /**
   * Write every save now. It settles, never with an error, once every write asked for before it
   * has, and every save made meanwhile has been written too, and says what came of them: written,
   * failed and waiting to be tried again, or refused over another tab's change.
   */
  flush(): Promise<Flushed> {
    return this.flushAll("caller");
  }

  /**
   * Store an import (decision 0038): its package, under the prefix imported ids take, beside any
   * earlier import of the same template, with what this import keeps (`ImportRecord`); and its
   * document, as a new one, which is set with the package. Returns the document's id. Throws
   * `PackageRefused` for a package the store refuses (`refusedId`, the package's schema), a
   * document not set with it, or one that holds no outline (`madeByFirstPass`), and Zod's error for a document the model refuses; nothing is stored
   * then.
   */
  async importDocument(imported: Imported): Promise<string> {
    const id = imported.package.id;
    const refused = refusedId(id);
    if (refused !== undefined) throw new PackageRefused(id, refused);
    const read = TemplatePackage.safeParse(imported.package);
    if (!read.success) throw new PackageRefused(id, "the package's schema refuses it", read.error);
    // Parsed, so the store holds a copy of the document rather than the caller's.
    const document = Document.parse(imported.document);
    if (document.template !== id)
      throw new PackageRefused(id, `the document is set with ${document.template}`);
    if (madeByFirstPass(document))
      throw new PackageRefused(id, "its document is no outline, as the first pass imported one");
    const documentId = crypto.randomUUID();
    const now = Date.now();
    const record: ImportRecord = {
      upload: imported.upload,
      job: imported.job,
      report: imported.report,
      made: now,
    };
    const row: DocumentRow = {
      id: documentId,
      title: titleOf(document.resume),
      template: id,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      document,
    };
    const { documents, packages } = this.db;
    await this.db.transaction("rw", documents, packages, async () => {
      const kept = await packages.get(id);
      await packages.put({
        id,
        package: read.data,
        made: kept?.made ?? now,
        lastUsed: now,
        imports: { ...(kept?.imports ?? {}), [documentId]: record },
      });
      await documents.add(row);
    });
    this.held.set(documentId, { opened: 1, revision: 1, issued: 1, createdAt: now, stale: false });
    this.announce({ type: "changed", id: documentId, revision: 1 });
    return documentId;
  }

  /**
   * An imported template as a document opens with it (`resolveTemplate`): its package, checked as
   * a document is when it is read, and what `document`'s own import keeps, when the store keeps it;
   * undefined when there is no such package. Using it marks the package used, in the background.
   * Throws `PackageRefused` for an id outside the prefix or a curated package's, and for a package
   * the schema refuses, as a newer editor's, which stays stored.
   */
  async templateOf(id: string, document?: string): Promise<StoredTemplate | undefined> {
    const refused = refusedId(id);
    if (refused !== undefined) throw new PackageRefused(id, refused);
    const row = await this.db.packages.get(id);
    if (row === undefined) return undefined;
    const read = TemplatePackage.safeParse(row.package);
    if (!read.success) throw new PackageRefused(id, "the package's schema refuses it", read.error);
    if (read.data.id !== id) throw new PackageRefused(id, `its package's id is ${read.data.id}`);
    this.db.packages
      .update(id, { lastUsed: Date.now() })
      .catch((error: unknown) => console.warn("A kept package could not be marked used", error));
    const own = document === undefined ? undefined : row.imports?.[document];
    return { package: read.data, ...(own === undefined ? {} : { import: own }) };
  }

  /**
   * Delete a document, and any save of it not written yet. A document imported onto a package takes
   * its import with it (`ImportRecord`); the last document of a package takes the package too,
   * and its formats and the paths its compiles read (decision 0038). Returns the id of the package
   * that went, so that the compiler lets its formats go too, or undefined.
   */
  async remove(id: string): Promise<string | undefined> {
    this.pending.delete(id);
    this.newest.delete(id);
    this.held.delete(id);
    const { documents, packages, formats, prefetch } = this.db;
    const dropped = await this.db.transaction(
      "rw",
      [documents, packages, formats, prefetch],
      async () => {
        const template = (await documents.get(id))?.template;
        await documents.delete(id);
        if (template === undefined || refusedId(template) !== undefined) return undefined;
        const row = await packages.get(template);
        const left = await documents.where("template").equals(template).count();
        if (left > 0) {
          if (row?.imports?.[id] !== undefined) {
            const { [id]: _gone, ...imports } = row.imports;
            await packages.put({ ...row, imports });
          }
          return undefined;
        }
        await packages.delete(template);
        await prefetch.delete(template);
        // Every format of a package is named after its id and a hash (`generateFormat`).
        const named = `${template}-`;
        await formats.bulkDelete(
          await formats.filter((format) => format.name.startsWith(named)).primaryKeys(),
        );
        return template;
      },
    );
    this.announce({ type: "deleted", id });
    return dropped;
  }

  /**
   * Call `listener` with the id of a document this store holds when another tab changes or
   * deletes it: when that tab says so, or when a save here meets the change. It is called once
   * for each reading, which takes no more saves. Returns a function that stops the calls.
   */
  onChanged(listener: (id: string) => void): () => void {
    this.changedListeners.add(listener);
    return () => this.changedListeners.delete(listener);
  }

  /**
   * Call `listener` with what every flush did, whoever asked for it: the timer, the page going
   * away, a read, or the app. Returns a function that stops the calls.
   */
  onFlushed(listener: (result: Flushed) => void): () => void {
    this.flushedListeners.add(listener);
    return () => this.flushedListeners.delete(listener);
  }

  /**
   * The formats kept for the engine build `tag` names. A format is good only for the build that
   * dumped it, so each is kept under its build's tag, and keeping one drops those of every other
   * build, which this one can never load. Past `MAX_FORMATS`, the least recently used goes.
   */
  formatsFor(tag: string): FormatStore {
    const formats = this.db.formats;
    return {
      get: async (engine, name) => {
        const row = await formats.get(formatKey(tag, engine, name));
        if (row === undefined) return undefined;
        // Marked used after the answer, which need not wait for the format to be written again.
        void formats
          .put({ ...row, usedAt: Date.now() })
          .catch((error: unknown) => console.warn("A kept format could not be marked used", error));
        return row.bytes;
      },
      put: async (engine, name, bytes) => {
        // Another build's formats go first, in a transaction of their own, so that the space they
        // hold is freed even when the new one then does not fit, which would roll back a drop made
        // in its transaction.
        await this.db.transaction("rw", formats, async () => {
          await formats.bulkDelete(await formats.where("tag").notEqual(tag).primaryKeys());
        });
        const row = { key: formatKey(tag, engine, name), tag, engine, name, bytes };
        try {
          await this.keepFormat({ ...row, usedAt: Date.now() });
        } catch (error) {
          if (!isQuotaError(error)) throw error;
          // The disk is full: the least recently used format makes room, and this one is tried
          // once more.
          await this.dropLeastUsedFormat();
          await this.keepFormat({ ...row, usedAt: Date.now() });
        }
      },
    };
  }

  /**
   * The TeX Live files each template is known to read: every path its dumps and compiles have
   * read, first read first, up to `MAX_PATHS`, past which new paths are not kept.
   */
  readonly prefetch: PrefetchStore = {
    get: async (template) => pathsOf(await this.db.prefetch.get(template)),
    add: (template, paths) =>
      this.db.transaction("rw", this.db.prefetch, async () => {
        const known = pathsOf(await this.db.prefetch.get(template));
        const union = [...new Set([...known, ...paths])].slice(0, MAX_PATHS);
        if (union.length > known.length) await this.db.prefetch.put({ template, paths: union });
      }),
  };

  /**
   * Stop listening to the page and the listeners, write what is waiting, and close the database
   * and the channel.
   */
  async close(): Promise<void> {
    this.closed = true;
    this.stopListening();
    this.changedListeners.clear();
    this.flushedListeners.clear();
    await this.flush();
    this.channel?.close();
    this.channel = undefined;
    this.db.close();
  }

  /**
   * Write what waits, and settle once those writes and every one before them are done, saying what
   * came of them. Unless the timer asked (`Asker`), a save made meanwhile is written too, and the
   * flush settles only once none is left; a save that fails is not tried twice in one flush.
   */
  private async flushAll(asker: Asker): Promise<Flushed> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const final = asker === "leaving";
    const results: Flushed[] = [];
    let tried = 0;
    do {
      for (const [id, save] of this.pending) {
        if (save.serial <= tried) continue;
        this.pending.delete(id);
        const written = this.write(id, save, final);
        this.writing.add(written);
        void written.then(() => this.writing.delete(written));
      }
      tried = this.serials;
      results.push(...(await Promise.all(this.writing)));
    } while (asker !== "timer" && [...this.pending.values()].some((save) => save.serial > tried));
    // A save made while the timer's writes were on their way waits for its next tick, set when the
    // save was made; `schedule` sets one only where none is.
    if (asker === "timer") this.schedule();
    const result: Flushed = {
      written: results.reduce((sum, { written }) => sum + written, 0),
      failed: [...new Set(results.flatMap(({ failed }) => failed))],
      conflicts: [...new Set(results.flatMap(({ conflicts }) => conflicts))],
    };
    tell(this.flushedListeners, result);
    return result;
  }

  /**
   * Write one save, and settle, never with an error, with what happened. A save is written only
   * over the revision this tab last read or wrote: the write reads the row and puts the save in
   * one transaction, both asked for at once, so that the put is on its way in the task that asked
   * for it, and aborts the transaction when the read finds another tab's write. As the page is
   * hidden or goes away (`final`) it may run no later task, to hear the read or to let the
   * transaction commit, so the put is committed at once, unchecked, and only what this tab has
   * heard from the others guards it.
   */
  private write(id: string, save: Save, final: boolean): Promise<Flushed> {
    const held = this.held.get(id);
    // A reading the store no longer holds, or one another tab has changed, would be written over
    // what it never read.
    if (held === undefined || held.opened !== save.revision || held.stale)
      return Promise.resolve({ written: 0, failed: [], conflicts: [id] });
    const revision = Math.max(held.revision, held.issued) + 1;
    held.issued = revision;
    const { document } = save;
    const row: DocumentRow = {
      id,
      title: titleOf(document.resume),
      template: document.template,
      createdAt: held.createdAt,
      updatedAt: Date.now(),
      revision,
      document,
    };
    const documents = this.db.documents;
    return this.db
      .transaction("rw", documents, async (transaction) => {
        if (final) {
          const put = documents.put(row);
          // Browsers before `commit` commit once the page lets them, as it may.
          if (typeof transaction.idbtrans.commit === "function") transaction.idbtrans.commit();
          await put;
          return;
        }
        // The read answers first, with the row as it was before the put.
        const before = documents.get(id);
        const put = documents.put(row);
        // A put the read refuses is rolled back with the transaction; its error says nothing new.
        put.catch(() => {});
        if (revisionOf(await before) !== held.revision) throw new Conflict();
        await put;
      })
      .then(
        (): Flushed => {
          held.revision = Math.max(held.revision, revision);
          this.retryAt = 0;
          this.announce({ type: "changed", id, revision });
          return { written: 1, failed: [], conflicts: [] };
        },
        (error: unknown): Flushed => {
          if (error instanceof Conflict) {
            this.changedUnder(id, held);
            return { written: 0, failed: [], conflicts: [id] };
          }
          console.error("The document could not be saved in this browser", error);
          // A document is worth more than a format, which only saves a dump.
          if (isQuotaError(error))
            this.dropLeastUsedFormat().catch((error: unknown) =>
              console.warn("No kept format could make room for the document", error),
            );
          // A newer save carries this one's edits, and is written in its place.
          if (this.newest.get(id) !== save.serial) return { written: 0, failed: [], conflicts: [] };
          this.pending.set(id, save);
          this.retryAt = Date.now() + RETRY_DELAY;
          clearTimeout(this.timer);
          this.timer = undefined;
          this.schedule();
          return { written: 0, failed: [id], conflicts: [] };
        },
      );
  }

  /**
   * Write what waits once `SAVE_DELAY` has passed, or later while a failed write waits to be tried
   * again. Nothing is written by the timer once the store is closed.
   */
  private schedule() {
    if (this.timer !== undefined || this.closed || this.pending.size === 0) return;
    const delay = Math.max(SAVE_DELAY, this.retryAt - Date.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flushAll("timer");
    }, delay);
  }

  /** What another tab said it did; anything that is not such a message is ignored. */
  private heard(data: unknown) {
    const change = Change.safeParse(data);
    if (!change.success) return;
    const { id } = change.data;
    const held = this.held.get(id);
    if (held === undefined) return;
    // A write this tab has read already, or one before it, changes nothing here.
    if (change.data.type === "changed" && change.data.revision <= held.revision) return;
    this.changedUnder(id, held);
  }

  /** Another tab has changed a document this one holds: nothing more of this reading is written. */
  private changedUnder(id: string, held: Held) {
    if (held.stale) return;
    held.stale = true;
    // A reading the store has since replaced is no one's concern.
    if (this.held.get(id) !== held) return;
    tell(this.changedListeners, id);
  }

  /** Tell the other tabs what this one did; a message that cannot be sent costs them only time. */
  private announce(change: Change) {
    try {
      this.channel?.postMessage(change);
    } catch (error) {
      console.warn("The other tabs could not be told of a change", error);
    }
  }

  private keepFormat(row: FormatRow): Promise<void> {
    const formats = this.db.formats;
    return this.db.transaction("rw", formats, async () => {
      await formats.put(row);
      const over = (await formats.count()) - MAX_FORMATS;
      if (over > 0)
        await formats.bulkDelete(await formats.orderBy("usedAt").limit(over).primaryKeys());
    });
  }

  private dropLeastUsedFormat(): Promise<void> {
    const formats = this.db.formats;
    return this.db.transaction("rw", formats, async () => {
      const [key] = await formats.orderBy("usedAt").limit(1).primaryKeys();
      if (key !== undefined) await formats.delete(key);
    });
  }
}

const formatKey = (tag: string, engine: Engine, name: string) => `${tag}:${engine}:${name}`;

/** A row's revision, 0 for a row written before revisions, and undefined for no row. */
function revisionOf(row: DocumentRow | undefined): number | undefined {
  if (row === undefined) return undefined;
  return Number.isSafeInteger(row.revision) ? row.revision : 0;
}

/** The paths a prefetch row holds, whatever wrote it: only strings, and none for no row. */
function pathsOf(row: PrefetchRow | undefined): string[] {
  const paths: unknown = row?.paths;
  return Array.isArray(paths)
    ? paths.filter((path): path is string => typeof path === "string")
    : [];
}

/**
 * Call each listener. One that throws is reported, and keeps neither the others from their call
 * nor a flush from its answer.
 */
function tell<T>(listeners: Set<(value: T) => void>, value: T) {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch (error) {
      console.error("A listener to the store failed", error);
    }
  }
}

/**
 * Whether an error is the browser's refusal to store more, as Dexie gives it: as it is, or inside
 * the error of the transaction it aborted.
 */
function isQuotaError(error: unknown): boolean {
  let cause = error;
  for (let depth = 0; depth < 4 && typeof cause === "object" && cause !== null; depth++) {
    if ((cause as { name?: unknown }).name === "QuotaExceededError") return true;
    cause = (cause as { inner?: unknown }).inner;
  }
  return false;
}
