import type { Preview } from '@storybook/nextjs-vite';
import { withThemeByClassName } from '@storybook/addon-themes';
import { MotionConfig } from 'motion/react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { base, baseSepolia } from 'viem/chains';
import { createConfig, http, WagmiProvider } from 'wagmi';

import { TooltipProvider } from '@/components/ui/tooltip';
import { makeQueryClient, makeTrpcClient, trpc } from '@/lib/api/client';

import '../app/globals.css';

const fontVariables = {
  '--font-jetbrains-mono': 'ui-monospace, SFMono-Regular, Menlo, monospace',
  '--font-space-grotesk': 'Inter, ui-sans-serif, system-ui, sans-serif',
} as CSSProperties;

const storybookWagmiConfig = createConfig({
  chains: [base, baseSepolia],
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
});

function StoryProviders({ children }: Readonly<{ children: ReactNode }>) {
  const [queryClient] = useState(() => makeQueryClient());
  const [trpcClient] = useState(() => makeTrpcClient());

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={storybookWagmiConfig}>
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
          <MotionConfig reducedMotion="always">
            <TooltipProvider>
              <div className="min-h-screen bg-background p-6 text-foreground" style={fontVariables}>
                {children}
              </div>
            </TooltipProvider>
          </MotionConfig>
        </trpc.Provider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}

const preview: Preview = {
  decorators: [
    withThemeByClassName({
      defaultTheme: 'dark',
      themes: {
        dark: 'dark',
        light: 'light',
      },
    }),
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
  initialGlobals: {
    backgrounds: { value: 'app' },
  },
  parameters: {
    a11y: {
      // The existing catalogue is being migrated to blocking audits. New story files
      // must opt into `error`; the coverage check validates the explicit legacy allowlist.
      test: 'todo',
    },
    backgrounds: {
      options: {
        app: { name: 'App background', value: 'var(--background)' },
        card: { name: 'Card surface', value: 'var(--card)' },
      },
    },
    controls: {
      expanded: true,
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: 'fullscreen',
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: '/',
      },
    },
    options: {
      storySort: {
        order: ['Foundation', 'Primitives', 'Visualizations', 'Product', 'Patterns', 'Experiences'],
      },
    },
    viewport: {
      options: {
        mobile: { name: 'Mobile', styles: { height: '844px', width: '390px' } },
        tablet: { name: 'Tablet', styles: { height: '1024px', width: '768px' } },
        compactDesktop: {
          name: 'Compact desktop',
          styles: { height: '768px', width: '1024px' },
        },
        desktop: { name: 'Desktop', styles: { height: '900px', width: '1440px' } },
      },
    },
  },
  tags: ['autodocs', 'test'],
};

export default preview;
