import type { FactionInfo } from "../data/Factions";
import type { PlanetState } from "../data/Economy";
import type { StarData } from "../data/StarMap";
import {
  formatLeaderClass,
  getLeaderTraitDefinition,
  leaderXpForLevel,
} from "../data/Leaders";
import { getGovernmentPositionDefinition } from "../data/Government";
import type { GovernmentPositionId } from "../data/Government";
import type { LeaderClass, LeaderState } from "../data/Leaders";
import type { ClientCommand, ServerFleet } from "../game/GameProtocol";
import { PanelInteractionGate, captureScrollState, restoreScrollStateSoon } from "./panelDomState";
import type { LeaderAssignmentTarget } from "./leaderEvents";

export interface LeadersPanelData {
  leaders: LeaderState[];
  fleets: ServerFleet[];
  stars: StarData[];
  planetStates: PlanetState[];
  factions: FactionInfo[];
  playerFactionId: number | null;
  factionName?: string;
  clockYear: number;
  assignmentTarget?: LeaderAssignmentTarget | null;
  onLeaderCommand?: (command: ClientCommand) => void;
  onClose?: () => void;
}

type LeaderTab = "all" | "civilian" | "military";

const STYLE_ID = "leaders-panel-style";
const LEADERS_SCROLL_SELECTORS = [".leadersListPane", ".leaderDetailBody"] as const;

export class LeadersPanel {
  private root: HTMLDivElement;
  private panelElement: HTMLDivElement | null = null;
  private currentData: LeadersPanelData | null = null;
  private selectedLeaderId: string | null = null;
  private activeTab: LeaderTab = "all";
  private position = { x: 38, y: 52 };
  private dragOffset = { x: 0, y: 0 };
  private isDragging = false;
  private pendingRefreshData: LeadersPanelData | null = null;
  private pendingRefreshTimer: number | null = null;
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

  public show(data: LeadersPanelData): void {
    this.currentData = data;
    this.ensureSelection(data);
    const scrollState = captureScrollState(this.panelElement, LEADERS_SCROLL_SELECTORS);
    if (!this.panelElement) {
      this.panelElement = document.createElement("div");
      this.panelElement.className = "leadersPanel";
      this.root.appendChild(this.panelElement);
    }
    this.interactionGate.bind(this.panelElement);
    this.panelElement.innerHTML = this.render(data);
    this.applyPosition();
    this.bindEvents(data);
    restoreScrollStateSoon(this.panelElement, scrollState);
  }

