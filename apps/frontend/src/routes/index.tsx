import { createFileRoute } from '@tanstack/react-router';
import { LandingView } from '@/components/views/LandingView';

export const Route = createFileRoute('/')({
  component: LandingView,
});
