import { describe, expect, it } from "vitest";
import {
  ACCOUNT_BLOCKED,
  ANOTHER_BROWSER,
  BAD_ADDRESS,
  CONFIRM_FIRST,
  codeOf,
  EMAIL_OFF,
  LINK_EXPIRED,
  LINK_FAILED,
  LINK_SUPERSEDED,
  messageFor,
  NOT_CHANGED,
  NOT_MADE,
  NOT_SENT,
  NOT_SIGNED_OUT,
  PASSWORD_RULE,
  SAME_PASSWORD,
  SESSION_ENDED,
  SIGN_IN_FAILED,
  SIGNED_IN_TOO_LONG_AGO,
  TOO_MANY,
  TOO_MANY_TRIES,
  UNREACHABLE,
  WRONG_CURRENT,
  WRONG_PASSWORD,
} from "./messages";
import { keepsRule, MAX_BYTES, MIN_CHARACTERS } from "./password";

/** An error as the client gives one: its code, and words of Supabase's own that are never shown. */
const error = (code?: string, name = "AuthApiError") => ({
  name,
  code,
  status: 400,
  message: "SUPABASE'S OWN WORDS",
});

describe("messageFor", () => {
  it("chooses the editor's words for sending a link by the error's code", () => {
    expect(messageFor(error("over_email_send_rate_limit"), "send")).toBe(TOO_MANY);
    expect(messageFor(error("over_request_rate_limit"), "send")).toBe(TOO_MANY);
    expect(messageFor(error("email_address_invalid"), "send")).toBe(BAD_ADDRESS);
    expect(messageFor(error("validation_failed"), "send")).toBe(BAD_ADDRESS);
    expect(messageFor(error("signup_disabled"), "send")).toBe(EMAIL_OFF);
    expect(messageFor(error("otp_disabled"), "send")).toBe(EMAIL_OFF);
    expect(messageFor(error("email_address_not_authorized"), "send")).toBe(EMAIL_OFF);
    expect(messageFor(error("unexpected_failure"), "send")).toBe(NOT_SENT);
    expect(messageFor(error(), "send")).toBe(NOT_SENT);
  });

  it("chooses the editor's words for a link that came back", () => {
    expect(messageFor(error("pkce_code_verifier_not_found"), "link")).toBe(ANOTHER_BROWSER);
    expect(messageFor(error("otp_expired"), "link")).toBe(LINK_EXPIRED);
    expect(messageFor(error("flow_state_expired"), "link")).toBe(LINK_EXPIRED);
    expect(messageFor(error("flow_state_not_found"), "link")).toBe(LINK_EXPIRED);
    expect(messageFor("access_denied", "link")).toBe(LINK_EXPIRED);
    expect(messageFor("otp_expired", "link")).toBe(LINK_EXPIRED);
    expect(messageFor(error("bad_code_verifier"), "link")).toBe(LINK_SUPERSEDED);
    expect(messageFor(error("user_banned"), "link")).toBe(ACCOUNT_BLOCKED);
    expect(messageFor("unspecified_code", "link")).toBe(LINK_FAILED);
    expect(messageFor(undefined, "link")).toBe(LINK_FAILED);
  });

  it("says the service could not be reached for a request that never got there", () => {
    expect(messageFor(error(undefined, "AuthRetryableFetchError"), "send")).toBe(UNREACHABLE);
    expect(messageFor(new TypeError("Failed to fetch"), "link")).toBe(UNREACHABLE);
    expect(codeOf(new TypeError("Failed to fetch"))).toBe("network");
  });

  it("says a sign-out did not finish", () => {
    expect(messageFor(error("unexpected_failure"), "signOut")).toBe(NOT_SIGNED_OUT);
  });

  it("chooses the editor's words for signing up", () => {
    expect(messageFor(error("validation_failed"), "signUp")).toBe(BAD_ADDRESS);
    expect(messageFor(error("email_address_invalid"), "signUp")).toBe(BAD_ADDRESS);
    expect(messageFor(error("signup_disabled"), "signUp")).toBe(EMAIL_OFF);
    expect(messageFor(error("email_provider_disabled"), "signUp")).toBe(EMAIL_OFF);
    expect(messageFor(error("otp_disabled"), "signUp")).toBe(EMAIL_OFF);
    expect(messageFor(error("over_request_rate_limit"), "signUp")).toBe(TOO_MANY);
    // An email Auth could not send is said, never read as sent (decision 0099).
    expect(messageFor(error("over_email_send_rate_limit"), "signUp")).toBe(TOO_MANY);
    expect(messageFor(error("unexpected_failure"), "signUp")).toBe(NOT_MADE);
  });

  it("gives one message for a failed sign-in with a password, whichever was wrong", () => {
    expect(messageFor(error("invalid_credentials"), "signIn")).toBe(WRONG_PASSWORD);
    expect(messageFor(error("user_not_found"), "signIn")).toBe(WRONG_PASSWORD);
    expect(messageFor(error("validation_failed"), "signIn")).toBe(WRONG_PASSWORD);
    expect(messageFor(error("email_not_confirmed"), "signIn")).toBe(CONFIRM_FIRST);
    expect(messageFor(error("over_request_rate_limit"), "signIn")).toBe(TOO_MANY_TRIES);
    expect(messageFor(error("user_banned"), "signIn")).toBe(ACCOUNT_BLOCKED);
    expect(messageFor(error("unexpected_failure"), "signIn")).toBe(SIGN_IN_FAILED);
  });

  it("chooses the editor's words for a reset link", () => {
    expect(messageFor(error("validation_failed"), "reset")).toBe(BAD_ADDRESS);
    expect(messageFor(error("email_provider_disabled"), "reset")).toBe(EMAIL_OFF);
    expect(messageFor(error("over_request_rate_limit"), "reset")).toBe(TOO_MANY);
    expect(messageFor(error("over_email_send_rate_limit"), "reset")).toBe(TOO_MANY);
    expect(messageFor(error("unexpected_failure"), "reset")).toBe(NOT_SENT);
  });

  it("chooses the editor's words for setting a new password", () => {
    expect(messageFor(error("weak_password"), "password")).toBe(PASSWORD_RULE);
    // The server's own "too long", over 72 characters.
    expect(messageFor(error("validation_failed"), "password")).toBe(PASSWORD_RULE);
    expect(messageFor(error("same_password"), "password")).toBe(SAME_PASSWORD);
    // A session over a day old, which `secure_password_change` asks a code of (decision 0099).
    expect(messageFor(error("reauthentication_needed"), "password")).toBe(SIGNED_IN_TOO_LONG_AGO);
    expect(messageFor(error("session_not_found"), "password")).toBe(SESSION_ENDED);
    expect(messageFor(error(undefined, "AuthSessionMissingError"), "password")).toBe(SESSION_ENDED);
    expect(messageFor(error("over_request_rate_limit"), "password")).toBe(TOO_MANY_TRIES);
    expect(messageFor(error("unexpected_failure"), "password")).toBe(NOT_CHANGED);
    expect(messageFor(error("invalid_credentials"), "current")).toBe(WRONG_CURRENT);
    expect(messageFor(error("unexpected_failure"), "current")).toBe(NOT_CHANGED);
  });

  it("never gives the error's own words", () => {
    const codes = [
      undefined,
      "over_email_send_rate_limit",
      "email_address_invalid",
      "otp_expired",
      "bad_code_verifier",
      "invalid_credentials",
      "email_not_confirmed",
      "weak_password",
      "same_password",
      "something_new",
    ];
    for (const code of codes)
      for (const moment of [
        "send",
        "link",
        "signOut",
        "signUp",
        "signIn",
        "reset",
        "password",
        "current",
      ] as const)
        expect(messageFor(error(code), moment)).not.toContain("SUPABASE");
  });
});

describe("keepsRule", () => {
  it("takes 8 characters to 72 bytes, with no rule on which characters", () => {
    expect(MIN_CHARACTERS).toBe(8);
    expect(MAX_BYTES).toBe(72);
    expect(keepsRule("1234567")).toBe(false);
    expect(keepsRule("12345678")).toBe(true);
    expect(keepsRule("        ")).toBe(true);
    expect(keepsRule("a".repeat(72))).toBe(true);
    expect(keepsRule("a".repeat(73))).toBe(false);
  });

  it("counts characters for the least and UTF-8 bytes for the most", () => {
    // Four two-byte letters are 8 bytes but 4 characters: too short.
    expect(keepsRule("éééé")).toBe(false);
    expect(keepsRule("éééééééé")).toBe(true);
    // 36 two-byte letters are 72 bytes; one more of anything is over.
    expect(keepsRule("é".repeat(36))).toBe(true);
    expect(keepsRule(`${"é".repeat(36)}a`)).toBe(false);
    // An emoji is one character of four bytes.
    expect(keepsRule("🙂".repeat(8))).toBe(true);
    expect(keepsRule("🙂".repeat(19))).toBe(false);
  });
});
