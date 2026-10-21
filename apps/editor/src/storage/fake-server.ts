/**
 * An in-memory stand-in for the account's `documents` table, for the sync queue's tests and the
 * account screens' DOM tests (decision 0096: a fake in `pnpm test`, the real stack apart). One
 * `FakeAccounts` is the database every account's rows live in; `server(account)` is one device's
 * connection to it, signed in as that account, which can go offline. The fake does what the table
 * and its trigger do: each account sees only its own rows, an insert takes revision 1 and an update
 * one more, and the server stamps the time, whatever the device sent. `anotherDevice` changes a row
 * as a device the test does not drive would.
 */

import type { DocumentKind, ServerDocument, SyncServer, Upload, WriteResult } from "./server";
import { ServerUnavailable } from "./server";

interface Row {
  owner: string;
  id: string;
  kind: DocumentKind;
  templateId: string;
  title: string;
  document: unknown;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

/** What a device asked of the account, in order, for a test to count. */
export interface Call {
  account: string;
  /** The connection's name (`FakeAccounts.server`). */
  device: string;
  method: "list" | "get" | "insert" | "update" | "remove";
  id?: string;
}

/** The `documents` table of every account. */
export class FakeAccounts {
  private readonly rows = new Map<string, Row>();
  /** Every call any device made, in order. */
  readonly calls: Call[] = [];

  /** A device's connection, signed in as `account`, named `device` in `calls`. */
  server(account: string, device = "device"): FakeServer {
    return new FakeServer(this, account, device);
  }

  /** The account's documents as the table holds them, oldest first. */
  documents(account: string): ServerDocument[] {
    return [...this.rows.values()].filter((row) => row.owner === account).map(documentOf);
  }

  /** One of the account's documents, or undefined. */
  document(account: string, id: string): ServerDocument | undefined {
    const row = this.rows.get(id);
    return row?.owner === account ? documentOf(row) : undefined;
  }

  /** How many calls of `method` reached the table, from any device. */
  count(method: Call["method"]): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  /** Writes and deletes made by a device the test does not drive. */
  anotherDevice(account: string) {
    return {
      /** Write a document as another device's update would, the revision counted on. */
      change: (id: string, change: (row: { title: string; document: unknown }) => Partial<Row>) => {
        const row = this.rows.get(id);
        if (row?.owner !== account) throw new Error(`${account} has no document ${id}`);
        const changed = change({ title: row.title, document: structuredClone(row.document) });
        this.rows.set(id, {
          ...row,
          ...changed,
          revision: row.revision + 1,
          updatedAt: Date.now(),
        });
      },
      insert: (upload: Upload) => this.insert(account, upload),
      remove: (id: string) => this.remove(account, id),
    };
  }

  /** @internal */
  call(call: Call) {
    this.calls.push(call);
  }

  /** @internal */
  list(account: string) {
    return [...this.rows.values()]
      .filter((row) => row.owner === account)
      .map(({ id, revision, updatedAt }) => ({ id, revision, updatedAt }));
  }

  /** @internal */
  insert(account: string, upload: Upload): WriteResult {
    // The id is the table's key: taken by any account, the insert is refused.
    if (this.rows.has(upload.id)) return { ok: false, reason: "conflict" };
    const now = Date.now();
    this.rows.set(upload.id, {
      ...copyOf(upload),
      owner: account,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true, revision: 1, updatedAt: now };
  }

  /** @internal */
  update(account: string, upload: Upload, expected: number): WriteResult {
    const row = this.rows.get(upload.id);
    // Another account's row is out of sight, as the table's policies keep it.
    if (row === undefined || row.owner !== account) return { ok: false, reason: "missing" };
    if (row.revision !== expected) return { ok: false, reason: "conflict" };
    const updatedAt = Date.now();
    const revision = row.revision + 1;
    // The kind, the owner and when it was made stay as the insert set them.
    const { title, templateId, document } = copyOf(upload);
    this.rows.set(row.id, { ...row, title, templateId, document, revision, updatedAt });
    return { ok: true, revision, updatedAt };
  }

  /** @internal */
  remove(account: string, id: string) {
    if (this.rows.get(id)?.owner === account) this.rows.delete(id);
  }
}

/** One device's connection to the account, which a test can take offline. */
export class FakeServer implements SyncServer {
  private online = true;
  private paused: Promise<void> | undefined;
  /** Every call this connection made, offline or not. */
  tries = 0;

  constructor(
    private readonly accounts: FakeAccounts,
    readonly account: string,
    readonly device: string,
  ) {}

  /** The connection drops: every call fails with `ServerUnavailable` until `goOnline`. */
  goOffline() {
    this.online = false;
  }

  goOnline() {
    this.online = true;
  }

  /**
   * Hold every call until the function returned is called, as a slow connection would: a test
   * can act while a send is on its way.
   */
  pause(): () => void {
    let release = () => {};
    this.paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.paused = undefined;
      release();
    };
  }

  async list() {
    await this.reach({ method: "list" });
    return this.accounts.list(this.account);
  }

  async get(id: string) {
    await this.reach({ method: "get", id });
    return this.accounts.document(this.account, id) ?? null;
  }

  async insert(doc: Upload) {
    await this.reach({ method: "insert", id: doc.id });
    return this.accounts.insert(this.account, doc);
  }

  async update(doc: Upload, expectedRevision: number) {
    await this.reach({ method: "update", id: doc.id });
    return this.accounts.update(this.account, doc, expectedRevision);
  }

  async remove(id: string) {
    await this.reach({ method: "remove", id });
    this.accounts.remove(this.account, id);
  }

  /**
   * A round trip: a microtask, or as long as the test holds it (`pause`), then the table, unless
   * the device is offline. No timer is used, so that tests with fake timers need not advance them.
   */
  private async reach(call: Omit<Call, "account" | "device">) {
    this.tries++;
    await Promise.resolve();
    if (this.paused !== undefined) await this.paused;
    if (!this.online) throw new ServerUnavailable();
    this.accounts.call({ ...call, account: this.account, device: this.device });
  }
}

/**
 * Web Locks for tests: each lock is granted to one holder at a time, the others waiting in the order
 * they asked, as `navigator.locks` grants them. Two queues given one `FakeLocks` are two tabs.
 */
export class FakeLocks {
  private readonly queues = new Map<string, (() => void)[]>();
  private readonly held = new Set<string>();

  request(name: string, callback: () => Promise<unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const run = () => {
        this.held.add(name);
        Promise.resolve()
          .then(callback)
          .then(resolve, reject)
          .finally(() => {
            this.held.delete(name);
            this.queues.get(name)?.shift()?.();
          });
      };
      if (this.held.has(name)) {
        const queue = this.queues.get(name) ?? [];
        queue.push(run);
        this.queues.set(name, queue);
      } else run();
    });
  }
}

const documentOf = ({ owner: _, ...row }: Row): ServerDocument => structuredClone(row);

/** What the table keeps of an upload: a copy, as JSON crossing the network would be. */
function copyOf({ id, kind, templateId, title, document }: Upload) {
  return { id, kind, templateId, title, document: structuredClone(document) };
}
