import type { FactionInfo } from "../data/Factions";
import {
  STARBASE_SHIP_DEFINITIONS,
  countStarbaseShipyards,
} from "../data/Starbase";
import type { StarbaseShipKind } from "../data/Starbase";
import {
  calculateShipDesignStats,
  createDefaultShipDesign,
  getShipModuleDefinition,
  SHIP_DEFENSE_MODULES,
  SHIP_HULL_DEFINITIONS,
  SHIP_UTILITY_MODULES,
  SHIP_WEAPON_MODULES,
} from "../data/ShipDesigns";
import type { ShipDesign, ShipModuleDefinition, ShipModuleSlotType } from "../data/ShipDesigns";
import type { StarData } from "../data/StarMap";
import type { BattleGroupConfig, ClientCommand, ServerFleet, ServerShip, ServerStarbase } from "../game/GameProtocol";
import type { BattleGroupBehavior, BattleGroupChaseSetting } from "../game/CombatTypes";
import { GAME_DAYS_PER_YEAR, REAL_MS_PER_GAME_DAY } from "../game/GameTime";
import { computeCombatPowerFromStats, computeFleetPower } from "../game/combatPower";

export interface FleetManagerPanelData {
  fleets: ServerFleet[];
  ships: ServerShip[];
  shipDesigns: ShipDesign[];
  starbases: ServerStarbase[];
  stars: StarData[];
  factions: FactionInfo[];
  playerFactionId: number | null;
  clockYear: number;
  onFleetCommand?: (command: ClientCommand) => void;
}

const STYLE_ID = "fleet-manager-panel-style";

type FleetManagerTab = "fleetManager" | "shipDesigner";
type DesignerSlotKind = "weapon" | "defense" | "utility";

export class FleetManagerPanel {
  private root: HTMLDivElement;
  private panelElement: HTMLDivElement | null = null;
  private currentData: FleetManagerPanelData | null = null;
  private activeTab: FleetManagerTab = "fleetManager";
  private selectedFleetId: string | null = null;
  private selectedBattleGroupId: string | null = null;
  private selectedDesignId: string | null = null;
  private designerDraft: ShipDesign | null = null;
  private selectedDesignerSlot = "weapon:0";
  private addShipsOpen = false;
  private position = { x: 62, y: 82 };
  private dragOffset = { x: 0, y: 0 };
  private isDragging = false;

  private readonly onPointerMove = (ev: PointerEvent): void => {
    if (!this.isDragging || !this.panelElement) return;
    ev.preventDefault();
    const rect = this.panelElement.getBoundingClientRect();
    this.position.x = Math.max(8, Math.min(window.innerWidth - rect.width - 8, ev.clientX - this.dragOffset.x));
    this.position.y = Math.max(8, Math.min(window.innerHeight - rect.height - 8, ev.clientY - this.dragOffset.y));
    this.applyPosition();
  };

  private readonly onPointerUp = (): void => {
    this.isDragging = false;
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
  };

  constructor() {
    this.root = document.getElementById("spaceHudRoot") as HTMLDivElement;
    if (!this.root) {
      this.root = document.createElement("div");
      this.root.id = "spaceHudRoot";
      document.body.appendChild(this.root);
    }
    this.injectStyles();
  }

  public show(data: FleetManagerPanelData): void {
    this.currentData = data;
    this.ensureSelectedFleet(data);
    if (this.activeTab === "shipDesigner") this.ensureDesignerDraft(data);
    if (!this.panelElement) {
      this.panelElement = document.createElement("div");
      this.panelElement.className = "fleetManagerPanel";
      this.root.appendChild(this.panelElement);
    }

    const accent = data.playerFactionId !== null
      ? this.colorToCss(this.getFaction(data, data.playerFactionId)?.color, 0.95)
      : "rgba(114, 226, 255, 0.95)";
    this.panelElement.style.setProperty("--fleet-accent", accent);
    this.panelElement.innerHTML = this.render(data);
    this.applyPosition();
    this.bindEvents(data);
  }

  public refresh(data: FleetManagerPanelData): void {
    if (!this.panelElement) return;
    this.show(data);
  }

  public close(): void {
    this.onPointerUp();
    this.panelElement?.remove();
    this.panelElement = null;
    this.currentData = null;
    this.activeTab = "fleetManager";
    this.addShipsOpen = false;
    this.selectedDesignId = null;
    this.designerDraft = null;
  }

  public dispose(): void {
    this.close();
  }

