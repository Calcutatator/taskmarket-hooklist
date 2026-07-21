#!/usr/bin/env bash
# Sandbox setup for cloud coding agents (Claude Code cloud, Codex cloud).
# Brings up the full Taskmarket stack inside a single Linux VM/container:
# toolchain, native Postgres (no Docker), a local Anvil chain, contracts
# deployed to it, and a .env the Makefile's ENV_LOADER picks up -- so
# `make smoke <mode>` works entirely on localhost afterwards.
#
# STATUS: verified end to end in a real Claude Code cloud environment (triggered
# automatically by the SessionStart hook in .claude/settings.json) and in a Docker
# container standing in for one (make smoke sandbox) -- make smoke bounty passes clean,
# both the happy path and the reject path. See the "Tier-2 setup" section of
# docs/specs/agentic-development-factory-rfc.md for what that surfaced.
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
# A real cloud sandbox is a fresh container with no pre-existing Postgres, so
# 5432 never collides there. Override via env (DB_PORT=5544 ./cloud-env-setup.sh)
# when testing this script on a machine that already runs Postgres on 5432 --
# e.g. a developer's own local dev/testnet database.
DB_PORT="${DB_PORT:-5432}"

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
REQUESTER_ADDRESS="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
WORKER_KEY="0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
WORKER_ADDRESS="0x90F79bf6EB2c4f870365E785982E1f101E93b906"
WORKER_B_KEY="0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"
WORKER_B_ADDRESS="0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"
EVALUATOR_KEY="0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"
EVALUATOR_ADDRESS="0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"
FACILITATOR_KEY="0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e"
FEE_RECIPIENT_KEY="0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356"
FEE_RECIPIENT_ADDRESS="0x14dC79964da2C08b23698B3D3cc7Ca32193d9955"

echo "==> [1/12] Toolchain (Node, pnpm, bun, Foundry)"
# Match the Makefile's own ENV_LOADER (`nvm install && nvm use`, reading .nvmrc) before
# installing anything globally -- npm/pnpm installs are keyed to whichever node version is
# active at install time, and nvm keeps each version's global packages separate. Skipping
# this let pnpm get installed under the sandbox's default node, invisible once `make` later
# switches to .nvmrc's version via its own ENV_LOADER ("pnpm: command not found").
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh" && nvm install && nvm use
fi
if ! command -v pnpm > /dev/null 2>&1; then
  npm install -g pnpm@8.15.0
fi
if ! command -v bun > /dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
# Foundry's own installer only adds ~/.foundry/bin to ~/.bashrc, which non-interactive
# shells (like this script running as a hook command) never source -- so a prior run's
# install is invisible to `command -v` here even though the binary is genuinely on disk.
# Check the known install path directly first, so an already-installed forge is correctly
# found instead of triggering a needless, network-dependent reinstall on every invocation.
if [ -x "$HOME/.foundry/bin/forge" ]; then
  export PATH="$HOME/.foundry/bin:$PATH"
fi
if ! command -v forge > /dev/null 2>&1; then
  curl -L https://foundry.paradigm.xyz | bash
  export PATH="$HOME/.foundry/bin:$PATH"
  # Pinned, not "latest" -- an unpinned foundryup silently drifts to whatever release is
  # newest at run time, which can raise the MSRV out from under a from-source fallback build
  # (hit exactly this: main HEAD needed rustc 1.95, v1.7.1 only needs 1.89). A pinned version
  # also downloads a known release tarball directly rather than resolving "latest" via
  # api.github.com first, which matters in sandboxes that scope GitHub API access per-repo.
  # --force skips foundryup's SHA/attestation verification -- normally undesirable, but that
  # verification step itself needs a GitHub-scoped call this kind of sandbox blocks even for
  # a pinned version. Accepted here specifically because the version is pinned to an exact,
  # known-good release tag rather than "whatever's latest", not a general bypass.
  foundryup --install v1.7.1 --force
