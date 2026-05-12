import {
  pgTable,
  text,
  integer,
  timestamp,
  bigint,
  smallint,
  index,
  uniqueIndex,
  numeric,
  serial,
  unique,
} from 'drizzle-orm/pg-core';

export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    requester: text('requester').notNull(),
    requesterPubkey: text('requester_pubkey').notNull(),
    description: text('description').notNull(),
    reward: numeric('reward', { precision: 78, scale: 0 }).notNull(),
    escrowTxHash: text('escrow_tx_hash').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiryTime: timestamp('expiry_time').notNull(),
    status: text('status').notNull(),
    tags: text('tags').array().notNull(),
    worker: text('worker'),
    rating: smallint('rating'),
    mode: text('mode').notNull().default('bounty'),
    stakeRequired: integer('stake_required').notNull().default(0),
    stakeBps: smallint('stake_bps').notNull().default(0),
    pitchDeadline: timestamp('pitch_deadline'),
    bidDeadline: timestamp('bid_deadline'),
    maxPrice: numeric('max_price', { precision: 78, scale: 0 }),
    auctionType: text('auction_type'),
    auctionStartPrice: numeric('auction_start_price', { precision: 78, scale: 0 }),
    auctionFloorPrice: numeric('auction_floor_price', { precision: 78, scale: 0 }),
    metricDescription: text('metric_description'),
    metricTarget: text('metric_target'),
    claimedBy: text('claimed_by'),
    claimedAt: timestamp('claimed_at'),
    platformFeeBps: smallint('platform_fee_bps').notNull().default(500),
    requesterAgentId: text('requester_agent_id'),
    chainId: integer('chain_id'),
    contractAddress: text('contract_address'),
    cancelledAt: timestamp('cancelled_at'),
  },
  (table) => ({
    statusIdx: index('idx_tasks_status').on(table.status),
    expiryIdx: index('idx_tasks_expiry').on(table.expiryTime),
    requesterIdx: index('idx_tasks_requester').on(table.requester),
    workerIdx: index('idx_tasks_worker').on(table.worker),
    modeIdx: index('idx_tasks_mode').on(table.mode),
    claimedByIdx: index('idx_tasks_claimed_by').on(table.claimedBy),
  })
);

export const submissions = pgTable(
  'submissions',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    workerAddress: text('worker_address').notNull(),
    fileUrl: text('file_url').notNull(),
    signature: text('signature').notNull(),
    deliverableHash: text('deliverable_hash'),
    submitTxHash: text('submit_tx_hash'),
    submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  },
  (table) => ({
    taskIdIdx: index('idx_submissions_task').on(table.taskId),
    workerIdx: index('idx_submissions_worker').on(table.workerAddress),
  })
);

export const artifacts = pgTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    submissionId: text('submission_id')
      .notNull()
      .references(() => submissions.id),
    role: text('role').notNull().default('attachment'),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    mediaKind: text('media_kind').notNull().default('unknown'),
    storageUri: text('storage_uri').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256Hash: text('sha256_hash').notNull(),
    keccak256Hash: text('keccak256_hash').notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    taskIdx: index('idx_artifacts_task').on(table.taskId),
    submissionIdx: index('idx_artifacts_submission').on(table.submissionId),
  })
);

export const agents = pgTable(
  'agents',
  {
    address: text('address').primaryKey(),
    agentId: text('agent_id'),
    completedTasks: integer('completed_tasks').notNull().default(0),
    ratedTasks: integer('rated_tasks').notNull().default(0),
    totalStars: integer('total_stars').notNull().default(0),
    totalEarnings: numeric('total_earnings', { precision: 78, scale: 0 }).notNull().default('0'),
    skills: text('skills').array().notNull().default([]),
    withdrawalAddress: text('withdrawal_address'),
    emailAddress: text('email_address').unique(),
    xmtpInboxId: text('xmtp_inbox_id'),
    xmtpEnabled: integer('xmtp_enabled').notNull().default(0),
    xmtpLastSeenAt: timestamp('xmtp_last_seen_at'),
    publicKey: text('public_key'),
    registeredVia: text('registered_via').notNull().default('cli'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    completedIdx: index('idx_agents_completed').on(table.completedTasks),
    agentIdIdx: index('idx_agents_agent_id').on(table.agentId),
  })
);

