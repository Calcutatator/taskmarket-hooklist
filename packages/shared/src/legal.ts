export type LegalDocumentType =
  | 'terms_of_service'
  | 'privacy_policy'
  | 'risk_disclosure'
  | 'acceptable_use_policy';

export type LegalCopyStatus = 'draft' | 'approved';

export const LEGAL_RECEIPT_HEADER = 'X-Taskmarket-Legal-Receipt';

export function buildLegalReceiptHeaders(
  receipt: string | null | undefined
): Record<string, string> {
  return receipt ? { [LEGAL_RECEIPT_HEADER]: receipt } : {};
}

export interface LegalDocument {
  type: LegalDocumentType;
  title: string;
  slug: 'terms' | 'privacy' | 'risks' | 'acceptable-use';
  version: string;
  summary: string;
  markdown: string;
}

export interface LegalDocumentEvidence {
  type: LegalDocumentType;
  title: string;
  version: string;
  contentHash: string;
}

export interface LegalPolicyBundle {
  version: string;
  status: LegalCopyStatus;
  publishedAt: string;
  effectiveAt: string | null;
  documents: readonly LegalDocument[];
}

export const LEGAL_ENTITY = {
  registeredName: '[REGISTERED ENTITY NAME]',
  jurisdiction: '[JURISDICTION OF INCORPORATION]',
  registeredAddress: '[REGISTERED ADDRESS]',
  legalNoticeEmail: '[LEGAL NOTICE EMAIL]',
} as const;

export const LEGAL_ACCEPTANCE_STATEMENT =
  'I agree to the Terms of Service and Acceptable Use Policy, acknowledge the Risk Disclosure, and confirm that I have been given the Privacy Policy.';

const VERSION = '2026-07-draft-2';
const PUBLISHED_AT = '2026-07-15T00:00:00.000Z';
const EFFECTIVE_AT: string | null = null;
const DRAFT_NOTICE = `> Draft for counsel review. This policy is not approved or active. The contracting entity details, launch jurisdictions, operating-model statements, and counsel decisions in square brackets must be completed and verified before activation.`;
const POLICY_DATE_LINES = `Published: 15 July 2026

Effective date: ${EFFECTIVE_AT ?? '[COUNSEL TO APPROVE EFFECTIVE DATE]'}`;

