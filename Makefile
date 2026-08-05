# Taskmarket monorepo - install, build, start services, lint, format
SHELL := /bin/bash
ENV_LOADER := [ -f .env ] && set -a && source .env && set +a; export NVM_DIR="$${NVM_DIR:-$$HOME/.nvm}"; if [ -s "$$NVM_DIR/nvm.sh" ]; then . "$$NVM_DIR/nvm.sh" && nvm install && nvm use; fi

# Capture arguments for multi-word targets like: make start backend
ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))

.PHONY: help init install build dev start storybook storybook-ci storybook-image storybook-image-smoke storybook-install-browsers deploy deploy-reward-hook swap-reward-hook release upgrade upgrade-accept-pinning lint-check lint-fix format-check format-fix type-check check fix test skill-conformance skill-export docs-og-check contract ci-quality-js ui-ci ui-ci-e2e ui-ci-install-browsers clean db pre-commit lint-check-all lint-fix-all format-check-all format-fix-all type-check-all smoke design-system deploy-email-worker email-worker cli dither-kit

help:
	@echo "Taskmarket - Available targets:"
	@echo "  make                      - Show this help"
	@echo "  make init                 - Install all dependencies (uses Node from .nvmrc)"
	@echo "  make install              - Same as init"
	@echo "  make deploy <env>         - Deploy contracts (testnet|mainnet|preview)"
	@echo "  make release              - Tag and push a production release (deploys backend + frontend)"
	@echo "  make build <app|all>      - Build specific app or all (backend|frontend|web|docs|shared|contracts|storybook|all); 'contracts' also regenerates abi/TaskMarket.json"
	@echo "  make dev [storybook]      - Start all dev servers, optionally with Storybook"
	@echo "  make start <service>      - Start specific service (db|backend|frontend|web|mock-api|mock-web|docs|anvil|storybook)"
	@echo "  make storybook            - Start the component library on port 6006"
	@echo "  make storybook-ci         - Check catalogue coverage, build, and test every story"
	@echo "  make storybook-image      - Build the production Storybook container"
	@echo "  make storybook-image-smoke - Build and smoke-test the Storybook container"
	@echo "  make storybook-install-browsers - Install Chromium for Storybook tests"
	@echo "  make lint-check <app|all> - Check linting for specific app or all"
	@echo "  make lint-fix <app|all>   - Fix linting for specific app or all"
	@echo "  make format-check <app|all> - Check formatting for specific app or all"
	@echo "  make format-fix <app|all> - Fix formatting for specific app or all"
	@echo "  make type-check <app|all> - Type check specific app or all"
	@echo "  make check all            - Run all checks (lint + format + type-check)"
	@echo "  make fix all              - Fix all issues (lint + format)"
	@echo "  make test [app]           - Run all tests, or just one package's tests"
	@echo "  make skill-conformance    - Check shipped skill against platform contracts"
	@echo "  make skill-export SKILLS_MARKET_OUTPUT=<dir> - Export the canonical skills.sh package"
	@echo "  make docs-og-check        - Check docs pages have required og/twitter meta tags"
	@echo "  make lint-check adr       - Check docs/adr/ ADRs follow numbering/status rules"
	@echo "  make lint-check specs     - Check docs/specs/ follow the Spec-lite structural template"
	@echo "  make test adr             - Run the adr package's own unit test suite (also covers spec-lint)"
	@echo "  make contract <cmd>       - Contract tools (audit|coverage|coverage-check|snapshot|snapshot-check|doc|test|test-ci)"
	@echo "  make contract <owner-cmd> <testnet|mainnet> - Owner actions (pause|unpause|accept-ownership)"
	@echo "  make ci-quality-js        - Run the non-contract CI quality shard"
	@echo "  make ui-ci                - Run the full Storybook and production web UI gate"
	@echo "  make ui-ci-e2e            - Build and run the CI E2E shard (UI_CI_PROJECT optional)"
	@echo "  make ui-ci-install-browsers - Install browsers for UI regression checks"
	@echo "  make clean                - Clean build artifacts"
	@echo "  make db <cmd>             - Database commands (start|stop|generate|migrate|push|seed|studio|backfill-task-awards|backfill-agent-registry-chain|retry-orphaned-refunds)"
	@echo "  make smoke <mode> [testnet] - Run smoke test against localhost (or testnet with 'testnet' flag)"
	@echo "  make pre-commit           - Run pre-commit checks"
	@echo "  make design-system        - Generate design tokens and copy to apps/frontend"
	@echo "  make dither-kit [args]    - Run the pinned Dither Kit CLI for apps/web"
	@echo "  make cli [args]           - Build the CLI, then run it against a local backend (TASKMARKET_API_URL)"
	@echo "  make upgrade <testnet|mainnet> [revNNN] - Upgrade contract implementation; applies every pending step in sequence, or one explicit step (e.g. rev012)"
	@echo "  make deploy-reward-hook <testnet|mainnet|preview> - Deploy DREAMS token reward hook (testnet/preview use a mock token)"
	@echo "  make swap-reward-hook <testnet|mainnet> - Ship a reward-hook logic fix: deploy a new EpochBudget+hook, reuse the existing RewardVault (requires zero outstanding reservations, see ADR-0028)"
	@echo "  make deploy-email-worker  - Deploy Cloudflare Email Worker"

init:
	$(ENV_LOADER) && pnpm install
	git submodule update --init --recursive

install: init

