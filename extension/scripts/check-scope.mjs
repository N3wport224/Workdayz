// Item 83: CI guard for the project's core security constraint — the
// extension must NEVER run anywhere but public *.myworkdayjobs.com career
// sites (plus the optional-permission web-app bridge the user grants
// explicitly). A PR that widens the manifest fails CI here.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "..", "manifest.json"), "utf-8"));

const ALLOWED = new Set(["*://*.myworkdayjobs.com/*"]);
const failures = [];

for (const script of manifest.content_scripts ?? []) {
  for (const match of script.matches ?? []) {
    if (!ALLOWED.has(match)) failures.push(`content_scripts match: ${match}`);
  }
}
for (const perm of manifest.host_permissions ?? []) {
  if (!ALLOWED.has(perm)) failures.push(`host_permissions: ${perm}`);
}
// The internal-Workday domains must never appear anywhere in the manifest.
const raw = JSON.stringify(manifest);
if (/myworkday\.com|(?<!myworkdayjobs)\bworkday\.com/.test(raw)) {
  failures.push("manifest references an internal Workday domain (myworkday.com / workday.com)");
}

if (failures.length) {
  console.error("❌ Extension scope check FAILED — the manifest reaches beyond *.myworkdayjobs.com:");
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log("✅ Extension scope check passed: *.myworkdayjobs.com only.");
