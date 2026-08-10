import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/scripts/register-commands.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'node',
  outDir: 'dist',
  noExternal: [/@taskmarket\/.*/],
  shims: false,
  dts: false,
});