fi
# Belt-and-suspenders: some cloud sandboxes (Codex cloud, confirmed) run this setup script in
# a separate bash session from whatever session actually uses the repo afterwards -- a plain
# `export PATH=...` above only affects this script's own process, not that later session. The
# installers above already add these to ~/.bashrc themselves, but don't rely on that alone;
# write them explicitly and idempotently so a later interactive shell picks them up regardless
# of installer behavior.
for LINE in \
  'export PATH="$HOME/.bun/bin:$PATH"' \
  'export PATH="$HOME/.foundry/bin:$PATH"'; do
  grep -qxF "$LINE" "$HOME/.bashrc" 2>/dev/null || echo "$LINE" >> "$HOME/.bashrc"
done

echo "==> [2/12] Git submodules (contracts dependencies)"
git submodule update --init --recursive

echo "==> [3/12] Native Postgres (cloud sandboxes have no Docker)"
if ! command -v pg_isready > /dev/null 2>&1; then
  # sudo resets the environment by default -- a plain `export` here never reaches the
  # sudo'd apt-get, so tzdata's postinstall prompts interactively and hangs forever on
  # a non-interactive shell. Route it through `env` explicitly rather than relying on
  # sudo's own (sudoers-policy-dependent) VAR=value command-line parsing.
  sudo env DEBIAN_FRONTEND=noninteractive apt-get update -qq \
    && sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql
fi
PG_VERSION="$(ls /etc/postgresql | head -1)"
PG_CONF="/etc/postgresql/$PG_VERSION/main/postgresql.conf"
# Set the cluster's real listen port to $DB_PORT before starting it -- a plain
# `pg_ctlcluster ... start` always uses postgresql.conf's own port setting, so
# this has to be an edit, not a start-time flag, for psql/DATABASE_URL/every
# other tool that just connects on $DB_PORT to agree with what's actually
# listening. Harmless when DB_PORT is left at its 5432 default (a real
# sandbox is a fresh container with no pre-existing Postgres to collide with).
sudo sed -i "s/^#\?port = .*/port = $DB_PORT/" "$PG_CONF"
sudo service postgresql start || sudo pg_ctlcluster "$PG_VERSION" main start
sudo -u postgres psql -p "$DB_PORT" -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
  || sudo -u postgres psql -p "$DB_PORT" -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD' SUPERUSER"
sudo -u postgres psql -p "$DB_PORT" -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres createdb -p "$DB_PORT" -O "$DB_USER" "$DB_NAME"

echo "==> [4/12] Workspace dependencies"
make install

echo "==> [5/12] Local Anvil chain"
if ! curl -sf -X POST "$ANVIL_RPC_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' > /dev/null 2>&1; then
  # --chain-id 84532: Base Sepolia masquerade, see header note on X402.
  # setsid, not just nohup: nohup alone only makes the immediate process ignore
  # SIGHUP -- it does not reliably survive when the process is later replaced by an
  # exec'd child or wrapped by another runtime. setsid detaches the whole process
  # into its own session with no controlling terminal, so a session/terminal hangup
  # elsewhere can't reach it at all.
  setsid nohup anvil --host 127.0.0.1 --port 8545 --chain-id 84532 > /tmp/anvil.log 2>&1 &
  for _ in $(seq 1 30); do
    curl -sf -X POST "$ANVIL_RPC_URL" -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' > /dev/null 2>&1 && break
    sleep 1
  done
fi

