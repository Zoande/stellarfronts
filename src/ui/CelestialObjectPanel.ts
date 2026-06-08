import type { CelestialObjectDetails, DistrictCounts, DistrictKind, PlanetType, StarType } from "../data/StarMap";
import {
  BUILDING_KINDS,
  BUILDING_DEFINITIONS,
  BUILDING_LABELS,
  BUILDING_MAX_LEVEL,
  createBuildingConstructionQueueItem,
  createBuildingUpgradeConstructionQueueItem,
  createDistrictConstructionQueueItem,
  DISTRICT_BUILD_DAYS,
  DISTRICT_MINERAL_COSTS,
  filterInvalidQueuedBuildingsForSubDistrictChange,
  getBuildingBuildDays,
  getBuildingLevelEffectMultiplier,
  getBuildingMineralCost,
  getBuildingUpgradeBuildDays,
  getBuildingUpgradeMineralCost,
  getBuildingUpgradeTargetLevel,
  getCompatibleBuildings,
  getConstructionSpeedMultiplier,
  getEffectiveSpeciesHabitability,
  getHabitabilityProductionMultiplier,
  getHabitabilityUpkeepMultiplier,
  getPlanetBuildingKind,
  getPlanetBuildingLevel,
  JOB_FILL_ORDER,
  JOB_DEFINITIONS,
  JOB_LABELS,
  PEOPLE_PER_MONTHLY_UNIT,
  isBuildingCompatible,
  PLANET_FEATURE_DEFINITIONS,
  RESOURCE_KINDS,
  RESOURCE_LABELS,
  URBAN_SUB_DISTRICT_KINDS,
  URBAN_SUB_DISTRICT_LABELS,
} from "../data/Economy";
import type {
  BuildingDefinition,
  BuildingKind,
  BuildingSlotArea,
  JobClass,
  JobKind,
  PlanetConstructionQueueItem,
  PlanetFeatureKind,
  PlanetBuildingSlot,
  PlanetModifierTarget,
  PlanetState,
  PopGroup,
  ResourceKind,
  UrbanSubDistrictKind,
} from "../data/Economy";
import type { ClientCommand } from "../game/GameProtocol";
import type { LeaderState } from "../data/Leaders";
import { GAME_DAYS_PER_YEAR } from "../game/GameTime";
import {
  getFirstRequiredTechName,
  getRequiredTechIdsForBuilding,
  getRequiredTechIdsForBuildingLevel,
} from "../data/Technology";
import type { FactionTechnologyView, TechId } from "../data/Technology";
import { PanelInteractionGate, captureScrollState, restoreScrollStateSoon } from "./panelDomState";
import { requestOpenLeadersPanel } from "./leaderEvents";
import { FloatingTooltipManager } from "./FloatingTooltipManager";

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
  technology?: FactionTechnologyView | null;
  onPlanetCommand?: (command: ClientCommand) => void;
  orbitFleetId?: string | null;
  assignedLeader?: LeaderState | null;
  canManageLeaders?: boolean;
  onClose?: (objectId: string, kind: CelestialObjectKind) => void;
}

const STYLE_ID = "celestial-object-panel-style";
const CELESTIAL_SCROLL_SELECTORS = [
  ".coBuildList",
  ".coQueueList",
  ".coFeatureList",
  ".coJobClassList",
  ".coPopGroupList",
] as const;
const PLANET_BANNER_DIR = "/textures/planet-banners";
const BUILDING_ICON_DIR = "/textures/buildings";
const DISTRICT_ICON_DIR = "/textures/districts";

type EconomyFlowResource = ResourceKind | "amenities" | "crime";

interface EconomyFlowEntry {
  resource: EconomyFlowResource;
  amount: number;
  direction: "input" | "output" | "effect";
}

interface TooltipGroupContribution {
  group: PopGroup;
  amount: number;
}

interface TooltipJobContribution {
  job: JobKind;
  amount: number;
  groups: TooltipGroupContribution[];
}

const DISTRICTS: Array<{ kind: DistrictKind; label: string; code: string }> = [
  { kind: "city", label: "City Districts", code: "CT" },
  { kind: "generator", label: "Generator Districts", code: "EN" },
  { kind: "mining", label: "Mining Districts", code: "MN" },
  { kind: "agriculture", label: "Agriculture Districts", code: "AG" },
];

const DISTRICT_LABELS: Record<DistrictKind, string> = {
  city: "City",
  generator: "Generator",
  mining: "Mining",
  agriculture: "Agriculture",
};

const DISTRICT_ICON_BY_KIND: Record<DistrictKind, string> = {
  city: `${DISTRICT_ICON_DIR}/City.webp`,
  generator: `${DISTRICT_ICON_DIR}/Generator.webp`,
  mining: `${DISTRICT_ICON_DIR}/Mining.webp`,
  agriculture: `${DISTRICT_ICON_DIR}/Agriculture.webp`,
};

const BUILDING_ICON_BY_KIND: Record<BuildingKind, string> = {
  housingComplex: `${BUILDING_ICON_DIR}/Housing_Complex.webp`,
  administrativeComplex: `${BUILDING_ICON_DIR}/Administrative_Complex.webp`,
  researchLabs: `${BUILDING_ICON_DIR}/Research_Labs.webp`,
  civilianFabricators: `${BUILDING_ICON_DIR}/Civilian_Fabricators.webp`,
  alloyFoundries: `${BUILDING_ICON_DIR}/Alloy_Foundries.webp`,
  commercialForum: `${BUILDING_ICON_DIR}/Commercial_Forum.webp`,
  foodProcessingPlant: `${BUILDING_ICON_DIR}/Food_Processing_Plant.webp`,
  agroIndustrialKitchens: `${BUILDING_ICON_DIR}/Agro-Industrial_Kitchens.webp`,
  mineralPurificationPlant: `${BUILDING_ICON_DIR}/Mineral_Purification_Plant.webp`,
  oreSmelter: `${BUILDING_ICON_DIR}/Ore_Smelter.webp`,
  energyGrid: `${BUILDING_ICON_DIR}/Energy_Grid.webp`,
  capacitorWorkshops: `${BUILDING_ICON_DIR}/Capacitor_Workshops.webp`,
  entertainmentForum: `${BUILDING_ICON_DIR}/Entertainment_Forum.webp`,
  securityOffice: `${BUILDING_ICON_DIR}/Security_Office.webp`,
};

const HABITED_PLANET_BANNERS: Partial<Record<PlanetType, string>> = {
  Barren: `${PLANET_BANNER_DIR}/Barren_banner.webp`,
  Gaseous: `${PLANET_BANNER_DIR}/Gaseous_banner.webp`,
  Snowy: `${PLANET_BANNER_DIR}/Snowy_banner_city.webp`,
  Arid: `${PLANET_BANNER_DIR}/Arid_banner_city.webp`,
  Dusty: `${PLANET_BANNER_DIR}/Dusty_banner_city.webp`,
  Grassland: `${PLANET_BANNER_DIR}/Grassland_banner_city.webp`,
  Jungle: `${PLANET_BANNER_DIR}/Jungle_banner_city.webp`,
  Marshy: `${PLANET_BANNER_DIR}/Marsh_banner_city.webp`,
  Martian: `${PLANET_BANNER_DIR}/Martian_banner_city.webp`,
  Methane: `${PLANET_BANNER_DIR}/Methane_banner_city.webp`,
  Sandy: `${PLANET_BANNER_DIR}/Sandy_banner_city.webp`,
  Tundra: `${PLANET_BANNER_DIR}/Tundra_banner_city.webp`,
};

const PLANET_NO_CITY_BANNERS: Record<PlanetType, string> = {
  Barren: `${PLANET_BANNER_DIR}/Barren_banner.webp`,
  Gaseous: `${PLANET_BANNER_DIR}/Gaseous_banner.webp`,
  Snowy: `${PLANET_BANNER_DIR}/Snowy_banner.webp`,
  Arid: `${PLANET_BANNER_DIR}/Arid_banner.webp`,
  Dusty: `${PLANET_BANNER_DIR}/Dusty_banner.webp`,
  Grassland: `${PLANET_BANNER_DIR}/Grassland_banner.webp`,
  Jungle: `${PLANET_BANNER_DIR}/Jungle_banner.webp`,
  Marshy: `${PLANET_BANNER_DIR}/Marsh_banner.webp`,
  Martian: `${PLANET_BANNER_DIR}/Martian_banner.webp`,
  Methane: `${PLANET_BANNER_DIR}/Methane_banner.webp`,
  Sandy: `${PLANET_BANNER_DIR}/Sandy_banner.webp`,
  Tundra: `${PLANET_BANNER_DIR}/Tundra_banner.webp`,
};

const STAR_BANNER_DIR = PLANET_BANNER_DIR;

const STAR_BANNERS: Record<StarType, string> = {
  B: `${STAR_BANNER_DIR}/Star_B_banner.webp`,
  A: `${STAR_BANNER_DIR}/Star_A_banner.webp`,
  F: `${STAR_BANNER_DIR}/Star_F_banner.webp`,
  G: `${STAR_BANNER_DIR}/Star_G_banner.webp`,
  K: `${STAR_BANNER_DIR}/Star_K_banner.webp`,
  M: `${STAR_BANNER_DIR}/Star_M_banner.webp`,
  ["M Red Giant"]: `${STAR_BANNER_DIR}/Star_M_Red_Giant_banner.webp`,
  ["T Brown Dwarf"]: `${STAR_BANNER_DIR}/Star_T_Brown_Dwarf_banner.webp`,
  ["Neutron Star"]: `${STAR_BANNER_DIR}/Star_Neutron_Star_banner.webp`,
  Pulsar: `${STAR_BANNER_DIR}/Star_Pulsar_banner.webp`,
  ["Black Hole"]: `${STAR_BANNER_DIR}/Star_Black_Hole_banner.webp`,
};

export class CelestialObjectPanel {
  private root: HTMLDivElement;
  private panelElement: HTMLDivElement | null = null;
  private currentData: CelestialObjectPanelData | null = null;
  private activeTab: "surface" | "economy" = "surface";
  private selectedJob: JobKind | null = null;
  private expandedJobClasses = this.createDefaultExpandedJobClasses();
  private buildingPickerTarget: { area: BuildingSlotArea; slotIndex: number; subDistrictIndex?: number } | null = null;
  private featureTrayOpen = false;
  private readonly tooltips = new FloatingTooltipManager({
    selector: "[data-co-tooltip]",
    datasetKey: "coTooltip",
    className: "coTooltip",
    width: 320,
  });
  private readonly clickBoundElements = new WeakSet<HTMLElement>();
  private readonly keyedBuildingIconCache = new Map<string, string>();
  private clockYear = 2100;
  private planetStateReceivedAtYear = 2100;
  private position = { x: 24, y: 70 };
  private dragOffset = { x: 0, y: 0 };
  private isDragging = false;
  private pendingPlanetRefresh: {
    planetId: string;
    planetState: PlanetState;
    objectDetails: CelestialObjectDetails;
    isHabited: boolean;
  } | null = null;
  private pendingLeaderRefresh: {
    objectId: string;
    assignedLeader: LeaderState | null;
    canManageLeaders?: boolean;
  } | null = null;
  private pendingRefreshTimer: number | null = null;
  private readonly interactionGate = new PanelInteractionGate();

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

  private getHeroBackgroundLayers(data: CelestialObjectPanelData): string | null {
    if (data.kind === "star") {
      const starType = data.objectDetails.typeName as StarType;
      const starBanner = STAR_BANNERS[starType];
      const fallbackTexture = data.imageUrl ?? null;
      const layers = [starBanner, fallbackTexture];

      return layers.filter((layer): layer is string => Boolean(layer))
        .map((layer) => `url("${layer}")`)
        .join(", ");
    }

    const planetType = data.objectDetails.typeName as PlanetType;

    if (!planetType) {
      return data.imageUrl ? `url("${data.imageUrl}")` : null;
    }

    const noCityBanner = PLANET_NO_CITY_BANNERS[planetType];
    const cityBanner = HABITED_PLANET_BANNERS[planetType];
    const fallbackTexture = data.imageUrl ?? null;

    const layers = data.isHabited && cityBanner
      ? [cityBanner, noCityBanner, fallbackTexture]
      : [noCityBanner, fallbackTexture];

    return layers.filter((layer): layer is string => Boolean(layer))
      .map((layer) => `url("${layer}")`)
      .join(", ");
  }

  private getBuildingIconCandidates(definition: BuildingDefinition): string[] {
    const mapped = BUILDING_ICON_BY_KIND[definition.kind];
    const spaced = `${BUILDING_ICON_DIR}/${definition.label}.webp`;
    const underscored = `${BUILDING_ICON_DIR}/${definition.label.replace(/\s+/g, "_")}.webp`;
    const kindName = `${BUILDING_ICON_DIR}/${definition.kind}.webp`;
    const spellingFallback = definition.kind === "entertainmentForum"
      ? `${BUILDING_ICON_DIR}/Entretainment_Forum.webp`
      : "";
    return Array.from(new Set([mapped, spaced, underscored, spellingFallback, kindName].filter(Boolean).map((path) => encodeURI(path))));
  }

  private getBuildingIconCandidateAttribute(definition: BuildingDefinition): string {
    return this.getBuildingIconCandidates(definition).join("|");
  }

  private getDistrictIconCandidates(kind: DistrictKind): string[] {
    const label = DISTRICT_LABELS[kind];
    const mapped = DISTRICT_ICON_BY_KIND[kind];
    const spaced = `${DISTRICT_ICON_DIR}/${label}.webp`;
    const underscored = `${DISTRICT_ICON_DIR}/${label.replace(/\s+/g, "_")}.webp`;
    const kindName = `${DISTRICT_ICON_DIR}/${kind}.webp`;
    return Array.from(new Set([mapped, spaced, underscored, kindName].map((path) => encodeURI(path))));
  }

  private getDistrictIconCandidateAttribute(kind: DistrictKind): string {
    return this.getDistrictIconCandidates(kind).join("|");
  }

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
    const previousData = this.currentData;
    if (this.currentData?.objectId !== data.objectId) {
      if (this.currentData) this.currentData.onClose?.(this.currentData.objectId, this.currentData.kind);
      this.activeTab = "surface";
      this.selectedJob = null;
      this.expandedJobClasses = this.createDefaultExpandedJobClasses();
      this.buildingPickerTarget = null;
      this.featureTrayOpen = false;
    }
    if (data.planetState && (previousData?.objectId !== data.objectId || previousData?.planetState !== data.planetState)) {
      this.planetStateReceivedAtYear = this.clockYear;
    }
    this.currentData = data;
    if (this.buildingPickerTarget) {
      this.buildingPickerTarget = this.resolveBuildingPickerTarget(data, this.buildingPickerTarget);
    }
    const scrollState = captureScrollState(this.panelElement, CELESTIAL_SCROLL_SELECTORS);
    if (!this.panelElement) {
      this.panelElement = document.createElement("div");
      this.panelElement.className = "celestialObjectPanel";
      this.root.appendChild(this.panelElement);
    }
    this.interactionGate.bind(this.panelElement);

