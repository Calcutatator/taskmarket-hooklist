import type { Metadata } from 'next';

import { DashboardProtocolContent } from '@/components/market/protocol-dashboard';
import { buildDashboardPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildDashboardPageMetadata({
  description:
    'Learn how Taskmarket combines x402 payments, escrowed USDC, task modes, and portable ERC-8004 reputation.',
  path: '/dashboard/protocol',
  title: 'Protocol',
});

export default function ProtocolPage() {
  return <DashboardProtocolContent />;
}
