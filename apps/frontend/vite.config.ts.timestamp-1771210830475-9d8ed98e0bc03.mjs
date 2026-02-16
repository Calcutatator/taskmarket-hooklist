// vite.config.ts
import { TanStackRouterVite } from "file:///Users/admin/Git_Downloads/Daydreams/stakework/node_modules/.pnpm/@tanstack+router-plugin@1.159.11_@tanstack+react-router@1.159.10_vite@5.4.21/node_modules/@tanstack/router-plugin/dist/esm/vite.js";
import react from "file:///Users/admin/Git_Downloads/Daydreams/stakework/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@5.4.21/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "file:///Users/admin/Git_Downloads/Daydreams/stakework/node_modules/.pnpm/vite@5.4.21_@types+node@20.19.33/node_modules/vite/dist/node/index.js";
var __vite_injected_original_import_meta_url = "file:///Users/admin/Git_Downloads/Daydreams/stakework/apps/frontend/vite.config.ts";
var __dirname = path.dirname(fileURLToPath(__vite_injected_original_import_meta_url));
var vite_config_default = defineConfig({
  plugins: [
    TanStackRouterVite({
      autoCodeSplitting: true,
      generatedRouteTree: "./src/generated/routeTree.gen.ts"
    }),
    react()
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/trpc": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true
      }
    }
  },
  base: "/"
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvYWRtaW4vR2l0X0Rvd25sb2Fkcy9EYXlkcmVhbXMvc3Rha2V3b3JrL2FwcHMvZnJvbnRlbmRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy9hZG1pbi9HaXRfRG93bmxvYWRzL0RheWRyZWFtcy9zdGFrZXdvcmsvYXBwcy9mcm9udGVuZC92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvYWRtaW4vR2l0X0Rvd25sb2Fkcy9EYXlkcmVhbXMvc3Rha2V3b3JrL2FwcHMvZnJvbnRlbmQvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBUYW5TdGFja1JvdXRlclZpdGUgfSBmcm9tICdAdGFuc3RhY2svcm91dGVyLXBsdWdpbi92aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICd1cmwnO1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5PcHRpb24gfSBmcm9tICd2aXRlJztcbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnO1xuXG5jb25zdCBfX2Rpcm5hbWUgPSBwYXRoLmRpcm5hbWUoZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpKTtcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW1xuICAgIFRhblN0YWNrUm91dGVyVml0ZSh7XG4gICAgICBhdXRvQ29kZVNwbGl0dGluZzogdHJ1ZSxcbiAgICAgIGdlbmVyYXRlZFJvdXRlVHJlZTogJy4vc3JjL2dlbmVyYXRlZC9yb3V0ZVRyZWUuZ2VuLnRzJyxcbiAgICB9KSBhcyBQbHVnaW5PcHRpb24sXG4gICAgcmVhY3QoKSBhcyBQbHVnaW5PcHRpb24sXG4gIF0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgJ0AnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi9zcmMnKSxcbiAgICB9LFxuICB9LFxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiA1MTczLFxuICAgIHByb3h5OiB7XG4gICAgICAnL3RycGMnOiB7XG4gICAgICAgIHRhcmdldDogJ2h0dHA6Ly8xMjcuMC4wLjE6MzAwMCcsXG4gICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgYmFzZTogJy8nLFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXNXLFNBQVMsMEJBQTBCO0FBQ3pZLE9BQU8sV0FBVztBQUNsQixPQUFPLFVBQVU7QUFDakIsU0FBUyxxQkFBcUI7QUFFOUIsU0FBUyxvQkFBb0I7QUFMbU0sSUFBTSwyQ0FBMkM7QUFPalIsSUFBTSxZQUFZLEtBQUssUUFBUSxjQUFjLHdDQUFlLENBQUM7QUFFN0QsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUztBQUFBLElBQ1AsbUJBQW1CO0FBQUEsTUFDakIsbUJBQW1CO0FBQUEsTUFDbkIsb0JBQW9CO0FBQUEsSUFDdEIsQ0FBQztBQUFBLElBQ0QsTUFBTTtBQUFBLEVBQ1I7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssS0FBSyxRQUFRLFdBQVcsT0FBTztBQUFBLElBQ3RDO0FBQUEsRUFDRjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLE1BQ0wsU0FBUztBQUFBLFFBQ1AsUUFBUTtBQUFBLFFBQ1IsY0FBYztBQUFBLE1BQ2hCO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLE1BQU07QUFDUixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
