import type { CelestialObjectDetails, DistrictCounts, DistrictKind, PlanetType, StarType } from "../data/StarMap";
import {
  BUILDING_KINDS,
  BUILDING_BUILD_DAYS,
  BUILDING_DEFINITIONS,
  BUILDING_LABELS,
  BUILDING_MINERAL_COSTS,
  DISTRICT_BUILD_DAYS,
  DISTRICT_MINERAL_COSTS,
  getCompatibleBuildings,
  getEffectiveSpeciesHabitability,
  getHabitabilityProductionMultiplier,
  getHabitabilityUpkeepMultiplier,
  JOB_FILL_ORDER,
  JOB_DEFINITIONS,
  JOB_LABELS,
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
  PlanetModifierTarget,
  PlanetState,
  ResourceKind,
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
  orbitFleetId?: string | null;
}

const STYLE_ID = "celestial-object-panel-style";
const PLANET_BANNER_DIR = "/textures/planet-banners";
const BUILDING_ICON_DIR = "/textures/buildings";
const DISTRICT_ICON_DIR = "/textures/districts";

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
  city: `${DISTRICT_ICON_DIR}/City.png`,
  generator: `${DISTRICT_ICON_DIR}/Generator.png`,
  mining: `${DISTRICT_ICON_DIR}/Mining.png`,
  agriculture: `${DISTRICT_ICON_DIR}/Agriculture.png`,
};

const BUILDING_ICON_BY_KIND: Record<BuildingKind, string> = {
  housingComplex: `${BUILDING_ICON_DIR}/Housing_Complex.png`,
  administrativeComplex: `${BUILDING_ICON_DIR}/Administrative_Complex.png`,
  researchLabs: `${BUILDING_ICON_DIR}/Research_Labs.png`,
  civilianFabricators: `${BUILDING_ICON_DIR}/Civilian_Fabricators.png`,
  alloyFoundries: `${BUILDING_ICON_DIR}/Alloy_Foundries.png`,
  commercialForum: `${BUILDING_ICON_DIR}/Commercial_Forum.png`,
  foodProcessingPlant: `${BUILDING_ICON_DIR}/Food_Processing_Plant.png`,
  agroIndustrialKitchens: `${BUILDING_ICON_DIR}/Agro-Industrial_Kitchens.png`,
  mineralPurificationPlant: `${BUILDING_ICON_DIR}/Mineral_Purification_Plant.png`,
  oreSmelter: `${BUILDING_ICON_DIR}/Ore_Smelter.png`,
  energyGrid: `${BUILDING_ICON_DIR}/Energy_Grid.png`,
  capacitorWorkshops: `${BUILDING_ICON_DIR}/Capacitor_Workshops.png`,
  entertainmentForum: `${BUILDING_ICON_DIR}/Entertainment_Forum.png`,
  securityOffice: `${BUILDING_ICON_DIR}/Security_Office.png`,
};

const HABITED_PLANET_BANNERS: Partial<Record<PlanetType, string>> = {
  Barren: `${PLANET_BANNER_DIR}/Barren_banner.png`,
  Gaseous: `${PLANET_BANNER_DIR}/Gaseous_banner.png`,
  Snowy: `${PLANET_BANNER_DIR}/Snowy_banner_city.png`,
  Arid: `${PLANET_BANNER_DIR}/Arid_banner_city.png`,
  Dusty: `${PLANET_BANNER_DIR}/Dusty_banner_city.png`,
  Grassland: `${PLANET_BANNER_DIR}/Grassland_banner_city.png`,
  Jungle: `${PLANET_BANNER_DIR}/Jungle_banner_city.png`,
  Marshy: `${PLANET_BANNER_DIR}/Marsh_banner_city.png`,
  Martian: `${PLANET_BANNER_DIR}/Martian_banner_city.png`,
  Methane: `${PLANET_BANNER_DIR}/Methane_banner_city.png`,
  Sandy: `${PLANET_BANNER_DIR}/Sandy_banner_city.png`,
  Tundra: `${PLANET_BANNER_DIR}/Tundra_banner_city.png`,
};

