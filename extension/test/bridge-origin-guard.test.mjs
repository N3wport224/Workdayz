// Regression test for the bridge-origin security fix: the web-app bridge
// (registerBridgeForOrigin in background.ts, the popup's Connect button)
// must never register on a Workday domain, since myworkdayjobs.com is
// already a required host permission — chrome.permissions.request() for
// it would succeed with no prompt, letting a Workday tenant page forge
// profile-store messages. isWorkdayDomain() is the shared guard; this
// bundles it with esbuild and runs plain assertions (no browser needed —
// it's a pure function).
import * as esbuild from "esbuild";
import { fileURLToPath } from "url";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));

const bundle = await esbuild.build({
  entryPoints: [path.join(here, "..", "src", "types.ts")],
  bundle: true,
  format: "esm",
  write: false,
  target: "node18",
});
const mod = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const { isWorkdayDomain } = mod;

const failures = [];
function check(name, cond) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures.push(name); console.error(`FAIL  ${name}`); }
}

check("blocks the apex myworkdayjobs.com", isWorkdayDomain("myworkdayjobs.com"));
check("blocks a real tenant subdomain", isWorkdayDomain("acme.myworkdayjobs.com"));
check("blocks a multi-level tenant subdomain", isWorkdayDomain("acme.wd5.myworkdayjobs.com"));
check("blocks the internal myworkday.com portal", isWorkdayDomain("acme.myworkday.com"));
check("blocks bare workday.com", isWorkdayDomain("workday.com"));
check("blocks a workday.com subdomain", isWorkdayDomain("www.workday.com"));
check("is case-insensitive", isWorkdayDomain("Acme.MyWorkdayJobs.COM"));
check("does NOT block localhost", !isWorkdayDomain("localhost"));
check("does NOT block a real deployed web app host", !isWorkdayDomain("workdayz.vercel.app"));
// The exact bypass class the old .endsWith() SSRF bug hit elsewhere in this
// project — a domain that merely contains the string as a substring, not a
// real subdomain, must NOT be treated as a match in the other direction:
// this guard only needs to be strict about blocking Workday, so a
// non-Workday host that happens to contain "workday" should stay allowed.
check("does NOT block an unrelated host containing the word 'workday'", !isWorkdayDomain("notworkdayatall.example.com"));

if (failures.length) {
  console.error(`\n${failures.length} bridge-origin-guard check(s) failed.`);
  process.exit(1);
}
console.log("\nAll bridge-origin-guard checks passed.");
