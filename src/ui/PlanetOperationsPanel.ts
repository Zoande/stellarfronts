import type { FactionInfo } from "../data/Factions";
import {
  RESOURCE_KINDS,
  RESOURCE_LABELS,
} from "../data/Economy";
import type {
  FactionEconomyState,
  ResourceKind,
} from "../data/Economy";
import {
  PLANET_TYPES,
} from "../data/StarMap";
import type { LeaderState } from "../data/Leaders";
import type { PlanetManagerPlanetEntry } from "../game/GameProtocol";
import {
  captureScrollState,
  PanelInteractionGate,
  restoreScrollStateSoon,
} from "./panelDomState";
import { requestOpenLeadersPanel } from "./leaderEvents";

export interface PlanetOperationsPanelData {
  planets: PlanetManagerPlanetEntry[];
  leaders: LeaderState[];
  factionEconomies: FactionEconomyState[];
  factions: FactionInfo[];
  playerFactionId: number | null;
  factionName?: string;
  onOpenPlanet?: (planetId: string) => void;
  onClose?: () => void;
}

type PlanetStatusFilter = "all" | "healthy" | "deficit";
type PlanetStabilityFilter = "all" | "stable" | "unstable" | "critical";
type PlanetLeaderFilter = "all" | "assigned" | "unassigned";

interface PlanetResourceMaxima {
  food: number;
  minerals: number;
  energy: number;
  goods: number;
  alloys: number;
  research: number;
}

interface PlaceholderRole {
  label: string;
  className: string;
}

const STYLE_ID = "planet-operations-panel-style";
const PLANET_OPERATIONS_SCROLL_SELECTORS = [".poTableViewport"] as const;

const RESOURCE_ICON_LABELS: Record<ResourceKind, string> = {
  food: "Food",
  minerals: "Minerals",
  energy: "Energy",
  goods: "Goods",
  alloys: "Alloys",
  research: "Research",
};

export class PlanetOperationsPanel {
  private root: HTMLDivElement;
  private panelElement: HTMLDivElement | null = null;
  private currentData: PlanetOperationsPanelData | null = null;
  private position = { x: 44, y: 76 };
  private dragOffset = { x: 0, y: 0 };
  private isDragging = false;
  private pendingRefreshData: PlanetOperationsPanelData | null = null;
  private pendingRefreshTimer: number | null = null;
  private statusFilter: PlanetStatusFilter = "all";
  private stabilityFilter: PlanetStabilityFilter = "all";
  private leaderFilter: PlanetLeaderFilter = "all";
  private searchTerm = "";
  private readonly interactionGate = new PanelInteractionGate();

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

  public show(data: PlanetOperationsPanelData): void {
    this.currentData = data;
    const scrollState = captureScrollState(this.panelElement, PLANET_OPERATIONS_SCROLL_SELECTORS);
    if (!this.panelElement) {
      this.panelElement = document.createElement("div");
      this.panelElement.className = "planetOperationsPanel";
      this.root.appendChild(this.panelElement);
    }
    this.interactionGate.bind(this.panelElement);

    const accent = data.playerFactionId !== null
      ? this.colorToCss(this.getFaction(data, data.playerFactionId)?.color, 0.95)
      : "rgba(74, 236, 214, 0.95)";
    this.panelElement.style.setProperty("--planet-accent", accent);
    this.panelElement.innerHTML = this.render(data);
    this.applyPosition();
    this.bindEvents(data);
    restoreScrollStateSoon(this.panelElement, scrollState);
  }

  public refresh(data: PlanetOperationsPanelData): void {
    if (!this.panelElement) return;
    this.currentData = data;
    if (this.shouldDeferRefresh()) {
      this.pendingRefreshData = data;
      this.schedulePendingRefresh();
      return;
    }
    this.show(data);
  }

  public close(): void {
    const onClose = this.currentData?.onClose;
    this.onPointerUp();
    this.clearPendingRefresh();
    this.interactionGate.clear();
    this.panelElement?.remove();
    this.panelElement = null;
    this.currentData = null;
    onClose?.();
  }

  public dispose(): void {
    this.close();
  }