  public refresh(data: LeadersPanelData): void {
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

  private ensureSelection(data: LeadersPanelData): void {
    const visible = this.getVisibleLeaders(data);
    const selected = visible.find((leader) => leader.id === this.selectedLeaderId);
    if (selected) return;
    const target = data.assignmentTarget;
    this.selectedLeaderId = visible.find((leader) => (
      target && leader.class === target.requiredClass && leader.status !== "dead"
    ))?.id ?? visible[0]?.id ?? null;
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

  private bindEvents(data: LeadersPanelData): void {
    if (!this.panelElement) return;
    this.panelElement.querySelector<HTMLButtonElement>("[data-leaders-close]")?.addEventListener("click", () => this.close());
    this.panelElement.querySelector<HTMLElement>("[data-leaders-drag]")?.addEventListener("pointerdown", (ev) => {
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
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-leader-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.dataset.leaderTab as LeaderTab | undefined;
        if (!tab) return;
        this.activeTab = tab;
        this.selectedLeaderId = null;
        this.show(data);
      });
    });
    this.panelElement.querySelectorAll<HTMLElement>("[data-leader-row]").forEach((row) => {
      row.addEventListener("click", () => {
        const leaderId = row.dataset.leaderRow;
        if (!leaderId) return;
        this.selectedLeaderId = leaderId;
        this.show(data);
      });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-leader-recruit]").forEach((button) => {
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const leaderId = button.dataset.leaderRecruit;
        if (!leaderId) return;
        data.onLeaderCommand?.({ type: "recruitLeader", leaderId });
      });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-leader-assign]").forEach((button) => {
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const leaderId = button.dataset.leaderAssign;
        if (!leaderId || !data.assignmentTarget) return;
        data.onLeaderCommand?.({
          type: "assignLeader",
          leaderId,
          assignment: {
            kind: data.assignmentTarget.kind,
            targetId: data.assignmentTarget.targetId,
          },
        });
        this.close();
      });
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-leader-unassign]")?.addEventListener("click", () => {
      const leader = this.getSelectedLeader(data);
      if (!leader) return;
      data.onLeaderCommand?.({ type: "assignLeader", leaderId: leader.id, assignment: null });
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-leader-dismiss]")?.addEventListener("click", () => {
      const leader = this.getSelectedLeader(data);
      if (!leader || leader.status !== "recruited") return;
      data.onLeaderCommand?.({ type: "dismissLeader", leaderId: leader.id });
    });
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

  private render(data: LeadersPanelData): string {
    const selected = this.getSelectedLeader(data);
    const recruited = this.getVisibleLeaders(data).filter((leader) => leader.status === "recruited");
    const recruitable = this.getVisibleLeaders(data).filter((leader) => leader.status === "pool");
    const civilianCount = recruited.filter((leader) => leader.class === "civilian").length;
    const militaryCount = recruited.filter((leader) => leader.class === "military").length;
    const assignmentLine = data.assignmentTarget
      ? `<div class="leadersAssignBanner">Assign ${this.escapeHtml(formatLeaderClass(data.assignmentTarget.requiredClass))} to <strong>${this.escapeHtml(data.assignmentTarget.label)}</strong></div>`
      : "";

    return `
      <div class="leadersFrame">
        <header class="leadersHeader" data-leaders-drag>
          <div>
            <div class="leadersTitle">Leaders</div>
            <div class="leadersSubtitle">${this.escapeHtml(data.factionName ?? "No faction selected")}</div>
          </div>
          <button class="leadersClose" type="button" data-leaders-close aria-label="Close leaders panel">X</button>
        </header>
        <nav class="leadersTabs">
          ${this.renderTab("all", "All", recruited.length)}
          ${this.renderTab("civilian", "Officials", civilianCount)}
          ${this.renderTab("military", "Commanders", militaryCount)}
        </nav>
        ${assignmentLine}
        <main class="leadersBody">
          <section class="leadersListPane">
            ${this.renderSection("Your Leaders", recruited, data)}
            ${this.renderSection("Recruitable Leaders", recruitable, data)}
          </section>
          <aside class="leaderDetailPane">
            ${selected ? this.renderDetail(selected, data) : '<div class="leaderEmptyDetail">No leader selected</div>'}
          </aside>
        </main>
      </div>
    `;
  }

  private renderTab(tab: LeaderTab, label: string, count: number): string {
    return `
      <button class="leadersTab ${this.activeTab === tab ? "active" : ""}" type="button" data-leader-tab="${tab}">
        <span>${this.escapeHtml(label)}</span>
        <strong>${count}</strong>
      </button>
    `;
  }

  private renderSection(label: string, leaders: LeaderState[], data: LeadersPanelData): string {
    return `
      <div class="leadersSection">
        <div class="leadersSectionTitle">${this.escapeHtml(label)} <span>${leaders.length}</span></div>
        <div class="leadersRows">
          ${leaders.length > 0
            ? leaders.map((leader) => this.renderLeaderRow(leader, data)).join("")
            : '<div class="leadersEmptyRows">None available</div>'}
        </div>
      </div>
    `;
  }

  private renderLeaderRow(leader: LeaderState, data: LeadersPanelData): string {
    const selected = leader.id === this.selectedLeaderId ? " selected" : "";
    const target = data.assignmentTarget;
    const canAssign = Boolean(target && target.requiredClass === leader.class && leader.status !== "dead");
    const traits = leader.traits.map((trait) => getLeaderTraitDefinition(trait).name).join(" | ");
    const action = canAssign
      ? `<button class="leaderMiniButton assign" type="button" data-leader-assign="${this.escapeHtml(leader.id)}">${leader.status === "pool" ? "Recruit + Assign" : "Assign"}</button>`
      : leader.status === "pool"
        ? `<button class="leaderMiniButton" type="button" data-leader-recruit="${this.escapeHtml(leader.id)}">Recruit</button>`
        : "";

    return `
      <article class="leaderRow${selected}" data-leader-row="${this.escapeHtml(leader.id)}">
        ${this.renderPortrait(leader, "leaderRowPortrait")}
        <div class="leaderRowMain">
          <div class="leaderRowName">${this.escapeHtml(leader.name)}</div>
          <div class="leaderRowMeta">${this.escapeHtml(formatLeaderClass(leader.class))} | Level ${leader.level} | Age ${Math.floor(leader.age)}</div>
          <div class="leaderRowTraits">${this.escapeHtml(traits)}</div>
        </div>
        <div class="leaderRowAssignment">${this.escapeHtml(this.getAssignmentLabel(leader, data))}</div>
        <div class="leaderRowAction">${action}</div>
      </article>
    `;
  }

  private renderDetail(leader: LeaderState, data: LeadersPanelData): string {
    const nextLevelXp = leader.level >= 100 ? leader.xp : leaderXpForLevel(leader.level + 1);
    const currentLevelXp = leaderXpForLevel(leader.level);
    const progress = leader.level >= 100
      ? 100
      : Math.max(0, Math.min(100, ((leader.xp - currentLevelXp) / Math.max(1, nextLevelXp - currentLevelXp)) * 100));
    const canAssign = Boolean(data.assignmentTarget && data.assignmentTarget.requiredClass === leader.class && leader.status !== "dead");
    const assignment = this.getAssignmentLabel(leader, data);
    return `
      <div class="leaderDetailHero">
        <div class="leaderDetailPortraitWrap">
          ${this.renderPortrait(leader, "leaderDetailPortrait")}
          <div class="leaderLevelPip">${leader.level}</div>
        </div>
        <div class="leaderDetailIdentity">
          <div class="leaderDetailName">${this.escapeHtml(leader.name)}</div>
          <div class="leaderDetailRole">${this.escapeHtml(formatLeaderClass(leader.class))}</div>
          <div class="leaderDetailAssignment">${this.escapeHtml(assignment)}</div>
        </div>
      </div>
      <div class="leaderDetailStats">
        <div><span>Age</span><strong>${Math.floor(leader.age)}</strong></div>
        <div><span>Lifespan</span><strong>${Math.floor(leader.lifespan)}</strong></div>
        <div><span>Status</span><strong>${this.escapeHtml(leader.status)}</strong></div>
      </div>
      <div class="leaderXpBar"><i style="width: ${progress}%"></i></div>
      <div class="leaderDetailBody">
        <div class="leaderTraitList">
          ${leader.traits.map((traitId) => {
            const trait = getLeaderTraitDefinition(traitId);
            return `
              <article class="leaderTraitCard">
                <strong>${this.escapeHtml(trait.name)}</strong>
                <span>${this.escapeHtml(trait.description)}</span>
              </article>
            `;
          }).join("")}
        </div>
      </div>
      <div class="leaderDetailActions">
        ${leader.status === "pool" && !data.assignmentTarget ? `<button type="button" data-leader-recruit="${this.escapeHtml(leader.id)}">Recruit Leader</button>` : ""}
        ${canAssign ? `<button type="button" data-leader-assign="${this.escapeHtml(leader.id)}">${leader.status === "pool" ? "Recruit + Assign" : "Assign Leader"}</button>` : ""}
        ${leader.assignment ? '<button type="button" data-leader-unassign>Unassign</button>' : ""}
        ${leader.status === "recruited" ? '<button class="danger" type="button" data-leader-dismiss>Dismiss Leader</button>' : ""}
      </div>
    `;
  }

  private renderPortrait(leader: LeaderState, className: string): string {
    const image = leader.portraitUrl ? ` style="background-image: url('${this.escapeAttribute(leader.portraitUrl)}')"` : "";
    const initials = leader.name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    return `<div class="${className} leaderPortrait ${leader.class}"${image}><span>${this.escapeHtml(initials)}</span></div>`;
  }

  private getVisibleLeaders(data: LeadersPanelData): LeaderState[] {
    return data.leaders
      .filter((leader) => leader.status !== "dead")
      .filter((leader) => this.activeTab === "all" || leader.class === this.activeTab)
      .sort((a, b) => {
        const statusOrder = (a.status === "recruited" ? 0 : 1) - (b.status === "recruited" ? 0 : 1);
        if (statusOrder !== 0) return statusOrder;
        if (a.class !== b.class) return a.class === "civilian" ? -1 : 1;
        return b.level - a.level || a.name.localeCompare(b.name);
      });
  }

  private getSelectedLeader(data: LeadersPanelData): LeaderState | null {
    return data.leaders.find((leader) => leader.id === this.selectedLeaderId && leader.status !== "dead") ?? null;
  }

  private getAssignmentLabel(leader: LeaderState, data: LeadersPanelData): string {
    if (!leader.assignment) return leader.status === "pool" ? "Candidate" : "No assignment";
    if (leader.assignment.kind === "government") {
      const position = getGovernmentPositionDefinition(leader.assignment.targetId as GovernmentPositionId);
      return position ? `${position.title} cabinet` : "Government position missing";
    }
    if (leader.assignment.kind === "fleet") {
      const fleet = data.fleets.find((candidate) => candidate.id === leader.assignment?.targetId);
      if (!fleet) return "Assigned fleet missing";
      const owner = data.factions.find((faction) => faction.id === fleet.ownerId);
      return `${owner?.name ?? "Faction"} Fleet`;
    }
    const planetState = data.planetStates.find((candidate) => candidate.id === leader.assignment?.targetId);
    const planet = planetState
      ? data.stars[planetState.starId]?.system.planets[planetState.planetIndex]
      : null;
    return planet ? `Governing ${planet.name}` : "Assigned planet missing";
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.leadersPanel {
  --panel-accent: rgba(96, 240, 184, 0.95);
  position: fixed;
  z-index: 98;
  width: min(1010px, calc(100vw - 28px));
  height: min(590px, calc(100vh - 28px));
  pointer-events: auto;
  color: #d7efe3;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
}

.leadersFrame {
  height: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--panel-accent) 76%, transparent);
  background:
    radial-gradient(circle at 70% 18%, color-mix(in srgb, var(--panel-accent) 12%, transparent), transparent 20rem),
    linear-gradient(180deg, rgba(7, 20, 24, 0.985), rgba(2, 9, 12, 0.99));
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.58), inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  overflow: hidden;
}

.leadersHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px 7px;
  border-bottom: 1px solid color-mix(in srgb, var(--panel-accent) 28%, transparent);
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--panel-accent) 22%, rgba(6, 20, 23, 0.92)),
    rgba(3, 11, 14, 0.94));
  cursor: grab;
}

.leadersTitle {
  color: #e5fff4;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.leadersSubtitle {
  margin-top: 2px;
  color: rgba(156, 225, 194, 0.75);
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.leadersClose {
  width: 28px;
  height: 28px;
  border: 1px solid rgba(88, 255, 197, 0.55);
  background: rgba(8, 45, 37, 0.88);
  color: #bffff0;
  font: inherit;
  cursor: pointer;
}

.leadersTabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 7px 14px 0;
  border-bottom: 1px solid rgba(65, 202, 153, 0.16);
}

.leadersTab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 32px;
  border: 1px solid transparent;
  border-bottom-color: rgba(221, 187, 72, 0.34);
  background: rgba(8, 31, 28, 0.5);
  color: rgba(211, 239, 225, 0.82);
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}

.leadersTab.active {
  color: #f0d65d;
  border-color: rgba(221, 187, 72, 0.7);
  background: linear-gradient(180deg, rgba(42, 64, 38, 0.7), rgba(11, 34, 27, 0.7));
}

