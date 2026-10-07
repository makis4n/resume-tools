# 0078. A speed spike: two engines and the edited page first

Date: 2026-10-07 · Status: accepted, under the owner's decision 4 of 6 October 2026: a spike only,
measured and written up, nothing built

## Context

Decision 0074 left two ways to make the import and the typing faster that cost too much to try
blind (its fix 9). One is to compile a bisection's two halves at once on two engines: bisections
are 64% of pdfTeX's import time and 55% of XeTeX's, and an import's compiles run one at a time on
the one compile worker. The other is to show the edited page as soon as the engine has written it,
rather than when the whole document is set: `altacv-0017` (7 pages) and `other-0028` (17) are the
slowest resumes to type in, at 546 and 451 ms. The owner asked for three numbers: what a second
engine costs in memory, what the halves on two engines would win, and how soon the edited page
could show. This record reads its own measurements only, never a resume. It names resumes by id.

## Decision

### How it was measured

On the M4 Pro, on main (`ad0a73e`), with scratch code that stays local: a hook in the probe's and
the checks' bisections and a few scripts, none committed. Each run went through the heavy-job
queue on its own, with other lanes' work beside it, at the one-minute loads given.

- **Memory.** In Node, one engine session as the import and the tests start it, warmed by
  importing Jake's upstream sample (pdfTeX) or Awesome-CV's (XeTeX), then a second session beside
  it, warmed the same. After each step, with the JS heap collected: RSS, the JS heap, the engine's
  WebAssembly memory and the bytes its file system holds. Load 4.3 to 5.6.
- **Halves.** `corpus run --json` over all 220 documents with every bisection compile logged: its
  bisection, a hash of its set, the set's size, its time and its verdict, and each split's parts.
  `corpus compare` finds the run the same as main's on all 220, times aside. Load 5.5 to 6.2, 6.5
  minutes. A simulation then replays each import's log on two engines. Engine A runs what the
  serial order asks for, as today, so every verdict is applied in today's order. When a set splits,
  engine B starts the next part at once: the second half, or the next candidate the compile named,
  then the rest. Whenever B is free it takes the part announced last that A has not reached, which
  in a depth-first bisection is the one A asks for soonest. A request for a set that B has compiled
  waits for B instead of compiling. A part A never asks for is wasted. A part's time is its serial
  compile's, or its parent's where A never compiled it.
- **Two engines at once.** Two processes compiled Jake's upstream sample 15 times each, first
  alone, then together: 164 and 166 ms a compile, a ratio of 0.99 to 1.03, at a load of 4.7 to
  4.9. So the simulation applies no slowdown.
- **The order on one engine.** The 14 slow resumes (`slow.txt` and `europecv-0008`) were imported
  again with each split's second part compiled before its first and kept until the serial order
  asked for it. That is the order engine B would run them in. Load 5.4.
- **The page.** A resume was imported and opened as the app opens it, on a session that notes when
  each byte of its DVI reaches the output file. Then a field was edited five times on the first
  page that has a field, and five times on the last, as the typing timing edits (its last
  character retyped). For each edit's compile, the record notes when each page's bytes were all
  written, against the whole compile. This was done on `altacv-0017`, `other-0028`, `altacv-0014`
  and an invented 3-page look-alike of AltaCV's upstream sample (its Experience and Projects
  sections repeated before its page break), which was never written to the repository. Load 2.3
  to 6.3.

### A second engine's memory

| | pdfTeX, Jake's sample | XeTeX, Awesome-CV's sample |
|---|--:|--:|
| The engine's WebAssembly memory | 512 MB | 512 MB |
| The session's copy of its first 64 MB, restored after every run | 64.7 MB | 64.7 MB |
| TeX Live files read into its file system | 8.3 MB, 90 files | 67.7 MB, 475 files |
| The session's JS heap | 34 to 37 MB | 34 to 37 MB |
| RSS, one engine warmed | 1,176 MB | 1,415 MB |
| RSS, two engines warmed | 1,826 MB | 2,178 MB |
| **The second engine's cost** | **+650 MB** | **+763 MB** |

- The second engine costs what the first does, since the two share nothing but code. The
  WebAssembly memory is 512 MB from the start and never grew in these runs. The session zeroes all
  of it after every run, so all of it stays resident.
- In the browser, each worker also holds its own fonts for reading output, which the Node run
  shared between its sessions; Awesome-CV's import grew that heap by 65 MB. So a second worker
  should cost about 620 MB on pdfTeX and 740 MB on XeTeX. The browser was not measured for this
  record. A scratch page that reads each worker's WebAssembly memory and heap is left in the
  spike's worktree.
- RSS on this machine moves with its swap, which was nearly full, so the parts are the firmer
  numbers.

### A bisection's halves on two engines

Every imported resume, from the logged run:

| | Today, this run | Two engines |
|---|--:|--:|
| pdfTeX, 91: the page within 8 s | 66 | 71 |
| pdfTeX: the page, median and slowest | 3.8 s, 47.4 s | 3.3 s, 32.7 s |
| pdfTeX: every field open, slowest | 72.6 s | 50.7 s |
| pdfTeX: the whole import within 8 s, median, slowest | 56, 5.6 s, 135.8 s | 60, 4.6 s, 89.7 s |
| pdfTeX: all 91 imports | 1,087 s | 829 s (−24%) |
| XeTeX, 19: the page within 20 s, slowest | 17, 25.3 s | 19, 18.6 s |
| XeTeX: the whole import, slowest | 43.0 s | 29.0 s |
| XeTeX: all 19 imports | 360 s | 284 s (−21%) |
| Engine B's compiles: started, used, wasted | | pdfTeX 1,296, 1,179, 117 (33.6 s); XeTeX 477, 461, 16 (3.5 s) |

The 14 slow resumes:

| Resume | Bisection compiles | The page, today → two engines | The whole import | Wasted |
|---|--:|---|---|--:|
| `altacv-0017` | 157 | 36.2 → 26.9 s | 135.8 → 89.7 s (−34%) | 11 |
| `other-0028` | 155 | 47.4 → 32.7 s | 110.9 → 72.7 s (−34%) | 10 |
| `other-0032` (XeTeX) | 135 | 19.2 → 14.1 s | 43.0 → 29.0 s (−33%) | 2 |
| `other-0020` (XeTeX) | 123 | 25.3 → 18.6 s | 37.6 → 27.3 s (−27%) | 9 |
| `altacv-0014` | 96 | 18.2 → 13.4 s | 34.8 → 24.5 s (−30%) | 2 |
| `moderncv-0007` | 105 | 24.0 → 17.2 s | 34.2 → 24.7 s (−28%) | 9 |
| `moderncv-0013` | 114 | 23.5 → 15.3 s | 32.9 → 22.4 s (−32%) | 2 |
| `moderncv-0002` | 73 | 19.6 → 14.2 s | 32.9 → 23.4 s (−29%) | 0 |
| `altacv-0002` | 64 | 20.4 → 14.4 s | 29.0 → 20.9 s (−28%) | 0 |
| `altacv-0005` | 71 | 14.7 → 10.8 s | 27.3 → 20.2 s (−26%) | 0 |
| `other-0006` | 132 | 12.4 → 8.8 s | 25.3 → 17.0 s (−33%) | 4 |
| `moderncv-0023` | 61 | 11.8 → 8.8 s | 22.3 → 16.3 s (−27%) | 1 |
| `other-0015` | 155 | 12.9 → 7.9 s | 21.3 → 12.8 s (−40%) | 5 |
| `europecv-0008` | 92 | 14.3 → 10.1 s | 16.9 → 12.3 s (−27%) | 5 |
| All 14 | 1,533 | 299.8 → 213.2 s (−29%) | 604.1 → 413.1 s (−32%) | 60, 24.7 s |

- Each bisection loses about a third of its time, not half. On pdfTeX the probe loses 34%, check
  1 34%, check 2 38% and check 3 29%. A part's own split has to wait for that part's verdict, so B
  is often idle. A median pdfTeX import gains 15% (XeTeX 17%); an import with no bisection gains
  nothing, and the most any gains is 40%.
- Little is wasted. A bisection asks for both halves of every set it splits. B's work is lost only
  where the budget runs out first, or where a candidate found failing alone is held apart and the
  rest is then compiled without it. The out-of-order run measured the waste the simulation
  guessed: 55 parts and 25.8 s on the 14, against 60 parts and 24.7 s.
- **Not every verdict stays the same.** In the out-of-order run, 104 of the 14 resumes' 106
  bisections ended with the same verdicts, and words in place and fields were the same in all 14.
  Every probe, check 1 and check 2 bisection was the same. Two of check 3's were not. In
  `moderncv-0023`, a trial that broke the page after its predecessor kept it after another, so one
  group is no longer fixed for its copy. In `other-0028`, a half that broke passed, so check 3
  leaves 42 groups untried, not 83. The probe starts every compile from the auxiliary files its
  baseline wrote, so a set's verdict depends on the set alone. The checks compile one outline after
  another in one job, so each compile starts from the `.aux` the last one left, and a trial that
  copies or removes an entry changes it. Today, on one engine, check 3's verdicts already depend on
  the order of its trials. Two engines would change which trial comes before which.

### The edited page first

| Resume, pages | Page edited | The compile | That page's bytes written | The page's own time today | With the page read first |
|---|---|--:|--:|--:|--:|
| `altacv-0017`, 7 | 1 | 525 ms | 308 ms (59%) | 564 ms | about 317 ms |
| `altacv-0017`, 7 | 6, the last with a field | 524 ms | 520 ms (99%) | 562 ms | no gain |
| `other-0028`, 17 | 2, the first with a field | 421 ms | 155 ms (37%) | 476 ms | about 160 ms |
| `other-0028`, 17 | 17 | 402 ms | 398 ms (99%) | 451 ms | no gain |
| `altacv-0014`, 2 | 1 and 2 | 327 ms | 323 ms (99%) | 340 ms | no gain |
| AltaCV look-alike, 3 | 1 and 2 | 316 to 323 ms | 312 to 314 ms (97 to 99%) | 323 to 331 ms | no gain |

- Each edit took one pass. "With the page read first" adds two things to the bytes' time: the
  body's making before the compile (3 ms) and the draw of that one page, about a seventh of the 36
  ms that drawing all seven pages takes (a seventeenth of 47 ms for `other-0028`).
- The default DVI buffer is fine-grained enough. With TeX's buffer cut from 16 KB to 800 bytes,
  `altacv-0017`'s first page was written at 302 of 511 ms, the same share, because a page here is
  13 to 31 KB.
- Where a page is written depends on how the class sets the document, not on its length. AltaCV's
  upstream sample sets its columns with paracol. In the 2- and 3-page AltaCV resumes measured,
  every page reached the file in the last 4 ms of the pass. On `altacv-0017`, page 1 came at
  59% of the pass and the rest one by one after it.
- XeTeX's XDV is written the same way. No long XeTeX resume was measured.

### What it would take, and the recommendation

- **Two engines: do not build.** They would take about a quarter off every import with a
  bisection: five more pdfTeX pages within 8 s, all 19 XeTeX pages within 20 s, and the slowest
  pdfTeX import from 136 to 90 s. Against that, the cost:
  - Some 650 to 760 MB more memory a tab, against the plan's settled host: one worker, one engine
    loaded at a time, to keep memory down on old laptops (section 8).
  - A second worker that holds the import's format and files.
  - Check 3 made independent of order.

  The run's targets do not need two engines. Decision 0074's slowest-import target, under 100 s, is
  expected from check 3 stopping when its budget cannot cover the groups left (F1), at no memory
  cost. Should the wait become the bottleneck again, first make each of check 3's trials start from
  the same auxiliary files, as the probe's compiles do. Then start a second worker only while an
  import runs, close it after, and measure the browser's memory on a smaller machine before
  deciding.
- **The edited page first: do not build.** It wins only on long resumes and only for an edit near
  their start. `altacv-0017`'s first page would come in about 317 ms rather than 564, and
  `other-0028`'s second in about 160 rather than 476. It wins nothing for an edit on a last page,
  or on AltaCV resumes whose columns hold every page until the end. The typing targets (at least
  104 of 108 resumes within 300 ms, the slowest under 700 ms) hold without it. To build it, the
  worker would note the output file's growth from inside TeX's run and post each page's bytes once
  the next page begins. The page would read a DVI or XDV with no postamble and draw that page
  alone, its overlay laid out on it, and the rest when the compile ends. A pass that is not the
  last, or a compile that stops, would have to take the early page back. That is a large change
  in `src/engine/` and the page.

## Consequences

- Nothing is built. The plan's host stays one worker with one engine, and the edit's page is still
  drawn once its compile ends.
- Check 3's verdicts depend on the order of its trials, because its compiles carry the auxiliary
  files of the trial before. This is a follow-up in `src/import/checks.ts` whatever becomes of two
  engines: it changed one group's verdict in `moderncv-0023` and how many groups `other-0028`
  leaves untried, though no word in place.
- The browser's memory for one and two workers is still to be read from the scratch page, with the
  pane displayed. It is expected near Node's parts, plus each worker's fonts.
- No change to `src/import/`, the corpus scripts or the engine's tree is committed, so no corpus
  run follows from this record.
