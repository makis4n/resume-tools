import { createReadStream, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const SPIKE_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".tex": "text/plain; charset=utf-8",
  ".otf": "font/otf",
};

/**
 * Serve the engine spike's page assets (`spike/web/`, hundreds of MB of engine and TeX Live
 * bundles) at `/spike/` in the dev server only. Keeping them out of `public/` keeps them out
 * of `dist/`; nothing about the spike ships.
 */
function spikeServer(): Plugin {
  const root = resolve(__dirname, "spike", "web");
  return {
    name: "spike-server",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/spike/", (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (!file.startsWith(root + sep)) return next();
        let size: number;
        try {
          const stat = statSync(file);
          if (!stat.isFile()) return next();
          size = stat.size;
        } catch {
          return next();
        }
        res.setHeader("Content-Type", SPIKE_TYPES[extname(file)] ?? "application/octet-stream");
        res.setHeader("Content-Length", size);
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), spikeServer()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
