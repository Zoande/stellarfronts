import type { CelestialObjectDetails, DistrictCounts, DistrictKind } from "../data/StarMap";
import {
  BUILDING_LABELS,
  getCompatibleBuildings,
  JOB_FILL_ORDER,
  JOB_LABELS,
  RESOURCE_KINDS,
  RESOURCE_LABELS,
  URBAN_SUB_DISTRICT_KINDS,
  URBAN_SUB_DISTRICT_LABELS,
} from "../data/Economy";
import type {
  BuildingKind,
  BuildingSlotArea,
  JobClass,
  JobKind,
  PlanetState,
  UrbanSubDistrictKind,
} from "../data/Economy";
import type { ClientCommand } from "../game/GameProtocol";

export type CelestialObjectKind = "planet" | "star";

export interface CelestialObjectPanelData {
  kind: CelestialObjectKind;
  objectId: string;
  name: string;
  subtitle: string;
  isHabited: boolean;
  objectDetails: CelestialObjectDetails;
  planetState?: PlanetState;
  imageUrl?: string;
  accentColor?: string;
  onPlanetCommand?: (command: ClientCommand) => void;
}

const STYLE_ID = "celestial-object-panel-style";

const DISTRICTS: Array<{ kind: DistrictKind; label: string; code: string }> = [
  { kind: "city", label: "City Districts", code: "CT" },
  { kind: "generator", label: "Generator Districts", code: "EN" },
  { kind: "mining", label: "Mining Districts", code: "MN" },
  { kind: "agriculture", label: "Agriculture Districts", code: "AG" },
];

export class CelestialObjectPanel {
  private root: HTMLDivElement;
  private panelElement: HTMLDivElement | null = null;
  private currentData: CelestialObjectPanelData | null = null;
  private activeTab: "surface" | "economy" = "surface";
  private selectedJob: JobKind | null = null;
  private position = { x: 24, y: 70 };
  private dragOffset = { x: 0, y: 0 };
  private isDragging = false;

