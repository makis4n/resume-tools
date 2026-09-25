/**
 * TeX Live's package database, `tlpkg/texlive.tlpdb`, read as far as the fetch script needs it.
 *
 * The fetch script adds TeX Live 2023 packages that the bundles lack from TeX Live's historic
 * archive (decision 0011). The database says which packages there are, what each depends on, which
 * files it installs and the size and SHA-512 of its container, so the script works out from it
 * what to fetch (`packagesToFetch`) and pins each container by what it records. A container
 * carries its package's own entry as `tlpkg/tlpobj/<name>.tlpobj`, in the same form, which the
 * same parser reads. They are pure functions over text, so that they can be tested without the
 * archive.
 *
 * The database is a text file of entries separated by blank lines, one per package. Each line is
 * a key and its value, except that the lines after a `runfiles`, `docfiles`, `srcfiles` or
 * `binfiles` line that start with a space list that line's files. Only the keys `TlPackage` holds
 * are read; the rest, descriptions and documentation among them, are skipped.
 */

/** One package of the database. */
export interface TlPackage {
  name: string;
  /** `Package`, `Collection`, `Scheme`, `TLCore` or `ConTeXt`. */
  category: string;
  revision: number;
  /** What it names with `depend`, collections, schemes and binaries among them. */
  depends: string[];
  /**
   * Whether its container holds its files relative to `texmf-dist` rather than to TeX Live's
   * root, which the database says with `relocated 1` and by listing them under `RELOC/`.
   */
  relocated: boolean;
  /** The size in bytes of its container of run files, as `containersize` gives it. */
  containerSize?: number;
  /** That container's SHA-512, as `containerchecksum` gives it. */
  containerChecksum?: string;
  /** Its run files, the files TeX reads, by path from TeX Live's root: `texmf-dist/tex/...`. */
  runfiles: string[];
  /**
   * The font maps it adds to `pdftex.map`, by file name, from its `execute addMap` and
   * `execute addMixedMap` lines.
   */
  maps: string[];
}

/**
 * A listed file's path from TeX Live's root. A relocated package lists its files under `RELOC/`,
 * which stands for `texmf-dist/`, and a list may put attributes such as `details="..."` after a
 * path.
 */
function listedPath(line: string): string {
  return line
    .trim()
    .replace(/\s+[\w-]+=".*$/, "")
    .replace(/^RELOC\//, "texmf-dist/");
}

/** Every package of a database, or of a container's `.tlpobj`, by name. */
export function parseDatabase(text: string): Map<string, TlPackage> {
  const packages = new Map<string, TlPackage>();
  let pkg: TlPackage | undefined;
  /** Whether the indented lines that follow list run files, rather than other files or none. */
  let runfiles = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") {
      pkg = undefined;
      runfiles = false;
      continue;
    }
    if (line.startsWith(" ")) {
      if (pkg && runfiles) pkg.runfiles.push(listedPath(line));
      continue;
    }
    const [key, ...words] = line.split(/\s+/);
    const value = words.join(" ");
    runfiles = key === "runfiles";
    if (key === "name") {
      pkg = {
        name: value,
        category: "",
        revision: 0,
        depends: [],
        relocated: false,
        runfiles: [],
        maps: [],
      };
      packages.set(value, pkg);
      continue;
    }
    if (!pkg) continue;
    if (key === "category") pkg.category = value;
    else if (key === "revision") pkg.revision = Number(value);
    else if (key === "relocated") pkg.relocated = value === "1";
    else if (key === "depend") pkg.depends.push(value);
    else if (key === "containersize") pkg.containerSize = Number(value);
    else if (key === "containerchecksum") pkg.containerChecksum = value;
    else if (key === "execute" && (words[0] === "addMap" || words[0] === "addMixedMap")) {
      // updmap puts a MixedMap's fonts in pdftex.map as it does a Map's; only dvips's map differs.
      if (words[1]) pkg.maps.push(words[1]);
    }
  }
  return packages;
}

/**
 * Whether a `depend` names what the fetch never takes: a collection or a scheme, which only group
 * packages, or `<name>.ARCH`, a package's programs built for each platform, which the engine's one
 * WebAssembly binary stands in for.
 */
export const ignoredDependency = (name: string) =>
  name.startsWith("collection-") || name.startsWith("scheme-") || name.endsWith(".ARCH");

/**
 * The packages `wanted` names and every package they depend on, directly or through others, in
 * name order, leaving out what `ignoredDependency` says. It follows `depend` lines only, and
 * TeX Live records few between ordinary packages, so what a package's style files load has to be
 * named in `wanted` too. A name the database lacks throws, since the tree would lack it too.
 */
export function dependencyClosure(
  db: ReadonlyMap<string, TlPackage>,
  wanted: readonly string[],
): TlPackage[] {
  const found = new Map<string, TlPackage>();
  const queue: [name: string, by?: string][] = wanted.map((name) => [name]);
  for (const [name, by] of queue) {
    if (found.has(name) || (by && ignoredDependency(name))) continue;
    const pkg = db.get(name);
    if (!pkg)
      throw new Error(
        by ? `${by} depends on ${name}, which the database lacks` : `the database has no ${name}`,
      );
    found.set(name, pkg);
    for (const dependency of pkg.depends) queue.push([dependency, name]);
  }
  return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}

/**
 * The run files of a package that the tree lacks, where `has` says whether the tree holds a path
 * from TeX Live's root, such as `texmf-dist/tex/latex/xkeyval/xkeyval.sty`.
 */
export function missingRunfiles(pkg: TlPackage, has: (path: string) => boolean): string[] {
  return pkg.runfiles.filter((path) => !has(path));
}

/**
 * What the archive has to add for `wanted`: their dependency closure, less every package whose
 * run files the tree holds already, all of them, as one with no run files does. A package the
 * tree holds only in part is fetched, for the files it lacks.
 */
export function packagesToFetch(
  db: ReadonlyMap<string, TlPackage>,
  wanted: readonly string[],
  has: (path: string) => boolean,
): TlPackage[] {
  return dependencyClosure(db, wanted).filter((pkg) => missingRunfiles(pkg, has).length > 0);
}

/**
 * The name the archive serves a package's container of run files under. It carries the package's
 * revision, so that the containers of two revisions never share a name in `downloads/`. The
 * package's documentation and sources come in containers of their own, which the fetch never
 * takes.
 */
export const containerName = (name: string, revision: number) => `${name}.r${revision}.tar.xz`;