echo "==> [6/12] Local facilitator (X402 payment verification/settlement)"
FACILITATOR_PORT=8402
# BEARER_TOKEN gates the facilitator's /verify and /settle routes specifically
# (not /supported) -- the backend must present the same token as
# X402_FACILITATOR_TOKEN or its real verify/settle calls get rejected with 401.
FACILITATOR_TOKEN="$(openssl rand -hex 32)"
if ! curl -sf "http://127.0.0.1:$FACILITATOR_PORT/supported" > /dev/null 2>&1; then
  if [ ! -d /tmp/facilitator ]; then
    git clone --depth 1 https://github.com/daydreamsai/facilitator /tmp/facilitator
  fi
  cd /tmp/facilitator
  bun install
  # The example server imports the built @daydreamsai/facilitator package, not
  # its source -- bun install alone does not build it.
  cd packages/core
  bun run build
  cd ../../examples/facilitator-server
  # setsid, not just nohup: `bun run dev` spawns the actual server as a further
  # child process, and nohup's SIGHUP-ignore on the immediate bun process doesn't
  # reliably extend to that child -- confirmed by direct testing, the underlying
  # process was killed by SIGHUP ("Terminal hung up") despite nohup. setsid
  # detaches the whole process tree into its own session with no controlling
  # terminal, so a session/terminal hangup elsewhere can't reach it at all.
  PORT="$FACILITATOR_PORT" \
    EVM_NETWORKS="base-sepolia" \
    EVM_RPC_URL_BASE_SEPOLIA="$ANVIL_RPC_URL" \
    EVM_PRIVATE_KEY="$FACILITATOR_KEY" \
    TRACKING_ALLOW_IN_MEMORY_FALLBACK="true" \
    BEARER_TOKEN="$FACILITATOR_TOKEN" \
    setsid nohup bun run dev > /tmp/facilitator.log 2>&1 &
  for _ in $(seq 1 30); do
    curl -sf "http://127.0.0.1:$FACILITATOR_PORT/supported" > /dev/null 2>&1 && break
    sleep 1
  done
  cd "$REPO_ROOT"
fi

# Clones a live EIP-1967 proxy contract (code + implementation-slot + implementation
# code) from a source chain onto this local Anvil, at the SAME address -- the actual
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

echo "==> [7/12] Clone ERC-8004 identity/reputation registries from Base Sepolia"
BASE_SEPOLIA_RPC_URL="${FORGE_BASE_SEPOLIA_RPC_URL:-https://base-sepolia.g.alchemy.com/v2/7MBoD_MGw1P6ZpTHDhBAx}"
ERC8004_IDENTITY_REGISTRY="0x8004A818BFB912233c491871b3d84c89A494BD9e"
ERC8004_REPUTATION_REGISTRY="0x8004B663056A597Dffe9eCcC1965A193B7388713"
clone_eip1967_proxy "$ERC8004_IDENTITY_REGISTRY" "$BASE_SEPOLIA_RPC_URL" "$ANVIL_RPC_URL"
clone_eip1967_proxy "$ERC8004_REPUTATION_REGISTRY" "$BASE_SEPOLIA_RPC_URL" "$ANVIL_RPC_URL"

echo "==> [8/12] Deploy mock USDC, diamond, and forwarder to local Anvil"
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

# Same rationale as PLATFORM_MASTER_KEY_GENERATED above -- ADMIN_SECRET gates the
# broadcast endpoint (see .env.example) and was previously left unset here, which
# silently failed every `make smoke broadcast` run in the sandbox (the backend
# rejects all requests when ADMIN_SECRET is unconfigured, so there was no valid
# secret to send). Generated the same way .env.example documents.
ADMIN_SECRET_GENERATED="$(openssl rand -hex 32)"

# Retries the whole invocation on a transient RPC-connection failure -- nothing has broadcast
# yet at that point, so a full retry is safe. Same helper preview.yml uses against Railway's
# anvil; kept here too so a freshly-started local anvil gets the same protection.
run_with_retry() {
  local log="$1" marker="$2"
  shift 2
  for i in $(seq 1 5); do
    "$@" 2>&1 | tee "$log"
    grep -q "$marker" "$log" && return 0
    grep -q "Application not found" "$log" || return 1
    sleep 3
  done
  return 1
}

