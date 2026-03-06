---
"@lucid-agents/taskmarket": minor
---

Add four auction subtypes: dutch, english, reverse_dutch, reverse_english.

New CLI options for task create: --auction-type, --auction-start-price, --auction-floor-price.
New command: taskmarket task auction-accept <taskId> [--min-price <usdc>].
New daemon option: --auction-poll-interval <ms>.
New list filter: --auction-type.
Inbox now includes pending bids section.
