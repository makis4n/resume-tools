// Awesome-CV on XeTeX: plain compile, then a format with native fonts loaded, then a format without them.
const fs = require("fs");
const path = require("path");
const { makeModule, writeProject, readText, readBytes, PROJECT } = require("./harness.cjs");
const OUT =
  process.env.SPIKE_OUT ??
  path.join(process.env.SPIKE_ASSETS ?? path.join(__dirname, "assets"), "out");
fs.mkdirSync(OUT, { recursive: true });

const R = process.env.SPIKE_ASSETS ?? path.join(__dirname, "assets");
const FONTS = path.join(R, "fonts");

// Shims for the three TeX Live packages the class expects; fonts are loaded by file name from fonts/.
const roboto = String.raw`\ProvidesPackage{roboto}
\RequirePackage{fontspec}
\newfontfamily\roboto[Path=fonts/,Extension=.ttf,UprightFont=Roboto-Regular,ItalicFont=Roboto-Italic,
  BoldFont=Roboto-Bold,BoldItalicFont=Roboto-BoldItalic,
  FontFace={l}{n}{Font=Roboto-Light},FontFace={l}{it}{Font=Roboto-LightItalic},
  FontFace={mb}{n}{Font=Roboto-Medium},FontFace={mb}{it}{Font=Roboto-MediumItalic}]{Roboto}
\newcommand*\robotolight{\roboto\fontseries{l}\selectfont}
`;
const ssFeatures = String.raw`Path=fonts/,Extension=.otf,UprightFont=SourceSans3-Regular,ItalicFont=SourceSans3-It,
  BoldFont=SourceSans3-Bold,BoldItalicFont=SourceSans3-BoldIt,
  FontFace={l}{n}{Font=SourceSans3-Light},FontFace={l}{it}{Font=SourceSans3-LightIt},
  FontFace={sb}{n}{Font=SourceSans3-Semibold},FontFace={sb}{it}{Font=SourceSans3-SemiboldIt}`;
const sourcesanspro = String.raw`\ProvidesPackage{sourcesanspro}
\RequirePackage{fontspec}
\DeclareOption{default}{}\DeclareOption{opentype}{}\ProcessOptions\relax
\setmainfont[${ssFeatures}]{SourceSans3}
\setsansfont[${ssFeatures}]{SourceSans3}
\newfontfamily\sourcesanspro[${ssFeatures}]{SourceSans3}
\newcommand*\sourcesansprolight{\sourcesanspro\fontseries{l}\selectfont}
`;
const solid = {
  faMobile: "F10B",
  faEnvelope: "F0E0",
  faHome: "F015",
  faGraduationCap: "F19D",
  faBirthdayCake: "F1FD",
};
const brands = {
  faGithubSquare: "F092",
  faLinkedin: "F08C",
  faStackOverflow: "F16C",
  faGitlab: "F296",
  faTwitter: "F099",
  faSkype: "F17E",
  faReddit: "F1A1",
  faMedium: "F23A",
  faKaggle: "F5FA",
  faHackerrank: "F5F7",
  faBitbucket: "F171",
  faXingSquare: "F169",
  faTelegram: "F2C6",
  faResearchgate: "F4F8",
  faOrcid: "F8D2",
  faMastodon: "F4F6",
};
const fontawesome5 =
  String.raw`\ProvidesPackage{fontawesome5}
\RequirePackage{fontspec}
\newfontfamily\FAsolid[Path=fonts/,Extension=.otf]{FontAwesome5Free-Solid-900}
\newfontfamily\FAbrands[Path=fonts/,Extension=.otf]{FontAwesome5Brands-Regular-400}
` +
  Object.entries(solid)
    .map(([m, c]) => `\\newcommand*{\\${m}}{{\\FAsolid\\symbol{"${c}}}}`)
    .join("\n") +
  "\n" +
  Object.entries(brands)
    .map(([m, c]) => `\\newcommand*{\\${m}}{{\\FAbrands\\symbol{"${c}}}}`)
    .join("\n") +
  "\n";

