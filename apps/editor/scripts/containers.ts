/**
 * Unpacking the containers of the TeX Live 2023 packages the fetch script adds to the tree
 * (decision 0011).
 *
 * The script pins each container by the SHA-512 the archive's database records for it, and
 * unpacks it here with the system `tar`, which macOS and Linux both have and which reads xz on
 * both, so that the script needs no decompressor of its own. A container that holds anything but
 * files and folders is refused, since a link could lead the tree out of the container's folder,
 * and so is one whose package is not relocated, since it could install outside `texmf-dist`. The
 * functions take their folders as arguments, so that they can be tested on invented containers,
 * without the archive.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
// Node runs the fetch script by stripping its types, so imports need their real extensions.
import { containerName, parseDatabase } from "./tlpdb.ts";

/** Unpack an xz-compressed tar into `dir` with the system `tar`. */
export function untar(file: string, dir: string) {
  const run = spawnSync("tar", ["-xJf", file, "-C", dir], { encoding: "utf8" });
  if (run.error) throw new Error(`the system tar did not run: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`tar could not unpack ${basename(file)}: ${run.stderr}`);
}

/**
 * The files under a folder, by path relative to it, in path order. Only regular files and folders
 * are taken, and anything else is refused, naming the entry and `source`, where the folder came
 * from: a symbolic link, which could lead a move out of the folder to what it points at, a hard
 * link, whose file has another name, and a device or a pipe. Each entry is read with `lstat`,
 * which does not follow a link, where `readdir`'s recursive listing follows a link to a folder.
 */
export function filesUnder(dir: string, source = dir): string[] {
  const files: string[] = [];
  const walk = (folder: string) => {
    // In name order, so that the entry a refusal names does not depend on the file system.
    for (const name of readdirSync(join(dir, folder)).sort()) {
      const path = folder ? `${folder}/${name}` : name;
      const entry = lstatSync(join(dir, path));
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.nlink <= 1) files.push(path);
      else {
        const kind = entry.isSymbolicLink()
          ? "a symbolic link"
          : entry.isFile()
            ? "a hard link"
            : "neither a file nor a folder";
        throw new Error(
          `${source} holds ${path}, which is ${kind}; only files and folders are taken`,
        );
      }
    }
  };
  walk("");
  return files.sort();
}

/** What `unpackPackages` unpacks, and the folders it reads and writes. */
export interface Unpacking {
  /** The packages, by name, with the revision their container is named by. */
  packages: Readonly<Record<string, { revision: number }>>;
  /** The folder holding their containers, under the names `containerName` gives them. */
  containers: string;
  /** A folder of its own to unpack each container into first; it is removed afterwards. */
  scratch: string;
  /** The tree the files go into, at the paths the engine sees them under. */
  tree: string;
}

/** What the packages added to the tree. */
export interface Unpacked {
  /** The font maps the packages add to `pdftex.map`, by path in the tree, in package order. */
  maps: string[];
  /** The files each package added, by path in the tree, in path order, by package name. */
  added: Map<string, string[]>;
}

/**
 * Unpack the container of each package into the tree's `/texlive/texmf-dist`, list the files it
 * adds in `files`, and return what the packages added: the font maps to merge and each package's
 * files.
 *
 * Each container is unpacked into a folder of its own first, since the tree takes from it only
 * what TeX reads, and every entry it holds is checked before any is read or moved
 * (`filesUnder`). The container of a relocated package holds its files relative to `texmf-dist`,
 * and its entry in the database as `tlpkg/tlpobj/<name>.tlpobj`, which is read for the package's
 * run files and maps and then dropped. A file either tree holds already stays as the bundles gave
 * it, and is not shadowed by a copy in the first tree either: the stock formats were dumped from
 * the bundles' files, and the templates read them, so a package the bundles hold in part keeps
 * their version and gains only the files it lacks, as pgf's dependency xcolor gains only its
 * rollback copy `xcolor-2022-06-12.sty`. What the tree gains is what the container holds; the run
 * files its entry lists only check it, and one it lacks is reported. A map the tree held already
 * is the bundles', and is left to their merge: the fetch script merges the Ubuntu tree's maps after
 * the packages', and TeX Live's own are the ones updmap wrote `pdftex.map` from.
 *
 * No `ls-R` is written, though item 19 of the milestone speaks of regenerating it: the engine
 * session builds every tree's filename database from the manifest when it starts
 * (`mountOnDemand` in `src/engine/session.ts`), so listing a file in the manifest is what puts
 * it there.
 */
export function unpackPackages(unpacking: Unpacking, files: Record<string, number>): Unpacked {
  const { packages, containers, scratch, tree } = unpacking;
  const maps: string[] = [];
  const added = new Map<string, string[]>();
  try {
    for (const [name, { revision }] of Object.entries(packages)) {
      const container = containerName(name, revision);
      const dir = join(scratch, name);
      mkdirSync(dir, { recursive: true });
      untar(join(containers, container), dir);
      const unpacked = filesUnder(dir, container);
      const entry = join(dir, "tlpkg", "tlpobj", `${name}.tlpobj`);
      const pkg = existsSync(entry)
        ? parseDatabase(readFileSync(entry, "utf8")).get(name)
        : undefined;
      if (!pkg) throw new Error(`the container of ${name} holds no tlpkg/tlpobj/${name}.tlpobj`);
      if (!pkg.relocated)
        throw new Error(
          `${name} is not relocated, so its container may install outside texmf-dist`,
        );
      const held = unpacked.filter((file) => !file.startsWith("tlpkg/"));
      const moved: string[] = [];
      for (const file of held) {
        const path = `/texlive/texmf-dist/${file}`;
        if (files[path] !== undefined || files[`/texmf/texmf-dist/${file}`] !== undefined) continue;
        const target = join(tree, path);
        mkdirSync(dirname(target), { recursive: true });
        renameSync(join(dir, file), target);
        files[path] = statSync(target).size;
        moved.push(path);
      }
      added.set(name, moved);
      const kept = held.length - moved.length;
      if (kept > 0) console.log(`  ${name}: the bundles' copy of ${kept} of its files stays`);
      const holds = new Set(held.map((file) => `texmf-dist/${file}`));
      const lacking = pkg.runfiles.filter((runfile) => !holds.has(runfile));
      if (lacking.length > 0)
        console.warn(`  ${name}: its container lacks ${lacking.join(", ")}, which it lists`);
      for (const map of pkg.maps) {
        const file = held.find((path) => path.startsWith("fonts/map/") && basename(path) === map);
        if (!file)
          console.warn(`  ${name}: adds ${map} to the font maps, but its container lacks it`);
        else if (moved.includes(`/texlive/texmf-dist/${file}`))
          maps.push(`/texlive/texmf-dist/${file}`);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return { maps, added };
}
