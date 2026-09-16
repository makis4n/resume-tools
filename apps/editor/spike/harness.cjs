// Node harness for the BusyTeX WebAssembly engines (spike only, throwaway).
// Usage: node harness.cjs <mode> ...   see bottom.
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

const ROOT = process.env.SPIKE_ASSETS ?? path.join(__dirname, "assets");
const B = path.join(ROOT, "busytex");
const OUT = path.join(ROOT, "out");
const PROJECT = "/home/web_user/project_dir";
const ENV = {
  TEXMFDIST: "/texlive/texmf-dist:/texmf/texmf-dist",
  TEXMFVAR: "/texlive/texmf-dist/texmf-var",
  TEXMFCNF: "/texlive/texmf-dist/web2c",
  TEXMFLOG: "/tmp/texmf.log",
  FONTCONFIG_PATH: "/texlive",
};

// Node has no IndexedDB. The loader was built with --use-preload-cache and throws without one,
// so give it a fake whose open() fails on the next tick; its fallback then reads the file with fs.
global.location = { href: "file:///" };
global.self = global;
global.indexedDB = {
  open() {
    const req = {};
    setImmediate(() => req.onerror && req.onerror(new Error("no indexedDB in node")));
    return req;
  },
};
// The data-package loaders bind to a global named BusytexPipeline (patched file_packager output).
global.BusytexPipeline = {
  preRun: [],
  calledRun: false,
  locateFile(name) {
    return path.join(B, path.basename(name));
  },
  // Node has no IndexedDB; hand the loader the bytes directly so it skips its cache path.
  getPreloadedPackage(name, size) {
    const b = fs.readFileSync(name);
    if (b.byteLength !== size) throw new Error(`size mismatch for ${name}`);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  },
};

async function makeModule(packages, opts = {}) {
  for (const p of packages) require(path.join(B, `${p}.js`));
  const busytex = require(path.join(B, "busytex.js"));
  const out = [];
  const Module = {
    thisProgram: "/bin/busytex",
    noInitialRun: true,
    locateFile: (name) => path.join(B, path.basename(name)),
    preRun: [
      () => {
        Object.assign(Module.ENV, ENV, opts.env || {});
        Module.FS.mkdir(PROJECT);
        Object.setPrototypeOf(global.BusytexPipeline, Module);
        for (const f of global.BusytexPipeline.preRun) f();
      },
    ],
    print: (t) => out.push(t),
    printErr: (t) => out.push(t),
  };
  const t0 = performance.now();
  const M = await busytex(Module);
  M.__out = out;
  M.__initMs = performance.now() - t0;
  M.__heapMb = M.HEAPU8.length / 2 ** 20;
  const HEADER = 2 ** 26;
  if (!M.HEAP32.slice(HEADER / 4).every((x) => x === 0))
    throw new Error("heap beyond header not zero");
  M.__header = Uint8Array.from(M.HEAPU8.slice(0, HEADER));
  M.__run = (args) => {
    out.length = 0;
    const t = performance.now();
    const code = M.callMain([...args]); // callMain mutates its argument
    M._flush_streams();
    const ms = performance.now() - t;
    M.HEAPU8.fill(0);
    M.HEAPU8.set(M.__header);
    process.exitCode = 0;
    return { code, ms, out: out.join("\n") };
  };
  return M;
}

function writeProject(M, files) {
  const { FS } = M;
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.posix.join(PROJECT, rel);
    const dir = path.posix.dirname(abs);
    dir.split("/").reduce((acc, seg) => {
      const p = acc ? `${acc}/${seg}` : `/${seg}`;
      if (seg && !FS.analyzePath(p).exists) FS.mkdir(p);
      return p === "/" ? "" : p;
    }, "");
    FS.writeFile(abs, content);
  }
  FS.chdir(PROJECT);
}

function readText(M, p) {
  return M.FS.analyzePath(p).exists ? M.FS.readFile(p, { encoding: "utf8" }) : "";
}
function readBytes(M, p) {
  return M.FS.analyzePath(p).exists ? M.FS.readFile(p) : null;
}

module.exports = { makeModule, writeProject, readText, readBytes, PROJECT, B };

if (require.main === module) {
  fs.mkdirSync(path.join(ROOT, "out"), { recursive: true });
  (async () => {
    const mode = process.argv[2] || "jake-stock";
    if (mode === "jake-stock") {
      const M = await makeModule([
        "texlive-basic",
        "ubuntu-texlive-latex-extra",
        "ubuntu-texlive-fonts-recommended",
      ]);
      console.log(
        `init ${M.__initMs.toFixed(0)} ms; heap ${M.__heapMb} MB; roots: ${M.FS.readdir("/").join(" ")}; /texmf: ${M.FS.analyzePath("/texmf").exists ? M.FS.readdir("/texmf").join(" ") : "-"}`,
      );
      const v = M.__run(["pdflatex", "--version"]);
      console.log(v.out.split("\n")[0]);
      const tex = fs.readFileSync(path.join(ROOT, "templates", "jake", "resume.tex"), "utf8");
      writeProject(M, { "resume.tex": tex });
      const args = [
        "pdflatex",
        "--no-shell-escape",
        "--interaction=nonstopmode",
        "--halt-on-error",
        "--output-format=dvi",
        "--fmt",
        "/texlive/texmf-dist/texmf-var/web2c/pdftex/pdflatex.fmt",
        "resume.tex",
      ];
      for (let i = 0; i < 6; i++) {
        const r = M.__run(args);
        const dvi = readBytes(M, `${PROJECT}/resume.dvi`);
        console.log(
          `run ${i + 1}: exit ${r.code} ${r.ms.toFixed(0)} ms dvi ${dvi ? dvi.length : 0} bytes`,
        );
        if (r.code !== 0 || !dvi) {
          console.log(r.out.slice(-3000));
          console.log("--- log tail ---");
          console.log(readText(M, `${PROJECT}/resume.log`).slice(-3000));
          break;
        }
        if (i === 0) fs.writeFileSync(path.join(OUT, "jake-stock.dvi"), dvi);
      }
      const log = readText(M, `${PROJECT}/resume.log`);
      console.log(
        log
          .split("\n")
          .filter((l) => /Warning|Error|Output written|Font|missing/i.test(l))
          .slice(0, 20)
          .join("\n"),
      );
    }
  })().catch((e) => {
    console.error("FAILED", e);
    process.exit(1);
  });
}
