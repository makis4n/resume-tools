// Is the per-face cost XeTeX's own font loading, or fontspec's probing around it?
const fs = require("fs");
const path = require("path");
const { makeModule, writeProject, readText, readBytes, PROJECT } = require("./harness.cjs");
const R = process.env.SPIKE_ASSETS ?? path.join(__dirname, "assets");
(async () => {
  const M = await makeModule([
    "texlive-basic",
    "ubuntu-texlive-latex-base",
    "ubuntu-texlive-latex-recommended",
    "ubuntu-texlive-latex-extra",
  ]);
  const files = {};
  for (const f of fs.readdirSync(path.join(R, "fonts", "sourcesans", "OTF")))
    if (f.endsWith(".otf"))
      files[`fonts/${f}`] = fs.readFileSync(path.join(R, "fonts", "sourcesans", "OTF", f));
  for (const f of fs.readdirSync(path.join(R, "fonts", "roboto")))
    files[`fonts/${f}`] = fs.readFileSync(path.join(R, "fonts", "roboto", f));
  writeProject(M, files);
  const common = ["--no-shell-escape", "--interaction=nonstopmode", "--halt-on-error", "--no-pdf"];
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  writeProject(M, {
    "f.tex": `\\RequirePackage[OT1]{fontenc}\\documentclass{article}\\usepackage{xcolor,geometry,hyperref}\\dump\n`,
  });
  let r = M.__run(["xelatex", "-ini", "-jobname=f", ...common, "&xelatex", "f.tex"]);
  console.log(`format: exit ${r.code}`);
  const cases = {
    "cm only": `\\begin{document}Hello x\\end{document}`,
    "raw \\font 1 otf face": `\\begin{document}\\font\\a="[fonts/SourceSans3-Regular.otf]" at 10pt \\a Hello x\\end{document}`,
    "raw \\font 1 otf face + tex-text mapping": `\\begin{document}\\font\\a="[fonts/SourceSans3-Regular.otf]:mapping=tex-text" at 10pt \\a Hello x\\end{document}`,
    "raw \\font 4 otf faces": `\\begin{document}\\font\\a="[fonts/SourceSans3-Regular.otf]" at 10pt \\font\\b="[fonts/SourceSans3-Bold.otf]" at 10pt \\font\\c="[fonts/SourceSans3-It.otf]" at 10pt \\font\\d="[fonts/SourceSans3-Light.otf]" at 10pt \\a Hello \\b b \\c i \\d l\\end{document}`,
    "raw \\font 4 ttf faces": `\\begin{document}\\font\\a="[fonts/Roboto-Regular.ttf]" at 10pt \\font\\b="[fonts/Roboto-Bold.ttf]" at 10pt \\font\\c="[fonts/Roboto-Italic.ttf]" at 10pt \\font\\d="[fonts/Roboto-Light.ttf]" at 10pt \\a Hello \\b b \\c i \\d l\\end{document}`,
    "raw \\font same face twice (cache?)": `\\begin{document}\\font\\a="[fonts/SourceSans3-Regular.otf]" at 10pt \\font\\b="[fonts/SourceSans3-Regular.otf]" at 11pt \\a Hello \\b x\\end{document}`,
    "fontspec, 1 face": `\\usepackage{fontspec}\\setmainfont[Path=fonts/,Extension=.otf]{SourceSans3-Regular}\\begin{document}Hello x\\end{document}`,
    "fontspec loaded, no font used": `\\usepackage{fontspec}\\begin{document}Hello x\\end{document}`,
  };
  for (const [name, tex] of Object.entries(cases)) {
    writeProject(M, { "b.tex": tex });
    const t = [];
    for (let i = 0; i < 3; i++) {
      r = M.__run(["xelatex", ...common, "--fmt", `${PROJECT}/f.fmt`, "b.tex"]);
      t.push(r.ms);
    }
    const xdv = readBytes(M, `${PROJECT}/b.xdv`);
    console.log(
      `${name}: warm median ${med(t.slice(1)).toFixed(0)} ms, exit ${r.code}, xdv ${xdv ? xdv.length : 0}${
        r.code
          ? " " +
            readText(M, `${PROJECT}/b.log`)
              .split("\n")
              .filter((l) => /^!/.test(l))
              .slice(0, 2)
              .join(" | ")
          : ""
      }`,
    );
    if (xdv) M.FS.unlink(`${PROJECT}/b.xdv`);
  }
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
