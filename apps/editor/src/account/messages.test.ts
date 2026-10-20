import { describe, expect, it } from "vitest";
import {
  ACCOUNT_BLOCKED,
  ANOTHER_BROWSER,
  BAD_ADDRESS,
  codeOf,
  EMAIL_OFF,
  LINK_EXPIRED,
  LINK_FAILED,
  LINK_SUPERSEDED,
  messageFor,
  NOT_SENT,
  NOT_SIGNED_OUT,
  TOO_MANY,
  UNREACHABLE,
} from "./messages";

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

  it("never gives the error's own words", () => {
    const codes = [
      undefined,
      "over_email_send_rate_limit",
      "email_address_invalid",
      "otp_expired",
      "bad_code_verifier",
      "something_new",
    ];
    for (const code of codes)
      for (const moment of ["send", "link", "signOut"] as const)
        expect(messageFor(error(code), moment)).not.toContain("SUPABASE");
  });
});
