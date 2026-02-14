# Stakework monorepo - install, build, start services, lint, format
SHELL := /bin/bash
ENV_LOADER := [ -f .env ] && set -a && source .env && set +a; export NVM_DIR="$${NVM_DIR:-$$HOME/.nvm}" && [ -s "$$NVM_DIR/nvm.sh" ] && . "$$NVM_DIR/nvm.sh" && nvm install && nvm use

# Capture arguments for multi-word targets like: make start api
ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))

.PHONY: help init install build dev start lint-check lint-fix format-check format-fix type-check check fix test clean db pre-commit

help:
	@echo "Stakework - Available targets:"
	@echo "  make                      - Show this help"
	@echo "  make init                 - Install all dependencies (uses Node from .nvmrc)"
	@echo "  make install              - Same as init"
	@echo "  make build <app|all>      - Build specific app or all (api, cli, frontend, docs, shared, contracts, all)"
	@echo "  make dev                  - Start all dev servers in parallel"
	@echo "  make start <service>      - Start specific service (db, api, frontend, docs, cli, anvil)"
	@echo "  make lint-check <app|all> - Check linting for specific app or all"
	@echo "  make lint-fix <app|all>   - Fix linting for specific app or all"
	@echo "  make format-check <app|all> - Check formatting for specific app or all"
	@echo "  make format-fix <app|all> - Fix formatting for specific app or all"
	@echo "  make type-check <app|all> - Type check specific app or all"
	@echo "  make check all            - Run all checks (lint + format + type-check)"
	@echo "  make fix all              - Fix all issues (lint + format)"
	@echo "  make test                 - Run all tests"
	@echo "  make clean                - Clean build artifacts"
	@echo "  make db <cmd>             - Database commands (start, stop, migrate, seed, studio)"
	@echo "  make pre-commit           - Run pre-commit checks"

init:
	$(ENV_LOADER) && pnpm install

install: init

build:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make build <api|cli|frontend|docs|shared|contracts|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo build; \
	elif [ "$(word 1,$(ARGS))" = "api" ]; then \
		pnpm --filter @stakework/api build; \
	elif [ "$(word 1,$(ARGS))" = "cli" ]; then \
		pnpm --filter @stakework/cli build; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		pnpm --filter @stakework/frontend build; \
	elif [ "$(word 1,$(ARGS))" = "docs" ]; then \
		pnpm --filter @stakework/docs build; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		pnpm --filter @stakework/shared build; \
	elif [ "$(word 1,$(ARGS))" = "contracts" ]; then \
		cd packages/contracts && pnpm build; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make build <api|cli|frontend|docs|shared|contracts|all>"; \
		exit 1; \
	fi

dev:
	$(ENV_LOADER) && pnpm turbo dev

start:
	@$(ENV_LOADER) && \
	if [ "$(word 1,$(ARGS))" = "db" ]; then \
		cd platform/dev && docker compose up -d postgres; \
	elif [ "$(word 1,$(ARGS))" = "api" ]; then \
		cd apps/api && pnpm dev; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		cd apps/frontend && pnpm dev; \
	elif [ "$(word 1,$(ARGS))" = "docs" ]; then \
		cd apps/docs && pnpm dev; \
	elif [ "$(word 1,$(ARGS))" = "cli" ]; then \
		cd apps/cli && pnpm dev; \
	elif [ "$(word 1,$(ARGS))" = "anvil" ]; then \
		anvil; \
	else \
		echo "Usage: make start <db|api|frontend|docs|cli|anvil>"; \
		exit 1; \
	fi

lint-check:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make lint-check <api|cli|frontend|docs|shared|contracts|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo lint:check; \
	elif [ "$(word 1,$(ARGS))" = "api" ]; then \
		cd apps/api && pnpm lint:check; \
	elif [ "$(word 1,$(ARGS))" = "cli" ]; then \
		cd apps/cli && pnpm lint:check; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		cd apps/frontend && pnpm lint:check; \
	elif [ "$(word 1,$(ARGS))" = "docs" ]; then \
		cd apps/docs && pnpm lint:check; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		cd packages/shared && pnpm lint:check; \
	elif [ "$(word 1,$(ARGS))" = "contracts" ]; then \
		cd packages/contracts && pnpm fmt:check; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make lint-check <api|cli|frontend|docs|shared|contracts|all>"; \
		exit 1; \
	fi

lint-fix:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make lint-fix <api|cli|frontend|docs|shared|contracts|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo lint:write; \
	elif [ "$(word 1,$(ARGS))" = "api" ]; then \
		cd apps/api && pnpm lint:write; \
	elif [ "$(word 1,$(ARGS))" = "cli" ]; then \
		cd apps/cli && pnpm lint:write; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		cd apps/frontend && pnpm lint:write; \
	elif [ "$(word 1,$(ARGS))" = "docs" ]; then \
		cd apps/docs && pnpm lint:write; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		cd packages/shared && pnpm lint:write; \
	elif [ "$(word 1,$(ARGS))" = "contracts" ]; then \
		cd packages/contracts && pnpm fmt; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make lint-fix <api|cli|frontend|docs|shared|contracts|all>"; \
		exit 1; \
	fi

