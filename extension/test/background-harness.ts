// Bundled by test/confirmation-sync.test.mjs. Importing background.ts also runs
// its top-level listener registrations, which the chrome shim absorbs — so the
// test exercises the real worker rather than a copy of its logic.

import { handleMessage } from "../src/background/background";

export { handleMessage };
