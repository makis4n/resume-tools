# 0094. Signing in: email link and password now, Google at hosting

Date: 2026-10-21 · Status: accepted for the three ways in, the owner's decision of 5 October 2026,
reconfirmed on 20 October 2026; Google moved to milestone 5 and the 8-character minimum are the
owner's decisions of 21 October 2026; the other details are proposed with docs/milestone-4.md

## Context

The plan names sign-in but no way to do it. The owner chose all three of Supabase's common ways:
a link sent by email, Google, and an email with a password. Local Supabase catches every email in
its own inbox, Mailpit, so the email link, confirmation and password reset can be tested end to
end without sending mail. Google needs an OAuth client that only the owner can register in Google
Cloud, and hosting needs a production client with a verified consent screen in any case.

## Decision

- **Milestone 4 builds two ways in**: the email link, and the email and password. **Google waits
  for milestone 5**, so that the owner registers one client, at hosting, rather than a testing
  client now and a production one later.
- **One client, PKCE.** The browser's Supabase client is made with the PKCE flow, keeps the session
  in the browser's local storage as Supabase does by default, and refreshes it itself. A link
  opened in another browser than the one that asked for it says so in plain words and offers to
  send a new one there.
- **Email link**: the person types an email and is sent a link that signs them in, and makes the
  account if there is none. The email says what the link does and that it can be ignored.
- **Email and password**: signing up needs the email confirmed before the first sign-in
  (`enable_confirmations` on). A password is at least 8 characters and at most 72, with no rule on
  which characters. Eight is the common minimum and the owner's choice; NIST's current guidance
  asks for 15 when a password is the only factor, and the email link remains for anyone who wants
  no password. A wrong email or password gets one message that does not say which was wrong.
- **Reset**: "Forgot your password?" sends a link by email whether or not the account exists, and
  says so in those words. The link opens the editor in a recovery state where the person sets a new
  password. Changing a password while signed in asks for the current one.
- **Linking by email**: the email link and the password are one identity in Supabase, the email
  one, so they are the same account on the same address. Supabase's automatic linking is kept for
  Google: a Google identity on the same, verified address will join the existing user rather than
  make a second. Before linking, Supabase drops any unconfirmed identity on that address, so nobody
  can claim an account by signing up with someone else's address and waiting. Manual linking stays
  off.
- **Google, in milestone 5**: a "Continue with Google" button, hidden while no client is
  configured. The client is a web application client whose redirect address is the project's
  `/auth/v1/callback`, which on the local stack is `http://127.0.0.1:54321/auth/v1/callback`, with
  the editor's address as its origin. Its secret is read through `env()` in `config.toml` from an
  untracked environment file, never from the repository. A sign-in with Google is checked by hand;
  CI, which has no Google account, checks only that the button leads to Google's address with the
  right redirect.
- **Signing up stays open** on the local stack. Whether the hosted project limits it is milestone
  5's.
- **Words**: every sign-in message is the editor's own plain English. Supabase's error text is never
  shown as it comes.

## Consequences

- Both ways in during milestone 4 depend on email, which locally is Mailpit and at hosting needs a
  real mail provider, since Supabase's built-in sender is rate-limited and meant for trials
  (milestone 5).
- An 8-character password is weaker against guessing than the 15 NIST asks of a single factor.
  Supabase's check of passwords against known leaks, a paid feature of the hosted service and not
  of the local stack, is milestone 5's to decide, and would make up part of the difference.
- A session in local storage can be read by any script running on the editor's page. The editor
  runs no third-party script, and keeps it that way.
- People who expect Google find only email until milestone 5.
