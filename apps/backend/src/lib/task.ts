import {
  PAID_PENDING_ACTION_NAMES,
  Secp256k1PublicKeySchema,
  formatUsdcBaseUnits,
  type PendingAction,
  type PendingActionNameValue,
  type TaskPhaseType,
} from '@taskmarket/shared';
import { STANDARD_X402_ACTION_AMOUNT } from '../config/payments';

const PAID_ACTIONS = new Set<PendingActionNameValue>(PAID_PENDING_ACTION_NAMES);

export type SubmissionWindowTask = {
  status: string;
  mode: string;
  expiryTime: Date;
};

export type PendingActionTask = SubmissionWindowTask & {
  id: string;
  requester: string;
  pitchCount: number;
  bidCount: number;
  submissionCount: number;
  pitchDeadline: Date | null;
  bidDeadline: Date | null;
  claimedBy: string | null;
  auctionType: string | null;
  currentClockPrice: bigint | null;
  currentLowestBid: string | null;
  // Set only when the task has exactly one distinct active submitter -- see ADR-0027.
  // Left null whenever zero or multiple distinct addresses have submitted, so
  // resubmission spam from a non-winning submitter can no longer capture the
  // suggested `--worker` slot in the accept/reject_submission commands below.
  latestSubmissionWorker?: string | null;
  // Per-caller projection used for contest appeals when a verdict has no lead
  // award and therefore no claimedBy worker. Never populate this with another
  // submitter's address in a response visible to the current caller.
  appealEligibleWorker?: string | null;
  evaluator?: string | null;
  disputeResolver?: string | null;
  evaluatorDeadline?: Date | null;
  appealDeadline?: Date | null;
  awardWorkers: Array<{ workerAddress: string; rating: number | null }>;
};

type ActionOptions = {
  eligibleAddress?: string | null;
  availableAfter?: Date | null;
  availableUntil?: Date | null;
  targetWorker?: string | null;
};

function action(
  role: PendingAction['role'],
  name: PendingActionNameValue,
  command: string,
  options: ActionOptions = {}
): PendingAction {
  const requiresPayment = PAID_ACTIONS.has(name);
  return {
    role,
    action: name,
    command,
    eligibleAddress: options.eligibleAddress ?? null,
    requiresPayment,
    paymentAmount: requiresPayment ? STANDARD_X402_ACTION_AMOUNT : null,
    availableAfter: options.availableAfter?.toISOString() ?? null,
    availableUntil: options.availableUntil?.toISOString() ?? null,
    targetWorker: options.targetWorker ?? null,
  };
}

export function computeSubmissionWindowOpen(task: SubmissionWindowTask, now: Date): boolean {
  if (task.expiryTime <= now) return false;

  switch (task.mode) {
    case 'bounty':
    case 'benchmark':
      return task.status === 'open';
    case 'claim':
    case 'auction':
      return task.status === 'claimed';
    case 'pitch':
      return task.status === 'worker_selected';
    default:
      return false;
  }
}

const IN_REVIEW_STATUSES = new Set(['review', 'appealing', 'disputed']);
const SUBMISSION_WINDOW_STATUSES = new Set(['open', 'claimed', 'worker_selected']);
const RESOLVED_STATUSES = new Set(['completed', 'cancelled', 'expired']);

// Implements: ADR-0024 (derived phase field for awaiting-closeout state)
// Derived lifecycle bucket over `status` -- see ADR-0024. `status` stays a literal
// mirror of on-chain/indexer state; `phase` names the coarser bucket a client actually
// wants without having to separately cross-check expiryTime and re-derive this itself.
export function computeTaskPhase(task: SubmissionWindowTask, now: Date): TaskPhaseType {
  if (IN_REVIEW_STATUSES.has(task.status)) return 'in_review';
  if (RESOLVED_STATUSES.has(task.status)) return 'resolved';
  if (SUBMISSION_WINDOW_STATUSES.has(task.status)) {
    return task.expiryTime <= now ? 'awaiting_settlement' : 'active';
  }
  // pending_approval (and any future status this client does not yet know) has no
  // deadline gating it -- treat as routine in-progress work, not a judged state.
  return 'active';
}

export function computeNetReward(
  grossPayout: string | null,
  platformFeeBps: number
): string | null {
  if (grossPayout === null) return null;
  const feeBps = BigInt(platformFeeBps);
  return ((BigInt(grossPayout) * (10_000n - feeBps)) / 10_000n).toString();
}

export function normalizeRequesterPublicKey(
  publishedKey: string | null | undefined,
  storedKey: string | null | undefined
): string | null {
  if (isSecp256k1PublicKey(publishedKey)) return publishedKey;
  if (isSecp256k1PublicKey(storedKey)) return storedKey;
  return null;
}

function isSecp256k1PublicKey(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && Secp256k1PublicKeySchema.safeParse(value).success;
}

