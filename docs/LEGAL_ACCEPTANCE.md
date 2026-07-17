# Legal Acceptance Operations

Taskmarket has one versioned legal bundle covering web, CLI, and raw API operators. The checked-in bundle is intentionally marked `draft`; the backend refuses to enable enforcement until the status is `approved`, the version and effective date are final, the entity fields are complete, and no counsel or product placeholders remain.

## Blockers to launch

This is not an engineering timeline. Enforcement stays off until all of the following are true, and none of them have a fixed date:

1. **No real entity yet.** The documents need an actual registered business name, incorporation jurisdiction, and address in place of the `[Entity Name]`-style placeholders in `packages/shared/src/legal.ts`.
2. **No counsel review yet.** A lawyer has to actually determine what Taskmarket is legally required to do — money transmission, sanctions screening, tax reporting, consumer protection — and this varies by launch jurisdiction. That analysis has not happened.
3. **Unknown build scope.** Depending on what counsel's analysis requires, real features may need to be built first (identity checks, sanctions screening, complaints handling) that don't exist today.
4. **No privacy program yet.** How user data is collected, stored, and returned on request needs a written, approved program. It does not exist yet.
5. **The policy text is still a draft.** Every bracketed placeholder needs to become final, counsel-approved wording, not something an engineer fills in unilaterally.

Once 1–5 are actually done (by counsel and the business, not by engineering), the remaining steps — production Privy config, deploying with enforcement still off, testing end to end, then flipping `LEGAL_ENFORCEMENT_ENABLED=true` — are fast. They are not the bottleneck and should not be scheduled against a calendar date; they happen after the legal work is genuinely finished, whenever that is.

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
2. Approve an operating-model and launch-jurisdiction matrix covering every task mode, contract-formation event, platform fee, worker stake, rejection or dispute charge, smart-contract flow, relayer, X402 payment, embedded wallet, fiat onramp, storage provider, and participant role. Verify the policy descriptions against the production interface and deployed contracts.
3. Obtain counsel's written classification analysis for custody, money transmission, payment services, virtual-asset services, financial services, sanctions, marketplace and digital-platform work, employment and contractor status, consumer and small-business protections, tax reporting or withholding, content moderation, intellectual property, privacy, and cross-border transfers in every launch jurisdiction. A policy disclaimer is not a substitute for that analysis.
4. Implement the controls the analysis requires, including licensing or registration, identity and trader-status checks, sanctions and geographic screening, asset blocking and reporting, complaints and appeals, worker notices, consumer remedies, intellectual-property notices, illegal-content reporting, and regulator cooperation. Test both false-positive review and prohibited-party paths before launch.
5. Complete and approve the purpose-by-purpose data inventory, lawful-basis assessment, collection notices, service-provider register, international-transfer mechanism, cookie and SDK inventory, consent controls, retention schedule, rights-request procedure, privacy-impact assessments, and incident and eligible-breach response plan. Confirm the public Privacy Policy describes actual production behavior.
6. Replace the governing-law, forum, liability-cap, regulatory, privacy-representative, supervisory-authority, retention, provider, complaint, moderation, copyright, and appeal placeholders, remove every draft marker, and set the effective-date constant used by every policy.
7. Set a final version and effective date, change the bundle status to `approved`, and review the resulting document hashes in `GET /api/legal/current`.
8. Configure the production Privy app's Terms and Privacy URLs and enable Privy's affirmative-consent display as a first-login notice. Taskmarket's own versioned gate remains the authoritative reacceptance ledger.
9. Set backend `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and optionally `PRIVY_JWT_VERIFICATION_KEY`.
10. Apply migration `0026_add_legal_acceptance`, confirm all three legal tables exist in production, rate-limit the public legal challenge endpoint at the edge, and schedule deletion of expired challenge rows after the required diagnostic window.
11. Set `TRUST_PROXY_HOPS` to the verified Railway proxy-hop count, then confirm a controlled request records the real client IP and that a direct spoofed `X-Forwarded-For` value is not trusted in the deployed topology.
12. Deploy approved copy with `LEGAL_ENFORCEMENT_ENABLED=false`, verify web and CLI acceptance end to end, and inspect acceptance evidence without logging raw receipts or access tokens. The web gate uses `acceptanceAvailable`, so this pre-enforcement rollout remains testable while protected writes are still allowed.
13. Enable `LEGAL_ENFORCEMENT_ENABLED=true`, then verify a protected unpaid X402 probe returns 403 before payment and that terminal acceptance, cancellation, refund, appeal, withdrawal, email deletion, and public reads remain available as required without a receipt (see the exempt routes in `legal-access.ts`). Logout is a client-side Privy action that never calls a legal-gated backend route, so it needs no exemption of its own. Complaints handling and a formal data rights-request procedure do not exist as backend endpoints yet; build and exempt them before claiming this item complete.

## Policy Updates

Any material policy change must use a new bundle version. Do not edit active copy in place. Deploy the new public pages and backend bundle together; clients will then require fresh acceptance automatically. A digest change also fails closed if a same-version edit is made accidentally. Preserve old acceptance rows and document content in source control for auditability.

## Incident Response

Raw receipts are secret-like evidence capabilities but do not replace wallet signatures, device tokens, Privy authentication, or X402 authorization. CLI receipts are origin-bound and must not be copied between API environments. If a receipt is exposed, revoke the relevant `legal_access_receipts` row. If the current bundle or evidence process is compromised, disable enforcement only if necessary to preserve access to recovery actions, investigate, publish a new bundle version, and require reacceptance.
