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

/**
 * A link from an earlier request, after a newer one was asked for in this browser, even one that
 * was refused (too many at once), which no email answers.
 */
export const LINK_SUPERSEDED =
  "That sign-in link was replaced by a later request. Open the newest email if one came, or send a new link.";

/** Any other link that could not sign in. */
export const LINK_FAILED = "That link could not sign you in. Send a new one.";

/** The account cannot sign in at all. */
export const ACCOUNT_BLOCKED = "This account cannot sign in.";

/**
 * An email that could not be sent for now: too many asked for in a short time, by this address or
 * by everyone. Never read as sent (decision 0099).
 */
export const TOO_MANY =
  "Too many emails were asked for in a short time, so none was sent. Wait a minute, then try again.";

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

/** The password rule, stated before the person submits one (decision 0094). */
export const PASSWORD_HINT = "At least 8 characters.";

/**
 * A password that breaks the rule, refused by the editor before any request or by the server. The
 * upper bound is 72 bytes (`MAX_BYTES`), which the second sentence says in plain words.
 */
export const PASSWORD_RULE =
  "A password needs at least 8 characters and at most 72. Accented letters, emoji and other symbols can count as more than one.";

/**
 * A failed sign-in with a password: one message for a wrong email, a wrong password, and an
 * address with no account, so it never says which was wrong.
 */
export const WRONG_PASSWORD =
  "That email and password do not match an account. Check them and try again, or reset your password.";

/**
 * The right password for an address not yet confirmed. Supabase says so only once the password is
 * right (a wrong one gets `invalid_credentials`, as any other), so it tells nothing to someone
 * without the password. The email link confirms the address too.
 */
export const CONFIRM_FIRST =
  "Confirm your email first: open the link we sent when you made the account. If it has expired, use “Email me a link” to get a new one.";

/** Signing in with a password failed for another reason. */
export const SIGN_IN_FAILED = "You could not be signed in. Try again.";

/** Too many sign-ins or password changes tried in a short time. */
export const TOO_MANY_TRIES = "Too many tries in a short time. Wait a few minutes, then try again.";

/** Signing up failed for a reason that is not the address or the password. */
export const NOT_MADE = "Your account could not be made. Try again.";

/** The current password, asked for before changing it, was wrong; nothing changed. */
export const WRONG_CURRENT = "That is not your current password. Your password has not changed.";

/** The new password is the one the account has already. */
export const SAME_PASSWORD = "That is already your password. Choose a different one.";

/**
 * The session is more than a day old, and Auth asks for an emailed code before setting a password
 * from it (`secure_password_change`, decision 0099); a new link makes a new session.
 */
export const SIGNED_IN_TOO_LONG_AGO =
  "You signed in too long ago to set a password this way. Choose “Not now”, then “Change password”, and ask for a link to set one.";

/** The session ended before the password could be set. */
export const SESSION_ENDED =
  "You are no longer signed in, so the password was not changed. Sign in again, or ask for a new reset link.";

/** The password could not be set for another reason. */
export const NOT_CHANGED = "Your password could not be changed. Try again.";

/**
 * What the person was doing when the error came: sending a link, coming back from one, signing
 * out, signing up, signing in with a password, asking for a reset link, setting a new password
 * (after a reset or while signed in), and checking the current password before changing it.
 */
export type Moment =
  | "send"
  | "link"
  | "signOut"
  | "signUp"
  | "signIn"
  | "reset"
  | "password"
  | "current";

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
  // The client's own error for a call that needs a session when none is kept.
  if (name === "AuthSessionMissingError") return "session_missing";
  return undefined;
}

/** The editor's words for `error`, met while doing `moment`; never the error's own text. */
export function messageFor(error: unknown, moment: Moment): string {
  const code = codeOf(error);
  if (code === "network") return UNREACHABLE;
  if (code === "user_banned") return ACCOUNT_BLOCKED;
  const typed = moment === "signIn" || moment === "password" || moment === "current";
  if (typed && code === "over_request_rate_limit") return TOO_MANY_TRIES;
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
    // Making an account sends only the address (decision 0099), so a failed validation is it.
    case "signUp":
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
          return NOT_MADE;
      }
    case "signIn":
      switch (code) {
        case "invalid_credentials":
        case "validation_failed":
        case "user_not_found":
          return WRONG_PASSWORD;
        case "email_not_confirmed":
          return CONFIRM_FIRST;
        case "email_provider_disabled":
          return EMAIL_OFF;
        default:
          return SIGN_IN_FAILED;
      }
    case "reset":
      switch (code) {
        case "email_address_invalid":
        case "validation_failed":
          return BAD_ADDRESS;
        case "email_address_not_authorized":
        case "email_provider_disabled":
          return EMAIL_OFF;
        default:
          return NOT_SENT;
      }
    case "password":
      switch (code) {
        // Only the password is sent, so a failed validation is the password: over 72 characters.
        case "weak_password":
        case "validation_failed":
          return PASSWORD_RULE;
        case "same_password":
          return SAME_PASSWORD;
        case "reauthentication_needed":
          return SIGNED_IN_TOO_LONG_AGO;
        case "session_missing":
        case "session_not_found":
        case "session_expired":
        case "refresh_token_not_found":
        case "refresh_token_already_used":
        case "no_authorization":
        case "bad_jwt":
          return SESSION_ENDED;
        default:
          return NOT_CHANGED;
      }
    case "current":
      switch (code) {
        case "invalid_credentials":
          return WRONG_CURRENT;
        default:
          return NOT_CHANGED;
      }
  }
}

