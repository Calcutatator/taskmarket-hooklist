'use client';

import type { ReactNode } from 'react';

import { SlapChopPrivyProvider } from '@/components/slap-chop-privy-provider';

export function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return <SlapChopPrivyProvider>{children}</SlapChopPrivyProvider>;
}
