import { CatalogExperience } from '@/components/catalog-experience';
import { fetchCatalogSnapshot, getSearchQuery } from '@/lib/catalog-api';
import { getEnvironment } from '@/lib/environment';

export default async function HomePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ q?: string | string[] }>;
}>) {
  const [{ q }, result] = await Promise.all([searchParams, fetchCatalogSnapshot()]);
  const votingEnabled = getEnvironment().SLAP_CHOP_DATA_MODE !== 'live-readonly';

  return (
    <CatalogExperience
      initialQuery={getSearchQuery(q)}
      result={result}
      votingEnabled={votingEnabled}
    />
  );
}
