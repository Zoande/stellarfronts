import { RESOURCE_KINDS, RESOURCE_LABELS } from "../data/Economy";
import {
  STARBASE_BUILDING_DEFINITIONS,
  STARBASE_BUILDING_KINDS,
  STARBASE_LEVEL_DEFINITIONS,
  STARBASE_SHIP_DEFINITIONS,
  STARBASE_SHIP_KINDS,
  countStarbaseShipyards,
  getNextStarbaseLevel,
  hasQueuedStarbaseBuildingTarget,
} from "../data/Starbase";
import type { ResourceCounts } from "../data/Economy";
import type { StarbaseBuildingKind } from "../data/Starbase";
import type { ClientCommand, ServerStarbase } from "../game/GameProtocol";

export interface StarbasePanelData {
  id: string;
  name: string;
  systemName: string;
  ownerName?: string;
  ownerColor?: [number, number, number];
  status?: string;
  power?: string;
  starbase?: ServerStarbase;
  onStarbaseCommand?: (command: ClientCommand) => void;
}

const STYLE_ID = "starbase-panel-style";

type StarbaseTab = "starbase" | "defenses" | "shipyard";

export class StarbasePanel {
  private root: HTMLDivElement;
  private panelElement: HTMLDivElement | null = null;
  private currentData: StarbasePanelData | null = null;
  private activeTab: StarbaseTab = "starbase";
  private position = { x: 42, y: 74 };
  private dragOffset = { x: 0, y: 0 };
  private isDragging = false;
  private buildingPickerSlotIndex: number | null = null;

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

  public show(data: StarbasePanelData): void {
    if (this.currentData?.id !== data.id) {
      this.activeTab = "starbase";
      this.buildingPickerSlotIndex = null;
    }
    this.currentData = data;
    if (!this.panelElement) {
      this.panelElement = document.createElement("div");
      this.panelElement.className = "starbasePanel";
      this.root.appendChild(this.panelElement);
    }

    const accent = data.ownerColor
      ? `rgba(${Math.round(data.ownerColor[0] * 255)}, ${Math.round(data.ownerColor[1] * 255)}, ${Math.round(data.ownerColor[2] * 255)}, 0.95)`
      : "rgba(114, 226, 255, 0.95)";
    this.panelElement.style.setProperty("--starbase-accent", accent);
    this.panelElement.innerHTML = this.render(data);
    this.applyPosition();
    this.bindEvents(data);
  }

  public close(): void {
    this.onPointerUp();
    this.panelElement?.remove();
    this.panelElement = null;
    this.currentData = null;
    this.activeTab = "starbase";
  }

  public refreshStarbase(starbase: ServerStarbase): void {
    if (!this.currentData || this.currentData.id !== starbase.id) return;
    this.show({ ...this.currentData, starbase });
  }

  public dispose(): void {
    this.close();
  }

  private bindEvents(data: StarbasePanelData): void {
    if (!this.panelElement) return;
    this.panelElement.querySelector<HTMLButtonElement>("[data-starbase-close]")?.addEventListener("click", () => this.close());
    this.panelElement.querySelector<HTMLElement>("[data-starbase-drag]")?.addEventListener("pointerdown", (ev) => {
      if (!this.panelElement) return;
      ev.preventDefault();
      const rect = this.panelElement.getBoundingClientRect();
      this.dragOffset.x = ev.clientX - rect.left;
      this.dragOffset.y = ev.clientY - rect.top;
      this.isDragging = true;
      window.addEventListener("pointermove", this.onPointerMove);
      window.addEventListener("pointerup", this.onPointerUp);
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-starbase-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        this.activeTab = (button.dataset.starbaseTab as StarbaseTab | undefined) ?? "starbase";
        this.show(data);
      });
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-sb-upgrade]")?.addEventListener("click", () => {
      if (!data.starbase) return;
      data.onStarbaseCommand?.({ type: "upgradeStarbase", starbaseId: data.starbase.id });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-sb-building-slot]").forEach((button) => {
      button.addEventListener("click", () => {
        const slotIndex = Number(button.dataset.sbBuildingSlot);
        if (!Number.isInteger(slotIndex)) return;
        this.buildingPickerSlotIndex = slotIndex;
        this.show(data);
      });
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-sb-close-building-picker]")?.addEventListener("click", () => {
      this.buildingPickerSlotIndex = null;
      this.show(data);
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-sb-pick-building]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!data.starbase || this.buildingPickerSlotIndex === null) return;
        const buildingKind = button.dataset.sbPickBuilding as StarbaseBuildingKind | undefined;
        if (!buildingKind) return;
        data.onStarbaseCommand?.({
          type: "buildStarbaseBuilding",
          starbaseId: data.starbase.id,
          slotIndex: this.buildingPickerSlotIndex,
          buildingKind,
        });
      });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-sb-build-ship]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!data.starbase) return;
        const shipKind = button.dataset.sbBuildShip as keyof typeof STARBASE_SHIP_DEFINITIONS | undefined;
        if (!shipKind) return;
        data.onStarbaseCommand?.({
          type: "buildStarbaseShip",
          starbaseId: data.starbase.id,
          shipKind,
        });
      });
    });
  }

  private applyPosition(): void {
    if (!this.panelElement) return;
    this.panelElement.style.left = `${this.position.x}px`;
    this.panelElement.style.top = `${this.position.y}px`;
  }

  private render(data: StarbasePanelData): string {
    return `
      <div class="sbHeader" data-starbase-drag>
        <div class="sbHeaderIcon">SB</div>
        <div>
          <div class="sbTitle">${this.escapeHtml(data.name)}</div>
          <div class="sbSubtitle">${this.escapeHtml(data.systemName)} | ${this.escapeHtml(data.ownerName ?? "Unknown Command")}</div>
        </div>
        <button class="sbClose" type="button" data-starbase-close aria-label="Close starbase panel">X</button>
      </div>
      <div class="sbHeroRow">
        <div class="sbBanner">
          <div class="sbBannerGlow"></div>
          <div class="sbBannerCaption">
            <strong>Orbital Command Spire</strong>
            <span>Placeholder interior operations banner</span>
          </div>
        </div>
        <aside class="sbModelPane">
          <div class="sbStationArt"></div>
          <div class="sbPowerBadge">${this.escapeHtml(data.power ?? "13.0K")}</div>
        </aside>
      </div>
      ${this.renderBody(data)}
      <nav class="sbTabs">
        ${this.renderTab("starbase", "Starbase")}
        ${this.renderTab("defenses", "Defenses")}
        ${this.renderTab("shipyard", "Shipyard")}
      </nav>
    `;
  }

  private renderBody(data: StarbasePanelData): string {
    if (this.activeTab === "defenses") return this.renderDefenses(data);
    if (this.activeTab === "shipyard") return this.renderShipyard(data);
    return this.renderStarbase(data);
  }

  private renderStarbase(data: StarbasePanelData): string {
    const level = data.starbase?.level ?? "outpost";
    const definition = STARBASE_LEVEL_DEFINITIONS[level] ?? STARBASE_LEVEL_DEFINITIONS.outpost;
    const nextLevel = getNextStarbaseLevel(level);
    const nextDefinition = nextLevel ? STARBASE_LEVEL_DEFINITIONS[nextLevel] : null;
    const upgrade = definition.upgrade;
    const slots = Array.isArray(data.starbase?.buildingSlots)
      ? data.starbase.buildingSlots
      : Array<StarbaseBuildingKind | null>(9).fill(null);
    const queue = Array.isArray(data.starbase?.constructionQueue) ? data.starbase.constructionQueue : [];
    const selectedSlotQueued = this.buildingPickerSlotIndex !== null
      && hasQueuedStarbaseBuildingTarget(queue, this.buildingPickerSlotIndex);
    if (selectedSlotQueued) this.buildingPickerSlotIndex = null;
    return `
      <section class="sbBody sbStarbaseBody">
        <div class="sbLeftColumn">
          <div class="sbTierGrid">
            <article>
              <span>Current Frame</span>
              <strong>${this.escapeHtml(definition.label)}</strong>
              <small>${definition.buildingSlots} / 9 building slots online</small>
              <button type="button">Details</button>
              <button type="button">Downgrade</button>
            </article>
            <article>
              <span>Upgrade Target</span>
              <strong>${nextDefinition ? this.escapeHtml(nextDefinition.label) : "Maximum Level"}</strong>
              <small>${upgrade ? `${upgrade.alloyCost} alloys | ${upgrade.buildDays} days` : "No further upgrade"}</small>
              <button type="button"${upgrade ? "" : " disabled"} data-sb-upgrade>Upgrade</button>
            </article>
          </div>
          <div class="sbSectionTitle">Starbase Buildings</div>
          <div class="sbSlotGrid buildings">${this.renderSlots(slots, definition.buildingSlots, queue)}</div>
        </div>
        <aside class="sbSideStack">
          ${this.buildingPickerSlotIndex === null ? `
          <div class="sbEconomyPanel">
            <div class="sbEconomyColumn">
              <div class="sbSectionTitle">Starbase Production</div>
              <div class="sbTokenGrid">${this.renderResourceTokens(data.starbase?.economy?.production ?? definition.production, "positive")}</div>
            </div>
            <div class="sbEconomyColumn">
              <div class="sbSectionTitle">Starbase Upkeep</div>
              <div class="sbTokenGrid">${this.renderResourceTokens(data.starbase?.economy?.upkeep ?? definition.upkeep, "negative")}</div>
            </div>
          </div>
          ` : this.renderBuildingPicker(this.buildingPickerSlotIndex)}
          <div class="sbQueue">
            <div class="sbSectionTitle">Starbase Queue</div>
            <div class="sbQueueList">
              ${queue.length === 0
                ? '<div class="sbQueueEmpty">No queued starbase orders.</div>'
                : queue.map((item) => {
                  const totalDays = Math.max(1, item.totalDays ?? 1);
                  const remainingDays = Math.max(0, item.remainingDays ?? totalDays);
                  const progress = Math.max(0, Math.min(100, ((totalDays - remainingDays) / totalDays) * 100));
                  return `
                    <div class="sbQueueItem">
                      <strong>${this.escapeHtml(item.label ?? "Starbase Order")}</strong>
                      <span>${Math.ceil(remainingDays)} days remaining</span>
                      <div class="sbQueueBar"><span style="width: ${progress}%"></span></div>
                    </div>
                  `;
                }).join("")}
            </div>
          </div>
        </aside>
      </section>
    `;
  }

  private renderDefenses(data: StarbasePanelData): string {
    return `
      <section class="sbBody sbDetailBody">
        <article class="sbDefenseCard">
          <span>Defense Platforms</span>
          <strong>4 / 12</strong>
          <p>Placeholder platform capacity and defense aura summary for ${this.escapeHtml(data.name)}.</p>
        </article>
        <article class="sbDefenseCard">
          <span>Shield Matrix</span>
          <strong>Online</strong>
          <p>Projected system shields, point defense, and interception modules will live here.</p>
        </article>
        <article class="sbDefenseCard">
          <span>Threat Coverage</span>
          <strong>Medium</strong>
          <p>Future UI: enemy approach lanes, weapon arcs, garrison ships, and repair reserves.</p>
        </article>
      </section>
    `;
  }

  private renderShipyard(data: StarbasePanelData): string {
    const starbase = data.starbase;
    const shipyardCount = starbase ? countStarbaseShipyards(starbase.buildingSlots) : 0;
    const shipQueue = starbase?.shipQueue ?? [];
    const activeCount = Math.min(shipyardCount, shipQueue.length);
    return `
      <section class="sbBody sbShipyardBody">
        <article class="sbShipyardColumn sbOrbitColumn">
          <div class="sbShipyardSummary">
            <div class="sbShipyardIcon">SY</div>
            <div>
              <span>Shipyards</span>
              <strong>${shipyardCount}</strong>
              <small>${activeCount} active slip${activeCount === 1 ? "" : "s"}</small>
            </div>
          </div>
          <div class="sbSectionTitle">Orbiting Ships</div>
          <div class="sbOrbitList">
            <div class="sbQueueEmpty">No orbiting ships tracked yet.</div>
            ${Array.from({ length: 7 }, (_, index) => `<div class="sbOrbitPlaceholder"><span>--${index + 1}</span><small>Future orbit slot</small></div>`).join("")}
          </div>
        </article>
        <article class="sbShipyardColumn">
          <div class="sbSectionTitle">Modifier Effects</div>
          <div class="sbModifierGrid">
            <span>Build Speed +0%</span>
            <span>Alloy Efficiency +0%</span>
            <span>Crew Training +0%</span>
          </div>
          <div class="sbSectionTitle">Shipyard Queue</div>
          <div class="sbShipQueueList">
            ${shipQueue.length === 0
              ? '<div class="sbQueueEmpty">No ships queued.</div>'
              : shipQueue.map((item, index) => {
                const totalDays = Math.max(1, item.totalDays);
                const progress = Math.max(0, Math.min(100, ((totalDays - item.remainingDays) / totalDays) * 100));
                const isActive = index < shipyardCount;
                return `
                  <div class="sbShipQueueItem ${isActive ? "active" : ""}">
                    <div>
                      <strong>${this.escapeHtml(item.label)}</strong>
                      <span>${isActive ? "Building" : "Waiting"} | ${Math.ceil(item.remainingDays)}d</span>
                    </div>
                    <small>${this.formatCompact(item.alloyUpkeepPerDay)}/d alloys</small>
                    <div class="sbQueueBar"><span style="width: ${progress}%"></span></div>
                  </div>
                `;
              }).join("")}
          </div>
        </article>
        <article class="sbShipyardColumn">
          <div class="sbSectionTitle">Shipbuilding Demand</div>
          <div class="sbDemandPanel">
            <span>Active alloy demand: ${this.formatCompact(this.getActiveShipAlloyDemand(starbase))} / day</span>
            <span>Queued crew demand: ${this.formatCompact(shipQueue.reduce((total, item) => total + item.crewDemand, 0))}</span>
            <span>Completed ships: held for future fleet spawning</span>
          </div>
          <div class="sbSectionTitle">Available Ships</div>
          <div class="sbAvailableShipList">
            ${STARBASE_SHIP_KINDS.map((kind) => {
              const definition = STARBASE_SHIP_DEFINITIONS[kind];
              const predictedAlloys = definition.alloyUpkeepPerDay * definition.buildDays;
              return `
                <button class="sbAvailableShipCard" type="button" data-sb-build-ship="${kind}" ${shipyardCount > 0 ? "" : "disabled"}>
                  <span class="sbShipIcon">◆</span>
                  <span>
                    <strong>${this.escapeHtml(definition.label)}</strong>
                    <small>${this.escapeHtml(definition.className)}</small>
                    <em>${this.formatCompact(predictedAlloys)} alloys predicted | ${definition.buildDays} days | ${this.formatCompact(definition.crewDemand)} crew</em>
                  </span>
                </button>
              `;
            }).join("")}
          </div>
        </article>
      </section>
    `;
  }

  private getActiveShipAlloyDemand(starbase?: ServerStarbase): number {
    if (!starbase) return 0;
    const shipyardCount = countStarbaseShipyards(starbase.buildingSlots);
    return starbase.shipQueue
      .slice(0, shipyardCount)
      .reduce((total, item) => total + item.alloyUpkeepPerDay, 0);
  }

  private renderSlots(
    labels: Array<StarbaseBuildingKind | null>,
    unlockedSlots: number,
    queue: ServerStarbase["constructionQueue"],
  ): string {
    return Array.from({ length: 9 }, (_, index) => {
      const buildingKind = labels[index] ?? null;
      const definition = buildingKind ? STARBASE_BUILDING_DEFINITIONS[buildingKind] : null;
      const queued = queue.find((item) => item.kind === "building" && item.slotIndex === index);
      const locked = index >= unlockedSlots;
      const canClick = !locked && !definition && !queued;
      return `
      <button class="sbSlot ${definition ? "filled" : "empty"} ${locked ? "locked" : ""} ${queued ? "queued" : ""}" type="button" ${canClick ? `data-sb-building-slot="${index}"` : "disabled"}>
        <span>${definition ? this.escapeHtml(this.getInitials(definition.label)) : queued ? "Q" : "+"}</span>
        <small>${locked ? "Locked" : queued ? `${this.escapeHtml(queued.label)} queued` : definition ? this.escapeHtml(definition.label) : `Slot ${index + 1}`}</small>
      </button>
    `;
    }).join("");
  }

  private renderBuildingPicker(slotIndex: number): string {
    return `
      <div class="sbBuildingPicker">
        <div class="sbPickerHeader">
          <div>
            <strong>Build Starbase Building</strong>
            <span>Slot ${slotIndex + 1}</span>
          </div>
          <button type="button" data-sb-close-building-picker>X</button>
        </div>
        <div class="sbBuildingList">
          ${STARBASE_BUILDING_KINDS.map((kind) => {
            const definition = STARBASE_BUILDING_DEFINITIONS[kind];
            return `
              <button class="sbBuildingCard" type="button" data-sb-pick-building="${kind}">
                <span class="sbBuildingIcon">${this.escapeHtml(this.getInitials(definition.label))}</span>
                <span class="sbBuildingInfo">
                  <strong>${this.escapeHtml(definition.label)}</strong>
                  <small>${this.renderInlineCost(definition.cost)} | ${definition.buildDays} days</small>
                  <em>${this.escapeHtml(definition.description)}</em>
                </span>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  private renderResourceTokens(counts: ResourceCounts, className: "positive" | "negative"): string {
    const rows = RESOURCE_KINDS
      .filter((resource) => Math.abs(counts[resource]) > 0.0001)
      .map((resource) => `<span class="${className}">${this.escapeHtml(RESOURCE_LABELS[resource])} ${className === "negative" ? "-" : "+"}${this.formatCompact(counts[resource])}</span>`);
    return rows.length > 0 ? rows.join("") : '<span class="muted">None</span>';
  }

  private formatCompact(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}K`;
    return abs.toFixed(abs >= 10 ? 0 : 1);
  }

  private renderInlineCost(counts: ResourceCounts): string {
    const parts = RESOURCE_KINDS
      .filter((resource) => Math.abs(counts[resource]) > 0.0001)
      .map((resource) => `${this.formatCompact(counts[resource])} ${RESOURCE_LABELS[resource]}`);
    return parts.length > 0 ? parts.join(", ") : "Free";
  }

  private getInitials(label: string): string {
    return label.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();
  }

  private renderTab(tab: StarbaseTab, label: string): string {
    return `<button class="${this.activeTab === tab ? "active" : ""}" type="button" data-starbase-tab="${tab}">${label}</button>`;
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.starbasePanel {
  --starbase-accent: rgba(114, 226, 255, 0.95);
  position: fixed;
  width: min(860px, calc(100vw - 32px));
  height: min(640px, calc(100vh - 32px));
  z-index: 58;
  pointer-events: auto;
  display: grid;
  grid-template-rows: 58px 188px minmax(0, 1fr) 44px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--starbase-accent) 76%, transparent);
  background:
    radial-gradient(circle at 70% 22%, color-mix(in srgb, var(--starbase-accent) 12%, transparent), transparent 18rem),
    linear-gradient(180deg, rgba(7, 28, 31, 0.98), rgba(2, 12, 15, 0.99));
  color: #e9fff8;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.56), inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  user-select: none;
}

.sbHeader {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  cursor: grab;
  border-bottom: 1px solid rgba(103, 255, 221, 0.24);
  background: linear-gradient(90deg, rgba(20, 70, 62, 0.86), rgba(4, 19, 23, 0.92));
}

.sbHeaderIcon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  clip-path: polygon(50% 0, 94% 25%, 94% 75%, 50% 100%, 6% 75%, 6% 25%);
  background: var(--starbase-accent);
  color: #062018;
  font-weight: 900;
  font-size: 11px;
}

.sbTitle {
  font-size: 19px;
  font-weight: 900;
  letter-spacing: 0.04em;
}

.sbSubtitle {
  margin-top: 2px;
  color: rgba(206, 232, 226, 0.68);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.sbClose {
  margin-left: auto;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(103, 255, 221, 0.62);
  background: rgba(6, 42, 38, 0.76);
  color: #bfffee;
  font: inherit;
  cursor: pointer;
}

.sbHeroRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 306px;
  border-bottom: 1px solid rgba(103, 255, 221, 0.22);
}

.sbBanner {
  position: relative;
  min-width: 0;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgba(1, 10, 15, 0.1), rgba(2, 13, 18, 0.74)),
    url("/textures/starbase/Starbase_banner.png") center / cover no-repeat,
    radial-gradient(circle at 54% 38%, rgba(132, 234, 255, 0.38), transparent 12rem),
    linear-gradient(135deg, rgba(17, 65, 88, 0.96), rgba(6, 23, 48, 0.96) 42%, rgba(7, 44, 54, 0.92));
}

.sbBanner::before {
  content: "";
  position: absolute;
  inset: 18px 24px 58px;
  border: 1px solid rgba(164, 251, 255, 0.22);
  background: linear-gradient(90deg, rgba(118, 220, 255, 0.08), rgba(255, 255, 255, 0.04));
  transform: skewX(-8deg);
  opacity: 0.38;
}

.sbBannerGlow {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 58% 42%, rgba(255, 255, 255, 0.46), transparent 5rem);
  opacity: 0.7;
}

.sbBannerCaption {
  position: absolute;
  left: 22px;
  bottom: 18px;
  display: grid;
  gap: 4px;
}

.sbBannerCaption strong {
  font-size: 14px;
}

.sbBannerCaption span {
  color: rgba(207, 231, 232, 0.68);
  font-size: 11px;
}

.sbModelPane {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at 68% 38%, rgba(246, 124, 79, 0.46), transparent 12rem),
    linear-gradient(135deg, rgba(61, 11, 14, 0.95), rgba(12, 6, 15, 0.98));
}

.sbStationArt {
  position: absolute;
  width: 210px;
  height: 128px;
  right: 22px;
  bottom: 18px;
  border-radius: 50%;
  background:
    radial-gradient(ellipse at center, rgba(255, 220, 176, 0.38), transparent 12%),
    radial-gradient(ellipse at center, rgba(134, 91, 79, 0.98) 0 26%, rgba(77, 52, 52, 0.98) 27% 42%, transparent 43%),
    linear-gradient(180deg, rgba(204, 143, 111, 0.92), rgba(55, 35, 40, 0.96));
  border: 2px solid rgba(232, 155, 103, 0.55);
  transform: perspective(260px) rotateX(58deg);
  box-shadow: 0 0 36px rgba(255, 129, 70, 0.24);
}

.sbPowerBadge {
  position: absolute;
  left: 14px;
  bottom: 14px;
  padding: 4px 8px;
  border: 1px solid rgba(255, 224, 123, 0.64);
  background: rgba(48, 34, 13, 0.72);
  color: #ffe48a;
  font-size: 12px;
  font-weight: 900;
}

.sbBody {
  min-height: 0;
  padding: 8px;
}

.sbStarbaseBody {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 270px;
  gap: 8px;
}

.sbLeftColumn {
  min-height: 0;
  overflow: hidden;
}

.sbTierGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 8px;
}

.sbTierGrid article,
.sbQueue,
.sbEconomyPanel,
.sbDefenseCard {
  border: 1px solid rgba(103, 255, 221, 0.26);
  background: rgba(5, 24, 25, 0.72);
}

.sbTierGrid article {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 8px;
}

.sbTierGrid span,
.sbTierGrid strong,
.sbTierGrid small {
  grid-column: 1 / span 2;
}

.sbTierGrid span,
.sbSlot small,
.sbQueueItem span,
.sbDefenseCard span {
  color: rgba(206, 232, 226, 0.66);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.sbTierGrid strong {
  font-size: 14px;
}

.sbTierGrid button,
.sbWideButton {
  min-height: 28px;
  border: 1px solid rgba(103, 255, 221, 0.42);
  background: rgba(6, 42, 38, 0.72);
  color: #d8fff6;
  font: inherit;
  font-size: 11px;
}

.sbTierGrid button:disabled {
  opacity: 0.42;
}

.sbSectionTitle {
  margin: 6px 0;
  color: #eafef8;
  font-size: 13px;
  font-weight: 900;
}

.sbSlotGrid {
  display: grid;
  gap: 5px;
}

.sbSlotGrid.buildings {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.sbSlot {
  min-height: 62px;
  display: grid;
  place-items: center;
  gap: 2px;
  border: 1px solid rgba(103, 255, 221, 0.36);
  background: linear-gradient(145deg, rgba(18, 70, 64, 0.68), rgba(4, 18, 22, 0.94));
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.sbSlot.empty {
  opacity: 0.48;
}

.sbSlot:disabled {
  cursor: default;
}

.sbSlot.locked {
  opacity: 0.24;
  filter: grayscale(0.6);
}

.sbSlot.queued {
  opacity: 0.78;
  border-color: rgba(255, 209, 106, 0.58);
  background: linear-gradient(145deg, rgba(72, 53, 18, 0.72), rgba(4, 18, 22, 0.94));
}

.sbSlot span {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  background: rgba(103, 255, 221, 0.12);
  border: 1px solid rgba(103, 255, 221, 0.38);
  color: #a9ffea;
  font-size: 11px;
  font-weight: 900;
}

.sbSlot small {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sbSideStack {
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(96px, 0.52fr);
  gap: 8px;
}

.sbBuildingPicker {
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(103, 255, 221, 0.26);
  background: rgba(5, 24, 25, 0.72);
  padding: 8px;
}

.sbPickerHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.sbPickerHeader div {
  display: grid;
  gap: 2px;
}

.sbPickerHeader strong {
  font-size: 12px;
}

.sbPickerHeader span {
  color: rgba(206, 232, 226, 0.62);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.sbPickerHeader button {
  margin-left: auto;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(103, 255, 221, 0.5);
  background: rgba(6, 42, 38, 0.72);
  color: #d8fff6;
  font: inherit;
  cursor: pointer;
}

.sbBuildingList {
  max-height: 250px;
  overflow-y: auto;
  display: grid;
  gap: 6px;
  padding-right: 3px;
  scrollbar-width: thin;
}

.sbBuildingList::-webkit-scrollbar {
  width: 6px;
}

.sbBuildingList::-webkit-scrollbar-thumb {
  background: rgba(103, 255, 221, 0.34);
  border-radius: 999px;
}

.sbBuildingCard {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  min-height: 70px;
  border: 1px solid rgba(103, 255, 221, 0.28);
  background: linear-gradient(135deg, rgba(16, 57, 52, 0.76), rgba(4, 17, 21, 0.94));
  color: #e9fff8;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.sbBuildingCard:hover {
  border-color: rgba(103, 255, 221, 0.72);
}

.sbBuildingIcon {
  width: 34px;
  height: 34px;
  margin-left: 7px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(103, 255, 221, 0.42);
  background: rgba(103, 255, 221, 0.1);
  color: #a9ffea;
  font-weight: 900;
  font-size: 11px;
}

.sbBuildingInfo {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.sbBuildingInfo strong {
  font-size: 12px;
}

.sbBuildingInfo small {
  color: #ffd16a;
  font-size: 10px;
}

.sbBuildingInfo em {
  color: rgba(216, 238, 232, 0.62);
  font-size: 10px;
  font-style: normal;
  line-height: 1.25;
}

.sbEconomyPanel {
  min-height: 0;
  display: grid;
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 8px;
}

.sbEconomyColumn {
  min-height: 0;
}

.sbTokenGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  font-size: 11px;
}

.sbTokenGrid span {
  padding: 3px 5px;
  border: 1px solid rgba(103, 255, 221, 0.16);
  background: rgba(0, 0, 0, 0.18);
}

.sbTokenGrid .positive {
  color: #6cff9a;
}

.sbTokenGrid .negative {
  color: #ff9b84;
}

.sbTokenGrid .muted {
  grid-column: 1 / span 2;
  color: rgba(206, 232, 226, 0.48);
}

.sbQueue {
  padding: 8px;
  min-height: 0;
  overflow: hidden;
}

.sbQueueList {
  max-height: 118px;
  overflow-y: auto;
  padding-right: 3px;
  scrollbar-width: thin;
}

.sbQueueList::-webkit-scrollbar {
  width: 6px;
}

.sbQueueList::-webkit-scrollbar-thumb {
  background: rgba(103, 255, 221, 0.34);
  border-radius: 999px;
}

.sbQueueItem {
  padding: 8px;
  border: 1px solid rgba(255, 224, 123, 0.34);
  background: rgba(42, 31, 11, 0.58);
}

.sbQueueItem strong,
.sbQueueItem span {
  display: block;
}

.sbQueueBar {
  height: 5px;
  margin-top: 8px;
  background: rgba(0, 0, 0, 0.48);
  overflow: hidden;
}

.sbQueueBar span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #ffd16a, #73ffd9);
}

.sbQueueEmpty {
  margin-top: 8px;
  color: rgba(206, 232, 226, 0.48);
  font-size: 11px;
}

.sbDetailBody {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.sbShipyardBody {
  display: grid;
  grid-template-columns: 1fr 1.08fr 1.16fr;
  gap: 8px;
}

.sbShipyardColumn {
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(103, 255, 221, 0.26);
  background: rgba(5, 24, 25, 0.72);
  padding: 8px;
}

.sbShipyardSummary {
  min-height: 64px;
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(103, 255, 221, 0.22);
  background: linear-gradient(135deg, rgba(16, 57, 52, 0.76), rgba(4, 17, 21, 0.92));
  padding: 7px;
}

.sbShipyardIcon {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(103, 255, 221, 0.42);
  background: rgba(103, 255, 221, 0.12);
  color: #a9ffea;
  font-weight: 900;
}

.sbShipyardSummary span,
.sbShipyardSummary small {
  color: rgba(206, 232, 226, 0.66);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.sbShipyardSummary strong {
  display: block;
  color: #eafff8;
  font-size: 24px;
  line-height: 1;
}

.sbOrbitList,
.sbShipQueueList,
.sbAvailableShipList {
  min-height: 0;
  max-height: 236px;
  overflow-y: auto;
  display: grid;
  align-content: start;
  gap: 5px;
  padding-right: 3px;
  scrollbar-width: thin;
}

.sbOrbitList::-webkit-scrollbar,
.sbShipQueueList::-webkit-scrollbar,
.sbAvailableShipList::-webkit-scrollbar {
  width: 6px;
}

.sbOrbitList::-webkit-scrollbar-thumb,
.sbShipQueueList::-webkit-scrollbar-thumb,
.sbAvailableShipList::-webkit-scrollbar-thumb {
  background: rgba(103, 255, 221, 0.34);
  border-radius: 999px;
}

.sbOrbitPlaceholder {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  align-items: center;
  min-height: 28px;
  border-left: 3px solid rgba(103, 255, 221, 0.74);
  border-bottom: 1px solid rgba(103, 255, 221, 0.14);
  background: rgba(1, 8, 10, 0.36);
  padding: 3px 6px;
}

.sbOrbitPlaceholder span {
  color: #eafff8;
  font-size: 11px;
  font-weight: 900;
}

.sbOrbitPlaceholder small {
  color: rgba(206, 232, 226, 0.38);
  font-size: 10px;
}

.sbModifierGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  margin-bottom: 8px;
}

.sbModifierGrid span {
  min-height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(103, 255, 221, 0.22);
  background: rgba(0, 0, 0, 0.18);
  color: #75ff9b;
  font-size: 10px;
}

.sbShipQueueItem {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  padding: 7px;
  border: 1px solid rgba(103, 255, 221, 0.2);
  background: rgba(1, 8, 10, 0.46);
}

.sbShipQueueItem.active {
  border-color: rgba(103, 255, 221, 0.58);
  box-shadow: inset 3px 0 0 rgba(103, 255, 221, 0.78);
}

.sbShipQueueItem strong,
.sbShipQueueItem span,
.sbShipQueueItem small {
  display: block;
}

.sbShipQueueItem strong {
  font-size: 12px;
}

.sbShipQueueItem span,
.sbShipQueueItem small {
  color: rgba(206, 232, 226, 0.66);
  font-size: 10px;
}

.sbShipQueueItem .sbQueueBar {
  grid-column: 1 / span 2;
  margin-top: 0;
}

.sbDemandPanel {
  display: grid;
  gap: 5px;
  margin-bottom: 8px;
  padding: 8px;
  border: 1px solid rgba(103, 255, 221, 0.18);
  background: rgba(0, 0, 0, 0.18);
}

.sbDemandPanel span {
  color: rgba(216, 238, 232, 0.72);
  font-size: 10px;
  line-height: 1.35;
}

.sbAvailableShipCard {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  min-height: 58px;
  border: 1px solid rgba(103, 255, 221, 0.28);
  background: linear-gradient(135deg, rgba(16, 57, 52, 0.76), rgba(4, 17, 21, 0.94));
  color: #e9fff8;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.sbAvailableShipCard:disabled {
  opacity: 0.42;
  cursor: default;
}

.sbAvailableShipCard:not(:disabled):hover {
  border-color: rgba(103, 255, 221, 0.72);
}

.sbShipIcon {
  display: grid;
  place-items: center;
  color: #dffcff;
  font-size: 18px;
}

.sbAvailableShipCard strong,
.sbAvailableShipCard small,
.sbAvailableShipCard em {
  display: block;
}

.sbAvailableShipCard strong {
  font-size: 12px;
}

.sbAvailableShipCard small {
  color: #75ff9b;
  font-size: 10px;
}

.sbAvailableShipCard em {
  color: rgba(216, 238, 232, 0.62);
  font-size: 10px;
  font-style: normal;
  line-height: 1.25;
}

.sbDefenseCard {
  padding: 12px;
}

.sbDefenseCard strong {
  display: block;
  margin-top: 5px;
  font-size: 18px;
}

.sbDefenseCard p {
  color: rgba(216, 238, 232, 0.72);
  line-height: 1.45;
}

.sbTabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-top: 1px solid rgba(103, 255, 221, 0.24);
}

.sbTabs button {
  border: 0;
  border-right: 1px solid rgba(103, 255, 221, 0.18);
  background: linear-gradient(135deg, rgba(22, 67, 58, 0.72), rgba(8, 19, 22, 0.94));
  color: rgba(228, 248, 242, 0.78);
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}

.sbTabs button.active {
  color: #ffffff;
  background: linear-gradient(135deg, rgba(39, 104, 88, 0.82), rgba(13, 39, 39, 0.96));
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
}
