#!/bin/sh
set -eu

base_url=${1:-https://taskmarket.dev}
base_url=${base_url%/}
target_dir=${TASKMARKET_SKILL_DIR:-.agents/skills/taskmarket}
temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/taskmarket-skill.XXXXXX")
trap 'rm -rf -- "$temp_dir"' EXIT HUP INT TERM
payload_dir=$temp_dir/payload
manifest_file=$temp_dir/skill-manifest.txt

mkdir -p "$payload_dir"
curl -fsSL "$base_url/reference/skill-manifest.txt" -o "$manifest_file"

root_seen=0
while IFS= read -r file || [ -n "$file" ]; do
  [ -n "$file" ] || continue
  case "$file" in
    *..* | /* | *\\*)
      printf 'Invalid path in skill manifest: %s\n' "$file" >&2
      exit 1
      ;;
    skill.md)
      [ "$root_seen" -eq 0 ] || {
        printf 'Duplicate skill.md in skill manifest\n' >&2
        exit 1
      }
      destination=SKILL.md
      root_seen=1
      ;;
    modes/*.md | reference/*.md | examples/*.md)
      destination=$file
      ;;
    *)
      printf 'Unsupported path in skill manifest: %s\n' "$file" >&2
      exit 1
      ;;
  esac

  mkdir -p "$(dirname "$payload_dir/$destination")"
  curl -fsSL "$base_url/$file" -o "$payload_dir/$destination"
done < "$manifest_file"

[ "$root_seen" -eq 1 ] || {
  printf 'skill.md is missing from skill manifest\n' >&2
  exit 1
}

case "$target_dir" in
  '' | / | . | ./ | *..*)
    printf 'Unsafe Taskmarket skill target: %s\n' "$target_dir" >&2
    exit 1
    ;;
esac

[ ! -e "$target_dir" ] || [ -d "$target_dir" ] || {
  printf 'Taskmarket skill target is not a directory: %s\n' "$target_dir" >&2
  exit 1
}

mkdir -p "$target_dir"
for entry in SKILL.md modes reference examples; do
  owned_path=$target_dir/$entry
  if [ -e "$owned_path" ] || [ -L "$owned_path" ]; then
    rm -rf -- "$owned_path"
  fi
done
cp -R "$payload_dir/." "$target_dir/"
printf 'Installed Taskmarket skill at %s\n' "$target_dir"
