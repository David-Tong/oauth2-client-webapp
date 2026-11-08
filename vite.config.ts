import { defineConfig } from 'vite';

const target = process.env.AUTH_SERVER_PROXY_TARGET || 'http://localhost:9001';

export default defineConfig({
  base: '/app/',
  server: {
    proxy: {
      '/api/auth': target,
      '/oauth2': target,
      '/.well-known': target
    }
  }
});
