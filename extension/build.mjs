import * as esbuild from "esbuild";
import { mkdirSync, copyFileSync, cpSync, rmSync } from "fs";

const watch = process.argv.includes("--watch");

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/popup", { recursive: true });

// Background is a real MV3 module service worker; content scripts and the
// popup are plain injected/loaded scripts and must not contain import/export
// syntax, so those are bundled as IIFEs.
const common = { bundle: true, target: "chrome110", outdir: "dist", sourcemap: true, logLevel: "info" };

const builds = [
  { ...common, entryPoints: [{ in: "src/background/background.ts", out: "background" }], format: "esm" },
  {
    ...common,
    entryPoints: [
      { in: "src/content/workday.ts", out: "content/workday" },
      { in: "src/content/web-app-bridge.ts", out: "content/web-app-bridge" },
      { in: "src/popup/popup.ts", out: "popup/popup" },
    ],
    format: "iife",
  },
];

copyFileSync("manifest.json", "dist/manifest.json");
copyFileSync("src/popup/popup.html", "dist/popup/popup.html");
cpSync("icons", "dist/icons", { recursive: true });

if (watch) {
  const ctxs = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(ctxs.map((ctx) => ctx.watch()));
  console.log("Watching for changes...");
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
