/**
 * Paths inside an upload and inside the job its files go to: relative, their parts joined by `/`.
 * The corpus's manifest holds its paths to the same rule (`scripts/corpus-manifest.ts`), so that one
 * test of a path serves the documents the corpus fetches and the zips a person uploads.
 *
 * Nothing here reaches for Node or the browser, so the intake runs in both, and Node's scripts
 * import it as it is: it imports nothing, which is what lets Node load it by stripping its types.
 */

/**
 * Whether a path is relative, its parts joined by `/`, none of them empty, `.` or `..`, and with no
 * backslash or control character anywhere, so that it names a file inside the folder it is joined
 * to on every system.
 */
export function isSafePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\") || /\p{Cc}/u.test(path))
    return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** A path's extension in lower case with its dot, or "" when its name has none. */
export function extensionOf(path: string): string {
  const name = nameOf(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** The folder a path is in, "" at the top. */
export const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/** A path's last part, its file's name. */
export const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** A path without its extension (`extensionOf`). */
export const withoutExtension = (path: string) => {
  const extension = extensionOf(path);
  return extension === "" ? path : path.slice(0, -extension.length);
};

/**
 * A name taken from a folder, `.` and `..` worked out, as a path under the top; undefined when it
 * would leave the top or is not a safe path (`isSafePath`).
 */
export function joinPath(folder: string, name: string): string | undefined {
  const parts: string[] = [];
  for (const part of [...folder.split("/"), ...name.split("/")]) {
    if (part === "" || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.pop() === undefined) return undefined;
  }
  const path = parts.join("/");
  return isSafePath(path) ? path : undefined;
}
