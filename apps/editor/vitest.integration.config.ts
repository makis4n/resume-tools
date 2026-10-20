import { defineConfig } from "vitest/config";

// The integration tests, which run against the local Supabase stack (decision 0096), one file at
// a time since they share the stack's database and mail. `scripts/test-integration.ts` runs them
// with the stack's address; `pnpm test` leaves them out (vite.config.ts).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
