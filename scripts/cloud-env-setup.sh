#!/usr/bin/env bash
# Sandbox setup for cloud coding agents (Claude Code cloud, Codex cloud).
# Brings up the full Taskmarket stack inside a single Linux VM/container:
# toolchain, native Postgres (no Docker), a local Anvil chain, contracts
# deployed to it, and a .env the Makefile's ENV_LOADER picks up -- so
# `make smoke <mode>` works entirely on localhost afterwards.
#
# STATUS: first draft, not yet executed inside a real vendor sandbox.
# Expected first-run friction: native Postgres setup on the vendor image,
# git submodules, and the full backend env var set (see .env.example for
# anything the backend still complains about). See the "Tier-2 setup"
# section of docs/specs/agentic-development-factory-rfc.md.
#
# X402 payments: payer-gated endpoints go through a facilitator wired to
# this Anvil chain (see the facilitator section of
# docs/specs/agent-preview-environments-rfc.md). Anvil runs with
# --chain-id 84532 (Base Sepolia masquerade), this script clones and
# starts the public daydreamsai/facilitator against it, and the deployed
# MockUSDC is EIP-3009 capable so X402 settlement works end to end.
#
# All keys below are Anvil's well-known, pre-funded default dev accounts.
# They are public knowledge and safe ONLY because this chain never leaves
# the sandbox. Never use them against a real network.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ANVIL_RPC_URL="http://127.0.0.1:8545"
DB_USER="taskmarket"
DB_PASSWORD="taskmarket"
DB_NAME="taskmarket"

# Anvil default accounts #0..#8, derived from its canonical mnemonic
# ("test test test test test test test test test test test junk"), deterministic
# and pre-funded with 10k ETH each. Every role gets its own dedicated account --
# including the fee recipient (#8), not reused from the deployer -- so each has
# a distinct identity to test against, and a signing key in case a test needs to
# act as that role (e.g. verify balance, sign a withdrawal).
DEPLOYER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
DEPLOYER_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
SERVER_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
SERVER_ADDRESS="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
REQUESTER_KEY="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
WORKER_KEY="0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
WORKER_B_KEY="0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"
EVALUATOR_KEY="0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"
FACILITATOR_KEY="0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e"
FEE_RECIPIENT_KEY="0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356"
FEE_RECIPIENT_ADDRESS="0x14dC79964da2C08b23698B3D3cc7Ca32193d9955"

echo "==> [1/10] Toolchain (Node, pnpm, bun, Foundry)"
if ! command -v pnpm > /dev/null 2>&1; then
  npm install -g pnpm@8.15.0
fi
if ! command -v bun > /dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
if ! command -v forge > /dev/null 2>&1; then
  curl -L https://foundry.paradigm.xyz | bash
  export PATH="$HOME/.foundry/bin:$PATH"
  foundryup
fi

echo "==> [2/10] Git submodules (contracts dependencies)"
git submodule update --init --recursive

echo "==> [3/10] Native Postgres (cloud sandboxes have no Docker)"
if ! command -v pg_isready > /dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -qq && sudo apt-get install -y -qq postgresql
fi
sudo service postgresql start || sudo pg_ctlcluster "$(ls /etc/postgresql | head -1)" main start
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD' SUPERUSER"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"

echo "==> [4/10] Workspace dependencies"
make install

echo "==> [5/10] Local Anvil chain"
if ! curl -sf -X POST "$ANVIL_RPC_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' > /dev/null 2>&1; then
  # --chain-id 84532: Base Sepolia masquerade, see header note on X402.
  nohup anvil --host 127.0.0.1 --port 8545 --chain-id 84532 > /tmp/anvil.log 2>&1 &
  for _ in $(seq 1 30); do
    curl -sf -X POST "$ANVIL_RPC_URL" -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' > /dev/null 2>&1 && break
    sleep 1
  done
fi

