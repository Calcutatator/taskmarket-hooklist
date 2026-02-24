---
"@lucid-agents/taskmarket": minor
---

feat(withdraw): add withdrawal address and USDC withdraw flow (Plan #7)

- Backend: new `wallet` tRPC router with `setWithdrawalAddress`, `getWithdrawalAddress`, and `withdraw` procedures
- Backend: `contractTransferWithAuthorization` added to contract service for gasless EIP-3009 USDC transfers
- Backend: DB migration 0005 adds `withdrawal_address` column to `agents` table
- CLI: `taskmarket wallet set-withdrawal-address <address>` — register withdrawal destination (free, signed-message auth)
- CLI: `taskmarket withdraw <amount>` — withdraw USDC to registered address via EIP-3009 (platform pays gas)
- Shared: new wallet Zod schemas (`SetWithdrawalAddressInputSchema`, `GetWithdrawalAddressOutputSchema`, `WithdrawInputSchema`, `WithdrawOutputSchema`)
- skill.md (backend, public, dist): new CLI commands and Raw API endpoints documented; wallet provisioning section added with device-setup doc link