/** Titles as a sentence names them: each in quotation marks, joined by commas. */
const named = (titles: readonly string[]) => titles.map((title) => `“${title}”`).join(", ");

/**
 * Signing out stopped before removing anything, since some documents are not in the account
 * (decision 0092): it names them, and the person stays signed in. A document whose saves have not
 * been sent yet waits for the connection; one the account refused (decision 0098, `refused`) is
 * never sent as it is, so waiting cannot help: it has to change, or go. The sign-out warning
 * (milestone 4 item 9) asks, under it, whether to sign out all the same (`SIGN_OUT_ANYWAY`).
 */
export function unsentNotice(unsent: readonly { title: string; refused?: boolean }[]): string {
  const waiting = unsent.filter((each) => each.refused !== true).map(({ title }) => title);
  const refused = unsent.filter((each) => each.refused === true).map(({ title }) => title);
  const said = [
    "You are still signed in: some documents are not in your account yet, so nothing was removed from this browser.",
  ];
  if (waiting.length > 0)
    said.push(`Not saved yet: ${named(waiting)}. Try again once you are online.`);
  if (refused.length > 0)
    said.push(
      `Your account could not keep: ${named(refused)}, most likely because it is too large. Make it smaller or delete it, then sign out again.`,
    );
  return said.join(" ");
}

// The account's screens (milestone 4 item 9): the header's state, the list's marks, and every
// message of the sync queue (decision 0092), in the editor's own words.

/** Under the account's menu, beside "Sign out": what signing out does to this browser (0092). */
export const SIGN_OUT_NOTE =
  "Signing out removes your account's documents from this browser. They stay in your account.";

/** The sign-out warning's question, under `unsentNotice`. */
export const SIGN_OUT_ANYWAY =
  "Sign out anyway, and they are removed from this browser: what is not in your account is lost. Or stay signed in, and they stay here.";

/** The header's quiet line of where the account's documents are, while signed in. */
export const SYNC_SAVING = "Saving to your account…";
export const SYNC_SAVED = "Saved to your account";
export const SYNC_OFFLINE = "Offline: your changes are kept in this browser";
export const SYNC_NOT_ALL = "Some documents could not be saved to your account";

/** The first save's notice (decision 0091): its title, and what is sent and kept, in plain words. */
export const SAVING_TITLE = "Saving to your account";
export const SAVING_NOTICE =
  "While you are signed in, your documents are saved to your account as well as in this browser, so you can open them on your other devices. What is sent: each document; and for a resume imported from .tex files, the files you uploaded and the editor's reading of them. Your account keeps them until you delete them. Nothing has been sent yet.";

/** The first sign-in's question (decision 0092): documents only in this browser. */
export const ADD_QUESTION = "Add them to your account?";

/** What the question says of the documents it is about, and of what adding them sends. */
export function addDetail(count: number): string {
  const these = count === 1 ? "One document is" : `${count} documents are`;
  return `${these} only in this browser. Adding them sends each one to your account, which keeps it until you delete it, with the files you uploaded for a resume imported from .tex files. “Not now” leaves them only in this browser; you can add each one later from the list.`;
}

/** The list's marks, one per document: where it is (`Where`, decision 0092). */
export const PLACE_MARKS = {
  "in-account": "In your account",
  waiting: "Waiting to save to your account",
  refused: "Could not be saved to your account",
  "only-here": "Only in this browser",
} as const;

/** Why a document is marked refused (decision 0098), beside the mark. */
export const REFUSED_WHY =
  "It is most likely too large for your account to keep. It stays in this browser, and is tried again once you change it.";

/** An open document the account changed, from another device (decision 0092), with a Reload. */
export const CHANGED_ON_DEVICE = "This document was changed on another device.";

/**
 * This device's version of a document kept as a copy (decision 0092), titled `copy`: the account's
 * version took its place (`conflict`), or the account no longer has it (`deleted`). `open` says it
 * of the document open; otherwise it is named, by its title without the copy's ending.
 */
export function copiedNotice(
  copy: string,
  why: "conflict" | "deleted",
  open: boolean,
  suffix: string,
): string {
  const original = copy.endsWith(suffix) ? copy.slice(0, -suffix.length) : copy;
  const subject = open ? "This document" : `“${original}”`;
  const happened = why === "conflict" ? "was changed" : "was deleted";
  return `${subject} ${happened} on another device. Your version here was kept as “${copy}”.`;
}