deploy:
	@$(ENV_LOADER) && \
	TMPFILE=$$(mktemp) && \
	VERIFY=1 && \
	if [ "$(word 1,$(ARGS))" = "testnet" ]; then \
		CHAINID=84532; \
		cd packages/contracts && \
		FORGE_DEV_PRIVATE_KEY="$${FORGE_DEV_PRIVATE_KEY:-$$FORGE_DEV_PRIVATE_KEY_TESTNET}" \
		FORGE_USDC_TOKEN_ADDRESS="$${FORGE_USDC_TOKEN_ADDRESS:-$$FORGE_USDC_TOKEN_ADDRESS_TESTNET}" \
		FORGE_FEE_RECIPIENT_ADDRESS="$${FORGE_FEE_RECIPIENT_ADDRESS:-$$FORGE_FEE_RECIPIENT_ADDRESS_TESTNET}" \
		FORGE_DEFAULT_PLATFORM_FEE_BPS="$${FORGE_DEFAULT_PLATFORM_FEE_BPS:-$$FORGE_DEFAULT_PLATFORM_FEE_BPS_TESTNET}" \
		FORGE_ERC8004_REPUTATION_REGISTRY="$${FORGE_ERC8004_REPUTATION_REGISTRY:-$$FORGE_ERC8004_REPUTATION_REGISTRY_TESTNET}" \
		forge script script/DiamondDeploy.s.sol:DiamondDeploy \
			--rpc-url base_sepolia \
			--broadcast \
			--verify 2>&1 | tee $$TMPFILE; \
	elif [ "$(word 1,$(ARGS))" = "mainnet" ]; then \
		CHAINID=8453; \
		cd packages/contracts && \
		FORGE_DEV_PRIVATE_KEY="$${FORGE_DEV_PRIVATE_KEY:-$$FORGE_DEV_PRIVATE_KEY_MAINNET}" \
		FORGE_USDC_TOKEN_ADDRESS="$${FORGE_USDC_TOKEN_ADDRESS:-$$FORGE_USDC_TOKEN_ADDRESS_MAINNET}" \
		FORGE_FEE_RECIPIENT_ADDRESS="$${FORGE_FEE_RECIPIENT_ADDRESS:-$$FORGE_FEE_RECIPIENT_ADDRESS_MAINNET}" \
		FORGE_DEFAULT_PLATFORM_FEE_BPS="$${FORGE_DEFAULT_PLATFORM_FEE_BPS:-$$FORGE_DEFAULT_PLATFORM_FEE_BPS_MAINNET}" \
		FORGE_ERC8004_REPUTATION_REGISTRY="$${FORGE_ERC8004_REPUTATION_REGISTRY:-$$FORGE_ERC8004_REPUTATION_REGISTRY_MAINNET}" \
		forge script script/DiamondDeploy.s.sol:DiamondDeploy \
			--rpc-url base \
			--broadcast \
			--verify 2>&1 | tee $$TMPFILE; \
	elif [ "$(word 1,$(ARGS))" = "preview" ]; then \
		VERIFY=0 && \
		cd packages/contracts && \
		FORGE_DEV_PRIVATE_KEY="$${FORGE_DEV_PRIVATE_KEY:-$$FORGE_DEV_PRIVATE_KEY_PREVIEW}" \
		FORGE_FEE_RECIPIENT_ADDRESS="$${FORGE_FEE_RECIPIENT_ADDRESS:-$$FORGE_FEE_RECIPIENT_ADDRESS_PREVIEW}" \
		FORGE_DEFAULT_PLATFORM_FEE_BPS="$${FORGE_DEFAULT_PLATFORM_FEE_BPS:-$$FORGE_DEFAULT_PLATFORM_FEE_BPS_PREVIEW}" \
		forge script script/DiamondDeploy.s.sol:DiamondDeploy \
			--rpc-url "$${FORGE_RPC_URL:-$$FORGE_RPC_URL_PREVIEW}" \
			--broadcast 2>&1 | tee $$TMPFILE; \
	else \
		rm -f $$TMPFILE; \
		echo "Usage: make deploy <testnet|mainnet|preview>"; \
		exit 1; \
	fi; \
	PROXY=$$(grep "Diamond deployed at:" $$TMPFILE | awk '{print $$NF}'); \
	rm -f $$TMPFILE; \
	if [ -n "$$PROXY" ]; then \
		echo "Diamond deployed at: $$PROXY"; \
	fi; \
	if [ "$$VERIFY" = "1" ] && [ -n "$$PROXY" ]; then \
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
		cd packages/contracts && \
		FORGE_DEV_PRIVATE_KEY="$${FORGE_DEV_PRIVATE_KEY:-$$FORGE_DEV_PRIVATE_KEY_TESTNET}" \
		./script/upgrade.sh testnet "$(word 2,$(ARGS))"; \
	elif [ "$(word 1,$(ARGS))" = "mainnet" ]; then \
		cd packages/contracts && \
		FORGE_DEV_PRIVATE_KEY="$${FORGE_DEV_PRIVATE_KEY:-$$FORGE_DEV_PRIVATE_KEY_MAINNET}" \
		./script/upgrade.sh mainnet "$(word 2,$(ARGS))"; \
	else \
		echo "Usage: make upgrade <testnet|mainnet> [revNNN]"; \
		exit 1; \
	fi

upgrade-accept-pinning:
	@$(ENV_LOADER) && \
	if [ "$(word 1,$(ARGS))" = "testnet" ]; then \
		cd packages/contracts && forge script script/DiamondUpgradeAcceptPinning.s.sol:DiamondUpgradeAcceptPinning \
			--rpc-url base_sepolia \
			--broadcast \
			--verify; \
	elif [ "$(word 1,$(ARGS))" = "mainnet" ]; then \
		cd packages/contracts && forge script script/DiamondUpgradeAcceptPinning.s.sol:DiamondUpgradeAcceptPinning \
			--rpc-url base \
			--broadcast \
			--verify; \
	else \
		echo "Usage: make upgrade-accept-pinning <testnet|mainnet>"; \
		exit 1; \
	fi

