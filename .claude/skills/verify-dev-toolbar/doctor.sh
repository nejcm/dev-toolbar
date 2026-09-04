#!/usr/bin/env sh
# Read-only: is this checkout worth driving?
#
# Answers four questions and nothing else — it starts nothing, installs
# nothing, and writes nothing. Exit 0 means "drive it"; exit 1 means fix what
# is printed first. The browser half of the doctor is the agent-bridge read
# `window.__DEV_TOOLBAR__.instances["playground"].read()` (see SKILL.md).
set -u

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "FAIL  not a git checkout — run this from inside the dev-toolbar repo"
  exit 1
}
cd "$root" || exit 1
fail=0
say() { printf '%-5s %s\n' "$1" "$2"; }

# 1. Right repo. A verify run against some other project's :5273 proves nothing.
# bun, not node: every documented command in this repo is bun (`packageManager`
# pins bun@1.4.0), so bun is the runtime the reader already has.
name=$(bun -e 'process.stdout.write(require("./package.json").name)' 2>/dev/null || echo "")
if [ "$name" = "@nejcm/dev-toolbar" ]; then
  say OK "repo is @nejcm/dev-toolbar at $root"
else
  say FAIL "package.json name is '$name', expected @nejcm/dev-toolbar"
  fail=1
fi

# 2. The playground consumes `file:../..`, so a missing dist/ or a missing
#    install gives a blank page rather than an error worth reading.
if [ -f dist/index.js ] && [ -f dist/styles.css ]; then
  # UTC ISO on purpose: the page read's `loadedAt` is the same shape, so a tab
  # whose `loadedAt` sorts before this stamp is serving an older build.
  say OK "dist/ built $(date -u -r dist/index.js '+%Y-%m-%dT%H:%M:%SZ') — a tab whose \`loadedAt\` is earlier predates it"
  newer=$(find src -newer dist/index.js -name '*.ts*' -print -quit 2>/dev/null)
  [ -n "$newer" ] && say WARN "src/ is newer than dist/ ($newer) — \`bun run build\` or restart the preview"
else
  say FAIL "dist/ is missing — run \`bun run build\`"
  fail=1
fi
if [ -d examples/playground/node_modules/react ]; then
  say OK "playground deps installed"
else
  say FAIL "examples/playground/node_modules is missing — run \`bun run playground:install\`"
  fail=1
fi

# 3. Who owns :5273. An unrelated listener is the one failure mode that makes
#    every later assertion a lie, so name the process rather than guessing.
#    A listener under this checkout is not automatically yours either: it may
#    be a leftover from an earlier session, and SKILL.md forbids driving an
#    instance this run did not start.
pid=$(lsof -nP -iTCP:5273 -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -z "$pid" ]; then
  say OK ":5273 is free — start the preview: the \"playground\" entry in .claude/launch.json"
else
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
  case "$cwd" in
    "$root"*)
      say CHECK ":5273 held by pid $pid under this checkout — reuse it ONLY if this run started it"
      echo "      Your own \`preview_start\` result is the proof; without it this is somebody"
      echo "      else's session — stop, say so, and do not drive it."
      ;;
    *) say FAIL ":5273 held by pid $pid with cwd '$cwd' — not ours; do not drive it"; fail=1 ;;
  esac
fi

exit "$fail"
