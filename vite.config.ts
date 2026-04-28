import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import path from "path";

const isDev = process.env.NODE_ENV !== "production";
const asyncHooksPolyfill = path.join(process.cwd(), "src/polyfills/async-hooks.ts");

export default defineConfig({
  // GitHub Actions sets VITE_BASE_PATH to /repo-name/; local dev uses root.
  base: process.env.VITE_BASE_PATH ?? "/",

  plugins: [
    // basicSsl only needed for local HTTPS — GitHub Pages handles its own TLS.
    isDev ? basicSsl() : null,
  ].filter(Boolean),

  resolve: {
    alias: {
      // Applied during both dev and production build (Rollup phase).
      "node:async_hooks": asyncHooksPolyfill,
    },
  },

  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          // Also applied during esbuild pre-bundling (dev only).
          name: "polyfill-async-hooks",
          setup(build) {
            build.onResolve({ filter: /^node:async_hooks$/ }, () => ({
              path: asyncHooksPolyfill,
            }));
          },
        },
      ],
    },
  },

  server: {
    port: 8080,
  },

  build: {
    rollupOptions: {
      // ArcGIS SDK is loaded via CDN — do not bundle it.
      external: [/^@arcgis\//],
    },
  },
});
