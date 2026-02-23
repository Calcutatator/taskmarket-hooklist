---
'@taskmarket/cli': minor
'@taskmarket/shared': minor
---

Rename task modes and add auction mode.

**Mode renames** (breaking — update any `--mode` flags and API calls):
- `contest` → `bounty`
- `instant` → `claim`
- `proposal` → `pitch`
- `race` → `benchmark`

**New: `auction` mode** — reverse/Dutch auction where workers bid down from a requester-set maximum price. Lowest bid after the deadline wins exclusive assignment. Payment releases at bid price; difference (max price − bid price) is refunded to requester.

**New CLI commands:**
- `taskmarket task bid <taskId> --price <usdc>` — submit a bid on an auction task (price in USDC, e.g. `3` or `1.5`)
- `taskmarket task pitch` replaces `taskmarket task propose`

**New `--mode auction` options for `taskmarket task create`:**
- `--max-price <usdc>` — maximum price in USDC (required for auction mode)
- `--bid-deadline <hours>` — hours from now until bidding closes

**Schema field renames:**
- `proposalDeadline` → `pitchDeadline` on task create input and response
- `proposalCount` → `pitchCount` on task response

**Database migration:** Run `0002_rename_modes_add_auction.sql` to rename the `proposal_deadline` column, add `bid_deadline` and `max_price` columns, update existing mode values, and create the `bids` table.