  private readonly onPointerMove = (ev: PointerEvent): void => {
    if (!this.isDragging || !this.panelElement) return;
    ev.preventDefault();
    const width = this.panelElement.offsetWidth;
    const height = this.panelElement.offsetHeight;
    this.position.x = Math.max(8, Math.min(window.innerWidth - width - 8, ev.clientX - this.dragOffset.x));
    this.position.y = Math.max(8, Math.min(window.innerHeight - height - 8, ev.clientY - this.dragOffset.y));
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

  public show(data: CelestialObjectPanelData): void {
    if (this.currentData?.objectId !== data.objectId) {
      this.activeTab = "surface";
      this.selectedJob = null;
    }
    this.currentData = data;
    if (!this.panelElement) {
      this.panelElement = document.createElement("div");
      this.panelElement.className = "celestialObjectPanel";
      this.root.appendChild(this.panelElement);
    }

    this.panelElement.style.setProperty("--object-accent", data.accentColor ?? "rgba(102, 236, 199, 0.95)");
    this.panelElement.innerHTML = this.render(data);
    this.applyPosition();
    this.bindPanelEvents(data);
  }

  public refreshPlanetState(
    planetId: string,
    planetState: PlanetState,
    objectDetails: CelestialObjectDetails,
    isHabited: boolean,
  ): void {
    if (!this.currentData || this.currentData.objectId !== planetId) return;
    this.show({
      ...this.currentData,
      isHabited,
      objectDetails,
      planetState,
    });
  }

  public close(): void {
    this.panelElement?.remove();
    this.panelElement = null;
    this.onPointerUp();
  }

  public dispose(): void {
    this.close();
  }

  private bindPanelEvents(data: CelestialObjectPanelData): void {
    if (!this.panelElement) return;

    const closeButton = this.panelElement.querySelector<HTMLButtonElement>("[data-co-close]");
    closeButton?.addEventListener("click", () => this.close());

    const header = this.panelElement.querySelector<HTMLElement>("[data-co-drag]");
    header?.addEventListener("pointerdown", (ev) => {
      if (!this.panelElement) return;
      ev.preventDefault();
      const rect = this.panelElement.getBoundingClientRect();
      this.dragOffset.x = ev.clientX - rect.left;
      this.dragOffset.y = ev.clientY - rect.top;
      this.isDragging = true;
      window.addEventListener("pointermove", this.onPointerMove);
      window.addEventListener("pointerup", this.onPointerUp);
    });

    const hero = this.panelElement.querySelector<HTMLElement>("[data-co-hero]");
    const portrait = this.panelElement.querySelector<HTMLElement>("[data-co-portrait]");
    if (data.imageUrl) {
      hero?.style.setProperty("background-image", `linear-gradient(90deg, rgba(3, 12, 16, 0.14), rgba(3, 12, 16, 0.78)), url("${data.imageUrl}")`);
      portrait?.style.setProperty("background-image", `url("${data.imageUrl}")`);
    }

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-co-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.classList.contains("disabled")) return;
        this.activeTab = button.dataset.coTab === "economy" ? "economy" : "surface";
        this.show(data);
      });
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-co-build-district]").forEach((button) => {
      button.addEventListener("click", () => {
        const districtKind = button.dataset.coBuildDistrict as DistrictKind | undefined;
        if (!districtKind || !data.planetState) return;
        data.onPlanetCommand?.({ type: "buildDistrict", planetId: data.planetState.id, districtKind });
      });
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-co-building-slot]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!data.planetState) return;
        this.openBuildingPicker(button, data, {
          area: button.dataset.coArea as BuildingSlotArea,
          slotIndex: Number(button.dataset.coSlotIndex),
          subDistrictIndex: button.dataset.coSubIndex === undefined
            ? undefined
            : Number(button.dataset.coSubIndex),
        });
      });
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-co-change-sub]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!data.planetState) return;
        this.openSubDistrictPicker(button, data, Number(button.dataset.coSubIndex));
      });
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-co-job]").forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedJob = button.dataset.coJob as JobKind;
        this.show(data);
      });
    });
  }

  private applyPosition(): void {
    if (!this.panelElement) return;
    this.panelElement.style.left = `${this.position.x}px`;
    this.panelElement.style.top = `${this.position.y}px`;
  }

  private render(data: CelestialObjectPanelData): string {
    const details = data.objectDetails;
    const habitability = details.habitability === null ? "?%" : `${details.habitability}%`;
    const isPlanet = data.kind === "planet";
    const isHabitedPlanet = isPlanet && data.isHabited;
    const planetState = data.planetState;
    const tabsDisabled = isHabitedPlanet ? "" : " disabled";

    return `
      <div class="coHeader" data-co-drag>
        <div class="coHeaderSigil">${isPlanet ? "P" : "S"}</div>
        <div>
          <div class="coTitle">${this.escapeHtml(data.name)}</div>
          <div class="coSubtitle">${this.escapeHtml(data.subtitle)}</div>
        </div>
        <button class="coClose" type="button" data-co-close aria-label="Close object panel">X</button>
      </div>
      <div class="coHeroRow">
        <div class="coHero" data-co-hero>
          ${isHabitedPlanet ? '<div class="coLeaderCard"><div class="coLeaderPortrait"></div><div><strong>Sector Official</strong><span>Placeholder Leader</span></div></div>' : ""}
          ${isPlanet && !isHabitedPlanet ? '<button class="coHeroAction" type="button">Terraform</button>' : ""}
        </div>
        <aside class="coSummary">
          <div class="coSectionTitle">${isPlanet ? "Planet Summary" : "Stellar Summary"}</div>
          <div class="coTypeName">${this.escapeHtml(details.typeName)}</div>
          <div class="coSummaryGrid">
            <span>Habitability</span><strong>${habitability}</strong>
            <span>Habited</span><strong>${data.isHabited ? "Yes" : "No"}</strong>
            <span>Size</span><strong>${details.size}</strong>
          </div>
          <div class="coPortrait" data-co-portrait></div>
        </aside>
      </div>
      <div class="coResourceStrip">
        <span>STABILITY ${planetState ? `${planetState.economy.stability.toFixed(0)}%` : "?%"}</span>
        <span>POP ${planetState ? this.formatPeople(planetState.population) : "0"}</span>
        <span>CRIME ${planetState ? `${planetState.economy.crime.toFixed(0)}%` : "?%"}</span>
        <span>AMENITIES ${planetState ? this.formatCompact(planetState.economy.amenities) : "0"}</span>
        <span>HOUSING ${planetState ? this.formatPeople(planetState.economy.housing) : "0"}</span>
      </div>
      ${this.activeTab === "economy" && isHabitedPlanet && planetState
        ? this.renderEconomyBody(planetState)
        : this.renderSurfaceBody(data)}
      <nav class="coTabs">
        <button class="${this.activeTab === "surface" ? "active" : ""}" type="button" data-co-tab="surface">Surface</button>
        <button class="${tabsDisabled}" type="button">Management</button>
        <button class="${this.activeTab === "economy" ? "active" : ""} ${tabsDisabled}" type="button" data-co-tab="economy">Economy</button>
        <button class="${tabsDisabled}" type="button">Armies</button>
        <button class="${tabsDisabled}" type="button">Holdings</button>
      </nav>
    `;
  }

  private renderSubDistrictSlots(): string {
    return `
      <div class="coSubDistricts">
        <div>
          <span>Residential Arcology</span>
          <div class="coEmbeddedBuildings coSubBuildings">${this.renderBuildingSlots(true, 3)}</div>
        </div>
        <div>
          <span>Service Grid</span>
          <div class="coEmbeddedBuildings coSubBuildings">${this.renderBuildingSlots(true, 3)}</div>
        </div>
      </div>
    `;
  }

  private renderDistrict(
    kind: DistrictKind,
    label: string,
    built: DistrictCounts,
    limits: DistrictCounts,
    showCityIndustry: boolean,
  ): string {
    const used = built[kind];
    const limit = limits[kind];
    const district = DISTRICTS.find((entry) => entry.kind === kind);
    return `
      <div class="coDistrictTitle">${this.escapeHtml(label)}</div>
      <div class="coDistrictContent">
        <div class="coDistrictIcon ${kind}">${district?.code ?? ""}</div>
        <div class="coDistrictMeta">
          ${showCityIndustry ? '<div class="coSpecialization">Space Age Industry</div>' : ""}
          <div class="coDistrictCount">${used}/${limit}</div>
          <div class="coDistrictBar ${kind}">
            ${this.renderDistrictSlots(used, limit)}
          </div>
        </div>
      </div>
    `;
  }

  private renderDistrictSlots(used: number, limit: number): string {
    if (limit <= 0) return '<span class="empty zero"></span>';
    return Array.from({ length: limit }, (_, index) => (
      `<span class="${index < used ? "filled" : "empty"}"></span>`
    )).join("");
  }

  private renderBuildingSlots(enabled: boolean, slotCount: number): string {
    return Array.from({ length: slotCount }, (_, index) => {
      if (!enabled) return '<span class="placeholder"></span>';
      if (index === 0) return '<span class="filled">Archives</span>';
      if (index === 1 && slotCount > 3) return '<span class="filled">Industry</span>';
      return '<span>+</span>';
    }).join("");
  }

  private renderProductionPlaceholder(): string {
    return `
      <div class="coProduction">
        <h4>Planet Production</h4>
        <div class="coTokenGrid">
          <span>EN 80</span><span>MN 83</span><span>FD 119</span><span>RS 19</span>
          <span>AL 53</span><span>CG 101</span><span>AM 35</span><span>TR 17</span>
        </div>
        <h4>Planet Deficit</h4>
        <div class="coEmptyLine">No active deficits</div>
      </div>
    `;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.celestialObjectPanel {
  --object-accent: rgba(102, 236, 199, 0.95);
  position: fixed;
  width: min(1040px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: hidden;
  pointer-events: auto;
  color: var(--hud-ink, #d6dde7);
  border: 1px solid rgba(73, 156, 129, 0.82);
  background:
    linear-gradient(180deg, rgba(12, 34, 28, 0.92), rgba(5, 10, 14, 0.96)),
    radial-gradient(circle at 20% 0%, rgba(96, 234, 190, 0.14), transparent 32rem);
  box-shadow: 0 24px 90px rgba(0, 0, 0, 0.58), inset 0 0 0 1px rgba(149, 255, 220, 0.08);
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
  z-index: 88;
}

.coHeader {
  height: 50px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  cursor: move;
  background:
    linear-gradient(90deg, rgba(26, 63, 51, 0.92), rgba(17, 35, 33, 0.72)),
    linear-gradient(135deg, rgba(255, 255, 255, 0.07), transparent 48%);
  border-bottom: 1px solid rgba(110, 212, 181, 0.38);
  user-select: none;
}

.coHeaderSigil {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  clip-path: polygon(50% 0, 92% 25%, 92% 75%, 50% 100%, 8% 75%, 8% 25%);
  border: 1px solid rgba(194, 255, 231, 0.75);
  background: linear-gradient(160deg, rgba(18, 56, 48, 0.95), rgba(8, 18, 22, 0.96));
  color: var(--object-accent);
  font-weight: 800;
}

.coTitle {
  font-size: 18px;
  color: #eefaf6;
  text-shadow: 0 0 12px rgba(99, 236, 199, 0.38);
}

.coSubtitle {
  margin-top: 3px;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: rgba(188, 217, 207, 0.72);
  text-transform: uppercase;
}

.coClose {
  margin-left: auto;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(103, 255, 221, 0.72);
  background: rgba(5, 34, 32, 0.78);
  color: #bfffee;
  font: inherit;
  cursor: pointer;
}

.coClose:hover {
  background: rgba(16, 88, 77, 0.9);
}

.coHeroRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  min-height: 150px;
  border-bottom: 1px solid rgba(110, 212, 181, 0.32);
}

.coHero {
  position: relative;
  background:
    linear-gradient(90deg, rgba(4, 16, 18, 0.2), rgba(4, 16, 18, 0.82)),
    radial-gradient(circle at 45% 28%, rgba(73, 158, 201, 0.34), transparent 19rem),
    linear-gradient(135deg, rgba(54, 97, 87, 0.9), rgba(8, 20, 23, 0.98));
  background-size: cover;
  background-position: center;
}

.coHero::after {
  content: "";
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.04) 1px, transparent 1px, transparent 4px);
  opacity: 0.3;
  pointer-events: none;
}

