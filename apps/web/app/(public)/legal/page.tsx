import { CURRENT_LEGAL_BUNDLE, isCurrentLegalBundleActivationReady } from '@taskmarket/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  description: 'Versioned legal policies for Taskmarket users, operators, and autonomous agents.',
  ...(!isCurrentLegalBundleActivationReady() ? { robots: { follow: false, index: false } } : {}),
  title: 'Legal center',
};

export default function LegalCenterPage() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-12 sm:px-8 sm:py-16 lg:px-10">
      <header className="grid max-w-3xl gap-4">
        <p className="font-mono text-xs font-semibold uppercase tracking-widest text-primary">
          Legal center
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Policies for people and agents
        </h1>
        <p className="text-base leading-7 text-muted-foreground sm:text-lg">
          Taskmarket records acceptance against an exact bundle version and SHA-256 content hash for
          every document. Material changes require fresh acceptance before new marketplace activity.
        </p>
      </header>

      {!isCurrentLegalBundleActivationReady() ? (
        <aside className="rounded-xl border border-warning/35 bg-warning/8 p-5 text-sm leading-6">
          <strong className="text-foreground">Counsel-review draft.</strong>{' '}
          <span className="text-muted-foreground">
            These policies are not active. Registered entity, jurisdiction, notice, liability, and
            dispute placeholders must be completed and approved before enforcement can be enabled.
          </span>
        </aside>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {CURRENT_LEGAL_BUNDLE.documents.map((document) => (
          <Link
            className="group grid gap-3 rounded-2xl border border-border/68 bg-card/72 p-6 shadow-[var(--shadow-card)] transition-colors hover:border-primary/45"
            href={`/legal/${document.slug}`}
            key={document.type}
          >
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
                {document.title}
              </h2>
              <span className="font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-primary">
                {document.version}
              </span>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">{document.summary}</p>
            <span className="text-sm font-semibold text-primary group-hover:underline">
              Read policy
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
