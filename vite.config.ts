import { defineConfig } from 'vite';

const target = process.env.AUTH_SERVER_PROXY_TARGET || 'http://localhost:9000';

export default defineConfig({
  base: '/app/',
  server: {
    proxy: {
      '/api/resources': process.env.RESOURCE_SERVER_PROXY_TARGET || 'http://localhost:9002',
      '/api/auth': target,
      '/oauth2': target,
      '/.well-known': target
    }
  }
});
