# 0038. Imports in the browser, and their packages in the store

Date: 2026-10-01 · Status: proposed

## Context

Milestone 3 item 12 takes the import pipeline of items 3 to 11 into the editor: a person's `.tex`
or zip goes in from the document list, runs through the pipeline on the editor's own engine, and
comes out as a document that opens, edits, saves, downloads and opens again, its template's package
kept in the browser. Decision 0026 left three things for it to do first or alongside: keep a section
whose head opens its content's list together with the locked part that closes it, since removing
the section alone stopped the compile in 20 of Jake's forks; refuse, in the store's loader, an
imported package outside the `import-` prefix; and terminate a worker whose compile never ends.
Decision 0019 left it a stand-in whose path the PDF will not show, and decision 0010 a store that
knows only curated templates. The engine's session is synchronous and lives in the compile worker,
and every step of the pipeline calls it synchronously, so where the pipeline runs was the first
question.

## Decision

### The pipeline runs in the worker, on the editor's engine

- `src/import/run.ts`, `importResume(files, deps, onStep, signal)`, runs the steps in the order
  `scripts/corpus-assemble-child.ts` runs them in Node: the intake; stand-ins copied to plain paths
  (below); the reference compile, read in Latin Modern where the page cannot draw its Computer
  Modern in T1 or TS1; the signatures, asked of `SIZE_OPTIONS` too; the parse; the probe, whose
  format is dropped at once; the naming request, built with the upload's sources and the page's
  strings and checked with `assertNoText` before it leaves, as `corpus name` builds it (decision
  0033); the naming service; a XeTeX document's fonts declared by file and checked (decision 0023);
  and `validate`. It imports nothing of Node's. The corpus runners' Node parts, the answer folder
  and the header's values found from it, stay in `scripts/`: in the browser the service's reply
  carries the answers, and one request goes, built without the header's values, which only its
  answers give. It is built by one function (`importRequest`), which `corpus leak` proves as it
  stands, the header's values given to the check besides; and a word a setting keeps as a keyword
  or a colour's name that the page shows, or a text the preamble stores holds, goes as its
  placeholder, since the header's values that masked it there are not in the browser's request
  (decision 0033's update).
- It runs where the session is: the worker gains an `import` request, which loads the pipeline,
  the fonts the page's glyphs are read with and the tree's images only when the first import asks,
  and reports progress under the request's id. The worker is built as an ES module
  (`worker.format: "es"`), so the pipeline is chunks of its own: the worker every document starts
  stays at 20 KB, and the pipeline's 1 MB loads with the first import, where an IIFE worker inlined
  it, 1.09 MB in all, into the worker of every document.
- Each step and each compile reports through `onStep`: the step's name in plain English (plan
  section 6.4), the compiles so far and whether one is under way. The names are "Reading your
  files", "Compiling your resume as it stands, slower the first time", "Matching its fonts to ones
  the page can draw", "Reading the template's commands", "Reading your resume's parts", "Finding
  the parts you can edit", "Preparing what is sent to learn the template", "Asking the naming
  service about the template", "Setting up the template's fonts" and "Checking the imported
  template". `signal` stops the import between compiles, through a session that checks it before
  each compile, dump and PDF.
