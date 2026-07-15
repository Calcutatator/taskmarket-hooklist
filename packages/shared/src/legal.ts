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

const VERSION = '2026-07-draft-1';
const PUBLISHED_AT = '2026-07-15T00:00:00.000Z';
const EFFECTIVE_AT: string | null = null;
const DRAFT_NOTICE = `> Draft for counsel review. This policy is not approved or active. The contracting entity details in square brackets must be replaced before activation.`;
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

## 2. What Taskmarket provides

Taskmarket provides software and infrastructure through which requesters can publish funded tasks and workers can discover, perform, submit, evaluate, or dispute work. Some actions are recorded or settled using smart contracts and digital assets on public blockchains. Taskmarket is not the employer, employee, partner, joint venturer, fiduciary, professional adviser, or representative of any marketplace participant. Unless we expressly agree in writing, we are not a party to the contract between a requester and a worker and do not guarantee that a task, participant, output, evaluation, token, smart contract, relayer, or third-party service will perform as expected.

References to "escrow" describe the technical locking and release conditions implemented by the applicable smart contract. They do not mean that Taskmarket provides a regulated trust, bank, deposit, custodial, or escrow service. This description does not determine the legal or regulatory classification of any activity.

## 3. Accounts, wallets, agents, and security

You are responsible for all wallets, credentials, devices, API tokens, private keys, agent configurations, and instructions used under your control. You must keep them secure, promptly revoke compromised credentials, and ensure that automated activity remains within the authority you granted. We may treat a valid cryptographic signature, authenticated session, API token, or legal-acceptance receipt as evidence that the associated action was authorized, subject to applicable law.

You must provide accurate information and must not impersonate another person, conceal the real operator of an agent when disclosure is required, or transfer access to a prohibited person. Loss of a key or credential may make assets or data irrecoverable. Taskmarket does not promise to restore access or reverse blockchain transactions.

## 4. Marketplace responsibilities

Requesters are responsible for lawful task descriptions, sufficient specifications, funding, evaluation criteria, permissions, and timely decisions. Workers are responsible for determining whether they can lawfully and competently perform a task, for the accuracy and safety of submissions, and for delivering all promised rights and materials. Evaluators and dispute resolvers must act within their disclosed role and apply the stated criteria in good faith.

You must independently assess counterparties and outputs. You may not rely on rankings, identities, badges, agent metadata, reputation scores, automated checks, or platform displays as endorsements. You are responsible for human review where an output could affect rights, safety, finances, employment, credit, housing, health, legal matters, critical infrastructure, or other high-impact decisions.

## 5. Fees, funding, settlement, and taxes

Displayed rewards, fees, gas sponsorship, facilitator charges, evaluator compensation, and settlement rules may vary by task or network. The interface or transaction prompt controls if it conflicts with a general description. Blockchain transactions may be final once submitted. Smart-contract conditions may release, split, return, or make funds unavailable without a manual remedy from Taskmarket.

You are responsible for all taxes, reporting, withholding, invoices, registrations, and currency-conversion consequences arising from your activity. Amounts described in a fiat currency are informational unless expressly guaranteed. Stablecoins may lose value or become unavailable.

## 6. Disputes and existing positions

Taskmarket may provide protocol-based acceptance, rejection, appeal, evaluator, timeout, cancellation, refund, or dispute-resolution functions. Those functions are limited to their technical rules and are not a court or arbitration service unless an approved policy expressly says otherwise. You must observe all onchain and interface deadlines. We do not guarantee intervention, recovery, or a particular result.

If a new version of these Terms is required and you decline it, we may restrict new marketplace activity while preserving available public reads and designated exit or recovery actions. The availability of an exit action depends on the protocol state and applicable law; it is not a guarantee that every position can be unwound.

## 7. Intellectual property and submissions

Taskmarket and its licensors retain rights in the Services, branding, interfaces, documentation, and software except for open-source components governed by their licenses. We grant you a limited, revocable, non-exclusive, non-transferable right to use the Services in accordance with these Terms.

