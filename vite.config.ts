import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import path from "path";

const asyncHooksPolyfill = path.join(process.cwd(), "src/polyfills/async-hooks.ts");

export default defineConfig({
  plugins: [
    basicSsl(), // handles HTTPS automatically, no need for server.https: true
  ],
  resolve: {
    alias: {
      // Applied at dev-server runtime and during build.
      "node:async_hooks": asyncHooksPolyfill,
    },
  },
  optimizeDeps: {
    // Applied during esbuild pre-bundling, which runs before alias resolution.
    esbuildOptions: {
      plugins: [
        {
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
      external: [/^@arcgis\//],
    },
  },
});
