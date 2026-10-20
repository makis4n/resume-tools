/**
 * What the person reads when signing in goes wrong (milestone 4 item 4, decision 0094): the
 * editor's own plain English, chosen by the error's code. Supabase's own text, an error's
 * `message` or a callback's `error_description`, is never shown; it goes to the console at most.
 */

/** A link opened in another browser than the one that asked for it, which has no verifier. */
export const ANOTHER_BROWSER =
  "This link was asked for in a different browser, so it cannot sign you in here. Send a new link from this browser, and open it here.";

/** A link that has run out, or was used already. */
export const LINK_EXPIRED =
  "That sign-in link has expired or has already been used. Send a new one.";

/** A link from an earlier request, after a newer one was asked for in this browser. */
export const LINK_SUPERSEDED =
  "That sign-in link is from an earlier request. Open the newest email, or send a new link.";

/** Any other link that could not sign in. */
export const LINK_FAILED = "That link could not sign you in. Send a new one.";

/** The account cannot sign in at all. */
export const ACCOUNT_BLOCKED = "This account cannot sign in.";

/** Too many links asked for in a short time. */
export const TOO_MANY = "Too many sign-in emails were asked for. Wait a minute, then try again.";

/** The address was refused as it is written. */
export const BAD_ADDRESS = "That email address does not look right. Check it and try again.";

/** Signing in by email is turned off where the accounts are. */
export const EMAIL_OFF = "Signing in by email is not available right now.";

/** The link could not be sent for another reason. */
export const NOT_SENT = "The link could not be sent. Try again.";

/** The accounts could not be reached, or their code could not be loaded. */
export const UNREACHABLE =
  "The account service could not be reached. Check your connection and try again.";

/** Signing out did not finish, and the session is still here. */
export const NOT_SIGNED_OUT = "You could not be signed out. Try again.";

/** What the person was doing when the error came. */
export type Moment = "send" | "link" | "signOut";

/**
 * The error's code, as the editor reads it: Supabase's `code`, or a callback's error code, or
 * `network` for a request that never reached the server; none for anything else.
 */
export function codeOf(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (typeof error !== "object" || error === null) return undefined;
  const { code, name } = error as { code?: unknown; name?: unknown };
  if (typeof code === "string" && code !== "") return code;
  // The client's own wrapper for a request that did not reach the server, and fetch's own failure.
  if (name === "AuthRetryableFetchError" || error instanceof TypeError) return "network";
  return undefined;
}

/** The editor's words for `error`, met while doing `moment`; never the error's own text. */
export function messageFor(error: unknown, moment: Moment): string {
  const code = codeOf(error);
  if (code === "network") return UNREACHABLE;
  if (code === "user_banned") return ACCOUNT_BLOCKED;
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") return TOO_MANY;
  switch (moment) {
    case "send":
      switch (code) {
        case "email_address_invalid":
        case "validation_failed":
          return BAD_ADDRESS;
        case "email_address_not_authorized":
        case "email_provider_disabled":
        case "otp_disabled":
        case "signup_disabled":
          return EMAIL_OFF;
        default:
          return NOT_SENT;
      }
    case "link":
      switch (code) {
        case "pkce_code_verifier_not_found":
          return ANOTHER_BROWSER;
        case "otp_expired":
        case "flow_state_expired":
        case "flow_state_not_found":
        case "access_denied":
          return LINK_EXPIRED;
        case "bad_code_verifier":
          return LINK_SUPERSEDED;
        default:
          return LINK_FAILED;
      }
    case "signOut":
      return NOT_SIGNED_OUT;
  }
}
