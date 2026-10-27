# 0104. Accounts online

Date: 2026-10-21 · Status: accepted, approved by the owner on 27 October 2026 with the plan for
milestone 5 (docs/milestone-5.md); the owner chose, on 27 October 2026, the Free plan before and
after launch, the Singapore region and Resend for mail; extends 0089, 0094, 0096 and 0099

## Context

Milestone 4 built accounts against the local stack alone (decision 0089) and left to milestone 5
the hosted project, a mail sender, Google, a bot check on signing up, the leaked-password check, a
second look at the replies that tell which addresses have accounts, and the extra session a
password change leaves (decisions 0094, 0099 and 0100). The hosted service is not the local one:
its own sender mails only the project's team, two an hour; a Free project pauses after a week of
low activity and keeps no backups; the leaked-password check is Pro's; and Google shows an app's
name only after brand verification.

## Decision

- **One hosted project**, production, in Singapore, on the Free plan while the milestone builds
  and after launch, as the owner chose on 27 October 2026. No staging project and no branching.
- **Configured from the repository.** Migrations reach it through `supabase db push` and settings
  through `supabase config push`, from the same `config.toml` the local stack runs on. Its
  `[remotes.production]` block holds what differs: the site address `https://<domain>`, the one
  redirect pattern `https://<domain>/**` (links come back with the service's own query), SMTP,
  the bot check, Google, the rate limits, and a minute between two emails to one person, where the
  local stack has one second for its tests. Secrets come from the workflow's environment through
  `env()`. A setting `config push` does not manage is set in the dashboard and listed in the
  README. The hosted schema is never changed in the dashboard.
- **Mail** goes through Resend, the owner's choice, as the project's SMTP server, from an address on
  the domain with SPF, DKIM and DMARC set, and the provider's link tracking off. Every email uses
  the editor's own template in plain English: confirming an address, the sign-in link, a reset, a
  change of address, and the notice that a password changed. Each link leads first to a page of the
  editor's that asks for one click before it goes on to the service's link, which it carries in the
  address's fragment, unseen by any server, and which it follows only to the project's own address.
  A mail scanner that opens the link uses nothing up, and the PKCE exchange of decision 0094 still
  signs in only the browser that asked.
- **Rate limits**: emails an hour set so a day stays within the provider's daily limit (once SMTP
  is set the service allows 30 an hour, and the local stack's 1,000 is for tests); a minute
  between two emails to one person; the rest at the service's defaults, sign-ups and sign-ins 30
  every five minutes per address, unless the hosted project's item finds them too tight.
- **Signing up stays open**, which decision 0094 left to this milestone: the bot check, the rate
  limits and the caps per account (decision 0106) guard it, and the number of accounts is not
  capped at launch.
- **The bot check**: the service's CAPTCHA with Turnstile, on a widget of its own. It then refuses,
  without a token, signing up, signing in with a password, asking for a link or a code, asking for
  a reset and asking to resend. The panel fetches Turnstile when it opens and passes a fresh token
  as `captchaToken` with each request. Signing in with Google and refreshing a session need none.
  Locally it is off; the integration tests that cover it turn it on with Turnstile's test keys.
- **No leaked-password check.** It is Pro's, and the project stays on Free. The bot check, the
  rate limits and milestone 4's minimum of 8 characters guard passwords without it.
- **Google**, as decision 0094 has it, with the owner's production client: a web application with
  the domain as its JavaScript origin and `https://<ref>.supabase.co/auth/v1/callback` as its
  redirect, asking `openid`, `email` and `profile`, published in production, which those scopes
  allow with no review, no test-user list and no seven-day expiry.
- **Google's screen**: without brand verification it shows only the app's domain, which through
  the service is `<ref>.supabase.co`. The owner submits the brand, with the home page and the
  privacy page on the domain verified in Search Console. If Google refuses it because the callback
  is on `supabase.co`, the screen names `<ref>.supabase.co`. Supabase's custom domain, which would
  move the service to `auth.<domain>`, is only on Pro, so on Free that is how the screen stays.
- **The extra session**: the session a password change signs in with, to prove the current
  password, is signed out at once once the new password is set, revoking its refresh token. If
  the hosted service's version checks a current password itself, the change uses that and signs
  in no second time.
- **The three ways to tell which addresses have accounts** (decision 0099) are checked on the
  hosted service; each is closed there, or accepted in a record with the bot check and the rate
  limits as its guard.
- **Proven before anyone but the owners signs up**: `supabase test db --linked` runs the
  database's tests against the hosted project, each rolled back; decision 0093's API test runs
  from the owner's machine with two throwaway accounts made with the service key, which never
  leaves that machine; the editor's own deletion (decision 0105) then removes both; and a query
  over the database connection, with the password the owner holds, finds nothing of them in the
  table or the bucket, since the service key is granted nothing on the table. No check workflow
  calls the hosted project; the `database` workflow alone reaches it (decision 0102).

## Consequences

- `config.toml` stays the record of every setting but the secrets and the dashboard's few, so the
  local stack and the hosted project differ only where `[remotes.production]` says.
- On Free, a week of low activity pauses the project and every sign-in fails until the owner
  resumes it; Supabase warns by email first. A Free project keeps no backups, so a lost or damaged
  database cannot be restored (decision 0102).
- Without the leaked-password check, a password known from another site's breach is accepted.
- Turnstile's script runs on the sign-in panel; Google's way in never meets it.
- The test-time CAPTCHA calls Turnstile's own service with its test keys, so those integration
  tests need the network.
- On Free there is no custom domain, so a person signing in with Google may see `supabase.co` on
  Google's screen.
- A deleted or signed-out device's access token stays valid until it expires, within the hour, but
  reaches no row: the rows are gone or no longer its owner's.
