// Experimental Firefox (MV3) build: Firefox runs the background as an event
// page (background.scripts), not a service worker, and doesn't support
// module background scripts — so the background is re-bundled as an IIFE and
// the manifest patched. Everything else (content scripts, popup) is shared.
//
// Usage: npm run build:firefox   → dist-firefox/ (load via about:debugging →
// This Firefox → Load Temporary Add-on)

import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";

rmSync("dist-firefox", { recursive: true, force: true });
mkdirSync("dist-firefox", { recursive: true });

// Reuse the standard Chrome build output for everything except background.
cpSync("dist", "dist-firefox", { recursive: true });

await esbuild.build({
  bundle: true,
  target: "firefox121",
  entryPoints: [{ in: "src/background/background.ts", out: "background" }],
  outdir: "dist-firefox",
  format: "iife",
  sourcemap: true,
  logLevel: "info",
});

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.background = { scripts: ["background.js"] };
manifest.browser_specific_settings = {
  gecko: { id: "workdayz@example.local", strict_min_version: "121.0" },
};
writeFileSync("dist-firefox/manifest.json", JSON.stringify(manifest, null, 2));

console.log("wrote dist-firefox/ (experimental Firefox build)");
