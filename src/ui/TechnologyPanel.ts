import {
  BUILDING_LABELS,
  JOB_LABELS,
  RESOURCE_LABELS,
} from "../data/Economy";
import {
  STARBASE_BUILDING_DEFINITIONS,
} from "../data/Starbase";
import {
  getShipModuleDefinition,
  getShipSectionModuleDefinition,
  SHIP_HULL_DEFINITIONS,
} from "../data/ShipDesigns";
import {
  TECHNOLOGY_BY_ID,
  TECHNOLOGY_DEFINITIONS,
} from "../data/Technology";
import type {
  FactionTechnologyView,
  TechnologyDefinition,
  TechnologyEffect,
  TechnologyStatusView,
  TechId,
} from "../data/Technology";
import type { ClientCommand } from "../game/GameProtocol";
import { PanelInteractionGate, captureScrollState, restoreScrollStateSoon } from "./panelDomState";

export interface TechnologyPanelData {
  technology: FactionTechnologyView | null;
  factionName?: string;
  onTechnologyCommand?: (command: ClientCommand) => void;
  onClose?: () => void;
}

const STYLE_ID = "technology-panel-style";
const TECHNOLOGY_SCROLL_SELECTORS = [
  ".techTreeViewport",
  ".techDetailBody",
] as const;

const NODE_WIDTH = 250;
const NODE_HEIGHT = 112;
const COLUMN_GAP = 340;
const ROW_GAP = 154;
const TREE_PADDING_X = 52;
const TREE_PADDING_Y = 40;
const NODE_MIN_VERTICAL_GAP = 34;

const CATEGORY_LABELS: Record<string, string> = {
  agriculture: "Agriculture",
  industry: "Industry",
  military: "Military",
  logistics: "Logistics",
  energy: "Energy",
  computing: "Computing",
  society: "Society",
  sensors: "Sensors",
};

export class TechnologyPanel {
  private root: HTMLDivElement;
  private panelElement: HTMLDivElement | null = null;
  private currentData: TechnologyPanelData | null = null;
  private selectedTechId: TechId | null = null;
  private techTreeZoom = 0.82;
  private position = { x: 62, y: 74 };
  private dragOffset = { x: 0, y: 0 };
  private isDragging = false;
  private pendingRefreshData: TechnologyPanelData | null = null;
  private pendingRefreshTimer: number | null = null;
  private readonly interactionGate = new PanelInteractionGate();

