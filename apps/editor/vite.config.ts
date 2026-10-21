import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";
import { serveEngine } from "./scripts/serve-folder.ts";
import { serveLabel } from "./scripts/serve-label.ts";
import { serveSamples } from "./scripts/serve-samples.ts";

export default defineConfig({
  plugins: [
    react(),
    serveEngine(resolve(import.meta.dirname, ".engine")),
    // The reading service's route that labels a PDF's lines (milestone 3 second pass, item 13).
    serveLabel(),
    // The upstream samples the import is measured on, at ?measure=import (decision 0045).
    serveSamples(),
  ],
  // The compile worker is a module worker, which loads the import's pipeline only when a resume is
  // imported (decision 0038), so its build is one too, split where it imports.
  worker: { format: "es" },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    // The integration tests need the local Supabase stack and run on their own, through
    // `test:integration` (decision 0096), so `pnpm test` never needs Docker.
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
    // Half the cores: the engine tests each run a TeX engine, and a worker on every core made the
    // heaviest imports run eight times slower than alone, past their limits. One on CI's two.
    maxWorkers: "50%",
  },
});