export const feedbacks = pgTable(
  'feedbacks',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    workerAddress: text('worker_address').notNull(),
    workerAgentId: text('worker_agent_id'),
    requesterAddress: text('requester_address').notNull(),
    requesterAgentId: text('requester_agent_id'),
    rating: smallint('rating').notNull(),
    feedbackText: text('feedback_text'),
    fileContent: text('file_content').notNull(),
    ratingTxHash: text('rating_tx_hash'),
    ratingBlockNumber: bigint('rating_block_number', { mode: 'number' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    taskIdx: index('idx_feedbacks_task').on(table.taskId),
    workerIdx: index('idx_feedbacks_worker').on(table.workerAddress),
  })
);

export const proposals = pgTable(
  'proposals',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    workerAddress: text('worker_address').notNull(),
    proposalText: text('proposal_text').notNull(),
    estimatedDuration: integer('estimated_duration'),
    status: text('status').notNull().default('pending'),
    signature: text('signature').notNull(),
    submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  },
  (table) => ({
    taskIdIdx: index('idx_proposals_task').on(table.taskId),
    workerIdx: index('idx_proposals_worker').on(table.workerAddress),
    statusIdx: index('idx_proposals_status').on(table.status),
  })
);

export const claims = pgTable(
  'claims',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    workerAddress: text('worker_address').notNull(),
    stakeAmount: numeric('stake_amount', { precision: 78, scale: 0 }).notNull(),
    stakeTxHash: text('stake_tx_hash').notNull(),
    claimedAt: timestamp('claimed_at').defaultNow().notNull(),
    status: text('status').notNull().default('active'),
  },
  (table) => ({
    taskIdIdx: index('idx_claims_task').on(table.taskId),
    workerIdx: index('idx_claims_worker').on(table.workerAddress),
  })
);

export const proofs = pgTable(
  'proofs',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    workerAddress: text('worker_address').notNull(),
    proofData: text('proof_data').notNull(),
    proofType: text('proof_type').notNull(),
    metricValue: text('metric_value'),
    status: text('status').notNull().default('pending'),
    signature: text('signature').notNull(),
    submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  },
  (table) => ({
    taskIdIdx: index('idx_proofs_task').on(table.taskId),
    workerIdx: index('idx_proofs_worker').on(table.workerAddress),
  })
);

export const bids = pgTable(
  'bids',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    workerAddress: text('worker_address').notNull(),
    price: numeric('price', { precision: 78, scale: 0 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    taskIdIdx: index('idx_bids_task').on(table.taskId),
    workerIdx: index('idx_bids_worker').on(table.workerAddress),
    priceIdx: index('idx_bids_price').on(table.price),
    taskWorkerUnique: unique('bids_task_worker_unique').on(table.taskId, table.workerAddress),
  })
);

export const platformFees = pgTable(
  'platform_fees',
  {
    id: serial('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    amount: numeric('amount', { precision: 78, scale: 0 }).notNull(),
    txHash: text('tx_hash').notNull(),
    collectedAt: timestamp('collected_at').defaultNow().notNull(),
  },
  (table) => ({
    taskIdIdx: index('idx_platform_fees_task').on(table.taskId),
  })
);

export const devices = pgTable(
  'devices',
  {
    id: text('id').primaryKey(),
    apiTokenHash: text('api_token_hash').notNull().unique(),
    walletAddress: text('wallet_address').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    revokedAt: timestamp('revoked_at'),
  },
  (table) => ({
    walletIdx: index('devices_wallet_idx').on(table.walletAddress),
  })
);

/**
 * An XMTP "installation" is one XMTP client keypair registered on one device.
 * This is XMTP's own term of art from @xmtp/node-sdk.
 *
 * A single agent wallet can have multiple installations — one per machine
 * the agent has ever run on (laptop, prod server, etc.). Each installation
 * has its own private key and local SQLite DB, but all share the same inboxId.
 * XMTP delivers messages to all active installations for a given inboxId.
 *
 * Installations are kept alive by periodic heartbeats. Those that exceed
 * XMTP_STALE_INSTALLATION_MINUTES without a heartbeat can be purged (revoked),
 * preventing message delivery to abandoned/decommissioned machines.
 */
export const agentXmtpInstallations = pgTable(
  'agent_xmtp_installations',
  {
    id: serial('id').primaryKey(),
    agentAddress: text('agent_address')
      .notNull()
      .references(() => agents.address),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id),
    inboxId: text('inbox_id').notNull(),
    installationId: text('installation_id').notNull().unique(),
    dbPath: text('db_path'),
    clientVersion: text('client_version'),
    status: text('status').notNull().default('active'),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    agentIdx: index('idx_agent_xmtp_installations_agent').on(table.agentAddress),
    inboxIdx: index('idx_agent_xmtp_installations_inbox').on(table.inboxId),
    statusIdx: index('idx_agent_xmtp_installations_status').on(table.status),
  })
);

