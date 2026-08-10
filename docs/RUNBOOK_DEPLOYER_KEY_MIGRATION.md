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

1. **The backend must be stopped for the whole window.** Every transfer below is signed by the
   relayer key, and a running backend is a second, uncoordinated source of nonces for that same
   wallet. Stopping it makes a collision impossible instead of merely recoverable. It stays down
   from step 2 until step 9 — not paused, stopped.
2. **The new EOA needs ETH before anything else.** It has to send `acceptOwnership` itself. An
   unfunded new key turns the Diamond transfer into a stall at the worst possible moment.
3. **The Diamond's 2-step transfer is the proof-of-control test.** It is the only step that is
   reversible (an unaccepted `pendingOwner` can be overwritten), and completing it proves the new
   key exists, is funded, and can sign. It must land before anything irreversible.
4. **The point of no return is the first hook `transferOwnership`.** The three hook-side
   contracts are plain OpenZeppelin `Ownable`: 1-step, instant, no pending state, no undo. Once
   the first one fires, the migration must be carried to completion.
5. **RewardVault goes last.** Hook and EpochBudget are replaceable by redeploy-and-rewire
   (`swap-reward-hook`); RewardVault is not. Losing its ownership loses the ~991,835 DREAMS it
   holds. It is transferred only after the new key has successfully taken two cheaper contracts.
6. **`hook.backend()` must still be the relayer afterwards.** Verify it explicitly. If
   `backend()` is ever moved to the deployer key, DREAMS withdrawals break for every user.
7. **Never call `renounceOwnership()` on anything.** These contracts inherit it. It permanently
   destroys ownership with no recovery path. It is not part of this procedure at any step.
8. **Do not stop midway.** `SwapRewardHook.s.sol` uses one owner key for the vault, the budget
   and `setDefaultHooks`. Ownership split across two addresses breaks it, so a half-done
   migration is worse than either end state.
9. **Rehearse the whole thing on testnet first**, end to end, including the verification
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

## Step 2 — Stop the backend relayer, and confirm it has drained

Every ownership transfer below is signed by the **relayer key**, which is also the key the backend
uses to relay live user transactions. While the backend is running there are two independent
sources issuing nonces for one wallet: the backend's database allocator, and `cast`/`forge` here.
They do not coordinate, and neither can see the other's reservations.

If they collide, the loser's transaction is dropped. If the loser is the backend's, that is a real
user's relayed write that silently does not happen. If the loser is one of the transfers below, the
migration halts partway — and past step 5 that is the state this runbook exists to avoid.

Stopping the backend removes the second nonce source entirely, so the collision is **impossible**
rather than merely survivable. This is the single measure that makes the migration safe; the
reconciler fix in ADR-0063 is the safety net for unplanned collisions outside a window like this
one, not a substitute for taking the window.

1. Announce a maintenance window. All relayed writes will fail for its duration.
2. Stop the backend process (however it is deployed — scale to zero, stop the service, whatever
   applies). Do not merely pause the contract: `pause()` stops the market but the backend
   process keeps its allocator and can still broadcast.
3. Confirm nothing is still in flight before signing anything. Against the backend's database:

   ```sql
   select id, nonce, status, tx_hash, broadcast_at
   from server_wallet_transactions
   where status in ('reserved', 'broadcast')
   order by nonce;
   ```

   This must return **zero rows**. A `reserved` row is a nonce handed out but not yet broadcast —
   invisible to the chain, and precisely what `cast` cannot see. A `broadcast` row is still
   racing for a slot. Wait for them to clear (or resolve them) before continuing.

4. Confirm the chain agrees the wallet is idle — pending and latest counts must be equal:

   ```bash
   cast rpc eth_getTransactionCount "$RELAYER" pending --rpc-url "$NETWORK"
   cast rpc eth_getTransactionCount "$RELAYER" latest  --rpc-url "$NETWORK"
   ```

   Equal counts mean nothing of the relayer's is unmined. Record the value: every transaction
   below should consume exactly one nonce from it, in order.

**Do not start the backend again until step 9.** Restarting mid-migration reintroduces the
collision at the worst point.

## Step 3 — Diamond `transferOwnership` (reversible)

Signed by the **current owner** (the relayer key):

```bash
cast send "$DIAMOND" "transferOwnership(address)" "$NEW_OWNER" \
  --private-key "$RELAYER_PRIVATE_KEY" --rpc-url "$NETWORK"

cast call "$DIAMOND" "pendingOwner()(address)" --rpc-url "$NETWORK"   # -> $NEW_OWNER
cast call "$DIAMOND" "owner()(address)"        --rpc-url "$NETWORK"   # -> $RELAYER (unchanged)
```

Still fully reversible here: re-run `transferOwnership` with any other address, or simply never
accept.

## Step 4 — Diamond `acceptOwnership` — the proof-of-control gate

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
situation is fully recoverable. Do not proceed to step 5 on anything other than a clean pass.

---

