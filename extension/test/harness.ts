// Bundled by test/run-e2e.mjs and injected into the fixture page so the
// REAL autofill implementation runs against mock-Workday markup.

import { applyAnswers, findEmptyRequiredFields, findQuestionFields, parseDateParts, runAutofill } from "../src/content/autofill";
import { undoFill } from "../src/content/dom-utils";
import type { AutofillPackage, CustomFillRule } from "../src/types";

declare global {
  interface Window {
    WorkdayzTest: {
      runAutofill: (pkg: AutofillPackage, rules?: CustomFillRule[]) => ReturnType<typeof runAutofill>;
      findQuestionFields: typeof findQuestionFields;
      findEmptyRequiredFields: typeof findEmptyRequiredFields;
      applyAnswers: typeof applyAnswers;
      parseDateParts: typeof parseDateParts;
      undoFill: typeof undoFill;
    };
  }
}

window.WorkdayzTest = { runAutofill, findQuestionFields, findEmptyRequiredFields, applyAnswers, parseDateParts, undoFill };
