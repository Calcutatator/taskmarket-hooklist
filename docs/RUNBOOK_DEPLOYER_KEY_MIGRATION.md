# Runbook: migrating contract ownership to a dedicated deployer EOA

Operational procedure for the decision recorded in
[ADR-0064](adr/0064-deploy-and-owner-operations-use-a-separate-eoa-from-the-relayer.md).

**Nothing in this runbook has been executed.** It is written to be followed by a human operator
with the deployer key in hand, and it is not safe to automate.

> **Placement note:** `docs/` has no existing runbooks convention — it is a flat directory of
> uppercase guide documents, with `adr/`, `rfc/` and `specs/` as the only subdirectories, each
> governed by its own README and tooling. A new `docs/runbooks/` directory would imply a
> convention that does not exist and that no tooling reads, so this sits alongside the other
> flat guides as `RUNBOOK_*`, which leaves room for later runbooks to follow the same prefix.

---

## What is moving and what is not

| Role                            | Contract            | Moves?   | Mechanism                                       |
| ------------------------------- | ------------------- | -------- | ----------------------------------------------- |
| `owner()`                       | Diamond             | Yes      | 2-step `transferOwnership` + `acceptOwnership`  |
| `owner()`                       | TaskTokenRewardHook | Yes      | 1-step OpenZeppelin `transferOwnership`         |
| `owner()`                       | EpochBudget         | Yes      | 1-step OpenZeppelin `transferOwnership`         |
| `owner()`                       | RewardVault         | Yes      | 1-step OpenZeppelin `transferOwnership`         |
| `backend()`                     | TaskTokenRewardHook | **No**   | Must stay on the relayer wallet                 |
| `authorizedRelayer()`           | Forwarder           | **No**   | `immutable`; cannot change without a redeploy   |

All five owner-side roles currently sit on the relayer address
`0x3C0820e2dabD5FEAe1fd03B78079DEe15c7F83D8`.

## Non-negotiable rules

1. **The new EOA needs ETH before anything else.** It has to send `acceptOwnership` itself. An
   unfunded new key turns the Diamond transfer into a stall at the worst possible moment.
2. **The Diamond's 2-step transfer is the proof-of-control test.** It is the only step that is
   reversible (an unaccepted `pendingOwner` can be overwritten), and completing it proves the new
   key exists, is funded, and can sign. It must land before anything irreversible.
3. **The point of no return is the first hook `transferOwnership`.** The three hook-side
   contracts are plain OpenZeppelin `Ownable`: 1-step, instant, no pending state, no undo. Once
   the first one fires, the migration must be carried to completion.
4. **RewardVault goes last.** Hook and EpochBudget are replaceable by redeploy-and-rewire
   (`swap-reward-hook`); RewardVault is not. Losing its ownership loses the ~991,835 DREAMS it
   holds. It is transferred only after the new key has successfully taken two cheaper contracts.
5. **`hook.backend()` must still be the relayer afterwards.** Verify it explicitly. If
   `backend()` is ever moved to the deployer key, DREAMS withdrawals break for every user.
6. **Never call `renounceOwnership()` on anything.** These contracts inherit it. It permanently
   destroys ownership with no recovery path. It is not part of this procedure at any step.
7. **Do not stop midway.** `SwapRewardHook.s.sol` uses one owner key for the vault, the budget
   and `setDefaultHooks`. Ownership split across two addresses breaks it, so a half-done
   migration is worse than either end state.
8. **Rehearse the whole thing on testnet first**, end to end, including the verification
   commands — not a subset.

---

## Environment

```bash
# Run every command below from packages/contracts, so foundry.toml resolves the RPC aliases.
cd packages/contracts

# --- pick ONE network per session -------------------------------------------
NETWORK=base_sepolia                          # testnet rehearsal
DIAMOND="$FORGE_DIAMOND_ADDRESS_TESTNET"

# NETWORK=base                                # mainnet
# DIAMOND="$FORGE_DIAMOND_ADDRESS_MAINNET"
# ----------------------------------------------------------------------------

RELAYER=0x3C0820e2dabD5FEAe1fd03B78079DEe15c7F83D8   # current owner AND relayer
NEW_OWNER=0x<the new deployer EOA>
```

Discover the hook-side addresses rather than trusting a stale note. The hook address is the
protocol's configured default reward hook; from it, the vault and budget are on-chain getters:

```bash
HOOK=0x<TaskTokenRewardHook address>
FORWARDER=0x<TaskMarketForwarder address>
VAULT=$(cast call "$HOOK" "vault()(address)" --rpc-url "$NETWORK")
BUDGET=$(cast call "$HOOK" "epochBudget()(address)" --rpc-url "$NETWORK")
echo "hook=$HOOK vault=$VAULT budget=$BUDGET"
```