cd packages/contracts
run_with_retry /tmp/usdc-deploy.log "Mock USDC deployed at:" \
  env FORGE_DEV_PRIVATE_KEY="$FORGE_DEV_PRIVATE_KEY_PREVIEW" \
  forge script script/DeployMockUSDCPreview.s.sol:DeployMockUSDCPreview \
  --rpc-url "$FORGE_RPC_URL_PREVIEW" --broadcast
USDC_ADDRESS="$(grep 'Mock USDC deployed at:' /tmp/usdc-deploy.log | tail -1 | awk '{print $NF}')"
cd "$REPO_ROOT"

run_with_retry /tmp/diamond-deploy.log "Diamond deployed at:" \
  env FORGE_RPC_URL="$FORGE_RPC_URL_PREVIEW" \
  FORGE_DEV_PRIVATE_KEY="$FORGE_DEV_PRIVATE_KEY_PREVIEW" \
  FORGE_USDC_TOKEN_ADDRESS="$USDC_ADDRESS" \
  FORGE_FEE_RECIPIENT_ADDRESS="$FORGE_FEE_RECIPIENT_ADDRESS_PREVIEW" \
  FORGE_DEFAULT_PLATFORM_FEE_BPS="$FORGE_DEFAULT_PLATFORM_FEE_BPS_PREVIEW" \
  FORGE_ERC8004_REPUTATION_REGISTRY="$ERC8004_REPUTATION_REGISTRY" \
  make deploy preview
DIAMOND_ADDRESS="$(grep 'Diamond deployed at:' /tmp/diamond-deploy.log | tail -1 | awk '{print $NF}')"

# The backend's own auth/relay wallet (SERVER_PRIVATE_KEY) is the forwarder's
# authorized relayer -- DeployForwarder reads FORGE_SERVER_ADDRESS for that, plus
# the same USDC_TOKEN_ADDRESS/CONTRACT_ADDRESS names the backend itself uses
# (DeployForwarder.s.sol has no FORGE_ prefix on those two -- see its source).
cd packages/contracts
run_with_retry /tmp/forwarder-deploy.log "Forwarder (FORWARDER_ADDRESS):" \
  env FORGE_DEV_PRIVATE_KEY="$FORGE_DEV_PRIVATE_KEY_PREVIEW" \
  USDC_TOKEN_ADDRESS="$USDC_ADDRESS" \
  CONTRACT_ADDRESS="$DIAMOND_ADDRESS" \
  FORGE_SERVER_ADDRESS="$FORGE_SERVER_ADDRESS_PREVIEW" \
  forge script script/DeployForwarder.s.sol:DeployForwarder \
  --rpc-url "$FORGE_RPC_URL_PREVIEW" --broadcast
FORWARDER_ADDRESS="$(grep 'Forwarder (FORWARDER_ADDRESS):' /tmp/forwarder-deploy.log | tail -1 | awk '{print $NF}')"

# Register the forwarder with the diamond -- without this, every relay() call reverts.
# DiamondDeploy can't do this itself: the forwarder doesn't exist yet at diamond-deploy time.
run_with_retry /tmp/addforwarder.log "Added forwarder:" \
  env FORGE_DEV_PRIVATE_KEY="$FORGE_DEV_PRIVATE_KEY_PREVIEW" \
  CONTRACT_ADDRESS="$DIAMOND_ADDRESS" \
  FORWARDER_ADDRESS="$FORWARDER_ADDRESS" \
  forge script script/AddForwarder.s.sol:AddForwarder \
  --rpc-url "$FORGE_RPC_URL_PREVIEW" --broadcast
tail -5 /tmp/addforwarder.log
cd "$REPO_ROOT"

# Smoke tests (and any agent driving the API directly) need the requester/
# worker/etc. accounts to actually hold mock USDC to pay through X402 --
# DeployMockUSDCPreview only mints to the deployer. mint() is permissionless
# by design for exactly this (see MockUSDC.sol).
for ACCOUNT in "$REQUESTER_ADDRESS" "$WORKER_ADDRESS" "$WORKER_B_ADDRESS" "$EVALUATOR_ADDRESS"; do
  cast send "$USDC_ADDRESS" "mint(address,uint256)" "$ACCOUNT" 1000000000000 \
    --private-key "$FORGE_DEV_PRIVATE_KEY_PREVIEW" --rpc-url "$FORGE_RPC_URL_PREVIEW" > /dev/null
