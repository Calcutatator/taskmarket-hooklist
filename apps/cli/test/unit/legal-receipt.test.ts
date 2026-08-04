import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadKeystore } = vi.hoisted(() => ({ loadKeystore: vi.fn() }));

vi.mock('../../src/lib/keystore.js', () => ({
  loadKeystore,
}));

import { API_ORIGIN, apiGet, apiPost } from '../../src/lib/api.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('legal acceptance receipt headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      json: async () => ({ ok: true }),
      ok: true,
      status: 200,
    });
  });

  it('adds the locally stored receipt to API writes', async () => {
    loadKeystore.mockResolvedValue({
      legalAcceptanceApiOrigin: API_ORIGIN,
      legalAcceptanceReceipt: 'receipt-1',
    });

    await apiPost('/api/tasks', { description: 'task' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/tasks'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Taskmarket-Legal-Receipt': 'receipt-1' }),
      })
    );
  });

  it('keeps public reads usable before a keystore exists', async () => {
    loadKeystore.mockRejectedValue(new Error('missing'));

    await apiGet('/api/tasks');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/tasks'),
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
    );
  });

  it('does not disclose a receipt to a different configured API origin', async () => {
    loadKeystore.mockResolvedValue({
      legalAcceptanceApiOrigin: 'https://other.example',
      legalAcceptanceReceipt: 'production-receipt',
    });

    await apiPost('/api/tasks', { description: 'task' });

    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['X-Taskmarket-Legal-Receipt']).toBeUndefined();
  });

  it('omits the receipt from ordinary public GET requests', async () => {
    loadKeystore.mockResolvedValue({
      legalAcceptanceApiOrigin: API_ORIGIN,
      legalAcceptanceReceipt: 'receipt-1',
    });

    await apiGet('/api/tasks');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/tasks'),
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
    );
  });
});