deploy-reward-hook:
	@$(ENV_LOADER) && \
	if [ "$(word 1,$(ARGS))" = "testnet" ]; then \
		cd packages/contracts && \
		FORGE_DEV_PRIVATE_KEY=$${FORGE_DEV_PRIVATE_KEY:-$$FORGE_DEV_PRIVATE_KEY_TESTNET} \
		FORGE_DIAMOND_ADDRESS=$${FORGE_DIAMOND_ADDRESS:-$$FORGE_DIAMOND_ADDRESS_TESTNET} \
		FORGE_DREAMS_PER_USDC=$${FORGE_DREAMS_PER_USDC:-$$FORGE_DREAMS_PER_USDC_TESTNET} \
		FORGE_BONUS_BPS=$${FORGE_BONUS_BPS:-$$FORGE_BONUS_BPS_TESTNET} \
		FORGE_EPOCH_DURATION=$${FORGE_EPOCH_DURATION:-$$FORGE_EPOCH_DURATION_TESTNET} \
		FORGE_GLOBAL_EPOCH_CAP_USD=$${FORGE_GLOBAL_EPOCH_CAP_USD:-$$FORGE_GLOBAL_EPOCH_CAP_USD_TESTNET} \
		FORGE_WORKER_CAP_USD=$${FORGE_WORKER_CAP_USD:-$$FORGE_WORKER_CAP_USD_TESTNET} \
		FORGE_REQUESTER_CAP_USD=$${FORGE_REQUESTER_CAP_USD:-$$FORGE_REQUESTER_CAP_USD_TESTNET} \
		FORGE_MAX_USD_PER_TASK=$${FORGE_MAX_USD_PER_TASK:-$$FORGE_MAX_USD_PER_TASK_TESTNET} \
		FORGE_WORKER_SPLIT_BPS=$${FORGE_WORKER_SPLIT_BPS:-$$FORGE_WORKER_SPLIT_BPS_TESTNET} \
		FORGE_INITIAL_VAULT_BALANCE=$${FORGE_INITIAL_VAULT_BALANCE:-$$FORGE_INITIAL_VAULT_BALANCE_TESTNET} \
		FORGE_PGTR_FORWARDER=$${FORGE_PGTR_FORWARDER:-$$FORGE_PGTR_FORWARDER_TESTNET} \
		forge script script/DeployRewardHookTestnet.s.sol:DeployRewardHookTestnet \
			--rpc-url base_sepolia \
			--broadcast \
			--verify; \
	elif [ "$(word 1,$(ARGS))" = "mainnet" ]; then \
		cd packages/contracts && \
		FORGE_DEV_PRIVATE_KEY=$${FORGE_DEV_PRIVATE_KEY:-$$FORGE_DEV_PRIVATE_KEY_MAINNET} \
		FORGE_DIAMOND_ADDRESS=$${FORGE_DIAMOND_ADDRESS:-$$FORGE_DIAMOND_ADDRESS_MAINNET} \
		FORGE_PROTOCOL_TOKEN=$${FORGE_PROTOCOL_TOKEN:-$$FORGE_PROTOCOL_TOKEN_MAINNET} \
		FORGE_DREAMS_PER_USDC=$${FORGE_DREAMS_PER_USDC:-$$FORGE_DREAMS_PER_USDC_MAINNET} \
		FORGE_BONUS_BPS=$${FORGE_BONUS_BPS:-$$FORGE_BONUS_BPS_MAINNET} \
		FORGE_EPOCH_DURATION=$${FORGE_EPOCH_DURATION:-$$FORGE_EPOCH_DURATION_MAINNET} \
		FORGE_GLOBAL_EPOCH_CAP_USD=$${FORGE_GLOBAL_EPOCH_CAP_USD:-$$FORGE_GLOBAL_EPOCH_CAP_USD_MAINNET} \
		FORGE_WORKER_CAP_USD=$${FORGE_WORKER_CAP_USD:-$$FORGE_WORKER_CAP_USD_MAINNET} \
		FORGE_REQUESTER_CAP_USD=$${FORGE_REQUESTER_CAP_USD:-$$FORGE_REQUESTER_CAP_USD_MAINNET} \
		FORGE_MAX_USD_PER_TASK=$${FORGE_MAX_USD_PER_TASK:-$$FORGE_MAX_USD_PER_TASK_MAINNET} \
		FORGE_WORKER_SPLIT_BPS=$${FORGE_WORKER_SPLIT_BPS:-$$FORGE_WORKER_SPLIT_BPS_MAINNET} \
		FORGE_PGTR_FORWARDER=$${FORGE_PGTR_FORWARDER:-$$FORGE_PGTR_FORWARDER_MAINNET} \
		forge script script/DeployRewardHook.s.sol:DeployRewardHook \
			--rpc-url base \
			--broadcast \
			--verify; \
	elif [ "$(word 1,$(ARGS))" = "preview" ]; then \
		cd packages/contracts && \
		FORGE_DEV_PRIVATE_KEY=$${FORGE_DEV_PRIVATE_KEY:-$$FORGE_DEV_PRIVATE_KEY_PREVIEW} \
		FORGE_DIAMOND_ADDRESS=$${FORGE_DIAMOND_ADDRESS:-$$FORGE_DIAMOND_ADDRESS_PREVIEW} \
		FORGE_DREAMS_PER_USDC=$${FORGE_DREAMS_PER_USDC:-$$FORGE_DREAMS_PER_USDC_PREVIEW} \
		FORGE_BONUS_BPS=$${FORGE_BONUS_BPS:-$$FORGE_BONUS_BPS_PREVIEW} \
		FORGE_EPOCH_DURATION=$${FORGE_EPOCH_DURATION:-$$FORGE_EPOCH_DURATION_PREVIEW} \
		FORGE_GLOBAL_EPOCH_CAP_USD=$${FORGE_GLOBAL_EPOCH_CAP_USD:-$$FORGE_GLOBAL_EPOCH_CAP_USD_PREVIEW} \
		FORGE_WORKER_CAP_USD=$${FORGE_WORKER_CAP_USD:-$$FORGE_WORKER_CAP_USD_PREVIEW} \
		FORGE_REQUESTER_CAP_USD=$${FORGE_REQUESTER_CAP_USD:-$$FORGE_REQUESTER_CAP_USD_PREVIEW} \
		FORGE_MAX_USD_PER_TASK=$${FORGE_MAX_USD_PER_TASK:-$$FORGE_MAX_USD_PER_TASK_PREVIEW} \
		FORGE_WORKER_SPLIT_BPS=$${FORGE_WORKER_SPLIT_BPS:-$$FORGE_WORKER_SPLIT_BPS_PREVIEW} \
		FORGE_INITIAL_VAULT_BALANCE=$${FORGE_INITIAL_VAULT_BALANCE:-$$FORGE_INITIAL_VAULT_BALANCE_PREVIEW} \
		FORGE_PGTR_FORWARDER=$${FORGE_PGTR_FORWARDER:-$$FORGE_PGTR_FORWARDER_PREVIEW} \
		forge script script/DeployRewardHookTestnet.s.sol:DeployRewardHookTestnet \
			--rpc-url "$${FORGE_RPC_URL:-$$FORGE_RPC_URL_PREVIEW}" \
			--broadcast; \
	else \
		echo "Usage: make deploy-reward-hook <testnet|mainnet|preview>"; \
		exit 1; \
	fi

