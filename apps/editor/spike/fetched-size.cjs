// Sum the raw, gzip and brotli sizes of files the on-demand page reported fetching, from the tree
// extract-texlive.cjs unpacked.
// Usage: node spike/fetched-size.cjs <json list of paths>   (paths as in the manifest)
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const R = process.env.SPIKE_ASSETS ?? path.join(__dirname, "assets");
const ROOT = path.join(R, "texlive");
const list = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const groups = {};
const add = (group, raw, gz, br) => {
  const g = (groups[group] ??= { files: 0, raw: 0, gz: 0, br: 0 });
  g.files++;
  g.raw += raw;
  g.gz += gz;
  g.br += br;
};
for (const p of list) {
  const data = fs.readFileSync(path.join(ROOT, p));
  const gz = zlib.gzipSync(data, { level: 9 }).length;
  const br = zlib.brotliCompressSync(data).length;
  const group = /\.fmt$/.test(p)
    ? "stock format"
    : /ls-R$/.test(p)
      ? "ls-R"
      : /\.tfm$/.test(p)
        ? "tfm"
        : /texmf\.cnf$/.test(p)
          ? "texmf.cnf"
          : "packages";
  add(group, data.length, gz, br);
  add("total", data.length, gz, br);
}
for (const [name, g] of Object.entries(groups))
  console.log(
    `${name.padEnd(13)} ${String(g.files).padStart(3)} files  raw ${(g.raw / 1e6).toFixed(2)} MB  gzip ${(g.gz / 1e6).toFixed(2)} MB  brotli ${(g.br / 1e6).toFixed(2)} MB`,
  );
const extra = (p) => {
  const d = fs.readFileSync(p);
  return `${path.basename(p)}: raw ${(d.length / 1e6).toFixed(2)} MB gzip ${(zlib.gzipSync(d, { level: 9 }).length / 1e6).toFixed(2)} MB brotli ${(zlib.brotliCompressSync(d).length / 1e6).toFixed(2)} MB`;
};
console.log(extra(path.join(R, "texlive-manifest.json")));