.leadersTab strong {
  color: #8fffd0;
}

.leadersAssignBanner {
  margin: 8px 14px 0;
  padding: 7px 10px;
  border: 1px solid rgba(91, 222, 185, 0.38);
  background: rgba(4, 38, 34, 0.62);
  color: rgba(212, 250, 235, 0.82);
  font-size: 10px;
  letter-spacing: 0.04em;
}

.leadersAssignBanner strong {
  color: #f0d65d;
}

.leadersBody {
  min-height: 0;
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 10px;
  padding: 10px 14px 14px;
}

.leadersListPane {
  min-height: 0;
  overflow-y: auto;
  padding-right: 6px;
  scrollbar-width: thin;
  scrollbar-color: rgba(73, 214, 164, 0.6) rgba(0, 0, 0, 0.28);
}

.leadersSection + .leadersSection {
  margin-top: 11px;
}

.leadersSectionTitle {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #74ffbc;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 6px;
}

.leadersSectionTitle span {
  color: rgba(199, 234, 219, 0.72);
}

.leadersRows {
  display: grid;
  gap: 4px;
}

.leadersEmptyRows,
.leaderEmptyDetail {
  min-height: 72px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(65, 202, 153, 0.2);
  background: rgba(2, 16, 16, 0.72);
  color: rgba(211, 239, 225, 0.55);
  font-size: 11px;
}

.leaderRow {
  min-width: 0;
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) 158px 102px;
  gap: 9px;
  align-items: center;
  min-height: 62px;
  padding: 5px 7px;
  border: 1px solid rgba(65, 202, 153, 0.24);
  background: linear-gradient(90deg, rgba(10, 45, 38, 0.74), rgba(4, 18, 20, 0.86));
  cursor: pointer;
}

.leaderRow.selected {
  border-color: rgba(240, 214, 93, 0.82);
  box-shadow: inset 0 0 18px rgba(240, 214, 93, 0.12);
}

.leaderPortrait {
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 4px;
  border: 1px solid rgba(131, 255, 217, 0.36);
  background-size: cover;
  background-position: center;
}

.leaderPortrait::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 24%, rgba(230, 255, 255, 0.26), transparent 24%),
    linear-gradient(145deg, rgba(63, 116, 104, 0.9), rgba(18, 32, 35, 0.94));
}

