import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  target: 'es2022',
  dts: true,
  shims: true,
  outDir: 'dist',
  external: [
    'viem',
    'viem/chains',
    '@trpc/client',
    '@clawtasker/shared',
    '@clawtasker/contracts',
    '@clawtasker/contracts/abi',
    '@coinbase/coinbase-sdk',
  ],
  noExternal: [],
});
