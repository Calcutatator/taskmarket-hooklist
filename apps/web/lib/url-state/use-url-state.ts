'use client';

// Implements: ADR-0096
// Implements: ADR-0097
//
// The round trip. A URL-backed value has exactly one storage location, and this hook is it: no
// useState mirror, no "initial" prop that then drifts. That is the rule that fixes the bug this
// whole contract exists for -- `SubmissionGalleryDialog` seeds `selectedArtifactId` from
// `?artifact=` and never writes back, so from the first arrow press the address bar describes a
// screen the viewer is no longer looking at, and a copied link sends the recipient somewhere else.
// Adding more params does not fix that; deleting the mirror does.

import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { urlStateHref } from './href';
import { URL_PARAMS, type RegisteredParam } from './registry';

/**
 * The query string as it will be after every write issued so far this tick.
 *
 * `useSearchParams()` reflects the *committed* URL, and `router.replace` is a transition that has
 * not landed by the time the next line runs. So two writes in one tick -- switching a view and
 * then a sort, which is one gesture as far as a user is concerned -- each build their href from
 * the same pre-change snapshot, and the second silently drops the first. That is not a test
 * artifact: it is what happens whenever two controls are driven in quick succession.
 *
 * This is a single module-level buffer rather than a ref per hook, because the two writes come
 * from two different `useUrlState` instances and a per-hook ref cannot see its sibling's pending
 * change. It resyncs whenever the committed URL differs from the snapshot it was seeded from, so
 * Back, Forward and an external navigation all win over anything buffered.
 */
let pendingSearch: { seededFrom: string; params: URLSearchParams } | null = null;

function liveSearchParams(searchParams: { toString: () => string }): URLSearchParams {
  const committed = searchParams.toString();
  if (!pendingSearch || pendingSearch.seededFrom !== committed) {
    pendingSearch = { params: new URLSearchParams(committed), seededFrom: committed };
  }
  return pendingSearch.params;
}

/** Record what a write is about to make true, so a sibling write this tick builds on it. */
function rememberWrite(href: string): void {
  if (!pendingSearch) return;
  const query = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
  pendingSearch = { params: new URLSearchParams(query), seededFrom: pendingSearch.seededFrom };
}

/**
 * How a write should affect browser history.
 *
 * - `refine` replaces the current entry: typing in a search box, dragging a slider, toggling a
 *   filter chip, arrowing through a gallery. Pushing on every keystroke makes Back unusable.
 * - `navigate` pushes a new entry: opening an overlay, changing page, switching a top-level tab.
 *   Replacing here makes Back leave the page instead of closing what the user just opened.
 *
 * Defaulting to `refine` is deliberate: refinement is the common case, and a wrongly-replaced
 * entry is a smaller harm than a wrongly-pushed one.
 */
export type HistoryIntent = 'refine' | 'navigate';

export type UseUrlStateOptions = {
  history?: HistoryIntent;
  /**
   * Coalesce rapid writes. A search box passes 300 so a typed query produces one history-neutral
   * replace rather than one per character.
   */
  debounceMs?: number;
};

type ParamValue<K extends RegisteredParam> = ReturnType<(typeof URL_PARAMS)[K]['parse']>;

/**
 * Read and write one registered shareable param.
 *
 * The returned value is derived from `useSearchParams()` on every render rather than cached, so
 * Back, Forward, a pasted link and a server-rendered first paint all agree by construction.
 */
export function useUrlState<K extends RegisteredParam>(
  key: K,
  options: UseUrlStateOptions = {}
): [ParamValue<K>, (next: ParamValue<K>) => void] {
  const { debounceMs = 0, history = 'refine' } = options;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const definition = URL_PARAMS[key];
  const value = useMemo(
    () => definition.parse(searchParams.get(definition.name) ?? undefined) as ParamValue<K>,
    [definition, searchParams]
  );

  // A pending debounced write must not outlive the component, or it navigates a page the user has
  // already left.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const setValue = useCallback(
    (next: ParamValue<K>) => {
      const href = urlStateHref(pathname, liveSearchParams(searchParams), {
        [key]: next,
      } as Record<K, unknown>);
      rememberWrite(href);

      const commit = () => {
        timerRef.current = null;
        if (history === 'navigate') {
          router.push(href as Route);
        } else {
          router.replace(href as Route);
        }
      };

      if (timerRef.current) clearTimeout(timerRef.current);
      if (debounceMs > 0) {
        timerRef.current = setTimeout(commit, debounceMs);
      } else {
        commit();
      }
    },
    [debounceMs, history, key, pathname, router, searchParams]
  );

  return [value, setValue];
}

/**
 * A named overlay that can also carry which item it is showing.
 *
 * Two params rather than one, because "the gallery is open" and "it is showing artifact X" are
 * genuinely different facts: a viewer can open the gallery to browse from the start, with no
 * particular artifact selected. Folding both into `?artifact=` would need a sentinel value to mean
 * "open but nothing chosen", which reads as data when it is really a state.
 *
 * History follows ADR-0096: opening is a navigation the user expects Back to undo, while moving
 * between items inside an already-open overlay is refinement. Closing pops only an entry this
 * session pushed -- a viewer who arrived directly on the deep link has none of ours to pop, and
 * calling `back()` for them would strand them on whatever site they came from.
 */
