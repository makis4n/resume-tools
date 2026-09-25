import { describe, expect, it } from "vitest";
import {
  containerName,
  dependencyClosure,
  missingRunfiles,
  packagesToFetch,
  parseDatabase,
  type TlPackage,
} from "./tlpdb";

/**
 * An invented excerpt of a package database, in the database's form: three packages that depend
 * on one another, a collection, a platform's binaries, and entries the parser skips.
 */
const DATABASE = [
  "name quiltmark",
  "category Package",
  "revision 41203",
  "shortdesc Patchwork symbols, invented for this test",
  "relocated 1",
  "longdesc A package that exists only here,",
  "longdesc described over two lines.",
  "depend quiltmark-shapes",
  "depend collection-quilting",
  "depend quiltmark.ARCH",
  "execute addMap quiltmark.map",
  "execute addMixedMap quiltmark-bitmap.map",
  "execute AddFormat name=quilt engine=pdftex",
  "containersize 5120",
  `containerchecksum ${"ab".repeat(64)}`,
  "doccontainersize 9000",
  `doccontainerchecksum ${"cd".repeat(64)}`,
  "docfiles size=12",
  ' RELOC/doc/latex/quiltmark/README.md details="Readme"',
  "runfiles size=4",
  " RELOC/fonts/map/dvips/quiltmark/quiltmark.map",
  " RELOC/tex/latex/quiltmark/quiltmark.sty",
  "catalogue-license lppl1.3c",
  "",
  "name quiltmark-shapes",
  "category Package",
  "revision 39877",
  "relocated 1",
  "depend stitchkeys",
  "containersize 2048",
  `containerchecksum ${"ef".repeat(64)}`,
  "runfiles size=1",
  " RELOC/tex/latex/quiltmark-shapes/qmshapes.sty",
  "",
  "name stitchkeys",
  "category Package",
  "revision 30112",
  "relocated 1",
  "depend scheme-quilter",
  "containersize 1024",
  `containerchecksum ${"12".repeat(64)}`,
  "runfiles size=2",
  " RELOC/tex/generic/stitchkeys/stitchkeys.tex",
  " RELOC/tex/latex/stitchkeys/stitchkeys.sty",
  "",
  "name collection-quilting",
  "category Collection",
  "revision 50000",
  "depend quiltmark",
  "depend thimble",
  "",
  "name quiltmark.x86_64-linux",
  "category Package",
  "revision 41000",
  "binfiles arch=x86_64-linux size=1",
  " bin/x86_64-linux/quiltmark",
  "",
].join("\n");

const db = parseDatabase(DATABASE);

/** A package of the excerpt, which the test expects it to have. */
function get(name: string): TlPackage {
  const pkg = db.get(name);
  if (!pkg) throw new Error(`the excerpt has no ${name}`);
  return pkg;
}

const names = (packages: readonly TlPackage[]) => packages.map((pkg) => pkg.name);

describe("parseDatabase", () => {
  it("reads a package's name, revision, dependencies, container, run files and maps", () => {
    expect([...db.keys()]).toEqual([
      "quiltmark",
      "quiltmark-shapes",
      "stitchkeys",
      "collection-quilting",
      "quiltmark.x86_64-linux",
    ]);
    expect(get("quiltmark")).toEqual({
      name: "quiltmark",
      category: "Package",
      revision: 41203,
      depends: ["quiltmark-shapes", "collection-quilting", "quiltmark.ARCH"],
      relocated: true,
      containerSize: 5120,
      containerChecksum: "ab".repeat(64),
      // RELOC/ stands for texmf-dist/, and the documentation's list is not the run files'.
      runfiles: [
        "texmf-dist/fonts/map/dvips/quiltmark/quiltmark.map",
        "texmf-dist/tex/latex/quiltmark/quiltmark.sty",
      ],
      // Both kinds of map pdftex.map takes, and no other `execute`.
      maps: ["quiltmark.map", "quiltmark-bitmap.map"],
    });
  });

  it("reads a collection and a platform's binaries without run files or a container", () => {
    expect(get("collection-quilting")).toMatchObject({
      category: "Collection",
      depends: ["quiltmark", "thimble"],
      relocated: false,
      runfiles: [],
    });
    expect(get("collection-quilting").containerSize).toBeUndefined();
    expect(get("quiltmark.x86_64-linux").runfiles).toEqual([]);
  });

  it("reads a container's own entry, which ends without a blank line", () => {
    const entry = [
      "name stitchkeys",
      "category Package",
      "revision 30112",
      "relocated 1",
      "runfiles size=2",
      " RELOC/tex/latex/stitchkeys/stitchkeys.sty",
    ].join("\n");
    expect(parseDatabase(entry).get("stitchkeys")).toMatchObject({
      revision: 30112,
      relocated: true,
      runfiles: ["texmf-dist/tex/latex/stitchkeys/stitchkeys.sty"],
    });
  });
});

describe("dependencyClosure", () => {
  it("follows depend lines through other packages, in name order", () => {
    // Not the collection, whose thimble the excerpt lacks, nor the scheme or the binaries.
    expect(names(dependencyClosure(db, ["quiltmark"]))).toEqual([
      "quiltmark",
      "quiltmark-shapes",
      "stitchkeys",
    ]);
    expect(names(dependencyClosure(db, ["stitchkeys", "quiltmark-shapes"]))).toEqual([
      "quiltmark-shapes",
      "stitchkeys",
    ]);
  });

  it("refuses a package the database lacks, naming what depends on it", () => {
    expect(() => dependencyClosure(db, ["thimble"])).toThrow("the database has no thimble");
    const loose = parseDatabase("name bobbin\nrevision 7\ndepend thimble\n");
    expect(() => dependencyClosure(loose, ["bobbin"])).toThrow(
      "bobbin depends on thimble, which the database lacks",
    );
  });
});

describe("packagesToFetch", () => {
  // The tree holds all of quiltmark-shapes, and one of stitchkeys's two run files.
  const tree = new Set([
    "texmf-dist/tex/latex/quiltmark-shapes/qmshapes.sty",
    "texmf-dist/tex/latex/stitchkeys/stitchkeys.sty",
  ]);
  const has = (path: string) => tree.has(path);

  it("keeps a package the tree holds in part, and leaves out one it holds whole", () => {
    expect(missingRunfiles(get("stitchkeys"), has)).toEqual([
      "texmf-dist/tex/generic/stitchkeys/stitchkeys.tex",
    ]);
    expect(missingRunfiles(get("quiltmark-shapes"), has)).toEqual([]);
    expect(names(packagesToFetch(db, ["quiltmark"], has))).toEqual(["quiltmark", "stitchkeys"]);
  });

  it("leaves out a package with no run files", () => {
    const docs = parseDatabase("name patterns-doc\ncategory Package\nrevision 3\n");
    expect(packagesToFetch(docs, ["patterns-doc"], () => false)).toEqual([]);
  });
});

describe("containerName", () => {
  it("names a package's container of run files by its revision", () => {
    expect(containerName("quiltmark", 41203)).toBe("quiltmark.r41203.tar.xz");
    expect(containerName("quiltmark-shapes", 39877)).toBe("quiltmark-shapes.r39877.tar.xz");
  });
});
