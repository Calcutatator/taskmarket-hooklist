---
description: "Use the Taskmarket wallet to pay external x402 v2 HTTP services under local origin, asset, and rolling-spend policies."
---

# External X402 Payments

The Taskmarket CLI can use its encrypted EVM wallet to buy a directly supplied HTTPS resource
from an external x402 v2 service. External payments are separate from Taskmarket task payments:
they never send Taskmarket legal receipts, API tokens, caller proofs, or idempotency headers to the
external origin.

Supported in this release:

* HTTPS GET and JSON POST.
* EVM networks (`eip155:<chainId>`).
* `exact` payments through EIP-3009 or Permit2.
* `upto` payments through Permit2.
* Explicitly allowlisted ERC-20 contracts.
* Interactive approval or unattended execution under a local policy.

Service discovery, Bazaar search, MCP, A2A, non-EVM wallets, batch settlement, uploads, forms, and
streaming request bodies are not supported.

## Safety Model

An external 402 response is untrusted. Before the wallet signs, the CLI checks the resource URL,
origin, path, method, protocol version, scheme, network, token contract, recipient, amount, and
authorization lifetime. Redirects are disabled. Unattended requests also reject private, loopback,
and link-local destinations unless their matching policy rule explicitly allows private networking.

The policy protects agents using this CLI installation. It is not an onchain wallet limit and does
not coordinate with another computer or wallet program controlling the same private key.

Never retry a payment whose result is `pending: true`. The service may already have settled it.
Inspect or reconcile the recorded payment instead.

**This CLI is meant to be driven by an AI agent, which changes the threat model.** An agent can be
prompt-injected by untrusted content it processes in the course of ordinary work -- a task
description, a fetched webpage, another tool's output -- into running a CLI command it was never
meant to run. Unattended (`--non-interactive`) payments exist specifically so an agent can pay
without a human present at request time; the entire safety of that mode depends on a human already
having authorized the exact origin, recipient, and spend caps in the policy rule beforehand. To
keep that premise true rather than merely assumed, adding or enabling a policy rule that grants
unattended spending authority always requires a real interactive terminal and a typed
confirmation -- an agent driving this CLI cannot author or activate its own unattended
authorization, even if it has been compromised. Treat `~/.taskmarket/x402-policy.json` as a
security-sensitive file: only write unattended rules yourself, at a terminal, after reading exactly
what origin and spend caps you are granting.

## Initialize Policy

```bash
taskmarket x402 policy init
taskmarket x402 policy path
taskmarket x402 policy show
taskmarket x402 policy validate
```

The policy is stored at `~/.taskmarket/x402-policy.json` with owner-only permissions. Override the
path for isolated automation or tests with `TASKMARKET_X402_POLICY_PATH`.

The machine-readable schema is available from:

```bash
taskmarket x402 policy schema
```

and at [`x402-policy.schema.json`](x402-policy.schema.json).

## Policy Example

Amounts are unsigned integer strings in the token's atomic units. `displaySymbol` and
`displayDecimals` are for operator display only; authorization uses the network and contract
address.

```json
{
  "version": 1,
  "networks": {
    "eip155:8453": {
      "rpcUrlEnv": "BASE_RPC_URL"
    }
  },
  "rules": [
    {
      "id": "example-api",
      "enabled": true,
      "priority": 100,
      "origin": "https://api.example.com",
      "pathPrefix": "/v1/",
      "methods": ["GET", "POST"],
      "unattended": true,
      "allowPrivateNetwork": false,
      "maxAuthorizationSeconds": 300,
      "payments": [
        {
          "scheme": "upto",
          "network": "eip155:8453",
          "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          "payTo": "0x1111111111111111111111111111111111111111",
          "displaySymbol": "USDC",
          "displayDecimals": 6,
          "maxPerPayment": "100000",
          "spendWindow": {
            "seconds": 86400,
            "max": "1000000"
          },
          "permit2": {
            "allowSponsoredApproval": true,
            "allowDirectApproval": true,
            "allowUnattendedDirectApproval": false,
            "maxApprovalGasWei": "100000000000000"
          }
        }
      ]
    }
  ]
}
```