echo "==> [6/10] Local facilitator (X402 payment verification/settlement)"
FACILITATOR_PORT=8402
if ! curl -sf "http://127.0.0.1:$FACILITATOR_PORT/supported" > /dev/null 2>&1; then
  if [ ! -d /tmp/facilitator ]; then
    git clone --depth 1 https://github.com/daydreamsai/facilitator /tmp/facilitator
  fi
  cd /tmp/facilitator
  bun install
  cd examples/facilitator-server
  PORT="$FACILITATOR_PORT" \
    EVM_NETWORKS="base-sepolia" \
    EVM_RPC_URL_BASE_SEPOLIA="$ANVIL_RPC_URL" \
    EVM_PRIVATE_KEY="$FACILITATOR_KEY" \
    TRACKING_ALLOW_IN_MEMORY_FALLBACK="true" \
    nohup bun run dev > /tmp/facilitator.log 2>&1 &
  for _ in $(seq 1 30); do
    curl -sf "http://127.0.0.1:$FACILITATOR_PORT/supported" > /dev/null 2>&1 && break
    sleep 1
  done
  cd "$REPO_ROOT"
fi

# Clones a live EIP-1967 proxy contract (code + implementation-slot + implementation
# code) from a source chain onto this local Anvil, at the SAME address. Verified
# end-to-end against Base Sepolia's ERC-8004 identity registry: a real register() call
# through the cloned proxy succeeds and emits real events, because this is the actual
# deployed logic, not a hand-written approximation of it. One-time read-only RPC calls
# to the source chain at setup time only -- no ongoing dependency afterwards.
EIP1967_IMPL_SLOT="0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
clone_eip1967_proxy() {
  local proxy_addr="$1" source_rpc="$2" local_rpc="$3"
  local proxy_code impl_addr impl_code
  proxy_code="$(cast code "$proxy_addr" --rpc-url "$source_rpc")"
  impl_addr="0x$(cast storage "$proxy_addr" "$EIP1967_IMPL_SLOT" --rpc-url "$source_rpc" | tail -c 41)"
  impl_code="$(cast code "$impl_addr" --rpc-url "$source_rpc")"
  cast rpc anvil_setCode "$impl_addr" "$impl_code" --rpc-url "$local_rpc" > /dev/null
  cast rpc anvil_setCode "$proxy_addr" "$proxy_code" --rpc-url "$local_rpc" > /dev/null
  cast rpc anvil_setStorageAt "$proxy_addr" "$EIP1967_IMPL_SLOT" \
    "$(cast to-uint256 "$impl_addr")" --rpc-url "$local_rpc" > /dev/null
}

echo "==> [7/10] Clone ERC-8004 identity/reputation registries from Base Sepolia"
BASE_SEPOLIA_RPC_URL="${FORGE_BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
ERC8004_IDENTITY_REGISTRY="0x8004A818BFB912233c491871b3d84c89A494BD9e"
ERC8004_REPUTATION_REGISTRY="0x8004B663056A597Dffe9eCcC1965A193B7388713"
clone_eip1967_proxy "$ERC8004_IDENTITY_REGISTRY" "$BASE_SEPOLIA_RPC_URL" "$ANVIL_RPC_URL"
clone_eip1967_proxy "$ERC8004_REPUTATION_REGISTRY" "$BASE_SEPOLIA_RPC_URL" "$ANVIL_RPC_URL"

echo "==> [8/10] Deploy mock USDC, diamond, and forwarder to local Anvil"
# Every FORGE_* input below carries the _PREVIEW suffix -- the same convention
# FORGE_DIAMOND_ADDRESS_TESTNET/_MAINNET already use -- so this file can sit
# alongside real testnet/mainnet forge config without any name colliding.
# Solidity scripts read bare names via vm.env*, so each is exported bare,
# resolved from its _PREVIEW source, immediately before the forge call that needs
# it -- never written bare into the generated .env below.
FORGE_RPC_URL_PREVIEW="$ANVIL_RPC_URL"
FORGE_DEV_PRIVATE_KEY_PREVIEW="$DEPLOYER_KEY"
FORGE_FEE_RECIPIENT_ADDRESS_PREVIEW="$FEE_RECIPIENT_ADDRESS"
FORGE_DEFAULT_PLATFORM_FEE_BPS_PREVIEW=750
FORGE_SERVER_ADDRESS_PREVIEW="$SERVER_ADDRESS"
ERC8004_SEED_BLOCK_PREVIEW=0 # our own fresh chain, not the real testnet's seed block

