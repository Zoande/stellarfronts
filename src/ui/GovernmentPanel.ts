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
  private expandedLawId: GovernmentLawId = "researchCharter";
  private pendingRefreshData: GovernmentPanelData | null = null;
  private pendingRefreshTimer: number | null = null;
  private readonly interactionGate = new PanelInteractionGate();

  constructor() {
    this.root = document.getElementById("spaceHudRoot") as HTMLDivElement;
    if (!this.root) {
      this.root = document.createElement("div");
      this.root.id = "spaceHudRoot";
      document.body.appendChild(this.root);
    }
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
    this.panelElement.innerHTML = this.render(data);
    this.bindEvents(data);
    restoreScrollStateSoon(this.panelElement, scrollState);
  }

  public refresh(data: GovernmentPanelData): void {
    if (!this.panelElement) return;
    this.currentData = data;
    if (this.interactionGate.isBusy(this.panelElement)) {
      this.pendingRefreshData = data;
      this.schedulePendingRefresh();
      return;
    }
    this.show(data);
  }

  public close(): void {
    const onClose = this.currentData?.onClose;
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
      if (this.interactionGate.isBusy(this.panelElement)) {
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
        this.expandedLawId = this.expandedLawId === lawId ? "researchCharter" : lawId;
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

  private render(data: GovernmentPanelData): string {
    const factionName = data.factionName ?? "No faction selected";
    const effects = this.getActiveEffectRows(data);
    const adminEffect = this.sumEmpireStat(data, "administrativeEfficiency");
    const allocation = this.getResearchAllocation(data);
    const openPositions = this.getOpenPositionCount(data);

    return `
      <div class="governmentFrame">
        <header class="governmentHeader">
          <div class="governmentIdentity">
            <div class="governmentBadge">G</div>
            <div>
              <div class="governmentTitle">Government</div>
              <div class="governmentSubtitle">${this.escapeHtml(factionName)} Executive Council</div>
            </div>
          </div>
          <button class="governmentClose" type="button" data-government-close aria-label="Close government panel">X</button>
        </header>
        <section class="governmentSummary">
          ${this.renderSummaryItem("Government Type", "Technocratic Republic", "GOV")}
          ${this.renderSummaryItem("Governance Effectiveness", this.formatSignedPercent(adminEffect), "EFF", adminEffect)}
          ${this.renderSummaryItem("Research Allocation", `${Math.round(allocation.active * 100)} / ${Math.round(allocation.passive * 100)}`, "RES")}
          ${this.renderSummaryItem("Open Positions", String(openPositions), "POS", -openPositions)}
        </section>
        <nav class="governmentTabs">
          ${this.renderTab("leaders", "Leaders")}
          ${this.renderTab("laws", "Laws")}
        </nav>
        <main class="governmentContent ${this.activeTab}">
          ${this.activeTab === "leaders" ? this.renderLeadersTab(data, effects) : this.renderLawsTab(data, effects)}
        </main>
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
  border: 1px solid rgba(0, 216, 255, 0.5);
  background:
    radial-gradient(circle at 80% 0%, rgba(0, 216, 255, 0.14), transparent 22rem),
    linear-gradient(180deg, rgba(3, 17, 25, 0.98), rgba(2, 8, 13, 0.98));
  box-shadow: 0 22px 64px rgba(0, 0, 0, 0.62), inset 0 0 44px rgba(0, 216, 255, 0.08);
  overflow: hidden;
}

.governmentHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 62px;
  padding: 9px 12px 9px 16px;
  border-bottom: 1px solid rgba(0, 216, 255, 0.24);
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
  padding: 7px 10px 10px 72px;
}

.governmentLawOption button {
  width: 100%;
  min-height: 42px;
  display: grid;
  grid-template-columns: 24px minmax(170px, 1fr) minmax(220px, 1.4fr) 138px;
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
