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

import type { EngineManifest } from "./manifest";

const BASE = "/engine/";

/** The tree's manifest, untagged. */
export const manifestUrl = (): string => `${BASE}manifest.json`;

/**
 * The tag a tree is served under: its BusyTeX release and the layout `scripts/fetch-engine.ts`
 * wrote it in, which between them change whenever any file does.
 */
export const engineTag = ({ release, layout }: Pick<EngineManifest, "release" | "layout">) =>
  `${release}-${layout}`;

/** One of the engine's own files, `busytex.mjs` or `busytex.wasm`, under the tree's tag. */
export const engineUrl = (tag: string, name: string): string =>
  `${BASE}${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;

/** A TeX Live file by its path in the engine's file system, which starts with `/`. */
export const fileUrl = (tag: string, path: string): string =>
  `${BASE}${encodeURIComponent(tag)}/files${path.split("/").map(encodeURIComponent).join("/")}`;
