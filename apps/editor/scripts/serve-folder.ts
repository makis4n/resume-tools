/**
 * Serve a folder at a route in the dev server only. The engine and TeX Live tree
 * (`.engine/`, built by `scripts/fetch-engine.ts`) and the spike's page assets (`spike/web/`)
 * are hundreds of MB each; keeping them out of `public/` keeps them out of `dist/`.
 */

import { createReadStream, statSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".tex": "text/plain; charset=utf-8",
  ".otf": "font/otf",
};

/**
 * `folder` is an absolute path. `serves` says which paths, relative to the folder, the route
 * answers for. Anything else under the route is a 404, never the app's index page, so the worker
 * cannot take HTML for a TeX file. It keeps the route tidy and is not access control: Vite serves
 * every file under the app's folder in dev anyway.
 */
export function serveFolder(
  name: string,
  route: string,
  folder: string,
  serves: (path: string) => boolean = () => true,
): Plugin {
  const root = resolve(folder);
  return {
    name,
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(route, (req, res, next) => {
        // Connect also hands this route "/spike.html" and "/spike", which are not in the folder.
        if (!req.originalUrl?.startsWith(route)) return next();
        const notFound = () => {
          res.statusCode = 404;
          res.end();
        };
        let path: string;
        try {
          path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
        } catch {
          return notFound();
        }
        const file = resolve(root, `.${path}`);
        if (!file.startsWith(root + sep)) return notFound();
        if (!serves(relative(root, file).split(sep).join("/"))) return notFound();
        let size: number;
        try {
          const stat = statSync(file);
          if (!stat.isFile()) return notFound();
          size = stat.size;
        } catch {
          return notFound();
        }
        res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
        res.setHeader("Content-Length", size);
        const stream = createReadStream(file);
        // The file can go between the stat and the read, as when fetch-engine swaps a new tree
        // in. Without a listener the error would be thrown, and stop the dev server.
        stream.on("error", () => {
          if (res.headersSent) return res.destroy();
          res.removeHeader("Content-Type");
          res.removeHeader("Content-Length");
          notFound();
        });
        // A request the browser abandons, as on a reload, closes the file too.
        res.on("close", () => stream.destroy());
        stream.pipe(res);
      });
    },
  };
}