export function computePendingActions(task: PendingActionTask, now: Date): PendingAction[] {
  const id = task.id;
  const expired = task.expiryTime <= now;
  const submissionWindowOpen = computeSubmissionWindowOpen(task, now);
  const workerAddress =
    task.claimedBy ?? task.appealEligibleWorker ?? task.latestSubmissionWorker ?? null;

  if (task.status === 'open') {
    const auctionHasBids = task.mode === 'auction' && task.bidCount > 0;
    const contestHasSubmissions =
      (task.mode === 'bounty' || task.mode === 'benchmark') && task.submissionCount > 0;
    const mayUpdate = !auctionHasBids;
    const mayCancel = !expired && !auctionHasBids && !contestHasSubmissions;

    const managementActions: PendingAction[] = [];
    if (mayCancel) {
      managementActions.push(
        action('requester', 'cancel', `taskmarket task cancel ${id}`, {
          eligibleAddress: task.requester,
        })
      );
    }
    if (mayUpdate) {
      managementActions.push(
        action('requester', 'update', `taskmarket task update ${id} --extend-expiry <seconds>`, {
          eligibleAddress: task.requester,
        })
      );
    }

    if (expired && !contestHasSubmissions) {
      return [
        ...managementActions,
        action('requester', 'refund_expired', `taskmarket task refund-expired ${id}`, {
          eligibleAddress: task.requester,
          availableAfter: task.expiryTime,
        }),
      ];
    }

    const requesterDecisionActions: PendingAction[] = contestHasSubmissions
      ? [
          ...(task.evaluator
            ? []
            : [
                action(
                  'requester',
                  'accept',
                  `taskmarket task accept ${id} --worker ${workerAddress ?? '<address>'}`,
                  { eligibleAddress: task.requester }
                ),
                action(
                  'requester',
                  'accept_submissions',
                  `taskmarket task accept-submissions ${id} --winner <worker>:10000`,
                  { eligibleAddress: task.requester }
                ),
              ]),
          action(
            'requester',
            'reject_submission',
            `taskmarket task reject-submission ${id} --worker ${task.latestSubmissionWorker ?? workerAddress ?? '<address>'}`,
            { eligibleAddress: task.requester }
          ),
          ...(task.evaluator
            ? [
                action(
                  'evaluator',
                  'evaluate',
                  `taskmarket task evaluate ${id} --verdict approve --award <worker>:<amount-usdc>:1`,
                  { eligibleAddress: task.evaluator }
                ),
              ]
            : []),
        ]
      : [];

    switch (task.mode) {
      case 'bounty':
        return [
          ...managementActions,
          ...requesterDecisionActions,
          ...(submissionWindowOpen
            ? [
                action('worker', 'submit', `taskmarket task submit ${id} --file <path>`, {
                  availableUntil: task.expiryTime,
                }),
              ]
            : []),
        ];
      case 'benchmark':
        return [
          ...managementActions,
          ...requesterDecisionActions,
          ...(submissionWindowOpen
            ? [
                action(
                  'worker',
                  'submit_proof',
                  `taskmarket task proof ${id} --data <data> --type <type>`,
                  { availableUntil: task.expiryTime }
                ),
              ]
            : []),
        ];
      case 'claim':
        return expired
          ? managementActions
          : [
              ...managementActions,
              action('worker', 'claim', `taskmarket task claim ${id}`, {
                availableUntil: task.expiryTime,
              }),
            ];
      case 'pitch': {
        const pitchWindowEnd = task.pitchDeadline ?? task.expiryTime;
        const actions = [...managementActions];
        if (!expired && now < pitchWindowEnd) {
          actions.push(
            action('worker', 'pitch', `taskmarket task pitch ${id} --text "..."`, {
              availableUntil: pitchWindowEnd,
            })
          );
        }
        if (!expired && task.pitchCount > 0) {
          actions.push(
            action(
              'requester',
              'select_worker',
              `taskmarket task select-worker ${id} --pitch <pitchId> --worker <address>`,
              { eligibleAddress: task.requester, availableUntil: task.expiryTime }
            )
          );
        }
        return actions;
      }
      case 'auction': {
        if (expired) return managementActions;
        const bidWindowEnd = task.bidDeadline ?? task.expiryTime;
        const deadlinePassed = now >= bidWindowEnd;

        if (task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch') {
          if (deadlinePassed) return managementActions;
          const price =
            task.currentClockPrice === null ? '?' : formatUsdcBaseUnits(task.currentClockPrice);
          return [
            ...managementActions,
            action(
              'worker',
              'auction_accept',
              `taskmarket task auction-accept ${id} # current price: $${price}`,
              { availableUntil: bidWindowEnd }
            ),
          ];
        }

        if (deadlinePassed) {
          return task.bidCount > 0
            ? [
                action('anyone', 'select_winner', `taskmarket task select-winner ${id}`, {
                  availableUntil: task.expiryTime,
                }),
              ]
            : managementActions;
        }

        if (task.auctionType === 'english') {
          const lowest =
            task.currentLowestBid === null
              ? ''
              : ` # current lowest: $${formatUsdcBaseUnits(task.currentLowestBid)}`;
          return [
            ...managementActions,
            action('worker', 'bid', `taskmarket task bid ${id} --price <usdc>${lowest}`, {
              availableUntil: bidWindowEnd,
            }),
          ];
        }

        return [
          ...managementActions,
          action(
            'worker',
            'bid',
            `taskmarket task bid ${id} --price <usdc> # ${task.bidCount} sealed bid(s) placed`,
            { availableUntil: bidWindowEnd }
          ),
        ];
      }
      default:
        return managementActions;
    }
  }

  if (task.status === 'claimed') {
    if (submissionWindowOpen && workerAddress) {
      return [
        action('worker', 'submit', `taskmarket task submit ${id} --file <path>`, {
          eligibleAddress: workerAddress,
          availableUntil: task.expiryTime,
        }),
      ];
    }
    if (expired && task.mode === 'claim') {
      return [
        action('requester', 'forfeit', `taskmarket task forfeit ${id}`, {
          eligibleAddress: task.requester,
          availableAfter: task.expiryTime,
        }),
      ];
    }
    if (expired && task.mode === 'auction') {
      return [
        action('requester', 'refund_expired', `taskmarket task refund-expired ${id}`, {
          eligibleAddress: task.requester,
          availableAfter: task.expiryTime,
        }),
      ];
    }
    return [];
  }

  if (task.status === 'worker_selected') {
    if (submissionWindowOpen && workerAddress) {
      return [
        action('worker', 'submit', `taskmarket task submit ${id} --file <path>`, {
          eligibleAddress: workerAddress,
          availableUntil: task.expiryTime,
        }),
      ];
    }
    if (expired) {
      return [
        action('requester', 'refund_expired', `taskmarket task refund-expired ${id}`, {
          eligibleAddress: task.requester,
          availableAfter: task.expiryTime,
        }),
      ];
    }
    return [];
  }

  if (task.status === 'pending_approval') {
    if (expired && task.mode !== 'bounty' && task.mode !== 'benchmark') {
      return [
        action('requester', 'refund_expired', `taskmarket task refund-expired ${id}`, {
          eligibleAddress: task.requester,
          availableAfter: task.expiryTime,
        }),
      ];
    }
    return [
      action(
        'requester',
        'accept',
        `taskmarket task accept ${id} --worker ${workerAddress ?? '<address>'}`,
        {
          eligibleAddress: task.requester,
          availableUntil:
            task.mode === 'bounty' || task.mode === 'benchmark' ? null : task.expiryTime,
        }
      ),
    ];
  }

  if (task.status === 'review') {
    const actions: PendingAction[] = [];
    if (task.evaluator) {
      actions.push(
        action(
          'evaluator',
          'evaluate',
          `taskmarket task evaluate ${id} --verdict approve --award <worker>:<amount-usdc>:1 --score 1000`,
          { eligibleAddress: task.evaluator }
        )
      );
    }
    if (task.evaluatorDeadline && now >= task.evaluatorDeadline) {
      actions.push(
        action('requester', 'evaluator_timeout', `taskmarket task evaluator-timeout ${id}`, {
          eligibleAddress: task.requester,
          availableAfter: task.evaluatorDeadline,
        })
      );
    }
    return actions;
  }

  if (task.status === 'appealing') {
    if (task.appealDeadline && now < task.appealDeadline) {
      return [
        action('worker', 'appeal', `taskmarket task appeal ${id}`, {
          eligibleAddress: workerAddress,
          availableUntil: task.appealDeadline,
        }),
      ];
    }
    return [
      action('anyone', 'finalize_verdict', `taskmarket task finalize-verdict ${id}`, {
        availableAfter: task.appealDeadline,
      }),
    ];
  }

  if (task.status === 'disputed') {
    return [
      action(
        'dispute_resolver',
        'resolve_dispute',
        `taskmarket task resolve-dispute ${id} --verdict approve --award <worker>:<amount-usdc>:<rank>`,
        { eligibleAddress: task.disputeResolver ?? null }
      ),
    ];
  }

  if (task.status === 'completed') {
    const unratedWorkers = Array.from(
      task.awardWorkers
        .reduce((workers, award) => {
          const key = award.workerAddress.toLowerCase();
          const current = workers.get(key);
          workers.set(key, {
            address: current?.address ?? award.workerAddress,
            rated: Boolean(current?.rated || award.rating !== null),
          });
          return workers;
        }, new Map<string, { address: string; rated: boolean }>())
        .values()
    )
      .filter((worker) => !worker.rated)
      .map((worker) => worker.address);

    return unratedWorkers.map((targetWorker) =>
      action(
        'requester',
        'rate',
        `taskmarket task rate ${id} --worker ${targetWorker} --rating <0-100>`,
        { eligibleAddress: task.requester, targetWorker }
      )
    );
  }

  return [];
}