const termsOfService: LegalDocument = {
  type: 'terms_of_service',
  title: 'Terms of Service',
  slug: 'terms',
  version: VERSION,
  summary: 'The contract governing access to Taskmarket and participation in its task marketplace.',
  markdown: `# Taskmarket Terms of Service

Version ${VERSION}

${POLICY_DATE_LINES}

${DRAFT_NOTICE}

These Terms of Service (the "Terms") are a binding agreement between you and ${LEGAL_ENTITY.registeredName}, a company registered in ${LEGAL_ENTITY.jurisdiction}, with its registered office at ${LEGAL_ENTITY.registeredAddress} ("Taskmarket", "we", "us", or "our"). They govern your access to and use of Taskmarket websites, APIs, command-line tools, smart-contract interfaces, relayers, communications services, and related software (collectively, the "Services").

## 1. Acceptance and authority

By selecting the acceptance control, signing the Taskmarket legal-acceptance message, submitting an acceptance through an authorized integration, or using a feature that requires acceptance, you agree to these Terms and the Acceptable Use Policy and acknowledge the Privacy Policy and Risk Disclosure. If you act for a company, DAO, agent operator, principal, or other person, you represent that you have authority to bind that person. "You" includes that person and every software agent you authorize to use the Services.

You must be legally capable of entering this agreement, be at least 18 years old or the age of majority where you live, and not be prohibited from using the Services by law. You may not accept on behalf of an unidentified principal or allow an autonomous agent to accept unless a human or legal person has authorized the acceptance.

## 2. Platform role and regulatory perimeter

Taskmarket provides software and infrastructure through which requesters can publish funded tasks and workers can discover, perform, submit, evaluate, or dispute work. Some actions are recorded or settled using smart contracts and digital assets on public blockchains. Taskmarket-operated interfaces may prepare or relay participant-authorized transactions, sponsor gas, collect disclosed platform fees, or integrate third-party identity, wallet, fiat-onramp, storage, messaging, RPC, or payment-facilitation services.

Unless Taskmarket expressly agrees otherwise in a separate signed writing, Taskmarket is not the requester, worker, employer, employee, partner, joint venturer, fiduciary, trustee, professional adviser, or agent of a marketplace participant and is not a party to a participant contract described in section 3. Taskmarket does not take title to task deliverables merely by operating the Services. A third-party provider's services are governed by its own terms, and Taskmarket does not control public blockchains or independently deployed smart contracts.

References to "escrow" describe technical locking and release conditions implemented by the applicable smart contract. They do not promise a regulated trust, bank, deposit, custody, money-transmission, payment, or escrow service, deposit insurance, or chargeback rights. A label or disclaimer in these Terms does not determine the regulatory classification of Taskmarket, a participant, or an activity. [COUNSEL TO CONFIRM THE CUSTODY, MONEY-TRANSMISSION, PAYMENT-SERVICE, VIRTUAL-ASSET, FINANCIAL-SERVICE, AND FIAT-ONRAMP ANALYSIS FOR EVERY LAUNCH JURISDICTION AND THE DEPLOYED OPERATING MODEL.]

## 3. Task records and participant contracts

A "Task Record" is the version of a task's description, mode, reward or pricing rule, platform fee, deadlines, eligibility rules, acceptance or evaluation criteria, evaluator and dispute settings, intellectual-property terms, confidentiality requirements, linked materials, and other disclosed conditions presented when a participant takes the relevant action, together with the applicable onchain state and transaction prompt. Requesters must make the Task Record complete and internally consistent. Participants must preserve a copy of any offchain terms they rely on.

Each Task Record and the actions taken under it form a direct contract between the requester and each worker to the extent a contract is created under applicable law (a "Participant Contract"). Depending on the task mode, a worker manifests willingness to contract by claiming or accepting a task, submitting a bid or pitch, or submitting work to an open bounty or benchmark. The Participant Contract forms when the worker claims or accepts the task, the requester selects the worker's bid or pitch, or the worker submits to an open task, subject to applicable law. A requester's publication funds and offers the task subject to its disclosed mode; selection, acceptance, rejection, evaluation, appeal, cancellation, expiry, and payment rights are governed by the Task Record and protocol state. [COUNSEL TO CONFIRM CONTRACT-FORMATION EVENTS FOR EVERY SUPPORTED TASK MODE AGAINST THE PRODUCTION INTERFACE AND SMART CONTRACTS.]

The requester promises to fund and administer the task, apply the disclosed criteria in good faith, avoid material changes after worker commitment except as the Task Record and law permit, and authorize payment when the protocol conditions are satisfied. The worker promises to perform and submit the work in accordance with the Task Record and to deliver the disclosed rights, licences, provenance, and supporting materials. Evaluators and dispute resolvers are bound by their disclosed mandate and must apply the stated criteria impartially and in good faith.

If records conflict, mandatory law controls first. As between participants, the verified onchain state and signed transaction control settlement mechanics; the Task Record controls the promised scope and quality of work; and these Terms supply general rules. A smart-contract result does not extinguish a separate legal right or remedy that cannot lawfully be excluded. Taskmarket is not responsible for enforcing Participant Contracts outside the technical functions it expressly provides.

## 4. Accounts, wallets, agents, and security

You are responsible for all wallets, credentials, devices, API tokens, private keys, agent configurations, and instructions used under your control. You must keep them secure, promptly revoke compromised credentials, and ensure that automated activity remains within the authority you granted. We may treat a valid cryptographic signature, authenticated session, API token, or legal-acceptance receipt as evidence that the associated action was authorized, subject to applicable law.

You must provide accurate information and must not impersonate another person, conceal the real operator of an agent when disclosure is required, or transfer access to a prohibited person. Loss of a key or credential may make assets or data irrecoverable. Taskmarket does not promise to restore access or reverse blockchain transactions.

## 5. Marketplace responsibilities and worker status

Requesters are responsible for lawful task descriptions, sufficient specifications, funding, evaluation criteria, permissions, and timely decisions. Workers are responsible for determining whether they can lawfully and competently perform a task, for the accuracy and safety of submissions, and for delivering all promised rights and materials. Evaluators and dispute resolvers must act within their disclosed role and apply the stated criteria in good faith.

You must independently assess counterparties and outputs. You may not rely on rankings, identities, badges, agent metadata, reputation scores, automated checks, or platform displays as endorsements. You are responsible for human review where an output could affect rights, safety, finances, employment, credit, housing, health, legal matters, critical infrastructure, or other high-impact decisions.

Participants ordinarily act as independent businesses or contractors, not as Taskmarket employees. That description does not override the legal classification produced by the actual relationship. Requesters and workers are responsible for determining and complying with any employment, contractor, labour-hire, digital-platform-work, minimum-pay, working-time, workplace-safety, insurance, payroll, withholding, superannuation, benefit, licensing, or collective-right obligations that apply. Taskmarket will provide any rights, notices, records, consultation, deactivation process, or regulator cooperation that mandatory platform-work law requires. [COUNSEL TO ASSESS WORKER CLASSIFICATION AND DIGITAL LABOUR PLATFORM DUTIES IN EVERY LAUNCH JURISDICTION.]

If a participant acts as a trader, business, consumer, or small business, it must accurately disclose that status where the Services request it. A trader must provide all legally required identity, contact, pricing, cancellation, guarantee, and pre-contract information to its counterparty. Participants may not use Taskmarket to evade consumer, worker, tax, or professional obligations.

## 6. Funding, fees, settlement, and taxes

Displayed rewards, platform fees, gas sponsorship, facilitator charges, evaluator compensation, worker stakes, rejection or dispute charges, and settlement rules may vary by task, mode, or network. Before authorizing an action, you must review the asset, amount, recipient, network, platform fee, third-party fee, exchange-rate basis, and conditions for release, refund, forfeiture, or expiry. The Task Record or transaction prompt controls task-specific economics if it conflicts with a general description in these Terms.

Task funding may be held and released by a smart contract according to its state rather than by Taskmarket. Blockchain transactions may be final once submitted. Smart-contract conditions may release, split, return, freeze, forfeit, or make funds unavailable without a manual remedy from Taskmarket. Fiat onramps, stablecoins, wallets, facilitators, and exchanges are independent services and may impose separate identity checks, fees, limits, reversals, freezes, or terms.

Taskmarket may screen, reject, delay, freeze, block, or report an interface, relay, wallet, payment, or withdrawal where required by law, a sanctions obligation, a binding order, or a provider restriction. Taskmarket will not intentionally retain or redirect participant assets except as the protocol, a participant authorization, or applicable law permits. [COUNSEL TO DEFINE REQUIRED CUSTOMER DUE DILIGENCE, SANCTIONS SCREENING, RECORDKEEPING, REPORTING, ASSET-BLOCKING, LICENSING, AND COMPLAINT CONTROLS BEFORE ACTIVATION.]

You are responsible for all taxes, reporting, withholding, invoices, registrations, and currency-conversion consequences arising from your activity. Amounts described in a fiat currency are informational unless expressly guaranteed. Stablecoins may lose value or become unavailable.

## 7. Protocol disputes and existing positions

Taskmarket may provide protocol-based acceptance, rejection, appeal, evaluator, timeout, cancellation, refund, or dispute-resolution functions. Those functions are limited to their disclosed technical rules and are not a court or arbitration service unless an approved policy expressly says otherwise. You must observe all onchain and interface deadlines and retain supporting evidence. A protocol result may determine smart-contract settlement but does not prevent a participant from pursuing a non-waivable legal remedy against its counterparty.

If a new version of these Terms is required and you decline it, we may restrict new marketplace activity while preserving available public reads and designated exit or recovery actions. The availability of an exit action depends on the protocol state and applicable law; it is not a guarantee that every position can be unwound.

## 8. Intellectual property and submissions

Taskmarket and its licensors retain rights in the Services, branding, interfaces, documentation, and software except for open-source components governed by their licenses. We grant you a limited, revocable, non-exclusive, non-transferable right to use the Services in accordance with these Terms.

As between marketplace participants, ownership and licensing of task inputs and outputs are determined by the Task Record, the Participant Contract, and applicable law. Unless a Task Record expressly provides a different rule, each participant retains what it owned before the task and the worker retains ownership of new deliverables; the worker grants the requester only a non-exclusive licence reasonably necessary to inspect and evaluate the submission. Any assignment or broader licence takes effect only to the extent stated in the Task Record and permitted by law, and [COUNSEL TO CONFIRM WHETHER IT IS CONDITIONED ON FULL PAYMENT]. Moral rights and similar rights are not waived except through a valid express waiver or consent.

You represent that you have all rights and permissions needed to upload, process, disclose, and license content and that you will provide required attribution, open-source notices, provenance, and usage restrictions. You grant Taskmarket a worldwide, non-exclusive licence to host, transmit, reproduce, transform, and display content solely as needed to operate, secure, and improve the Services, resolve complaints, and comply with law. This operational licence ends when no longer needed, subject to backups, evidence preservation, public records, and legal retention.

Taskmarket may operate an intellectual-property complaint and counter-notice process and may restrict disputed content while reviewing a complaint. [COUNSEL TO DEFINE THE APPLICABLE COPYRIGHT, TRADEMARK, REPEAT-INFRINGER, COUNTER-NOTICE, AND DESIGNATED-AGENT PROCESS FOR LAUNCH JURISDICTIONS.]

## 9. Confidentiality and public blockchains

The Services do not create a general duty of confidentiality between participants. A Task Record must expressly identify confidential information, permitted recipients and uses, security requirements, and the duration of any confidentiality obligation. Do not place confidential, personal, export-controlled, privileged, or restricted information in public task fields, signatures, hashes, transaction calldata, content-addressed storage, or other permanent systems. Public blockchain information may be visible indefinitely and cannot generally be deleted by Taskmarket. A hash can still reveal information or become personal data when combined with other information.

## 10. Compliance, sanctions, and acceptable use

You must comply with all laws that apply to you, including sanctions, export controls, anti-money-laundering obligations, anti-bribery rules, consumer and marketplace laws, intellectual-property laws, privacy laws, and rules governing automated decision-making. You may not use the Services from, for, or on behalf of a sanctioned jurisdiction, blocked person, or prohibited transaction. You must comply with the Acceptable Use Policy.

You must provide information reasonably required for identity, age, trader-status, source-of-funds, sanctions, export-control, tax, fraud, or other lawful checks. We may screen addresses, identities, locations, counterparties, content, or activity; request information; restrict access; reject or delay relaying; preserve records; block assets where legally required and technically possible; or report conduct where reasonably necessary for security, legal compliance, or platform integrity. Screening is not a representation that any participant or transaction is lawful.

## 11. Mandatory rights, complaints, suspension, and termination

Nothing in these Terms excludes, restricts, or modifies mandatory consumer, small-business, worker, or contractor rights; statutory guarantees; cooling-off or cancellation rights; unfair-terms protections; privacy or payment rights; or regulator or court remedies. If a prohibited exclusion would otherwise apply, these Terms operate only to the maximum extent permitted by law. You may contact ${LEGAL_ENTITY.legalNoticeEmail} about a payment, safety, moderation, privacy, intellectual-property, deactivation, or other complaint. [COUNSEL AND PRODUCT TO DEFINE JURISDICTION-SPECIFIC COMPLAINT CATEGORIES, RESPONSE TARGETS, EXTERNAL ESCALATION, AND REQUIRED OMBUDSMAN OR REGULATOR DETAILS.]

You may stop using the Services at any time. We may limit, suspend, or terminate access; refuse or remove content; revoke platform credentials; or stop operating any feature where reasonably necessary for legal compliance, security, maintenance, abuse prevention, or material breach. Where feasible and lawful, we will preserve designated exit functions for existing positions, but smart-contract and third-party constraints may limit what we can do.

Where required by law, we will give reasons, advance notice, an opportunity to respond, and access to an internal or external review process before or after moderation, suspension, deactivation, or termination. Immediate action may be necessary for urgent harm, security, sanctions, fraud, illegality, or a binding order. The Acceptable Use Policy describes the general enforcement process.

Sections that by their nature should survive will survive, including ownership, payment, risk allocation, liability, indemnity, records, disputes, and notices.

## 12. Disclaimers

THE SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE". TO THE MAXIMUM EXTENT PERMITTED BY LAW, TASKMARKET DISCLAIMS ALL EXPRESS, IMPLIED, AND STATUTORY WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, ACCURACY, SECURITY, AVAILABILITY, AND WARRANTIES ARISING FROM COURSE OF DEALING. TASKMARKET DOES NOT WARRANT THAT CODE, SMART CONTRACTS, AGENTS, OUTPUTS, PAYMENTS, DATA, OR THIRD-PARTY SERVICES ARE ERROR-FREE, SAFE, LAWFUL, OR AVAILABLE.

Nothing in these Terms excludes a warranty, guarantee, right, or remedy that cannot lawfully be excluded.

## 13. Limitation of liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, TASKMARKET AND ITS AFFILIATES, PERSONNEL, AND SUPPLIERS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, PUNITIVE, OR CONSEQUENTIAL LOSS; LOST PROFITS, REVENUE, DATA, GOODWILL, OPPORTUNITY, OR DIGITAL ASSETS; OR LOSS ARISING FROM KEYS, AGENTS, OUTPUTS, COUNTERPARTIES, SMART CONTRACTS, NETWORKS, FORKS, OR THIRD-PARTY SERVICES.

TASKMARKET'S AGGREGATE LIABILITY ARISING OUT OF THE SERVICES WILL NOT EXCEED THE GREATER OF (A) FEES YOU PAID DIRECTLY TO TASKMARKET DURING THE SIX MONTHS BEFORE THE EVENT GIVING RISE TO LIABILITY OR (B) [LIABILITY CAP TO BE APPROVED BY COUNSEL]. These limits apply across all theories of liability and do not apply where prohibited by law.

## 14. Indemnity

To the extent permitted by law, you will defend, indemnify, and hold harmless Taskmarket and its affiliates and personnel from third-party claims, losses, and reasonable costs arising from your tasks, submissions, agents, content, breach of these Terms, infringement, unlawful conduct, or failure to pay taxes. This obligation does not apply to the extent caused by a protected party's fraud, wilful misconduct, or liability that cannot be excluded.

## 15. Changes, electronic communications, and records

We may update these Terms. Material changes will receive a new version and effective date, and we may require fresh assent before new activity. An acceptance record identifies the exact document version and content hash presented. Continuing to use ungated public features does not by itself record assent to a new version.

You consent to receive agreements, disclosures, receipts, and notices electronically where law permits. A click, authenticated request, wallet signature, agent action within granted authority, or other electronic record may evidence assent or authorization, but does not bind a person who did not authorize it. You are responsible for keeping contact details current and retaining copies of Task Records, transaction prompts, and notices. Taskmarket may retain versioned policies, content hashes, signatures, session evidence, timestamps, IP addresses, user agents, and related audit records as described in the Privacy Policy.

## 16. Governing law and legal disputes

These Terms are governed by the laws of [GOVERNING LAW JURISDICTION], excluding conflict-of-law rules. The courts of [EXCLUSIVE FORUM] have exclusive jurisdiction, subject to any mandatory consumer rights and any dispute process counsel adds before approval. [COUNSEL TO INSERT ANY ARBITRATION, CLASS-ACTION, OR CONSUMER-SPECIFIC TERMS.]

## 17. General

These Terms, the Acceptable Use Policy, the Risk Disclosure, the applicable Task Record, and any expressly incorporated participant terms are the entire agreement about their subject matter. The Privacy Policy is a notice and does not form a contract except where applicable law provides otherwise. If a provision is unenforceable, it will be enforced to the maximum lawful extent and the rest remains effective. A failure to enforce is not a waiver. You may not assign these Terms without our consent; we may assign them as part of a reorganization, financing, or transfer of the Services, subject to law. Neither party is liable for delay caused by an event beyond its reasonable control, but this does not excuse payment, asset-protection, or mandatory legal obligations. Headings are for convenience only.

## 18. Notices and contact

Legal notices to Taskmarket must be sent to ${LEGAL_ENTITY.legalNoticeEmail} and, where required, to ${LEGAL_ENTITY.registeredAddress}. We may send operational or legal notices through the Services, to your registered contact, or by another lawful method.
`,
};

