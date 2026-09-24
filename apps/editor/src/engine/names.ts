/**
 * The names the engine session accepts, shared with the template package schema so that a package
 * which parses is one the session will dump: its id becomes a format name, and its files are
 * written into the job's folder under their own names.
 */

/** A format or job name: letters, digits, `-` and `_`, starting with a letter or digit. */
export const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** A name `dump` or `putFormat` takes for a format. `stock` is the engine's own and is reserved. */
export const isFormatName = (name: string): boolean => NAME.test(name) && name !== "stock";

/** A file name in a job's folder: one path segment that does not start with a dot. */
export const isFileName = (name: string): boolean =>
  name.length > 0 && !name.includes("/") && !name.startsWith(".");
