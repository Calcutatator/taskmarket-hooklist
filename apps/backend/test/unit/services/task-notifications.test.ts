import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/mailer', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('../../../src/services/agent-targeting', () => ({
  selectTargetAgents: vi.fn(),
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    EMAIL_DOMAIN: 'mail.taskmarket.xyz',
    NODE_ENV: 'test',
  }),
}));

vi.mock('../../../src/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), http: vi.fn() },
}));

import { notifyNewTask, buildNewTaskEmail } from '../../../src/services/task-notifications';
import { sendEmail } from '../../../src/services/mailer';
import { selectTargetAgents } from '../../../src/services/agent-targeting';

const TASK_ID = '0x' + 'a'.repeat(64);

function makeRecipients(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    address: `0xworker${i}`,
    emailAddress: `worker${i}@mail.taskmarket.xyz`,
  }));
}

// A minimal db stub; selectTargetAgents and sendEmail are both mocked so the db is
// never actually queried here.
const db = {} as any;

describe('task-notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildNewTaskEmail', () => {
    it('embeds the taskId, reward, mode, tags, snippet and a task link', () => {
      const { subject, bodyText } = buildNewTaskEmail({
        taskId: TASK_ID,
        description: 'Design a logo for a coffee brand',
        reward: '1500000',
        mode: 'bounty',
        tags: ['design', 'logo'],
      });

      expect(subject).toContain('New task');
      expect(bodyText).toContain(TASK_ID);
      expect(bodyText).toContain('$1.5');
      expect(bodyText).toContain('bounty');
      expect(bodyText).toContain('design, logo');
      expect(bodyText).toContain('Design a logo for a coffee brand');
      expect(bodyText).toContain(`/dashboard/tasks/${TASK_ID}`);
    });

    it('formats whole-dollar rewards without a fractional part', () => {
      const { bodyText } = buildNewTaskEmail({
        taskId: TASK_ID,
        description: 'x',
        reward: '80000000',
        mode: 'bounty',
      });
      expect(bodyText).toContain('$80');
      expect(bodyText).not.toContain('$80.');
    });

    it('truncates a long description snippet', () => {
      const long = 'a'.repeat(1000);
      const { bodyText } = buildNewTaskEmail({
        taskId: TASK_ID,
        description: long,
        reward: '1000000',
        mode: 'bounty',
      });
      expect(bodyText).toContain('...');
      expect(bodyText.length).toBeLessThan(long.length);
    });
  });

  describe('notifyNewTask', () => {
    it('targets agents by skills matching tags when tags exist', async () => {
      vi.mocked(selectTargetAgents).mockResolvedValueOnce(makeRecipients(2));
      vi.mocked(sendEmail).mockResolvedValue(undefined);

      const result = await notifyNewTask({
        db,
        taskId: TASK_ID,
        description: 'Design work',
        reward: '1000000',
        mode: 'bounty',
        tags: ['design', 'logo'],
      });

      expect(selectTargetAgents).toHaveBeenCalledTimes(1);
      expect(selectTargetAgents).toHaveBeenCalledWith(db, { skills: ['design', 'logo'] });
      expect(result).toEqual({ sent: 2, failed: 0, total: 2 });
      expect(sendEmail).toHaveBeenCalledTimes(2);
    });

    it('falls back to all eligible agents when there are no tags', async () => {
      vi.mocked(selectTargetAgents).mockResolvedValueOnce(makeRecipients(1));
      vi.mocked(sendEmail).mockResolvedValue(undefined);

      await notifyNewTask({
        db,
        taskId: TASK_ID,
        description: 'Anything',
        reward: '1000000',
        mode: 'bounty',
        tags: [],
      });

      expect(selectTargetAgents).toHaveBeenCalledWith(db, {});
    });

    it('falls back to all eligible agents when tags are null', async () => {
      vi.mocked(selectTargetAgents).mockResolvedValueOnce(makeRecipients(1));
      vi.mocked(sendEmail).mockResolvedValue(undefined);

      await notifyNewTask({
        db,
        taskId: TASK_ID,
        description: 'Anything',
        reward: '1000000',
        mode: 'bounty',
        tags: null,
      });

      expect(selectTargetAgents).toHaveBeenCalledWith(db, {});
    });

    it('sends one email per recipient with the same idempotent taskId body', async () => {
      vi.mocked(selectTargetAgents).mockResolvedValueOnce(makeRecipients(3));
      vi.mocked(sendEmail).mockResolvedValue(undefined);

      await notifyNewTask({
        db,
        taskId: TASK_ID,
        description: 'Work',
        reward: '1000000',
        mode: 'pitch',
        tags: ['x'],
      });

      expect(sendEmail).toHaveBeenCalledTimes(3);
      for (const call of vi.mocked(sendEmail).mock.calls) {
        expect(call[0].bodyText).toContain(TASK_ID);
        expect(call[0].from).toBe('noreply@mail.taskmarket.xyz');
      }
    });

    it('isolates send failures and counts them without throwing', async () => {
      vi.mocked(selectTargetAgents).mockResolvedValueOnce(makeRecipients(2));
      vi.mocked(sendEmail)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('relay down'));

      const result = await notifyNewTask({
        db,
        taskId: TASK_ID,
        description: 'Work',
        reward: '1000000',
        mode: 'bounty',
        tags: ['x'],
      });

      expect(result).toEqual({ sent: 1, failed: 1, total: 2 });
    });

    it('does nothing and sends no email when there are no recipients', async () => {
      vi.mocked(selectTargetAgents).mockResolvedValueOnce([]);

      const result = await notifyNewTask({
        db,
        taskId: TASK_ID,
        description: 'Work',
        reward: '1000000',
        mode: 'bounty',
        tags: ['x'],
      });

      expect(result).toEqual({ sent: 0, failed: 0, total: 0 });
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });
});
