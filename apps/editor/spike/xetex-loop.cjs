// The XeTeX loop the decision record proposes, run for real on Awesome-CV: a format dumped from
// a preamble that never loads a native font, then the body compiled per edit with the fonts
// declared through NFSS declarations that name the font files, no fontspec at compile time.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { makeModule, writeProject, readText, readBytes, PROJECT } = require("./harness.cjs");
const OUT =
  process.env.SPIKE_OUT ??
  path.join(process.env.SPIKE_ASSETS ?? path.join(__dirname, "assets"), "out");
fs.mkdirSync(OUT, { recursive: true });

const R = process.env.SPIKE_ASSETS ?? path.join(__dirname, "assets");
const FONTS = path.join(R, "fonts");

// --- font shims: what a template package would carry instead of roboto/sourcesanspro/fontawesome5
const MAP = ":mapping=tex-text"; // what fontspec's Ligatures=TeX does: -- --- `` '' become one glyph
const family = (name, faces, map = MAP) =>
  [
    `\\DeclareFontFamily{TU}{${name}}{}`,
    ...faces.map(([series, shape, file, features = ""]) =>
      file.startsWith("ssub")
        ? `\\DeclareFontShape{TU}{${name}}{${series}}{${shape}}{<->${file}}{}`
        : `\\DeclareFontShape{TU}{${name}}{${series}}{${shape}}{<->"[fonts/${file}]${map}${features}"}{}`,
    ),
  ].join("\n");
// Series names the class uses: m, b (via \bfseries), l (\robotolight, \sourcesansprolight);
// mb and sb mirror the fontspec shim in acv.cjs. Slanted substitutes italic, as fontspec does.
const robotoFaces = [
  ["m", "n", "Roboto-Regular.ttf"],
  ["m", "it", "Roboto-Italic.ttf"],
  ["m", "sl", "ssub*Roboto/m/it"],
  ["b", "n", "Roboto-Bold.ttf"],
  ["b", "it", "Roboto-BoldItalic.ttf"],
  ["b", "sl", "ssub*Roboto/b/it"],
  ["bx", "n", "ssub*Roboto/b/n"],
  ["bx", "it", "ssub*Roboto/b/it"],
  ["l", "n", "Roboto-Light.ttf"],
  ["l", "it", "Roboto-LightItalic.ttf"],
  ["l", "sl", "ssub*Roboto/l/it"],
  ["mb", "n", "Roboto-Medium.ttf"],
  ["mb", "it", "Roboto-MediumItalic.ttf"],
];
const ssFaces = [
  ["m", "n", "SourceSans3-Regular.otf"],
  ["m", "it", "SourceSans3-It.otf"],
  ["m", "sl", "ssub*SourceSans3/m/it"],
  ["m", "sc", "SourceSans3-Regular.otf", ";+smcp"],
  ["b", "n", "SourceSans3-Bold.otf"],
  ["b", "it", "SourceSans3-BoldIt.otf"],
  ["b", "sl", "ssub*SourceSans3/b/it"],
  ["b", "sc", "SourceSans3-Bold.otf", ";+smcp"],
  ["bx", "n", "ssub*SourceSans3/b/n"],
  ["bx", "it", "ssub*SourceSans3/b/it"],
  ["bx", "sc", "ssub*SourceSans3/b/sc"],
  ["l", "n", "SourceSans3-Light.otf"],
  ["l", "it", "SourceSans3-LightIt.otf"],
  ["l", "sl", "ssub*SourceSans3/l/it"],
  ["l", "sc", "SourceSans3-Light.otf", ";+smcp"],
  ["sb", "n", "SourceSans3-Semibold.otf"],
  ["sb", "it", "SourceSans3-SemiboldIt.otf"],
];
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
// The icon fonts are NFSS families rather than a fixed-size raw \font so they follow \fontsize,
// which the class sets to 6.8pt in the header line.
const shims = (map = MAP) =>
  [
    family("Roboto", robotoFaces, map),
    family("SourceSans3", ssFaces, map),
    family("FA5solid", [["m", "n", "FontAwesome5Free-Solid-900.otf"]], ""),
    family("FA5brands", [["m", "n", "FontAwesome5Brands-Regular-400.otf"]], ""),
    String.raw`\newcommand*\roboto{\fontencoding{TU}\fontfamily{Roboto}\selectfont}
\newcommand*\robotolight{\roboto\fontseries{l}\selectfont}
\newcommand*\sourcesanspro{\fontencoding{TU}\fontfamily{SourceSans3}\selectfont}
\newcommand*\sourcesansprolight{\sourcesanspro\fontseries{l}\selectfont}
\newcommand*\FAsolid{\fontencoding{TU}\fontfamily{FA5solid}\selectfont}
\newcommand*\FAbrands{\fontencoding{TU}\fontfamily{FA5brands}\selectfont}`,
    ...Object.entries(solid).map(([m, c]) => `\\newcommand*{\\${m}}{{\\FAsolid\\symbol{"${c}}}}`),
    ...Object.entries(brands).map(([m, c]) => `\\newcommand*{\\${m}}{{\\FAbrands\\symbol{"${c}}}}`),
    // What sourcesanspro's [default] option does: the body font is the document default.
    String.raw`\renewcommand*\encodingdefault{TU}
\renewcommand*\rmdefault{SourceSans3}
\renewcommand*\sfdefault{SourceSans3}`,
  ].join("\n");