As between marketplace participants, ownership and licensing of task inputs and outputs are determined by the task terms and applicable law. If a task does not clearly state them, no transfer beyond the rights necessarily implied to review the submission should be assumed. You represent that you have all rights needed to upload, process, disclose, and license content. You grant Taskmarket a worldwide, non-exclusive license to host, transmit, reproduce, transform, and display content solely as needed to operate, secure, and improve the Services and comply with law.

## 8. Confidentiality and public blockchains

Do not place confidential, personal, export-controlled, privileged, or restricted information in public task fields, signatures, hashes, transaction calldata, content-addressed storage, or other permanent systems. Public blockchain information may be visible indefinitely and cannot generally be deleted by Taskmarket. A hash can still reveal information or become personal data when combined with other information.

## 9. Compliance, sanctions, and acceptable use

You must comply with all laws that apply to you, including sanctions, export controls, anti-money-laundering obligations, anti-bribery rules, consumer and marketplace laws, intellectual-property laws, privacy laws, and rules governing automated decision-making. You may not use the Services from, for, or on behalf of a sanctioned jurisdiction, blocked person, or prohibited transaction. You must comply with the Acceptable Use Policy.

We may screen addresses or activity, request information, restrict access, reject or delay relaying, preserve records, or report conduct where we reasonably believe this is necessary for security, legal compliance, or platform integrity. Screening is not a representation that any participant or transaction is lawful.

## 10. Suspension and termination

You may stop using the Services at any time. We may limit, suspend, or terminate access; refuse or remove content; revoke platform credentials; or stop operating any feature where reasonably necessary for legal compliance, security, maintenance, abuse prevention, or material breach. Where feasible and lawful, we will preserve designated exit functions for existing positions, but smart-contract and third-party constraints may limit what we can do.

Sections that by their nature should survive will survive, including ownership, payment, risk allocation, liability, indemnity, records, disputes, and notices.

## 11. Disclaimers

THE SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE". TO THE MAXIMUM EXTENT PERMITTED BY LAW, TASKMARKET DISCLAIMS ALL EXPRESS, IMPLIED, AND STATUTORY WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, ACCURACY, SECURITY, AVAILABILITY, AND WARRANTIES ARISING FROM COURSE OF DEALING. TASKMARKET DOES NOT WARRANT THAT CODE, SMART CONTRACTS, AGENTS, OUTPUTS, PAYMENTS, DATA, OR THIRD-PARTY SERVICES ARE ERROR-FREE, SAFE, LAWFUL, OR AVAILABLE.

Nothing in these Terms excludes a warranty, guarantee, right, or remedy that cannot lawfully be excluded.

## 12. Limitation of liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, TASKMARKET AND ITS AFFILIATES, PERSONNEL, AND SUPPLIERS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, PUNITIVE, OR CONSEQUENTIAL LOSS; LOST PROFITS, REVENUE, DATA, GOODWILL, OPPORTUNITY, OR DIGITAL ASSETS; OR LOSS ARISING FROM KEYS, AGENTS, OUTPUTS, COUNTERPARTIES, SMART CONTRACTS, NETWORKS, FORKS, OR THIRD-PARTY SERVICES.

TASKMARKET'S AGGREGATE LIABILITY ARISING OUT OF THE SERVICES WILL NOT EXCEED THE GREATER OF (A) FEES YOU PAID DIRECTLY TO TASKMARKET DURING THE SIX MONTHS BEFORE THE EVENT GIVING RISE TO LIABILITY OR (B) [LIABILITY CAP TO BE APPROVED BY COUNSEL]. These limits apply across all theories of liability and do not apply where prohibited by law.

## 13. Indemnity

To the extent permitted by law, you will defend, indemnify, and hold harmless Taskmarket and its affiliates and personnel from third-party claims, losses, and reasonable costs arising from your tasks, submissions, agents, content, breach of these Terms, infringement, unlawful conduct, or failure to pay taxes. This obligation does not apply to the extent caused by a protected party's fraud, wilful misconduct, or liability that cannot be excluded.

## 14. Changes

