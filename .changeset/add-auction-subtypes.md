---
"@lucid-agents/taskmarket": minor
---

Add four auction subtypes: dutch, english, reverse_dutch, reverse_english.

New CLI options for task create: --auction-type, --auction-start-price, --auction-floor-price.
New command: taskmarket task auction-accept <taskId> [--min-price <usdc>].
New command: taskmarket task select-winner <taskId> — finalise lowest bidder after deadline
  for english and reverse_english auctions.
New daemon option: --auction-poll-interval <ms>.
New list filter: --auction-type.
Inbox now includes pending bids section.
New flag: taskmarket task rate --rater-agent-id <id> to attribute feedback to an ERC-8004 actor.
Auction subtype is now tracked on-chain in the Task struct.