  private bindEvents(data: FleetManagerPanelData): void {
    if (!this.panelElement) return;
    this.panelElement.querySelector<HTMLButtonElement>("[data-fm-close]")?.addEventListener("click", () => this.close());
    this.panelElement.querySelector<HTMLElement>("[data-fm-drag]")?.addEventListener("pointerdown", (ev) => {
      if (!this.panelElement) return;
      ev.preventDefault();
      const rect = this.panelElement.getBoundingClientRect();
      this.dragOffset.x = ev.clientX - rect.left;
      this.dragOffset.y = ev.clientY - rect.top;
      this.isDragging = true;
      window.addEventListener("pointermove", this.onPointerMove);
      window.addEventListener("pointerup", this.onPointerUp);
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        this.activeTab = button.dataset.fmTab === "shipDesigner" ? "shipDesigner" : "fleetManager";
        this.addShipsOpen = false;
        this.show(data);
      });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-select-fleet]").forEach((button) => {
      button.addEventListener("click", () => {
        const fleetId = button.dataset.fmSelectFleet;
        if (!fleetId) return;
        this.selectedFleetId = fleetId;
        this.selectedBattleGroupId = null;
        this.addShipsOpen = false;
        this.show(data);
      });
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-fm-add-ships]")?.addEventListener("click", () => {
      this.addShipsOpen = true;
      this.show(data);
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-fm-toggle-alert]")?.addEventListener("click", () => {
      const fleet = this.getSelectedFleet(data);
      if (!fleet) return;
      data.onFleetCommand?.({ type: "setFleetAlertMode", fleetId: fleet.id, alertMode: !fleet.alertMode });
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-fm-create-bg]")?.addEventListener("click", () => {
      const fleet = this.getSelectedFleet(data);
      if (!fleet) return;
      data.onFleetCommand?.({ type: "createBattleGroup", fleetId: fleet.id, name: `Battle Group ${fleet.battleGroups.length + 1}` });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-select-bg]").forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedBattleGroupId = button.dataset.fmSelectBg ?? null;
        this.show(data);
      });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-delete-bg]").forEach((button) => {
      button.addEventListener("click", () => {
        const fleet = this.getSelectedFleet(data);
        const battleGroupId = button.dataset.fmDeleteBg;
        if (!fleet || !battleGroupId) return;
        data.onFleetCommand?.({ type: "deleteBattleGroup", fleetId: fleet.id, battleGroupId });
      });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-split-bg]").forEach((button) => {
      button.addEventListener("click", () => {
        const fleet = this.getSelectedFleet(data);
        const battleGroupId = button.dataset.fmSplitBg;
        const group = fleet?.battleGroups.find((candidate) => candidate.id === battleGroupId);
        if (!fleet || !group || group.shipIds.length < 2) return;
        data.onFleetCommand?.({
          type: "splitBattleGroup",
          fleetId: fleet.id,
          battleGroupId: group.id,
          shipIds: group.shipIds.slice(Math.ceil(group.shipIds.length / 2)),
        });
      });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-merge-bg]").forEach((button) => {
      button.addEventListener("click", () => {
        const fleet = this.getSelectedFleet(data);
        const sourceBattleGroupId = button.dataset.fmMergeBg;
        const targetBattleGroupId = this.selectedBattleGroupId;
        if (!fleet || !sourceBattleGroupId || !targetBattleGroupId || sourceBattleGroupId === targetBattleGroupId) return;
        data.onFleetCommand?.({ type: "mergeBattleGroups", fleetId: fleet.id, sourceBattleGroupId, targetBattleGroupId });
      });
    });
    this.panelElement.querySelectorAll<HTMLSelectElement>("[data-fm-bg-behavior]").forEach((select) => {
      select.addEventListener("change", () => {
        const fleet = this.getSelectedFleet(data);
        const battleGroupId = select.dataset.fmBgBehavior;
        if (!fleet || !battleGroupId) return;
        data.onFleetCommand?.({
          type: "setBattleGroupBehavior",
          fleetId: fleet.id,
          battleGroupId,
          behavior: select.value as BattleGroupBehavior,
        });
      });
    });
    this.panelElement.querySelectorAll<HTMLSelectElement>("[data-fm-bg-chase]").forEach((select) => {
      select.addEventListener("change", () => {
        const fleet = this.getSelectedFleet(data);
        const battleGroupId = select.dataset.fmBgChase;
        if (!fleet || !battleGroupId) return;
        data.onFleetCommand?.({
          type: "setBattleGroupChaseSetting",
          fleetId: fleet.id,
          battleGroupId,
          chaseSetting: select.value as BattleGroupChaseSetting,
        });
      });
    });
    this.panelElement.querySelectorAll<HTMLInputElement>("[data-fm-bg-retreat]").forEach((input) => {
      input.addEventListener("change", () => {
        const fleet = this.getSelectedFleet(data);
        const battleGroupId = input.dataset.fmBgRetreat;
        if (!fleet || !battleGroupId) return;
        const thresholdPercent = Number(input.value);
        data.onFleetCommand?.({
          type: "setBattleGroupRetreatPolicy",
          fleetId: fleet.id,
          battleGroupId,
          retreatPolicy: Number.isFinite(thresholdPercent) && thresholdPercent > 0
            ? { mode: "hpPercent", thresholdPercent }
            : { mode: "none", thresholdPercent: null },
        });
      });
    });
    this.panelElement.querySelectorAll<HTMLSelectElement>("[data-fm-ship-bg-target]").forEach((select) => {
      select.addEventListener("change", () => {
        const fleet = this.getSelectedFleet(data);
        const shipId = select.dataset.fmShipId;
        if (!fleet || !shipId || !select.value) return;
        data.onFleetCommand?.({
          type: "moveShipsToBattleGroup",
          fleetId: fleet.id,
          toBattleGroupId: select.value,
          shipIds: [shipId],
        });
      });
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-fm-close-ship-picker]")?.addEventListener("click", () => {
      this.addShipsOpen = false;
      this.show(data);
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-build-ship]").forEach((button) => {
      button.addEventListener("click", () => {
        const fleet = this.getSelectedFleet(data);
        const shipKind = button.dataset.fmBuildShip as StarbaseShipKind | undefined;
        const designId = button.dataset.fmBuildDesign;
        if (!fleet || !shipKind) return;
        const shipyard = this.findNearestShipyard(data, fleet);
        if (!shipyard) return;
        data.onFleetCommand?.({
          type: "buildStarbaseShip",
          starbaseId: shipyard.id,
          shipKind,
          designId,
        });
      });
    });
    this.bindDesignerEvents(data);
  }

  private bindDesignerEvents(data: FleetManagerPanelData): void {
    if (!this.panelElement || this.activeTab !== "shipDesigner") return;
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-select-design]").forEach((button) => {
      button.addEventListener("click", () => {
        const design = data.shipDesigns.find((candidate) => candidate.id === button.dataset.fmSelectDesign);
        if (!design) return;
        this.selectedDesignId = design.id;
        this.designerDraft = this.cloneDesign(design);
        this.selectedDesignerSlot = "weapon:0";
        this.show(data);
      });
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-fm-new-design]")?.addEventListener("click", () => {
      const ownerId = data.playerFactionId ?? data.factions[0]?.id ?? 0;
      const draft = createDefaultShipDesign(ownerId, "corvette", data.clockYear);
      this.selectedDesignId = null;
      this.designerDraft = {
        ...draft,
        id: "",
        name: "New Corvette Design",
      };
      this.selectedDesignerSlot = "weapon:0";
      this.show(data);
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-design-slot]").forEach((button) => {
      button.addEventListener("click", () => {
        const slot = button.dataset.fmDesignSlot;
        if (!slot) return;
        this.selectedDesignerSlot = slot;
        this.show(data);
      });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-module]").forEach((button) => {
      button.addEventListener("click", () => {
        const moduleId = button.dataset.fmModule;
        if (!moduleId || !this.designerDraft) return;
        this.applyModuleToDraft(moduleId);
        this.show(data);
      });
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-fm-clear-design]")?.addEventListener("click", () => {
      if (!this.designerDraft) return;
      const ownerId = this.designerDraft.ownerId;
      const shipKind = this.designerDraft.shipKind;
      const base = createDefaultShipDesign(ownerId, shipKind, data.clockYear);
      this.designerDraft = {
        ...this.designerDraft,
        weaponModuleIds: [...base.weaponModuleIds],
        defenseModuleIds: [...base.defenseModuleIds],
        utilityModuleId: base.utilityModuleId,
      };
      this.show(data);
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-fm-save-design]")?.addEventListener("click", () => {
      if (!this.designerDraft) return;
      const nameInput = this.panelElement?.querySelector<HTMLInputElement>("[data-fm-design-name]");
      const name = (nameInput?.value ?? this.designerDraft.name).trim() || this.designerDraft.name;
      this.designerDraft.name = name;
      data.onFleetCommand?.({
        type: "saveShipDesign",
        designId: this.designerDraft.id || undefined,
        shipKind: this.designerDraft.shipKind,
        name,
        weaponModuleIds: [...this.designerDraft.weaponModuleIds],
        defenseModuleIds: [...this.designerDraft.defenseModuleIds],
        utilityModuleId: this.designerDraft.utilityModuleId,
      });
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-fm-decommission-design]")?.addEventListener("click", () => {
      if (!this.designerDraft?.id) return;
      data.onFleetCommand?.({ type: "decommissionShipDesign", designId: this.designerDraft.id });
    });
  }

  private applyPosition(): void {
    if (!this.panelElement) return;
    this.panelElement.style.left = `${this.position.x}px`;
    this.panelElement.style.top = `${this.position.y}px`;
  }

  private render(data: FleetManagerPanelData): string {
    return `
      <div class="fmHeader" data-fm-drag>
        <div class="fmHeaderIcon">FL</div>
        <div>
          <div class="fmTitle">Fleet Operations</div>
          <div class="fmSubtitle">${this.escapeHtml(this.getPanelSubtitle(data))}</div>
        </div>
        <button class="fmClose" type="button" data-fm-close aria-label="Close fleet manager">X</button>
      </div>
      ${this.activeTab === "shipDesigner" ? this.renderShipDesigner(data) : this.renderFleetManager(data)}
      <nav class="fmTabs">
        ${this.renderTab("fleetManager", "Fleet Manager")}
        ${this.renderTab("shipDesigner", "Ship Designer")}
      </nav>
    `;
  }

  private renderFleetManager(data: FleetManagerPanelData): string {
    const selectedFleet = this.getSelectedFleet(data);
    return `
      <section class="fmBody">
        <article class="fmColumn fmFleetListColumn">
          <div class="fmSectionTitle">Fleet Manager</div>
          <div class="fmFleetList">
            ${data.fleets.length === 0
              ? '<div class="fmEmpty">No fleets currently visible.</div>'
              : data.fleets.map((fleet, index) => this.renderFleetListItem(data, fleet, index)).join("")}
          </div>
        </article>
        <article class="fmColumn fmSelectedColumn">
          ${selectedFleet ? this.renderSelectedFleet(data, selectedFleet) : this.renderNoSelectedFleet()}
        </article>
        <aside class="fmColumn fmStatsColumn">
          ${this.addShipsOpen && selectedFleet ? this.renderShipPicker(data, selectedFleet) : this.renderOverallStats(data)}
        </aside>
      </section>
    `;
  }

  private renderFleetListItem(data: FleetManagerPanelData, fleet: ServerFleet, index: number): string {
    const owner = this.getFaction(data, fleet.ownerId);
    const selected = fleet.id === this.selectedFleetId;
    const shipCount = this.getFleetShipCount(data, fleet);
    const systemName = this.getStarName(data, fleet.currentStarId);
    return `
      <button class="fmFleetCard ${selected ? "selected" : ""}" type="button" data-fm-select-fleet="${this.escapeAttribute(fleet.id)}">
        <span class="fmFleetPip" style="--fleet-owner-color: ${this.colorToCss(owner?.color, 0.95)}"></span>
        <span class="fmFleetCopy">
          <strong>${this.escapeHtml(this.getFleetName(data, fleet, index))}</strong>
          <small>${this.escapeHtml(systemName)} | ${this.escapeHtml(this.formatFleetStatus(fleet))}</small>
        </span>
        <span class="fmFleetNumbers">
          <strong>${shipCount}</strong>
          <small>${this.escapeHtml(this.formatFleetPower(data, fleet, index))}</small>
        </span>
      </button>
    `;
  }

  private renderSelectedFleet(data: FleetManagerPanelData, fleet: ServerFleet): string {
    const owner = this.getFaction(data, fleet.ownerId);
    const ships = this.getShipsForFleet(data, fleet.id);
    const index = Math.max(0, data.fleets.findIndex((candidate) => candidate.id === fleet.id));
    const shipCount = this.getFleetShipCount(data, fleet);
    const defense = this.getFleetDefense(data, fleet);
    return `
      <div class="fmSelectedHeader">
        <div>
          <div class="fmSectionTitle">Selected Fleet</div>
          <h3>${this.escapeHtml(this.getFleetName(data, fleet, index))}</h3>
          <span>${this.escapeHtml(this.getStarName(data, fleet.currentStarId))} System</span>
        </div>
        <div class="fmPowerBadge">${this.escapeHtml(this.formatFleetPower(data, fleet, index))}</div>
      </div>
      <div class="fmStatGrid">
        ${this.renderStat("Status", this.formatFleetStatus(fleet))}
        ${this.renderStat("Owner", owner?.name ?? "Unknown")}
        ${this.renderStat("Class", shipCount === 1 ? "Single-Ship Fleet" : `${shipCount} Ships`)}
        ${this.renderStat("Shields", `${Math.round(defense.shield)} / ${Math.round(defense.maxShield)}`)}
        ${this.renderStat("Armor", `${Math.round(defense.armor)} / ${Math.round(defense.maxArmor)}`)}
        ${this.renderStat("Hull", `${Math.round(defense.hull)} / ${Math.round(defense.maxHull)}`)}
        ${this.renderStat("Speed", `${this.formatCompact(fleet.speed * 2)} ly/day`)}
        ${this.renderStat("Order", this.formatFleetOrder(data, fleet))}
      </div>
      ${this.renderBattleGroupEditor(data, fleet, ships)}
      <button class="fmAddShipsButton" type="button" data-fm-add-ships ${data.playerFactionId === fleet.ownerId ? "" : "disabled"}>Add Ships</button>
    `;
  }

  private renderBattleGroupEditor(data: FleetManagerPanelData, fleet: ServerFleet, ships: ServerShip[]): string {
    const groups = fleet.battleGroups ?? [];
    const selectedGroupId = this.selectedBattleGroupId && groups.some((group) => group.id === this.selectedBattleGroupId)
      ? this.selectedBattleGroupId
      : groups[0]?.id ?? null;
    this.selectedBattleGroupId = selectedGroupId;
    return `
      <div class="fmDoctrineHeader">
        <div>
          <div class="fmSectionTitle fmCompositionTitle">Battle Groups</div>
          <span>${fleet.alertMode ? "Alert deployed" : "Fleet stowed"} | ${groups.length || 0} group${groups.length === 1 ? "" : "s"}</span>
        </div>
        <div class="fmDoctrineActions">
          <button type="button" data-fm-toggle-alert ${data.playerFactionId === fleet.ownerId ? "" : "disabled"}>${fleet.alertMode ? "Stand Down" : "Alert"}</button>
          <button type="button" data-fm-create-bg ${data.playerFactionId === fleet.ownerId ? "" : "disabled"}>New</button>
        </div>
      </div>
      <div class="fmBattleGroupList">
        ${groups.length === 0
          ? '<div class="fmEmpty">Battle groups will be generated automatically from compatible ships.</div>'
          : groups.map((group) => this.renderBattleGroupCard(data, fleet, group, ships, group.id === selectedGroupId)).join("")}
      </div>
    `;
  }

  private renderBattleGroupCard(
    data: FleetManagerPanelData,
    fleet: ServerFleet,
    group: BattleGroupConfig,
    ships: ServerShip[],
    selected: boolean,
  ): string {
    const groupShips = group.shipIds
      .map((shipId) => ships.find((ship) => ship.id === shipId))
      .filter((ship): ship is ServerShip => !!ship);
    const hp = this.getShipsDefense(groupShips);
    const hpPct = hp.maxTotal > 0 ? Math.round((hp.total / hp.maxTotal) * 100) : 0;
    const canCommand = data.playerFactionId === fleet.ownerId;
    return `
      <article class="fmBattleGroupCard ${selected ? "selected" : ""}">
        <button class="fmBattleGroupTitle" type="button" data-fm-select-bg="${this.escapeAttribute(group.id)}">
          <strong>${this.escapeHtml(group.name)}</strong>
          <span>${groupShips.length} ships | ${hpPct}% total HP</span>
        </button>
        <div class="fmBattleGroupControls">
          <label>Behavior ${this.renderBattleGroupBehaviorSelect(group)}</label>
          <label>Chase ${this.renderBattleGroupChaseSelect(group)}</label>
          <label>Retreat <input type="number" min="0" max="99" step="5" value="${group.retreatPolicy.mode === "hpPercent" ? Math.round(group.retreatPolicy.thresholdPercent ?? 0) : 0}" data-fm-bg-retreat="${this.escapeAttribute(group.id)}" ${canCommand ? "" : "disabled"}></label>
        </div>
        <div class="fmBattleGroupShips">
          ${groupShips.length === 0
            ? '<div class="fmEmpty">No ships assigned.</div>'
            : groupShips.map((ship) => this.renderBattleGroupShipRow(data, fleet, group, ship)).join("")}
        </div>
        <div class="fmBattleGroupButtons">
          <button type="button" data-fm-split-bg="${this.escapeAttribute(group.id)}" ${canCommand && group.shipIds.length >= 2 ? "" : "disabled"}>Split</button>
          <button type="button" data-fm-merge-bg="${this.escapeAttribute(group.id)}" ${!canCommand || selected ? "disabled" : ""}>Merge Into Selected</button>
          <button type="button" data-fm-delete-bg="${this.escapeAttribute(group.id)}" ${canCommand ? "" : "disabled"}>Delete</button>
        </div>
      </article>
    `;
  }

  private renderBattleGroupBehaviorSelect(group: BattleGroupConfig): string {
    const options: BattleGroupBehavior[] = ["screen", "brawler", "line", "artillery", "defender"];
    return `
      <select data-fm-bg-behavior="${this.escapeAttribute(group.id)}">
        ${options.map((option) => `<option value="${option}" ${group.behavior === option ? "selected" : ""}>${this.escapeHtml(this.formatBattleGroupBehavior(option))}</option>`).join("")}
      </select>
    `;
  }

  private renderBattleGroupChaseSelect(group: BattleGroupConfig): string {
    const options: BattleGroupChaseSetting[] = ["none", "system", "friendlySystems", "neutralSystems", "enemySystems"];
    return `
      <select data-fm-bg-chase="${this.escapeAttribute(group.id)}">
        ${options.map((option) => `<option value="${option}" ${group.chaseSetting === option ? "selected" : ""}>${this.escapeHtml(this.formatChaseSetting(option))}</option>`).join("")}
      </select>
    `;
  }

  private renderBattleGroupShipRow(
    data: FleetManagerPanelData,
    fleet: ServerFleet,
    group: BattleGroupConfig,
    ship: ServerShip,
  ): string {
    const definition = STARBASE_SHIP_DEFINITIONS[ship.shipKind];
    const design = this.getDesignById(data, ship.designId);
    return `
      <div class="fmBattleGroupShipRow">
        <span class="fmShipIcon">${this.escapeHtml(this.getInitials(definition?.label ?? ship.shipKind))}</span>
        <span>
          <strong>${this.escapeHtml(definition?.label ?? ship.shipKind)}</strong>
          <small>${this.escapeHtml(design?.name ?? definition?.className ?? "Unknown class")}</small>
        </span>
        <select data-fm-ship-bg-target="${this.escapeAttribute(group.id)}" data-fm-ship-id="${this.escapeAttribute(ship.id)}">
          ${(fleet.battleGroups ?? []).map((candidate) => `
            <option value="${this.escapeAttribute(candidate.id)}" ${candidate.id === group.id ? "selected" : ""}>${this.escapeHtml(candidate.name)}</option>
          `).join("")}
        </select>
      </div>
    `;
  }

  private renderCompositionRows(
    data: FleetManagerPanelData,
    fleet: ServerFleet,
    ships: ServerShip[],
  ): string {
    if (ships.length > 0) {
      return ships.map((ship) => this.renderShipRow(data, ship)).join("");
    }
    if (fleet.shipIds.length > 0) {
      return fleet.shipIds.map((shipId) => `
        <div class="fmCompositionRow">
          <span class="fmShipIcon">CV</span>
          <span>
            <strong>Corvette</strong>
            <small>${this.escapeHtml(shipId)}</small>
          </span>
          <em>Tracked</em>
        </div>
      `).join("");
    }
    return '<div class="fmEmpty">No ships assigned to this fleet.</div>';
  }

  private renderShipRow(data: FleetManagerPanelData, ship: ServerShip): string {
    const definition = STARBASE_SHIP_DEFINITIONS[ship.shipKind];
    const design = this.getDesignById(data, ship.designId);
    const shieldPct = ship.maxShield > 0 ? Math.round((ship.shield / ship.maxShield) * 100) : 0;
    const armorPct = ship.maxArmor > 0 ? Math.round((ship.armor / ship.maxArmor) * 100) : 0;
    const hullPct = ship.maxHull > 0 ? Math.round((ship.hull / ship.maxHull) * 100) : 0;
    return `
      <div class="fmCompositionRow">
        <span class="fmShipIcon">${this.escapeHtml(this.getInitials(definition?.label ?? ship.shipKind))}</span>
        <span>
          <strong>${this.escapeHtml(definition?.label ?? ship.shipKind)}</strong>
          <small>${this.escapeHtml(design?.name ?? definition?.className ?? "Unknown class")}</small>
        </span>
        <em>S ${shieldPct}% | A ${armorPct}% | H ${hullPct}%</em>
      </div>
    `;
  }

  private renderNoSelectedFleet(): string {
    return `
      <div class="fmNoSelection">
        <div class="fmSectionTitle">Selected Fleet</div>
        <p>Select a fleet from the manager list.</p>
      </div>
    `;
  }

  private renderOverallStats(data: FleetManagerPanelData): string {
    const totalFleetPower = data.fleets.reduce((total, fleet, index) => (
      total + this.getFleetPowerValue(data, fleet, index)
    ), 0);
    return `
      <div class="fmStatsHeader">
        <div>
          <div class="fmSectionTitle">Overall Fleet Statistics</div>
          <span>Strategic readiness summary</span>
        </div>
      </div>
      <div class="fmOverallGrid">
        ${this.renderStat("Total Fleets", String(data.fleets.length))}
        ${this.renderStat("Total Ships", String(this.getTotalShipCount(data)))}
        ${this.renderStat("Fleet Power", this.formatPowerValue(totalFleetPower))}
        ${this.renderStat("Reinforcements", "Placeholder")}
        ${this.renderStat("Naval Capacity", "Placeholder")}
        ${this.renderStat("Command Limit", "Placeholder")}
        ${this.renderStat("Upkeep", "Placeholder")}
        ${this.renderStat("Readiness", "Placeholder")}
      </div>
      <div class="fmStatsNote">
        <strong>Shipyards</strong>
        <span>${this.getAvailableShipyardCount(data)} completed slip${this.getAvailableShipyardCount(data) === 1 ? "" : "s"} available.</span>
      </div>
    `;
  }

  private renderShipPicker(data: FleetManagerPanelData, fleet: ServerFleet): string {
    const nearest = this.findNearestShipyard(data, fleet);
    const designs = this.getActiveDesigns(data, fleet.ownerId);
    return `
      <div class="fmShipPicker">
        <div class="fmPickerHeader">
          <div>
            <strong>Add Ships</strong>
            <span>${nearest ? `Nearest shipyard: ${this.escapeHtml(this.getStarName(data, nearest.starId))}` : "No completed shipyard available"}</span>
          </div>
          <button type="button" data-fm-close-ship-picker aria-label="Close add ships">X</button>
        </div>
        <div class="fmBuildShipList">
          ${designs.length === 0 ? '<div class="fmEmpty">No active designs available.</div>' : designs.map((design) => {
            const stats = calculateShipDesignStats(design);
            const predictedAlloys = stats.alloyUpkeepPerDay * stats.buildDays;
            return `
              <button class="fmBuildShipCard" type="button" data-fm-build-ship="${design.shipKind}" data-fm-build-design="${this.escapeAttribute(design.id)}" ${nearest ? "" : "disabled"}>
                <span class="fmShipIcon">${this.escapeHtml(this.getInitials(SHIP_HULL_DEFINITIONS[design.shipKind]?.label ?? design.shipKind))}</span>
                <span>
                  <strong>${this.escapeHtml(design.name)}</strong>
                  <small>${this.escapeHtml(SHIP_HULL_DEFINITIONS[design.shipKind]?.label ?? design.shipKind)}</small>
                  <em>${this.formatCompact(predictedAlloys)} alloys predicted | ${stats.buildDays.toFixed(1)} days | ${this.formatCompact(stats.crewDemand)} crew</em>
                </span>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  private renderShipDesigner(data: FleetManagerPanelData): string {
    const draft = this.getDesignerDraft(data);
    if (!draft) {
      return `
        <section class="fmDesignerBody">
          <article class="fmDesignerEmpty">
            <div class="fmSectionTitle">Ship Designer</div>
            <p>No ship designs are available.</p>
          </article>
        </section>
      `;
    }
    const stats = calculateShipDesignStats(draft);
    const activeDesignCount = this.getActiveDesigns(data, draft.ownerId, draft.shipKind).length;
    return `
      <section class="fmDesignerBody">
        <aside class="fmDesignListPane">
          <button class="fmNewDesignCard" type="button" data-fm-new-design>
            <span>+</span>
            <strong>New Design</strong>
          </button>
          ${this.renderDesignList(data, draft)}
        </aside>
        <main class="fmDesignWorkbench">
          <div class="fmDesignNameBar">
            <input type="text" value="${this.escapeAttribute(draft.name)}" maxlength="40" data-fm-design-name aria-label="Design name">
            <span>${this.escapeHtml(SHIP_HULL_DEFINITIONS[draft.shipKind]?.label ?? draft.shipKind)}</span>
          </div>
          <div class="fmCoreSection">
            <div class="fmSectionTitle">Corvette Core</div>
            <div class="fmSlotRow fmWeaponSlots">
              ${draft.weaponModuleIds.map((moduleId, index) => this.renderDesignSlot("weapon", index, moduleId)).join("")}
            </div>
          </div>
          <div class="fmDesignViewport" aria-label="Ship preview"></div>
          <div class="fmLowerSections">
            <div>
              <div class="fmSectionTitle">Defense</div>
              <div class="fmSlotRow fmDefenseSlots">
                ${draft.defenseModuleIds.map((moduleId, index) => this.renderDesignSlot("defense", index, moduleId)).join("")}
              </div>
            </div>
            <div>
              <div class="fmSectionTitle">Extra</div>
              <div class="fmSlotRow">
                ${this.renderDesignSlot("utility", 0, draft.utilityModuleId)}
              </div>
            </div>
          </div>
          <div class="fmModulePalette">
            ${this.renderModulePalette()}
          </div>
        </main>
        <aside class="fmDesignStatsPane">
          <div class="fmStatsHeader">
            <div>
              <div class="fmSectionTitle">Ship Stats</div>
              <span>${this.escapeHtml(stats.className)}</span>
            </div>
          </div>
          <div class="fmOverallGrid fmDesignStatGrid">
            ${this.renderStat("Power", this.formatPowerValue(computeCombatPowerFromStats(stats.combat)))}
            ${this.renderStat("Damage", this.formatCompact(stats.combat.weaponMounts.reduce((sum, mount) => sum + mount.damage * mount.barrels, 0)))}
            ${this.renderStat("Shields", this.formatCompact(stats.combat.maxShield))}
            ${this.renderStat("Armor", this.formatCompact(stats.combat.maxArmor))}
            ${this.renderStat("Hull", this.formatCompact(stats.combat.maxHull))}
            ${this.renderStat("Evasion", `${Math.round(stats.combat.evasion * 100)}%`)}
            ${this.renderStat("Speed", this.formatCompact(stats.speed))}
            ${this.renderStat("Sensor", this.formatCompact(stats.combat.sensorRange))}
          </div>
          <div class="fmStatsNote">
            <strong>Cost</strong>
            <span>${this.escapeHtml(this.formatResources(stats.cost))}</span>
          </div>
          <div class="fmStatsNote">
            <strong>Upkeep</strong>
            <span>${this.escapeHtml(this.formatResources(stats.upkeep))}</span>
          </div>
          <div class="fmControlStack">
            <button type="button" data-fm-clear-design>Auto-complete</button>
            <button type="button" data-fm-save-design>Save</button>
            <button type="button" data-fm-decommission-design ${draft.id && activeDesignCount > 1 ? "" : "disabled"}>Decommission</button>
          </div>
        </aside>
      </section>
    `;
  }

  private renderDesignList(data: FleetManagerPanelData, draft: ShipDesign): string {
    const groups = new Map<StarbaseShipKind, ShipDesign[]>();
    for (const design of data.shipDesigns.filter((candidate) => candidate.status === "active")) {
      if (data.playerFactionId !== null && design.ownerId !== data.playerFactionId) continue;
      const list = groups.get(design.shipKind) ?? [];
      list.push(design);
      groups.set(design.shipKind, list);
    }
    const orderedKinds: StarbaseShipKind[] = ["corvette"];
    return orderedKinds.map((shipKind) => {
      const designs = (groups.get(shipKind) ?? []).sort((a, b) => a.name.localeCompare(b.name));
      if (designs.length === 0) return "";
      const hull = SHIP_HULL_DEFINITIONS[shipKind];
      return `
        <div class="fmDesignTypeGroup">
          <div class="fmDesignTypeLabel">${this.escapeHtml(hull?.label ?? shipKind)}</div>
          ${designs.map((design) => `
            <button class="fmDesignCard ${draft.id === design.id ? "selected" : ""}" type="button" data-fm-select-design="${this.escapeAttribute(design.id)}">
              <span class="fmDesignThumb">${this.escapeHtml(this.getInitials(hull?.label ?? shipKind))}</span>
              <span>
                <strong>${this.escapeHtml(design.name)}</strong>
                <small>${this.escapeHtml(hull?.label ?? shipKind)}</small>
              </span>
            </button>
          `).join("")}
        </div>
      `;
    }).join("");
  }

  private renderDesignSlot(kind: DesignerSlotKind, index: number, moduleId: string | null | undefined): string {
    const module = getShipModuleDefinition(moduleId);
    const slot = `${kind}:${index}`;
    const selected = this.selectedDesignerSlot === slot;
    const emptyLabel = kind === "utility" ? "Extra" : kind === "weapon" ? "Weapon" : "Defense";
    return `
      <button class="fmDesignSlot ${selected ? "selected" : ""} ${module ? "" : "empty"}" type="button" data-fm-design-slot="${this.escapeAttribute(slot)}">
        <span>${this.escapeHtml(module ? this.getInitials(module.label) : "+")}</span>
        <strong>${this.escapeHtml(module?.label ?? emptyLabel)}</strong>
      </button>
    `;
  }

  private renderModulePalette(): string {
    const slot = this.parseDesignerSlot(this.selectedDesignerSlot);
    const modules = this.getModulesForSlot(slot.kind);
    return `
      <div class="fmPaletteHeader">
        <strong>${this.escapeHtml(this.formatSlotKind(slot.kind))}</strong>
      </div>
      <div class="fmPaletteList">
        ${modules.map((module) => this.renderModuleButton(module)).join("")}
      </div>
    `;
  }

  private renderModuleButton(module: ShipModuleDefinition): string {
    const selected = this.isModuleSelectedInSlot(module.id);
    return `
      <button class="fmModuleButton ${selected ? "selected" : ""}" type="button" data-fm-module="${this.escapeAttribute(module.id)}">
        <span>${this.escapeHtml(this.getInitials(module.label))}</span>
        <strong>${this.escapeHtml(module.label)}</strong>
      </button>
    `;
  }

  private renderTab(tab: FleetManagerTab, label: string): string {
    return `<button class="${this.activeTab === tab ? "active" : ""}" type="button" data-fm-tab="${tab}">${label}</button>`;
  }

  private renderStat(label: string, value: string): string {
    return `
      <div class="fmStat">
        <span>${this.escapeHtml(label)}</span>
        <strong>${this.escapeHtml(value)}</strong>
      </div>
    `;
  }

  private ensureDesignerDraft(data: FleetManagerPanelData): void {
    const available = this.getActiveDesigns(data, data.playerFactionId ?? undefined);
    const selected = this.selectedDesignId
      ? data.shipDesigns.find((design) => design.id === this.selectedDesignId)
      : null;
    if (this.designerDraft && (!this.selectedDesignId || selected)) return;
    const design = selected ?? available[0] ?? data.shipDesigns.find((candidate) => candidate.status === "active");
    this.selectedDesignId = design?.id ?? null;
    this.designerDraft = design ? this.cloneDesign(design) : null;
  }

  private getDesignerDraft(data: FleetManagerPanelData): ShipDesign | null {
    this.ensureDesignerDraft(data);
    return this.designerDraft;
  }

  private cloneDesign(design: ShipDesign): ShipDesign {
    return {
      ...design,
      weaponModuleIds: [...design.weaponModuleIds],
      defenseModuleIds: [...design.defenseModuleIds],
    };
  }

  private getDesignById(data: FleetManagerPanelData, designId: string | null | undefined): ShipDesign | null {
    if (!designId) return null;
    return data.shipDesigns.find((design) => design.id === designId) ?? null;
  }

  private getActiveDesigns(
    data: FleetManagerPanelData,
    ownerId?: number | null,
    shipKind?: StarbaseShipKind,
  ): ShipDesign[] {
    return data.shipDesigns
      .filter((design) => (
        design.status === "active"
        && (ownerId === undefined || ownerId === null || design.ownerId === ownerId)
        && (!shipKind || design.shipKind === shipKind)
      ))
      .sort((a, b) => {
        const kindDelta = a.shipKind.localeCompare(b.shipKind);
        return kindDelta !== 0 ? kindDelta : a.name.localeCompare(b.name);
      });
  }

  private parseDesignerSlot(slot: string): { kind: DesignerSlotKind; index: number } {
    const [kind, indexText] = slot.split(":");
    if (kind === "defense" || kind === "utility" || kind === "weapon") {
      return { kind, index: Math.max(0, Number(indexText) || 0) };
    }
    return { kind: "weapon", index: 0 };
  }

  private getModulesForSlot(kind: DesignerSlotKind): ShipModuleDefinition[] {
    if (kind === "defense") return SHIP_DEFENSE_MODULES;
    if (kind === "utility") return SHIP_UTILITY_MODULES;
    return SHIP_WEAPON_MODULES;
  }

  private applyModuleToDraft(moduleId: string): void {
    if (!this.designerDraft) return;
    const module = getShipModuleDefinition(moduleId);
    if (!module) return;
    const slot = this.parseDesignerSlot(this.selectedDesignerSlot);
    if (module.slotType !== slot.kind) return;
    if (slot.kind === "weapon" && slot.index < this.designerDraft.weaponModuleIds.length) {
      this.designerDraft.weaponModuleIds[slot.index] = moduleId;
    } else if (slot.kind === "defense" && slot.index < this.designerDraft.defenseModuleIds.length) {
      this.designerDraft.defenseModuleIds[slot.index] = moduleId;
    } else if (slot.kind === "utility") {
      this.designerDraft.utilityModuleId = moduleId;
    }
  }

  private isModuleSelectedInSlot(moduleId: string): boolean {
    if (!this.designerDraft) return false;
    const slot = this.parseDesignerSlot(this.selectedDesignerSlot);
    if (slot.kind === "weapon") return this.designerDraft.weaponModuleIds[slot.index] === moduleId;
    if (slot.kind === "defense") return this.designerDraft.defenseModuleIds[slot.index] === moduleId;
    return this.designerDraft.utilityModuleId === moduleId;
  }

  private formatSlotKind(kind: ShipModuleSlotType): string {
    if (kind === "defense") return "Defense Modules";
    if (kind === "utility") return "Extra Components";
    return "Weapons";
  }

  private formatResources(resources: Record<string, number>): string {
    const parts = Object.entries(resources)
      .filter(([, value]) => Math.abs(value) > 0.001)
      .map(([resource, value]) => `${this.formatCompact(value)} ${resource}`);
    return parts.length > 0 ? parts.join(" | ") : "None";
  }

  private ensureSelectedFleet(data: FleetManagerPanelData): void {
    if (this.selectedFleetId && data.fleets.some((fleet) => fleet.id === this.selectedFleetId)) return;
    const ownFleet = data.playerFactionId === null
      ? null
      : data.fleets.find((fleet) => fleet.ownerId === data.playerFactionId);
    this.selectedFleetId = (ownFleet ?? data.fleets[0])?.id ?? null;
    this.addShipsOpen = false;
  }

  private getSelectedFleet(data: FleetManagerPanelData): ServerFleet | null {
    if (!this.selectedFleetId) return null;
    return data.fleets.find((fleet) => fleet.id === this.selectedFleetId) ?? null;
  }

  private getShipsForFleet(data: FleetManagerPanelData, fleetId: string): ServerShip[] {
    return data.ships.filter((ship) => ship.fleetId === fleetId);
  }

  private getFleetShipCount(data: FleetManagerPanelData, fleet: ServerFleet): number {
    return Math.max(fleet.shipIds.length, this.getShipsForFleet(data, fleet.id).length);
  }

  private getTotalShipCount(data: FleetManagerPanelData): number {
    return data.fleets.reduce((total, fleet) => total + this.getFleetShipCount(data, fleet), 0);
  }

  private getFleetDefense(data: FleetManagerPanelData, fleet: ServerFleet): {
    shield: number;
    maxShield: number;
    armor: number;
    maxArmor: number;
    hull: number;
    maxHull: number;
  } {
    const ships = this.getShipsForFleet(data, fleet.id);
    if (ships.length === 0) {
      return { shield: 0, maxShield: 0, armor: 0, maxArmor: 0, hull: 0, maxHull: 0 };
    }
    return ships.reduce(
      (total, ship) => ({
        shield: total.shield + ship.shield,
        maxShield: total.maxShield + ship.maxShield,
        armor: total.armor + ship.armor,
        maxArmor: total.maxArmor + ship.maxArmor,
        hull: total.hull + ship.hull,
        maxHull: total.maxHull + ship.maxHull,
      }),
      { shield: 0, maxShield: 0, armor: 0, maxArmor: 0, hull: 0, maxHull: 0 },
    );
  }

  private getShipsDefense(ships: ServerShip[]): { total: number; maxTotal: number } {
    return ships.reduce(
      (total, ship) => ({
        total: total.total + ship.shield + ship.armor + ship.hull,
        maxTotal: total.maxTotal + ship.maxShield + ship.maxArmor + ship.maxHull,
      }),
      { total: 0, maxTotal: 0 },
    );
  }

  private formatBattleGroupBehavior(behavior: BattleGroupBehavior): string {
    const labels: Record<BattleGroupBehavior, string> = {
      screen: "Screen",
      brawler: "Brawler",
      line: "Line",
      artillery: "Artillery",
      defender: "Defender",
    };
    return labels[behavior] ?? behavior;
  }

  private formatChaseSetting(chase: BattleGroupChaseSetting): string {
    const labels: Record<BattleGroupChaseSetting, string> = {
      none: "No chase",
      system: "In system",
      friendlySystems: "Friendly systems",
      neutralSystems: "Neutral systems",
      enemySystems: "Enemy systems",
    };
    return labels[chase] ?? chase;
  }

  private getFleetName(data: FleetManagerPanelData, fleet: ServerFleet, index: number): string {
    const owner = this.getFaction(data, fleet.ownerId);
    const suffix = data.fleets.filter((candidate) => candidate.ownerId === fleet.ownerId).length > 1
      ? ` ${index + 1}`
      : "";
    return owner ? `${owner.name} Fleet${suffix}` : `Unidentified Fleet ${index + 1}`;
  }

  private getPanelSubtitle(data: FleetManagerPanelData): string {
    const player = data.playerFactionId === null ? null : this.getFaction(data, data.playerFactionId);
    return player ? `${player.name} Fleet Command` : "Observer Fleet Command";
  }

  private getFaction(data: FleetManagerPanelData, ownerId: number): FactionInfo | null {
    return data.factions.find((faction) => faction.id === ownerId) ?? null;
  }

  private getStarName(data: FleetManagerPanelData, starId: number): string {
    return data.stars[starId]?.name ?? `Star ${starId}`;
  }

  private findNearestShipyard(data: FleetManagerPanelData, fleet: ServerFleet): ServerStarbase | null {
    if (data.playerFactionId !== null && fleet.ownerId !== data.playerFactionId) return null;
    const fleetPosition = this.getFleetMapPosition(data, fleet);
    if (!fleetPosition) return null;
    let nearest: ServerStarbase | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const starbase of data.starbases) {
      if (starbase.ownerId !== fleet.ownerId) continue;
      if (starbase.status !== "online") continue;
      if (countStarbaseShipyards(starbase.buildingSlots) <= 0) continue;
      const star = data.stars[starbase.starId];
      if (!star) continue;
      const dx = star.x - fleetPosition.x;
      const dz = star.z - fleetPosition.z;
      const distance = dx * dx + dz * dz;
      if (distance < nearestDistance) {
        nearest = starbase;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private getFleetMapPosition(data: FleetManagerPanelData, fleet: ServerFleet): { x: number; z: number } | null {
    if (fleet.hyperlanePosition) {
      const from = data.stars[fleet.hyperlanePosition.fromStarId];
      const to = data.stars[fleet.hyperlanePosition.toStarId];
      if (!from || !to) return null;
      const progress = Math.max(0, Math.min(1, fleet.hyperlanePosition.progress));
      return {
        x: from.x + (to.x - from.x) * progress,
        z: from.z + (to.z - from.z) * progress,
      };
    }
    const star = data.stars[fleet.currentStarId];
    return star ? { x: star.x, z: star.z } : null;
  }

  private getAvailableShipyardCount(data: FleetManagerPanelData): number {
    const playerFactionId = data.playerFactionId;
    return data.starbases
      .filter((starbase) => (
        starbase.status === "online"
        && (playerFactionId === null || starbase.ownerId === playerFactionId)
      ))
      .reduce((total, starbase) => total + countStarbaseShipyards(starbase.buildingSlots), 0);
  }

  private getFleetPowerValue(data: FleetManagerPanelData, fleet: ServerFleet, index: number): number {
    const ships = this.getShipsForFleet(data, fleet.id);
    return computeFleetPower(ships, Math.max(1, this.getFleetShipCount(data, fleet)), undefined, data.shipDesigns);
  }

  private formatFleetPower(data: FleetManagerPanelData, fleet: ServerFleet, index: number): string {
    return this.formatPowerValue(this.getFleetPowerValue(data, fleet, index));
  }

  private formatPowerValue(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    return `${Math.round(value / 1000)}K`;
  }

  private formatFleetStatus(fleet: ServerFleet): string {
    switch (fleet.phase) {
      case "departingSystem":
        return "Departing";
      case "arrivingSystem":
        return "Arriving";
      case "buildingStarbase":
        return "Building";
      case "jumpingHyperlane":
        return "In Transit";
      case "movingSystem":
        return fleet.orderType === "merge" ? "Merging" : "Maneuvering";
      case "orbiting":
      case "orbitingPlanet":
        return "Orbiting";
      case "idle":
      default:
        return "Operational";
    }
  }

  private formatFleetOrder(data: FleetManagerPanelData, fleet: ServerFleet): string {
    if (fleet.movementPlan) {
      const destination = fleet.movementPlan.destinationPlanetId
        ? this.findPlanetName(data, fleet.movementPlan.destinationPlanetId)
        : (fleet.movementPlan.destinationOrbitTarget
          ? this.formatOrbitTarget(data, fleet.movementPlan.destinationOrbitTarget)
          : this.getStarName(data, fleet.movementPlan.destinationStarId));
      const remainingDays = Math.max(0, (fleet.movementPlan.endsAtYear - data.clockYear) * GAME_DAYS_PER_YEAR);
      const remainingMinutes = remainingDays * REAL_MS_PER_GAME_DAY / 60_000;
      return `${destination} | ${remainingDays.toFixed(1)}d | ${remainingMinutes.toFixed(1)}m`;
    }
    if (fleet.orderType === "build") return "Build Starbase";
    if (fleet.orderType === "orbit" && fleet.orbitTargetPlanetId) return `Orbiting ${this.findPlanetName(data, fleet.orbitTargetPlanetId)}`;
    if (fleet.orbitTarget) return `Orbiting ${this.formatOrbitTarget(data, fleet.orbitTarget)}`;
    if (fleet.orderType === "merge") return "Merge rendezvous";
    if (fleet.orderType === "move") return fleet.targetStarId === null ? "Move" : `Move to ${this.getStarName(data, fleet.targetStarId)}`;
    return "None";
  }

  private formatOrbitTarget(data: FleetManagerPanelData, target: NonNullable<ServerFleet["orbitTarget"]>): string {
    if (target.kind === "planet" && target.planetId) return this.findPlanetName(data, target.planetId);
    if (target.kind === "star") return this.getStarName(data, target.starId);
    if (target.kind === "starbase") return `${this.getStarName(data, target.starId)} Starbase`;
    if (target.kind === "hyperlane") return `${this.getStarName(data, target.starId)} Hyperlane`;
    if (target.kind === "fleet") return "Fleet";
    return this.getStarName(data, target.starId);
  }

  private findPlanetName(data: FleetManagerPanelData, planetId: string): string {
    for (const star of data.stars) {
      const planet = star.system.planets.find((candidate) => candidate.id === planetId);
      if (planet) return planet.name;
    }
    return planetId;
  }

  private formatCompact(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}K`;
    return abs.toFixed(abs >= 10 ? 0 : 1);
  }

  private getInitials(label: string): string {
    return label.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();
  }

  private colorToCss(color: [number, number, number] | undefined, alpha: number): string {
    if (!color) return `rgba(114, 226, 255, ${alpha})`;
    const r = Math.round(Math.max(0, Math.min(1, color[0])) * 255);
    const g = Math.round(Math.max(0, Math.min(1, color[1])) * 255);
    const b = Math.round(Math.max(0, Math.min(1, color[2])) * 255);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.fleetManagerPanel {
  --fleet-accent: rgba(114, 226, 255, 0.95);
  position: fixed;
  width: min(1120px, calc(100vw - 32px));
  height: min(680px, calc(100vh - 32px));
  z-index: 58;
  pointer-events: auto;
  display: grid;
  grid-template-rows: 58px minmax(0, 1fr) 44px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--fleet-accent) 76%, transparent);
  background:
    radial-gradient(circle at 70% 22%, color-mix(in srgb, var(--fleet-accent) 12%, transparent), transparent 18rem),
    linear-gradient(180deg, rgba(7, 28, 31, 0.98), rgba(2, 12, 15, 0.99));
  color: #e9fff8;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.56), inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  user-select: none;
}

.fmHeader {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  cursor: grab;
  border-bottom: 1px solid rgba(103, 255, 221, 0.24);
  background: linear-gradient(90deg, rgba(20, 70, 62, 0.86), rgba(4, 19, 23, 0.92));
}

.fmHeaderIcon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  clip-path: polygon(50% 0, 94% 25%, 94% 75%, 50% 100%, 6% 75%, 6% 25%);
  background: var(--fleet-accent);
  color: #062018;
  font-weight: 900;
  font-size: 11px;
}

.fmTitle {
  font-size: 19px;
  font-weight: 900;
}

.fmSubtitle {
  margin-top: 2px;
  color: rgba(206, 232, 226, 0.68);
  font-size: 11px;
  text-transform: uppercase;
}

.fmClose {
  margin-left: auto;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(103, 255, 221, 0.62);
  background: rgba(6, 42, 38, 0.76);
  color: #bfffee;
  font: inherit;
  cursor: pointer;
}

.fmBody {
  min-height: 0;
  display: grid;
  grid-template-columns: 270px minmax(0, 1fr) 270px;
  gap: 8px;
  padding: 8px;
}

.fmColumn,
.fmDesignerEmpty,
.fmDesignListPane,
.fmDesignWorkbench,
.fmDesignStatsPane {
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(103, 255, 221, 0.26);
  background: rgba(5, 24, 25, 0.72);
}

.fmFleetListColumn,
.fmSelectedColumn,
.fmStatsColumn {
  padding: 8px;
}

.fmSectionTitle {
  margin: 0 0 7px;
  color: #eafef8;
  font-size: 13px;
  font-weight: 900;
}

.fmFleetList,
.fmCompositionList,
.fmBuildShipList {
  min-height: 0;
  overflow-y: auto;
  display: grid;
  align-content: start;
  gap: 6px;
  padding-right: 3px;
  scrollbar-width: thin;
}

.fmFleetList {
  max-height: calc(100% - 26px);
}

.fmCompositionList {
  max-height: 154px;
}

.fmBuildShipList {
  max-height: 424px;
}

.fmFleetList::-webkit-scrollbar,
.fmCompositionList::-webkit-scrollbar,
.fmBuildShipList::-webkit-scrollbar {
  width: 6px;
}

.fmFleetList::-webkit-scrollbar-thumb,
.fmCompositionList::-webkit-scrollbar-thumb,
.fmBuildShipList::-webkit-scrollbar-thumb {
  background: rgba(103, 255, 221, 0.34);
  border-radius: 999px;
}

.fmFleetCard {
  min-height: 64px;
  display: grid;
  grid-template-columns: 6px minmax(0, 1fr) 56px;
  gap: 8px;
  align-items: center;
  border: 1px solid rgba(103, 255, 221, 0.24);
  background: linear-gradient(135deg, rgba(16, 57, 52, 0.76), rgba(4, 17, 21, 0.94));
  color: #e9fff8;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.fmFleetCard.selected {
  border-color: rgba(248, 218, 103, 0.78);
  box-shadow: inset 3px 0 0 rgba(248, 218, 103, 0.82), 0 0 14px rgba(248, 218, 103, 0.12);
}

.fmFleetCard:hover {
  border-color: rgba(103, 255, 221, 0.72);
}

.fmFleetPip {
  width: 4px;
  height: 42px;
  margin-left: 5px;
  background: var(--fleet-owner-color, var(--fleet-accent));
}

.fmFleetCopy,
.fmFleetNumbers,
.fmCompositionRow span,
.fmBuildShipCard span {
  min-width: 0;
}

.fmFleetCopy strong,
.fmFleetCopy small,
.fmFleetNumbers strong,
.fmFleetNumbers small {
  display: block;
}

.fmFleetCopy strong {
  color: #eafff8;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fmFleetCopy small,
.fmFleetNumbers small {
  color: rgba(206, 232, 226, 0.62);
  font-size: 10px;
}

.fmFleetNumbers {
  text-align: right;
  padding-right: 7px;
}

.fmFleetNumbers strong {
  color: #75ff9b;
  font-size: 15px;
}

.fmSelectedHeader,
.fmStatsHeader {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(103, 255, 221, 0.2);
}

.fmSelectedHeader h3 {
  margin: 0;
  color: #eafff8;
  font-size: 17px;
}

.fmSelectedHeader span,
.fmStatsHeader span,
.fmDesignerEmpty p {
  display: block;
  margin-top: 3px;
  color: rgba(206, 232, 226, 0.62);
  font-size: 11px;
  line-height: 1.35;
}

.fmPowerBadge {
  min-width: 62px;
  padding: 5px 8px;
  border: 1px solid rgba(255, 224, 123, 0.64);
  background: rgba(48, 34, 13, 0.72);
  color: #ffe48a;
  font-size: 12px;
  font-weight: 900;
  text-align: center;
}

.fmStatGrid,
.fmOverallGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  margin-top: 8px;
}

.fmStat {
  min-height: 46px;
  padding: 6px;
  border: 1px solid rgba(103, 255, 221, 0.24);
  background: rgba(1, 8, 10, 0.36);
}

.fmStat span,
.fmShipPicker .fmPickerHeader span {
  display: block;
  color: rgba(206, 232, 226, 0.62);
  font-size: 10px;
  text-transform: uppercase;
}

.fmStat strong {
  display: block;
  margin-top: 6px;
  color: #eafff8;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fmCompositionTitle {
  margin-top: 10px;
}

.fmDoctrineHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(103, 255, 221, 0.2);
}

.fmDoctrineHeader span {
  color: rgba(206, 232, 226, 0.62);
  font-size: 10px;
}

.fmDoctrineActions,
.fmBattleGroupButtons {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}

.fmDoctrineActions button,
.fmBattleGroupButtons button {
  min-height: 26px;
  border: 1px solid rgba(103, 255, 221, 0.38);
  background: rgba(6, 42, 38, 0.72);
  color: #d8fff6;
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}

.fmDoctrineActions button:disabled,
.fmBattleGroupButtons button:disabled {
  opacity: 0.38;
  cursor: default;
}

.fmBattleGroupList {
  max-height: 300px;
  overflow-y: auto;
  display: grid;
  gap: 7px;
  padding-right: 3px;
  scrollbar-width: thin;
}

.fmBattleGroupCard {
  display: grid;
  gap: 6px;
  border: 1px solid rgba(103, 255, 221, 0.22);
  background: rgba(1, 8, 10, 0.36);
  padding: 7px;
}

.fmBattleGroupCard.selected {
  border-color: rgba(248, 218, 103, 0.72);
}

.fmBattleGroupTitle {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  border: 0;
  background: transparent;
  color: #eafff8;
  font: inherit;
  text-align: left;
  cursor: pointer;
  padding: 0;
}

.fmBattleGroupTitle strong,
.fmBattleGroupTitle span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fmBattleGroupTitle span {
  color: rgba(206, 232, 226, 0.62);
  font-size: 10px;
}

.fmBattleGroupControls {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
}

.fmBattleGroupControls label {
  display: grid;
  gap: 3px;
  color: rgba(206, 232, 226, 0.62);
  font-size: 9px;
  text-transform: uppercase;
}

.fmBattleGroupControls select,
.fmBattleGroupControls input,
.fmBattleGroupShipRow select {
  min-width: 0;
  height: 26px;
  border: 1px solid rgba(103, 255, 221, 0.28);
  background: rgba(0, 0, 0, 0.32);
  color: #eafff8;
  font: inherit;
  font-size: 10px;
}

.fmBattleGroupShips {
  display: grid;
  gap: 5px;
}

.fmBattleGroupShipRow {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 120px;
  gap: 7px;
  align-items: center;
  min-height: 42px;
}

.fmBattleGroupShipRow strong,
.fmBattleGroupShipRow small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fmBattleGroupShipRow small {
  color: rgba(206, 232, 226, 0.62);
  font-size: 10px;
}

.fmCompositionRow,
.fmBuildShipCard {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-height: 56px;
  border: 1px solid rgba(103, 255, 221, 0.22);
  background: rgba(1, 8, 10, 0.42);
  padding: 7px;
}

.fmCompositionRow strong,
.fmCompositionRow small,
.fmBuildShipCard strong,
.fmBuildShipCard small,
.fmBuildShipCard em {
  display: block;
}

.fmCompositionRow strong,
.fmBuildShipCard strong {
  color: #eafff8;
  font-size: 12px;
}

.fmCompositionRow small,
.fmBuildShipCard small {
  color: #75ff9b;
  font-size: 10px;
}

.fmCompositionRow em,
.fmBuildShipCard em {
  color: rgba(216, 238, 232, 0.62);
  font-size: 10px;
  font-style: normal;
}

.fmShipIcon,
.fmDesignerIcon {
  display: grid;
  place-items: center;
  border: 1px solid rgba(103, 255, 221, 0.42);
  background: rgba(103, 255, 221, 0.1);
  color: #a9ffea;
  font-weight: 900;
}

.fmShipIcon {
  width: 32px;
  height: 32px;
  font-size: 10px;
}

.fmAddShipsButton {
  width: 100%;
  min-height: 36px;
  margin-top: 8px;
  border: 1px solid rgba(103, 255, 221, 0.5);
  background: rgba(6, 42, 38, 0.72);
  color: #d8fff6;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.fmAddShipsButton:disabled {
  opacity: 0.38;
  cursor: default;
}

.fmStatsNote {
  display: grid;
  gap: 3px;
  margin-top: 8px;
  padding: 8px;
  border: 1px solid rgba(103, 255, 221, 0.18);
  background: rgba(0, 0, 0, 0.18);
}

.fmStatsNote strong {
  color: #eafff8;
  font-size: 12px;
}

.fmStatsNote span {
  color: rgba(206, 232, 226, 0.62);
  font-size: 11px;
}

.fmShipPicker {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.fmPickerHeader {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.fmPickerHeader strong {
  display: block;
  color: #eafff8;
  font-size: 13px;
}

.fmPickerHeader button {
  width: 28px;
  height: 28px;
  border: 1px solid rgba(103, 255, 221, 0.5);
  background: rgba(6, 42, 38, 0.72);
  color: #d8fff6;
  font: inherit;
  cursor: pointer;
}

.fmBuildShipCard {
  grid-template-columns: 38px minmax(0, 1fr);
  color: #e9fff8;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.fmBuildShipCard:hover {
  border-color: rgba(103, 255, 221, 0.72);
}

.fmBuildShipCard:disabled {
  opacity: 0.44;
  cursor: default;
}

.fmNoSelection,
.fmEmpty {
  color: rgba(206, 232, 226, 0.56);
  font-size: 11px;
  line-height: 1.4;
}

.fmDesignerBody {
  min-height: 0;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 248px;
  gap: 8px;
  padding: 8px;
}

.fmDesignerEmpty {
  height: 100%;
  padding: 18px;
}

.fmDesignListPane,
.fmDesignWorkbench,
.fmDesignStatsPane {
  padding: 8px;
}

.fmDesignListPane {
  overflow-y: auto;
  scrollbar-width: thin;
}

.fmNewDesignCard,
.fmDesignCard {
  width: 100%;
  display: grid;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(103, 255, 221, 0.24);
  background: rgba(1, 8, 10, 0.42);
  color: #e9fff8;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.fmNewDesignCard {
  grid-template-columns: 34px minmax(0, 1fr);
  min-height: 52px;
  margin-bottom: 10px;
  background: rgba(103, 255, 221, 0.08);
}

.fmNewDesignCard span,
.fmDesignThumb {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(103, 255, 221, 0.38);
  color: #a9ffea;
  font-weight: 900;
}

.fmDesignTypeGroup {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
}

.fmDesignTypeLabel {
  color: rgba(206, 232, 226, 0.66);
  font-size: 10px;
  text-transform: uppercase;
  font-weight: 900;
}

.fmDesignCard {
  grid-template-columns: 40px minmax(0, 1fr);
  min-height: 62px;
  padding: 7px;
}

.fmDesignCard.selected,
.fmDesignSlot.selected,
.fmModuleButton.selected {
  border-color: rgba(248, 218, 103, 0.82);
  box-shadow: inset 0 0 0 1px rgba(248, 218, 103, 0.24);
}

.fmDesignCard strong,
.fmDesignCard small,
.fmNewDesignCard strong {
  display: block;
}

.fmDesignCard strong,
.fmNewDesignCard strong {
  color: #eafff8;
  font-size: 12px;
}

.fmDesignCard small {
  color: rgba(206, 232, 226, 0.62);
  font-size: 10px;
}

.fmDesignWorkbench {
  display: grid;
  grid-template-rows: 36px auto minmax(180px, 1fr) auto 114px;
  gap: 8px;
}

.fmDesignNameBar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.fmDesignNameBar input {
  min-width: 0;
  height: 34px;
  border: 1px solid rgba(103, 255, 221, 0.38);
  background: rgba(0, 0, 0, 0.32);
  color: #eafff8;
  padding: 0 9px;
  font: inherit;
  font-size: 13px;
}

.fmDesignNameBar span {
  color: #75ff9b;
  font-size: 11px;
  text-transform: uppercase;
}

.fmCoreSection,
.fmLowerSections,
.fmModulePalette {
  border: 1px solid rgba(103, 255, 221, 0.18);
  background: rgba(1, 8, 10, 0.32);
  padding: 8px;
}

.fmSlotRow {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.fmDesignSlot {
  width: 92px;
  height: 60px;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(103, 255, 221, 0.28);
  background: rgba(5, 20, 22, 0.72);
  color: #e9fff8;
  font: inherit;
  cursor: pointer;
  padding: 5px;
}

.fmDesignSlot span {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid rgba(103, 255, 221, 0.34);
  color: #a9ffea;
  font-size: 9px;
  font-weight: 900;
}

.fmDesignSlot strong {
  min-width: 0;
  color: #eafff8;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fmDesignViewport {
  min-height: 180px;
  border: 1px solid rgba(103, 255, 221, 0.2);
  background: #000;
  box-shadow: inset 0 0 28px rgba(103, 255, 221, 0.08);
}

.fmLowerSections {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 116px;
  gap: 8px;
}

.fmModulePalette {
  min-height: 0;
  overflow: hidden;
}

.fmPaletteHeader {
  margin-bottom: 7px;
  color: #eafff8;
  font-size: 12px;
}

.fmPaletteList {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 3px;
}

.fmModuleButton {
  min-width: 132px;
  height: 58px;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  border: 1px solid rgba(103, 255, 221, 0.24);
  background: rgba(1, 8, 10, 0.42);
  color: #e9fff8;
  font: inherit;
  text-align: left;
  cursor: pointer;
  padding: 6px;
}

.fmModuleButton span {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(103, 255, 221, 0.34);
  color: #a9ffea;
  font-size: 9px;
  font-weight: 900;
}

.fmModuleButton strong {
  min-width: 0;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fmDesignStatsPane {
  overflow-y: auto;
}

.fmDesignStatGrid {
  grid-template-columns: 1fr;
}

.fmControlStack {
  display: grid;
  gap: 7px;
  margin-top: 10px;
}

.fmControlStack button {
  min-height: 34px;
  border: 1px solid rgba(103, 255, 221, 0.44);
  background: rgba(6, 42, 38, 0.72);
  color: #d8fff6;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.fmControlStack button:disabled {
  opacity: 0.38;
  cursor: default;
}

.fmTabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid rgba(103, 255, 221, 0.24);
}

.fmTabs button {
  border: 0;
  border-right: 1px solid rgba(103, 255, 221, 0.18);
  background: linear-gradient(135deg, rgba(22, 67, 58, 0.72), rgba(8, 19, 22, 0.94));
  color: rgba(228, 248, 242, 0.78);
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}

.fmTabs button.active {
  color: #ffffff;
  background: linear-gradient(135deg, rgba(39, 104, 88, 0.82), rgba(13, 39, 39, 0.96));
}

@media (max-width: 900px) {
  .fleetManagerPanel {
    width: calc(100vw - 16px);
  }

  .fmBody {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .fmDesignerBody {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .fmFleetList,
  .fmCompositionList,
  .fmBuildShipList {
    max-height: none;
  }
}
    `;
    document.head.appendChild(style);
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private escapeAttribute(value: unknown): string {
    return this.escapeHtml(value).replace(/'/g, "&#039;");
  }
}