.leaderPortrait.military::before {
  background:
    radial-gradient(circle at 50% 24%, rgba(255, 230, 190, 0.22), transparent 24%),
    linear-gradient(145deg, rgba(104, 83, 70, 0.95), rgba(22, 27, 34, 0.94));
}

.leaderPortrait span {
  position: relative;
  z-index: 1;
  color: rgba(236, 255, 247, 0.88);
  font-size: 14px;
  font-weight: 900;
}

.leaderRowPortrait {
  width: 48px;
  height: 52px;
}

.leaderRowMain {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.leaderRowName {
  min-width: 0;
  color: #f0d65d;
  font-size: 11px;
  font-weight: 900;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.leaderRowMeta,
.leaderRowTraits,
.leaderRowAssignment {
  min-width: 0;
  color: rgba(211, 239, 225, 0.72);
  font-size: 9px;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.leaderRowTraits {
  color: rgba(120, 255, 199, 0.78);
}

.leaderRowAssignment {
  color: rgba(224, 241, 234, 0.8);
}

.leaderRowAction {
  display: flex;
  justify-content: flex-end;
}

.leaderMiniButton {
  min-height: 26px;
  padding: 0 8px;
  border: 1px solid rgba(84, 202, 164, 0.42);
  background: rgba(7, 35, 31, 0.86);
  color: #d8fff2;
  font: inherit;
  font-size: 8px;
  cursor: pointer;
}

.leaderMiniButton.assign {
  color: #f0d65d;
  border-color: rgba(240, 214, 93, 0.58);
}

.leaderDetailPane {
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  border: 1px solid rgba(65, 202, 153, 0.34);
  background:
    radial-gradient(circle at 50% 14%, rgba(170, 236, 218, 0.16), transparent 11rem),
    rgba(4, 20, 22, 0.82);
}

.leaderDetailHero {
  min-height: 214px;
  display: grid;
  align-content: end;
  gap: 10px;
  padding: 14px 14px 10px;
}

.leaderDetailPortraitWrap {
  position: relative;
  justify-self: center;
}

.leaderDetailPortrait {
  width: 154px;
  height: 164px;
}

.leaderLevelPip {
  position: absolute;
  right: -7px;
  bottom: -7px;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid rgba(240, 214, 93, 0.86);
  background: rgba(15, 40, 30, 0.96);
  color: #f0d65d;
  font-size: 13px;
  font-weight: 900;
}

.leaderDetailIdentity {
  text-align: center;
}

.leaderDetailName {
  color: #f0d65d;
  font-size: 15px;
  font-weight: 900;
}

.leaderDetailRole,
.leaderDetailAssignment {
  margin-top: 3px;
  color: rgba(207, 236, 224, 0.76);
  font-size: 10px;
}

.leaderDetailStats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-top: 1px solid rgba(65, 202, 153, 0.22);
  border-bottom: 1px solid rgba(65, 202, 153, 0.22);
}

.leaderDetailStats div {
  display: grid;
  gap: 3px;
  padding: 7px 8px;
  text-align: center;
}

.leaderDetailStats div + div {
  border-left: 1px solid rgba(65, 202, 153, 0.18);
}

.leaderDetailStats span {
  color: rgba(174, 214, 197, 0.68);
  font-size: 8px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.leaderDetailStats strong {
  color: #f1fff8;
  font-size: 12px;
}

.leaderXpBar {
  height: 5px;
  background: rgba(0, 0, 0, 0.45);
}

.leaderXpBar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #3dffb5, #f0d65d);
}

.leaderDetailBody {
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
}

.leaderTraitList {
  display: grid;
  gap: 7px;
}

.leaderTraitCard {
  padding: 8px;
  border: 1px solid rgba(65, 202, 153, 0.26);
  background: rgba(2, 13, 15, 0.72);
}

.leaderTraitCard strong {
  display: block;
  color: #8fffd0;
  font-size: 10px;
  margin-bottom: 3px;
}

.leaderTraitCard span {
  display: block;
  color: rgba(219, 243, 234, 0.78);
  font-size: 10px;
  line-height: 1.35;
}

.leaderDetailActions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 9px;
  border-top: 1px solid rgba(65, 202, 153, 0.22);
}

.leaderDetailActions button {
  min-height: 30px;
  flex: 1 1 112px;
  border: 1px solid rgba(84, 202, 164, 0.42);
  background: rgba(7, 35, 31, 0.86);
  color: #d8fff2;
  font: inherit;
  font-size: 9px;
  cursor: pointer;
}

.leaderDetailActions button.danger {
  color: #ff9ba6;
  border-color: rgba(255, 110, 126, 0.42);
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
