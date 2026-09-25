# 0011. TeX Live packages from the archive

Date: 2026-09-25 · Status: accepted

## Context

The engine's TeX Live tree is what BusyTeX's release holds: TeX Live 2023's scheme-basic with the
LaTeX and XeTeX collections, and four Ubuntu bundles of LaTeX packages and fonts (decision 0003,
milestone 2 item 1). It lacks what AltaCV and Awesome-CV need: pgf and TikZ, Font Awesome 5, Lato,
Roboto and Source Sans Pro. The milestone settles that the tree is BusyTeX's TeX Live 2023,
extended from TeX Live 2023's final package archive; item 19 does it, in
`apps/editor/scripts/fetch-engine.ts` and `scripts/tlpdb.ts`.

## Decision

- **The archive.** TeX Live 2023's network archive as it was when TeX Live 2024 replaced it,
  `tlnet-final`, from the historic mirror at `ftp.math.utah.edu`. It has to be 2023's, the year
  of the engine and of the bundles, since a format or a package of another year disagrees with
  them; and a historic archive no longer changes, so what the script pins stays there.
- **What is pinned.** The archive's package database, `tlpkg/texlive.tlpdb`, by its SHA-256 and
  size, so that a database that differs is refused rather than read. It is the uncompressed copy,
  19.4 MB: the archive also serves it compressed with xz, but neither Node nor macOS's base system
  can decompress a bare xz file. And `PACKAGES`, the packages the tree takes, each with its
  revision and its container's size and SHA-512 as the database records them, which is what each
  container is checked against. A build reads nothing unpinned and not the database either, so the
  tree is the same on every machine.
- **What is taken.** `WANTED` names pgf, fontawesome5, lato, roboto and sourcesanspro, and what
  they need comes in two ways. `--resolve` follows the database's `depend` lines, leaving out
  collections, schemes and binaries (`.ARCH`). But TeX Live records few of those between ordinary
  packages, so the packages' style files are read by hand, from their `\RequirePackage` lines and
  the encodings they ask fontenc for, whenever `WANTED` changes, and what the bundles lack of what
  they load is named in `WANTED` too: mweights, which `roboto.sty` and `sourcesanspro.sty` load,
  and ly1, whose LY1 encoding `sourcesanspro.sty` asks fontenc for. pgfopts is named as well,
  since bundled packages such as beamertheme-metropolis and handin load it. A package whose every
  run file the bundles hold is left out. That gives nine packages, 44.9 MB of containers:
  fontawesome5 r63207 (0.9 MB), lato r54512 (12.7 MB), ly1 r63565 (55 KB), mweights r53520
  (1 KB), pgf r65553 (0.7 MB), pgfopts r56615 (2 KB), roboto r64350 (25.4 MB), sourcesanspro
  r54892 (5.2 MB), and xcolor r68864 (18 KB), which pgf depends on.
- **How it is refreshed.** Change `WANTED`, run `fetch-engine --resolve`, paste the list it prints
  over `PACKAGES`, and bump `LAYOUT`. `--resolve` mounts the bundles to list their files, reads
  the database, works the list out as above, and asks the archive for each container it names, so
  that a list the archive cannot serve is refused there rather than half way through a build. A
  database that differs from the pin is refused with its hash and size printed, to record when
  the archive is meant to change.
- **Where the files go.** Each container, `archive/<name>.r<revision>.tar.xz`, which is the name
  the archive serves it under, is unpacked into a folder of its own. A relocated container holds
  its files relative to `texmf-dist`, and they go into `/texlive/texmf-dist`, the tree kpathsea
  searches before the Ubuntu one; a package that is not relocated is refused, since it could
  install outside `texmf-dist`. The container's `tlpkg/tlpobj/<name>.tlpobj`, the package's own
  entry, is read for its run files and maps and dropped. What the tree gains is what the container
  holds; the run files the entry lists only check it. A file either tree holds already stays as
  the bundles gave it and is not shadowed, since the stock formats were dumped from the bundles'
  files and the templates read them; so xcolor, which the Ubuntu bundle holds at v2.14 without its
  rollback copy, keeps v2.14 and gains only `xcolor-2022-06-12.sty`. No `ls-R` is written: the
  session builds every tree's filename database from the manifest (`mountOnDemand`).
- **The map rule.** Decision 0009's merge takes the maps each package adds with `execute addMap`
  or `addMixedMap`, before the Ubuntu tree's, since the packages' files are in the tree searched
  first, by the same rule: an entry for a TeX font `pdftex.map` does not have yet, whose outline
  file the trees hold. A TrueType or OpenType file now counts as an outline file, since xdvipdfmx
  embeds them as it does Type 1, though the page reads only Type 1 (item 21). The four maps add
  2,752 entries, all naming Type 1 files; the Ubuntu tree's 150 are unchanged.
- **What stays out.** Documentation and source containers, binaries, since the engine is one
  binary of its own, and a newer TeX Live, which waits for milestone 5 and the engine build it
  needs.
- **No new dependency.** The system `tar` unpacks the containers: macOS's reads xz itself, and
  Ubuntu's through `xz`, which Ubuntu installs by default.

## Consequences

- A first build downloads 45 MB more, about 260 MB in all, and the tree grows from 17,087 files
  and 285 MB to 25,827 files and 429 MB. Roboto is 4,793 of the new files and 76 MB, Lato 1,834
  and 44 MB, Source Sans Pro 1,504 and 16 MB, most of them metrics and virtual fonts for each
  encoding, weight and figure style, and their OpenType files, which the XeTeX templates read.
- The session mounts every file of the manifest when it starts, so the engine starts later: in
  Node on an M4 Pro, 4.1 to 4.5 s against 2.7 to 2.9 s for the tree before; a compile costs the
  same. The manifest grows from 1.08 MB to 1.83 MB (94 KB to 129 KB with Brotli), and
  `pdftex.map`, which the page reads before it draws, from 83 KB to 489 KB (25 KB with Brotli).
  Item 23 measures the browser on the slow laptop; if the start costs too much there, the tree can
  keep only what the templates read, or the session can mount lazily.
- A first build, and CI on a cache miss, need the archive's host. CI keys its cached tree on
  `scripts/tlpdb.ts` as well.
- A package a style file loads, or an encoding it asks fontenc for, is found by reading the style
  files; `--resolve` does not read them. greek-fontenc is left out: only
  `sourcesanspro-type1-autoinst.sty` and Roboto's `\robotolgr` ask for its LGR encoding, and the
  templates use neither.
- xcolor stays at the bundles' v2.14, the version current when pgf 3.1.10 came out, while the
  archive's is v3.01; a template that needs the newer one would have to replace the bundle's, and
  every template would move with it.