const PLANET_NO_CITY_BANNERS: Record<PlanetType, string> = {
  Barren: `${PLANET_BANNER_DIR}/Barren_banner.png`,
  Gaseous: `${PLANET_BANNER_DIR}/Gaseous_banner.png`,
  Snowy: `${PLANET_BANNER_DIR}/Snowy_banner.png`,
  Arid: `${PLANET_BANNER_DIR}/Arid_banner.png`,
  Dusty: `${PLANET_BANNER_DIR}/Dusty_banner.png`,
  Grassland: `${PLANET_BANNER_DIR}/Grassland_banner.png`,
  Jungle: `${PLANET_BANNER_DIR}/Jungle_banner.png`,
  Marshy: `${PLANET_BANNER_DIR}/Marsh_banner.png`,
  Martian: `${PLANET_BANNER_DIR}/Martian_banner.png`,
  Methane: `${PLANET_BANNER_DIR}/Methane_banner.png`,
  Sandy: `${PLANET_BANNER_DIR}/Sandy_banner.png`,
  Tundra: `${PLANET_BANNER_DIR}/Tundra_banner.png`,
};

const STAR_BANNER_DIR = PLANET_BANNER_DIR;

const STAR_BANNERS: Record<StarType, string> = {
  B: `${STAR_BANNER_DIR}/Star_B_banner.png`,
  A: `${STAR_BANNER_DIR}/Star_A_banner.png`,
  F: `${STAR_BANNER_DIR}/Star_F_banner.png`,
  G: `${STAR_BANNER_DIR}/Star_G_banner.png`,
  K: `${STAR_BANNER_DIR}/Star_K_banner.png`,
  M: `${STAR_BANNER_DIR}/Star_M_banner.png`,
  ["M Red Giant"]: `${STAR_BANNER_DIR}/Star_M_Red_Giant_banner.png`,
  ["T Brown Dwarf"]: `${STAR_BANNER_DIR}/Star_T_Brown_Dwarf_banner.png`,
  ["Neutron Star"]: `${STAR_BANNER_DIR}/Star_Neutron_Star_banner.png`,
  Pulsar: `${STAR_BANNER_DIR}/Star_Pulsar_banner.png`,
  ["Black Hole"]: `${STAR_BANNER_DIR}/Star_Black_Hole_banner.png`,
};

