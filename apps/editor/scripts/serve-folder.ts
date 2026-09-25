/**
 * Serve a folder at a route in the dev server only. The engine and TeX Live tree
 * (`.engine/`, built by `scripts/fetch-engine.ts`) and the spike's page assets (`spike/web/`)
 * are hundreds of MB each; keeping them out of `public/` keeps them out of `dist/`.
 */

import { createReadStream, statSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

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
   * Whether a request's first segment under the route may be a tag, which is taken off before
   * the path is looked up: `/engine/<tag>/files/a.sty` serves `files/a.sty`, whatever the tag. A
   * tag names one version of what its URLs hold, so the browser may keep them for good; the folder
   * holds one version, so any tag serves it (see `src/engine/urls.ts`).
   */
  tags?: boolean;
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
        const tag = options.tags ? /^\/[^/]+(?=\/)/.exec(path) : null;
        const tagged = tag !== null;
        if (tag) path = path.slice(tag[0].length);
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
 * load, since it names the tag, and everything else only under a tag, and immutable, since a new
 * tree comes with a new tag (decision 0010).
 */
export const serveEngine = (folder: string): Plugin =>
  serveFolder(
    "engine-server",
    "/engine/",
    folder,
    (path, tagged) =>
      tagged ? ENGINE_FILES.has(path) || path.startsWith("files/") : path === "manifest.json",
    { tags: true, cacheControl: (_, tagged) => (tagged ? IMMUTABLE : "no-cache") },
  );