# Generated fresh per sandbox, unlike the public Anvil dev keys above -- this is an
# application-level secret (see PLATFORM_MASTER_KEY in .env.example), not chain
# material, so it gets its own random value per environment rather than a shared
# well-known one. Same generation method .env.example already recommends for
# ADMIN_SECRET.
PLATFORM_MASTER_KEY_GENERATED="$(openssl rand -hex 32)"

cd packages/contracts
FORGE_DEV_PRIVATE_KEY="$FORGE_DEV_PRIVATE_KEY_PREVIEW" \
  forge script script/DeployMockUSDCPreview.s.sol:DeployMockUSDCPreview \
  --rpc-url "$FORGE_RPC_URL_PREVIEW" --broadcast 2>&1 | tee /tmp/usdc-deploy.log
USDC_ADDRESS="$(grep 'Mock USDC deployed at:' /tmp/usdc-deploy.log | awk '{print $NF}')"
cd "$REPO_ROOT"

FORGE_RPC_URL="$FORGE_RPC_URL_PREVIEW" \
  FORGE_DEV_PRIVATE_KEY="$FORGE_DEV_PRIVATE_KEY_PREVIEW" \
  FORGE_USDC_TOKEN_ADDRESS="$USDC_ADDRESS" \
  FORGE_FEE_RECIPIENT_ADDRESS="$FORGE_FEE_RECIPIENT_ADDRESS_PREVIEW" \
  FORGE_DEFAULT_PLATFORM_FEE_BPS="$FORGE_DEFAULT_PLATFORM_FEE_BPS_PREVIEW" \
  make deploy preview 2>&1 | tee /tmp/diamond-deploy.log
DIAMOND_ADDRESS="$(grep 'Diamond deployed at:' /tmp/diamond-deploy.log | awk '{print $NF}')"

# The backend's own auth/relay wallet (SERVER_PRIVATE_KEY) is the forwarder's
# authorized relayer -- DeployForwarder reads FORGE_SERVER_ADDRESS for that, plus
# the same USDC_TOKEN_ADDRESS/CONTRACT_ADDRESS names the backend itself uses
# (DeployForwarder.s.sol has no FORGE_ prefix on those two -- see its source).
cd packages/contracts
FORGE_DEV_PRIVATE_KEY="$FORGE_DEV_PRIVATE_KEY_PREVIEW" \
  USDC_TOKEN_ADDRESS="$USDC_ADDRESS" \
  CONTRACT_ADDRESS="$DIAMOND_ADDRESS" \
  FORGE_SERVER_ADDRESS="$FORGE_SERVER_ADDRESS_PREVIEW" \
  forge script script/DeployForwarder.s.sol:DeployForwarder \
  --rpc-url "$FORGE_RPC_URL_PREVIEW" --broadcast 2>&1 | tee /tmp/forwarder-deploy.log
FORWARDER_ADDRESS="$(grep 'Forwarder (FORWARDER_ADDRESS):' /tmp/forwarder-deploy.log | awk '{print $NF}')"
cd "$REPO_ROOT"

cat > .env << EOF
# Generated by scripts/cloud-env-setup.sh -- local sandbox stack.
# Anvil default dev keys: public knowledge, sandbox-only, never real networks.
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME

# CLI (apps/cli/src/lib/api.ts) -- points the built CLI at this sandbox's own
# backend. Build and run it with \`make cli <args>\` (see Makefile).
TASKMARKET_API_URL=http://127.0.0.1:3000

# Backend runtime config (apps/backend/src/config/env.ts) -- plain values, same
# as .env.example's "Testnet overrides" comment block. The backend is one
# running process handed one set of values for wherever it's deployed; there's
# no testnet/mainnet-style CLI selection at this layer, so no _PREVIEW suffix.
CHAIN_ID=84532
BASE_RPC_URL=$ANVIL_RPC_URL
CONTRACT_ADDRESS=$DIAMOND_ADDRESS
FORWARDER_ADDRESS=$FORWARDER_ADDRESS
USDC_TOKEN_ADDRESS=$USDC_ADDRESS
# ERC-8004 registries: cloned from Base Sepolia onto this Anvil chain at the same
# addresses (step 7 above), not redeployed -- so these are the real, unchanged
# testnet addresses, not new local ones.
ERC8004_IDENTITY_REGISTRY=$ERC8004_IDENTITY_REGISTRY
ERC8004_REPUTATION_REGISTRY=$ERC8004_REPUTATION_REGISTRY
ERC8004_SEED_BLOCK=$ERC8004_SEED_BLOCK_PREVIEW
X402_FACILITATOR_URL=http://127.0.0.1:$FACILITATOR_PORT
DEFAULT_PLATFORM_FEE_BPS=750
USDC_DOMAIN_NAME=USD Coin
CORS_ORIGIN=http://localhost:5173
SERVER_PRIVATE_KEY=$SERVER_KEY
PLATFORM_MASTER_KEY=$PLATFORM_MASTER_KEY_GENERATED

# Contract deploy scripts (packages/contracts/script/*.s.sol) -- FORGE_ prefix,
# every one suffixed _PREVIEW. Unlike the backend section above, \`make deploy
# <testnet|mainnet|preview>\` genuinely does select between real, different
# networks from one shared .env file, the same way FORGE_DIAMOND_ADDRESS_TESTNET
# /_MAINNET already do -- picking the wrong one risks a real deploy against the
# wrong chain, so every FORGE_ input here carries its network suffix, never bare.
FORGE_RPC_URL_PREVIEW=$FORGE_RPC_URL_PREVIEW
FORGE_DEV_PRIVATE_KEY_PREVIEW=$FORGE_DEV_PRIVATE_KEY_PREVIEW
FORGE_FEE_RECIPIENT_ADDRESS_PREVIEW=$FORGE_FEE_RECIPIENT_ADDRESS_PREVIEW
FORGE_DEFAULT_PLATFORM_FEE_BPS_PREVIEW=$FORGE_DEFAULT_PLATFORM_FEE_BPS_PREVIEW
FORGE_SERVER_ADDRESS_PREVIEW=$FORGE_SERVER_ADDRESS_PREVIEW
# Deploy outputs (this run's freshly deployed addresses), not per-network config
# inputs -- preview/local always redeploys fresh rather than reading a static
# known address the way testnet/mainnet upgrades do, so these have no bare
# testnet/mainnet counterpart to collide with.
FORGE_USDC_TOKEN_ADDRESS_PREVIEW=$USDC_ADDRESS
FORGE_DIAMOND_ADDRESS_PREVIEW=$DIAMOND_ADDRESS
FORGE_FORWARDER_ADDRESS_PREVIEW=$FORWARDER_ADDRESS

# Smoke tests (apps/backend/scripts/smoke-*.ts)
DEV_PRIVATE_KEY=$DEPLOYER_KEY
REQUESTER_PRIVATE_KEY=$REQUESTER_KEY
WORKER_PRIVATE_KEY=$WORKER_KEY
WORKER_B_PRIVATE_KEY=$WORKER_B_KEY
EVALUATOR_PRIVATE_KEY=$EVALUATOR_KEY

# Web app (apps/web, Next.js -- NEXT_PUBLIC_ prefix)
NEXT_PUBLIC_SITE_URL=http://localhost:3001
NEXT_PUBLIC_PLATFORM_FEE_BPS=750
NEXT_PUBLIC_CHAIN_ID=84532
NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=$ANVIL_RPC_URL
EOF

echo "==> [9/10] Build the CLI"
make cli

echo "==> [10/10] Done"
echo "Diamond:     $DIAMOND_ADDRESS"
echo "Mock USDC:   $USDC_ADDRESS"
echo "Forwarder:   $FORWARDER_ADDRESS"
echo "Facilitator: http://127.0.0.1:$FACILITATOR_PORT"
echo "CLI:         built at apps/cli/dist/index.js -- run with \`make cli <args>\`"
echo "Next: start the backend (make dev, or the backend app directly -- migrations"
echo "run on boot), then run smoke tests: make smoke <mode>"