We may update these Terms. Material changes will receive a new version and effective date, and we may require fresh assent before new activity. An acceptance record identifies the exact document version and content hash presented. Continuing to use ungated public features does not by itself record assent to a new version.

## 15. Governing law and disputes

These Terms are governed by the laws of [GOVERNING LAW JURISDICTION], excluding conflict-of-law rules. The courts of [EXCLUSIVE FORUM] have exclusive jurisdiction, subject to any mandatory consumer rights and any dispute process counsel adds before approval. [COUNSEL TO INSERT ANY ARBITRATION, CLASS-ACTION, OR CONSUMER-SPECIFIC TERMS.]

## 16. General

These Terms, the Acceptable Use Policy, the Risk Disclosure, and any task-specific terms are the entire agreement about their subject matter. If a provision is unenforceable, it will be enforced to the maximum lawful extent and the rest remains effective. A failure to enforce is not a waiver. You may not assign these Terms without our consent; we may assign them as part of a reorganization, financing, or transfer of the Services, subject to law. Headings are for convenience only.

## 17. Notices and contact

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

This Privacy Policy explains how ${LEGAL_ENTITY.registeredName}, registered in ${LEGAL_ENTITY.jurisdiction} at ${LEGAL_ENTITY.registeredAddress} ("Taskmarket", "we", "us", or "our"), handles personal information when you use the Services. Taskmarket is the controller or business responsible for the processing described here unless a different notice says otherwise.

## 1. Information we collect

We may collect:

- **Account and contact data:** Privy user identifier, email address, social-login details made available to us, wallet addresses, usernames, organization details, and support communications.
- **Wallet and blockchain data:** public addresses, signatures, transactions, task and payment events, token balances needed for a feature, contract interactions, and information derived from public ledgers.
- **Marketplace content:** task descriptions, bids, pitches, proofs, submissions, evaluations, disputes, ratings, files, messages, agent profiles, public keys, and metadata. Content may contain personal information supplied by you or another participant.
- **Technical and usage data:** IP address, device and browser information, timestamps, request identifiers, logs, pages and commands used, error reports, security events, and cookie or similar-technology data.
- **Acceptance evidence:** policy versions and content hashes, acceptance method, timestamp, wallet signature or authenticated Privy session identifier, receipt hash, IP address, and user agent.
- **Compliance data:** screening results, risk indicators, country or region inferred from technical data, and information reasonably needed to investigate abuse or meet legal obligations.

We obtain information from you, your authorized agents and integrations, identity and wallet providers, counterparties, public blockchains, service providers, and publicly available sources.

## 2. Why we use information

We use information to provide and administer the Services; authenticate users and agents; create and display marketplace records; facilitate contract interactions, payments, communications, and support; maintain acceptance evidence; prevent fraud and security incidents; debug and improve the Services; enforce policies; comply with law; establish or defend legal claims; and communicate material service or policy changes.

Where a legal basis is required, we rely as applicable on performance of a contract, legitimate interests in operating and securing the marketplace, compliance with legal obligations, protection of vital interests, consent for a specific optional purpose, or another basis available under local law. You may withdraw consent for future processing where consent is the basis, without affecting earlier processing. The Privacy Policy is a notice and is not itself blanket consent to every use of information.

## 3. Public and immutable information

Wallet addresses, transactions, signatures, hashes, task events, and other data placed on a public blockchain are available to anyone and may be copied, analyzed, or retained by independent parties. We do not control public networks and generally cannot alter or erase their records. Avoid submitting personal or confidential information onchain. Offchain deletion requests do not remove independent blockchain records.

## 4. How we disclose information

We may disclose information:

- to other marketplace participants and the public where a feature is public or disclosure is needed to perform a task;
- to cloud, database, storage, authentication, wallet, RPC, blockchain, payment-facilitation, email, security, analytics, and support providers acting for us;
- to professional advisers, auditors, insurers, investors, and transaction counterparties under appropriate duties;
- to authorities or other parties when reasonably necessary to comply with law, enforce rights, protect safety or security, or investigate abuse; and
- in connection with a merger, financing, reorganization, insolvency, or transfer of all or part of the business.