.coHeroAction {
  position: absolute;
  left: 50%;
  top: 48%;
  transform: translate(-50%, -50%);
  min-width: 150px;
  min-height: 42px;
  border: 1px solid rgba(194, 255, 231, 0.34);
  background: rgba(22, 27, 31, 0.76);
  color: rgba(230, 240, 238, 0.72);
  font: inherit;
}

.coLeaderCard {
  position: absolute;
  left: 14px;
  top: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(4, 17, 17, 0.68);
  border: 1px solid rgba(92, 221, 184, 0.38);
}

.coLeaderCard span {
  display: block;
  margin-top: 3px;
  color: rgba(218, 236, 229, 0.72);
  font-size: 10px;
}

.coLeaderPortrait {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: linear-gradient(160deg, #516b71, #1a2529 60%, #111);
  border: 1px solid rgba(179, 255, 229, 0.42);
}

.coSummary {
  position: relative;
  padding: 16px 116px 14px 16px;
  background:
    radial-gradient(circle at 100% 28%, rgba(76, 167, 214, 0.18), transparent 10rem),
    rgba(4, 12, 16, 0.88);
}

.coSectionTitle {
  color: var(--object-accent);
  font-size: 16px;
  margin-bottom: 6px;
}

.coTypeName {
  color: #9cffcc;
  font-weight: 800;
  font-size: 12px;
  margin-bottom: 8px;
}

.coSummaryGrid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 8px;
  font-size: 12px;
}

