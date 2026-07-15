import {
  CURRENT_LEGAL_BUNDLE,
  isCurrentLegalBundleActivationReady,
  type LegalDocumentType,
} from '@taskmarket/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import Markdown from 'react-markdown';

export function legalDocumentMetadata(title: string): Metadata {
  return {
    title,
    ...(!isCurrentLegalBundleActivationReady() ? { robots: { follow: false, index: false } } : {}),
  };
}

function documentByType(type: LegalDocumentType) {
  const document = CURRENT_LEGAL_BUNDLE.documents.find((item) => item.type === type);
  if (!document) throw new Error(`Missing legal document: ${type}`);
  return document;
}

export function LegalDocumentPage({ type }: { type: LegalDocumentType }) {
  const document = documentByType(type);

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8 px-5 py-12 sm:px-8 sm:py-16 lg:px-10">
      <nav aria-label="Legal documents" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link className="font-semibold text-primary hover:underline" href="/legal">
          Legal center
        </Link>
        {CURRENT_LEGAL_BUNDLE.documents.map((item) => (
          <Link
            aria-current={item.type === type ? 'page' : undefined}
            className="text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
            href={`/legal/${item.slug}`}
            key={item.type}
          >
            {item.title}
          </Link>
        ))}
      </nav>

      <article className="grid gap-5 rounded-2xl border border-border/68 bg-card/72 p-6 shadow-[var(--shadow-card)] sm:p-10">
        <Markdown
          components={{
            a: ({ children, ...props }) => (
              <a
                className="font-semibold text-primary underline-offset-4 hover:underline"
                {...props}
              >
                {children}
              </a>
            ),
            blockquote: ({ children }) => (
              <blockquote className="rounded-xl border border-warning/35 bg-warning/8 p-4 text-sm leading-6 text-foreground">
                {children}
              </blockquote>
            ),
            h1: ({ children }) => (
              <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="mt-5 font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {children}
              </h2>
            ),
            li: ({ children }) => <li className="pl-1">{children}</li>,
            p: ({ children }) => (
              <p className="text-sm leading-7 text-muted-foreground sm:text-base">{children}</p>
            ),
            strong: ({ children }) => (
              <strong className="font-semibold text-foreground">{children}</strong>
            ),
            ul: ({ children }) => (
              <ul className="grid list-disc gap-2 pl-6 text-sm leading-7 text-muted-foreground sm:text-base">
                {children}
              </ul>
            ),
          }}
        >
          {document.markdown}
        </Markdown>
      </article>
    </div>
  );
}
