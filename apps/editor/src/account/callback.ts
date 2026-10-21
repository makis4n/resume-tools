/**
 * The sign-in callback in the editor's address (milestone 4 item 4, decision 0094): a sign-in link
 * leads back to the editor with `?code=`, which the PKCE flow exchanges for a session, or, when the
 * link could not sign in, with an error and its code, which Supabase puts in the query and again in
 * the fragment. The editor reads the code and the error's code, never the error's description, and
 * takes them all out of the address once read, so a reload does not read them again.
 */

import { flowIdOf } from "./client";

/**
 * What a sign-in link brought back: the code to exchange, with the flow id of the request it
 * answers when the link carries one, and whether the person asked to choose a password once signed
 * in (making an account); or the code of what went wrong.
 */
export type Callback = { code: string; flowId?: string; choosePassword?: true } | { error: string };

/**
 * The parameter, and its value, that "Make an account" adds to the address its link leads back to,
 * so that the editor asks for a password once the link has signed the person in (decision 0099).
 * It grants nothing: only a code this browser asked for signs in, and the person can leave it.
 */
export const THEN = "then";
export const CHOOSE_PASSWORD = "password";

/** The parameters a sign-in callback adds, which are taken out of the address once read. */
const PARAMS = ["code", "sb_flow_id", "error", "error_code", "error_description", THEN] as const;

/** The parameters of a fragment such as `#error=access_denied&error_code=otp_expired`. */
function fragment(url: URL): URLSearchParams {
  return new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
}

/**
 * The callback in `href`, or none. An error wins over a code: the error's code where it has one
 * (`otp_expired`), its kind where it has not (`access_denied`), from the query or the fragment.
 */
export function callbackOf(href: string): Callback | undefined {
  const url = new URL(href);
  for (const params of [url.searchParams, fragment(url)]) {
    const error = params.get("error_code") || params.get("error");
    if (error) return { error };
  }
  const code = url.searchParams.get("code");
  if (!code) return undefined;
  const flowId = flowIdOf(url.searchParams.get("sb_flow_id"));
  return {
    code,
    ...(flowId === undefined ? {} : { flowId }),
    ...(url.searchParams.get(THEN) === CHOOSE_PASSWORD ? { choosePassword: true as const } : {}),
  };
}

/** `href` with the callback's parameters taken out, and the fragment if it held only those. */
export function withoutCallback(href: string): string {
  const url = new URL(href);
  for (const name of PARAMS) url.searchParams.delete(name);
  const hash = fragment(url);
  if (PARAMS.some((name) => hash.has(name))) {
    for (const name of PARAMS) hash.delete(name);
    const rest = hash.toString();
    url.hash = rest === "" ? "" : `#${rest}`;
  }
  return url.toString();
}
