import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useMemo, useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Input } from '@/components/ui/input';

declare global {
  interface ImportMeta {
    glob<T = unknown>(
      pattern: string,
      options: { eager: boolean; import: string; query: string }
    ): Record<string, T>;
  }
}

const storySources = import.meta.glob('./*.stories.tsx', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

const coveragePattern = /storybook-coverage:\s*(components\/[\w./-]+\.tsx)/g;
const titlePattern = /title:\s*['"]([^'"]+)['"]/;

function storybookSlug(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

const components = Object.values(storySources)
  .flatMap((source) => {
    const title = source.match(titlePattern)?.[1];
    if (!title) return [];

    return [...source.matchAll(coveragePattern)].map((match) => ({
      component: match[1],
      storyHref: `?path=/docs/${storybookSlug(title)}--docs`,
      storyTitle: title,
    }));
  })
  .sort((left, right) => left.component.localeCompare(right.component));

function ComponentIndex() {
  const [query, setQuery] = useState('');
  const filteredComponents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return components;
    return components.filter(({ component, storyTitle }) =>
      `${component} ${storyTitle}`.toLowerCase().includes(normalizedQuery)
    );
  }, [query]);

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6">
      <header className="grid gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Storybook coverage map
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Component index</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Find a component module, then open the catalogue that exercises it. Reusable components
          should gain a direct component-named story when they are materially changed.
        </p>
      </header>

      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="component-search">
          Find a component
        </label>
        <Input
          id="component-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by component path or catalogue"
          value={query}
        />
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {filteredComponents.length} of {components.length} component modules
        </p>
      </div>

      {filteredComponents.length ? (
        <ul className="grid gap-2" data-testid="component-results">
          {filteredComponents.map(({ component, storyHref, storyTitle }) => (
            <li className="rounded-lg border border-border bg-card p-4" key={component}>
              <a
                className="grid gap-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={storyHref}
                target="_top"
              >
                <span className="font-mono text-sm text-foreground">{component}</span>
                <span className="text-xs text-muted-foreground">Open {storyTitle}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          No component modules match this search.
        </p>
      )}
    </main>
  );
}

const meta = {
  component: ComponentIndex,
  parameters: {
    a11y: {
      test: 'error',
    },
    docs: {
      description: {
        component:
          'Searchable map from component modules to the Storybook catalogues that exercise them.',
      },
    },
  },
  title: 'Foundation/Component index',
} satisfies Meta<typeof ComponentIndex>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllComponents: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = canvas.getByRole('textbox', { name: 'Find a component' });

    await userEvent.type(search, 'landing-typer');

    await expect(canvas.getByText('components/market/landing-typer.tsx')).toBeVisible();
    await expect(canvas.queryByText('components/market/actions/accept-button.tsx')).toBeNull();

    await userEvent.clear(search);
    await userEvent.type(search, 'components/market/protocol.tsx');
    await expect(
      canvas.getByRole('link', { name: /components\/market\/protocol\.tsx/ })
    ).toHaveAttribute('href', '?path=/docs/product-data-displays--docs');
  },
};

export const NoResults: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = canvas.getByRole('textbox', { name: 'Find a component' });

    await userEvent.type(search, 'component-that-does-not-exist');

    await expect(canvas.getByText('No component modules match this search.')).toBeVisible();
    await expect(canvas.queryByTestId('component-results')).not.toBeInTheDocument();
  },
};
