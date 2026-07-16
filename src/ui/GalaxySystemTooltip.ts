import type { IntelStatus } from "../data/Intelligence";

export interface GalaxySystemTooltipRow {
  label: string;
  value: string;
  status?: IntelStatus;
  freshness?: string | null;
  tone?: "neutral" | "friendly" | "hostile";
}

export interface GalaxySystemTooltipData {
  title: string;
  titleStatus?: IntelStatus;
  titleFreshness?: string | null;
  unknown?: boolean;
  rows: GalaxySystemTooltipRow[];
}

const STYLE_ID = "galaxy-system-tooltip-style";
const VIEWPORT_PADDING = 10;
const POINTER_OFFSET = 18;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.galaxySystemTooltip {
  position: fixed;
  z-index: 70;
  width: 270px;
  max-width: calc(100vw - 20px);
  padding: 12px 13px 11px;
  border: 1px solid rgba(119, 191, 221, 0.72);
  border-radius: 5px;
  background:
    linear-gradient(135deg, rgba(55, 126, 158, 0.11), transparent 46%),
    linear-gradient(180deg, rgba(14, 23, 32, 0.98), rgba(6, 11, 17, 0.98));
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.48), inset 0 0 22px rgba(57, 153, 195, 0.05);
  color: #d6e4ee;
  pointer-events: none;
  user-select: none;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
}

.galaxySystemTooltip[hidden] {
  display: none;
}

.galaxySystemTooltip.unknown {
  width: auto;
  min-width: 92px;
}

.galaxySystemTooltipEyebrow {
  margin-bottom: 4px;
  color: rgba(111, 198, 230, 0.76);
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.galaxySystemTooltipTitle {
  color: #f0f8fc;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.055em;
  line-height: 1.25;
}

.galaxySystemTooltipTitle.stale {
  color: #d7d2bd;
}

.galaxySystemTooltipRows {
  display: grid;
  gap: 0;
  margin-top: 9px;
  border-top: 1px solid rgba(118, 161, 183, 0.24);
}

.galaxySystemTooltipRow {
  display: grid;
  grid-template-columns: minmax(74px, auto) minmax(0, 1fr);
  gap: 5px 12px;
  padding: 6px 0 5px;
  border-bottom: 1px solid rgba(118, 161, 183, 0.14);
}

.galaxySystemTooltipLabel {
  color: rgba(146, 174, 190, 0.8);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.galaxySystemTooltipValue {
  overflow-wrap: anywhere;
  color: #dbe8ef;
  font-family: "Rajdhani", "Trebuchet MS", sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.035em;
  line-height: 1.15;
  text-align: right;
}

.galaxySystemTooltipValue.friendly {
  color: #7fe2c5;
}

.galaxySystemTooltipValue.hostile {
  color: #ff8d84;
}

.galaxySystemTooltipValue.stale::after {
  content: "LAST KNOWN";
  display: inline-block;
  margin-left: 6px;
  color: rgba(211, 188, 122, 0.78);
  font-family: "Orbitron", "Rajdhani", sans-serif;
  font-size: 7px;
  font-weight: 800;
  letter-spacing: 0.08em;
  vertical-align: 1px;
}

.galaxySystemTooltipFreshness {
  grid-column: 1 / -1;
  color: rgba(190, 174, 126, 0.72);
  font-family: "Rajdhani", "Trebuchet MS", sans-serif;
  font-size: 9px;
  line-height: 1.2;
  text-align: right;
}
`;
  document.head.appendChild(style);
}

export class GalaxySystemTooltip {
  private readonly element: HTMLDivElement;
  private signature = "";

  constructor() {
    ensureStyles();
    this.element = document.createElement("div");
    this.element.className = "galaxySystemTooltip";
    this.element.setAttribute("role", "tooltip");
    this.element.hidden = true;
    document.body.appendChild(this.element);
  }

  show(data: GalaxySystemTooltipData, clientX: number, clientY: number): void {
    const signature = JSON.stringify(data);
    if (signature !== this.signature) {
      this.signature = signature;
      this.render(data);
    }

    this.element.classList.toggle("unknown", data.unknown === true);
    this.element.hidden = false;
    this.position(clientX, clientY);
  }

  hide(): void {
    this.element.hidden = true;
  }

  dispose(): void {
    this.element.remove();
    this.signature = "";
  }

  private render(data: GalaxySystemTooltipData): void {
    this.element.replaceChildren();

    if (data.unknown) {
      const unknownTitle = document.createElement("div");
      unknownTitle.className = "galaxySystemTooltipTitle";
      unknownTitle.textContent = "Unknown";
      this.element.appendChild(unknownTitle);
      return;
    }

    const eyebrow = document.createElement("div");
    eyebrow.className = "galaxySystemTooltipEyebrow";
    eyebrow.textContent = "Star System";
    this.element.appendChild(eyebrow);

    const title = document.createElement("div");
    title.className = `galaxySystemTooltipTitle${data.titleStatus === "stale" ? " stale" : ""}`;
    title.textContent = data.title;
    this.element.appendChild(title);

    if (data.titleFreshness) {
      const freshness = document.createElement("div");
      freshness.className = "galaxySystemTooltipFreshness";
      freshness.textContent = data.titleFreshness;
      this.element.appendChild(freshness);
    }

    const rows = document.createElement("div");
    rows.className = "galaxySystemTooltipRows";
    for (const rowData of data.rows) {
      const row = document.createElement("div");
      row.className = "galaxySystemTooltipRow";

      const label = document.createElement("span");
      label.className = "galaxySystemTooltipLabel";
      label.textContent = rowData.label;

      const value = document.createElement("span");
      value.className = [
        "galaxySystemTooltipValue",
        rowData.status === "stale" ? "stale" : "",
        rowData.tone ?? "",
      ].filter(Boolean).join(" ");
      value.textContent = rowData.value;

      row.append(label, value);
      if (rowData.freshness) {
        const freshness = document.createElement("span");
        freshness.className = "galaxySystemTooltipFreshness";
        freshness.textContent = rowData.freshness;
        row.appendChild(freshness);
      }
      rows.appendChild(row);
    }
    this.element.appendChild(rows);
  }

  private position(clientX: number, clientY: number): void {
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING);
    const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING);
    const preferredLeft = clientX + POINTER_OFFSET;
    const preferredTop = clientY + POINTER_OFFSET;
    const left = preferredLeft + width <= window.innerWidth - VIEWPORT_PADDING
      ? preferredLeft
      : clientX - width - POINTER_OFFSET;
    const top = preferredTop + height <= window.innerHeight - VIEWPORT_PADDING
      ? preferredTop
      : clientY - height - POINTER_OFFSET;

    this.element.style.left = `${Math.max(VIEWPORT_PADDING, Math.min(maxLeft, left))}px`;
    this.element.style.top = `${Math.max(VIEWPORT_PADDING, Math.min(maxTop, top))}px`;
  }
}
