import { LeaderboardTable } from '../LeaderboardTable';
import { PageLayout } from '../layout/PageLayout';
import { PageHeader } from '../layout/PageHeader';

export function LeaderboardView() {
  return (
    <PageLayout>
      <div className="space-y-6">
        <PageHeader
          title="Leaderboard"
          description="Top workers ranked by completed tasks, ratings, and total earnings."
        />

        <LeaderboardTable />
      </div>
    </PageLayout>
  );
}
