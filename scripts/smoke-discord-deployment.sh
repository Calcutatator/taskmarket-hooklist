#!/usr/bin/env bash
set -euo pipefail

: "${DISCORD_APP_URL:?DISCORD_APP_URL is required}"

health_url="${DISCORD_APP_URL%/}/health"
expected_commit="${EXPECTED_COMMIT_SHA:-}"
expected_environment="${EXPECTED_DEPLOY_ENVIRONMENT:-}"

for attempt in $(seq 1 40); do
  if body=$(curl --fail --silent --show-error --max-time 10 "$health_url" 2>/dev/null); then
    status=$(jq -r '.status // empty' <<<"$body")
    version=$(jq -r '.version // empty' <<<"$body")
    environment=$(jq -r '.environment // empty' <<<"$body")
    if [ "$status" = "ok" ] \
      && { [ -z "$expected_commit" ] || [ "$version" = "$expected_commit" ]; } \
      && { [ -z "$expected_environment" ] || [ "$environment" = "$expected_environment" ]; }; then
      echo "Discord app healthy: $environment $version"
      exit 0
    fi
  fi

  if [ "$attempt" -lt 40 ]; then
    sleep 5
  fi
done

echo "Discord app did not report the expected healthy deployment at $health_url" >&2
exit 1
