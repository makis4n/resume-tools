// Spike: a Web Worker hosting the BusyTeX build of pdfTeX (TeX Live 2023, WebAssembly).
// Plain JavaScript on purpose: the engine glue and the TeX Live bundles are classic scripts
// that need importScripts, which module workers do not have.
/* global importScripts, busytex */

const ASSETS = "/spike/assets/";
// The TeX Live tree as individual files, for the on-demand mode; see spike/extract-texlive.cjs.
const TEXLIVE = "/spike/assets/texlive";
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

// What the on-demand file system fetched since the last reply.
let fetched = { requests: 0, bytes: 0, files: [] };
const takeFetched = () => {
  const f = fetched;
  fetched = { requests: 0, bytes: 0, files: [] };
  return f;
};
function fetchSync(url) {
  const xhr = new XMLHttpRequest();
  xhr.open("GET", url, false);
  xhr.responseType = "arraybuffer";
  xhr.send(null);
  if (xhr.status !== 200) throw new Error(`${url}: HTTP ${xhr.status}`);
  return new Uint8Array(xhr.response);
}

// Every file in the manifest becomes an empty MEMFS node that knows its size, whose contents
// are fetched with one synchronous request the first time TeX reads it. stat() costs nothing,
// which matters because kpathsea stats many candidates for each file it looks up.
function mountOnDemand(FS, manifest) {
  const t0 = performance.now();
  let count = 0;
  for (const [path, size] of Object.entries(manifest.files)) {
    const slash = path.lastIndexOf("/");
    const dir = path.slice(0, slash) || "/";
    const name = path.slice(slash + 1);
    FS.mkdirTree(dir);
    const node = FS.create(path, 0o444);
    node.usedBytes = size;
    Object.defineProperty(node, "contents", {
      configurable: true,
      get() {
        const data = fetchSync(TEXLIVE + path);
        fetched.requests++;
        fetched.bytes += data.length;
        fetched.files.push(path);
        Object.defineProperty(node, "contents", {
          value: data,
          writable: true,
          configurable: true,
        });
        return data;
      },
      set(value) {
        Object.defineProperty(node, "contents", { value, writable: true, configurable: true });
      },
    });
    count++;
  }
  return { count, ms: performance.now() - t0 };
}

async function init(packages, onDemand) {
  const t0 = performance.now();
  let manifest = null;
  let mounted = null;
  if (onDemand) {
    importScripts(`${ASSETS}busytex.js`);
    manifest = JSON.parse(new TextDecoder().decode(fetchSync(`${ASSETS}texlive-manifest.json`)));
  } else importScripts(...packages.map((p) => `${ASSETS}${p}.js`), `${ASSETS}busytex.js`);
  const Module = {
    thisProgram: "/bin/busytex",
    noInitialRun: true,
    locateFile: (name) => ASSETS + name.split("/").pop(),
    preRun: [
      () => {
        Object.assign(Module.ENV, ENV);
        Module.FS.mkdir(PROJECT);
        if (manifest) {
          mounted = mountOnDemand(Module.FS, manifest);
          return;
        }
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
  return { ms: performance.now() - t0, mounted };
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
      const { ms, mounted } = await init(data.packages, data.onDemand);
      reply({
        type: "ready",
        ms,
        mounted,
        heapMb: M.HEAPU8.length / 2 ** 20,
        fetched: takeFetched(),
      });
    } else if (data.type === "dump") {
      M.FS.writeFile("pre.tex", `${data.preamble}\n\\dump\n`);
      const r = run(["pdflatex", "-ini", "-jobname=pre", ...COMMON, "&pdflatex", "pre.tex"]);
      const fmt = readBytes(`${PROJECT}/pre.fmt`);
      reply({
        type: "dumped",
        ...r,
        size: fmt ? fmt.length : 0,
        log: readText(`${PROJECT}/pre.log`),
        fetched: takeFetched(),
      });
    } else if (data.type === "compile") {
      M.FS.writeFile("body.tex", data.body);
      if (M.FS.analyzePath(`${PROJECT}/body.dvi`).exists) M.FS.unlink(`${PROJECT}/body.dvi`);
      const fmt = data.stock ? STOCK_FORMAT : `${PROJECT}/pre.fmt`;
      const r = run(["pdflatex", ...COMMON, "--fmt", fmt, "body.tex"]);
      const dvi = readBytes(`${PROJECT}/body.dvi`);
      reply(
        {
          type: "compiled",
          ...r,
          dvi,
          log: readText(`${PROJECT}/body.log`),
          fetched: takeFetched(),
        },
        dvi ? [dvi.buffer] : [],
      );
    }
  } catch (e) {
    reply({ type: "error", message: String(e && e.stack ? e.stack : e) });
  }
};
