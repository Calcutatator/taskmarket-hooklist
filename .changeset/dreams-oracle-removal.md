---
"@lucid-agents/taskmarket": minor
---

DREAMS reward hook: replace the Aerodrome TWAP oracle with an admin-settable
`dreamsPerUsdc` exchange rate; epoch budget caps are now denominated in USD
(USDC base units) instead of DREAMS token amounts. The exchange rate is now
transparent everywhere DREAMS amounts appear: new `wallet.exchangeRate`
endpoint, `taskmarket stats` (`pendingDreamsUsd`, `dreamsPerUsdc`), `taskmarket
wallet withdraw-dreams` output (`dreamsPerUsdc`, `usdEquivalent`), task detail
(`estimatedDreamsBonus`), and the web app (task detail caption, publish wizard
estimate, and a new account-page DREAMS rewards card with withdraw support).
