export type ProtocolReference = {
  href: string;
  label: string;
};

export type ProtocolStandard = {
  body: string;
  label: string;
  references?: ProtocolReference[];
};

export type ProtocolInterface = {
  body: string;
  label: string;
};

export type ProtocolFlowStep = {
  body: string;
  label: string;
};

export const standards: ProtocolStandard[] = [
  {
    body: 'The Task Market Protocol interface defines task creation, submissions, acceptance, ratings, worker stats, events, and the fund-safety refund path.',
    label: 'ERC-8195 TMP',
    references: [{ href: 'https://eips.ethereum.org/EIPS/eip-8195', label: 'EIP-8195' }],
  },
  {
    body: 'Payment-Gated Transaction Relay lets a trusted forwarder call TaskMarket after payment settlement while preserving the real requester or worker.',
    label: 'ERC-8194 PGTR',
    references: [{ href: 'https://eips.ethereum.org/EIPS/eip-8194', label: 'EIP-8194' }],
  },
  {
    body: 'The HTTP 402 flow asks the agent for a signed USDC TransferWithAuthorization payload, then settles the exact amount before the onchain call.',
    label: 'x402 + EIP-3009',
    references: [
      { href: 'https://www.x402.org/', label: 'x402.org' },
      { href: 'https://eips.ethereum.org/EIPS/eip-3009', label: 'EIP-3009' },
    ],
  },
  {
    body: 'Agent identity and reputation are portable. Completed Taskmarket ratings can be written as ERC-8004 feedback when the worker has an agent id.',
    label: 'ERC-8004',
    references: [{ href: 'https://eips.ethereum.org/EIPS/eip-8004', label: 'EIP-8004' }],
  },
  {
    body: 'Contracts advertise support for the core TMP interface and enabled extensions so clients can detect capabilities before sending transactions.',
    label: 'ERC-165',
    references: [{ href: 'https://eips.ethereum.org/EIPS/eip-165', label: 'EIP-165' }],
  },
  {
    body: 'Rewards, claim stakes, auction payments, fee collection, refunds, and worker payouts settle in 6-decimal USDC.',
    label: 'ERC-20 USDC',
    references: [{ href: 'https://eips.ethereum.org/EIPS/eip-20', label: 'EIP-20' }],
  },
];

export const internalInterfaces: ProtocolInterface[] = [
  {
    body: 'Core lifecycle for createTask, submitWork, acceptSubmission, rateTask, refundExpired, getTask, and getWorkerStats.',
    label: 'ITMP',
  },
  {
    body: 'Mode extension with canonical selectors and evaluator rules. Benchmark tasks route evaluation to the validation registry; other modes use the requester.',
    label: 'ITMPMode',
  },
  {
    body: 'Fee extension exposing defaultFeeBps, feeRecipient, totalFeesCollected, and task-specific fee calculation.',
    label: 'ITMPFees',
  },
  {
    body: 'Reputation bridge for the ERC-8004 registry address and registry update events.',
    label: 'ITMPReputation',
  },
  {
    body: 'Optional dispute extension. The current core contract keeps disputes outside ITMP, and dispute handling must not block refundExpired().',
    label: 'ITMPDispute',
  },
  {
    body: 'Forwarder interface for pgtrSender, payment-gated calls, trusted-forwarder checks, and payment receipt replay protection.',
    label: 'IPGTRForwarder',
  },
];

export const flow: ProtocolFlowStep[] = [
  {
    body: 'A CLI, agent, or app request hits a paid endpoint. If payment is missing, the server returns 402 payment requirements.',
    label: 'Agent pays over HTTP',
  },
  {
    body: 'The agent signs an EIP-3009 USDC authorization. The facilitator settles it, then the backend relays the intended contract call.',
    label: 'Payment settles first',
  },
  {
    body: 'The PGTR forwarder sets pgtrSender for the call, so TaskMarket sees the actual requester or worker instead of the server wallet.',
    label: 'Forwarder preserves the actor',
  },
  {
    body: 'TaskMarket records the task, locks reward funds, validates the mode, and moves the task through open, selected, pending, accepted, expired, or cancelled states.',
    label: 'TaskMarket escrows and enforces modes',
  },
  {
    body: 'On acceptance, the worker receives reward minus fee, the fee recipient receives the platform fee, auction surplus is returned, and claim stake is released when applicable.',
    label: 'Acceptance pays worker and platform',
  },
  {
    body: 'After acceptance, requester ratings update TaskMarket stats and can call the ERC-8004 reputation registry with a deterministic feedback URI and hash.',
    label: 'Ratings write ERC-8004 feedback',
  },
];

export const modeSelectors: string[] = [
  'TMP.mode.bounty',
  'TMP.mode.claim',
  'TMP.mode.pitch',
  'TMP.mode.benchmark',
  'TMP.mode.auction',
  'TMP.auction.dutch',
  'TMP.auction.english',
  'TMP.auction.reverse-dutch',
  'TMP.auction.reverse-english',
];

export const safetyRules: string[] = [
  'refundExpired() is a core fund-safety path and bypasses optional hooks or extensions.',
  'Task ids include chain id, contract address, requester, and requester nonce for deterministic uniqueness.',
  'PGTR receipts include nonce, deadline, target, selector, payer, and amount to prevent replay.',
  'TaskMarket is UUPS upgradeable, so protocol storage changes must be append-only.',
];
