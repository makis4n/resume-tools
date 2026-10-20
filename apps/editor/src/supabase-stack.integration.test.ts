import { describe, expect, it } from "vitest";

// The local Supabase stack answers as milestone 4 expects (item 1, decision 0089): its sign-in
// service, its gateway with the publishable key, and Mailpit. Skips without the stack.
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const mailpit = process.env.MAILPIT_URL;

describe.skipIf(!url || !key)("the local Supabase stack", () => {
  it("serves sign-in with the 8-character minimum and confirmations on", async () => {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key ?? "" } });
    expect(res.ok).toBe(true);
    const settings = (await res.json()) as {
      external: Record<string, boolean>;
      mailer_autoconfirm: boolean;
      disable_signup: boolean;
    };
    expect(settings.external.email).toBe(true);
    expect(settings.mailer_autoconfirm).toBe(false);
    expect(settings.disable_signup).toBe(false);

    const short = await fetch(`${url}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: key ?? "", "content-type": "application/json" },
      body: JSON.stringify({ email: "short.password@example.test", password: "seven77" }),
    });
    expect(short.status).toBe(422);
  });

  it("catches mail in Mailpit", async () => {
    expect(mailpit).toBeTruthy();
    const res = await fetch(`${mailpit}/api/v1/messages`);
    expect(res.ok).toBe(true);
  });
});
