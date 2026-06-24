# Taskmarket monorepo - install, build, start services, lint, format
SHELL := /bin/bash
ENV_LOADER := [ -f .env ] && set -a && source .env && set +a; export NVM_DIR="$${NVM_DIR:-$$HOME/.nvm}"; if [ -s "$$NVM_DIR/nvm.sh" ]; then . "$$NVM_DIR/nvm.sh" && nvm install && nvm use; fi

# Capture arguments for multi-word targets like: make start backend
ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))

.PHONY: help init install build dev start deploy release upgrade lint-check lint-fix format-check format-fix type-check check fix test contract ui-ci ui-ci-install-browsers clean db pre-commit lint-check-all lint-fix-all format-check-all format-fix-all type-check-all smoke design-system deploy-email-worker email-worker

help:
	@echo "Taskmarket - Available targets:"
	@echo "  make                      - Show this help"
	@echo "  make init                 - Install all dependencies (uses Node from .nvmrc)"
	@echo "  make install              - Same as init"
	@echo "  make deploy <env>         - Deploy contracts (testnet|mainnet)"
	@echo "  make release              - Tag and push a production release (deploys backend + frontend)"
	@echo "  make build <app|all>      - Build specific app or all (backend|frontend|web|docs|shared|contracts|all)"
	@echo "  make dev                  - Start all dev servers in parallel"
	@echo "  make start <service>      - Start specific service (db|backend|frontend|web|mock-api|mock-web|docs|anvil)"
	@echo "  make lint-check <app|all> - Check linting for specific app or all"
	@echo "  make lint-fix <app|all>   - Fix linting for specific app or all"
	@echo "  make format-check <app|all> - Check formatting for specific app or all"
	@echo "  make format-fix <app|all> - Fix formatting for specific app or all"
	@echo "  make type-check <app|all> - Type check specific app or all"
	@echo "  make check all            - Run all checks (lint + format + type-check)"
	@echo "  make fix all              - Fix all issues (lint + format)"
	@echo "  make test                 - Run all tests"
	@echo "  make contract <cmd>       - Contract tools (audit|coverage|coverage-check|snapshot|snapshot-check|doc|test|test-ci|pause|unpause|accept-ownership)"
	@echo "  make ui-ci                - Run production web UI regression checks"
	@echo "  make ui-ci-install-browsers - Install browsers for UI regression checks"
	@echo "  make clean                - Clean build artifacts"
	@echo "  make db <cmd>             - Database commands (start|stop|generate|migrate|push|seed|studio)"
	@echo "  make smoke <mode> [testnet] - Run smoke test against localhost (or testnet with 'testnet' flag)"
	@echo "  make pre-commit           - Run pre-commit checks"
	@echo "  make design-system        - Generate design tokens and copy to apps/frontend"
	@echo "  make upgrade <testnet|mainnet> - Upgrade contract implementation (proxy address unchanged)"
	@echo "  make deploy-email-worker  - Deploy Cloudflare Email Worker"

init:
	$(ENV_LOADER) && pnpm install
	git submodule update --init --recursive

install: init

deploy:
	@$(ENV_LOADER) && \
	TMPFILE=$$(mktemp) && \
	if [ "$(word 1,$(ARGS))" = "testnet" ]; then \
		CHAINID=84532; \
		cd packages/contracts && forge script script/DiamondDeploy.s.sol:DiamondDeploy \
			--rpc-url base_sepolia \
			--broadcast \
			--verify 2>&1 | tee $$TMPFILE; \
	elif [ "$(word 1,$(ARGS))" = "mainnet" ]; then \
		CHAINID=8453; \
		cd packages/contracts && forge script script/DiamondDeploy.s.sol:DiamondDeploy \
			--rpc-url base \
			--broadcast \
			--verify 2>&1 | tee $$TMPFILE; \
	else \
		rm -f $$TMPFILE; \
		echo "Usage: make deploy <testnet|mainnet>"; \
		exit 1; \
	fi; \
	PROXY=$$(grep "Diamond deployed at:" $$TMPFILE | awk '{print $$NF}'); \
	rm -f $$TMPFILE; \
	if [ -n "$$PROXY" ]; then \
		echo "" && echo "Verifying proxy on Basescan (chain $$CHAINID, $$PROXY)..." && \
		RESP=$$(curl -s "https://api.etherscan.io/v2/api?chainid=$$CHAINID&module=contract&action=verifyproxycontract&address=$$PROXY&apikey=$$FORGE_ETHERSCAN_API_KEY") && \
		GUID=$$(echo "$$RESP" | grep -o '"result":"[^"]*"' | head -1 | cut -d'"' -f4) && \
		if [ -n "$$GUID" ]; then \
			echo "Proxy verification submitted (GUID: $$GUID). Waiting 10s..." && \
			sleep 10 && \
			curl -s "https://api.etherscan.io/v2/api?chainid=$$CHAINID&module=contract&action=checkproxyverification&guid=$$GUID&apikey=$$FORGE_ETHERSCAN_API_KEY" | grep -o '"result":"[^"]*"' | head -1 | cut -d'"' -f4; \
		else \
			echo "Proxy verification response: $$RESP"; \
		fi; \
	fi