.coSummaryGrid span {
  color: #d9eee5;
}

.coSummaryGrid strong {
  color: #f4d56f;
}

.coPortrait {
  position: absolute;
  right: 18px;
  top: 38px;
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 36% 30%, rgba(239, 255, 243, 0.92), rgba(91, 167, 144, 0.78) 32%, rgba(17, 38, 48, 0.92) 68%, rgba(0, 0, 0, 0.92));
  background-size: cover;
  background-position: center;
  border: 2px solid rgba(147, 252, 223, 0.62);
  box-shadow: 0 0 18px rgba(93, 236, 194, 0.28);
}

.coResourceStrip {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  border-bottom: 1px solid rgba(110, 212, 181, 0.24);
  background: rgba(10, 24, 23, 0.72);
}

.coResourceStrip span {
  padding: 7px 10px;
  border-right: 1px solid rgba(110, 212, 181, 0.24);
  color: rgba(191, 231, 220, 0.82);
  font-size: 11px;
  text-align: center;
}

.coBody {
  background: rgba(4, 12, 13, 0.76);
}

.coBodyHeader {
  padding: 7px 12px;
  font-size: 15px;
  color: #edf7f3;
  border-bottom: 1px solid rgba(110, 212, 181, 0.24);
}

.coDistrictGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
}

.coDistrictCard,
.coInfoCard {
  min-height: 124px;
  padding: 7px;
  border: 1px solid rgba(76, 158, 133, 0.46);
  background:
    linear-gradient(135deg, rgba(16, 65, 67, 0.36), rgba(10, 19, 18, 0.86)),
    rgba(8, 20, 19, 0.74);
}

.coDistrictCity {
  grid-column: span 2;
}

.coDistrictagriculture {
  grid-column: auto;
}

