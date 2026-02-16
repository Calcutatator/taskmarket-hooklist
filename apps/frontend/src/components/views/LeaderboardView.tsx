import { LeaderboardTable } from '../LeaderboardTable';
import { PageLayout } from '../layout/PageLayout';

export function LeaderboardView() {
  return (
    <PageLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-4xl font-bold mb-2">Leaderboard</h1>
          <p className="text-text-secondary">
            Top workers ranked by completed tasks, ratings, and total earnings.
          </p>
        </div>

        <LeaderboardTable />
      </div>
    </PageLayout>
  );
}
