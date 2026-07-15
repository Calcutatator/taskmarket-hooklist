import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  timestamp,
  bigint,
  smallint,
  boolean,
  index,
  uniqueIndex,
  jsonb,
  numeric,
  primaryKey,
  serial,
  unique,
  check,
} from 'drizzle-orm/pg-core';

export const taskDrops = pgTable(
  'task_drops',
  {
    id: text('id').primaryKey(),
    ownerAddress: text('owner_address').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    announcedAt: timestamp('announced_at', { precision: 3, withTimezone: true }),
  },
  (table) => ({
    ownerIdx: index('idx_task_drops_owner').on(sql`lower(${table.ownerAddress})`),
  })
);

export const taskDropTaskReservations = pgTable(
  'task_drop_task_reservations',
  {
    reservationId: text('reservation_id').primaryKey(),
    taskDropId: text('task_drop_id')
      .notNull()
      .references(() => taskDrops.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    taskDropIdx: index('idx_task_drop_task_reservations_drop').on(table.taskDropId),
  })
);

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
    selfAward: boolean('self_award').notNull().default(false),
    hookContract: text('hook_contract'),
    evaluator: text('evaluator'),
    evaluatorStake: numeric('evaluator_stake', { precision: 78, scale: 0 }),
    evaluatorFeeBps: smallint('evaluator_fee_bps'),
    evaluationWindow: integer('evaluation_window'),
    appealWindow: integer('appeal_window'),
    disputeResolver: text('dispute_resolver'),
    appealDeadline: timestamp('appeal_deadline', { withTimezone: true }),
    verdictType: text('verdict_type'),
    verdictScore: smallint('verdict_score'),
    verdictConfidence: smallint('verdict_confidence'),
    verdictEvidenceHash: text('verdict_evidence_hash'),
    evaluatorDeadline: timestamp('evaluator_deadline', { withTimezone: true }),
    taskDropId: text('task_drop_id').references(() => taskDrops.id),
  },
  (table) => ({
    statusIdx: index('idx_tasks_status').on(table.status),
    expiryIdx: index('idx_tasks_expiry').on(table.expiryTime),
    requesterIdx: index('idx_tasks_requester').on(table.requester),
    workerIdx: index('idx_tasks_worker').on(table.worker),
    modeIdx: index('idx_tasks_mode').on(table.mode),
    claimedByIdx: index('idx_tasks_claimed_by').on(table.claimedBy),
    createdAtIdx: index('idx_tasks_created_at').on(table.createdAt),
    taskDropIdx: index('idx_tasks_task_drop').on(table.taskDropId),
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
    rejectedAt: timestamp('rejected_at'),
  },
  (table) => ({
    taskIdIdx: index('idx_submissions_task').on(table.taskId),
    workerIdx: index('idx_submissions_worker').on(table.workerAddress),
    submittedAtIdx: index('idx_submissions_submitted_at').on(table.submittedAt),
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
    createdAt: timestamp('created_at'),
  },
  (table) => ({
    completedIdx: index('idx_agents_completed').on(table.completedTasks),
    agentIdIdx: index('idx_agents_agent_id').on(table.agentId),
    createdAtIdx: index('idx_agents_created_at').on(table.createdAt),
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
    createdAtIdx: index('idx_feedbacks_created_at').on(table.createdAt),
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
    pitchHash: text('pitch_hash'),
    submitTxHash: text('submit_tx_hash'),
    submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  },
  (table) => ({
    taskIdIdx: index('idx_proposals_task').on(table.taskId),
    workerIdx: index('idx_proposals_worker').on(table.workerAddress),
    statusIdx: index('idx_proposals_status').on(table.status),
    submittedAtIdx: index('idx_proposals_submitted_at').on(table.submittedAt),
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
    claimedAtIdx: index('idx_claims_claimed_at').on(table.claimedAt),
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
    proofHash: text('proof_hash'),
    submitTxHash: text('submit_tx_hash'),
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
    createdAtIdx: index('idx_bids_created_at').on(table.createdAt),
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

export const taskDropSubscriptions = pgTable(
  'task_drop_subscriptions',
  {
    id: text('id').primaryKey(),
    taskDropId: text('task_drop_id').references(() => taskDrops.id),
    email: text('email').notNull(),
    walletAddress: text('wallet_address'),
    agentAddress: text('agent_address'),
    scope: text('subscription_scope').notNull().default('drop'),
    source: text('source').notNull().default('first_run_panel'),
    status: text('status').notNull().default('active'),
    consentedAt: timestamp('consented_at', { precision: 3, withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    unsubscribedAt: timestamp('unsubscribed_at'),
  },
  (table) => ({
    dropEmailIdx: uniqueIndex('uidx_task_drop_subscriptions_drop_email')
      .on(table.taskDropId, sql`lower(${table.email})`)
      .where(sql`${table.taskDropId} IS NOT NULL`),
    dropIdx: index('idx_task_drop_subscriptions_drop').on(table.taskDropId),
    walletIdx: index('idx_task_drop_subscriptions_wallet').on(table.walletAddress),
    statusIdx: index('idx_task_drop_subscriptions_status').on(table.status),
    scopeIdx: index('idx_task_drop_subscriptions_scope').on(table.scope),
    officialEmailIdx: uniqueIndex('uidx_task_drop_subscriptions_official_email')
      .on(sql`lower(${table.email})`)
      .where(sql`${table.scope} = 'official'`),
    scopeDropCheck: check(
      'task_drop_subscriptions_scope_drop_check',
      sql`(${table.scope} = 'drop' AND ${table.taskDropId} IS NOT NULL) OR (${table.scope} IN ('official', 'legacy') AND ${table.taskDropId} IS NULL)`
    ),
  })
);

export const taskDropSubscribeRateLimits = pgTable('task_drop_subscribe_rate_limits', {
  key: text('rate_limit_key').primaryKey(),
  windowStartedAt: timestamp('window_started_at', { precision: 3, withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull(),
  updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true }).defaultNow().notNull(),
});

export const taskDropAnnouncementDeliveries = pgTable(
  'task_drop_announcement_deliveries',
  {
    id: text('id').primaryKey(),
    taskDropId: text('task_drop_id')
      .notNull()
      .references(() => taskDrops.id),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => taskDropSubscriptions.id),
    subscriptionConsentedAt: timestamp('subscription_consented_at', {
      precision: 3,
      withTimezone: true,
    }).notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    processingAt: timestamp('processing_at', { precision: 3, withTimezone: true }),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { precision: 3, withTimezone: true }),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    taskDropIdx: index('idx_task_drop_announcement_deliveries_drop').on(table.taskDropId),
    statusIdx: index('idx_task_drop_announcement_deliveries_status').on(table.status),
    dropSubscriptionIdx: uniqueIndex('uidx_task_drop_announcement_delivery_subscription').on(
      table.taskDropId,
      table.subscriptionId
    ),
    statusCheck: check(
      'task_drop_announcement_deliveries_status_check',
      sql`${table.status} IN ('pending', 'processing', 'sent', 'failed', 'skipped')`
    ),
  })
);

export const indexerState = pgTable('indexer_state', {
  id: text('id').primaryKey().default('main'),
  lastBlock: bigint('last_block', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const protocolEvents = pgTable(
  'protocol_events',
  {
    id: serial('id').primaryKey(),
    eventName: text('event_name').notNull(),
    chainId: integer('chain_id').notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    logIndex: integer('log_index').notNull(),
    txHash: text('tx_hash').notNull(),
    args: jsonb('args').notNull(),
    emittedAt: timestamp('emitted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    eventNameIdx: index('idx_protocol_events_name').on(table.eventName),
    blockNumberIdx: index('idx_protocol_events_block').on(table.blockNumber),
    chainBlockLogUnique: uniqueIndex('protocol_events_chain_block_log_unique').on(
      table.chainId,
      table.blockNumber,
      table.logIndex
    ),
  })
);

export const requesterReputationEvents = pgTable(
  'requester_reputation_events',
  {
    id: serial('id').primaryKey(),
    taskId: text('task_id').notNull(),
    requester: text('requester').notNull(),
    eventType: text('event_type').notNull(),
    reward: text('reward').notNull(),
    submissionCount: integer('submission_count').notNull().default(0),
    uniqueWorkers: integer('unique_workers').notNull().default(0),
    selfAward: boolean('self_award').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    taskIdUnique: uniqueIndex('uidx_requester_rep_task').on(table.taskId),
    requesterIdx: index('idx_requester_rep_requester').on(table.requester),
  })
);

// One-time-use nonces for the DREAMS withdraw signed-message flow. withdrawFor is
// executed by the trusted backend wallet (not a user tx), so replay protection can't
// live on-chain — a captured signature must be rejected here on reuse, not just relied
// on to expire, since a short validity window alone still allows repeat submission
// within that window.
export const dreamsWithdrawNonces = pgTable('dreams_withdraw_nonces', {
  nonce: text('nonce').primaryKey(),
  usedAt: timestamp('used_at', { withTimezone: true }).defaultNow().notNull(),
});

export const indexedEvents = pgTable(
  'indexed_events',
  {
    chainId: integer('chain_id').notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    logIndex: integer('log_index').notNull(),
    eventName: text('event_name').notNull(),
    txHash: text('tx_hash').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.blockNumber, table.logIndex] }),
  })
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskDrop = typeof taskDrops.$inferSelect;
export type NewTaskDrop = typeof taskDrops.$inferInsert;
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
export type RequesterReputationEvent = typeof requesterReputationEvents.$inferSelect;
export type NewRequesterReputationEvent = typeof requesterReputationEvents.$inferInsert;
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
export type TaskDropSubscription = typeof taskDropSubscriptions.$inferSelect;
export type NewTaskDropSubscription = typeof taskDropSubscriptions.$inferInsert;
