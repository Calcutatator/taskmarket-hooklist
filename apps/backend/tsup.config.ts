import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'node',
  outDir: 'dist',
  noExternal: [/@taskmarket\/.*/],
  external: ['postgres'],
  shims: false,
  dts: false,
});
