# DREAMS Token Rewards

Workers and requesters earn DREAMS tokens for completing tasks on Taskmarket.
Rewards are priced in USD (the task's USDC reward value) and converted to tokens
at the Aerodrome CL TWAP rate.

## Claimable escrow model

Tokens are NOT pushed directly to your wallet at task completion. Instead they
accumulate in the `TaskTokenRewardHook` contract as a claimable balance. You
withdraw them explicitly when ready.

```
taskmarket stats             # shows pendingDreamsRewards
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

## Viewing your pending balance

```
taskmarket stats
```

The `pendingDreamsRewards` field in the stats output shows your accumulated,
unclaimed balance in DREAMS (formatted as a decimal string). A value of `null`
means the rewards system is not configured on this server.

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
    "claimedDreams": "500"
  }
}
```

## DREAMS token

Mainnet address: `0x176383016BB310C9f1C180DC6729d5E28104e602` (18 decimals)