export const agentXmtpPeerPolicies = pgTable(
  'agent_xmtp_peer_policies',
  {
    id: serial('id').primaryKey(),
    ownerAgentAddress: text('owner_agent_address')
      .notNull()
      .references(() => agents.address),
    peerInboxId: text('peer_inbox_id').notNull(),
    policy: text('policy').notNull().default('allow'),
    reason: text('reason'),
    updatedByDeviceId: text('updated_by_device_id').references(() => devices.id),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    ownerIdx: index('idx_agent_xmtp_peer_policies_owner').on(table.ownerAgentAddress),
    peerIdx: index('idx_agent_xmtp_peer_policies_peer').on(table.peerInboxId),
    ownerPeerUniqueIdx: uniqueIndex('uidx_agent_xmtp_peer_policies_owner_peer').on(
      table.ownerAgentAddress,
      table.peerInboxId
    ),
  })
);

export const emails = pgTable(
  'emails',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id').unique(),
    fromAddress: text('from_address').notNull(),
    toAddress: text('to_address').notNull(),
    agentAddress: text('agent_address')
      .notNull()
      .references(() => agents.address, { onDelete: 'cascade' }),
    subject: text('subject'),
    bodyText: text('body_text'),
    bodyHtml: text('body_html'),
    isRead: integer('is_read').notNull().default(0),
    receivedAt: timestamp('received_at').defaultNow().notNull(),
  },
  (table) => ({
    agentIdx: index('idx_emails_agent').on(table.agentAddress),
    receivedIdx: index('idx_emails_received').on(table.receivedAt),
  })
);

export const indexerState = pgTable('indexer_state', {
  id: text('id').primaryKey().default('main'),
  lastBlock: bigint('last_block', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Feedback = typeof feedbacks.$inferSelect;
export type NewFeedback = typeof feedbacks.$inferInsert;
export type Proposal = typeof proposals.$inferSelect;
export type NewProposal = typeof proposals.$inferInsert;
export type Claim = typeof claims.$inferSelect;
export type NewClaim = typeof claims.$inferInsert;
export type Proof = typeof proofs.$inferSelect;
export type NewProof = typeof proofs.$inferInsert;
export type PlatformFee = typeof platformFees.$inferSelect;
export type NewPlatformFee = typeof platformFees.$inferInsert;
export type IndexerState = typeof indexerState.$inferSelect;
export type NewIndexerState = typeof indexerState.$inferInsert;
export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type Bid = typeof bids.$inferSelect;
export type NewBid = typeof bids.$inferInsert;
export type AgentXmtpInstallation = typeof agentXmtpInstallations.$inferSelect;
export type NewAgentXmtpInstallation = typeof agentXmtpInstallations.$inferInsert;
export type AgentXmtpPeerPolicy = typeof agentXmtpPeerPolicies.$inferSelect;
export type NewAgentXmtpPeerPolicy = typeof agentXmtpPeerPolicies.$inferInsert;
export type Email = typeof emails.$inferSelect;
export type NewEmail = typeof emails.$inferInsert;
