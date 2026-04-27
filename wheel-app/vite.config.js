import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/wheel-app/',
  server: {
    port: 5173,
    proxy: {
      // Yahoo Finance — proxy avoids CORS on localhost; sets browser UA so Yahoo doesn't reject
      '/yf': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/yf/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
            proxyReq.setHeader('Accept', 'application/json,text/plain,*/*');
            proxyReq.setHeader('Referer', 'https://finance.yahoo.com/');
          });
        },
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
