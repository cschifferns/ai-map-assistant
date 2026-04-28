import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import path from "path";

const isDev = process.env.NODE_ENV !== "production";

// Plain JS polyfill — no TS transform needed, works in both esbuild and Rollup.
const asyncHooksPolyfill = path.join(process.cwd(), "src/polyfills/async-hooks.js");

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",

  plugins: [isDev ? basicSsl() : null].filter(Boolean),

  resolve: {
    alias: {
      // Applied by Vite's alias resolver (dev server + Rollup build).
      "node:async_hooks": asyncHooksPolyfill,
    },
  },

  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          // esbuild pre-bundling phase (dev only).
          name: "polyfill-async-hooks-esbuild",
          setup(build) {
            build.onResolve({ filter: /^node:async_hooks$/ }, () => ({
              path: asyncHooksPolyfill,
            }));
          },
        },
      ],
    },
  },

  build: {
    rollupOptions: {
      external: [/^@arcgis\//],
      plugins: [
        {
          // Rollup production build phase — intercepts before Rollup can
          // treat node: imports as Node.js built-ins and skip the alias.
          name: "polyfill-async-hooks-rollup",
          resolveId(id) {
            if (id === "node:async_hooks") return asyncHooksPolyfill;
            return null;
          },
        },
      ],
    },
  },

  server: { port: 8080 },
});
