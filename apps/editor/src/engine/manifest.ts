/** What `scripts/fetch-engine.ts` writes to `.engine/manifest.json`, and the worker reads. */
export interface EngineManifest {
  /** The BusyTeX release the engine and the tree come from. */
  release: string;
  /** The version of what the script writes; a change rebuilds `.engine/`. */
  layout: number;
  /** The TeX Live bundles unpacked into the tree, in mounting order. */
  bundles: string[];
  /** Every file TeX may read, by its path in the engine's file system, with its size in bytes. */
  files: Record<string, number>;
}
