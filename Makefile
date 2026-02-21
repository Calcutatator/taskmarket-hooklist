# Clawtasker monorepo - install, build, start services, lint, format
SHELL := /bin/bash
ENV_LOADER := [ -f .env ] && set -a && source .env && set +a; export NVM_DIR="$${NVM_DIR:-$$HOME/.nvm}" && [ -s "$$NVM_DIR/nvm.sh" ] && . "$$NVM_DIR/nvm.sh" && nvm install && nvm use

# Capture arguments for multi-word targets like: make start backend
ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))

.PHONY: help init install build dev start deploy lint-check lint-fix format-check format-fix type-check check fix test clean db pre-commit lint-check-all lint-fix-all format-check-all format-fix-all type-check-all smoke design-system

help:
	@echo "Clawtasker - Available targets:"
	@echo "  make                      - Show this help"
	@echo "  make init                 - Install all dependencies (uses Node from .nvmrc)"
	@echo "  make install              - Same as init"
	@echo "  make deploy <env>         - Deploy contracts (testnet|mainnet)"
	@echo "  make build <app|all>      - Build specific app or all (backend|frontend|shared|contracts|all)"
	@echo "  make dev                  - Start all dev servers in parallel"
	@echo "  make start <service>      - Start specific service (db|backend|frontend|anvil)"
	@echo "  make lint-check <app|all> - Check linting for specific app or all"
	@echo "  make lint-fix <app|all>   - Fix linting for specific app or all"
	@echo "  make format-check <app|all> - Check formatting for specific app or all"
	@echo "  make format-fix <app|all> - Fix formatting for specific app or all"
	@echo "  make type-check <app|all> - Type check specific app or all"
	@echo "  make check all            - Run all checks (lint + format + type-check)"
	@echo "  make fix all              - Fix all issues (lint + format)"
	@echo "  make test                 - Run all tests"
	@echo "  make clean                - Clean build artifacts"
	@echo "  make db <cmd>             - Database commands (start|stop|generate|migrate|push|seed|studio)"
	@echo "  make smoke <mode>         - Run smoke test (contest|instant|proposal|race)"
	@echo "  make pre-commit           - Run pre-commit checks"
	@echo "  make design-system        - Generate design tokens and copy to apps/frontend"

init:
	$(ENV_LOADER) && pnpm install

install: init

deploy:
	@$(ENV_LOADER) && \
	if [ "$(word 1,$(ARGS))" = "testnet" ]; then \
		cd packages/contracts && forge script script/DeployTestnet.s.sol:DeployTestnet \
			--rpc-url base_sepolia \
			--broadcast \
			--verify; \
	elif [ "$(word 1,$(ARGS))" = "mainnet" ]; then \
		cd packages/contracts && forge script script/Deploy.s.sol:DeployScript \
			--rpc-url base \
			--broadcast \
			--verify; \
	else \
		echo "Usage: make deploy <testnet|mainnet>"; \
		exit 1; \
	fi

build:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make build <backend|frontend|shared|contracts|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo build; \
	elif [ "$(word 1,$(ARGS))" = "backend" ]; then \
		pnpm --filter @clawtasker/backend build; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		pnpm --filter @clawtasker/frontend build; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		pnpm --filter @clawtasker/shared build; \
	elif [ "$(word 1,$(ARGS))" = "contracts" ]; then \
		forge build --root packages/contracts; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make build <backend|frontend|shared|contracts|all>"; \
		exit 1; \
	fi

dev:
	$(ENV_LOADER) && pnpm turbo dev

start:
	@$(ENV_LOADER) && \
	if [ "$(word 1,$(ARGS))" = "db" ]; then \
		cd platform/dev && docker compose up -d postgres; \
	elif [ "$(word 1,$(ARGS))" = "backend" ]; then \
		pnpm --filter @clawtasker/backend dev; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		pnpm --filter @clawtasker/frontend dev; \
	elif [ "$(word 1,$(ARGS))" = "anvil" ]; then \
		anvil; \
	else \
		echo "Usage: make start <db|backend|frontend|anvil>"; \
		exit 1; \
	fi

lint-check:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make lint-check <backend|frontend|shared|contracts|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo lint:check; \
	elif [ "$(word 1,$(ARGS))" = "backend" ]; then \
		cd apps/backend && pnpm lint:check; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		cd apps/frontend && pnpm lint:check; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		cd packages/shared && pnpm lint:check; \
	elif [ "$(word 1,$(ARGS))" = "contracts" ]; then \
		cd packages/contracts && pnpm fmt:check; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make lint-check <backend|frontend|shared|contracts|all>"; \
		exit 1; \
	fi

