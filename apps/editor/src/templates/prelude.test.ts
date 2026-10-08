import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import type { EngineManifest } from "../engine/manifest";
import { ENGINE_DIR, engineAvailable, startNodeSession } from "../engine/node";
import type { Engine, EngineSession } from "../engine/session";
import { difference, type GlyphStream, glyphStream } from "../import/reference";
import { FontLibrary } from "../page/fonts";
import { TexLiveIndex } from "../page/texlive";
import { MARKER_BEGIN, MARKER_END } from "../tex/fields";
import { CURATED } from "./curated";
import { generateBody, generateFormat } from "./generate";
import { defaultControls } from "./package";
import { PRELUDE } from "./prelude";

// Every document here is invented for these tests, with invented words; none is a real resume.

/**
 * A body with every field's markers taken out, `\rtfield{<id>}{<content>}` written as its content:
 * the page the markers must not move. Braces count from the content's own, past an escaped one.
 */
function unmarked(latex: string): string {
  const call = "\\rtfield{";
  const start = latex.indexOf(call);
  if (start < 0) return latex;
  const idEnd = latex.indexOf("}", start + call.length);
  if (latex[idEnd + 1] !== "{") throw new Error("a field without its content");
  const from = idEnd + 2;
  let depth = 1;
  let at = from;
  for (; depth > 0; at++) {
    const char = latex[at];
    if (char === undefined) throw new Error("a field's content does not close");
    if (char === "\\") at++;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
  }
  // The content, its own fields taken out too, then the rest.
  return latex.slice(0, start) + unmarked(latex.slice(from, at - 1)) + unmarked(latex.slice(at));
}

/**
 * The prelude with its field macro put back as main had it before decision 0080: the italic
 * correction of its own in a slanted text command, the end marker at once, no microtype hook.
 */
const OLD_FIELD = String.raw`\newcommand{\rtfield}[2]{%
  \texorpdfstring{\leavevmode\special{${MARKER_BEGIN}\detokenize{#1}}\rt@par{#1}#2%
    \ifhmode\ifx\check@icr\@empty\else\ifdim\fontdimen\@ne\font>\z@\/\fi\fi\fi%
    \special{${MARKER_END}\detokenize{#1}}}{#2}}
`;

/**
 * The prototype decision 0077 measured: the correction of a field's last glyph kept in a global
 * that nothing clears when LaTeX does not correct, and added by a later `\/` after any whatsit.
 */
const PROTOTYPE_FIELD = String.raw`\newcommand{\rtfield}[2]{%
  \texorpdfstring{\leavevmode\rt@icreset\special{${MARKER_BEGIN}\detokenize{#1}}\rt@par{#1}#2%
    \rt@endic\special{${MARKER_END}\detokenize{#1}}}{#2}}
\newdimen\rt@ic
\protected\def\rt@icreset{\global\rt@ic\z@}
\let\rt@italiccorr\@@italiccorr
\protected\def\@@italiccorr{\ifdim\rt@ic>\z@\ifnum\lastnodetype=9 \kern\rt@ic\global\rt@ic\z@
  \else\rt@italiccorr\fi\else\rt@italiccorr\fi}
\protected\def\rt@endic{\global\rt@ic\z@\ifhmode\@tempswafalse\ifnum\lastnodetype=\z@\@tempswatrue
  \fi\ifnum\lastnodetype=7 \@tempswatrue\fi\ifnum\lastnodetype=9 \@tempswatrue\fi\if@tempswa
  \rt@italiccorr\ifnum\lastnodetype=12 \global\rt@ic\lastkern\unkern\fi\fi\fi}
`;

/** The prelude with its field macro, from `\rtfield`'s definition to `\rt@par`'s, replaced. */
function preludeWith(field: string): string {
  const from = PRELUDE.indexOf("\\newcommand{\\rtfield}");
  const to = PRELUDE.indexOf("% The paragraph a field is set in");
  if (from < 0 || to < from) throw new Error("the prelude's field macro is not where it was");
  return PRELUDE.slice(0, from) + field + PRELUDE.slice(to);
}

/** The glyphs a stream sets, natively or from a TeX font. */
const glyphsOf = (stream: GlyphStream) =>
  stream.pages.reduce((sum, page) => sum + page.items.filter((i) => i.kind === "glyph").length, 0);

