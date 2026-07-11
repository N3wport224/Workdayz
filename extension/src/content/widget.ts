// Minimal shadow-DOM floating widget so our styles never leak into (or
// clash with) the host page's CSS. Collapsible to a small bubble; the
// collapsed state persists via chrome.storage.local.

const COLLAPSED_KEY = "workdayz.widgetCollapsed";
const POSITION_KEY = "workdayz.widgetPosition"; // "right" (default) | "left"

export interface Widget {
  root: HTMLElement;
  setStatus(text: string): void;
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
      <div id="actions"></div>
    </div>
    <button class="bubble" id="bubble" title="Open Workdayz">W</button>
  `;

  // textContent, not template interpolation — keeps this safe even if a
  // future caller ever passes non-constant text.
  shadow.getElementById("title")!.textContent = title;
  const statusEl = shadow.getElementById("status")!;
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
    chrome.storage.local.get([COLLAPSED_KEY, POSITION_KEY]).then((data) => {
      if (data[COLLAPSED_KEY]) setCollapsed(true, false);
      if (data[POSITION_KEY] === "left") {
        position = "left";
        applyPosition("left");
      }
    });
  } catch {
    /* orphaned script */
  }

  return {
    root: shadow.getElementById("actions") as unknown as HTMLElement,
    setStatus(text: string) {
      statusEl.textContent = text;
    },
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
