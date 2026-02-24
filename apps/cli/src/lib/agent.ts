import { API_URL } from './api.js';

export async function pollAgentId(address: string, maxWaitMs = 60_000): Promise<string | null> {
  const interval = 3_000;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    try {
      const res = await fetch(`${API_URL}/api/identity/status?address=${address}`);
      if (res.ok) {
        const data = (await res.json()) as { agentId?: string | null };
        if (data.agentId) return data.agentId;
      }
    } catch {
      // ignore transient errors, keep polling
    }
  }
  return null;
}