done

echo "==> [9/12] Deploy reward hook stack (mock DREAMS token, vault) to local Anvil"
# Mirrors \`make deploy-reward-hook testnet\` -- same Makefile target and
# DeployRewardHookTestnet.s.sol script, just pointed at this disposable Anvil chain
# via the preview branch added to deploy-reward-hook alongside deploy's own. Lets
# smoke-token-reward-hook.ts run fully locally instead of needing a real testnet
# deploy -- see its required env vars (REWARD_HOOK_ADDRESS, MOCK_TOKEN_ADDRESS,
# VAULT_ADDRESS) in apps/backend/scripts/smoke-token-reward-hook.ts. The smoke test
# itself funds the vault from the deployer wallet, so no funding happens here.
run_with_retry /tmp/rewardhook-deploy.log "TaskTokenRewardHook:" \
  env FORGE_DEV_PRIVATE_KEY="$FORGE_DEV_PRIVATE_KEY_PREVIEW" \
  FORGE_DIAMOND_ADDRESS="$DIAMOND_ADDRESS" \
  FORGE_PGTR_FORWARDER="$FORWARDER_ADDRESS" \
  FORGE_RPC_URL="$FORGE_RPC_URL_PREVIEW" \
  make deploy-reward-hook preview
MOCK_TOKEN_ADDRESS="$(grep 'MockERC20 (mDREAMS):' /tmp/rewardhook-deploy.log | tail -1 | awk '{print $NF}')"
VAULT_ADDRESS="$(grep 'RewardVault:' /tmp/rewardhook-deploy.log | tail -1 | awk '{print $NF}')"
REWARD_HOOK_ADDRESS="$(grep 'TaskTokenRewardHook:' /tmp/rewardhook-deploy.log | tail -1 | awk '{print $NF}')"

# The reward hook is now in this diamond's default hook list (setDefaultHooks;
# AppStorage.defaultHooks can hold up to 8) for every task, not just
# smoke-token-reward-hook.ts's own scenarios -- an unfunded vault rejects any claim()
# call anywhere in the smoke suite with HookCheckClaimRejected(). Fund it once here so
# the rest of the smoke suite isn't broken by a hook it never opted into.
cast send "$MOCK_TOKEN_ADDRESS" "transfer(address,uint256)" "$VAULT_ADDRESS" 100000000000000000000000 \
  --private-key "$FORGE_DEV_PRIVATE_KEY_PREVIEW" --rpc-url "$FORGE_RPC_URL_PREVIEW" > /dev/null

cat > .env << EOF
# Generated by scripts/cloud-env-setup.sh -- local sandbox stack.
# Anvil default dev keys: public knowledge, sandbox-only, never real networks.
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@localhost:$DB_PORT/$DB_NAME

# Points both the built CLI (apps/cli/src/lib/api.ts) and the smoke test
# scripts (apps/backend/scripts/_x402.ts) at this sandbox's own backend --
# one var for both, set explicitly so neither depends on its own fallback.
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
X402_FACILITATOR_TOKEN=$FACILITATOR_TOKEN
DEFAULT_PLATFORM_FEE_BPS=750
USDC_DOMAIN_NAME="USD Coin"
CORS_ORIGIN=http://localhost:5173
SERVER_PRIVATE_KEY=$SERVER_KEY
PLATFORM_MASTER_KEY=$PLATFORM_MASTER_KEY_GENERATED
ADMIN_SECRET=$ADMIN_SECRET_GENERATED
# Defaults to false (apps/backend/src/config/env.ts), which makes xmtp.router.ts
# reject every request outright -- smoke-xmtp.ts only exercises the control-plane
# bookkeeping (bootstrap metadata, peer policy, status/heartbeat) against this
# sandbox's own Postgres, no real XMTP network connectivity needed, so this is
# safe to turn on unconditionally here.
XMTP_ENABLED=true

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
FORGE_PGTR_FORWARDER_PREVIEW=$FORWARDER_ADDRESS

