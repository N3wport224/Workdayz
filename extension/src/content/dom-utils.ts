// Generic, label-driven form utilities. Workday tenants heavily customize
// field labels/markup, so this deliberately does fuzzy, synonym-based
// matching instead of hardcoded CSS selectors — it will need occasional
// tuning per tenant (see extension/README.md).

export type FillableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Raw (un-normalized) label text for a field — used when the actual wording
 * matters, e.g. sending an application question's text to the LLM. */
export function fieldLabelText(el: Element): string {
  const parts: string[] = [];

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) parts.push(ariaLabel);

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      const node = document.getElementById(id);
      if (node?.textContent) parts.push(node.textContent);
    }
  }

  const id = el.getAttribute("id");
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent) parts.push(label.textContent);
  }

  const wrappingLabel = el.closest("label");
  if (wrappingLabel?.textContent) parts.push(wrappingLabel.textContent);

  const placeholder = el.getAttribute("placeholder");
  if (placeholder) parts.push(placeholder);

  // Workday commonly renders a <fieldset>/<div> with a heading label above
  // the field's own container. Start the lookup from the PARENT — fields like
  // dateSectionMonth-input carry their own data-automation-id, and closest()
  // from the element itself would match the field instead of its container.
  const container = el.parentElement?.closest('[data-automation-id], fieldset, div[role="group"]');
  if (container) {
    const heading = container.querySelector("label, legend, [data-automation-id$='label']");
    if (heading?.textContent && heading !== wrappingLabel) {
      // Don't inherit a heading that is explicitly some OTHER field's label,
      // or one sibling's label bleeds into every field in the group.
      const forId = heading.getAttribute("for");
      if (!forId || forId === id) parts.push(heading.textContent);
    }
  }

  const automationId = el.getAttribute("data-automation-id");
  if (automationId) parts.push(automationId.replace(/([a-z])([A-Z])/g, "$1 $2"));

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function labelForElement(el: Element): string {
  return normalize(fieldLabelText(el));
}

/** Like findFieldBySynonyms but requires the label to contain EVERY term —
 * used for compound fields like "start date" + "month". */
export function findFieldByAllTerms(
  fields: FillableElement[],
  terms: string[],
  { onlyEmpty = true }: { onlyEmpty?: boolean } = {},
): FillableElement | null {
  for (const el of fields) {
    if (onlyEmpty && !isEmpty(el)) continue;
    const label = labelForElement(el);
    if (label && terms.every((t) => label.includes(normalize(t)))) return el;
  }
  return null;
}

