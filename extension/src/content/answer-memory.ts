/**
 * Answer memory: remembers how you answered recurring screening questions
 * ("How many years of Python experience do you have?", "Do you hold an active
 * security clearance?", "What are your salary expectations?") so the next
 * tenant asking the same thing fills from history instead of from scratch.
 *
 * Distinct from the popup's custom rules, which you type by hand and which
 * match on a label *substring*. Memory is captured from real answers you
 * already gave and matches on the normalized question text, so it can hold
 * many similar-but-different questions without them colliding.
 *
 * Two deliberate asymmetries:
 *   - Recall is automatic (that's the point — it saves the typing).
 *   - Capture is an explicit click. Silently harvesting everything typed into
 *     a job application into local storage is not a default anyone asked for.
 *
 * Self-identification questions (veteran/disability/gender/race/pronouns) are
 * never captured and never filled — enforced with autofill.ts's isPersonalField
 * so there is exactly one copy of that exclusion list.
 */

import { STORAGE_KEYS } from "../types";
import { isPersonalField } from "./autofill";
import { fieldLabelText, findFillableFields, setFieldValue, type FillableElement } from "./dom-utils";

export interface RememberedAnswer {
  /** The question as it was actually worded, for display in the UI. */
  label: string;
  answer: string;
  /** ISO timestamp — most recent capture or reuse. Drives eviction. */
  lastUsed: string;
  /** How many times this has been recalled; surfaces the ones that earn space. */
  useCount: number;
}

export type AnswerMemory = Record<string, RememberedAnswer>;

/** Storage is finite (chrome.storage.local is ~5MB shared across the whole
 * extension), and a stale answer is worse than no answer. Caps keep both
 * bounded without the user ever having to prune by hand. */
const MAX_ENTRIES = 200;
const MAX_ANSWER_CHARS = 2000;
const MAX_LABEL_CHARS = 300;

/** Shortest a question can be and still be a question worth remembering.
 * Matches findQuestionFields' own floor so the two agree on what counts. */
const MIN_QUESTION_CHARS = 12;

/** Below this length, a containment match is too likely to be a coincidence
 * ("years" would match a dozen unrelated questions), so only exact keys apply. */
const MIN_FUZZY_KEY_CHARS = 20;

/**
 * Collapses a question to a stable lookup key: case, punctuation, and
 * whitespace differences between tenants shouldn't split one question into
 * two memories. "How many years of experience do you have?" and
 * "How many years of experience do you have" land on the same key.
 */
export function memoryKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when this question may be remembered/recalled at all. */
function isRemembererable(label: string): boolean {
  const trimmed = label.trim();
  if (trimmed.length < MIN_QUESTION_CHARS) return false;
  // The one hard rule: self-ID is the applicant's alone, always.
  if (isPersonalField(trimmed)) return false;
  // A cover letter is generated per job — a remembered one would be wrong.
  if (/cover letter/i.test(trimmed)) return false;
  return true;
}

export async function loadAnswerMemory(): Promise<AnswerMemory> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.answerMemory);
    const raw = data[STORAGE_KEYS.answerMemory];
    return raw && typeof raw === "object" ? (raw as AnswerMemory) : {};
  } catch {
    return {}; // orphaned content script
  }
}

async function writeAnswerMemory(memory: AnswerMemory): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.answerMemory]: memory });
  } catch {
    /* orphaned content script */
  }
}

/** Drops the least-recently-used entries once over cap, so the store can't
 * grow without bound across hundreds of applications. */
function evictToCap(memory: AnswerMemory): AnswerMemory {
  const keys = Object.keys(memory);
  if (keys.length <= MAX_ENTRIES) return memory;
  const keep = keys
    .sort((a, b) => Date.parse(memory[b].lastUsed || "") - Date.parse(memory[a].lastUsed || ""))
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(keep.map((k) => [k, memory[k]]));
}

/**
 * Stores one question/answer pair. Returns false when the question is not
 * eligible (too short, self-ID, empty answer) so callers can report honestly
 * instead of implying something was saved.
 */
export async function rememberAnswer(label: string, answer: string): Promise<boolean> {
  const trimmedAnswer = answer.trim();
  if (!trimmedAnswer || !isRemembererable(label)) return false;

  const memory = await loadAnswerMemory();
  const key = memoryKey(label);
  if (!key) return false;

  memory[key] = {
    label: label.trim().slice(0, MAX_LABEL_CHARS),
    answer: trimmedAnswer.slice(0, MAX_ANSWER_CHARS),
    lastUsed: new Date().toISOString(),
    useCount: memory[key]?.useCount ?? 0,
  };
  await writeAnswerMemory(evictToCap(memory));
  return true;
}