const privacyPolicy: LegalDocument = {
  type: 'privacy_policy',
  title: 'Privacy Policy',
  slug: 'privacy',
  version: VERSION,
  summary: 'How Taskmarket collects, uses, shares, retains, and protects personal information.',
  markdown: `# Taskmarket Privacy Policy

Version ${VERSION}

${POLICY_DATE_LINES}

${DRAFT_NOTICE}

This Privacy Policy explains how ${LEGAL_ENTITY.registeredName}, registered in ${LEGAL_ENTITY.jurisdiction} at ${LEGAL_ENTITY.registeredAddress} ("Taskmarket", "we", "us", or "our"), handles personal information when you use the Services. Taskmarket is the controller, APP entity, business, or other organization responsible for the processing described here to the extent the applicable law assigns that role. Marketplace participants are independently responsible for personal information they place in tasks, submissions, evaluations, or agent workflows unless a written data-processing agreement says otherwise. [COUNSEL TO CONFIRM TASKMARKET'S PRIVACY ROLE FOR EACH DATA FLOW AND LAUNCH JURISDICTION.]

## 1. Information we collect

We may collect:

- **Account and contact data:** Privy user identifier, email address, social-login details made available to us, wallet addresses, usernames, organization details, and support communications.
- **Wallet and blockchain data:** public addresses, signatures, transactions, task and payment events, token balances needed for a feature, contract interactions, and information derived from public ledgers.
- **Marketplace content:** task descriptions, bids, pitches, proofs, submissions, evaluations, disputes, ratings, files, messages, agent profiles, public keys, and metadata. Content may contain personal information supplied by you or another participant.
- **Technical and usage data:** IP address, device and browser information, timestamps, request identifiers, logs, pages and commands used, error reports, security events, and cookie or similar-technology data.
- **Acceptance evidence:** policy versions and content hashes, acceptance method, timestamp, wallet signature or authenticated Privy session identifier, receipt hash, IP address, and user agent.
- **Compliance data:** screening results, risk indicators, country or region inferred from technical data, and information reasonably needed to investigate abuse or meet legal obligations.
- **Sensitive or regulated data:** identity-verification records, government identifiers, sanctions matches, precise location, or other sensitive information only where a feature or legal obligation requires it. Do not include health, biometric, financial-account, government-identifier, criminal-record, or other sensitive data in marketplace content unless the Task Record expressly permits it and a lawful basis and safeguards are in place.

We obtain information from you, your authorized agents and integrations, identity and wallet providers, counterparties, public blockchains, service providers, and publicly available sources. Where required, we provide a contextual collection notice at or before collection explaining the data, purpose, recipients, consequences of not providing it, and applicable choices. This Policy does not replace a collection notice required for a particular feature or jurisdiction.

## 2. Why we use information

We use information to provide and administer the Services; authenticate users and agents; create and display marketplace records; facilitate contract interactions, payments, communications, and support; maintain acceptance evidence; prevent fraud and security incidents; debug and improve the Services; enforce policies; perform sanctions and compliance checks where implemented; comply with law; establish or defend legal claims; and communicate material service or policy changes.

Where a legal basis is required, we rely as applicable on performance of a contract, legitimate interests in operating and securing the marketplace, compliance with legal obligations, protection of vital interests, consent for a specific optional purpose, or another basis available under local law. [COUNSEL AND PRODUCT TO COMPLETE A PURPOSE-BY-PURPOSE DATA INVENTORY AND LAWFUL-BASIS ASSESSMENT.] You may withdraw consent for future processing where consent is the basis, without affecting earlier processing. The Privacy Policy is a notice and is not itself blanket consent to every use of information. We will not use personal information for a materially incompatible purpose without another lawful basis and any notice or consent the law requires.

## 3. Public and immutable information

Wallet addresses, transactions, signatures, hashes, task events, and other data placed on a public blockchain are available to anyone and may be copied, analyzed, or retained by independent parties. We do not control public networks and generally cannot alter or erase their records. Avoid submitting personal or confidential information onchain. Offchain deletion requests do not remove independent blockchain records.

## 4. How we disclose information

We may disclose information:

- to other marketplace participants and the public where a feature is public or disclosure is needed to perform a task;
- to cloud, database, storage, authentication, wallet, RPC, blockchain, payment-facilitation, email, security, analytics, and support providers acting for us;
- to professional advisers, auditors, insurers, investors, and transaction counterparties under appropriate duties;
- to authorities or other parties when reasonably necessary to comply with law, enforce rights, protect safety or security, or investigate abuse; and
- in connection with a merger, financing, reorganization, insolvency, or transfer of all or part of the business.

Public blockchains and independently operated protocols are not our processors and may use data for their own purposes. Before activation, Taskmarket must publish and maintain a service-provider register covering material authentication, wallet, cloud, database, storage, RPC, fiat-onramp, payment, email, security, analytics, and support providers, their purposes, and processing locations. [PRODUCT AND COUNSEL TO COMPLETE AND APPROVE THAT REGISTER.] We do not sell personal information for money. [COUNSEL TO CONFIRM WHETHER ANY ADVERTISING, ANALYTICS, ONCHAIN ENRICHMENT, OR PROVIDER ACTIVITY IS A "SALE," "SHARE," OR TARGETED ADVERTISING UNDER APPLICABLE US STATE LAW.]

## 5. International transfers

The Services and our providers may process information in countries other than yours. Before launch, Taskmarket will identify relevant origin and destination countries and, where required, use recognized transfer safeguards, perform transfer-risk assessments, and make required disclosures. Safeguards may include adequacy decisions, contractual clauses, or another lawful mechanism. Public blockchain data is globally accessible and cannot be limited to a selected processing location. [COUNSEL TO APPROVE THE INTERNATIONAL-TRANSFER MECHANISM AND COUNTRY DISCLOSURES.]

## 6. Retention and deletion

We retain information only for as long as reasonably needed for the purposes above, including the life of an account or marketplace position and an appropriate period afterward. We may retain acceptance evidence, transaction and accounting records, security logs, dispute materials, and compliance records for the applicable limitation, tax, anti-fraud, sanctions, or regulatory period. Retention depends on the data's sensitivity, purpose, legal requirements, and risk. Before activation, Taskmarket must adopt and implement a documented retention schedule.

[PRODUCT AND COUNSEL TO APPROVE A DOCUMENTED RETENTION SCHEDULE WITH A SPECIFIC PERIOD OR OBJECTIVE CRITERION FOR EACH DATA CATEGORY, INCLUDING ACCOUNTS, AUTHENTICATION, WALLET DATA, MARKETPLACE CONTENT, UPLOADS, ACCEPTANCE EVIDENCE, PAYMENT RECORDS, LOGS, SUPPORT, SCREENING, DISPUTES, AND BACKUPS.] When a period expires, we delete, de-identify, or securely isolate the information unless preservation is required by law, a legal hold, security investigation, or an unresolved position or dispute. Account deletion does not necessarily delete public content, records needed to complete or defend a transaction, or data outside our control. Public blockchain and content-addressed records may persist indefinitely.

## 7. Security and incident response

We use administrative, technical, and organizational measures designed to protect information, including access controls, encryption where appropriate, credential hashing, logging, environment separation, vendor review, backup controls, vulnerability management, and incident response proportionate to the risk. No system, wallet, transmission, or storage method is completely secure. You are responsible for securing your keys, devices, integrations, and agent instructions and for avoiding sensitive data in public fields.

We maintain a process to identify, contain, investigate, remediate, document, and learn from suspected breaches. Where a breach is an eligible data breach or otherwise legally notifiable, we will notify affected people and the competent regulator within the time and with the information required by applicable law. [PRODUCT AND COUNSEL TO APPROVE THE INCIDENT-RESPONSE PLAN, RESPONSIBLE CONTACTS, PROVIDER ESCALATIONS, AND JURISDICTION-SPECIFIC ASSESSMENT AND NOTIFICATION DEADLINES.]

## 8. Your choices and rights

Depending on where you live, you may have rights to access, correct, delete, restrict, object to, or receive a portable copy of personal information; withdraw consent; opt out of certain sale, sharing, profiling, or targeted advertising; and complain to a privacy or data-protection authority. You may also have a right not to be discriminated against for exercising a right.

Send requests to ${LEGAL_ENTITY.legalNoticeEmail}. We may verify your identity and authority, refuse or limit a request where permitted, and retain information that law or compelling legitimate interests require. If you use an authorized agent, we may require proof of authorization. We will respond within the period required by the law that applies to the request and explain applicable appeal rights. [COUNSEL AND PRODUCT TO DEFINE VERIFIED REQUEST INTAKE, SEARCH, EXPORT, CORRECTION, DELETION, RESTRICTION, OBJECTION, APPEAL, AND RECORDKEEPING PROCEDURES.] Requests cannot require us to alter a public blockchain or data controlled solely by another participant, but we will address offchain copies and links within our control as applicable law requires.

## 9. Cookies and tracking technologies

We and our authentication and infrastructure providers may use cookies, local storage, or similar technologies for login sessions, security, preferences, legal-acceptance receipts, and service operation. We will not deploy non-essential analytics, advertising, or cross-context tracking before obtaining consent where required. [PRODUCT AND COUNSEL TO COMPLETE A COOKIE AND SDK INVENTORY, IDENTIFY EACH PROVIDER, PURPOSE, DATA, DURATION, AND CLASSIFICATION, IMPLEMENT WITHDRAWAL AND REGION-SPECIFIC CONSENT CONTROLS, AND PUBLISH THE RESULTING COOKIE NOTICE BEFORE APPROVAL.]

## 10. Automated systems

We may use automated tools to detect abuse, prioritize security review, calculate public marketplace metrics, or screen activity. These tools may be inaccurate. Taskmarket does not intend to make solely automated decisions producing legal or similarly significant effects about individuals unless disclosed with safeguards required by law. Before using personal information for such a decision, Taskmarket will assess the system, document the information and decision types, provide any required explanation and human review, and publish disclosures required by applicable law. Marketplace participants control their own agents and evaluations and are independently responsible for their processing.

## 11. Children

The Services are not directed to children under 18, and we do not knowingly permit them to enter marketplace transactions. Contact us if you believe a child provided personal information so we can investigate and take appropriate action.

## 12. Third-party services

The Services may link to or interoperate with wallets, authentication providers, fiat onramps, payment facilitators, blockchains, storage networks, websites, and agents controlled by others. Their privacy practices are governed by their own notices, not this Policy. Taskmarket will use contracts and diligence required by applicable law for providers processing personal information on its behalf, but cannot control an independent participant, provider, or public network.

## 13. Accountability and privacy by design

Taskmarket will maintain records of material data flows, purposes, lawful bases where required, providers, transfers, retention, security controls, rights requests, and incidents. New features involving sensitive information, systematic monitoring, large-scale profiling, financial activity, agent evaluation, or other high risk will receive a privacy and legal assessment before launch. This Policy describes practices; it does not replace the internal procedures and systems required to comply with privacy law.

## 14. Changes

We may update this Policy. We will publish the new version and effective date and provide additional notice where required. If a change requires consent under law, we will request it separately. Material legal-bundle changes may require a fresh Taskmarket acknowledgement.

## 15. Contact and region-specific disclosures

- Privacy questions and requests: ${LEGAL_ENTITY.legalNoticeEmail}
- Postal address: ${LEGAL_ENTITY.registeredAddress}
- Representative or data protection officer: [INSERT IF REQUIRED]
- Relevant supervisory authority details: [INSERT AFTER JURISDICTION REVIEW]
- Region-specific rights, collection notices, financial incentives, and appeals: [INSERT FOR EACH LAUNCH JURISDICTION]
`,
};

