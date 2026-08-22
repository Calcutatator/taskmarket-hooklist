# Taskmarket hook manifest

`taskmarket-hook.json` is a portable declaration for an external ERC-8195 /
Taskmarket hook. Validate version 1 manifests against
[`schemas/taskmarket-hook.schema.json`](../schemas/taskmarket-hook.schema.json), served
after release at
`https://taskmarket.dev/schemas/taskmarket-hook/1.0.0/schema.json`, and with:

```sh
pnpm validate:hook-manifest -- path/to/taskmarket-hook.json
```

Run commands from this package root (`packages/contracts` in the official monorepo).
The official monorepo byte-for-byte checks its hosted web asset against this canonical
source so the URL cannot drift from the published schema.

The manifest is deliberately descriptive. Four fields must not be conflated:

- `listing` is a registry/listing status.
- `sourceVerification` records explorer/source-verifier evidence.
- `conformance` records interface/test conformance evidence; it is not an audit.
- `protocolDefault` records whether a diamond selects the hook by default; it is
  independent of every status above.

`security.audits` separately records audit status and scope. In a publishable manifest,
`submitted` and `listed` listings require `listingUrl`; `tested` and
`independently-verified` conformance requires `evidence`; and an `audited` entry
requires its `report` URL. Consumers should verify all claims against the cited sources
and the chain; a valid manifest is not an endorsement.

Every externally rendered URL is HTTPS-only: author and source links, verifier and
dependency URLs, audit reports, listings, conformance evidence, and protocol-default
evidence. Consumers must still escape and safely render those untrusted destinations.

For publication, `sourceVerification.status: verified` requires at least one verifier
and every verifier entry must be verified. `partially-verified` requires both verified
and pending/unverified evidence. Verifier chain IDs must match declared deployments.

## Required deployment evidence

Every deployment includes its EIP-155 `chainId`, nonzero hook and Taskmarket diamond
addresses, a nonzero deploy transaction and block, and a nonzero runtime bytecode hash.
Addresses are strict 20-byte `0x` hex values; transactions and codehashes are strict
`bytes32`. The source is pinned by repository URL, a nonzero commit, and source path.
Published gas estimates must be nonzero. A zero address, all-zero hash or commit, zero
deployment block, or zero gas estimate is rejected as incomplete evidence.

The portal may emit placeholders only with an explicit true/object `x-draft` extension.
Generic Draft 2020-12 validation conditionally accepts that schema-shaped editing output,
but the marker explicitly means it is never publishable and the CLI reports it as such.
Draft affirmative statuses may temporarily omit their evidence URLs. An absent or false
marker activates the schema's non-placeholder and affirmative-evidence publication rules.
Remove `x-draft` only after replacing every placeholder with independently checked
evidence.

## Callbacks and modes

`callbacks` may only declare the Taskmarket interface callbacks: `checkFund`,
`checkClaim`, `checkSelectWorker`, `checkSubmit`, `checkEvaluate`, `checkComplete`,
`onComplete`, `onForfeit`, `onCancel`, and `onExpire`. `taskModes` is the declared
compatibility set: `bounty`, `claim`, `pitch`, `auction`, or `benchmark`.

## hookData is publisher-attested metadata

`hookData.encoding` is either:

- `none`: the exact wire value is `0x`; `schema` must be `{}` and each example has
  `decoded: null`, `encoded: "0x"`.
- `abi`: `abiType` declares the Solidity ABI type expression, `schema` describes its
  decoded values, and each example supplies claimed ABI hex bytes in `encoded`.

The package validator applies the same canonical schema with Ajv 2020 and standard
format validation, then adds only the documented cross-field consistency checks. The
schema is self-contained so the hosted mirror remains portable to other Draft 2020-12
validators. Validation checks this publisher-attested metadata structurally only; it
does not prove that `abiType`, `decoded`, `schema`, and `encoded` are semantically
equivalent. Consumers must independently ABI-decode `encoded` using `abiType` and
validate the decoded result before relying on it. Do not put a JSON serialization in
`encoded`. Add new, incompatible formats through a new `manifestVersion` and schema
URL; vendor additions may use `x-` keys.

## Operations and trust

Declare proxy kind, implementation, admin/timelock and upgrade authority for upgradeable
hooks. `kind: none` is reserved for immutable hooks and those manifests must omit
proxy-only authority fields. List all privileged role holders and capabilities,
external contracts/services, and liveness failure and recovery behavior.

Gas estimates must match `callbacks` exactly and include a methodology. A `candidate`
protocol-default claim requires evidence. A `default-on-some-chains` or
`default-on-all-declared-chains` claim also requires deployment-backed chain IDs; the
latter must list every declared deployment. Keep security assumptions, audits, and known
limitations in `security.notes`.

The valid fixtures are test data, not real deployments. `portal-ready.json` matches the
portal generator's ready output shape and is validated in the package test suite:

```sh
pnpm validate:hook-manifest -- tools/hook-manifest/fixtures/valid/simple-immutable.json
pnpm validate:hook-manifest -- tools/hook-manifest/fixtures/valid/advanced-proxy.json
pnpm validate:hook-manifest -- tools/hook-manifest/fixtures/valid/portal-ready.json
```
