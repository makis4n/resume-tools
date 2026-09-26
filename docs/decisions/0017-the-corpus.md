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

- `apps/editor/corpus/manifest.json` names each document: an id, its family, its repository by
  name and by GitHub's number for it, the commit the repository's default branch was at when it
  was collected, the licence, the main file, each file to fetch with its SHA-256 and size, the
  names of its fonts, and how many images it has. Nothing of a document's content is committed,
  in the manifest or anywhere else.
- `corpus fetch` downloads every file at its commit, never from a branch, from
  raw.githubusercontent.com, or through the contents API when that host cannot be reached, eight
  at a time. A file is written under `apps/editor/.corpus/<id>/<path>`, which git ignores, only
  when its size and SHA-256 match, through a temporary name of its own, and one already there
  with the right hash is kept, so a second run downloads nothing. A file is read no further than
  its recorded size. CI fetches the same way.
- A path is relative, joined by `/`, with no empty, `.` or `..` part, no backslash and no control
  character, and no two paths of a document are one file on a disk that ignores case or Unicode
  normalisation, as macOS's and Windows' do by default. The schema refuses anything else;
  `collect` holds every path it takes to the same rule, a main file's and a class found anywhere
  in the repository alike; and `fetch` checks each path again, and that it stays inside the
  document's folder, before it writes.
- `collect` checks the manifest against the schema before it writes it, every time, and does not
  take a document the schema refuses; it prints why.
- An id is the family, a dash and a four-digit counter, given in the order documents are taken.
  The manifest keeps each family's counter, the number its next id gets, and an id comes from the
  counter alone, never from the highest id present, so no id is ever given twice, a withdrawn
  document's included. `corpus collect` extends the manifest: what it has stays, with its ids,
  but for withdrawals, and new documents are appended. Ids are never renumbered.

### Public repositories only

- The corpus holds public repositories only. Code search also finds files in the private
  repositories the token can read, this project's own among them, so a hit counts only when
  GitHub marks its repository public, and a repository counts only when GitHub says it is public;
  a private or internal one is as good as gone.
- The token goes to api.github.com alone. raw.githubusercontent.com is asked without it, so that
  no file of a private repository can be read there at all.
- A repository that turns private after its document was collected counts as unavailable, like
  one that is deleted, and its document is withdrawn (below).

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
- Candidates are considered in the order of the SHA-256 of their repositories' names, in lower
  case. The order is as stable as the names' own, so a rerun over the same candidates takes the
  same ones, and it spreads the corpus over GitHub, where the names' order filled five families
  with owners whose names begin with a digit or an a.

### How a document qualifies

- Its repository is public, as above.
- Its main file is a whole document, with `\documentclass`, `\begin{document}` and
  `\end{document}`; is 1 KB to 200 KB; and has under 2% of its letters outside Latin script. A
  main file is read no further than 200 KB and a document's files no further than 2 MB in all:
  one past that is refused, never held whole.
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
- One document per repository, the repository known by GitHub's number for it as well as by its
  name, so that one renamed since it was taken is not taken again: the first main file that
  qualifies, the shallowest first, then one named as a resume or CV, then by path. A fork's main
  file is looked for at its root and under `examples/`, where the upstreams keep theirs; a
  searched repository's among the files the search found.

### What a document is

- Its files are the main file, then every file of its repository that it loads, followed three
  files deep: the classes named by `\documentclass` and `\LoadClass`, the packages named by
  `\usepackage` and `\RequirePackage`, the sources named by `\input`, `\include`, `\subfile`,
  `\InputIfFileExists`, `\import` and `\subimport`, and the bibliographies named by
  `\bibliography` and `\addbibresource`. A source is found from the main file's folder, which is
  TeX's working folder, and a class or package from the folders above it or anywhere in the
  repository, the shallowest first. Only `.tex`, `.cls`, `.sty`, `.def`, `.clo`, `.fd` and `.bib`
  files are taken. A name built by a macro is not followed, nor one whose brackets do not close
  within 8 KB, which keeps reading a source linear in its length; and a symbolic link or a
  submodule is not a file. A document of more than 40 files or 2 MB is not taken.
- Its assets are the names of the fonts (`.otf`, `.ttf`, `.pfb`) in the main file's folder and
  the folders under it, at most 200, never their content; item 8 matches them to the tree. Its
  images there (`.png`, `.jpg`, `.jpeg`, `.pdf`, `.eps`, `.svg`) are counted and never named, as
  an image's name, a photo's most of all, can say whose it is; item 2's survey counts them. A PDF
  named as the main file is, beside it, is the document compiled and is not an image.

### The caps

- `jake` 50, `awesome-cv` 40, `altacv` 20, `moderncv` 30, `europecv` 10 and `other` 70, 220 in
  all, so that `other`, the hand-rolled and messy documents that decide the editable rate, is a
  third of the corpus.
- A family stops at its cap. A repository is passed over for a full family only when the first
  of its main files that qualifies is of a full family, or when its screen read every main file
  it has and each one that passed is of a full family, so that examining it could take nothing:
  the family of the first file the screen passes never settles it alone. A fork is not even read
  once its upstream's family is full.
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
  the fetch's report holds ids, repositories, commits, states and paths. Every line they print
  goes through one function, which writes a control character as its code point, so that a
  hostile file name cannot put an escape to the terminal.
