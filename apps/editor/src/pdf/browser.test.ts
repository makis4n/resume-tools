import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { minimalPdf } from "../test/minimal-pdf";
import { readPdf } from "./node";
import { isPdfRefusal, READ_TIME_LIMIT_MS } from "./refusals";

/**
 * The page's worker, as a test can have one: pdf.js's own worker code, the file Vite makes the
 * page's worker from, on the far side of a message channel in this thread. Messages cross it as
 * they cross a worker's boundary, copied or transferred, never shared. `silent` makes one whose
 * worker never answers, as a worker stuck on a file would not.
 */
const { FakeWorker } = vi.hoisted(() => {
  class FakeWorker {
    static made: FakeWorker[] = [];
    static silent = false;
    readonly channel = new MessageChannel();
    terminated = false;
    constructor() {
      FakeWorker.made.push(this);
      const { port1, port2 } = this.channel;
      port1.start();
      if (FakeWorker.silent) return;
      void import("pdfjs-dist/legacy/build/pdf.worker.mjs").then(({ WorkerMessageHandler }) => {
        WorkerMessageHandler.initializeFromPort(port2);
        port2.start();
      });
    }
    postMessage(message: unknown, transfer?: Transferable[]) {
      this.channel.port1.postMessage(message, transfer ?? []);
    }
    addEventListener(type: string, listener: EventListener) {
      this.channel.port1.addEventListener(type, listener);
    }
    removeEventListener(type: string, listener: EventListener) {
      this.channel.port1.removeEventListener(type, listener);
    }
    terminate() {
      this.terminated = true;
      this.channel.port1.close();
      this.channel.port2.close();
    }
  }
  return { FakeWorker };
});

vi.mock("pdfjs-dist/legacy/build/pdf.worker.mjs?worker", () => ({ default: FakeWorker }));

const { readPdfInWorker } = await import("./browser");

const OTHER_DIR = fileURLToPath(
  new URL("../../scripts/spike-pdf/fixtures/other/", import.meta.url),
);

afterEach(() => {
  FakeWorker.made = [];
  FakeWorker.silent = false;
  vi.useRealTimers();
});

describe("the PDF reader in the page", () => {
  it("reads in a worker of its own, as the tests' reader in this thread reads", async () => {
    for (const name of readdirSync(OTHER_DIR).sort()) {
      const bytes = new Uint8Array(readFileSync(join(OTHER_DIR, name, "resume.pdf")));
      const inWorker = await readPdfInWorker(bytes);
      const inThread = await readPdf(bytes);
      if (isPdfRefusal(inWorker) || isPdfRefusal(inThread)) throw new Error(`${name} refused`);
      expect(inWorker.pages, name).toEqual(inThread.pages);
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

  it("refuses a PDF the worker is stuck on past the time limit, and stops the worker", async () => {
    vi.useFakeTimers();
    FakeWorker.silent = true;
    const pdf = minimalPdf([{ texts: [{ x: 72, y: 80, size: 12, text: "Invented and slow" }] }]);
    const reading = readPdfInWorker(pdf);
    await vi.advanceTimersByTimeAsync(READ_TIME_LIMIT_MS - 1);
    expect(FakeWorker.made.map((worker) => worker.terminated)).toEqual([false]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await reading).toMatchObject({ refused: true, reason: "unreadable" });
    expect(FakeWorker.made.map((worker) => worker.terminated)).toEqual([true]);
  });
});
