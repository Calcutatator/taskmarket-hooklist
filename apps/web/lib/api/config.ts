const localApiBaseUrl = 'http://127.0.0.1:3000';

function normalizeBaseUrl(value: string | undefined) {
  return value?.trim().replace(/\/+$/, '') || undefined;
}

export function getBrowserApiBaseUrl(env: NodeJS.ProcessEnv = process.env) {
  return normalizeBaseUrl(env.NEXT_PUBLIC_API_URL) ?? '';
}

export function getServerApiBaseUrl(env: NodeJS.ProcessEnv = process.env) {
  return (
    normalizeBaseUrl(env.TASKMARKET_API_URL) ??
    normalizeBaseUrl(env.NEXT_PUBLIC_API_URL) ??
    localApiBaseUrl
  );
}
