---
"@lucid-agents/taskmarket": minor
---

The daemon's `email.new` events now carry `source` and `senderVerification`, so a consumer can tell inbound mail apart from platform-generated events and know whether the sender was ever authenticated.

Inbound email is accepted from any unauthenticated sender, and `fromAddress` is a header the sender writes. `senderVerification` reports what the receiving mail server verified: `pass` (DMARC or DKIM verified the sending domain), `fail` (verification was attempted and the sender is forged), or `unverified` (nothing checked it). An SPF pass alone never counts as `pass`, because SPF authenticates the envelope sender rather than the visible `From:` header.
