import { describe, expect, it } from 'vitest';

import { getBrowserApiBaseUrl, getServerApiBaseUrl } from './config';

describe('api connection config', () => {
  it('uses same-origin browser calls unless a public API URL is configured', () => {
    expect(getBrowserApiBaseUrl({} as NodeJS.ProcessEnv)).toBe('');

    expect(
      getBrowserApiBaseUrl({
        NEXT_PUBLIC_API_URL: 'https://api.taskmarket.example',
      } as unknown as NodeJS.ProcessEnv)
    ).toBe('https://api.taskmarket.example');
  });

  it('lets server fetches use a private backend URL before falling back to public or local URLs', () => {
    expect(
      getServerApiBaseUrl({
        TASKMARKET_API_URL: 'https://internal.taskmarket.example',
      } as unknown as NodeJS.ProcessEnv)
    ).toBe('https://internal.taskmarket.example');

    expect(
      getServerApiBaseUrl({
        NEXT_PUBLIC_API_URL: 'https://public.taskmarket.example',
      } as unknown as NodeJS.ProcessEnv)
    ).toBe('https://public.taskmarket.example');

    expect(getServerApiBaseUrl({} as NodeJS.ProcessEnv)).toBe('http://127.0.0.1:3000');
  });
});
