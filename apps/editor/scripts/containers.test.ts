import { spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filesUnder, type Unpacking, unpackPackages } from "./containers";

/** A folder of its own for each test, removed after it. */
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "containers-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Write each file under `dir`, by its path from there. */
function write(dir: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

/** A package's entry, as its container carries it in `tlpkg/tlpobj/<name>.tlpobj`. */
const tlpobj = (name: string, revision: number, runfiles: string[], maps: string[]) =>
  [
    `name ${name}`,
    "category Package",
    `revision ${revision}`,
    "relocated 1",
    ...maps.map((map) => `execute addMap ${map}`),
    `runfiles size=${runfiles.length}`,
    ...runfiles.map((file) => ` RELOC/${file}`),
    "",
  ].join("\n");

/**
 * Pack an invented package's container into `containers/` as the archive packs one: an
 * xz-compressed tar of its files by path from `texmf-dist`, and its entry. `prepare` may add to
 * the folder before it is packed.
 */
function container(
  name: string,
  revision: number,
  files: Record<string, string>,
  maps: string[] = [],
  prepare?: (box: string) => void,
) {
  const box = join(root, "boxes", name);
  write(box, {
    ...files,
    [`tlpkg/tlpobj/${name}.tlpobj`]: tlpobj(name, revision, Object.keys(files), maps),
  });
  prepare?.(box);
  mkdirSync(join(root, "containers"), { recursive: true });
  const file = join(root, "containers", `${name}.r${revision}.tar.xz`);
  // macOS's tar would pack a file's extended attributes as entries of their own without this.
  const run = spawnSync("tar", ["-cJf", file, "-C", box, ...readdirSync(box)], {
    encoding: "utf8",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  if (run.status !== 0) throw new Error(`tar could not pack ${name}: ${run.stderr}`);
}

const unpacking = (packages: Unpacking["packages"]): Unpacking => ({
  packages,
  containers: join(root, "containers"),
  scratch: join(root, "scratch"),
  tree: join(root, "tree"),
});

describe("filesUnder", () => {
  it("lists the files under a folder, by path from it, in path order", () => {
    write(join(root, "box"), {
      "tex/latex/quiltmark/quiltmark.sty": "%",
      "fonts/map/dvips/quiltmark/quiltmark.map": "",
      "tlpkg/tlpobj/quiltmark.tlpobj": "name quiltmark",
    });
    expect(filesUnder(join(root, "box"))).toEqual([
      "fonts/map/dvips/quiltmark/quiltmark.map",
      "tex/latex/quiltmark/quiltmark.sty",
      "tlpkg/tlpobj/quiltmark.tlpobj",
    ]);
  });

  it("refuses a symbolic link to a folder outside it, naming the entry", () => {
    write(join(root, "outside"), { "notes/invented.txt": "an invented note" });
    write(join(root, "box"), { "tex/latex/quiltmark/quiltmark.sty": "%" });
    symlinkSync(join(root, "outside"), join(root, "box/tex/latex/quiltmark/cache"));
    expect(() => filesUnder(join(root, "box"), "quiltmark.r41203.tar.xz")).toThrow(
      "quiltmark.r41203.tar.xz holds tex/latex/quiltmark/cache, which is a symbolic link; only files and folders are taken",
    );
  });

  it("refuses a hard link", () => {
    write(join(root, "box"), { "tex/latex/quiltmark/quiltmark.sty": "%" });
    linkSync(
      join(root, "box/tex/latex/quiltmark/quiltmark.sty"),
      join(root, "box/tex/latex/quiltmark/again.sty"),
    );
    expect(() => filesUnder(join(root, "box"))).toThrow(
      `${join(root, "box")} holds tex/latex/quiltmark/again.sty, which is a hard link; only files and folders are taken`,
    );
  });
});

describe("unpackPackages", () => {
  it("merges the maps the packages add, and leaves a map the tree holds to the bundles'", () => {
    // Shaped like TeX Live 2023's marvosym: the Ubuntu tree holds every file of it but its
    // TrueType one, its map among them.
    const ubuntu = {
      "/texmf/texmf-dist/fonts/map/dvips/stitchsym/stitchsym.map": "stitch Stitch <stitch.pfb\n",
      "/texmf/texmf-dist/tex/latex/stitchsym/stitchsym.sty": "% the bundles' copy\n",
    };
    write(join(root, "tree"), ubuntu);
    const files: Record<string, number> = Object.fromEntries(
      Object.entries(ubuntu).map(([path, text]) => [path, text.length]),
    );
    container(
      "stitchsym",
      29349,
      {
        "fonts/map/dvips/stitchsym/stitchsym.map": "stitch Invented <stitch.pfb\n",
        "fonts/truetype/public/stitchsym/stitchsym.ttf": "invented",
        "tex/latex/stitchsym/stitchsym.sty": "% the archive's copy\n",
      },
      ["stitchsym.map"],
    );
    container(
      "quiltmark",
      41203,
      {
        "fonts/map/dvips/quiltmark/quiltmark.map": "quilt Quilt <quilt.pfb\n",
        "fonts/type1/public/quiltmark/quilt.pfb": "invented",
      },
      ["quiltmark.map"],
    );

    const { maps, added } = unpackPackages(
      unpacking({ quiltmark: { revision: 41203 }, stitchsym: { revision: 29349 } }),
      files,
    );

    // Only the map a container added is the packages' to merge, and it is where it says.
    expect(maps).toEqual(["/texlive/texmf-dist/fonts/map/dvips/quiltmark/quiltmark.map"]);
    expect(readFileSync(join(root, "tree", maps[0] as string), "utf8")).toBe(
      "quilt Quilt <quilt.pfb\n",
    );
    expect(added).toEqual(
      new Map([
        [
          "quiltmark",
          [
            "/texlive/texmf-dist/fonts/map/dvips/quiltmark/quiltmark.map",
            "/texlive/texmf-dist/fonts/type1/public/quiltmark/quilt.pfb",
          ],
        ],
        ["stitchsym", ["/texlive/texmf-dist/fonts/truetype/public/stitchsym/stitchsym.ttf"]],
      ]),
    );
    // The bundles' copies stay, and are not shadowed in the first tree.
    expect(files["/texlive/texmf-dist/fonts/truetype/public/stitchsym/stitchsym.ttf"]).toBe(8);
    expect(files["/texlive/texmf-dist/fonts/map/dvips/stitchsym/stitchsym.map"]).toBeUndefined();
    expect(files["/texlive/texmf-dist/tex/latex/stitchsym/stitchsym.sty"]).toBeUndefined();
    expect(existsSync(join(root, "scratch"))).toBe(false);
  });

  it("refuses a container that carries a symbolic link, and takes nothing from it", () => {
    write(join(root, "outside"), { "notes/invented.txt": "an invented note" });
    container("quiltmark", 41203, { "tex/latex/quiltmark/quiltmark.sty": "%" }, [], (box) =>
      symlinkSync(join(root, "outside"), join(box, "tex/latex/quiltmark/cache")),
    );
    const files: Record<string, number> = {};
    expect(() => unpackPackages(unpacking({ quiltmark: { revision: 41203 } }), files)).toThrow(
      "quiltmark.r41203.tar.xz holds tex/latex/quiltmark/cache, which is a symbolic link; only files and folders are taken",
    );
    expect(files).toEqual({});
    expect(existsSync(join(root, "tree"))).toBe(false);
    expect(readFileSync(join(root, "outside/notes/invented.txt"), "utf8")).toBe("an invented note");
    expect(existsSync(join(root, "scratch"))).toBe(false);
  });
});
