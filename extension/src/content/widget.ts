// Minimal shadow-DOM floating widget so our styles never leak into (or
// clash with) the host page's CSS.

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
      .title { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
      .status { font-size: 12px; opacity: 0.85; margin-bottom: 8px; line-height: 1.4; }
      button {
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
      }
      button:hover { background: #1d4ed8; }
      button:disabled { opacity: 0.5; cursor: default; }
    </style>
    <div class="panel">
      <div class="title">${title}</div>
      <div class="status" id="status">Loading...</div>
      <div id="actions"></div>
    </div>
  `;

  const statusEl = shadow.getElementById("status")!;

  return {
    root: shadow.getElementById("actions") as unknown as HTMLElement,
    setStatus(text: string) {
      statusEl.textContent = text;
    },
  };
}

export function addButton(container: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  container.appendChild(btn);
  return btn;
}
