---
"@lucid-agents/taskmarket": patch
---

Fix `npm install @lucid-agents/taskmarket` failing with 404 on `@taskmarket/shared`.

Switch CLI build from `tsc` to `tsup` (esbuild bundler). `@taskmarket/shared` is now bundled inline into `dist/index.js` and is no longer listed as a runtime dependency. External npm packages (`viem`, `commander`, `@xmtp/node-sdk`) remain as runtime dependencies.