upgrade:
	@$(ENV_LOADER) && \
	if [ "$(word 1,$(ARGS))" = "testnet" ]; then \
		cd packages/contracts && forge script script/DiamondFullUpgrade.s.sol:DiamondFullUpgrade \
			--rpc-url base_sepolia \
			--broadcast \
			--verify; \
	elif [ "$(word 1,$(ARGS))" = "mainnet" ]; then \
		cd packages/contracts && forge script script/DiamondFullUpgrade.s.sol:DiamondFullUpgrade \
			--rpc-url base \
			--broadcast \
			--verify; \
	else \
		echo "Usage: make upgrade <testnet|mainnet>"; \
		exit 1; \
	fi

release:
	@LAST=$$(git tag --sort=-version:refname | grep "^v[0-9]" | head -1); \
	if [ -z "$$LAST" ]; then \
		NEXT="v0.1.0"; \
	else \
		VER="$${LAST#v}"; \
		MAJOR=$$(echo "$$VER" | cut -d. -f1); \
		MINOR=$$(echo "$$VER" | cut -d. -f2); \
		PATCH=$$(echo "$$VER" | cut -d. -f3); \
		NEXT_PATCH=$$((PATCH + 1)); \
		NEXT="v$${MAJOR}.$${MINOR}.$${NEXT_PATCH}"; \
	fi; \
	echo "Creating tag $$NEXT..."; \
	git tag "$$NEXT"; \
	git push origin "$$NEXT"; \
	echo "Released $$NEXT"

build:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make build <backend|frontend|web|docs|shared|contracts|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo build; \
	elif [ "$(word 1,$(ARGS))" = "backend" ]; then \
		pnpm --filter @taskmarket/backend build; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		pnpm --filter @taskmarket/frontend build; \
	elif [ "$(word 1,$(ARGS))" = "web" ]; then \
		pnpm --filter @taskmarket/web build; \
	elif [ "$(word 1,$(ARGS))" = "docs" ]; then \
		pnpm --filter @taskmarket/docs build; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		pnpm --filter @taskmarket/shared build; \
	elif [ "$(word 1,$(ARGS))" = "contracts" ]; then \
		forge build --root packages/contracts; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make build <backend|frontend|web|docs|shared|contracts|all>"; \
		exit 1; \
	fi

dev:
	$(ENV_LOADER) && pnpm turbo dev

start:
	@$(ENV_LOADER) && \
	if [ "$(word 1,$(ARGS))" = "db" ]; then \
		cd platform/dev && docker compose up -d postgres; \
	elif [ "$(word 1,$(ARGS))" = "backend" ]; then \
		pnpm --filter @taskmarket/backend dev; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		pnpm --filter @taskmarket/frontend dev; \
	elif [ "$(word 1,$(ARGS))" = "web" ]; then \
		pnpm --filter @taskmarket/web dev; \
	elif [ "$(word 1,$(ARGS))" = "mock-api" ]; then \
		pnpm --filter @taskmarket/backend exec tsx ../../apps/web/e2e/mock-api.ts; \
	elif [ "$(word 1,$(ARGS))" = "mock-web" ]; then \
		MOCK_API_PORT="$${E2E_MOCK_API_PORT:-$${TASKMARKET_MOCK_API_PORT:-3101}}"; \
		PORT="$${TASKMARKET_MOCK_WEB_PORT:-3002}" \
		NEXT_PUBLIC_API_URL="http://127.0.0.1:$$MOCK_API_PORT" \
		TASKMARKET_API_URL="http://127.0.0.1:$$MOCK_API_PORT" \
		pnpm --filter @taskmarket/web dev; \
	elif [ "$(word 1,$(ARGS))" = "docs" ]; then \
		pnpm --filter @taskmarket/docs dev; \
	elif [ "$(word 1,$(ARGS))" = "anvil" ]; then \
		anvil; \
	else \
		echo "Usage: make start <db|backend|frontend|web|mock-api|mock-web|docs|anvil>"; \
		exit 1; \
	fi

