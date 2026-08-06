import { DashboardSectionTabsClient } from './dashboard-section-tabs-client';
import type { DashboardSection } from './dashboard-section';

export { parseDashboardSection, type DashboardSection } from './dashboard-section';

export function DashboardSectionTabs({ section }: { section: DashboardSection }) {
  return <DashboardSectionTabsClient section={section} />;
}
