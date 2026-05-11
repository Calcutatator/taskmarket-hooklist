// vite.config.ts
import { TanStackRouterVite } from 'file:///Users/os/conductor/workspaces/taskmarket/ottawa-v2/node_modules/.pnpm/@tanstack+router-plugin@1.159.11_@tanstack+react-router@1.159.10_vite@5.4.21/node_modules/@tanstack/router-plugin/dist/esm/vite.js';
import react from 'file:///Users/os/conductor/workspaces/taskmarket/ottawa-v2/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@5.4.21/node_modules/@vitejs/plugin-react/dist/index.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'file:///Users/os/conductor/workspaces/taskmarket/ottawa-v2/node_modules/.pnpm/vite@5.4.21_@types+node@20.19.33/node_modules/vite/dist/node/index.js';
var __vite_injected_original_import_meta_url =
  'file:///Users/os/conductor/workspaces/taskmarket/ottawa-v2/apps/frontend/vite.config.ts';
var __dirname = path.dirname(fileURLToPath(__vite_injected_original_import_meta_url));
var vite_config_default = defineConfig({
  plugins: [
    TanStackRouterVite({
      autoCodeSplitting: true,
      generatedRouteTree: './src/generated/routeTree.gen.ts',
    }),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/trpc': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    allowedHosts: true,
  },
  base: '/',
});
export { vite_config_default as default };
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvb3MvY29uZHVjdG9yL3dvcmtzcGFjZXMvdGFza21hcmtldC9vdHRhd2EtdjIvYXBwcy9mcm9udGVuZFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL1VzZXJzL29zL2NvbmR1Y3Rvci93b3Jrc3BhY2VzL3Rhc2ttYXJrZXQvb3R0YXdhLXYyL2FwcHMvZnJvbnRlbmQvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1VzZXJzL29zL2NvbmR1Y3Rvci93b3Jrc3BhY2VzL3Rhc2ttYXJrZXQvb3R0YXdhLXYyL2FwcHMvZnJvbnRlbmQvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBUYW5TdGFja1JvdXRlclZpdGUgfSBmcm9tICdAdGFuc3RhY2svcm91dGVyLXBsdWdpbi92aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICd1cmwnO1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5PcHRpb24gfSBmcm9tICd2aXRlJztcbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnO1xuXG5jb25zdCBfX2Rpcm5hbWUgPSBwYXRoLmRpcm5hbWUoZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpKTtcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW1xuICAgIFRhblN0YWNrUm91dGVyVml0ZSh7XG4gICAgICBhdXRvQ29kZVNwbGl0dGluZzogdHJ1ZSxcbiAgICAgIGdlbmVyYXRlZFJvdXRlVHJlZTogJy4vc3JjL2dlbmVyYXRlZC9yb3V0ZVRyZWUuZ2VuLnRzJyxcbiAgICB9KSBhcyBQbHVnaW5PcHRpb24sXG4gICAgcmVhY3QoKSBhcyBQbHVnaW5PcHRpb24sXG4gIF0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgJ0AnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi9zcmMnKSxcbiAgICB9LFxuICB9LFxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiA1MTczLFxuICAgIHByb3h5OiB7XG4gICAgICAnL3RycGMnOiB7XG4gICAgICAgIHRhcmdldDogJ2h0dHA6Ly8xMjcuMC4wLjE6MzAwMCcsXG4gICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICAnL2FwaSc6IHtcbiAgICAgICAgdGFyZ2V0OiAnaHR0cDovLzEyNy4wLjAuMTozMDAwJyxcbiAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxuICBwcmV2aWV3OiB7XG4gICAgYWxsb3dlZEhvc3RzOiB0cnVlLFxuICB9LFxuICBiYXNlOiAnLycsXG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBcVgsU0FBUywwQkFBMEI7QUFDeFosT0FBTyxXQUFXO0FBQ2xCLE9BQU8sVUFBVTtBQUNqQixTQUFTLHFCQUFxQjtBQUU5QixTQUFTLG9CQUFvQjtBQUw2TSxJQUFNLDJDQUEyQztBQU8zUixJQUFNLFlBQVksS0FBSyxRQUFRLGNBQWMsd0NBQWUsQ0FBQztBQUU3RCxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTO0FBQUEsSUFDUCxtQkFBbUI7QUFBQSxNQUNqQixtQkFBbUI7QUFBQSxNQUNuQixvQkFBb0I7QUFBQSxJQUN0QixDQUFDO0FBQUEsSUFDRCxNQUFNO0FBQUEsRUFDUjtBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxLQUFLLFFBQVEsV0FBVyxPQUFPO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixPQUFPO0FBQUEsTUFDTCxTQUFTO0FBQUEsUUFDUCxRQUFRO0FBQUEsUUFDUixjQUFjO0FBQUEsTUFDaEI7QUFBQSxNQUNBLFFBQVE7QUFBQSxRQUNOLFFBQVE7QUFBQSxRQUNSLGNBQWM7QUFBQSxNQUNoQjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxjQUFjO0FBQUEsRUFDaEI7QUFBQSxFQUNBLE1BQU07QUFDUixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
