# 0099. A password is chosen after the address is confirmed

Date: 2026-10-21 · Status: proposed (milestone 4 item 5, after its adversarial review); amends 0094

## Context

Decision 0094 has the person sign up with an email and a password and then confirm the address.
The review of item 5 showed, on the local stack's Auth (2.197.0), that a password set before the
address is confirmed survives the confirmation, whoever set it: anyone with the public key can sign
up with someone else's address and a password of their own, and once the owner confirms the
address, by the confirmation link or by an email link, that password signs in to the owner's
account. Signing up again before confirming does not replace the first password either. The same
review found that sign-up told which addresses have accounts, that an email Auth refused to send
was reported as sent, that a reload lost the recovery state, and that the server lets any holder of
a session token change the password.

## Decision

- **No password before the address is proven.** "Make an account" takes only the email and sends a
  link, as the email link does, that confirms a new address or signs in to an existing account. It
  leads back to the editor, signed in, with a panel to choose a password (the same rule, stated
  before submitting), which the person may leave for now and set later.
- **The database drops a password set before confirmation.** A trigger on `auth.users` empties the
  password when `email_confirmed_at` goes from none to a time. Only the address's owner can confirm
  it, so a password that survives was set after the address was proven.
- **Sign-up answers alike.** `[auth.sms] enable_confirmations` is on, though phone sign-up is off:
  with it off Auth confirms phones itself, and then answers a sign-up for an address with an
  account with `user_already_exists` instead of the answer a new address gets.
- **An email not sent is said.** `over_email_send_rate_limit` reads "Too many emails were asked
  for…, so none was sent", for making an account and for a reset alike. Auth gives that code both
  when the project's email budget is spent and when one address asks again too soon, and the editor
  cannot tell them apart without reading Auth's text.
- **The recovery state survives a reload.** This browser's storage keeps which account is choosing
  a password until it is set, left for now, or the person signs out.
- **`secure_password_change` is on.** Auth refuses a new password from a session more than a day old
  without a code emailed to the account. The editor's own change signs in afresh with the current
  password first, and a reset or "Make an account" link's session is new, so neither needs a code.

## Consequences

- Making an account takes the password one step later, after the email, rather than in the same
  form. An account made by the email link alone, or left without a password, signs in by email link.
- The trigger is the first migration that touches `auth.users`; it is tested with pgTAP and by the
  integration tests that replay both ways of taking over an address.
- Two ways to tell which addresses have accounts remain, both in Auth's own answers, which no
  setting changes: its sign-up answer for an address that was sent a sign-in or reset link carries
  `recovery_sent_at`, and a second reset for a known address asked within `max_frequency` is
  refused while one for an unknown address is not. The editor says so honestly rather than hide a
  failure. Milestone 5 checks whether the hosted Auth's version closes them.
- The current password is still checked only by the editor. A stolen session token less than a day
  old can change the password, which `secure_password_change` does not prevent; such a token can
  already read and delete the account's documents.