> ## POINT OF NO RETURN
>
> Everything below is a 1-step OpenZeppelin `transferOwnership`: instant, no pending state, no
> undo. From step 5 onward the migration must be carried through to step 7. Confirm step 4 passed
> and that you hold the new key before continuing.

---

## Step 5 — TaskTokenRewardHook `transferOwnership` (irreversible)

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

## Step 6 — EpochBudget `transferOwnership` (irreversible)

```bash
cast send "$BUDGET" "transferOwnership(address)" "$NEW_OWNER" \
  --private-key "$RELAYER_PRIVATE_KEY" --rpc-url "$NETWORK"

cast call "$BUDGET" "owner()(address)" --rpc-url "$NETWORK"   # -> $NEW_OWNER
```

## Step 7 — RewardVault `transferOwnership` (irreversible, unrecoverable)

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

## Step 8 — After state (full verification)

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

## Step 9 — Restart the backend relayer

Only once step 8 has fully passed. Restarting earlier reintroduces the second nonce source while
transfers are still outstanding.

Nothing about the backend's own configuration changed in this migration — it keeps the same
`SERVER_PRIVATE_KEY`, the forwarder's `authorizedRelayer` is `immutable`, and `hook.backend()` was
verified unchanged in step 8. So this is a plain restart, not a reconfiguration.

1. Start the backend.
2. Confirm the allocator picks up cleanly from the chain rather than from a stale cached value —
   its next nonce must be at or ahead of the chain's `latest` count:

   ```bash
   cast rpc eth_getTransactionCount "$RELAYER" latest --rpc-url "$NETWORK"
   ```

   ```sql
   select wallet_address, next_nonce from server_wallet_nonces;
   ```

   `next_nonce` behind the chain would reissue a spent nonce. The transfers above consumed
   nonces the allocator never handed out, so this is the check that matters most on restart.

3. Watch the first minutes of logs for `nonce too low` or reconciler replacement failures. With
   the ADR-0063 fix in place a genuinely orphaned row settles terminally rather than retrying
   forever, so a repeating replacement failure means something else is wrong.

## Step 10 — Update configuration

Set `FORGE_DEV_PRIVATE_KEY_TESTNET` / `FORGE_DEV_PRIVATE_KEY_MAINNET` to the new deployer key
wherever deploys run (local `.env`, CI secrets, deploy runner). The relayer key stays exactly as
it is for `SERVER_PRIVATE_KEY`.

Then confirm owner-gated tooling still works end to end on **testnet** with the new key — a
`make upgrade testnet` or a `swap-reward-hook testnet` — before relying on it for mainnet. This
also re-checks the `SwapRewardHook.s.sol` single-owner-key assumption against the new end state.

## Step 11 — Post-migration checks

**Do not run smoke tests against mainnet or testnet as part of this procedure.** They create real
tasks and move real funds, and they are not what validates this migration. The relay-path smoke
(`make smoke nonce`) belongs to the agent sandbox as a pre-merge gate on the backend build — it
runs against a disposable stack before that build is deployed, not against a live deployment
afterwards.

What confirms this migration on a live network is observed behaviour:

- Backend logs: no `nonce too low` or replacement failures from the reconciler.
- A DREAMS withdrawal succeeds for a real user (exercises `hook.backend()`).
- A relayed task write succeeds (exercises the forwarder's `authorizedRelayer`).
- The allocator stays level with or ahead of the chain (the step 9 check, re-run once some real
  traffic has flowed).

## If something goes wrong

| Failure point                          | Recovery                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Before step 4 completes                 | Fully recoverable. Overwrite `pendingOwner` or never accept; no ownership has changed                  |
| New key wrong, caught after step 5      | Hook is replaceable: redeploy and rewire via `swap-reward-hook`, gated on the Diamond owner            |
| New key wrong, caught after step 6      | EpochBudget is replaceable the same way, together with the hook                                        |
| New key wrong, caught after step 7      | **No recovery.** The DREAMS in RewardVault are lost. This is why step 7 is last and step 4 is a gate   |
| `hook.backend()` changed by mistake     | The current hook owner can set it back. Withdrawals are broken until it is restored                    |
| `renounceOwnership()` called            | **No recovery** on that contract, ever. Do not call it                                                 |
| Backend restarted mid-migration         | Stop it again before signing anything further, then re-run the step 2 drain checks. Any relayed write it made in the meantime consumed a nonce, so re-read both transaction counts before continuing |
| Migration abandoned after step 2        | Restart the backend (step 9) and re-run its checks. Stopping before step 5 leaves ownership untouched, so an abandoned run costs only the maintenance window |

## References

- [ADR-0064](adr/0064-deploy-and-owner-operations-use-a-separate-eoa-from-the-relayer.md) — the decision.
- [ADR-0063](adr/0063-the-reconciler-settles-a-nonce-spent-by-a-foreign-transaction.md) — the reconciler fix for the nonce collision this removes the cause of.
- `packages/contracts/src/libraries/LibDiamond.sol` — the Diamond's 2-step transfer.
- `packages/contracts/script/SwapRewardHook.s.sol` — assumes a single owner key.
