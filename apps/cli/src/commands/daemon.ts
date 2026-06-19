import { Command } from 'commander';
import { loadKeystore } from '../lib/keystore.js';
import { apiGet, apiPost } from '../lib/api.js';
import { printResult } from '../lib/output.js';
import { createXmtpClient, listenForEnvelopes } from '../lib/xmtp-client.js';
import type { XmtpClientSession } from '../lib/xmtp-client.js';
import type { AgentMessageEnvelope } from '@taskmarket/shared';

// --- Interfaces ---

interface TaskRow {
  id: string;
  description: string;
  reward: string;
  mode: string;
  status: string;
  tags: string[];
}

interface AuctionTaskRow extends TaskRow {
  auctionType?: string | null;
  currentAuctionPrice?: string | null;
  bidDeadline?: string | null;
}

interface InboxResult {
  asRequester: TaskRow[];
  asWorker: TaskRow[];
}

interface PendingAction {
  role: string;
  action: string;
  command: string;
}

interface TaskDetail {
  id: string;
  status: string;
  pendingActions: PendingAction[];
}

interface EmailRow {
  id: string;
  fromAddress: string;
  subject: string | null;
  bodyText: string | null;
  receivedAt: string;
}

interface EmailListResult {
  emails: EmailRow[];
}

// --- Pure helpers (exported for testing) ---

export function diffTaskStatuses(
  prev: Map<string, string>,
  next: Map<string, string>
): Array<{ taskId: string; from: string; to: string }> {
  const changes: Array<{ taskId: string; from: string; to: string }> = [];
  for (const [taskId, newStatus] of next) {
    const oldStatus = prev.get(taskId);
    if (oldStatus !== undefined && oldStatus !== newStatus) {
      changes.push({ taskId, from: oldStatus, to: newStatus });
    }
  }
  return changes;
}

export function collectNewTaskIds(tasks: TaskRow[], seenIds: Set<string>): string[] {
  return tasks.filter((t) => !seenIds.has(t.id)).map((t) => t.id);
}

// --- Utilities ---

function sleepOrAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        resolve();
      },
      { once: true }
    );
  });
}

const MAX_SEEN_TASK_IDS = 2000;

// --- Daemon command ---

