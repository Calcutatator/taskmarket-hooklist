import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DropClock } from './drop-clock';

describe('DropClock hydration', () => {
  it('keeps the absolute reduced-motion deadline stable through hydration', async () => {
    const source = '2026-07-28T01:30:00.000Z';
    const element = <DropClock source={source} />;
    const serverHtml = renderToString(element);
    const container = document.createElement('div');
    const recoverableErrors: unknown[] = [];
    container.innerHTML = serverHtml;

    expect(container.textContent).toContain('UTC');

    const root = hydrateRoot(container, element, {
      onRecoverableError: (error) => recoverableErrors.push(error),
    });
    await act(async () => {});

    expect(recoverableErrors).toEqual([]);
    expect(container.textContent).toContain('UTC');

    await act(async () => root.unmount());
  });
});
