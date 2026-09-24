# Editor

The browser editor for LaTeX resumes. Owner: @makis4n. The plan, including the build order, is in [../../docs/plan.md](../../docs/plan.md); the current milestone's plan is in [../../docs/milestone-2.md](../../docs/milestone-2.md).

```sh
pnpm install        # from the repository root
pnpm --filter @resume-tools/editor fetch-engine
pnpm dev
pnpm test
```

`fetch-engine` builds `.engine/`, which git ignores: the TeX engine compiled to WebAssembly and a TeX Live 2023 tree, one file per path, with a manifest. It downloads about 220 MB from a pinned BusyTeX release on GitHub the first time, checks every file against the hash recorded in `scripts/fetch-engine.ts`, and does nothing on later runs unless the pinned release or what the script writes changes, or you pass `--force`. Only one run builds at a time. `--from <dir>` takes the release files from a folder instead of downloading them. The dev server serves the result at `/engine/`.
