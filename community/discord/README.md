# Taskmarket Discord

This directory is the version-controlled blueprint for Taskmarket's public Discord server and
its read-only Discord application. Discord is the community and support layer; Taskmarket's web
app, documentation, status page, and support intake remain the sources of truth.

## Product principles

1. A new member can find the correct next action without reading chat history.
2. Support questions become searchable forum threads, not repeated private conversations.
3. User work, wallet actions, payments, disputes, and identity verification never happen in
   Discord.
4. Official links have one canonical location. Staff never initiate direct messages for support.
5. The public app reads only explicitly public Taskmarket data and cannot mutate Taskmarket.
6. Roles grant the minimum permissions required. Reputation roles are cosmetic, not authority.
7. Every operational action has an owner, escalation path, and review cadence.

## Repository map

- `server.yaml`: categories, channels, purpose, and retention intent.
- `roles-and-permissions.yaml`: role hierarchy and permission boundaries.
- `onboarding.yaml`: Discord Community onboarding questions and destinations.
- `forum-tags.yaml`: required support and showcase classification.
- `automod.yaml`: native AutoMod policy and escalation behavior.
- `apps-and-webhooks.yaml`: approved integrations and webhook ownership.
- `copy/`: canonical member-facing copy.
- `playbooks/`: support, moderation, safety, and incident procedures.
- `audits/`: launch and recurring control checks.
- `metrics/`: success and safety measures.

## Change control

Changes to permissions, staff roles, app scopes, retention, or incident handling require review by
the Community and Security owners. Update this blueprint first, apply it to DEVNET, record the
audit result, then promote the same change to PRODUCTION.

The application implementation lives in `apps/discord-app`. Railway deployment and command
registration are documented in `playbooks/railway-deployment.md`.