  private readonly onPointerMove = (ev: PointerEvent): void => {
    if (!this.isDragging || !this.panelElement) return;
    ev.preventDefault();
    this.position.x = ev.clientX - this.dragOffset.x;
    this.position.y = ev.clientY - this.dragOffset.y;
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

  public show(data: TechnologyPanelData): void {
    this.currentData = data;
    const isNewPanel = !this.panelElement;
    if (isNewPanel) this.selectedTechId = null;
    this.ensureSelectedTech(data);
    const scrollState = captureScrollState(this.panelElement, TECHNOLOGY_SCROLL_SELECTORS);
    if (!this.panelElement) {
      this.panelElement = document.createElement("div");
      this.panelElement.className = "technologyPanel";
      this.root.appendChild(this.panelElement);
    }
    this.interactionGate.bind(this.panelElement);
    this.panelElement.innerHTML = this.render(data);
    this.applyPosition();
    this.bindEvents(data);
    restoreScrollStateSoon(this.panelElement, scrollState);
  }

  public refresh(data: TechnologyPanelData): void {
    if (!this.panelElement) return;
    this.currentData = data;
    if (this.shouldDeferRefresh()) {
      this.pendingRefreshData = data;
      this.schedulePendingRefresh();
      return;
    }
    this.show(data);
  }

  public toggle(data: TechnologyPanelData): void {
    if (this.panelElement) {
      this.close();
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

  private ensureSelectedTech(data: TechnologyPanelData): void {
    const view = data.technology;
    if (!view) {
      this.selectedTechId = null;
      return;
    }
    if (!this.selectedTechId) return;
    const ids = new Set(view.technologies.map((status) => status.id));
    if (!ids.has(this.selectedTechId)) this.selectedTechId = null;
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

  private bindEvents(data: TechnologyPanelData): void {
    if (!this.panelElement) return;
    this.panelElement.querySelector<HTMLButtonElement>("[data-tech-close]")?.addEventListener("click", () => this.close());
    this.panelElement.querySelector<HTMLElement>("[data-tech-drag]")?.addEventListener("pointerdown", (ev) => {
      if (!this.panelElement) return;
      if ((ev.target as HTMLElement).closest("button")) return;
      ev.preventDefault();
      const rect = this.panelElement.getBoundingClientRect();
      this.dragOffset.x = ev.clientX - rect.left;
      this.dragOffset.y = ev.clientY - rect.top;
      this.isDragging = true;
      window.addEventListener("pointermove", this.onPointerMove);
      window.addEventListener("pointerup", this.onPointerUp);
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-tech-node]").forEach((button) => {
      button.addEventListener("click", () => {
        const techId = button.dataset.techNode;
        if (!techId) return;
        this.selectedTechId = this.selectedTechId === techId ? null : techId;
        this.show(data);
      });
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-tech-research]")?.addEventListener("click", () => {
      if (!this.selectedTechId) return;
      data.onTechnologyCommand?.({ type: "setActiveTechnology", techId: this.selectedTechId });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-tech-zoom]").forEach((button) => {
      button.addEventListener("click", () => {
        this.adjustTreeZoom(button.dataset.techZoom ?? "reset");
        this.show(data);
      });
    });
  }

  private adjustTreeZoom(action: string): void {
    if (action === "reset") {
      this.techTreeZoom = 0.82;
      return;
    }
    const delta = action === "in" ? 0.1 : -0.1;
    this.techTreeZoom = Math.max(0.58, Math.min(1.25, Number((this.techTreeZoom + delta).toFixed(2))));
  }

  private applyPosition(): void {
    if (!this.panelElement) return;
    const rect = this.panelElement.getBoundingClientRect();
    const maxX = Math.max(8, window.innerWidth - rect.width - 8);
    const maxY = Math.max(8, window.innerHeight - rect.height - 8);
    this.position.x = Math.max(8, Math.min(maxX, this.position.x));
    this.position.y = Math.max(8, Math.min(maxY, this.position.y));
    this.panelElement.style.left = `${this.position.x}px`;
    this.panelElement.style.top = `${this.position.y}px`;
  }

  private render(data: TechnologyPanelData): string {
    const view = data.technology;
    if (!view) {
      return `
        <div class="techHeader" data-tech-drag>
          <div class="techHeaderIcon">TC</div>
          <div>
            <div class="techTitle">Technology</div>
            <div class="techSubtitle">${this.escapeHtml(data.factionName ?? "No faction selected")}</div>
          </div>
          <button class="techClose" type="button" data-tech-close aria-label="Close technology panel">X</button>
        </div>
        <section class="techUnavailable">Technology telemetry is unavailable for the current perspective.</section>
      `;
    }

    const selected = this.getStatus(view, this.selectedTechId);
    const activeTech = view.activeTechId ? TECHNOLOGY_BY_ID[view.activeTechId] : null;
    const completedCount = view.technologies.filter((status) => status.completed).length;
    return `
      <div class="techHeader" data-tech-drag>
        <div class="techHeaderIcon">TC</div>
        <div>
          <div class="techTitle">Technology</div>
          <div class="techSubtitle">${this.escapeHtml(data.factionName ?? `Faction ${view.factionId}`)}</div>
        </div>
        <button class="techClose" type="button" data-tech-close aria-label="Close technology panel">X</button>
      </div>
      <div class="techSummary">
        ${this.renderSummaryCard("Research", `${view.researchPerHour.toFixed(2)}/h`, "Labs and baseline output")}
        ${this.renderSummaryCard("Focused", `${view.activeResearchPerHour.toFixed(2)}/h`, activeTech?.name ?? "No active focus")}
        ${this.renderSummaryCard("Passive", `${view.passiveResearchPerHour.toFixed(2)}/h`, "Empire identity spread")}
        ${this.renderSummaryCard("Completed", `${completedCount}/${view.technologies.length}`, "Known technologies")}
      </div>
      <section class="techBody">
        ${this.renderTree(view, selected?.id ?? null)}
        ${selected ? this.renderDetail(view, selected) : this.renderEmpireDetail(view)}
      </section>
    `;
  }

  private renderSummaryCard(label: string, value: string, detail: string): string {
    return `
      <article class="techSummaryCard">
        <span>${this.escapeHtml(label)}</span>
        <strong>${this.escapeHtml(value)}</strong>
        <small>${this.escapeHtml(detail)}</small>
      </article>
    `;
  }

  private buildTreeLayout(): { positions: Map<TechId, { x: number; y: number }>; width: number; height: number } {
    const positions = new Map<TechId, { x: number; y: number }>();
    const columns = new Map<number, TechnologyDefinition[]>();
    for (const tech of TECHNOLOGY_DEFINITIONS) {
      const column = tech.positionInTree.x;
      const list = columns.get(column) ?? [];
      list.push(tech);
      columns.set(column, list);
    }

    for (const [column, techs] of columns) {
      const baseX = TREE_PADDING_X + column * COLUMN_GAP;
      const ordered = techs
        .map((tech) => ({ tech, baseY: this.getNodePosition(tech).y }))
        .sort((a, b) => a.baseY - b.baseY);
      let lastY = -Infinity;
      for (const entry of ordered) {
        let y = entry.baseY;
        const minY = lastY + NODE_HEIGHT + NODE_MIN_VERTICAL_GAP;
        if (y < minY) y = minY;
        positions.set(entry.tech.id, { x: baseX, y });
        lastY = y;
      }
    }

    let maxX = 0;
    let maxY = 0;
    positions.forEach((pos) => {
      maxX = Math.max(maxX, pos.x);
      maxY = Math.max(maxY, pos.y);
    });
    return {
      positions,
      width: maxX + NODE_WIDTH + TREE_PADDING_X,
      height: maxY + NODE_HEIGHT + TREE_PADDING_Y,
    };
  }

  private renderTree(view: FactionTechnologyView, selectedTechId: TechId | null): string {
    const statusById = new Map(view.technologies.map((status) => [status.id, status]));
    const layout = this.buildTreeLayout();
    const width = layout.width;
    const height = layout.height;
    const zoom = this.techTreeZoom;
    const scaledWidth = Math.ceil(width * zoom);
    const scaledHeight = Math.ceil(height * zoom);
    return `
      <div class="techTreeShell">
        <div class="techTreeToolbar" aria-label="Technology tree zoom">
          <button type="button" data-tech-zoom="out" aria-label="Zoom technology tree out">-</button>
          <span>${Math.round(zoom * 100)}%</span>
          <button type="button" data-tech-zoom="in" aria-label="Zoom technology tree in">+</button>
          <button type="button" data-tech-zoom="reset" aria-label="Reset technology tree zoom">Fit</button>
        </div>
        <div class="techTreeViewport">
          <div class="techTreeScene" style="width:${scaledWidth}px;height:${scaledHeight}px;">
            <div class="techTreeCanvas" style="width:${width}px;height:${height}px;transform:scale(${zoom});">
              <svg class="techTreeLines" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
                ${TECHNOLOGY_DEFINITIONS.flatMap((tech) => tech.prerequisites.map((prereqId) => {
                  const from = TECHNOLOGY_BY_ID[prereqId];
                  if (!from) return "";
                  const fromStatus = statusById.get(from.id);
                  const toStatus = statusById.get(tech.id);
                  const complete = fromStatus?.completed && toStatus?.completed;
                  const active = toStatus?.active;
                  const a = this.getNodeCenterFromLayout(from, layout.positions);
                  const b = this.getNodeCenterFromLayout(tech, layout.positions);
                  return `<path class="${complete ? "completed" : ""} ${active ? "active" : ""}" d="M ${a.x} ${a.y} C ${a.x + 120} ${a.y}, ${b.x - 120} ${b.y}, ${b.x} ${b.y}" />`;
                })).join("")}
              </svg>
              ${TECHNOLOGY_DEFINITIONS.map((tech) => {
                const status = statusById.get(tech.id);
                if (!status) return "";
                return this.renderNode(tech, status, selectedTechId === tech.id, layout.positions.get(tech.id));
              }).join("")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderNode(
    tech: TechnologyDefinition,
    status: TechnologyStatusView,
    selected: boolean,
    position?: { x: number; y: number },
  ): string {
    const pos = position ?? this.getNodePosition(tech);
    const progress = this.getProgressPercent(tech, status);
    const state = status.completed ? "Completed" : status.active ? "Active" : status.available ? "Available" : "Locked";
    const classes = [
      "techNode",
      `cat-${tech.category}`,
      status.completed ? "completed" : "",
      status.active ? "active" : "",
      status.available ? "available" : "",
      status.locked ? "locked" : "",
      selected ? "selected" : "",
      tech.defaultUnlocked ? "baseline" : "",
    ].filter(Boolean).join(" ");
    return `
      <button
        class="${classes}"
        type="button"
        data-tech-node="${this.escapeAttribute(tech.id)}"
        style="left:${pos.x}px;top:${pos.y}px;"
        aria-label="${this.escapeAttribute(tech.name)}"
      >
        <span class="techNodeMeta">${this.escapeHtml(CATEGORY_LABELS[tech.category] ?? tech.category)} T${tech.tier}</span>
        <strong>${this.escapeHtml(tech.name)}</strong>
        <small>${this.escapeHtml(state)}</small>
        <span class="techNodeBar" aria-hidden="true"><i style="width:${progress.toFixed(1)}%"></i></span>
      </button>
    `;
  }

  private renderDetail(view: FactionTechnologyView, status: TechnologyStatusView): string {
    const tech = TECHNOLOGY_BY_ID[status.id];
    const progress = this.getProgressPercent(tech, status);
    const canResearch = status.available && !status.completed && !status.active;
    const missing = status.missingPrerequisites
      .map((id) => TECHNOLOGY_BY_ID[id]?.name ?? id)
      .join(", ");
    return `
      <aside class="techDetail">
        <div class="techDetailHeader">
          <div>
            <span>${this.escapeHtml(CATEGORY_LABELS[tech.category] ?? tech.category)} / Tier ${tech.tier}</span>
            <strong>${this.escapeHtml(tech.name)}</strong>
          </div>
          <button type="button" data-tech-research ${canResearch ? "" : "disabled"}>
            ${status.active ? "Researching" : status.completed ? "Completed" : status.locked ? "Locked" : "Research"}
          </button>
        </div>
        <div class="techDetailBody">
          <p>${this.escapeHtml(tech.description)}</p>
          <div class="techProgressBlock">
            <div class="techProgressHeader">
              <span>Total progress</span>
              <strong>${progress.toFixed(1)}%</strong>
            </div>
            <div class="techProgressBar"><i style="width:${progress.toFixed(1)}%"></i></div>
            <div class="techProgressGrid">
              <span>Total ${Math.round(status.progress.totalProgress)} / ${tech.cost}</span>
              <span>Active ${Math.round(status.progress.activeProgress)}</span>
              <span>Passive ${Math.round(status.progress.passiveProgress)} / ${Math.round(status.passiveCap)}</span>
            </div>
          </div>
          <section class="techDetailSection">
            <div class="techSectionTitle">Research Speed</div>
            <div class="techMultiplier">
              <strong>${status.evaluation.multiplier.toFixed(2)}x</strong>
              <span>${this.formatSignedPercent(status.evaluation.bonus)} total modifier</span>
            </div>
            <div class="techSourceList">
              ${status.evaluation.breakdown.length === 0
                ? '<span class="techMuted">No contextual modifiers.</span>'
                : status.evaluation.breakdown.map((entry) => `
                  <span>
                    <strong>${this.escapeHtml(entry.label)}</strong>
                    <small>${this.formatSignedPercent(entry.bonus)} (cap ${this.formatPercent(entry.cap)})</small>
                  </span>
                `).join("")}
            </div>
          </section>
          <section class="techDetailSection">
            <div class="techSectionTitle">Effects</div>
            <div class="techEffectList">
              ${tech.effects.map((effect) => `<span>${this.escapeHtml(this.describeEffect(effect))}</span>`).join("")}
            </div>
          </section>
          ${missing ? `
            <section class="techDetailSection">
              <div class="techSectionTitle">Prerequisites</div>
              <div class="techLockedText">${this.escapeHtml(missing)}</div>
            </section>
          ` : ""}
          <section class="techDetailSection">
            <div class="techSectionTitle">Research Pools</div>
            <div class="techPoolGrid">
              <span>Focused <strong>${view.activeResearchPerHour.toFixed(2)}/h</strong></span>
              <span>Passive <strong>${view.passiveResearchPerHour.toFixed(2)}/h</strong></span>
            </div>
          </section>
        </div>
      </aside>
    `;
  }

  private renderEmpireDetail(view: FactionTechnologyView): string {
    const completedCount = view.technologies.filter((status) => status.completed).length;
    const availableCount = view.technologies.filter((status) => status.available && !status.completed).length;
    const activeTech = view.activeTechId ? TECHNOLOGY_BY_ID[view.activeTechId] : null;
    const affinities = this.getCategoryAffinities(view);
    const maxAffinity = affinities.reduce((max, entry) => Math.max(max, entry.score), 0) || 1;
    const signals = this.getModifierHighlights(view);
    return `
      <aside class="techDetail techDetailSummary">
        <div class="techDetailHeader">
          <div>
            <span>Empire Affinity</span>
            <strong>Strategic Profile</strong>
          </div>
          <div class="techDetailHint">Select a technology</div>
        </div>
        <div class="techDetailBody">
          <p class="techSoft">Select a technology node to view research detail. Until then, these signals summarize your empire's current lean.</p>
          <section class="techDetailSection">
            <div class="techSectionTitle">Focus Snapshot</div>
            <div class="techInsightGrid">
              <div class="techInsightCard">
                <span>Active Focus</span>
                <strong>${this.escapeHtml(activeTech?.name ?? "No active focus")}</strong>
                <small>${this.escapeHtml(activeTech ? `${CATEGORY_LABELS[activeTech.category] ?? activeTech.category} / Tier ${activeTech.tier}` : "Set an active research target")}</small>
              </div>
              <div class="techInsightCard">
                <span>Available</span>
                <strong>${availableCount}</strong>
                <small>${this.escapeHtml(`${completedCount}/${view.technologies.length} completed`)}</small>
              </div>
              <div class="techInsightCard">
                <span>Research Output</span>
                <strong>${view.researchPerHour.toFixed(2)}/h</strong>
                <small>${this.escapeHtml(`Active ${view.activeResearchPerHour.toFixed(2)}/h`)}</small>
              </div>
              <div class="techInsightCard">
                <span>Passive Stream</span>
                <strong>${view.passiveResearchPerHour.toFixed(2)}/h</strong>
                <small>${this.escapeHtml("Baseline affinity spread")}</small>
              </div>
            </div>
          </section>
          <section class="techDetailSection">
            <div class="techSectionTitle">Affinity Map</div>
            <div class="techAffinityList">
              ${affinities.length === 0
                ? '<span class="techMuted">No affinity telemetry yet.</span>'
                : affinities.map((entry) => `
                  <div class="techAffinityRow">
                    <span>${this.escapeHtml(CATEGORY_LABELS[entry.category] ?? entry.category)}</span>
                    <div class="techAffinityBar"><i style="width:${Math.max(6, (entry.score / maxAffinity) * 100).toFixed(1)}%"></i></div>
                    <strong>${this.formatPercent(entry.score)}</strong>
                  </div>
                `).join("")}
            </div>
          </section>
          <section class="techDetailSection">
            <div class="techSectionTitle">Research Signals</div>
            <div class="techSourceList">
              ${signals.length === 0
                ? '<span class="techMuted">No active modifiers detected.</span>'
                : signals.map((entry) => `
                  <span>
                    <strong>${this.escapeHtml(entry.label)}</strong>
                    <small>${this.formatSignedPercent(entry.bonus)} (cap ${this.formatPercent(entry.cap)})</small>
                  </span>
                `).join("")}
            </div>
          </section>
        </div>
      </aside>
    `;
  }

  private getStatus(view: FactionTechnologyView, techId: TechId | null): TechnologyStatusView | null {
    if (!techId) return null;
    return view.technologies.find((status) => status.id === techId) ?? null;
  }

  private getProgressPercent(tech: TechnologyDefinition, status: TechnologyStatusView): number {
    if (tech.cost <= 0 || status.completed) return 100;
    return Math.max(0, Math.min(100, (status.progress.totalProgress / tech.cost) * 100));
  }

  private getNodePosition(tech: TechnologyDefinition): { x: number; y: number } {
    return {
      x: TREE_PADDING_X + tech.positionInTree.x * COLUMN_GAP,
      y: TREE_PADDING_Y + tech.positionInTree.y * ROW_GAP,
    };
  }

  private getNodeCenterFromLayout(
    tech: TechnologyDefinition,
    positions: Map<TechId, { x: number; y: number }>,
  ): { x: number; y: number } {
    const pos = positions.get(tech.id) ?? this.getNodePosition(tech);
    return {
      x: pos.x + NODE_WIDTH / 2,
      y: pos.y + NODE_HEIGHT / 2,
    };
  }

  private getCategoryAffinities(view: FactionTechnologyView): Array<{ category: string; score: number }> {
    const totals = new Map<string, { score: number; count: number }>();
    for (const status of view.technologies) {
      const tech = TECHNOLOGY_BY_ID[status.id];
      if (!tech) continue;
      const entry = totals.get(tech.category) ?? { score: 0, count: 0 };
      entry.score += status.evaluation.passiveScore;
      entry.count += 1;
      totals.set(tech.category, entry);
    }
    return Array.from(totals.entries())
      .map(([category, entry]) => ({ category, score: entry.count > 0 ? entry.score / entry.count : 0 }))
      .sort((a, b) => b.score - a.score);
  }

  private getModifierHighlights(view: FactionTechnologyView): Array<{ label: string; bonus: number; cap: number }> {
    const highlights = new Map<string, { label: string; bonus: number; cap: number }>();
    for (const status of view.technologies) {
      for (const entry of status.evaluation.breakdown) {
        if (!entry.bonus) continue;
        const current = highlights.get(entry.label);
        if (!current || Math.abs(entry.bonus) > Math.abs(current.bonus)) {
          highlights.set(entry.label, { label: entry.label, bonus: entry.bonus, cap: entry.cap });
        }
      }
    }
    return Array.from(highlights.values())
      .sort((a, b) => Math.abs(b.bonus) - Math.abs(a.bonus))
      .slice(0, 6);
  }

  private describeEffect(effect: TechnologyEffect): string {
    switch (effect.type) {
      case "unlock_building":
        return `Unlock building: ${BUILDING_LABELS[effect.building] ?? effect.building}`;
      case "unlock_building_level":
        return `Unlock building upgrade: ${BUILDING_LABELS[effect.building] ?? effect.building} level ${effect.level}`;
      case "unlock_starbase_building":
        return `Unlock starbase building: ${STARBASE_BUILDING_DEFINITIONS[effect.building]?.label ?? effect.building}`;
      case "unlock_ship_hull":
        return `Unlock hull: ${SHIP_HULL_DEFINITIONS[effect.shipKind]?.label ?? effect.shipKind}`;
      case "unlock_ship_module": {
        const module = getShipModuleDefinition(effect.moduleId);
        return `Unlock ship module: ${module?.label ?? effect.moduleId}`;
      }
      case "unlock_ship_section": {
        const module = getShipSectionModuleDefinition(effect.sectionModuleId);
        return `Unlock ship section: ${module?.label ?? effect.sectionModuleId}`;
      }
      case "job_output_mult":
        return `${JOB_LABELS[effect.job] ?? effect.job} ${RESOURCE_LABELS[effect.resource] ?? effect.resource} output +${this.formatPercent(effect.value)}`;
      case "construction_speed_mult":
        return `Planet construction speed +${this.formatPercent(effect.value)}`;
      case "starbase_ship_build_speed_mult":
        return `Starbase ship build speed +${this.formatPercent(effect.value)}`;
    }
  }

  private formatPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  private formatSignedPercent(value: number): string {
    const rounded = Math.round(value * 100);
    return `${rounded >= 0 ? "+" : ""}${rounded}%`;
  }

  private escapeHtml(value: string | number): string {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  private escapeAttribute(value: string | number): string {
    return this.escapeHtml(value);
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.technologyPanel {
  --tech-accent: rgba(114, 226, 255, 0.95);
  --tech-panel-scale: 0.82;
  position: fixed;
  z-index: 59;
  pointer-events: auto;
  width: min(1380px, calc(100vw - 32px));
  height: min(760px, calc(100vh - 32px));
  transform: scale(var(--tech-panel-scale));
  transform-origin: top left;
  display: grid;
  grid-template-rows: 58px 72px minmax(0, 1fr);
  color: #e9fff8;
  background:
    radial-gradient(circle at 72% 18%, color-mix(in srgb, var(--tech-accent) 12%, transparent), transparent 18rem),
    linear-gradient(180deg, rgba(7, 28, 31, 0.98), rgba(2, 12, 15, 0.99));
  border: 1px solid color-mix(in srgb, var(--tech-accent) 76%, transparent);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.56), inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  overflow: hidden;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
  user-select: none;
}
.techHeader {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 12px;
  padding: 8px 12px;
  cursor: grab;
  border-bottom: 1px solid rgba(103, 255, 221, 0.24);
  background: linear-gradient(90deg, rgba(20, 70, 62, 0.86), rgba(4, 19, 23, 0.92));
}
.techHeaderIcon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  clip-path: polygon(50% 0, 94% 25%, 94% 75%, 50% 100%, 6% 75%, 6% 25%);
  background: linear-gradient(135deg, #ff69c9, #7d57ff);
  color: #160017;
  font-weight: 900;
  font-size: 11px;
  box-shadow: 0 0 16px rgba(255, 105, 201, 0.32), inset 0 0 0 2px rgba(10, 0, 20, 0.45);
}
.techTitle {
  font-size: 19px;
  font-weight: 900;
}
.techSubtitle {
  margin-top: 2px;
  color: rgba(206, 232, 226, 0.68);
  font-size: 11px;
  text-transform: uppercase;
}
.techClose {
  margin-left: auto;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(103, 255, 221, 0.62);
  background: rgba(6, 42, 38, 0.76);
  color: #bfffee;
  font: inherit;
  cursor: pointer;
}
.techSummary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid rgba(103, 255, 221, 0.18);
  background: rgba(1, 8, 10, 0.42);
}
.techSummaryCard {
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid rgba(103, 255, 221, 0.26);
  background: linear-gradient(180deg, rgba(9, 45, 51, 0.74), rgba(2, 14, 18, 0.72));
}
.techSummaryCard span,
.techSummaryCard small {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.techSummaryCard span {
  color: #72e2ff;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0;
}
.techSummaryCard strong {
  display: block;
  margin-top: 4px;
  color: #ffffff;
  font-size: 15px;
}
.techSummaryCard small {
  margin-top: 3px;
  color: rgba(206, 232, 226, 0.58);
  font-size: 10px;
}
.techBody {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 390px;
  gap: 10px;
  padding: 8px;
}
.techTreeShell {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: grid;
}
.techTreeToolbar {
  position: absolute;
  top: 10px;
  right: 14px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid rgba(103, 255, 221, 0.22);
  background: rgba(2, 13, 17, 0.78);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.3);
}
.techTreeToolbar button {
  height: 28px;
  min-width: 30px;
  border: 1px solid rgba(103, 255, 221, 0.36);
  background: rgba(6, 42, 38, 0.72);
  color: #d8fff6;
  font: inherit;
  font-size: 10px;
  font-weight: 900;
  cursor: pointer;
}
.techTreeToolbar button:hover {
  border-color: rgba(103, 255, 221, 0.76);
}
.techTreeToolbar span {
  min-width: 38px;
  color: rgba(206, 232, 226, 0.72);
  font-size: 10px;
  text-align: center;
}
.techTreeViewport {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border: 1px solid rgba(103, 255, 221, 0.26);
  background:
    linear-gradient(rgba(103, 255, 221, 0.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(103, 255, 221, 0.055) 1px, transparent 1px),
    linear-gradient(180deg, rgba(5, 24, 25, 0.72), rgba(1, 8, 10, 0.84));
  background-size: 34px 34px;
  scrollbar-width: thin;
}
.techTreeViewport::-webkit-scrollbar,
.techDetailBody::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.techTreeViewport::-webkit-scrollbar-thumb,
.techDetailBody::-webkit-scrollbar-thumb {
  background: rgba(103, 255, 221, 0.34);
  border-radius: 999px;
}
.techTreeScene {
  position: relative;
}
.techTreeCanvas {
  position: relative;
  transform-origin: top left;
}
.techTreeLines {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.techTreeLines path {
  fill: none;
  stroke: rgba(103, 255, 221, 0.22);
  stroke-width: 2;
}
.techTreeLines path.completed {
  stroke: rgba(103, 255, 221, 0.62);
}
.techTreeLines path.active {
  stroke: rgba(255, 105, 201, 0.76);
}
.techNode {
  --node-accent: #72e2ff;
  position: absolute;
  width: ${NODE_WIDTH}px;
  height: ${NODE_HEIGHT}px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 11px 12px;
  border: 1px solid rgba(103, 255, 221, 0.26);
  border-left: 3px solid var(--node-accent);
  color: #eafff8;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--node-accent) 12%, transparent), transparent 54%),
    linear-gradient(180deg, rgba(8, 38, 41, 0.96), rgba(2, 14, 18, 0.96));
  cursor: pointer;
  text-align: left;
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.32);
}
.techNode.cat-agriculture {
  --node-accent: #75ff9b;
}
.techNode.cat-industry {
  --node-accent: #ffdc72;
}
.techNode.cat-military {
  --node-accent: #ff5a78;
}
.techNode.cat-logistics {
  --node-accent: #72e2ff;
}
.techNode.cat-energy {
  --node-accent: #4cecff;
}
.techNode.cat-computing {
  --node-accent: #b985ff;
}
.techNode.cat-society {
  --node-accent: #ff9adf;
}
.techNode:hover,
.techNode.selected {
  border-color: color-mix(in srgb, var(--node-accent) 82%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--node-accent) 28%, transparent), 0 12px 26px rgba(0, 0, 0, 0.36);
}
.techNode.completed {
  border-color: rgba(103, 255, 221, 0.52);
  border-left-color: #67ffdd;
}
.techNode.active {
  border-color: rgba(255, 105, 201, 0.78);
  border-left-color: #ff69c9;
}
.techNode.locked {
  opacity: 0.5;
}
.techNode.baseline {
  background: linear-gradient(180deg, rgba(21, 42, 45, 0.96), rgba(5, 20, 23, 0.96));
}
.techNodeMeta {
  color: var(--node-accent);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0;
}
.techNode strong {
  width: 100%;
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.18;
  overflow-wrap: anywhere;
}
.techNode small {
  margin-top: 7px;
  color: rgba(206, 232, 226, 0.66);
  font-size: 10px;
}
.techNodeBar {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 10px;
  height: 4px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.1);
}
.techNodeBar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #72e2ff, #ff69c9);
}
.techDetail {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(103, 255, 221, 0.26);
  background: rgba(5, 24, 25, 0.72);
  display: flex;
  flex-direction: column;
}
.techDetailHeader {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid rgba(103, 255, 221, 0.18);
  background: rgba(1, 8, 10, 0.26);
}
.techDetailHeader span {
  display: block;
  color: #72e2ff;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0;
}
.techDetailHeader strong {
  display: block;
  margin-top: 4px;
  font-size: 14px;
  line-height: 1.18;
  overflow-wrap: anywhere;
}
.techDetailHeader button {
  height: 34px;
  border: 1px solid rgba(103, 255, 221, 0.62);
  padding: 0 12px;
  color: #061413;
  font-weight: 800;
  font: inherit;
  background: #72e2ff;
  cursor: pointer;
}
.techDetailHeader button:disabled {
  color: rgba(206, 232, 226, 0.44);
  border-color: rgba(103, 255, 221, 0.18);
  background: rgba(255, 255, 255, 0.08);
  cursor: default;
}
.techDetailBody {
  min-height: 0;
  overflow: auto;
  padding: 14px;
}
.techDetailBody p {
  margin: 0;
  color: rgba(206, 232, 226, 0.76);
  line-height: 1.45;
  font-size: 12px;
}
.techDetailHint {
  color: rgba(206, 232, 226, 0.58);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.techSoft {
  color: rgba(206, 232, 226, 0.62);
  font-size: 11px;
}
.techInsightGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}
.techInsightCard {
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(103, 255, 221, 0.12);
  background: rgba(255, 255, 255, 0.045);
}
.techInsightCard span {
  display: block;
  color: rgba(206, 232, 226, 0.62);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.techInsightCard strong {
  display: block;
  margin-top: 4px;
  font-size: 12px;
}
.techInsightCard small {
  display: block;
  margin-top: 3px;
  color: rgba(206, 232, 226, 0.52);
  font-size: 10px;
}
.techAffinityList {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}
.techAffinityRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: rgba(206, 232, 226, 0.72);
}
.techAffinityBar {
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(103, 255, 221, 0.18);
  overflow: hidden;
}
.techAffinityBar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #72e2ff, #ff69c9);
}
.techProgressBlock,
.techDetailSection {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid rgba(103, 255, 221, 0.22);
  background: rgba(1, 8, 10, 0.32);
}
.techProgressHeader,
.techMultiplier,
.techPoolGrid {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.techProgressHeader span,
.techMultiplier span {
  color: rgba(206, 232, 226, 0.62);
  font-size: 11px;
}
.techProgressBar {
  height: 7px;
  margin-top: 10px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.1);
}
.techProgressBar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #72e2ff, #ff69c9);
}
.techProgressGrid,
.techSourceList,
.techEffectList,
.techPoolGrid {
  display: grid;
  gap: 8px;
  margin-top: 10px;
  color: rgba(206, 232, 226, 0.74);
  font-size: 11px;
}
.techProgressGrid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.techSectionTitle {
  color: #72e2ff;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0;
}
.techSourceList span,
.techEffectList span,
.techPoolGrid span {
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(103, 255, 221, 0.12);
  background: rgba(255, 255, 255, 0.045);
}
.techSourceList strong,
.techSourceList small {
  display: block;
}
.techSourceList small {
  margin-top: 2px;
  color: rgba(206, 232, 226, 0.56);
}
.techLockedText,
.techMuted {
  display: block;
  margin-top: 8px;
  color: rgba(255, 105, 201, 0.88);
  font-size: 11px;
}
.techUnavailable {
  padding: 18px;
  color: rgba(206, 232, 226, 0.72);
}
@media (max-width: 900px) {
  .technologyPanel {
    width: calc(100vw - 16px);
    height: calc(100vh - 16px);
  }
  .techSummary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .techBody {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(280px, 1fr) 360px;
  }
  .techDetail {
    border-left: 0;
    border-top: 1px solid rgba(126, 211, 255, 0.14);
  }
  .techInsightGrid {
    grid-template-columns: 1fr;
  }
}
`;
    document.head.appendChild(style);
  }
}