/**
 * A stream's glyphs and rules alone, each page's, and its specials' texts in order but for the
 * editor's markers: two streams the same in both set every glyph at the same place, and colour
 * and links over the same glyphs, though a special stand elsewhere. A built-in sample's section
 * titles start their paragraph at the field's `\leavevmode`, so a colour special set before the
 * title's text goes in the title's line rather than above it (decision 0003).
 */
function glyphsAndSpecials(stream: GlyphStream): { glyphs: GlyphStream; specials: string[] } {
  const specials: string[] = [];
  const pages = stream.pages.map((page) => ({
    items: page.items.filter((item) => {
      if (item.kind !== "special") return true;
      if (!/^rt:[bepl]:/.test(item.text)) specials.push(item.text);
      return false;
    }),
  }));
  return { glyphs: { ...stream, pages }, specials };
}

/** The fields a stream's markers open. */
const fieldsOf = (stream: GlyphStream) =>
  stream.pages.reduce(
    (sum, page) =>
      sum +
      page.items.filter((i) => i.kind === "special" && i.text.startsWith(MARKER_BEGIN)).length,
    0,
  );

describe("unmarked", () => {
  test("writes each field as its content, nested fields and escaped braces too", () => {
    expect(unmarked("A \\rtfield{a}{Invented \\{x\\}} and \\textbf{\\rtfield{b}{Inv}}.")).toBe(
      "A Invented \\{x\\} and \\textbf{Inv}.",
    );
    expect(unmarked("\\rtfield{o}{one \\rtfield{i}{two {three}} four}")).toBe(
      "one two {three} four",
    );
    expect(unmarked("Nothing marked.")).toBe("Nothing marked.");
  });
});

/** An invented look-alike of a cause: a document whose fields the macro must not move. */
interface LookAlike {
  name: string;
  engine: Engine;
  preamble: string;
  body: string;
  /**
   * The macro that moved the look-alike's page: main's before decision 0080, or the prototype; or
   * none, for a look-alike that only shows the macro works where it stands.
   */
  moved?: "old" | "prototype";
}

const ARTICLE = "\\documentclass{article}\n\\usepackage[hidelinks]{hyperref}\n";
const XETEX = String.raw`\documentclass{article}
\usepackage{xcolor}
\usepackage{fontspec}
\setmainfont{lmroman10-regular.otf}[ItalicFont=lmroman10-italic.otf,BoldFont=lmroman10-bold.otf]
`;
const PARAGRAPH = "Invented words fill this paragraph so that its lines break as they would.";

