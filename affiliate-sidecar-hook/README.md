# Affiliate Sidecar Escrow Hook

An opt-in Taskmarket V1 hook that adds a flexible, separately funded affiliate reward to a task.

- `X` is the task reward escrowed and settled by Taskmarket.
- `Y` is the affiliate reward escrowed and settled by this hook.
- `X` and `Y` are independent explicit token amounts. The contract imposes no percentage relationship.
- Taskmarket's platform fee applies to `X`; it does not apply to `Y`.

For example, `X = 90 USDC` and `Y = 10 USDC` requires 100 USDC of funding. If the task's fee snapshot
were 7.5%, the worker would receive 83.25 USDC, the platform would receive 6.75 USDC, and the affiliate
would receive 10 USDC after successful completion. These values and the 7.5% fee are hypothetical:
callers select both amounts for every task, and Taskmarket stamps its then-current fee onto the task.

### Relationship to x402aff

[x402aff](https://github.com/MiroShark/x402aff) routes an x402 payment to a deterministic 0xSplits wallet.
Taskmarket cannot route its core reward that way because `X` must remain in the Taskmarket Diamond until
the task resolves. This implementation therefore adopts the affiliate-attribution pattern, but does not
depend on x402aff or 0xSplits: Taskmarket escrows `X`, while this hook escrows and settles the independent
sidecar amount `Y` against the same task lifecycle.

## How it works

The payer signs an EIP-712 authorization binding the sidecar allocation and a `taskTermsHash` commitment
to the complete creation-time task configuration that this hook can verify:

- Task ID and Taskmarket requester
- Payment token and task amount `X`
- Canonical task terms, including timing, mode, stake, fee, evaluator, content, tags, and final hook list
- Sidecar payer
- Affiliate ID and snapshotted beneficiary
- Refund recipient
- Affiliate amount `Y`
- Nonce and deadline

During Taskmarket's `checkFund`, the hook validates that authorization and pulls exactly `Y` from the
payer with `transferFrom`. Taskmarket has already received `X` at this point, but both operations are in
the same transaction: if the signature, allowance, balance, or `Y` transfer fails, task creation and the
`X` transfer revert as well.

The hook never transfers tokens from a lifecycle callback. It only changes internal resolution state:

| Taskmarket outcome | Sidecar outcome |
| --- | --- |
| `Accepted` | `Y` becomes claimable by the affiliate beneficiary |
| `Cancelled` / evaluator rejection | `Y` becomes claimable by the signed refund recipient |
| Normal `Expired` | `Y` becomes claimable by the signed refund recipient |
| Claim-mode forfeit and reopen | `Y` remains escrowed while the task remains live |
| Selected auction expiry with a deliverable | Taskmarket auto-completes; `Y` goes to the affiliate |

`claim(taskId)` is permissionless, but funds can only be transferred to the recipient snapshotted at
creation. `reconcile(taskId)` reconstructs resolution from Taskmarket's terminal state if a best-effort
`onComplete`, `onCancel`, or `onExpire` callback was missed. It does not create a separate sidecar timeout:
`Y` remains escrowed for as long as the Taskmarket task remains nonterminal.

## Funding integration

This is a custom, opt-in hook. It must not be installed as a protocol-default hook because every attached
task requires its own signed funding payload and a nonzero `Y`.

For the production PGTR flow, the `payer` is normally the authorized relayer/backend EOA that supplies
USDC, not the `TaskMarketForwarder` contract:

1. Quote the user a task amount `X`, affiliate amount `Y`, and total `X + Y`.
2. Resolve the affiliate code offchain and snapshot its payout address as `beneficiary`. Store a stable
   hash such as `keccak256(bytes(builderCode))` as `affiliateId`.
3. Assemble the exact task configuration. Build `TaskTerms`, including the fee basis points that
   Taskmarket will stamp at creation and `hooksHash` for the final ordered list of protocol-default hooks
   followed by the requested hooks. Compute `taskTermsHash` with the contract helper or the schema below.
4. Compute the next task ID:

   ```solidity
   keccak256(
       abi.encode(
           block.chainid,
           taskmarketDiamond,
           requester,
           ITMPCore(taskmarketDiamond).requesterNonce(requester)
       )
   )
   ```

5. Configure both allowances used by the real forwarder flow:

   - The authorized relayer approves `TaskMarketForwarder` for `X`.
   - The sidecar `payer` approves this hook for `Y`.

   When the relayer is also the sidecar payer, that one EOA needs both approvals. The EIP-712 signature
   prevents a requester from using the hook allowance without the payer's explicit per-task authorization.
6. Sign `AffiliateFunding` and ABI-encode hook data as:

   ```solidity
   abi.encode(uint8(1), fundingAuthorization, signature)
   ```

   The contract exposes `fundingDigest(...)` and `encodeHookData(...)` as integration helpers.
7. Relay `createTask` with payment amount `X`, this hook in `HookConfig.contracts`, and the encoded payload
   in the shared `HookConfig.data`. Taskmarket transfers `X`; the hook pulls `Y` atomically.

### Stock x402 and one `X + Y` checkout

The stock x402/PGTR Taskmarket route charges and forwards the core task payment `X`; it has no native
second output for `Y`. This hook therefore pulls `Y` separately from its signed payer during `checkFund`.
Do not pass `X + Y` as the forwarder's `paymentAmount`: the forwarder would send all of it to the Taskmarket
Diamond while the hook would still pull `Y`, overcharging the payer and leaving the extra amount outside the
sidecar allocation.

A product may display one `X + Y` checkout, but making that one user payment requires backend settlement or
a purpose-built router/permit flow that collects the total and atomically supplies `X` to the forwarder and
`Y` to this hook. The hook contract alone does not change the stock x402 payment route.

The EIP-712 domain is:

```text
name:              AffiliateSidecarEscrowHook
version:           1
chainId:           deployment chain ID
verifyingContract: deployed hook address
```

The signed type is:

```text
AffiliateFunding(bytes32 taskId,address requester,address paymentToken,uint256 taskAmount,bytes32 taskTermsHash,address payer,address beneficiary,address refundRecipient,bytes32 affiliateId,uint256 affiliateAmount,uint256 nonce,uint256 deadline)
```

`taskTermsHash` is the EIP-712-style struct hash of this exact canonical type:

```text
AffiliateTaskTerms(uint256 duration,bytes4 mode,uint256 pitchDuration,uint256 bidDuration,bytes4 auctionSubtype,bool stakeRequired,uint16 stakeBps,uint16 feeBps,address evaluator,uint256 evaluatorStake,uint16 evaluatorFeeBps,uint32 evaluationWindow,uint32 appealWindow,address disputeResolver,bytes32 contentHash,bytes32 contentURIHash,bytes32 tagsHash,bytes32 hooksHash)
```

Compute it as `keccak256(abi.encode(TASK_TERMS_TYPEHASH, ...all fields in the order above))`, or call
`taskTermsHash(TaskTerms)`. The dynamic creation values use these canonical hashes:

- `contentURIHash = keccak256(bytes(contentURI))`
- `tagsHash = keccak256(abi.encode(tags))`
- `hooksHash = keccak256(abi.encode(finalHooks))`, where `finalHooks` is the protocol-default list followed
  by the requested list, in dispatch order

`duration`, `pitchDuration`, and `bidDuration` are the creation-time relative durations, not absolute block
timestamps. `feeBps` is the fee Taskmarket stamps onto the task at creation. During `checkFund`, the hook
reconstructs the hash from the committed Diamond state and rejects any mismatch before pulling `Y`.

Amounts use the payment token's base units. Base USDC uses six decimals, so 1 USDC is `1_000_000`.

### Requester nonce and re-signing

Task IDs use the requester's next Taskmarket nonce. If another task for the same requester is created after
the ID is computed but before this transaction mines, the nonce advances and the authorization no longer
matches. The transaction safely reverts, including both funding legs, but the integration must fetch the new
nonce, recompute the task ID, and obtain a new signature. Recompute `taskTermsHash` too if the quoted
configuration changed. Serialize concurrent creation requests per requester where possible. A
protocol-default hook or fee change between quoting and mining can likewise change `hooksHash` or `feeBps`
and require a fresh quote and signature.

### Diamond upgrades and quote-time trust

The hook is permanently bound to an owner-upgradeable Taskmarket Diamond. The Diamond owner can replace
facets and change the protocol-default hook list. Default hooks may themselves be upgradeable. The funding
signature binds the fee value and the final ordered hook addresses, but it does not bind Diamond facet
bytecode or implementation bytecode behind a hook proxy.

Under the reviewed V20 behavior, a nonce, fee, or default-hook address change between signing and mining
changes the committed task terms and makes creation revert atomically. The integration must re-read state,
recompute the task ID and terms, and obtain a new signature. An implementation upgrade at an unchanged
address is not detected by that hash. Monitor Diamond and default-hook upgrades, stop quoting during an
unreviewed change, and re-review both creation and terminal-state semantics before resuming. The deployment
preflight below is a point-in-time compatibility check, not a guarantee about future upgrades.

### Refund recipient

The payer explicitly signs the refund recipient. Set it to:

- The requester when refunds should return directly to the Taskmarket user.
- The payer/relayer when the backend maintains the user's custodial balance and will credit the refund
  offchain.

The contract never guesses between those models.

### Immutable recipient liveness

The beneficiary and refund recipient are immutable after funding. The hook rejects the zero address and its
own address, but it has no recipient-rotation or emergency-withdrawal path. A typo, lost wallet, incompatible
contract recipient, or an address later blocked by the payment token can make `Y` permanently unclaimable.
Validate both recipients before signing and treat wallet availability and token blacklist/freeze behavior as
ongoing liveness dependencies.

### Hook gas budget

Taskmarket V20 forwards a fixed 1,000,000 gas stipend to each hook call. `checkFund` reconstructs terms from
several Diamond getters, hashes dynamic task metadata, validates the payer signature, and transfers `Y`.
Very large `contentURI`, tags, hook data/signatures, or an expensive ERC-1271 wallet validation can exhaust
that stipend. Task creation then reverts atomically as a rejected funding hook. Bound production metadata and
payload sizes and test representative smart-wallet payers against the target deployment; ordinary transaction
gas limits cannot raise the per-hook stipend.

### Shared hook data compatibility

Taskmarket forwards one shared `hookData` byte string to every V1 hook on the task. This payload works with
hooks that ignore `hookData`. Coexistence with another configuration-consuming hook requires a common outer
envelope agreed by every consumer. This contract currently decodes its V1 tuple directly and does not provide
such an envelope, so an incompatible second consumer will make task creation revert.

## Deliberate V1 behavior

- The affiliate receives fixed `Y`, including when an auction settles below its maximum task reward.
- Split acceptance and multiwinner tasks still create one affiliate allocation and pay `Y` once per task.
- Updating Taskmarket's reward `X` does not change the creation-time `Y`. Hook V1 has no update callback.
- If the application wants a percentage, it calculates and displays `Y` before signing; the contract
  always stores the final explicit amount.
- Sidecar expiry never runs independently of Taskmarket. If the core task stays nonterminal, `Y` stays
  escrowed too. For example, an active Bounty/Benchmark submission may require requester action before the
  core can reach `Expired`; neither the payer nor refund recipient can bypass that state machine here.
- There is no owner withdrawal path. Escrow liabilities can leave only through predetermined affiliate
  payment or refund claims.
- The hook supports EOA signatures and ERC-1271 smart-wallet signatures through OpenZeppelin's
  `SignatureChecker`.

## Install

Prerequisites: Node.js 18+, [Foundry](https://book.getfoundry.sh/getting-started/installation), and Git.

```sh
forge install --no-git daydreamsai/taskmarket-contracts@a85cc8dae76e0fc6da9e463375fd2e385710d442
forge install --no-git OpenZeppelin/openzeppelin-contracts@fcbae5394ae8ad52d8e580a3477db99814b9d565
forge install --no-git OpenZeppelin/openzeppelin-contracts-upgradeable@7bf4727aacdbfaa0f36cbd664654d0c9e1dc52bf
forge install --no-git foundry-rs/forge-std@1801b0541f4fda118a10798fd3486bb7051c5dd6
cp .env.example .env
```

## Build and test

```sh
forge fmt --check
forge build
forge test -j 1
```

The suite includes unit, fuzz, and local Taskmarket Diamond integration coverage for:

- Independent arbitrary `X` and `Y`
- Independent EIP-712/type-hash construction, task-terms binding, expiry, nonce invalidation, and allowance
  failure
- EOA and ERC-1271 contract payers
- Production-forwarder dual funding and atomic rollback of `X` when `Y` cannot be funded
- Completion payment and cancellation/expiry refund
- Forfeit/reopen reserve retention
- Auction expiry auto-completion
- Missed-callback reconciliation
- Task reward updates leaving `Y` unchanged

## Deploy on Base Sepolia

The deployment script is bound to the Base Sepolia Taskmarket Diamond shown in the official scaffolder
documentation: `0x0A24E9c3b9E31B8258329e187470ACc16497Cec7`. Before starting a broadcast it requires:

- Base Sepolia chain ID `84532`
- Contract code at the configured Diamond address
- `diamondVersion() == 20`
- The Diamond's `usdcToken()` to equal
  [Circle's canonical Base Sepolia USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses)
  at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, with contract code present
- Code-backed Diamond loupe routes for `diamondVersion()`, `usdcToken()`, and every task getter this hook
  directly calls

The guard deliberately rejects other chains, missing/wrong contracts, older revisions, and unreviewed newer
revisions. It does not pin mutable fee/default-hook state or facet bytecode, and it cannot prevent a later
Diamond upgrade. Verify the address, revision, payment token, and current upgrade state independently before
broadcasting; changing the constants is a new deployment decision, not a routine workaround for the guard.

Set `PRIVATE_KEY`, `FORGE_BASE_SEPOLIA_RPC_URL`, and `FORGE_ETHERSCAN_API_KEY` in `.env`, then run:

```sh
set -a
. ./.env
set +a
forge script script/Deploy.s.sol:Deploy --rpc-url base_sepolia --broadcast --verify
```

The contract is ownerless and each deployment is permanently bound to the constructor-supplied Taskmarket
Diamond. Deploy a separately reviewed instance and deployment script for every Diamond/network.

## Security status

This implementation has automated tests but has not been independently audited. Hooks are immutable per
task, and a `checkFund` revert rejects creation, so verify bytecode, deployment parameters, both production
allowances, the signed task-terms calculation, recipient recoverability, and the complete x402/PGTR funding
integration before using real funds.

For registry disclosure, its current security status is **unaudited** and its conformance status is **tested**
by the unit, fuzz, and local Diamond integration suite. A registry listing is discovery metadata, not an audit,
endorsement, or protocol-default designation.

## License

[MIT](LICENSE)
