// Where do XeTeX's seconds go? Each case is compiled 3 times; the median of the warm runs is reported.
const fs = require("fs");
const path = require("path");
const { makeModule, writeProject, readText, readBytes, PROJECT } = require("./harness.cjs");
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
  const fmt = "/texlive/texmf-dist/texmf-var/web2c/xetex/xelatex.fmt";
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const ss = (name) =>
    `\\newfontfamily\\${name}[Path=fonts/,Extension=.otf,UprightFont=SourceSans3-Regular,ItalicFont=SourceSans3-It,BoldFont=SourceSans3-Bold,BoldItalicFont=SourceSans3-BoldIt]{SourceSans3}`;
  const cases = {
    "article only": `\\documentclass{article}\\begin{document}Hello x\\end{document}`,
    "+fontspec": `\\documentclass{article}\\usepackage{fontspec}\\begin{document}Hello x\\end{document}`,
    "+fontspec, 1 family by file (4 faces)": `\\documentclass{article}\\usepackage{fontspec}${ss("ssp")}\\begin{document}{\\ssp Hello x \\textbf{b} \\textit{i}}\\end{document}`,
    "+fontspec, 3 families by file (14 faces)": `\\documentclass{article}\\usepackage{fontspec}${ss("ssp")}\\newfontfamily\\rob[Path=fonts/,Extension=.ttf,UprightFont=Roboto-Regular,ItalicFont=Roboto-Italic,BoldFont=Roboto-Bold,BoldItalicFont=Roboto-BoldItalic,FontFace={l}{n}{Font=Roboto-Light},FontFace={l}{it}{Font=Roboto-LightItalic},FontFace={mb}{n}{Font=Roboto-Medium},FontFace={mb}{it}{Font=Roboto-MediumItalic}]{Roboto}\\newfontfamily\\FAs[Path=fonts/,Extension=.otf]{FontAwesome5Free-Solid-900}\\newfontfamily\\FAb[Path=fonts/,Extension=.otf]{FontAwesome5Brands-Regular-400}\\begin{document}{\\ssp Hello \\textbf{b} \\textit{i}} {\\rob R \\textbf{b} \\textit{i} \\fontseries{l}\\selectfont l} {\\FAs\\symbol{"F015}} {\\FAb\\symbol{"F092}}\\end{document}`,
    "+fontspec, font by NAME (fontconfig)": `\\documentclass{article}\\usepackage{fontspec}\\setmainfont{Latin Modern Roman}\\begin{document}Hello x\\end{document}`,
    "awesome-cv packages, no fonts, no body": `\\documentclass{article}\\usepackage{array,tabularx,enumitem,ragged2e,geometry,fancyhdr,xcolor,ifxetex,xifthen,xstring,etoolbox,setspace,parskip}\\usepackage[hidelinks,unicode]{hyperref}\\usepackage{bookmark}\\begin{document}Hello x\\end{document}`,
  };
  const results = {};
  for (const [name, tex] of Object.entries(cases)) {
    writeProject(M, { "t.tex": tex });
    const t = [];
    let r;
    for (let i = 0; i < 3; i++) {
      r = M.__run(["xelatex", ...common, "--fmt", fmt, "t.tex"]);
      t.push(r.ms);
    }
    const xdv = readBytes(M, `${PROJECT}/t.xdv`);
    results[name] = { ms: med(t.slice(1)), first: t[0], exit: r.code, xdv: xdv ? xdv.length : 0 };
    console.log(
      `${name}: first ${t[0].toFixed(0)} ms, warm median ${med(t.slice(1)).toFixed(0)} ms, exit ${r.code}, xdv ${xdv ? xdv.length : 0}`,
    );
    if (r.code !== 0)
      console.log(
        readText(M, `${PROJECT}/t.log`)
          .split("\n")
          .filter((l) => /^!|not found|cannot|error/i.test(l))
          .slice(0, 5)
          .join("\n"),
      );
    M.FS.unlink(`${PROJECT}/t.xdv`);
  }
  // Can a format be dumped after \usepackage{fontspec} alone?
  writeProject(M, { "d.tex": `\\documentclass{article}\\usepackage{fontspec}\\dump\n` });
  const r = M.__run(["xelatex", "-ini", "-jobname=d", ...common, "&xelatex", "d.tex"]);
  const log = readText(M, `${PROJECT}/d.log`);
  console.log(
    `dump after fontspec only: exit ${r.code}; ${log
      .split("\n")
      .filter((l) => /^!|Can't|dump/i.test(l))
      .slice(0, 3)
      .join(" | ")}`,
  );
  // and after fontspec with the default font replaced by a TFM font? (fontspec always loads lmroman via native font)
  writeProject(M, {
    "e.tex": `\\documentclass{article}\\usepackage{xcolor,geometry,hyperref}\\dump\n`,
  });
  const r2 = M.__run(["xelatex", "-ini", "-jobname=e", ...common, "&xelatex", "e.tex"]);
  console.log(
    `dump with xcolor+geometry+hyperref, no fontspec: exit ${r2.code} fmt ${(readBytes(M, `${PROJECT}/e.fmt`) || []).length} bytes; ${readText(
      M,
      `${PROJECT}/e.log`,
    )
      .split("\n")
      .filter((l) => /^!|Can't/i.test(l))
      .slice(0, 2)
      .join(" | ")}`,
  );
  if (r2.code === 0) {
    writeProject(M, {
      "eb.tex": `\\usepackage{fontspec}${ss("ssp")}\\begin{document}{\\ssp Hello x}\\end{document}`,
    });
    const t = [];
    let rr;
    for (let i = 0; i < 3; i++) {
      rr = M.__run(["xelatex", ...common, "--fmt", `${PROJECT}/e.fmt`, "eb.tex"]);
      t.push(rr.ms);
    }
    console.log(
      `body from that format + fontspec + 1 family: first ${t[0].toFixed(0)} ms, warm median ${med(t.slice(1)).toFixed(0)} ms, exit ${rr.code}`,
    );
    if (rr.code !== 0)
      console.log(
        readText(M, `${PROJECT}/eb.log`)
          .split("\n")
          .filter((l) => /^!|not found|error/i.test(l))
          .slice(0, 5)
          .join("\n"),
      );
  }
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
