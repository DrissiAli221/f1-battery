import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev only: serves web/readme/panels.html so the README images can be rendered by the real
 * components and stylesheets. Never used for a build; `npm run build` still reads vite.config.ts.
 *   npx vite --config vite.readme.config.ts --port 5175
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(env.VITE_API_BASE ?? '') },
    server: {
      proxy: {
        '/api/live': { target: env.VITE_LIVE_PROXY ?? 'http://127.0.0.1:8082', timeout: 0, proxyTimeout: 0 },
        '/api': env.VITE_API_PROXY ?? 'http://127.0.0.1:8081',
      },
    },
  };
});
