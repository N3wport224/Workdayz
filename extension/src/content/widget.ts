// Minimal shadow-DOM floating widget so our styles never leak into (or
// clash with) the host page's CSS. Collapsible to a small bubble; the
// collapsed state persists via chrome.storage.local.

const COLLAPSED_KEY = "workdayz.widgetCollapsed";
const POSITION_KEY = "workdayz.widgetPosition"; // "right" (default) | "left"

/** Every string rendered here can originate from the Workday tenant's own
 * page (field labels, form values) — the extension is scoped to every
 * *.myworkdayjobs.com tenant, not just a trusted one, so this content is
 * untrusted. Escape before any innerHTML interpolation. */
export function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

export interface Widget {
  root: HTMLElement;
  /** The result region inside the shadow DOM — for callers that need to
   * mount interactive nodes (e.g. the fill-preview table). */
  resultArea: HTMLElement;
  setStatus(text: string): void;
  showProgress(step: string, current: number, total: number): void;
  showResult(summary: import("../types").AutofillRunSummary): void;
  showExtendedInfo(html: string): void;
  reset(): void;
}

export function mountWidget(title: string): Widget {
  const host = document.createElement("div");
  host.id = "workdayz-widget-host";
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.bottom = "20px";
  host.style.right = "20px";
  host.style.zIndex = "2147483647";
  document.body.appendChild(host);

  // Some Workday tenants put their own chat/help bubble bottom-right; let
  // the user park the widget on the other side instead.
  function applyPosition(side: "left" | "right") {
    host.style.left = side === "left" ? "20px" : "";
    host.style.right = side === "right" ? "20px" : "";
  }
  let position: "left" | "right" = "right";

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .panel {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #111827;
        color: #f9fafb;
        border-radius: 12px;
        padding: 12px 14px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.35);
        min-width: 220px;
        max-width: 300px;
      }
      .titleRow { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
      .title { font-weight: 600; font-size: 13px; }
      .collapseBtn {
        background: none; border: none; color: #9ca3af; cursor: pointer;
        font-size: 14px; padding: 0 2px; line-height: 1;
      }
      .collapseBtn:hover { color: #f9fafb; }
      .status { font-size: 12px; opacity: 0.85; margin-bottom: 8px; line-height: 1.4; }
      .progress-container { margin-bottom: 8px; }
      .progress-bar {
        width: 100%; height: 4px; background: #374151; border-radius: 2px; overflow: hidden;
      }
      .progress-fill {
        height: 100%; background: #2563eb; border-radius: 2px; transition: width 0.3s ease;
        width: 0%;
      }
      .progress-label { font-size: 10px; color: #9ca3af; margin-top: 3px; }
      button.action {
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        background: #2563eb;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 8px 10px;
        cursor: pointer;
        width: 100%;
        margin-bottom: 6px;
      }
      button.action:hover { background: #1d4ed8; }
      button.action:disabled { opacity: 0.5; cursor: default; }
      .result-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 6px; }
      .result-item { background: #1f2937; border-radius: 6px; padding: 6px 8px; text-align: center; }
      .result-item .num { font-size: 16px; font-weight: 700; line-height: 1.2; }
      .result-item .num.green { color: #34d399; }
      .result-item .num.amber { color: #fbbf24; }
      .result-item .num.red { color: #f87171; }
      .result-item .desc { font-size: 9px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.03em; }
      .result-detail { font-size: 10px; color: #9ca3af; line-height: 1.4; }
      .bubble {
        width: 40px; height: 40px; border-radius: 50%;
        background: #2563eb; color: white; border: none; cursor: pointer;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-weight: 700; font-size: 15px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.35);
        display: none;
      }
      .hidden { display: none; }
      .bubble.shown { display: block; }
      select.profileSelect {
        width: 100%;
        margin-bottom: 8px;
        font-size: 11px;
        padding: 6px 8px;
        border-radius: 6px;
        background: #1f2937;
        color: #f9fafb;
        border: 1px solid #374151;
        font-family: inherit;
      }
      .panel.light select.profileSelect { background: #f1f5f9; color: #0f172a; border-color: #e2e8f0; }
      /* Item 71: light theme, driven by the extension's theme setting */
      .panel.light { background: #ffffff; color: #0f172a; border: 1px solid #e2e8f0; }
      .panel.light .status { opacity: 1; color: #475569; }
      .panel.light .result-item { background: #f1f5f9; }
      .panel.light .result-detail { color: #64748b; }
      .panel.light .collapseBtn { color: #64748b; }
      .panel.light .progress-bar { background: #e2e8f0; }
    </style>
    <div class="panel" id="panel">
      <div class="titleRow">
        <div class="title" id="title"></div>
        <div>
          <button class="collapseBtn" id="move" title="Move to the other side">⇄</button>
          <button class="collapseBtn" id="collapse" title="Minimize">—</button>
        </div>
      </div>
      <div class="status" id="status">Loading...</div>
      <div class="progress-container hidden" id="progressContainer">
        <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
        <div class="progress-label" id="progressLabel">Starting...</div>
      </div>
      <div id="resultArea"></div>
      <div id="actions"></div>
      <a id="howLink" href="#" target="_blank" rel="noreferrer"
         style="display:none;font-size:10px;color:#9ca3af;text-decoration:underline;">How the autofill works ↗</a>
    </div>
    <button class="bubble" id="bubble" title="Open Workdayz">W</button>
  `;

  shadow.getElementById("title")!.textContent = title;
  const statusEl = shadow.getElementById("status")!;
  const progressContainer = shadow.getElementById("progressContainer")!;
  const progressFill = shadow.getElementById("progressFill")! as HTMLElement;
  const progressLabel = shadow.getElementById("progressLabel")!;
  const resultArea = shadow.getElementById("resultArea")!;
  const panel = shadow.getElementById("panel")!;
  const bubble = shadow.getElementById("bubble")!;

  function setCollapsed(collapsed: boolean, persist: boolean) {
    panel.classList.toggle("hidden", collapsed);
    bubble.classList.toggle("shown", collapsed);
    if (persist) {
      try {
        chrome.storage.local.set({ [COLLAPSED_KEY]: collapsed });
      } catch {
        /* orphaned script */
      }
    }
  }

  shadow.getElementById("collapse")!.addEventListener("click", () => setCollapsed(true, true));
  bubble.addEventListener("click", () => setCollapsed(false, true));
  shadow.getElementById("move")!.addEventListener("click", () => {
    position = position === "right" ? "left" : "right";
    applyPosition(position);
    try {
      chrome.storage.local.set({ [POSITION_KEY]: position });
    } catch {
      /* orphaned script */
    }
  });

  try {
    chrome.storage.local.get([COLLAPSED_KEY, POSITION_KEY, "workdayz.settings"]).then((data) => {
      if (data[COLLAPSED_KEY]) setCollapsed(true, false);
      if (data[POSITION_KEY] === "left") {
        position = "left";
        applyPosition("left");
      }
      // Item 71: honor the theme setting in the on-page widget too.
      const theme = (data["workdayz.settings"] as { theme?: string } | undefined)?.theme;
      if (theme === "light") panel.classList.add("light");
    });
    // Item 94: link to the web app's autofill explainer.
    chrome.storage.local.get("workdayz.webAppOrigin").then((data) => {
      const origin = data["workdayz.webAppOrigin"] as string | undefined;
      if (origin) {
        const link = shadow.getElementById("howLink") as HTMLAnchorElement;
        link.href = `${origin.replace(/\/$/, "")}/#how-autofill-works`;
        link.style.display = "inline";
      }
    });
  } catch {
    /* orphaned script */
  }

  function showProgress(step: string, current: number, total: number) {
    progressContainer.classList.remove("hidden");
    const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    progressFill.style.width = `${pct}%`;
    progressLabel.textContent = `${step} (${current}/${total})`;
    statusEl.textContent = `⏳ ${step}...`;
  }

  function showResult(summary: import("../types").AutofillRunSummary) {
    progressContainer.classList.add("hidden");
    const total = summary.filled.length;
    const stillRequired = summary.stillRequired?.length ?? 0;
    const skipped = summary.skipped.length;
    const leftForYou = summary.leftForYou?.length ?? 0;

    let html = `<div class="result-grid">`;
    html += `<div class="result-item"><div class="num green">${total}</div><div class="desc">Filled</div></div>`;
    html += `<div class="result-item"><div class="num ${stillRequired > 0 ? 'red' : 'green'}">${stillRequired}</div><div class="desc">Still Needs You</div></div>`;
    if (skipped > 0 || leftForYou > 0) {
      html += `<div class="result-item"><div class="num amber">${skipped}</div><div class="desc">Skipped</div></div>`;
      html += `<div class="result-item"><div class="num amber">${leftForYou}</div><div class="desc">Left For You</div></div>`;
    }
    html += `</div>`;

    if (summary.stillRequired?.length) {
      html += `<div class="result-detail" style="color: #f87171;"><strong>Still need:</strong> `;
      html += escapeHtml(summary.stillRequired.slice(0, 4).map(s => s.slice(0, 40)).join(", "));
      html += `</div>`;
    }
    if (summary.leftForYou?.length) {
      html += `<div class="result-detail"><strong>Your input:</strong> `;
      html += escapeHtml(summary.leftForYou.slice(0, 2).join(", "));
      if (summary.leftForYou.length > 2) html += ` +${summary.leftForYou.length - 2} more`;
      html += `</div>`;
    }
    resultArea.innerHTML = html;
  }

  function showExtendedInfo(html: string) {
    progressContainer.classList.add("hidden");
    resultArea.innerHTML = html;
  }

  function reset() {
    progressContainer.classList.add("hidden");
    resultArea.innerHTML = "";
    statusEl.textContent = "Ready";
  }

  return {
    root: shadow.getElementById("actions") as unknown as HTMLElement,
    resultArea: resultArea as HTMLElement,
    setStatus(text: string) {
      statusEl.textContent = text;
    },
    showProgress,
    showResult,
    showExtendedInfo,
    reset,
  };
}

export function addButton(container: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "action";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  container.appendChild(btn);
  return btn;
}
