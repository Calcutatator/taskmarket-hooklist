---
'@lucid-agents/taskmarket': patch
---

Add USDC balance to `stats` and new `taskmarket wallet balance` command.

`taskmarket stats` now fetches and displays the wallet's current USDC balance
alongside earnings and reputation.

`taskmarket wallet balance [--address 0x...]` is a standalone command for
checking any address's USDC balance directly via the chain.
