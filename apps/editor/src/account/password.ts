/**
 * The password rule (milestone 4 item 5, decision 0094): at least 8 characters and at most 72, with
 * no rule on which characters. The editor checks it before any request, so a password that breaks
 * it never leaves the page; the server's own refusal of one maps to the same words (`messageFor`).
 */

/** The fewest characters a password may have, as `minimum_password_length` in `config.toml`. */
export const MIN_CHARACTERS = 8;

/**
 * The most a password may have, in bytes of its UTF-8 form, not characters: bcrypt, which Supabase
 * hashes passwords with, reads only the first 72 bytes, so a longer password would match on its
 * start alone. An accented letter takes two bytes, many symbols and emoji three or four, so a
 * password of fewer than 72 characters can be too long.
 */
export const MAX_BYTES = 72;

/** Whether `password` keeps the rule: 8 characters or more, and 72 bytes or fewer. */
export function keepsRule(password: string): boolean {
  // Characters as a person counts them, by code point, so "é" is one and an emoji one.
  const characters = [...password].length;
  const bytes = new TextEncoder().encode(password).length;
  return characters >= MIN_CHARACTERS && bytes <= MAX_BYTES;
}