lint-check:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make lint-check <backend|frontend|web|docs|shared|contracts|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo lint:check; \
	elif [ "$(word 1,$(ARGS))" = "backend" ]; then \
		cd apps/backend && pnpm lint:check; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		cd apps/frontend && pnpm lint:check; \
	elif [ "$(word 1,$(ARGS))" = "web" ]; then \
		cd apps/web && pnpm lint:check; \
	elif [ "$(word 1,$(ARGS))" = "docs" ]; then \
		cd apps/docs && pnpm lint:check; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		cd packages/shared && pnpm lint:check; \
	elif [ "$(word 1,$(ARGS))" = "contracts" ]; then \
		cd packages/contracts && pnpm lint:check; \
	elif [ "$(word 1,$(ARGS))" = "email-worker" ]; then \
		cd apps/email-worker && pnpm lint:check; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make lint-check <backend|frontend|web|docs|shared|contracts|email-worker|all>"; \
		exit 1; \
	fi

lint-fix:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make lint-fix <backend|frontend|web|docs|shared|contracts|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo lint:write; \
	elif [ "$(word 1,$(ARGS))" = "backend" ]; then \
		cd apps/backend && pnpm lint:write; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		cd apps/frontend && pnpm lint:write; \
	elif [ "$(word 1,$(ARGS))" = "web" ]; then \
		cd apps/web && pnpm lint:write; \
	elif [ "$(word 1,$(ARGS))" = "docs" ]; then \
		cd apps/docs && pnpm lint:write; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		cd packages/shared && pnpm lint:write; \
	elif [ "$(word 1,$(ARGS))" = "contracts" ]; then \
		cd packages/contracts && pnpm run format:write; \
	elif [ "$(word 1,$(ARGS))" = "email-worker" ]; then \
		cd apps/email-worker && pnpm lint:write; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make lint-fix <backend|frontend|web|docs|shared|contracts|email-worker|all>"; \
		exit 1; \
	fi

format-check:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make format-check <backend|frontend|web|docs|shared|contracts|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo format:check; \
	elif [ "$(word 1,$(ARGS))" = "backend" ]; then \
		cd apps/backend && pnpm format:check; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		cd apps/frontend && pnpm format:check; \
	elif [ "$(word 1,$(ARGS))" = "web" ]; then \
		cd apps/web && pnpm format:check; \
	elif [ "$(word 1,$(ARGS))" = "docs" ]; then \
		cd apps/docs && pnpm format:check; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		cd packages/shared && pnpm format:check; \
	elif [ "$(word 1,$(ARGS))" = "contracts" ]; then \
		cd packages/contracts && pnpm run format:check; \
	elif [ "$(word 1,$(ARGS))" = "email-worker" ]; then \
		cd apps/email-worker && pnpm format:check; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make format-check <backend|frontend|web|docs|shared|contracts|email-worker|all>"; \
		exit 1; \
	fi

format-fix:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make format-fix <backend|frontend|web|docs|shared|contracts|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo format:write; \
	elif [ "$(word 1,$(ARGS))" = "backend" ]; then \
		cd apps/backend && pnpm format:write; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		cd apps/frontend && pnpm format:write; \
	elif [ "$(word 1,$(ARGS))" = "web" ]; then \
		cd apps/web && pnpm format:write; \
	elif [ "$(word 1,$(ARGS))" = "docs" ]; then \
		cd apps/docs && pnpm format:write; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		cd packages/shared && pnpm format:write; \
	elif [ "$(word 1,$(ARGS))" = "contracts" ]; then \
		cd packages/contracts && pnpm run format:write; \
	elif [ "$(word 1,$(ARGS))" = "email-worker" ]; then \
		cd apps/email-worker && pnpm format:write; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make format-fix <backend|frontend|web|docs|shared|contracts|email-worker|all>"; \
		exit 1; \
	fi

type-check:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make type-check <backend|frontend|web|shared|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo type-check; \
	elif [ "$(word 1,$(ARGS))" = "backend" ]; then \
		cd apps/backend && pnpm type-check; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		cd apps/frontend && pnpm type-check; \
	elif [ "$(word 1,$(ARGS))" = "web" ]; then \
		cd apps/web && pnpm type-check; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		cd packages/shared && pnpm type-check; \
	elif [ "$(word 1,$(ARGS))" = "email-worker" ]; then \
		cd apps/email-worker && pnpm type-check; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make type-check <backend|frontend|web|shared|email-worker|all>"; \
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

