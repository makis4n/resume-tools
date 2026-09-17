// What unicode-math costs per compile on the XeTeX loop, now that a math font is at hand.
// Awesome-CV loads it only for a bullet and a centred dot in text; this measures both the
// package kept in the body (it cannot live in the format: it loads fontspec and a native font)
// and the importer's replacement, the symbols taken from the math font as a plain NFSS family.
// Usage: node spike/unicode-math.cjs [math font file in assets/fonts/, default latinmodern-math.otf]
const fs = require("fs");
const path = require("path");
const { makeModule, writeProject, readText, readBytes, PROJECT } = require("./harness.cjs");
const R = process.env.SPIKE_ASSETS ?? path.join(__dirname, "assets");
const FONTS = path.join(R, "fonts");
const MATH = process.argv[2] ?? "latinmodern-math.otf";

// The shims from xetex-loop.cjs, reduced to the faces this measurement touches.
const MAP = ":mapping=tex-text";
const family = (name, faces, map = MAP) =>
  [
    `\\DeclareFontFamily{TU}{${name}}{}`,
    ...faces.map(([series, shape, file, features = ""]) =>
      file.startsWith("ssub")
        ? `\\DeclareFontShape{TU}{${name}}{${series}}{${shape}}{<->${file}}{}`
        : `\\DeclareFontShape{TU}{${name}}{${series}}{${shape}}{<->"[fonts/${file}]${map}${features}"}{}`,
    ),
  ].join("\n");
