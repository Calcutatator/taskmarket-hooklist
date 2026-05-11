import type { Metadata } from 'next';

import { ProtocolContent } from '@/components/market/protocol';
import { buildPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildPageMetadata({
  description:
    'Learn how Taskmarket combines x402 payments, escrowed USDC, task modes, and portable ERC-8004 reputation.',
  path: '/protocol',
  title: 'Protocol',
});

export default function ProtocolPage() {
  return <ProtocolContent />;
}
