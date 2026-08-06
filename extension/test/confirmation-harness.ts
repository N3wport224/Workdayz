// Bundled by test/confirmation.test.mjs and injected into the fixture page so
// the REAL confirmation detection runs against mock-Workday markup.
// looksLikeApplicationForm is re-exported so the suite can assert its form
// fixture genuinely trips the veto (otherwise the veto tests prove nothing).

import {
  buildConfirmationEvent,
  confirmationKey,
  DEDUPE_WINDOW_MS,
  detectConfirmation,
  isDuplicate,
} from "../src/content/confirmation";
import { looksLikeApplicationForm } from "../src/content/autofill";

export {
  buildConfirmationEvent,
  confirmationKey,
  DEDUPE_WINDOW_MS,
  detectConfirmation,
  isDuplicate,
  looksLikeApplicationForm,
};
