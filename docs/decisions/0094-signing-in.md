# 0094. Signing in: email link, Google, and email and password

Date: 2026-10-21 · Status: accepted for the three ways in, the owner's decision of 5 October 2026,
reconfirmed on 20 October 2026; the details below are proposed with docs/milestone-4.md

## Context

The plan names sign-in but no way to do it. The owner chose all three of Supabase's common ways:
a link sent by email, Google, and an email with a password. Local Supabase catches every email in
its own inbox, Mailpit, so the email link, confirmation and password reset can be tested end to
end without sending mail. Google needs an OAuth client that only the owner can register in Google
Cloud.

## Decision

- **One client, PKCE.** The browser's Supabase client is made with the PKCE flow, keeps the session
  in the browser's local storage as Supabase does by default, and refreshes it itself. A link
  opened in another browser than the one that asked for it says so in plain words and offers to send
  a new one there.
- **Email link**: the person types an email and is sent a link that signs them in, and makes the
  account if there is none. The email says what the link does and that it can be ignored.
- **Email and password**: signing up needs the email confirmed before the first sign-in
  (`enable_confirmations` on). A password is at least 12 characters and at most 72, with no rule on
  which characters, following NIST's current guidance that length matters and composition rules do
  not. A wrong email or password gets one message that does not say which was wrong.
- **Reset**: "Forgot your password?" sends a link by email whether or not the account exists, and
  says so in those words. The link opens the editor in a recovery state where the person sets a new
  password. Changing a password while signed in asks for the current one.
- **Google**: a "Continue with Google" button. Locally it works against a Google OAuth client the
  owner registers as a web application, in testing mode, with the redirect address
  `http://127.0.0.1:54321/auth/v1/callback` and the dev server's address as its origin. Its id and
  secret come from an untracked environment file through `env()` in `config.toml`, never from the
  repository. Without them the button is hidden and nothing else changes. If the owner has not
  registered a client by the time its item is reached, the item moves to milestone 5, which needs a
  production client anyway.
- **Linking by email**: Supabase's automatic linking is kept. A person who signed in by email link
  and later continues with Google on the same, verified address gets one account, not two. Before
  linking, Supabase drops any unconfirmed identity on that address, so nobody can claim an account
  by signing up with someone else's address and waiting. Manual linking stays off.
- **Signing up stays open** on the local stack. Whether the hosted project limits it is milestone
  5's.
- **Words**: every sign-in message is the editor's own plain English. Supabase's error text is never
  shown as it comes.

## Consequences

- Three ways in mean three sets of messages and tests. Two of them depend on email, which locally is
  Mailpit and at hosting needs a real mail provider, since Supabase's built-in sender is
  rate-limited and meant for trials (milestone 5).
- Google cannot be tested in CI, which has no Google account. CI checks that the button leads to
  Google's address with the right redirect; a real sign-in with Google is checked by hand.
- A session in local storage can be read by any script running on the editor's page. The editor
  runs no third-party script, and keeps it that way.
- Supabase's check of passwords against known leaks is a paid feature of the hosted service, not of
  the local stack; milestone 5 decides on it.
