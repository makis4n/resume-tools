import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { minimalPdf } from "../test/minimal-pdf";
import { readPdf } from "./node";
import { type ReaderScope, serveReadings } from "./protocol";
import { isPdfRefusal, READ_TIME_LIMIT_MS } from "./refusals";

/**
 * The reader's worker, as a test can have one: the worker's own serving code (`protocol.ts`),
 * reading as `reader-worker.ts` reads, on the far side of a message channel in this thread, so that
 * the request and the reading cross it as they cross a worker's boundary, copied or transferred.
 * `mode` makes one that never answers, as a worker stuck on a file would not, or one that fails to
 * load, as a worker whose file the server lost would.
 */
const { FakeWorker } = vi.hoisted(() => {
  class FakeWorker extends EventTarget {
    static made: FakeWorker[] = [];
    static mode: "reads" | "silent" | "broken" = "reads";
    static serve: (scope: ReaderScope) => void = () => undefined;
    readonly channel = new MessageChannel();
    terminated = false;
    constructor() {
      super();
      FakeWorker.made.push(this);
      const { port1, port2 } = this.channel;
      port1.addEventListener("message", (event) =>
        this.dispatchEvent(new MessageEvent("message", { data: (event as MessageEvent).data })),
      );
      port1.start();
      if (FakeWorker.mode === "broken") {
        setTimeout(() => this.dispatchEvent(new Event("error", { cancelable: true })), 0);
        return;
      }
      if (FakeWorker.mode === "silent") return;
      // pdf.js's worker code says it is ready when it loads in a worker, as the real one does.
      port2.postMessage({ sourceName: "worker", targetName: "main", action: "ready", data: null });
      FakeWorker.serve({
        addEventListener: (type, listener) =>
          port2.addEventListener(type, listener as (event: Event) => void),
        postMessage: (message) => port2.postMessage(message),
      });
      port2.start();
    }
    postMessage(message: unknown, transfer: Transferable[] = []) {
      this.channel.port1.postMessage(message, transfer);
    }
    terminate() {
      this.terminated = true;
      this.channel.port1.close();
      this.channel.port2.close();
    }
  }
  return { FakeWorker };
});

vi.mock("./reader-worker.ts?worker", () => ({ default: FakeWorker }));

const { readPdfInWorker, WORKER_GRACE_MS } = await import("./browser");

FakeWorker.serve = (scope) => serveReadings(scope, (bytes) => readPdf(bytes));

const OTHER_DIR = fileURLToPath(
  new URL("../../scripts/spike-pdf/fixtures/other/", import.meta.url),
);

afterEach(() => {
  FakeWorker.made = [];
  FakeWorker.mode = "reads";
  vi.useRealTimers();
});

describe("the PDF reader in the page", () => {
  it("reads in a worker of its own, as the reader in this thread reads", async () => {
    for (const name of readdirSync(OTHER_DIR).sort()) {
      const bytes = new Uint8Array(readFileSync(join(OTHER_DIR, name, "resume.pdf")));
      const inWorker = await readPdfInWorker(bytes);
      const inThread = await readPdf(bytes);
      if (isPdfRefusal(inWorker) || isPdfRefusal(inThread)) throw new Error(`${name} refused`);
      expect(inWorker.pages, name).toEqual(inThread.pages);
      // The caller's bytes stay theirs: the worker was given a copy.
      expect(bytes.byteLength, name).toBeGreaterThan(0);
    }
    // One worker a reading, each ended when its reading was done.
    expect(FakeWorker.made.length).toBe(readdirSync(OTHER_DIR).length);
    expect(FakeWorker.made.every((worker) => worker.terminated)).toBe(true);
  }, 60_000);

  it("refuses in the worker as in this thread, and ends the worker", async () => {
    const locked = minimalPdf([{ texts: [{ x: 72, y: 80, size: 12, text: "Invented, locked" }] }], {
      locked: true,
    });
    expect(await readPdfInWorker(locked)).toMatchObject({ refused: true, reason: "password" });
    expect(FakeWorker.made.map((worker) => worker.terminated)).toEqual([true]);
  }, 60_000);

  it("stops a worker that does not answer past the time limit, and refuses the PDF", async () => {
    vi.useFakeTimers();
    FakeWorker.mode = "silent";
    const pdf = minimalPdf([{ texts: [{ x: 72, y: 80, size: 12, text: "Invented and slow" }] }]);
    const reading = readPdfInWorker(pdf);
    await vi.advanceTimersByTimeAsync(READ_TIME_LIMIT_MS + WORKER_GRACE_MS - 1);
    expect(FakeWorker.made.map((worker) => worker.terminated)).toEqual([false]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await reading).toMatchObject({ refused: true, reason: "too-complex" });
    expect(FakeWorker.made.map((worker) => worker.terminated)).toEqual([true]);
  });

  it("rejects at once, as the editor's failure, when the worker fails to load", async () => {
    vi.useFakeTimers();
    FakeWorker.mode = "broken";
    const pdf = minimalPdf([{ texts: [{ x: 72, y: 80, size: 12, text: "Invented and fine" }] }]);
    const reading = readPdfInWorker(pdf);
    const failed = expect(reading).rejects.toThrow(/worker failed/);
    await vi.advanceTimersByTimeAsync(1);
    await failed;
    expect(FakeWorker.made.map((worker) => worker.terminated)).toEqual([true]);
  });

  it("stops the worker when the reading is stopped", async () => {
    FakeWorker.mode = "silent";
    const stop = new AbortController();
    const pdf = minimalPdf([{ texts: [{ x: 72, y: 80, size: 12, text: "Invented and long" }] }]);
    const reading = readPdfInWorker(pdf, { signal: stop.signal });
    stop.abort();
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.made.map((worker) => worker.terminated)).toEqual([true]);
  });

  it("lets pdf.js's own messages pass by, on either side of the line", async () => {
    let answered: unknown;
    let listener: ((event: MessageEvent) => void) | undefined;
    serveReadings(
      {
        addEventListener: (_type, l) => {
          listener = l;
        },
        postMessage: (message) => {
          answered = message;
        },
      },
      () => Promise.reject(new Error("not asked")),
    );
    listener?.(new MessageEvent("message", { data: { targetName: "worker", action: "test" } }));
    await Promise.resolve();
    expect(answered).toBeUndefined();
    // A reader that fails answers unreadable, never nothing.
    listener?.(
      new MessageEvent("message", { data: { kind: "read-pdf", bytes: new Uint8Array(4) } }),
    );
    await vi.waitFor(() => expect(answered).toMatchObject({ reading: { reason: "unreadable" } }));
  });
});
