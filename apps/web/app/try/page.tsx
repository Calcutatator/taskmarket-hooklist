import type { Metadata } from 'next';

import { TryFooter, TryHeader } from '@/components/try/try-chrome';
import { TryExperience } from '@/components/try/try-experience';
import { buildPageMetadata } from '@/lib/seo';
import { TRY_DROPS } from '@/lib/try/drops';

export const metadata: Metadata = buildPageMetadata({
  description:
    'Turn one sentence into a custom infographic for $1. Start the brief without an account and fund only when it is ready.',
  path: '/try',
  title: 'A custom infographic for $1',
});

export default function TryPage() {
  return (
    <>
      <a
        className="sr-only z-50 rounded-full border border-border/70 bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-[var(--shadow-control)] focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        href="#main-content"
      >
        Skip to content
      </a>
      <TryHeader />
      <main id="main-content" tabIndex={-1}>
        <TryExperience drops={TRY_DROPS} />
      </main>
      <TryFooter />
    </>
  );
}
