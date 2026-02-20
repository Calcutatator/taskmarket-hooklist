import './index.css';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { routeTree } from './generated/routeTree.gen';
import { WalletProvider } from './contexts/WalletProvider';
import { TRPCProvider } from './contexts/TRPCProvider';

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <WalletProvider>
      <TRPCProvider>
        <RouterProvider router={router} />
      </TRPCProvider>
    </WalletProvider>
  </React.StrictMode>
);
