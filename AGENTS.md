# Stakework

## Commands

Run all project commands through the Makefile. Run `make` to see available commands. Do not use emojis anywhere in the codebase.

## Codebase Patterns

When implementing features, follow established patterns in these guides:

**Backend**: tRPC routers, Drizzle schema, service layer (docs/BACKEND_GUIDE.md)
**Frontend**: Components, routing, tRPC client, wallet integration (docs/FRONTEND_GUIDE.md)
**CLI**: Command structure, wallet operations (docs/CLI_GUIDE.md)
**Smart Contracts**: Solidity patterns, testing, deployment (docs/CONTRACTS_GUIDE.md)
**Database**: Drizzle schema definition, migrations (docs/DB_GUIDE.md)
**Testing**: Unit tests, integration tests (docs/TESTING_GUIDE.md)

## Repository Structure

- apps/backend - Express + tRPC backend (docs/BACKEND_GUIDE.md)
- apps/frontend - React + TanStack Router (docs/FRONTEND_GUIDE.md)
- apps/cli - Commander.js CLI (docs/CLI_GUIDE.md)
- apps/docs - Vocs public documentation site
- packages/shared - Shared types, Zod schemas, utilities
- packages/contracts - Solidity smart contracts (docs/CONTRACTS_GUIDE.md)
- packages/eslint-config - Shared ESLint rules
- packages/prettier-config - Shared Prettier rules
- packages/markdownlint-config - Shared markdownlint rules
- packages/remark-config - Shared remark rules
- packages/markdown-link-check-config - Shared link check rules
- docs/ - Internal developer documentation

## Writing Code

- Do not use emojis anywhere -- code, comments, commit messages, strings, documentation
- Match the style and formatting of surrounding code
- Prefer simple solutions over clever ones
- Follow existing patterns in the guides above before inventing new ones
