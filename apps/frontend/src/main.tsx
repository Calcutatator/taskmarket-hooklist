import './index.css';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { HelmetProvider } from 'react-helmet-async';
import { routeTree } from './generated/routeTree.gen';
import { AppProvider } from './contexts/AppProvider';

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <HelmetProvider>
      <AppProvider>
        <RouterProvider router={router} />
      </AppProvider>
    </HelmetProvider>
  </React.StrictMode>
);
