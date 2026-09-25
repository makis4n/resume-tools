import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { serveEngine } from "./scripts/serve-folder.ts";

export default defineConfig({
  plugins: [react(), serveEngine(resolve(import.meta.dirname, ".engine"))],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
  },
});
