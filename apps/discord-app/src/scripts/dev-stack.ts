import express from 'express';

const mockPort = Number(process.env.DISCORD_MOCK_API_PORT ?? 3006);
process.env.DISCORD_TASKMARKET_API_URL ??= `http://127.0.0.1:${mockPort}`;

const mockApi = express();
mockApi.get('/api/tasks', (_request, response) => {
  response.json({
    hasMore: false,
    nextCursor: null,
    tasks: [
      {
        description: 'Build the highest-paying fixture',
        expiryTime: '2030-01-01T00:00:00.000Z',
        id: 'top-open-task',
        mode: 'bounty',
        reward: '25000000',
        status: 'open',
        tags: ['fixture'],
        taskVisibility: 'public',
      },
    ],
  });
});
mockApi.get('/api/tasks/:taskId', (request, response) => {
  if (request.params.taskId === 'missing-task') {
    response.status(404).json(null);
    return;
  }

  response.json({
    description:
      request.params.taskId === 'unlisted-task'
        ? 'Fixture that must never render in Discord'
        : 'Build a safe Taskmarket integration',
    expiryTime: '2030-01-01T00:00:00.000Z',
    id: request.params.taskId,
    mode: 'bounty',
    reward: '5000000',
    status: 'open',
    tags: ['fixture'],
    taskVisibility: request.params.taskId === 'unlisted-task' ? 'unlisted' : 'public',
  });
});
mockApi.get('/api/task-drops/directory', (_request, response) => {
  response.json({
    items: [
      {
        availableTaskCount: 1,
        drop: { id: 'open-fixture-drop', name: 'Open Fixture Task Drop' },
      },
    ],
    nextCursor: null,
  });
});
mockApi.get('/api/task-drops/:dropId', (request, response) => {
  response.json({
    drop: { id: request.params.dropId, name: 'Fixture Task Drop' },
    tasks:
      request.params.dropId === 'empty-drop'
        ? []
        : [
            {
              description: 'Build a public fixture',
              id: 'public-task',
              mode: 'bounty',
              reward: '5000000',
              status: 'open',
            },
          ],
  });
});

mockApi.listen(mockPort, () => {
  process.stdout.write(`Discord fixture API listening on port ${mockPort}\n`);
});

await import('../server');