---

## Step 0 — Before state (record the output)

```bash
cast call "$DIAMOND" "owner()(address)"          --rpc-url "$NETWORK"
cast call "$DIAMOND" "pendingOwner()(address)"   --rpc-url "$NETWORK"
cast call "$HOOK"    "owner()(address)"          --rpc-url "$NETWORK"
cast call "$HOOK"    "backend()(address)"        --rpc-url "$NETWORK"
cast call "$VAULT"   "owner()(address)"          --rpc-url "$NETWORK"
cast call "$VAULT"   "totalReserved()(uint256)"  --rpc-url "$NETWORK"
cast call "$BUDGET"  "owner()(address)"          --rpc-url "$NETWORK"
```

Expected on mainnet today: all five `owner()`/`backend()` reads return `$RELAYER`,
`pendingOwner()` returns the zero address, and `totalReserved()` returns `0`.

**Stop if `pendingOwner()` is not zero** — an unfinished transfer is already in progress and this
runbook's first step would overwrite it.

Also record the vault's DREAMS balance, to compare afterwards:

```bash
TOKEN=$(cast call "$HOOK" "token()(address)" --rpc-url "$NETWORK")
cast call "$TOKEN" "balanceOf(address)(uint256)" "$VAULT" --rpc-url "$NETWORK"
```

## Step 1 — Fund the new EOA

Send enough ETH for at least four transactions plus headroom. Confirm it landed:

```bash
cast balance "$NEW_OWNER" --rpc-url "$NETWORK"
```

**Do not continue on a zero balance.**

## Step 2 — Diamond `transferOwnership` (reversible)

Signed by the **current owner** (the relayer key):

```bash
cast send "$DIAMOND" "transferOwnership(address)" "$NEW_OWNER" \
  --private-key "$RELAYER_PRIVATE_KEY" --rpc-url "$NETWORK"

cast call "$DIAMOND" "pendingOwner()(address)" --rpc-url "$NETWORK"   # -> $NEW_OWNER
cast call "$DIAMOND" "owner()(address)"        --rpc-url "$NETWORK"   # -> $RELAYER (unchanged)
```

Still fully reversible here: re-run `transferOwnership` with any other address, or simply never
accept.

## Step 3 — Diamond `acceptOwnership` — the proof-of-control gate

Signed by the **new deployer key**. This is the step that proves the new key works.

```bash
FORGE_DEV_PRIVATE_KEY_MAINNET="$NEW_OWNER_PRIVATE_KEY" \
  make contract accept-ownership mainnet
# testnet rehearsal:
# FORGE_DEV_PRIVATE_KEY_TESTNET="$NEW_OWNER_PRIVATE_KEY" make contract accept-ownership testnet
```

Verify:

```bash
cast call "$DIAMOND" "owner()(address)"        --rpc-url "$NETWORK"   # -> $NEW_OWNER
cast call "$DIAMOND" "pendingOwner()(address)" --rpc-url "$NETWORK"   # -> 0x0
```

**Gate.** If `owner()` is not `$NEW_OWNER`, stop. Nothing irreversible has happened yet and the
situation is fully recoverable. Do not proceed to step 4 on anything other than a clean pass.

---

> ## POINT OF NO RETURN
>
> Everything below is a 1-step OpenZeppelin `transferOwnership`: instant, no pending state, no
> undo. From step 4 onward the migration must be carried through to step 6. Confirm step 3 passed
> and that you hold the new key before continuing.

---

## Step 4 — TaskTokenRewardHook `transferOwnership` (irreversible)

Cheapest to recover from if the new key turns out to be wrong (the hook is replaceable via
`swap-reward-hook`), so it goes first among the irreversible ones. Signed by the relayer key:

```bash
cast send "$HOOK" "transferOwnership(address)" "$NEW_OWNER" \
  --private-key "$RELAYER_PRIVATE_KEY" --rpc-url "$NETWORK"

cast call "$HOOK" "owner()(address)"   --rpc-url "$NETWORK"   # -> $NEW_OWNER
cast call "$HOOK" "backend()(address)" --rpc-url "$NETWORK"   # -> $RELAYER, MUST NOT change
```

If `backend()` is anything other than `$RELAYER`, stop and restore it before continuing —
withdrawals are broken until it is right.

## Step 5 — EpochBudget `transferOwnership` (irreversible)

