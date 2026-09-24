/**
 * kpathsea's filename database, `ls-R`, built from a list of paths.
 *
 * Without one, kpathsea lists directories to find a file, and in the engine every run starts from
 * a fresh heap, so it lists them again on every compile. With one it only looks names up.
 */

const HEADER = "% ls-R -- filename database for kpathsea; do not change this line.";

/**
 * The `ls-R` for the tree at `root`, covering every path under it: one section per directory,
 * named relative to the root, listing the files and folders it holds.
 */
export function filenameDatabase(paths: Iterable<string>, root: string): string {
  const prefix = `${root}/`;
  const folders = new Map<string, Set<string>>();
  const add = (folder: string, name: string) => {
    let names = folders.get(folder);
    if (!names) {
      names = new Set();
      folders.set(folder, names);
    }
    names.add(name);
  };
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const parts = path.slice(prefix.length).split("/");
    let folder = ".";
    for (const part of parts) {
      add(folder, part);
      folder = `${folder}/${part}`;
    }
  }
  const lines = [HEADER, ""];
  for (const folder of [...folders.keys()].sort()) {
    lines.push(`${folder}:`, ...[...(folders.get(folder) ?? [])].sort(), "");
  }
  return lines.join("\n");
}