const riskDisclosure: LegalDocument = {
  type: 'risk_disclosure',
  title: 'Risk Disclosure',
  slug: 'risks',
  version: VERSION,
  summary: 'Material technical, financial, marketplace, legal, and autonomous-agent risks.',
  markdown: `# Taskmarket Risk Disclosure

Version ${VERSION}

${POLICY_DATE_LINES}

${DRAFT_NOTICE}

Taskmarket involves experimental software, autonomous agents, public blockchains, smart contracts, cryptographic credentials, and digital assets. It is not suitable for every person or use case. This disclosure highlights material risks but cannot identify every risk. You should obtain independent legal, tax, financial, security, and technical advice appropriate to your circumstances.

## 1. Smart-contract and protocol risk

Smart contracts may contain defects, behave unexpectedly, be upgraded, pause, become unavailable, or be exploited. Transaction ordering, reorganization, congestion, gas pricing, RPC failures, chain forks, validator behavior, and dependencies may delay or change outcomes. A transaction shown as pending or successful in an interface may later fail or be reorganized. Code and onchain state, not a summary in the interface, determine protocol execution.

## 2. Irreversibility and loss

Blockchain signatures and transactions are generally irreversible. Funds sent to an incorrect address, network, contract, or task may be permanently lost. Deadlines can expire without notice, and a missed acceptance, appeal, evaluation, timeout, or withdrawal step may change who receives funds. Taskmarket may be technically unable to stop or reverse an executed transaction.

## 3. Stablecoin, token, and market risk

USDC and any reward token are issued or governed by third parties. They may deviate from their reference value, be frozen, blacklisted, upgraded, redeemed on changed terms, lose liquidity, or become illegal or unavailable in a jurisdiction. Token prices and exchange rates can move rapidly. A displayed fiat equivalent is not guaranteed. Gas sponsorship, facilitator availability, and fee levels may change.

## 4. Wallet and credential risk

Anyone who controls your private key, device key, session, API token, or agent runtime may act through it. Malware, phishing, prompt injection, compromised dependencies, insecure backups, exposed environment variables, or operator error can cause unauthorized tasks, signatures, disclosures, or loss. Embedded and external wallets have distinct custody and recovery models. Review them before use.

## 5. Autonomous-agent risk

Agents can hallucinate, misunderstand instructions, exceed authority, expose secrets, infringe rights, produce unsafe code, manipulate other agents, or take economically irrational actions. Agent outputs may be inaccurate, biased, malicious, or unsuitable for production. An agent can be induced by untrusted task content or files to disregard its operator's instructions. Apply least privilege, spending limits, sandboxing, monitoring, and human review proportionate to the impact.

## 6. Marketplace and counterparty risk

Participants may be anonymous, pseudonymous, unavailable, unqualified, or dishonest. Identity records, wallet history, rankings, and reputation signals can be incomplete, manipulated, or associated with a compromised key. A requester may provide unlawful or defective materials. A worker may submit plagiarized, insecure, or unusable work. Evaluation is subjective, and protocol dispute mechanisms may not provide a legally enforceable or satisfactory remedy.

## 7. Escrow and settlement risk

"Escrow" is a description of technical smart-contract conditions and does not guarantee legal trust, custody, deposit protection, chargeback rights, or recovery. Funds may be locked, split, released, refunded, or stranded according to contract state. Relayers and payment facilitators may reject, delay, or incorrectly process requests. The legal classification of a payment or facilitation activity can vary by jurisdiction and may impose obligations on Taskmarket or participants.

Fiat onramps, embedded wallets, stablecoin issuers, payment facilitators, RPC providers, and relayers may require identity checks, impose limits, decline a transaction, freeze an account or asset, reverse an offchain leg, become insolvent, or stop supporting a jurisdiction. Taskmarket may be unable to complete a transaction or recover value held or controlled by one of those providers.

## 8. Legal, regulatory, sanctions, and tax risk

Laws governing digital assets, money transmission, marketplaces, employment, digital platform work, consumer protection, sanctions, export controls, AI, privacy, intellectual property, and taxation are evolving and differ across jurisdictions. A regulator or court may restrict the Services, characterize Taskmarket or a participant differently from these documents, require licensing, registration, employment benefits, refunds, disclosures, reporting, or tax withholding, invalidate a contract term, or order assets or access blocked. Sanctions and fraud screening may produce false positives, delay lawful activity, or fail to identify prohibited activity. You remain responsible for your own compliance and taxes, but this does not transfer a legal obligation that applicable law places on Taskmarket.

## 9. Data and confidentiality risk

Public blockchain records and content-addressed data may be permanent, globally visible, and correlated with your identity. Encryption may be implemented incorrectly or later weakened. Files and agent outputs may contain malware, personal information, confidential material, or hidden instructions. Never assume a task, message, proof, hash, or submission is private merely because the interface does not prominently display it.

## 10. Availability and change risk

The Services may experience downtime, data loss, rate limits, discontinued features, incompatible updates, or third-party failures. Open-source software may change without notice. Taskmarket may restrict a region, wallet, task, or action for legal or security reasons. Exit functions can depend on current protocol state and are not guaranteed to remain available in every circumstance.

## 11. No advice or guarantee

Information, metrics, rankings, examples, documentation, and agent-generated content are not legal, tax, financial, investment, cybersecurity, or professional advice. Taskmarket does not recommend a participant, task, token, strategy, or output and does not guarantee profit, payment, quality, compliance, recovery, or fitness for purpose.

## 12. Acknowledgement

By acknowledging this Risk Disclosure, you confirm that you understand that you can lose funds, data, rights, time, and access; that autonomous and blockchain systems may fail; that counterparties may not perform; and that you are able to bear the risks of the activities you authorize. An acknowledgement is not a waiver of rights that cannot lawfully be waived.
`,
};

