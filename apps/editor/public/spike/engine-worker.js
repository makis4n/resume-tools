// Spike: a Web Worker hosting the BusyTeX build of pdfTeX (TeX Live 2023, WebAssembly).
// Plain JavaScript on purpose: the engine glue and the TeX Live bundles are classic scripts
// that need importScripts, which module workers do not have.
/* global importScripts, busytex */

const ASSETS = "/spike-assets/";
const PROJECT = "/home/web_user/project_dir";
const STOCK_FORMAT = "/texlive/texmf-dist/texmf-var/web2c/pdftex/pdflatex.fmt";
const HEADER_BYTES = 2 ** 26;
const ENV = {
  TEXMFDIST: "/texlive/texmf-dist:/texmf/texmf-dist",
  TEXMFVAR: "/texlive/texmf-dist/texmf-var",
  TEXMFCNF: "/texlive/texmf-dist/web2c",
  TEXMFLOG: "/tmp/texmf.log",
  FONTCONFIG_PATH: "/texlive",
};

// The TeX Live bundle loaders bind to this global and ask it where their .data file is.
self.BusytexPipeline = {
  preRun: [],
  calledRun: false,
  locateFile: (name) => ASSETS + name.split("/").pop(),
};

let M = null;
let header = null;
let out = [];

async function init(packages) {
  const t0 = performance.now();
  importScripts(...packages.map((p) => `${ASSETS}${p}.js`), `${ASSETS}busytex.js`);
  const Module = {
    thisProgram: "/bin/busytex",
    noInitialRun: true,
    locateFile: (name) => ASSETS + name.split("/").pop(),
    preRun: [
      () => {
        Object.assign(Module.ENV, ENV);
        Module.FS.mkdir(PROJECT);
        Object.setPrototypeOf(self.BusytexPipeline, Module);
        for (const f of self.BusytexPipeline.preRun) f();
      },
    ],
    print: (t) => out.push(t),
    printErr: (t) => out.push(t),
  };
  M = await busytex(Module);
  header = M.HEAPU8.slice(0, HEADER_BYTES);
  M.FS.chdir(PROJECT);
  return performance.now() - t0;
}

// One engine run. The heap is snapshotted after initialisation and restored after every
// run, so main() can be called again and again; files live in MEMFS and survive.
function run(args) {
  out = [];
  const t0 = performance.now();
  const code = M.callMain([...args]); // callMain mutates its argument
  M._flush_streams();
  const ms = performance.now() - t0;
  const t1 = performance.now();
  M.HEAPU8.fill(0);
  M.HEAPU8.set(header);
  return { code, ms, resetMs: performance.now() - t1, out: out.join("\n") };
}

const readText = (p) => (M.FS.analyzePath(p).exists ? M.FS.readFile(p, { encoding: "utf8" }) : "");
const readBytes = (p) => (M.FS.analyzePath(p).exists ? M.FS.readFile(p) : null);
const COMMON = [
  "--no-shell-escape",
  "--interaction=nonstopmode",
  "--halt-on-error",
  "--output-format=dvi",
];

onmessage = async ({ data }) => {
  const reply = (msg, transfer) => postMessage({ id: data.id, ...msg }, transfer);
  try {
    if (data.type === "init") {
      const ms = await init(data.packages);
      reply({ type: "ready", ms, heapMb: M.HEAPU8.length / 2 ** 20 });
    } else if (data.type === "dump") {
      M.FS.writeFile("pre.tex", `${data.preamble}\n\\dump\n`);
      const r = run(["pdflatex", "-ini", "-jobname=pre", ...COMMON, "&pdflatex", "pre.tex"]);
      const fmt = readBytes(`${PROJECT}/pre.fmt`);
      reply({
        type: "dumped",
        ...r,
        size: fmt ? fmt.length : 0,
        log: readText(`${PROJECT}/pre.log`),
      });
    } else if (data.type === "compile") {
      M.FS.writeFile("body.tex", data.body);
      if (M.FS.analyzePath(`${PROJECT}/body.dvi`).exists) M.FS.unlink(`${PROJECT}/body.dvi`);
      const fmt = data.stock ? STOCK_FORMAT : `${PROJECT}/pre.fmt`;
      const r = run(["pdflatex", ...COMMON, "--fmt", fmt, "body.tex"]);
      const dvi = readBytes(`${PROJECT}/body.dvi`);
      reply(
        { type: "compiled", ...r, dvi, log: readText(`${PROJECT}/body.log`) },
        dvi ? [dvi.buffer] : [],
      );
    }
  } catch (e) {
    reply({ type: "error", message: String(e && e.stack ? e.stack : e) });
  }
};
