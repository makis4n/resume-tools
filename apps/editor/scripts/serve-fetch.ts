/**
 * The service's routes in the dev server (decision 0028): each route's handler is written against
 * the fetch API, and these convert Node's request to a `Request`, whose body is a stream the handler
 * reads no faster than it takes it and no further than its cap, and the handler's `Response` back
 * to Node's. The label route (`serve-label.ts`) uses them.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** A request as connect hands it on: with the URL it came with, before any route was taken off. */
export type Incoming = IncomingMessage & { originalUrl?: string };

/**
 * Node's request body as a stream: each chunk handed on as it comes, Node's stream paused while
 * one waits to be read, and, once the reader stops, what is left drained and dropped, so that the
 * connection can still carry the answer.
 */
function bodyOf(req: IncomingMessage): ReadableStream<Uint8Array> {
  let open = true;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      req.on("data", (chunk: Buffer) => {
        if (!open) return;
        controller.enqueue(chunk);
        if ((controller.desiredSize ?? 0) <= 0) req.pause();
      });
      req.on("end", () => {
        if (!open) return;
        open = false;
        controller.close();
      });
      req.on("error", (error) => {
        if (!open) return;
        open = false;
        controller.error(error);
      });
    },
    pull() {
      req.resume();
    },
    cancel() {
      open = false;
      req.resume();
    },
  });
}

/**
 * Node's request as the fetch API's: its method, its URL on the dev server's own origin, its
 * headers, and a body for any method that has one. A URL that cannot be read is the route's own.
 */
export function toRequest(req: Incoming, route: string): Request {
  const headers = new Headers();
  for (const [header, value] of Object.entries(req.headers)) {
    // HTTP/2's pseudo-headers are no header's name.
    if (value === undefined || header.startsWith(":")) continue;
    for (const each of Array.isArray(value) ? value : [value]) headers.append(header, each);
  }
  const method = req.method ?? "GET";
  const path = req.originalUrl ?? req.url ?? "/";
  let url: URL;
  try {
    url = new URL(path, `http://${req.headers.host ?? "localhost"}`);
  } catch {
    url = new URL(route, "http://localhost");
  }
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = bodyOf(req);
    init.duplex = "half";
  }
  return new Request(url, init);
}

/** A `Response` written to Node's response: its status, its headers and its body. */
export async function send(res: ServerResponse, response: Response): Promise<void> {
  const body = new Uint8Array(await response.arrayBuffer());
  res.statusCode = response.status;
  response.headers.forEach((value, header) => {
    res.setHeader(header, value);
  });
  res.setHeader("Content-Length", body.byteLength);
  res.end(body);
}
