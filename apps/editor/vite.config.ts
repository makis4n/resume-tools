import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { serveEngine, serveFolder } from "./scripts/serve-folder.ts";

export default defineConfig({
  plugins: [
    react(),
    serveEngine(resolve(import.meta.dirname, ".engine")),
    serveFolder("spike-server", "/spike/", resolve(import.meta.dirname, "spike/web")),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
  },
});