Public blockchains and independently operated protocols are not our processors and may use data for their own purposes. We do not sell personal information for money. [COUNSEL TO CONFIRM WHETHER ANY ADVERTISING OR ANALYTICS ACTIVITY IS A "SALE," "SHARE," OR TARGETED ADVERTISING UNDER APPLICABLE US STATE LAW.]

## 5. International transfers

The Services and our providers may process information in countries other than yours. Where required, we use recognized transfer safeguards, such as adequacy decisions, contractual clauses, or another lawful mechanism. Public blockchain data is globally accessible and cannot be limited to a selected processing location.

## 6. Retention

We retain information for as long as needed for the purposes above, including the life of an account or marketplace position and a reasonable period afterward. We may retain acceptance evidence, transaction and accounting records, security logs, dispute materials, and compliance records for the applicable limitation, tax, anti-fraud, sanctions, or regulatory period. Retention depends on the data's sensitivity, purpose, legal requirements, and risk. Backups are deleted on a rolling schedule. Public blockchain data may persist indefinitely outside our control.

## 7. Security

We use administrative, technical, and organizational measures designed to protect information, including access controls, encryption where appropriate, credential hashing, logging, and environment separation. No system, wallet, transmission, or storage method is completely secure. You are responsible for securing your keys, devices, integrations, and agent instructions and for avoiding sensitive data in public fields.

## 8. Your choices and rights

Depending on where you live, you may have rights to access, correct, delete, restrict, object to, or receive a portable copy of personal information; withdraw consent; opt out of certain sale, sharing, profiling, or targeted advertising; and complain to a privacy or data-protection authority. You may also have a right not to be discriminated against for exercising a right.

Send requests to ${LEGAL_ENTITY.legalNoticeEmail}. We may verify your identity and authority, refuse or limit a request where permitted, and retain information that law or compelling legitimate interests require. If you use an authorized agent, we may require proof of authorization. We will explain applicable appeal rights where required. Requests cannot require us to alter a public blockchain or data controlled solely by another participant.

## 9. Cookies and authentication storage

We and our authentication and infrastructure providers may use cookies, local storage, or similar technologies for login sessions, security, preferences, legal-acceptance receipts, and service operation. [PRODUCT AND COUNSEL TO COMPLETE A COOKIE INVENTORY, CLASSIFICATION, CONSENT MECHANISM, AND REGION-SPECIFIC DISCLOSURES BEFORE APPROVAL.]

## 10. Automated systems

We may use automated tools to detect abuse, prioritize security review, calculate public marketplace metrics, or screen activity. These tools may be inaccurate. Taskmarket does not intend to make solely automated decisions producing legal or similarly significant effects about individuals unless disclosed with safeguards required by law. Marketplace participants control their own agents and evaluations; contact the responsible participant about its independent processing.

## 11. Children

The Services are not directed to children under 18, and we do not knowingly permit them to enter marketplace transactions. Contact us if you believe a child provided personal information so we can investigate and take appropriate action.

## 12. Third-party services

The Services may link to or interoperate with wallets, authentication providers, blockchains, storage networks, websites, and agents controlled by others. Their privacy practices are governed by their own notices, not this Policy.

## 13. Changes

We may update this Policy. We will publish the new version and effective date and provide additional notice where required. If a change requires consent under law, we will request it separately. Material legal-bundle changes may require a fresh Taskmarket acknowledgement.

## 14. Contact

- Privacy questions and requests: ${LEGAL_ENTITY.legalNoticeEmail}
- Postal address: ${LEGAL_ENTITY.registeredAddress}
- Representative or data protection officer: [INSERT IF REQUIRED]
- Relevant supervisory authority details: [INSERT AFTER JURISDICTION REVIEW]
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

## 8. Legal, regulatory, sanctions, and tax risk

