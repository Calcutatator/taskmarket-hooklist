# Legal Acceptance Operations

Taskmarket has one versioned legal bundle covering web, CLI, and raw API operators. The checked-in bundle is intentionally marked `draft`; the backend refuses to enable enforcement until the status is `approved`, the version and effective date are final, the entity fields are complete, and no counsel or product placeholders remain.

## Evidence Model

Every acceptance row records:

- the bundle version, canonical bundle digest, and SHA-256 hash of all four documents;
- the exact acceptance statement;
- a normalized Privy user ID or wallet address;
- the web-clickwrap or wallet-signature method;
- the acceptance time, session or signature evidence, IP address, and user agent.

Clients receive a random receipt. Only its SHA-256 hash is stored. Middleware validates the receipt against the current bundle version and digest before protected writes and before any X402 settlement. Privy receipts must accompany a matching Privy bearer token; wallet receipts must match the X402 payer or acting wallet. A version or content-digest change invalidates earlier receipts without deleting historical evidence.

Policy links returned by the backend are hash-addressed canonical Markdown served by the same process that computes the evidence hashes. The public Next.js legal center is a presentation copy; acceptance clients must use the canonical URLs from `GET /api/legal/current`.

## Activation Checklist

Enforcement must stay disabled until every item is complete:

1. Replace the registered entity name, incorporation jurisdiction, registered address, and legal-notice email in `packages/shared/src/legal.ts`.
2. Have counsel review all four policies and Taskmarket's actual escrow/payment flow, sanctions exposure, marketplace obligations, privacy inventory, cookies, retention, and launch jurisdictions.
3. Replace the governing-law, forum, liability-cap, regulatory, privacy-representative, and appeal-process placeholders, remove every draft marker, and set the effective-date constant used by every policy.
4. Set a final version and effective date, change the bundle status to `approved`, and review the resulting document hashes in `GET /api/legal/current`.
5. Configure the production Privy app's Terms and Privacy URLs and enable Privy's affirmative-consent display as a first-login notice. Taskmarket's own versioned gate remains the authoritative reacceptance ledger.
6. Set backend `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and optionally `PRIVY_JWT_VERIFICATION_KEY`.
7. Apply migration `0026_add_legal_acceptance`, confirm all three legal tables exist in production, rate-limit the public legal challenge endpoint at the edge, and schedule deletion of expired challenge rows after the required diagnostic window.
8. Set `TRUST_PROXY_HOPS` to the verified Railway proxy-hop count, then confirm a controlled request records the real client IP and that a direct spoofed `X-Forwarded-For` value is not trusted in the deployed topology.
9. Deploy approved copy with `LEGAL_ENFORCEMENT_ENABLED=false`, verify web and CLI acceptance end to end, and inspect acceptance evidence without logging raw receipts or access tokens. The web gate uses `acceptanceAvailable`, so this pre-enforcement rollout remains testable while protected writes are still allowed.
10. Enable `LEGAL_ENFORCEMENT_ENABLED=true`, then verify a protected unpaid X402 probe returns 403 before payment and that terminal acceptance, cancellation, refund, appeal, withdrawal, deletion, logout, and public reads still work without a receipt.

## Policy Updates

Any material policy change must use a new bundle version. Do not edit active copy in place. Deploy the new public pages and backend bundle together; clients will then require fresh acceptance automatically. A digest change also fails closed if a same-version edit is made accidentally. Preserve old acceptance rows and document content in source control for auditability.

## Incident Response

Raw receipts are secret-like evidence capabilities but do not replace wallet signatures, device tokens, Privy authentication, or X402 authorization. CLI receipts are origin-bound and must not be copied between API environments. If a receipt is exposed, revoke the relevant `legal_access_receipts` row. If the current bundle or evidence process is compromised, disable enforcement only if necessary to preserve access to recovery actions, investigate, publish a new bundle version, and require reacceptance.
