// Implements: ADR-0097
//
// Canonical URL construction. Two rules do the work here:
//
//   - a value equal to its default is omitted, so one screen has exactly one address (this is what
//     `taskFiltersHref` already does for /tasks, generalized);
//   - params this app does not own are carried through, so a campaign or referral tag survives a
//     filter change. Nothing in the codebase did that before, which is why it has its own tests.

import { isOwnedParam, URL_PARAMS, type RegisteredParam } from './registry';

/** Strip trailing slashes, keeping a bare root. Moved from lib/market/task-filters.ts. */
export function normalizeBasePath(basePath: string): string {
  return basePath.replace(/\/+$/, '') || '/';
}

export type UrlStateOverrides = Partial<{
  [K in RegisteredParam]: unknown;
}>;

/**
 * Build the canonical href for a surface.
 *
 * `current` is the query string as it stands -- typically `useSearchParams()` or the server's
 * `searchParams`. Every param in it that this app does not own is preserved verbatim; every param
 * it does own is re-derived from `overrides` (falling back to the current value), so the result is
 * a full canonical address rather than a patch.
 */
export function urlStateHref(
  basePath: string,
  current: URLSearchParams | undefined,
  overrides: UrlStateOverrides = {}
): string {
  const next = new URLSearchParams();

  // Unowned params first, in their original order, so a link keeps whatever the user arrived with.
  if (current) {
    for (const [key, value] of current.entries()) {
      if (!isOwnedParam(key)) {
        next.append(key, value);
      }
    }
  }

  for (const key of Object.keys(URL_PARAMS) as RegisteredParam[]) {
    const definition = URL_PARAMS[key];
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, key);
    const value = hasOverride
      ? (overrides[key] as never)
      : definition.parse(current?.get(definition.name) ?? undefined);

    const serialized = definition.serialize(value);
    if (serialized !== undefined) {
      next.set(definition.name, serialized);
    }
  }

  const normalized = normalizeBasePath(basePath);
  const query = next.toString();
  return query ? `${normalized}?${query}` : normalized;
}

/**
 * Read one registered param out of an untrusted query string.
 *
 * Never throws and never returns anything outside the param's domain, so a caller can hand the
 * result straight to an API client. A crafted `?status=<script>` becomes the default, exactly as
 * `parseStatus` already handles.
 */
export function readUrlParam<K extends RegisteredParam>(
  current: URLSearchParams | undefined,
  key: K
): ReturnType<(typeof URL_PARAMS)[K]['parse']> {
  const definition = URL_PARAMS[key];
  return definition.parse(current?.get(definition.name) ?? undefined) as ReturnType<
    (typeof URL_PARAMS)[K]['parse']
  >;
}

/**
 * Read a param from Next's server `searchParams` shape, where a repeated key arrives as an array.
 *
 * A repeated param takes its first value rather than erroring: `?q=a&q=b` is what a hand-edited or
 * concatenated URL looks like, and answering it with the first value is more useful than a 400.
 */
export function readServerParam<K extends RegisteredParam>(
  searchParams: Record<string, string | string[] | undefined> | undefined,
  key: K
): ReturnType<(typeof URL_PARAMS)[K]['parse']> {
  const definition = URL_PARAMS[key];
  const raw = searchParams?.[definition.name];
  const single = Array.isArray(raw) ? raw[0] : raw;
  return definition.parse(single) as ReturnType<(typeof URL_PARAMS)[K]['parse']>;
}

/** Convert Next's server `searchParams` shape into a URLSearchParams for href building. */
export function toSearchParams(
  searchParams: Record<string, string | string[] | undefined> | undefined
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, entry);
    } else {
      params.set(key, value);
    }
  }
  return params;
}
