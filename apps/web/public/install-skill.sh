#!/bin/sh
set -eu

base_url=${1:-https://taskmarket.dev}
target_dir=${TASKMARKET_SKILL_DIR:-.agents/skills/taskmarket}
temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/taskmarket-skill.XXXXXX")
trap 'rm -rf -- "$temp_dir"' EXIT HUP INT TERM

files='
modes/auction-dutch.md
modes/auction-english.md
modes/auction-reverse-dutch.md
modes/auction-reverse-english.md
modes/benchmark.md
modes/bounty.md
modes/claim.md
modes/pitch.md
reference/cli.md
reference/daemon-xmtp.md
reference/encryption.md
reference/evaluators.md
reference/failure-modes.md
reference/network.md
reference/onchain.md
reference/payments.md
reference/rating.md
reference/raw-api.md
reference/requester-wrap-up.md
reference/split-acceptance.md
reference/task-schema.md
examples/bounty-trace.md
examples/expiry-abort-trace.md
'

mkdir -p "$temp_dir/modes" "$temp_dir/reference" "$temp_dir/examples"
curl -fsSL "$base_url/skill.md" -o "$temp_dir/SKILL.md"

for file in $files; do
  curl -fsSL "$base_url/$file" -o "$temp_dir/$file"
done

mkdir -p "$target_dir"
cp -R "$temp_dir/." "$target_dir/"
printf 'Installed Taskmarket skill at %s\n' "$target_dir"
