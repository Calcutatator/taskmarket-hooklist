# Launch checklist

Owners: Community Lead and Security Lead. Both owners review this checklist before the public invite
opens, after a material trust-boundary change, and before reopening after an emergency closure.

- [ ] Two break-glass Owners exist and use hardware-backed multi-factor authentication.
- [ ] Staff roles match `roles-and-permissions.yaml`; no unexpected Administrator grants exist.
- [ ] Two independent reviewers signed the same effective-permission audit snapshot.
- [ ] Community, rules screening, explicit media filtering, and native AutoMod are enabled.
- [ ] Canonical links and staff direct-message warning are visible in `start-here`.
- [ ] `{{PRIVATE_SUPPORT_URL}}` and `{{SUPPORT_STAFFED_HOURS}}` provisioning tokens have been replaced
      in the published copy and the private intake has been exercised.
- [ ] Onboarding exposes at least seven defaults, including five where `@everyone` can view and send.
- [ ] Support and developer forums require classification tags.
- [ ] DEVNET and PRODUCTION use separate Discord applications, keys, guilds, and Railway variables.
- [ ] The app requests only `applications.commands` and has no privileged Gateway intents.
- [ ] Discord successfully validates each signed Interactions Endpoint URL.
- [ ] The protected emergency command-removal workflow has been exercised in DEVNET.
- [ ] `/task` does not reveal unlisted, private, missing, or malformed task data.
- [ ] `/drop` does not reveal a drop with no discoverable tasks.
- [ ] `/tasks` lists at most ten open tasks in descending reward order.
- [ ] `/task-drops` lists at most ten Task Drops that currently have open work.
- [ ] `/docs`, `/report`, and optional `/status` use canonical links.
- [ ] Railway `/health` reports the intended environment and commit.
- [ ] Support, scam, raid, incident, appeal, and offboarding procedures have named owners.
- [ ] Invite links, webhooks, integrations, and server audit logs have been reviewed.
- [ ] A tabletop phishing and compromised-staff-account exercise has completed.
