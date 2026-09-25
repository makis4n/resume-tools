/**
 * Finding TeX Live files by name, the way kpathsea would: through the manifest, searching the
 * trees in the engine's order, and only in the folder a kind of file belongs in.
 */

import type { EngineManifest } from "../engine/manifest";
import { TREES } from "../engine/session";

/** Where each kind of file lives under a tree, as kpathsea's search paths say. */
const KINDS = {
  tfm: "/fonts/tfm/",
  type1: "/fonts/type1/",
  enc: "/fonts/enc/",
  map: "/fonts/map/",
  vf: "/fonts/vf/",
} as const;

export type FileKind = keyof typeof KINDS;

export class TexLiveIndex {
  private readonly byName = new Map<string, string[]>();

  constructor(manifest: EngineManifest) {
    for (const path of Object.keys(manifest.files)) {
      const name = path.slice(path.lastIndexOf("/") + 1);
      const paths = this.byName.get(name);
      if (paths) paths.push(path);
      else this.byName.set(name, [path]);
    }
  }

  /** The path of the file `name` of the given kind, from the first tree that has one. */
  find(kind: FileKind, name: string): string | undefined {
    const candidates = this.byName.get(name);
    if (!candidates) return undefined;
    for (const tree of TREES) {
      const found = candidates.find((path) => path.startsWith(`${tree}${KINDS[kind]}`));
      if (found) return found;
    }
    return undefined;
  }

  /** Every file of a kind whose name ends with `suffix`, such as every `.map`. */
  all(kind: FileKind, suffix: string): string[] {
    const out: string[] = [];
    for (const [name, paths] of this.byName) {
      if (!name.endsWith(suffix)) continue;
      for (const path of paths)
        if (TREES.some((tree) => path.startsWith(`${tree}${KINDS[kind]}`))) out.push(path);
    }
    return out.sort();
  }
}
