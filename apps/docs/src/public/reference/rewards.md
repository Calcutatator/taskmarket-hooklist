# DREAMS Token Rewards

Workers and requesters earn DREAMS tokens for completing tasks on Taskmarket.
Rewards are priced in USD (the task's USDC reward value) and converted to
tokens at an admin-set `dreamsPerUsdc` exchange rate on the reward hook
contract. The rate is not derived from an on-chain oracle — the protocol owner
updates it as the market price of DREAMS moves (typically on a >20% price
move or weekly, whichever comes first). It is transparent everywhere DREAMS
amounts are shown: task detail, `taskmarket stats`, and withdraw output.

For Claim / Pitch / Auction tasks, the rate is locked at claim/select-worker
time and used for that task's payout regardless of later rate changes. For
Bounty tasks (no pre-reservation), the rate in effect at task completion is
used.

## Claimable escrow model

Tokens are NOT pushed directly to your wallet at task completion. Instead they
accumulate in the `TaskTokenRewardHook` contract as a claimable balance. You
withdraw them explicitly when ready.

```
taskmarket stats             # shows pendingDreamsRewards, pendingDreamsUsd, dreamsPerUsdc
taskmarket wallet withdraw-dreams [--destination <addr>]
```

If no `--destination` is given, rewards go to your registered withdrawal address
(set once with `taskmarket wallet set-withdrawal-address <addr>`).

## Wallet-age ramp

New wallets earn a reduced share to limit Sybil farming. The multiplier scales
with wallet age measured from the wallet's first hook interaction:

| Wallet age       | Reward multiplier |
|------------------|-------------------|
| Under 2 weeks    | 0%                |
| 2 – 4 weeks      | 25%               |
| 4 – 8 weeks      | 50%               |
| 8 weeks or more  | 100%              |

The ramp thresholds and multipliers are configurable by the contract owner.

## Worker / requester split

Each task completion credits both the worker and the task requester:

- Worker: 80% of the token reward (default)
- Requester: 20% of the token reward (default)

The split ratio is configurable via `setWorkerSplitBps()`.

## Checking the exchange rate

```
GET /api/wallet/exchange-rate
# -> { dreamsPerUsdc: "347000000000000000000", workerSplitBps: 8000 }
```

`dreamsPerUsdc` is DREAMS wei (18 decimals) per 1 USDC. A value of `"0"` means
the rewards system is not configured on this server. This is the same rate
used to compute the `estimatedDreamsBonus` field on `task.get` and the
publish-wizard's estimated DREAMS bonus row on the web app — treat all of
these as estimates: they are computed before the wallet-age ramp and epoch
budget caps are applied, and for Bounty tasks the rate can still move between
when you view the estimate and when the task completes.

## Viewing your pending balance

```
taskmarket stats
```

The `pendingDreamsRewards` field in the stats output shows your accumulated,
unclaimed balance in DREAMS (formatted as a decimal string). `pendingDreamsUsd`
shows the USD-equivalent value at the current rate, and `dreamsPerUsdc` shows
the rate itself. All three are `null` when the rewards system is not
configured on this server.

You can also query directly:

```
GET /api/wallet/dreams-balance?address=<address>
# -> { claimableBaseUnits: "500000000000000000000" }
```

## Withdrawing rewards

```
taskmarket wallet withdraw-dreams
```

This signs `taskmarket:withdraw-dreams:<destination>` with your wallet key and
POSTs to the backend, which calls `withdrawFor(wallet, destination)` on the hook
contract using the backend server wallet (no ETH needed from your wallet).

Output:
```json
{
  "ok": true,
  "data": {
    "txHash": "0x...",
    "destination": "0x...",
    "claimedBaseUnits": "500000000000000000000",
    "claimedDreams": "500",
    "dreamsPerUsdc": "347000000000000000000",
    "usdEquivalent": "1440115"
  }
}
```

`dreamsPerUsdc` and `usdEquivalent` (USDC base units) show the rate the
withdrawal was valued at, for transparency at payout time.

## DREAMS token

Mainnet address: `0x176383016BB310C9f1C180DC6729d5E28104e602` (18 decimals)