lint-fix:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make lint-fix <backend|frontend|shared|contracts|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo lint:write; \
	elif [ "$(word 1,$(ARGS))" = "backend" ]; then \
		cd apps/backend && pnpm lint:write; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		cd apps/frontend && pnpm lint:write; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		cd packages/shared && pnpm lint:write; \
	elif [ "$(word 1,$(ARGS))" = "contracts" ]; then \
		cd packages/contracts && pnpm fmt; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make lint-fix <backend|frontend|shared|contracts|all>"; \
		exit 1; \
	fi

format-check:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make format-check <backend|frontend|shared|contracts|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo format:check; \
	elif [ "$(word 1,$(ARGS))" = "backend" ]; then \
		cd apps/backend && pnpm format:check; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		cd apps/frontend && pnpm format:check; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		cd packages/shared && pnpm format:check; \
	elif [ "$(word 1,$(ARGS))" = "contracts" ]; then \
		cd packages/contracts && pnpm fmt:check; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make format-check <backend|frontend|shared|contracts|all>"; \
		exit 1; \
	fi

format-fix:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make format-fix <backend|frontend|shared|contracts|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo format:write; \
	elif [ "$(word 1,$(ARGS))" = "backend" ]; then \
		cd apps/backend && pnpm format:write; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		cd apps/frontend && pnpm format:write; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		cd packages/shared && pnpm format:write; \
	elif [ "$(word 1,$(ARGS))" = "contracts" ]; then \
		cd packages/contracts && pnpm fmt; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make format-fix <backend|frontend|shared|contracts|all>"; \
		exit 1; \
	fi

type-check:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make type-check <backend|frontend|shared|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo type-check; \
	elif [ "$(word 1,$(ARGS))" = "backend" ]; then \
		cd apps/backend && pnpm type-check; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		cd apps/frontend && pnpm type-check; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		cd packages/shared && pnpm type-check; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make type-check <backend|frontend|shared|all>"; \
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
		cd apps/backend && pnpm db:generate; \
	elif [ "$(word 1,$(ARGS))" = "migrate" ]; then \
		cd apps/backend && pnpm db:migrate; \
	elif [ "$(word 1,$(ARGS))" = "push" ]; then \
		cd apps/backend && pnpm db:push; \
	elif [ "$(word 1,$(ARGS))" = "seed" ]; then \
		cd apps/backend && pnpm db:seed; \
	elif [ "$(word 1,$(ARGS))" = "studio" ]; then \
		cd apps/backend && pnpm db:studio; \
	else \
		echo "Usage: make db <start|stop|generate|migrate|push|seed|studio>"; \
		exit 1; \
	fi

smoke:
	@$(ENV_LOADER) && \
	if [ "$(word 1,$(ARGS))" = "contest" ]; then \
		cd apps/backend && pnpm smoke:contest; \
	elif [ "$(word 1,$(ARGS))" = "instant" ]; then \
		cd apps/backend && pnpm smoke:instant; \
	elif [ "$(word 1,$(ARGS))" = "proposal" ]; then \
		cd apps/backend && pnpm smoke:proposal; \
	elif [ "$(word 1,$(ARGS))" = "race" ]; then \
		cd apps/backend && pnpm smoke:race; \
	else \
		echo "Usage: make smoke <contest|instant|proposal|race>"; \
		exit 1; \
	fi

design-system:
	@$(ENV_LOADER) && \
	pnpm --filter @clawtasker/design-system generate && \
	cp packages/design-system/build/tailwind/base.css apps/frontend/src/styles/css/base.css && \
	cp packages/design-system/build/tailwind/dark.css apps/frontend/src/styles/css/dark.css && \
	cp packages/design-system/build/tailwind/tailwind.base.js apps/frontend/tailwind.base.js

pre-commit:
	@echo "Running pre-commit checks..."
	@echo "Checking linting..."
	@$(MAKE) lint-check all || (echo "Linting failed. Run 'make lint-fix all' to fix." && exit 1)
	@echo "Checking formatting..."
	@$(MAKE) format-check all || (echo "Formatting check failed. Run 'make format-fix all' to fix." && exit 1)
	@echo "Checking types..."
	@$(MAKE) type-check all || (echo "Type check failed." && exit 1)
	@echo "All pre-commit checks passed."

# Catch-all for extra arguments (e.g. make start backend)
%:
	@:
