import type { FactionInfo } from "../data/Factions";
import type { FactionEconomyState } from "../data/Economy";
import type { FactionTechnologyView } from "../data/Technology";
import { TECHNOLOGY_BY_ID } from "../data/Technology";
import {
  formatLeaderClass,
  getLeaderTraitDefinition,
} from "../data/Leaders";
import type { LeaderState } from "../data/Leaders";
import {
  GOVERNMENT_LAW_DEFINITIONS,
  GOVERNMENT_POSITION_DEFINITIONS,
  getAssignedGovernmentLeader,
  getSelectedGovernmentLawOptions,
} from "../data/Government";
import type {
  FactionGovernmentState,
  GovernmentEffect,
  GovernmentEmpireStat,
  GovernmentFleetModifierTarget,
  GovernmentLawDefinition,
  GovernmentLawId,
  GovernmentLawOption,
  GovernmentPositionDefinition,
  GovernmentPositionId,
} from "../data/Government";
import type { ClientCommand } from "../game/GameProtocol";
import { PanelInteractionGate, captureScrollState, restoreScrollStateSoon } from "./panelDomState";
import { ensurePanelThemeStyles } from "./panelTheme";
import type { LeaderAssignmentTarget } from "./leaderEvents";

export interface GovernmentPanelData {
  government: FactionGovernmentState | null;
  leaders: LeaderState[];
  technology: FactionTechnologyView | null;
  factionEconomy: FactionEconomyState | null;
  factions: FactionInfo[];
  playerFactionId: number | null;
  factionName?: string;
  clockYear: number;
  onGovernmentCommand?: (command: ClientCommand) => void;
  onOpenLeaderAssignment?: (target: LeaderAssignmentTarget) => void;
  onClose?: () => void;
}

type GovernmentTab = "leaders" | "laws";

interface EffectRow {
  label: string;
  value: string;
  source: string;
  polarity: "positive" | "negative" | "neutral";
}

const STYLE_ID = "government-panel-style";
const GOVERNMENT_SCROLL_SELECTORS = [".governmentContent", ".governmentLawsList"] as const;

