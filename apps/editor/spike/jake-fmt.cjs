// Dump Jake's preamble into a format, then compile the body from it. Prints timings.
const fs = require("fs");
const path = require("path");
const { makeModule, writeProject, readText, readBytes, PROJECT } = require("./harness.cjs");
const R = process.env.SPIKE_ASSETS ?? path.join(__dirname, "assets");
const OUT =
  process.env.SPIKE_OUT ??
  path.join(process.env.SPIKE_ASSETS ?? path.join(__dirname, "assets"), "out");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const M = await makeModule([
    "texlive-basic",
    "ubuntu-texlive-latex-extra",
    "ubuntu-texlive-fonts-recommended",
  ]);
  const tex = fs.readFileSync(path.join(R, "templates", "jake", "resume.tex"), "utf8");
  const cut = tex.indexOf("\\begin{document}");
  const preamble = tex.slice(0, cut);
  const body = tex.slice(cut);
  writeProject(M, {
    "jake-pre.tex": `${preamble}\n\\dump\n`,
    "jake-body.tex": body,
    "resume.tex": tex,
  });

  const common = ["--no-shell-escape", "--interaction=nonstopmode", "--halt-on-error"];
  const stockFmt = "/texlive/texmf-dist/texmf-var/web2c/pdftex/pdflatex.fmt";

  // 1. dump
  let r = M.__run([
    "pdflatex",
    "-ini",
    "-jobname=jake-pre",
    ...common,
    "--output-format=dvi",
    "--fmt",
    stockFmt,
    "jake-pre.tex",
  ]);
  let fmt = readBytes(M, `${PROJECT}/jake-pre.fmt`);
  console.log(
    `dump (-fmt abs): exit ${r.code} ${r.ms.toFixed(0)} ms fmt ${fmt ? fmt.length : 0} bytes`,
  );
  if (!fmt) {
    console.log(r.out.slice(-1500));
    r = M.__run([
      "pdflatex",
      "-ini",
      "-jobname=jake-pre",
      ...common,
      "--output-format=dvi",
      "&pdflatex",
      "jake-pre.tex",
    ]);
    fmt = readBytes(M, `${PROJECT}/jake-pre.fmt`);
    console.log(
      `dump (&pdflatex): exit ${r.code} ${r.ms.toFixed(0)} ms fmt ${fmt ? fmt.length : 0} bytes`,
    );
    if (!fmt) {
      console.log(r.out.slice(-2500));
      console.log(readText(M, `${PROJECT}/jake-pre.log`).slice(-2500));
      process.exit(1);
    }
  }
  fs.writeFileSync(path.join(OUT, "jake-pre.fmt"), fmt);

  // 2. body from the custom format, six times
  const bodyArgs = [
    "pdflatex",
    ...common,
    "--output-format=dvi",
    "--fmt",
    `${PROJECT}/jake-pre.fmt`,
    "jake-body.tex",
  ];
  const times = [];
  for (let i = 0; i < 6; i++) {
    r = M.__run(bodyArgs);
    const dvi = readBytes(M, `${PROJECT}/jake-body.dvi`);
    times.push(r.ms);
    console.log(
      `body run ${i + 1}: exit ${r.code} ${r.ms.toFixed(0)} ms dvi ${dvi ? dvi.length : 0} bytes`,
    );
    if (r.code !== 0 || !dvi) {
      console.log(r.out.slice(-2500));
      console.log(readText(M, `${PROJECT}/jake-body.log`).slice(-2500));
      process.exit(1);
    }
    if (i === 0) fs.writeFileSync(path.join(OUT, "jake-fmt.dvi"), dvi);
  }
  // 3. stock format, six times, same process, for a like-for-like comparison
  const stockArgs = ["pdflatex", ...common, "--output-format=dvi", "--fmt", stockFmt, "resume.tex"];
  const stockTimes = [];
  for (let i = 0; i < 6; i++) {
    r = M.__run(stockArgs);
    stockTimes.push(r.ms);
  }
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  console.log(
    `median body-from-format ${med(times.slice(1)).toFixed(0)} ms; median stock ${med(stockTimes.slice(1)).toFixed(0)} ms`,
  );
  // 4. same output? compare DVI ignoring the preamble comment (which carries the jobname/date)
  const a = fs.readFileSync(path.join(OUT, "jake-stock.dvi")),
    b = fs.readFileSync(path.join(OUT, "jake-fmt.dvi"));
  const strip = (d) => d.subarray(15 + d[14]);
  console.log(
    `dvi bodies identical: ${Buffer.compare(strip(a), strip(b)) === 0} (${a.length} vs ${b.length} bytes)`,
  );
  const log = readText(M, `${PROJECT}/jake-body.log`);
  console.log(
    log
      .split("\n")
      .filter((l) => /Warning|Error|Output written/i.test(l))
      .slice(0, 12)
      .join("\n"),
  );
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