const acceptableUsePolicy: LegalDocument = {
  type: 'acceptable_use_policy',
  title: 'Acceptable Use Policy',
  slug: 'acceptable-use',
  version: VERSION,
  summary: 'Rules protecting people, systems, markets, and the lawful operation of Taskmarket.',
  markdown: `# Taskmarket Acceptable Use Policy

Version ${VERSION}

${POLICY_DATE_LINES}

${DRAFT_NOTICE}

This Acceptable Use Policy (the "AUP") forms part of the Taskmarket Terms of Service. It applies to every user, operator, requester, worker, evaluator, resolver, integration, and autonomous agent using the Services. You are responsible for configuring and supervising your agents so that they comply.

## 1. Illegal and regulated activity

You may not use Taskmarket to request, facilitate, conceal, promote, or perform activity that violates applicable law. This includes money laundering, terrorist financing, sanctions evasion, bribery, fraud, trafficking, illegal gambling, unlicensed financial services, unlawful securities activity, tax evasion, or trade in prohibited goods or services. You may not transact with a blocked person or for a prohibited jurisdiction or purpose.

Do not offer regulated legal, medical, financial, employment, credit, housing, insurance, or other high-impact services unless every required authorization, professional duty, disclosure, safeguard, and human review is in place.

You must provide accurate information and reasonably cooperate with lawful identity, age, trader-status, source-of-funds, wallet or counterparty screening, sanctions, export-control, fraud, tax, or licensing checks. You may not structure activity, use another wallet or agent, conceal a principal or beneficiary, or route through a third party to evade a restriction, reporting duty, or compliance control.

## 2. Harm, exploitation, and dangerous services

You may not create or accept tasks that facilitate violence, abuse, exploitation, stalking, extortion, doxxing, non-consensual intimate content, child sexual abuse material, human trafficking, or credible threats. You may not develop biological, chemical, radiological, nuclear, or weapons capabilities intended to cause harm, or provide operational instructions that materially enable such harm.

## 3. Cybersecurity abuse

You may perform security research only with clear authorization and within the authorized scope. You may not deploy malware or ransomware; steal credentials or tokens; conduct phishing, credential stuffing, denial-of-service, destructive exploitation, botnet activity, unauthorized access, covert persistence, data exfiltration, or supply-chain compromise; or evade security controls. Proof-of-concept work must be contained and must not expose unrelated systems or data.

## 4. Privacy, surveillance, and identity

You may not unlawfully collect, infer, buy, sell, expose, or process personal information; conduct covert surveillance; identify an anonymous person without a lawful basis; create deceptive biometric or identity systems; impersonate another person; or submit confidential, privileged, health, financial, authentication, or government-identifier data without authority and appropriate safeguards.

## 5. Intellectual property and deceptive content

You may not infringe intellectual-property, confidentiality, publicity, database, or contractual rights; submit plagiarized work; remove provenance or rights information; create deceptive endorsements; or falsely represent the source, authorship, testing, security, or capabilities of an output. Synthetic or modified media must be disclosed where non-disclosure would mislead or violate law.

An intellectual-property complaint must identify the protected work or right, the challenged material, the complainant's authority, contact details, a good-faith basis, and any statement required by applicable law. Affected users may submit a counter-notice where available. False, abusive, or retaliatory complaints violate this AUP. [COUNSEL TO DEFINE THE DESIGNATED CONTACT, REPEAT-INFRINGER STANDARD, COUNTER-NOTICE PROCESS, RESTORATION TIMELINE, AND JURISDICTION-SPECIFIC FORMALITIES.]

## 6. Market and platform integrity

You may not manipulate ratings, bids, rankings, disputes, rewards, identities, task outcomes, or token markets; collude to extract rewards; create sham tasks or submissions; use multiple identities to evade controls; exploit another participant's mistake in bad faith; spam; scrape in a way that degrades the Services; bypass rate limits or access controls; probe secrets; or interfere with Taskmarket, its smart contracts, relayers, facilitators, communications, or other users.

You may not submit a task or file whose primary purpose is to prompt-inject, deceive, compromise, or redirect an agent outside the disclosed task. Security testing of agent defenses requires explicit scope and containment.

## 7. Resource and communications abuse

Do not send unsolicited bulk messages, deceptive email, malicious attachments, or communications that violate anti-spam or marketing laws. Do not consume disproportionate infrastructure, automate abusive retries, or use the Services to mine cryptocurrency or proxy unrelated traffic without written authorization.

## 8. Required safeguards

You must use permissions and data proportionate to the task; disclose material constraints and hazards; validate inputs and outputs; protect credentials; inspect third-party files; maintain lawful records; stop an agent that behaves unexpectedly; and provide human oversight for high-impact or irreversible actions. If you discover a vulnerability, avoid unnecessary access or harm and report it to ${LEGAL_ENTITY.legalNoticeEmail}.

## 9. Enforcement, reporting, and appeals

We may investigate, preserve evidence, remove content, reject relaying, rate-limit, suspend credentials, restrict wallets or regions, notify affected parties, or report conduct to service providers or authorities. We may act on reasonable risk indicators without first proving a legal violation. Where feasible and lawful, enforcement will be calibrated to the risk and will not intentionally prevent designated withdrawal, refund, cancellation, data-access, deletion, or logout functions needed to protect existing rights.

You must cooperate with reasonable investigations and must not retaliate against a reporter. Evasion or attempted evasion is a separate violation.

Report suspected violations to ${LEGAL_ENTITY.legalNoticeEmail} with the relevant task, wallet, transaction, message, and supporting facts. Do not include unnecessary sensitive data. [COUNSEL AND PRODUCT TO DEFINE AN ENFORCEMENT APPEAL PROCESS, RESPONSE TARGETS, AND REQUIRED ILLEGAL-CONTENT REPORTING CHANNELS FOR EACH LAUNCH JURISDICTION.]

Unless immediate action or legal restrictions prevent it, Taskmarket will provide the affected person with the nature and basis of a material restriction and access to a notice and appeal process. Review will be performed by a person or system with appropriate independence and authority, and the outcome and available external escalation will be communicated where required. [COUNSEL AND PRODUCT TO DEFINE NOTICE CONTENT, ENFORCEMENT LEVELS, PRESERVATION RULES, REVIEW INDEPENDENCE, RESPONSE TARGETS, REPEAT-VIOLATION RULES, EXTERNAL REDRESS, TRANSPARENCY REPORTING, AND REQUIRED ILLEGAL-CONTENT CHANNELS FOR EACH LAUNCH JURISDICTION.]
`,
};

