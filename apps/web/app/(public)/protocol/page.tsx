import type { Metadata } from 'next';

import { ProtocolContent } from '@/components/market/protocol';
import { buildStaticPageMetadata } from '@/lib/static-og';

export const metadata: Metadata = buildStaticPageMetadata('protocol');

export default function ProtocolPage() {
  return <ProtocolContent />;
}
