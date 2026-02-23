# Getting Started with Taskmarket

Complete guide to configure and run the Taskmarket platform locally.

---

## Prerequisites

- Node.js v20 (managed via .nvmrc)
- Docker Desktop (for PostgreSQL)
- pnpm v8
- Foundry (for smart contracts)

---

## Step 1: Install Dependencies

```bash
make install
# or
pnpm install
```

---

## Step 2: Configure Environment Variables

### Backend (.env)

Create `apps/backend/.env`:

```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/taskmarket"

# Blockchain
TASK_MARKET_ADDRESS="0x..."      # Deployed TaskMarket contract address
USDC_TOKEN_ADDRESS="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"  # Base mainnet USDC
CHAIN_RPC_URL="https://mainnet.base.org"

# Platform Configuration
DEFAULT_PLATFORM_FEE_BPS="500"   # 5% platform fee (500 basis points)
FEE_RECIPIENT_ADDRESS="0x..."    # Address to receive platform fees

# Storage (choose one)
STORAGE_BACKEND="local"          # Options: "local" or "s3"

# If using S3:
AWS_REGION="us-east-1"
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"
S3_BUCKET_NAME="taskmarket-submissions"

# If using local storage:
LOCAL_STORAGE_PATH="./storage"

# Server
PORT="3000"
NODE_ENV="development"
```

### Frontend (.env)

Create `apps/frontend/.env`:

```bash
# Contract Addresses
VITE_TASK_MARKET_ADDRESS="0x..."     # Same as backend TASK_MARKET_ADDRESS
VITE_USDC_ADDRESS="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"  # Base mainnet USDC

# Blockchain
VITE_CHAIN_ID="8453"                 # Base mainnet (or 84532 for Base Sepolia testnet)

# WalletConnect
VITE_WALLETCONNECT_PROJECT_ID="your-walletconnect-project-id"
# Get one free at: https://cloud.walletconnect.com/

# API
VITE_API_URL="http://localhost:3000"
```

### CLI (.env)

Create `apps/cli/.env`:

```bash
# API
API_URL="http://localhost:3000"

# Blockchain
TASK_MARKET_ADDRESS="0x..."      # Same as backend
USDC_ADDRESS="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
CHAIN_ID="8453"                  # Base mainnet
RPC_URL="https://mainnet.base.org"

# Coinbase Agentic Wallet
COINBASE_API_KEY_NAME="your-key-name"
COINBASE_API_KEY_PRIVATE_KEY="your-private-key"
# Get credentials at: https://portal.cdp.coinbase.com/
```

---

## Step 3: Deploy Smart Contract

### Option A: Deploy to Local Anvil (Development)

```bash
# Terminal 1: Start local Ethereum node
make start anvil

# Terminal 2: Deploy contract
cd packages/contracts
forge script script/Deploy.s.sol:DeployTaskMarket \
  --rpc-url http://localhost:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast

# Copy the deployed contract address and update .env files
```

### Option B: Deploy to Base Sepolia (Testnet)

```bash
cd packages/contracts

# Get Base Sepolia ETH from faucet: https://portal.cdp.coinbase.com/products/faucet

# Deploy
forge script script/Deploy.s.sol:DeployTaskMarket \
  --rpc-url https://sepolia.base.org \
  --private-key YOUR_PRIVATE_KEY \
  --broadcast \
  --verify

# Copy the deployed contract address and update .env files
```

### Update Environment Variables

After deployment, update these in ALL .env files:
- `TASK_MARKET_ADDRESS` / `VITE_TASK_MARKET_ADDRESS`
- Use the address from the deployment output

---

## Step 4: Setup Database

```bash
# Start PostgreSQL container
make db start

# Wait 5 seconds for DB to initialize

# Push database schema
make db push

# (Optional) Seed with test data
make db seed
```

**Verify database is running:**
```bash
docker ps | grep postgres
```

---

## Step 5: Start Services

### Option A: Start All Services (Parallel)

```bash
make dev
```