export const daemonCommand = new Command('daemon')
  .description('Long-running agent daemon: XMTP stream, heartbeats, and task polling')
  .option('--heartbeat-interval <ms>', 'Heartbeat interval in milliseconds', '1800000')
  .option('--inbox-interval <ms>', 'Inbox poll interval in milliseconds', '15000')
  .option('--task-interval <ms>', 'New task poll interval in milliseconds', '15000')
  .option(
    '--auction-poll-interval <ms>',
    'Poll interval for clock-based auction tasks (dutch/reverse_dutch) in milliseconds',
    '15000'
  )
  .option('--email-poll-interval <ms>', 'Email inbox poll interval in milliseconds', '60000')
  .option('--task-filters <json>', 'JSON filter object for new-task discovery')
  .option('--no-xmtp', 'Disable XMTP stream and heartbeat')
  .action(
    async (opts: {
      heartbeatInterval: string;
      inboxInterval: string;
      taskInterval: string;
      auctionPollInterval: string;
      emailPollInterval: string;
      taskFilters?: string;
      xmtp: boolean;
    }) => {
      const heartbeatIntervalMs = Number(opts.heartbeatInterval);
      const inboxIntervalMs = Number(opts.inboxInterval);
      const taskIntervalMs = Number(opts.taskInterval);
      const auctionPollIntervalMs = Number(opts.auctionPollInterval);
      const emailPollIntervalMs = Number(opts.emailPollInterval);

      if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) {
        throw new Error('--heartbeat-interval must be a positive number');
      }
      if (!Number.isFinite(inboxIntervalMs) || inboxIntervalMs <= 0) {
        throw new Error('--inbox-interval must be a positive number');
      }
      if (!Number.isFinite(taskIntervalMs) || taskIntervalMs <= 0) {
        throw new Error('--task-interval must be a positive number');
      }
      if (!Number.isFinite(auctionPollIntervalMs) || auctionPollIntervalMs <= 0) {
        throw new Error('--auction-poll-interval must be a positive number');
      }
      if (!Number.isFinite(emailPollIntervalMs) || emailPollIntervalMs <= 0) {
        throw new Error('--email-poll-interval must be a positive number');
      }

      let taskFilters: Record<string, unknown> = {};
      if (opts.taskFilters) {
        try {
          const parsed: unknown = JSON.parse(opts.taskFilters);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('must be a JSON object');
          }
          taskFilters = parsed as Record<string, unknown>;
        } catch (err) {
          throw new Error(`--task-filters: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const keystore = await loadKeystore();
      const address = keystore.walletAddress;

      let stopped = false;
      const abortController = new AbortController();

      const stop = () => {
        stopped = true;
        abortController.abort();
      };

      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);

      // Determine XMTP availability
      const xmtpRequested = opts.xmtp;
      const xmtpAvailable = xmtpRequested && !!keystore.xmtpInboxId;
      if (xmtpRequested && !keystore.xmtpInboxId) {
        process.stderr.write(
          'XMTP not initialized. Run `taskmarket xmtp init` first. Continuing without XMTP.\n'
        );
      }

      try {
        let xmtpClient: XmtpClientSession | undefined;
        if (xmtpAvailable) {
          xmtpClient = await createXmtpClient({
            walletAddress: keystore.walletAddress,
            existingInboxId: keystore.xmtpInboxId,
            existingInstallationId: keystore.xmtpInstallationId,
            existingDbPath: keystore.xmtpDbPath,
            keystore,
          });
        }

        const xmtpLoop = async (): Promise<void> => {
          if (!xmtpClient) return;
          await listenForEnvelopes({
            client: xmtpClient,
            shouldStop: () => stopped,
            signal: abortController.signal,
            onEnvelope: (envelope: AgentMessageEnvelope) => {
              printResult({ event: 'xmtp.envelope', ...envelope });
            },
          });
        };

        const heartbeatLoop = async (): Promise<void> => {
          if (!xmtpClient) return;
          const client: XmtpClientSession = xmtpClient;
          while (!stopped) {
            await sleepOrAbort(heartbeatIntervalMs, abortController.signal);
            if (stopped) break;
            try {
              await apiPost('/trpc/xmtp.heartbeat', {
                deviceId: keystore.deviceId,
                apiToken: keystore.apiToken,
                installationId: client.installationId,
              });
              printResult({ event: 'xmtp.heartbeat', installationId: client.installationId });
            } catch (err) {
              process.stderr.write(
                `Heartbeat failed: ${err instanceof Error ? err.message : String(err)}\n`
              );
            }
          }
        };

        const taskPollLoop = async (): Promise<void> => {
          const knownStatuses = new Map<string, string>();
          const seenTaskIds = new Set<string>();

          const buildTaskParams = (): URLSearchParams => {
            const params = new URLSearchParams();
            params.set('status', 'open');
            params.set('limit', '50');
            if (typeof taskFilters.mode === 'string') {
              params.set('mode', taskFilters.mode);
            }
            const tagsValue = taskFilters.tags;
            if (typeof tagsValue === 'string') {
              params.set('tags', tagsValue);
            } else if (Array.isArray(tagsValue)) {
              params.set('tags', tagsValue.join(','));
            }
            return params;
          };

          // Initialization: populate baseline without emitting events
          try {
            const inbox = (await apiGet(
              `/api/agents/inbox?address=${encodeURIComponent(address)}`
            )) as InboxResult;
            for (const task of [...inbox.asRequester, ...inbox.asWorker]) {
              knownStatuses.set(task.id, task.status);
            }
          } catch {
            // Non-fatal: will pick up on first real poll
          }

          try {
            const result = (await apiGet(`/api/tasks?${buildTaskParams().toString()}`)) as {
              tasks: TaskRow[];
              hasMore: boolean;
            };
            for (const task of result.tasks) {
              seenTaskIds.add(task.id);
            }
          } catch {
            // Non-fatal
          }

          const inboxPollLoop = async (): Promise<void> => {
            while (!stopped) {
              await sleepOrAbort(inboxIntervalMs, abortController.signal);
              if (stopped) break;
              try {
                const inbox = (await apiGet(
                  `/api/agents/inbox?address=${encodeURIComponent(address)}`
                )) as InboxResult;
                const allTasks = [...inbox.asRequester, ...inbox.asWorker];

                const nextStatuses = new Map<string, string>();
                for (const task of allTasks) {
                  nextStatuses.set(task.id, task.status);
                }

                const changes = diffTaskStatuses(knownStatuses, nextStatuses);
                for (const change of changes) {
                  const isRequester = inbox.asRequester.some((t) => t.id === change.taskId);
                  const role = isRequester ? 'requester' : 'worker';

                  let pendingActions: PendingAction[] = [];
                  try {
                    const detail = (await apiGet(`/api/tasks/${change.taskId}`)) as TaskDetail;
                    pendingActions = detail.pendingActions ?? [];
                  } catch {
                    // Non-fatal: emit without pendingActions
                  }

                  printResult({
                    event: 'task.status_changed',
                    taskId: change.taskId,
                    role,
                    from: change.from,
                    to: change.to,
                    pendingActions,
                  });
                  knownStatuses.set(change.taskId, change.to);
                }

                // Register newly seen tasks in knownStatuses
                for (const task of allTasks) {
                  if (!knownStatuses.has(task.id)) {
                    knownStatuses.set(task.id, task.status);
                  }
                }
              } catch (err) {
                process.stderr.write(
                  `Inbox poll failed: ${err instanceof Error ? err.message : String(err)}\n`
                );
              }
            }
          };

          const newTaskPollLoop = async (): Promise<void> => {
            while (!stopped) {
              await sleepOrAbort(taskIntervalMs, abortController.signal);
              if (stopped) break;
              try {
                const result = (await apiGet(`/api/tasks?${buildTaskParams().toString()}`)) as {
                  tasks: TaskRow[];
                  hasMore: boolean;
                };
                const newIds = collectNewTaskIds(result.tasks, seenTaskIds);
                const taskMap = new Map(result.tasks.map((t) => [t.id, t]));

                for (const id of newIds) {
                  const task = taskMap.get(id);
                  if (task) {
                    printResult({
                      event: 'task.new',
                      taskId: task.id,
                      description: task.description,
                      reward: task.reward,
                      mode: task.mode,
                      tags: task.tags,
                    });
                  }
                  seenTaskIds.add(id);
                }

                // Bound seenTaskIds to MAX_SEEN_TASK_IDS (LRU eviction of oldest entries)
                if (seenTaskIds.size > MAX_SEEN_TASK_IDS) {
                  const excess = seenTaskIds.size - MAX_SEEN_TASK_IDS;
                  const iter = seenTaskIds.values();
                  for (let i = 0; i < excess; i++) {
                    const next = iter.next();
                    if (!next.done) {
                      seenTaskIds.delete(next.value);
                    }
                  }
                }
              } catch (err) {
                process.stderr.write(
                  `New task poll failed: ${err instanceof Error ? err.message : String(err)}\n`
                );
              }
            }
          };

          const auctionPollLoop = async (): Promise<void> => {
            while (!stopped) {
              await sleepOrAbort(auctionPollIntervalMs, abortController.signal);
              if (stopped) break;
              try {
                let cursor: string | undefined;
                let hasMore = true;
                while (hasMore) {
                  const params = new URLSearchParams({
                    mode: 'auction',
                    status: 'open',
                    limit: '50',
                  });
                  if (cursor) params.set('cursor', cursor);
                  const result = (await apiGet(`/api/tasks?${params.toString()}`)) as {
                    tasks: AuctionTaskRow[];
                    hasMore: boolean;
                    nextCursor: string | null;
                  };
                  for (const task of result.tasks) {
                    if (task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch') {
                      printResult({
                        event: 'task.auction_clock',
                        taskId: task.id,
                        auctionType: task.auctionType,
                        currentAuctionPrice: task.currentAuctionPrice ?? null,
                        bidDeadline: task.bidDeadline ?? null,
                      });
                    }
                  }
                  cursor = result.nextCursor ?? undefined;
                  hasMore = result.hasMore && cursor !== undefined;
                }
              } catch (err) {
                process.stderr.write(
                  `Auction poll failed: ${err instanceof Error ? err.message : String(err)}\n`
                );
              }
            }
          };

          const emailPollLoop = async (): Promise<void> => {
            const PAGE_SIZE = 50;
            while (!stopped) {
              await sleepOrAbort(emailPollIntervalMs, abortController.signal);
              if (stopped) break;
              try {
                let hasMore = true;
                // Intentionally drains the full queue before sleeping — stop signals
                // are honoured after the current cycle completes, not mid-drain.
                while (hasMore) {
                  const params = new URLSearchParams({
                    deviceId: keystore.deviceId,
                    apiToken: keystore.apiToken,
                    limit: String(PAGE_SIZE),
                    unread: 'true',
                  });
                  const result = (await apiGet(
                    `/api/emails/list?${params.toString()}`
                  )) as EmailListResult;

                  for (const email of result.emails) {
                    printResult({
                      event: 'email.new',
                      id: email.id,
                      fromAddress: email.fromAddress,
                      subject: email.subject,
                      bodyText: email.bodyText,
                      receivedAt: email.receivedAt,
                    });

                    try {
                      await apiPost('/api/emails/mark-read', {
                        deviceId: keystore.deviceId,
                        apiToken: keystore.apiToken,
                        id: email.id,
                        read: true,
                      });
                    } catch (markErr) {
                      process.stderr.write(
                        `Email mark-read failed for ${email.id}: ${markErr instanceof Error ? markErr.message : String(markErr)}\n`
                      );
                    }
                  }

                  hasMore = result.emails.length === PAGE_SIZE;
                }
              } catch (err) {
                process.stderr.write(
                  `Email poll failed: ${err instanceof Error ? err.message : String(err)}\n`
                );
              }
            }
          };

          await Promise.allSettled([
            inboxPollLoop(),
            newTaskPollLoop(),
            auctionPollLoop(),
            emailPollLoop(),
          ]);
        };

        await Promise.allSettled([xmtpLoop(), heartbeatLoop(), taskPollLoop()]);
      } finally {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
      }
    }
  );
