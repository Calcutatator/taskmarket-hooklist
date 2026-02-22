import { createFileRoute } from '@tanstack/react-router';
import { ProtocolView } from '@/components/views/ProtocolView';

export const Route = createFileRoute('/protocol')({
  component: ProtocolView,
});
