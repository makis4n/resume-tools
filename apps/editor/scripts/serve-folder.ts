/**
 * Serve a folder at a route in the dev server only. The engine and TeX Live tree
 * (`.engine/`, built by `scripts/fetch-engine.ts`) and the spike's page assets (`spike/web/`)
 * are hundreds of MB each; keeping them out of `public/` keeps them out of `dist/`.
 */

import { createReadStream, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import type { EngineManifest } from "../src/engine/manifest.ts";
import { engineTag } from "../src/engine/urls.ts";

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".tex": "text/plain; charset=utf-8",
  ".otf": "font/otf",
};

export interface ServeOptions {
  /**
   * The tag the folder's contents are served under now, if any: a request's first segment under
   * the route may be it, and is taken off before the path is looked up, so that
   * `/engine/<tag>/files/a.sty` serves `files/a.sty`. A tag names one version of what its URLs
   * hold, which lets the browser keep them for good, so a request under any other tag is not
   * found: the folder holds one version, and answering for another would have the browser keep
   * this one's bytes under that one's URLs for good (see `src/engine/urls.ts`).
   */
  tag?: () => string | undefined;
  /**
   * The `Cache-Control` header for a path the route serves, relative to the folder, and whether
   * it came under a tag; none when it returns undefined.
   */
  cacheControl?: (path: string, tagged: boolean) => string | undefined;
}

/**
 * `folder` is an absolute path. `serves` says which paths, relative to the folder, the route
 * answers for, and may answer differently under a tag. Anything else under the route is a 404,
 * never the app's index page, so the worker cannot take HTML for a TeX file. It keeps the route
 * tidy and is not access control: Vite serves every file under the app's folder in dev anyway.
 */
export function serveFolder(
  name: string,
  route: string,
  folder: string,
  serves: (path: string, tagged: boolean) => boolean = () => true,
  options: ServeOptions = {},
): Plugin {
  const root = resolve(folder);
  return {
    name,
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(route, (req, res, next) => {
        // Connect also hands this route "/spike.html" and "/spike", which are not in the folder.
        if (!req.originalUrl?.startsWith(route)) return next();
        const notFound = () => {
          res.statusCode = 404;
          res.end();
        };
        let path: string;
        try {
          path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
        } catch {
          return notFound();
        }
        // A tag is a whole segment with more path after it; the manifest, which names the tag,
        // sits at the route's top level, untagged.
        const tag = options.tag ? /^\/([^/]+)(?=\/)/.exec(path) : null;
        const tagged = tag !== null;
        if (tag) {
          if (tag[1] !== options.tag?.()) return notFound();
          path = path.slice(tag[0].length);
        }
        const file = resolve(root, `.${path}`);
        if (!file.startsWith(root + sep)) return notFound();
        const served = relative(root, file).split(sep).join("/");
        if (!serves(served, tagged)) return notFound();
        let size: number;
        try {
          const stat = statSync(file);
          if (!stat.isFile()) return notFound();
          size = stat.size;
        } catch {
          return notFound();
        }
        res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
        res.setHeader("Content-Length", size);
        const cacheControl = options.cacheControl?.(served, tagged);
        if (cacheControl !== undefined) res.setHeader("Cache-Control", cacheControl);
        const stream = createReadStream(file);
        // The file can go between the stat and the read, as when fetch-engine swaps a new tree
        // in. Without a listener the error would be thrown, and stop the dev server.
        stream.on("error", () => {
          if (res.headersSent) return res.destroy();
          res.removeHeader("Content-Type");
          res.removeHeader("Content-Length");
          res.removeHeader("Cache-Control");
          notFound();
        });
        // A request the browser abandons, as on a reload, closes the file too.
        res.on("close", () => stream.destroy());
        stream.pipe(res);
      });
    },
  };
}

/** A year, the longest `max-age` caches keep to, and `immutable`, so a reload does not ask again. */
export const IMMUTABLE = "public, max-age=31536000, immutable";

/** What the worker loads from `.engine/` under the tree's tag, besides the tree in `files/`. */
const ENGINE_FILES = new Set(["busytex.mjs", "busytex.wasm"]);

/**
 * The engine and its TeX Live tree at `/engine/`: the manifest untagged and revalidated on every
 * load, since it names the tag, and everything else only under the tag the manifest names, and
 * immutable, since a new tree comes with a new tag (decision 0010). A tab still holding the tag of
 * a tree fetch-engine has since replaced is answered 404 rather than with the new tree's files,
 * which it would keep under the old tree's URLs; a reload gives it the new tag.
 */
export function serveEngine(folder: string): Plugin {
  const manifest = join(folder, "manifest.json");
  /** The tag, and the manifest's identity when read: fetch-engine replaces it whole. */
  let known: { file: string; tag: string | undefined } | undefined;
  const tag = () => {
    let file: string;
    try {
      const { ino, size, mtimeMs } = statSync(manifest);
      file = `${ino}:${size}:${mtimeMs}`;
    } catch {
      return undefined;
    }
    if (known?.file !== file) known = { file, tag: tagOf(manifest) };
    return known.tag;
  };
  return serveFolder(
    "engine-server",
    "/engine/",
    folder,
    (path, tagged) =>
      tagged ? ENGINE_FILES.has(path) || path.startsWith("files/") : path === "manifest.json",
    { tag, cacheControl: (_, tagged) => (tagged ? IMMUTABLE : "no-cache") },
  );
}

/** The tag a manifest names, or none for one that cannot be read, which serves no tree. */
function tagOf(manifest: string): string | undefined {
  try {
    const { release, layout } = JSON.parse(
      readFileSync(manifest, "utf8"),
    ) as Partial<EngineManifest>;
    return typeof release === "string" && typeof layout === "number"
      ? engineTag({ release, layout })
      : undefined;
  } catch {
    return undefined;
  }
}
