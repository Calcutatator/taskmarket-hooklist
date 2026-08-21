# Taskmarket Hooklist

A public, searchable registry of hook contracts observed on [Taskmarket](https://taskmarket.dev). It follows the useful parts of the [Uniswap Hooklist](https://github.com/uniswap/hooklist) model—a canonical registry, generated aggregate, filters, and contract details—while indexing Taskmarket's own hooks and task modes on Base.

The registry currently discovers **3 hook contracts across 214 observed public task-hook uses**. Counts refresh from Taskmarket at request time and fall back to the checked-in snapshot if the upstream API is unavailable.

## What it does

- Discovers `hookContract` and `hooks` values from every public Taskmarket task.
- Hydrates task details when the list endpoint omits hook fields.
- De-duplicates addresses and aggregates usage, active tasks, modes, statuses, requesters, tags, and examples.
- Merges community-maintained metadata without treating inclusion as an endorsement.
- Filters by text, task mode, activity, and metadata, with filters reflected in the URL.
- Shows full addresses, BaseScan/source links, proxy implementation details, and representative tasks in an accessible detail drawer.
- Serves a live `/api/hooks` endpoint with a generated `/registry.json` fallback.

## Run locally

Node.js 20 or later is required. There are no runtime dependencies.

```bash
npm start
```

Open [http://localhost:4173](http://localhost:4173).

To point the indexer at another compatible backend:

```bash
TASKMARKET_API_URL=https://api.taskmarket.dev npm start
```

## Registry layout

```text
data/hooks/index.json                 canonical metadata index
data/hooks/<lowercase-address>.json  one curated metadata record per hook
public/registry.json                 generated offline fallback
api/hooks.js                         serverless live registry endpoint
schema/                              JSON schemas for source and output data
scripts/                             build and validation commands
```

Discovery and curation are intentionally separate. Public onchain usage determines whether a hook appears; the files under `data/hooks/` add human-readable metadata such as a name, repository, audit, or verification state.

## Add or improve a hook

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version:

1. Add or edit `data/hooks/<address>.json`.
2. Add new addresses to `data/hooks/index.json`.
3. Run `npm run registry:build`, `npm run registry:validate`, and `npm test`.
4. Open a pull request with links that substantiate every verification, audit, proxy, or authorship claim.

You can also start with the repository's **Submit hook metadata** issue form.

## Commands

```bash
npm run check              # JavaScript syntax checks
npm test                   # unit and HTTP contract tests
npm run registry:build     # refresh public/registry.json from Taskmarket
npm run registry:validate  # validate metadata and generated output
```

For reproducible fixture builds, pass a local Taskmarket task response:

```bash
node scripts/build-registry.js --input tasks.json --generated-at 2026-08-21T00:00:00Z
```

## Deploy

The repository is ready to import into Vercel with the **Other** framework preset. Vercel serves `public/` as the static output and deploys `api/hooks.js` as the live registry function; `vercel.json` gives the first refresh up to 30 seconds and adds restrictive browser security headers. No build command or environment variable is required for the default Taskmarket API.

### GitHub Pages

GitHub Pages can host the registry UI, but it cannot run the Node `/api/hooks` endpoint. The included Pages workflow therefore refreshes `public/registry.json` in GitHub Actions, validates it, builds a path-independent static artifact, and deploys that snapshot. It runs on every `main` push, on manual dispatch, and every six hours. If a refresh fails, the workflow fails and GitHub Pages keeps serving the previous successful deployment rather than silently republishing stale data.

One-time repository setup: open **Settings → Pages → Build and deployment** and select **GitHub Actions** as the source. Protect the `github-pages` environment so only `main` can deploy. The workflow in `.github/workflows/pages.yml` then handles later deployments.

To inspect the exact artifact locally:

```bash
npm run pages:build
npm run pages:validate
```

Serve `dist/` from any static server. Relative asset and registry URLs allow the same artifact to work at `https://<owner>.github.io/<repository>/` or behind a Pages custom domain.

## API

`GET /api/hooks` returns:

```json
{
  "generatedAt": "2026-08-21T14:19:00.000Z",
  "source": "https://api.taskmarket.dev/api/tasks?status=ALL",
  "chainId": 8453,
  "totalTasksScanned": 229,
  "totalHooks": 3,
  "hooks": []
}
```

Responses use a five-minute shared cache with stale-while-revalidate behavior. A warm process can serve the last good registry while refreshing; a cold process falls back to `public/registry.json` if both live discovery and hydration fail.

## Trust model

This is a discovery registry, not an approval list. A hook can execute arbitrary contract logic during Taskmarket lifecycle checks and callbacks. Before using one, inspect the effective implementation, confirm proxy targets, review audits, and understand the permissions requested by the task. “Verified source” means the effective behavior source was verified; a verified proxy shell alone does not qualify.

Taskmarket's hook interface and lifecycle are documented in the [official hook reference](https://taskmarket.dev/reference/hooks.md).
