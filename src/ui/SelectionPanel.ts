/**
 * SelectionPanel
 * Displays detail panels for selected ship or starbase in bottom-right
 */

import type { ShipAction } from "../game/GameplayTypes";
import type { BattleLayerDamage } from "../game/GameProtocol";

export type SelectionType = "ship" | "fleet" | "starbase" | "battleGroup";

export interface SelectionData {
  type: SelectionType;
  id?: string;
  name: string;
  hp: number;
  maxHp: number;
  shield?: number;
  maxShield?: number;
  armor?: number;
  maxArmor?: number;
  hull?: number;
  maxHull?: number;
  class?: string;
  status?: string;
  detail?: string;
  ownerName?: string;
  ownerColor?: [number, number, number];
  canCommand?: boolean;
  actions?: ShipAction[];
  battle?: BattleSelectionData;
}

export interface BattleSelectionParticipant {
  id: string;
  name: string;
  ownerName: string;
  status: string;
  groups: string[];
  damageDealt: BattleLayerDamage;
  damageReceived: BattleLayerDamage;
  topWeapons: string[];
  hitRate: number;
  dodgeRate: number;
  shipsLost: number;
  escapedShips: number;
}

export interface BattleSelectionData {
  battleId: string;
  allied: BattleSelectionParticipant[];
  hostile: BattleSelectionParticipant[];
}

