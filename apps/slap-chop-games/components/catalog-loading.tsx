import { AppShell } from '@/components/app-shell';

const loadingTiles = Array.from({ length: 48 }, (_, index) => index);

function LoadingSearchRail() {
  return (
    <form
      aria-label="Search games"
      className="flex min-w-0 flex-1 items-center border-l border-catalog-border"
      role="search"
    >
      <label className="sr-only" htmlFor="catalog-search-loading">
        Search games
      </label>
      <input
        className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-catalog-muted outline-none placeholder:text-catalog-muted"
        disabled
        id="catalog-search-loading"
        placeholder="Search games"
        type="search"
      />
    </form>
  );
}

export function CatalogLoading() {
  return (
    <AppShell rail={<LoadingSearchRail />}>
      <section
        aria-busy="true"
        aria-label="Loading catalog"
        className="grid grid-cols-2 gap-px bg-catalog-border md:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8"
        role="status"
      >
        <span className="sr-only">Loading catalog</span>
        {loadingTiles.map((tile) => (
          <div
            aria-hidden="true"
            className={
              tile % 3 === 0
                ? 'aspect-square bg-catalog-surface'
                : 'aspect-square bg-catalog-canvas'
            }
            key={tile}
          />
        ))}
      </section>
    </AppShell>
  );
}
