import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { serveFolder } from "./scripts/serve-folder.ts";

/** What the worker loads from `.engine/`: the engine, the manifest and the TeX Live tree. */
const ENGINE_FILES = new Set(["busytex.mjs", "busytex.wasm", "manifest.json"]);

export default defineConfig({
  plugins: [
    react(),
    serveFolder(
      "engine-server",
      "/engine/",
      resolve(import.meta.dirname, ".engine"),
      (path) => ENGINE_FILES.has(path) || path.startsWith("files/"),
    ),
    serveFolder("spike-server", "/spike/", resolve(import.meta.dirname, "spike/web")),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
  },
});