export interface SelectionPanelCallbacks {
  onShipAction?: (action: ShipAction, selection?: SelectionData) => void;
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
.spaceSelectionPanel.fleet,
.spaceSelectionPanel.battleGroup {
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
.spaceSelectionPanel.fleet .spaceSelectionPanelTitle,
.spaceSelectionPanel.battleGroup .spaceSelectionPanelTitle {
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
.spaceSelectionPanel.fleet .spaceSelectionPanelHpFill,
.spaceSelectionPanel.battleGroup .spaceSelectionPanelHpFill {
  background: linear-gradient(90deg, var(--selection-color-soft), var(--selection-color));
}

.spaceSelectionPanelHpPercent {
  font-size: 9px;
  color: var(--hud-muted);
  margin-top: 2px;
  text-align: right;
  letter-spacing: 0.08em;
}

.spaceSelectionPanelLayerStack {
  display: grid;
  gap: 4px;
  margin-top: 6px;
}

.spaceSelectionPanelLayerBar {
  width: 100%;
  height: 4px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 2px;
  border: 1px solid var(--hud-line);
  overflow: hidden;
}

.spaceSelectionPanelLayerFill {
  height: 100%;
  border-radius: 1px;
  transition: width 0.2s ease;
}

.spaceSelectionPanelLayerFill.shield {
  background: linear-gradient(90deg, rgba(78, 160, 220, 0.55), rgba(86, 202, 255, 0.9));
}

.spaceSelectionPanelLayerFill.armor {
  background: linear-gradient(90deg, rgba(210, 145, 84, 0.6), rgba(255, 190, 122, 0.92));
}

.spaceSelectionPanelLayerFill.hull {
  background: linear-gradient(90deg, rgba(120, 200, 120, 0.6), rgba(90, 210, 150, 0.95));
}

.spaceSelectionPanelDetail {
  color: var(--hud-muted);
  font-size: 10px;
  letter-spacing: 0.08em;
  line-height: 1.35;
}

.spaceSelectionActions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
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

.spaceBattlePanel {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 10px;
}

.spaceBattleSide {
  border: 1px solid var(--hud-line);
  border-radius: 6px;
  padding: 7px;
  background: rgba(5, 9, 14, 0.36);
  min-width: 0;
}

.spaceBattleSideTitle {
  font-size: 10px;
  font-weight: 800;
  color: #e5f7ff;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 6px;
}

.spaceBattleEmpty,
.spaceBattleMeta {
  color: var(--hud-muted);
  font-size: 9px;
  letter-spacing: 0.06em;
}

.spaceBattleParticipant {
  display: grid;
  gap: 5px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.spaceBattleParticipant:first-of-type {
  border-top: 0;
  padding-top: 0;
}

.spaceBattleParticipantHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  font-size: 10px;
}

.spaceBattleParticipantHeader strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spaceBattleParticipantHeader span {
  color: var(--hud-muted);
  font-size: 9px;
  text-transform: uppercase;
}

.spaceBattleGroups,
.spaceBattleWeapons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.spaceBattleGroups span,
.spaceBattleWeapons span {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 2px 4px;
  color: #c9d8e8;
  font-size: 9px;
  background: rgba(255, 255, 255, 0.04);
}

.spaceBattleStatsGrid {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 3px 6px;
  font-size: 9px;
}

.spaceBattleStatsGrid span {
  color: var(--hud-muted);
}

.spaceBattleStatsGrid b {
  color: #e1edf7;
  font-weight: 700;
  text-align: right;
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
    this.activeShipAction = null;
    this.render();
  }

  public hasSelection(type: SelectionType, id?: string): boolean {
    if (id) return this.selections.has(`${type}:${id}`);
    for (const key of this.selections.keys()) {
      if (key.startsWith(`${type}:`)) return true;
    }
    return false;
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

    const hull = data.hull ?? data.hp;
    const maxHull = Math.max(1, data.maxHull ?? data.maxHp);
    const shield = data.shield ?? 0;
    const maxShield = Math.max(0, data.maxShield ?? 0);
    const armor = data.armor ?? 0;
    const maxArmor = Math.max(0, data.maxArmor ?? 0);
    const hullPercent = Math.round((hull / maxHull) * 100);
    const hullWidth = (hull / maxHull) * 100;
    const shieldWidth = maxShield > 0 ? (shield / maxShield) * 100 : 0;
    const armorWidth = maxArmor > 0 ? (armor / maxArmor) * 100 : 0;
    const showLayers = maxShield > 0 || maxArmor > 0;

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
    const actionLabels: Record<ShipAction, string> = {
      move: "Move",
      build: "Build",
      attack: "Attack",
      merge: "Merge",
      retreat: "Retreat",
      retreatTo: "Retreat To",
      emergencyRetreatTo: "Emergency Retreat",
      orbit: "Orbit",
      hold: "Hold",
      protect: "Protect",
    };
    const actions = (data.actions && data.actions.length > 0)
      ? data.actions
      : ["move", "build", "attack", "merge"];
    const actionButtons = (data.type === "ship" || data.type === "fleet" || data.type === "battleGroup") && data.canCommand
      ? `
        <div class="spaceSelectionActions">
          ${actions.map((action) => `
            <button
              class="spaceSelectionActionBtn ${this.activeShipAction === action ? "active" : ""}"
              type="button"
              data-selection-key="${this.escapeHtml(this.getSelectionKey(data))}"
              data-action="${action}">
              ${actionLabels[action as ShipAction] ?? action}
            </button>
          `).join("")}
        </div>
      `
      : "";

    const battleBlock = data.battle ? this.renderBattleBlock(data.battle) : "";

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
          <span class="spaceSelectionPanelValue">${hullPercent}%</span>
        </div>
        <div class="spaceSelectionPanelLayerStack">
          ${showLayers ? `
          <div class="spaceSelectionPanelLayerBar">
            <div class="spaceSelectionPanelLayerFill shield" style="width: ${shieldWidth}%"></div>
          </div>
          <div class="spaceSelectionPanelLayerBar">
            <div class="spaceSelectionPanelLayerFill armor" style="width: ${armorWidth}%"></div>
          </div>
          ` : ""}
          <div class="spaceSelectionPanelLayerBar">
            <div class="spaceSelectionPanelLayerFill hull" style="width: ${hullWidth}%"></div>
          </div>
        </div>
        <div class="spaceSelectionPanelHpPercent">
          ${showLayers
            ? `S ${Math.round(shield)} / ${Math.round(maxShield)} | A ${Math.round(armor)} / ${Math.round(maxArmor)} | H ${Math.round(hull)} / ${Math.round(maxHull)}`
            : `${Math.round(hull)} / ${Math.round(maxHull)}`}
        </div>
        ${battleBlock}
        ${actionButtons}
      </div>
    `;

    for (const button of panel.querySelectorAll<HTMLButtonElement>(".spaceSelectionActionBtn")) {
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const action = button.dataset.action as ShipAction | undefined;
        if (!action) return;
        const selectionKey = button.dataset.selectionKey;
        const selection = selectionKey ? this.selections.get(selectionKey) : undefined;
        this.callbacks.onShipAction?.(action, selection);
      });
    }

    return panel;
  }

  private renderBattleBlock(battle: BattleSelectionData): string {
    const renderSide = (title: string, participants: BattleSelectionParticipant[]) => `
      <div class="spaceBattleSide">
        <div class="spaceBattleSideTitle">${this.escapeHtml(title)}</div>
        ${participants.length === 0
          ? '<div class="spaceBattleEmpty">No active contacts</div>'
          : participants.map((participant) => this.renderBattleParticipant(participant)).join("")}
      </div>
    `;
    return `
      <div class="spaceBattlePanel">
        ${renderSide("Allied", battle.allied)}
        ${renderSide("Hostile", battle.hostile)}
      </div>
    `;
  }

  private renderBattleParticipant(participant: BattleSelectionParticipant): string {
    const dealt = participant.damageDealt;
    const received = participant.damageReceived;
    return `
      <div class="spaceBattleParticipant">
        <div class="spaceBattleParticipantHeader">
          <strong>${this.escapeHtml(participant.name)}</strong>
          <span>${this.escapeHtml(participant.status)}</span>
        </div>
        <div class="spaceBattleMeta">${this.escapeHtml(participant.ownerName)}</div>
        <div class="spaceBattleGroups">${participant.groups.map((group) => `<span>${this.escapeHtml(group)}</span>`).join("")}</div>
        <div class="spaceBattleStatsGrid">
          <span>Dealt</span><b>S ${Math.round(dealt.shield)} | A ${Math.round(dealt.armor)} | H ${Math.round(dealt.hull)}</b>
          <span>Taken</span><b>S ${Math.round(received.shield)} | A ${Math.round(received.armor)} | H ${Math.round(received.hull)}</b>
          <span>Hit</span><b>${Math.round(participant.hitRate * 100)}%</b>
          <span>Dodge</span><b>${Math.round(participant.dodgeRate * 100)}%</b>
          <span>Lost</span><b>${participant.shipsLost}</b>
          <span>Escaped</span><b>${participant.escapedShips}</b>
        </div>
        <div class="spaceBattleWeapons">${participant.topWeapons.map((weapon) => `<span>${this.escapeHtml(weapon)}</span>`).join("")}</div>
      </div>
    `;
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