const shims = [
  family("Roboto", [
    ["m", "n", "Roboto-Regular.ttf"],
    ["m", "it", "Roboto-Italic.ttf"],
    ["b", "n", "Roboto-Bold.ttf"],
    ["bx", "n", "ssub*Roboto/b/n"],
    ["l", "n", "Roboto-Light.ttf"],
  ]),
  family("SourceSans3", [
    ["m", "n", "SourceSans3-Regular.otf"],
    ["m", "it", "SourceSans3-It.otf"],
    ["m", "sc", "SourceSans3-Regular.otf", ";+smcp"],
    ["b", "n", "SourceSans3-Bold.otf"],
    ["bx", "n", "ssub*SourceSans3/b/n"],
    ["l", "n", "SourceSans3-Light.otf"],
    ["l", "it", "SourceSans3-LightIt.otf"],
  ]),
  String.raw`\renewcommand*\encodingdefault{TU}\renewcommand*\rmdefault{SourceSans3}\renewcommand*\sfdefault{SourceSans3}`,
].join("\n");
// The importer's replacement: the math font as an ordinary family, its symbols by code point.
const symbolFamily = `${family("LMMath", [["m", "n", MATH]], "")}
\\newcommand*\\mathsym[1]{{\\fontencoding{TU}\\fontfamily{LMMath}\\selectfont\\symbol{#1}}}`;

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
    ["sourcesans/OTF", /\.otf$/],
  ])
    for (const f of fs.readdirSync(path.join(FONTS, dir)))
      if (glob.test(f)) files[`fonts/${f}`] = fs.readFileSync(path.join(FONTS, dir, f));
  files[`fonts/${MATH}`] = fs.readFileSync(path.join(FONTS, MATH));
  writeProject(M, files);
  const common = ["--no-shell-escape", "--interaction=nonstopmode", "--halt-on-error", "--no-pdf"];
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const issues = (log) =>
    log
      .split("\n")
      .filter((l) => /^!|Can't|not found|Missing|undefined/i.test(l))
      .slice(0, 6)
      .join(" | ");

  // The format: OT1 first, article and the packages Awesome-CV uses, no fontspec.
  const pkgs = String.raw`\usepackage{array,tabularx,enumitem,ragged2e,geometry,fancyhdr,xcolor,etoolbox,setspace,parskip}\usepackage[hidelinks,unicode]{hyperref}\usepackage{bookmark}`;
  writeProject(M, {
    "f.tex": `\\RequirePackage[OT1]{fontenc}\\documentclass[11pt]{article}${pkgs}${shims}\\dump\n`,
  });
  let r = M.__run(["xelatex", "-ini", "-jobname=f", ...common, "&xelatex", "f.tex"]);
  console.log(
    `format: exit ${r.code} ${r.ms.toFixed(0)} ms ${issues(readText(M, `${PROJECT}/f.log`))}`,
  );
  if (r.code !== 0) process.exit(1);

  // Can unicode-math be dumped? Shown once, for the record.
  writeProject(M, {
    "g.tex": `\\RequirePackage[OT1]{fontenc}\\documentclass[11pt]{article}${pkgs}\\usepackage{unicode-math}\\setmathfont{${MATH}}[Path=fonts/]\\dump\n`,
  });
  r = M.__run(["xelatex", "-ini", "-jobname=g", ...common, "&xelatex", "g.tex"]);
  console.log(
    `format with unicode-math: exit ${r.code} ${issues(readText(M, `${PROJECT}/g.log`))}`,
  );

  // A page's worth of text with the two symbols the class needs, forty times each.
  const items = Array.from(
    { length: 40 },
    (_, i) => `\\item Item ${i} of the resume, cutting turnaround from days to minutes.`,
  ).join("\n");
  const textBody = (bullet, dot) =>
    `\\begin{document}\\section*{Experience}Engineer ${dot} Remote ${dot} 2020\\begin{itemize}\\renewcommand{\\labelitemi}{${bullet}}${items}\\end{itemize}\\end{document}`;
  const cases = {
    "loop body, text symbols (\\textbullet, \\textperiodcentered)": textBody(
      "\\textbullet",
      "\\textperiodcentered",
    ),
    "loop body, symbols from the math font as a family (\\symbol)": `${symbolFamily}${textBody('\\mathsym{"2022}', '\\mathsym{"22C5}')}`,
    "fontspec loaded, nothing else": `\\usepackage{fontspec}${textBody("\\textbullet", "\\textperiodcentered")}`,
    "unicode-math, default font by name (as the class does)": `\\usepackage{unicode-math}${textBody("$\\bullet$", "$\\cdot$")}`,
    "unicode-math, \\setmathfont by file": `\\usepackage{unicode-math}\\setmathfont{${MATH}}[Path=fonts/]${textBody("$\\bullet$", "$\\cdot$")}`,
    "unicode-math, \\setmathfont, one display formula": `\\usepackage{unicode-math}\\setmathfont{${MATH}}[Path=fonts/]${textBody("$\\bullet$", "$\\cdot$").replace("\\end{itemize}", "\\end{itemize}\\[\\int_0^1 \\frac{x^2}{\\sqrt{1+x}}\\,dx = \\sum_{n} \\alpha_n\\]")}`,
  };
  for (const [name, tex] of Object.entries(cases)) {
    writeProject(M, { "b.tex": tex });
    const t = [];
    for (let i = 0; i < 4; i++) {
      r = M.__run(["xelatex", ...common, "--fmt", `${PROJECT}/f.fmt`, "b.tex"]);
      t.push(r.ms);
      if (r.code !== 0) break;
    }
    const log = readText(M, `${PROJECT}/b.log`);
    const fontsLoaded = (log.match(/\\font\\/g) ?? []).length;
    console.log(
      `${name}: ${r.code === 0 ? `first ${t[0].toFixed(0)} ms, warm median ${med(t.slice(1)).toFixed(0)} ms` : `FAILED ${issues(log)}`}${fontsLoaded ? ` (${fontsLoaded} \\font lines in the log)` : ""}`,
    );
    if (r.code !== 0) console.log(log.slice(-800));
    if (M.FS.analyzePath(`${PROJECT}/b.xdv`).exists) M.FS.unlink(`${PROJECT}/b.xdv`);
  }
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