export function isVisible(el: Element): boolean {
  const rect = (el as HTMLElement).getBoundingClientRect();
  const style = window.getComputedStyle(el as HTMLElement);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function isEmpty(el: FillableElement): boolean {
  if (el instanceof HTMLSelectElement) return !el.value;
  return !el.value?.trim();
}

function isSearchCombobox(el: Element): boolean {
  return el.getAttribute("role") === "combobox" || Boolean(el.getAttribute("aria-autocomplete"));
}

export function findFillableFields(): FillableElement[] {
  const candidates = Array.from(
    document.querySelectorAll<FillableElement>("input:not([type=hidden]):not([type=file]), textarea, select"),
  );
  return candidates.filter(
    (el) =>
      isVisible(el) &&
      !el.disabled &&
      // Type-ahead comboboxes need their option clicked to commit a value —
      // plain text-filling them leaves an uncommitted value Workday ignores.
      // They're handled by fillSearchCombobox instead.
      !isSearchCombobox(el) &&
      (el instanceof HTMLSelectElement || !(el as HTMLInputElement).readOnly),
  );
}

/** Finds an empty type-ahead search combobox (input[role="combobox"] /
 * aria-autocomplete) whose label matches one of the synonyms. */
export function findComboboxBySynonyms(container: ParentNode, synonyms: string[]): HTMLInputElement | null {
  const inputs = Array.from(
    container.querySelectorAll<HTMLInputElement>(
      'input[role="combobox"], input[aria-autocomplete]',
    ),
  );
  for (const el of inputs) {
    if (!isVisible(el) || el.disabled || el.readOnly || el.value.trim()) continue;
    const label = labelForElement(el);
    if (synonyms.some((s) => label.includes(normalize(s)))) return el;
  }
  return null;
}

/** Types into a search combobox, waits for the filtered options, and clicks
 * the best match; clears the input again if nothing matches so Workday isn't
 * left with an uncommitted value. */
export async function fillSearchCombobox(input: HTMLInputElement, value: string): Promise<boolean> {
  setFieldValue(input, value);
  const option = await waitForOption(value, 2000);
  if (!option) {
    setFieldValue(input, "");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return false;
  }
  option.click();
  return true;
}

/**
 * Finds the best unfilled field whose label matches one of the given
 * synonyms (case-insensitive substring match, longest synonym wins ties).
 */
export function findFieldBySynonyms(
  fields: FillableElement[],
  synonyms: string[],
  { onlyEmpty = true }: { onlyEmpty?: boolean } = {},
): FillableElement | null {
  return findAllFieldsBySynonyms(fields, synonyms, { onlyEmpty })[0] ?? null;
}

/** Same matching as findFieldBySynonyms, but returns every match ordered by
 * relevance — used to locate one anchor field per repeated panel (e.g. one
 * "Job Title" field per work-experience entry). */
export function findAllFieldsBySynonyms(
  fields: FillableElement[],
  synonyms: string[],
  { onlyEmpty = true }: { onlyEmpty?: boolean } = {},
): FillableElement[] {
  const matches: { el: FillableElement; score: number; index: number }[] = [];
  fields.forEach((el, index) => {
    if (onlyEmpty && !isEmpty(el)) return;
    const label = labelForElement(el);
    if (!label) return;
    for (const syn of synonyms) {
      const needle = normalize(syn);
      if (label.includes(needle)) {
        matches.push({ el, score: needle.length, index });
        break;
      }
    }
  });
  matches.sort((a, b) => b.score - a.score || a.index - b.index);
  return matches.map((m) => m.el);
}

/**
 * Walks up from `anchor` to find the smallest ancestor that also encloses at
 * least one other field from `fields` — a best-effort way to find the
 * boundary of a single repeated panel (e.g. one job entry) without relying
 * on tenant-specific markup.
 */
export function findPanelContainer(
  anchor: HTMLElement,
  fields: FillableElement[],
  /** One anchor per sibling panel: the walk stops before an ancestor that
   * contains a SECOND anchor, so the last panel can't climb to <body> and
   * swallow the whole form. */
  allAnchors?: FillableElement[],
): HTMLElement {
  let el: HTMLElement | null = anchor.parentElement;
  let best: HTMLElement = anchor.parentElement ?? anchor;
  for (let depth = 0; depth < 8 && el; depth++) {
    if (allAnchors && allAnchors.filter((a) => el!.contains(a)).length > 1) break;
    const enclosed = fields.filter((f) => el!.contains(f)).length;
    if (enclosed >= 2) {
      best = el;
      if (enclosed >= 6) break; // large enough to be the whole panel
    }
    el = el.parentElement;
  }
  return best;
}

/**
 * Workday renders most dropdowns as <button aria-haspopup="listbox"> (or
 * role="combobox") rather than native <select>. Finds one by label within a
 * container, skipping anything already showing a chosen value.
 */
export function findListboxButtonBySynonyms(
  container: ParentNode,
  synonyms: string[],
): HTMLElement | null {
  const buttons = Array.from(
    container.querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"], [role="combobox"]'),
  );
  let best: { el: HTMLElement; score: number } | null = null;
  for (const el of buttons) {
    if (!isVisible(el)) continue;
    const label = labelForElement(el);
    if (!label) continue;
    for (const syn of synonyms) {
      const needle = normalize(syn);
      if (label.includes(needle) && needle.length > (best?.score ?? 0)) {
        best = { el, score: needle.length };
      }
    }
  }
  return best?.el ?? null;
}

function listboxAlreadyHasValue(button: HTMLElement): boolean {
  const text = normalize(button.textContent ?? "");
  // Workday placeholders read "select one", "select…", or are empty.
  return Boolean(text) && !/^select( one)?$/.test(text);
}

// Profiles often store abbreviations while Workday dropdowns list full
// names — substring matching can't bridge "TX" → "Texas", so expand known
// aliases into additional candidate needles.
const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};

const COUNTRY_ALIASES: Record<string, string> = {
  usa: "united states",
  us: "united states",
  uk: "united kingdom",
};

function expandValueCandidates(value: string): string[] {
  const candidates = [value];
  const state = US_STATES[value.trim().toUpperCase()];
  if (state) candidates.push(state);
  const country = COUNTRY_ALIASES[normalize(value).trim()];
  if (country) candidates.push(country);
  return candidates;
}

function waitForOption(value: string, timeoutMs: number): Promise<HTMLElement | null> {
  const needles = expandValueCandidates(value).map((v) => normalize(v).trim()).filter(Boolean);
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = () => {
      const options = Array.from(
        document.querySelectorAll<HTMLElement>('[role="option"], [role="listbox"] li'),
      ).filter(isVisible);
      let fallback: HTMLElement | null = null;
      for (const opt of options) {
        const text = normalize(opt.textContent ?? "");
        if (!text) continue;
        for (const needle of needles) {
          if (text === needle) return resolve(opt); // exact match wins immediately
          if (!fallback && (text.includes(needle) || needle.includes(text))) fallback = opt;
        }
      }
      if (fallback) return resolve(fallback);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(poll, 120);
    };
    poll();
  });
}

