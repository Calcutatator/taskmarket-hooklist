/**
 * Rater agent ID smoke test: verifies requesterAgentId is stored on tasks and used
 * in the on-chain rateTask call when the requester has a registered ERC-8004 identity.
 *
 * Flow:
 *   1. Register requester identity (idempotent)
 *   2. Create bounty task
 *   3. Verify task.requesterAgentId is non-null
 *   4. Worker submits work
 *   5. Requester accepts (X402) — triggers AcceptanceFacet's giveFeedback() try/catch
 *      against the real (cloned) ERC-8004 reputation registry
 *   6. Verify ReputationFeedbackFailed was NOT emitted -- proves the reputation
 *      registry the sandbox wired in actually works end to end, not just that the
 *      try/catch swallows failures gracefully (see the Solidity unit tests in
 *      packages/contracts/test/TaskMarket.t.sol for that side of the coverage)
 *   7. Requester rates (X402)
 *   8. Verify feedback file has correct value
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-rater-agent-id.ts
 */
import { createHash } from 'crypto';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { baseSepolia } from 'viem/chains';
import { buildSubmitMessage } from '@taskmarket/shared';
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402';

function contentHash(payload: string): string {
  return createHash('sha256').update(Buffer.from(payload)).digest('hex');
}

const RPC_URL = process.env.FORGE_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS as `0x${string}` | undefined;
const reputationFeedbackFailedEvent = parseAbiItem(
  'event ReputationFeedbackFailed(bytes32 indexed taskId, uint256 indexed agentId)'
);

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Rater Agent ID ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Register requester identity (idempotent — safe to re-run)
  log('1/7', 'Registering requester ERC-8004 identity (X402)...');
  const regResult = (await x402Post('/api/identity/register', {}, requester)) as {
    agentId: string;
    alreadyRegistered: boolean;
  };
  if (!regResult.agentId) {
    throw new Error(`Missing agentId in registration response: ${JSON.stringify(regResult)}`);
  }
  ok('requesterAgentId', regResult.agentId);
  ok('alreadyRegistered', regResult.alreadyRegistered);

  // 2. Register worker identity (so workerAgentId is also populated in feedback)
  log('2/7', 'Registering worker ERC-8004 identity (X402)...');
  const workerReg = (await x402Post('/api/identity/register', {}, worker)) as {
    agentId: string;
    alreadyRegistered: boolean;
  };
  ok('workerAgentId', workerReg.agentId);

  // 3. Create bounty task — server resolves requester's agentId and stores it
  log('3/7', 'Creating bounty task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Rater agent ID smoke test task',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-rater-agent-id'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 4. Verify task has requesterAgentId populated
  log('4/7', 'Verifying task.requesterAgentId is set...');
  const taskDetail = (await get(`/api/tasks/${taskId}`)) as {
    requesterAgentId: string | null;
  };
  if (!taskDetail.requesterAgentId) {
    throw new Error(
      `Expected requesterAgentId to be set (requester has registered identity), got: ${taskDetail.requesterAgentId}`
    );
  }
  if (taskDetail.requesterAgentId !== regResult.agentId) {
    throw new Error(
      `requesterAgentId mismatch: task has ${taskDetail.requesterAgentId}, expected ${regResult.agentId}`
    );
  }
  ok('requesterAgentId on task', taskDetail.requesterAgentId);

  // 5. Worker submits work
  log('5/7', 'Worker submitting work...');
  const submitPayload = 'rater-agent-id-smoke-payload';
  const submitSig = await worker.signMessage({
    message: buildSubmitMessage(taskId, [contentHash(submitPayload)]),
  });
  const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    artifacts: [
      {
        fileName: 'submission.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from(submitPayload).toString('base64'),
      },
    ],
    signature: submitSig,
  })) as { submissionId: string };
  ok('submissionId', submissionId);

  // 6. Requester accepts — this is what actually triggers AcceptanceFacet's
  //    giveFeedback() try/catch against the configured reputation registry
  //    (requesterAgentId is non-zero, so the path isn't skipped).
  log('6/8', 'Requester accepting submission (X402)...');
  if (!CONTRACT_ADDRESS) {
    throw new Error('Missing CONTRACT_ADDRESS (needed to check for ReputationFeedbackFailed)');
  }
  const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
  const blockBeforeAccept = await client.getBlockNumber();
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  // Wait for indexer to process TaskCompleted event before rating
  for (let i = 0; i < 20; i++) {
    const t = (await get(`/api/tasks/${taskId}`)) as { status: string };
    if (t.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 3000));
  }

  // 7. Verify the reputation registry actually worked -- ReputationFeedbackFailed must
  //    NOT have been emitted for this taskId. A silent catch with no event is exactly
  //    what let the real mainnet misconfiguration (reputationRegistry pointed at the
  //    wrong ERC-8004 registry) go unnoticed for the diamond's entire mainnet lifetime.
  log('7/8', 'Verifying ReputationFeedbackFailed was not emitted...');
  const failureLogs = await client.getLogs({
    address: CONTRACT_ADDRESS,
    event: reputationFeedbackFailedEvent,
    args: { taskId: taskId as `0x${string}` },
    fromBlock: blockBeforeAccept,
    toBlock: 'latest',
  });
  if (failureLogs.length > 0) {
    // viem getLogs results carry bigint fields (blockNumber, etc.) that JSON.stringify
    // throws on by default -- stringify with a replacer that renders them as strings.
    const serializableLogs = JSON.stringify(failureLogs, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
    throw new Error(
      `ReputationFeedbackFailed fired for this task -- the reputation registry rejected giveFeedback(): ${serializableLogs}`
    );
  }
  ok('ReputationFeedbackFailed not emitted', true);

  // 8. Requester rates — raterAgentId is derived server-side from task.requesterAgentId
  log('8/8', 'Requester rating 90/100 (X402) — raterAgentId used server-side...');
  const { feedbackId } = (await x402Post(
    `/api/tasks/${taskId}/rate`,
    {
      taskId,
      worker: worker.address,
      rating: 90,
      feedbackText: 'Rater agent ID smoke test feedback.',
    },
    requester
  )) as { feedbackId: string };
  ok('feedbackId', feedbackId);

  const feedbackFile = (await get(`/api/feedback/${feedbackId}`)) as Record<string, unknown>;
  if (typeof feedbackFile !== 'object' || feedbackFile.value !== 90) {
    throw new Error(`Feedback file invalid: ${JSON.stringify(feedbackFile)}`);
  }
  ok('feedbackFile.value', feedbackFile.value);
  ok('feedbackFile.agentId', feedbackFile.agentId);

  console.log('\n=== Rater agent ID smoke test passed ===');
  console.log('taskId:', taskId);
  console.log('requesterAgentId:', taskDetail.requesterAgentId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});
