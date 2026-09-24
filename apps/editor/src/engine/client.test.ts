import { describe, expect, it } from "vitest";
import { EngineClient } from "./client";

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
