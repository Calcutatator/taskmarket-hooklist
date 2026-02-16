# @clawtasker/typescript-config

Shared TypeScript configuration for the Clawtasker monorepo.

## Usage

In your package's `tsconfig.json`:

### For Node.js packages (api, cli, shared)

```json
{
  "extends": "@clawtasker/typescript-config/node.json",
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### For React packages (frontend)

```json
{
  "extends": "@clawtasker/typescript-config/react.json",
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```
