import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { serveEngine } from "./scripts/serve-folder.ts";
import { serveNaming } from "./scripts/serve-naming.ts";

export default defineConfig({
  plugins: [react(), serveEngine(resolve(import.meta.dirname, ".engine")), serveNaming()],
  // The compile worker is a module worker, which loads the import's pipeline only when a resume is
  // imported (decision 0038), so its build is one too, split where it imports.
  worker: { format: "es" },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    // Half the cores: the engine tests each run a TeX engine, and a worker on every core made the
    // heaviest imports run eight times slower than alone, past their limits. One on CI's two.
    maxWorkers: "50%",
  },
});
