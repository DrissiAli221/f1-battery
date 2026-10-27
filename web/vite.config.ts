import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_ORIGIN = 'http://127.0.0.1:5173';

/** The public origin for canonical and og URLs. Production builds require an absolute http(s) origin. */
function resolveSiteOrigin(raw: string | undefined, command: 'build' | 'serve'): string {
  const value = (raw ?? '').trim();
  if (!value && command !== 'build') return DEV_ORIGIN;
  let url: URL | null = null;
  try {
    url = new URL(value);
  } catch {
    // reported below
  }
  if (
    !url ||
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `VITE_SITE_URL must be set to the absolute http(s) origin the site is served from, for example https://example.com (got ${value ? JSON.stringify(value) : 'nothing'}). It fills canonical and og:image URLs, which must not be relative.`
    );
  }
  return url.origin;
}

/**
 * The head shared by every page, injected once here. Each HTML file keeps only its own <title>
 * and <meta name="description">; the canonical path is the clean one (no .html) derived from the file name.
 */
function siteHead(origin: string): Plugin {
  const pick = (html: string, re: RegExp, what: string) => {
    const m = re.exec(html);
    if (!m) throw new Error(`site-head: page has no ${what}`);
    return m[1].trim();
  };
  return {
    name: 'site-head',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const title = pick(html, /<title>([^<]*)<\/title>/, '<title>');
        const description = pick(html, /<meta\s+name="description"\s+content="([^"]*)"/, 'meta description');
        const file = ctx.path.replace(/^\//, '').split('?')[0];
        const slug = file.replace(/\.html$/, '');
        const path = slug === '' || slug === 'index' ? '/' : `/${slug}`;
        const url = `${origin}${path}`;
        const image = `${origin}/og.png`;
        const font = (name: string) =>
          `    <link rel="preload" href="/fonts/${name}.woff2" as="font" type="font/woff2" crossorigin />`;
        const head = [
          '    <meta charset="utf-8" />',
          '    <meta name="viewport" content="width=device-width,initial-scale=1" />',
          '    <meta name="color-scheme" content="dark" />',
          '    <meta name="theme-color" content="#030303" />',
          '    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
          // Only the faces used above the fold: Formula 1 Black, KH F1 (labels, nav), Geist (body).
          font('Formula1-Black'),
          font('KHInterferenceF1-Regular'),
          font('geist-var'),
          '    <script>',
          '      // Before first paint: flag JS and allowed motion, so motion-only styles never flash.',
          "      document.documentElement.classList.add('js');",
          "      if (!matchMedia('(prefers-reduced-motion: reduce)').matches)",
          "        document.documentElement.classList.add('motion');",
          '    </script>',
          `    <link rel="canonical" href="${url}" />`,
          '    <meta property="og:type" content="website" />',
          '    <meta property="og:site_name" content="F1 Battery" />',
          `    <meta property="og:url" content="${url}" />`,
          `    <meta property="og:title" content="${title}" />`,
          `    <meta property="og:description" content="${description}" />`,
          `    <meta property="og:image" content="${image}" />`,
          '    <meta property="og:image:width" content="1200" />',
          '    <meta property="og:image:height" content="630" />',
          '    <meta property="og:image:alt" content="F1 Battery: the hidden side of racing" />',
          '    <meta name="twitter:card" content="summary_large_image" />',
          `    <meta name="twitter:title" content="${title}" />`,
          `    <meta name="twitter:description" content="${description}" />`,
          `    <meta name="twitter:image" content="${image}" />`,
        ].join('\n');
        return html.replace(/<head>\s*/, `<head>\n${head}\n    `);
      },
    },
  };
}

const CLEAN_PAGES = new Set(['/session', '/findings', '/method', '/replay']);

/** Dev and preview serve the clean page paths the host serves in production (/session -> /session.html). */
function cleanPaths(): Plugin {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    const [path, query] = (req.url ?? '').split('?');
    if (CLEAN_PAGES.has(path)) req.url = `${path}.html${query === undefined ? '' : `?${query}`}`;
    next();
  };
  return {
    name: 'clean-paths',
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
  };
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const page = (name: string) => resolve(__dirname, name);
  return {
    plugins: [react(), cleanPaths(), siteHead(resolveSiteOrigin(env.VITE_SITE_URL, command))],
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
