import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportProgress } from "../import/run";
import { EngineCancelled, EngineClient, EngineTimeout } from "./client";

/** A stand-in for the compile worker, which keeps what it is sent and replies when told to. */
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  posted: { id: number; type: string }[] = [];
  terminated = false;
  postMessage(message: { id: number; type: string }) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.({ data });
  }
  fail(message: string) {
    this.onerror?.({ message });
  }
}

const clientOf = (worker: FakeWorker) => new EngineClient(worker as unknown as Worker);

describe("EngineClient", () => {
  it("settles each call with the reply that carries its id", async () => {
    const worker = new FakeWorker();
    const client = clientOf(worker);
    const forgotten = client.forget("a");
    const started = client.start();
    const [forget, start] = worker.posted;
    worker.reply({ id: start?.id, result: { files: 3 } });
    worker.reply({ id: forget?.id, error: "no job named a" });
    await expect(started).resolves.toEqual({ files: 3 });
    await expect(forgotten).rejects.toThrow("no job named a");
  });

  it("fails what waits on a worker that fails, and every call after it", async () => {
    const worker = new FakeWorker();
    const client = clientOf(worker);
    const waiting = client.start();
    worker.fail("out of memory");
    await expect(waiting).rejects.toThrow("compile worker: out of memory");
    expect(worker.terminated).toBe(true);
    // A failed worker answers nothing, so a call made to it would wait for ever.
    const later = client.compile("pdftex", "stock", "");
    expect(worker.posted).toHaveLength(1);
    await expect(later).rejects.toThrow("compile worker: out of memory");
  });

  it("asks for a job's PDF, and resolves with the result the worker sends", async () => {
    const worker = new FakeWorker();
    const client = clientOf(worker);
    const made = client.pdf("doc", { compress: 0 });
    expect(worker.posted).toEqual([{ type: "pdf", job: "doc", options: { compress: 0 }, id: 1 }]);
    const result = { ok: true, pdf: new TextEncoder().encode("%PDF-1.5"), ms: 20, output: "" };
    worker.reply({ id: 1, result });
    await expect(made).resolves.toEqual(result);
  });

  it("asks the worker to drop a format", async () => {
    const worker = new FakeWorker();
    const client = clientOf(worker);
    const dropped = client.dropFormat("pdftex", "import-0123456789ab-89abcdef");
    expect(worker.posted).toEqual([
      { type: "dropFormat", engine: "pdftex", name: "import-0123456789ab-89abcdef", id: 1 },
    ]);
    worker.reply({ id: 1, result: null });
    await expect(dropped).resolves.toBeUndefined();
  });

  it("fails every call after it is terminated", async () => {
    const worker = new FakeWorker();
    const client = clientOf(worker);
    const waiting = client.start();
    client.terminate();
    await expect(waiting).rejects.toThrow("compile worker terminated");
    const later = client.forget("a");
    expect(worker.posted).toHaveLength(1);
    await expect(later).rejects.toThrow("compile worker terminated");
  });
});

/** A progress message of an import's, at a step, and whether a compile is under way. */
const progress = (compiles: number, compiling: boolean): ImportProgress => ({
  step: "probe",
  label: "Finding the parts you can edit",
  compiles,
  compiling,
});

describe("EngineClient's imports and cancel (decision 0038)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A client over fake workers it makes as it needs them, and the workers it made. */
  function clientWithWorkers() {
    const workers: FakeWorker[] = [];
    const client = new EngineClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    return { client, workers };
  }

  it("hands on an import's progress as it comes, and settles with its reply", async () => {
    const { client, workers } = clientWithWorkers();
    const heard: ImportProgress[] = [];
    const files = [{ name: "cv.tex", bytes: new TextEncoder().encode("invented") }];
    const done = client.importResume(files, (each) => heard.push(each));
    const [worker] = workers;
    expect(worker?.posted).toEqual([{ type: "import", files, id: 1 }]);
    worker?.reply({ id: 1, progress: progress(0, true) });
    worker?.reply({ id: 1, progress: progress(1, false) });
    // Progress settles nothing.
    const outcome = { refused: true, reason: "parse", message: "This resume could not be read." };
    worker?.reply({ id: 1, result: outcome });
    await expect(done).resolves.toEqual(outcome);
    expect(heard).toEqual([progress(0, true), progress(1, false)]);
  });

  it("cancels: terminates the worker, fails what waits on it, and starts a new one for the next call", async () => {
    const { client, workers } = clientWithWorkers();
    const importing = client.importResume([], () => {});
    const started = client.start();
    client.cancel();
    await expect(importing).rejects.toBeInstanceOf(EngineCancelled);
    await expect(started).rejects.toBeInstanceOf(EngineCancelled);
    expect(workers[0]?.terminated).toBe(true);
    // No new worker until a call needs one; then the call goes to it.
    expect(workers).toHaveLength(1);
    const later = client.forget("doc");
    expect(workers).toHaveLength(2);
    expect(workers[1]?.posted).toEqual([{ type: "forget", job: "doc", id: 3 }]);
    // What the old worker says now reaches nothing.
    workers[0]?.reply({ id: 2, result: { files: 1 } });
    workers[1]?.reply({ id: 3, result: null });
    await expect(later).resolves.toBeUndefined();
  });

  it("takes a compile of an import that runs past its limit for hung, and starts the worker afresh", async () => {
    vi.useFakeTimers();
    const { client, workers } = clientWithWorkers();
    const done = client.importResume([], () => {}, 1_000);
    const [worker] = workers;
    // Between compiles, the naming service may take as long as it takes.
    worker?.reply({ id: 1, progress: progress(0, false) });
    vi.advanceTimersByTime(5_000);
    expect(worker?.terminated).toBe(false);
    // A compile that ends in time is fine; one that does not is hung.
    worker?.reply({ id: 1, progress: progress(1, true) });
    vi.advanceTimersByTime(900);
    worker?.reply({ id: 1, progress: progress(1, false) });
    worker?.reply({ id: 1, progress: progress(2, true) });
    vi.advanceTimersByTime(999);
    expect(worker?.terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(worker?.terminated).toBe(true);
    await expect(done).rejects.toBeInstanceOf(EngineTimeout);
    expect(vi.getTimerCount()).toBe(0);
    // The next call starts a new worker.
    void client.start();
    expect(workers).toHaveLength(2);
  });

  it("stops for good on a cancel when it was given a worker rather than a maker of them", async () => {
    const worker = new FakeWorker();
    const client = clientOf(worker);
    const waiting = client.start();
    client.cancel();
    await expect(waiting).rejects.toBeInstanceOf(EngineCancelled);
    await expect(client.start()).rejects.toBeInstanceOf(EngineCancelled);
    expect(worker.posted).toHaveLength(1);
  });
});
