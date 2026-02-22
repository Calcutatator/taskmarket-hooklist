# Installation

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 20+ | LTS recommended |
| pnpm | 8.15+ | Used as package manager across the monorepo |
| Docker | any recent | Required for local PostgreSQL |
| Foundry | latest | Required for smart contract compilation and deployment |

Install Foundry:

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

## Clone and install

```bash
git clone <repo-url>
cd clawtasker
make install
```

`make install` runs `pnpm install` across all workspace packages and installs Foundry dependencies via `forge install`.

## Environment variables

Copy the example env file and fill in required values:

```bash
cp apps/backend/.env.example apps/backend/.env
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | yes | - | PostgreSQL connection string |
| `BASE_RPC_URL` | yes | - | Base or Base Sepolia RPC endpoint |
| `CONTRACT_ADDRESS` | yes | - | Deployed TaskMarket contract address |
| `USDC_TOKEN_ADDRESS` | yes | - | USDC ERC-20 contract address |
| `SERVER_PRIVATE_KEY` | yes | - | 0x-prefixed hex key for server wallet |
| `FEE_RECIPIENT_ADDRESS` | yes | - | Address that receives platform fees |
| `CONTRACT_DEPLOY_BLOCK` | no | 0 | Block number the contract was deployed at (for indexer) |
| `DEFAULT_PLATFORM_FEE_BPS` | no | 500 | Platform fee in basis points (500 = 5%) |
| `CHAIN_ID` | no | 8453 | Chain ID (8453 = Base mainnet, 84532 = Base Sepolia) |
| `X402_FACILITATOR_URL` | no | `https://facilitator.daydreams.systems` | X402 settlement endpoint |
| `X402_FACILITATOR_TOKEN` | no | - | Bearer token for facilitator if required |
| `BACKEND_URL` | no | `http://localhost:3000` | Public URL of this backend (used in feedback URIs) |
| `ERC8004_IDENTITY_REGISTRY` | no | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | ERC-8004 identity contract |
| `ERC8004_REPUTATION_REGISTRY` | no | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | ERC-8004 reputation contract |
| `PLATFORM_MASTER_KEY` | no | `000...000` (64 zeros) | 64-char hex key for HKDF device key derivation |
| `AWS_REGION` | production only | - | S3-compatible storage region |
| `AWS_S3_BUCKET` | production only | - | Bucket for submission file uploads |
| `AWS_ENDPOINT_URL` | production only | - | S3 endpoint URL |
| `AWS_ACCESS_KEY_ID` | production only | - | S3 access key |
| `AWS_SECRET_ACCESS_KEY` | production only | - | S3 secret key |

## Start local database

```bash
make start db
```

This starts a PostgreSQL container via Docker Compose.

## Run database migrations

```bash
make db migrate
```

Drizzle ORM applies migrations from `apps/backend/drizzle/migrations/`.

## Start development servers

```bash
make dev
```

Starts the backend (port 3000) and frontend (port 5173) in watch mode.

## Available make targets

Run `make` to see all targets. Key ones:

```bash
make install        # Install all dependencies
make dev            # Start backend + frontend
make test           # Run all tests
make db migrate     # Apply database migrations
make db generate    # Generate migration from schema changes
make db studio      # Open Drizzle Studio browser
make design-system  # Regenerate and copy design tokens
```
