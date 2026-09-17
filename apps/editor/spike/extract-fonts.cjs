// Pull the CM Type 1 fonts, TFMs and the pdftex map for Jake's DVI out of the data bundle.
const fs = require("fs"),
  path = require("path");
const { makeModule } = require("./harness.cjs");
const R = process.env.SPIKE_ASSETS ?? path.join(__dirname, "assets");
(async () => {
  const M = await makeModule(["texlive-basic"]);
  const out = path.join(R, "texfonts");
  fs.mkdirSync(out, { recursive: true });
  const map = M.FS.readFile("/texlive/texmf-dist/texmf-var/fonts/map/pdftex/updmap/pdftex.map", {
    encoding: "utf8",
  });
  fs.writeFileSync(path.join(out, "pdftex.map"), map);
  const names = [
    "cmr10",
    "cmsy10",
    "cmbx10",
    "cmbx12",
    "cmcsc10",
    "cmsy6",
    "cmti10",
    "cmr7",
    "cmr8",
    "cmmi10",
    "cmr12",
    "cmr17",
    "cmtt10",
    "cmbx8",
    "cmr9",
    "cmsy8",
    "cmsy7",
  ];
  for (const n of names) {
    const line = map.split("\n").find((l) => l.startsWith(n + " "));
    const pfb = `/texlive/texmf-dist/fonts/type1/public/amsfonts/cm/${n}.pfb`,
      tfm = `/texlive/texmf-dist/fonts/tfm/public/cm/${n}.tfm`;
    const ok = M.FS.analyzePath(pfb).exists && M.FS.analyzePath(tfm).exists;
    if (ok) {
      fs.writeFileSync(path.join(out, `${n}.pfb`), M.FS.readFile(pfb));
      fs.writeFileSync(path.join(out, `${n}.tfm`), M.FS.readFile(tfm));
    }
    console.log(`${n}: ${ok ? "ok" : "MISSING"}  map: ${line || "-"}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
