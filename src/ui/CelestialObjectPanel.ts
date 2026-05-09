import type { CelestialObjectDetails, DistrictCounts, DistrictKind } from "../data/StarMap";
import {
  BUILDING_KINDS,
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
  private buildingPickerTarget: { area: BuildingSlotArea; slotIndex: number; subDistrictIndex?: number } | null = null;
  private position = { x: 24, y: 70 };
  private dragOffset = { x: 0, y: 0 };
  private isDragging = false;

  private readonly onPointerMove = (ev: PointerEvent): void => {
    if (!this.isDragging || !this.panelElement) return;
    ev.preventDefault();
    const rect = this.panelElement.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
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
      this.buildingPickerTarget = null;
    }
    this.currentData = data;
    if (this.buildingPickerTarget) {
      this.buildingPickerTarget = this.resolveBuildingPickerTarget(data, this.buildingPickerTarget);
    }
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
    this.currentData = null;
    this.selectedJob = null;
    this.buildingPickerTarget = null;
    this.activeTab = "surface";
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
        this.openBuildingPicker(data, {
          area: button.dataset.coArea as BuildingSlotArea,
          slotIndex: Number(button.dataset.coSlotIndex),
          subDistrictIndex: button.dataset.coSubIndex === undefined
            ? undefined
            : Number(button.dataset.coSubIndex),
        });
      });
    });

    const closeBuildingPicker = this.panelElement.querySelector<HTMLButtonElement>("[data-co-close-building-picker]");
    closeBuildingPicker?.addEventListener("click", () => {
      this.buildingPickerTarget = null;
      this.show(data);
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-co-pick-building]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!data.planetState || !this.buildingPickerTarget) return;
        const buildingKind = button.dataset.coPickBuilding as BuildingKind | undefined;
        if (!buildingKind) return;
        data.onPlanetCommand?.({
          type: "buildPlanetBuilding",
          planetId: data.planetState.id,
          area: this.buildingPickerTarget.area,
          slotIndex: this.buildingPickerTarget.slotIndex,
          subDistrictIndex: this.buildingPickerTarget.subDistrictIndex,
          buildingKind,
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

  private renderSurfaceBody(data: CelestialObjectPanelData): string {
    const details = data.objectDetails;
    const planetState = data.planetState;
    const built = planetState?.builtDistricts ?? details.builtDistricts;
    const limits = details.districtLimits;
    const canBuild = data.kind === "planet" && data.isHabited && Boolean(planetState);
    const buildTray = this.renderBuildingTray(data);
    const sidePanel = buildTray || this.renderPlanetOverview(data);

    return `
      <section class="coBody">
        <div class="coBodyHeader">Districts and Buildings</div>
        <div class="coSurfaceLayout${sidePanel ? " withSide" : ""}">
          <div class="coDistrictGrid">
            <article class="coDistrictCard coDistrictCity">
              ${this.renderDistrict("city", "City Districts", built, limits, data.isHabited, canBuild)}
              <div class="coEmbeddedBuildings coCityBuildings">
                ${this.renderBuildingSlotsForArea(data, "city", planetState?.buildings.city ?? [], 6)}
              </div>
              ${planetState && data.isHabited ? this.renderUrbanSubDistricts(data, planetState) : ""}
            </article>
            <article class="coInfoCard">
              ${planetState && data.isHabited ? this.renderProductionPanels(planetState) : this.renderDescription(details)}
            </article>
            <article class="coDistrictCard">
              ${this.renderDistrict("generator", "Generator Districts", built, limits, false, canBuild)}
              <div class="coEmbeddedBuildings">
                ${this.renderBuildingSlotsForArea(data, "generator", planetState?.buildings.generator ?? [], 3)}
              </div>
            </article>
            <article class="coDistrictCard">
              ${this.renderDistrict("mining", "Mining Districts", built, limits, false, canBuild)}
              <div class="coEmbeddedBuildings">
                ${this.renderBuildingSlotsForArea(data, "mining", planetState?.buildings.mining ?? [], 3)}
              </div>
            </article>
            <article class="coDistrictCard">
              ${this.renderDistrict("agriculture", "Agriculture Districts", built, limits, false, canBuild)}
              <div class="coEmbeddedBuildings">
                ${this.renderBuildingSlotsForArea(data, "agriculture", planetState?.buildings.agriculture ?? [], 3)}
              </div>
            </article>
          </div>
          ${sidePanel}
        </div>
      </section>
    `;
  }

  private renderDescription(details: CelestialObjectDetails): string {
    return `
      <div class="coDescriptionType">${this.escapeHtml(details.typeName)}</div>
      <p>${this.escapeHtml(details.description)}</p>
    `;
  }

  private renderUrbanSubDistricts(data: CelestialObjectPanelData, planetState: PlanetState): string {
    return `
      <div class="coSubDistricts">
        ${planetState.urbanSubDistricts.map((subDistrict, index) => `
          <div class="coSubDistrictCard">
            <div class="coSubDistrictHeader">
              <span>${this.escapeHtml(URBAN_SUB_DISTRICT_LABELS[subDistrict.kind])}</span>
              <button type="button" title="Change sub-district" data-co-change-sub data-co-sub-index="${index}">Change</button>
            </div>
            <div class="coEmbeddedBuildings coSubBuildings">
              ${this.renderBuildingSlotsForArea(data, "urbanSubDistrict", subDistrict.buildings, 3, index)}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  private renderDistrict(
    kind: DistrictKind,
    label: string,
    built: DistrictCounts,
    limits: DistrictCounts,
    showCityIndustry: boolean,
    canBuild: boolean,
  ): string {
    const used = built[kind];
    const limit = limits[kind];
    const district = DISTRICTS.find((entry) => entry.kind === kind);
    const buildDisabled = !canBuild || used >= limit ? " disabled" : "";
    return `
      <div class="coDistrictTitle">
        <span>${this.escapeHtml(label)}</span>
        <button class="coTinyAction${buildDisabled}" type="button" data-co-build-district="${kind}"${buildDisabled ? " disabled" : ""}>+</button>
      </div>
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

  private renderBuildingSlotsForArea(
    data: CelestialObjectPanelData,
    area: BuildingSlotArea,
    slots: Array<BuildingKind | null>,
    slotCount: number,
    subDistrictIndex?: number,
  ): string {
    const enabled = data.isHabited && Boolean(data.planetState);
    return Array.from({ length: slotCount }, (_, index) => {
      if (!enabled) return '<span class="placeholder"></span>';
      const building = slots[index] ?? null;
      if (building) return `<span class="filled">${this.escapeHtml(BUILDING_LABELS[building])}</span>`;
      const subAttribute = subDistrictIndex === undefined ? "" : ` data-co-sub-index="${subDistrictIndex}"`;
      const selected = this.isBuildingPickerTarget(area, index, subDistrictIndex) ? " selected" : "";
      return `
        <button
          class="coBuildingSlot${selected}"
          type="button"
          data-co-building-slot
          data-co-area="${area}"
          data-co-slot-index="${index}"
          ${subAttribute}
        >+</button>
      `;
    }).join("");
  }

  private renderBuildingTray(data: CelestialObjectPanelData): string {
    const planetState = data.planetState;
    const target = this.buildingPickerTarget;
    if (!planetState || !target) return "";
    const subDistrictKind = this.getTargetSubDistrictKind(planetState, target);
    const compatible = new Set(getCompatibleBuildings(target.area, subDistrictKind));
    const targetLabel = this.getBuildingTargetLabel(planetState, target);

    return `
      <aside class="coBuildTray">
        <div class="coBuildTrayHeader">
          <div>
            <strong>Construct Building</strong>
            <span>${this.escapeHtml(targetLabel)}</span>
          </div>
          <button type="button" data-co-close-building-picker aria-label="Close building list">X</button>
        </div>
        <div class="coBuildList">
          ${BUILDING_KINDS.map((building) => {
            const isCompatible = compatible.has(building);
            return `
              <button
                type="button"
                data-co-pick-building="${building}"
                class="${isCompatible ? "" : "incompatible"}"
                ${isCompatible ? "" : "disabled"}
              >
                <span>${this.escapeHtml(BUILDING_LABELS[building])}</span>
                <small>${isCompatible ? "Available" : "Incompatible slot"}</small>
              </button>
            `;
          }).join("")}
        </div>
      </aside>
    `;
  }

  private renderPlanetOverview(data: CelestialObjectPanelData): string {
    const planetState = data.planetState;
    if (!planetState || !data.isHabited) return "";
    const economy = planetState.economy;
    const openBuildingSlots = this.collectOpenBuildingSlots(planetState).length;
    const districtUsed = DISTRICTS.reduce((sum, district) => sum + planetState.builtDistricts[district.kind], 0);
    const districtLimit = DISTRICTS.reduce((sum, district) => sum + data.objectDetails.districtLimits[district.kind], 0);
    const housingDelta = economy.housing - planetState.population;
    const amenityNeed = planetState.population / 1_000_000;
    const amenityDelta = economy.amenities - amenityNeed;

    return `
      <aside class="coPlanetOverview">
        <div class="coSidePanelHeader">
          <div>
            <strong>Planet Overview</strong>
            <span>Surface command summary</span>
          </div>
        </div>
        <div class="coOverviewGrid">
          <div><span>Unemployment</span><strong>${this.formatPeople(economy.unemployedPopulation)}</strong></div>
          <div><span>Employed</span><strong>${this.formatPeople(economy.employedPopulation)}</strong></div>
          <div><span>Armies</span><strong>0</strong></div>
          <div><span>Open Building Slots</span><strong>${openBuildingSlots}</strong></div>
          <div><span>Districts</span><strong>${districtUsed}/${districtLimit}</strong></div>
          <div><span>Housing Balance</span><strong>${this.formatSignedPeople(housingDelta)}</strong></div>
          <div><span>Amenities Balance</span><strong>${this.formatSignedCompact(amenityDelta)}</strong></div>
          <div><span>Migration</span><strong>0/mo</strong></div>
          <div><span>Defense Rating</span><strong>0</strong></div>
          <div><span>Planet Features</span><strong>Pending</strong></div>
        </div>
        <div class="coOverviewActions">
          <button type="button">Features</button>
          <button type="button">Decisions</button>
        </div>
      </aside>
    `;
  }

  private renderProductionPanels(planetState: PlanetState): string {
    const netRows = RESOURCE_KINDS.map((resource) => {
      const value = planetState.economy.net[resource];
      const className = value >= 0 ? "positive" : "negative";
      return `<span class="${className}">${this.escapeHtml(RESOURCE_LABELS[resource])} ${this.formatSignedCompact(value)}</span>`;
    }).join("");
    const deficits = RESOURCE_KINDS
      .filter((resource) => planetState.economy.deficit[resource] > 0)
      .map((resource) => `<span class="negative">${this.escapeHtml(RESOURCE_LABELS[resource])} -${this.formatCompact(planetState.economy.deficit[resource])}</span>`)
      .join("");

    return `
      <div class="coProduction">
        <h4>Planet Production</h4>
        <div class="coTokenGrid">${netRows}</div>
        <h4>Planet Deficit</h4>
        ${deficits ? `<div class="coTokenGrid">${deficits}</div>` : '<div class="coEmptyLine">No active deficits</div>'}
      </div>
    `;
  }

  private renderEconomyBody(planetState: PlanetState): string {
    const classes: Array<{ className: JobClass; label: string }> = [
      { className: "upper", label: "Upper Class" },
      { className: "middle", label: "Middle Class" },
      { className: "lower", label: "Lower Class" },
    ];
    const selected = this.selectedJob
      ? planetState.economy.popGroups.find((group) => group.job === this.selectedJob)
      : null;

    return `
      <section class="coBody coEconomyBody">
        <div class="coJobsPanel">
          <div class="coBodyHeader">Jobs</div>
          ${classes.map((entry) => this.renderJobClass(planetState, entry.className, entry.label)).join("")}
        </div>
        <aside class="coDemographicsPanel">
          <div class="coBodyHeader">Demographics</div>
          <div class="coGrowthGrid">
            <div><strong>Growing</strong><span>Placeholder</span></div>
            <div><strong>Assembling</strong><span>Placeholder</span></div>
            <div><strong>Declining</strong><span>Placeholder</span></div>
          </div>
          <div class="coSpeciesOrb"></div>
          <div class="coSelectedJob">
            ${selected ? this.renderSelectedJob(planetState, selected.job) : "Click a job to inspect its population group."}
          </div>
        </aside>
      </section>
    `;
  }

  private renderJobClass(planetState: PlanetState, className: JobClass, label: string): string {
    const jobs = JOB_FILL_ORDER
      .concat("unemployed")
      .filter((job) => this.getJobClass(job) === className);
    const total = jobs.reduce((sum, job) => sum + this.getPopForJob(planetState, job), 0);

    return `
      <div class="coJobClass">
        <div class="coJobClassTitle">
          <span>${this.escapeHtml(label)}</span>
          <strong>${this.formatPeople(total)}</strong>
        </div>
        <div class="coJobRows">
          ${jobs.map((job) => this.renderJobRow(planetState, job)).join("")}
        </div>
      </div>
    `;
  }

  private renderJobRow(planetState: PlanetState, job: JobKind): string {
    const population = this.getPopForJob(planetState, job);
    const capacity = planetState.economy.jobCapacity[job];
    const selected = this.selectedJob === job ? " selected" : "";
    return `
      <button class="coJobRow${selected}" type="button" data-co-job="${job}">
        <span>${this.escapeHtml(JOB_LABELS[job])}</span>
        <strong>${this.formatPeople(population)}</strong>
        <small>cap ${this.formatPeople(capacity)}</small>
      </button>
    `;
  }

  private renderSelectedJob(planetState: PlanetState, job: JobKind): string {
    const group = planetState.economy.popGroups.find((candidate) => candidate.job === job);
    const population = group?.population ?? 0;
    const jobClass = this.getJobClass(job);
    return `
      <h4>${this.escapeHtml(JOB_LABELS[job])}</h4>
      <p>Class: ${this.escapeHtml(jobClass)}</p>
      <p>Population: ${this.formatPeople(population)}</p>
      <p>Production and upkeep are included in the planet totals.</p>
    `;
  }

  private getPopForJob(planetState: PlanetState, job: JobKind): number {
    return planetState.economy.popGroups.find((group) => group.job === job)?.population ?? 0;
  }

  private getJobClass(job: JobKind): JobClass {
    if (job === "administrator") return "upper";
    if (job === "researcher" || job === "artisan" || job === "metallurgist") return "middle";
    return "lower";
  }

  private openBuildingPicker(
    data: CelestialObjectPanelData,
    slot: { area: BuildingSlotArea; slotIndex: number; subDistrictIndex?: number },
  ): void {
    if (!data.planetState || !Number.isInteger(slot.slotIndex)) return;
    this.buildingPickerTarget = this.resolveBuildingPickerTarget(data, slot);
    this.activeTab = "surface";
    this.show(data);
  }

  private resolveBuildingPickerTarget(
    data: CelestialObjectPanelData,
    target: { area: BuildingSlotArea; slotIndex: number; subDistrictIndex?: number } | null,
  ): { area: BuildingSlotArea; slotIndex: number; subDistrictIndex?: number } | null {
    const planetState = data.planetState;
    if (!data.isHabited || !planetState) return null;
    const openSlots = this.collectOpenBuildingSlots(planetState);
    if (openSlots.length === 0) return null;
    if (target && this.isBuildingSlotOpen(planetState, target)) return target;
    if (target) {
      const sameArea = openSlots.find((slot) => (
        slot.area === target.area && slot.subDistrictIndex === target.subDistrictIndex
      ));
      if (sameArea) return sameArea;
    }
    return openSlots[0];
  }

  private collectOpenBuildingSlots(
    planetState: PlanetState,
  ): Array<{ area: BuildingSlotArea; slotIndex: number; subDistrictIndex?: number }> {
    const slots: Array<{ area: BuildingSlotArea; slotIndex: number; subDistrictIndex?: number }> = [];
    const addDistrictSlots = (area: Exclude<DistrictKind, never>, buildings: Array<BuildingKind | null>): void => {
      buildings.forEach((building, slotIndex) => {
        if (!building) slots.push({ area, slotIndex });
      });
    };

    addDistrictSlots("city", planetState.buildings.city);
    planetState.urbanSubDistricts.forEach((subDistrict, subDistrictIndex) => {
      subDistrict.buildings.forEach((building, slotIndex) => {
        if (!building) slots.push({ area: "urbanSubDistrict", slotIndex, subDistrictIndex });
      });
    });
    addDistrictSlots("generator", planetState.buildings.generator);
    addDistrictSlots("mining", planetState.buildings.mining);
    addDistrictSlots("agriculture", planetState.buildings.agriculture);
    return slots;
  }

  private isBuildingSlotOpen(
    planetState: PlanetState,
    target: { area: BuildingSlotArea; slotIndex: number; subDistrictIndex?: number },
  ): boolean {
    if (!Number.isInteger(target.slotIndex)) return false;
    if (target.area === "urbanSubDistrict") {
      if (target.subDistrictIndex === undefined || !Number.isInteger(target.subDistrictIndex)) return false;
      return planetState.urbanSubDistricts[target.subDistrictIndex]?.buildings[target.slotIndex] === null;
    }
    return planetState.buildings[target.area]?.[target.slotIndex] === null;
  }

  private isBuildingPickerTarget(area: BuildingSlotArea, slotIndex: number, subDistrictIndex?: number): boolean {
    const target = this.buildingPickerTarget;
    return Boolean(target
      && target.area === area
      && target.slotIndex === slotIndex
      && target.subDistrictIndex === subDistrictIndex);
  }

  private getTargetSubDistrictKind(
    planetState: PlanetState,
    target: { area: BuildingSlotArea; slotIndex: number; subDistrictIndex?: number },
  ): UrbanSubDistrictKind | undefined {
    if (target.area !== "urbanSubDistrict" || target.subDistrictIndex === undefined) return undefined;
    return planetState.urbanSubDistricts[target.subDistrictIndex]?.kind;
  }

  private getBuildingTargetLabel(
    planetState: PlanetState,
    target: { area: BuildingSlotArea; slotIndex: number; subDistrictIndex?: number },
  ): string {
    if (target.area === "urbanSubDistrict" && target.subDistrictIndex !== undefined) {
      const subDistrict = planetState.urbanSubDistricts[target.subDistrictIndex];
      const label = subDistrict ? URBAN_SUB_DISTRICT_LABELS[subDistrict.kind] : "Sub-District";
      return `${label} slot ${target.slotIndex + 1}`;
    }
    const district = DISTRICTS.find((entry) => entry.kind === target.area);
    return `${district?.label ?? "District"} slot ${target.slotIndex + 1}`;
  }

  private openSubDistrictPicker(button: HTMLButtonElement, data: CelestialObjectPanelData, subDistrictIndex: number): void {
    if (!this.panelElement || !data.planetState || Number.isNaN(subDistrictIndex)) return;
    this.panelElement.querySelector(".coPicker")?.remove();
    const picker = document.createElement("div");
    picker.className = "coPicker";
    picker.innerHTML = URBAN_SUB_DISTRICT_KINDS
      .map((kind) => `<button type="button" data-co-pick-sub="${kind}">${this.escapeHtml(URBAN_SUB_DISTRICT_LABELS[kind])}</button>`)
      .join("");
    this.positionPicker(button, picker);
    this.panelElement.appendChild(picker);
    picker.querySelectorAll<HTMLButtonElement>("[data-co-pick-sub]").forEach((choice) => {
      choice.addEventListener("click", () => {
        const kind = choice.dataset.coPickSub as UrbanSubDistrictKind | undefined;
        if (!kind) return;
        data.onPlanetCommand?.({
          type: "setUrbanSubDistrict",
          planetId: data.planetState!.id,
          subDistrictIndex,
          subDistrictKind: kind,
        });
        picker.remove();
      });
    });
  }

  private positionPicker(anchor: HTMLElement, picker: HTMLDivElement): void {
    if (!this.panelElement) return;
    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = this.panelElement.getBoundingClientRect();
    const scale = panelRect.width / this.panelElement.offsetWidth || 1;
    picker.style.left = `${Math.max(8, (anchorRect.left - panelRect.left) / scale)}px`;
    picker.style.top = `${Math.max(8, (anchorRect.bottom - panelRect.top + 4) / scale)}px`;
  }

  private formatPeople(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}B`;
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
    if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
    return `${Math.round(value)}`;
  }

  private formatSignedPeople(value: number): string {
    return `${value >= 0 ? "+" : ""}${this.formatPeople(value)}`;
  }

  private formatCompact(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return `${Math.round(value * 10) / 10}`;
  }

  private formatSignedCompact(value: number): string {
    return `${value >= 0 ? "+" : ""}${this.formatCompact(value)}`;
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
  --co-panel-scale: 0.8;
  position: fixed;
  display: flex;
  flex-direction: column;
  width: min(1040px, calc(100vw - 24px));
  max-height: calc((100vh - 24px) / var(--co-panel-scale));
  overflow: hidden;
  transform: scale(var(--co-panel-scale));
  transform-origin: top left;
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
  flex: 0 0 auto;
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
  flex: 0 0 auto;
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
  flex: 0 0 auto;
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
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
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
  align-content: start;
  align-items: start;
  grid-auto-rows: max-content;
  gap: 4px;
  padding: 4px;
}

.coSurfaceLayout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  min-height: 0;
}

.coSurfaceLayout.withSide {
  grid-template-columns: minmax(0, 1fr) 270px;
}

.coDistrictCard,
.coInfoCard {
  align-self: start;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: #eefaf6;
  margin-bottom: 6px;
}

.coTinyAction,
.coSubDistrictHeader button {
  min-width: 28px;
  min-height: 24px;
  border: 1px solid rgba(103, 255, 221, 0.56);
  background: rgba(6, 42, 38, 0.72);
  color: #bfffee;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.coTinyAction.disabled,
.coSubDistrictHeader button:disabled {
  opacity: 0.35;
  cursor: default;
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

.coSubDistrictCard {
  border: 1px solid rgba(104, 232, 200, 0.52);
  padding: 5px;
  background: rgba(8, 32, 32, 0.72);
}

.coSubDistrictHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  color: rgba(226, 247, 241, 0.9);
  font-size: 11px;
}

.coDescriptionType {
  margin-bottom: 8px;
  color: #9cffcc;
  font-weight: 800;
}

.coProduction h4 {
  margin: 5px 0;
  text-align: center;
  color: #eefaf6;
}

.coTokenGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  color: #5df0a7;
  font-size: 11px;
}

.coTokenGrid .positive {
  color: #64ff9a;
}

.coTokenGrid .negative {
  color: #ff8a77;
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

.coEmbeddedBuildings span,
.coEmbeddedBuildings button {
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

.coEmbeddedBuildings button {
  cursor: pointer;
  font: inherit;
}

.coEmbeddedBuildings button:hover,
.coTinyAction:not(.disabled):hover,
.coSubDistrictHeader button:hover {
  background: rgba(18, 88, 79, 0.88);
}

.coBuildingSlot.selected {
  border-color: rgba(248, 218, 103, 0.92);
  color: #ffe989;
  box-shadow: inset 0 0 0 1px rgba(248, 218, 103, 0.36), 0 0 10px rgba(248, 218, 103, 0.16);
}

.coEmbeddedBuildings .filled {
  color: #e4efe9;
  background: rgba(31, 56, 54, 0.82);
}

.coEmbeddedBuildings .placeholder {
  opacity: 0.32;
}

.coEconomyBody {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 290px;
  gap: 6px;
  min-height: 0;
  padding: 5px;
}

.coBuildTray,
.coPlanetOverview {
  align-self: start;
  min-height: 0;
  margin: 4px 4px 4px 0;
  border: 1px solid rgba(96, 196, 164, 0.58);
  background:
    linear-gradient(180deg, rgba(13, 42, 39, 0.92), rgba(5, 13, 15, 0.96)),
    radial-gradient(circle at 50% 0%, rgba(103, 255, 221, 0.16), transparent 12rem);
}

.coBuildTray {
  display: flex;
  flex-direction: column;
}

.coBuildTrayHeader,
.coSidePanelHeader {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid rgba(110, 212, 181, 0.28);
}

.coBuildTrayHeader strong,
.coBuildTrayHeader span,
.coSidePanelHeader strong,
.coSidePanelHeader span {
  display: block;
}

.coBuildTrayHeader strong,
.coSidePanelHeader strong {
  color: #eefaf6;
  font-size: 13px;
}

.coBuildTrayHeader span,
.coSidePanelHeader span {
  margin-top: 3px;
  color: rgba(198, 231, 222, 0.72);
  font-size: 11px;
}

.coBuildTrayHeader button {
  min-width: 28px;
  min-height: 26px;
  border: 1px solid rgba(103, 255, 221, 0.56);
  background: rgba(6, 42, 38, 0.72);
  color: #bfffee;
  font: inherit;
  cursor: pointer;
}

.coBuildList {
  display: grid;
  gap: 4px;
  padding: 6px;
  max-height: 352px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.coBuildList::-webkit-scrollbar {
  width: 6px;
}

.coBuildList::-webkit-scrollbar-thumb {
  background: rgba(103, 255, 221, 0.34);
  border-radius: 999px;
}

.coBuildList button {
  display: grid;
  gap: 3px;
  min-height: 31px;
  padding: 4px 6px;
  border: 1px solid rgba(103, 255, 221, 0.36);
  background: rgba(6, 26, 26, 0.62);
  color: #e5fff8;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.coBuildList button:not(:disabled):hover {
  background: rgba(18, 88, 79, 0.88);
}

.coBuildList button.incompatible {
  opacity: 0.38;
  cursor: default;
}

.coBuildList span,
.coBuildList small {
  display: block;
}

.coBuildList small {
  color: rgba(201, 224, 218, 0.62);
  font-size: 10px;
}

.coOverviewGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  padding: 7px;
}

.coOverviewGrid div {
  min-height: 44px;
  padding: 6px;
  border: 1px solid rgba(103, 255, 221, 0.28);
  background: rgba(6, 26, 26, 0.52);
}

.coOverviewGrid span,
.coOverviewGrid strong {
  display: block;
}

.coOverviewGrid span {
  color: rgba(202, 225, 219, 0.68);
  font-size: 10px;
}

.coOverviewGrid strong {
  margin-top: 5px;
  color: #eafff8;
  font-size: 12px;
}

.coOverviewActions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  padding: 0 7px 7px;
}

.coOverviewActions button {
  min-height: 34px;
  border: 1px solid rgba(103, 255, 221, 0.48);
  background: rgba(9, 40, 37, 0.78);
  color: #bfffee;
  font: inherit;
  cursor: pointer;
}

.coOverviewActions button:hover {
  background: rgba(18, 88, 79, 0.88);
}

.coJobsPanel,
.coDemographicsPanel {
  border: 1px solid rgba(76, 158, 133, 0.46);
  background: rgba(8, 20, 19, 0.74);
}

.coJobClass {
  margin: 6px;
  border: 1px solid rgba(96, 196, 164, 0.36);
  background: rgba(10, 28, 27, 0.66);
}

.coJobClassTitle {
  display: flex;
  justify-content: space-between;
  padding: 6px 8px;
  color: #eefaf6;
  background: rgba(30, 62, 55, 0.74);
}

.coJobRows {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  padding: 5px;
}

.coJobRow {
  flex: 1 1 0;
  min-width: 0;
  display: grid;
  gap: 3px;
  min-height: 48px;
  padding: 4px;
  border: 1px solid rgba(103, 255, 221, 0.36);
  background: rgba(6, 26, 26, 0.62);
  color: #dff7ef;
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}

.coJobRow.selected {
  border-color: rgba(248, 218, 103, 0.82);
  background: rgba(67, 54, 18, 0.54);
}

.coJobRow strong {
  color: #9cffcc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.coJobRow small {
  color: rgba(208, 231, 225, 0.62);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.coJobRow span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.coGrowthGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
  padding: 8px;
}

.coGrowthGrid div,
.coSelectedJob {
  min-height: 62px;
  border: 1px solid rgba(103, 255, 221, 0.32);
  background: rgba(4, 16, 18, 0.58);
  padding: 6px;
  color: rgba(224, 242, 237, 0.82);
  font-size: 11px;
}

.coGrowthGrid strong,
.coGrowthGrid span {
  display: block;
}

.coGrowthGrid span {
  margin-top: 18px;
  color: rgba(198, 218, 213, 0.54);
}

.coSpeciesOrb {
  width: 104px;
  height: 104px;
  margin: 8px auto;
  border-radius: 50%;
  border: 1px solid rgba(151, 249, 222, 0.72);
  background:
    radial-gradient(circle at 35% 28%, rgba(214, 235, 255, 0.96), rgba(83, 157, 222, 0.72) 48%, rgba(14, 41, 56, 0.96) 80%);
  box-shadow: 0 0 24px rgba(73, 177, 224, 0.28);
}

.coSelectedJob {
  margin: 8px;
  min-height: 98px;
}

.coSelectedJob h4 {
  margin: 0 0 6px;
  color: #eefaf6;
}

.coSelectedJob p {
  margin: 4px 0;
}

.coPicker {
  position: absolute;
  z-index: 4;
  display: grid;
  gap: 3px;
  min-width: 190px;
  max-width: 260px;
  padding: 6px;
  border: 1px solid rgba(135, 255, 225, 0.76);
  background: rgba(4, 13, 15, 0.98);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
}

.coPicker button,
.coPicker span {
  padding: 6px 8px;
  border: 1px solid rgba(103, 255, 221, 0.32);
  background: rgba(12, 40, 38, 0.92);
  color: #e5fff8;
  font: inherit;
  font-size: 11px;
  text-align: left;
}

.coPicker button {
  cursor: pointer;
}

.coPicker button:hover {
  background: rgba(28, 88, 78, 0.96);
}

.coTabs {
  flex: 0 0 auto;
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
  .coDistrictGrid,
  .coEconomyBody,
  .coSurfaceLayout.withSide {
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