(async () => {
  const M = await makeModule([
    "texlive-basic",
    "ubuntu-texlive-latex-base",
    "ubuntu-texlive-latex-recommended",
    "ubuntu-texlive-latex-extra",
    "ubuntu-texlive-fonts-recommended",
  ]);
  const { FS } = M;
  const has = (p) => FS.analyzePath(p).exists;
  const lmmath = "/texlive/texmf-dist/fonts/opentype/public/lm-math/latinmodern-math.otf";
  console.log(
    `init ${M.__initMs.toFixed(0)} ms; xelatex.fmt ${has("/texlive/texmf-dist/texmf-var/web2c/xetex/xelatex.fmt")}; latinmodern-math ${has(lmmath)}; /texlive/fonts.conf ${has("/texlive/fonts.conf")}; /etc/fonts ${has("/etc/fonts") ? FS.readdir("/etc/fonts").join(",") : "-"}`,
  );

  let cls = fs.readFileSync(
    path.join(R, "templates", "awesome-cv", "fa5", "awesome-cv.cls"),
    "utf8",
  );
  cls = cls.replace(
    /^\\RequirePackage\[skins\]\{tcolorbox\}\s*$/m,
    "% tcolorbox dropped for the spike: needs pgf, which the bundles lack; only used by \\photo",
  );
  if (!has(lmmath)) {
    cls = cls.replace(
      /^\\RequirePackage\{unicode-math\}\s*$/m,
      "% unicode-math dropped: latinmodern-math.otf not in the bundles",
    );
    // unicode-math makes math symbols usable in text; without it the class's list bullet must be a text symbol
    cls = cls.replace(/\\labelitemi\}\{\\bullet\}/g, "\\labelitemi}{\\textbullet}");
  }
  const files = {
    "awesome-cv.cls": cls,
    "roboto.sty": roboto,
    "sourcesanspro.sty": sourcesanspro,
    "fontawesome5.sty": fontawesome5,
  };
  files["resume.tex"] = fs
    .readFileSync(path.join(R, "templates", "awesome-cv", "examples", "resume.tex"), "utf8")
    .replace(/\\cdotp/g, "{$\\cdot$}"); // math-only symbol used in text by the example
  for (const f of fs.readdirSync(path.join(R, "templates", "awesome-cv", "examples", "resume")))
    files[`resume/${f}`] = fs
      .readFileSync(path.join(R, "templates", "awesome-cv", "examples", "resume", f), "utf8")
      .replace(/\\cdotp/g, "{$\\cdot$}");
  for (const [dir, glob] of [
    ["roboto", /\.ttf$/],
    ["fa5", /\.otf$/],
    ["sourcesans/OTF", /\.otf$/],
  ])
    for (const f of fs.readdirSync(path.join(FONTS, dir)))
      if (glob.test(f)) files[`fonts/${f}`] = fs.readFileSync(path.join(FONTS, dir, f));
  writeProject(M, files);

  const common = ["--no-shell-escape", "--interaction=nonstopmode", "--halt-on-error", "--no-pdf"];
  const stockFmt = "/texlive/texmf-dist/texmf-var/web2c/xetex/xelatex.fmt";
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const issues = (log) =>
    log
      .split("\n")
      .filter((l) => /^!|Warning|Error|Output written|Missing|not found|cannot|fontspec/i.test(l))
      .slice(0, 14)
      .join("\n");

  // 1. plain compile with the stock xelatex format
  const plain = [];
  for (let i = 0; i < 6; i++) {
    const r = M.__run(["xelatex", ...common, "--fmt", stockFmt, "resume.tex"]);
    const xdv = readBytes(M, `${PROJECT}/resume.xdv`);
    plain.push(r.ms);
    console.log(
      `plain run ${i + 1}: exit ${r.code} ${r.ms.toFixed(0)} ms xdv ${xdv ? xdv.length : 0} bytes`,
    );
    if (r.code !== 0 || !xdv) {
      console.log(r.out.slice(-1500));
      console.log("--- log ---");
      console.log(issues(readText(M, `${PROJECT}/resume.log`)));
      console.log(readText(M, `${PROJECT}/resume.log`).slice(-1800));
      process.exit(1);
    }
    if (i === 0) fs.writeFileSync(path.join(OUT, "acv-plain.xdv"), xdv);
  }
  console.log(issues(readText(M, `${PROJECT}/resume.log`)));

  // 2. format WITH native fonts loaded (class loads them at \documentclass time)
  const tex = files["resume.tex"];
  const cut = tex.indexOf("\\begin{document}");
  writeProject(M, {
    "acv-pre.tex": `${tex.slice(0, cut)}\n\\dump\n`,
    "acv-body.tex": tex.slice(cut),
  });
  let r = M.__run(["xelatex", "-ini", "-jobname=acv-pre", ...common, "&xelatex", "acv-pre.tex"]);
  let fmt = readBytes(M, `${PROJECT}/acv-pre.fmt`);
  console.log(
    `dump with fonts: exit ${r.code} ${r.ms.toFixed(0)} ms fmt ${fmt ? fmt.length : 0} bytes`,
  );
  const preLog = readText(M, `${PROJECT}/acv-pre.log`);
  console.log(
    preLog
      .split("\n")
      .filter((l) => /^!|dump|font/i.test(l))
      .slice(-8)
      .join("\n"),
  );
  let withFonts = null;
  if (fmt) {
    const t = [];
    for (let i = 0; i < 6; i++) {
      r = M.__run(["xelatex", ...common, "--fmt", `${PROJECT}/acv-pre.fmt`, "acv-body.tex"]);
      const xdv = readBytes(M, `${PROJECT}/acv-body.xdv`);
      t.push(r.ms);
      console.log(
        `body(fonts in fmt) run ${i + 1}: exit ${r.code} ${r.ms.toFixed(0)} ms xdv ${xdv ? xdv.length : 0} bytes`,
      );
      if (r.code !== 0 || !xdv) {
        console.log(issues(readText(M, `${PROJECT}/acv-body.log`)));
        console.log(readText(M, `${PROJECT}/acv-body.log`).slice(-1500));
        break;
      }
      if (i === 0) fs.writeFileSync(path.join(OUT, "acv-fmt.xdv"), xdv);
    }
    if (t.length === 6) withFonts = med(t.slice(1));
    console.log(issues(readText(M, `${PROJECT}/acv-body.log`)));
  }

  // 3. format WITHOUT fonts: strip the three font packages from the class, load them in the body instead
  const clsNoFonts = cls
    .replace(/^\\RequirePackage\{fontawesome5\}\s*$/m, "")
    .replace(/^\\RequirePackage\{roboto\}\s*$/m, "")
    .replace(/^\\RequirePackage\[default,opentype\]\{sourcesanspro\}\s*$/m, "");
  writeProject(M, {
    "awesome-cv.cls": clsNoFonts,
    "acv-pre2.tex": `${tex.slice(0, cut)}\n\\dump\n`,
    "acv-body2.tex": `\\usepackage{fontawesome5}\\usepackage{roboto}\\usepackage[default,opentype]{sourcesanspro}\n${tex.slice(cut)}`,
  });
  r = M.__run(["xelatex", "-ini", "-jobname=acv-pre2", ...common, "&xelatex", "acv-pre2.tex"]);
  fmt = readBytes(M, `${PROJECT}/acv-pre2.fmt`);
  console.log(
    `dump without fonts: exit ${r.code} ${r.ms.toFixed(0)} ms fmt ${fmt ? fmt.length : 0} bytes`,
  );
  let noFonts = null;
  if (fmt) {
    const t = [];
    for (let i = 0; i < 6; i++) {
      r = M.__run(["xelatex", ...common, "--fmt", `${PROJECT}/acv-pre2.fmt`, "acv-body2.tex"]);
      const xdv = readBytes(M, `${PROJECT}/acv-body2.xdv`);
      t.push(r.ms);
      console.log(
        `body(fonts per compile) run ${i + 1}: exit ${r.code} ${r.ms.toFixed(0)} ms xdv ${xdv ? xdv.length : 0} bytes`,
      );
      if (r.code !== 0 || !xdv) {
        console.log(issues(readText(M, `${PROJECT}/acv-body2.log`)));
        console.log(readText(M, `${PROJECT}/acv-body2.log`).slice(-1500));
        break;
      }
    }
    if (t.length === 6) noFonts = med(t.slice(1));
  } else {
    console.log(readText(M, `${PROJECT}/acv-pre2.log`).slice(-1200));
  }

  // 4. PDF from the XDV, for the download path
  r = M.__run(["xdvipdfmx", "-o", "resume.pdf", "resume.xdv"]);
  const pdf = readBytes(M, `${PROJECT}/resume.pdf`);
  console.log(`xdvipdfmx: exit ${r.code} ${r.ms.toFixed(0)} ms pdf ${pdf ? pdf.length : 0} bytes`);
  if (pdf) fs.writeFileSync(path.join(OUT, "acv.pdf"), pdf);
  else console.log(r.out.slice(-800));

  console.log(
    `SUMMARY xetex: plain median ${med(plain.slice(1)).toFixed(0)} ms; fonts-in-format ${withFonts === null ? "n/a" : withFonts.toFixed(0) + " ms"}; fonts-per-compile ${noFonts === null ? "n/a" : noFonts.toFixed(0) + " ms"}`,
  );
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
