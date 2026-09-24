import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { PORTRAIT_ATLAS_STRIP_PATHS } from "./src/data/portraitAtlasIds.ts";

const MAX_CODE_FILE_BYTES = 5 * 1024 * 1024;
const REQUIRED_LOCAL_IMAGES = [
  "story/opening-arena.jpg",
  "story/championship-celebration.jpg",
  "assets/story/opening-arena.jpg",
  "assets/story/championship-celebration.jpg",
  ...PORTRAIT_ATLAS_STRIP_PATHS.map((path) => path.slice(2)),
];

function listLocalFiles(root: string, directory = ""): string[] {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listLocalFiles(root, path);
    if (!entry.isFile()) throw new Error(`Unsupported public asset: ${path}`);
    return [path];
  });
}

function classicStaticScript(): Plugin {
  return {
    name: "classic-static-script",
    apply: "build",
    enforce: "post",
    transformIndexHtml(html) {
      return html
        .replace(/\s*<script data-local-file-redirect>[\s\S]*?<\/script>/u, "")
        .replace(/<script type="module"(?: crossorigin)? src=/g, "<script defer src=");
    },
    generateBundle(_options, bundle) {
      const htmlEntry = Object.values(bundle).find((output) => output.type === "asset" && output.fileName === "app.html");
      if (htmlEntry?.type === "asset") htmlEntry.fileName = "index.html";
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        // React's minified-error decoder only formats text; its help URL is never a game request.
        // Keep the error code but remove the non-whitelisted URL from the shipped static bundle.
        output.code = output.code.replaceAll("https://react.dev/errors/", "React error code ");
        if (Buffer.byteLength(output.code) >= MAX_CODE_FILE_BYTES) {
          throw new Error(`${output.fileName} exceeds the 5 MiB per-code-file upload limit`);
        }
      }
    },
    closeBundle() {
      const root = resolve("h5");
      const publicRoot = resolve("public");
      for (const relativePath of REQUIRED_LOCAL_IMAGES) {
        if (!existsSync(resolve(root, relativePath))) throw new Error(`Missing bundled local image: ${relativePath}`);
      }
      const scriptPath = resolve(root, "assets/game.js");
      if (statSync(scriptPath).size >= MAX_CODE_FILE_BYTES) throw new Error("assets/game.js exceeds the 5 MiB upload limit");
      const script = readFileSync(scriptPath, "utf8");
      const remoteUrls = script.match(/https?:\/\/[^\s"'`<>]+/gu) ?? [];
      if (remoteUrls.some((url) => !url.startsWith("http://www.w3.org/"))) throw new Error("Non-whitelisted remote URL in game.js");
      if (/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\s*\(|\bEventSource\s*\(|ColorboxAI\.request|\bsendBeacon\s*\(/u.test(script)) {
        throw new Error("The offline game must not make runtime network requests");
      }
      const files = listLocalFiles(publicRoot).map((path) => {
        const source = readFileSync(resolve(publicRoot, path));
        const destination = resolve(root, path);
        if (!existsSync(destination)) throw new Error(`Missing bundled public asset: ${path}`);
        const bundled = readFileSync(destination);
        const sha256 = createHash("sha256").update(source).digest("hex");
        if (sha256 !== createHash("sha256").update(bundled).digest("hex")) throw new Error(`Bundled asset changed: ${path}`);
        return { path, bytes: bundled.byteLength, sha256 };
      });
      writeFileSync(resolve(root, "local-assets-manifest.json"), `${JSON.stringify({ offline: true, files }, null, 2)}\n`);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), classicStaticScript()],
  build: {
    outDir: "h5",
    emptyOutDir: true,
    minify: "esbuild",
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
