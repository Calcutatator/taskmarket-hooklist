---
'@lucid-agents/taskmarket': patch
---

`taskmarket init` now fetches network info from the backend and displays the network name, chain ID, and USDC contract address after wallet creation (both in human and JSON output). This removes the need to run `taskmarket deposit` separately just to find out where to send funds.
