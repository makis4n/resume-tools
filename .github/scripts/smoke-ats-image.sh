#!/usr/bin/env bash
# Starts the ATS image and checks it answers as the service does: healthy, a PDF analysed, anything
# else refused (decision 0020). Usage: bash .github/scripts/smoke-ats-image.sh <image>
set -euo pipefail

# Paths are relative to the root, wherever the script is run from.
cd "$(git rev-parse --show-toplevel)"

image=${1:?usage: smoke-ats-image.sh <image>}
port=${SMOKE_PORT:-18000}
url="http://127.0.0.1:$port"
work=$(mktemp -d)

# Not --rm: a container that crashes on start must stay long enough for its logs to be read.
container=$(docker run --detach --publish "127.0.0.1:$port:8000" "$image")
cleanup() {
  docker rm --force "$container" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

for _ in $(seq 1 30); do
  if curl --silent --fail --max-time 2 "$url/health" >/dev/null; then
    break
  fi
  sleep 1
done
if ! curl --silent --fail --max-time 2 "$url/health"; then
  echo "::error::The service never answered /health."
  docker logs "$container"
  exit 1
fi
echo

# The contract's schemas; the image's replies must match them as the service's do.
contracts=packages/contracts/ats/v1

# Checks a JSON file against a schema, with the same pinned tool as the repo workflow.
matches() {
  uvx --quiet --exclude-newer 2026-09-26T00:00:00Z check-jsonschema@0.38.2 \
    --schemafile "$1" "$2" >/dev/null
}

status=0

# Posts a file with a media type to /v1/analyze, and checks the reply's status, its body against
# a schema and, for an error, its code.
expect() {
  local file=$1 type=$2 want=$3 schema=$4 code=${5:-} got
  rm -f "$work/body.json"
  got=$(curl --silent --max-time 10 --output "$work/body.json" --write-out '%{http_code}' \
    --form "file=@$file;type=$type" "$url/v1/analyze" || true)
  echo "$(basename "$file") as $type: HTTP $got $(cat "$work/body.json" 2>/dev/null || true)"
  if [ "$got" != "$want" ]; then
    echo "::error::Expected HTTP $want."
    status=1
  elif ! matches "$schema" "$work/body.json"; then
    echo "::error::The reply does not match $schema."
    status=1
  elif [ -n "$code" ] && ! grep -q "\"code\": *\"$code\"" "$work/body.json"; then
    echo "::error::Expected the error code $code."
    status=1
  fi
}

# Invented bytes with a PDF's signature; the placeholder analysis reads nothing else.
printf '%%PDF-1.4\n%%%%EOF\n' >"$work/resume.pdf"
printf 'not a pdf\n' >"$work/notes.txt"

expect "$work/resume.pdf" application/pdf 200 "$contracts/analysis.schema.json"
expect "$work/notes.txt" text/plain 415 "$contracts/error.schema.json" not-a-pdf
# Declared a PDF but without the signature, so only the signature check refuses it.
expect "$work/notes.txt" application/pdf 415 "$contracts/error.schema.json" not-a-pdf

if [ "$status" -ne 0 ]; then
  docker logs "$container"
fi
exit "$status"
