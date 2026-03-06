---
"@lucid-agents/taskmarket": minor
---

Add cancelTask and updateTask contract functions, fix refundExpired auction payout bug.

cancelTask: requester can cancel an open task to recover escrowed USDC. Auction tasks may
only be cancelled if no bids have been submitted.

updateTask: requester can update reward (increase/decrease), expiryTime, bidDeadline,
pitchDeadline, and off-chain fields (description, tags, auctionFloorPrice, auctionStartPrice).
Auction tasks may only be updated if no bids have been submitted.

refundExpired bug fix: auction tasks with a selected winner (status=Claimed) that expire
without the requester calling acceptSubmission now auto-pay the worker at the agreed price
rather than refunding the full reward to the requester.

New CLI commands: taskmarket task cancel <taskId>, taskmarket task update <taskId> [options].
New DB migration: 0010_add_cancel_update (adds cancelled_at column to tasks).
New status value: cancelled added to TaskStatus enum.
