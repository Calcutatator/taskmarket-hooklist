/**
 * Agent directory smoke test: create task → submit → accept → rate → verify directory
 *
 * Steps:
 *  1. Register identities for requester and worker
 *  2. Create a task with tags ['python', 'smoke-test']
 *  3. Worker submits work
 *  4. Requester accepts submission (triggers skill population)
 *  5. Requester rates the worker
 *  6. Verify agent appears in leaderboard
 *  7. Verify sort=tasks ordering
 *  8. Verify skill=python filter
 *  9. Verify search by agentId
 * 10. Verify stats lookup by agentId
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-agents.ts
 */
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402';

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Agent Directory ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Register identities (idempotent)
  log('1/10', 'Registering requester identity (X402)...');
  const reqReg = (await x402Post('/api/identity/register', {}, requester)) as {
    agentId: string;
    alreadyRegistered: boolean;
  };
  ok('requester agentId', reqReg.agentId);

  log('1b/10', 'Registering worker identity (X402)...');
  const workerReg = (await x402Post('/api/identity/register', {}, worker)) as {
    agentId: string;
    alreadyRegistered: boolean;
  };
  ok('worker agentId', workerReg.agentId);
  const workerAgentId = workerReg.agentId;

  // 2. Create task with skill tags
  log('2/10', 'Creating task with tags: python, smoke-test (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Write a Python script that prints hello world',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['python', 'smoke-test'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 3. Worker submits
  log('3/10', 'Worker submitting work...');
  const submitSig = await worker.signMessage({ message: `taskmarket:submit:${taskId}` });
  const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    artifacts: [
      {
        fileName: 'solution.py',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from('print("hello world")').toString('base64'),
      },
    ],
    signature: submitSig,
  })) as { submissionId: string };
  ok('submissionId', submissionId);

  // 4. Requester accepts (this triggers skill population from task tags)
  log('4/10', 'Requester accepting submission (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  // Wait for indexer to process TaskCompleted event before rating
  for (let i = 0; i < 20; i++) {
    const t = (await get(`/api/tasks/${taskId}`)) as { status: string };
    if (t.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 3000));
  }

  // 5. Requester rates
  log('5/10', 'Requester rating 90/100 (X402)...');
  const { feedbackId } = (await x402Post(
    `/api/tasks/${taskId}/rate`,
    {
      taskId,
      worker: worker.address,
      rating: 90,
      feedbackText: 'Great Python work.',
    },
    requester
  )) as { feedbackId: string };
  ok('feedbackId', feedbackId);

  // 6. Verify worker appears in default leaderboard
  log('6/10', 'Verifying worker in leaderboard (default sort)...');
  const leaderboard = (await get('/api/agents/leaderboard')) as {
    address: string;
    agentId: string | null;
    completedTasks: number;
    skills: string[];
  }[];

  const workerEntry = leaderboard.find(
    (a) => a.address.toLowerCase() === worker.address.toLowerCase()
  );
  if (!workerEntry) {
    throw new Error(`Worker ${worker.address} not found in leaderboard`);
  }
  ok('worker in leaderboard', true);
  ok('completedTasks', workerEntry.completedTasks);
  ok('skills', workerEntry.skills);

  // 7. Verify sort=tasks ordering
  log('7/10', 'Verifying sort=tasks...');
  const byTasks = (await get('/api/agents/leaderboard?sort=tasks')) as {
    address: string;
    completedTasks: number;
  }[];
  if (byTasks.length === 0) throw new Error('Empty leaderboard with sort=tasks');
  ok('sort=tasks results', byTasks.length);

  // 8. Verify skill=python filter
  log('8/10', 'Verifying skill=python filter...');
  const bySkill = (await get('/api/agents/leaderboard?skill=python')) as {
    address: string;
    skills: string[];
  }[];
  const workerInSkill = bySkill.find(
    (a) => a.address.toLowerCase() === worker.address.toLowerCase()
  );
  if (!workerInSkill) {
    throw new Error('Worker not found in skill=python filtered results');
  }
  ok('worker found with skill=python', true);
  ok('worker skills', workerInSkill.skills);

  // 9. Verify search by agentId
  log('9/10', 'Verifying search by agentId...');
  const bySearch = (await get(
    `/api/agents/leaderboard?search=${encodeURIComponent(workerAgentId)}`
  )) as { address: string; agentId: string | null }[];
  const foundByAgentId = bySearch.find(
    (a) => a.address.toLowerCase() === worker.address.toLowerCase()
  );
  if (!foundByAgentId) {
    throw new Error(`Worker not found when searching by agentId ${workerAgentId}`);
  }
  ok('worker found by agentId search', true);

  // 10. Verify stats by agentId
  log('10/10', 'Verifying stats lookup by agentId...');
  const stats = (await get(`/api/agents/stats?agentId=${encodeURIComponent(workerAgentId)}`)) as {
    address: string;
    agentId: string | null;
    completedTasks: number;
    skills: string[];
  };
  if (stats.completedTasks < 1) {
    throw new Error(`Expected completedTasks >= 1, got ${stats.completedTasks}`);
  }
  if (!stats.skills.includes('python')) {
    throw new Error(`Expected skills to include 'python', got: ${JSON.stringify(stats.skills)}`);
  }
  ok('stats.completedTasks', stats.completedTasks);
  ok('stats.skills', stats.skills);
  ok('stats.agentId', stats.agentId);

  console.log('\n=== Agent directory smoke test passed ===');
  console.log('taskId:', taskId);
  console.log('workerAgentId:', workerAgentId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});
