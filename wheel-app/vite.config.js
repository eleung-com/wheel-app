import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/wheel-app/',
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
      // Tradier API — key is injected server-side so it never appears in browser network logs
      '/tr': {
        target: 'https://api.tradier.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tr/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Read key from the x-tradier-token header set by the client,
            // then replace it with the real Authorization header going to Tradier.
            const token = req.headers['x-tradier-token'];
            if (token) {
              proxyReq.setHeader('Authorization', `Bearer ${token}`);
              proxyReq.removeHeader('x-tradier-token');
            }
            proxyReq.setHeader('Accept', 'application/json');
          });
        },
      },
    },
  },
});
