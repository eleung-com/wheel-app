import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Cloudflare Pages (wheel-app-67w.pages.dev) serves the app at the root.
  base: '/',
  server: {
    port: 5173,
    proxy: {
      // Notion — always via the worker, which holds the token. Override the
      // target with NOTION_PROXY_TARGET to develop against a stub worker.
      '/notion': {
        target: process.env.NOTION_PROXY_TARGET || 'https://wheel-tradier-proxy.esthercandy.workers.dev',
        changeOrigin: true,
      },
      // Yahoo Finance — through the worker, which is also what production uses.
      // Yahoo rate-limits residential IPs (every direct call from a dev machine
      // comes back 429), so hitting query1 from here just fails. The worker's
      // /yf route already sets the browser User-Agent Yahoo requires, so the
      // path is passed through unrewritten. Set YF_PROXY_TARGET to a stub or to
      // https://query1.finance.yahoo.com (with the rewrite restored) to bypass it.
      '/yf': {
        target: process.env.YF_PROXY_TARGET || 'https://wheel-tradier-proxy.esthercandy.workers.dev',
        changeOrigin: true,
      },
      // Research relay (SEC / FMP / Finnhub) — the Pages Function, run locally:
      //   npx wrangler pages dev dist --port 8788   (keys in wheel-app/.dev.vars)
      // The deployed copy sits behind Cloudflare Access, so dev can't use it.
      '/research': {
        target: process.env.RESEARCH_PROXY_TARGET || 'http://localhost:8788',
        changeOrigin: true,
      },
      // CBOE delayed option chains — through the worker's /cboe pass-through,
      // same as production (cdn.cboe.com sends no CORS headers).
      '/cboe': {
        target: process.env.CBOE_PROXY_TARGET || 'https://wheel-tradier-proxy.esthercandy.workers.dev',
        changeOrigin: true,
      },
    },
  },
});
