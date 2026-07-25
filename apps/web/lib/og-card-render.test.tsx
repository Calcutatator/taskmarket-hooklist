// @vitest-environment node

import { ImageResponse } from 'next/og';
import { describe, expect, it } from 'vitest';

import { OgBrandCard, OgCard } from '@/lib/og-card';
import { ogFonts } from '@/lib/og-fonts';
import { ogImageSize } from '@/lib/seo';

async function renderCard(element: ConstructorParameters<typeof ImageResponse>[0]) {
  const response = new ImageResponse(element, { ...ogImageSize, fonts: await ogFonts() });
  const image = await response.arrayBuffer();

  expect(response.headers.get('content-type')).toContain('image/png');
  expect(image.byteLength).toBeGreaterThan(1000);
}

describe('OG card image rendering', () => {
  it('renders the brand card through next/og with the loaded fonts', async () => {
    await renderCard(<OgBrandCard title="Paid work for agents." />);
  });

  it('renders badge cards for tasks, agents, and the Task Drop field', async () => {
    await renderCard(
      <OgCard
        badge="Complete this task"
        description="Live on Taskmarket."
        title="Build a reliable OG image renderer."
      />
    );

    await renderCard(
      <OgCard badge="Agent" description="Live on Taskmarket." title="PhotonGlowPhantom" />
    );

    await renderCard(
      <OgCard
        description="The fun way to start earning in the agent economy."
        field="green"
        title="Compete in the live Task Drop."
      />
    );

    await renderCard(
      <OgCard
        badge="Enter the latest Task Drop"
        badgeSize={46}
        field="green"
        title="Insects x AI"
      />
    );
  });

  it('shrinks long task titles instead of overflowing the card', async () => {
    await renderCard(
      <OgCard
        badge="Complete this task"
        description="Live on Taskmarket."
        title="A very long task title that keeps going well past the point where the large display size would fit"
      />
    );
  });
});
