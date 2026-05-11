/**
 * SelectionPanel
 * Displays detail panels for selected ship or starbase in bottom-right
 */

import type { ShipAction } from "../game/GameplayTypes";

export type SelectionType = "ship" | "fleet" | "starbase";

export interface SelectionData {
  type: SelectionType;
  id?: string;
  name: string;
  hp: number;
  maxHp: number;
  class?: string;
  status?: string;
  detail?: string;
  ownerName?: string;
  ownerColor?: [number, number, number];
  canCommand?: boolean;
}

export interface SelectionPanelCallbacks {
  onShipAction?: (action: ShipAction) => void;
}

export class SelectionPanel {
  private root: HTMLDivElement;
  private selections: Map<string, SelectionData> = new Map();
  private styleId = "space-selection-panel-style";
  private containerElement: HTMLDivElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private activeShipAction: ShipAction | null = null;
  private callbacks: SelectionPanelCallbacks;

  constructor(canvasElement?: HTMLCanvasElement, callbacks: SelectionPanelCallbacks = {}) {
    this.root = document.getElementById("spaceHudRoot") as HTMLDivElement;
    if (!this.root) {
      this.root = document.createElement("div");
      this.root.id = "spaceHudRoot";
      document.body.appendChild(this.root);
    }
    this.canvasElement = canvasElement || (document.querySelector("canvas") as HTMLCanvasElement);
    this.callbacks = callbacks;
    this.injectStyles();
  }

  private injectStyles(): void {
    if (document.getElementById(this.styleId)) return;

    const style = document.createElement("style");
    style.id = this.styleId;
    style.textContent = `
.spaceSelectionPanelContainer {
  position: fixed;
  bottom: 20px;
  left: 20px;
  display: flex;
  flex-direction: column-reverse;
  gap: 12px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding-right: 6px;
  pointer-events: auto;
  z-index: 49;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
}

.spaceSelectionPanel {
  --selection-color: rgba(150, 200, 230, 0.95);
  --selection-color-soft: rgba(150, 200, 230, 0.22);
  min-width: 240px;
  border-radius: 6px;
  border: 1px solid var(--selection-color);
  background:
    linear-gradient(180deg, var(--selection-color-soft) 0%, rgba(6, 13, 24, 0.1) 36%),
    linear-gradient(180deg, var(--hud-panel-alt) 0%, var(--hud-panel) 100%);
  padding: 12px;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
  color: var(--hud-ink);
  font-size: 11px;
  outline: none;
  -webkit-user-select: none;
  user-select: none;
}

.spaceSelectionPanel.starbase {
  border-color: rgba(230, 200, 150, 0.7);
}

.spaceSelectionPanel.ship,
.spaceSelectionPanel.fleet {
  border-color: var(--selection-color);
}

.spaceSelectionPanelTitle {
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: 12px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--hud-line);
}

.spaceSelectionPanel.starbase .spaceSelectionPanelTitle {
  color: rgba(230, 200, 150, 0.95);
}

.spaceSelectionPanel.ship .spaceSelectionPanelTitle,
.spaceSelectionPanel.fleet .spaceSelectionPanelTitle {
  color: var(--selection-color);
}

.spaceSelectionPanelContent {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.spaceSelectionPanelRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.spaceSelectionPanelLabel {
  color: var(--hud-muted);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  flex: 1;
}

.spaceSelectionPanelValue {
  font-weight: 600;
  letter-spacing: 0.08em;
  text-align: right;
  min-width: 60px;
}

.spaceSelectionPanelHpBar {
  width: 100%;
  height: 4px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 2px;
  border: 1px solid var(--hud-line);
  overflow: hidden;
  margin-top: 6px;
}

.spaceSelectionPanelHpFill {
  height: 100%;
  background: linear-gradient(90deg, rgba(100, 200, 100, 0.8), rgba(80, 180, 80, 0.9));
  border-radius: 1px;
  transition: width 0.2s ease;
}

.spaceSelectionPanel.ship .spaceSelectionPanelHpFill,
.spaceSelectionPanel.fleet .spaceSelectionPanelHpFill {
  background: linear-gradient(90deg, var(--selection-color-soft), var(--selection-color));
}

.spaceSelectionPanelHpPercent {
  font-size: 9px;
  color: var(--hud-muted);
  margin-top: 2px;
  text-align: right;
  letter-spacing: 0.08em;
}

.spaceSelectionPanelDetail {
  color: var(--hud-muted);
  font-size: 10px;
  letter-spacing: 0.08em;
  line-height: 1.35;
}

.spaceSelectionActions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin-top: 10px;
}

.spaceSelectionActionBtn {
  min-height: 30px;
  border-radius: 4px;
  border: 1px solid var(--hud-line);
  background: linear-gradient(180deg, rgba(29, 38, 49, 0.96) 0%, rgba(18, 25, 33, 0.96) 100%);
  color: #c4d1e2;
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
}

.spaceSelectionActionBtn:hover {
  border-color: var(--selection-color);
  background: linear-gradient(180deg, rgba(37, 52, 68, 0.98) 0%, rgba(22, 33, 44, 0.98) 100%);
}

.spaceSelectionActionBtn.active {
  border-color: var(--selection-color);
  color: #edfaff;
  box-shadow: 0 0 16px var(--selection-color-soft);
}
    `;
    document.head.appendChild(style);
  }

