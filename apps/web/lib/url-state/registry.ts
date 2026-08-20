// Implements: ADR-0097
//
// One declaration site for every shareable query param in the app.
//
// The collision this prevents is concrete rather than theoretical: `view` already means the
// table/gallery toggle on /tasks, and the worker submission history and /live each hold their own
// independent `view` state. Once those move into the URL, two features wanting `?view=` on one
// route silently overwrite each other, and the bug surfaces as "the gallery toggle stopped working
// when we shipped the history panel" -- a long way from its cause. Declaring params here turns
// that into a type error at the point of definition.

/**
 * A param's contract: how to read it from an untrusted query string, how to write it back, and
 * what its absence means.
 */
export type UrlParamDefinition<TValue> = {
  /** Query-string key. camelCase, matching the params already shipped and the tRPC inputs. */
  readonly name: string;
  /**
   * Route prefixes that own this param. Two definitions sharing a name on overlapping routes is
   * the collision the registry exists to catch -- see `assertNoRegistryCollisions`.
   */
  readonly routes: readonly string[];
  /** The value when the param is absent, or present but invalid. */
  readonly defaultValue: TValue;
  /**
   * Read an untrusted raw value. Never throws: a stale bookmark, a crafted URL or a crawler can
   * put anything here, and the answer is always the default rather than an error page. This
   * generalizes what `parseStatus` in lib/market/task-filters.ts already does for `?status=`.
   */
  readonly parse: (raw: string | undefined) => TValue;
  /**
   * Serialize for the URL. Returning `undefined` means "omit", which is how a value equal to its
   * default stays out of the query string and each screen keeps exactly one canonical address.
   */
  readonly serialize: (value: TValue) => string | undefined;
};

/** Build a param whose legal values are a fixed set of strings. */
export function enumParam<const TValues extends readonly string[]>(config: {
  name: string;
  routes: readonly string[];
  values: TValues;
  defaultValue: TValues[number];
}): UrlParamDefinition<TValues[number]> {
  const { defaultValue, name, routes, values } = config;
  return {
    defaultValue,
    name,
    parse: (raw) => (raw !== undefined && values.includes(raw) ? raw : defaultValue),
    routes,
    serialize: (value) => (value === defaultValue ? undefined : value),
  };
}

/** Build a free-text param, trimmed and length-bounded. */
export function stringParam(config: {
  name: string;
  routes: readonly string[];
  maxLength?: number;
}): UrlParamDefinition<string> {
  const { maxLength = 200, name, routes } = config;
  return {
    defaultValue: '',
    name,
    // Bounded on read as well as on write: the bound is about what this app will act on, and a
    // crafted URL does not go through our own serializer.
    parse: (raw) => (raw ?? '').trim().slice(0, maxLength),
    routes,
    serialize: (value) => {
      const trimmed = value.trim().slice(0, maxLength);
      return trimmed === '' ? undefined : trimmed;
    },
  };
}

/**
 * Global params. These keep one meaning everywhere they appear, so a reader can carry an
 * understanding of a Taskmarket URL from one page to the next.
 */
export const URL_PARAMS = {
  /** Selected artifact within a submission. */
  artifact: stringParam({ maxLength: 128, name: 'artifact', routes: ['/tasks', '/dashboard'] }),
  /** Forward keyset cursor. */
  cursor: stringParam({ maxLength: 128, name: 'cursor', routes: ['/'] }),
  /** Back-stack for keyset pagination. */
  cursorStack: stringParam({ maxLength: 2048, name: 'cursorStack', routes: ['/'] }),
  /** Open overlay or side panel, by name. */
  panel: stringParam({ maxLength: 64, name: 'panel', routes: ['/'] }),
  /** Free-text search query. */
  q: stringParam({ maxLength: 200, name: 'q', routes: ['/'] }),
  /** Active top-level section. */
  section: stringParam({ maxLength: 64, name: 'section', routes: ['/dashboard'] }),
  /** Selected submission, addressed by its reference code (ADR-0098). */
  submission: stringParam({ maxLength: 32, name: 'submission', routes: ['/tasks', '/dashboard'] }),
  /** Sort order for the primary list on the route. */
  sort: stringParam({ maxLength: 32, name: 'sort', routes: ['/live', '/dashboard'] }),
  /** Active tab within a section. */
  tab: stringParam({ maxLength: 64, name: 'tab', routes: ['/'] }),
  /**
   * A drilled-into worker's submission history: which view, how it is sorted, and which page.
   *
   * Qualified names rather than reusing `view`/`sort`/`page`, because this panel sits inside a
   * task detail page that already owns those for its own list. Flat naming means the distinction
   * is made here, once, instead of by a prefix scheme -- and the registry is what stops the two
   * from silently clobbering each other.
   */
  historyPage: stringParam({ maxLength: 8, name: 'historyPage', routes: ['/tasks', '/dashboard'] }),
  historySort: stringParam({
    maxLength: 32,
    name: 'historySort',
    routes: ['/tasks', '/dashboard'],
  }),
  historyView: stringParam({
    maxLength: 32,
    name: 'historyView',
    routes: ['/tasks', '/dashboard'],
  }),
} as const;

export type RegisteredParam = keyof typeof URL_PARAMS;

/**
 * Params this app owns. Anything else in a query string belongs to someone else -- a campaign tag,
 * a referral marker, a feature that has not shipped yet -- and is carried through untouched rather
 * than dropped when a filter changes (ADR-0097 rule 3).
 */
export function isOwnedParam(name: string): boolean {
  return OWNED_PARAM_NAMES.has(name);
}

const OWNED_PARAM_NAMES = new Set<string>(
  Object.values(URL_PARAMS).map((definition) => definition.name)
);

/**
 * Register additional names this app owns but which are not (yet) driven through `useUrlState` --
 * the /tasks filter params, which keep their existing bespoke parser for now. Without this, a
 * filter change would treat them as somebody else's params and preserve stale copies of values it
 * had just rewritten.
 */
export function registerOwnedParams(names: readonly string[]): void {
  for (const name of names) {
    OWNED_PARAM_NAMES.add(name);
  }
}

/**
 * Fail loudly when two definitions claim one name on overlapping routes.
 *
 * Called from the registry's own test rather than at module load: the cost of the check is
 * irrelevant, but a throw at import time would take down every page for a mistake that a test
 * reports precisely.
 */
export function findRegistryCollisions(): string[] {
  const collisions: string[] = [];
  const byName = new Map<string, UrlParamDefinition<unknown>[]>();

  for (const definition of Object.values(URL_PARAMS) as UrlParamDefinition<unknown>[]) {
    const existing = byName.get(definition.name) ?? [];
    existing.push(definition);
    byName.set(definition.name, existing);
  }

  for (const [name, definitions] of byName) {
    if (definitions.length < 2) continue;
    for (let a = 0; a < definitions.length; a += 1) {
      for (let b = a + 1; b < definitions.length; b += 1) {
        if (routesOverlap(definitions[a].routes, definitions[b].routes)) {
          collisions.push(name);
        }
      }
    }
  }

  return collisions;
}

function routesOverlap(left: readonly string[], right: readonly string[]): boolean {
  return left.some((leftRoute) =>
    right.some((rightRoute) => leftRoute.startsWith(rightRoute) || rightRoute.startsWith(leftRoute))
  );
}