swap-reward-hook:
	@$(ENV_LOADER) && \
	if [ "$(word 1,$(ARGS))" = "testnet" ]; then \
		if [ "$(word 2,$(ARGS))" = "force" ]; then \
			SKIP_RESERVATION_CHECK_TESTNET=true; \
		fi; \
		cd packages/contracts && \
		FORGE_DEV_PRIVATE_KEY=$${FORGE_DEV_PRIVATE_KEY:-$$FORGE_DEV_PRIVATE_KEY_TESTNET} \
		FORGE_REWARD_VAULT_ADDRESS=$${FORGE_REWARD_VAULT_ADDRESS:-$$FORGE_REWARD_VAULT_ADDRESS_TESTNET} \
		FORGE_DIAMOND_ADDRESS=$${FORGE_DIAMOND_ADDRESS:-$$FORGE_DIAMOND_ADDRESS_TESTNET} \
		FORGE_DREAMS_PER_USDC=$${FORGE_DREAMS_PER_USDC:-$$FORGE_DREAMS_PER_USDC_TESTNET} \
		FORGE_BONUS_BPS=$${FORGE_BONUS_BPS:-$$FORGE_BONUS_BPS_TESTNET} \
		FORGE_EPOCH_DURATION=$${FORGE_EPOCH_DURATION:-$$FORGE_EPOCH_DURATION_TESTNET} \
		FORGE_GLOBAL_EPOCH_CAP_USD=$${FORGE_GLOBAL_EPOCH_CAP_USD:-$$FORGE_GLOBAL_EPOCH_CAP_USD_TESTNET} \
		FORGE_WORKER_CAP_USD=$${FORGE_WORKER_CAP_USD:-$$FORGE_WORKER_CAP_USD_TESTNET} \
		FORGE_REQUESTER_CAP_USD=$${FORGE_REQUESTER_CAP_USD:-$$FORGE_REQUESTER_CAP_USD_TESTNET} \
		FORGE_MAX_USD_PER_TASK=$${FORGE_MAX_USD_PER_TASK:-$$FORGE_MAX_USD_PER_TASK_TESTNET} \
		FORGE_WORKER_SPLIT_BPS=$${FORGE_WORKER_SPLIT_BPS:-$$FORGE_WORKER_SPLIT_BPS_TESTNET} \
		FORGE_PGTR_FORWARDER=$${FORGE_PGTR_FORWARDER:-$$FORGE_PGTR_FORWARDER_TESTNET} \
		SKIP_RESERVATION_CHECK=$${SKIP_RESERVATION_CHECK:-$${SKIP_RESERVATION_CHECK_TESTNET:-false}} \
		forge script script/SwapRewardHook.s.sol:SwapRewardHook \
			--rpc-url base_sepolia \
			--broadcast \
			--verify; \
	elif [ "$(word 1,$(ARGS))" = "mainnet" ]; then \
		if [ "$(word 2,$(ARGS))" = "force" ]; then \
			SKIP_RESERVATION_CHECK_MAINNET=true; \
		fi; \
		cd packages/contracts && \
		FORGE_DEV_PRIVATE_KEY=$${FORGE_DEV_PRIVATE_KEY:-$$FORGE_DEV_PRIVATE_KEY_MAINNET} \
		FORGE_REWARD_VAULT_ADDRESS=$${FORGE_REWARD_VAULT_ADDRESS:-$$FORGE_REWARD_VAULT_ADDRESS_MAINNET} \
		FORGE_DIAMOND_ADDRESS=$${FORGE_DIAMOND_ADDRESS:-$$FORGE_DIAMOND_ADDRESS_MAINNET} \
		FORGE_DREAMS_PER_USDC=$${FORGE_DREAMS_PER_USDC:-$$FORGE_DREAMS_PER_USDC_MAINNET} \
		FORGE_BONUS_BPS=$${FORGE_BONUS_BPS:-$$FORGE_BONUS_BPS_MAINNET} \
		FORGE_EPOCH_DURATION=$${FORGE_EPOCH_DURATION:-$$FORGE_EPOCH_DURATION_MAINNET} \
		FORGE_GLOBAL_EPOCH_CAP_USD=$${FORGE_GLOBAL_EPOCH_CAP_USD:-$$FORGE_GLOBAL_EPOCH_CAP_USD_MAINNET} \
		FORGE_WORKER_CAP_USD=$${FORGE_WORKER_CAP_USD:-$$FORGE_WORKER_CAP_USD_MAINNET} \
		FORGE_REQUESTER_CAP_USD=$${FORGE_REQUESTER_CAP_USD:-$$FORGE_REQUESTER_CAP_USD_MAINNET} \
		FORGE_MAX_USD_PER_TASK=$${FORGE_MAX_USD_PER_TASK:-$$FORGE_MAX_USD_PER_TASK_MAINNET} \
		FORGE_WORKER_SPLIT_BPS=$${FORGE_WORKER_SPLIT_BPS:-$$FORGE_WORKER_SPLIT_BPS_MAINNET} \
		FORGE_PGTR_FORWARDER=$${FORGE_PGTR_FORWARDER:-$$FORGE_PGTR_FORWARDER_MAINNET} \
		SKIP_RESERVATION_CHECK=$${SKIP_RESERVATION_CHECK:-$${SKIP_RESERVATION_CHECK_MAINNET:-false}} \
		forge script script/SwapRewardHook.s.sol:SwapRewardHook \
			--rpc-url base \
			--broadcast \
			--verify; \
	else \
		echo "Usage: make swap-reward-hook <testnet|mainnet> [force]"; \
		echo "  force skips the RewardVault.totalReserved()==0 safety guard -- DANGEROUS, see ADR-0028"; \
		exit 1; \
	fi

