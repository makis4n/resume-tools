/**
 * Build `.engine/`: the TeX engine and a TeX Live 2023 tree, for development and CI.
 *
 * Downloads the pinned BusyTeX release, the WebAssembly build of TeX Live 2023 the spike measured,
 * and checks every file against the hash recorded below. The release packs TeX Live into bundles
 * that only the engine can unpack, so the script mounts them in the engine under Node and copies
 * every file out, one file per path, with a manifest of paths and sizes. The worker fetches files
 * from that tree one at a time, the first time TeX opens each.
 *
 * The bundles lack packages the templates need, pgf and Font Awesome 5 among them, and packages
 * the corpus's documents need (decision 0018), so the script then adds those from TeX Live 2023's
 * final package archive (`PACKAGES`), each container checked against the SHA-512 the archive's
 * database records for it and unpacked with the system `tar` (`scripts/containers.ts`, decision
 * 0011). On the way out, the added packages' and the Ubuntu bundles' font maps are merged into
 * `pdftex.map` (`mergeMaps`), as `updmap` would merge them, and fontconfig's configuration loses
 * its font folders (`bareFontConf`), so that XeTeX scans no fonts on any run.
 *
 *   node scripts/fetch-engine.ts [--from <dir>] [--force] [--resolve]
 *
 *   --from <dir>  take the release files from a folder instead of downloading them
 *   --force       rebuild even when `.engine/` is already up to date
 *   --resolve     work `PACKAGES` out again from the archive's database and print it, building
 *                 nothing
 *
 * To change the packages, change `WANTED`, run with `--resolve`, paste what it prints over
 * `PACKAGES`, and bump `LAYOUT`; nothing else reads the database.
 *
 * Output, all ignored by git:
 *
 *   .engine/package.json     marks the folder CommonJS, which the release's loaders are written as
 *   .engine/downloads/       the release files and the archive's containers as downloaded, and the
 *                            archive's database once `--resolve` has read it
 *   .engine/busytex.js       the engine's loader, for Node
 *   .engine/busytex.mjs      the same loader as an ES module, for the worker
 *   .engine/busytex.wasm     the engine: pdfTeX, XeTeX, LuaHBTeX and xdvipdfmx in one binary
 *   .engine/files/<path>     every TeX Live file, at the path the engine sees it under
 *   .engine/manifest.json    { release, layout, bundles, packages, files: { <path>: <size> } },
 *                            written last
 *
 * One run at a time: a run holds `.engine/.lock` while it builds, and a second run stops. Each run
 * writes its downloads and its staging folder under names that carry its process id, so even
 * runs that both got past the lock cannot overwrite each other's half-written files.
 */

import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { copyFile, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
// Node runs this file by stripping its types, so the type import needs its real extension.
import type { EngineManifest } from "../src/engine/manifest.ts";
import { unpackPackages } from "./containers.ts";
import { withoutFontFolders } from "./fontconfig.ts";
import { mergeFontMaps } from "./fontmaps.ts";
import { containerName, packagesToFetch, parseDatabase } from "./tlpdb.ts";

const RELEASE = "build_wasm_4499aa69fd3cf77ad86a47287d9a5193cf5ad993_7936974349_1";
const RELEASE_URL = `https://github.com/busytex/busytex/releases/download/${RELEASE}/`;

/**
 * The version of what this script writes. Bump it whenever the output changes (the files, the
 * loaders, the manifest's shape), so a `.engine/` built by an older version is rebuilt. CI keys its
 * cached `.engine/` on the six files the output depends on, this script, `containers.ts` and
 * `tlpdb.ts`, which unpack the added packages and read their entries, `fontconfig.ts`, which
 * writes fontconfig's configuration, and `fontmaps.ts` and `src/page/fontmap.ts`, which merge the
 * font maps into `pdftex.map`, so a change to any of them rebuilds it there; a `.engine/` built on
 * a machine is rebuilt only by the bump or by a change to `PACKAGES`.
 */
const LAYOUT = 5;

/** Release files with their SHA-256 and size, recorded from the copies the spike measured. */
const ASSETS: Record<string, { sha256: string; size: number }> = {
  "busytex.js": {
    sha256: "f381d9ba816d9a4389d429f54fe85f13396aa2f822973d9b66e1f527ced3434b",
    size: 295606,
  },
  "busytex.wasm": {
    sha256: "a7785b59bfddb8667e7738443f111430e3ee2bd3ec0c1c26629267849e091415",
    size: 30363063,
  },
  "texlive-basic.js": {
    sha256: "23cc4ce427d27d555fe2a050b97ff8c95bb331425018e9159130e74b62373ff1",
    size: 2068492,
  },
  "texlive-basic.data": {
    sha256: "c955651ca293f09b2e57d6360fa2cb61ad710b4ae51e9fbc04b049477a8aeb71",
    size: 104576512,
  },
  "ubuntu-texlive-latex-base.js": {
    sha256: "807f0bfbe66ff919c1799737acd751dfba6c1ca2afd8d71db2bb30c3c5c62144",
    size: 299539,
  },
  "ubuntu-texlive-latex-base.data": {
    sha256: "0dd2dfaaa2e6a9674090cbf8cf3a01419ce37063080f762aee0d82ad7263ead8",
    size: 5741806,
  },
  "ubuntu-texlive-latex-recommended.js": {
    sha256: "bbd975921a74adae9119988ae8a740ca9f4837db772061d313c67729fba1d9ee",
    size: 337892,
  },
  "ubuntu-texlive-latex-recommended.data": {
    sha256: "fa9a03f928a0af0e9c5a24e2ce2956e64db9d580dd2c3a7517176aac16dc9006",
    size: 9058527,
  },
  "ubuntu-texlive-latex-extra.js": {
    sha256: "a99a68b79e6a93f3ca9d94f46afe8a62e7e06b6d4c5e90a705ec15fc42d8ecda",
    size: 1398581,
  },
  "ubuntu-texlive-latex-extra.data": {
    sha256: "fb4dc0440f4b2bd2d5138dbb5689e6a33cd20c9704934422436cb97af5d623c4",
    size: 49513577,
  },
  "ubuntu-texlive-fonts-recommended.js": {
    sha256: "708f60e5fc46b64204e8361a0d0939b3f8f0713f9b7fae379baa67e5dbe0c37a",
    size: 353109,
  },
  "ubuntu-texlive-fonts-recommended.data": {
    sha256: "3154397a58db2ac62d6bcf99e44786c6ea62cc31c2343adc42d51f2088b6a3f1",
    size: 10264033,
  },
};

/**
 * The TeX Live bundles, in mounting order. `texlive-basic` holds TeX Live's own scheme-basic
 * with the LaTeX and XeTeX collections and the stock formats, under /texlive; the Ubuntu
 * bundles add LaTeX packages and fonts under /texmf, which the engine searches second.
 */
const BUNDLES = [
  "texlive-basic",
  "ubuntu-texlive-latex-base",
  "ubuntu-texlive-latex-recommended",
  "ubuntu-texlive-latex-extra",
  "ubuntu-texlive-fonts-recommended",
];

/**
 * TeX Live 2023's package archive as it was when TeX Live 2024 replaced it, which no longer
 * changes. It has to be 2023's, the year of the engine and of the bundles, since a format or a
 * package of another year disagrees with them (decision 0011).
 */
const ARCHIVE_URL = "https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2023/tlnet-final/";

/**
 * The archive's package database, with its SHA-256 and size, so that a database that differs is
 * refused rather than read; the refusal prints what it found, for when the archive is meant to
 * change. Only `--resolve` reads it. It is the uncompressed copy: the archive also serves it
 * compressed with xz, but neither Node nor macOS's base system can decompress a bare xz file, and
 * the system tar reads xz only inside a tar archive.
 */
const DATABASE = {
  path: "tlpkg/texlive.tlpdb",
  sha256: "529eda93e5f3cbf89cb4064d835ebde1a0dd83dca4019d217548f83b5ca14b27",
  size: 19353989,
};

/**
 * The TeX Live packages the templates need that the bundles lack: pgf for TikZ, Font Awesome 5
 * for icons, and Lato, Roboto and Source Sans Pro. `--resolve` adds what their `depend` lines
 * name, but TeX Live records few dependencies between ordinary packages, so what their style
 * files load that the bundles lack is named here too: mweights, which `roboto.sty` and
 * `sourcesanspro.sty` load, and ly1, whose LY1 encoding `sourcesanspro.sty` asks fontenc for.
 * And pgfopts, pgf's option parser, which none of them loads but bundled packages such as
 * beamertheme-metropolis and handin do, and could not while the tree lacked it. And tikzfill,
 * whose `tikzfill.image` the bundles' tcolorbox 6.0.1 loads for its skins library, which
 * Awesome-CV's class and AltaCV's load; tcolorbox's entry names no dependency, so only its files
 * say so.
 *
 * Then what the corpus's documents need that the tree lacks, as `corpus survey` counts them
 * (decision 0018): every package three documents or more need, the most needed first, within
 * 80 MB of containers, that makes at least one of them lack nothing once it is in:
 * fontawesome, Font Awesome 4, for its package and its `FontAwesome.otf`; biblatex, whose
 * `depend` brings logreq; tex-gyre; ulem; academicons; soul; and plex. Their style files load
 * nothing the tree lacks, and ask fontenc for T1, LY1 and OT1 only.
 */
const WANTED = [
  "pgf",
  "fontawesome5",
  "lato",
  "roboto",
  "sourcesanspro",
  "mweights",
  "ly1",
  "pgfopts",
  "tikzfill",
  "fontawesome",
  "biblatex",
  "tex-gyre",
  "ulem",
  "academicons",
  "soul",
  "plex",
];

/** A package's container of run files in the archive: its revision, size and SHA-512. */
interface Container {
  revision: number;
  size: number;
  sha512: string;
}

/**
 * The packages the archive adds to the tree: `WANTED` and what they depend on, less those whose
 * every run file the bundles hold already, each with its revision and its container's size and
 * SHA-512 as the database records them, so that the tree is the same on every machine without
 * reading the database. To change it, change `WANTED`, run `--resolve`, which reads the database,
 * checks that the archive serves each container it lists and prints the list, paste the list
 * here, and bump `LAYOUT`.
 */
const PACKAGES: Record<string, Container> = {
  academicons: {
    revision: 62622,
    size: 35252,
    sha512:
      "10fed2cdb2533a7291626eee2f3d46e79fe972eadd83cf7177f22228dcd13422549819dc5e1cf0b03e8397e23badc02a965857aca886ba004a3279efeb49b288",
  },
  biblatex: {
    revision: 66403,
    size: 254400,
    sha512:
      "e07cd6233021bbe2f3591f866c3b3eeae083574f705da9505f6bcbb7284c243ac7f24440253c4557f0a300e9995188bf5915a42643e63eb80ff9e0fa4ffaff1c",
  },
  fontawesome: {
    revision: 48145,
    size: 276180,
    sha512:
      "e08643104006c9e14c40bb965b4401a8fe296f43e5f39b285cd19d5aa0ed33602cc0eb6ffcc996e1d6e5aaa57dd906903324626ee40facdcb3cedc5216a3deb6",
  },
  fontawesome5: {
    revision: 63207,
    size: 866312,
    sha512:
      "d7f6a40797b2968c31b28f1bf273af9d27b7a87e7c2953748f354db2e760b027feb5a8fd52c8f367649fba24cd629d71c1b1368b8864d42eb84269e0b22b59d4",
  },
  lato: {
    revision: 54512,
    size: 12721308,
    sha512:
      "2f8454888913ec6a024c53cf157509b8b769f948ac2c92d0683e80ff8e22865545a6a65864876be35569bf4a5d56ed871c8112b216561e3ce585136bd062c9ce",
  },
  logreq: {
    revision: 53003,
    size: 3212,
    sha512:
      "df61c0c6c0b8520f5ec38780d8eb69cfd5fccd21f5120e48eee71e02b004d3da4cc9cb9371a36766852e3ca09a3db86655f1a2639a49741f00134cff1246acd2",
  },
  ly1: {
    revision: 63565,
    size: 54900,
    sha512:
      "79ec3f1971587a3266d3351cf4d97e44d7871ace695c7f229b92c819f1334c2032a3c906a2e7e74e98fea5f01ef4dabac9c2dbdbecf68f0d5512c637288e8297",
  },
  mweights: {
    revision: 53520,
    size: 1236,
    sha512:
      "50d675bdee00625b5fbdcc1ef923a48abc19af890faab90ddde4893081dd2a5de6b5ce9165a4bece512c885ba3f3990d8dc300a873177c725a5aa16b434d4e77",
  },
  pgf: {
    revision: 65553,
    size: 717460,
    sha512:
      "d7fbf0dc83f88a2f6d2de3117365d3f4ac2379ecbc530e343bc3e02ac8083e9a9843d479d375d086e39b6377b21d2fcba22883485e040fab1601642ba80128b9",
  },
  pgfopts: {
    revision: 56615,
    size: 1928,
    sha512:
      "7d672d626428c37fa749a810c57be43c6102e1325a6d3e16c57bc560b6d65a57bae94e619a73f3e0efb46ce7b4783d05a6e98c64b1e90c6e0f94f1dd9acd676f",
  },
  plex: {
    revision: 69154,
    size: 11533644,
    sha512:
      "4180d4b5ff2d6843ac375a52bc3c63570638cc29f7d3bbda476dee962998293ce4b201817e056d5e87c20bd8280336b65bc689a8e1580ab8aa6f24164002732c",
  },
  roboto: {
    revision: 64350,
    size: 25354284,
    sha512:
      "d82d9ce9480bf0c9d7f6559e7bcbb5fe8f22179adc44113121f67fc0daadd66c938b9fcf9a41073843e1cc981162972a79f15fe6162f68ba7a01b74732b0f01a",
  },
  soul: {
    revision: 67365,
    size: 8944,
    sha512:
      "233f1178521296d5cccc7db50c98425995b8708c97d750a5c24f698bd0de2e54ed5c57f9641f402bb8a42721e348355e6f7e9092b4056999b032d001c8203aba",
  },
  sourcesanspro: {
    revision: 54892,
    size: 5153396,
    sha512:
      "0511dcf736273d80f7143c9dad96dd9f631b016183b4078243ed061d35889fea62e50c5f48e9842ffae7b654fd2e08a21d1c46403e56349c0b515ff2eb62e164",
  },
  "tex-gyre": {
    revision: 68624,
    size: 7748428,
    sha512:
      "5422f349d15233e6f49576fe3a65f8afb5cae6a3c51e5ad7cb56617d7d064e9cf574f233f789c029c04bbfc24e5948c115b2d33569e881373d68615ac709153f",
  },
  tikzfill: {
    revision: 67847,
    size: 4652,
    sha512:
      "4864d0859490cd07e123e1160a35fb7817c3ffcc1f409a8c61285823f655357473e0dc7ab92434b5b552cbfca3e88d9181e57cf944d2422467b466cbdcd743a0",
  },
  ulem: {
    revision: 53365,
    size: 6512,
    sha512:
      "bb7fc8d93d38a847431f9f62f1447520890f3904654ef6f3cdffd14537600da35d54bd0839cd8fd8d26e1e3146463cd9ced79f706df54df075292eea8a40ed4c",
  },
  xcolor: {
    revision: 68864,
    size: 18236,
    sha512:
      "6b7d38d631f89f4c4ffa9f447a16cef6169c3e4798c5c65339fe48f9318291373a49ef9da8143c453fc5fd9ee853bad53b5477b248ad5f99763df9ea28638c78",
  },
};

/** Top-level folders of the engine's file system that hold files TeX may read. */
const ROOTS = ["/texlive", "/texmf", "/etc", "/bin"];

/** Files the editor cannot work without; the build fails if any is missing. */
const REQUIRED = [
  "/texlive/texmf-dist/texmf-var/web2c/pdftex/pdflatex.fmt",
  "/texlive/texmf-dist/texmf-var/web2c/xetex/xelatex.fmt",
  "/texlive/texmf-dist/texmf-var/fonts/map/pdftex/updmap/pdftex.map",
  "/texlive/texmf-dist/web2c/texmf.cnf",
  "/texlive/texmf-dist/ls-R",
  "/texlive/texmf-dist/tex/latex/base/article.cls",
  "/texlive/texmf-dist/fonts/tfm/public/cm/cmr10.tfm",
  "/texlive/texmf-dist/fonts/map/glyphlist/glyphlist.txt",
  "/texmf/texmf-dist/tex/latex/xcolor/xcolor.sty",
  "/texmf/texmf-dist/tex/latex/enumitem/enumitem.sty",
  "/texmf/texmf-dist/fonts/map/dvips/marvosym/marvosym.map",
  "/texlive/texmf-dist/tex/latex/pgf/frontendlayer/tikz.sty",
  "/texlive/texmf-dist/tex/latex/fontawesome5/fontawesome5.sty",
  "/texlive/texmf-dist/tex/latex/lato/lato.sty",
  "/texlive/texmf-dist/tex/latex/roboto/roboto.sty",
  "/texlive/texmf-dist/tex/latex/sourcesanspro/sourcesanspro.sty",
];

/** The font map pdfTeX's tools read, as updmap wrote it for TeX Live's own tree. */
const PDFTEX_MAP = "/texlive/texmf-dist/texmf-var/fonts/map/pdftex/updmap/pdftex.map";

/** The fontconfig configuration XeTeX reads, whose folders fontconfig would scan for fonts. */
const FONTS_CONF = "/etc/fonts/fonts.conf";

/** Where the Ubuntu tree keeps its font maps, none of which updmap saw. */
const UBUNTU_MAPS = "/texmf/texmf-dist/fonts/map/dvips/";

/**
 * Where the two trees keep outline files, which is where kpathsea looks for the files a map names:
 * Type 1, and TrueType and OpenType, which xdvipdfmx embeds as it does Type 1, though the page's
 * reader takes only Type 1 (item 21 draws the others).
 */
const OUTLINES = ["/texlive/texmf-dist/fonts/", "/texmf/texmf-dist/fonts/"].flatMap((fonts) =>
  ["type1/", "truetype/", "opentype/"].map((kind) => fonts + kind),
);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".engine");
const DOWNLOADS = join(ROOT, "downloads");
const FILES = join(ROOT, "files");
const MANIFEST = join(ROOT, "manifest.json");
const LOCK = join(ROOT, ".lock");

/** A file pinned by its size and its digest, under the algorithm its source records. */
interface Pin {
  size: number;
  algorithm: "sha256" | "sha512";
  digest: string;
}

async function digestOf(file: string, algorithm: Pin["algorithm"]): Promise<string> {
  const hash = createHash(algorithm);
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

/** True when the file exists and matches its pinned size and digest. */
async function verified(file: string, pin: Pin): Promise<boolean> {
  if (!existsSync(file)) return false;
  if ((await stat(file)).size !== pin.size) return false;
  return (await digestOf(file, pin.algorithm)) === pin.digest;
}

/**
 * Put one pinned file into `downloads/` as `name`, copied from the folder `from` when there is one
 * and fetched from `url` when not, and check it. A file already there that matches is kept.
 * Returns whether the file had to be put there.
 */
async function obtain(name: string, pin: Pin, url: string, from?: string): Promise<boolean> {
  const target = join(DOWNLOADS, name);
  if (await verified(target, pin)) return false;
  const partial = `${target}.partial-${process.pid}`;
  if (from) {
    await copyFile(join(from, name), partial);
  } else {
    const response = await fetch(url);
    if (!response.ok || !response.body)
      throw new Error(`${name}: HTTP ${response.status} from ${url}`);
    // The DOM and Node type the same stream differently; at run time they are one object.
    const body = response.body as unknown as NodeReadableStream<Uint8Array>;
    await pipeline(Readable.fromWeb(body), createWriteStream(partial));
  }
  if (!(await verified(partial, pin))) {
    const size = (await stat(partial)).size;
    const digest = await digestOf(partial, pin.algorithm);
    await rm(partial, { force: true });
    throw new Error(
      `${name} is ${size} bytes with ${pin.algorithm.toUpperCase()} ${digest}, not the recorded ${pin.size} bytes and ${pin.digest || "no digest"}; refusing to use it`,
    );
  }
  await rename(partial, target);
  return true;
}

/** Put the release files into `downloads/`, and ready `.engine/` for their loaders. */
async function obtainRelease(from: string | undefined) {
  console.log(from ? `Copying the release from ${from}` : `Downloading ${RELEASE_URL}`);
  mkdirSync(DOWNLOADS, { recursive: true });
  // The editor's package is an ES module package, which would make Node load the release's
  // CommonJS loaders as ES modules; this folder says otherwise.
  await writeFile(join(ROOT, "package.json"), `${JSON.stringify({ type: "commonjs" })}\n`);
  for (const [name, { sha256, size }] of Object.entries(ASSETS)) {
    const pin: Pin = { size, algorithm: "sha256", digest: sha256 };
    if (await obtain(name, pin, RELEASE_URL + name, from))
      console.log(`  ${name}, ${(size / 1e6).toFixed(1)} MB`);
  }
}

/** Put the container of every package of `PACKAGES` into `downloads/`, from the archive. */
async function obtainPackages() {
  console.log(`Downloading TeX Live 2023 packages from ${ARCHIVE_URL}archive/`);
  let downloaded = 0;
  for (const [name, { revision, size, sha512 }] of Object.entries(PACKAGES)) {
    const file = containerName(name, revision);
    const pin: Pin = { size, algorithm: "sha512", digest: sha512 };
    if (await obtain(file, pin, `${ARCHIVE_URL}archive/${file}`)) downloaded++;
  }
  const names = Object.keys(PACKAGES);
  const bytes = Object.values(PACKAGES).reduce((sum, { size }) => sum + size, 0);
  console.log(
    `  ${names.join(", ")}: ${names.length} packages, ${(bytes / 1e6).toFixed(1)} MB, ${downloaded} of them downloaded now`,
  );
}

/** The part of Emscripten's file system API the walk uses. */
interface EmscriptenFs {
  readdir(path: string): string[];
  stat(path: string): { mode: number };
  isDir(mode: number): boolean;
  isFile(mode: number): boolean;
  readFile(path: string): Uint8Array;
  analyzePath(path: string): { exists: boolean };
}

/**
 * Mount the bundles in the engine and return its file system. The bundle loaders were written
 * for a browser page, so Node has to supply what they look for: a `self` and a `location`, an
 * IndexedDB whose `open` fails, after which they read their data file from disk, and a global
 * named `BusytexPipeline` that they bind to and that forwards to the engine.
 */
async function mount(): Promise<EmscriptenFs> {
  const g = globalThis as Record<string, unknown>;
  g.self = globalThis;
  g.location = { href: "file:///" };
  const noIndexedDb = new Error("no IndexedDB in Node");
  g.indexedDB = {
    open() {
      const request: { onerror?: (e: Error) => void } = {};
      setImmediate(() => request.onerror?.(noIndexedDb));
      return request;
    },
  };
  // The loaders report that failure on the console before falling back; nothing is wrong.
  const error = console.error;
  console.error = (...args: unknown[]) => {
    if (args[0] !== noIndexedDb && args[0] !== "falling back to default preload behavior")
      error(...args);
  };
  const bundlePipeline = {
    preRun: [] as (() => void)[],
    calledRun: false,
    locateFile: (name: string) => join(DOWNLOADS, basename(name)),
  };
  g.BusytexPipeline = bundlePipeline;
  const require = createRequire(import.meta.url);
  for (const bundle of BUNDLES) require(join(DOWNLOADS, `${bundle}.js`));
  const busytex = require(join(DOWNLOADS, "busytex.js")) as (
    module: Record<string, unknown>,
  ) => Promise<{ FS: EmscriptenFs }>;
  const engine: Record<string, unknown> = {
    thisProgram: "/bin/busytex",
    noInitialRun: true,
    locateFile: (name: string) => join(DOWNLOADS, basename(name)),
    preRun: [
      () => {
        Object.setPrototypeOf(bundlePipeline, engine);
        for (const run of bundlePipeline.preRun) run();
      },
    ],
    print: () => {},
    printErr: () => {},
  };
  try {
    return (await busytex(engine)).FS;
  } finally {
    console.error = error;
  }
}

/** Every file under the roots of the engine's file system, in path order. */
function treeFiles(fs: EmscriptenFs): string[] {
  const paths: string[] = [];
  const walk = (path: string) => {
    for (const name of fs.readdir(path)) {
      if (name === "." || name === "..") continue;
      const child = `${path}/${name}`;
      const { mode } = fs.stat(child);
      if (fs.isDir(mode)) walk(child);
      else if (fs.isFile(mode)) paths.push(child);
    }
  };
  for (const root of ROOTS) if (fs.analyzePath(root).exists) walk(root);
  return paths.sort();
}

/** Copy every file under the roots out of the engine into `dir`, and list it, in path order. */
function copyOut(fs: EmscriptenFs, dir: string): Record<string, number> {
  const files: Record<string, number> = {};
  for (const path of treeFiles(fs)) {
    const data = fs.readFile(path);
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    files[path] = data.length;
  }
  return files;
}

/** The files a manifest lists, in path order. */
const byPath = (files: Record<string, number>) =>
  Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));

