# Contributing to Taskmarket

Thank you for your interest in contributing to Taskmarket.

## Development Setup

1. Clone the repository
2. Install dependencies: `make install`
3. Start the database: `make start db`
4. Run database migrations: `make db migrate`
5. Start the development servers: `make dev`

## Code Style

We use ESLint and Prettier to enforce code style. Run `make check-all` to verify your code follows our standards.

- No emojis in code, comments, or commit messages
- Use single quotes for strings
- 2-space indentation
- Semicolons required
- 100 character line length

### Frontend changes

Before implementing or reviewing any change under `apps/web`, read
[docs/FRONTEND_GUIDE.md](docs/FRONTEND_GUIDE.md) in full. The guide's semantic design token,
component reuse, Server Component, interaction, accessibility, and validation requirements
are merge requirements and blocking review findings. Follow the guide's validation matrix
before opening or approving a pull request.

## Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation updates
- `refactor/description` - Code refactoring

## Commit Messages

Follow conventional commits:

- `feat: add user authentication`
- `fix: resolve database connection issue`
- `docs: update API documentation`
- `test: add unit tests for encryption`

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Run `make check-all` to verify code quality
4. Run `make test` to ensure all tests pass
5. Create a pull request with a clear description
6. Wait for CI to pass
7. Request review from maintainers

## Testing Requirements

- All new features must include unit tests
- Integration tests for API endpoints
- Ensure all tests pass before submitting PR

## Release Process

We use changesets for versioning:

1. Create a changeset: `pnpm changeset`
2. Describe your changes
3. Commit the changeset file
4. Changesets will be automatically versioned on merge to main
