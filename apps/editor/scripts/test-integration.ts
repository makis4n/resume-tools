/**
 * Run the editor's integration tests, `src/**\/*.integration.test.ts`, against the local Supabase
 * stack (milestone 4, decision 0096):
 *
 *   pnpm --filter @resume-tools/editor test:integration [<vitest args>...]
 *
 * It asks the pinned CLI for the running stack's address, its publishable key and Mailpit's
 * address, and hands them to the tests as `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and
 * `MAILPIT_URL`. With no stack running it says so and runs the tests anyway, which then skip, as
 * the tests that need TeX skip without the engine. Start the stack first with `stack:start`. With
 * `REQUIRE_STACK` set, as the `accounts` workflow sets it, no stack is a failure instead.
 */
import { spawnSync } from "node:child_process";

const status = spawnSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
  encoding: "utf8",
});
const env: NodeJS.ProcessEnv = { ...process.env };
let stack: Record<string, string> | undefined;
if (status.status === 0) {
  try {
    stack = JSON.parse(status.stdout.slice(status.stdout.indexOf("{")));
  } catch {
    stack = undefined;
  }
}
if (stack?.API_URL && stack.PUBLISHABLE_KEY) {
  env.VITE_SUPABASE_URL = stack.API_URL;
  env.VITE_SUPABASE_PUBLISHABLE_KEY = stack.PUBLISHABLE_KEY;
  if (stack.MAILPIT_URL) env.MAILPIT_URL = stack.MAILPIT_URL;
  console.log(`test:integration: against the local stack at ${stack.API_URL}`);
} else if (process.env.REQUIRE_STACK) {
  // The accounts workflow sets this, so a stack that failed to start fails the run rather than
  // letting every test skip.
  console.error("test:integration: REQUIRE_STACK is set but no local Supabase stack is running");
  process.exit(1);
} else {
  console.log("test:integration: no local Supabase stack is running; the tests will skip");
}

const run = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "--config", "vitest.integration.config.ts", ...process.argv.slice(2)],
  { stdio: "inherit", env },
);
process.exit(run.status ?? 1);
