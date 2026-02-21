# @taskmarket/typescript-config

Shared TypeScript configuration for the Taskmarket monorepo.

## Usage

In your package's `tsconfig.json`:

### For Node.js packages (api, cli, shared)

```json
{
  "extends": "@taskmarket/typescript-config/node.json",
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### For React packages (frontend)

```json
{
  "extends": "@taskmarket/typescript-config/react.json",
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```
