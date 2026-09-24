import { createReadStream, statSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".tex": "text/plain; charset=utf-8",
  ".otf": "font/otf",
};

/**
 * Serve a folder at a route in the dev server only. The engine and TeX Live tree
 * (`.engine/`, built by `scripts/fetch-engine.ts`) and the spike's page assets (`spike/web/`)
 * are hundreds of MB each; keeping them out of `public/` keeps them out of `dist/`.
 *
 * `serves` says which paths, relative to the folder, the route answers for. Anything else under
 * the route is a 404, never the app's index page, so the worker cannot take HTML for a TeX file.
 * It keeps the route tidy and is not access control: Vite serves every file under the app's
 * folder in dev anyway.
 */
function serveFolder(
  name: string,
  route: string,
  folder: string,
  serves: (path: string) => boolean = () => true,
): Plugin {
  const root = resolve(__dirname, folder);
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
        const url = new URL(req.url ?? "/", "http://localhost");
        const file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
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
        createReadStream(file).pipe(res);
      });
    },
  };
}

/** What the worker loads from `.engine/`: the engine, the manifest and the TeX Live tree. */
const ENGINE_FILES = new Set(["busytex.mjs", "busytex.wasm", "manifest.json"]);

export default defineConfig({
  plugins: [
    react(),
    serveFolder(
      "engine-server",
      "/engine/",
      ".engine",
      (path) => ENGINE_FILES.has(path) || path.startsWith("files/"),
    ),
    serveFolder("spike-server", "/spike/", "spike/web"),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