const LOOK_ALIKES: LookAlike[] = [
  {
    name: "a: a text command's correction after a field that is its argument",
    engine: "pdftex",
    preamble: ARTICLE,
    body: String.raw`Invented \textbf{\rtfield{a}{Invented staff}}: words after it.
\textit{\rtfield{b}{Invented word}} and more words.
\textit{\textup{\rtfield{c}{Invented staff}}} and more words.
\textbf{\rtfield{d}{\rtfield{e}{Invented chief}}}: nested fields.`,
    moved: "old",
  },
  {
    name: "a: a text command's correction at a field's end, decided on what follows the field",
    engine: "pdftex",
    preamble: ARTICLE,
    body: String.raw`\rtfield{a}{Invented \textit{half}}. Words after it.
\rtfield{b}{Invented \textit{half}} and words after it.
\textbf{\rtfield{c}{Invented \textit{half}}}, words after it.`,
    moved: "old",
  },
  {
    name: "a: the next text command's correction of a field's last glyph, after a space or none",
    engine: "pdftex",
    preamble: ARTICLE,
    body: String.raw`\rtfield{a}{Invented staff} \textbf{Invented} words after it.
\rtfield{b}{Invented staff}\textbf{Invented} words after it.
\textit{\rtfield{c}{Invented half} \textup{words}} after it.
\rtfield{d}{Invented staff} \textbf{.Invented} and \rtfield{e}{Invented staff} \textbf{}words.
\rtfield{f}{Invented staff} \emph{Invented} and \textbf{\rtfield{g}{Invented staff} }words.
{\itshape \rtfield{h}{Invented half}} \textbf{Invented} and \textit{\small{\rtfield{i}{Invented half}}} after.`,
    moved: "old",
  },
  {
    name: "d: no correction of the macro's own in a slanted text command",
    engine: "pdftex",
    preamble: ARTICLE,
    body: String.raw`\textit{\rtfield{a}{Invented half}}. And after.
Invented label: \textsl{\rtfield{b}{Invented half}}, done.
{\slshape \rtfield{c}{Invented half}} and after, as a declaration.`,
    moved: "old",
  },
  {
    name: "a and d in XeTeX's text",
    engine: "xetex",
    preamble: XETEX,
    body: String.raw`Invented \textbf{\rtfield{a}{Invented staff}}: words after it.
\textit{\rtfield{b}{Invented half}}. And after.
\textit{\rtfield{c}{Invented half}} and after.`,
    moved: "old",
  },
  {
    // The text's own \/ after a field corrects the field's last glyph: the end marker goes in
    // before its kern, as before LaTeX's.
    name: "an explicit \\/ right after a field that ends a text command's argument",
    engine: "pdftex",
    preamble: ARTICLE,
    body: String.raw`\textit{\rtfield{a}{Invented half}\/} more words.
\textit{\rtfield{b}{Invented half}\/}. And after.
\textbf{\rtfield{c}{Invented staff}\/}: and after.
\textit{\rtfield{d}{Invented half}}\/ and after.
\rtfield{e}{Invented \textit{half}}\/ and after.`,
  },
  {
    // A declaration, or a document's own command that wraps one, sets no text command's
    // correction: the \/ after the field is the only one.
    name: "an explicit \\/ after a field in a declaration's group, or after its end",
    engine: "pdftex",
    preamble: String.raw`${ARTICLE}\newcommand{\position}[1]{{\itshape #1\/}}
`,
    body: String.raw`{\itshape \rtfield{a}{Invented half}\/} more words.
\position{\rtfield{b}{Invented half}} at an invented place.
{\itshape \rtfield{c}{Invented half}}\/ and after.
{\itshape \rtfield{d}{Invented half} }\/ and after.`,
    moved: "old",
  },
  {
    name: "an explicit \\/ after a field in XeTeX's text",
    engine: "xetex",
    preamble: String.raw`${XETEX}\newcommand{\position}[1]{{\itshape #1\/}}
`,
    body: String.raw`\textit{\rtfield{a}{Invented half}\/} more words.
\position{\rtfield{b}{Invented half}} at an invented place.`,
    moved: "old",
  },
  {
    name: "b: microtype's protrusion of an item's first glyph",
    engine: "pdftex",
    preamble: `${ARTICLE}\\usepackage{microtype}\n`,
    body: String.raw`\begin{itemize}
\item \rtfield{a}{(Invented) words that open an item.}
\item \rtfield{b}{\lq Invented\rq{} words that open another.}
\item \textbf{\rtfield{c}{Tall invented words}}, bold.
\end{itemize}`,
    moved: "old",
  },
  {
    name: "the prototype's pdfTeX loss: a kept correction added after a colour special",
    engine: "pdftex",
    preamble: `${ARTICLE}\\usepackage{xcolor}\n`,
    body: String.raw`\rtfield{a}{Invented staff} \textcolor{gray}{\textbf{Invented}} words.
{\itshape \rtfield{b}{Invented half}} {\color{gray}\textbf{Invented} words.}`,
    moved: "prototype",
  },
  {
    name: "the prototype's XeTeX loss: a kept correction in place of the one after XeTeX's text",
    engine: "xetex",
    preamble: XETEX,
    body: String.raw`{\itshape \rtfield{a}{Invented half}} {\color{gray}words \textbf{Invented}} after.`,
    moved: "prototype",
  },
  {
    name: "a field in a TikZ node, whose text's closing brace the macro reads past",
    engine: "pdftex",
    preamble: `${ARTICLE}\\usepackage{tikz}\n`,
    body: String.raw`A tag \tikz[baseline]\node[anchor=base,draw]{\rtfield{a}{Invented staff}}; and
\tikz[baseline]\node[anchor=base]{\textit{\rtfield{b}{Invented half}}}; after.`,
  },
  {
    name: "a field that ends a conditional's branch, read past by the macro",
    engine: "pdftex",
    preamble: String.raw`${ARTICLE}\newcommand{\cvsig}[1]{\def\cvsigtext{#1}}
\newcommand{\cvclose}{\ifx\cvsigtext\undefined\else\cvsigtext\fi: done\par}
`,
    body: String.raw`\cvsig{\rtfield{a}{Invented Name}}\cvclose
\cvsig{\textit{\rtfield{b}{Invented half}}}\cvclose`,
  },
  {
    // The end marker goes in before the correction's kern: after it, the glue after the kern
    // would be where the line breaks, and the line would keep the kern.
    name: "a line break right after a correction a text command sets after a field",
    engine: "pdftex",
    preamble: ARTICLE,
    body: [216, 220, 224, 228, 232, 236, 240]
      .map(
        (width, k) =>
          String.raw`\parbox{${width}pt}{Invented words run on here before \textbf{\rtfield{a${k}}{Invented staff}} words after it and more invented words fill out the paragraph to the end of it.}`,
      )
      .join("\n"),
  },
  {
    name: "a line break right after a correction a text command sets after a field, in XeTeX",
    engine: "xetex",
    preamble: XETEX,
    body: [196, 200, 204, 208, 212, 216, 220, 224]
      .map(
        (width, k) =>
          String.raw`\parbox{${width}pt}{Invented words run on here before \textbf{\rtfield{a${k}}{Invented staff}} words after it.}`,
      )
      .join("\n"),
  },
  {
    // And before a space the text command ends with, which \par and \\ take off a line's end.
    name: "a space a text command ends with after a field, at a centred or ragged line's end",
    engine: "pdftex",
    preamble: ARTICLE,
    body: String.raw`{\centering \textit{\rtfield{a}{Invented half} }\par}
{\raggedleft \textbf{\rtfield{b}{Invented staff} }\\ next\par}`,
  },
  {
    // Read past the group's end, the line's end would be read as \obeylines makes it: a new line.
    name: "a field that ends a group under \\obeylines",
    engine: "pdftex",
    preamble: ARTICLE,
    body: String.raw`Before.

{\obeylines\itshape \rtfield{a}{Invented half}}
words after it.`,
  },
  {
    // A class's own text command of a kernel name: the markers go in before it.
    name: "a field before a class's own \\emph and \\textsc",
    engine: "pdftex",
    preamble: String.raw`${ARTICLE}\renewcommand{\emph}[1]{\textbullet\ #1}
\renewcommand{\textsc}[1]{}
`,
    body: String.raw`\rtfield{a}{Invented staff} \emph{Invented} words after.
\rtfield{b}{Invented staff}\textsc{gone} more words \rtfield{c}{Invented other} words.`,
  },
];

