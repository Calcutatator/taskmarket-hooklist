import { CatalogExperience } from '@/components/catalog-experience';
import { fetchCatalogSnapshot, getSearchQuery } from '@/lib/catalog-api';

export default async function HomePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ q?: string | string[] }>;
}>) {
  const [{ q }, result] = await Promise.all([searchParams, fetchCatalogSnapshot()]);

  return <CatalogExperience initialQuery={getSearchQuery(q)} result={result} />;
}
