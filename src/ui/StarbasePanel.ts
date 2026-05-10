import { RESOURCE_KINDS, RESOURCE_LABELS } from "../data/Economy";
import {
  STARBASE_LEVEL_DEFINITIONS,
  STARBASE_LEVEL_ORDER,
  getNextStarbaseLevel,
} from "../data/Starbase";
import type { ResourceCounts } from "../data/Economy";
import type { ServerStarbase } from "../game/GameProtocol";

export interface StarbasePanelData {
  id: string;
  name: string;
  systemName: string;
  ownerName?: string;
  ownerColor?: [number, number, number];
  status?: string;
  power?: string;
  starbase?: ServerStarbase;
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
      : Array<string | null>(9).fill(null);
    const queue = Array.isArray(data.starbase?.constructionQueue) ? data.starbase.constructionQueue : [];
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
              <button type="button"${upgrade ? "" : " disabled"}>Upgrade</button>
            </article>
          </div>
          <div class="sbSectionTitle">Starbase Buildings</div>
          <div class="sbSlotGrid buildings">${this.renderSlots(slots, definition.buildingSlots)}</div>
        </div>
        <aside class="sbSideStack">
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
    return `
      <section class="sbBody sbDetailBody">
        <article class="sbDefenseCard">
          <span>Shipyards</span>
          <strong>2 Active Slips</strong>
          <p>Ship production queues and template selection will be wired here later.</p>
        </article>
        <article class="sbDefenseCard">
          <span>Fleet Assembly</span>
          <strong>Idle</strong>
          <p>Placeholder rally point, reinforcement, and fleet merge controls.</p>
        </article>
        <article class="sbDefenseCard">
          <span>Repair Dock</span>
          <strong>Available</strong>
          <p>Future repair, retrofit, and mothball operations.</p>
        </article>
      </section>
    `;
  }

  private renderSlots(labels: Array<string | null>, unlockedSlots: number): string {
    return Array.from({ length: 9 }, (_, index) => {
      const label = labels[index] ?? null;
      const locked = index >= unlockedSlots;
      return `
      <div class="sbSlot ${label ? "filled" : "empty"} ${locked ? "locked" : ""}">
        <span>${label ? this.escapeHtml(label.split(" ").map((word) => word[0]).join("").slice(0, 2)) : "+"}</span>
        <small>${locked ? "Locked" : label ? this.escapeHtml(label) : `Slot ${index + 1}`}</small>
      </div>
    `;
    }).join("");
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
    radial-gradient(circle at 54% 38%, rgba(132, 234, 255, 0.38), transparent 12rem),
    linear-gradient(135deg, rgba(17, 65, 88, 0.96), rgba(6, 23, 48, 0.96) 42%, rgba(7, 44, 54, 0.92));
}

.sbBanner::before {
  content: "";
  position: absolute;
  inset: 18px 24px 58px;
  border: 1px solid rgba(164, 251, 255, 0.22);
  background:
    linear-gradient(90deg, rgba(118, 220, 255, 0.16) 0 20%, transparent 20% 24%, rgba(118, 220, 255, 0.12) 24% 52%, transparent 52% 57%, rgba(118, 220, 255, 0.14) 57%),
    repeating-linear-gradient(90deg, transparent 0 34px, rgba(255, 255, 255, 0.08) 35px 36px);
  transform: skewX(-8deg);
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
}

.sbSlot.empty {
  opacity: 0.48;
}

.sbSlot.locked {
  opacity: 0.24;
  filter: grayscale(0.6);
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