/**
 * Each field's glyphs, counted between its markers, and the markers in the order they stand: a
 * field takes in no glyph of the text after it, and no marker is held past the next field's.
 */
function fieldGlyphs(stream: GlyphStream): { counts: Record<string, number>; order: string[] } {
  const counts: Record<string, number> = {};
  const open = new Set<string>();
  const order: string[] = [];
  for (const page of stream.pages)
    for (const item of page.items) {
      if (item.kind === "special" && item.text.startsWith(MARKER_BEGIN)) {
        const id = item.text.slice(MARKER_BEGIN.length);
        open.add(id);
        counts[id] = 0;
        order.push(item.text);
      } else if (item.kind === "special" && item.text.startsWith(MARKER_END)) {
        open.delete(item.text.slice(MARKER_END.length));
        order.push(item.text);
      } else if (item.kind === "glyph") for (const id of open) counts[id] = (counts[id] ?? 0) + 1;
    }
  return { counts, order };
}

describe.skipIf(!engineAvailable())("the field macro, on the engine (decision 0080)", () => {
  let session: EngineSession;
  let fonts: FontLibrary;
  beforeAll(async () => {
    session = await startNodeSession();
    const manifest = JSON.parse(
      readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"),
    ) as EngineManifest;
    fonts = new FontLibrary(new TexLiveIndex(manifest), async (path) =>
      readFileSync(join(ENGINE_DIR, "files", path)),
    );
  }, 60_000);

  /** A whole document compiled from the stock format, read as the probe reads a page. */
  async function compiled(engine: Engine, latex: string, job: string): Promise<GlyphStream> {
    const result = session.compile(engine, "stock", latex, { job, maxPasses: 2 });
    if (!result.output) throw new Error(`${job} did not compile: ${result.error}`);
    return glyphStream(fonts, result.output);
  }

  const document = (each: LookAlike, prelude: string, body: string) =>
    `${each.preamble}${prelude}\n\\begin{document}\n${PARAGRAPH}\n\n${body}\n\n${PARAGRAPH}\n\\end{document}\n`;

  for (const [index, each] of LOOK_ALIKES.entries())
    test(`sets ${each.name} where the unmarked page does`, async () => {
      const job = `lookalike${index}`;
      const plain = await compiled(each.engine, document(each, PRELUDE, unmarked(each.body)), job);
      const marked = await compiled(each.engine, document(each, PRELUDE, each.body), job);
      const fields = (each.body.match(/\\rtfield\{/g) ?? []).length;
      expect(fieldsOf(marked)).toBe(fields);
      expect(difference(plain, marked)?.text).toBeUndefined();
      // The macro it replaces moved the same look-alike: it shows the cause.
      if (each.moved !== undefined) {
        const before = preludeWith(each.moved === "old" ? OLD_FIELD : PROTOTYPE_FIELD);
        const then = await compiled(each.engine, document(each, before, each.body), job);
        expect(difference(plain, then), `the ${each.moved} macro`).toBeDefined();
      }
      const moved = each.moved === undefined ? "" : `; the ${each.moved} macro moved it`;
      console.info(
        `${each.name}: marked = unmarked, ${glyphsOf(marked)} glyphs, ${fields} fields${moved}`,
      );
    }, 60_000);

  test("holds no field's end past a class's own text command of a kernel name", async () => {
    const each = LOOK_ALIKES.find((one) => one.name.includes("class's own")) as LookAlike;
    const marked = await compiled(each.engine, document(each, PRELUDE, each.body), "classown");
    const { counts, order } = fieldGlyphs(marked);
    // "Invented staff" sets 12 glyphs, its ff a ligature, and "Invented other" 13.
    expect(counts).toEqual({ a: 12, b: 12, c: 13 });
    expect(order).toEqual(["a", "b", "c"].flatMap((id) => [MARKER_BEGIN + id, MARKER_END + id]));
  }, 60_000);

  test("c: protrusion at a line's start passes the begin marker in pdfTeX, and stops at it in XeTeX", async () => {
    // A field that starts a line with a glyph microtype protrudes. pdfTeX's margin kerning passes
    // a whatsit to the line's first glyph; XeTeX's stops at it, and no macro can put the marker
    // after that glyph: out of the macro's reach (decision 0080).
    const body = String.raw`\noindent\rtfield{a}{(Invented) words that open a paragraph and run on.}`;
    const cases = [
      { engine: "pdftex", preamble: `${ARTICLE}\\usepackage{microtype}\n`, same: true },
      { engine: "xetex", preamble: `${XETEX}\\usepackage{microtype}\n`, same: false },
    ] as const;
    for (const { engine, preamble, same } of cases) {
      const each: LookAlike = { name: "c", engine, preamble, body, moved: "old" };
      const plain = await compiled(
        engine,
        document(each, PRELUDE, unmarked(body)),
        `line${engine}`,
      );
      const marked = await compiled(engine, document(each, PRELUDE, body), `line${engine}`);
      expect(difference(plain, marked) === undefined, engine).toBe(same);
      console.info(`c in ${engine}: marked ${same ? "=" : "differs from"} unmarked`);
    }
  }, 60_000);

  test("every built-in template's sample: marked = unmarked, glyph for glyph", async () => {
    for (const [id, { package: pkg, sample }] of CURATED) {
      const values = defaultControls(pkg);
      const format = generateFormat(pkg, values);
      const dumped = session.dump(pkg.engine, format.name, format.preamble, format.files);
      if (!dumped.ok) throw new Error(dumped.error);
      // The same format with main's macro before decision 0080, to say what it did.
      const old = `${format.name}-old`;
      const preamble = format.preamble.replace(PRELUDE, preludeWith(OLD_FIELD));
      const again = session.dump(pkg.engine, old, preamble, format.files);
      if (!dumped.ok || !again.ok) throw new Error(dumped.error ?? again.error);
      const body = generateBody(pkg, sample, values);
      const read = async (name: string, latex: string) => {
        const result = session.compile(pkg.engine, name, latex, { job: id, maxPasses: 3 });
        if (!result.output) throw new Error(`${id} did not compile: ${result.error}`);
        const stream = await glyphStream(fonts, result.output);
        return { stream, ...glyphsAndSpecials(stream) };
      };
      const plain = await read(format.name, unmarked(body.latex));
      const marked = await read(format.name, body.latex);
      const before = await read(old, body.latex);
      expect(fieldsOf(marked.stream), id).toBe(body.texts.size);
      expect(difference(plain.glyphs, marked.glyphs)?.text, id).toBeUndefined();
      expect(marked.specials, id).toEqual(plain.specials);
      const moved = difference(plain.glyphs, before.glyphs) !== undefined;
      console.info(
        `${id}: marked = unmarked, ${glyphsOf(marked.glyphs)} glyphs; main's macro ${moved ? "moved" : "kept"} them`,
      );
    }
  }, 180_000);
});
