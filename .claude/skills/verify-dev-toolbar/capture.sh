#!/usr/bin/env sh
# Persist one piece of evidence. Reads the artifact body on stdin.
#
#   .claude/skills/verify-dev-toolbar/capture.sh flags override-applied.json <<'EOF'
#   { ... the probe output you just read ... }
#   EOF
#
# Prints the path it wrote. Artifacts live outside the skill directory, under
# a run id, so `cleanup` can drop instances without touching proof.
#
# The run id is *persisted*, not re-derived: shell state does not survive
# between tool calls, so an exported variable would mint a new
# second-resolution directory on every call and scatter one run's artifacts
# across a dozen of them. It is resolved in this order:
#
#   1. $VERIFY_RUN_ID, if set — an explicit id always wins.
#   2. .verify-artifacts/.current-run, written by the first call of the run.
#   3. A fresh id from the clock, recorded in .current-run for later calls.
#
# Start a new run deliberately with `capture.sh --new-run`, which mints an id,
# records it and prints it, writing no artifact.
set -eu

usage() {
  echo "usage: capture.sh [--force] <feature> <filename>   (body on stdin)" >&2
  echo "       capture.sh --new-run                        (start a fresh run id)" >&2
}

root=$(git rev-parse --show-toplevel)
base="$root/.verify-artifacts"
marker="$base/.current-run"

new_run() {
  mkdir -p "$base"
  id=$(date '+%Y%m%d-%H%M%S')
  printf '%s\n' "$id" > "$marker"
  printf '%s\n' "$id"
}

force=0
case "${1:-}" in
  --new-run) [ $# -eq 1 ] || { usage; exit 2; }; new_run; exit 0 ;;
  --force) force=1; shift ;;
  -*) usage; exit 2 ;;
esac

[ $# -eq 2 ] || { usage; exit 2; }

# `<feature>` and `<filename>` are path *segments*, not paths: a `/` or a `..`
# in either would write outside .verify-artifacts/.
for arg in "$1" "$2"; do
  case "$arg" in
    "" | . | .. | */* | *..*)
      echo "capture.sh: '$arg' is not a valid path segment (no '/' or '..')" >&2
      exit 2
      ;;
  esac
done

if [ -n "${VERIFY_RUN_ID:-}" ]; then
  run=$VERIFY_RUN_ID
  case "$run" in
    "" | . | .. | */* | *..*)
      echo "capture.sh: VERIFY_RUN_ID='$run' is not a valid path segment" >&2
      exit 2
      ;;
  esac
elif [ -f "$marker" ]; then
  run=$(cat "$marker")
else
  run=$(new_run)
fi

dir="$base/$run/$1"
mkdir -p "$dir"
out="$dir/$2"

# Never clobber evidence quietly: a re-run of the same step is either a
# deliberate overwrite or a filename collision between two different proofs.
if [ -e "$out" ] && [ "$force" -eq 0 ]; then
  echo "capture.sh: $out already exists — pick another filename, or pass --force" >&2
  exit 3
fi
[ -e "$out" ] && echo "capture.sh: overwriting $out (--force)" >&2

cat > "$out"
echo "$out"
