# Contributing hook metadata

Thank you for helping make Taskmarket hooks easier to discover and evaluate. The registry indexes public hook use automatically; contributions add the context that cannot be inferred safely from a contract address alone.

## Before submitting

- Use the Base mainnet hook address in lowercase.
- Only make claims you can support with a public source.
- Link to the effective implementation source, not only a proxy contract.
- Do not mark `verified` as `true` when only the proxy shell is verified.
- Do not describe inclusion as an endorsement, certification, or security review.

## Add a metadata record

Create `data/hooks/<lowercase-address>.json` and add the same address to `data/hooks/index.json`.

```json
{
  "$schema": "../../schema/hook-metadata.schema.json",
  "address": "0x0000000000000000000000000000000000000000",
  "chainId": 8453,
  "name": "Example hook",
  "description": "A factual description of the hook's observed behavior.",
  "author": "Example contributor",
  "repository": "https://github.com/example/example-hook",
  "license": "MIT",
  "categories": ["rewards"],
  "verified": true,
  "sourceUrl": "https://basescan.org/address/0x0000000000000000000000000000000000000000#code",
  "auditUrl": null,
  "currentDefault": false,
  "defaultStatus": "custom",
  "proxyKind": "none",
  "implementationAddress": null,
  "proxySourceVerified": false
}
```

The schema allows fields to be omitted when they are unknown. Prefer omission or a conservative `false`/`unknown` value over guessing.

## Field guidance

- `name`, `description`, `author`: factual display metadata.
- `repository`, `homepage`, `license`: project links and declared license.
- `categories`: lowercase, stable discovery terms such as `rewards` or `protocol-default`.
- `verified`: whether the source for the contract that defines effective hook behavior is verified.
- `sourceUrl`: a direct explorer or repository link supporting the behavior-source claim.
- `auditUrl`: a public report that covers the submitted deployment or implementation.
- `currentDefault`: reserved for Taskmarket's currently confirmed protocol default.
- `defaultStatus`: one of `current_confirmed`, `historical_confirmed`, `historical_inferred`, `custom`, or `unknown`.
- `proxyKind`: one of `none`, `none_or_unknown`, `erc1967`, or `unknown`.
- `implementationAddress`: the current implementation when the hook is a proxy.
- `proxySourceVerified`: whether the proxy shell itself has verified source; this is distinct from `verified`.

## Validate the change

```bash
npm run check
npm run registry:build
npm run registry:validate
npm test
```

`registry:build` uses the live public Taskmarket API unless `--input` is supplied. If the address has not been observed in a public task, its metadata remains curated but it will not appear in the generated registry.

## Pull request evidence

Include:

- the hook address and BaseScan link;
- a source repository or verified implementation link;
- evidence for the author, audit, and license fields when present;
- proxy and implementation evidence when applicable;
- a short explanation of any inferred rather than confirmed metadata.

Maintainers may request more conservative wording or values when the evidence is ambiguous.