- The manifest keeps each document's main file and file paths, since `fetch` needs them, and a
  path may carry a person's name, as a resume is often saved under its owner's. This repository
  is private, so they are seen by those who can see it and no one else; were it made public, the
  paths would be looked at again first. Images are counted rather than named for the same
  reason, and a document whose repository goes away is withdrawn, which takes its name and paths
  out of the manifest.

### When a repository disappears

- `fetch` asks GitHub, once for each document on every run, whether its repository is still
  there, public, and the one collected, by its number: a machine that fetched the corpus long ago
  learns so without downloading anything. A document whose repository is gone, private, blocked
  or another one now, or one of whose files GitHub no longer has at the commit, is `unavailable`
  in `.corpus/fetch-report.json`, which lists every document's state, and is printed, and its
  folder is removed, since its owner took it down. That is not an error, and the runner leaves
  the document out. A file that differs from its hash is an error, and so is one that could not
  be downloaded at all; the fetch exits 1 for either, and writes nothing of the file.
- Each of the report's entries names the repository and commit it is about, besides the id and
  the state. `collect` and `fetch --only` take an entry's word only while those match the
  document the manifest has under that id, and `fetch` drops an entry that does not when it
  writes the report, so that a report left by another manifest is not taken for this one.
- A later `collect` withdraws a document the report marks unavailable: its entry becomes its id,
  its family and `"withdrawn": true`, and its repository, commit, licence, main file, files,
  fonts and images go. Its place in its family is free, so `collect` appends a replacement under
  a new id and the corpus keeps its size; the id itself is never given again. `fetch` skips a
  withdrawn document and removes its folder.
- A document's folder holds `.pinned`, which names the repository and commit its files are from.
  A folder without it, or naming another, is emptied before a file is written, and once every
  file of the document verifies, anything else in its folder goes, so that a folder never mixes
  two documents' files, nor keeps a stopped run's partial write.
- Starting again means deleting the manifest and `.corpus/` together: a new manifest's counters
  start at 1 again, and its ids name other documents than the old folders do.

## Consequences

- The collection, on 26 September 2026, took 220 documents: `jake` 50, `awesome-cv` 40,
  `altacv` 20, `moderncv` 30, `europecv` 10 and `other` 70, so no family fell short and none left
  room to `other`. They hold 670 files and 6.5 MB: 451 `.tex`, 95 `.cls`, 56 `.def`, 47 `.sty`
  and 21 `.bib`. 115 documents are a single file, 48 of the 50 `jake` ones among them, while every
  `awesome-cv` one is several, 281 files and 3.2 MB between the 40; 94 documents carry a class of
  their own. Main files run from 1.0 KB to 56 KB, 7.7 KB the median. 35 documents name 502 fonts
  between them, and 144 have 1,184 images. The owners' names begin with 27 different characters.
- Licences: 144 of the 220 repositories report none; 44 MIT, 20 LPPL-1.3c, 2 each Apache-2.0,
  CC-BY-SA-4.0 and GPL-3.0, and 1 each BSD-2-Clause, BSD-3-Clause, CC-BY-4.0, CC0-1.0, EUPL-1.2
  and MPL-2.0.
- The run took 21 minutes: about seven of code search at 10 requests a minute, which found 3,205
  public repositories and left out one file in a repository that is not public; one listing 5,340
  forks; and about twelve considering 3,527 of the 8,545 candidates in their order, when every
  family was full. 2,029 were rejected: 1,595 forks never pushed to, 212 with no whole document
  where one was looked for, 70 `other` documents that do not look like resumes, 67 copies, 59 not
  in Latin script, 21 main files under 1 KB, 2 forks within ten lines of a version of their
  upstream's samples, 2 gone and 1 upstream repository. 1,278 more were passed over for a full
  family. The run never waited for a rate limit, no candidate failed on a request, and the schema
  refused none.
- `fetch` from nothing takes 25 s for the 6.5 MB and reproduced every hash; a second run takes 9 s,
  downloads nothing, and asks GitHub once for each of the 220 repositories. So `fetch` needs a
  token for its rate, which `gh auth token` gives it, and CI with its own: GitHub allows 60
  requests an hour without one.
- A code search candidate is examined, at three requests of the hourly 5,000, whenever a file
  its screen passed is of a family with room, and whenever its screen stopped at such a file
  while reading ahead and the family filled before its turn. Taking the family of the first file
  the screen passes as the repository's, as the first collection did, cost nothing, and lost a
  repository whose first file is no resume and whose second is one of a family with room.
- A fork is judged by its main file, so a fork whose edits are all in the sources its main file
  inputs, as an Awesome-CV fork's can be, with ten lines or fewer of the main file changed, is
  taken for unmodified. The `other` check gives up some real resumes to keep out what is not one:
  a resume in a repository named for something else, or naming fewer than two headings, is left
  out, and there are hundreds of candidates for the family's 70 places.
- The corpus loses a document when its repository goes or turns private; the next `collect` on
  a machine that has fetched since withdraws it and replaces it. Raising a cap or adding a query
  and collecting again appends.
