## 1) Core Identity

- Name: Prometheus
- Package version: `1.0.4`
- Runtime stack: Node.js + TypeScript
- Dev entry path: `tsx src/cli/index.ts`
- Gateway entry: `src/gateway/server-v2.ts`
- Main chat runtime: `src/gateway/routes/chat.router.ts`
- Default local gateway endpoint: `http://127.0.0.1:18789`
- Canonical code truth: `src/` for backend/runtime, `web-ui/` for frontend
- `dist/` may exist, but architecture and behavior should always be verified from source, not build output

Current package build facts:

- `npm run build` runs `npm run build:backend && npm run build:web`
- `npm run build:backend` runs `tsc && node scripts/copy-creative-renderers.js`
- `npm run build:web` currently delegates to `npm run check:web-ui`
- backend TypeScript targets ES2022/CommonJS with source maps, declarations, and `src/` as the root
