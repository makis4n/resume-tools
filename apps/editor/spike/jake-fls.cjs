// What does a body compile actually read? Run with -recorder and sum the input files.
const fs = require("fs");
const path = require("path");
const { makeModule, writeProject, readText, readBytes, PROJECT } = require("./harness.cjs");
(async () => {
  const M = await makeModule([
    "texlive-basic",
    "ubuntu-texlive-latex-extra",
    "ubuntu-texlive-fonts-recommended",
  ]);
  // The spike page's preamble and body, which the tests keep as fixtures.
  const fixtures = path.join(__dirname, "..", "src", "tex", "fixtures");
  const preamble = fs.readFileSync(path.join(fixtures, "jake-preamble.tex"), "utf8");
  const body = fs.readFileSync(path.join(fixtures, "body.tex"), "utf8");
  writeProject(M, { "pre.tex": `${preamble}\n\\dump\n`, "body.tex": body });
  const common = [
    "--no-shell-escape",
    "--interaction=nonstopmode",
    "--halt-on-error",
    "--output-format=dvi",
  ];
  let r = M.__run(["pdflatex", "-ini", "-jobname=pre", ...common, "&pdflatex", "pre.tex"]);
  console.log(`dump exit ${r.code}`);
  M.__run(["pdflatex", ...common, "--fmt", `${PROJECT}/pre.fmt`, "body.tex"]); // warm: .aux/.out exist
  r = M.__run(["pdflatex", ...common, "-recorder", "--fmt", `${PROJECT}/pre.fmt`, "body.tex"]);
  console.log(`body exit ${r.code} ${r.ms.toFixed(0)} ms`);
  const fls = readText(M, `${PROJECT}/body.fls`);
  const inputs = [
    ...new Set(
      fls
        .split("\n")
        .filter((l) => l.startsWith("INPUT "))
        .map((l) => l.slice(6).trim()),
    ),
  ];
  let total = 0;
  const rows = [];
  for (const f of inputs) {
    const p = f.startsWith("/") ? f : `${PROJECT}/${f}`;
    let size = 0;
    try {
      size = M.FS.stat(p).size;
    } catch {
      size = -1;
    }
    total += Math.max(0, size);
    rows.push([size, f]);
  }
  rows.sort((a, b) => b[0] - a[0]);
  console.log(`inputs: ${inputs.length} files, ${(total / 1e6).toFixed(2)} MB total`);
  for (const [s, f] of rows) console.log(`${String(s).padStart(9)}  ${f}`);
  console.log("--- first-load of the pdfTeX path for this template:");
  const fmt = M.FS.stat(`${PROJECT}/pre.fmt`).size;
  const texlive = rows
    .filter(([, f]) => f.startsWith("/texlive") || f.startsWith("/texmf"))
    .reduce((a, [s]) => a + Math.max(0, s), 0);
  console.log(
    `format ${(fmt / 1e6).toFixed(1)} MB; TeX Live files read by the body run ${(texlive / 1e6).toFixed(2)} MB`,
  );
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
