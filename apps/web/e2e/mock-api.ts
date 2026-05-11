import { createServer, type ServerResponse } from 'node:http';

const now = new Date('2026-01-01T00:00:00.000Z').toISOString();

const tasks = [
  {
    bidDeadline: null,
    claimedAt: null,
    claimedBy: null,
    createdAt: now,
    description: 'Audit agent settlement receipts and flag duplicate submissions.',
    escrowTxHash: '0xe2e1',
    expiryTime: now,
    id: 'e2e-task-1',
    maxPrice: null,
    metricDescription: null,
    metricTarget: null,
    mode: 'bounty',
    platformFeeBps: 250,
    pitchDeadline: null,
    rating: null,
    requester: '0x8f12A4c661F9b365D408bF4a3Dd079fd9a5E2011',
    requesterPubkey: '0x8f12A4c661F9b365D408bF4a3Dd079fd9a5E2011',
    reward: '240000000',
    pitchCount: 1,
    status: 'open',
    stakeBps: 0,
    stakeRequired: false,
    submissionCount: 2,
    tags: ['analysis', 'verification'],
    worker: null,
  },
  {
    auctionBidCount: 3,
    auctionType: 'english',
    bidDeadline: null,
    claimedAt: null,
    claimedBy: null,
    createdAt: now,
    description: 'Build a typed parser for agent capability manifests.',
    escrowTxHash: '0xe2e2',
    expiryTime: now,
    id: 'e2e-task-2',
    maxPrice: null,
    metricDescription: null,
    metricTarget: null,
    mode: 'auction',
    platformFeeBps: 250,
    pitchDeadline: null,
    rating: null,
    requester: '0x597b0e7F366D9f985E03C8BdaF014C96a5985e4B',
    requesterPubkey: '0x597b0e7F366D9f985E03C8BdaF014C96a5985e4B',
    reward: '850000000',
    pitchCount: 0,
    status: 'open',
    stakeBps: 0,
    stakeRequired: false,
    submissionCount: 0,
    tags: ['typescript', 'agents'],
    worker: null,
  },
];

const agents = [
  {
    address: '0x1111111111111111111111111111111111111111',
    agentId: '1001',
    averageRating: 4.8,
    completedTasks: 28,
    emailAddress: 'agent-one@example.com',
    rank: 1,
    skills: ['typescript', 'analysis'],
    totalEarnings: '1825000000',
  },
  {
    address: '0x2222222222222222222222222222222222222222',
    agentId: '1002',
    averageRating: 4.5,
    completedTasks: 17,
    emailAddress: 'agent-two@example.com',
    rank: 2,
    skills: ['solidity', 'testing'],
    totalEarnings: '940000000',
  },
];

export const taskListResponse = {
  hasMore: false,
  nextCursor: null,
  tasks,
};

function writeJson(serverResponse: ServerResponse, body: unknown, status = 200) {
  serverResponse.writeHead(status, {
    'access-control-allow-origin': '*',
    'content-type': 'application/json',
  });
  serverResponse.end(JSON.stringify(body));
}

export async function startMockApiServer(port = Number(process.env.E2E_MOCK_API_PORT ?? 3101)) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

    if (url.pathname === '/api/tasks/stats') {
      writeJson(response, {
        count: tasks.length,
        totalRewards: tasks.reduce((total, task) => total + BigInt(task.reward), 0n).toString(),
      });
      return;
    }

    if (url.pathname === '/api/agents/count') {
      writeJson(response, { count: agents.length });
      return;
    }

    if (url.pathname === '/api/tasks') {
      writeJson(response, taskListResponse);
      return;
    }

    if (url.pathname === '/api/agents/leaderboard') {
      writeJson(response, agents);
      return;
    }

    writeJson(response, { error: 'Not found' }, 404);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
