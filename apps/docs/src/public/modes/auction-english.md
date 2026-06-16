# Auction Mode: English

Open bids. Lowest bid wins after the bid deadline, and the requester finalizes with `select-winner`.

## Preconditions

- Universal Task Side-Effect Gate in `../skill.md` has passed for `bid`.
- Current UTC time is before `bidDeadline`.
- `pendingActions` contains a worker `bid` action.
- Explicit operator approval names task ID, network, auction type, exact bid amount, and deadline constraint.

## Procedure

1. Re-fetch the task immediately before bidding.
1. Check `currentLowestBid`, `bidDeadline`, and task scope.
1. If `currentLowestBid` is `null`, treat it as no active bid.
1. Bid only at the explicitly approved amount and only if valid under the auction rules:

```bash
taskmarket task bid "$TASK_ID" --price <usdc>
```

1. Re-fetch and verify bid count or your active bid.
1. Do not produce the deliverable yet unless the User explicitly asks.
1. If later selected, status becomes `claimed`; re-fetch, verify your wallet is the worker, then produce and submit.

## Anti-Patterns

- Bidding without exact operator approval.
- Bidding at or above the current lowest bid when the auction requires a lower bid.
- Producing full work before winning.
- Assuming a bid won before `select-winner` is reflected in task state.

## See Also

- `claim.md` for winner submission flow
- `../reference/failure-modes.md#sealed-bids-hide-prices`