export class GovernmentPanel {
  private root: HTMLDivElement;
  private panelElement: HTMLDivElement | null = null;
  private currentData: GovernmentPanelData | null = null;
  private activeTab: GovernmentTab = "leaders";
  private expandedLawId: GovernmentLawId | null = null;
  private pendingRefreshData: GovernmentPanelData | null = null;
  private pendingRefreshTimer: number | null = null;
  private position = { x: 48, y: 68 };
  private dragOffset = { x: 0, y: 0 };
  private isDragging = false;
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
    ensurePanelThemeStyles();
    this.injectStyles();
  }

  public show(data: GovernmentPanelData): void {
    this.currentData = data;
    const scrollState = captureScrollState(this.panelElement, GOVERNMENT_SCROLL_SELECTORS);
    if (!this.panelElement) {
      this.panelElement = document.createElement("div");
      this.panelElement.className = "governmentPanel";
      this.root.appendChild(this.panelElement);
    }
    this.interactionGate.bind(this.panelElement);
    const accent = data.playerFactionId !== null
      ? this.colorToCss(data.factions.find((faction) => faction.id === data.playerFactionId)?.color, 0.95)
      : "rgba(74, 236, 214, 0.95)";
    this.panelElement.style.setProperty("--government-accent", accent);
    this.panelElement.style.setProperty("--panel-accent", accent);
    this.panelElement.innerHTML = this.render(data);
    this.applyPosition();
    this.bindEvents(data);
    restoreScrollStateSoon(this.panelElement, scrollState);
  }

  public refresh(data: GovernmentPanelData): void {
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

  private bindEvents(data: GovernmentPanelData): void {
    if (!this.panelElement) return;
    this.panelElement.querySelector<HTMLButtonElement>("[data-government-close]")?.addEventListener("click", () => this.close());
    this.panelElement.querySelector<HTMLElement>("[data-government-drag]")?.addEventListener("pointerdown", (ev) => {
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
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-government-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.dataset.governmentTab as GovernmentTab | undefined;
        if (!tab) return;
        this.activeTab = tab;
        this.show(data);
      });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-government-law]").forEach((button) => {
      button.addEventListener("click", () => {
        const lawId = button.dataset.governmentLaw as GovernmentLawId | undefined;
        if (!lawId) return;
        this.expandedLawId = this.expandedLawId === lawId ? null : lawId;
        this.show(data);
      });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-government-option]").forEach((button) => {
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const lawId = button.dataset.governmentLawId as GovernmentLawId | undefined;
        const optionId = button.dataset.governmentOption;
        if (!lawId || !optionId) return;
        data.onGovernmentCommand?.({ type: "setGovernmentLaw", lawId, optionId });
      });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-government-assign]").forEach((button) => {
      button.addEventListener("click", () => {
        const positionId = button.dataset.governmentAssign as GovernmentPositionId | undefined;
        const position = GOVERNMENT_POSITION_DEFINITIONS.find((candidate) => candidate.id === positionId);
        if (!position) return;
        data.onOpenLeaderAssignment?.({
          kind: "government",
          targetId: position.id,
          label: position.title,
          requiredClass: position.requiredClass,
        });
      });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-government-unassign]").forEach((button) => {
      button.addEventListener("click", () => {
        const leaderId = button.dataset.governmentUnassign;
        if (!leaderId) return;
        data.onGovernmentCommand?.({ type: "assignLeader", leaderId, assignment: null });
      });
    });
  }

  private shouldDeferRefresh(): boolean {
    return this.isDragging || this.interactionGate.isBusy(this.panelElement);
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

  private render(data: GovernmentPanelData): string {
    const factionName = data.factionName ?? "No faction selected";
    const effects = this.getActiveEffectRows(data);
    const adminEffect = this.sumEmpireStat(data, "administrativeEfficiency");
    const allocation = this.getResearchAllocation(data);
    const openPositions = this.getOpenPositionCount(data);

    return `
      <div class="governmentFrame">
        <header class="governmentHeader" data-government-drag>
          <div class="governmentIdentity">
            <div class="governmentBadge">G</div>
            <div>
              <div class="governmentTitle">Government</div>
              <div class="governmentSubtitle">${this.escapeHtml(factionName)} Executive Council</div>
            </div>
          </div>
          <button class="governmentClose" type="button" data-government-close aria-label="Close government panel">X</button>
        </header>
        <section class="governmentBody">
          <section class="governmentSummary">
            ${this.renderSummaryItem("Government Type", "Technocratic Republic", "GOV")}
            ${this.renderSummaryItem("Governance Effectiveness", this.formatSignedPercent(adminEffect), "EFF", adminEffect)}
            ${this.renderSummaryItem("Research Allocation", `${Math.round(allocation.active * 100)} / ${Math.round(allocation.passive * 100)}`, "RES")}
            ${this.renderSummaryItem("Open Positions", String(openPositions), "POS", -openPositions)}
          </section>
          <main class="governmentContent ${this.activeTab}">
            ${this.activeTab === "leaders" ? this.renderLeadersTab(data, effects) : this.renderLawsTab(data, effects)}
          </main>
        </section>
        <nav class="governmentTabs">
          ${this.renderTab("leaders", "Leaders")}
          ${this.renderTab("laws", "Laws")}
        </nav>
      </div>
    `;
  }

  private renderSummaryItem(label: string, value: string, icon: string, numericValue = 0): string {
    return `
      <div class="governmentSummaryItem">
        <span class="governmentSummaryIcon">${this.escapeHtml(icon)}</span>
        <span>
          <small>${this.escapeHtml(label)}</small>
          <strong class="${numericValue < 0 ? "negative" : numericValue > 0 ? "positive" : ""}">${this.escapeHtml(value)}</strong>
        </span>
      </div>
    `;
  }

  private renderTab(tab: GovernmentTab, label: string): string {
    return `
      <button class="governmentTab ${this.activeTab === tab ? "active" : ""}" type="button" data-government-tab="${tab}">
        <span>${this.escapeHtml(tab === "leaders" ? "CAB" : "LAW")}</span>
        <strong>${this.escapeHtml(label)}</strong>
      </button>
    `;
  }

  private renderLeadersTab(data: GovernmentPanelData, effects: EffectRow[]): string {
    return `
      <section class="governmentLeaderGrid">
        ${GOVERNMENT_POSITION_DEFINITIONS.map((position) => this.renderPositionCard(position, data)).join("")}
      </section>
      <aside class="governmentSideStack">
        ${this.renderEffectPanel("Council Effects", effects.filter((row) => row.source.startsWith("cabinet")), "No cabinet effects active.")}
        ${this.renderCabinetSynergy(data)}
        ${this.renderDirectivePanel()}
      </aside>
    `;
  }

  private renderPositionCard(position: GovernmentPositionDefinition, data: GovernmentPanelData): string {
    const factionId = data.playerFactionId ?? -1;
    const leader = factionId >= 0 ? getAssignedGovernmentLeader(data.leaders, factionId, position.id) : null;
    const traitCards = leader
      ? leader.traits.map((traitId) => {
        const trait = getLeaderTraitDefinition(traitId);
        const councilText = (trait.governmentEffects ?? [])
          .filter((effect) => !effect.positionId || effect.positionId === "any" || effect.positionId === position.id)
          .map((effect) => effect.description)
          .join(" ");
        return `<span class="governmentTrait ${councilText ? "active" : ""}" title="${this.escapeAttribute(councilText || trait.description)}">${this.escapeHtml(trait.name)}</span>`;
      }).join("")
      : '<span class="governmentTrait empty">No leader assigned</span>';
    const effectRows = leader ? this.getPositionEffectRows(position, leader) : [];

    return `
      <article class="governmentLeaderCard ${leader ? "filled" : "empty"}">
        <div class="governmentLeaderPortrait ${leader?.class ?? "civilian"}"${leader?.portraitUrl ? ` style="background-image: url('${this.escapeAttribute(leader.portraitUrl)}')"` : ""}>
          <span>${leader ? this.escapeHtml(this.getInitials(leader.name)) : "+"}</span>
        </div>
        <div class="governmentLeaderMain">
          <div class="governmentLeaderRole">${this.escapeHtml(position.title)}</div>
          <div class="governmentLeaderName">${leader ? this.escapeHtml(leader.name) : "Open Position"}</div>
          <div class="governmentLeaderMeta">${leader ? `${this.escapeHtml(formatLeaderClass(leader.class))} | Level ${leader.level}` : `Requires ${this.escapeHtml(formatLeaderClass(position.requiredClass))}`}</div>
          <div class="governmentTraitRow">${traitCards}</div>
          <div class="governmentLevelEffect">${this.escapeHtml(position.levelEffectDescription)}</div>
          <div class="governmentMiniEffects">
            ${effectRows.length ? effectRows.map((row) => this.renderMiniEffect(row)).join("") : `<span>${this.escapeHtml(position.summary)}</span>`}
          </div>
        </div>
        <div class="governmentLeaderActions">
          <button type="button" data-government-assign="${this.escapeAttribute(position.id)}">${leader ? "Replace" : "Assign"}</button>
          ${leader ? `<button type="button" data-government-unassign="${this.escapeAttribute(leader.id)}">Unassign</button>` : ""}
        </div>
      </article>
    `;
  }

  private renderMiniEffect(row: EffectRow): string {
    return `<span class="${row.polarity}"><em>${this.escapeHtml(row.label)}</em><strong>${this.escapeHtml(row.value)}</strong></span>`;
  }

  private renderLawsTab(data: GovernmentPanelData, effects: EffectRow[]): string {
    return `
      <section class="governmentLawsList">
        ${GOVERNMENT_LAW_DEFINITIONS.map((law, index) => this.renderLaw(law, index + 1, data)).join("")}
      </section>
      <aside class="governmentSideStack">
        ${this.renderEffectPanel("Active Legal Effects", effects.filter((row) => row.source.startsWith("law")), "No legal effects active.")}
        ${this.renderCompliancePanel(data)}
        ${this.renderSanctionsPanel()}
      </aside>
    `;
  }

  private renderLaw(law: GovernmentLawDefinition, index: number, data: GovernmentPanelData): string {
    const government = data.government;
    const selectedId = government?.selectedLawOptionIds[law.id] ?? law.defaultOptionId;
    const selected = law.options.find((option) => option.id === selectedId) ?? law.options[0];
    const expanded = this.expandedLawId === law.id;
    return `
      <article class="governmentLaw ${expanded ? "expanded" : ""}">
        <button class="governmentLawHeader" type="button" data-government-law="${this.escapeAttribute(law.id)}">
          <span class="governmentLawIcon">${this.escapeHtml(law.icon)}</span>
          <strong>${index}. ${this.escapeHtml(law.name)}</strong>
          <em>${this.escapeHtml(selected.name)}</em>
          <small>${this.escapeHtml(selected.summary)}</small>
          <i>${expanded ? "^" : "v"}</i>
        </button>
        ${expanded ? `
          <div class="governmentLawOptions">
            ${law.options.map((option) => this.renderLawOption(law, option, selected.id === option.id, data)).join("")}
          </div>
        ` : ""}
      </article>
    `;
  }

  private renderLawOption(
    law: GovernmentLawDefinition,
    option: GovernmentLawOption,
    active: boolean,
    data: GovernmentPanelData,
  ): string {
    const completedTechIds = new Set(data.technology?.completedTechIds ?? []);
    const locked = Boolean(option.requiresTechId && !completedTechIds.has(option.requiresTechId));
    const requiredName = option.requiresTechId ? TECHNOLOGY_BY_ID[option.requiresTechId]?.name ?? option.requiresTechId : "";
    const rows = option.effects.flatMap((effect) => this.describeEffect(effect, 1, law.name));
    return `
      <div class="governmentLawOption ${active ? "active" : ""} ${locked ? "locked" : ""}">
        <button
          type="button"
          data-government-law-id="${this.escapeAttribute(law.id)}"
          data-government-option="${this.escapeAttribute(option.id)}"
          ${active || locked ? "disabled" : ""}
          aria-label="${this.escapeAttribute(`Set ${law.name} to ${option.name}`)}">
          <span class="governmentRadio"></span>
          <span class="governmentLawOptionMain">
            <strong>${this.escapeHtml(option.name)}</strong>
            <small>${this.escapeHtml(option.description)}</small>
          </span>
          <span class="governmentOptionEffects">
            ${rows.slice(0, 3).map((row) => `<i class="${row.polarity}">${this.escapeHtml(row.label)} ${this.escapeHtml(row.value)}</i>`).join("")}
          </span>
          <em>${active ? "Active" : locked ? `Requires ${this.escapeHtml(requiredName)}` : "Available"}</em>
        </button>
      </div>
    `;
  }

  private renderEffectPanel(title: string, rows: EffectRow[], emptyText: string): string {
    return `
      <section class="governmentSidePanel">
        <div class="governmentSideTitle"><span>EFF</span><strong>${this.escapeHtml(title)}</strong></div>
        <div class="governmentEffectList">
          ${rows.length
            ? rows.slice(0, 12).map((row) => `
              <div class="governmentEffectRow ${row.polarity}">
                <span>${this.escapeHtml(row.label)}</span>
                <strong>${this.escapeHtml(row.value)}</strong>
              </div>
            `).join("")
            : `<div class="governmentEmpty">${this.escapeHtml(emptyText)}</div>`}
        </div>
      </section>
    `;
  }

  private renderCabinetSynergy(data: GovernmentPanelData): string {
    const filled = GOVERNMENT_POSITION_DEFINITIONS.length - this.getOpenPositionCount(data);
    const research = this.getAssignedPosition(data, "headOfResearch");
    const development = this.getAssignedPosition(data, "headOfDevelopment");
    const defense = this.getAssignedPosition(data, "ministerOfDefense");
    const president = this.getAssignedPosition(data, "president");
    const synergies = [
      { name: "Executive Cohesion", active: Boolean(president && filled >= 3), effect: "Administrative Efficiency +10%" },
      { name: "Scientific Progress", active: Boolean(research && development), effect: "Research Speed +10%" },
      { name: "Strategic Excellence", active: Boolean(defense && president), effect: "Fleet Readiness +10%" },
    ];
    return `
      <section class="governmentSidePanel">
        <div class="governmentSideTitle"><span>SYN</span><strong>Cabinet Synergy</strong><em>${synergies.filter((item) => item.active).length} / ${synergies.length}</em></div>
        <div class="governmentSynergyList">
          ${synergies.map((item) => `
            <div class="${item.active ? "active" : ""}">
              <strong>${this.escapeHtml(item.name)}</strong>
              <span>${this.escapeHtml(item.active ? item.effect : "Inactive")}</span>
            </div>
          `).join("")}
        </div>
      </section>
    `;
  }

  private renderDirectivePanel(): string {
    return `
      <section class="governmentSidePanel">
        <div class="governmentSideTitle"><span>DIR</span><strong>Active Directives</strong><em>0 / 2</em></div>
        <div class="governmentPlaceholderList">
          <div><strong>Advance Hyperdrive Initiative</strong><span>Directive placeholder</span></div>
          <div><strong>Frontier Infrastructure Plan</strong><span>Directive placeholder</span></div>
        </div>
      </section>
    `;
  }

  private renderCompliancePanel(data: GovernmentPanelData): string {
    const lockedCount = GOVERNMENT_LAW_DEFINITIONS.reduce((count, law) => (
      count + law.options.filter((option) => option.requiresTechId && !(data.technology?.completedTechIds ?? []).includes(option.requiresTechId)).length
    ), 0);
    const compliance = Math.max(62, 88 - lockedCount * 2);
    return `
      <section class="governmentSidePanel">
        <div class="governmentSideTitle"><span>COM</span><strong>Galactic Community Law Compliance</strong></div>
        <div class="governmentComplianceRows">
          ${this.renderComplianceRow("Trade Charter Compliance", "Compliant", "positive")}
          ${this.renderComplianceRow("Environmental Accord", "Partial", "neutral")}
          ${this.renderComplianceRow("Research Ethics Protocol", "Compliant", "positive")}
          ${this.renderComplianceRow("Military Oversight Mandate", "Under Review", "negative")}
        </div>
        <div class="governmentComplianceBar"><span>Overall Compliance</span><i><b style="width:${compliance}%"></b></i><strong>${compliance}%</strong></div>
      </section>
    `;
  }

  private renderComplianceRow(label: string, value: string, polarity: EffectRow["polarity"]): string {
    return `<div class="${polarity}"><span>${this.escapeHtml(label)}</span><strong>${this.escapeHtml(value)}</strong></div>`;
  }

  private renderSanctionsPanel(): string {
    return `
      <section class="governmentSidePanel">
        <div class="governmentSideTitle"><span>SAN</span><strong>Galactic Community Sanctions</strong></div>
        <div class="governmentSanctionGrid">
          <span>Active Sanctions</span><strong class="negative">0</strong>
          <span>Warning Notices</span><strong class="neutral">0</strong>
          <span>Trade Penalty Risk</span><strong class="positive">Low</strong>
          <span>Embargo Status</span><strong class="positive">None</strong>
        </div>
      </section>
    `;
  }

  private getAssignedPosition(data: GovernmentPanelData, positionId: GovernmentPositionId): LeaderState | null {
    const factionId = data.playerFactionId ?? -1;
    return factionId >= 0 ? getAssignedGovernmentLeader(data.leaders, factionId, positionId) : null;
  }

  private getOpenPositionCount(data: GovernmentPanelData): number {
    return GOVERNMENT_POSITION_DEFINITIONS.filter((position) => !this.getAssignedPosition(data, position.id)).length;
  }

  private getResearchAllocation(data: GovernmentPanelData): { active: number; passive: number } {
    const allocation = this.getActiveEffectRows(data)
      .find((row) => row.label === "Research Allocation")
      ?.value.match(/(\d+)%.*?(\d+)%/);
    if (!allocation) return { active: 0.8, passive: 0.2 };
    return { active: Number(allocation[1]) / 100, passive: Number(allocation[2]) / 100 };
  }

  private sumEmpireStat(data: GovernmentPanelData, stat: GovernmentEmpireStat): number {
    let total = 0;
    for (const { effect, scale } of this.getActiveEffects(data)) {
      if (effect.type === "empireStat" && effect.stat === stat) total += effect.value * scale;
    }
    return total;
  }

  private getActiveEffectRows(data: GovernmentPanelData): EffectRow[] {
    return this.getActiveEffects(data).flatMap(({ effect, scale, source }) => this.describeEffect(effect, scale, source));
  }

  private getPositionEffectRows(position: GovernmentPositionDefinition, leader: LeaderState): EffectRow[] {
    const rows = position.levelEffects.flatMap((effect) => this.describeEffect(effect, Math.max(1, leader.level), position.title));
    const leaderScale = 1 + Math.max(0, leader.level - 1) * 0.01;
    for (const traitId of leader.traits) {
      const trait = getLeaderTraitDefinition(traitId);
      for (const traitEffect of trait.governmentEffects ?? []) {
        if (traitEffect.positionId && traitEffect.positionId !== "any" && traitEffect.positionId !== position.id) continue;
        rows.push(...traitEffect.effects.flatMap((effect) => this.describeEffect(effect, leaderScale, trait.name)));
      }
    }
    return rows;
  }

  private getActiveEffects(data: GovernmentPanelData): Array<{ effect: GovernmentEffect; scale: number; source: string }> {
    const effects: Array<{ effect: GovernmentEffect; scale: number; source: string }> = [];
    if (data.government) {
      for (const { law, option } of getSelectedGovernmentLawOptions(data.government)) {
        for (const effect of option.effects) effects.push({ effect, scale: 1, source: `law:${law.id}` });
      }
    }
    for (const position of GOVERNMENT_POSITION_DEFINITIONS) {
      const leader = this.getAssignedPosition(data, position.id);
      if (!leader || leader.class !== position.requiredClass) continue;
      for (const effect of position.levelEffects) effects.push({ effect, scale: Math.max(1, leader.level), source: `cabinet:${position.id}` });
      const leaderScale = 1 + Math.max(0, leader.level - 1) * 0.01;
      for (const traitId of leader.traits) {
        const trait = getLeaderTraitDefinition(traitId);
        for (const traitEffect of trait.governmentEffects ?? []) {
          if (traitEffect.positionId && traitEffect.positionId !== "any" && traitEffect.positionId !== position.id) continue;
          for (const effect of traitEffect.effects) effects.push({ effect, scale: leaderScale, source: `cabinet:${position.id}:${trait.id}` });
        }
      }
    }
    return effects;
  }

  private describeEffect(effect: GovernmentEffect, scale: number, source: string): EffectRow[] {
    if (effect.type === "planetModifier") {
      const value = effect.value * scale;
      return [{
        label: this.getPlanetTargetLabel(effect.target),
        value: effect.operation === "multiply" ? this.formatSignedPercent(value) : this.formatSignedNumber(value),
        source,
        polarity: this.getPolarity(effect.target === "crime" ? -value : value),
      }];
    }
    if (effect.type === "fleetModifier") {
      const value = effect.value * scale;
      return [{
        label: this.getFleetTargetLabel(effect.target),
        value: this.formatSignedPercent(value),
        source,
        polarity: this.getPolarity(effect.target === "upkeep" ? -value : value),
      }];
    }
    if (effect.type === "researchSpeed") {
      const value = effect.value * scale;
      return [{ label: "Research Speed", value: this.formatSignedPercent(value), source, polarity: this.getPolarity(value) }];
    }
    if (effect.type === "researchAllocation") {
      return [{
        label: "Research Allocation",
        value: `${Math.round(effect.activeFraction * 100)}% selected / ${Math.round(effect.passiveFraction * 100)}% natural`,
        source,
        polarity: "neutral",
      }];
    }
    if (effect.type === "empireStat") {
      const value = effect.value * scale;
      return [{ label: this.getEmpireStatLabel(effect.stat), value: this.formatEmpireStatValue(effect.stat, value), source, polarity: this.getPolarity(value) }];
    }
    const enabled = effect.enabled !== false;
    return [{ label: "Flag", value: `${enabled ? "+" : "-"}${effect.flag}`, source, polarity: enabled ? "positive" : "negative" }];
  }

  private getPlanetTargetLabel(target: string): string {
    if (target === "jobOutput") return "Resource Output";
    if (target === "constructionSpeed") return "Construction Speed";
    if (target === "populationGrowth") return "Population Growth";
    if (target === "stability") return "Stability";
    if (target === "happiness") return "Happiness";
    if (target === "crime") return "Crime";
    if (target.startsWith("jobOutput:miner:minerals")) return "Mineral Output";
    if (target.startsWith("jobOutput:metallurgist:alloys")) return "Alloy Output";
    return target.replace(/:/g, " ");
  }

  private getFleetTargetLabel(target: GovernmentFleetModifierTarget): string {
    if (target === "attack") return "Fleet Combat Strength";
    if (target === "speed") return "Fleet Speed";
    if (target === "shield") return "Fleet Shield Endurance";
    if (target === "upkeep") return "Ship Upkeep";
    return "Fleet Evasion";
  }

  private getEmpireStatLabel(stat: GovernmentEmpireStat): string {
    const labels: Record<GovernmentEmpireStat, string> = {
      administrativeEfficiency: "Administrative Efficiency",
      unity: "Unity",
      tradeValue: "Trade Value",
      defenseStrength: "Defense Strength",
      diplomaticRelations: "Diplomatic Relations",
      aiEfficiency: "AI Efficiency",
      frontierGrowth: "Frontier Growth",
    };
    return labels[stat];
  }

  private formatEmpireStatValue(stat: GovernmentEmpireStat, value: number): string {
    if (stat === "diplomaticRelations") return this.formatSignedNumber(value);
    return this.formatSignedPercent(value);
  }

  private getPolarity(value: number): EffectRow["polarity"] {
    if (value > 0.0001) return "positive";
    if (value < -0.0001) return "negative";
    return "neutral";
  }

  private formatSignedPercent(value: number): string {
    return `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
  }

  private formatSignedNumber(value: number): string {
    return `${value >= 0 ? "+" : ""}${Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "")}`;
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

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.governmentPanel {
  position: fixed;
  z-index: 99;
  left: 50%;
  top: 50%;
  width: min(1220px, calc(100vw - 72px));
  height: min(760px, calc(100vh - 46px));
  transform: translate(-50%, -50%);
  pointer-events: auto;
  color: #d7eef3;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
}

.governmentFrame {
  height: 100%;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  border: 1px solid color-mix(in srgb, var(--panel-accent) 76%, transparent);
  background:
    radial-gradient(circle at 70% 18%, color-mix(in srgb, var(--panel-accent) 12%, transparent), transparent 20rem),
    linear-gradient(180deg, rgba(7, 20, 24, 0.985), rgba(2, 9, 12, 0.99));
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.58), inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  overflow: hidden;
}

.governmentContent,
.governmentLawsList,
.governmentSideStack {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--panel-accent) 45%, transparent) transparent;
}
.governmentContent::-webkit-scrollbar,
.governmentLawsList::-webkit-scrollbar,
.governmentSideStack::-webkit-scrollbar { width: 7px; }
.governmentContent::-webkit-scrollbar-thumb,
.governmentLawsList::-webkit-scrollbar-thumb,
.governmentSideStack::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--panel-accent) 40%, transparent);
  border-radius: 999px;
}

.governmentHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 62px;
  padding: 9px 12px 9px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--panel-accent) 28%, transparent);
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--panel-accent) 22%, rgba(6, 20, 23, 0.92)),
    rgba(3, 11, 14, 0.94));
}

.governmentIdentity {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.governmentBadge,
.governmentSummaryIcon,
.governmentLawIcon {
  display: grid;
  place-items: center;
  border: 1px solid rgba(54, 230, 255, 0.64);
  background: rgba(0, 156, 188, 0.16);
  color: #12efff;
  font-weight: 900;
}

.governmentBadge {
  width: 36px;
  height: 36px;
  clip-path: polygon(50% 0, 94% 25%, 94% 75%, 50% 100%, 6% 75%, 6% 25%);
  font-size: 13px;
}

.governmentTitle {
  color: #f4fbff;
  font-size: 22px;
  font-weight: 900;
}

.governmentSubtitle {
  margin-top: 3px;
  color: rgba(190, 209, 221, 0.78);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.governmentClose {
  width: 36px;
  height: 36px;
  border: 1px solid rgba(0, 232, 255, 0.62);
  background: rgba(2, 25, 36, 0.86);
  color: #12efff;
  font: inherit;
  font-size: 18px;
  cursor: pointer;
}

.governmentSummary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  margin: 9px 12px 0;
  border: 1px solid rgba(0, 216, 255, 0.28);
  background: rgba(2, 20, 29, 0.72);
}

.governmentSummaryItem {
  min-width: 0;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 54px;
  padding: 9px 14px;
}

.governmentSummaryItem + .governmentSummaryItem {
  border-left: 1px solid rgba(0, 216, 255, 0.22);
}

.governmentSummaryIcon {
  width: 30px;
  height: 30px;
  font-size: 9px;
}

.governmentSummaryItem small,
.governmentLeaderRole,
.governmentSideTitle,
.governmentLawHeader strong {
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.governmentSummaryItem small {
  display: block;
  color: rgba(181, 204, 216, 0.75);
  font-size: 9px;
}

.governmentSummaryItem strong {
  display: block;
  margin-top: 4px;
  color: #f7fbff;
  font-size: 14px;
}

.governmentPanel .positive { color: #a4f76b !important; }
.governmentPanel .negative { color: #ff9a8a !important; }
.governmentPanel .neutral { color: #ffd766 !important; }

.governmentTabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 320px));
  gap: 8px;
  padding: 10px 12px 0;
}

.governmentTab {
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border: 1px solid rgba(0, 216, 255, 0.28);
  background: rgba(2, 18, 27, 0.72);
  color: rgba(205, 225, 235, 0.72);
  font: inherit;
  cursor: pointer;
}

.governmentTab.active {
  color: #12efff;
  border-color: rgba(0, 232, 255, 0.74);
  background: linear-gradient(180deg, rgba(0, 148, 176, 0.24), rgba(2, 24, 34, 0.9));
  box-shadow: inset 0 0 22px rgba(0, 232, 255, 0.12);
}

.governmentContent {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 310px;
  gap: 12px;
  padding: 12px;
  overflow: hidden;
}

.governmentLeaderGrid {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-width: thin;
}

.governmentLeaderCard {
  min-width: 0;
  min-height: 220px;
  display: grid;
  grid-template-columns: 148px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 10px;
  border: 1px solid rgba(0, 216, 255, 0.32);
  background:
    linear-gradient(90deg, rgba(5, 38, 50, 0.84), rgba(3, 14, 21, 0.92)),
    radial-gradient(circle at 20% 0%, rgba(0, 232, 255, 0.1), transparent 12rem);
  padding: 10px;
}

.governmentLeaderPortrait {
  grid-row: 1 / span 2;
  min-height: 190px;
  display: grid;
  place-items: center;
  align-self: stretch;
  border: 1px solid rgba(0, 216, 255, 0.34);
  background:
    radial-gradient(circle at 50% 28%, rgba(214, 250, 255, 0.18), transparent 32%),
    linear-gradient(150deg, rgba(22, 70, 86, 0.95), rgba(9, 20, 28, 0.96));
  background-size: cover;
  background-position: center;
  overflow: hidden;
}

.governmentLeaderPortrait.military {
  background:
    radial-gradient(circle at 50% 28%, rgba(255, 226, 188, 0.2), transparent 32%),
    linear-gradient(150deg, rgba(86, 62, 48, 0.95), rgba(12, 19, 28, 0.96));
}

.governmentLeaderPortrait span {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border: 1px solid rgba(210, 250, 255, 0.36);
  background: rgba(0, 0, 0, 0.25);
  color: rgba(240, 252, 255, 0.88);
  font-size: 18px;
  font-weight: 900;
}

.governmentLeaderMain {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 7px;
}

.governmentLeaderRole {
  color: #12efff;
  font-size: 10px;
  font-weight: 900;
}

.governmentLeaderName {
  min-width: 0;
  color: #f4fbff;
  font-size: 17px;
  font-weight: 900;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.governmentLeaderMeta,
.governmentLevelEffect,
.governmentMiniEffects span,
.governmentLawHeader small,
.governmentLawHeader em,
.governmentLawOption small {
  color: rgba(201, 221, 230, 0.76);
  font-size: 10px;
  line-height: 1.35;
}

.governmentTraitRow {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-height: 24px;
}

.governmentTrait {
  max-width: 100%;
  padding: 4px 7px;
  border: 1px solid rgba(143, 156, 171, 0.32);
  background: rgba(8, 18, 27, 0.74);
  color: rgba(213, 225, 235, 0.78);
  font-size: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.governmentTrait.active {
  color: #c793ff;
  border-color: rgba(199, 147, 255, 0.62);
  background: rgba(50, 23, 70, 0.58);
}

.governmentTrait.empty {
  color: rgba(181, 204, 216, 0.55);
}

.governmentMiniEffects {
  display: grid;
  gap: 4px;
}

.governmentMiniEffects span {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 5px 6px;
  border: 1px solid rgba(0, 216, 255, 0.18);
  background: rgba(1, 11, 17, 0.58);
}

.governmentMiniEffects em {
  min-width: 0;
  font-style: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.governmentMiniEffects strong {
  white-space: nowrap;
}

.governmentLeaderActions {
  grid-column: 2;
  display: flex;
  gap: 7px;
  align-self: end;
}

.governmentLeaderActions button {
  min-height: 30px;
  flex: 1 1 0;
  border: 1px solid rgba(0, 216, 255, 0.42);
  background: rgba(2, 29, 41, 0.86);
  color: #12efff;
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}

.governmentLawsList {
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 7px;
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-width: thin;
}

.governmentLaw {
  border: 1px solid rgba(0, 216, 255, 0.26);
  background: rgba(2, 18, 27, 0.72);
}

.governmentLaw.expanded {
  border-color: rgba(0, 232, 255, 0.68);
  box-shadow: inset 0 0 22px rgba(0, 232, 255, 0.08);
}

.governmentLawHeader {
  width: 100%;
  min-height: 46px;
  display: grid;
  grid-template-columns: 44px 250px 170px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border: 0;
  background: linear-gradient(90deg, rgba(5, 35, 48, 0.84), rgba(2, 15, 22, 0.9));
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.governmentLawHeader strong {
  color: rgba(235, 245, 250, 0.92);
  font-size: 13px;
}

.governmentLawHeader em {
  color: #12efff;
  font-style: normal;
  font-weight: 800;
}

.governmentLawHeader i {
  color: #d9faff;
  font-style: normal;
  text-align: right;
}

.governmentLawIcon {
  width: 28px;
  height: 28px;
  font-size: 8px;
}

.governmentLawOptions {
  display: grid;
  gap: 5px;
  padding: 7px 12px 10px 18px;
}

.governmentLawOption button {
  width: 100%;
  min-height: 42px;
  display: grid;
  grid-template-columns: 20px minmax(0, 1.1fr) minmax(0, 1.3fr) auto;
  align-items: center;
  gap: 9px;
  border: 1px solid rgba(0, 216, 255, 0.25);
  background: rgba(1, 12, 18, 0.78);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.governmentLawOption button:disabled {
  cursor: default;
}

.governmentLawOption.active button {
  border-color: rgba(0, 232, 255, 0.78);
  background: rgba(0, 94, 112, 0.2);
}

.governmentLawOption.locked button {
  opacity: 0.58;
}

.governmentRadio {
  width: 14px;
  height: 14px;
  margin-left: 6px;
  border-radius: 50%;
  border: 1px solid rgba(0, 232, 255, 0.68);
  background: rgba(0, 0, 0, 0.42);
}

.governmentLawOption.active .governmentRadio {
  box-shadow: inset 0 0 0 4px rgba(0, 232, 255, 0.9);
}

.governmentLawOptionMain {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.governmentLawOptionMain strong {
  color: #effbff;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.governmentOptionEffects {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.governmentOptionEffects i {
  padding: 3px 5px;
  border: 1px solid rgba(0, 216, 255, 0.18);
  background: rgba(2, 21, 30, 0.72);
  font-size: 9px;
  font-style: normal;
  white-space: nowrap;
}

.governmentLawOption em {
  justify-self: end;
  max-width: 138px;
  color: #12efff;
  font-size: 10px;
  font-style: normal;
  text-align: right;
  overflow-wrap: anywhere;
}

.governmentSideStack {
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 10px;
  overflow-y: auto;
  padding-right: 2px;
}

.governmentSidePanel {
  border: 1px solid rgba(0, 216, 255, 0.32);
  background:
    linear-gradient(180deg, rgba(4, 28, 38, 0.82), rgba(2, 12, 19, 0.88)),
    radial-gradient(circle at 90% 0%, rgba(0, 232, 255, 0.1), transparent 9rem);
  padding: 10px;
}

.governmentSideTitle {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(0, 216, 255, 0.18);
  color: rgba(238, 248, 252, 0.9);
  font-size: 11px;
}

.governmentSideTitle span {
  color: #12efff;
  font-size: 9px;
}

.governmentSideTitle em {
  color: #12efff;
  font-style: normal;
}

.governmentEffectList,
.governmentSynergyList,
.governmentPlaceholderList,
.governmentComplianceRows,
.governmentSanctionGrid {
  display: grid;
  gap: 6px;
  margin-top: 9px;
}

.governmentEffectRow,
.governmentComplianceRows div,
.governmentSanctionGrid {
  font-size: 10px;
}

.governmentEffectRow,
.governmentComplianceRows div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.governmentEffectRow span,
.governmentComplianceRows span,
.governmentSanctionGrid span {
  color: rgba(201, 221, 230, 0.78);
}

.governmentEffectRow strong,
.governmentComplianceRows strong,
.governmentSanctionGrid strong {
  white-space: nowrap;
}

.governmentSynergyList div,
.governmentPlaceholderList div {
  display: grid;
  gap: 2px;
  padding: 7px;
  border: 1px solid rgba(0, 216, 255, 0.18);
  background: rgba(1, 12, 18, 0.56);
}

.governmentSynergyList strong,
.governmentPlaceholderList strong {
  color: #12efff;
  font-size: 10px;
}

.governmentSynergyList div:not(.active) strong {
  color: rgba(170, 188, 198, 0.62);
}

.governmentSynergyList span,
.governmentPlaceholderList span {
  color: rgba(201, 221, 230, 0.72);
  font-size: 10px;
}

.governmentSanctionGrid {
  grid-template-columns: minmax(0, 1fr) auto;
}

.governmentComplianceBar {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 10px;
}

.governmentComplianceBar i {
  height: 7px;
  background: rgba(0, 0, 0, 0.42);
  overflow: hidden;
}

.governmentComplianceBar b {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #12efff, #a4f76b);
}

.governmentEmpty {
  min-height: 42px;
  display: grid;
  place-items: center;
  color: rgba(181, 204, 216, 0.56);
  font-size: 10px;
}

@media (max-width: 980px) {
  .governmentPanel {
    width: calc(100vw - 24px);
    height: calc(100vh - 24px);
  }

  .governmentSummary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .governmentSummaryItem + .governmentSummaryItem {
    border-left: 0;
  }

  .governmentContent {
    grid-template-columns: minmax(0, 1fr);
    overflow-y: auto;
  }

  .governmentLeaderGrid {
    grid-template-columns: minmax(0, 1fr);
    overflow: visible;
  }

  .governmentLawHeader {
    grid-template-columns: 36px minmax(0, 1fr) 24px;
  }

  .governmentLawHeader em,
  .governmentLawHeader small {
    grid-column: 2;
  }

  .governmentLawOptions {
    padding-left: 10px;
  }

  .governmentLawOption button {
    grid-template-columns: 24px minmax(0, 1fr);
  }

  .governmentOptionEffects,
  .governmentLawOption em {
    grid-column: 2;
    justify-self: stretch;
    text-align: left;
  }
}

.governmentPanel {
  --government-accent: rgba(74, 236, 214, 0.95);
  --government-panel-scale: 0.84;
  left: 48px;
  top: 68px;
  width: min(1228px, calc(100vw - 32px));
  height: min(676px, calc(100vh - 32px));
  transform: scale(var(--government-panel-scale));
  transform-origin: top left;
  z-index: 61;
  color: #e9fff9;
  user-select: none;
}

.governmentPanel * {
  box-sizing: border-box;
  letter-spacing: 0;
}

.governmentFrame {
  position: relative;
  height: 100%;
  display: grid;
  grid-template-rows: 66px minmax(0, 1fr) 52px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--government-accent) 76%, transparent);
  background:
    radial-gradient(circle at 24% 0%, color-mix(in srgb, var(--government-accent) 13%, transparent), transparent 17rem),
    radial-gradient(circle at 82% 18%, rgba(240, 214, 93, 0.1), transparent 18rem),
    linear-gradient(180deg, rgba(4, 27, 30, 0.98), rgba(1, 11, 14, 0.99));
  box-shadow: 0 28px 82px rgba(0, 0, 0, 0.58), inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.governmentFrame::before,
.governmentFrame::after {
  content: "";
  position: absolute;
  z-index: 5;
  pointer-events: none;
}

.governmentFrame::before {
  inset: 0;
  border: 1px solid rgba(62, 255, 226, 0.12);
  clip-path: polygon(0 24px, 24px 0, 36% 0, 37% 6px, 64% 6px, 65% 0, calc(100% - 24px) 0, 100% 24px, 100% 100%, 0 100%);
}

.governmentFrame::after {
  left: 14px;
  right: 14px;
  top: 62px;
  height: 1px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--government-accent) 76%, transparent), transparent);
}

.governmentHeader {
  min-width: 0;
  min-height: 0;
  padding: 9px 14px 8px;
  cursor: grab;
  background:
    radial-gradient(circle at 23% -20%, color-mix(in srgb, var(--government-accent) 20%, transparent), transparent 13rem),
    linear-gradient(90deg, rgba(7, 52, 55, 0.9), rgba(4, 19, 24, 0.95));
  border-bottom: 1px solid rgba(87, 250, 223, 0.27);
}

.governmentIdentity {
  gap: 12px;
}

.governmentBadge,
.governmentSummaryIcon,
.governmentLawIcon {
  border: 1px solid color-mix(in srgb, var(--government-accent) 54%, transparent);
  background:
    radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--government-accent) 18%, transparent), transparent 72%),
    rgba(3, 32, 37, 0.86);
  color: color-mix(in srgb, var(--government-accent) 82%, #ffffff 18%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03), 0 0 14px color-mix(in srgb, var(--government-accent) 13%, transparent);
}

.governmentBadge {
  width: 39px;
  height: 39px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--government-accent) 86%, #ffffff 14%), #f0d65d);
  color: #061413;
  font-size: 15px;
  box-shadow: 0 0 18px color-mix(in srgb, var(--government-accent) 28%, transparent), inset 0 0 0 2px rgba(5, 25, 31, 0.36);
}

.governmentTitle {
  color: #eafff8;
  font-size: 22px;
  font-weight: 950;
  line-height: 1.1;
}

.governmentSubtitle {
  margin-top: 3px;
  color: rgba(204, 236, 229, 0.7);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

.governmentClose {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(98, 255, 228, 0.56);
  background: rgba(6, 43, 43, 0.72);
  color: #bffff4;
  font-weight: 900;
}

.governmentClose:hover {
  color: #ffffff;
  border-color: rgba(141, 255, 236, 0.9);
  background: rgba(10, 65, 61, 0.84);
}

.governmentBody {
  min-height: 0;
  display: grid;
  grid-template-rows: 76px minmax(0, 1fr);
  gap: 10px;
  padding: 8px 12px 0;
}

.governmentSummary {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  border: 0;
  background: transparent;
}

.governmentSummaryItem {
  min-height: 68px;
  grid-template-columns: 46px minmax(0, 1fr);
  gap: 10px;
  padding: 9px 13px;
  border: 1px solid rgba(70, 225, 211, 0.32);
  background:
    linear-gradient(90deg, rgba(6, 46, 48, 0.72), rgba(2, 20, 25, 0.82)),
    linear-gradient(180deg, color-mix(in srgb, var(--government-accent) 4%, transparent), transparent);
}

.governmentSummaryItem + .governmentSummaryItem {
  border-left: 1px solid rgba(70, 225, 211, 0.32);
}

.governmentSummaryIcon {
  width: 38px;
  height: 38px;
  font-size: 11px;
  font-weight: 950;
}

.governmentSummaryItem small {
  color: rgba(209, 236, 231, 0.72);
  font-size: 10px;
  font-weight: 850;
}

.governmentSummaryItem strong {
  color: #f4fffb;
  font-size: 18px;
  font-weight: 950;
  line-height: 1;
}

.governmentPanel .positive { color: #aaf86b !important; }
.governmentPanel .negative { color: #ff7b70 !important; }
.governmentPanel .neutral { color: #ffe04f !important; }

.governmentTabs {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  padding: 8px 0 0;
}

.governmentTab {
  min-width: 0;
  min-height: 0;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border: 1px solid rgba(76, 223, 197, 0.32);
  background: rgba(3, 26, 29, 0.72);
  color: rgba(205, 236, 230, 0.72);
  font-size: 13px;
  font-weight: 950;
}

.governmentTab span {
  width: 28px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(70, 225, 211, 0.32);
  color: color-mix(in srgb, var(--government-accent) 88%, #ffffff 12%);
  background: rgba(4, 30, 34, 0.58);
  font-size: 9px;
}

.governmentTab.active {
  color: #eafff8;
  border-color: color-mix(in srgb, var(--government-accent) 78%, transparent);
  background:
    radial-gradient(circle at 50% 100%, color-mix(in srgb, var(--government-accent) 24%, transparent), transparent 13rem),
    rgba(7, 56, 55, 0.82);
}

.governmentTab.active span {
  color: #061413;
  background: linear-gradient(135deg, color-mix(in srgb, var(--government-accent) 86%, #ffffff 14%), #f0d65d);
}

.governmentContent {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 318px;
  gap: 8px;
  padding: 0;
  overflow: hidden;
}

.governmentLeaderGrid,
.governmentLawsList,
.governmentSideStack {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--government-accent) 58%, transparent) rgba(0, 0, 0, 0.26);
}

.governmentLeaderGrid {
  gap: 8px;
}

.governmentLeaderCard {
  min-height: 216px;
  grid-template-columns: 138px minmax(0, 1fr);
  gap: 10px;
  border: 1px solid rgba(70, 225, 211, 0.3);
  background:
    linear-gradient(90deg, rgba(6, 45, 47, 0.72), rgba(2, 20, 25, 0.9)),
    repeating-linear-gradient(90deg, rgba(75, 255, 231, 0.04) 0 1px, transparent 1px 96px);
  padding: 8px;
}

.governmentLeaderCard.filled {
  border-color: color-mix(in srgb, var(--government-accent) 42%, transparent);
}

.governmentLeaderCard.empty {
  border-style: dashed;
  background: rgba(3, 23, 27, 0.58);
}

.governmentLeaderPortrait {
  min-height: 190px;
  border: 1px solid rgba(97, 255, 229, 0.46);
  background:
    radial-gradient(circle at 50% 23%, rgba(240, 255, 252, 0.2), transparent 26%),
    linear-gradient(145deg, rgba(64, 118, 106, 0.9), rgba(17, 31, 35, 0.95));
  background-size: cover;
  background-position: center;
}

.governmentLeaderPortrait.military {
  background:
    radial-gradient(circle at 50% 23%, rgba(255, 230, 190, 0.22), transparent 26%),
    linear-gradient(145deg, rgba(104, 83, 70, 0.95), rgba(22, 27, 34, 0.94));
}

.governmentLeaderPortrait span {
  width: 52px;
  height: 52px;
  border: 1px solid rgba(210, 250, 255, 0.36);
  color: rgba(238, 255, 250, 0.88);
  font-size: 16px;
}

.governmentLeaderRole {
  color: color-mix(in srgb, var(--government-accent) 88%, #ffffff 12%);
  font-size: 10px;
  font-weight: 950;
}

.governmentLeaderName {
  color: #f0d65d;
  font-size: 16px;
  font-weight: 950;
}

.governmentLeaderMeta,
.governmentLevelEffect,
.governmentMiniEffects span,
.governmentLawHeader small,
.governmentLawHeader em,
.governmentLawOption small {
  color: rgba(205, 235, 229, 0.72);
  font-size: 10px;
}

.governmentTrait {
  border: 1px solid rgba(64, 233, 211, 0.24);
  background: rgba(3, 23, 27, 0.72);
  color: rgba(213, 242, 235, 0.74);
  font-size: 9px;
}

.governmentTrait.active {
  color: #ffe04f;
  border-color: rgba(240, 214, 93, 0.58);
  background: rgba(58, 45, 14, 0.48);
}

.governmentMiniEffects span {
  border: 1px solid rgba(64, 233, 211, 0.2);
  background: rgba(1, 14, 18, 0.58);
}

.governmentLeaderActions button {
  min-height: 30px;
  border: 1px solid rgba(76, 223, 197, 0.42);
  background: rgba(6, 42, 38, 0.72);
  color: #d8fff6;
  font-size: 10px;
  font-weight: 900;
}

.governmentLeaderActions button:hover,
.governmentLawOption button:not(:disabled):hover {
  border-color: rgba(104, 255, 231, 0.8);
  background: rgba(7, 48, 48, 0.86);
}

.governmentLawsList {
  gap: 6px;
}

.governmentLaw {
  border: 1px solid rgba(70, 225, 211, 0.3);
  background:
    linear-gradient(180deg, rgba(4, 28, 32, 0.94), rgba(2, 14, 18, 0.96)),
    repeating-linear-gradient(90deg, rgba(75, 255, 231, 0.04) 0 1px, transparent 1px 96px);
}

.governmentLaw.expanded {
  border-color: color-mix(in srgb, var(--government-accent) 72%, transparent);
  box-shadow: inset 0 0 20px color-mix(in srgb, var(--government-accent) 8%, transparent);
}

.governmentLawHeader {
  min-height: 54px;
  grid-template-columns: 40px minmax(190px, 0.7fr) minmax(150px, 0.55fr) minmax(0, 1fr) 24px;
  gap: 10px;
  padding: 7px 10px;
  background: linear-gradient(90deg, rgba(6, 46, 48, 0.72), rgba(2, 20, 25, 0.86));
}

.governmentLawHeader strong {
  color: #effefa;
  font-size: 12px;
  font-weight: 950;
}

.governmentLawHeader em {
  color: color-mix(in srgb, var(--government-accent) 88%, #ffffff 12%);
  font-weight: 900;
}

.governmentLawHeader i {
  color: #eafff8;
  font-size: 14px;
}

.governmentLawIcon {
  width: 30px;
  height: 30px;
  font-size: 9px;
}

.governmentLawOptions {
  gap: 6px;
  padding: 8px 10px 10px 58px;
}

.governmentLawOption button {
  min-height: 48px;
  grid-template-columns: 24px minmax(170px, 1fr) minmax(220px, 1.25fr) 126px;
  gap: 9px;
  padding: 7px 9px;
  border: 1px solid rgba(70, 225, 211, 0.25);
  background: rgba(1, 14, 18, 0.68);
}

.governmentLawOption.active button {
  border-color: rgba(240, 214, 93, 0.82);
  background:
    radial-gradient(circle at 4% 50%, rgba(240, 214, 93, 0.1), transparent 9rem),
    rgba(4, 31, 33, 0.78);
  box-shadow: inset 0 0 0 1px rgba(240, 214, 93, 0.16);
}

.governmentRadio {
  border-color: color-mix(in srgb, var(--government-accent) 74%, transparent);
}

.governmentLawOption.active .governmentRadio {
  border-color: rgba(240, 214, 93, 0.92);
  box-shadow: inset 0 0 0 4px rgba(240, 214, 93, 0.9);
}

.governmentLawOptionMain strong {
  color: #f2fffb;
  font-size: 12px;
  font-weight: 950;
}

.governmentOptionEffects i {
  border: 1px solid rgba(70, 225, 211, 0.18);
  background: rgba(4, 30, 34, 0.52);
  font-size: 9px;
}

.governmentLawOption em {
  color: color-mix(in srgb, var(--government-accent) 88%, #ffffff 12%);
  font-weight: 900;
}

.governmentSideStack {
  gap: 8px;
}

.governmentSidePanel {
  border: 1px solid rgba(70, 225, 211, 0.3);
  background:
    linear-gradient(180deg, rgba(4, 28, 32, 0.94), rgba(2, 14, 18, 0.96)),
    repeating-linear-gradient(90deg, rgba(75, 255, 231, 0.04) 0 1px, transparent 1px 96px);
  padding: 10px;
}

.governmentSideTitle {
  grid-template-columns: 34px minmax(0, 1fr) auto;
  border-bottom: 1px solid rgba(70, 225, 211, 0.2);
  color: #effefa;
  font-size: 11px;
  font-weight: 950;
}

.governmentSideTitle span {
  min-height: 24px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(70, 225, 211, 0.28);
  background: rgba(4, 30, 34, 0.58);
  color: color-mix(in srgb, var(--government-accent) 88%, #ffffff 12%);
  font-size: 9px;
}

.governmentSideTitle em {
  color: #f0d65d;
  font-weight: 950;
}

.governmentEffectRow span,
.governmentComplianceRows span,
.governmentSanctionGrid span,
.governmentSynergyList span,
.governmentPlaceholderList span {
  color: rgba(205, 235, 229, 0.7);
}

.governmentSynergyList div,
.governmentPlaceholderList div {
  border: 1px solid rgba(70, 225, 211, 0.18);
  background: rgba(4, 30, 34, 0.5);
}

.governmentSynergyList strong,
.governmentPlaceholderList strong {
  color: color-mix(in srgb, var(--government-accent) 88%, #ffffff 12%);
  font-weight: 950;
}

.governmentComplianceBar i {
  border: 1px solid rgba(70, 225, 211, 0.14);
  background: rgba(0, 0, 0, 0.42);
}

.governmentComplianceBar b {
  background: linear-gradient(90deg, color-mix(in srgb, var(--government-accent) 86%, #ffffff 14%), #aaf86b);
}

@media (max-width: 1040px) {
  .governmentPanel {
    --government-panel-scale: 0.76;
  }
}

@media (max-width: 980px) {
  .governmentPanel {
    width: calc(100vw - 16px);
    height: calc(100vh - 16px);
  }

  .governmentFrame {
    grid-template-rows: 62px minmax(0, 1fr) 52px;
  }

  .governmentBody {
    grid-template-rows: auto minmax(0, 1fr);
    padding: 8px 8px 0;
  }

  .governmentSummary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .governmentSummaryItem + .governmentSummaryItem {
    border-left: 0;
  }

  .governmentContent {
    grid-template-columns: minmax(0, 1fr);
    overflow-y: auto;
  }

  .governmentLeaderGrid,
  .governmentSideStack {
    overflow: visible;
  }

  .governmentLeaderCard {
    grid-template-columns: 112px minmax(0, 1fr);
  }

  .governmentLeaderPortrait {
    min-height: 164px;
  }

  .governmentLawHeader {
    grid-template-columns: 36px minmax(0, 1fr) 24px;
  }

  .governmentLawHeader em,
  .governmentLawHeader small {
    grid-column: 2;
  }

  .governmentLawOptions {
    padding-left: 10px;
  }

  .governmentLawOption button {
    grid-template-columns: 24px minmax(0, 1fr);
  }

  .governmentOptionEffects,
  .governmentLawOption em {
    grid-column: 2;
    justify-self: stretch;
    text-align: left;
  }
}
`;
    document.head.appendChild(style);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private escapeAttribute(value: string): string {
    return this.escapeHtml(value).replace(/`/g, "&#096;");
  }
}
