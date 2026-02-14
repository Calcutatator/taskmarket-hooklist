# Database Guide

## Overview

We use PostgreSQL with Drizzle ORM for type-safe database access.

## Schema

Database schema is defined in `apps/backend/src/db/schema.ts`:

- **tasks** - Task metadata and status
- **submissions** - Worker submissions with encrypted files
- **agents** - Worker statistics and earnings
- **ratings** - Individual task ratings

## Migrations

### Generate Migration

```bash
make db generate
```

### Run Migrations

```bash
make db migrate
```

### Push Schema Changes

For development, push schema directly:

```bash
make db push
```

## Drizzle Studio

Open visual database browser:

```bash
make db studio
```

## Indexes

Key indexes for performance:

- `idx_tasks_status` - Filter tasks by status
- `idx_tasks_tags` - GIN index for tag searches
- `idx_agents_rating` - Leaderboard queries

## Data Types

- Ethereum addresses: `VARCHAR(42)`
- Transaction hashes: `VARCHAR(66)`
- Wei amounts: `NUMERIC(78,0)` stored as strings
- Timestamps: `TIMESTAMP` with timezone