  private render(data: PlanetOperationsPanelData): string {
    const visiblePlanets = this.getVisiblePlanets(data);
    const maxima = this.getResourceMaxima(visiblePlanets);
    const factionSubtitle = data.factionName ? `${data.factionName} Planet Command` : "Planet Command";
    return `
      <div class="poHeader" data-po-drag>
        <div class="poHeaderIcon">PL</div>
        <div class="poHeaderText">
          <div class="poTitle">Planet Operations</div>
          <div class="poSubtitle">${this.escapeHtml(factionSubtitle)}</div>
        </div>
        <button class="poClose" type="button" data-po-close aria-label="Close planet operations">X</button>
      </div>
      <section class="poBody">
        <div class="poSectionBar">
          <div class="poSectionTitle">
            <span class="poSectionIcon poSectionIcon-population" aria-hidden="true"></span>
            <strong>Habited Planets</strong>
          </div>
          <div class="poSectionMeta">
            <span>${visiblePlanets.length} / ${data.planets.length} planets</span>
            <span class="poListGlyph" aria-hidden="true"></span>
          </div>
        </div>
        <div class="poFilters">
          ${this.renderSelect("status", "Status", this.statusFilter, [
            ["all", "All"],
            ["healthy", "Healthy"],
            ["deficit", "Deficit"],
          ])}
          ${this.renderSelect("stability", "Stability", this.stabilityFilter, [
            ["all", "All"],
            ["stable", "Stable"],
            ["unstable", "Unstable"],
            ["critical", "Critical"],
          ])}
          ${this.renderSelect("type", "Type", "all", [["all", "All"]], true)}
          ${this.renderSelect("leader", "Leader", this.leaderFilter, [
            ["all", "All"],
            ["assigned", "Assigned"],
            ["unassigned", "Unassigned"],
          ])}
          <label class="poSearch">
            <input type="search" value="${this.escapeAttribute(this.searchTerm)}" placeholder="Search planets..." data-po-search aria-label="Search planets">
            <span class="poSearchIcon" aria-hidden="true"></span>
          </label>
        </div>
        <div class="poTableShell">
          <div class="poTableHeader">
            <div>Planet</div>
            ${RESOURCE_KINDS.map((resource) => `
              <div class="poMetricHead">
                ${this.renderStatIcon(resource)}
                <span>${this.escapeHtml(RESOURCE_LABELS[resource])}</span>
              </div>
            `).join("")}
            <div class="poMetricHead">${this.renderStatIcon("stability")}<span>Stability</span></div>
            <div class="poMetricHead">${this.renderStatIcon("population")}<span>Population</span></div>
            <div class="poMetricHead">${this.renderStatIcon("leader")}<span>Leader</span></div>
            <div>Actions</div>
          </div>
          <div class="poTableViewport">
            ${visiblePlanets.length
              ? visiblePlanets.map((entry) => this.renderPlanetRow(data, entry, maxima)).join("")
              : this.renderEmptyState(data)}
          </div>
        </div>
      </section>
      <nav class="poTabs">
        <button class="active" type="button">
          <span class="poSectionIcon poSectionIcon-population" aria-hidden="true"></span>
          Habited
        </button>
        <button class="disabled" type="button" disabled title="Uninhabited planet overview is not implemented yet.">
          <span class="poSectionIcon poSectionIcon-uninhabited" aria-hidden="true"></span>
          Uninhabited
        </button>
      </nav>
    `;
  }

  private renderSelect(
    key: "status" | "stability" | "type" | "leader",
    label: string,
    value: string,
    options: Array<[string, string]>,
    disabled = false,
  ): string {
    return `
      <label class="poFilter">
        <span>${this.escapeHtml(label)}</span>
        <select data-po-filter="${this.escapeAttribute(key)}" ${disabled ? "disabled title=\"Planet role filtering is placeholder.\"" : ""}>
          ${options.map(([optionValue, optionLabel]) => `
            <option value="${this.escapeAttribute(optionValue)}" ${optionValue === value ? "selected" : ""}>${this.escapeHtml(optionLabel)}</option>
          `).join("")}
        </select>
      </label>
    `;
  }

  private renderPlanetRow(
    data: PlanetOperationsPanelData,
    entry: PlanetManagerPlanetEntry,
    maxima: PlanetResourceMaxima,
  ): string {
    const leader = this.getAssignedLeader(data, entry.planetState.id);
    const stability = this.getStability(entry);
    const status = this.getStabilityStatus(stability);
    const populationRatio = this.getPopulationRatio(entry, data.planets);
    const role = this.getPlaceholderRole(entry);
    const canOpen = Boolean(data.onOpenPlanet);
    return `
      <article class="poPlanetRow" data-po-planet-row="${this.escapeAttribute(entry.planetState.id)}">
        <div class="poPlanetCell">
          <div class="poPlanetBadge">
            <div class="poPlanetPortrait" style="background-image: url('${this.escapeAttribute(this.getPlanetTextureUrl(entry))}')"></div>
            <span class="poPlanetOrbit" aria-hidden="true"></span>
          </div>
          <div class="poPlanetCopy">
            <strong>${this.escapeHtml(entry.planet.name)}</strong>
            <span>${this.escapeHtml(entry.planet.objectDetails.typeName || entry.planet.type)} | ${this.escapeHtml(entry.starName)}</span>
            <em class="poRoleChip ${role.className}">${this.escapeHtml(role.label)}</em>
          </div>
        </div>
        ${RESOURCE_KINDS.map((resource) => this.renderResourceCell(entry, resource, maxima[resource])).join("")}
        <div class="poStabilityCell">
          <span class="poStabilityRing ${status.className}" style="--po-stability: ${Math.max(0, Math.min(100, stability)) * 3.6}deg">
            <strong>${stability.toFixed(0)}%</strong>
          </span>
          <small>${this.escapeHtml(status.label)}</small>
        </div>
        <div class="poPopulationCell">
          <div class="poPopMain">
            ${this.renderStatIcon("population")}
            <strong>${this.escapeHtml(this.formatPeople(entry.planetState.population))}</strong>
          </div>
          <span class="poCellBar"><i style="width: ${populationRatio.toFixed(2)}%"></i></span>
        </div>
        <div class="poLeaderCell">
          ${this.renderLeaderButton(entry, leader)}
        </div>
        <div class="poActionCell">
          <button class="poOpenPlanet" type="button" ${canOpen ? `data-po-open-planet="${this.escapeAttribute(entry.planetState.id)}"` : "disabled"} aria-label="Open ${this.escapeAttribute(entry.planet.name)}">
            <span aria-hidden="true"></span>
          </button>
        </div>
      </article>
    `;
  }

