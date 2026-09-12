# CLAUDE.md

@AGENTS.md

Notes specific to Claude Code:

- Some machines have a pre-push hook that blocks `git push` until a review verdict is recorded
  for HEAD. If it fires, run the `adversarial-review` skill, which records a skip for trivial
  changes and reviews the rest, then push again. Never bypass it with `--no-verify`.
- Run the checks yourself before reporting a change as done; do not rely on CI to find out.
- When a change alters a decision, update `docs/decisions/` in the same commit, and say so in
  the final message.
- Prefer `pnpm --filter` and `uv run` over global tools, and keep to the commands in AGENTS.md.
