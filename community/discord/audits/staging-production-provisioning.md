# Staging and production provisioning

Owner: Engineering deploy owner. Backup: Security Lead. Review every item before first launch and
after application, guild, Railway service, or protected-environment replacement.

- [ ] Create distinct DEVNET and PRODUCTION Discord applications.
- [ ] Use a private staging guild and the public production guild; record their IDs only in the
      matching protected environment.
- [ ] Configure approved guild and channel allowlists for each environment.
- [ ] Create one Railway service with Root Directory `/` and Config-as-Code path
      `/apps/discord-app/railway.json` in DEVNET and PRODUCTION.
- [ ] Store the runtime public key in Railway and registration token in the matching GitHub
      protected environment.
- [ ] Require reviewers for the PRODUCTION deployment and rollback environment, and protect `v*`
      tags from unreviewed creation or replacement.
- [ ] Configure and validate each `/interactions` endpoint from Discord.
- [ ] Register guild-scoped DEVNET commands and run live canaries.
- [ ] Complete permission, integration, AutoMod, support, phishing, and rollback drills.
- [ ] Register production commands in the canary guild, exercise every enabled command plus privacy
      and outage cases, then use the protected `Publish Discord production commands` workflow to
      reconcile global commands for the exact SHA.