  public select(data: SelectionData, shiftKey: boolean): void {
    if (!shiftKey) {
      this.selections.clear();
    }
    this.selections.set(this.getSelectionKey(data), data);
    this.render();
  }

  public deselect(type: SelectionType): void {
    for (const key of Array.from(this.selections.keys())) {
      if (key.startsWith(`${type}:`)) {
        this.selections.delete(key);
      }
    }
    this.render();
  }

  public clear(): void {
    this.selections.clear();
    this.render();
  }

  public setActiveShipAction(action: ShipAction | null): void {
    this.activeShipAction = action;
    this.render();
  }

  private render(): void {
    const existingContainer = this.root.querySelector(".spaceSelectionPanelContainer");
    if (existingContainer) {
      existingContainer.remove();
    }

    if (this.selections.size === 0) {
      this.containerElement = null;
      return;
    }

    const container = document.createElement("div");
    container.className = "spaceSelectionPanelContainer";
    this.containerElement = container;

    // Prevent focus loss when clicking UI
    container.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (this.canvasElement) {
        this.canvasElement.focus();
      }
    });

    for (const [, data] of this.selections) {
      const panel = this.createPanelElement(data);
      container.appendChild(panel);
    }

    this.root.appendChild(container);
  }

  private createPanelElement(data: SelectionData): HTMLDivElement {
    const panel = document.createElement("div");
    panel.className = `spaceSelectionPanel ${data.type}`;
    if (data.ownerColor) {
      panel.style.setProperty("--selection-color", this.colorToCss(data.ownerColor, 0.95));
      panel.style.setProperty("--selection-color-soft", this.colorToCss(data.ownerColor, 0.24));
    }

    const hpPercent = Math.round((data.hp / data.maxHp) * 100);
    const hpWidth = (data.hp / data.maxHp) * 100;

    const status = data.status ?? "Operational";
    let classLine = "";
    if (data.class) {
      classLine = `
        <div class="spaceSelectionPanelRow">
          <span class="spaceSelectionPanelLabel">Class</span>
          <span class="spaceSelectionPanelValue">${this.escapeHtml(data.class)}</span>
        </div>
      `;
    }

    const ownerLine = data.ownerName
      ? `
        <div class="spaceSelectionPanelRow">
          <span class="spaceSelectionPanelLabel">Owner</span>
          <span class="spaceSelectionPanelValue">${this.escapeHtml(data.ownerName)}</span>
        </div>
      `
      : "";
    const detailLine = data.detail
      ? `<div class="spaceSelectionPanelDetail">${this.escapeHtml(data.detail)}</div>`
      : "";
    const actionButtons = (data.type === "ship" || data.type === "fleet") && data.canCommand
      ? `
        <div class="spaceSelectionActions">
          <button class="spaceSelectionActionBtn ${this.activeShipAction === "move" ? "active" : ""}" type="button" data-action="move">Move</button>
          <button class="spaceSelectionActionBtn ${this.activeShipAction === "build" ? "active" : ""}" type="button" data-action="build">Build</button>
          <button class="spaceSelectionActionBtn" type="button" data-action="attack">Attack</button>
          <button class="spaceSelectionActionBtn" type="button" data-action="merge">Merge</button>
        </div>
      `
      : "";

    panel.innerHTML = `
      <div class="spaceSelectionPanelTitle">${this.escapeHtml(data.name)}</div>
      <div class="spaceSelectionPanelContent">
        <div class="spaceSelectionPanelRow">
          <span class="spaceSelectionPanelLabel">Status</span>
          <span class="spaceSelectionPanelValue">${this.escapeHtml(status)}</span>
        </div>
        ${ownerLine}
        ${classLine}
        ${detailLine}
        <div class="spaceSelectionPanelRow">
          <span class="spaceSelectionPanelLabel">Integrity</span>
          <span class="spaceSelectionPanelValue">${hpPercent}%</span>
        </div>
        <div class="spaceSelectionPanelHpBar">
          <div class="spaceSelectionPanelHpFill" style="width: ${hpWidth}%"></div>
        </div>
        <div class="spaceSelectionPanelHpPercent">${data.hp} / ${data.maxHp}</div>
        ${actionButtons}
      </div>
    `;

    for (const button of panel.querySelectorAll<HTMLButtonElement>(".spaceSelectionActionBtn")) {
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const action = button.dataset.action as ShipAction | undefined;
        if (!action) return;
        this.callbacks.onShipAction?.(action);
      });
    }

    return panel;
  }

  private getSelectionKey(data: SelectionData): string {
    return `${data.type}:${data.id ?? data.type}`;
  }

  private colorToCss(color: [number, number, number], alpha: number): string {
    const r = Math.round(Math.max(0, Math.min(1, color[0])) * 255);
    const g = Math.round(Math.max(0, Math.min(1, color[1])) * 255);
    const b = Math.round(Math.max(0, Math.min(1, color[2])) * 255);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