export class CelestialObjectPanel {
  private root: HTMLDivElement;
  private panelElement: HTMLDivElement | null = null;
  private currentData: CelestialObjectPanelData | null = null;
  private activeTab: "surface" | "economy" = "surface";
  private selectedJob: JobKind | null = null;
  private buildingPickerTarget: { area: BuildingSlotArea; slotIndex: number; subDistrictIndex?: number } | null = null;
  private featureTrayOpen = false;
  private tooltipElement: HTMLDivElement | null = null;
  private tooltipAnchor: HTMLElement | null = null;
  private tooltipShowTimer: number | null = null;
  private tooltipStickTimer: number | null = null;
  private tooltipHideTimer: number | null = null;
  private tooltipSticky = false;
  private readonly keyedBuildingIconCache = new Map<string, string>();
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
    const spaced = `${BUILDING_ICON_DIR}/${definition.label}.png`;
    const underscored = `${BUILDING_ICON_DIR}/${definition.label.replace(/\s+/g, "_")}.png`;
    const kindName = `${BUILDING_ICON_DIR}/${definition.kind}.png`;
    const spellingFallback = definition.kind === "entertainmentForum"
      ? `${BUILDING_ICON_DIR}/Entretainment_Forum.png`
      : "";
    return Array.from(new Set([mapped, spaced, underscored, spellingFallback, kindName].filter(Boolean).map((path) => encodeURI(path))));
  }

  private getBuildingIconCandidateAttribute(definition: BuildingDefinition): string {
    return this.getBuildingIconCandidates(definition).join("|");
  }

  private getDistrictIconCandidates(kind: DistrictKind): string[] {
    const label = DISTRICT_LABELS[kind];
    const mapped = DISTRICT_ICON_BY_KIND[kind];
    const spaced = `${DISTRICT_ICON_DIR}/${label}.png`;
    const underscored = `${DISTRICT_ICON_DIR}/${label.replace(/\s+/g, "_")}.png`;
    const kindName = `${DISTRICT_ICON_DIR}/${kind}.png`;
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
    if (this.currentData?.objectId !== data.objectId) {
      this.activeTab = "surface";
      this.selectedJob = null;
      this.buildingPickerTarget = null;
      this.featureTrayOpen = false;
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

    this.hideTooltip();
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
    this.hideTooltip();
    this.panelElement?.remove();
    this.panelElement = null;
    this.currentData = null;
    this.selectedJob = null;
    this.buildingPickerTarget = null;
    this.featureTrayOpen = false;
    this.activeTab = "surface";
    this.onPointerUp();
  }

  public dispose(): void {
    this.hideTooltip();
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

    this.panelElement.querySelectorAll<HTMLImageElement>("[data-building-icon]").forEach((image) => {
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

    this.panelElement.querySelectorAll<HTMLImageElement>("[data-district-icon]").forEach((image) => {
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

    const openFeatures = this.panelElement.querySelector<HTMLButtonElement>("[data-co-open-features]");
    openFeatures?.addEventListener("click", () => {
      this.featureTrayOpen = true;
      this.buildingPickerTarget = null;
      this.show(data);
    });

    this.panelElement.querySelector<HTMLButtonElement>("[data-co-orbit-planet]")?.addEventListener("click", () => {
      if (!data.orbitFleetId || data.kind !== "planet") return;
      data.onPlanetCommand?.({ type: "orbitPlanet", fleetId: data.orbitFleetId, planetId: data.objectId });
    });

    const closeFeatures = this.panelElement.querySelector<HTMLButtonElement>("[data-co-close-features]");
    closeFeatures?.addEventListener("click", () => {
      this.featureTrayOpen = false;
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

    this.bindTooltips();
  }

  private applyPosition(): void {
    if (!this.panelElement) return;
    this.panelElement.style.left = `${this.position.x}px`;
    this.panelElement.style.top = `${this.position.y}px`;
  }

  private bindTooltips(): void {
    if (!this.panelElement) return;
    this.panelElement.querySelectorAll<HTMLElement>("[data-co-tooltip]").forEach((anchor) => {
      anchor.addEventListener("pointerenter", () => this.scheduleTooltip(anchor));
      anchor.addEventListener("pointerleave", () => this.scheduleTooltipHide());
      anchor.addEventListener("focus", () => this.scheduleTooltip(anchor));
      anchor.addEventListener("blur", () => this.scheduleTooltipHide());
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

  private scheduleTooltip(anchor: HTMLElement): void {
    this.clearTooltipTimers();
    this.tooltipAnchor = anchor;
    this.tooltipSticky = false;
    this.tooltipShowTimer = window.setTimeout(() => {
      this.showTooltip(anchor);
    }, 180);
    this.tooltipStickTimer = window.setTimeout(() => {
      if (this.tooltipAnchor !== anchor) return;
      this.tooltipSticky = true;
      this.tooltipElement?.classList.add("sticky");
    }, 850);
  }

  private scheduleTooltipHide(): void {
    this.clearTooltipTimers();
    this.tooltipHideTimer = window.setTimeout(() => {
      const hoveringAnchor = Boolean(this.tooltipAnchor?.matches(":hover"));
      const hoveringTooltip = Boolean(this.tooltipElement?.matches(":hover"));
      if (hoveringAnchor || hoveringTooltip) {
        this.scheduleTooltipHide();
        return;
      }
      this.hideTooltip();
    }, this.tooltipSticky ? 120 : 60);
  }

  private showTooltip(anchor: HTMLElement): void {
    const content = anchor.dataset.coTooltip;
    if (!content) return;
    if (!this.tooltipElement) {
      this.tooltipElement = document.createElement("div");
      this.tooltipElement.className = "coTooltip";
      document.body.appendChild(this.tooltipElement);
      this.tooltipElement.addEventListener("pointerleave", () => this.scheduleTooltipHide());
      this.tooltipElement.addEventListener("pointerenter", () => {
        if (this.tooltipHideTimer !== null) window.clearTimeout(this.tooltipHideTimer);
      });
    }
    this.tooltipElement.innerHTML = content;
    this.tooltipElement.classList.toggle("sticky", this.tooltipSticky);
    const rect = anchor.getBoundingClientRect();
    const width = 320;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right + 12));
    const fallbackLeft = Math.max(8, rect.left - width - 12);
    this.tooltipElement.style.width = `${width}px`;
    this.tooltipElement.style.left = `${left + width > window.innerWidth - 8 ? fallbackLeft : left}px`;
    this.tooltipElement.style.top = `${Math.max(8, Math.min(window.innerHeight - 160, rect.top))}px`;
    this.tooltipElement.classList.add("visible");
  }

  private hideTooltip(): void {
    this.clearTooltipTimers();
    this.tooltipElement?.remove();
    this.tooltipElement = null;
    this.tooltipAnchor = null;
    this.tooltipSticky = false;
  }

  private clearTooltipTimers(): void {
    if (this.tooltipShowTimer !== null) window.clearTimeout(this.tooltipShowTimer);
    if (this.tooltipStickTimer !== null) window.clearTimeout(this.tooltipStickTimer);
    if (this.tooltipHideTimer !== null) window.clearTimeout(this.tooltipHideTimer);
    this.tooltipShowTimer = null;
    this.tooltipStickTimer = null;
    this.tooltipHideTimer = null;
  }

  private render(data: CelestialObjectPanelData): string {
    const details = data.objectDetails;
    const habitabilityValue = data.planetState
      ? getEffectiveSpeciesHabitability(data.planetState)
      : details.habitability;
    const habitability = habitabilityValue === null ? "?%" : `${habitabilityValue}%`;
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
          ${isHabitedPlanet ? '<div class="coLeaderCard"><div class="coLeaderPortrait"></div><div><strong>Sector Official</strong><span>No governor assigned</span></div></div>' : ""}
          ${isPlanet && data.orbitFleetId ? '<button class="coHeroAction" type="button" data-co-orbit-planet>Orbit</button>' : ""}
          ${isPlanet && !isHabitedPlanet && !data.orbitFleetId ? '<button class="coHeroAction" type="button">Terraform</button>' : ""}
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
        <span>HAPPINESS ${planetState ? `${planetState.economy.happiness.toFixed(0)}%` : "?%"}</span>
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
    const featuresTray = this.renderFeaturesTray(data);
    const sidePanel = featuresTray || buildTray || this.renderPlanetOverview(data);

    return `
      <section class="coBody">
        <div class="coBodyHeader">Districts and Buildings</div>
        <div class="coSurfaceLayout${sidePanel ? " withSide" : ""}">
          <div class="coDistrictGrid">
            <article class="coDistrictCard coDistrictCity">
              ${this.renderDistrict("city", "City Districts", built, limits, data.isHabited, canBuild, planetState)}
              <div class="coEmbeddedBuildings coCityBuildings">
                ${this.renderBuildingSlotsForArea(data, "city", planetState?.buildings.city ?? [], 6)}
              </div>
              ${planetState && data.isHabited ? this.renderUrbanSubDistricts(data, planetState) : ""}
            </article>
            <article class="coInfoCard">
              ${planetState && data.isHabited ? this.renderProductionPanels(planetState) : this.renderDescription(details)}
            </article>
            <article class="coDistrictCard">
              ${this.renderDistrict("generator", "Generator Districts", built, limits, false, canBuild, planetState)}
              <div class="coEmbeddedBuildings">
                ${this.renderBuildingSlotsForArea(data, "generator", planetState?.buildings.generator ?? [], 3)}
              </div>
            </article>
            <article class="coDistrictCard">
              ${this.renderDistrict("mining", "Mining Districts", built, limits, false, canBuild, planetState)}
              <div class="coEmbeddedBuildings">
                ${this.renderBuildingSlotsForArea(data, "mining", planetState?.buildings.mining ?? [], 3)}
              </div>
            </article>
            <article class="coDistrictCard">
              ${this.renderDistrict("agriculture", "Agriculture Districts", built, limits, false, canBuild, planetState)}
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
              <button type="button" data-co-tooltip="${this.tooltipAttr(this.renderSubDistrictTooltip(subDistrict.kind, planetState))}" data-co-change-sub data-co-sub-index="${index}">Change</button>
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
        <button class="coTinyAction${buildDisabled}" type="button" data-co-tooltip="${tooltip}" data-co-build-district="${kind}"${buildDisabled ? " disabled" : ""}>+</button>
      </div>
      <div class="coDistrictContent">
        <div class="coDistrictIcon ${kind}">
          <img class="coDistrictIconArt" data-district-icon data-district-icon-candidates="${this.escapeHtml(this.getDistrictIconCandidateAttribute(kind))}" alt="" loading="eager" decoding="async" style="display:none;" />
          <div class="coDistrictFallback" data-district-fallback>${district?.code ?? ""}</div>
        </div>
        <div class="coDistrictMeta">
          ${showCityIndustry ? '<div class="coSpecialization">Space Age Industry</div>' : ""}
          <div class="coDistrictCount">${used}/${limit}${queuedLabel}</div>
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
      if (building) {
        const definition = BUILDING_DEFINITIONS[building];
        return `
          <span class="filled coBuildingIconSlot" data-co-tooltip="${this.tooltipAttr(this.renderBuildingTooltip(definition, data.planetState!, area, subDistrictIndex))}">
            <img class="coBuildingIconArt" data-building-icon data-building-icon-candidates="${this.escapeHtml(this.getBuildingIconCandidateAttribute(definition))}" alt="" loading="eager" decoding="async" style="display:none;" />
            <span class="coBuildingInitials" data-building-fallback>${this.escapeHtml(definition.initials)}</span>
          </span>
        `;
      }
      const queued = this.getQueuedBuildingForSlot(data.planetState!, area, index, subDistrictIndex);
      if (queued?.buildingKind) {
        const definition = BUILDING_DEFINITIONS[queued.buildingKind];
        return `
          <span class="queued coBuildingIconSlot" data-co-tooltip="${this.tooltipAttr(this.renderBuildingTooltip(definition, data.planetState!, area, subDistrictIndex, queued))}">
            <img class="coBuildingIconArt" data-building-icon data-building-icon-candidates="${this.escapeHtml(this.getBuildingIconCandidateAttribute(definition))}" alt="" loading="eager" decoding="async" style="display:none;" />
            <span class="coBuildingInitials" data-building-fallback>${this.escapeHtml(definition.initials)}</span>
            <small>${Math.ceil(queued.remainingDays)}d</small>
          </span>
        `;
      }
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
          title="Build in this slot"
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
            const definition = BUILDING_DEFINITIONS[building];
            return `
              <button
                type="button"
                data-co-pick-building="${building}"
                class="${isCompatible ? "" : "incompatible"}"
                data-co-tooltip="${this.tooltipAttr(this.renderBuildingTooltip(definition, planetState, target.area, target.subDistrictIndex))}"
                ${isCompatible ? "" : "disabled"}
              >
                <span class="coBuildCardIcon">
                  <img class="coBuildingIconArt" data-building-icon data-building-icon-candidates="${this.escapeHtml(this.getBuildingIconCandidateAttribute(definition))}" alt="" loading="eager" decoding="async" style="display:none;" />
                  <span class="coBuildingInitials" data-building-fallback>${this.escapeHtml(definition.initials)}</span>
                </span>
                <span class="coBuildCardCopy">
                  <strong>${this.escapeHtml(definition.label)}</strong>
                  <small>${isCompatible ? `${BUILDING_MINERAL_COSTS[building]} minerals | ${BUILDING_BUILD_DAYS[building]} days` : "Incompatible slot"}</small>
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
    const housingDelta = economy.housing - planetState.population;
    const amenityNeed = planetState.population / 1_000_000;
    const amenityDelta = economy.amenities - amenityNeed;
    const growth = economy.populationGrowth;

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
          <div><span>Growth / 4 mo</span><strong>${this.formatSignedPeople(growth.netPerQuarter)}</strong></div>
          <div><span>Districts</span><strong>${districtUsed}/${districtLimit}</strong></div>
          <div><span>Happiness</span><strong>${economy.happiness.toFixed(0)}%</strong></div>
          <div><span>Housing Balance</span><strong>${this.formatSignedPeople(housingDelta)}</strong></div>
          <div><span>Amenities Balance</span><strong>${this.formatSignedCompact(amenityDelta)}</strong></div>
        </div>
        ${this.renderConstructionQueue(planetState)}
        <div class="coOverviewActions">
          <button type="button" data-co-open-features>Features</button>
          <button type="button">Decisions</button>
        </div>
      </aside>
    `;
  }

  private renderFeaturesTray(data: CelestialObjectPanelData): string {
    const planetState = data.planetState;
    if (!this.featureTrayOpen || !planetState || !data.isHabited) return "";
    const features = planetState.features;
    return `
      <aside class="coFeatureTray">
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

  private renderBuildingTooltip(
    definition: BuildingDefinition,
    planetState: PlanetState,
    area: BuildingSlotArea,
    subDistrictIndex?: number,
    queued?: PlanetConstructionQueueItem,
  ): string {
    const jobLines = this.renderBuildingJobLines(definition, planetState);
    const productionLines = this.renderBuildingProductionLines(definition, planetState);
    const compatible = this.isDefinitionCompatible(definition, area, subDistrictIndex, planetState);
    return `
      <div class="coTooltipTitle">${this.escapeHtml(definition.label)}</div>
      <p>${this.escapeHtml(definition.description)}</p>
      <div class="coTooltipGrid">
        <div><span>Cost</span><strong>${definition.mineralCost} Minerals</strong></div>
        <div><span>Build Time</span><strong>${queued ? `${Math.ceil(queued.remainingDays)} days left` : `${definition.buildDays} days`}</strong></div>
        <div><span>Slot</span><strong>${compatible ? "Compatible" : "Incompatible"}</strong></div>
      </div>
      <div class="coTooltipSectionTitle">Jobs And Housing</div>
      <div class="coTooltipList">${jobLines.length ? jobLines.map((line) => `<span>${line}</span>`).join("") : "<span>No direct jobs.</span>"}</div>
      <div class="coTooltipSectionTitle">Predicted Monthly Output</div>
      <div class="coTooltipList">${productionLines.length ? productionLines.map((line) => `<span>${line}</span>`).join("") : "<span>No direct production.</span>"}</div>
    `;
  }

  private renderBuildingJobLines(definition: BuildingDefinition, planetState: PlanetState): string[] {
    const lines: string[] = [];
    if (definition.housing) lines.push(`+${this.formatPeople(definition.housing)} Housing`);
    for (const effect of definition.jobs ?? []) {
      const amount = effect.amount * (effect.perDistrict ? planetState.builtDistricts[effect.perDistrict] : 1);
      const sign = amount >= 0 ? "+" : "-";
      lines.push(`${sign}${this.formatPeople(Math.abs(amount))} ${this.escapeHtml(JOB_LABELS[effect.job])}`);
    }
    return lines;
  }

  private renderBuildingProductionLines(definition: BuildingDefinition, planetState: PlanetState): string[] {
    const habitability = getEffectiveSpeciesHabitability(planetState);
    const outputMultiplier = getHabitabilityProductionMultiplier(habitability) * Math.max(0, 1 + (planetState.economy.stability - 50) * 0.005);
    const upkeepMultiplier = getHabitabilityUpkeepMultiplier(habitability);
    const lines: string[] = [];
    for (const effect of definition.jobs ?? []) {
      const amount = effect.amount * (effect.perDistrict ? planetState.builtDistricts[effect.perDistrict] : 1);
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

  private renderConstructionQueue(planetState: PlanetState): string {
    const queue = planetState.constructionQueue;
    return `
      <div class="coQueuePanel">
        <div class="coQueueHeader">
          <strong>Build Queue</strong>
          <span>${queue.length} active</span>
        </div>
        <div class="coQueueList">
          ${queue.length === 0 ? '<div class="coQueueEmpty">No active construction</div>' : queue.map((item) => this.renderQueueItem(item)).join("")}
        </div>
      </div>
    `;
  }

  private renderQueueItem(item: PlanetConstructionQueueItem): string {
    const progress = item.totalDays <= 0 ? 1 : 1 - item.remainingDays / item.totalDays;
    return `
      <div class="coQueueItem">
        <strong>${this.escapeHtml(item.label)}</strong>
        <span>${Math.ceil(item.remainingDays)}d remaining</span>
        <small>${item.mineralCost} minerals</small>
        <div class="coQueueProgress"><span style="width:${Math.max(2, Math.min(100, progress * 100)).toFixed(0)}%"></span></div>
      </div>
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
    const growth = planetState.economy.populationGrowth;
    const growthLabel = growth.netPerQuarter >= 0
      ? this.formatSignedPeople(growth.netPerQuarter)
      : this.formatSignedPeople(growth.netPerQuarter);
    const growthRate = `${(growth.ratePerQuarter * 100).toFixed(2)}% / 4 mo`;

    return `
      <section class="coBody coEconomyBody">
        <div class="coJobsPanel">
          <div class="coBodyHeader">Jobs</div>
          ${classes.map((entry) => this.renderJobClass(planetState, entry.className, entry.label)).join("")}
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
            ${this.selectedJob ? this.renderSelectedJob(planetState, this.selectedJob) : "Click a job to inspect its population groups."}
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
    const groups = planetState.economy.popGroups.filter((candidate) => candidate.job === job);
    const population = groups.reduce((sum, group) => sum + group.population, 0);
    const jobClass = this.getJobClass(job);
    const effects = this.getJobEffectSummary(job);
    return `
      <h4>${this.escapeHtml(JOB_LABELS[job])}</h4>
      <p>Class: ${this.escapeHtml(jobClass)}</p>
      <p>Population: ${this.formatPeople(population)}</p>
      <p>Capacity: ${this.formatPeople(planetState.economy.jobCapacity[job])}</p>
      <p>${this.escapeHtml(effects)}</p>
      <div class="coPopGroupList">
        ${groups.length === 0
          ? '<span>No assigned population.</span>'
          : groups.map((group) => `
            <span>
              <strong>${this.escapeHtml(group.speciesName)}</strong>
              ${this.formatPeople(group.population)} | Happy ${group.happiness}% | Hab ${group.habitability}%
            </span>
          `).join("")}
      </div>
    `;
  }

  private getJobEffectSummary(job: JobKind): string {
    const output: Partial<Record<ResourceKind | "amenities", number>> = {};
    const upkeep: Partial<Record<ResourceKind, number>> = {};
    const addOutput = (resource: ResourceKind | "amenities", value: number) => {
      output[resource] = (output[resource] ?? 0) + value;
    };
    const addUpkeep = (resource: ResourceKind, value: number) => {
      upkeep[resource] = (upkeep[resource] ?? 0) + value;
    };
    const jobClass = this.getJobClass(job);
    if (jobClass === "upper") addUpkeep("goods", 0.4);
    if (jobClass === "middle") addUpkeep("goods", 0.2);
    if (jobClass === "lower" && job !== "unemployed") addUpkeep("goods", 0.05);
    const definition = JOB_DEFINITIONS[job];
    for (const [resource, value] of Object.entries(definition.output ?? {}) as Array<[ResourceKind, number]>) {
      addOutput(resource, value);
    }
    for (const [resource, value] of Object.entries(definition.upkeep ?? {}) as Array<[ResourceKind, number]>) {
      addUpkeep(resource, value);
    }
    if (definition.amenities) addOutput("amenities", definition.amenities);
    const outputText = Object.entries(output).map(([resource, value]) => `+${value} ${resource}`).join(", ");
    const upkeepText = Object.entries(upkeep).map(([resource, value]) => `-${value} ${resource}`).join(", ");
    const crimeText = definition.crimeReduction ? `-${definition.crimeReduction} crime` : "";
    if (!outputText && !upkeepText && !crimeText) return "No production or upkeep per 1M population.";
    return `Per 1M: ${[outputText, upkeepText, crimeText].filter(Boolean).join("; ")}`;
  }

  private getPopForJob(planetState: PlanetState, job: JobKind): number {
    return planetState.economy.popGroups
      .filter((group) => group.job === job)
      .reduce((sum, group) => sum + group.population, 0);
  }

  private getJobClass(job: JobKind): JobClass {
    return JOB_DEFINITIONS[job].class;
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
      item.kind === "building"
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
  grid-template-columns: repeat(6, 1fr);
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

.coQueuePanel {
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
  display: grid;
  gap: 5px;
  max-height: 148px;
  overflow-y: auto;
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
  display: grid;
  gap: 2px;
}

.coQueueItem strong,
.coQueueItem span,
.coQueueItem small {
  display: block;
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

.coQueueProgress {
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

.coPopGroupList {
  display: grid;
  gap: 4px;
  margin-top: 7px;
}

.coPopGroupList span {
  display: block;
  padding: 4px;
  border: 1px solid rgba(103, 255, 221, 0.24);
  background: rgba(6, 26, 26, 0.5);
}

.coPopGroupList strong {
  color: #9cffcc;
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
