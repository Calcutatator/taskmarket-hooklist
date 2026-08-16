import { CurateWorkspaceRoute } from '@/components/curate/curate-workspace-route';

export const metadata = {
  robots: {
    follow: false,
    index: false,
  },
  title: 'Curate',
};

// Implements: ADR-0087 and ADR-0088. This route is intentionally unlinked from the public
// catalog and its client leaf fails closed until the server-verified curator workflow begins.
export default function CuratePage() {
  return <CurateWorkspaceRoute />;
}