/** Removes one remembered answer. */
export async function forgetAnswer(key: string): Promise<void> {
  const memory = await loadAnswerMemory();
  if (!(key in memory)) return;
  delete memory[key];
  await writeAnswerMemory(memory);
}

/** Wipes the whole memory bank. */
export async function clearAnswerMemory(): Promise<void> {
  await writeAnswerMemory({});
}

/** Newest first — what the popup lists. */
export async function listRememberedAnswers(): Promise<Array<RememberedAnswer & { key: string }>> {
  const memory = await loadAnswerMemory();
  return Object.entries(memory)
    .map(([key, entry]) => ({ key, ...entry }))
    .sort((a, b) => Date.parse(b.lastUsed || "") - Date.parse(a.lastUsed || ""));
}

/**
 * Finds the best remembered answer for a question. Exact normalized match
 * wins; failing that, a containment match in either direction, but only for
 * keys long enough that overlap means something. Among several containment
 * candidates the longest (most specific) key wins.
 */
export function matchRemembered(label: string, memory: AnswerMemory): RememberedAnswer | null {
  const key = memoryKey(label);
  if (!key) return null;
  if (memory[key]) return memory[key];

  let best: { key: string; entry: RememberedAnswer } | null = null;
  for (const [candidateKey, entry] of Object.entries(memory)) {
    if (candidateKey.length < MIN_FUZZY_KEY_CHARS) continue;
    const overlaps = key.includes(candidateKey) || candidateKey.includes(key);
    if (!overlaps) continue;
    if (!best || candidateKey.length > best.key.length) best = { key: candidateKey, entry };
  }
  return best?.entry ?? null;
}

/** A question field on the page, paired with its current value. */
interface ScannedQuestion {
  label: string;
  el: FillableElement;
  value: string;
}

/**
 * Every question-shaped field on the page, filled or not. Deliberately
 * separate from autofill.ts's findQuestionFields, which skips non-empty
 * fields — capture needs exactly the ones that DO have answers.
 */
function scanQuestions(): ScannedQuestion[] {
  const found: ScannedQuestion[] = [];
  for (const el of findFillableFields()) {
    const label = fieldLabelText(el).trim();
    if (!isRemembererable(label)) continue;
    const isTextarea = el instanceof HTMLTextAreaElement;
    // Same shape test as findQuestionFields: a textarea, or a label that asks
    // something. Keeps contact fields out of the memory bank.
    if (!isTextarea && !label.includes("?")) continue;
    found.push({ label, el, value: (el as HTMLInputElement).value ?? "" });
  }
  return found;
}

/**
 * Saves every answered question on the current page. Returns what it stored
 * and what it deliberately passed over, so the widget can say so out loud.
 */
export async function captureAnswersFromPage(): Promise<{ saved: string[]; skipped: number }> {
  const saved: string[] = [];
  let skipped = 0;
  for (const q of scanQuestions()) {
    if (!q.value.trim()) {
      skipped++;
      continue;
    }
    if (await rememberAnswer(q.label, q.value)) saved.push(q.label.slice(0, 60));
    else skipped++;
  }
  return { saved, skipped };
}

/**
 * Fills empty question fields from memory. Never touches a field that already
 * has a value — the form's own prefill and anything you typed both win over
 * history. Bumps useCount/lastUsed on whatever it actually used.
 */
export async function applyRememberedAnswers(): Promise<{ filled: string[] }> {
  const memory = await loadAnswerMemory();
  if (!Object.keys(memory).length) return { filled: [] };

  const filled: string[] = [];
  const touchedKeys = new Set<string>();

  for (const q of scanQuestions()) {
    if (q.value.trim()) continue; // never overwrite an existing answer
    const hit = matchRemembered(q.label, memory);
    if (!hit) continue;
    setFieldValue(q.el, hit.answer);
    filled.push(`remembered: ${q.label.slice(0, 40)}`);
    touchedKeys.add(memoryKey(hit.label));
  }

  if (touchedKeys.size) {
    const now = new Date().toISOString();
    for (const key of touchedKeys) {
      if (!memory[key]) continue;
      memory[key] = { ...memory[key], useCount: memory[key].useCount + 1, lastUsed: now };
    }
    await writeAnswerMemory(memory);
  }
  return { filled };
}

/**
 * Dry-run counterpart: which questions WOULD be answered from memory, without
 * writing anything. Feeds the widget's existing preview mode.
 */
export async function previewRememberedAnswers(): Promise<Array<{ label: string; answer: string }>> {
  const memory = await loadAnswerMemory();
  if (!Object.keys(memory).length) return [];
  const planned: Array<{ label: string; answer: string }> = [];
  for (const q of scanQuestions()) {
    if (q.value.trim()) continue;
    const hit = matchRemembered(q.label, memory);
    if (hit) planned.push({ label: q.label.slice(0, 60), answer: hit.answer });
  }
  return planned;
}
