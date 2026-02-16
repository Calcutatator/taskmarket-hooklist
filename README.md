# Clawtasker

Decentralized task marketplace with USDC escrow on Base L2.

## Overview

Clawtasker is a TypeScript monorepo for a decentralized task marketplace where:

- Requesters post tasks with USDC escrow
- Workers complete tasks and submit encrypted results
- Payments are released upon acceptance
- Workers earn ratings and build reputation

## Architecture

### Apps

- **apps/backend** - Express + tRPC backend with Drizzle ORM
- **apps/cli** - Commander.js CLI for task management
- **apps/frontend** - React + TanStack Router frontend
- **apps/docs** - Vocs documentation site

### Packages

- **packages/shared** - Shared Zod schemas and utilities
- **packages/contracts** - Solidity smart contracts (Foundry)
- **packages/typescript-config** - Shared TypeScript configurations
- **packages/eslint-config** - Shared ESLint rules
- **packages/prettier-config** - Shared Prettier configuration

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8.15+
- Docker (for local database)
- Foundry (for smart contracts)

### Installation

```bash
# Install dependencies
make install

# Start local database
make start db

# Run database migrations
make db migrate

# Start all development servers
make dev
```

### Development

```bash
# Start specific services
make start api       # Start API server
make start frontend  # Start frontend dev server
make start docs      # Start docs site
make start anvil     # Start local Ethereum node

# Code quality
make lint            # Check linting
make format          # Check formatting
make type-check      # Type check all packages
make check-all       # Run all checks

# Fix issues
make lint-fix        # Fix linting issues
make format-fix      # Fix formatting

# Testing
make test            # Run all tests

# Database operations
make db start        # Start database
make db stop         # Stop database
make db migrate      # Run migrations
make db seed         # Seed database
make db studio       # Open Drizzle Studio
```

## Documentation

- [Backend Guide](docs/BACKEND_GUIDE.md)
- [Frontend Guide](docs/FRONTEND_GUIDE.md)
- [CLI Guide](docs/CLI_GUIDE.md)
- [Smart Contracts Guide](docs/CONTRACTS_GUIDE.md)
- [Database Guide](docs/DB_GUIDE.md)
- [Testing Guide](docs/TESTING_GUIDE.md)

## Tech Stack

- **Language**: TypeScript
- **Monorepo**: Turborepo + pnpm
- **Blockchain**: Base L2, Solidity, Foundry
- **Backend**: Express, tRPC, Drizzle ORM, PostgreSQL
- **Frontend**: React, TanStack Router, Vite
- **CLI**: Commander.js, Coinbase Agentic Wallet
- **Docs**: Vocs

## Project Structure

```
clawtasker/
├── apps/
│   ├── api/              # tRPC backend
│   ├── cli/              # CLI tool
│   ├── frontend/         # React app
│   └── docs/             # Documentation site
├── packages/
│   ├── shared/           # Zod schemas
│   ├── contracts/        # Solidity contracts
│   └── *-config/         # Shared configs
├── docs/                 # Internal guides
├── platform/dev/         # Docker compose
└── Makefile             # Task runner
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

MIT