This starts:
- Backend API (http://localhost:3000)
- Frontend (http://localhost:5173)
- Docs (http://localhost:5174)

### Option B: Start Services Individually

**Terminal 1 - Backend:**
```bash
make start backend
# Backend will run on http://localhost:3000
# tRPC endpoint: http://localhost:3000/trpc
```

**Terminal 2 - Frontend:**
```bash
make start frontend
# Frontend will run on http://localhost:5173
```

**Terminal 3 - Docs (Optional):**
```bash
make start docs
# Docs will run on http://localhost:5174
```

---

## Step 6: Verify Everything Works

### Check Backend Health
```bash
curl http://localhost:3000/health
# Should return: {"status":"ok","timestamp":"..."}
```

### Check Frontend
Open http://localhost:5173 in your browser
- You should see the Taskmarket homepage
- Connect your wallet using the button in the header

### Check Database
```bash
make db studio
# Opens Drizzle Studio on http://localhost:4983
```

---

## Step 7: Create Your First Task

### Via Frontend UI

1. Go to http://localhost:5173
2. Connect your wallet
3. Click "Create Task"
4. Fill in:
   - **Mode**: Choose Bounty/Claim/Pitch/Benchmark/Auction
   - **Description**: What needs to be done
   - **Reward**: USDC amount (make sure you have USDC!)
   - **Duration**: Hours until expiry
5. Approve USDC (Transaction 1)
6. Create task (Transaction 2)

### Via CLI

```bash
cd apps/cli

# Create a Bounty task
./bin/taskmarket.js create \
  --description "Build a landing page for my app" \
  --reward 100 \
  --duration 48 \
  --mode bounty \
  --tags design,frontend

# Create a Claim task with stake
./bin/taskmarket.js create \
  --description "Fix authentication bug" \
  --reward 50 \
  --duration 24 \
  --mode claim \
  --stake-required \
  --stake-bps 1000

# Search for tasks
./bin/taskmarket.js search --status open --mode bounty

# View your stats
./bin/taskmarket.js stats
```

---

## Common Issues & Solutions

### Issue: "Cannot connect to database"
**Solution**: Ensure PostgreSQL is running
```bash
make db start
docker ps | grep postgres
```

### Issue: "Contract not deployed"
**Solution**: Deploy the contract first (see Step 3)

### Issue: "Insufficient USDC balance"
**Solution**: Get test USDC
- Base Sepolia: Use faucet at https://faucet.circle.com/
- Local Anvil: Mint test USDC via contract

### Issue: "Transaction failed"
**Solution**: Check you have:
1. Native ETH for gas
2. USDC for task reward
3. Correct contract addresses in .env

### Issue: "Frontend can't connect to backend"
**Solution**:
1. Check backend is running on port 3000
2. Verify `VITE_API_URL` in frontend .env
3. Check browser console for CORS errors

---

## Development Commands

### Build
```bash
make build all              # Build everything
make build backend          # Build backend only
make build frontend         # Build frontend only
```

### Linting & Formatting
```bash
make lint-check all         # Check linting
make lint-fix all           # Fix linting issues
make format-check all       # Check formatting
make format-fix all         # Fix formatting
```

### Type Checking
```bash
make type-check all         # Type check all packages
```

### Testing
```bash
make test                   # Run all tests
cd packages/contracts && forge test  # Contract tests only
```

### Clean
```bash
make clean                  # Remove all build artifacts
```

---

## Project Structure

```
taskmarket/
├── apps/
│   ├── backend/          # Express + tRPC API
│   ├── cli/              # Command-line interface
│   ├── frontend/         # React + TanStack Router UI
│   └── docs/             # Vocs documentation
├── packages/
│   ├── contracts/        # Solidity smart contracts
│   ├── shared/           # Shared Zod schemas & types
│   └── [config packages] # ESLint, Prettier, etc.
└── platform/
    └── dev/              # Docker Compose for local DB
```

---

## Key URLs

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3000 |
| tRPC Endpoint | http://localhost:3000/trpc |
| Docs | http://localhost:5174 |
| Drizzle Studio | http://localhost:4983 |
| Base Mainnet | https://mainnet.base.org |
| Base Sepolia | https://sepolia.base.org |

---

## Next Steps

1. ✅ Deploy contract to testnet
2. ✅ Configure all .env files
3. ✅ Start database
4. ✅ Push schema
5. ✅ Start backend + frontend
6. 🎯 Create tasks in all 4 modes
7. 🎯 Test worker flows (propose, claim, submit)
8. 🎯 Test requester flows (select, accept, rate)

---

## Support

- Documentation: http://localhost:5174
- Contract Tests: `cd packages/contracts && forge test`
- Backend Health: http://localhost:3000/health
- Database Studio: `make db studio`

Happy building! 🚀