contract:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make contract <audit|coverage|coverage-check|snapshot|snapshot-check|doc|test|test-ci|pause|unpause|accept-ownership>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "audit" ]; then \
		mkdir -p packages/contracts/reports && \
		cd packages/contracts && set -o pipefail && slither . --config-file slither.config.json 2>&1 | tee reports/slither-audit.md && \
		echo "Report written to packages/contracts/reports/slither-audit.md"; \
	elif [ "$(word 1,$(ARGS))" = "coverage" ]; then \
		mkdir -p packages/contracts/reports/coverage && \
		cd packages/contracts && forge coverage --ir-minimum --no-match-coverage "script/" --report summary --report lcov --lcov-version 2 --report-file reports/coverage/lcov.info && \
		echo "lcov report written to packages/contracts/reports/coverage/lcov.info"; \
	elif [ "$(word 1,$(ARGS))" = "coverage-check" ]; then \
		mkdir -p packages/contracts/reports/coverage && \
		cd packages/contracts && forge coverage --ir-minimum --no-match-coverage "script/" --report summary --report lcov --lcov-version 2 --report-file reports/coverage/lcov.info | tee /tmp/forge-coverage.txt && \
		echo "lcov report written to reports/coverage/lcov.info" && \
		bash scripts/check-coverage.sh /tmp/forge-coverage.txt; \
	elif [ "$(word 1,$(ARGS))" = "snapshot" ]; then \
		cd packages/contracts && forge snapshot; \
	elif [ "$(word 1,$(ARGS))" = "snapshot-check" ]; then \
		cd packages/contracts && forge snapshot --check --tolerance 1; \
	elif [ "$(word 1,$(ARGS))" = "doc" ]; then \
		cd packages/contracts && forge doc --out docs/natspec && \
		echo "Docs written to packages/contracts/docs/natspec"; \
	elif [ "$(word 1,$(ARGS))" = "test" ]; then \
		cd packages/contracts && forge test --summary; \
	elif [ "$(word 1,$(ARGS))" = "test-ci" ]; then \
		cd packages/contracts && FOUNDRY_PROFILE=ci forge test --summary; \
	elif [ "$(word 1,$(ARGS))" = "pause" ]; then \
		{ [ -n "$$CONTRACT_ADDRESS" ] && [ -n "$$FORGE_DEV_PRIVATE_KEY" ] && [ -n "$$EVM_RPC_URL" ]; } || \
			{ echo "Error: CONTRACT_ADDRESS, FORGE_DEV_PRIVATE_KEY, and EVM_RPC_URL must be set"; exit 1; }; \
		cast send $$CONTRACT_ADDRESS "pause()" \
			--private-key $$FORGE_DEV_PRIVATE_KEY \
			--rpc-url $$EVM_RPC_URL; \
	elif [ "$(word 1,$(ARGS))" = "unpause" ]; then \
		{ [ -n "$$CONTRACT_ADDRESS" ] && [ -n "$$FORGE_DEV_PRIVATE_KEY" ] && [ -n "$$EVM_RPC_URL" ]; } || \
			{ echo "Error: CONTRACT_ADDRESS, FORGE_DEV_PRIVATE_KEY, and EVM_RPC_URL must be set"; exit 1; }; \
		cast send $$CONTRACT_ADDRESS "unpause()" \
			--private-key $$FORGE_DEV_PRIVATE_KEY \
			--rpc-url $$EVM_RPC_URL; \
	elif [ "$(word 1,$(ARGS))" = "accept-ownership" ]; then \
		{ [ -n "$$CONTRACT_ADDRESS" ] && [ -n "$$FORGE_DEV_PRIVATE_KEY" ] && [ -n "$$EVM_RPC_URL" ]; } || \
			{ echo "Error: CONTRACT_ADDRESS, FORGE_DEV_PRIVATE_KEY, and EVM_RPC_URL must be set"; exit 1; }; \
		cast send $$CONTRACT_ADDRESS "acceptOwnership()" \
			--private-key $$FORGE_DEV_PRIVATE_KEY \
			--rpc-url $$EVM_RPC_URL; \
	else \
		echo "Unknown command: $(word 1,$(ARGS))"; \
		echo "Usage: make contract <audit|coverage|coverage-check|snapshot|snapshot-check|doc|test|test-ci|pause|unpause|accept-ownership>"; \
		exit 1; \
	fi

