#!/usr/bin/env bash
# The rules in AGENTS.md that a machine can check from the list of tracked files (decision 0020).
# Usage: bash .github/scripts/check-repo.sh
set -euo pipefail

# Patterns are relative to the root, wherever the script is run from.
cd "$(git rev-parse --show-toplevel)"

status=0

# Fails when any tracked file matches one of the patterns, naming the files and the reason.
forbid() {
  local reason=$1
  shift
  local hits
  hits=$(git ls-files -- "$@")
  if [ -n "$hits" ]; then
    echo "::error::$reason"
    echo "$hits" | sed 's/^/  /'
    status=1
  fi
}

forbid "A second package manager's lockfile. pnpm and uv are the only package managers." \
  '*package-lock.json' '*npm-shrinkwrap.json' '*yarn.lock' '*bun.lockb' '*bun.lock' \
  '*requirements*.txt' '*poetry.lock' '*Pipfile' '*Pipfile.lock'

forbid "An environment file. Only .env.example is committed; values live in .env or in secrets." \
  '.env' '.env.*' '*/.env' '*/.env.*' ':!:*.example'

forbid "An ESLint or Prettier configuration. Biome is the only TypeScript formatter and linter." \
  '*.eslintrc' '*.eslintrc.*' '*eslint.config.*' '*.prettierrc' '*.prettierrc.*' \
  '*prettier.config.*' '*.prettierignore'

forbid "Installed dependencies, build output or caches." \
  '*node_modules/*' 'dist/*' '*/dist/*' '*.venv/*' '*__pycache__/*' '*.pytest_cache/*' \
  '*.ruff_cache/*' '*.vite/*' '*.tsbuildinfo' 'apps/editor/.engine/*'

forbid "The corpus's documents or reports: real people's resumes, never committed (0017)." \
  'apps/editor/.corpus/*'

forbid "Python under apps/editor. Python belongs in apps/ats." \
  'apps/editor/*.py'

forbid "TypeScript under apps/ats. TypeScript belongs in apps/editor or packages/." \
  'apps/ats/*.ts' 'apps/ats/*.tsx' 'apps/ats/*.mts' 'apps/ats/*.cts'

if [ "$status" -eq 0 ]; then
  echo "Repository rules hold."
fi
exit "$status"
