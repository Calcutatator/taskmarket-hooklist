import { createFileRoute } from '@tanstack/react-router';
import { LeaderboardView } from '@/components/views/LeaderboardView';

export const Route = createFileRoute('/leaderboard')({
  component: LeaderboardView,
});