ui-ci:
	$(ENV_LOADER) && \
	pnpm --filter @taskmarket/web lint:check && \
	pnpm --filter @taskmarket/web format:check && \
	pnpm --filter @taskmarket/shared build && \
	pnpm --filter @taskmarket/web type-check && \
	pnpm --filter @taskmarket/web test && \
	pnpm --filter @taskmarket/web build && \
	pnpm --filter @taskmarket/web test:e2e

ui-ci-install-browsers:
	$(ENV_LOADER) && cd apps/web && pnpm exec playwright install --with-deps chromium

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
	if [ "$(word 2,$(ARGS))" = "testnet" ]; then \
		SMOKE_API_URL="$$TESTNET_API_URL"; \
	else \
		SMOKE_API_URL="$$API_URL"; \
	fi && \
	if [ "$(word 1,$(ARGS))" = "bounty" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:bounty; \
	elif [ "$(word 1,$(ARGS))" = "claim" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:claim; \
	elif [ "$(word 1,$(ARGS))" = "pitch" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:pitch; \
	elif [ "$(word 1,$(ARGS))" = "benchmark" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:benchmark; \
	elif [ "$(word 1,$(ARGS))" = "auction" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:auction; \
	elif [ "$(word 1,$(ARGS))" = "identity" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:identity; \
	elif [ "$(word 1,$(ARGS))" = "agents" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:agents; \
	elif [ "$(word 1,$(ARGS))" = "inbox" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:inbox; \
	elif [ "$(word 1,$(ARGS))" = "wallet" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:wallet; \
	elif [ "$(word 1,$(ARGS))" = "withdraw" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:withdraw; \
	elif [ "$(word 1,$(ARGS))" = "encryption" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:encryption; \
	elif [ "$(word 1,$(ARGS))" = "xmtp" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:xmtp; \
	elif [ "$(word 1,$(ARGS))" = "xmtp-live" ]; then \
		cd apps/cli && API_URL="$$SMOKE_API_URL" pnpm smoke:xmtp-live; \
	elif [ "$(word 1,$(ARGS))" = "auction-types" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:auction-types; \
	elif [ "$(word 1,$(ARGS))" = "cancel-update" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:cancel-update; \
	elif [ "$(word 1,$(ARGS))" = "email" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:email; \
	elif [ "$(word 1,$(ARGS))" = "broadcast" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:broadcast; \
	elif [ "$(word 1,$(ARGS))" = "auction-full" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:auction-full; \
	elif [ "$(word 1,$(ARGS))" = "rater-agent-id" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:rater-agent-id; \
	elif [ "$(word 1,$(ARGS))" = "bids-inbox" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:bids-inbox; \
	elif [ "$(word 1,$(ARGS))" = "pending-actions" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:pending-actions; \
	elif [ "$(word 1,$(ARGS))" = "artifacts" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:artifacts; \
	elif [ "$(word 1,$(ARGS))" = "presigned-upload" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:presigned-upload; \
	elif [ "$(word 1,$(ARGS))" = "submission-hash" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:submission-hash; \
	elif [ "$(word 1,$(ARGS))" = "task-search" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:task-search; \
	elif [ "$(word 1,$(ARGS))" = "upgrade" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:upgrade; \
	elif [ "$(word 1,$(ARGS))" = "ranked-payout" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:ranked-payout; \
	elif [ "$(word 1,$(ARGS))" = "evaluator-timeout" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:evaluator-timeout; \
	elif [ "$(word 1,$(ARGS))" = "refund-expired" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:refund-expired; \
	else \
		echo "Usage: make smoke <bounty|claim|pitch|benchmark|auction|auction-types|auction-full|cancel-update|rater-agent-id|bids-inbox|pending-actions|artifacts|submission-hash|task-search|identity|agents|inbox|wallet|withdraw|encryption|xmtp|xmtp-live|email|broadcast|upgrade|ranked-payout|evaluator-timeout|refund-expired>"; \
		exit 1; \
	fi

design-system:
	@$(ENV_LOADER) && \
	pnpm --filter @taskmarket/design-system generate && \
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

deploy-email-worker:
	$(ENV_LOADER) && cd apps/email-worker && pnpm deploy

# Catch-all for extra arguments (e.g. make start backend)
%:
	@:
