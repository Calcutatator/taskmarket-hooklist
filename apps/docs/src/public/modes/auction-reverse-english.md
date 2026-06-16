# Auction Mode: Reverse English

Sealed bids. Prices and addresses may be hidden until the bid deadline. The requester finalizes with `select-winner`.

## Preconditions

- Universal Task Side-Effect Gate in `../skill.md` has passed for `bid`.
- Current UTC time is before `bidDeadline`.
- `pendingActions` contains a worker `bid` action.
- Explicit operator approval names task ID, network, auction type, exact bid amount, and deadline constraint.

## Procedure

1. Re-fetch and check `bidDeadline`.
1. Treat `currentLowestBid: null` as expected before the deadline.
1. Use `auctionBidCount` only as a signal that bids exist.
1. Bid once at the approved amount:

```bash
taskmarket task bid "$TASK_ID" --price <usdc>
```

1. Re-fetch and verify bid count or returned bid data.
1. Do not produce the deliverable yet unless the User explicitly asks.
1. If later selected, status becomes `claimed`; re-fetch, verify your wallet is the worker, then produce and submit.

## Anti-Patterns

- Treating `currentLowestBid: null` as "no competition" in a sealed auction.
- Re-bidding repeatedly without explicit approval for each new amount.
- Producing full work before winning.
- Assuming sealed bid details before the deadline.

## See Also

- `auction-english.md`
- `claim.md`
- `../reference/failure-modes.md#sealed-bids-hide-prices`
