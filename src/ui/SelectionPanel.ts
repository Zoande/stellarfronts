/**
 * SelectionPanel
 * Displays detail panels for selected ship or starbase in bottom-right
 */

export type SelectionType = "ship" | "starbase";

export interface SelectionData {
  type: SelectionType;
  name: string;
  hp: number;
  maxHp: number;
  class?: string;
}

export class SelectionPanel {
  private root: HTMLDivElement;
  private selections: Map<SelectionType, SelectionData> = new Map();
  private styleId = "space-selection-panel-style";
  private containerElement: HTMLDivElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;

  constructor(canvasElement?: HTMLCanvasElement) {
    this.root = document.getElementById("spaceHudRoot") as HTMLDivElement;
    if (!this.root) {
      this.root = document.createElement("div");
      this.root.id = "spaceHudRoot";
      document.body.appendChild(this.root);
    }
    this.canvasElement = canvasElement || (document.querySelector("canvas") as HTMLCanvasElement);
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
  pointer-events: auto;
  z-index: 49;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
}

.spaceSelectionPanel {
  min-width: 240px;
  border-radius: 6px;
  border: 1px solid var(--hud-line-strong);
  background: linear-gradient(180deg, var(--hud-panel-alt) 0%, var(--hud-panel) 100%);
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

.spaceSelectionPanel.ship {
  border-color: rgba(150, 200, 230, 0.7);
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

.spaceSelectionPanel.ship .spaceSelectionPanelTitle {
  color: rgba(150, 200, 230, 0.95);
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

.spaceSelectionPanel.ship .spaceSelectionPanelHpFill {
  background: linear-gradient(90deg, rgba(100, 150, 200, 0.8), rgba(80, 130, 180, 0.9));
}

.spaceSelectionPanelHpPercent {
  font-size: 9px;
  color: var(--hud-muted);
  margin-top: 2px;
  text-align: right;
  letter-spacing: 0.08em;
}
    `;
    document.head.appendChild(style);
  }

  public select(data: SelectionData, shiftKey: boolean): void {
    if (!shiftKey) {
      this.selections.clear();
    }
    this.selections.set(data.type, data);
    this.render();
  }

  public deselect(type: SelectionType): void {
    this.selections.delete(type);
    this.render();
  }

  public clear(): void {
    this.selections.clear();
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

    const hpPercent = Math.round((data.hp / data.maxHp) * 100);
    const hpWidth = (data.hp / data.maxHp) * 100;

    let classLine = "";
    if (data.class) {
      classLine = `
        <div class="spaceSelectionPanelRow">
          <span class="spaceSelectionPanelLabel">Class</span>
          <span class="spaceSelectionPanelValue">${data.class}</span>
        </div>
      `;
    }

    panel.innerHTML = `
      <div class="spaceSelectionPanelTitle">${data.name}</div>
      <div class="spaceSelectionPanelContent">
        <div class="spaceSelectionPanelRow">
          <span class="spaceSelectionPanelLabel">Status</span>
          <span class="spaceSelectionPanelValue">Operational</span>
        </div>
        ${classLine}
        <div class="spaceSelectionPanelRow">
          <span class="spaceSelectionPanelLabel">Integrity</span>
          <span class="spaceSelectionPanelValue">${hpPercent}%</span>
        </div>
        <div class="spaceSelectionPanelHpBar">
          <div class="spaceSelectionPanelHpFill" style="width: ${hpWidth}%"></div>
        </div>
        <div class="spaceSelectionPanelHpPercent">${data.hp} / ${data.maxHp}</div>
      </div>
    `;

    return panel;
  }
}