    this.hideTooltip();
    this.panelElement.style.setProperty("--object-accent", data.accentColor ?? "rgba(102, 236, 199, 0.95)");
    this.panelElement.innerHTML = this.render(data);
    this.applyPosition();
    this.bindPanelEvents(data);
    restoreScrollStateSoon(this.panelElement, scrollState);
  }

  public refreshPlanetState(
    planetId: string,
    planetState: PlanetState,
    objectDetails: CelestialObjectDetails,
    isHabited: boolean,
  ): void {
    if (!this.currentData || this.currentData.objectId !== planetId) return;
    if (this.panelElement && this.shouldDeferRefresh()) {
      this.pendingPlanetRefresh = { planetId, planetState, objectDetails, isHabited };
      this.schedulePendingRefresh();
      return;
    }
    const nextData: CelestialObjectPanelData = {
      ...this.currentData,
      isHabited,
      objectDetails,
      planetState,
    };
    if (!this.panelElement || this.currentData.kind !== "planet") {
      this.show(nextData);
      return;
    }
    this.currentData = nextData;
    this.planetStateReceivedAtYear = this.clockYear;
    if (this.buildingPickerTarget) {
      this.buildingPickerTarget = this.resolveBuildingPickerTarget(nextData, this.buildingPickerTarget);
    }
    this.patchPlanetPanel(nextData);
  }

  public setClockYear(year: number): void {
    if (!Number.isFinite(year)) return;
    this.clockYear = year;
    this.patchConstructionProgressOnly();
  }

  public refreshAssignedLeader(
    objectId: string,
    assignedLeader: LeaderState | null,
    canManageLeaders?: boolean,
  ): void {
    if (!this.currentData || this.currentData.objectId !== objectId) return;
    if (this.panelElement && this.shouldDeferRefresh()) {
      this.pendingLeaderRefresh = { objectId, assignedLeader, canManageLeaders };
      this.schedulePendingRefresh();
      return;
    }
    const nextData = {
      ...this.currentData,
      assignedLeader,
      canManageLeaders: canManageLeaders ?? this.currentData.canManageLeaders,
    };
    this.currentData = nextData;
    if (!this.panelElement || nextData.kind !== "planet" || !nextData.isHabited) {
      this.show(nextData);
      return;
    }
    const currentCard = this.panelElement.querySelector<HTMLElement>(".coLeaderCard");
    const nextCard = this.createElementFromHtml(this.renderLeaderCard(nextData));
    if (!nextCard) return;
    if (currentCard) {
      if (currentCard.outerHTML === nextCard.outerHTML) return;
      currentCard.replaceWith(nextCard);
    } else {
      this.panelElement.querySelector<HTMLElement>("[data-co-hero]")?.prepend(nextCard);
    }
    this.bindLeaderCardEvent(nextData, nextCard);
  }

  public getCurrentObjectId(): string | null {
    return this.currentData?.objectId ?? null;
  }

  public getCurrentKind(): CelestialObjectKind | null {
    return this.currentData?.kind ?? null;
  }

  public close(): void {
    const closingObjectId = this.currentData?.objectId ?? null;
    const closingKind = this.currentData?.kind ?? null;
    const onClose = this.currentData?.onClose;
    this.hideTooltip();
    this.clearPendingRefresh();
    this.interactionGate.clear();
    this.panelElement?.remove();
    this.panelElement = null;
    this.currentData = null;
    this.selectedJob = null;
    this.expandedJobClasses = this.createDefaultExpandedJobClasses();
    this.buildingPickerTarget = null;
    this.featureTrayOpen = false;
    this.activeTab = "surface";
    this.onPointerUp();
    if (closingObjectId && closingKind) onClose?.(closingObjectId, closingKind);
  }

  public dispose(): void {
    this.tooltips.dispose();
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
    const heroLayers = this.getHeroBackgroundLayers(data);
    if (heroLayers) {
      hero?.style.setProperty("background-image", `linear-gradient(90deg, rgba(3, 12, 16, 0.14), rgba(3, 12, 16, 0.78)), ${heroLayers}`);
    }
    if (data.imageUrl) {
      portrait?.style.setProperty("background-image", `url("${data.imageUrl}")`);
    }

    this.initializeDynamicMedia(this.panelElement);

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-co-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.classList.contains("disabled")) return;
        this.activeTab = button.dataset.coTab === "economy" ? "economy" : "surface";
        this.show(this.getFreshData(data));
      });
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-co-build-district]").forEach((button) => {
      button.addEventListener("click", () => {
        const districtKind = button.dataset.coBuildDistrict as DistrictKind | undefined;
        this.handleBuildDistrict(data, districtKind);
      });
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-co-building-slot]").forEach((button) => {
      button.addEventListener("click", () => {
        const freshData = this.getFreshData(data);
        if (!freshData.planetState) return;
        this.openBuildingPicker(freshData, {
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
      this.patchSurfaceTransientState(data);
    });

    const openFeatures = this.panelElement.querySelector<HTMLButtonElement>("[data-co-open-features]");
    openFeatures?.addEventListener("click", () => {
      this.featureTrayOpen = true;
      this.buildingPickerTarget = null;
      this.patchSurfaceTransientState(data);
    });

    this.panelElement.querySelector<HTMLButtonElement>("[data-co-orbit-planet]")?.addEventListener("click", () => {
      if (!data.orbitFleetId || data.kind !== "planet") return;
      data.onPlanetCommand?.({ type: "orbitPlanet", fleetId: data.orbitFleetId, planetId: data.objectId });
    });

    this.bindLeaderCardEvent(data, this.panelElement);

    const closeFeatures = this.panelElement.querySelector<HTMLButtonElement>("[data-co-close-features]");
    closeFeatures?.addEventListener("click", () => {
      this.featureTrayOpen = false;
      this.patchSurfaceTransientState(data);
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-co-pick-building]").forEach((button) => {
      button.addEventListener("click", () => {
        const buildingKind = button.dataset.coPickBuilding as BuildingKind | undefined;
        this.handlePickBuilding(data, buildingKind);
      });
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-co-cancel-planet-queue]").forEach((button) => {
      button.addEventListener("click", () => {
        this.handleCancelPlanetConstruction(data, button.dataset.coCancelPlanetQueue);
      });
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-co-change-sub]").forEach((button) => {
      button.addEventListener("click", () => {
        const freshData = this.getFreshData(data);
        if (!freshData.planetState) return;
        this.openSubDistrictPicker(button, freshData, Number(button.dataset.coSubIndex));
      });
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-co-job]").forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedJob = button.dataset.coJob as JobKind;
        this.show(this.getFreshData(data));
      });
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-co-job-class]").forEach((button) => {
      button.addEventListener("click", () => {
        const className = button.dataset.coJobClass as JobClass | undefined;
        if (!className) return;
        if (this.expandedJobClasses.has(className)) {
          this.expandedJobClasses.delete(className);
        } else {
          this.expandedJobClasses.add(className);
        }
        this.show(this.getFreshData(data));
      });
    });

    this.bindTooltips();
  }

  private getFreshData(fallback: CelestialObjectPanelData): CelestialObjectPanelData {
    return this.currentData?.objectId === fallback.objectId ? this.currentData : fallback;
  }

  private bindLeaderCardEvent(data: CelestialObjectPanelData, root: ParentNode): void {
    this.queryIncludingRoot<HTMLButtonElement>(root, "[data-co-open-leaders]")?.addEventListener("click", () => {
      const freshData = this.getFreshData(data);
      if (freshData.kind !== "planet" || !freshData.isHabited || freshData.canManageLeaders !== true) return;
      requestOpenLeadersPanel({
        assignmentTarget: {
          kind: "planet",
          targetId: freshData.objectId,
          label: freshData.name,
          requiredClass: "civilian",
        },
      });
    });
  }

  private handleBuildDistrict(data: CelestialObjectPanelData, districtKind?: DistrictKind): void {
    const freshData = this.getFreshData(data);
    if (!districtKind || !freshData.planetState) return;
    this.buildingPickerTarget = null;
    this.featureTrayOpen = false;
    const planetState = this.withQueuedDistrict(freshData.planetState, districtKind);
    freshData.onPlanetCommand?.({ type: "buildDistrict", planetId: freshData.planetState.id, districtKind });
    this.applyLocalPlanetState(freshData, planetState);
  }

  private handlePickBuilding(data: CelestialObjectPanelData, buildingKind?: BuildingKind): void {
    const freshData = this.getFreshData(data);
    if (!freshData.planetState || !this.buildingPickerTarget || !buildingKind) return;
    const target = { ...this.buildingPickerTarget };
    this.buildingPickerTarget = null;
    this.featureTrayOpen = false;
    const planetState = this.withQueuedBuilding(freshData.planetState, target, buildingKind);
    freshData.onPlanetCommand?.({
      type: "buildPlanetBuilding",
      planetId: freshData.planetState.id,
      area: target.area,
      slotIndex: target.slotIndex,
      subDistrictIndex: target.subDistrictIndex,
      buildingKind,
    });
    this.applyLocalPlanetState(freshData, planetState);
  }

  private handleUpgradeBuilding(
    data: CelestialObjectPanelData,
    area?: BuildingSlotArea,
    slotIndexValue?: string,
    subDistrictIndexValue?: string,
  ): void {
    const freshData = this.getFreshData(data);
    const planetState = freshData.planetState;
    if (!planetState || !area || slotIndexValue === undefined) return;
    const slotIndex = Number(slotIndexValue);
    const subDistrictIndex = subDistrictIndexValue === undefined ? undefined : Number(subDistrictIndexValue);
    const buildingSlot = this.getBuildingSlot(planetState, area, slotIndex, subDistrictIndex);
    const buildingKind = getPlanetBuildingKind(buildingSlot);
    const targetLevel = getBuildingUpgradeTargetLevel(buildingSlot);
    if (!buildingKind || !targetLevel) return;
    if (!this.isBuildingLevelUnlocked(freshData.technology, buildingKind, targetLevel)) return;
    if (this.getQueuedBuildingForSlot(planetState, area, slotIndex, subDistrictIndex)) return;
    const nextPlanetState = this.withQueuedBuildingUpgrade(planetState, { area, slotIndex, subDistrictIndex }, buildingKind, getPlanetBuildingLevel(buildingSlot));
    freshData.onPlanetCommand?.({
      type: "upgradePlanetBuilding",
      planetId: planetState.id,
      area,
      slotIndex,
      subDistrictIndex,
    });
    this.applyLocalPlanetState(freshData, nextPlanetState);
  }

  private handleCancelPlanetConstruction(data: CelestialObjectPanelData, queueItemId?: string): void {
    const freshData = this.getFreshData(data);
    if (!freshData.planetState || !queueItemId) return;
    if (!freshData.planetState.constructionQueue.some((item) => item.id === queueItemId)) return;
    const planetState = {
      ...freshData.planetState,
      constructionQueue: freshData.planetState.constructionQueue.filter((item) => item.id !== queueItemId),
    };
    freshData.onPlanetCommand?.({
      type: "cancelPlanetConstruction",
      planetId: freshData.planetState.id,
      queueItemId,
    });
    this.applyLocalPlanetState(freshData, planetState);
  }

  private handlePickSubDistrict(
    data: CelestialObjectPanelData,
    subDistrictIndex: number,
    subDistrictKind?: UrbanSubDistrictKind,
    picker?: HTMLElement,
  ): void {
    const freshData = this.getFreshData(data);
    if (!freshData.planetState || !subDistrictKind) return;
    const planetState = this.withChangedSubDistrict(freshData.planetState, subDistrictIndex, subDistrictKind);
    freshData.onPlanetCommand?.({
      type: "setUrbanSubDistrict",
      planetId: freshData.planetState.id,
      subDistrictIndex,
      subDistrictKind,
    });
    picker?.remove();
    this.buildingPickerTarget = null;
    this.applyLocalPlanetState(freshData, planetState);
  }

  private applyLocalPlanetState(data: CelestialObjectPanelData, planetState: PlanetState): void {
    const nextData = { ...data, planetState };
    this.currentData = nextData;
    this.planetStateReceivedAtYear = this.clockYear;
    if (!this.panelElement) {
      this.show(nextData);
      return;
    }
    this.patchPlanetPanel(nextData);
  }

  private patchSurfaceTransientState(data: CelestialObjectPanelData): void {
    const freshData = this.getFreshData(data);
    if (
      !this.panelElement
      || !freshData.planetState
      || !this.panelElement.querySelector('[data-co-body="surface"]')
    ) {
      this.show(freshData);
      return;
    }
    this.currentData = freshData;
    this.patchBuildingSlotContainers(freshData);
    this.patchSurfaceSidePanel(freshData);
  }

  private patchPlanetPanel(data: CelestialObjectPanelData): void {
    if (!this.panelElement || !data.planetState) {
      this.show(data);
      return;
    }

    this.hideTooltip();
    this.patchPlanetSummary(data);
    this.patchResourceStrip(data.planetState);

    const expectedBody = this.activeTab === "economy" && data.isHabited ? "economy" : "surface";
    const body = this.panelElement.querySelector<HTMLElement>("[data-co-body]");
    if (body?.dataset.coBody !== expectedBody) {
      const html = expectedBody === "economy" ? this.renderEconomyBody(data.planetState) : this.renderSurfaceBody(data);
      const nextBody = body ? this.replaceElementWithHtml(body, html) : this.appendPanelHtml(html);
      if (nextBody) {
        this.initializeDynamicMedia(nextBody);
        this.bindPatchedContentEvents(data, nextBody);
        this.bindTooltips(nextBody);
      }
      return;
    }

    if (expectedBody === "economy") {
      this.patchEconomyBody(data);
    } else {
      this.patchSurfaceBody(data);
    }
  }

  private getEstimatedConstructionQueue(planetState: PlanetState): PlanetConstructionQueueItem[] {
    if (planetState.constructionQueue.length === 0) return [];
    const elapsedDays = Math.max(0, (this.clockYear - this.planetStateReceivedAtYear) * GAME_DAYS_PER_YEAR);
    if (elapsedDays <= 0) return planetState.constructionQueue;
    const [first, ...rest] = planetState.constructionQueue;
    const speed = getConstructionSpeedMultiplier(planetState, first.kind);
    return [
      {
        ...first,
        remainingDays: Math.max(0, first.remainingDays - elapsedDays * speed),
      },
      ...rest,
    ];
  }

  private patchConstructionProgressOnly(): void {
    if (!this.panelElement || !this.currentData?.planetState) return;
    const estimatedQueue = this.getEstimatedConstructionQueue(this.currentData.planetState);
    for (const item of estimatedQueue) {
      const remaining = this.formatConstructionDays(item.remainingDays);
      this.panelElement.querySelectorAll<HTMLElement>("[data-co-queue-item]").forEach((element) => {
        if (element.dataset.coQueueItem !== item.id) return;
        const days = element.querySelector<HTMLElement>("[data-co-queue-days]");
        if (days) days.textContent = `${remaining} remaining`;
        const fill = element.querySelector<HTMLElement>("[data-co-queue-progress-fill]");
        if (fill) fill.style.width = this.getConstructionProgressPercent(item);
      });
      this.panelElement.querySelectorAll<HTMLElement>("[data-co-queued-building-days]").forEach((element) => {
        if (element.dataset.coQueueItem !== item.id) return;
        element.textContent = this.formatConstructionDays(item.remainingDays);
      });
    }
  }

  private getConstructionProgressPercent(item: PlanetConstructionQueueItem): string {
    const progress = item.totalDays <= 0 ? 1 : 1 - item.remainingDays / item.totalDays;
    return `${Math.max(2, Math.min(100, progress * 100)).toFixed(0)}%`;
  }

  private formatConstructionDays(days: number): string {
    const remaining = Math.max(0, days);
    if (remaining >= 100) return `${Math.ceil(remaining)}d`;
    if (remaining >= 10) return `${remaining.toFixed(1)}d`;
    return `${remaining.toFixed(1)}d`;
  }

  private patchPlanetSummary(data: CelestialObjectPanelData): void {
    if (!this.panelElement) return;
    const typeName = this.panelElement.querySelector<HTMLElement>("[data-co-type-name]");
    if (typeName) typeName.textContent = data.objectDetails.typeName;
    const summaryGrid = this.panelElement.querySelector<HTMLElement>("[data-co-summary-grid]");
    if (summaryGrid) this.replaceElementWithHtmlIfChanged(summaryGrid, this.renderSummaryGrid(data));
  }

  private patchResourceStrip(planetState: PlanetState): void {
    if (!this.panelElement) return;
    const strip = this.panelElement.querySelector<HTMLElement>("[data-co-resource-strip]");
    if (strip) this.replaceElementWithHtmlIfChanged(strip, this.renderResourceStrip(planetState));
  }

  private patchEconomyBody(data: CelestialObjectPanelData): void {
    if (!this.panelElement || !data.planetState) return;
    const body = this.panelElement.querySelector<HTMLElement>('[data-co-body="economy"]');
    if (!body) return;
    const html = this.renderEconomyBody(data.planetState);
    if (body.outerHTML === html.trim()) return;
    const scrollState = captureScrollState(this.panelElement, CELESTIAL_SCROLL_SELECTORS);
    const nextBody = this.replaceElementWithHtml(body, html);
    if (!nextBody) return;
    this.bindEconomyContentEvents(data, nextBody);
    this.bindTooltips(nextBody);
    restoreScrollStateSoon(this.panelElement, scrollState);
  }

  private patchSurfaceBody(data: CelestialObjectPanelData): void {
    if (!this.panelElement || !data.planetState) return;
    this.patchProductionPanel(data);
    this.patchDistrictFacts(data);
    this.patchUrbanSubDistrictFacts(data);
    this.patchBuildingSlotContainers(data);
    this.patchSurfaceSidePanel(data);
  }

  private patchProductionPanel(data: CelestialObjectPanelData): void {
    if (!this.panelElement || !data.planetState) return;
    const production = this.panelElement.querySelector<HTMLElement>("[data-co-production-panel]");
    if (production) this.replaceElementWithHtmlIfChanged(production, this.renderProductionPanels(data.planetState));
  }

  private patchDistrictFacts(data: CelestialObjectPanelData): void {
    if (!this.panelElement || !data.planetState) return;
    const limits = data.objectDetails.districtLimits;
    const canBuild = data.kind === "planet" && data.isHabited;
    for (const district of DISTRICTS) {
      const kind = district.kind;
      const used = data.planetState.builtDistricts[kind];
      const queued = this.getQueuedDistrictCount(data.planetState, kind);
      const limit = limits[kind];
      const queuedLabel = queued > 0 ? ` +${queued} queued` : "";
      const count = this.panelElement.querySelector<HTMLElement>(`[data-co-district-count="${kind}"]`);
      if (count) count.textContent = `${used}/${limit}${queuedLabel}`;
      const bar = this.panelElement.querySelector<HTMLElement>(`[data-co-district-bar="${kind}"]`);
      if (bar) {
        const html = this.renderDistrictSlots(used, limit);
        if (bar.innerHTML !== html) bar.innerHTML = html;
      }
      const button = this.panelElement.querySelector<HTMLButtonElement>(`[data-co-district-build-button="${kind}"]`);
      if (button) {
        const disabled = !canBuild || used + queued >= limit;
        button.disabled = disabled;
        button.classList.toggle("disabled", disabled);
      }
    }
  }

  private patchUrbanSubDistrictFacts(data: CelestialObjectPanelData): void {
    if (!this.panelElement || !data.planetState) return;
    const host = this.panelElement.querySelector<HTMLElement>(".coSubDistricts");
    if (!host) return;
    const currentCards = host.querySelectorAll<HTMLElement>("[data-co-subdistrict-card]");
    if (currentCards.length !== data.planetState.urbanSubDistricts.length) {
      const nextHost = this.replaceElementWithHtml(host, this.renderUrbanSubDistricts(data, data.planetState));
      if (nextHost) {
        this.initializeDynamicMedia(nextHost);
        this.bindSurfaceContentEvents(data, nextHost);
        this.bindTooltips(nextHost);
      }
      return;
    }
    data.planetState.urbanSubDistricts.forEach((subDistrict, index) => {
      const label = this.panelElement?.querySelector<HTMLElement>(`[data-co-subdistrict-label="${index}"]`);
      if (label) label.textContent = URBAN_SUB_DISTRICT_LABELS[subDistrict.kind];
      const button = this.panelElement?.querySelector<HTMLButtonElement>(`[data-co-change-sub][data-co-sub-index="${index}"]`);
      if (button) button.dataset.coTooltip = this.tooltipAttr(this.renderSubDistrictTooltip(subDistrict.kind, data.planetState!));
    });
  }

  private patchBuildingSlotContainers(data: CelestialObjectPanelData): void {
    if (!this.panelElement || !data.planetState) return;
    this.syncBuildingSlotContainer(
      data,
      this.panelElement.querySelector<HTMLElement>('[data-co-building-area="city"]'),
      this.renderBuildingSlotsForArea(data, "city", data.planetState.buildings.city, 6),
    );
    this.syncBuildingSlotContainer(
      data,
      this.panelElement.querySelector<HTMLElement>('[data-co-building-area="generator"]'),
      this.renderBuildingSlotsForArea(data, "generator", data.planetState.buildings.generator, 3),
    );
    this.syncBuildingSlotContainer(
      data,
      this.panelElement.querySelector<HTMLElement>('[data-co-building-area="mining"]'),
      this.renderBuildingSlotsForArea(data, "mining", data.planetState.buildings.mining, 3),
    );
    this.syncBuildingSlotContainer(
      data,
      this.panelElement.querySelector<HTMLElement>('[data-co-building-area="agriculture"]'),
      this.renderBuildingSlotsForArea(data, "agriculture", data.planetState.buildings.agriculture, 3),
    );
    data.planetState.urbanSubDistricts.forEach((subDistrict, index) => {
      const container = this.panelElement?.querySelector<HTMLElement>(`[data-co-building-area="urbanSubDistrict"][data-co-sub-index="${index}"]`) ?? null;
      this.syncBuildingSlotContainer(
        data,
        container,
        this.renderBuildingSlotsForArea(data, "urbanSubDistrict", subDistrict.buildings, 3, index),
      );
    });
  }

  private syncBuildingSlotContainer(
    data: CelestialObjectPanelData,
    container: HTMLElement | null,
    html: string,
  ): void {
    if (!container) return;
    const template = document.createElement("template");
    template.innerHTML = html.trim();
    const nextChildren = Array.from(template.content.children) as HTMLElement[];
    nextChildren.forEach((nextChild, index) => {
      const current = container.children[index] as HTMLElement | undefined;
      if (!current) {
        container.appendChild(nextChild);
        this.initializeDynamicMedia(nextChild);
        this.bindSurfaceContentEvents(data, nextChild);
        this.bindTooltips(nextChild);
        return;
      }
      if (
        current.dataset.coBuildingSlotKey === nextChild.dataset.coBuildingSlotKey
        && current.outerHTML === nextChild.outerHTML
      ) {
        return;
      }
      current.replaceWith(nextChild);
      this.initializeDynamicMedia(nextChild);
      this.bindSurfaceContentEvents(data, nextChild);
      this.bindTooltips(nextChild);
    });
    while (container.children.length > nextChildren.length) {
      container.lastElementChild?.remove();
    }
  }

  private patchSurfaceSidePanel(data: CelestialObjectPanelData): void {
    if (!this.panelElement) return;
    const layout = this.panelElement.querySelector<HTMLElement>("[data-co-surface-layout]");
    if (!layout) return;
    const html = this.renderSurfaceSidePanel(data);
    const existing = this.getSurfaceSidePanel(layout);
    layout.classList.toggle("withSide", Boolean(html));
    if (!html) {
      existing?.remove();
      return;
    }

    const nextPanel = this.createElementFromHtml(html);
    if (!nextPanel) return;
    if (!existing) {
      layout.appendChild(nextPanel);
      this.initializeDynamicMedia(nextPanel);
      this.bindSurfaceContentEvents(data, nextPanel);
      this.bindTooltips(nextPanel);
      return;
    }

    if (existing.dataset.coSidePanel !== nextPanel.dataset.coSidePanel) {
      existing.replaceWith(nextPanel);
      this.initializeDynamicMedia(nextPanel);
      this.bindSurfaceContentEvents(data, nextPanel);
      this.bindTooltips(nextPanel);
      return;
    }

    if (existing.dataset.coSidePanel === "overview" && data.planetState) {
      this.patchOverviewPanel(data, existing);
      return;
    }

    if (existing.outerHTML !== html.trim()) {
      existing.replaceWith(nextPanel);
      this.initializeDynamicMedia(nextPanel);
      this.bindSurfaceContentEvents(data, nextPanel);
      this.bindTooltips(nextPanel);
    }
  }

  private renderSurfaceSidePanel(data: CelestialObjectPanelData): string {
    return this.renderFeaturesTray(data) || this.renderBuildingTray(data) || this.renderPlanetOverview(data);
  }

  private getSurfaceSidePanel(layout: HTMLElement): HTMLElement | null {
    return Array.from(layout.children).find((child): child is HTMLElement => (
      child instanceof HTMLElement && child.matches("aside[data-co-side-panel]")
    )) ?? null;
  }

  private patchOverviewPanel(data: CelestialObjectPanelData, overview: HTMLElement): void {
    if (!data.planetState) return;
    const nextOverview = this.createElementFromHtml(this.renderPlanetOverview(data));
    if (!nextOverview) return;
    const grid = overview.querySelector<HTMLElement>(".coOverviewGrid");
    const nextGrid = nextOverview.querySelector<HTMLElement>(".coOverviewGrid");
    if (grid && nextGrid && grid.outerHTML !== nextGrid.outerHTML) grid.replaceWith(nextGrid);
    this.patchConstructionQueue(data, overview, nextOverview);
  }

  private patchConstructionQueue(
    data: CelestialObjectPanelData,
    overview: HTMLElement,
    nextOverview?: HTMLElement,
  ): void {
    const planetState = data.planetState;
    if (!planetState) return;
    const panel = overview.querySelector<HTMLElement>("[data-co-queue-panel]");
    if (!panel) return;
    const count = panel.querySelector<HTMLElement>("[data-co-queue-count]");
    if (count) count.textContent = `${planetState.constructionQueue.length} active`;
    const list = panel.querySelector<HTMLElement>("[data-co-queue-list]");
    if (!list) return;
    const estimatedQueue = this.getEstimatedConstructionQueue(planetState);
    const nextList = nextOverview?.querySelector<HTMLElement>("[data-co-queue-list]") ?? this.createElementFromHtml(
      `<div>${estimatedQueue.length === 0
        ? '<div class="coQueueEmpty">No active construction</div>'
        : estimatedQueue.map((item) => this.renderQueueItem(item, data.canManageLeaders === true)).join("")}</div>`,
    );
    if (!nextList) return;
    this.syncKeyedChildren(list, Array.from(nextList.children) as HTMLElement[], "coQueueItem");
    this.bindSurfaceContentEvents(data, list);
  }

  private syncKeyedChildren(container: HTMLElement, nextChildren: HTMLElement[], keyName: string): void {
    nextChildren.forEach((nextChild, index) => {
      const current = container.children[index] as HTMLElement | undefined;
      const nextKey = nextChild.dataset[keyName];
      if (!current) {
        container.appendChild(nextChild);
        return;
      }
      if (current.dataset[keyName] === nextKey && current.outerHTML === nextChild.outerHTML) return;
      current.replaceWith(nextChild);
    });
    while (container.children.length > nextChildren.length) {
      container.lastElementChild?.remove();
    }
  }

  private bindPatchedContentEvents(data: CelestialObjectPanelData, root: ParentNode): void {
    this.bindSurfaceContentEvents(data, root);
    this.bindEconomyContentEvents(data, root);
  }

  private bindSurfaceContentEvents(data: CelestialObjectPanelData, root: ParentNode): void {
    this.queryAllIncludingRoot<HTMLButtonElement>(root, "[data-co-build-district]").forEach((button) => {
      this.bindClickOnce(button, () => this.handleBuildDistrict(data, button.dataset.coBuildDistrict as DistrictKind | undefined));
    });
    this.queryAllIncludingRoot<HTMLButtonElement>(root, "[data-co-building-slot]").forEach((button) => {
      this.bindClickOnce(button, () => {
        const freshData = this.getFreshData(data);
        if (!freshData.planetState) return;
        this.openBuildingPicker(freshData, {
          area: button.dataset.coArea as BuildingSlotArea,
          slotIndex: Number(button.dataset.coSlotIndex),
          subDistrictIndex: button.dataset.coSubIndex === undefined ? undefined : Number(button.dataset.coSubIndex),
        });
      });
    });
    this.queryAllIncludingRoot<HTMLButtonElement>(root, "[data-co-upgrade-building]").forEach((button) => {
      this.bindClickOnce(button, () => this.handleUpgradeBuilding(
        data,
        button.dataset.coArea as BuildingSlotArea | undefined,
        button.dataset.coSlotIndex,
        button.dataset.coSubIndex,
      ));
    });
    const closeBuildingPicker = this.queryIncludingRoot<HTMLButtonElement>(root, "[data-co-close-building-picker]");
    if (closeBuildingPicker) this.bindClickOnce(closeBuildingPicker, () => {
      this.buildingPickerTarget = null;
      this.patchSurfaceTransientState(data);
    });
    const openFeatures = this.queryIncludingRoot<HTMLButtonElement>(root, "[data-co-open-features]");
    if (openFeatures) this.bindClickOnce(openFeatures, () => {
      this.featureTrayOpen = true;
      this.buildingPickerTarget = null;
      this.patchSurfaceTransientState(data);
    });
    const closeFeatures = this.queryIncludingRoot<HTMLButtonElement>(root, "[data-co-close-features]");
    if (closeFeatures) this.bindClickOnce(closeFeatures, () => {
      this.featureTrayOpen = false;
      this.patchSurfaceTransientState(data);
    });
    this.queryAllIncludingRoot<HTMLButtonElement>(root, "[data-co-pick-building]").forEach((button) => {
      this.bindClickOnce(button, () => this.handlePickBuilding(data, button.dataset.coPickBuilding as BuildingKind | undefined));
    });
    this.queryAllIncludingRoot<HTMLButtonElement>(root, "[data-co-cancel-planet-queue]").forEach((button) => {
      this.bindClickOnce(button, () => this.handleCancelPlanetConstruction(data, button.dataset.coCancelPlanetQueue));
    });
    this.queryAllIncludingRoot<HTMLButtonElement>(root, "[data-co-change-sub]").forEach((button) => {
      this.bindClickOnce(button, () => {
        const freshData = this.getFreshData(data);
        if (!freshData.planetState) return;
        this.openSubDistrictPicker(button, freshData, Number(button.dataset.coSubIndex));
      });
    });
  }

  private bindEconomyContentEvents(data: CelestialObjectPanelData, root: ParentNode): void {
    this.queryAllIncludingRoot<HTMLButtonElement>(root, "[data-co-job]").forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedJob = button.dataset.coJob as JobKind;
        this.show(this.getFreshData(data));
      });
    });
    this.queryAllIncludingRoot<HTMLButtonElement>(root, "[data-co-job-class]").forEach((button) => {
      button.addEventListener("click", () => {
        const className = button.dataset.coJobClass as JobClass | undefined;
        if (!className) return;
        if (this.expandedJobClasses.has(className)) {
          this.expandedJobClasses.delete(className);
        } else {
          this.expandedJobClasses.add(className);
        }
        this.show(this.getFreshData(data));
      });
    });
  }

  private createElementFromHtml(html: string): HTMLElement | null {
    const template = document.createElement("template");
    template.innerHTML = html.trim();
    return template.content.firstElementChild as HTMLElement | null;
  }

  private appendPanelHtml(html: string): HTMLElement | null {
    if (!this.panelElement) return null;
    const element = this.createElementFromHtml(html);
    if (!element) return null;
    this.panelElement.appendChild(element);
    return element;
  }

  private replaceElementWithHtml(element: HTMLElement, html: string): HTMLElement | null {
    const next = this.createElementFromHtml(html);
    if (!next) return null;
    element.replaceWith(next);
    return next;
  }

  private replaceElementWithHtmlIfChanged(element: HTMLElement, html: string): HTMLElement | null {
    if (element.outerHTML === html.trim()) return element;
    const next = this.replaceElementWithHtml(element, html);
    if (next) {
      this.initializeDynamicMedia(next);
      this.bindTooltips(next);
    }
    return next;
  }

  private queryIncludingRoot<T extends Element>(root: ParentNode, selector: string): T | null {
    if (root instanceof Element && root.matches(selector)) return root as T;
    return root.querySelector<T>(selector);
  }

  private queryAllIncludingRoot<T extends Element>(root: ParentNode, selector: string): T[] {
    const matches = Array.from(root.querySelectorAll<T>(selector));
    if (root instanceof Element && root.matches(selector)) {
      matches.unshift(root as T);
    }
    return matches;
  }

  private bindClickOnce(element: HTMLElement, handler: (ev: MouseEvent) => void): void {
    if (this.clickBoundElements.has(element)) return;
    this.clickBoundElements.add(element);
    element.addEventListener("click", handler);
  }

  private shouldDeferRefresh(): boolean {
    return this.isDragging || this.interactionGate.isBusy(this.panelElement);
  }

  private schedulePendingRefresh(delayMs = 120): void {
    if (this.pendingRefreshTimer !== null) return;
    this.pendingRefreshTimer = window.setTimeout(() => {
      this.pendingRefreshTimer = null;
      if (!this.panelElement) return;
      if (this.shouldDeferRefresh()) {
        this.schedulePendingRefresh();
        return;
      }
      const planetRefresh = this.pendingPlanetRefresh;
      const leaderRefresh = this.pendingLeaderRefresh;
      this.pendingPlanetRefresh = null;
      this.pendingLeaderRefresh = null;
      if (planetRefresh) {
        this.refreshPlanetState(
          planetRefresh.planetId,
          planetRefresh.planetState,
          planetRefresh.objectDetails,
          planetRefresh.isHabited,
        );
      }
      if (leaderRefresh) {
        this.refreshAssignedLeader(
          leaderRefresh.objectId,
          leaderRefresh.assignedLeader,
          leaderRefresh.canManageLeaders,
        );
      }
    }, delayMs);
  }

  private clearPendingRefresh(): void {
    if (this.pendingRefreshTimer !== null) {
      window.clearTimeout(this.pendingRefreshTimer);
      this.pendingRefreshTimer = null;
    }
    this.pendingPlanetRefresh = null;
    this.pendingLeaderRefresh = null;
  }

  private applyPosition(): void {
    if (!this.panelElement) return;
    this.panelElement.style.left = `${this.position.x}px`;
    this.panelElement.style.top = `${this.position.y}px`;
  }

  private bindTooltips(root: ParentNode | null = this.panelElement): void {
    this.tooltips.bind(root);
  }

  private initializeDynamicMedia(root: ParentNode): void {
    this.initializeBuildingIcons(root);
    this.initializeDistrictIcons(root);
  }

  private initializeBuildingIcons(root: ParentNode): void {
    root.querySelectorAll<HTMLImageElement>("[data-building-icon]").forEach((image) => {
      const fallback = image.parentElement?.querySelector<HTMLElement>("[data-building-fallback]");
      const candidates = (image.dataset.buildingIconCandidates ?? "").split("|").filter(Boolean);
      image.loading = "eager";
      image.decoding = "async";

      const showFallback = (): void => {
        image.style.display = "none";
        image.style.visibility = "hidden";
        image.style.opacity = "0";
        if (fallback) fallback.style.display = "grid";
      };

      const showImage = (): void => {
        image.style.display = "block";
        image.style.visibility = "visible";
        image.style.opacity = "1";
        if (fallback) fallback.style.display = "none";
      };

      const showProcessedImage = (source: string): void => {
        const keyedIcon = this.createKeyedBuildingIcon(image, source);
        if (keyedIcon && image.src !== keyedIcon) {
          image.onload = null;
          image.onerror = null;
          image.src = keyedIcon;
        }
        showImage();
      };

      const tryCandidate = (index: number): void => {
        if (index >= candidates.length) {
          showFallback();
          return;
        }

        const candidate = candidates[index];
        if (!candidate) {
          tryCandidate(index + 1);
          return;
        }

        image.style.display = "block";
        image.style.visibility = "hidden";
        image.style.opacity = "0";
        if (fallback) fallback.style.display = "grid";
        image.dataset.buildingIconIndex = String(index);
        image.onload = () => showProcessedImage(candidate);
        image.onerror = () => tryCandidate(index + 1);
        image.src = candidate;

        if (image.complete && image.naturalWidth > 0) {
          showProcessedImage(candidate);
        }
      };

      if (candidates.length === 0) {
        showFallback();
        return;
      }

      tryCandidate(Number(image.dataset.buildingIconIndex ?? "0"));
    });
  }

  private initializeDistrictIcons(root: ParentNode): void {
    root.querySelectorAll<HTMLImageElement>("[data-district-icon]").forEach((image) => {
      const fallback = image.parentElement?.querySelector<HTMLElement>("[data-district-fallback]");
      const candidates = (image.dataset.districtIconCandidates ?? "").split("|").filter(Boolean);
      image.loading = "eager";
      image.decoding = "async";

      const showFallback = (): void => {
        image.style.display = "none";
        image.style.visibility = "hidden";
        image.style.opacity = "0";
        if (fallback) fallback.style.display = "grid";
      };

      const showImage = (): void => {
        image.style.display = "block";
        image.style.visibility = "visible";
        image.style.opacity = "1";
        if (fallback) fallback.style.display = "none";
      };

      const tryCandidate = (index: number): void => {
        if (index >= candidates.length) {
          showFallback();
          return;
        }

        const candidate = candidates[index];
        if (!candidate) {
          tryCandidate(index + 1);
          return;
        }

        image.style.display = "block";
        image.style.visibility = "hidden";
        image.style.opacity = "0";
        if (fallback) fallback.style.display = "grid";
        image.dataset.districtIconIndex = String(index);
        image.onload = () => showImage();
        image.onerror = () => tryCandidate(index + 1);
        image.src = candidate;

        if (image.complete && image.naturalWidth > 0) {
          showImage();
        }
      };

      if (candidates.length === 0) {
        showFallback();
        return;
      }

      tryCandidate(Number(image.dataset.districtIconIndex ?? "0"));
    });
  }

  private createKeyedBuildingIcon(image: HTMLImageElement, source: string): string | null {
    const cached = this.keyedBuildingIconCache.get(source);
    if (cached) return cached;
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;

    try {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;

      context.drawImage(image, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      const pixels = imageData.data;
      const totalPixels = width * height;
      const visited = new Uint8Array(totalPixels);
      const queue = new Int32Array(totalPixels);
      let read = 0;
      let write = 0;

      const isNearWhiteBackground = (pixelIndex: number): boolean => {
        const offset = pixelIndex * 4;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        const alpha = pixels[offset + 3];
        const max = Math.max(red, green, blue);
        const min = Math.min(red, green, blue);
        return alpha > 0 && min >= 205 && max - min <= 55;
      };

      const enqueue = (pixelIndex: number): void => {
        if (pixelIndex < 0 || pixelIndex >= totalPixels || visited[pixelIndex] || !isNearWhiteBackground(pixelIndex)) return;
        visited[pixelIndex] = 1;
        queue[write] = pixelIndex;
        write += 1;
      };

      for (let x = 0; x < width; x += 1) {
        enqueue(x);
        enqueue((height - 1) * width + x);
      }
      for (let y = 1; y < height - 1; y += 1) {
        enqueue(y * width);
        enqueue(y * width + width - 1);
      }

      while (read < write) {
        const pixelIndex = queue[read];
        read += 1;
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);
        if (x > 0) enqueue(pixelIndex - 1);
        if (x < width - 1) enqueue(pixelIndex + 1);
        if (y > 0) enqueue(pixelIndex - width);
        if (y < height - 1) enqueue(pixelIndex + width);
      }

      for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex += 1) {
        if (!visited[pixelIndex]) continue;
        pixels[pixelIndex * 4 + 3] = 0;
      }

      context.putImageData(imageData, 0, 0);
      const keyedIcon = canvas.toDataURL("image/png");
      this.keyedBuildingIconCache.set(source, keyedIcon);
      return keyedIcon;
    } catch {
      return null;
    }
  }

  private hideTooltip(): void {
    this.tooltips.hide();
  }

  private render(data: CelestialObjectPanelData): string {
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
          ${isHabitedPlanet ? this.renderLeaderCard(data) : ""}
          ${isPlanet && data.orbitFleetId ? '<button class="coHeroAction" type="button" data-co-orbit-planet>Orbit</button>' : ""}
          ${isPlanet && !isHabitedPlanet && !data.orbitFleetId ? '<button class="coHeroAction" type="button">Terraform</button>' : ""}
        </div>
        <aside class="coSummary">
          <div class="coSectionTitle">${isPlanet ? "Planet Summary" : "Stellar Summary"}</div>
          <div class="coTypeName" data-co-type-name>${this.escapeHtml(data.objectDetails.typeName)}</div>
          ${this.renderSummaryGrid(data)}
          <div class="coPortrait" data-co-portrait></div>
        </aside>
        ${this.renderResourceStrip(planetState)}
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

  private renderSummaryGrid(data: CelestialObjectPanelData): string {
    const details = data.objectDetails;
    const habitabilityValue = data.planetState
      ? getEffectiveSpeciesHabitability(data.planetState)
      : details.habitability;
    const habitability = habitabilityValue === null ? "?%" : `${habitabilityValue}%`;
    return `
      <div class="coSummaryGrid" data-co-summary-grid>
        ${this.renderSummaryStat("habitability", "Habitability", habitability, data.planetState ? this.renderHabitabilityTooltip(data.planetState) : undefined)}
        ${this.renderSummaryStat("population", "Habited", data.isHabited ? "Yes" : "No")}
        ${this.renderSummaryStat("size", "Size", String(details.size))}
        ${data.planetState ? this.renderSummaryStat("housing", "Housing", this.formatPeople(data.planetState.economy.housing), this.renderHousingTooltip(data.planetState)) : ""}
        ${data.planetState ? this.renderSummaryStat("amenities", "Amenities", this.formatCompact(data.planetState.economy.amenities), this.renderAmenitiesTooltip(data.planetState)) : ""}
      </div>
    `;
  }

  private renderLeaderCard(data: CelestialObjectPanelData): string {
    const leader = data.assignedLeader ?? null;
    const canManage = data.canManageLeaders === true;
    const leaderName = leader?.name ?? "Sector Official";
    const leaderLabel = leader ? `Level ${leader.level} governor` : "No governor assigned";
    const initials = leader
      ? leader.name
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
      : "";
    const portraitStyle = leader?.portraitUrl ? ` style="background-image: url('${this.escapeHtml(leader.portraitUrl)}')"` : "";
    return `
      <button
        class="coLeaderCard ${canManage ? "assignable" : ""}"
        type="button"
        ${canManage ? "data-co-open-leaders" : "disabled"}
        aria-label="Assign sector official">
        <div class="coLeaderPortrait"${portraitStyle}>${leader ? `<span>${this.escapeHtml(initials)}</span>` : "<i>+</i>"}</div>
        <div>
          <strong>${this.escapeHtml(leaderName)}</strong>
          <span>${this.escapeHtml(leaderLabel)}</span>
        </div>
      </button>
    `;
  }

  private renderSummaryStat(icon: string, label: string, value: string, tooltip?: string): string {
    const tooltipAttribute = tooltip ? ` data-co-tooltip="${this.tooltipAttr(tooltip)}"` : "";
    return `
      <div class="coSummaryStat"${tooltipAttribute}>
        ${this.renderStatIcon(icon)}
        <span>${this.escapeHtml(label)}</span>
        <strong>${this.escapeHtml(value)}</strong>
      </div>
    `;
  }

  private renderResourceStrip(planetState?: PlanetState): string {
    if (!planetState) {
      return `
        <div class="coResourceStrip" data-co-resource-strip>
          ${this.renderResourceStripStat("stability", "Stability", "?%")}
          ${this.renderResourceStripStat("population", "Pop", "0")}
          ${this.renderResourceStripStat("happiness", "Happiness", "?%")}
          ${this.renderResourceStripStat("crime", "Crime", "?%")}
          ${this.renderResourceStripStat("amenities", "Amenities Balance", "0")}
          ${this.renderResourceStripStat("housing", "Housing Balance", "0")}
        </div>
      `;
    }

    const economy = planetState.economy;
    const support = this.getPlanetSupportMetrics(planetState);

    return `
      <div class="coResourceStrip" data-co-resource-strip>
        ${this.renderResourceStripStat("stability", "Stability", `${economy.stability.toFixed(0)}%`, this.getHighStatTone(economy.stability), this.renderStabilityTooltip(planetState))}
        ${this.renderResourceStripStat("population", "Pop", this.formatPeople(planetState.population))}
        ${this.renderResourceStripStat("happiness", "Happiness", `${economy.happiness.toFixed(0)}%`, this.getHighStatTone(economy.happiness), this.renderHappinessTooltip(planetState))}
        ${this.renderResourceStripStat("crime", "Crime", `${economy.crime.toFixed(0)}%`, this.getCrimeTone(economy.crime), this.renderCrimeTooltip(planetState))}
        ${this.renderResourceStripStat("amenities", "Amenities Balance", this.formatSignedCompact(support.amenityBalance), this.getNeedBalanceTone(support.amenityRatio), this.renderAmenitiesTooltip(planetState))}
        ${this.renderResourceStripStat("housing", "Housing Balance", this.formatSignedPeople(support.housingBalance), this.getNeedBalanceTone(support.housingRatio), this.renderHousingTooltip(planetState))}
      </div>
    `;
  }

  private renderResourceStripStat(icon: string, label: string, value: string, tone = "neutral", tooltip?: string): string {
    const tooltipAttribute = tooltip ? ` data-co-tooltip="${this.tooltipAttr(tooltip)}"` : "";
    return `
      <span class="coResourceStripItem coTone-${tone}" data-co-resource-stat="${this.escapeHtml(icon)}"${tooltipAttribute}>
        ${this.renderStatIcon(icon)}
        <small>${this.escapeHtml(label)}</small>
        <strong>${this.escapeHtml(value)}</strong>
      </span>
    `;
  }

  private renderStatIcon(icon: string): string {
    return `<span class="coStatIcon coStatIcon-${this.escapeHtml(icon)}" aria-hidden="true"></span>`;
  }

  private getPlanetSupportMetrics(planetState: PlanetState): {
    housingBalance: number;
    housingRatio: number;
    amenityBalance: number;
    amenityRatio: number;
  } {
    const economy = planetState.economy;
    const housingNeed = planetState.population;
    const amenityNeed = planetState.population / PEOPLE_PER_MONTHLY_UNIT;

    return {
      housingBalance: economy.housing - housingNeed,
      housingRatio: housingNeed > 0 ? economy.housing / housingNeed : 1,
      amenityBalance: economy.amenities - amenityNeed,
      amenityRatio: amenityNeed > 0 ? economy.amenities / amenityNeed : 1,
    };
  }

  private getHighStatTone(value: number): string {
    if (value > 80) return "good";
    if (value < 60) return "bad";
    return "warn";
  }

  private getCrimeTone(value: number): string {
    if (value > 30) return "bad";
    if (value > 10) return "warn";
    if (value <= 0) return "good";
    return "neutral";
  }

  private getNeedBalanceTone(ratio: number): string {
    if (ratio >= 1.3) return "good";
    if (ratio < 0.9) return "bad";
    if (ratio < 1) return "warn";
    return "neutral";
  }

  private renderSurfaceBody(data: CelestialObjectPanelData): string {
    const details = data.objectDetails;
    const planetState = data.planetState;
    const built = planetState?.builtDistricts ?? details.builtDistricts;
    const limits = details.districtLimits;
    const canBuild = data.kind === "planet" && data.isHabited && Boolean(planetState);
    const buildTray = this.renderBuildingTray(data);
    const featuresTray = this.renderFeaturesTray(data);
    const sidePanel = featuresTray || buildTray || this.renderPlanetOverview(data);

    return `
      <section class="coBody" data-co-body="surface">
        <div class="coBodyHeader">Districts and Buildings</div>
        <div class="coSurfaceLayout${sidePanel ? " withSide" : ""}" data-co-surface-layout>
          <div class="coDistrictGrid">
            <article class="coDistrictCard coDistrictCity" data-co-district-card="city">
              ${this.renderDistrict("city", "City Districts", built, limits, data.isHabited, canBuild, planetState)}
              <div class="coEmbeddedBuildings coCityBuildings" data-co-building-area="city">
                ${this.renderBuildingSlotsForArea(data, "city", planetState?.buildings.city ?? [], 6)}
              </div>
              ${planetState && data.isHabited ? this.renderUrbanSubDistricts(data, planetState) : ""}
            </article>
            <article class="coInfoCard" data-co-production-host>
              ${planetState && data.isHabited ? this.renderProductionPanels(planetState) : this.renderDescription(details)}
            </article>
            <article class="coDistrictCard" data-co-district-card="generator">
              ${this.renderDistrict("generator", "Generator Districts", built, limits, false, canBuild, planetState)}
              <div class="coEmbeddedBuildings" data-co-building-area="generator">
                ${this.renderBuildingSlotsForArea(data, "generator", planetState?.buildings.generator ?? [], 3)}
              </div>
            </article>
            <article class="coDistrictCard" data-co-district-card="mining">
              ${this.renderDistrict("mining", "Mining Districts", built, limits, false, canBuild, planetState)}
              <div class="coEmbeddedBuildings" data-co-building-area="mining">
                ${this.renderBuildingSlotsForArea(data, "mining", planetState?.buildings.mining ?? [], 3)}
              </div>
            </article>
            <article class="coDistrictCard" data-co-district-card="agriculture">
              ${this.renderDistrict("agriculture", "Agriculture Districts", built, limits, false, canBuild, planetState)}
              <div class="coEmbeddedBuildings" data-co-building-area="agriculture">
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
          <div class="coSubDistrictCard" data-co-subdistrict-card="${index}">
            <div class="coSubDistrictHeader">
              <span data-co-subdistrict-label="${index}">${this.escapeHtml(URBAN_SUB_DISTRICT_LABELS[subDistrict.kind])}</span>
              <button type="button" data-co-tooltip="${this.tooltipAttr(this.renderSubDistrictTooltip(subDistrict.kind, planetState))}" data-co-change-sub data-co-sub-index="${index}">Change</button>
            </div>
            <div class="coEmbeddedBuildings coSubBuildings" data-co-building-area="urbanSubDistrict" data-co-sub-index="${index}">
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
    planetState?: PlanetState,
  ): string {
    const used = built[kind];
    const queued = planetState ? this.getQueuedDistrictCount(planetState, kind) : 0;
    const limit = limits[kind];
    const district = DISTRICTS.find((entry) => entry.kind === kind);
    const buildDisabled = !canBuild || used + queued >= limit ? " disabled" : "";
    const queuedLabel = queued > 0 ? ` +${queued} queued` : "";
    const tooltip = this.tooltipAttr(this.renderDistrictTooltip(kind));
    return `
      <div class="coDistrictTitle">
        <span>${this.escapeHtml(label)}</span>
        <button class="coTinyAction${buildDisabled}" type="button" data-co-tooltip="${tooltip}" data-co-build-district="${kind}" data-co-district-build-button="${kind}"${buildDisabled ? " disabled" : ""}>+</button>
      </div>
      <div class="coDistrictContent">
        <div class="coDistrictIcon ${kind}">
          <img class="coDistrictIconArt" data-district-icon data-district-icon-candidates="${this.escapeHtml(this.getDistrictIconCandidateAttribute(kind))}" alt="" loading="eager" decoding="async" style="display:none;" />
          <div class="coDistrictFallback" data-district-fallback>${district?.code ?? ""}</div>
        </div>
        <div class="coDistrictMeta">
          ${showCityIndustry ? '<div class="coSpecialization">Space Age Industry</div>' : ""}
          <div class="coDistrictCount" data-co-district-count="${kind}">${used}/${limit}${queuedLabel}</div>
          <div class="coDistrictBar ${kind}" data-co-district-bar="${kind}">
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
    slots: PlanetBuildingSlot[],
    slotCount: number,
    subDistrictIndex?: number,
  ): string {
    return Array.from({ length: slotCount }, (_, index) => (
      this.renderBuildingSlotForArea(data, area, slots[index] ?? null, index, subDistrictIndex)
    )).join("");
  }

  private renderBuildingSlotForArea(
    data: CelestialObjectPanelData,
    area: BuildingSlotArea,
    building: PlanetBuildingSlot,
    slotIndex: number,
    subDistrictIndex?: number,
  ): string {
    const attributes = this.getBuildingSlotViewAttributes(area, slotIndex, subDistrictIndex);
    if (!data.isHabited || !data.planetState) return `<span class="placeholder" ${attributes}></span>`;
    const buildingKind = getPlanetBuildingKind(building);
    if (buildingKind) {
      const definition = BUILDING_DEFINITIONS[buildingKind];
      const level = getPlanetBuildingLevel(building);
      const targetLevel = getBuildingUpgradeTargetLevel(building);
      const queued = this.getQueuedBuildingForSlot(
        { ...data.planetState, constructionQueue: this.getEstimatedConstructionQueue(data.planetState) },
        area,
        slotIndex,
        subDistrictIndex,
      );
      const upgradeQueued = queued?.kind === "buildingUpgrade";
      const upgradeUnlocked = targetLevel !== null && this.isBuildingLevelUnlocked(data.technology, buildingKind, targetLevel);
      const canUpgrade = Boolean(data.onPlanetCommand && targetLevel !== null && upgradeUnlocked && !queued);
      const tagName = canUpgrade ? "button" : "span";
      const controlAttrs = canUpgrade
        ? `type="button" data-co-upgrade-building data-co-area="${this.escapeHtml(area)}" data-co-slot-index="${slotIndex}"${subDistrictIndex === undefined ? "" : ` data-co-sub-index="${subDistrictIndex}"`}`
        : "";
      const classes = [
        "filled",
        "coBuildingIconSlot",
        targetLevel !== null && upgradeUnlocked ? "upgradeable" : "",
        upgradeQueued ? "queuedUpgrade" : "",
      ].filter(Boolean).join(" ");
      return `
        <${tagName} class="${classes}" ${controlAttrs} ${attributes} data-co-tooltip="${this.tooltipAttr(this.renderBuildingTooltip(definition, data.planetState, area, subDistrictIndex, queued, building, data.technology))}">
          <img class="coBuildingIconArt" data-building-icon data-building-icon-candidates="${this.escapeHtml(this.getBuildingIconCandidateAttribute(definition))}" alt="" loading="eager" decoding="async" style="display:none;" />
          <span class="coBuildingInitials" data-building-fallback>${this.escapeHtml(definition.initials)}</span>
          <small class="coBuildingLevel">Lv ${level}</small>
          ${targetLevel !== null && upgradeUnlocked ? '<span class="coBuildingUpgradeArrow" aria-hidden="true">^</span>' : ""}
          ${upgradeQueued && queued ? `<small data-co-queued-building-days data-co-queue-item="${this.escapeHtml(queued.id)}">${this.formatConstructionDays(queued.remainingDays)}</small>` : ""}
        </${tagName}>
      `;
    }
    const queued = this.getQueuedBuildingForSlot(
      { ...data.planetState, constructionQueue: this.getEstimatedConstructionQueue(data.planetState) },
      area,
      slotIndex,
      subDistrictIndex,
    );
      if (queued?.buildingKind) {
        const definition = BUILDING_DEFINITIONS[queued.buildingKind];
        return `
          <span class="queued coBuildingIconSlot" ${attributes} data-co-tooltip="${this.tooltipAttr(this.renderBuildingTooltip(definition, data.planetState, area, subDistrictIndex, queued))}">
            <img class="coBuildingIconArt" data-building-icon data-building-icon-candidates="${this.escapeHtml(this.getBuildingIconCandidateAttribute(definition))}" alt="" loading="eager" decoding="async" style="display:none;" />
            <span class="coBuildingInitials" data-building-fallback>${this.escapeHtml(definition.initials)}</span>
          <small data-co-queued-building-days data-co-queue-item="${this.escapeHtml(queued.id)}">${this.formatConstructionDays(queued.remainingDays)}</small>
          </span>
        `;
      }
    const subAttribute = subDistrictIndex === undefined ? "" : ` data-co-sub-index="${subDistrictIndex}"`;
    const selected = this.isBuildingPickerTarget(area, slotIndex, subDistrictIndex) ? " selected" : "";
    return `
      <button
        class="coBuildingSlot${selected}"
        type="button"
        ${attributes}
        data-co-building-slot
        data-co-area="${area}"
        data-co-slot-index="${slotIndex}"
        ${subAttribute}
        title="Build in this slot"
      >+</button>
    `;
  }

  private getBuildingSlotViewAttributes(
    area: BuildingSlotArea,
    slotIndex: number,
    subDistrictIndex?: number,
  ): string {
    const subAttribute = subDistrictIndex === undefined ? "" : ` data-co-sub-index="${subDistrictIndex}"`;
    const key = this.getBuildingSlotKey(area, slotIndex, subDistrictIndex);
    return `data-co-building-slot-view data-co-building-slot-key="${this.escapeHtml(key)}" data-co-area="${this.escapeHtml(area)}" data-co-slot-index="${slotIndex}"${subAttribute}`;
  }

  private getBuildingSlotKey(area: BuildingSlotArea, slotIndex: number, subDistrictIndex?: number): string {
    return `${area}:${subDistrictIndex ?? "root"}:${slotIndex}`;
  }

  private renderBuildingTray(data: CelestialObjectPanelData): string {
    const planetState = data.planetState;
    const target = this.buildingPickerTarget;
    if (!planetState || !target) return "";
    const subDistrictKind = this.getTargetSubDistrictKind(planetState, target);
    const compatible = new Set(getCompatibleBuildings(target.area, subDistrictKind));
    const targetLabel = this.getBuildingTargetLabel(planetState, target);

    return `
      <aside class="coBuildTray" data-co-side-panel="build">
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
            const lockedByTechnology = !this.isBuildingUnlocked(data.technology, building);
            const definition = BUILDING_DEFINITIONS[building];
            const disabled = !isCompatible || lockedByTechnology;
            const note = !isCompatible
              ? "Incompatible slot"
              : lockedByTechnology
                ? `Requires ${this.getRequiredBuildingTechnologyName(building)}`
                : `${getBuildingMineralCost(building)} minerals | ${getBuildingBuildDays(building)} days`;
            return `
              <button
                type="button"
                data-co-pick-building="${building}"
                class="${disabled ? "incompatible" : ""}"
                data-co-tooltip="${this.tooltipAttr(this.renderBuildingTooltip(definition, planetState, target.area, target.subDistrictIndex))}"
                ${disabled ? "disabled" : ""}
              >
                <span class="coBuildCardIcon">
                  <img class="coBuildingIconArt" data-building-icon data-building-icon-candidates="${this.escapeHtml(this.getBuildingIconCandidateAttribute(definition))}" alt="" loading="eager" decoding="async" style="display:none;" />
                  <span class="coBuildingInitials" data-building-fallback>${this.escapeHtml(definition.initials)}</span>
                </span>
                <span class="coBuildCardCopy">
                  <strong>${this.escapeHtml(definition.label)}</strong>
                  <small>${this.escapeHtml(note)}</small>
                </span>
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
    const districtUsed = DISTRICTS.reduce((sum, district) => sum + planetState.builtDistricts[district.kind], 0);
    const districtLimit = DISTRICTS.reduce((sum, district) => sum + data.objectDetails.districtLimits[district.kind], 0);
    const support = this.getPlanetSupportMetrics(planetState);
    const growth = economy.populationGrowth;
    const weeklyGrowth = Math.round(growth.netPerQuarter * (7 / 120));

    return `
      <aside class="coPlanetOverview" data-co-side-panel="overview">
        <div class="coSidePanelHeader">
          <div>
            <strong>Planet Overview</strong>
            <span>Surface command summary</span>
          </div>
        </div>
        <div class="coOverviewGrid">
          ${this.renderOverviewStat("unemployment", "Unemployment", this.formatPeople(economy.unemployedPopulation), "neutral", this.renderUnemploymentTooltip(planetState))}
          ${this.renderOverviewStat("growth", "Growth / week", this.formatSignedPeople(weeklyGrowth), "neutral", this.renderGrowthTooltip(planetState))}
          ${this.renderOverviewStat("districts", "Districts", `${districtUsed}/${districtLimit}`, "neutral", this.renderDistrictCapacityTooltip(data, districtUsed, districtLimit))}
          ${this.renderOverviewStat("happiness", "Happiness", `${economy.happiness.toFixed(0)}%`, this.getHighStatTone(economy.happiness), this.renderHappinessTooltip(planetState))}
          ${this.renderOverviewStat("housing", "Housing", this.formatPeople(economy.housing), this.getNeedBalanceTone(support.housingRatio), this.renderHousingTooltip(planetState))}
          ${this.renderOverviewStat("amenities", "Amenities", this.formatCompact(economy.amenities), this.getNeedBalanceTone(support.amenityRatio), this.renderAmenitiesTooltip(planetState))}
        </div>
        ${this.renderConstructionQueue(data)}
        <div class="coOverviewActions">
          <button type="button" data-co-open-features>Features</button>
          <button type="button">Decisions</button>
        </div>
      </aside>
    `;
  }

  private renderOverviewStat(icon: string, label: string, value: string, tone = "neutral", tooltip?: string): string {
    const tooltipAttribute = tooltip ? ` data-co-tooltip="${this.tooltipAttr(tooltip)}"` : "";
    return `
      <div class="coOverviewStat coTone-${tone}" data-co-overview-stat="${this.escapeHtml(icon)}"${tooltipAttribute}>
        ${this.renderStatIcon(icon)}
        <span>${this.escapeHtml(label)}</span>
        <strong>${this.escapeHtml(value)}</strong>
      </div>
    `;
  }

  private renderFeaturesTray(data: CelestialObjectPanelData): string {
    const planetState = data.planetState;
    if (!this.featureTrayOpen || !planetState || !data.isHabited) return "";
    const features = planetState.features;
    return `
      <aside class="coFeatureTray" data-co-side-panel="features">
        <div class="coSidePanelHeader">
          <div>
            <strong>Planet Features</strong>
            <span>${features.length} discovered</span>
          </div>
          <button type="button" data-co-close-features aria-label="Close feature list">X</button>
        </div>
        <div class="coFeatureList">
          ${features.length === 0
            ? '<div class="coFeatureEmpty">No planetary features catalogued.</div>'
            : features.map((feature) => this.renderFeatureCard(feature)).join("")}
        </div>
      </aside>
    `;
  }

  private renderFeatureCard(feature: PlanetFeatureKind): string {
    const definition = PLANET_FEATURE_DEFINITIONS[feature];
    return `
      <article class="coFeatureCard">
        <strong>${this.escapeHtml(definition.label)}</strong>
        <p>${this.escapeHtml(definition.description)}</p>
        <div class="coFeatureModifiers">
          ${definition.modifiers.map((modifier) => `<span>${this.escapeHtml(this.describeModifier(modifier.target, modifier.value))}</span>`).join("")}
        </div>
      </article>
    `;
  }

  private renderDistrictTooltip(kind: DistrictKind): string {
    const rows: string[] = [
      `<div><span>Cost</span><strong>${DISTRICT_MINERAL_COSTS[kind]} Minerals</strong></div>`,
      `<div><span>Build Time</span><strong>${DISTRICT_BUILD_DAYS[kind]} days</strong></div>`,
    ];
    if (kind === "city") {
      rows.push("<div><span>Housing</span><strong>+1.5B</strong></div>");
      rows.push(`<div><span>Jobs</span><strong>+100M ${this.escapeHtml(JOB_LABELS.clerk)}</strong></div>`);
    } else if (kind === "generator") {
      rows.push(`<div><span>Jobs</span><strong>+1B ${this.escapeHtml(JOB_LABELS.technician)}</strong></div>`);
      rows.push(`<div><span>Base Output</span><strong>+5 Energy / 1M workers</strong></div>`);
    } else if (kind === "mining") {
      rows.push(`<div><span>Jobs</span><strong>+1B ${this.escapeHtml(JOB_LABELS.miner)}</strong></div>`);
      rows.push(`<div><span>Base Output</span><strong>+5 Minerals / 1M workers</strong></div>`);
    } else {
      rows.push(`<div><span>Jobs</span><strong>+1B ${this.escapeHtml(JOB_LABELS.farmer)}</strong></div>`);
      rows.push(`<div><span>Base Output</span><strong>+6 Food / 1M workers</strong></div>`);
    }
    return `
      <div class="coTooltipTitle">${this.escapeHtml(DISTRICTS.find((district) => district.kind === kind)?.label ?? kind)}</div>
      <p>Constructs one additional district if the planet has remaining capacity.</p>
      <div class="coTooltipGrid">${rows.join("")}</div>
    `;
  }

  private renderSubDistrictTooltip(kind: UrbanSubDistrictKind, planetState: PlanetState): string {
    const cityCount = planetState.builtDistricts.city;
    const perCity = this.getSubDistrictEffectLines(kind);
    const total = this.getSubDistrictEffectLines(kind, cityCount);
    return `
      <div class="coTooltipTitle">${this.escapeHtml(URBAN_SUB_DISTRICT_LABELS[kind])}</div>
      <p>City sub-district specialization. Changing it demolishes incompatible queued or completed buildings in that sub-district.</p>
      <div class="coTooltipSectionTitle">Per City District</div>
      <div class="coTooltipList">${perCity.map((line) => `<span>${line}</span>`).join("")}</div>
      <div class="coTooltipSectionTitle">Current Total</div>
      <div class="coTooltipList">${total.map((line) => `<span>${line}</span>`).join("")}</div>
    `;
  }

  private getSubDistrictEffectLines(kind: UrbanSubDistrictKind, cityCount = 1): string[] {
    const suffix = cityCount === 1 ? "" : ` (${cityCount} city districts)`;
    switch (kind) {
      case "residential":
        return [`+${this.formatPeople(1_000_000_000 * cityCount)} Housing${suffix}`, `+${this.formatPeople(100_000_000 * cityCount)} Clerks${suffix}`];
      case "researchCampus":
        return [`-${this.formatPeople(500_000_000 * cityCount)} Housing${suffix}`, `+${this.formatPeople(500_000_000 * cityCount)} Researchers${suffix}`];
      case "mixedIndustry":
        return [
          `-${this.formatPeople(500_000_000 * cityCount)} Housing${suffix}`,
          `+${this.formatPeople(250_000_000 * cityCount)} Artisans${suffix}`,
          `+${this.formatPeople(250_000_000 * cityCount)} Metallurgists${suffix}`,
        ];
      case "civilianIndustry":
        return [`-${this.formatPeople(500_000_000 * cityCount)} Housing${suffix}`, `+${this.formatPeople(500_000_000 * cityCount)} Artisans${suffix}`];
      case "heavyIndustry":
        return [`-${this.formatPeople(500_000_000 * cityCount)} Housing${suffix}`, `+${this.formatPeople(500_000_000 * cityCount)} Metallurgists${suffix}`];
      default:
        return ["No effects"];
    }
  }

  private renderHabitabilityTooltip(planetState: PlanetState): string {
    const effective = getEffectiveSpeciesHabitability(planetState);
    const base = planetState.habitability ?? 0;
    const modifierDelta = effective - base;
    const rows = [
      this.renderTooltipGridItem("Base Planet", `${base}%`),
      this.renderTooltipGridItem("Effective", `${effective}%`),
      this.renderTooltipGridItem("Modifiers", this.formatSignedPercent(modifierDelta)),
      this.renderTooltipGridItem("Production", `${this.formatMultiplier(getHabitabilityProductionMultiplier(effective))}x`),
      this.renderTooltipGridItem("Upkeep", `${this.formatMultiplier(getHabitabilityUpkeepMultiplier(effective))}x`),
    ];
    return `
      <div class="coTooltipTitle">Habitability</div>
      <p>Species habitability affects happiness, job production, and resource upkeep.</p>
      <div class="coTooltipGrid">${rows.join("")}</div>
      ${this.renderModifierSection(planetState, (target) => target.startsWith("habitability:"))}
    `;
  }

  private renderHousingTooltip(planetState: PlanetState): string {
    const support = this.getPlanetSupportMetrics(planetState);
    const sourceRows = this.getHousingSourceRows(planetState);
    const rawHousing = sourceRows.reduce((sum, row) => sum + row.amount, 0);
    const modifierDelta = planetState.economy.housing - rawHousing;
    const sourceTooltip = this.renderFlatBreakdownTooltip(
      "Housing Sources",
      sourceRows.concat(Math.abs(modifierDelta) > 0.5 ? [{ label: "Modifiers", amount: modifierDelta }] : []),
      (value) => this.formatSignedPeople(value),
    );
    return `
      <div class="coTooltipTitle">Housing</div>
      <p>Housing is compared against total population to calculate overcrowding pressure and happiness.</p>
      <div class="coTooltipGrid">
        ${this.renderTooltipGridItem("Housing", this.formatPeople(planetState.economy.housing), sourceTooltip)}
        ${this.renderTooltipGridItem("Usage", this.formatPeople(planetState.population), this.renderPopulationUsageTooltip("Housing Usage", planetState, (group) => group.population))}
        ${this.renderTooltipGridItem("Balance", this.formatSignedPeople(support.housingBalance))}
        ${this.renderTooltipGridItem("Ratio", `${(support.housingRatio * 100).toFixed(0)}%`)}
      </div>
    `;
  }

  private renderAmenitiesTooltip(planetState: PlanetState): string {
    const support = this.getPlanetSupportMetrics(planetState);
    const productionRows = this.getAmenityProductionContributions(planetState);
    const rawProduction = productionRows.reduce((sum, row) => sum + row.amount, 0);
    const modifierDelta = planetState.economy.amenities - rawProduction;
    const productionTooltip = this.renderJobContributionTooltip(
      "Amenities Production",
      productionRows.concat(Math.abs(modifierDelta) > 0.0001 ? [{
        job: "administrator",
        amount: modifierDelta,
        groups: [],
      }] : []),
      (value) => this.formatSignedCompact(value),
      modifierDelta,
    );
    const usageTooltip = this.renderPopulationUsageTooltip(
      "Amenities Usage",
      planetState,
      (group) => group.population / PEOPLE_PER_MONTHLY_UNIT,
      (value) => this.formatCompact(value),
    );
    return `
      <div class="coTooltipTitle">Amenities</div>
      <p>Amenities production is compared against one amenity required per 1M population.</p>
      <div class="coTooltipGrid">
        ${this.renderTooltipGridItem("Production", this.formatCompact(planetState.economy.amenities), productionTooltip)}
        ${this.renderTooltipGridItem("Usage", this.formatCompact(planetState.population / PEOPLE_PER_MONTHLY_UNIT), usageTooltip)}
        ${this.renderTooltipGridItem("Balance", this.formatSignedCompact(support.amenityBalance))}
        ${this.renderTooltipGridItem("Ratio", `${(support.amenityRatio * 100).toFixed(0)}%`)}
      </div>
    `;
  }

  private renderHappinessTooltip(planetState: PlanetState): string {
    const support = this.getPlanetSupportMetrics(planetState);
    const totalPopulation = this.getPopGroupPopulation(planetState);
    const unemploymentRatio = totalPopulation > 0 ? planetState.economy.unemployedPopulation / totalPopulation : 0;
    const habitability = this.getWeightedGroupValue(planetState, (group) => this.getHabitabilityHappinessModifier(group.habitability));
    const jobPenalty = this.getWeightedGroupValue(planetState, (group) => this.getJobHappinessPenalty(group.job));
    const housing = this.getHousingHappinessModifier(support.housingRatio);
    const amenities = this.getAmenitiesHappinessModifier(support.amenityRatio);
    const employment = this.getEmploymentHappinessModifier(unemploymentRatio);
    const stability = this.getStabilityHappinessModifier(planetState.economy.stability);
    const expected = 50 + habitability + housing + amenities + employment + stability + jobPenalty;
    const modifiers = planetState.economy.happiness - expected;
    const groupTooltip = this.renderPopulationHappinessTooltip(planetState);
    return `
      <div class="coTooltipTitle">Average Happiness</div>
      <p>Weighted average happiness across all population groups.</p>
      <div class="coTooltipGrid">
        ${this.renderTooltipGridItem("Average", `${planetState.economy.happiness.toFixed(1)}%`, groupTooltip)}
        ${this.renderTooltipGridItem("Base", "50%")}
        ${this.renderTooltipGridItem("Habitability", this.formatSignedPercent(habitability))}
        ${this.renderTooltipGridItem("Housing", this.formatSignedPercent(housing))}
        ${this.renderTooltipGridItem("Amenities", this.formatSignedPercent(amenities))}
        ${this.renderTooltipGridItem("Employment", this.formatSignedPercent(employment))}
        ${this.renderTooltipGridItem("Stability", this.formatSignedPercent(stability))}
        ${this.renderTooltipGridItem("Job Effects", this.formatSignedPercent(jobPenalty))}
        ${this.renderTooltipGridItem("Modifiers", this.formatSignedPercent(modifiers))}
      </div>
    `;
  }

  private renderCrimeTooltip(planetState: PlanetState): string {
    const pressureRows = this.getCrimePressureContributions(planetState);
    const jobRows = this.getCrimeJobEffectContributions(planetState);
    const pressure = pressureRows.reduce((sum, row) => sum + row.amount, 0);
    const jobEffects = jobRows.reduce((sum, row) => sum + row.amount, 0);
    const beforeModifiers = pressure + jobEffects;
    const modifiers = planetState.economy.crime - beforeModifiers;
    return `
      <div class="coTooltipTitle">Crime</div>
      <p>Low happiness creates crime pressure. Enforcers reduce it, while criminals increase it.</p>
      <div class="coTooltipGrid">
        ${this.renderTooltipGridItem("Final Crime", `${planetState.economy.crime.toFixed(1)}%`)}
        ${this.renderTooltipGridItem("Happiness Pressure", `${pressure.toFixed(1)}%`, this.renderJobContributionTooltip("Crime Pressure", pressureRows, (value) => `${value.toFixed(1)}%`))}
        ${this.renderTooltipGridItem("Job Effects", this.formatSignedPercent(jobEffects), this.renderJobContributionTooltip("Crime Job Effects", jobRows, (value) => this.formatSignedPercent(value)))}
        ${this.renderTooltipGridItem("Modifiers", this.formatSignedPercent(modifiers))}
      </div>
    `;
  }

  private renderStabilityTooltip(planetState: PlanetState): string {
    const support = this.getPlanetSupportMetrics(planetState);
    const totalPopulation = this.getPopGroupPopulation(planetState);
    const unemploymentRatio = totalPopulation > 0 ? planetState.economy.unemployedPopulation / totalPopulation : 0;
    const highHappinessStability = this.getWeightedGroupValue(planetState, (group) => Math.max(0, group.happiness - 80) / 20 * 15);
    const highHappiness = highHappinessStability * 0.6;
    const crime = -planetState.economy.crime * 0.55;
    const housing = -Math.max(0, 1 - support.housingRatio) * 34;
    const amenities = -Math.max(0, 1 - support.amenityRatio) * 34;
    const unemployment = -unemploymentRatio * 24;
    const lowHappiness = -Math.max(0, (55 - planetState.economy.happiness) / 55) * 24;
    const beforeModifiers = 58 + highHappiness + crime + housing + amenities + unemployment + lowHappiness;
    const modifiers = planetState.economy.stability - beforeModifiers;
    return `
      <div class="coTooltipTitle">Stability</div>
      <p>Stability summarizes social order and affects planetary production.</p>
      <div class="coTooltipGrid">
        ${this.renderTooltipGridItem("Final Stability", `${planetState.economy.stability.toFixed(1)}%`)}
        ${this.renderTooltipGridItem("Base Control", "58%")}
        ${this.renderTooltipGridItem("Avg Happiness", `${planetState.economy.happiness.toFixed(1)}%`, this.renderPopulationHappinessTooltip(planetState))}
        ${this.renderTooltipGridItem("High Happiness", this.formatSignedPercent(highHappiness))}
        ${this.renderTooltipGridItem("Crime", this.formatSignedPercent(crime), this.renderCrimeTooltip(planetState))}
        ${this.renderTooltipGridItem("Housing Shortfall", this.formatSignedPercent(housing))}
        ${this.renderTooltipGridItem("Amenities Shortfall", this.formatSignedPercent(amenities), this.renderAmenitiesTooltip(planetState))}
        ${this.renderTooltipGridItem("Unemployment", this.formatSignedPercent(unemployment), this.renderUnemploymentTooltip(planetState))}
        ${this.renderTooltipGridItem("Low Happiness", this.formatSignedPercent(lowHappiness))}
        ${this.renderTooltipGridItem("Modifiers", this.formatSignedPercent(modifiers))}
      </div>
      <div class="coTooltipSectionTitle">Production Effect</div>
      <div class="coTooltipList">${this.renderTooltipListRow("Job production multiplier", `${this.formatMultiplier(this.getStabilityProductionMultiplier(planetState.economy.stability))}x`)}</div>
    `;
  }

  private renderResourceEconomyTooltip(planetState: PlanetState, resource: ResourceKind): string {
    const economy = planetState.economy;
    const productionRows = this.getResourceProductionContributions(planetState, resource);
    const upkeepRows = this.getResourceUpkeepContributions(planetState, resource);
    return `
      <div class="coTooltipTitle">${this.escapeHtml(RESOURCE_LABELS[resource])}</div>
      <p>Monthly planetary ${this.escapeHtml(RESOURCE_LABELS[resource].toLowerCase())} balance from jobs and population upkeep.</p>
      <div class="coTooltipGrid">
        ${this.renderTooltipGridItem("Net", this.formatSignedCompact(economy.net[resource]))}
        ${this.renderTooltipGridItem("Production", this.formatCompact(economy.production[resource]), this.renderJobContributionTooltip(`${RESOURCE_LABELS[resource]} Production`, productionRows, (value) => this.formatSignedCompact(value)))}
        ${this.renderTooltipGridItem("Upkeep", this.formatCompact(economy.upkeep[resource]), this.renderJobContributionTooltip(`${RESOURCE_LABELS[resource]} Upkeep`, upkeepRows, (value) => this.formatCompact(value)))}
        ${this.renderTooltipGridItem("Deficit", economy.deficit[resource] > 0 ? this.formatCompact(economy.deficit[resource]) : "0")}
      </div>
    `;
  }

  private renderUnemploymentTooltip(planetState: PlanetState): string {
    const unemployed = planetState.economy.popGroups.filter((group) => group.job === "unemployed");
    const criminal = planetState.economy.popGroups.filter((group) => group.job === "criminal");
    return `
      <div class="coTooltipTitle">Unemployment</div>
      <p>Population without productive jobs can reduce happiness and can become criminal population as crime rises.</p>
      <div class="coTooltipGrid">
        ${this.renderTooltipGridItem("Unemployed", this.formatPeople(planetState.economy.unemployedPopulation), this.renderGroupListTooltip("Unemployed Population", unemployed, (group) => this.formatPeople(group.population)))}
        ${this.renderTooltipGridItem("Criminals", this.formatPeople(criminal.reduce((sum, group) => sum + group.population, 0)), this.renderGroupListTooltip("Criminal Population", criminal, (group) => this.formatPeople(group.population)))}
        ${this.renderTooltipGridItem("Employed", this.formatPeople(planetState.economy.employedPopulation))}
        ${this.renderTooltipGridItem("Total Pop", this.formatPeople(planetState.population))}
      </div>
    `;
  }

  private renderGrowthTooltip(planetState: PlanetState): string {
    const growth = planetState.economy.populationGrowth;
    const weeklyGrowth = Math.round(growth.netPerQuarter * (7 / 120));
    return `
      <div class="coTooltipTitle">Population Growth</div>
      <p>Growth is calculated quarterly and shown as an estimated weekly change in the overview.</p>
      <div class="coTooltipGrid">
        ${this.renderTooltipGridItem("Growth / Week", this.formatSignedPeople(weeklyGrowth))}
        ${this.renderTooltipGridItem("Growth / Quarter", this.formatSignedPeople(growth.netPerQuarter))}
        ${this.renderTooltipGridItem("Quarter Rate", `${(growth.ratePerQuarter * 100).toFixed(3)}%`)}
        ${this.renderTooltipGridItem("Capacity", this.formatPeople(growth.capacity))}
        ${this.renderTooltipGridItem("Housing", this.formatSignedPercent(growth.factors.housing * 100))}
        ${this.renderTooltipGridItem("Amenities", this.formatSignedPercent(growth.factors.amenities * 100), this.renderAmenitiesTooltip(planetState))}
        ${this.renderTooltipGridItem("Stability", this.formatSignedPercent(growth.factors.stability * 100), this.renderStabilityTooltip(planetState))}
        ${this.renderTooltipGridItem("Crime", this.formatSignedPercent(growth.factors.crime * 100), this.renderCrimeTooltip(planetState))}
        ${this.renderTooltipGridItem("Employment", this.formatSignedPercent(growth.factors.employment * 100), this.renderUnemploymentTooltip(planetState))}
        ${this.renderTooltipGridItem("Capacity", this.formatSignedPercent(growth.factors.capacity * 100))}
      </div>
    `;
  }

  private renderDistrictCapacityTooltip(data: CelestialObjectPanelData, districtUsed: number, districtLimit: number): string {
    const planetState = data.planetState;
    const rows = DISTRICTS.map((district) => {
      const used = planetState?.builtDistricts[district.kind] ?? data.objectDetails.builtDistricts[district.kind];
      const limit = data.objectDetails.districtLimits[district.kind];
      return this.renderTooltipListRow(district.label, `${used}/${limit}`, this.renderDistrictTooltip(district.kind));
    }).join("");
    return `
      <div class="coTooltipTitle">District Capacity</div>
      <p>Built districts compared against this planet's available district limits.</p>
      <div class="coTooltipGrid">
        ${this.renderTooltipGridItem("Used", String(districtUsed))}
        ${this.renderTooltipGridItem("Limit", String(districtLimit))}
      </div>
      <div class="coTooltipSectionTitle">Districts</div>
      <div class="coTooltipList">${rows}</div>
    `;
  }

  private renderTooltipGridItem(label: string, value: string, tooltip?: string): string {
    return `<div><span>${this.escapeHtml(label)}</span>${this.renderTooltipValue(value, tooltip)}</div>`;
  }

  private renderTooltipListRow(label: string, value: string, tooltip?: string): string {
    return `<span class="coTooltipListRow"><em>${this.escapeHtml(label)}</em>${this.renderTooltipValue(value, tooltip)}</span>`;
  }

  private renderTooltipValue(value: string, tooltip?: string): string {
    if (!tooltip) return `<strong>${this.escapeHtml(value)}</strong>`;
    return `<button class="coTooltipDrill" type="button" data-co-tooltip="${this.tooltipAttr(tooltip)}">${this.escapeHtml(value)}</button>`;
  }

  private renderFlatBreakdownTooltip(
    title: string,
    rows: Array<{ label: string; amount: number }>,
    formatter: (value: number) => string,
  ): string {
    const visibleRows = rows.filter((row) => Math.abs(row.amount) > 0.0001);
    return `
      <div class="coTooltipTitle">${this.escapeHtml(title)}</div>
      <div class="coTooltipList">
        ${visibleRows.length
          ? visibleRows.map((row) => this.renderTooltipListRow(row.label, formatter(row.amount))).join("")
          : '<span>No active contribution</span>'}
      </div>
    `;
  }

  private renderJobContributionTooltip(
    title: string,
    rows: TooltipJobContribution[],
    formatter: (value: number) => string,
    modifierDelta?: number,
  ): string {
    const visibleRows = rows
      .filter((row) => Math.abs(row.amount) > 0.0001)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    return `
      <div class="coTooltipTitle">${this.escapeHtml(title)}</div>
      <div class="coTooltipList">
        ${visibleRows.length
          ? visibleRows.map((row) => {
            const isModifierRow = row.groups.length === 0 && modifierDelta !== undefined && Math.abs(row.amount - modifierDelta) < 0.0001;
            const label = isModifierRow ? "Modifiers" : JOB_LABELS[row.job];
            const nested = row.groups.length > 0 ? this.renderGroupContributionTooltip(label, row.groups, formatter) : undefined;
            return this.renderTooltipListRow(label, formatter(row.amount), nested);
          }).join("")
          : '<span>No active contribution</span>'}
      </div>
    `;
  }

  private renderGroupContributionTooltip(
    title: string,
    rows: TooltipGroupContribution[],
    formatter: (value: number) => string,
  ): string {
    return `
      <div class="coTooltipTitle">${this.escapeHtml(title)}</div>
      <div class="coTooltipList">
        ${rows.length
          ? rows
            .slice()
            .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
            .map(({ group, amount }) => this.renderTooltipListRow(
              `${group.speciesName} ${JOB_LABELS[group.job]} (${this.formatPeople(group.population)})`,
              formatter(amount),
            ))
            .join("")
          : '<span>No population contribution</span>'}
      </div>
    `;
  }

  private renderGroupListTooltip(title: string, groups: PopGroup[], formatter: (group: PopGroup) => string): string {
    return `
      <div class="coTooltipTitle">${this.escapeHtml(title)}</div>
      <div class="coTooltipList">
        ${groups.length
          ? groups.map((group) => this.renderTooltipListRow(
            `${group.speciesName} ${JOB_LABELS[group.job]} (${this.formatPeople(group.population)})`,
            formatter(group),
          )).join("")
          : '<span>No population in this category</span>'}
      </div>
    `;
  }

  private renderPopulationUsageTooltip(
    title: string,
    planetState: PlanetState,
    getAmount: (group: PopGroup) => number = (group) => group.population,
    formatter: (value: number) => string = (value) => this.formatPeople(value),
  ): string {
    const groups = planetState.economy.popGroups.map((group) => ({ group, amount: getAmount(group) }));
    return this.renderGroupContributionTooltip(title, groups, formatter);
  }

  private renderPopulationHappinessTooltip(planetState: PlanetState): string {
    return `
      <div class="coTooltipTitle">Population Happiness</div>
      <div class="coTooltipList">
        ${planetState.economy.popGroups.length
          ? planetState.economy.popGroups
            .slice()
            .sort((a, b) => b.population - a.population)
            .map((group) => this.renderTooltipListRow(
              `${group.speciesName} ${JOB_LABELS[group.job]} (${this.formatPeople(group.population)})`,
              `${group.happiness}%`,
            ))
            .join("")
          : '<span>No population groups</span>'}
      </div>
    `;
  }

  private renderModifierSection(planetState: PlanetState, predicate: (target: PlanetModifierTarget) => boolean): string {
    const modifiers = planetState.economy.activeModifiers.filter((modifier) => predicate(modifier.target));
    if (modifiers.length === 0) return "";
    return `
      <div class="coTooltipSectionTitle">Modifiers</div>
      <div class="coTooltipList">
        ${modifiers.map((modifier) => this.renderTooltipListRow(
          modifier.label,
          modifier.operation === "multiply" ? `${this.formatSignedPercent(modifier.value * 100)} multiplier` : this.formatSignedCompact(modifier.value),
        )).join("")}
      </div>
    `;
  }

  private getHousingSourceRows(planetState: PlanetState): Array<{ label: string; amount: number }> {
    const rows: Array<{ label: string; amount: number }> = [
      { label: "City Districts", amount: planetState.builtDistricts.city * 1_600_000_000 },
    ];
    const subDistrictTotals = new Map<UrbanSubDistrictKind, number>();
    for (const subDistrict of planetState.urbanSubDistricts) {
      let amount = 0;
      if (subDistrict.kind === "residential") amount = planetState.builtDistricts.city * 1_100_000_000;
      if (subDistrict.kind !== "residential") amount = -planetState.builtDistricts.city * 500_000_000;
      subDistrictTotals.set(subDistrict.kind, (subDistrictTotals.get(subDistrict.kind) ?? 0) + amount);
      for (const building of subDistrict.buildings) {
        const buildingKind = getPlanetBuildingKind(building);
        if (!buildingKind) continue;
        const level = getPlanetBuildingLevel(building);
        const housing = (BUILDING_DEFINITIONS[buildingKind]?.housing ?? 0) * getBuildingLevelEffectMultiplier(level);
        if (housing) rows.push({ label: `${BUILDING_LABELS[buildingKind]} Lv ${level}`, amount: housing });
      }
    }
    for (const [kind, amount] of subDistrictTotals) rows.push({ label: URBAN_SUB_DISTRICT_LABELS[kind], amount });
    for (const building of planetState.buildings.city) {
      const buildingKind = getPlanetBuildingKind(building);
      if (!buildingKind) continue;
      const level = getPlanetBuildingLevel(building);
      const housing = (BUILDING_DEFINITIONS[buildingKind]?.housing ?? 0) * getBuildingLevelEffectMultiplier(level);
      if (housing) rows.push({ label: `${BUILDING_LABELS[buildingKind]} Lv ${level}`, amount: housing });
    }
    return rows;
  }

  private getAmenityProductionContributions(planetState: PlanetState): TooltipJobContribution[] {
    return this.getGroupedContributions(planetState, (group) => this.getGroupAmenityProduction(planetState, group));
  }

  private getResourceProductionContributions(planetState: PlanetState, resource: ResourceKind): TooltipJobContribution[] {
    return this.getGroupedContributions(planetState, (group) => this.getGroupResourceProduction(planetState, group, resource));
  }

  private getResourceUpkeepContributions(planetState: PlanetState, resource: ResourceKind): TooltipJobContribution[] {
    return this.getGroupedContributions(planetState, (group) => this.getGroupResourceUpkeep(planetState, group, resource));
  }

  private getCrimePressureContributions(planetState: PlanetState): TooltipJobContribution[] {
    const totalPopulation = this.getPopGroupPopulation(planetState);
    return this.getGroupedContributions(planetState, (group) => (
      totalPopulation > 0
        ? this.getHappinessCrimePressure(group.happiness) * (group.population / totalPopulation)
        : 0
    ));
  }

  private getCrimeJobEffectContributions(planetState: PlanetState): TooltipJobContribution[] {
    return this.getGroupedContributions(planetState, (group) => -this.getGroupCrimeReduction(planetState, group));
  }

  private getGroupedContributions(
    planetState: PlanetState,
    getAmount: (group: PopGroup) => number,
  ): TooltipJobContribution[] {
    const rows = new Map<JobKind, TooltipJobContribution>();
    for (const group of planetState.economy.popGroups) {
      const amount = getAmount(group);
      if (Math.abs(amount) <= 0.0001) continue;
      const existing = rows.get(group.job) ?? { job: group.job, amount: 0, groups: [] };
      existing.amount += amount;
      existing.groups.push({ group, amount });
      rows.set(group.job, existing);
    }
    return this.getAllJobs().map((job) => rows.get(job)).filter((row): row is TooltipJobContribution => Boolean(row));
  }

  private getGroupAmenityProduction(planetState: PlanetState, group: PopGroup): number {
    if (group.job === "unemployed") return 0;
    const amenities = JOB_DEFINITIONS[group.job].amenities ?? 0;
    if (amenities === 0) return 0;
    const base = (group.population / PEOPLE_PER_MONTHLY_UNIT) * amenities;
    return this.applyPlanetModifiers(
      base,
      planetState.economy.activeModifiers,
      `jobAmenities:${group.job}` as PlanetModifierTarget,
    ) * getHabitabilityProductionMultiplier(group.habitability);
  }

  private getGroupResourceProduction(planetState: PlanetState, group: PopGroup, resource: ResourceKind): number {
    if (group.job === "unemployed") return 0;
    const amount = JOB_DEFINITIONS[group.job].output?.[resource] ?? 0;
    if (amount === 0) return 0;
    const units = group.population / PEOPLE_PER_MONTHLY_UNIT;
    const generic = this.applyPlanetModifiers(units * amount, planetState.economy.activeModifiers, "jobOutput");
    return this.applyPlanetModifiers(
      generic,
      planetState.economy.activeModifiers,
      `jobOutput:${group.job}:${resource}` as PlanetModifierTarget,
    ) * this.getGroupProductionMultiplier(planetState, group);
  }

  private getGroupResourceUpkeep(planetState: PlanetState, group: PopGroup, resource: ResourceKind): number {
    const units = group.population / PEOPLE_PER_MONTHLY_UNIT;
    let amount = 0;
    if (group.job !== "unemployed") {
      const jobUpkeep = JOB_DEFINITIONS[group.job].upkeep?.[resource] ?? 0;
      if (jobUpkeep !== 0) {
        const generic = this.applyPlanetModifiers(units * jobUpkeep, planetState.economy.activeModifiers, "jobUpkeep");
        amount += this.applyPlanetModifiers(
          generic,
          planetState.economy.activeModifiers,
          `jobUpkeep:${group.job}:${resource}` as PlanetModifierTarget,
        ) * getHabitabilityUpkeepMultiplier(group.habitability);
      }
    }
    if (resource === "goods") {
      const goodsUpkeep = group.job === "unemployed" ? 0.025 : this.getClassGoodsUpkeep(group.class);
      amount += this.applyPlanetModifiers(
        units * goodsUpkeep,
        planetState.economy.activeModifiers,
        `goodsUpkeep:${group.class}` as PlanetModifierTarget,
      ) * getHabitabilityUpkeepMultiplier(group.habitability);
    }
    if (resource === "food") {
      amount += this.applyPlanetModifiers(
        units * 1.1 * getHabitabilityUpkeepMultiplier(group.habitability),
        planetState.economy.activeModifiers,
        "popUpkeep:food",
      );
    }
    return amount;
  }

  private getGroupCrimeReduction(planetState: PlanetState, group: PopGroup): number {
    if (group.job === "unemployed") return 0;
    const crimeReduction = JOB_DEFINITIONS[group.job].crimeReduction ?? 0;
    if (crimeReduction === 0) return 0;
    return (group.population / PEOPLE_PER_MONTHLY_UNIT) * crimeReduction * this.getGroupProductionMultiplier(planetState, group);
  }

  private getGroupProductionMultiplier(planetState: PlanetState, group: PopGroup): number {
    return getHabitabilityProductionMultiplier(group.habitability)
      * this.getStabilityProductionMultiplier(planetState.economy.stability);
  }

  private getPopGroupPopulation(planetState: PlanetState): number {
    return planetState.economy.popGroups.reduce((sum, group) => sum + group.population, 0);
  }

  private getWeightedGroupValue(planetState: PlanetState, getValue: (group: PopGroup) => number): number {
    const totalPopulation = this.getPopGroupPopulation(planetState);
    if (totalPopulation <= 0) return 0;
    return planetState.economy.popGroups.reduce((sum, group) => (
      sum + getValue(group) * group.population
    ), 0) / totalPopulation;
  }

  private applyPlanetModifiers(value: number, modifiers: PlanetState["economy"]["activeModifiers"], target: PlanetModifierTarget): number {
    let next = value;
    for (const modifier of modifiers) {
      if (modifier.target === target && modifier.operation === "add") next += modifier.value;
    }
    for (const modifier of modifiers) {
      if (modifier.target === target && modifier.operation === "multiply") next *= 1 + modifier.value;
    }
    return next;
  }

  private getAllJobs(): JobKind[] {
    return JOB_FILL_ORDER.concat("criminal", "unemployed");
  }

  private getHousingHappinessModifier(housingRatio: number): number {
    if (!Number.isFinite(housingRatio)) return 0;
    if (housingRatio >= 1) return Math.max(0, Math.min(20, (housingRatio - 1) / 0.5 * 20));
    if (housingRatio <= 0.1) return -40;
    return this.interpolate(housingRatio, 0.1, 1, -40, 0);
  }

  private getAmenitiesHappinessModifier(amenityRatio: number): number {
    if (!Number.isFinite(amenityRatio)) return 0;
    return Math.max(-10, Math.min(10, (amenityRatio - 1) * 10));
  }

  private getEmploymentHappinessModifier(unemploymentRatio: number): number {
    return Math.max(-28, Math.min(5, 5 - unemploymentRatio * 40));
  }

  private getHabitabilityHappinessModifier(habitability: number): number {
    if (habitability <= 80) return this.interpolate(habitability, 0, 80, -30, 0);
    return this.interpolate(habitability, 80, 100, 0, 30);
  }

  private getStabilityHappinessModifier(stability: number): number {
    if (stability < 50) return -(50 - stability) * 0.3;
    if (stability > 75) return Math.min(5, (stability - 75) * 0.08);
    return 0;
  }

  private getStabilityProductionMultiplier(stability: number): number {
    if (stability <= 50) return this.interpolate(stability, 0, 50, 0.35, 1);
    return this.interpolate(stability, 50, 100, 1, 1.25);
  }

  private getHappinessCrimePressure(happiness: number): number {
    if (happiness >= 100) return 0;
    if (happiness >= 80) return (100 - happiness) * 0.25;
    return 5 + ((80 - happiness) / 80) * 95;
  }

  private getJobHappinessPenalty(job: JobKind): number {
    if (job === "unemployed") return -25;
    if (job === "criminal") return -18;
    return 0;
  }

  private interpolate(value: number, inputMin: number, inputMax: number, outputMin: number, outputMax: number): number {
    if (inputMax === inputMin) return outputMin;
    const t = Math.max(0, Math.min(1, (value - inputMin) / (inputMax - inputMin)));
    return outputMin + (outputMax - outputMin) * t;
  }

  private formatSignedPercent(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    return `${rounded >= 0 ? "+" : ""}${rounded}%`;
  }

  private formatMultiplier(value: number): string {
    return value.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
  }

  private renderBuildingTooltip(
    definition: BuildingDefinition,
    planetState: PlanetState,
    area: BuildingSlotArea,
    subDistrictIndex?: number,
    queued?: PlanetConstructionQueueItem,
    building?: PlanetBuildingSlot,
    technology?: FactionTechnologyView | null,
  ): string {
    const level = Math.max(1, getPlanetBuildingLevel(building) || queued?.targetLevel || 1);
    const targetLevel = getBuildingUpgradeTargetLevel(building);
    const canUpgrade = targetLevel !== null && this.isBuildingLevelUnlocked(technology, definition.kind, targetLevel);
    const levelLabel = targetLevel && canUpgrade
      ? `Level ${level} -> ${targetLevel}`
      : `Level ${level}${level >= BUILDING_MAX_LEVEL ? " (max)" : ""}`;
    const buildCost = queued?.kind === "buildingUpgrade" && queued.targetLevel
      ? queued.mineralCost
      : building
        ? targetLevel
          ? getBuildingUpgradeMineralCost(definition.kind, level)
          : 0
        : getBuildingMineralCost(definition.kind, 1);
    const buildDays = queued?.kind === "buildingUpgrade"
      ? queued.remainingDays
      : building
        ? targetLevel
          ? getBuildingUpgradeBuildDays(definition.kind, level)
          : 0
        : getBuildingBuildDays(definition.kind, 1);
    const jobLines = this.renderBuildingJobLines(definition, planetState, level);
    const productionLines = this.renderBuildingProductionLines(definition, planetState, level);
    const compatible = this.isDefinitionCompatible(definition, area, subDistrictIndex, planetState);
    return `
      <div class="coTooltipTitle">${this.escapeHtml(definition.label)}</div>
      <p>${this.escapeHtml(definition.description)}</p>
      <div class="coTooltipGrid">
        <div><span>Level</span><strong>${this.escapeHtml(levelLabel)}</strong></div>
        <div><span>${building ? "Upgrade Cost" : "Cost"}</span><strong>${buildCost > 0 ? `${buildCost} Minerals` : "Maxed"}</strong></div>
        <div><span>${building ? "Upgrade Time" : "Build Time"}</span><strong>${queued ? `${this.formatConstructionDays(queued.remainingDays)} left` : buildDays > 0 ? `${this.formatConstructionDays(buildDays)}` : "Maxed"}</strong></div>
        <div><span>Slot</span><strong>${compatible ? "Compatible" : "Incompatible"}</strong></div>
      </div>
      ${building && targetLevel !== null ? `
        <button class="coTooltipAction" type="button" ${canUpgrade ? "" : "disabled"}>
          ${canUpgrade ? `Upgrade to level ${targetLevel}` : `Requires ${this.escapeHtml(this.getRequiredBuildingLevelTechnologyName(definition.kind, targetLevel))}`}
        </button>
      ` : ""}
      <div class="coTooltipSectionTitle">Jobs And Housing</div>
      <div class="coTooltipList">${jobLines.length ? jobLines.map((line) => `<span>${line}</span>`).join("") : "<span>No direct jobs.</span>"}</div>
      <div class="coTooltipSectionTitle">Predicted Monthly Output</div>
      <div class="coTooltipList">${productionLines.length ? productionLines.map((line) => `<span>${line}</span>`).join("") : "<span>No direct production.</span>"}</div>
    `;
  }

  private renderBuildingJobLines(definition: BuildingDefinition, planetState: PlanetState, level = 1): string[] {
    const lines: string[] = [];
    const levelMultiplier = getBuildingLevelEffectMultiplier(level);
    if (definition.housing) lines.push(`+${this.formatPeople(definition.housing * levelMultiplier)} Housing`);
    for (const effect of definition.jobs ?? []) {
      const amount = effect.amount * (effect.perDistrict ? planetState.builtDistricts[effect.perDistrict] : 1) * levelMultiplier;
      const sign = amount >= 0 ? "+" : "-";
      lines.push(`${sign}${this.formatPeople(Math.abs(amount))} ${this.escapeHtml(JOB_LABELS[effect.job])}`);
    }
    return lines;
  }

  private renderBuildingProductionLines(definition: BuildingDefinition, planetState: PlanetState, level = 1): string[] {
    const habitability = getEffectiveSpeciesHabitability(planetState);
    const outputMultiplier = getHabitabilityProductionMultiplier(habitability) * Math.max(0, 1 + (planetState.economy.stability - 50) * 0.005);
    const upkeepMultiplier = getHabitabilityUpkeepMultiplier(habitability);
    const levelMultiplier = getBuildingLevelEffectMultiplier(level);
    const lines: string[] = [];
    for (const effect of definition.jobs ?? []) {
      const amount = effect.amount * (effect.perDistrict ? planetState.builtDistricts[effect.perDistrict] : 1) * levelMultiplier;
      if (amount === 0) continue;
      const units = amount / 1_000_000;
      const job = JOB_DEFINITIONS[effect.job];
      for (const [resource, value] of Object.entries(job.output ?? {}) as Array<[ResourceKind, number]>) {
        lines.push(`${this.formatSignedCompact(units * value * outputMultiplier)} ${RESOURCE_LABELS[resource]}`);
      }
      for (const [resource, value] of Object.entries(job.upkeep ?? {}) as Array<[ResourceKind, number]>) {
        lines.push(`${this.formatSignedCompact(-units * value * upkeepMultiplier)} ${RESOURCE_LABELS[resource]} upkeep`);
      }
      if (job.amenities) lines.push(`${this.formatSignedCompact(units * job.amenities * outputMultiplier)} Amenities`);
      if (job.crimeReduction) lines.push(`${this.formatSignedCompact(-units * job.crimeReduction * outputMultiplier)} Crime`);
    }
    return lines;
  }

  private isDefinitionCompatible(
    definition: BuildingDefinition,
    area: BuildingSlotArea,
    subDistrictIndex: number | undefined,
    planetState: PlanetState,
  ): boolean {
    const subDistrictKind = area === "urbanSubDistrict" && subDistrictIndex !== undefined
      ? planetState.urbanSubDistricts[subDistrictIndex]?.kind
      : undefined;
    return definition.compatibility.some((rule) => {
      if (rule.area !== area) return false;
      if (area !== "urbanSubDistrict") return true;
      return Boolean(subDistrictKind && rule.subDistrictKinds?.includes(subDistrictKind));
    });
  }

  private renderConstructionQueue(data: CelestialObjectPanelData): string {
    const planetState = data.planetState;
    if (!planetState) return "";
    const queue = this.getEstimatedConstructionQueue(planetState);
    const canCancel = data.canManageLeaders === true;
    return `
      <div class="coQueuePanel" data-co-queue-panel>
        <div class="coQueueHeader">
          <strong>Build Queue</strong>
          <span data-co-queue-count>${queue.length} active</span>
        </div>
        <div class="coQueueList" data-co-queue-list>
          ${queue.length === 0 ? '<div class="coQueueEmpty">No active construction</div>' : queue.map((item) => this.renderQueueItem(item, canCancel)).join("")}
        </div>
      </div>
    `;
  }

  private renderQueueItem(item: PlanetConstructionQueueItem, canCancel: boolean): string {
    return `
      <div class="coQueueItem" data-co-queue-item="${this.escapeHtml(item.id)}">
        ${canCancel ? `
          <button
            class="coQueueCancel"
            type="button"
            data-co-cancel-planet-queue="${this.escapeHtml(item.id)}"
            aria-label="Cancel ${this.escapeHtml(item.label)}"
            title="Cancel construction"
          >X</button>
        ` : ""}
        <div class="coQueueItemMain">
          <strong title="${this.escapeHtml(item.label)}">${this.escapeHtml(item.label)}</strong>
          <span data-co-queue-days>${this.formatConstructionDays(item.remainingDays)} remaining</span>
        </div>
        <small>${item.mineralCost} minerals</small>
        <div class="coQueueProgress"><span data-co-queue-progress-fill style="width:${this.getConstructionProgressPercent(item)}"></span></div>
      </div>
    `;
  }

  private renderProductionPanels(planetState: PlanetState): string {
    const netRows = RESOURCE_KINDS.map((resource) => {
      const value = planetState.economy.net[resource];
      const className = value >= 0 ? "positive" : "negative";
      return this.renderProductionToken(resource, RESOURCE_LABELS[resource], this.formatSignedCompact(value), className, this.renderResourceEconomyTooltip(planetState, resource));
    }).join("");
    const deficits = RESOURCE_KINDS
      .filter((resource) => planetState.economy.deficit[resource] > 0)
      .map((resource) => this.renderProductionToken(resource, RESOURCE_LABELS[resource], `-${this.formatCompact(planetState.economy.deficit[resource])}`, "negative", this.renderResourceEconomyTooltip(planetState, resource)))
      .join("");

    return `
      <div class="coProduction" data-co-production-panel>
        <h4>Planet Production</h4>
        <div class="coTokenGrid">${netRows}</div>
        <h4>Planet Deficit</h4>
        ${deficits ? `<div class="coTokenGrid">${deficits}</div>` : '<div class="coEmptyLine">No active deficits</div>'}
      </div>
    `;
  }

  private renderProductionToken(icon: string, label: string, value: string, className: string, tooltip?: string): string {
    const tooltipAttribute = tooltip ? ` data-co-tooltip="${this.tooltipAttr(tooltip)}"` : "";
    return `
      <span class="coProductionToken ${className}"${tooltipAttribute}>
        ${this.renderStatIcon(icon)}
        <span>${this.escapeHtml(label)}</span>
        <strong>${this.escapeHtml(value)}</strong>
      </span>
    `;
  }

  private renderEconomyBody(planetState: PlanetState): string {
    const classes: Array<{ className: JobClass; label: string }> = [
      { className: "upper", label: "Upper Class" },
      { className: "middle", label: "Middle Class" },
      { className: "lower", label: "Lower Class" },
    ];
    const selectedJob = this.resolveSelectedEconomyJob(planetState);
    const growth = planetState.economy.populationGrowth;
    const weeklyGrowth = Math.round(growth.netPerQuarter * (7 / 120));
    const growthLabel = this.formatSignedPeople(weeklyGrowth);
    const growthRate = `${(growth.ratePerQuarter * (7 / 120) * 100).toFixed(3)}% / week`;

    return `
      <section class="coBody coEconomyBody" data-co-body="economy">
        <div class="coJobsPanel">
          <div class="coBodyHeader">Jobs</div>
          <div class="coJobClassList">
            ${classes.map((entry) => this.renderJobClass(planetState, entry.className, entry.label, selectedJob)).join("")}
          </div>
        </div>
        <aside class="coDemographicsPanel">
          <div class="coBodyHeader">Demographics</div>
          <div class="coGrowthGrid">
            <div><strong>${growth.netPerQuarter >= 0 ? "Growing" : "Contracting"}</strong><span>${growthLabel}<small>${growthRate}</small></span></div>
            <div><strong>Assembly</strong><span>0<small>No assembly source</small></span></div>
            <div><strong>Capacity</strong><span>${this.formatPeople(growth.capacity)}<small>${(growth.capacityPressure * 100).toFixed(0)}% density</small></span></div>
          </div>
          <div class="coSpeciesOrb"></div>
          <div class="coSelectedJob">
            ${selectedJob ? this.renderSelectedJob(planetState, selectedJob) : '<div class="coEmptyLine">No assigned jobs</div>'}
          </div>
        </aside>
      </section>
    `;
  }

  private renderJobClass(planetState: PlanetState, className: JobClass, label: string, selectedJob: JobKind | null): string {
    const jobs = this.getJobsForClass(className);
    const total = jobs.reduce((sum, job) => sum + this.getPopForJob(planetState, job), 0);
    const capacity = jobs.reduce((sum, job) => sum + planetState.economy.jobCapacity[job], 0);
    const expanded = this.expandedJobClasses.has(className);

    return `
      <article class="coJobClass ${expanded ? "expanded" : ""}">
        <button class="coJobClassTitle" type="button" data-co-job-class="${className}" aria-expanded="${expanded ? "true" : "false"}">
          <span class="coJobClassLabel"><i aria-hidden="true"></i>${this.escapeHtml(label)}</span>
          <span class="coJobClassTotals">
            <strong>${this.formatPeople(total)}</strong>
            <small>cap ${this.formatPeople(capacity)}</small>
          </span>
        </button>
        <div class="coJobIconRail">
          ${jobs.map((job) => this.renderJobMini(planetState, job, selectedJob)).join("")}
        </div>
        ${expanded ? `
          <div class="coJobRows">
            ${jobs.map((job) => this.renderJobRow(planetState, job, selectedJob)).join("")}
          </div>
        ` : ""}
      </article>
    `;
  }

  private renderJobMini(planetState: PlanetState, job: JobKind, selectedJob: JobKind | null): string {
    const population = this.getPopForJob(planetState, job);
    const selected = selectedJob === job ? " selected" : "";
    return `
      <button
        class="coJobMini${selected}"
        type="button"
        data-co-job="${job}"
        data-co-tooltip="${this.tooltipAttr(this.renderJobTooltip(planetState, job))}"
        aria-label="${this.escapeHtml(JOB_LABELS[job])}">
        ${this.renderJobIcon(job)}
        <span>${this.formatPeople(population)}</span>
      </button>
    `;
  }

  private renderJobRow(planetState: PlanetState, job: JobKind, selectedJob: JobKind | null): string {
    const population = this.getPopForJob(planetState, job);
    const capacity = planetState.economy.jobCapacity[job];
    const selected = selectedJob === job ? " selected" : "";
    return `
      <button
        class="coJobRow${selected}"
        type="button"
        data-co-job="${job}"
        data-co-tooltip="${this.tooltipAttr(this.renderJobTooltip(planetState, job))}">
        <span class="coJobIcon">${this.renderJobIcon(job)}</span>
        <span class="coJobMain">
          <strong>${this.escapeHtml(JOB_LABELS[job])}</strong>
          <small>${this.escapeHtml(JOB_DEFINITIONS[job].description)}</small>
        </span>
        <span class="coJobNumbers">
          <strong>${this.formatPeople(population)}</strong>
          <small>cap ${this.formatPeople(capacity)}</small>
        </span>
        <span class="coJobRecipe">
          ${this.renderJobConversion(job, PEOPLE_PER_MONTHLY_UNIT)}
        </span>
      </button>
    `;
  }

  private renderSelectedJob(planetState: PlanetState, job: JobKind): string {
    const groups = planetState.economy.popGroups.filter((candidate) => candidate.job === job);
    const population = groups.reduce((sum, group) => sum + group.population, 0);
    const jobClass = this.getJobClass(job);
    return `
      <div class="coSelectedJobHeader">
        <span class="coSelectedJobIcon">${this.renderJobIcon(job)}</span>
        <div>
          <h4>${this.escapeHtml(JOB_LABELS[job])}</h4>
          <p>${this.escapeHtml(this.formatJobClassLabel(jobClass))} | ${this.formatPeople(population)} / ${this.formatPeople(planetState.economy.jobCapacity[job])}</p>
        </div>
      </div>
      <div class="coSelectedJobRecipe">
        ${this.renderJobConversion(job, PEOPLE_PER_MONTHLY_UNIT, "Per 1M")}
      </div>
      <div class="coPopGroupList">
        ${groups.length === 0
          ? '<div class="coEmptyLine">No assigned population</div>'
          : groups.map((group, index) => `
            <article class="coPopGroupCard">
              <img class="coPopPortrait" src="${this.escapeHtml(this.getPopGroupPlaceholderImage(group, index))}" alt="" />
              <div class="coPopGroupMain">
                <div class="coPopGroupTitle">
                  <strong>${this.escapeHtml(group.speciesName)}</strong>
                  <span>${this.escapeHtml(this.formatJobClassLabel(group.class))}</span>
                </div>
                <div class="coPopStats">
                  <span>Population <strong>${this.formatPeople(group.population)}</strong></span>
                  <span>Happy <strong>${group.happiness}%</strong></span>
                  <span>Hab <strong>${group.habitability}%</strong></span>
                </div>
                <div class="coPopGroupFlow">
                  ${this.renderJobConversion(job, group.population)}
                </div>
              </div>
            </article>
          `).join("")}
      </div>
    `;
  }

  private renderJobTooltip(planetState: PlanetState, job: JobKind): string {
    const population = this.getPopForJob(planetState, job);
    const capacity = planetState.economy.jobCapacity[job];
    return `
      <div class="coTooltipSectionTitle">${this.escapeHtml(JOB_LABELS[job])}</div>
      <p>${this.escapeHtml(JOB_DEFINITIONS[job].description)}</p>
      <div class="coTooltipList">
        <span>Class: ${this.escapeHtml(this.formatJobClassLabel(this.getJobClass(job)))}</span>
        <span>Population: ${this.formatPeople(population)} / ${this.formatPeople(capacity)}</span>
      </div>
      <div class="coTooltipSectionTitle">Conversion</div>
      ${this.renderJobConversion(job, PEOPLE_PER_MONTHLY_UNIT, "Per 1M")}
    `;
  }

  private renderJobConversion(job: JobKind, population: number, prefix?: string): string {
    const multiplier = Math.max(0, population / PEOPLE_PER_MONTHLY_UNIT);
    const flows = this.getJobFlowEntries(job)
      .map((entry) => ({ ...entry, amount: entry.amount * multiplier }))
      .filter((entry) => Math.abs(entry.amount) > 0.0001);
    const inputs = flows.filter((entry) => entry.direction === "input");
    const outputs = flows.filter((entry) => entry.direction === "output");
    const effects = flows.filter((entry) => entry.direction === "effect");
    if (flows.length === 0) {
      return `<span class="coFlowEmpty">${prefix ? `${this.escapeHtml(prefix)}: ` : ""}No conversion</span>`;
    }
    return `
      <span class="coFlowLine">
        ${prefix ? `<span class="coFlowPrefix">${this.escapeHtml(prefix)}</span>` : ""}
        ${inputs.length > 0 ? inputs.map((entry) => this.renderFlowChip(entry)).join("") : '<span class="coFlowNone">No input</span>'}
        <span class="coFlowArrow" aria-hidden="true">&rarr;</span>
        ${outputs.length > 0 ? outputs.map((entry) => this.renderFlowChip(entry)).join("") : '<span class="coFlowNone">No output</span>'}
        ${effects.map((entry) => this.renderFlowChip(entry)).join("")}
      </span>
    `;
  }

  private renderFlowChip(entry: EconomyFlowEntry): string {
    const className = entry.direction === "input" ? "input" : entry.direction === "output" ? "output" : "effect";
    return `
      <span class="coFlowChip ${className}">
        ${this.renderStatIcon(entry.resource)}
        <strong>${this.escapeHtml(this.formatFlowAmount(entry.amount))}</strong>
        <small>${this.escapeHtml(this.getFlowResourceLabel(entry.resource))}</small>
      </span>
    `;
  }

  private getJobFlowEntries(job: JobKind): EconomyFlowEntry[] {
    const entries: EconomyFlowEntry[] = [];
    const addEntry = (resource: EconomyFlowResource, amount: number, direction: EconomyFlowEntry["direction"]): void => {
      if (amount === 0) return;
      const existing = entries.find((entry) => entry.resource === resource && entry.direction === direction);
      if (existing) {
        existing.amount += amount;
      } else {
        entries.push({ resource, amount, direction });
      }
    };
    const definition = JOB_DEFINITIONS[job];
    for (const [resource, value] of Object.entries(definition.output ?? {}) as Array<[ResourceKind, number]>) {
      addEntry(resource, value, "output");
    }
    for (const [resource, value] of Object.entries(definition.upkeep ?? {}) as Array<[ResourceKind, number]>) {
      addEntry(resource, -value, "input");
    }
    addEntry("goods", -this.getClassGoodsUpkeep(this.getJobClass(job)), "input");
    if (definition.amenities) addEntry("amenities", definition.amenities, "effect");
    if (definition.crimeReduction) addEntry("crime", -definition.crimeReduction, "effect");
    return entries;
  }

  private getClassGoodsUpkeep(jobClass: JobClass): number {
    if (jobClass === "upper") return 0.45;
    if (jobClass === "middle") return 0.25;
    return 0.08;
  }

  private resolveSelectedEconomyJob(planetState: PlanetState): JobKind | null {
    const allJobs = JOB_FILL_ORDER.concat("criminal", "unemployed");
    if (this.selectedJob && allJobs.includes(this.selectedJob)) return this.selectedJob;
    return allJobs.find((job) => this.getPopForJob(planetState, job) > 0)
      ?? allJobs.find((job) => planetState.economy.jobCapacity[job] > 0)
      ?? null;
  }

  private getJobsForClass(className: JobClass): JobKind[] {
    return JOB_FILL_ORDER
      .concat("criminal", "unemployed")
      .filter((job) => this.getJobClass(job) === className);
  }

  private getPopForJob(planetState: PlanetState, job: JobKind): number {
    return planetState.economy.popGroups
      .filter((group) => group.job === job)
      .reduce((sum, group) => sum + group.population, 0);
  }

  private getJobClass(job: JobKind): JobClass {
    return JOB_DEFINITIONS[job].class;
  }

  private formatJobClassLabel(jobClass: JobClass): string {
    if (jobClass === "upper") return "Upper Class";
    if (jobClass === "middle") return "Middle Class";
    return "Lower Class";
  }

  private getFlowResourceLabel(resource: EconomyFlowResource): string {
    if (resource === "amenities") return "Amenities";
    if (resource === "crime") return "Crime";
    return RESOURCE_LABELS[resource];
  }

  private formatFlowAmount(value: number): string {
    const sign = value >= 0 ? "+" : "-";
    const abs = Math.abs(value);
    if (abs >= 1000) return `${sign}${this.formatCompact(abs)}`;
    if (abs >= 10) return `${sign}${abs.toFixed(0)}`;
    if (abs >= 1) return `${sign}${abs.toFixed(1).replace(/\.0$/, "")}`;
    return `${sign}${abs.toFixed(2).replace(/0$/, "").replace(/\.0$/, "")}`;
  }

  private createDefaultExpandedJobClasses(): Set<JobClass> {
    return new Set<JobClass>();
  }

  private renderJobIcon(job: JobKind): string {
    const icons: Record<JobKind, string> = {
      administrator: '<svg class="coJobGlyph" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 12h22L16 5 5 12z"/><path d="M8 13v11M14 13v11M20 13v11M26 13v11"/><path d="M5 25h22"/></svg>',
      researcher: '<svg class="coJobGlyph" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="2.5"/><path d="M5 16c3-5 19-5 22 0-3 5-19 5-22 0z"/><path d="M16 5c5 3 5 19 0 22-5-3-5-19 0-22z"/><path d="M9 9c5 1 12 8 14 14"/></svg>',
      artisan: '<svg class="coJobGlyph" viewBox="0 0 32 32" aria-hidden="true"><path d="M10 22l8-8"/><path d="M15 7l10 10-4 4L11 11l4-4z"/><path d="M7 25l4-1 13-13-3-3L8 21l-1 4z"/></svg>',
      metallurgist: '<svg class="coJobGlyph" viewBox="0 0 32 32" aria-hidden="true"><path d="M8 25h16l2-10H6l2 10z"/><path d="M11 14c0-5 5-6 5-10 4 4 6 7 4 10"/><path d="M14 21h4"/></svg>',
      entertainer: '<svg class="coJobGlyph" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 5l3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1 3-7z"/><path d="M12 17c2 2 6 2 8 0"/></svg>',
      enforcer: '<svg class="coJobGlyph" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4l10 4v7c0 7-4 10-10 13C10 25 6 22 6 15V8l10-4z"/><path d="M12 16h8"/><path d="M16 12v8"/></svg>',
      farmer: '<svg class="coJobGlyph" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 25V8"/><path d="M16 13c-5-5-9-4-11 0 4 4 8 4 11 0z"/><path d="M16 18c5-5 9-4 11 0-4 4-8 4-11 0z"/><path d="M8 26h16"/></svg>',
      miner: '<svg class="coJobGlyph" viewBox="0 0 32 32" aria-hidden="true"><path d="M7 24l10-10"/><path d="M14 7c5 0 9 4 11 9"/><path d="M13 8l11 11"/><path d="M5 25l3 3"/></svg>',
      technician: '<svg class="coJobGlyph" viewBox="0 0 32 32" aria-hidden="true"><path d="M18 3L8 17h8l-2 12 10-15h-8l2-11z"/><path d="M7 25h6M20 7h5"/></svg>',
      clerk: '<svg class="coJobGlyph" viewBox="0 0 32 32" aria-hidden="true"><path d="M9 5h14v22H9z"/><path d="M12 11h8M12 16h8M12 21h5"/><path d="M22 5l3 3"/></svg>',
      criminal: '<svg class="coJobGlyph" viewBox="0 0 32 32" aria-hidden="true"><path d="M8 14V9c0-5 16-5 16 0v5"/><path d="M7 14h18l-2 13H9L7 14z"/><path d="M13 20h6"/><path d="M16 17v6"/></svg>',
      unemployed: '<svg class="coJobGlyph" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="11" r="5"/><path d="M7 27c1-6 5-9 9-9s8 3 9 9"/><path d="M10 5l12 22"/></svg>',
    };
    return icons[job];
  }

  private getPopGroupPlaceholderImage(group: PopGroup, index: number): string {
    const palettes = [
      ["#7bc8ff", "#123448", "#d9f2ff"],
      ["#7cffc3", "#123d32", "#d9fff0"],
      ["#ffd36d", "#443516", "#fff2c7"],
      ["#ff8e95", "#421b22", "#ffe0e3"],
    ];
    const palette = palettes[index % palettes.length];
    const initial = group.speciesName
      .trim()
      .charAt(0)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "") || "H";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette[0]}"/><stop offset="1" stop-color="${palette[1]}"/></linearGradient></defs><rect width="96" height="96" rx="8" fill="url(#bg)"/><circle cx="48" cy="34" r="18" fill="${palette[2]}" opacity=".82"/><path d="M18 86c5-22 16-33 30-33s25 11 30 33" fill="${palette[2]}" opacity=".68"/><text x="48" y="43" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="${palette[1]}">${initial}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  private withQueuedDistrict(planetState: PlanetState, districtKind: DistrictKind): PlanetState {
    return {
      ...planetState,
      constructionQueue: [
        ...planetState.constructionQueue,
        createDistrictConstructionQueueItem(districtKind),
      ],
    };
  }

  private withQueuedBuilding(
    planetState: PlanetState,
    target: { area: BuildingSlotArea; slotIndex: number; subDistrictIndex?: number },
    buildingKind: BuildingKind,
  ): PlanetState {
    return {
      ...planetState,
      constructionQueue: [
        ...planetState.constructionQueue,
        createBuildingConstructionQueueItem(
          buildingKind,
          target.area,
          target.slotIndex,
          target.subDistrictIndex,
        ),
      ],
    };
  }

  private withQueuedBuildingUpgrade(
    planetState: PlanetState,
    target: { area: BuildingSlotArea; slotIndex: number; subDistrictIndex?: number },
    buildingKind: BuildingKind,
    currentLevel: number,
  ): PlanetState {
    return {
      ...planetState,
      constructionQueue: [
        ...planetState.constructionQueue,
        createBuildingUpgradeConstructionQueueItem(
          buildingKind,
          currentLevel,
          target.area,
          target.slotIndex,
          target.subDistrictIndex,
        ),
      ],
    };
  }

  private withChangedSubDistrict(
    planetState: PlanetState,
    subDistrictIndex: number,
    subDistrictKind: UrbanSubDistrictKind,
  ): PlanetState {
    if (!Number.isInteger(subDistrictIndex) || !planetState.urbanSubDistricts[subDistrictIndex]) return planetState;
    const urbanSubDistricts = planetState.urbanSubDistricts.map((subDistrict, index) => {
      if (index !== subDistrictIndex) return subDistrict;
      return {
        kind: subDistrictKind,
        buildings: subDistrict.buildings.map((building) => {
          const buildingKind = getPlanetBuildingKind(building);
          return buildingKind && isBuildingCompatible(buildingKind, "urbanSubDistrict", subDistrictKind) ? building : null;
        }),
      };
    });

    return {
      ...planetState,
      urbanSubDistricts,
      constructionQueue: filterInvalidQueuedBuildingsForSubDistrictChange(
        planetState,
        subDistrictIndex,
        subDistrictKind,
      ),
    };
  }

  private openBuildingPicker(
    data: CelestialObjectPanelData,
    slot: { area: BuildingSlotArea; slotIndex: number; subDistrictIndex?: number },
  ): void {
    if (!data.planetState || !Number.isInteger(slot.slotIndex)) return;
    this.buildingPickerTarget = this.resolveBuildingPickerTarget(data, slot);
    this.activeTab = "surface";
    if (this.panelElement && this.panelElement.querySelector('[data-co-body="surface"]')) {
      this.currentData = data;
      this.patchBuildingSlotContainers(data);
      this.patchSurfaceSidePanel(data);
      return;
    }
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
    const addDistrictSlots = (area: Exclude<DistrictKind, never>, buildings: PlanetBuildingSlot[]): void => {
      buildings.forEach((building, slotIndex) => {
        if (!building && !this.getQueuedBuildingForSlot(planetState, area, slotIndex)) slots.push({ area, slotIndex });
      });
    };

    addDistrictSlots("city", planetState.buildings.city);
    planetState.urbanSubDistricts.forEach((subDistrict, subDistrictIndex) => {
      subDistrict.buildings.forEach((building, slotIndex) => {
        if (!building && !this.getQueuedBuildingForSlot(planetState, "urbanSubDistrict", slotIndex, subDistrictIndex)) {
          slots.push({ area: "urbanSubDistrict", slotIndex, subDistrictIndex });
        }
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
      return planetState.urbanSubDistricts[target.subDistrictIndex]?.buildings[target.slotIndex] === null
        && !this.getQueuedBuildingForSlot(planetState, target.area, target.slotIndex, target.subDistrictIndex);
    }
    return planetState.buildings[target.area]?.[target.slotIndex] === null
      && !this.getQueuedBuildingForSlot(planetState, target.area, target.slotIndex);
  }

  private getBuildingSlot(
    planetState: PlanetState,
    area: BuildingSlotArea,
    slotIndex: number,
    subDistrictIndex?: number,
  ): PlanetBuildingSlot | undefined {
    if (!Number.isInteger(slotIndex)) return undefined;
    if (area === "urbanSubDistrict") {
      if (subDistrictIndex === undefined || !Number.isInteger(subDistrictIndex)) return undefined;
      return planetState.urbanSubDistricts[subDistrictIndex]?.buildings[slotIndex];
    }
    return planetState.buildings[area]?.[slotIndex];
  }

  private getQueuedDistrictCount(planetState: PlanetState, districtKind: DistrictKind): number {
    return planetState.constructionQueue.filter((item) => item.kind === "district" && item.districtKind === districtKind).length;
  }

  private getQueuedBuildingForSlot(
    planetState: PlanetState,
    area: BuildingSlotArea,
    slotIndex: number,
    subDistrictIndex?: number,
  ): PlanetConstructionQueueItem | undefined {
    return planetState.constructionQueue.find((item) => (
      (item.kind === "building" || item.kind === "buildingUpgrade")
      && item.area === area
      && item.slotIndex === slotIndex
      && item.subDistrictIndex === subDistrictIndex
    ));
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

  private isBuildingUnlocked(technology: FactionTechnologyView | null | undefined, building: BuildingKind): boolean {
    const requiredTechIds = getRequiredTechIdsForBuilding(building);
    if (requiredTechIds.length === 0) return true;
    return requiredTechIds.some((techId) => this.isTechnologyCompleted(technology, techId));
  }

  private isBuildingLevelUnlocked(
    technology: FactionTechnologyView | null | undefined,
    building: BuildingKind,
    level: number,
  ): boolean {
    const requiredTechIds = getRequiredTechIdsForBuildingLevel(building, level);
    if (requiredTechIds.length === 0) return true;
    return requiredTechIds.some((techId) => this.isTechnologyCompleted(technology, techId));
  }

  private isTechnologyCompleted(technology: FactionTechnologyView | null | undefined, techId: TechId): boolean {
    return technology?.completedTechIds.includes(techId) === true;
  }

  private getRequiredBuildingTechnologyName(building: BuildingKind): string {
    return getFirstRequiredTechName(getRequiredTechIdsForBuilding(building));
  }

  private getRequiredBuildingLevelTechnologyName(building: BuildingKind, level: number): string {
    return getFirstRequiredTechName(getRequiredTechIdsForBuildingLevel(building, level));
  }

  private openSubDistrictPicker(button: HTMLButtonElement, data: CelestialObjectPanelData, subDistrictIndex: number): void {
    if (!this.panelElement || !data.planetState || Number.isNaN(subDistrictIndex)) return;
    this.panelElement.querySelector(".coPicker")?.remove();
    const picker = document.createElement("div");
    picker.className = "coPicker";
    picker.innerHTML = URBAN_SUB_DISTRICT_KINDS
      .map((kind) => `<button type="button" data-co-tooltip="${this.tooltipAttr(this.renderSubDistrictTooltip(kind, data.planetState!))}" data-co-pick-sub="${kind}">${this.escapeHtml(URBAN_SUB_DISTRICT_LABELS[kind])}</button>`)
      .join("");
    this.positionPicker(button, picker);
    this.panelElement.appendChild(picker);
    this.bindTooltips();
    picker.querySelectorAll<HTMLButtonElement>("[data-co-pick-sub]").forEach((choice) => {
      choice.addEventListener("click", () => {
        const kind = choice.dataset.coPickSub as UrbanSubDistrictKind | undefined;
        this.handlePickSubDistrict(data, subDistrictIndex, kind, picker);
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

  private describeModifier(target: PlanetModifierTarget, value: number): string {
    if (target === "habitability:human") return `${value >= 0 ? "+" : ""}${value}% Human Habitability`;
    const label = target.replace(/:/g, " ");
    return `${value >= 0 ? "+" : ""}${value} ${label}`;
  }

  private tooltipAttr(value: string): string {
    return this.escapeHtml(value);
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
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  min-height: 216px;
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
  color: rgba(236, 248, 244, 0.9);
  font: inherit;
  text-align: left;
  cursor: default;
  z-index: 1;
}

.coLeaderCard.assignable {
  cursor: pointer;
}

.coLeaderCard.assignable:hover {
  border-color: rgba(130, 255, 218, 0.72);
  box-shadow: 0 0 16px rgba(92, 221, 184, 0.2);
}

.coLeaderCard:disabled {
  opacity: 1;
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
  background-size: cover;
  background-position: center;
  border: 1px solid rgba(179, 255, 229, 0.42);
  display: grid;
  place-items: center;
  color: rgba(230, 255, 246, 0.9);
  font-size: 13px;
  font-weight: 900;
}

.coLeaderPortrait i {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid rgba(179, 255, 229, 0.56);
  color: rgba(179, 255, 229, 0.95);
  font-style: normal;
  font-size: 15px;
  line-height: 1;
}

.coSummary {
  position: relative;
  z-index: 1;
  padding: 16px 116px 58px 16px;
  background:
    linear-gradient(90deg, rgba(4, 12, 16, 0.44), rgba(4, 12, 16, 0.9) 26%, rgba(4, 12, 16, 0.97)),
    radial-gradient(circle at 100% 28%, rgba(76, 167, 214, 0.22), transparent 10rem);
}

.coSummary::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 -84px;
  z-index: -1;
  width: 84px;
  pointer-events: none;
  background: linear-gradient(90deg, rgba(4, 12, 16, 0), rgba(4, 12, 16, 0.46) 52%, rgba(4, 12, 16, 0.9));
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
  gap: 5px;
  font-size: 12px;
}

.coSummaryStat {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  min-height: 17px;
}

.coSummaryStat > span:not(.coStatIcon) {
  color: #d9eee5;
}

.coSummaryStat strong {
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
  position: absolute;
  inset: auto 0 0;
  z-index: 3;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  border-top: 1px solid rgba(148, 255, 226, 0.28);
  background: linear-gradient(90deg, rgba(2, 11, 13, 0.42), rgba(3, 17, 19, 0.7) 35%, rgba(2, 11, 13, 0.58));
  box-shadow: 0 -9px 24px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(7px);
}

.coResourceStripItem {
  min-width: 0;
  display: grid;
  grid-template-columns: 21px minmax(0, 1fr);
  grid-template-rows: auto auto;
  align-items: center;
  gap: 1px 7px;
  min-height: 46px;
  padding: 6px 10px;
  border-right: 1px solid rgba(110, 212, 181, 0.24);
  color: var(--co-tone, rgba(191, 231, 220, 0.88));
}

.coResourceStripItem .coStatIcon {
  grid-row: span 2;
}

.coResourceStripItem small,
.coResourceStripItem strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.coResourceStripItem small {
  color: rgba(203, 231, 224, 0.72);
  font-size: 9px;
  text-transform: uppercase;
}

.coResourceStripItem strong {
  color: currentColor;
  font-size: 12px;
  text-shadow: 0 0 12px rgba(0, 0, 0, 0.48);
}

.coTone-good { --co-tone: #64ff9a; }
.coTone-warn { --co-tone: #ffbb62; }
.coTone-bad { --co-tone: #ff756d; }
.coTone-neutral { --co-tone: #72e2ff; }

.coStatIcon {
  position: relative;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  color: var(--co-tone, #72e2ff);
  filter: drop-shadow(0 0 7px rgba(50, 255, 225, 0.18));
}

.coStatIcon::before,
.coStatIcon::after {
  content: "";
  position: absolute;
  box-sizing: border-box;
}

.coStatIcon-stability::before {
  width: 15px;
  height: 19px;
  background: currentColor;
  clip-path: polygon(50% 0, 88% 15%, 80% 70%, 50% 100%, 20% 70%, 12% 15%);
}

.coStatIcon-population::before,
.coStatIcon-unemployment::before {
  top: 2px;
  left: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 7px 2px 0 currentColor;
}

.coStatIcon-population::after {
  bottom: 3px;
  left: 2px;
  width: 17px;
  height: 9px;
  border-radius: 10px 10px 3px 3px;
  background: currentColor;
  opacity: 0.84;
}

.coStatIcon-unemployment::after {
  right: 1px;
  bottom: 4px;
  width: 16px;
  height: 8px;
  border-bottom: 3px solid currentColor;
}

.coStatIcon-happiness::before {
  inset: 2px;
  border: 2px solid currentColor;
  border-radius: 50%;
}

.coStatIcon-happiness::after {
  top: 7px;
  left: 5px;
  width: 10px;
  height: 7px;
  border-bottom: 2px solid currentColor;
  border-radius: 0 0 9px 9px;
  box-shadow: -3px -4px 0 -1px currentColor, 3px -4px 0 -1px currentColor;
}

.coStatIcon-crime::before {
  width: 19px;
  height: 17px;
  background: currentColor;
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
}

.coStatIcon-crime::after {
  top: 5px;
  left: 9px;
  width: 2px;
  height: 9px;
  background: rgba(2, 12, 15, 0.94);
  box-shadow: 0 11px 0 rgba(2, 12, 15, 0.94);
}

.coStatIcon-housing::before {
  width: 18px;
  height: 17px;
  background: currentColor;
  clip-path: polygon(50% 0, 100% 40%, 86% 40%, 86% 100%, 14% 100%, 14% 40%, 0 40%);
}

.coStatIcon-housing::after {
  right: 7px;
  bottom: 1px;
  width: 4px;
  height: 7px;
  background: rgba(2, 12, 15, 0.94);
}

.coStatIcon-amenities::before {
  width: 14px;
  height: 14px;
  background: currentColor;
  clip-path: polygon(50% 0, 62% 36%, 100% 50%, 62% 64%, 50% 100%, 38% 64%, 0 50%, 38% 36%);
}

.coStatIcon-amenities::after {
  right: 1px;
  top: 2px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.74;
}

.coStatIcon-habitability::before {
  inset: 2px;
  border: 2px solid currentColor;
  border-radius: 50%;
}

.coStatIcon-habitability::after {
  left: 5px;
  top: 4px;
  width: 10px;
  height: 13px;
  border-radius: 10px 0 10px 0;
  background: currentColor;
  transform: rotate(36deg);
}

.coStatIcon-size::before {
  inset: 3px;
  border: 2px solid currentColor;
  border-radius: 50%;
}

.coStatIcon-size::after {
  top: 9px;
  left: 1px;
  width: 18px;
  height: 4px;
  border-top: 2px solid currentColor;
  border-left: 2px solid currentColor;
  border-right: 2px solid currentColor;
}

.coStatIcon-growth::before {
  width: 16px;
  height: 14px;
  border-top: 3px solid currentColor;
  border-right: 3px solid currentColor;
  transform: translate(-2px, 2px) rotate(-45deg);
}

.coStatIcon-growth::after {
  right: 1px;
  top: 1px;
  width: 8px;
  height: 8px;
  background: currentColor;
  clip-path: polygon(100% 0, 100% 100%, 0 0);
}

.coStatIcon-districts::before {
  top: 3px;
  left: 3px;
  width: 6px;
  height: 6px;
  border: 1px solid currentColor;
  background: currentColor;
  box-shadow: 8px 0 0 currentColor, 0 8px 0 currentColor, 8px 8px 0 currentColor;
}

.coStatIcon-food::before {
  width: 13px;
  height: 18px;
  border-radius: 100% 0 100% 0;
  background: currentColor;
  transform: rotate(35deg);
}

.coStatIcon-food::after {
  left: 9px;
  top: 4px;
  width: 2px;
  height: 13px;
  background: rgba(2, 12, 15, 0.56);
  transform: rotate(35deg);
}

.coStatIcon-energy::before {
  width: 14px;
  height: 19px;
  background: currentColor;
  clip-path: polygon(58% 0, 100% 0, 68% 38%, 100% 38%, 28% 100%, 44% 54%, 4% 54%);
}

.coStatIcon-minerals::before {
  width: 17px;
  height: 18px;
  background: currentColor;
  clip-path: polygon(50% 0, 94% 28%, 76% 100%, 24% 100%, 6% 28%);
}

.coStatIcon-minerals::after {
  top: 4px;
  left: 9px;
  width: 2px;
  height: 13px;
  background: rgba(2, 12, 15, 0.46);
}

.coStatIcon-goods::before {
  width: 17px;
  height: 15px;
  border: 2px solid currentColor;
  background: rgba(114, 226, 255, 0.1);
}

.coStatIcon-goods::after {
  top: 3px;
  left: 9px;
  width: 2px;
  height: 15px;
  background: currentColor;
}

.coStatIcon-alloys::before {
  width: 17px;
  height: 5px;
  background: currentColor;
  box-shadow: 0 -6px 0 currentColor, 0 6px 0 currentColor;
  transform: skewX(-18deg);
}

.coStatIcon-research::before {
  width: 18px;
  height: 10px;
  border: 2px solid currentColor;
  border-radius: 50%;
  transform: rotate(38deg);
}

.coStatIcon-research::after {
  width: 18px;
  height: 10px;
  border: 2px solid currentColor;
  border-radius: 50%;
  transform: rotate(-38deg);
}

.coBody {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
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
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
  min-height: 0;
  overflow: hidden;
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
  align-self: stretch;
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
  position: relative;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border: 1px solid rgba(176, 255, 229, 0.48);
  background: linear-gradient(145deg, rgba(80, 110, 120, 0.9), rgba(18, 30, 34, 0.96));
  color: #e9fff8;
  font-weight: 900;
  overflow: hidden;
}

.coDistrictIcon.generator { color: #dbe447; }
.coDistrictIcon.mining { color: #f27761; }
.coDistrictIcon.agriculture { color: #62e865; }

.coDistrictIconArt {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  padding: 2px;
}

.coDistrictFallback {
  position: relative;
  z-index: 1;
}

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

.coProduction {
  min-height: 0;
  padding: 6px;
  border: 1px solid rgba(103, 255, 221, 0.22);
  background: rgba(4, 20, 21, 0.42);
}

.coProduction {
  display: flex;
  flex-direction: column;
  justify-content: start;
}

.coProduction h4 {
  margin: 2px 0 6px;
  text-align: center;
  color: #eefaf6;
}

.coTokenGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  font-size: 11px;
}

.coProductionToken {
  min-width: 0;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: center;
  gap: 1px 5px;
  padding: 3px 4px;
  border: 1px solid rgba(103, 255, 221, 0.14);
  background: rgba(1, 8, 10, 0.34);
}

.coProductionToken .coStatIcon {
  grid-row: span 2;
  width: 16px;
  height: 16px;
}

.coProductionToken > span:not(.coStatIcon),
.coProductionToken strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.coProductionToken > span:not(.coStatIcon) {
  color: rgba(202, 225, 219, 0.72);
  font-size: 9px;
  text-transform: uppercase;
}

.coProductionToken strong {
  font-size: 11px;
}

.coProductionToken.positive {
  --co-tone: #64ff9a;
  color: #64ff9a;
}

.coProductionToken.negative {
  --co-tone: #ff8a77;
  color: #ff8a77;
}

.coEmptyLine {
  display: grid;
  flex: 1 1 auto;
  place-items: center;
  min-height: 26px;
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

.coEmbeddedBuildings > span,
.coEmbeddedBuildings > button {
  aspect-ratio: 1 / 1;
  min-height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(103, 255, 221, 0.58);
  background:
    radial-gradient(circle at 28% 18%, rgba(114, 255, 224, 0.13), transparent 44%),
    linear-gradient(145deg, rgba(12, 53, 49, 0.86), rgba(3, 18, 21, 0.96));
  color: #9dffdf;
  font-weight: 800;
  font-size: 10px;
  text-align: center;
  padding: 2px;
  overflow: hidden;
}

.coBuildingIconSlot {
  position: relative;
  isolation: isolate;
}

button.coBuildingIconSlot {
  appearance: none;
}

.coBuildingIconSlot.upgradeable {
  border-color: rgba(111, 255, 174, 0.9);
  box-shadow: inset 0 0 0 1px rgba(111, 255, 174, 0.22), 0 0 12px rgba(111, 255, 174, 0.15);
}

.coBuildingIconSlot.queuedUpgrade {
  border-color: rgba(248, 218, 103, 0.72);
  box-shadow: inset 0 0 0 1px rgba(248, 218, 103, 0.2);
}

.coBuildingIconArt {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 3px;
  z-index: 0;
}

.coBuildingInitials {
  width: 28px;
  height: 28px;
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  border: 1px solid rgba(226, 255, 244, 0.38);
  background:
    radial-gradient(circle at 30% 20%, rgba(205, 255, 239, 0.22), transparent 48%),
    linear-gradient(145deg, rgba(39, 88, 81, 0.88), rgba(9, 24, 28, 0.94));
  color: #eafff8;
  font-size: 11px;
  letter-spacing: 0.04em;
}

.coBuildingLevel,
.coBuildingUpgradeArrow {
  position: absolute;
  z-index: 2;
  pointer-events: none;
}

.coBuildingLevel {
  left: 2px;
  bottom: 1px;
  padding: 1px 3px;
  border-radius: 2px;
  background: rgba(4, 14, 16, 0.78);
  color: rgba(226, 255, 244, 0.82);
  font-size: 8px;
  line-height: 1.1;
}

.coBuildingUpgradeArrow {
  top: 2px;
  right: 2px;
  width: 15px;
  height: 15px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(111, 255, 174, 0.7);
  border-radius: 50%;
  background: rgba(5, 36, 22, 0.92);
  color: #92ffb7;
  font-size: 11px;
  line-height: 1;
  font-weight: 900;
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
  background:
    radial-gradient(circle at 35% 20%, rgba(142, 255, 225, 0.14), transparent 48%),
    linear-gradient(145deg, rgba(33, 71, 65, 0.92), rgba(6, 25, 28, 0.98));
}

.coEmbeddedBuildings .queued {
  color: #ffe989;
  background:
    radial-gradient(circle at 35% 20%, rgba(255, 235, 128, 0.16), transparent 48%),
    linear-gradient(145deg, rgba(70, 55, 18, 0.88), rgba(16, 20, 18, 0.98));
  border-color: rgba(248, 218, 103, 0.72);
}

.coEmbeddedBuildings .queued small {
  position: absolute;
  right: 2px;
  bottom: 1px;
  z-index: 2;
  display: block;
  color: rgba(255, 237, 169, 0.72);
  font-size: 9px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
}

.coEmbeddedBuildings .filled small[data-co-queued-building-days] {
  right: 2px;
  bottom: 1px;
  left: auto;
  padding: 1px 3px;
  background: rgba(24, 17, 3, 0.82);
  color: rgba(255, 237, 169, 0.84);
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
.coPlanetOverview,
.coFeatureTray {
  align-self: stretch;
  min-height: 0;
  margin: 4px 4px 4px 0;
  overflow: hidden;
  border: 1px solid rgba(96, 196, 164, 0.58);
  background:
    linear-gradient(180deg, rgba(13, 42, 39, 0.92), rgba(5, 13, 15, 0.96)),
    radial-gradient(circle at 50% 0%, rgba(103, 255, 221, 0.16), transparent 12rem);
}

.coPlanetOverview {
  display: flex;
  flex-direction: column;
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

.coBuildTrayHeader button,
.coFeatureTray .coSidePanelHeader button {
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
  grid-template-columns: 54px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  min-height: 64px;
  padding: 7px;
  border: 1px solid rgba(103, 255, 221, 0.36);
  background: rgba(6, 26, 26, 0.62);
  color: #e5fff8;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.coBuildCardIcon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border: 1px solid rgba(226, 255, 244, 0.42);
  background:
    radial-gradient(circle at 30% 20%, rgba(132, 255, 225, 0.18), transparent 48%),
    linear-gradient(145deg, rgba(31, 86, 75, 0.94), rgba(5, 20, 24, 0.98));
  color: #eafff8;
  font-size: 16px;
  font-weight: 900;
}

.coBuildCardCopy {
  min-width: 0;
}

.coBuildCardCopy strong {
  display: block;
  color: #eefaf6;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

.coBuildList .coBuildCardIcon {
  display: grid;
}

.coBuildList .coBuildCardIcon .coBuildingIconArt {
  padding: 5px;
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

.coOverviewStat {
  min-height: 44px;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 1px 6px;
  padding: 6px;
  border: 1px solid rgba(103, 255, 221, 0.28);
  background: rgba(6, 26, 26, 0.52);
  color: var(--co-tone, #72e2ff);
}

.coOverviewStat .coStatIcon {
  grid-row: span 2;
  width: 18px;
  height: 18px;
}

.coOverviewStat > span:not(.coStatIcon),
.coOverviewStat strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.coOverviewStat > span:not(.coStatIcon) {
  color: rgba(202, 225, 219, 0.68);
  font-size: 10px;
}

.coOverviewStat strong {
  margin-top: 3px;
  color: currentColor;
  font-size: 12px;
}

.coOverviewActions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  padding: 0 7px 7px;
}

.coQueuePanel {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  margin: 0 7px 7px;
  border: 1px solid rgba(103, 255, 221, 0.28);
  background: rgba(5, 20, 20, 0.58);
}

.coQueueHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px;
  border-bottom: 1px solid rgba(103, 255, 221, 0.22);
}

.coQueueHeader strong {
  color: #eefaf6;
}

.coQueueHeader span {
  color: rgba(202, 225, 219, 0.68);
  font-size: 10px;
}

.coQueueList {
  flex: 1 1 auto;
  align-content: start;
  display: grid;
  gap: 5px;
  min-height: 0;
  max-height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  scrollbar-width: thin;
}

.coQueueList::-webkit-scrollbar {
  width: 6px;
}

.coQueueList::-webkit-scrollbar-thumb {
  background: rgba(103, 255, 221, 0.34);
  border-radius: 999px;
}

.coQueueItem,
.coQueueEmpty {
  min-height: 38px;
  padding: 5px;
  border: 1px solid rgba(103, 255, 221, 0.26);
  background: rgba(6, 26, 26, 0.62);
}

.coQueueItem {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 5px 8px;
  padding-right: 32px;
}

.coQueueCancel {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 117, 117, 0.62);
  background: rgba(66, 12, 20, 0.82);
  color: #ffb8b8;
  font: inherit;
  font-size: 10px;
  font-weight: 900;
  line-height: 1;
  cursor: pointer;
}

.coQueueCancel:hover {
  border-color: rgba(255, 151, 151, 0.92);
  background: rgba(116, 20, 34, 0.94);
  color: #ffe2e2;
}

.coQueueItemMain,
.coQueueItem strong,
.coQueueItem span,
.coQueueItem small {
  display: block;
  min-width: 0;
}

.coQueueItem strong {
  color: #ffe989;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.coQueueItem span,
.coQueueItem small,
.coQueueEmpty {
  color: rgba(202, 225, 219, 0.68);
  font-size: 10px;
}

.coQueueItem small {
  justify-self: end;
  max-width: 92px;
  padding-top: 1px;
  color: rgba(232, 246, 241, 0.78);
  text-align: right;
  white-space: nowrap;
}

.coQueueProgress {
  grid-column: 1 / -1;
  height: 4px;
  overflow: hidden;
  border: 1px solid rgba(248, 218, 103, 0.34);
  background: rgba(39, 31, 10, 0.76);
}

.coQueueProgress span {
  display: block;
  height: 100%;
  background: rgba(248, 218, 103, 0.82);
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

.coFeatureList {
  display: grid;
  gap: 7px;
  padding: 7px;
  max-height: 506px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.coFeatureList::-webkit-scrollbar {
  width: 6px;
}

.coFeatureList::-webkit-scrollbar-thumb {
  background: rgba(103, 255, 221, 0.34);
  border-radius: 999px;
}

.coFeatureCard,
.coFeatureEmpty {
  border: 1px solid rgba(103, 255, 221, 0.3);
  background: rgba(6, 26, 26, 0.62);
  padding: 8px;
}

.coFeatureCard strong {
  display: block;
  color: #eafff8;
  margin-bottom: 5px;
}

.coFeatureCard p,
.coFeatureEmpty {
  margin: 0;
  color: rgba(202, 225, 219, 0.72);
  font-size: 11px;
  line-height: 1.35;
}

.coFeatureModifiers {
  display: grid;
  gap: 4px;
  margin-top: 8px;
}

.coFeatureModifiers span {
  padding: 4px 6px;
  border: 1px solid rgba(248, 218, 103, 0.34);
  background: rgba(47, 38, 12, 0.58);
  color: #ffe989;
  font-size: 10px;
}

.coJobsPanel,
.coDemographicsPanel {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(76, 158, 133, 0.46);
  background: rgba(8, 20, 19, 0.74);
}

.coJobClassList {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 6px;
  padding: 6px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.coJobClassList::-webkit-scrollbar,
.coPopGroupList::-webkit-scrollbar {
  width: 6px;
}

.coJobClassList::-webkit-scrollbar-thumb,
.coPopGroupList::-webkit-scrollbar-thumb {
  background: rgba(103, 255, 221, 0.34);
  border-radius: 999px;
}

.coJobClass {
  border: 1px solid rgba(96, 196, 164, 0.36);
  background: rgba(10, 28, 27, 0.66);
}

.coJobClassTitle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 8px;
  border: 0;
  border-bottom: 1px solid rgba(103, 255, 221, 0.2);
  color: #eefaf6;
  background: rgba(30, 62, 55, 0.74);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.coJobClassTitle:hover {
  background: rgba(42, 82, 73, 0.86);
}

.coJobClassLabel {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-weight: 700;
}

.coJobClassLabel i {
  width: 0;
  height: 0;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 7px solid rgba(151, 249, 222, 0.84);
  transition: transform 0.16s ease;
}

.coJobClass.expanded .coJobClassLabel i {
  transform: rotate(90deg);
}

.coJobClassTotals {
  display: inline-grid;
  justify-items: end;
  gap: 1px;
  color: #eefaf6;
}

.coJobClassTotals strong {
  font-size: 15px;
}

.coJobClassTotals small {
  color: rgba(202, 225, 219, 0.62);
  font-size: 9px;
}

.coJobIconRail {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(44px, 1fr));
  gap: 4px;
  padding: 5px;
}

.coJobRows {
  display: grid;
  grid-template-columns: 1fr;
  gap: 5px;
  padding: 5px;
  border-top: 1px solid rgba(103, 255, 221, 0.18);
}

.coJobMini {
  min-width: 0;
  min-height: 42px;
  display: grid;
  grid-template-rows: 22px 1fr;
  justify-items: center;
  align-items: center;
  gap: 1px;
  padding: 4px 2px;
  border: 1px solid rgba(103, 255, 221, 0.28);
  background: rgba(4, 18, 20, 0.68);
  color: rgba(217, 248, 240, 0.82);
  font: inherit;
  cursor: pointer;
}

.coJobMini:hover,
.coJobMini.selected {
  border-color: rgba(248, 218, 103, 0.82);
  background: rgba(67, 54, 18, 0.5);
}

.coJobMini span {
  max-width: 100%;
  color: #9cffcc;
  font-size: 9px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.coJobRow {
  min-width: 0;
  display: grid;
  grid-template-columns: 36px minmax(120px, 1fr) 74px minmax(168px, 1.1fr);
  align-items: center;
  gap: 8px;
  min-height: 58px;
  padding: 6px;
  border: 1px solid rgba(103, 255, 221, 0.36);
  background: rgba(6, 26, 26, 0.62);
  color: #dff7ef;
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}

.coJobRow:hover,
.coJobRow.selected {
  border-color: rgba(248, 218, 103, 0.82);
  background: rgba(67, 54, 18, 0.54);
}

.coJobIcon,
.coSelectedJobIcon {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(103, 255, 221, 0.26);
  background: rgba(4, 16, 18, 0.72);
  color: #8fffe1;
}

.coJobGlyph {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.coJobMini .coJobGlyph {
  width: 20px;
  height: 20px;
}

.coJobMain,
.coJobNumbers {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.coJobMain strong,
.coJobNumbers strong {
  color: #9cffcc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.coJobMain small,
.coJobNumbers small {
  color: rgba(208, 231, 225, 0.62);
  font-size: 9px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.coJobNumbers {
  justify-items: end;
  text-align: right;
}

.coJobRecipe {
  min-width: 0;
  display: block;
}

.coFlowLine {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
}

.coFlowPrefix,
.coFlowNone,
.coFlowEmpty {
  color: rgba(202, 225, 219, 0.64);
  font-size: 9px;
}

.coFlowArrow {
  color: rgba(151, 249, 222, 0.78);
  font-size: 11px;
  font-weight: 800;
}

.coFlowChip {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 112px;
  padding: 2px 4px;
  border: 1px solid rgba(103, 255, 221, 0.22);
  background: rgba(5, 18, 20, 0.7);
  color: rgba(225, 244, 239, 0.84);
  font-size: 9px;
}

.coFlowChip.input {
  border-color: rgba(255, 125, 125, 0.32);
  color: #ffb6b6;
}

.coFlowChip.output {
  border-color: rgba(126, 255, 193, 0.36);
  color: #9cffcc;
}

.coFlowChip.effect {
  border-color: rgba(116, 215, 255, 0.34);
  color: #9be6ff;
}

.coFlowChip .coStatIcon {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
}

.coFlowChip strong,
.coFlowChip small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.coFlowChip small {
  color: currentColor;
  opacity: 0.7;
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

.coGrowthGrid small {
  display: block;
  margin-top: 3px;
  color: rgba(198, 218, 213, 0.62);
  font-size: 9px;
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
  flex: 1 1 auto;
  margin: 8px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.coSelectedJobHeader {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.coSelectedJob h4 {
  margin: 0;
  color: #eefaf6;
}

.coSelectedJob p {
  margin: 3px 0 0;
  color: rgba(202, 225, 219, 0.68);
  font-size: 10px;
}

.coSelectedJobRecipe {
  margin-top: 7px;
  padding: 5px;
  border: 1px solid rgba(103, 255, 221, 0.22);
  background: rgba(6, 26, 26, 0.52);
}

.coPopGroupList {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 6px;
  margin-top: 7px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.coPopGroupCard {
  min-width: 0;
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 7px;
  padding: 6px;
  border: 1px solid rgba(103, 255, 221, 0.24);
  background: rgba(6, 26, 26, 0.5);
}

.coPopPortrait {
  width: 52px;
  height: 52px;
  object-fit: cover;
  border: 1px solid rgba(151, 249, 222, 0.34);
  background: rgba(4, 16, 18, 0.9);
}

.coPopGroupMain,
.coPopGroupTitle {
  min-width: 0;
}

.coPopGroupTitle {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.coPopGroupTitle strong,
.coPopStats strong {
  color: #9cffcc;
}

.coPopGroupTitle span {
  color: rgba(202, 225, 219, 0.62);
  font-size: 9px;
}

.coPopStats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  margin-top: 5px;
}

.coPopStats span {
  min-width: 0;
  color: rgba(202, 225, 219, 0.68);
  font-size: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.coPopGroupFlow {
  margin-top: 5px;
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

.coTooltip {
  position: fixed;
  z-index: 9999;
  max-height: min(440px, calc(100vh - 24px));
  overflow-y: auto;
  opacity: 0;
  pointer-events: auto;
  padding: 10px;
  border: 1px solid rgba(135, 255, 225, 0.78);
  background:
    linear-gradient(180deg, rgba(8, 31, 29, 0.98), rgba(3, 11, 13, 0.98)),
    radial-gradient(circle at 20% 0%, rgba(103, 255, 221, 0.14), transparent 12rem);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(204, 255, 239, 0.08);
  color: #e8fff7;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
  font-size: 11px;
  line-height: 1.35;
}

[data-co-tooltip] {
  cursor: help;
}

.coTooltipAction {
  width: 100%;
  margin: 6px 0 2px;
  padding: 5px 8px;
  border: 1px solid rgba(111, 255, 174, 0.5);
  border-radius: 4px;
  background: rgba(12, 57, 38, 0.86);
  color: #dcffea;
  font: inherit;
  font-size: 11px;
  font-weight: 800;
}

.coTooltipAction:disabled {
  border-color: rgba(157, 177, 170, 0.26);
  background: rgba(32, 39, 39, 0.74);
  color: rgba(212, 228, 222, 0.62);
}

.coTooltip.visible {
  opacity: 1;
}

.coTooltip.sticky {
  border-color: rgba(248, 218, 103, 0.9);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55), 0 0 18px rgba(248, 218, 103, 0.16);
}

.coTooltipTitle {
  color: #eafff8;
  font-size: 14px;
  font-weight: 900;
  margin-bottom: 6px;
}

.coTooltip p {
  margin: 0 0 8px;
  color: rgba(211, 235, 229, 0.78);
}

.coTooltipGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  margin: 8px 0;
}

.coTooltipGrid div,
.coTooltipList span {
  padding: 5px;
  border: 1px solid rgba(103, 255, 221, 0.26);
  background: rgba(6, 26, 26, 0.58);
}

.coTooltipGrid span,
.coTooltipGrid strong {
  display: block;
}

.coTooltipGrid span,
.coTooltipSectionTitle {
  color: rgba(202, 225, 219, 0.68);
  font-size: 10px;
}

.coTooltipGrid strong {
  margin-top: 3px;
  color: #ffe989;
}

.coTooltipList span.coTooltipListRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.coTooltipListRow em {
  min-width: 0;
  color: rgba(211, 235, 229, 0.78);
  font-style: normal;
  overflow: hidden;
  text-overflow: ellipsis;
}

.coTooltipDrill {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  max-width: 100%;
  min-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: #ffe989;
  font: inherit;
  font-weight: 900;
  line-height: 1.25;
  text-align: right;
  cursor: help;
}

.coTooltipDrill:hover,
.coTooltipDrill:focus-visible {
  color: #ffffff;
  text-decoration: underline;
  outline: none;
}

.coTooltipSectionTitle {
  margin: 9px 0 4px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.coTooltipList {
  display: grid;
  gap: 4px;
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
