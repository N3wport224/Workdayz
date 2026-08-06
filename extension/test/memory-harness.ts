// Bundled by test/answer-memory.test.mjs and injected into the fixture page so
// the REAL answer-memory implementation runs against mock-Workday markup and a
// shimmed chrome.storage.local.

import {
  applyRememberedAnswers,
  captureAnswersFromPage,
  clearAnswerMemory,
  forgetAnswer,
  listRememberedAnswers,
  memoryKey,
  previewRememberedAnswers,
  rememberAnswer,
} from "../src/content/answer-memory";

export {
  applyRememberedAnswers,
  captureAnswersFromPage,
  clearAnswerMemory,
  forgetAnswer,
  listRememberedAnswers,
  memoryKey,
  previewRememberedAnswers,
  rememberAnswer,
};
