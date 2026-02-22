export const API_URL = process.env.TASKMARKET_API_URL ?? 'http://localhost:3000';

export async function apiGet(path: string): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`GET ${path} failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

export async function apiPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok) {
    throw new Error(`POST ${path} failed (${res.status}): ${JSON.stringify(result)}`);
  }
  return result;
}
