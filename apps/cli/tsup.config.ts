import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  bundle: true,
  // Bundle @taskmarket/shared inline; keep large npm packages external
  noExternal: ['@taskmarket/shared'],
  external: ['commander', 'viem', '@xmtp/node-sdk'],
  dts: false,
  clean: true,
})
