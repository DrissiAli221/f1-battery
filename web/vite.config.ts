import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Fills %SITE_URL% in index.html (canonical, og:url, og:image) from VITE_SITE_URL; empty keeps them root-relative. */
function siteUrl(origin: string): Plugin {
  return {
    name: "site-url",
    // "pre": before Vite parses the HTML's URLs (a bare "%SITE_URL%" is not a valid URI).
    transformIndexHtml: { order: "pre", handler: (html) => html.replace(/%SITE_URL%/g, origin.replace(/\/$/, "")) },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), siteUrl(env.VITE_SITE_URL ?? "")],
  };
});