```bash
cast send "$BUDGET" "transferOwnership(address)" "$NEW_OWNER" \
  --private-key "$RELAYER_PRIVATE_KEY" --rpc-url "$NETWORK"

cast call "$BUDGET" "owner()(address)" --rpc-url "$NETWORK"   # -> $NEW_OWNER
```

## Step 6 — RewardVault `transferOwnership` (irreversible, unrecoverable)

**Last, deliberately.** By this point the new key has successfully accepted the Diamond and taken
two replaceable contracts, so it is as well proven as it can be before the one transfer that
cannot be undone or worked around.

Re-check the vault state immediately before signing:

```bash
cast call "$VAULT" "totalReserved()(uint256)" --rpc-url "$NETWORK"
cast call "$TOKEN" "balanceOf(address)(uint256)" "$VAULT" --rpc-url "$NETWORK"
```

Then:

```bash
cast send "$VAULT" "transferOwnership(address)" "$NEW_OWNER" \
  --private-key "$RELAYER_PRIVATE_KEY" --rpc-url "$NETWORK"

cast call "$VAULT" "owner()(address)" --rpc-url "$NETWORK"   # -> $NEW_OWNER
```

## Step 7 — After state (full verification)

```bash
cast call "$DIAMOND" "owner()(address)"          --rpc-url "$NETWORK"   # $NEW_OWNER
cast call "$DIAMOND" "pendingOwner()(address)"   --rpc-url "$NETWORK"   # 0x0
cast call "$HOOK"    "owner()(address)"          --rpc-url "$NETWORK"   # $NEW_OWNER
cast call "$VAULT"   "owner()(address)"          --rpc-url "$NETWORK"   # $NEW_OWNER
cast call "$BUDGET"  "owner()(address)"          --rpc-url "$NETWORK"   # $NEW_OWNER

# Unchanged operational roles -- these are the ones a mistake here would have broken:
cast call "$HOOK" "backend()(address)"           --rpc-url "$NETWORK"   # $RELAYER
cast call "$FORWARDER" "authorizedRelayer()(address)" --rpc-url "$NETWORK"  # $RELAYER

# Value unchanged:
cast call "$TOKEN" "balanceOf(address)(uint256)" "$VAULT" --rpc-url "$NETWORK"
cast call "$VAULT" "totalReserved()(uint256)"    --rpc-url "$NETWORK"
```

Four owner reads must be `$NEW_OWNER`; both operational reads must still be `$RELAYER`; the vault
balance must match step 0.

## Step 8 — Update configuration

Set `FORGE_DEV_PRIVATE_KEY_TESTNET` / `FORGE_DEV_PRIVATE_KEY_MAINNET` to the new deployer key
wherever deploys run (local `.env`, CI secrets, deploy runner). The relayer key stays exactly as
it is for `SERVER_PRIVATE_KEY`.

Then confirm owner-gated tooling still works end to end on **testnet** with the new key — a
`make upgrade testnet` or a `swap-reward-hook testnet` — before relying on it for mainnet. This
also re-checks the `SwapRewardHook.s.sol` single-owner-key assumption against the new end state.

## Step 9 — Post-migration checks

- Backend logs: no `nonce too low` or replacement failures from the reconciler.
- A DREAMS withdrawal succeeds for a real user (exercises `hook.backend()`).
- A relayed task write succeeds (exercises the forwarder's `authorizedRelayer`).

## If something goes wrong

| Failure point                          | Recovery                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Before step 3 completes                | Fully recoverable. Overwrite `pendingOwner` or never accept; no ownership has changed                  |
| New key wrong, caught after step 4      | Hook is replaceable: redeploy and rewire via `swap-reward-hook`, gated on the Diamond owner            |
| New key wrong, caught after step 5      | EpochBudget is replaceable the same way, together with the hook                                        |
| New key wrong, caught after step 6      | **No recovery.** The DREAMS in RewardVault are lost. This is why step 6 is last and step 3 is a gate   |
| `hook.backend()` changed by mistake     | The current hook owner can set it back. Withdrawals are broken until it is restored                    |
| `renounceOwnership()` called            | **No recovery** on that contract, ever. Do not call it                                                 |

## References

- [ADR-0064](adr/0064-deploy-and-owner-operations-use-a-separate-eoa-from-the-relayer.md) — the decision.
- [ADR-0063](adr/0063-the-reconciler-settles-a-nonce-spent-by-a-foreign-transaction.md) — the reconciler fix for the nonce collision this removes the cause of.
- `packages/contracts/src/libraries/LibDiamond.sol` — the Diamond's 2-step transfer.
- `packages/contracts/script/SwapRewardHook.s.sol` — assumes a single owner key.
