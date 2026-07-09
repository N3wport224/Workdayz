// Generic, label-driven form utilities. Workday tenants heavily customize
// field labels/markup, so this deliberately does fuzzy, synonym-based
// matching instead of hardcoded CSS selectors — it will need occasional
// tuning per tenant (see extension/README.md).

export type FillableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function labelForElement(el: Element): string {
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

  // Workday commonly renders a <fieldset>/<div> with a preceding heading or
  // data-automation-id label sibling above the field's own container.
  const container = el.closest('[data-automation-id], fieldset, div[role="group"]');
  if (container) {
    const heading = container.querySelector('label, legend, [data-automation-id$="label"]');
    if (heading?.textContent && heading !== wrappingLabel) parts.push(heading.textContent);
  }

  const automationId = el.getAttribute("data-automation-id");
  if (automationId) parts.push(automationId.replace(/([a-z])([A-Z])/g, "$1 $2"));

  return normalize(parts.join(" "));
}

function isVisible(el: Element): boolean {
  const rect = (el as HTMLElement).getBoundingClientRect();
  const style = window.getComputedStyle(el as HTMLElement);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function isEmpty(el: FillableElement): boolean {
  if (el instanceof HTMLSelectElement) return !el.value;
  return !el.value?.trim();
}

export function findFillableFields(): FillableElement[] {
  const candidates = Array.from(
    document.querySelectorAll<FillableElement>("input:not([type=hidden]):not([type=file]), textarea, select"),
  );
  return candidates.filter(
    (el) => isVisible(el) && !el.disabled && (el instanceof HTMLSelectElement || !(el as HTMLInputElement).readOnly),
  );
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
export function findPanelContainer(anchor: HTMLElement, fields: FillableElement[]): HTMLElement {
  let el: HTMLElement | null = anchor.parentElement;
  let best: HTMLElement = anchor.parentElement ?? anchor;
  for (let depth = 0; depth < 8 && el; depth++) {
    const enclosed = fields.filter((f) => el!.contains(f)).length;
    if (enclosed >= 2) {
      best = el;
      if (enclosed >= 6) break; // large enough to be the whole panel
    }
    el = el.parentElement;
  }
  return best;
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
  el.click();
}

/** Sets a value through the element's native setter so framework-controlled
 * inputs (which override the plain `value` property) still pick it up, then
 * fires the events most JS form frameworks listen for. */
export function setFieldValue(el: FillableElement, value: string): void {
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
}

export function findFileInputBySynonyms(synonyms: string[]): HTMLInputElement | null {
  const fileInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).filter(
    (el) => !el.disabled,
  );
  for (const el of fileInputs) {
    const label = labelForElement(el) || normalize(el.closest("[data-automation-id]")?.textContent?.slice(0, 200) ?? "");
    if (synonyms.some((s) => label.includes(normalize(s)))) return el;
  }
  return fileInputs[0] ?? null;
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