.coInfoCard {
  grid-column: 3;
  grid-row: 1;
  color: rgba(232, 242, 237, 0.9);
  line-height: 1.28;
  font-size: 12px;
}

.coDistrictTitle {
  font-size: 12px;
  color: #eefaf6;
  margin-bottom: 6px;
}

.coDistrictContent {
  display: flex;
  gap: 10px;
}

.coDistrictIcon {
  width: 62px;
  height: 62px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border: 1px solid rgba(176, 255, 229, 0.48);
  background: linear-gradient(145deg, rgba(80, 110, 120, 0.9), rgba(18, 30, 34, 0.96));
  color: #e9fff8;
  font-weight: 900;
}

.coDistrictIcon.generator { color: #dbe447; }
.coDistrictIcon.mining { color: #f27761; }
.coDistrictIcon.agriculture { color: #62e865; }

.coDistrictMeta {
  min-width: 0;
  flex: 1;
}

.coSpecialization {
  color: #f4d56f;
  margin-bottom: 8px;
  font-size: 12px;
}

.coDistrictCount {
  display: inline-block;
  min-width: 48px;
  margin-bottom: 5px;
  padding: 3px 6px;
  background: rgba(5, 16, 20, 0.68);
  border: 1px solid rgba(159, 232, 212, 0.28);
  color: #effaf7;
  font-size: 12px;
}

.coDistrictBar {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}

.coDistrictBar span {
  width: 14px;
  height: 7px;
  border: 1px solid rgba(58, 169, 238, 0.88);
  background: rgba(9, 37, 51, 0.76);
}

.coDistrictBar .filled {
  background: rgba(28, 151, 213, 0.92);
}

.coDistrictBar.generator span { border-color: rgba(216, 224, 55, 0.86); }
.coDistrictBar.generator .filled { background: rgba(167, 174, 26, 0.92); }
.coDistrictBar.mining span { border-color: rgba(235, 92, 72, 0.88); }
.coDistrictBar.mining .filled { background: rgba(154, 55, 41, 0.92); }
.coDistrictBar.agriculture span { border-color: rgba(60, 218, 69, 0.88); }
.coDistrictBar.agriculture .filled { background: rgba(29, 146, 38, 0.92); }
.coDistrictBar .zero { opacity: 0.3; }

.coSubDistricts {
  margin-top: 6px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.coSubDistricts span {
  display: block;
  border: 1px solid rgba(104, 232, 200, 0.52);
  padding: 5px;
  color: rgba(226, 247, 241, 0.9);
  background: rgba(8, 32, 32, 0.72);
  font-size: 11px;
}

.coProduction h4 {
  margin: 5px 0;
  text-align: center;
  color: #eefaf6;
}

.coTokenGrid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  color: #5df0a7;
  font-size: 11px;
}

.coEmptyLine {
  margin-top: 8px;
  text-align: center;
  color: rgba(185, 202, 198, 0.6);
}

.coEmbeddedBuildings {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  margin-top: 6px;
}

.coCityBuildings {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.coSubBuildings {
  margin-top: 5px;
}

.coEmbeddedBuildings span {
  min-height: 26px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(103, 255, 221, 0.58);
  background: rgba(6, 26, 26, 0.62);
  color: #9dffdf;
  font-weight: 800;
  font-size: 10px;
  text-align: center;
  padding: 2px;
  overflow: hidden;
}

.coEmbeddedBuildings .filled {
  color: #e4efe9;
  background: rgba(31, 56, 54, 0.82);
}

.coEmbeddedBuildings .placeholder {
  opacity: 0.32;
}

.coTabs {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
}

.coTabs button {
  min-height: 34px;
  border: 0;
  border-right: 1px solid rgba(110, 212, 181, 0.2);
  background: linear-gradient(120deg, rgba(34, 66, 59, 0.94), rgba(13, 21, 22, 0.94));
  color: rgba(223, 238, 234, 0.86);
  font: inherit;
}

.coTabs button.active {
  background: linear-gradient(120deg, rgba(42, 86, 75, 0.98), rgba(17, 39, 36, 0.98));
  color: #fff;
}

.coTabs button.disabled {
  opacity: 0.42;
}

@media (max-width: 760px) {
  .celestialObjectPanel {
    width: calc(100vw - 16px);
  }

  .coHeroRow,
  .coDistrictGrid {
    grid-template-columns: 1fr;
  }

  .coDistrictCity,
  .coInfoCard {
    grid-column: auto;
    grid-row: auto;
  }
}
    `;
    document.head.appendChild(style);
  }
}