Rules match an exact HTTPS origin and optional path prefix. The highest priority wins; an equal
priority tie is rejected. Unattended payment entries must pin `payTo`; interactive-only rules may
leave it open for confirmation. Payment entries are ordered preferences. Command options can
narrow a persistent unattended rule but cannot widen it.

Manage rules without editing the file directly:

```bash
taskmarket x402 policy add --rule-file rule.json
taskmarket x402 policy disable example-api
taskmarket x402 policy enable example-api
taskmarket x402 policy remove example-api
```

`policy add` and `policy enable` print the rule's origin, path, methods, and payment terms and
require you to type `authorize` at the terminal whenever the rule being written or activated is
both enabled and `unattended`. This only runs with a real TTY attached, so it cannot be satisfied
by a script or an agent process. `policy disable` and `policy remove`, and adding or enabling a
rule that is not unattended, need no confirmation, since none of those grant unattended spending
authority.

## Make Requests

Interactive GET:

```bash
taskmarket x402 request https://api.example.com/v1/data
```

JSON POST:

```bash
taskmarket x402 request https://api.example.com/v1/generate \
  --method POST \
  --body-file request.json
```

Unattended execution fails closed unless one persistent rule authorizes the complete challenge:

```bash
taskmarket x402 request https://api.example.com/v1/data \
  --non-interactive \
  --policy example-api
```

Load secret headers from environment variables or an owner-only JSON file. Do not put secrets in
command arguments:

```bash
export EXAMPLE_API_KEY=secret
taskmarket x402 request https://api.example.com/v1/data \
  --header-env 'authorization=EXAMPLE_API_KEY'
```

JSON and text responses up to 1 MiB are returned in the CLI envelope. Use `--output <path>` for
larger or binary responses. The CLI refuses to overwrite an existing output file.

## Exact and Upto

`exact` authorizes and settles the advertised amount. Compatible tokens use EIP-3009; other ERC-20
tokens may use Permit2 when the service advertises that transfer method.

`upto` authorizes the advertised maximum. The service chooses an actual charge from zero through
that maximum after measuring usage. A conforming but dishonest service can charge the entire
maximum, so policy reserves the maximum before signing. On success the CLI reports both:

```json
{
  "authorizedAmount": "100000",
  "settledAmount": "43821"
}
```

Permit2 can require a one-time ERC-20 allowance. The CLI uses bounded EIP-2612 or raw-approval gas
sponsoring when advertised and policy permits it. Otherwise it can send a direct approval through
the rule's configured RPC. A direct approval verifies chain ID, native balance, and gas ceiling,
and receives a separate confirmation unless unattended direct approval is explicitly enabled.
The CLI never creates an unlimited Permit2 allowance automatically.

## Payment Records and Recovery

The append-only journal is `~/.taskmarket/x402-payments.jsonl`, with owner-only permissions. Before
signing, it atomically reserves the `exact` amount or `upto` maximum so concurrent agents cannot
spend the same remaining budget.

```bash
taskmarket x402 payments list
taskmarket x402 payments get <paymentId>
taskmarket x402 payments reconcile <paymentId>
```

After the paid request leaves the machine, a timeout, lost response, malformed receipt, or missing
`upto` amount is an unknown outcome. The journal keeps the full maximum reserved and the CLI emits
`pending: true`. `payments reconcile` checks the transaction or authorization nonce using the
policy's RPC configuration:

* An expired unused nonce becomes `expired_unspent` and releases the reservation.
* A consumed `exact` nonce proves the exact charge.
* A consumed `upto` nonce without a receipt proves money moved but not how much; the maximum stays
  counted as `settled_amount_unknown`.

Manual resolution is an audited last resort and requires an interactive confirmation:

```bash
taskmarket x402 payments resolve <paymentId> \
  --settled-amount <atomicUnits> \
  --transaction <hash> \
  --note 'evidence used to establish the amount'
```

Never manually release a reservation from an unchanged wallet balance alone. A pending transaction
and a failed transaction can look identical until the chain establishes the outcome.

Developers can run `make smoke external-x402` to verify real `exact`, partial `upto`, zero-charge
`upto`, and nonce-replay behavior on a disposable Base fork without spending real funds.