# Smoke tests (apps/backend/scripts/smoke-*.ts)
DEV_PRIVATE_KEY=$DEPLOYER_KEY
REQUESTER_PRIVATE_KEY=$REQUESTER_KEY
WORKER_PRIVATE_KEY=$WORKER_KEY
WORKER_B_PRIVATE_KEY=$WORKER_B_KEY
EVALUATOR_PRIVATE_KEY=$EVALUATOR_KEY

# smoke-token-reward-hook.ts specifically -- step 9 above deploys a mock DREAMS
# token, vault, and hook onto this same local Anvil, so this smoke test can run
# fully locally instead of needing a real testnet deploy. FORGE_BASE_SEPOLIA_RPC_URL
# points its RPC client at this Anvil chain instead of its real-testnet default.
FORGE_DEV_PRIVATE_KEY=$DEPLOYER_KEY
FORGE_BASE_SEPOLIA_RPC_URL=$ANVIL_RPC_URL
REWARD_HOOK_ADDRESS=$REWARD_HOOK_ADDRESS
MOCK_TOKEN_ADDRESS=$MOCK_TOKEN_ADDRESS
VAULT_ADDRESS=$VAULT_ADDRESS

# Web app (apps/web, Next.js -- NEXT_PUBLIC_ prefix)
NEXT_PUBLIC_SITE_URL=http://localhost:3001
NEXT_PUBLIC_PLATFORM_FEE_BPS=750
NEXT_PUBLIC_CHAIN_ID=84532
NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=$ANVIL_RPC_URL
EOF

echo "==> [10/12] Build the CLI"
make cli

echo "==> [11/12] Start the backend"
# The whole point of this script is that the sandbox is ready to use the
# moment it finishes -- not "ready after one more manual step". Migrations
# run on boot; nohup keeps it alive after this script exits.
# The backend has no dotenv loading of its own -- it expects its process environment
# to already have .env's values (matching the Makefile's ENV_LOADER convention), so
# source it explicitly here rather than relying on whatever this shell inherited.
if ! curl -sf http://127.0.0.1:3000 > /dev/null 2>&1; then
  (
    set -a
    source "$REPO_ROOT/.env"
    set +a
    cd apps/backend
    # setsid, not just nohup: `pnpm dev` spawns the actual server as a further
    # child process, and nohup's SIGHUP-ignore on the immediate pnpm process
    # doesn't reliably extend to that child. setsid detaches the whole process
    # tree into its own session with no controlling terminal, so a session/
    # terminal hangup elsewhere can't reach it at all.
    setsid nohup pnpm dev > /tmp/backend.log 2>&1 &
  )
  for _ in $(seq 1 30); do
    # -w '%{http_code}' with no -f: any HTTP response (even 404) counts as "up".
    # "000" means curl couldn't connect at all. `|| true` keeps this safe under
    # `set -e` -- a bare failing curl here would otherwise abort the whole script.
    code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000 2>/dev/null || true)"
    [ "$code" != "000" ] && break
    sleep 1
  done
fi

echo "==> [12/12] Done"
echo "Diamond:     $DIAMOND_ADDRESS"
echo "Mock USDC:   $USDC_ADDRESS"
echo "Forwarder:   $FORWARDER_ADDRESS"
echo "Facilitator: http://127.0.0.1:$FACILITATOR_PORT"
echo "Backend:     http://127.0.0.1:3000 (log: /tmp/backend.log)"
echo "CLI:         built at apps/cli/dist/index.js -- run with \`make cli <args>\`"
echo "Everything is running. Try: make smoke bounty"
