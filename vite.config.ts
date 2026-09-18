import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

function classicStaticScript(): Plugin {
  return {
    name: "classic-static-script",
    apply: "build",
    enforce: "post",
    transformIndexHtml(html) {
      return html.replace(/<script type="module"(?: crossorigin)? src=/g, "<script defer src=");
    },
    generateBundle(_options, bundle) {
      const htmlEntry = Object.values(bundle).find((output) => output.type === "asset" && output.fileName === "app.html");
      if (htmlEntry?.type === "asset") htmlEntry.fileName = "index.html";
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), classicStaticScript()],
  build: {
    outDir: "h5",
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: new URL("./app.html", import.meta.url).pathname,
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "assets/game.js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
