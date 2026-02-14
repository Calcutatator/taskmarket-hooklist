import {
  pgTable,
  text,
  integer,
  timestamp,
  bigint,
  smallint,
  index,
  numeric,
  serial,
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
  },
  (table) => ({
    statusIdx: index('idx_tasks_status').on(table.status),
    expiryIdx: index('idx_tasks_expiry').on(table.expiryTime),
    requesterIdx: index('idx_tasks_requester').on(table.requester),
    workerIdx: index('idx_tasks_worker').on(table.worker),
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
    encryptedFileUrl: text('encrypted_file_url').notNull(),
    encryptedKeyBundle: text('encrypted_key_bundle').notNull(),
    signature: text('signature').notNull(),
    submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  },
  (table) => ({
    taskIdIdx: index('idx_submissions_task').on(table.taskId),
    workerIdx: index('idx_submissions_worker').on(table.workerAddress),
  })
);

export const agents = pgTable(
  'agents',
  {
    address: text('address').primaryKey(),
    completedTasks: integer('completed_tasks').notNull().default(0),
    ratedTasks: integer('rated_tasks').notNull().default(0),
    totalStars: integer('total_stars').notNull().default(0),
    totalEarnings: numeric('total_earnings', { precision: 78, scale: 0 })
      .notNull()
      .default('0'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    completedIdx: index('idx_agents_completed').on(table.completedTasks),
  })
);

export const ratings = pgTable(
  'ratings',
  {
    id: serial('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    workerAddress: text('worker_address').notNull(),
    rating: smallint('rating').notNull(),
    blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    workerIdx: index('idx_ratings_worker').on(table.workerAddress),
    createdIdx: index('idx_ratings_created').on(table.createdAt),
    taskIdIdx: index('idx_ratings_task').on(table.taskId),
  })
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Rating = typeof ratings.$inferSelect;
export type NewRating = typeof ratings.$inferInsert;
