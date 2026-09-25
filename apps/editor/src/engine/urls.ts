/**
 * Where the browser fetches the engine and its TeX Live tree: served by the dev server from
 * `.engine/` now, and from a CDN in milestone 5.
 *
 * Every file but the manifest lives under a tag, the release and layout the manifest names, and
 * a new tree comes with a new tag. A URL's contents therefore never change, so they can be cached
 * for good, which matters because the worker reads TeX Live one file at a time with synchronous
 * requests, and only the HTTP cache can answer those (decision 0010). The manifest is what names
 * the tag, so it stays at one untagged URL that is revalidated on every load.
 *
 * The worker builds its URLs here, and so does the main thread, which fetches the files a
 * template reads ahead of TeX and the fonts the page draws: a file fetched under one URL and read
 * under another would be fetched twice.
 */

const BASE = "/engine/";

/** The tree's manifest, untagged. */
export const manifestUrl = (): string => `${BASE}manifest.json`;

/**
 * The tag a tree is served under: its BusyTeX release and the layout `scripts/fetch-engine.ts`
 * wrote it in, as its manifest names them, which between them change whenever any file does.
 */
export const engineTag = ({ release, layout }: { release: string; layout: number }) =>
  `${release}-${layout}`;

/** One of the engine's own files, `busytex.mjs` or `busytex.wasm`, under the tree's tag. */
export const engineUrl = (tag: string, name: string): string =>
  `${BASE}${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;

/**
 * A TeX Live file by its path in the engine's file system, which starts with `/`. Each segment is
 * encoded, so that nothing in a name reads as part of the URL, but a `.` or `..` segment would
 * still be read as a step through the tree, out of `files/` and on to any path of the origin, and
 * an empty one names no file. No path the manifest lists has either, so such a path is refused:
 * it is a mistake in the caller, or a path that did not come from the manifest.
 */
export function fileUrl(tag: string, path: string): string {
  const [root, ...segments] = path.split("/");
  if (
    root !== "" ||
    segments.length === 0 ||
    segments.some((s) => s === "" || s === "." || s === "..")
  )
    throw new Error(`not a path in the engine's file system: ${JSON.stringify(path)}`);
  return `${BASE}${encodeURIComponent(tag)}/files/${segments.map(encodeURIComponent).join("/")}`;
}