  private renderResourceCell(entry: PlanetManagerPlanetEntry, resource: ResourceKind, maxValue: number): string {
    const economy = entry.planetState.economy;
    const value = economy.net[resource];
    const hasDeficit = economy.deficit[resource] > 0.0001 || value < -0.0001;
    const width = Math.max(9, Math.min(100, Math.abs(value) / Math.max(1, maxValue) * 100));
    return `
      <div class="poResourceCell ${hasDeficit ? "deficit" : "positive"}">
        <strong>${this.escapeHtml(this.formatSignedCompact(value))}</strong>
        ${hasDeficit ? `<small>${economy.deficit[resource] > 0.0001 ? "Deficit" : "Shortfall"}</small>` : "<small>&nbsp;</small>"}
        <span class="poCellBar"><i style="width: ${width.toFixed(2)}%"></i></span>
      </div>
    `;
  }

  private renderLeaderButton(entry: PlanetManagerPlanetEntry, leader: LeaderState | null): string {
    const targetId = entry.planetState.id;
    const label = leader ? `Level ${leader.level} Governor` : "No Governor";
    const name = leader?.name ?? "Assign Leader";
    const initials = leader ? this.getInitials(leader.name) : "+";
    const portraitStyle = leader?.portraitUrl ? ` style="background-image: url('${this.escapeAttribute(leader.portraitUrl)}')"` : "";
    return `
      <button class="poLeaderButton ${leader ? "assigned" : "empty"}" type="button" data-po-open-leaders="${this.escapeAttribute(targetId)}">
        <span class="poLeaderPortrait ${leader ? "hasImage" : ""}"${portraitStyle}>${leader ? `<i>${this.escapeHtml(initials)}</i>` : "<i>+</i>"}</span>
        <span class="poLeaderCopy">
          <small>${this.escapeHtml(label)}</small>
          <strong>${this.escapeHtml(name)}</strong>
        </span>
      </button>
    `;
  }

  private renderEmptyState(data: PlanetOperationsPanelData): string {
    const message = data.planets.length === 0
      ? "No owned habited planets."
      : "No planets match the current filters.";
    return `
      <div class="poEmpty">
        <span class="poSectionIcon poSectionIcon-uninhabited" aria-hidden="true"></span>
        <strong>${this.escapeHtml(message)}</strong>
      </div>
    `;
  }