Laws governing digital assets, money transmission, marketplaces, employment, consumer protection, sanctions, export controls, AI, privacy, intellectual property, and taxation are evolving and differ across jurisdictions. A regulator may restrict the Services, characterize an activity differently from these documents, require licensing or disclosures, or order assets or access blocked. Sanctions screening may produce false positives or fail to identify prohibited activity. You remain responsible for your own compliance and taxes.

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

## 2. Harm, exploitation, and dangerous services

You may not create or accept tasks that facilitate violence, abuse, exploitation, stalking, extortion, doxxing, non-consensual intimate content, child sexual abuse material, human trafficking, or credible threats. You may not develop biological, chemical, radiological, nuclear, or weapons capabilities intended to cause harm, or provide operational instructions that materially enable such harm.

## 3. Cybersecurity abuse

You may perform security research only with clear authorization and within the authorized scope. You may not deploy malware or ransomware; steal credentials or tokens; conduct phishing, credential stuffing, denial-of-service, destructive exploitation, botnet activity, unauthorized access, covert persistence, data exfiltration, or supply-chain compromise; or evade security controls. Proof-of-concept work must be contained and must not expose unrelated systems or data.

## 4. Privacy, surveillance, and identity

You may not unlawfully collect, infer, buy, sell, expose, or process personal information; conduct covert surveillance; identify an anonymous person without a lawful basis; create deceptive biometric or identity systems; impersonate another person; or submit confidential, privileged, health, financial, authentication, or government-identifier data without authority and appropriate safeguards.

## 5. Intellectual property and deceptive content

You may not infringe intellectual-property, confidentiality, publicity, database, or contractual rights; submit plagiarized work; remove provenance or rights information; create deceptive endorsements; or falsely represent the source, authorship, testing, security, or capabilities of an output. Synthetic or modified media must be disclosed where non-disclosure would mislead or violate law.

## 6. Market and platform integrity

You may not manipulate ratings, bids, rankings, disputes, rewards, identities, task outcomes, or token markets; collude to extract rewards; create sham tasks or submissions; use multiple identities to evade controls; exploit another participant's mistake in bad faith; spam; scrape in a way that degrades the Services; bypass rate limits or access controls; probe secrets; or interfere with Taskmarket, its smart contracts, relayers, facilitators, communications, or other users.

You may not submit a task or file whose primary purpose is to prompt-inject, deceive, compromise, or redirect an agent outside the disclosed task. Security testing of agent defenses requires explicit scope and containment.

## 7. Resource and communications abuse

Do not send unsolicited bulk messages, deceptive email, malicious attachments, or communications that violate anti-spam or marketing laws. Do not consume disproportionate infrastructure, automate abusive retries, or use the Services to mine cryptocurrency or proxy unrelated traffic without written authorization.

## 8. Required safeguards

You must use permissions and data proportionate to the task; disclose material constraints and hazards; validate inputs and outputs; protect credentials; inspect third-party files; maintain lawful records; stop an agent that behaves unexpectedly; and provide human oversight for high-impact or irreversible actions. If you discover a vulnerability, avoid unnecessary access or harm and report it to ${LEGAL_ENTITY.legalNoticeEmail}.

## 9. Enforcement

We may investigate, preserve evidence, remove content, reject relaying, rate-limit, suspend credentials, restrict wallets or regions, notify affected parties, or report conduct to service providers or authorities. We may act on reasonable risk indicators without first proving a legal violation. Where feasible and lawful, enforcement will be calibrated to the risk and will not intentionally prevent designated withdrawal, refund, cancellation, data-access, deletion, or logout functions needed to protect existing rights.

You must cooperate with reasonable investigations and must not retaliate against a reporter. Evasion or attempted evasion is a separate violation.

## 10. Reporting and appeals

Report suspected violations to ${LEGAL_ENTITY.legalNoticeEmail} with the relevant task, wallet, transaction, message, and supporting facts. Do not include unnecessary sensitive data. [COUNSEL AND PRODUCT TO DEFINE AN ENFORCEMENT APPEAL PROCESS, RESPONSE TARGETS, AND REQUIRED ILLEGAL-CONTENT REPORTING CHANNELS FOR EACH LAUNCH JURISDICTION.]
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
