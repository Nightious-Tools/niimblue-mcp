// Two-stage build: the page bundle (browser IIFE, run inside headless Chrome) is inlined into dist/index.mjs as __PAGE_JS__.
import * as esbuild from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";

// "$/x" = NiimBlue's own src/x, as in its vite config
export const alias = { $: fileURLToPath(new URL("./node_modules/niimblue/src", import.meta.url)) };

/** Stage 1, in memory: returns the page JS text. Also used by vitest.config.ts. */
export async function buildPage() {
  const r = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("./src/page/render.ts", import.meta.url))], bundle: true, format: "iife", platform: "browser",
    target: "chrome120", minify: true, alias, loader: { ".woff2": "binary" }, write: false, logLevel: "warning",
  });
  return r.outputFiles[0].text;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await esbuild.build({
    entryPoints: ["src/index.ts"], bundle: true, platform: "node", format: "esm", packages: "bundle", target: "node20",
    outfile: "dist/index.mjs", alias, define: { __PAGE_JS__: JSON.stringify(await buildPage()) }, logLevel: "warning",
    // @capacitor/* is in here: niimbluelib's root import pulls it in and its deep printer_models import is circular (F3)
    banner: { js: "import{createRequire}from'node:module';const require=createRequire(import.meta.url);\n/*! Includes NiimBlue (MIT) and third-party code and fonts: see THIRD_PARTY_NOTICES.md */" },
  });
}
