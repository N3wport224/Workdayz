// Bundled by test/run-e2e.mjs and injected into the fixture page so the
// REAL autofill implementation runs against mock-Workday markup.

import { applyAnswers, buildFieldReport, findEmptyRequiredFields, findQuestionFields, parseDateParts, previewAutofill, runAutofill } from "../src/content/autofill";
import { undoFill } from "../src/content/dom-utils";
import { diffFormVsProfile } from "../src/content/features";
import { escapeHtml, mountWidget } from "../src/content/widget";
import type { AutofillPackage, CustomFillRule } from "../src/types";

declare global {
  interface Window {
    WorkdayzTest: {
      runAutofill: (pkg: AutofillPackage, rules?: CustomFillRule[]) => ReturnType<typeof runAutofill>;
      previewAutofill: typeof previewAutofill;
      buildFieldReport: typeof buildFieldReport;
      findQuestionFields: typeof findQuestionFields;
      findEmptyRequiredFields: typeof findEmptyRequiredFields;
      applyAnswers: typeof applyAnswers;
      parseDateParts: typeof parseDateParts;
      undoFill: typeof undoFill;
      diffFormVsProfile: typeof diffFormVsProfile;
      escapeHtml: typeof escapeHtml;
      mountWidget: typeof mountWidget;
    };
  }
}

window.WorkdayzTest = {
  runAutofill, previewAutofill, buildFieldReport, findQuestionFields, findEmptyRequiredFields,
  applyAnswers, parseDateParts, undoFill, diffFormVsProfile, escapeHtml, mountWidget,
};