export const CURRENT_LEGAL_BUNDLE = {
  version: VERSION,
  status: 'draft' as LegalCopyStatus,
  publishedAt: PUBLISHED_AT,
  effectiveAt: EFFECTIVE_AT,
  documents: [termsOfService, privacyPolicy, riskDisclosure, acceptableUsePolicy],
} as const satisfies LegalPolicyBundle;

// Canonical acceptance URLs are permanent. Before replacing the current bundle,
// retain its exact immutable definition in this registry as a named historical bundle.
export const LEGAL_BUNDLES: readonly LegalPolicyBundle[] = [CURRENT_LEGAL_BUNDLE];

export function getLegalBundleActivationIssues(
  bundle: LegalPolicyBundle,
  legalEntity: Readonly<Record<string, string>> = LEGAL_ENTITY
): string[] {
  const issues: string[] = [];
  if (bundle.status !== 'approved') {
    issues.push('bundle status is not approved');
  }
  if (!bundle.effectiveAt) {
    issues.push('effective date is missing');
  } else if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(bundle.effectiveAt) ||
    Number.isNaN(Date.parse(bundle.effectiveAt))
  ) {
    issues.push('effective date is invalid');
  }
  if (bundle.version.toLowerCase().includes('draft')) {
    issues.push('bundle version is still marked draft');
  }
  if (Object.values(legalEntity).some((value) => /^\[[^\]]+\]$/.test(value))) {
    issues.push('contracting entity details contain placeholders');
  }
  if (
    bundle.documents.some((document) => /\bdraft\b|not approved or active/i.test(document.markdown))
  ) {
    issues.push('policy copy still contains draft markers');
  }
  if (
    bundle.documents.some((document) =>
      /\[[^\]\n]*\b(?:APPROVED|COUNSEL|FORUM|GOVERNING|INSERT|JURISDICTION|LIABILITY|PRODUCT|REGISTERED|REQUIRED)\b[^\]\n]*\]/.test(
        document.markdown
      )
    )
  ) {
    issues.push('policy copy contains counsel or product placeholders');
  }
  return issues;
}

export function getCurrentLegalBundleActivationIssues(): string[] {
  return getLegalBundleActivationIssues(CURRENT_LEGAL_BUNDLE);
}

export function isCurrentLegalBundleActivationReady(): boolean {
  return getCurrentLegalBundleActivationIssues().length === 0;
}

export function buildWalletLegalAcceptanceMessage(input: {
  walletAddress: string;
  bundleVersion: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  documents: readonly LegalDocumentEvidence[];
}): string {
  const documentLines = input.documents
    .map((document) => `- ${document.title} (${document.version}): ${document.contentHash}`)
    .join('\n');

  return `Taskmarket legal acceptance\n\nWallet: ${input.walletAddress}\nBundle: ${input.bundleVersion}\nIssued at: ${input.issuedAt}\nExpires at: ${input.expiresAt}\nNonce: ${input.nonce}\n\nDocuments:\n${documentLines}\n\n${LEGAL_ACCEPTANCE_STATEMENT}`;
}
