import type { Preview } from '@storybook/nextjs-vite';
import { withThemeByClassName } from '@storybook/addon-themes';
import type { CSSProperties, ReactNode } from 'react';

import '../app/globals.css';

const fontVariables = {
  '--font-instrument-sans': 'Arial, ui-sans-serif, system-ui, sans-serif',
} as CSSProperties;

function StorySurface({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="min-h-[100dvh] bg-catalog-canvas text-catalog-ink" style={fontVariables}>
      {children}
    </div>
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
      <StorySurface>
        <Story />
      </StorySurface>
    ),
  ],
  parameters: {
    a11y: {
      test: 'error',
    },
    layout: 'fullscreen',
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: '/',
      },
    },
    viewport: {
      options: {
        phone: { name: 'Phone', styles: { height: '844px', width: '390px' } },
        tablet: { name: 'Tablet', styles: { height: '1024px', width: '768px' } },
        desktop: { name: 'Desktop', styles: { height: '900px', width: '1440px' } },
        wide: { name: 'Wide desktop', styles: { height: '1000px', width: '1600px' } },
      },
    },
  },
  tags: ['autodocs', 'test'],
};

export default preview;
