import { describe, expect, it } from 'vitest';

import {
  OfficialTaskDropAnnouncementEmail,
  OfficialTaskDropsWelcomeEmail,
  renderTaskmarketEmail,
  TaskDropNewTaskEmail,
  TaskDropsWelcomeEmail,
} from '../../../src/emails/task-drops';

const UNSUBSCRIBE_URL = 'https://api.taskmarket.example/task-drops/unsubscribe?id=sub-1&token=abc';

describe('Task Drops email templates', () => {
  it('renders the welcome email as styled HTML and plain text', async () => {
    const rendered = await renderTaskmarketEmail(
      TaskDropsWelcomeEmail({
        dashboardUrl: 'https://market.taskmarket.example/dashboard',
        dropName: 'Docs QA',
        dropUrl: 'https://market.taskmarket.example/drops/drop-1',
        unsubscribeUrl: UNSUBSCRIBE_URL,
      })
    );

    expect(rendered.bodyHtml).toContain('Following Docs QA');
    expect(rendered.bodyHtml).toContain('background-color:#0d0b0f');
    expect(rendered.bodyHtml).toContain(UNSUBSCRIBE_URL.replaceAll('&', '&amp;'));
    expect(rendered.bodyText).toContain('FOLLOWING DOCS QA');
    expect(rendered.bodyText).toContain('Unsubscribe');
  });

  it('renders a new task drop with task details and CTA', async () => {
    const rendered = await renderTaskmarketEmail(
      TaskDropNewTaskEmail({
        description: 'Build a latency benchmark dashboard',
        dropName: 'Docs QA',
        mode: 'bounty',
        rewardLabel: '$25',
        tags: ['benchmark', 'dashboard'],
        taskId: '0xabc',
        taskUrl: 'https://market.taskmarket.example/dashboard/tasks/0xabc',
        unsubscribeUrl: UNSUBSCRIBE_URL,
      })
    );

    expect(rendered.bodyHtml).toContain('New task in Docs QA');
    expect(rendered.bodyHtml).toContain('Build a latency benchmark dashboard');
    expect(rendered.bodyHtml).toContain('$25');
    expect(rendered.bodyHtml).toContain('bounty');
    expect(rendered.bodyHtml).toContain('benchmark, dashboard');
    expect(rendered.bodyText).toContain('View task');
  });

  it('renders official welcome consent and cadence copy', async () => {
    const { bodyText } = await renderTaskmarketEmail(
      OfficialTaskDropsWelcomeEmail({
        taskDropsUrl: 'https://taskmarket.example/taskdrop',
        unsubscribeUrl: UNSUBSCRIBE_URL,
      })
    );

    expect(bodyText).toContain('one announcement');
    expect(bodyText).toContain('all official Task Drops');
  });

  it('renders an official launch with task summaries and rewards', async () => {
    const { bodyText } = await renderTaskmarketEmail(
      OfficialTaskDropAnnouncementEmail({
        announcedAt: '2026-07-15T00:00:00.000Z',
        description: 'A coordinated launch.',
        dropName: 'Cosmos',
        dropUrl: 'https://taskmarket.example/drops/drop-1',
        tasks: [{ description: 'Audit the docs', mode: 'bounty', rewardLabel: '25 USDC' }],
        unsubscribeUrl: UNSUBSCRIBE_URL,
      })
    );

    expect(bodyText).toContain('COSMOS IS LIVE');
    expect(bodyText).toContain('Audit the docs');
    expect(bodyText).toContain('25 USDC');
    expect(bodyText).toContain('all official Task Drops');
  });
});
