import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8880',
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Dev only: allow just our two loopback dev origins. Never invent a missing Origin.
            if (req.headers.origin === 'http://localhost:5174' || req.headers.origin === 'http://127.0.0.1:5174') {
              proxyReq.setHeader('Origin', 'http://localhost:8880');
            }
          });
        },
      },
    },
  },
});
