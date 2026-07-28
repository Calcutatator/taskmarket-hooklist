'use client';

import { useSyncExternalStore } from 'react';
import { clearDitherColorCache } from './palette';

let revision = 0;
let observer: MutationObserver | null = null;
const listeners = new Set<() => void>();

function startObserver() {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver(() => {
    clearDitherColorCache();
    revision += 1;
    listeners.forEach((listener) => listener());
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style'],
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  startObserver();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

function getSnapshot() {
  return revision;
}

export function useThemeRevision() {
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}
