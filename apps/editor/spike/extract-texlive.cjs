// Unpack the TeX Live bundles into individual files, the way a CDN would hold them, plus a
// manifest of every path and size for the worker's on-demand file system.
// Usage: node spike/extract-texlive.cjs   -> spike/assets/texlive/** and texlive-manifest.json
const fs = require("fs");
const path = require("path");
const { makeModule } = require("./harness.cjs");
const R = process.env.SPIKE_ASSETS ?? path.join(__dirname, "assets");
const OUT = path.join(R, "texlive");
const MANIFEST = path.join(R, "texlive-manifest.json");
(async () => {
  const M = await makeModule([
    "texlive-basic",
    "ubuntu-texlive-latex-extra",
    "ubuntu-texlive-fonts-recommended",
  ]);
  const { FS } = M;
  const files = {};
  let bytes = 0;
  const walk = (dir) => {
    for (const name of FS.readdir(dir)) {
      if (name === "." || name === "..") continue;
      const p = dir === "/" ? `/${name}` : `${dir}/${name}`;
      const st = FS.stat(p);
      if (FS.isDir(st.mode)) walk(p);
      else if (FS.isFile(st.mode)) {
        const data = FS.readFile(p);
        const target = path.join(OUT, p);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data);
        files[p] = data.length;
        bytes += data.length;
      }
    }
  };
  for (const root of ["/texlive", "/texmf", "/etc", "/bin"])
    if (FS.analyzePath(root).exists) walk(root);
  fs.writeFileSync(MANIFEST, JSON.stringify({ files }));
  console.log(
    `${Object.keys(files).length} files, ${(bytes / 1e6).toFixed(1)} MB, manifest ${(fs.statSync(MANIFEST).size / 1e6).toFixed(1)} MB`,
  );
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