export function usePanelOverlay(panelName: string): {
  isOpen: boolean;
  itemId: string;
  open: (itemId?: string) => void;
  select: (itemId: string) => void;
  close: () => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pushedRef = useRef(false);

  useDuplicatePanelNameGuard(panelName);

  const panel = URL_PARAMS.panel.parse(searchParams.get(URL_PARAMS.panel.name) ?? undefined);
  const itemId = URL_PARAMS.artifact.parse(searchParams.get(URL_PARAMS.artifact.name) ?? undefined);
  const isOpen = panel === panelName;

  const hrefWith = useCallback(
    (overrides: Record<string, unknown>) => {
      const href = urlStateHref(pathname, liveSearchParams(searchParams), overrides);
      rememberWrite(href);
      return href;
    },
    [pathname, searchParams]
  );

  const open = useCallback(
    (nextItemId?: string) => {
      const href = hrefWith({ artifact: nextItemId ?? '', panel: panelName });
      if (isOpen) {
        router.replace(href as Route);
      } else {
        pushedRef.current = true;
        router.push(href as Route);
      }
    },
    [hrefWith, isOpen, panelName, router]
  );

  // Moving within an open overlay never pushes: Back should leave the overlay, not walk the
  // carousel one item at a time.
  const select = useCallback(
    (nextItemId: string) => {
      if (nextItemId === itemId) return;
      router.replace(hrefWith({ artifact: nextItemId, panel: panelName }) as Route);
    },
    [hrefWith, itemId, panelName, router]
  );

  // Closing always writes the closed address rather than popping history.
  //
  // Popping looks tidier -- it leaves no entry behind -- but it lands on whatever the previous
  // entry happened to be, and with nested overlays that is another *open* overlay, so Close
  // reopens something instead of closing anything. Replacing cannot do that: it rewrites the
  // current entry to the closed state, so Back from an open overlay still reaches the page as it
  // was before opening (the open entry was pushed), and Back after Close reaches the same place.
  //
  // This settles the "how much history is too much" question RFC-0010 left open, in favour of the
  // behaviour that cannot surprise.
  const close = useCallback(() => {
    pushedRef.current = false;
    router.replace(hrefWith({ artifact: '', panel: '' }) as Route);
  }, [hrefWith, router]);

  return { close, isOpen, itemId, open, select };
}

/**
 * Refuse two simultaneously-mounted overlays sharing one panel name.
 *
 * The registry catches two features claiming the same *param*; it cannot catch two features
 * claiming the same *value* of `panel`, because that is a string chosen at the call site. That
 * gap is not hypothetical -- the task page mounts two submission galleries, and giving both the
 * name `submissions` made `?panel=submissions` open both at once, which surfaced as duplicate
 * dialogs and a strict-mode locator violation rather than as anything naming the cause.
 *
 * Development-only: the cost of a module-level registry is not worth paying in production for a
 * mistake that a developer will hit on their first render.
 */
function useDuplicatePanelNameGuard(panelName: string): void {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;

    const count = (MOUNTED_PANELS.get(panelName) ?? 0) + 1;
    MOUNTED_PANELS.set(panelName, count);
    if (count > 1) {
      // eslint-disable-next-line no-console
      console.error(
        `Two overlays are mounted with the panel name "${panelName}". A panel name addresses one ` +
          'overlay, so both will open together on ?panel=' +
          panelName +
          '. Give each its own name.'
      );
    }

    return () => {
      const remaining = (MOUNTED_PANELS.get(panelName) ?? 1) - 1;
      if (remaining <= 0) {
        MOUNTED_PANELS.delete(panelName);
      } else {
        MOUNTED_PANELS.set(panelName, remaining);
      }
    };
  }, [panelName]);
}

const MOUNTED_PANELS = new Map<string, number>();

export type OverlayParam = Extract<RegisteredParam, 'artifact' | 'panel' | 'submission'>;

/**
 * An overlay whose open/closed state is an address.
 *
 * Opening pushes, so Back closes the overlay rather than leaving the page. Closing cannot simply
 * call `router.back()`, because the user may have arrived directly on the deep link -- there is no
 * entry of ours to pop, and popping would strand them on whatever site they came from. So
 * ownership is tracked: pop only what this session pushed, otherwise replace with the param
 * removed.
 */
export function useOverlayParam(key: OverlayParam): {
  value: string;
  isOpen: boolean;
  open: (next: string) => void;
  close: () => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pushedRef = useRef(false);

  const definition = URL_PARAMS[key];
  const value = definition.parse(searchParams.get(definition.name) ?? undefined) as string;

  const open = useCallback(
    (next: string) => {
      const href = urlStateHref(pathname, liveSearchParams(searchParams), {
        [key]: next,
      } as Record<OverlayParam, unknown>) as Route;
      rememberWrite(href);
      // Only the transition from closed to open is a navigation. Moving between artifacts inside
      // an already-open gallery is refinement, and pushing there would make Back walk the carousel
      // one artifact at a time.
      if (value === definition.defaultValue) {
        pushedRef.current = true;
        router.push(href);
      } else {
        router.replace(href);
      }
    },
    [definition.defaultValue, key, pathname, router, searchParams, value]
  );

  // Replace rather than pop, for the reason given on usePanelOverlay's close above.
  const close = useCallback(() => {
    pushedRef.current = false;
    const href = urlStateHref(pathname, liveSearchParams(searchParams), {
      [key]: definition.defaultValue,
    } as Record<OverlayParam, unknown>) as Route;
    rememberWrite(href);
    router.replace(href);
  }, [definition.defaultValue, key, pathname, router, searchParams]);

  return { close, isOpen: value !== definition.defaultValue, open, value };
}
