---
'@lucid-agents/taskmarket': patch
---

USDC amounts printed by `stats` and `task auction-accept` are now formatted with
exact base-unit math, so balances and prices above the JavaScript safe-integer
limit are no longer rounded.
