// @vitest-environment node

import { ImageResponse } from 'next/og';
import { describe, expect, it } from 'vitest';

import { OgCard } from '@/lib/og-card';
import { ogImageSize } from '@/lib/seo';

async function renderOgCard(props: Parameters<typeof OgCard>[0]) {
  const response = new ImageResponse(<OgCard {...props} />, ogImageSize);
  const image = await response.arrayBuffer();

  expect(response.headers.get('content-type')).toContain('image/png');
  expect(image.byteLength).toBeGreaterThan(1000);
}

describe('OgCard image rendering', () => {
  it('renders the default marketplace card through next/og', async () => {
    await renderOgCard({
      description: 'Taskmarket is a marketplace for paid autonomous agent work.',
      eyebrow: 'Agent work',
      metrics: [
        { label: 'Escrow', value: 'USDC' },
        { label: 'Modes', value: '5' },
        { label: 'Network', value: 'Base' },
      ],
      title: 'Paid work for autonomous agents',
    });
  });

  it('renders dynamic task and agent cards through next/og', async () => {
    await renderOgCard({
      description: 'Bounty task. Reward: 125.000 USDC. Status: open. Tags: seo, images.',
      eyebrow: 'Task',
      metrics: [
        { label: 'Reward', value: '125.000 USDC' },
        { label: 'Mode', value: 'reverse english' },
        { label: 'Status', value: 'pending approval' },
      ],
      title: 'Build a reliable OG image renderer.',
    });

    await renderOgCard({
      description:
        '12 completed tasks. Rating: 4.8. Total earned: 1,250.000 USDC. Skills: typescript, analysis.',
      eyebrow: 'Agent',
      metrics: [
        { label: 'Tasks', value: '12' },
        { label: 'Rating', value: '4.8' },
        { label: 'Earned', value: '1,250.000 USDC' },
      ],
      title: 'PhotonGlowPhantom',
    });
  });

  it('renders a card with an overflowing single-word title without throwing', async () => {
    await renderOgCard({
      description:
        'A long description that should clamp to two lines and end with an ellipsis when it exceeds the available space inside the card body region.',
      eyebrow: 'Agent',
      metrics: [
        { label: 'Tasks', value: '128' },
        { label: 'Rating', value: '4.9' },
        { label: 'Earned', value: '1,250.000 USDC' },
      ],
      title: 'SuperLongAgentNameThatKeepsGoingAndGoingPhotonGlowPhantomMaximumOverdrive9000',
    });
  });
});
