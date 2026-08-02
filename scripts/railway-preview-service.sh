#!/usr/bin/env bash

set -euo pipefail

ensure_service() {
  local service_name="$1"
  local repository="${2:-}"
  local attempt add_output
  local -a add_command=(railway add --service "$service_name")

  if [[ -n "$repository" ]]; then
    add_command+=(--repo "$repository")
  fi
  add_command+=(--json)

  for attempt in $(seq 1 3); do
    if add_output=$("${add_command[@]}" 2>&1); then
      echo "$add_output"
      return 0
    fi
    if grep -q "already exists" <<< "$add_output"; then
      echo "$service_name already exists -- reusing this PR's service."
      return 0
    fi
    if [[ "$attempt" -eq 3 ]]; then
      echo "$add_output" >&2
      return 1
    fi
    echo "railway add --service $service_name attempt $attempt failed, retrying: $add_output" >&2
    sleep 10
  done
}

deploy_service() {
  local service_name="$1"
  local environment_name="$2"
  local project_id="$3"
  local source_directory="${4:-.}"
  local attempt

  for attempt in $(seq 1 5); do
    if (
      cd "$source_directory"
      railway up --service "$service_name" \
        --environment "$environment_name" \
        --project "$project_id" \
        --detach --ci
    ); then
      return 0
    fi
    if [[ "$attempt" -eq 5 ]]; then
      echo "railway up --service $service_name still failing after 5 attempts" >&2
      return 1
    fi
    sleep 5
  done
}

link_environment() {
  local project_id="$1"
  local workspace_id="$2"
  local environment_name="$3"
  local service_name="$4"
  local attempt link_output

  # Railway returns from environment duplication before every cloned service is
  # consistently queryable. Retry the link used by subsequent service operations.
  for attempt in $(seq 1 10); do
    if link_output=$(railway link \
      --project "$project_id" \
      --workspace "$workspace_id" \
      --environment "$environment_name" \
      --service "$service_name" \
      --json 2>&1); then
      echo "$link_output"
      return 0
    fi
    if [[ "$attempt" -eq 10 ]]; then
      echo "$link_output" >&2
      return 1
    fi
    echo "railway link for $environment_name/$service_name attempt $attempt failed, retrying: $link_output" >&2
    sleep 3
  done
}

case "${1:-}" in
  ensure)
    shift
    ensure_service "$@"
    ;;
  deploy)
    shift
    deploy_service "$@"
    ;;
  link)
    shift
    link_environment "$@"
    ;;
  *)
    echo "Usage: $0 <ensure SERVICE [REPOSITORY] | deploy SERVICE ENVIRONMENT PROJECT [SOURCE_DIRECTORY] | link PROJECT WORKSPACE ENVIRONMENT SERVICE>" >&2
    exit 2
    ;;
esac
