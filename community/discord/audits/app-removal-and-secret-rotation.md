# App removal and secret rotation

Owner: Security Lead. Backup: a second Owner. Exercise removal and rotation in DEVNET quarterly and
review every production use within two business days.

For routine rotation, create the replacement token, update the protected environment secret,
redeploy, verify health and live commands, then revoke the old token. Public-key rotation requires
updating the Railway environment and Discord endpoint validation as one controlled change.

For compromise, remove the Interactions Endpoint URL or disable the application, revoke the token,
remove unexpected commands and integrations, inspect the audit log, rotate affected webhooks, and
redeploy with fresh environment-scoped credentials. DEVNET and PRODUCTION rotate independently.
Use the protected `Emergency disable Discord commands` workflow to replace the affected guild and
global command manifests with empty lists even when the runtime service is unhealthy.

Record the operator, environment, credential class, start and completion time, validation evidence,
and follow-up review without recording any secret value.
