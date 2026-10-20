import { describe, expect, it } from "vitest";
import { redirectOf } from "./account";
import { callbackOf, withoutCallback } from "./callback";
import {
  accountsConfig,
  accountsConfigured,
  hasStoredSession,
  hasStoredVerifier,
  type SessionStorage,
  STORAGE_KEY,
  VERIFIER_KEY,
} from "./client";

/** A storage holding `entries`, as local storage would. */
function storageOf(entries: Record<string, string>): SessionStorage {
  const kept = new Map(Object.entries(entries));
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => void kept.set(key, value),
    removeItem: (key) => void kept.delete(key),
  };
}

/** A storage that refuses every read, as a blocked one does. */
const refusing: SessionStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {},
  removeItem: () => {},
};

describe("accountsConfigured", () => {
  it("needs both the address and the key", () => {
    const url = "http://127.0.0.1:54321";
    const key = "sb_publishable_invented";
    expect(accountsConfigured({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key })).toBe(
      true,
    );
    expect(accountsConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key })).toEqual({
      url,
      key,
    });
    expect(accountsConfigured({ VITE_SUPABASE_URL: url })).toBe(false);
    expect(accountsConfigured({ VITE_SUPABASE_PUBLISHABLE_KEY: key })).toBe(false);
    expect(accountsConfigured({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: " " })).toBe(
      false,
    );
    expect(accountsConfigured({})).toBe(false);
  });
});

describe("hasStoredSession", () => {
  const session = JSON.stringify({
    access_token: "invented.access.token",
    refresh_token: "invented-refresh",
    expires_at: 1,
    user: { email: "someone@example.test" },
  });

  it("finds the session the client keeps under its key", () => {
    expect(hasStoredSession(storageOf({ [STORAGE_KEY]: session }))).toBe(true);
  });

  it("finds none without one, or with what is not a session", () => {
    expect(hasStoredSession(storageOf({}))).toBe(false);
    expect(hasStoredSession(storageOf({ "sb-other-auth-token": session }))).toBe(false);
    expect(hasStoredSession(storageOf({ [STORAGE_KEY]: "not json" }))).toBe(false);
    expect(hasStoredSession(storageOf({ [STORAGE_KEY]: "null" }))).toBe(false);
    expect(hasStoredSession(storageOf({ [STORAGE_KEY]: '{"access_token":"a"}' }))).toBe(false);
    expect(hasStoredSession(storageOf({ [STORAGE_KEY]: '{"refresh_token":""}' }))).toBe(false);
    expect(hasStoredSession(storageOf({ [VERIFIER_KEY]: '"verifier"' }))).toBe(false);
  });

  it("finds none where there is no storage, or it refuses the read", () => {
    expect(hasStoredSession(undefined)).toBe(false);
    expect(hasStoredSession(refusing)).toBe(false);
  });
});

describe("hasStoredVerifier", () => {
  it("finds the verifier kept when a link was asked for here", () => {
    expect(hasStoredVerifier(storageOf({ [VERIFIER_KEY]: '"invented-verifier"' }))).toBe(true);
    expect(hasStoredVerifier(storageOf({}))).toBe(false);
    expect(hasStoredVerifier(refusing)).toBe(false);
    expect(hasStoredVerifier(undefined)).toBe(false);
  });
});

describe("the sign-in callback in the address", () => {
  it("reads a code", () => {
    expect(callbackOf("http://localhost:5173/?code=invented-code")).toEqual({
      code: "invented-code",
    });
    expect(callbackOf("http://localhost:5173/")).toBeUndefined();
    expect(callbackOf("http://localhost:5173/?measure=1")).toBeUndefined();
  });

  it("reads an error's code, from the query or the fragment, before any code", () => {
    expect(
      callbackOf(
        "http://localhost:5173/?error=access_denied&error_code=otp_expired&error_description=Words#error=access_denied&error_code=otp_expired",
      ),
    ).toEqual({ error: "otp_expired" });
    expect(callbackOf("http://localhost:5173/#error=access_denied&error_code=otp_expired")).toEqual(
      { error: "otp_expired" },
    );
    expect(callbackOf("http://localhost:5173/?error=access_denied")).toEqual({
      error: "access_denied",
    });
    expect(callbackOf("http://localhost:5173/?code=c&error_code=flow_state_expired")).toEqual({
      error: "flow_state_expired",
    });
  });

  it("is taken out of the address, and nothing else is", () => {
    expect(withoutCallback("http://localhost:5173/?code=invented-code")).toBe(
      "http://localhost:5173/",
    );
    expect(withoutCallback("http://localhost:5173/app?measure=1&code=c&sb_flow_id=f")).toBe(
      "http://localhost:5173/app?measure=1",
    );
    expect(
      withoutCallback(
        "http://localhost:5173/?error=access_denied&error_code=otp_expired&error_description=Words#error=access_denied&error_code=otp_expired&error_description=Words",
      ),
    ).toBe("http://localhost:5173/");
    expect(withoutCallback("http://localhost:5173/#section")).toBe(
      "http://localhost:5173/#section",
    );
  });

  it("leads a link back to the editor's own address", () => {
    expect(redirectOf("http://localhost:5173/?code=c#x")).toBe("http://localhost:5173/");
    expect(redirectOf("https://editor.example.test/app/?a=1")).toBe(
      "https://editor.example.test/app/",
    );
  });
});
