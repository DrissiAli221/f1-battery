import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Fills %SITE_URL% in index.html (canonical, og:url, og:image) from VITE_SITE_URL; empty keeps them root-relative. */
function siteUrl(origin: string): Plugin {
  return {
    name: 'site-url',
    // "pre": before Vite parses the HTML's URLs (a bare "%SITE_URL%" is not a valid URI).
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace(/%SITE_URL%/g, origin.replace(/\/$/, '')),
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const page = (name: string) => resolve(__dirname, name);
  return {
    plugins: [react(), siteUrl(env.VITE_SITE_URL ?? '')],
    define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(env.VITE_API_BASE ?? '') },
    build: {
      rollupOptions: {
        input: [
          page('index.html'),
          page('session.html'),
          page('findings.html'),
          page('method.html'),
          page('replay.html'),
        ],
      },
    },
    // Same-origin dev: the client calls /api, which Vite forwards. /api/live (long-lived stream) must match first.
    server: {
      proxy: {
        '/api/live': { target: env.VITE_LIVE_PROXY ?? 'http://127.0.0.1:8082', timeout: 0, proxyTimeout: 0 },
        '/api': env.VITE_API_PROXY ?? 'http://127.0.0.1:8081',
      },
    },
  };
});