format-check:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make format-check <api|cli|frontend|docs|shared|contracts|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo format:check; \
	elif [ "$(word 1,$(ARGS))" = "api" ]; then \
		cd apps/api && pnpm format:check; \
	elif [ "$(word 1,$(ARGS))" = "cli" ]; then \
		cd apps/cli && pnpm format:check; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		cd apps/frontend && pnpm format:check; \
	elif [ "$(word 1,$(ARGS))" = "docs" ]; then \
		cd apps/docs && pnpm format:check; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		cd packages/shared && pnpm format:check; \
	elif [ "$(word 1,$(ARGS))" = "contracts" ]; then \
		cd packages/contracts && pnpm fmt:check; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make format-check <api|cli|frontend|docs|shared|contracts|all>"; \
		exit 1; \
	fi

format-fix:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make format-fix <api|cli|frontend|docs|shared|contracts|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo format:write; \
	elif [ "$(word 1,$(ARGS))" = "api" ]; then \
		cd apps/api && pnpm format:write; \
	elif [ "$(word 1,$(ARGS))" = "cli" ]; then \
		cd apps/cli && pnpm format:write; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		cd apps/frontend && pnpm format:write; \
	elif [ "$(word 1,$(ARGS))" = "docs" ]; then \
		cd apps/docs && pnpm format:write; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		cd packages/shared && pnpm format:write; \
	elif [ "$(word 1,$(ARGS))" = "contracts" ]; then \
		cd packages/contracts && pnpm fmt; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make format-fix <api|cli|frontend|docs|shared|contracts|all>"; \
		exit 1; \
	fi

type-check:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make type-check <api|cli|frontend|shared|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo type-check; \
	elif [ "$(word 1,$(ARGS))" = "api" ]; then \
		cd apps/api && pnpm type-check; \
	elif [ "$(word 1,$(ARGS))" = "cli" ]; then \
		cd apps/cli && pnpm type-check; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		cd apps/frontend && pnpm type-check; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		cd packages/shared && pnpm type-check; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make type-check <api|cli|frontend|shared|all>"; \
		exit 1; \
	fi

lint-check-all:
	$(ENV_LOADER) && pnpm turbo lint:check

lint-fix-all:
	$(ENV_LOADER) && pnpm turbo lint:write

format-check-all:
	$(ENV_LOADER) && pnpm turbo format:check

format-fix-all:
	$(ENV_LOADER) && pnpm turbo format:write

type-check-all:
	$(ENV_LOADER) && pnpm turbo type-check

check:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make check all"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo lint:check && pnpm turbo format:check && pnpm turbo type-check; \
	else \
		echo "Unknown option: $(word 1,$(ARGS))"; \
		echo "Usage: make check all"; \
		exit 1; \
	fi

fix:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make fix all"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo lint:write && pnpm turbo format:write; \
	else \
		echo "Unknown option: $(word 1,$(ARGS))"; \
		echo "Usage: make fix all"; \
		exit 1; \
	fi

test:
	$(ENV_LOADER) && pnpm turbo test

clean:
	$(ENV_LOADER) && pnpm turbo clean
	@find . -name "dist" -type d -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true

db:
	@$(ENV_LOADER) && \
	if [ "$(word 1,$(ARGS))" = "start" ]; then \
		cd platform/dev && docker compose up -d postgres; \
	elif [ "$(word 1,$(ARGS))" = "stop" ]; then \
		cd platform/dev && docker compose stop postgres; \
	elif [ "$(word 1,$(ARGS))" = "generate" ]; then \
		cd apps/api && pnpm db:generate; \
	elif [ "$(word 1,$(ARGS))" = "migrate" ]; then \
		cd apps/api && pnpm db:migrate; \
	elif [ "$(word 1,$(ARGS))" = "push" ]; then \
		cd apps/api && pnpm db:push; \
	elif [ "$(word 1,$(ARGS))" = "seed" ]; then \
		cd apps/api && pnpm db:seed; \
	elif [ "$(word 1,$(ARGS))" = "studio" ]; then \
		cd apps/api && pnpm db:studio; \
	else \
		echo "Usage: make db <start|stop|generate|migrate|push|seed|studio>"; \
		exit 1; \
	fi

pre-commit:
	@echo "Running pre-commit checks..."
	@echo "Checking linting..."
	@$(MAKE) lint-check all || (echo "Linting failed. Run 'make lint-fix all' to fix." && exit 1)
	@echo "Checking formatting..."
	@$(MAKE) format-check all || (echo "Formatting check failed. Run 'make format-fix all' to fix." && exit 1)
	@echo "Checking types..."
	@$(MAKE) type-check all || (echo "Type check failed." && exit 1)
	@echo "All pre-commit checks passed."

# Catch-all for extra arguments (e.g. make start api)
%:
	@:
