# 0017. The corpus

Date: 2026-09-26 · Status: accepted

## Context

Milestone 3 judges the import pipeline by a corpus of public LaTeX resumes, collected before the
pipeline exists: the share of them that import editable is the number the whole import effort is
measured by (plan section 5.7), and item 1 collects at least 200. They are real people's
resumes, public on GitHub by their owners' choice, and most of their repositories state no
licence, so the repository cannot hold them. The milestone settled that the corpus lives outside
git; this record says how it is chosen, pinned and fetched, by `apps/editor/scripts/corpus.ts`
and the modules beside it.

## Decision

### A manifest of sources, never the content

- `apps/editor/corpus/manifest.json` names each document: an id, its family, its repository, the
  commit the repository's default branch was at when it was collected, the licence, the main
  file, each file to fetch with its SHA-256 and size, and the names of its fonts and images.
  Nothing of a document's content is committed, in the manifest or anywhere else.
- `corpus fetch` downloads every file at its commit, never from a branch, from
  raw.githubusercontent.com, or through the contents API when that host cannot be reached, eight
  at a time. A file is written under `apps/editor/.corpus/<id>/<path>`, which git ignores, only
  when its size and SHA-256 match, and one already there with the right hash is kept, so a second
  run downloads nothing. CI fetches the same way.
- A path is relative, joined by `/`, with no empty, `.` or `..` part, no backslash and no control
  character; the schema refuses any other, and `fetch` checks it again, and that it stays inside
  the document's folder, before it writes.
- An id is the family, a dash and a four-digit counter, given in the order documents are taken.
  `corpus collect` extends the manifest: what it has stays, with its ids, and new documents are
  appended, each family counting on from its highest id. Ids are never renumbered.

### Where candidates come from

- Code search, eight queries, each served to its first 1,000 files, at 10 requests a minute:
  `resumeSubheading`, `altacv`, `awesome-cv`, `moderncv documentclass`, `europecv`,
  `filename:resume`, `filename:cv` and `"curriculum vitae"`, all with `extension:tex`.
- The forks of the five upstream templates, every page: sb2nov/resume and jakegut/resume, which
  are Jake's Resume and its original, posquit0/Awesome-CV, liantze/AltaCV and xdanaux/moderncv.
  Code search leaves out a fork with fewer stars than its parent, which is nearly every fork, so
  the listing is how forks are found.
- One classifier gives every candidate its family from its main file: `\documentclass{altacv}`,
  `{awesome-cv}`, `{moderncv}` or `{europecv}` names it; a file that calls `\resumeSubheading` is
  `jake`; anything else is `other`. Comments count for nothing, here and in every check below.
- A searched candidate's files are first read at HEAD, which costs none of the API's 5,000
  requests an hour, to screen most candidates out. A fork, or a candidate that passes, is pinned
  at the commit its default branch is at, and everything recorded is read at that commit.

### How a document qualifies

- Its main file is a whole document, with `\documentclass`, `\begin{document}` and
  `\end{document}`; is 1 KB to 200 KB; and has under 2% of its letters outside Latin script.
- It is not in one of the five upstream repositories.
- Its main file is not byte-identical, line endings normalised, to a main file the manifest has
  already, nor to any version of an upstream sample: a whole document at an upstream's root or
  under its `examples/`, in every version the default branch's latest 100 commits to it made,
  where it is now and, for one under `examples/`, at the root.
- A fork must have been pushed to after it was made, and its main file must differ from every
  version of its upstream's samples by more than ten lines, a line being added, removed or
  changed, blank lines and trailing spaces aside. A fork made years ago and left as it was holds
  an old version of the sample, which is as much the upstream's as the current one.
- A document of family `other` must look like a resume, since code search's words also find
  theses that close with a curriculum vitae, manuals, papers, slides and a Spanish *resumen*: its
  repository's name or its path must have resume, CV, vita, curriculum, Lebenslauf or Europass as
  a word of its own; it must not be slides; and its `.tex` sources must name at least two of the
  headings a resume has, education and experience among them, in the languages the corpus meets.
  The other families are resumes by their class or their macros.
- A cover letter is not a resume, whatever class it loads, and a file inside a TeX
  distribution's tree is a package's sample: neither is taken as a main file.
- One document per repository: the first main file that qualifies, the shallowest first, then
  one named as a resume or CV, then by path. A fork's main file is looked for at its root and
  under `examples/`, where the upstreams keep theirs; a searched repository's among the files the
  search found.

### What a document is

- Its files are the main file, then every file of its repository that it loads, followed three
  files deep: the classes named by `\documentclass` and `\LoadClass`, the packages named by
  `\usepackage` and `\RequirePackage`, the sources named by `\input`, `\include`, `\subfile`,
  `\InputIfFileExists`, `\import` and `\subimport`, and the bibliographies named by
  `\bibliography` and `\addbibresource`. A source is found from the main file's folder, which is
  TeX's working folder, and a class or package from the folders above it or anywhere in the
  repository, the shallowest first. Only `.tex`, `.cls`, `.sty`, `.def`, `.clo`, `.fd` and `.bib`
  files are taken. A name built by a macro is not followed, and a symbolic link or a submodule is
  not a file. A document of more than 40 files or 2 MB is not taken.
- Its assets are the names of the fonts (`.otf`, `.ttf`, `.pfb`) and images (`.png`, `.jpg`,
  `.jpeg`, `.pdf`, `.eps`, `.svg`) in the main file's folder and the folders under it, at most
  200, never their content. A PDF named as the main file is, beside it, is the document compiled
  and is not an asset. Item 2's survey counts them; item 8 matches font names to the tree.

### The caps

- `jake` 50, `awesome-cv` 40, `altacv` 20, `moderncv` 30, `europecv` 10 and `other` 70, 220 in
  all, so that `other`, the hand-rolled and messy documents that decide the editable rate, is a
  third of the corpus.
- Candidates are considered in the order of their repositories' names, so that each family takes
  its first qualifying candidates by name, whatever order GitHub ranked them in, and a rerun over
  the same candidates takes the same ones. A family stops at its cap; a fork is not even read once
  its upstream's family is full.
- A family still short of its cap once every candidate has been considered leaves its room to
  `other`, which takes the next candidates it passed over for being full, in the same order.

### Licences

- A document records the SPDX id GitHub reports for its repository, or null when GitHub reports
  none or NOASSERTION, and nothing more: the licence is recorded, not judged.
- The corpus is used for local and CI testing only and never redistributed, which is the rule for
  a document under no licence and is kept for every document alike: it is fetched into an ignored
  folder, read by tests and the runner, and published nowhere, in no fixture, artifact, answer or
  cache entry.

### Privacy

- Tests never quote a corpus document: they run on invented documents in invented `example/`
  repositories, served by a fake GitHub through the fetch function the scripts take.
- The scripts print counts, repository names, paths, hashes and sizes, never a document's text;
  the fetch's report holds ids, states and paths.

### When a repository disappears

- `fetch` marks a document whose file GitHub no longer has, or whose repository is gone, private
  or blocked, `unavailable` in `.corpus/fetch-report.json`, which lists every document's state, and
  prints it. That is not an error, and the runner leaves the document out. A file that differs
  from its hash is an error, and so is one that could not be downloaded at all; the fetch exits 1
  for either, and writes nothing of the file.
- The manifest keeps an unavailable document, so ids never move. A later `collect` reads the
  report and counts the document's place in its family as free, so it appends a replacement under
  a new id and the corpus keeps its size.

## Consequences

- The first collection, on 26 September 2026, took 220 documents: `jake` 50, `awesome-cv` 40,
  `altacv` 20, `moderncv` 30, `europecv` 10 and `other` 70, so no family fell short and none left
  room to `other`. They hold 759 files and 7.3 MB: 490 `.tex`, 109 `.def`, 90 `.cls`, 55 `.sty`
  and 15 `.bib`. 116 documents are a single file, every `jake` one among them, while every
  `awesome-cv` one is several, 285 files and 3.6 MB between the 40; 90 documents carry a class of
  their own. Main files run from 1.1 KB to 97 KB, 6.8 KB the median. 145 documents name 1,741
  assets between them: 40 name fonts and 132 images.
- Licences: 151 of the 220 repositories report none; 41 MIT, 15 LPPL-1.3c, 5 Apache-2.0,
  4 GPL-3.0, 2 GPL-2.0, 1 ISC and 1 LGPL-3.0.
- The run took 26 minutes: about ten of code search at 10 requests a minute, which found 3,204
  repositories; one listing 5,340 forks; and about fifteen considering 6,313 of the 8,544
  candidates by name, when every family was full. 3,666 were rejected: 2,910 forks never pushed to, 375 with no
  whole document where one was looked for, 134 copies, 115 `other` documents that do not look
  like resumes, 71 not in Latin script, 48 main files under 1 KB and one over 200 KB, 9 forks
  within ten lines of a version of their upstream's samples, 2 gone and 1 upstream repository.
  2,427 more were passed over for a full family. The run never waited for a rate limit, and no
  candidate failed on a request.
- `fetch` from nothing takes about 20 s for the 7.3 MB and reproduced every hash; a second run
  downloads nothing. CI fetches the same way, and needs GitHub, with a token only for its rate.
- Taking candidates by name makes a rerun take the same ones, but the sample is not spread over
  GitHub: five families filled with owners whose names begin with a digit or an a, and only
  `europecv`, the scarcest, went further. A name says nothing of a document's content, so the
  sample is fair to the pipeline; ordering by a hash of the name would spread it and be as stable,
  if that ever matters.
- A fork is judged by its main file, so a fork whose edits are all in the sources its main file
  inputs, as an Awesome-CV fork's can be, with ten lines or fewer of the main file changed, is
  taken for unmodified. The `other` check gives up some real resumes to keep out what is not one:
  a resume in a repository named for something else, or naming fewer than two headings, is left
  out, and there are hundreds of candidates for the family's 70 places.
- The corpus loses a document when its repository goes, and a later `collect` replaces it. Raising
  a cap or adding a query and collecting again appends; starting again means deleting the
  manifest, and every id with it.
