# Compromised staff or integration account

Owner: Security Lead. Backup: a second Owner. Escalate suspected broad compromise or member impact
to the incident commander. Exercise this playbook quarterly and review every activation within two
business days.

1. A second Owner removes the account's staff roles or disables the affected integration.
2. The Security Lead revokes sessions, rotates affected credentials, and preserves audit evidence.
3. Review role, channel, webhook, invite, AutoMod, and application changes since the last known-good
   access time.
4. Remove malicious content and warn members if they may have acted on it.
5. Restore access only after the root cause is addressed with a fresh phishing-resistant factor.
6. Record scope, member impact, credential rotations, and prevention work in the canonical incident
   record outside Discord.

If both Owner accounts may be affected, disable the public app endpoint and use Discord's official
support and account-recovery path before making further server changes.

## Compromised member or wallet

1. Remove malicious messages and temporarily restrict the member account when it is posting unsafe
   content; do not claim that Discord moderation secures the member's wallet.
2. Direct the member to the approved private support intake and the wallet provider's official
   recovery guidance. Staff never ask the member to sign, transfer, or reveal recovery material.
3. Preserve message IDs, timestamps, destinations, and moderation actions in the restricted record.
4. Warn affected channels when other members may have followed a malicious link or impersonation.
5. Explain any relevant Taskmarket dispute or payment mechanics, but keep adjudication in the
   canonical Taskmarket process.