/**
 * Opens a Workday-style listbox button and clicks the best-matching option.
 * Refuses to touch anything that reads like a navigation/submission control,
 * and closes the popup again (Escape) if no option matches.
 */
export async function fillListbox(button: HTMLElement, value: string): Promise<boolean> {
  const identity = normalize(
    `${button.textContent ?? ""} ${button.getAttribute("data-automation-id") ?? ""}`,
  );
  if (/\b(submit|continue|next|save and continue|apply now)\b/.test(identity)) return false;
  if (listboxAlreadyHasValue(button)) return false;

  button.click();
  const option = await waitForOption(value, 2000);
  if (!option) {
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return false;
  }
  option.click();
  return true;
}

export function findCheckboxBySynonyms(container: ParentNode, synonyms: string[]): HTMLInputElement | null {
  const checkboxes = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  for (const el of checkboxes) {
    if (el.disabled) continue;
    const label = labelForElement(el);
    if (synonyms.some((s) => label.includes(normalize(s)))) return el;
  }
  return null;
}

export function setCheckbox(el: HTMLInputElement, checked: boolean): void {
  if (el.checked === checked) return;
  if (fillLog && !restoring) fillLog.push({ el, kind: "checkbox", prev: el.checked ? "1" : "0" });
  el.click();
  if (!restoring) flashField(el);
}

// --- fill log: lets the user undo everything the last autofill wrote ---

interface FillLogEntry {
  el: HTMLElement;
  kind: "value" | "checkbox";
  prev: string;
}

let fillLog: FillLogEntry[] | null = null;
let restoring = false;

/** Start recording field writes so they can be undone. */
export function startFillLog(): void {
  fillLog = [];
}

/** Reverts every field the last autofill wrote (text/select/checkbox — not
 * listbox/combobox option clicks, which Workday commits immediately).
 * Returns how many fields were restored. */
export function undoFill(): number {
  if (!fillLog?.length) return 0;
  const entries = [...fillLog].reverse();
  restoring = true;
  try {
    for (const entry of entries) {
      if (entry.kind === "checkbox") {
        const cb = entry.el as HTMLInputElement;
        if (cb.checked !== (entry.prev === "1")) cb.click();
      } else {
        setFieldValue(entry.el as FillableElement, entry.prev);
      }
    }
  } finally {
    restoring = false;
  }
  fillLog = [];
  return entries.length;
}

/** Dry-run highlight: dashed amber outline, longer-lived than the fill
 * flash, and writes nothing. */
export function flashPreviewField(el: HTMLElement): void {
  const original = el.style.outline;
  el.style.outline = "2px dashed #d97706";
  el.style.outlineOffset = "1px";
  window.setTimeout(() => {
    el.style.outline = original;
    el.style.outlineOffset = "";
  }, 4000);
}

/** Brief visual pulse so the user can see exactly what just got filled. */
function flashField(el: HTMLElement): void {
  const original = el.style.outline;
  el.style.outline = "2px solid #2563eb";
  el.style.outlineOffset = "1px";
  window.setTimeout(() => {
    el.style.outline = original;
    el.style.outlineOffset = "";
  }, 1200);
}

/** Sets a value through the element's native setter so framework-controlled
 * inputs (which override the plain `value` property) still pick it up, then
 * fires the events most JS form frameworks listen for. */
export function setFieldValue(el: FillableElement, value: string): void {
  if (fillLog && !restoring) fillLog.push({ el, kind: "value", prev: el.value ?? "" });

  const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  if (el instanceof HTMLSelectElement) {
    const option = Array.from(el.options).find(
      (o) => normalize(o.textContent ?? "").includes(normalize(value)) || normalize(value).includes(normalize(o.textContent ?? "")),
    );
    if (option) el.value = option.value;
  } else if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  if (!restoring) flashField(el);
}

export function findFileInputBySynonyms(
  synonyms: string[],
  { allowSoleFallback = false }: { allowSoleFallback?: boolean } = {},
): HTMLInputElement | null {
  const fileInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).filter(
    (el) => !el.disabled,
  );
  for (const el of fileInputs) {
    const label = labelForElement(el) || normalize(el.closest("[data-automation-id]")?.textContent?.slice(0, 200) ?? "");
    if (synonyms.some((s) => label.includes(normalize(s)))) return el;
  }
  // Without a label match, only guess when there is exactly ONE file input on
  // the page (the common Workday "drop your resume here" step). Guessing among
  // several could attach the file to an unrelated upload field.
  if (allowSoleFallback && fileInputs.length === 1) return fileInputs[0];
  return null;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function attachFileToInput(input: HTMLInputElement, base64: string, fileName: string): void {
  const bytes = base64ToBytes(base64);
  const file = new File([bytes as unknown as BlobPart], fileName, { type: "application/pdf" });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
