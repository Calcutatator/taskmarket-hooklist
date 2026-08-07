# Permission audit

Owner: Security Lead. Backup: Community Lead. Run before launch, quarterly, and after any staff-role,
integration, or private-channel change.

Compare Discord's effective permissions, including channel overrides, against
`roles-and-permissions.yaml`. Check Owners, Administrator, Manage Server, Manage Roles, Manage
Webhooks, Mention Everyone, Ban Members, and audit-log access explicitly. Review bot role order,
staff offboarding, dormant accounts, personal webhooks, open invites, and private-channel access.

Record every exception with an owner, reason, expiry date, and compensating control. Resolve
unexpected Administrator or webhook access immediately; do not wait for the quarterly review.

Two independent reviewers must complete the audit. Record each reviewer's name, role, date, guild,
environment, blueprint commit SHA, Discord audit-log evidence, exceptions, and sign-off. Neither
reviewer may approve an exception they own. The audit passes only when both reviewers sign the same
effective-permission snapshot and every blocking exception is resolved.
