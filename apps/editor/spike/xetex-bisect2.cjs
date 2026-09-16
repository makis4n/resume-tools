// Can a XeTeX format be dumped if the preamble never touches a native font? Then what does the body cost?
const fs = require("fs");
const path = require("path");
const { makeModule, writeProject, readText, readBytes, PROJECT } = require("./harness.cjs");
const OUT =
  process.env.SPIKE_OUT ??
  path.join(process.env.SPIKE_ASSETS ?? path.join(__dirname, "assets"), "out");
fs.mkdirSync(OUT, { recursive: true });
const R = process.env.SPIKE_ASSETS ?? path.join(__dirname, "assets");
const FONTS = path.join(R, "fonts");
(async () => {
  const M = await makeModule([
    "texlive-basic",
    "ubuntu-texlive-latex-base",
    "ubuntu-texlive-latex-recommended",
    "ubuntu-texlive-latex-extra",
    "ubuntu-texlive-fonts-recommended",
  ]);
  const files = {};
  for (const [dir, glob] of [
    ["roboto", /\.ttf$/],
    ["fa5", /\.otf$/],
    ["sourcesans/OTF", /\.otf$/],
  ])
    for (const f of fs.readdirSync(path.join(FONTS, dir)))
      if (glob.test(f)) files[`fonts/${f}`] = fs.readFileSync(path.join(FONTS, dir, f));
  writeProject(M, files);
  const common = ["--no-shell-escape", "--interaction=nonstopmode", "--halt-on-error", "--no-pdf"];
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const errs = (log) =>
    log
      .split("\n")
      .filter((l) => /^!|Can't|not found/i.test(l))
      .slice(0, 3)
      .join(" | ");
  const ss = `\\setmainfont[Path=fonts/,Extension=.otf,UprightFont=SourceSans3-Regular,ItalicFont=SourceSans3-It,BoldFont=SourceSans3-Bold,BoldItalicFont=SourceSans3-BoldIt]{SourceSans3}`;
  const pkgs = `\\usepackage{array,tabularx,enumitem,ragged2e,geometry,fancyhdr,xcolor,ifxetex,xifthen,xstring,etoolbox,setspace,parskip}\\usepackage[hidelinks,unicode]{hyperref}\\usepackage{bookmark}`;
  const dumps = {
    "OT1 fontenc first, article, packages": `\\RequirePackage[OT1]{fontenc}\\documentclass{article}${pkgs}\\dump\n`,
    "OT1 fontenc first, article, packages, fontspec": `\\RequirePackage[OT1]{fontenc}\\documentclass{article}${pkgs}\\usepackage{fontspec}\\dump\n`,
  };
  for (const [name, tex] of Object.entries(dumps)) {
    writeProject(M, { "f.tex": tex });
    const r = M.__run(["xelatex", "-ini", "-jobname=f", ...common, "&xelatex", "f.tex"]);
    const fmt = readBytes(M, `${PROJECT}/f.fmt`);
    console.log(
      `dump [${name}]: exit ${r.code} ${r.ms.toFixed(0)} ms fmt ${fmt ? fmt.length : 0} bytes ${errs(readText(M, `${PROJECT}/f.log`))}`,
    );
    if (r.code !== 0) continue;
    const bodies = {
      "body: fontspec + 1 family (4 faces)": `\\usepackage{fontspec}${ss}\\begin{document}Hello x \\textbf{b} \\textit{i}\\end{document}`,
      "body: fontspec + 1 family, 1 face": `\\usepackage{fontspec}\\setmainfont[Path=fonts/,Extension=.otf]{SourceSans3-Regular}\\begin{document}Hello x\\end{document}`,
      "body: no fontspec (OT1 cm fonts)": `\\begin{document}Hello x \\textbf{b} \\textit{i}\\end{document}`,
    };
    for (const [bn, btex] of Object.entries(bodies)) {
      if (name.includes("fontspec") && bn.includes("no fontspec")) continue;
      writeProject(M, {
        "b.tex": btex.replace(name.includes("fontspec") ? "\\usepackage{fontspec}" : "", ""),
      });
      const t = [];
      let rr;
      for (let i = 0; i < 3; i++) {
        rr = M.__run(["xelatex", ...common, "--fmt", `${PROJECT}/f.fmt`, "b.tex"]);
        t.push(rr.ms);
      }
      const xdv = readBytes(M, `${PROJECT}/b.xdv`);
      console.log(
        `   ${bn}: first ${t[0].toFixed(0)} ms, warm median ${med(t.slice(1)).toFixed(0)} ms, exit ${rr.code}, xdv ${xdv ? xdv.length : 0} ${rr.code ? errs(readText(M, `${PROJECT}/b.log`)) : ""}`,
      );
      if (xdv && bn.includes("1 face")) fs.writeFileSync(path.join(OUT, "hello.xdv"), xdv);
      if (xdv) M.FS.unlink(`${PROJECT}/b.xdv`);
    }
  }
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