(async () => {
  const M = await makeModule([
    "texlive-basic",
    "ubuntu-texlive-latex-base",
    "ubuntu-texlive-latex-recommended",
    "ubuntu-texlive-latex-extra",
    "ubuntu-texlive-fonts-recommended",
  ]);
  console.log(`init ${M.__initMs.toFixed(0)} ms`);

  // --- the class, with acv.cjs's patches, then the three font packages and fontspec stripped
  let cls = fs.readFileSync(
    path.join(R, "templates", "awesome-cv", "fa5", "awesome-cv.cls"),
    "utf8",
  );
  cls = cls
    .replace(
      /^\\RequirePackage\[skins\]\{tcolorbox\}\s*$/m,
      "% tcolorbox dropped for the spike: needs pgf, which the bundles lack; only used by \\photo",
    )
    .replace(
      /^\\RequirePackage\{unicode-math\}\s*$/m,
      "% unicode-math dropped: latinmodern-math.otf not in the bundles",
    )
    .replace(/\\labelitemi\}\{\\bullet\}/g, "\\labelitemi}{\\textbullet}")
    .replace(/^\\RequirePackage\{fontawesome5\}\s*$/m, "% fontawesome5 shimmed in the body")
    .replace(/^\\RequirePackage\{roboto\}\s*$/m, "% roboto shimmed in the body")
    .replace(
      /^\\RequirePackage\[default,opentype\]\{sourcesanspro\}\s*$/m,
      "% sourcesanspro shimmed in the body",
    );
  // fontspec has to go too: loading it runs \RequirePackage[TU]{fontenc}, which selects Latin
  // Modern at the class's size and the format cannot be dumped (measured below).
  const clsNoFontspec = cls
    .replace(
      /^\\RequirePackage\[quiet\]\{fontspec\}\s*$/m,
      "% fontspec dropped: see xetex-loop.cjs",
    )
    .replace(
      /^\\defaultfontfeatures\{Ligatures=TeX\}\s*$/m,
      "% (fontspec) mapping=tex-text in shims",
    );

  const fix = (s) => s.replace(/\\cdotp/g, "{$\\cdot$}"); // math-only symbol used in text
  const tex = fix(
    fs.readFileSync(path.join(R, "templates", "awesome-cv", "examples", "resume.tex"), "utf8"),
  );
  const files = { "awesome-cv.cls": clsNoFontspec };
  for (const f of fs.readdirSync(path.join(R, "templates", "awesome-cv", "examples", "resume")))
    files[`resume/${f}`] = fix(
      fs.readFileSync(path.join(R, "templates", "awesome-cv", "examples", "resume", f), "utf8"),
    );
  for (const [dir, glob] of [
    ["roboto", /\.ttf$/],
    ["fa5", /\.otf$/],
    ["sourcesans/OTF", /\.otf$/],
  ])
    for (const f of fs.readdirSync(path.join(FONTS, dir)))
      if (glob.test(f)) files[`fonts/${f}`] = fs.readFileSync(path.join(FONTS, dir, f));
  writeProject(M, files);

  // Split the example: template configuration goes into the format, the personal fields
  // (\name ... \quote) stay in the body since they are what the user edits.
  const cut = tex.indexOf("\\begin{document}");
  const head = tex.slice(0, cut);
  const firstField = head.indexOf("\\name{");
  const config = head.slice(0, firstField);
  const fields = head.slice(firstField);
  const document = tex.slice(cut);

  const common = ["--no-shell-escape", "--interaction=nonstopmode", "--halt-on-error", "--no-pdf"];
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const issues = (log) =>
    log
      .split("\n")
      .filter((l) => /^!|Warning|Error|Missing|not found|undefined|Can't/i.test(l))
      .slice(0, 12)
      .join("\n");
  const dump = (name, pre) => {
    writeProject(M, { [`${name}.tex`]: pre });
    const r = M.__run([
      "xelatex",
      "-ini",
      `-jobname=${name}`,
      ...common,
      "&xelatex",
      `${name}.tex`,
    ]);
    const fmt = readBytes(M, `${PROJECT}/${name}.fmt`);
    const log = readText(M, `${PROJECT}/${name}.log`);
    console.log(
      `dump ${name}: exit ${r.code} ${r.ms.toFixed(0)} ms fmt ${fmt ? fmt.length : 0} bytes`,
    );
    const fontLines = log.split("\n").filter((l) => /^\\font\\TU|Can't|^!/.test(l));
    if (fontLines.length) console.log(`  ${fontLines.join("\n  ")}`);
    return r.code === 0 && fmt ? fmt : null;
  };
  const compile = (fmt, name, body, runs) => {
    writeProject(M, { [`${name}.tex`]: body });
    const t = [];
    let r;
    for (let i = 0; i < runs; i++) {
      r = M.__run(["xelatex", ...common, "--fmt", `${PROJECT}/${fmt}.fmt`, `${name}.tex`]);
      t.push(r.ms);
      if (r.code !== 0) break;
    }
    const log = readText(M, `${PROJECT}/${name}.log`);
    const xdv = readBytes(M, `${PROJECT}/${name}.xdv`);
    return { code: r.code, t, log, xdv, out: r.out };
  };

  // --- 1. the format. First show that keeping fontspec in the class does not dump.
  writeProject(M, { "awesome-cv.cls": cls });
  dump("acv-loop-fontspec", `\\RequirePackage[OT1]{fontenc}${config}\\dump\n`);
  writeProject(M, { "awesome-cv.cls": clsNoFontspec });
  const fmtA = dump("acv-loop-pre", `\\RequirePackage[OT1]{fontenc}${config}\\dump\n`);
  if (!fmtA) {
    console.log(readText(M, `${PROJECT}/acv-loop-pre.log`).slice(-1500));
    process.exit(1);
  }
  fs.writeFileSync(path.join(OUT, "acv-loop-pre.fmt"), fmtA);

  // --- 2. the body loop: shims + fields + document, six runs
  const body = `${shims()}\n${fields}${document}`;
  const loop = compile("acv-loop-pre", "acv-loop-body", body, 6);
  loop.t.forEach((ms, i) =>
    console.log(`body run ${i + 1}: ${ms.toFixed(0)} ms${i === 0 ? " (writes aux)" : ""}`),
  );
  if (loop.code !== 0 || !loop.xdv) {
    console.log(loop.out.slice(-1200));
    console.log(issues(loop.log));
    console.log(loop.log.slice(-2000));
    process.exit(1);
  }
  const warm = med(loop.t.slice(1));
  console.log(`body warm median (runs 2..6): ${warm.toFixed(0)} ms, xdv ${loop.xdv.length} bytes`);
  console.log(`body log issues:\n${issues(loop.log) || "  (none)"}`);
  fs.writeFileSync(path.join(OUT, "acv-loop.xdv"), loop.xdv);

  // --- 3. cost breakdown, four runs each, median of the last three
  const touch = [
    ["Roboto", "m", "n"],
    ["Roboto", "l", "n"],
    ["Roboto", "b", "n"],
    ["Roboto", "m", "it"],
    ["SourceSans3", "m", "n"],
    ["SourceSans3", "m", "sc"],
    ["SourceSans3", "m", "it"],
    ["SourceSans3", "b", "n"],
    ["SourceSans3", "l", "n"],
    ["SourceSans3", "l", "sl"],
    ["FA5solid", "m", "n"],
    ["FA5brands", "m", "n"],
  ]
    .map(
      ([f, s, sh]) =>
        `{\\fontencoding{TU}\\fontfamily{${f}}\\fontseries{${s}}\\fontshape{${sh}}\\selectfont x}`,
    )
    .join("");
  const widths =
    "\\setbox0\\hbox{--}\\typeout{W(--)=\\the\\wd0}\\setbox0\\hbox{``''}\\typeout{W(``'')=\\the\\wd0}";
  const oneFace = `${family("SourceSans3", [["m", "n", "SourceSans3-Regular.otf"]])}\\renewcommand*\\encodingdefault{TU}\\renewcommand*\\rmdefault{SourceSans3}`;
  const steps = {
    "cm fonts only (no TU, no declarations)": "\\begin{document}Hello x\\end{document}",
    "+ TU via \\usepackage[TU]{fontenc} (selects Latin Modern)":
      "\\usepackage[TU]{fontenc}\\begin{document}Hello x\\end{document}",
    "+ TU via \\encodingdefault and one declared face": `${oneFace}\\begin{document}Hello x\\end{document}`,
    "+ all shims declared, 12 faces the resume uses loaded once at 10pt": `${shims()}\\begin{document}${touch}\\end{document}`,
    "  same without tex-text mapping": `${shims("")}\\begin{document}${touch}\\end{document}`,
    "  mapping check, with mapping": `${oneFace}\\begin{document}${widths}\\end{document}`,
    "  mapping check, without mapping": `${oneFace.replace(MAP, "")}\\begin{document}${widths}\\end{document}`,
  };
  console.log("cost breakdown (warm median of 3):");
  for (const [name, b] of Object.entries(steps)) {
    const r = compile("acv-loop-pre", "acv-loop-step", b, 4);
    const w = r.log.split("\n").filter((l) => /^W\(/.test(l));
    console.log(
      `  ${name}: ${r.code === 0 ? `${med(r.t.slice(1)).toFixed(0)} ms` : `FAILED ${issues(r.log)}`}${w.length ? ` ${w.join(" ")}` : ""}`,
    );
    if (r.xdv) M.FS.unlink(`${PROJECT}/acv-loop-step.xdv`);
  }
  console.log(`  + full resume body: ${warm.toFixed(0)} ms`);

  // --- 3b. the declarations can live in the format too: they load nothing until selected
  const fmtB = dump("acv-loop-pre2", `\\RequirePackage[OT1]{fontenc}${config}${shims()}\n\\dump\n`);
  if (fmtB) {
    const r = compile("acv-loop-pre2", "acv-loop-body2", `${fields}${document}`, 6);
    console.log(
      `body with shims in the format: ${r.code === 0 ? `runs ${r.t.map((x) => x.toFixed(0)).join("/")} ms, warm median ${med(r.t.slice(1)).toFixed(0)} ms, xdv ${r.xdv ? r.xdv.length : 0} bytes` : `FAILED ${issues(r.log)}`}`,
    );
  }

  // --- 4. compare with the fontspec compile from acv.cjs
  const inspect = (file) => {
    const out = execFileSync(process.execPath, [path.join(__dirname, "dvi-inspect.cjs"), file], {
      encoding: "utf8",
    });
    const m = out.match(/pages=(\d+) chars=(\d+) rules=(\d+) glyphRuns=(\d+)/);
    const n = out.match(/native fonts \((\d+)\)/);
    return {
      pages: +m[1],
      chars: +m[2],
      rules: +m[3],
      glyphRuns: +m[4],
      native: n ? +n[1] : 0,
      out,
    };
  };
  const plainPath = path.join(OUT, "acv-plain.xdv");
  if (!fs.existsSync(plainPath)) {
    console.log("no acv-plain.xdv in SPIKE_OUT; run acv.cjs first to compare");
  } else {
    const a = inspect(plainPath);
    const b = inspect(path.join(OUT, "acv-loop.xdv"));
    console.log(
      `compare: plain (fontspec) pages=${a.pages} glyphRuns=${a.glyphRuns} rules=${a.rules} nativeFonts=${a.native}; loop pages=${b.pages} glyphRuns=${b.glyphRuns} rules=${b.rules} nativeFonts=${b.native}`,
    );
    console.log(
      `loop native fonts:\n${b.out
        .split("\n")
        .filter((l) => /^ {2}\d+: /.test(l))
        .join("\n")}`,
    );
  }

  // --- 5. PDF, to show the download path still works
  const r = M.__run(["xdvipdfmx", "-o", "acv-loop.pdf", "acv-loop-body.xdv"]);
  const pdf = readBytes(M, `${PROJECT}/acv-loop.pdf`);
  console.log(`xdvipdfmx: exit ${r.code} ${r.ms.toFixed(0)} ms pdf ${pdf ? pdf.length : 0} bytes`);
  if (pdf) fs.writeFileSync(path.join(OUT, "acv-loop.pdf"), pdf);
  else console.log(r.out.slice(-800));

  console.log(
    `SUMMARY xetex-loop: format ${fmtA.length} bytes; body warm median ${warm.toFixed(0)} ms (acv.cjs plain compile is about 10 s)`,
  );
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
