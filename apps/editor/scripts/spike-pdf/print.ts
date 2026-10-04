/**
 * How the PDF spike's third set is made (item 3): invented resumes printed by tools other than the
 * editor, each in a folder of `fixtures/other/` with its source, its PDF and its truth, which was
 * written as the source was. The folder's name says the tool:
 *
 * - `chrome-*`: `resume.html`, printed by Chrome headless (`--print-to-pdf`), as a browser's print
 *   makes a PDF;
 * - `textedit-*`: `resume.rtf`, printed by macOS's own text system, AppKit's, as TextEdit prints;
 * - `textutil-*`: `resume.html`, made RTF by `textutil`, then printed by AppKit likewise.
 *
 * `cupsfilter` on this machine converts only plain text to PDF, not RTF or HTML, so the text system
 * prints through AppKit (`NSPrintOperation` of an `NSTextView`), from a JavaScript for Automation
 * script `osascript` runs; its PDFs name `Quartz PDFContext` as their producer, as TextEdit's do.
 * Printing needs macOS and Chrome; the PDFs are committed, so reading them needs neither.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The third set's folder. */
export const OTHER_DIR = fileURLToPath(new URL("./fixtures/other/", import.meta.url));

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * AppKit's print of a rich text file to a PDF: US Letter, margins of three quarters of an inch, the
 * text laid out in a text view as wide as the page's text, and the view printed, page by page,
 * to the file. `run(argv)` takes the input's path and the output's. The script never touches the
 * view's layout manager, which would put it back on the old text system, which draws no list's
 * bullets: TextEdit draws them.
 */
const APPKIT_PRINT = `
ObjC.import("AppKit");
function run(argv) {
  const input = argv[0];
  const output = argv[1];
  const text = $.NSAttributedString.alloc.initWithURLOptionsDocumentAttributesError(
    $.NSURL.fileURLWithPath(input), $({}), null, null);
  if (!text || text.isNil()) throw new Error("could not read the input");
  const info = $.NSPrintInfo.sharedPrintInfo.copy;
  info.paperSize = $.NSMakeSize(612, 792);
  info.topMargin = 54;
  info.bottomMargin = 54;
  info.leftMargin = 54;
  info.rightMargin = 54;
  info.horizontallyCentered = false;
  info.verticallyCentered = false;
  info.horizontalPagination = $.NSPrintingPaginationModeFit;
  info.verticalPagination = $.NSPrintingPaginationModeAutomatic;
  info.jobDisposition = $.NSPrintSaveJob;
  info.dictionary.setObjectForKey($.NSURL.fileURLWithPath(output), $.NSPrintJobSavingURL);
  const view = $.NSTextView.alloc.initWithFrame($.NSMakeRect(0, 0, 612 - 108, 100));
  view.horizontallyResizable = false;
  view.verticallyResizable = true;
  view.textContainer.widthTracksTextView = true;
  view.textStorage.setAttributedString(text);
  view.sizeToFit;
  const operation = $.NSPrintOperation.printOperationWithViewPrintInfo(view, info);
  operation.showsPrintPanel = false;
  operation.showsProgressPanel = false;
  return operation.runOperation ? "printed" : "failed";
}
`;

/** Print a rich text file through AppKit to a PDF. */
function printAppKit(input: string, output: string) {
  const scratch = mkdtempSync(join(tmpdir(), "spike-pdf-"));
  try {
    const script = join(scratch, "print.js");
    writeFileSync(script, APPKIT_PRINT);
    const said = execFileSync("osascript", ["-l", "JavaScript", script, input, output], {
      encoding: "utf8",
    });
    if (!said.includes("printed")) throw new Error(`AppKit did not print ${input}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Print an HTML file with Chrome headless to a PDF. */
function printChrome(input: string, output: string) {
  execFileSync(
    CHROME,
    ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${output}`, input],
    { stdio: "ignore" },
  );
  if (!existsSync(output)) throw new Error(`Chrome did not print ${input}`);
}

/** Print every fixture of the third set from its source, each to its folder's `resume.pdf`. */
export function printFixtures(say: (line: string) => void = () => undefined): string[] {
  const printed: string[] = [];
  for (const name of readdirSync(OTHER_DIR).sort()) {
    const folder = join(OTHER_DIR, name);
    const pdf = join(folder, "resume.pdf");
    if (name.startsWith("chrome-")) printChrome(join(folder, "resume.html"), pdf);
    else if (name.startsWith("textedit-")) printAppKit(join(folder, "resume.rtf"), pdf);
    else if (name.startsWith("textutil-")) {
      const scratch = mkdtempSync(join(tmpdir(), "spike-pdf-"));
      try {
        const rtf = join(scratch, "resume.rtf");
        execFileSync("textutil", ["-convert", "rtf", "-output", rtf, join(folder, "resume.html")]);
        printAppKit(rtf, pdf);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    } else continue;
    printed.push(name);
    say(`printed ${name}`);
  }
  return printed;
}