release:
	@SQL_COUNT=$$(ls apps/backend/drizzle/migrations/*.sql 2>/dev/null | wc -l | tr -d ' '); \
	JOURNAL_COUNT=$$(python3 -c "import json; d=json.load(open('apps/backend/drizzle/migrations/meta/_journal.json')); print(len(d['entries']))" 2>/dev/null); \
	if [ "$$SQL_COUNT" != "$$JOURNAL_COUNT" ]; then \
		echo "ERROR: migration journal out of sync ($$SQL_COUNT .sql files, $$JOURNAL_COUNT journal entries). Add the missing entry to apps/backend/drizzle/migrations/meta/_journal.json before releasing."; \
		exit 1; \
	fi
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
		echo "Usage: make build <backend|frontend|web|docs|shared|contracts|storybook|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo build; \
	elif [ "$(word 1,$(ARGS))" = "backend" ]; then \
		pnpm --filter @taskmarket/backend build; \
	elif [ "$(word 1,$(ARGS))" = "frontend" ]; then \
		pnpm --filter @taskmarket/frontend build; \
	elif [ "$(word 1,$(ARGS))" = "web" ]; then \
		pnpm --filter @taskmarket/web build; \
	elif [ "$(word 1,$(ARGS))" = "storybook" ]; then \
		pnpm --filter @taskmarket/web storybook:build; \
	elif [ "$(word 1,$(ARGS))" = "docs" ]; then \
		pnpm --filter @taskmarket/docs build; \
	elif [ "$(word 1,$(ARGS))" = "shared" ]; then \
		pnpm --filter @taskmarket/shared build; \
	elif [ "$(word 1,$(ARGS))" = "contracts" ]; then \
		forge build --root packages/contracts && \
		cd packages/contracts && python3 -c "\
import json, os; \
facets = ['DiamondCutFacet.sol/DiamondCutFacet.json','DiamondLoupeFacet.sol/DiamondLoupeFacet.json','AdminFacet.sol/AdminFacet.json','CoreFacet.sol/CoreFacet.json','AuctionFacet.sol/AuctionFacet.json','AcceptanceFacet.sol/AcceptanceFacet.json','EvaluatorFacet.sol/EvaluatorFacet.json','RatingFacet.sol/RatingFacet.json','RegistryFacet.sol/RegistryFacet.json']; \
merged=[]; seen=set(); \
[merged.append(e) or seen.add(json.dumps(e,sort_keys=True)) for f in facets for e in json.load(open(os.path.join('out',f)))['abi'] if json.dumps(e,sort_keys=True) not in seen]; \
open('abi/TaskMarket.json','w').write(json.dumps(merged,indent=2)+'\n'); \
print(f'ABI: {len(merged)} entries -> abi/TaskMarket.json')"; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make build <backend|frontend|web|docs|shared|contracts|storybook|all>"; \
		exit 1; \
	fi

dev:
	@$(ENV_LOADER) && \
	if [ "$(word 1,$(ARGS))" = "storybook" ]; then \
		pnpm turbo dev & APP_PID=$$!; \
		pnpm --filter @taskmarket/web storybook & STORYBOOK_PID=$$!; \
		trap 'kill $$APP_PID $$STORYBOOK_PID 2>/dev/null || true' EXIT INT TERM; \
		wait $$APP_PID $$STORYBOOK_PID; \
	else \
		pnpm turbo dev; \
	fi

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
	elif [ "$(word 1,$(ARGS))" = "storybook" ]; then \
		pnpm --filter @taskmarket/web storybook; \
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
		echo "Usage: make lint-check <backend|frontend|web|docs|shared|contracts|email-worker|adr|specs|all>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "all" ]; then \
		pnpm turbo lint:check; \
	elif [ "$(word 1,$(ARGS))" = "specs" ]; then \
		cd packages/adr && pnpm spec-lint; \
	elif [ -d "apps/$(word 1,$(ARGS))" ]; then \
		cd apps/$(word 1,$(ARGS)) && pnpm lint:check; \
	elif [ -d "packages/$(word 1,$(ARGS))" ]; then \
		cd packages/$(word 1,$(ARGS)) && pnpm lint:check; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make lint-check <backend|frontend|web|docs|shared|contracts|email-worker|adr|specs|all>"; \
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
	elif [ "$(word 1,$(ARGS))" = "cli" ]; then \
		cd apps/cli && pnpm type-check; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make type-check <backend|frontend|web|shared|email-worker|cli|all>"; \
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
	# "test" is also the second goal in "make contract test"; the contract
	# dispatcher already ran the Solidity suite in that case.
	@if [ "$(word 1,$(MAKECMDGOALS))" = "contract" ]; then \
		exit 0; \
	fi; \
	$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		pnpm turbo test; \
	elif [ -d "apps/$(word 1,$(ARGS))" ]; then \
		cd apps/$(word 1,$(ARGS)) && pnpm test; \
	elif [ -d "packages/$(word 1,$(ARGS))" ]; then \
		cd packages/$(word 1,$(ARGS)) && pnpm test; \
	elif [ "$(word 1,$(ARGS))" = "storybook" ]; then \
		pnpm --filter @taskmarket/web storybook:test; \
	else \
		echo "Unknown app: $(word 1,$(ARGS))"; \
		echo "Usage: make test [backend|frontend|web|docs|shared|contracts|email-worker|adr|storybook]"; \
		exit 1; \
	fi

storybook:
	@if [ "$(word 1,$(MAKECMDGOALS))" = "build" ] || [ "$(word 1,$(MAKECMDGOALS))" = "dev" ] || [ "$(word 1,$(MAKECMDGOALS))" = "start" ] || [ "$(word 1,$(MAKECMDGOALS))" = "test" ]; then \
		exit 0; \
	fi; \
	$(ENV_LOADER) && pnpm --filter @taskmarket/web storybook

storybook-ci:
	$(ENV_LOADER) && \
	pnpm --filter @taskmarket/shared build && \
	pnpm --filter @taskmarket/web storybook:coverage && \
	pnpm --filter @taskmarket/web storybook:build && \
	pnpm --filter @taskmarket/web storybook:test

storybook-image:
	docker build -f apps/web/Dockerfile.storybook -t taskmarket-storybook:local .

storybook-image-smoke: storybook-image
	@CONTAINER_ID=$$(docker run --rm --detach --publish 127.0.0.1::8080 taskmarket-storybook:local) && \
	trap 'docker stop $$CONTAINER_ID >/dev/null' EXIT && \
	STORYBOOK_PORT=$$(docker port $$CONTAINER_ID 8080/tcp | awk -F: '{print $$NF}') && \
	for attempt in $$(seq 1 10); do \
		curl -fsS "http://127.0.0.1:$$STORYBOOK_PORT/health" >/dev/null 2>&1 && break; \
		[ "$$attempt" -lt 10 ] || exit 1; \
		sleep 1; \
	done && \
	curl -fsS "http://127.0.0.1:$$STORYBOOK_PORT/" | grep -q 'Storybook</title>' && \
	echo "Storybook container smoke test passed"

storybook-install-browsers:
	$(ENV_LOADER) && pnpm --filter @taskmarket/web exec playwright install --with-deps chromium

skill-conformance:
	$(ENV_LOADER) && \
	pnpm --filter @taskmarket/shared build && \
	pnpm --filter @taskmarket/backend exec vitest run test/unit/skill-conformance.test.ts test/integration/middleware/validateBody.test.ts && \
	pnpm --filter @lucid-agents/taskmarket exec vitest run test/unit/skill-conformance.test.ts && \
	pnpm --filter @taskmarket/web exec vitest run lib/skill-package.test.ts lib/skill.test.ts

skill-export:
	@if [ -z "$(SKILLS_MARKET_OUTPUT)" ]; then \
		echo "Usage: make skill-export SKILLS_MARKET_OUTPUT=<empty-output-directory>"; \
		exit 1; \
	fi
	@node scripts/export-skills-market.mjs "$(SKILLS_MARKET_OUTPUT)"

docs-og-check:
	$(ENV_LOADER) && \
	pnpm --filter @taskmarket/docs build && \
	pnpm --filter @taskmarket/docs check-og

contract:
	@$(ENV_LOADER) && \
	if [ -z "$(word 1,$(ARGS))" ]; then \
		echo "Usage: make contract <audit|coverage|coverage-check|snapshot|snapshot-check|doc|test|test-ci>"; \
		echo "       make contract <pause|unpause|accept-ownership> <testnet|mainnet>"; \
		exit 1; \
	elif [ "$(word 1,$(ARGS))" = "audit" ]; then \
		mkdir -p packages/contracts/reports && \
		cd packages/contracts && set -o pipefail && slither . --config-file slither.config.json 2>&1 | tee reports/slither-audit.md && \
		echo "Report written to packages/contracts/reports/slither-audit.md"; \
	elif [ "$(word 1,$(ARGS))" = "coverage" ]; then \
		mkdir -p packages/contracts/reports/coverage && \
		cd packages/contracts && forge coverage --ir-minimum --no-match-coverage "(script/|src/mocks/|test/mocks/)" --report summary --report lcov --lcov-version 2 --report-file reports/coverage/lcov.info && \
		echo "lcov report written to packages/contracts/reports/coverage/lcov.info"; \
	elif [ "$(word 1,$(ARGS))" = "coverage-check" ]; then \
		mkdir -p packages/contracts/reports/coverage && \
		cd packages/contracts && forge coverage --ir-minimum --no-match-coverage "(script/|src/mocks/|test/mocks/)" --report summary --report lcov --lcov-version 2 --report-file reports/coverage/lcov.info | tee /tmp/forge-coverage.txt && \
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
	elif [ "$(word 1,$(ARGS))" = "pause" ] || [ "$(word 1,$(ARGS))" = "unpause" ] || \
	     [ "$(word 1,$(ARGS))" = "accept-ownership" ]; then \
		case "$(word 1,$(ARGS))" in \
			pause) OWNER_SIG="pause()";; \
			unpause) OWNER_SIG="unpause()";; \
			accept-ownership) OWNER_SIG="acceptOwnership()";; \
		esac; \
		case "$(word 2,$(ARGS))" in \
			testnet) \
				OWNER_RPC=base_sepolia; \
				OWNER_ADDRESS_VAR=FORGE_DIAMOND_ADDRESS_TESTNET; \
				OWNER_KEY_VAR=FORGE_DEV_PRIVATE_KEY_TESTNET; \
				OWNER_ADDRESS="$${FORGE_DIAMOND_ADDRESS:-$$FORGE_DIAMOND_ADDRESS_TESTNET}"; \
				OWNER_KEY="$${FORGE_DEV_PRIVATE_KEY:-$$FORGE_DEV_PRIVATE_KEY_TESTNET}";; \
			mainnet) \
				OWNER_RPC=base; \
				OWNER_ADDRESS_VAR=FORGE_DIAMOND_ADDRESS_MAINNET; \
				OWNER_KEY_VAR=FORGE_DEV_PRIVATE_KEY_MAINNET; \
				OWNER_ADDRESS="$${FORGE_DIAMOND_ADDRESS:-$$FORGE_DIAMOND_ADDRESS_MAINNET}"; \
				OWNER_KEY="$${FORGE_DEV_PRIVATE_KEY:-$$FORGE_DEV_PRIVATE_KEY_MAINNET}";; \
			*) \
				echo "Usage: make contract $(word 1,$(ARGS)) <testnet|mainnet>"; \
				exit 1;; \
		esac; \
		[ -n "$$OWNER_ADDRESS" ] || \
			{ echo "Error: $$OWNER_ADDRESS_VAR (or FORGE_DIAMOND_ADDRESS) must be set"; exit 1; }; \
		[ -n "$$OWNER_KEY" ] || \
			{ echo "Error: $$OWNER_KEY_VAR (or FORGE_DEV_PRIVATE_KEY) must be set"; exit 1; }; \
		echo "Sending $$OWNER_SIG to $$OWNER_ADDRESS on $(word 2,$(ARGS))"; \
		cd packages/contracts && cast send "$$OWNER_ADDRESS" "$$OWNER_SIG" \
			--private-key "$$OWNER_KEY" \
			--rpc-url $$OWNER_RPC; \
	else \
		echo "Unknown command: $(word 1,$(ARGS))"; \
		echo "Usage: make contract <audit|coverage|coverage-check|snapshot|snapshot-check|doc|test|test-ci> | make contract <pause|unpause|accept-ownership> <testnet|mainnet>"; \
		exit 1; \
	fi

ci-quality-js:
	$(ENV_LOADER) && \
	pnpm turbo build --filter='!@taskmarket/contracts' --filter='!@taskmarket/docs' && \
	pnpm turbo lint:check --filter='!@taskmarket/contracts' && \
	pnpm turbo format:check --filter='!@taskmarket/contracts' && \
	pnpm turbo type-check --filter='!@taskmarket/contracts' && \
	pnpm turbo test --filter='!@taskmarket/contracts' --filter='!@taskmarket/docs'

ui-ci:
	$(MAKE) storybook-ci
	$(ENV_LOADER) && \
	MOCK_API_PORT="$${E2E_MOCK_API_PORT:-$${TASKMARKET_MOCK_API_PORT:-3101}}" && \
	MOCK_WEB_PORT="$${TASKMARKET_MOCK_WEB_PORT:-3002}" && \
	pnpm --filter @taskmarket/web lint:check && \
	pnpm --filter @taskmarket/web format:check && \
	pnpm --filter @taskmarket/shared build && \
	pnpm --filter @taskmarket/web type-check && \
	pnpm --filter @taskmarket/web test && \
	NEXT_PUBLIC_API_URL="http://127.0.0.1:$$MOCK_API_PORT" \
	TASKMARKET_API_URL="http://127.0.0.1:$$MOCK_API_PORT" \
	NEXT_PUBLIC_PRIVY_APP_ID= \
		pnpm --filter @taskmarket/web build && \
	NEXT_PUBLIC_API_URL="http://127.0.0.1:$$MOCK_API_PORT" \
	TASKMARKET_API_URL="http://127.0.0.1:$$MOCK_API_PORT" \
	NEXT_PUBLIC_PRIVY_APP_ID= \
	CI=1 \
	NODE_ENV=production \
	TASKMARKET_MOCK_WEB_PORT="$$MOCK_WEB_PORT" \
		pnpm --filter @taskmarket/web test:e2e

ui-ci-e2e:
	$(ENV_LOADER) && \
	MOCK_API_PORT="$${E2E_MOCK_API_PORT:-$${TASKMARKET_MOCK_API_PORT:-3101}}" && \
	MOCK_WEB_PORT="$${TASKMARKET_MOCK_WEB_PORT:-3002}" && \
	PLAYWRIGHT_ARGS=() && \
	if [ -n "$(UI_CI_PROJECT)" ]; then PLAYWRIGHT_ARGS+=(--project="$(UI_CI_PROJECT)"); fi && \
	pnpm --filter @taskmarket/shared build && \
	NEXT_PUBLIC_API_URL="http://127.0.0.1:$$MOCK_API_PORT" \
	TASKMARKET_API_URL="http://127.0.0.1:$$MOCK_API_PORT" \
	NEXT_PUBLIC_PRIVY_APP_ID= \
		pnpm --filter @taskmarket/web build && \
	NEXT_PUBLIC_API_URL="http://127.0.0.1:$$MOCK_API_PORT" \
	TASKMARKET_API_URL="http://127.0.0.1:$$MOCK_API_PORT" \
	NEXT_PUBLIC_PRIVY_APP_ID= \
	CI=1 \
	NODE_ENV=production \
	TASKMARKET_MOCK_WEB_PORT="$$MOCK_WEB_PORT" \
		pnpm --filter @taskmarket/web exec playwright test "$${PLAYWRIGHT_ARGS[@]}" $(UI_CI_TEST_ARGS)

ui-ci-install-browsers:
	$(ENV_LOADER) && cd apps/web && pnpm exec playwright install --with-deps $(if $(UI_CI_BROWSER),$(UI_CI_BROWSER),chromium webkit)

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
	elif [ "$(word 1,$(ARGS))" = "backfill-task-awards" ]; then \
		cd apps/backend && pnpm db:backfill-task-awards; \
	elif [ "$(word 1,$(ARGS))" = "backfill-agent-registry-chain" ]; then \
		if [ -z "$$REGISTRY" ] || [ -z "$$CHAIN_ID" ]; then \
			echo "Usage: REGISTRY=0x... CHAIN_ID=<n> make db backfill-agent-registry-chain [dry-run]"; \
			exit 1; \
		fi; \
		if [ "$(word 2,$(ARGS))" = "dry-run" ]; then \
			cd apps/backend && pnpm db:backfill-agent-registry-chain -- --registry "$$REGISTRY" --chain-id "$$CHAIN_ID" --dry-run; \
		else \
			cd apps/backend && pnpm db:backfill-agent-registry-chain -- --registry "$$REGISTRY" --chain-id "$$CHAIN_ID"; \
		fi; \
	elif [ "$(word 1,$(ARGS))" = "retry-orphaned-refunds" ]; then \
		if [ "$(word 2,$(ARGS))" = "dry-run" ]; then \
			cd apps/backend && pnpm db:retry-orphaned-refunds -- --dry-run; \
		else \
			cd apps/backend && pnpm db:retry-orphaned-refunds; \
		fi; \
	else \
		echo "Usage: make db <start|stop|generate|migrate|push|seed|studio|backfill-task-awards|backfill-agent-registry-chain|retry-orphaned-refunds [dry-run]>"; \
		exit 1; \
	fi

smoke:
	@$(ENV_LOADER) && \
	if [ "$(word 2,$(ARGS))" = "testnet" ]; then \
		SMOKE_API_URL="$$TESTNET_API_URL"; \
		SMOKE_REWARD_HOOK_ADDRESS="$$FORGE_DREAMS_HOOK_ADDRESS_TESTNET"; \
		SMOKE_MOCK_TOKEN_ADDRESS="$$FORGE_MOCK_TOKEN_ADDRESS_TESTNET"; \
		SMOKE_VAULT_ADDRESS="$$FORGE_REWARD_VAULT_ADDRESS_TESTNET"; \
	else \
		SMOKE_API_URL="$$API_URL"; \
		SMOKE_REWARD_HOOK_ADDRESS="$$REWARD_HOOK_ADDRESS"; \
		SMOKE_MOCK_TOKEN_ADDRESS="$$MOCK_TOKEN_ADDRESS"; \
		SMOKE_VAULT_ADDRESS="$$VAULT_ADDRESS"; \
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
	elif [ "$(word 1,$(ARGS))" = "cli" ]; then \
		pnpm --filter @lucid-agents/taskmarket... build && \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:cli; \
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
	elif [ "$(word 1,$(ARGS))" = "submission-integrity" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:submission-integrity; \
	elif [ "$(word 1,$(ARGS))" = "token-reward-hook" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" \
		REWARD_HOOK_ADDRESS="$$SMOKE_REWARD_HOOK_ADDRESS" \
		MOCK_TOKEN_ADDRESS="$$SMOKE_MOCK_TOKEN_ADDRESS" \
		VAULT_ADDRESS="$$SMOKE_VAULT_ADDRESS" \
		pnpm smoke:token-reward-hook; \
	elif [ "$(word 1,$(ARGS))" = "evaluator" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:evaluator; \
	elif [ "$(word 1,$(ARGS))" = "visibility" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:visibility; \
	elif [ "$(word 1,$(ARGS))" = "submission-visibility" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:submission-visibility; \
	elif [ "$(word 1,$(ARGS))" = "concurrent-tasks" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:concurrent-tasks; \
	elif [ "$(word 1,$(ARGS))" = "nonce" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:nonce; \
	elif [ "$(word 1,$(ARGS))" = "payment-orphan-refund" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:payment-orphan-refund; \
	elif [ "$(word 1,$(ARGS))" = "rate-limit" ]; then \
		cd apps/backend && API_URL="$$SMOKE_API_URL" pnpm smoke:rate-limit; \
	elif [ "$(word 1,$(ARGS))" = "sandbox" ]; then \
		if [ -f .git ]; then \
			echo "Linked git worktree detected -- its .git file points at the main repo's" ; \
			echo ".git/worktrees/<name> by absolute host path, which doesn't exist inside the" ; \
			echo "container. Cloning HEAD into a self-contained tree for the build context." ; \
			TMPCLONE=$$(mktemp -d) && \
			git clone --local --recurse-submodules --quiet . "$$TMPCLONE" && \
			docker build -f "$$TMPCLONE/scripts/sandbox.Dockerfile" -t taskmarket-sandbox-test "$$TMPCLONE"; \
			BUILD_STATUS=$$?; \
			rm -rf "$$TMPCLONE"; \
			[ $$BUILD_STATUS -eq 0 ] || exit $$BUILD_STATUS; \
			docker run --rm taskmarket-sandbox-test; \
		else \
			docker build -f scripts/sandbox.Dockerfile -t taskmarket-sandbox-test . && \
			docker run --rm taskmarket-sandbox-test; \
		fi; \
	else \
		echo "Usage: make smoke <bounty|claim|pitch|benchmark|auction|auction-types|auction-full|cancel-update|rater-agent-id|bids-inbox|pending-actions|artifacts|submission-hash|task-search|identity|agents|inbox|cli|wallet|withdraw|encryption|xmtp|xmtp-live|email|broadcast|upgrade|ranked-payout|evaluator-timeout|refund-expired|submission-integrity|token-reward-hook|evaluator|visibility|submission-visibility|concurrent-tasks|nonce|payment-orphan-refund|rate-limit|sandbox>"; \
		exit 1; \
	fi

design-system:
	@$(ENV_LOADER) && \
	pnpm --filter @taskmarket/design-system generate && \
	cp packages/design-system/build/tailwind/base.css apps/frontend/src/styles/css/base.css && \
	cp packages/design-system/build/tailwind/dark.css apps/frontend/src/styles/css/dark.css && \
	cp packages/design-system/build/tailwind/tailwind.base.js apps/frontend/tailwind.base.js

dither-kit:
	@$(ENV_LOADER) && \
	cd apps/web && \
	DO_NOT_TRACK=1 pnpm dlx @dither-kit/cli@0.1.1 --yes --no-input --no-color $(ARGS)

# "cli" is also a smoke mode (make smoke cli) and a type-check/test app name
# (make type-check cli, make test cli). Whenever one of those is the actual
# invoked goal, make treats "cli" as a second real goal alongside it and would
# otherwise execute this recipe standalone too -- as "node apps/cli/dist/index.js
# cli", which fails since "cli" isn't a CLI subcommand. No-op instead whenever
# any of those is the actual invoked goal, leaving "make cli [args]" itself
# unaffected.
cli:
	@$(ENV_LOADER) && \
	if [ "$(word 1,$(MAKECMDGOALS))" = "smoke" ] || [ "$(word 1,$(MAKECMDGOALS))" = "type-check" ] || [ "$(word 1,$(MAKECMDGOALS))" = "test" ]; then \
		exit 0; \
	fi; \
	pnpm --filter @lucid-agents/taskmarket... build && \
	if [ -n "$(ARGS)" ]; then \
		node apps/cli/dist/index.js $(ARGS); \
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

deploy-email-worker:
	$(ENV_LOADER) && cd apps/email-worker && pnpm deploy

# Catch-all for extra arguments (e.g. make start backend)
%:
	@:
