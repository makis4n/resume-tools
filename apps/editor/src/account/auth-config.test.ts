import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Auth settings the editor's accounts rely on (decision 0099), read from the stack's own
// `config.toml`: what a stolen old session cannot do, and what a sign-up does not tell. The
// integration tests show the second against the running stack; the first needs a session a day old,
// which they cannot make, so it is held here.

const config = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");

/** The value of `key` in the `[section]` table of the config, as written. */
function setting(section: string, key: string): string | undefined {
  let inside = false;
  for (const line of config.split("\n")) {
    const table = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (table) inside = table[1] === section;
    else if (inside) {
      const found = new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`).exec(line);
      if (found) return found[1];
    }
  }
  return undefined;
}

describe("the Auth settings of the accounts", () => {
  it("asks a session more than a day old for an emailed code before it sets a password", () => {
    expect(setting("auth.email", "secure_password_change")).toBe("true");
  });

  it("confirms phones, so that a sign-up answers an address with an account as a new one", () => {
    // With it off, Auth confirms phones itself and then answers `user_already_exists`.
    expect(setting("auth.sms", "enable_confirmations")).toBe("true");
    expect(setting("auth.sms", "enable_signup")).toBe("false");
  });

  it("confirms an email before the first sign-in", () => {
    expect(setting("auth.email", "enable_confirmations")).toBe("true");
  });
});