- The naming step calls `nameOnService` on the page's own origin. The dev server answers it from
  the committed answers and `.corpus/cache/`, and asks SoCLaaS only with `SOCLAAS_API_KEY` set on
  its side (decision 0036). When no answer comes, the browser has none of its own: every macro
  stays as the probe left it, what the template's macros set is kept as the upload wrote it, and
  the report says why (`naming.failed`, the client's own words).
- New refusals, each in plain English: `probe`, a body that does not set the reference's glyphs
  when compiled again unmarked; `request`, a naming request the privacy check finds the resume's
  text in, which is never sent; `failed`, a fault of the editor's own. A hung compile is `timeout`.
- What an import gives (`Imported`): the package; the document, the model's resume with its locked
  sections and extras; the report's inputs for item 13, the reference without its log, the checks,
  the locked parts, the images stood in for and dropped, the intake's warnings, how the naming went,
  and the compiles and time; the original upload's files as the person gave them; and the job, what
  the document's compiles need beside the package (below).

### One engine, and a worker that starts afresh

- The import runs on the compiler's engine (`Compiler.importResume`), in the worker's own jobs,
  `import`, and item 8's `fonts` for a XeTeX document, which it forgets when it ends, while the list
  shows: one engine is loaded at a time. It waits for what is in flight, and holds the engine until
  it lands, so that a document, a trial or a PDF asked meanwhile waits for it.
- Formats: the probe's is dropped right after the probe, and the XeTeX check's and the checks' by
  the import itself, whatever it comes to (decision 0022's rule). The checks dump the package's
  formats under their real names and drop them, so after an import the compiler forgets which
  imported formats its engine held, and hands them over again from its bytes when a document needs
  one.
- Cancel (`EngineClient.cancel`) terminates the worker, fails what waited on it with
  `EngineCancelled`, and starts a new worker for the next request; the compiler then treats its
  engine as new, and hands it the formats it keeps. The client times each compile of an import
  from the progress the worker sends as the compile begins, 120 s at most
  (`IMPORT_COMPILE_LIMIT`): one past it is hung, gets the same, and the import is refused as having
  taken too long (decision 0008). The time between compiles is not limited, since the naming
  service may take its two minutes; a person can cancel it.
- The protocol gains `dropFormat`, which the compiler sends for a package's formats once its last
  document is gone.

### The store keeps imported packages

- `DocumentStore`'s database goes to version 2: a `packages` table, and documents indexed by their
  template. A row holds the package, checked when it is read as a document is; when it was first
  made and last used; and, by document id, each import onto it: the original upload's files, the
  job, the report and when it was made. Two uploads of one template whose preambles agree share a
  package (decision 0026), and each keeps its own upload.
- `importDocument` stores the package and a new document set with it in one transaction; it refuses
  (`PackageRefused`) an id outside `IMPORTED_PREFIX`, or one a curated package has, which is the
  store's side of `checkCuratedId`, a package the schema refuses and a document not set with it.
  `templateOf` refuses the same on reading, and marks the package used.
- A package's formats are kept as any template's, among `MAX_FORMATS`. Deleting a document takes its
  import with it; deleting a package's last document takes the package, its formats, found by the
  prefix every format of it is named with, and its prefetch paths, and `remove` names the package
  so that the compiler drops its bytes and the engine's copies too.
- `templates/resolve.ts` gives a document's template: the curated map's, or the store's, only for
  an id under the prefix, with the document's own job. The app opens every document through it,
  and the list names an imported template as its package does.

### What an imported document compiles with

The checks compile an import with the reference compile's files, the upload's among them, where a
document's compile had only the package's. So the import keeps `referenceFiles` for the editor's
job: the upload's files, its images' stand-ins and pdfTeX's configurations; its bibliography apart,
which each job reads under its own name, `doc.bbl` and `fit.bbl`; and the stand-ins its PDF may
show. The compiler gives a job these files with a compile whenever the job does not hold them,
once it was forgotten or compiled with another format, as the session drops them then, and gives
the PDF the stand-ins.

### Stand-ins at plain paths

Right after the intake (`plainStandIns`), each stand-in whose path holds a character the PDF will
not take (decision 0019's residual) is copied to a plain path: its name with each letter's accents
taken off and every other such character a dash, a number added where the path is taken, with its
`.xbb` on pdfTeX; and every `\includegraphics` of the main file and the upload's `.tex` files that
names it, through the working folder or a `\graphicspath` folder, is rewritten to name the copy.
The stand-in stays under the document's own name for it beside the copy, for a name a macro builds,
which no rewrite sees: that PDF is still refused, and the intake's warning names the image. On the
engine, a document showing `Fotos/Café au lait` has its PDF refused before and made after.

### A section whose head opens its content's list goes as one

Where the nodes between a section's head and its content open a list the answer names a closer for,
as a Jake fork opens its skills' items with its entries' opener, and the closer stands after the
content, the section keeps everything up to that closer in its extras (`after`), which its snippet
writes after its content, where it was a locked section of its own. Removed or moved, the section
takes both. What stands after the closer stays a locked part of its own. An engine test removes such
a section from an invented Jake-shaped fork and compiles; without the change it stops.

The last unit's closer stood past the sections' region, among the template's code the document
snippet keeps after `{{sections}}`, so the review found the last section, and a last locked part,
still stopped the compile once removed. The region now runs to the closer of each list its units
open, so that the last section keeps the closer in its `after`, a last section of entries takes its
whole list, and a last locked part takes the closer into its LaTeX. Check 3 removes the last unit
of each kind as well as the first, since the first alone missed a last one that could not go. Engine
tests on the done-test's fork remove its last section, bullets inside the entries' list and a
section of entries, and compile.

### A kind whose removal stops the compile is fixed

Check 3 marks a kind the removal of whose first or last unit stops the compile, as it marks one
whose new unit does, and the assembly runs again with it (`fixed`). A kind the package marks is one
the editor neither adds nor removes, whichever stopped it, so a kind marked for its new unit alone,
which the editor used to let go, now keeps its units too: `applyUnder` refuses the removal, and the
side panel disables its Remove, saying why when pointed at. The check tries the removals in every
round under the package as though it marked nothing, since the editor would refuse them. A move is
not tried, and stays offered. An engine test imports an invented fork whose skills list is opened,
after the section's head, by a macro no answer names, and closed after the list: list sections are
marked, and no other kind.

The review named ten Jake forks whose list sections still could not go after the fix above
(jake-0004, 0007, 0020, 0021, 0023, 0025, 0033, 0035, 0043 and 0047). `corpus assemble --only`
over them, before and after: each still has `section.list` among the kinds whose trial stops the
compile (jake-0035 `section.paragraph` too), which the row counts, 10 and 10; the package marks it
in none before and in all ten after. `corpus assemble` now says of each section of such a kind
what frames it, by structure alone (`removals`): of the 20 list sections removed, the 2 that
compile keep nothing before their content, and the 18 that stop keep in `before` the opening of
environments that the parts after their content end. In 16 the macro that opens has no answer,
since the seed answers only upstream's macros and these forks redefine them, so the pairing above,
which goes by the answer's names, cannot see it; in jake-0007 the list is closed by another macro
than its answer names, the named one closing a second list the locked part opens; and in jake-0025
a `\begin` written out in `before` is ended past the section. The closer stands in the locked part
right after in 14, in the section's own `after` in one, and in neither in 3, each the last of its
kind. Pairing by the environments the macros' definitions begin and end would take all 18: a rule
of its own, left for later, and until then those sections are fixed rather than broken.

### The way in

The document list gets "New", which opens a chooser of the three curated templates, each with its
name, a line on its look and its engine; and "Import a resume", a file picker taking `.tex` and
`.zip`, with the list itself a drop target, and the privacy sentence of decision 0033 under the
picker. Several files, the `.tex` and what it needs beside it, are packed into one zip at their
names, stored uncompressed; a zip among several, or two files of one name, is refused. While an
import runs, the list shows its step and the compiles so far, with a Cancel, and nothing else
starts; a refusal comes back as the list's notice, in its own words; success opens the document.
A drag of files is always taken, so that the browser never opens a dropped file in the tab and
leaves the editor; while an import runs, or where nothing can import, a drop does nothing.

## Done

The engine test `src/import/run.test.ts` imports an invented fork of Jake's Resume, upstream's
preamble and commands with invented words (`src/test/jake-fork.ts`), and a picture in its heading
beside it, through `importResume` on the Node session, with the naming service's handler over the
committed answers and no model or network: the seed answers all 7 of its macros, the import takes
33 compiles and 5.5 s on the M4 Pro under other work, 23 fields and 76 words editable, the heading
block and the skills list kept, and its job holds the picture's stand-in, without which the body
stops. It is stored, opened through the compiler, a title edited, saved, its PDF made, and opened
again from a new store over the same database on a new TeX session, the job the store kept the
import's, the edit on its page and its PDF made. The same fork imports in the dev server
from the picker, as the brief's manual check asks, and opens, edits, makes its PDF and reopens after
a reload; a refusal, a cancel and the next import on a fresh worker, two imports sharing one package
until the last goes, a XeTeX document (9 s) and two dropped files with an image named with a space
and an accent were tried the same way. Nobody looked at a corpus document.

## Consequences

- Item 13 formats the report from `ImportReport`, which the store keeps with each import; item 15
  draws locked chunks, and the sections' `after` among them.
- The model is never called from the browser: the browser calls the naming service, which alone
  holds a key. Until milestone 5 hosts the service, only the dev server answers it, and an import
  anywhere else has every macro locked, which the report says.
- A document's job files include what the upload ships, fonts among them, in the browser's own
  store: the person's upload stays in their browser, as the plan's storage has it.
- An image a macro names with a character the PDF will not take still has its PDF refused, and a
  header written without the template's macros, as Jake's is, stays locked, which lists an imported
  Jake fork as "Untitled" until item 15 or a later reading of the header gives it a name.
- A first XeTeX import reads the tree's fonts for fontconfig's scan, 57.5 MB (decision 0019), which
  the progress line's "slower the first time" is all it says of.
- The owed row of the milestone's table is done: `corpus assemble` should find fewer documents whose
  first section of a kind cannot be removed, which a corpus run would show, and the package marks
  each kind that still cannot go, which its row `The editor neither adds nor removes` counts.
- A user of a Jake fork whose list sections are marked can neither add nor remove one until a
  pairing by definitions comes; a move, which the check does not try, is still offered.