  private bindEvents(data: PlanetOperationsPanelData): void {
    if (!this.panelElement) return;

    this.panelElement.querySelector<HTMLButtonElement>("[data-po-close]")?.addEventListener("click", () => this.close());
    this.panelElement.querySelector<HTMLElement>("[data-po-drag]")?.addEventListener("pointerdown", (ev) => {
      if (!this.panelElement || ev.target instanceof HTMLElement && ev.target.closest("button, input, select")) return;
      ev.preventDefault();
      const rect = this.panelElement.getBoundingClientRect();
      this.dragOffset.x = ev.clientX - rect.left;
      this.dragOffset.y = ev.clientY - rect.top;
      this.isDragging = true;
      window.addEventListener("pointermove", this.onPointerMove);
      window.addEventListener("pointerup", this.onPointerUp);
    });

    this.panelElement.querySelectorAll<HTMLSelectElement>("[data-po-filter]").forEach((select) => {
      select.addEventListener("change", () => {
        const key = select.dataset.poFilter;
        if (key === "status") this.statusFilter = select.value as PlanetStatusFilter;
        if (key === "stability") this.stabilityFilter = select.value as PlanetStabilityFilter;
        if (key === "leader") this.leaderFilter = select.value as PlanetLeaderFilter;
        this.show(data);
      });
    });

    this.panelElement.querySelector<HTMLInputElement>("[data-po-search]")?.addEventListener("input", (ev) => {
      this.searchTerm = (ev.currentTarget as HTMLInputElement).value;
      this.show(data);
      this.panelElement?.querySelector<HTMLInputElement>("[data-po-search]")?.focus();
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-po-open-leaders]").forEach((button) => {
      button.addEventListener("click", () => {
        const planetId = button.dataset.poOpenLeaders;
        const entry = planetId ? data.planets.find((candidate) => candidate.planetState.id === planetId) : null;
        if (!entry) return;
        requestOpenLeadersPanel({
          assignmentTarget: {
            kind: "planet",
            targetId: entry.planetState.id,
            label: entry.planet.name,
            requiredClass: "civilian",
          },
        });
      });
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-po-open-planet]").forEach((button) => {
      button.addEventListener("click", () => {
        const planetId = button.dataset.poOpenPlanet;
        if (!planetId) return;
        data.onOpenPlanet?.(planetId);
      });
    });
  }

  private getVisiblePlanets(data: PlanetOperationsPanelData): PlanetManagerPlanetEntry[] {
    const term = this.searchTerm.trim().toLowerCase();
    return data.planets
      .filter((entry) => {
        if (!entry.planetState.isHabited) return false;
        if (this.statusFilter === "healthy" && this.hasResourceDeficit(entry)) return false;
        if (this.statusFilter === "deficit" && !this.hasResourceDeficit(entry)) return false;

        const stability = this.getStability(entry);
        if (this.stabilityFilter === "stable" && stability < 70) return false;
        if (this.stabilityFilter === "unstable" && (stability < 45 || stability >= 70)) return false;
        if (this.stabilityFilter === "critical" && stability >= 45) return false;

        const leader = this.getAssignedLeader(data, entry.planetState.id);
        if (this.leaderFilter === "assigned" && !leader) return false;
        if (this.leaderFilter === "unassigned" && leader) return false;

        if (!term) return true;
        return [
          entry.planet.name,
          entry.starName,
          entry.planet.type,
          entry.planet.objectDetails.typeName,
          this.getPlaceholderRole(entry).label,
          leader?.name ?? "",
        ].some((value) => value.toLowerCase().includes(term));
      })
      .sort((a, b) => a.planet.name.localeCompare(b.planet.name));
  }

  private getResourceMaxima(planets: PlanetManagerPlanetEntry[]): PlanetResourceMaxima {
    const maxima = RESOURCE_KINDS.reduce((next, resource) => {
      next[resource] = 1;
      return next;
    }, {} as PlanetResourceMaxima);
    for (const entry of planets) {
      for (const resource of RESOURCE_KINDS) {
        maxima[resource] = Math.max(maxima[resource], Math.abs(entry.planetState.economy.net[resource]));
      }
    }
    return maxima;
  }

  private hasResourceDeficit(entry: PlanetManagerPlanetEntry): boolean {
    return RESOURCE_KINDS.some((resource) => (
      entry.planetState.economy.deficit[resource] > 0.0001
      || entry.planetState.economy.net[resource] < -0.0001
    ));
  }

  private getStability(entry: PlanetManagerPlanetEntry): number {
    return Number.isFinite(entry.planetState.economy.stability) ? entry.planetState.economy.stability : 0;
  }

  private getStabilityStatus(value: number): { label: string; className: string } {
    if (value >= 70) return { label: "Stable", className: "stable" };
    if (value >= 45) return { label: "Unstable", className: "unstable" };
    return { label: "Critical", className: "critical" };
  }

  private getPopulationRatio(entry: PlanetManagerPlanetEntry, planets: PlanetManagerPlanetEntry[]): number {
    const maxPopulation = Math.max(1, ...planets.map((candidate) => candidate.planetState.population));
    return Math.max(7, Math.min(100, entry.planetState.population / maxPopulation * 100));
  }

  private getPlaceholderRole(entry: PlanetManagerPlanetEntry): PlaceholderRole {
    if (entry.planetState.features.includes("homePlanet")) {
      return { label: "Capital", className: "capital" };
    }

    const net = entry.planetState.economy.net;
    const industry = net.goods + net.alloys;
    if (industry >= Math.max(net.food, net.minerals, net.energy, net.research)) {
      return { label: "Industrial", className: "industrial" };
    }
    if (net.food >= Math.max(net.minerals, net.energy, net.research)) {
      return { label: "Agricultural", className: "agricultural" };
    }
    if (net.research > Math.max(net.food, net.minerals, net.energy)) {
      return { label: "Research", className: "research" };
    }
    return { label: "Frontier", className: "frontier" };
  }

  private getAssignedLeader(data: PlanetOperationsPanelData, planetId: string): LeaderState | null {
    return data.leaders.find((leader) => (
      leader.status === "recruited"
      && leader.assignment?.kind === "planet"
      && leader.assignment.targetId === planetId
    )) ?? null;
  }

  private getPlanetTextureUrl(entry: PlanetManagerPlanetEntry): string {
    const cfg = PLANET_TYPES[entry.planet.type];
    const variation = String(entry.planet.textureVariation + 1).padStart(2, "0");
    return `${cfg.texturePrefix}_${variation}-1024x512.webp`;
  }

  private getFaction(data: PlanetOperationsPanelData, ownerId: number): FactionInfo | null {
    return data.factions.find((faction) => faction.id === ownerId) ?? null;
  }

  private shouldDeferRefresh(): boolean {
    return this.isDragging || this.interactionGate.isBusy(this.panelElement);
  }

  private schedulePendingRefresh(delayMs = 120): void {
    if (this.pendingRefreshTimer !== null) return;
    this.pendingRefreshTimer = window.setTimeout(() => {
      this.pendingRefreshTimer = null;
      if (!this.pendingRefreshData || !this.panelElement) return;
      if (this.shouldDeferRefresh()) {
        this.schedulePendingRefresh();
        return;
      }
      const data = this.pendingRefreshData;
      this.pendingRefreshData = null;
      this.show(data);
    }, delayMs);
  }

  private clearPendingRefresh(): void {
    if (this.pendingRefreshTimer !== null) {
      window.clearTimeout(this.pendingRefreshTimer);
      this.pendingRefreshTimer = null;
    }
    this.pendingRefreshData = null;
  }

  private applyPosition(): void {
    if (!this.panelElement) return;
    this.panelElement.style.left = `${this.position.x}px`;
    this.panelElement.style.top = `${this.position.y}px`;
  }

  private renderStatIcon(icon: ResourceKind | "stability" | "population" | "leader"): string {
    return `<span class="poStatIcon poStatIcon-${this.escapeAttribute(icon)}" title="${this.escapeAttribute(RESOURCE_ICON_LABELS[icon as ResourceKind] ?? icon)}" aria-hidden="true"></span>`;
  }

  private formatSignedCompact(value: number): string {
    const sign = value >= 0 ? "+" : "-";
    return `${sign}${this.formatCompact(Math.abs(value))}`;
  }

  private formatCompact(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) return `${(abs / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}B`;
    if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
    if (abs >= 1_000) return `${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
    return abs.toFixed(abs >= 10 ? 0 : 1);
  }

  private formatPeople(value: number): string {
    return this.formatCompact(value);
  }

  private getInitials(name: string): string {
    return name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  private colorToCss(color: [number, number, number] | undefined, alpha: number): string {
    if (!color) return `rgba(74, 236, 214, ${alpha})`;
    const r = Math.round(Math.max(0, Math.min(1, color[0])) * 255);
    const g = Math.round(Math.max(0, Math.min(1, color[1])) * 255);
    const b = Math.round(Math.max(0, Math.min(1, color[2])) * 255);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private escapeHtml(value: unknown): string {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private escapeAttribute(value: unknown): string {
    return this.escapeHtml(value);
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.planetOperationsPanel {
  --planet-accent: rgba(74, 236, 214, 0.95);
  --planet-panel-scale: 0.84;
  position: fixed;
  z-index: 59;
  width: min(1228px, calc(100vw - 32px));
  height: min(676px, calc(100vh - 32px));
  transform: scale(var(--planet-panel-scale));
  transform-origin: top left;
  pointer-events: auto;
  display: grid;
  grid-template-rows: 66px minmax(0, 1fr) 52px;
  overflow: hidden;
  color: #e9fff9;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
  background:
    radial-gradient(circle at 25% 0%, color-mix(in srgb, var(--planet-accent) 13%, transparent), transparent 17rem),
    linear-gradient(180deg, rgba(4, 27, 30, 0.98), rgba(1, 11, 14, 0.99));
  border: 1px solid color-mix(in srgb, var(--planet-accent) 76%, transparent);
  box-shadow: 0 28px 82px rgba(0, 0, 0, 0.58), inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  user-select: none;
}

.planetOperationsPanel::before,
.planetOperationsPanel::after {
  content: "";
  position: absolute;
  z-index: 5;
  pointer-events: none;
}

.planetOperationsPanel::before {
  inset: 0;
  border: 1px solid rgba(62, 255, 226, 0.12);
  clip-path: polygon(0 24px, 24px 0, 36% 0, 37% 6px, 64% 6px, 65% 0, calc(100% - 24px) 0, 100% 24px, 100% 100%, 0 100%);
}

.planetOperationsPanel::after {
  left: 14px;
  right: 14px;
  top: 62px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(72, 255, 230, 0.72), transparent);
}

.poHeader {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 14px 8px;
  cursor: grab;
  background:
    radial-gradient(circle at 23% -20%, color-mix(in srgb, var(--planet-accent) 20%, transparent), transparent 13rem),
    linear-gradient(90deg, rgba(7, 52, 55, 0.9), rgba(4, 19, 24, 0.95));
  border-bottom: 1px solid rgba(87, 250, 223, 0.27);
}

.poHeaderIcon {
  width: 39px;
  height: 39px;
  display: grid;
  place-items: center;
  clip-path: polygon(50% 0, 94% 25%, 94% 75%, 50% 100%, 6% 75%, 6% 25%);
  background: linear-gradient(135deg, #ff6bd6, #7b58ff);
  color: #140018;
  font-weight: 950;
  font-size: 12px;
  box-shadow: 0 0 18px rgba(255, 105, 214, 0.34), inset 0 0 0 2px rgba(7, 0, 18, 0.46);
}

.poHeaderText {
  min-width: 0;
}

.poTitle {
  color: #eafff8;
  font-size: 22px;
  font-weight: 950;
  letter-spacing: 0;
  line-height: 1.1;
}

.poSubtitle {
  margin-top: 3px;
  color: rgba(204, 236, 229, 0.7);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.poClose {
  margin-left: auto;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(98, 255, 228, 0.56);
  background: rgba(6, 43, 43, 0.72);
  color: #bffff4;
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}

.poClose:hover {
  color: #ffffff;
  border-color: rgba(141, 255, 236, 0.9);
  background: rgba(10, 65, 61, 0.84);
}

.poBody {
  min-height: 0;
  display: grid;
  grid-template-rows: 46px 50px minmax(0, 1fr);
  padding: 8px 12px 0;
}

.poSectionBar {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 10px;
  border: 1px solid rgba(76, 223, 197, 0.25);
  border-bottom: none;
  background: linear-gradient(90deg, rgba(8, 54, 53, 0.7), rgba(2, 22, 25, 0.74));
}

.poSectionTitle,
.poSectionMeta {
  display: flex;
  align-items: center;
  gap: 9px;
}

.poSectionTitle strong {
  color: #dffff7;
  font-size: 13px;
  font-weight: 950;
  text-transform: uppercase;
}

.poSectionMeta {
  color: rgba(204, 236, 229, 0.74);
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.poFilters {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(150px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr) minmax(210px, 1.16fr);
  gap: 12px;
  align-items: center;
  padding: 7px 10px 10px;
  border: 1px solid rgba(76, 223, 197, 0.25);
  border-top-color: rgba(76, 223, 197, 0.16);
  background: rgba(2, 20, 23, 0.62);
}

.poFilter,
.poSearch {
  min-width: 0;
  height: 32px;
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr);
  align-items: center;
  border: 1px solid rgba(74, 219, 201, 0.25);
  background: rgba(0, 14, 18, 0.62);
}

.poFilter span {
  display: grid;
  place-items: center;
  height: 100%;
  color: rgba(197, 229, 222, 0.66);
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
  border-right: 1px solid rgba(74, 219, 201, 0.22);
}

.poFilter select,
.poSearch input {
  min-width: 0;
  width: 100%;
  height: 100%;
  border: 0;
  outline: none;
  background: transparent;
  color: #eafff8;
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  padding: 0 9px;
}

.poFilter select {
  appearance: none;
  background:
    linear-gradient(45deg, transparent 50%, #44f2dc 50%) right 11px center / 7px 7px no-repeat,
    linear-gradient(135deg, #44f2dc 50%, transparent 50%) right 6px center / 7px 7px no-repeat;
}

.poFilter select:disabled {
  opacity: 0.68;
  color: rgba(206, 232, 226, 0.62);
}

.poSearch {
  grid-template-columns: minmax(0, 1fr) 36px;
}

.poSearch input::placeholder {
  color: rgba(190, 225, 216, 0.45);
}

.poSearchIcon,
.poListGlyph {
  position: relative;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
}

.poSearchIcon::before {
  content: "";
  width: 11px;
  height: 11px;
  border: 2px solid #29e7e6;
  border-radius: 50%;
}

.poSearchIcon::after {
  content: "";
  position: absolute;
  width: 8px;
  height: 2px;
  right: 2px;
  bottom: 3px;
  background: #29e7e6;
  transform: rotate(45deg);
}

.poListGlyph::before {
  content: "";
  width: 4px;
  height: 4px;
  background: #29e7e6;
  box-shadow: 0 7px 0 #29e7e6, 0 14px 0 #29e7e6, 8px 0 0 #29e7e6, 8px 7px 0 #29e7e6, 8px 14px 0 #29e7e6;
}

.poTableShell {
  min-height: 0;
  display: grid;
  grid-template-rows: 38px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(76, 223, 197, 0.26);
  background:
    linear-gradient(180deg, rgba(4, 27, 29, 0.94), rgba(2, 14, 18, 0.96)),
    repeating-linear-gradient(90deg, rgba(75, 255, 231, 0.05) 0 1px, transparent 1px 104px);
}

.poTableHeader,
.poPlanetRow {
  min-width: 1180px;
  display: grid;
  grid-template-columns: minmax(210px, 1.45fr) repeat(6, minmax(92px, 0.7fr)) 100px 112px 156px 64px;
}

.poTableHeader {
  height: 38px;
  align-items: center;
  border-bottom: 1px solid rgba(76, 223, 197, 0.22);
  background: rgba(3, 22, 25, 0.8);
  color: rgba(202, 233, 226, 0.72);
  font-size: 9px;
  font-weight: 950;
  text-transform: uppercase;
}

.poTableHeader > div {
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  border-right: 1px solid rgba(76, 223, 197, 0.18);
}

.poMetricHead {
  justify-content: center;
}

.poTableViewport {
  min-height: 0;
  height: 100%;
  max-height: 100%;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(72, 238, 217, 0.58) rgba(0, 0, 0, 0.26);
}

.poPlanetRow {
  min-height: 94px;
  border-bottom: 1px solid rgba(65, 213, 194, 0.22);
  background:
    linear-gradient(90deg, rgba(7, 53, 49, 0.68), rgba(3, 18, 22, 0.83)),
    linear-gradient(180deg, rgba(98, 255, 229, 0.025), transparent);
}

.poPlanetRow:nth-child(even) {
  background:
    linear-gradient(90deg, rgba(5, 44, 43, 0.7), rgba(3, 18, 22, 0.88)),
    linear-gradient(180deg, rgba(98, 255, 229, 0.018), transparent);
}

.poPlanetRow:hover {
  background:
    radial-gradient(circle at 8% 50%, color-mix(in srgb, var(--planet-accent) 16%, transparent), transparent 13rem),
    linear-gradient(90deg, rgba(8, 64, 59, 0.78), rgba(3, 22, 25, 0.9));
}

.poPlanetRow > div {
  min-width: 0;
  border-right: 1px solid rgba(65, 213, 194, 0.22);
}

.poPlanetCell {
  min-width: 0;
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 8px 9px;
}

.poPlanetBadge {
  position: relative;
  width: 62px;
  height: 70px;
  display: grid;
  place-items: center;
}

.poPlanetBadge::before {
  content: "";
  position: absolute;
  inset: 0;
  clip-path: polygon(50% 0, 94% 23%, 94% 77%, 50% 100%, 6% 77%, 6% 23%);
  border: 1px solid rgba(52, 231, 225, 0.74);
  background: rgba(4, 40, 43, 0.48);
}

.poPlanetPortrait {
  position: relative;
  z-index: 1;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background-size: 170% 100%;
  background-position: center;
  box-shadow: inset -9px -8px 16px rgba(0, 0, 0, 0.62), 0 0 18px rgba(54, 238, 230, 0.28);
}

.poPlanetOrbit {
  position: absolute;
  right: 2px;
  bottom: 1px;
  z-index: 2;
  width: 19px;
  height: 19px;
  border-radius: 50%;
  border: 1px solid rgba(42, 238, 224, 0.76);
  background: rgba(3, 28, 31, 0.9);
}

.poPlanetOrbit::before {
  content: "";
  position: absolute;
  left: 8px;
  top: 3px;
  width: 2px;
  height: 11px;
  background: #35f2e5;
  box-shadow: -4px 4px 0 -1px #35f2e5, 4px -4px 0 -1px #35f2e5;
}

.poPlanetCopy {
  min-width: 0;
  display: grid;
  gap: 3px;
  align-content: center;
}

.poPlanetCopy strong {
  min-width: 0;
  color: #eefefa;
  font-size: 16px;
  font-weight: 950;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.poPlanetCopy span {
  min-width: 0;
  color: rgba(204, 232, 226, 0.68);
  font-size: 10px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.poRoleChip {
  justify-self: start;
  max-width: 100%;
  min-height: 19px;
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border: 1px solid currentColor;
  color: #59f2df;
  background: rgba(10, 55, 54, 0.48);
  font-style: normal;
  font-size: 9px;
  font-weight: 950;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.poRoleChip.capital { color: #43e5ff; }
.poRoleChip.industrial { color: #ffe04f; }
.poRoleChip.agricultural { color: #65ff99; }
.poRoleChip.research { color: #bc8cff; }
.poRoleChip.frontier { color: #b997ff; }

.poResourceCell,
.poStabilityCell,
.poPopulationCell,
.poLeaderCell,
.poActionCell {
  min-width: 0;
  display: grid;
  align-content: center;
  justify-items: center;
  padding: 8px 10px;
}

.poResourceCell {
  gap: 3px;
}

.poResourceCell strong {
  color: #eafff8;
  font-size: 16px;
  font-weight: 950;
}

.poResourceCell small {
  min-height: 12px;
  color: #ff625e;
  font-size: 9px;
  font-weight: 900;
}

.poResourceCell.deficit strong,
.poResourceCell.deficit .poCellBar i {
  color: #ff5e5a;
  background: #ff5e5a;
}

.poResourceCell.positive .poCellBar i,
.poPopulationCell .poCellBar i {
  background: #25f0f4;
}

.poCellBar {
  width: 70px;
  height: 5px;
  display: block;
  overflow: hidden;
  background: rgba(54, 230, 221, 0.16);
  box-shadow: inset 0 0 0 1px rgba(54, 230, 221, 0.06);
}

.poCellBar i {
  display: block;
  width: 0;
  height: 100%;
  box-shadow: 0 0 10px currentColor;
}

.poStabilityCell {
  gap: 4px;
}

.poStabilityRing {
  --po-ring-color: #78ff73;
  width: 58px;
  height: 58px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background:
    radial-gradient(circle at center, rgba(3, 22, 26, 0.96) 0 56%, transparent 57%),
    conic-gradient(var(--po-ring-color) var(--po-stability), rgba(90, 118, 112, 0.35) 0);
  box-shadow: 0 0 16px color-mix(in srgb, var(--po-ring-color) 22%, transparent);
}

.poStabilityRing strong {
  color: #eefefa;
  font-size: 15px;
  font-weight: 950;
}

.poStabilityCell small {
  color: var(--po-ring-color);
  font-size: 10px;
  font-weight: 900;
}

.poStabilityRing.unstable { --po-ring-color: #ffbf32; }
.poStabilityRing.critical { --po-ring-color: #ff625e; }

.poPopulationCell {
  gap: 7px;
}

.poPopMain {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #34f2f5;
}

.poPopMain strong {
  color: #eafff8;
  font-size: 16px;
  font-weight: 950;
}

.poLeaderCell {
  padding: 7px;
}

.poLeaderButton {
  min-width: 0;
  width: 100%;
  height: 66px;
  display: grid;
  grid-template-columns: 50px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border: 1px solid rgba(64, 233, 211, 0.36);
  background: rgba(5, 32, 34, 0.76);
  color: #eafff8;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.poLeaderButton:hover {
  border-color: rgba(104, 255, 231, 0.8);
  background: rgba(7, 48, 48, 0.86);
}

.poLeaderButton.empty {
  border-style: dashed;
  color: rgba(209, 240, 234, 0.66);
}

.poLeaderPortrait {
  position: relative;
  width: 44px;
  height: 54px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid rgba(97, 255, 229, 0.46);
  background-size: cover;
  background-position: center;
}

.poLeaderPortrait::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 23%, rgba(240, 255, 252, 0.2), transparent 26%),
    linear-gradient(145deg, rgba(64, 118, 106, 0.9), rgba(17, 31, 35, 0.95));
}

.poLeaderPortrait.hasImage::before {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(0, 0, 0, 0.18));
}

.poLeaderPortrait i {
  position: relative;
  z-index: 1;
  color: rgba(238, 255, 250, 0.88);
  font-style: normal;
  font-size: 13px;
  font-weight: 950;
}

.poLeaderCopy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.poLeaderCopy small,
.poLeaderCopy strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.poLeaderCopy small {
  color: rgba(205, 235, 229, 0.64);
  font-size: 9px;
  font-weight: 800;
}

.poLeaderCopy strong {
  color: #eafff8;
  font-size: 11px;
  font-weight: 950;
}

.poActionCell {
  padding: 0;
}

.poOpenPlanet {
  width: 54px;
  height: 100%;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: #42eaf3;
  cursor: pointer;
}

.poOpenPlanet span {
  width: 16px;
  height: 16px;
  border-top: 4px solid currentColor;
  border-right: 4px solid currentColor;
  transform: rotate(45deg);
  filter: drop-shadow(0 0 8px rgba(66, 234, 243, 0.35));
}

.poOpenPlanet:hover {
  color: #ffffff;
  background: rgba(48, 235, 231, 0.08);
}

.poOpenPlanet:disabled {
  opacity: 0.38;
  cursor: default;
}

.poEmpty {
  min-width: 1180px;
  min-height: 220px;
  display: grid;
  place-items: center;
  gap: 10px;
  color: rgba(211, 240, 235, 0.62);
}

.poEmpty strong {
  font-size: 14px;
}

.poTabs {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  padding: 8px 0 0;
}

.poTabs button {
  min-width: 0;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border: 1px solid rgba(76, 223, 197, 0.32);
  background: rgba(3, 26, 29, 0.72);
  color: rgba(205, 236, 230, 0.72);
  font: inherit;
  font-size: 13px;
  font-weight: 950;
  cursor: pointer;
}

.poTabs button.active {
  color: #eafff8;
  border-color: rgba(71, 241, 220, 0.76);
  background:
    radial-gradient(circle at 50% 100%, color-mix(in srgb, var(--planet-accent) 24%, transparent), transparent 13rem),
    rgba(7, 56, 55, 0.82);
}

.poTabs button.disabled {
  opacity: 0.42;
  cursor: default;
}

.poSectionIcon,
.poStatIcon {
  position: relative;
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  color: #3df2e4;
  filter: drop-shadow(0 0 7px rgba(50, 255, 225, 0.18));
}

.poSectionIcon::before,
.poSectionIcon::after,
.poStatIcon::before,
.poStatIcon::after {
  content: "";
  position: absolute;
  box-sizing: border-box;
}

.poSectionIcon-population::before,
.poStatIcon-population::before {
  top: 3px;
  left: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 8px 1px 0 currentColor;
}

.poSectionIcon-population::after,
.poStatIcon-population::after {
  bottom: 4px;
  left: 2px;
  width: 18px;
  height: 9px;
  border-radius: 10px 10px 3px 3px;
  background: currentColor;
  opacity: 0.84;
}

.poSectionIcon-uninhabited::before {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid currentColor;
  opacity: 0.55;
}

.poSectionIcon-uninhabited::after {
  width: 24px;
  height: 8px;
  border-top: 2px solid currentColor;
  transform: rotate(-20deg);
  opacity: 0.62;
}

.poStatIcon-food::before {
  width: 13px;
  height: 18px;
  border-radius: 100% 0 100% 0;
  background: currentColor;
  transform: rotate(35deg);
}

.poStatIcon-food::after {
  left: 9px;
  top: 4px;
  width: 2px;
  height: 13px;
  background: rgba(2, 12, 15, 0.56);
  transform: rotate(35deg);
}

.poStatIcon-energy::before {
  width: 14px;
  height: 19px;
  background: currentColor;
  clip-path: polygon(58% 0, 100% 0, 68% 38%, 100% 38%, 28% 100%, 44% 54%, 4% 54%);
}

.poStatIcon-minerals::before {
  width: 17px;
  height: 18px;
  background: currentColor;
  clip-path: polygon(50% 0, 94% 28%, 76% 100%, 24% 100%, 6% 28%);
}

.poStatIcon-minerals::after {
  top: 4px;
  left: 9px;
  width: 2px;
  height: 13px;
  background: rgba(2, 12, 15, 0.46);
}

.poStatIcon-goods::before {
  width: 17px;
  height: 15px;
  border: 2px solid currentColor;
  background: rgba(114, 226, 255, 0.1);
}

.poStatIcon-goods::after {
  top: 3px;
  left: 9px;
  width: 2px;
  height: 15px;
  background: currentColor;
}

.poStatIcon-alloys::before {
  width: 17px;
  height: 5px;
  background: currentColor;
  box-shadow: 0 -6px 0 currentColor, 0 6px 0 currentColor;
  transform: skewX(-18deg);
}

.poStatIcon-research::before {
  width: 18px;
  height: 10px;
  border: 2px solid currentColor;
  border-radius: 50%;
  transform: rotate(38deg);
}

.poStatIcon-research::after {
  width: 18px;
  height: 10px;
  border: 2px solid currentColor;
  border-radius: 50%;
  transform: rotate(-38deg);
}

.poStatIcon-stability::before {
  width: 15px;
  height: 19px;
  background: currentColor;
  clip-path: polygon(50% 0, 88% 15%, 80% 70%, 50% 100%, 20% 70%, 12% 15%);
}

.poStatIcon-leader::before {
  top: 2px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.poStatIcon-leader::after {
  bottom: 2px;
  width: 17px;
  height: 10px;
  border-radius: 9px 9px 2px 2px;
  background: currentColor;
  opacity: 0.82;
}

@media (max-width: 980px) {
  .planetOperationsPanel {
    --planet-panel-scale: 0.72;
  }

  .poFilters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
`;
    document.head.appendChild(style);
  }
}