/**
 * Merge the font maps the added packages name and those of the Ubuntu tree into the copied tree's
 * `pdftex.map`, and give the manifest its new size. This is what `updmap` does for a map it is
 * told about; the packages and the bundles were unpacked over TeX Live's tree without it, so
 * `pdftex.map` names none of their fonts. The packages' maps come first, in `packageMaps`'s order,
 * since their files are in the tree kpathsea searches first, and then the Ubuntu tree's in path
 * order. Only entries whose outline file the trees hold are added (`mergeFontMaps`). The files
 * are read and written as Latin-1, one character per byte, so that the map's other lines come back
 * byte for byte.
 */
function mergeMaps(dir: string, files: Record<string, number>, packageMaps: readonly string[]) {
  if (files[PDFTEX_MAP] === undefined) return; // the check for REQUIRED files names it
  const outlines = new Set(
    Object.keys(files)
      .filter((path) => OUTLINES.some((tree) => path.startsWith(tree)))
      .map((path) => basename(path)),
  );
  const ubuntuMaps = Object.keys(files)
    .filter((path) => path.startsWith(UBUNTU_MAPS) && path.endsWith(".map"))
    .sort();
  const maps = [...packageMaps, ...ubuntuMaps].map((path) => ({
    path,
    text: readFileSync(join(dir, path), "latin1"),
  }));
  const base = readFileSync(join(dir, PDFTEX_MAP), "latin1");
  const merged = mergeFontMaps(base, maps, (file) => outlines.has(file));
  writeFileSync(join(dir, PDFTEX_MAP), merged, "latin1");
  files[PDFTEX_MAP] = Buffer.byteLength(merged, "latin1");
}

