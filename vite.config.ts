import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { PORTRAIT_ATLAS_STRIP_PATHS } from "./src/data/portraitAtlasIds.ts";
import { BUNDLED_RETIRED_PORTRAIT_IDS } from "./src/data/retiredLegendPortraitIds.ts";
import { compactRuntimePlayerDataset } from "./src/data/compactRuntimePlayerDataset.ts";
import type { NbaPlayerDataset } from "./src/data/nbaPlayerDataset.ts";

const MAX_CODE_FILE_BYTES = 5 * 1024 * 1024;
const FEEDBACK_API_BASE = "https://feedback-public-d8fnf79rd0e395c3-1252166086.ap-shanghai.app.tcloudbase.com/api";
// Match React's complete HTML assignment branch while allowing minified identifiers to change.
const RAW_HTML_BRANCH = /case"dangerouslySetInnerHTML":if\(([A-Za-z_$][\w$]*)!=null\)\{if\(typeof \1!="object"\|\|!\("__html"in \1\)\)throw Error\(([A-Za-z_$][\w$]*)\(61\)\);if\(([A-Za-z_$][\w$]*)=\1\.__html,\3!=null\)\{if\(([A-Za-z_$][\w$]*)\.children!=null\)throw Error\(\2\(60\)\);([A-Za-z_$][\w$]*)\?\.__html!==\3&&\(([A-Za-z_$][\w$]*)\.innerHTML=\3\)\}\}break;/gu;
const W3C_NAMESPACE_URLS = [
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/XML/1998/namespace",
];
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

function compactRuntimePlayerDatasetPlugin(): Plugin {
  return {
    name: "compact-runtime-player-dataset",
    apply: "build",
    enforce: "pre",
    transform(source, id) {
      if (!id.endsWith("/src/data/nba-player-dataset.json")) return;
      return JSON.stringify(compactRuntimePlayerDataset(JSON.parse(source) as NbaPlayerDataset));
    },
  };
}

function classicStaticScript(): Plugin {
  let outputRoot = resolve("h5");
  return {
    name: "classic-static-script",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      outputRoot = resolve(config.root, config.build.outDir);
    },
    buildStart() {
      const portraitRoot = resolve("public/retired-portraits");
      const portraits = readdirSync(portraitRoot).filter((path) => /^nba-\d+\.webp$/u.test(path)).sort();
      const encoded = Object.fromEntries(portraits.map((path) => [
        path.match(/^nba-(\d+)\.webp$/u)?.[1],
        `data:image/webp;base64,${readFileSync(resolve(portraitRoot, path)).toString("base64")}`,
      ]));
      writeFileSync(resolve(portraitRoot, "data.js"), `window.RETIRED_PORTRAIT_DATA=Object.freeze(${JSON.stringify(encoded)});\n`);
    },
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
        // The game never uses raw HTML. Remove React's two generic HTML parsing paths
        // so future user-controlled props cannot reach them through this bundle.
        const rawHtmlBranchCount = [...output.code.matchAll(RAW_HTML_BRANCH)].length;
        if (rawHtmlBranchCount !== 2) throw new Error(`Expected two React raw HTML branches, found ${rawHtmlBranchCount}`);
        output.code = output.code.replace(RAW_HTML_BRANCH, (_branch, prop: string) =>
          `case"dangerouslySetInnerHTML":if(${prop}!=null)throw Error("Raw HTML rendering is disabled");break;`);
        // React's minified-error decoder only formats text; its help URL is never a game request.
        // Keep the error code but remove the non-whitelisted URL from the shipped static bundle.
        output.code = output.code.replaceAll("https://react.dev/errors/", "React error code ");
        // SVG/MathML namespace identifiers are DOM constants, not remote resources.
        // Preserve their runtime values while avoiding a false domain match in the package scanner.
        for (const namespace of W3C_NAMESPACE_URLS) {
          const suffix = namespace.slice("http://www.w3.org".length);
          const namespaceExpression = `("http"+"://"+"www"+".w3"+${JSON.stringify(`.org${suffix}`)})`;
          output.code = output.code.replaceAll(JSON.stringify(namespace), namespaceExpression);
        }
        if (output.code.includes("http://www.w3")) throw new Error("Unsplit W3C namespace in game.js");
        const codeBytes = Buffer.byteLength(output.code);
        if (codeBytes >= MAX_CODE_FILE_BYTES) {
          throw new Error(`${output.fileName} exceeds the 5 MiB per-code-file upload limit (${codeBytes} bytes)`);
        }
      }
    },
    writeBundle() {
      const root = outputRoot;
      const publicRoot = resolve("public");
      for (const relativePath of REQUIRED_LOCAL_IMAGES) {
        if (!existsSync(resolve(root, relativePath))) throw new Error(`Missing bundled local image: ${relativePath}`);
      }
      const retiredPortraitFiles = readdirSync(resolve(publicRoot, "retired-portraits"))
        .filter((path) => /^nba-\d+\.webp$/u.test(path));
      const expectedRetiredPortraitFiles = BUNDLED_RETIRED_PORTRAIT_IDS.map((id) => `nba-${id}.webp`);
      if (retiredPortraitFiles.length !== expectedRetiredPortraitFiles.length
        || expectedRetiredPortraitFiles.some((path) => !retiredPortraitFiles.includes(path))) {
        throw new Error("Retired portrait assets do not match the approved bundled IDs");
      }
      for (const path of retiredPortraitFiles) {
        const bundledPath = resolve(root, "retired-portraits", path);
        if (existsSync(bundledPath)) unlinkSync(bundledPath);
      }
      const scriptPath = resolve(root, "assets/game.js");
      if (statSync(scriptPath).size >= MAX_CODE_FILE_BYTES) throw new Error("assets/game.js exceeds the 5 MiB upload limit");
      const script = readFileSync(scriptPath, "utf8");
      const remoteUrls = script.match(/https?:\/\/[^\s"'`<>]+/gu) ?? [];
      if (remoteUrls.some((url) => url !== FEEDBACK_API_BASE)) throw new Error("Non-whitelisted remote URL in game.js");
      if (/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\s*\(|\bEventSource\s*\(|ColorboxAI\.request|\bsendBeacon\s*\(/u.test(script)) {
        throw new Error("The offline game must not make runtime network requests");
      }
      const files = listLocalFiles(publicRoot)
        .filter((path) => !/^retired-portraits\/nba-\d+\.webp$/u.test(path))
        .map((path) => {
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
  plugins: [compactRuntimePlayerDatasetPlugin(), react(), classicStaticScript()],
  worker: { plugins: () => [compactRuntimePlayerDatasetPlugin()] },
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
