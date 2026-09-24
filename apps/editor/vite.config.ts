import { createReadStream, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
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
 * are hundreds of MB each; keeping them out of `public/` keeps them out of `dist/`. Anything
 * under the route that is not a file is a 404, never the app's index page, so the worker cannot
 * mistake HTML for a TeX file.
 */
function serveFolder(name: string, route: string, folder: string, exclude: string[] = []): Plugin {
  const root = resolve(__dirname, folder);
  return {
    name,
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(route, (req, res) => {
        const notFound = () => {
          res.statusCode = 404;
          res.end();
        };
        const url = new URL(req.url ?? "/", "http://localhost");
        const file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (!file.startsWith(root + sep)) return notFound();
        if (exclude.some((dir) => file.startsWith(resolve(root, dir) + sep))) return notFound();
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

export default defineConfig({
  plugins: [
    react(),
    serveFolder("engine-server", "/engine/", ".engine", ["downloads"]),
    serveFolder("spike-server", "/spike/", "spike/web"),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