/**
 * Take every font folder out of the copied tree's `fonts.conf`, and give the manifest its new size.
 * XeTeX would otherwise have fontconfig scan the tree's fonts on every run, though it takes every
 * font it sets by file (`scripts/fontconfig.ts`).
 */
function bareFontConf(dir: string, files: Record<string, number>) {
  if (files[FONTS_CONF] === undefined)
    throw new Error(`the tree has no ${FONTS_CONF} to take the font folders out of`);
  const conf = withoutFontFolders(readFileSync(join(dir, FONTS_CONF), "utf8"));
  writeFileSync(join(dir, FONTS_CONF), conf);
  files[FONTS_CONF] = Buffer.byteLength(conf);
}

/** The revision of each package of `PACKAGES`, by name, as the manifest records them. */
const revisions = (): Record<string, number> =>
  Object.fromEntries(Object.entries(PACKAGES).map(([name, { revision }]) => [name, revision]));

/** True when `.engine/` holds a finished build of this release, layout, bundles and packages. */
async function upToDate(): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(MANIFEST, "utf8")) as EngineManifest;
    return (
      manifest.release === RELEASE &&
      manifest.layout === LAYOUT &&
      manifest.bundles.join() === BUNDLES.join() &&
      JSON.stringify(manifest.packages) === JSON.stringify(revisions()) &&
      ["busytex.js", "busytex.mjs", "busytex.wasm"].every((f) => existsSync(join(ROOT, f))) &&
      REQUIRED.every((path) => existsSync(join(FILES, path)))
    );
  } catch {
    // No manifest, or one that is cut short or not of this shape: build again.
    return false;
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** A lock this old is stale even if its process id now belongs to a live process. */
const STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * Take `.engine/.lock`, which names the process holding it, and return what releases it. A lock
 * whose process is gone, or that is over an hour old, was left by a run that stopped and is taken
 * over; a live one stops this run.
 */
async function lock(): Promise<() => Promise<void>> {
  const mine = String(process.pid);
  for (;;) {
    try {
      await writeFile(LOCK, mine, { flag: "wx" });
      // Release the lock only while it is still this run's.
      return async () => {
        if ((await readFile(LOCK, "utf8").catch(() => "")) === mine)
          await rm(LOCK, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const holder = Number(await readFile(LOCK, "utf8").catch(() => ""));
      const age =
        Date.now() -
        (await stat(LOCK).then(
          (s) => s.mtimeMs,
          () => 0,
        ));
      if (holder && holder !== process.pid && alive(holder) && age < STALE_AFTER_MS)
        throw new Error(
          `fetch-engine is already running (process ${holder}). If it is not, delete ${LOCK} and run it again.`,
        );
      await rm(LOCK, { force: true });
    }
  }
}

/** Remove what runs that are no longer alive left behind: part-written files and old trees. */
async function sweep() {
  const folders = [ROOT, DOWNLOADS].filter((folder) => existsSync(folder));
  for (const folder of folders) {
    for (const name of readdirSync(folder)) {
      const leftover = /\.(?:partial|old)(?:-(\d+))?$/.exec(name);
      if (leftover && !(leftover[1] && alive(Number(leftover[1]))))
        await rm(join(folder, name), { recursive: true, force: true });
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const fromAt = args.indexOf("--from");
  const from = fromAt >= 0 ? resolve(args[fromAt + 1] ?? ".") : undefined;
  const resolving = args.includes("--resolve");
  if (!resolving && !args.includes("--force") && (await upToDate())) {
    console.log(`.engine/ is up to date (${RELEASE}); --force rebuilds it`);
    return;
  }
  mkdirSync(ROOT, { recursive: true });
  const unlock = await lock();
  try {
    await sweep();
    await (resolving ? resolvePackages(from) : build(from));
  } finally {
    await unlock();
  }
}

/**
 * Work `PACKAGES` out again from the archive's database and print it for pasting over the
 * constant: `WANTED` and what they depend on, in name order, less the packages whose every run
 * file the bundles hold. The bundles are mounted to list their files, and the archive is asked
 * for each container the list names, so that a list the archive cannot serve is refused here
 * rather than half way through a build. Nothing is built.
 */
async function resolvePackages(from: string | undefined) {
  await obtainRelease(from);
  console.log("Listing the bundles' files");
  const bundled = new Set(treeFiles(await mount()));
  const has = (path: string) => bundled.has(`/texlive/${path}`) || bundled.has(`/texmf/${path}`);
  const url = ARCHIVE_URL + DATABASE.path;
  console.log(`Reading ${url}`);
  const database = basename(DATABASE.path);
  await obtain(
    database,
    { size: DATABASE.size, algorithm: "sha256", digest: DATABASE.sha256 },
    url,
  );
  const packages = packagesToFetch(
    parseDatabase(await readFile(join(DOWNLOADS, database), "utf8")),
    WANTED,
    has,
  );
  const faults: string[] = [];
  for (const pkg of packages) {
    const file = containerName(pkg.name, pkg.revision);
    if (!pkg.relocated) faults.push(`${pkg.name} is not relocated`);
    if (pkg.containerSize === undefined || !pkg.containerChecksum)
      faults.push(`the database records no container for ${pkg.name}`);
    const response = await fetch(`${ARCHIVE_URL}archive/${file}`, { method: "HEAD" });
    const length = response.headers.get("content-length");
    if (!response.ok) faults.push(`${file}: HTTP ${response.status}`);
    else if (length !== null && Number(length) !== pkg.containerSize)
      faults.push(`${file} is ${length} bytes, not ${pkg.containerSize}`);
  }
  if (faults.length > 0)
    throw new Error(`the archive cannot give the tree:\n  ${faults.join("\n  ")}`);
  const bytes = packages.reduce((sum, pkg) => sum + (pkg.containerSize ?? 0), 0);
  console.log(
    `${packages.length} packages, ${(bytes / 1e6).toFixed(1)} MB, every container served; paste this over PACKAGES and bump LAYOUT:\n`,
  );
  console.log("const PACKAGES: Record<string, Container> = {");
  for (const pkg of packages)
    console.log(
      `  ${JSON.stringify(pkg.name)}: { revision: ${pkg.revision}, size: ${pkg.containerSize}, sha512: "${pkg.containerChecksum}" },`,
    );
  console.log("};");
}

async function build(from: string | undefined) {
  await obtainRelease(from);
  await obtainPackages();

  console.log("Unpacking TeX Live");
  const started = performance.now();
  // A new manifest is written last, so a build that stops half way is never taken as done.
  await rm(MANIFEST, { force: true });
  const staging = `${FILES}.partial-${process.pid}`;
  const old = `${FILES}.old-${process.pid}`;
  let files: Record<string, number>;
  try {
    files = copyOut(await mount(), staging);
    const { maps } = unpackPackages(
      {
        packages: PACKAGES,
        containers: DOWNLOADS,
        scratch: join(ROOT, `packages.partial-${process.pid}`),
        tree: staging,
      },
      files,
    );
    mergeMaps(staging, files, maps);
    bareFontConf(staging, files);
    files = byPath(files);
    const missing = REQUIRED.filter((path) => files[path] === undefined);
    if (missing.length) throw new Error(`the TeX Live tree lacks ${missing.join(", ")}`);
    // Swap the trees by renaming, so no run deletes files another run has put in place.
    await rename(FILES, old).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rename(staging, FILES);
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(old, { recursive: true, force: true });
  }

  const loader = await readFile(join(DOWNLOADS, "busytex.js"), "utf8");
  await writeFile(join(ROOT, "busytex.js"), loader);
  // The worker is an ES module and cannot use importScripts, so it imports this copy.
  await writeFile(join(ROOT, "busytex.mjs"), `${loader}\nexport default busytex;\n`);
  await copyFile(join(DOWNLOADS, "busytex.wasm"), join(ROOT, "busytex.wasm"));
  const manifest: EngineManifest = {
    release: RELEASE,
    layout: LAYOUT,
    bundles: BUNDLES,
    packages: revisions(),
    files,
  };
  // Written under another name and renamed, so a run stopped while writing it leaves no
  // manifest rather than part of one.
  const partial = `${MANIFEST}.partial-${process.pid}`;
  await writeFile(partial, JSON.stringify(manifest));
  await rename(partial, MANIFEST);

  const bytes = Object.values(files).reduce((a, b) => a + b, 0);
  console.log(
    `${Object.keys(files).length} files, ${(bytes / 1e6).toFixed(1)} MB, in ${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
