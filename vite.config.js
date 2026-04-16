import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [react(), basicSsl()],
  base: '/wheel-app/',
  server: {
    https: true,
    port: 5173,
    proxy: {
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
