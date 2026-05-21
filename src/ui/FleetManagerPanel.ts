import {
  ArcRotateCamera,
  Color3,
  Color4,
  Engine,
  HemisphericLight,
  Material,
  MeshBuilder,
  MultiMaterial,
  PointLight,
  Scene,
  SceneLoader,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { AbstractMesh } from "@babylonjs/core";
import "@babylonjs/loaders/OBJ/objFileLoader";
import type { FactionInfo } from "../data/Factions";
import {
  STARBASE_SHIP_DEFINITIONS,
  countStarbaseShipyards,
} from "../data/Starbase";
import type { StarbaseShipKind } from "../data/Starbase";
import {
  calculateShipDesignStats,
  createDefaultShipDesign,
  getShipDesignLayout,
  getShipModuleDefinition,
  getShipModulesForComponentSlot,
  getShipSectionModuleDefinition,
  getShipSectionModulesForKind,
  normalizeShipDesign,
  SHIP_HULL_DEFINITIONS,
  WEAPON_SLOT_SIZE_LABELS,
} from "../data/ShipDesigns";
import type {
  ShipComponentSlotDefinition,
  ShipComponentSlotType,
  ShipDesign,
  ShipDesignerModuleType,
  ShipDesignStats,
  ShipModuleDefinition,
  ShipSectionModuleDefinition,
  ShipSectionSlotType,
} from "../data/ShipDesigns";
import type { StarData } from "../data/StarMap";
import type { ClientCommand, ServerFleet, ServerShip, ServerStarbase } from "../game/GameProtocol";
import {
  getFirstRequiredTechName,
  getRequiredTechIdsForShipHull,
  getRequiredTechIdsForShipModule,
  getRequiredTechIdsForShipSection,
} from "../data/Technology";
import type { FactionTechnologyView, TechId } from "../data/Technology";
import type {
  CombatStance,
  FleetBehavior,
  FleetChasePolicy,
  FleetRetreatPolicy,
} from "../game/CombatTypes";
import { GAME_DAYS_PER_YEAR, REAL_MS_PER_GAME_DAY } from "../game/GameTime";
import { computeCombatPowerFromStats, computeFleetPower, computeShipPower } from "../game/combatPower";
import { getFleetTacticalRadius } from "../game/tacticalFormation";
import {
  captureScrollState,
  hasFocusedFormControl,
  restoreScrollStateSoon,
} from "./panelDomState";

export interface FleetManagerPanelData {
  fleets: ServerFleet[];
  ships: ServerShip[];
  shipDesigns: ShipDesign[];
  starbases: ServerStarbase[];
  stars: StarData[];
  factions: FactionInfo[];
  playerFactionId: number | null;
  clockYear: number;
  technology?: FactionTechnologyView | null;
  onFleetCommand?: (command: ClientCommand) => void;
}

const STYLE_ID = "fleet-manager-panel-style";
const SHIP_PREVIEW_MODEL_ROOT = "/ships/fighter_01/";
const SHIP_PREVIEW_MODEL_FILE = "Fighter_01.obj";
const SHIP_PREVIEW_TARGET_SIZE = 3.8;
const FLEET_MANAGER_SCROLL_SELECTORS = [
  ".fmFleetList",
  ".fmCompositionList",
  ".fmBuildShipList",
  ".fmDesignListPane",
  ".fmDesignStatsPane",
  ".fmPaletteList",
  ".fmBody",
  ".fmDesignerBody",
] as const;

type FleetManagerTab = "fleetManager" | "shipDesigner";
type DesignerSlotKind = ShipDesignerModuleType;
type DesignerModuleOption = ShipModuleDefinition | ShipSectionModuleDefinition;
type DesignStatMetricId = "power" | "damage" | "shields" | "armor" | "hull" | "evasion" | "speed" | "sensor";

interface DesignStatComparison {
  id: DesignStatMetricId;
  label: string;
  value: number;
  displayValue: string;
  score: number;
}

export class FleetManagerPanel {
  private root: HTMLDivElement;
  private panelElement: HTMLDivElement | null = null;
  private currentData: FleetManagerPanelData | null = null;
  private activeTab: FleetManagerTab = "fleetManager";
  private selectedFleetId: string | null = null;
  private selectedDesignId: string | null = null;
  private designerDraft: ShipDesign | null = null;
  private selectedDesignerSlot: string | null = null;
  private addShipsOpen = false;
  private position = { x: 62, y: 82 };
  private dragOffset = { x: 0, y: 0 };
  private isDragging = false;
  private pendingRefreshData: FleetManagerPanelData | null = null;
  private pendingRefreshTimer: number | null = null;
  private shipPreviewCanvas: HTMLCanvasElement | null = null;
  private shipPreviewEngine: Engine | null = null;
  private shipPreviewScene: Scene | null = null;
  private shipPreviewRoot: TransformNode | null = null;
  private shipPreviewLoadPromise: Promise<void> | null = null;
  private shipPreviewResizeObserver: ResizeObserver | null = null;
  private shipPreviewHost: HTMLElement | null = null;

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

  public show(data: FleetManagerPanelData): void {
    this.currentData = data;
    this.ensureSelectedFleet(data);
    if (this.activeTab === "shipDesigner") this.ensureDesignerDraft(data);
    const scrollState = captureScrollState(this.panelElement, FLEET_MANAGER_SCROLL_SELECTORS);
    if (!this.panelElement) {
      this.panelElement = document.createElement("div");
      this.panelElement.className = "fleetManagerPanel";
      this.root.appendChild(this.panelElement);
    }

    const accent = data.playerFactionId !== null
      ? this.colorToCss(this.getFaction(data, data.playerFactionId)?.color, 0.95)
      : "rgba(114, 226, 255, 0.95)";
    this.panelElement.style.setProperty("--fleet-accent", accent);
    this.panelElement.innerHTML = this.render(data);
    this.applyPosition();
    this.bindEvents(data);
    if (this.activeTab === "shipDesigner") {
      this.mountShipPreview();
    } else {
      this.disposeShipPreview();
    }
    restoreScrollStateSoon(this.panelElement, scrollState);
  }

  public refresh(data: FleetManagerPanelData): void {
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
    this.onPointerUp();
    this.clearPendingRefresh();
    this.disposeShipPreview();
    this.panelElement?.remove();
    this.panelElement = null;
    this.currentData = null;
    this.activeTab = "fleetManager";
    this.addShipsOpen = false;
    this.selectedDesignId = null;
    this.designerDraft = null;
  }

  public dispose(): void {
    this.close();
  }

  private shouldDeferRefresh(): boolean {
    return this.isDragging || hasFocusedFormControl(this.panelElement);
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

  private mountShipPreview(): void {
    const host = this.panelElement?.querySelector<HTMLElement>("[data-fm-ship-preview]");
    if (!host) return;

    if (!this.shipPreviewCanvas) {
      this.shipPreviewCanvas = document.createElement("canvas");
      this.shipPreviewCanvas.className = "fmShipPreviewCanvas";
      this.shipPreviewCanvas.setAttribute("aria-hidden", "true");
    }
    if (this.shipPreviewCanvas.parentElement !== host) {
      host.prepend(this.shipPreviewCanvas);
    }

    if (this.shipPreviewHost !== host) {
      this.shipPreviewResizeObserver?.disconnect();
      this.shipPreviewResizeObserver = null;
      this.shipPreviewHost = host;
      if (typeof ResizeObserver !== "undefined") {
        this.shipPreviewResizeObserver = new ResizeObserver(() => this.shipPreviewEngine?.resize());
        this.shipPreviewResizeObserver.observe(host);
      }
    }

    if (!this.shipPreviewEngine || !this.shipPreviewScene) {
      this.createShipPreviewScene();
    }
    this.shipPreviewEngine?.resize();
  }

  private createShipPreviewScene(): void {
    if (!this.shipPreviewCanvas) return;

    const engine = new Engine(this.shipPreviewCanvas, true, {
      antialias: true,
      preserveDrawingBuffer: true,
      stencil: true,
    }, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.01, 0.025, 0.04, 0);

    const camera = new ArcRotateCamera(
      "fleetManagerShipPreviewCamera",
      -Math.PI * 0.46,
      Math.PI * 0.58,
      6.2,
      new Vector3(0, 0.08, 0),
      scene,
    );
    camera.lowerRadiusLimit = 4.2;
    camera.upperRadiusLimit = 8.5;
    camera.wheelPrecision = 72;
    camera.panningSensibility = 0;
    camera.attachControl(this.shipPreviewCanvas, true);
    scene.activeCamera = camera;

    const fill = new HemisphericLight("fleetManagerShipPreviewFill", new Vector3(0.2, 1, 0.35), scene);
    fill.intensity = 0.85;
    fill.diffuse = new Color3(0.66, 0.78, 0.92);
    fill.groundColor = new Color3(0.08, 0.12, 0.16);

    const key = new PointLight("fleetManagerShipPreviewKey", new Vector3(-3.4, 3.2, -4.2), scene);
    key.intensity = 18;
    key.range = 18;
    key.diffuse = new Color3(0.76, 0.88, 1.0);
    key.specular = new Color3(0.95, 0.98, 1.0);

    const rim = new PointLight("fleetManagerShipPreviewRim", new Vector3(3.6, 1.7, 3.2), scene);
    rim.intensity = 7;
    rim.range = 18;
    rim.diffuse = new Color3(0.38, 1.0, 0.82);

    this.shipPreviewEngine = engine;
    this.shipPreviewScene = scene;
    engine.runRenderLoop(() => {
      if (!this.shipPreviewScene || this.shipPreviewScene.isDisposed) return;
      if (this.shipPreviewRoot) {
        this.shipPreviewRoot.rotation.y += (engine.getDeltaTime() / 1000) * 0.13;
      }
      scene.render();
    });

    void this.loadShipPreviewModel();
  }

  private async loadShipPreviewModel(): Promise<void> {
    if (!this.shipPreviewScene || this.shipPreviewRoot || this.shipPreviewLoadPromise) {
      return this.shipPreviewLoadPromise ?? Promise.resolve();
    }

    const scene = this.shipPreviewScene;
    this.shipPreviewLoadPromise = (async () => {
      try {
        const result = await SceneLoader.ImportMeshAsync(
          "",
          SHIP_PREVIEW_MODEL_ROOT,
          SHIP_PREVIEW_MODEL_FILE,
          scene,
        );
        if (this.shipPreviewScene !== scene || scene.isDisposed) {
          result.meshes.forEach((mesh) => mesh.dispose());
          return;
        }

        const meshes = result.meshes.filter((mesh) => (
          typeof mesh.getTotalVertices === "function" && mesh.getTotalVertices() > 0
        ));
        if (meshes.length === 0) throw new Error("Ship preview model did not produce renderable meshes.");

        const bounds = this.computeMeshBounds(meshes);
        const maxDimension = Math.max(
          0.001,
          bounds.max.x - bounds.min.x,
          bounds.max.y - bounds.min.y,
          bounds.max.z - bounds.min.z,
        );

        const root = new TransformNode("fleetManagerShipPreviewRoot", scene);
        root.rotation.set(0.2, -0.55, -0.06);
        root.scaling.setAll(SHIP_PREVIEW_TARGET_SIZE / maxDimension);

        const assetRoot = new TransformNode("fleetManagerShipPreviewAssetRoot", scene);
        assetRoot.parent = root;
        assetRoot.position = bounds.center.scale(-1);

        for (const mesh of meshes) {
          mesh.parent = assetRoot;
          mesh.isPickable = false;
          mesh.alwaysSelectAsActiveMesh = true;
          this.applyShipPreviewMaterialStyle(mesh.material, scene);
        }

        this.shipPreviewRoot = root;
      } catch (error) {
        console.warn("[FleetManagerPanel] Failed to load ship preview model.", error);
        if (!scene.isDisposed && this.shipPreviewScene === scene) {
          this.createFallbackShipPreview(scene);
        }
      }
    })().finally(() => {
      this.shipPreviewLoadPromise = null;
    });

    return this.shipPreviewLoadPromise;
  }

  private createFallbackShipPreview(scene: Scene): void {
    if (this.shipPreviewRoot) return;
    const root = new TransformNode("fleetManagerShipPreviewFallbackRoot", scene);
    root.rotation.set(0.2, -0.55, -0.06);
    this.shipPreviewRoot = root;

    const material = new StandardMaterial("fleetManagerShipPreviewFallbackMat", scene);
    material.diffuseColor = new Color3(0.58, 0.68, 0.76);
    material.emissiveColor = new Color3(0.03, 0.05, 0.06);
    material.specularColor = new Color3(0.86, 0.94, 1.0);

    const body = MeshBuilder.CreateBox("fleetManagerShipPreviewFallbackBody", { width: 2.9, height: 0.34, depth: 0.9 }, scene);
    body.parent = root;
    body.material = material;
    const wing = MeshBuilder.CreateBox("fleetManagerShipPreviewFallbackWing", { width: 1.15, height: 0.08, depth: 2.0 }, scene);
    wing.parent = root;
    wing.position.z = 0.08;
    wing.material = material;
  }

  private disposeShipPreview(): void {
    this.shipPreviewResizeObserver?.disconnect();
    this.shipPreviewResizeObserver = null;
    this.shipPreviewHost = null;
    this.shipPreviewCanvas?.remove();
    this.shipPreviewScene?.dispose();
    this.shipPreviewEngine?.dispose();
    this.shipPreviewCanvas = null;
    this.shipPreviewEngine = null;
    this.shipPreviewScene = null;
    this.shipPreviewRoot = null;
    this.shipPreviewLoadPromise = null;
  }

  private computeMeshBounds(meshes: AbstractMesh[]): { min: Vector3; max: Vector3; center: Vector3 } {
    const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      const corners = mesh.getBoundingInfo().boundingBox.vectorsWorld;
      for (const corner of corners) {
        min.minimizeInPlace(corner);
        max.maximizeInPlace(corner);
      }
    }

    if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) {
      return { min: new Vector3(-1, -1, -1), max: new Vector3(1, 1, 1), center: Vector3.Zero() };
    }
    return { min, max, center: min.add(max).scale(0.5) };
  }

  private applyShipPreviewMaterialStyle(material: Material | null, scene: Scene): void {
    if (!material) return;

    if (material instanceof MultiMaterial) {
      for (const subMaterial of material.subMaterials) {
        this.applyShipPreviewMaterialStyle(subMaterial, scene);
      }
      return;
    }

    if (!(material instanceof StandardMaterial)) return;

    const name = material.name.toLowerCase();
    material.disableLighting = false;
    material.diffuseColor = new Color3(0.92, 0.96, 1.0);
    material.ambientColor = new Color3(0.34, 0.38, 0.44);
    material.specularColor = new Color3(0.82, 0.86, 0.9);
    material.emissiveColor = new Color3(0.014, 0.016, 0.019);

    if (name.includes("body")) {
      material.diffuseTexture = this.createShipPreviewTexture(`${SHIP_PREVIEW_MODEL_ROOT}textures/Fighter_01_Body_BaseColor.png`, scene);
      material.bumpTexture = new Texture(`${SHIP_PREVIEW_MODEL_ROOT}textures/Fighter_01_Body_Normal.png`, scene);
      material.diffuseColor = new Color3(1.02, 1.04, 1.06);
      material.emissiveColor = new Color3(0.026, 0.028, 0.033);
      material.specularPower = 110;
      return;
    }

    if (name.includes("front")) {
      material.diffuseTexture = this.createShipPreviewTexture(`${SHIP_PREVIEW_MODEL_ROOT}textures/Fighter_01_Front_BaseColor.png`, scene);
      material.bumpTexture = new Texture(`${SHIP_PREVIEW_MODEL_ROOT}textures/Fighter_01_Front_Normal.png`, scene);
      material.emissiveTexture = new Texture(`${SHIP_PREVIEW_MODEL_ROOT}textures/Fighter_01_Front_Emissive.png`, scene);
      material.diffuseColor = new Color3(0.96, 1.0, 1.04);
      material.emissiveColor = new Color3(0.018, 0.032, 0.052);
      material.specularPower = 160;
      return;
    }

    if (name.includes("rear")) {
      material.diffuseTexture = this.createShipPreviewTexture(`${SHIP_PREVIEW_MODEL_ROOT}textures/Fighter_01_Rear_BaseColor.png`, scene);
      material.bumpTexture = new Texture(`${SHIP_PREVIEW_MODEL_ROOT}textures/Fighter_01_Rear_Normal.png`, scene);
      material.emissiveTexture = new Texture(`${SHIP_PREVIEW_MODEL_ROOT}textures/Fighter_01_Rear_Emissive.png`, scene);
      material.diffuseColor = new Color3(0.96, 0.98, 1.0);
      material.emissiveColor = new Color3(0.055, 0.02, 0.012);
      material.specularPower = 150;
      return;
    }

    if (name.includes("windows")) {
      material.diffuseTexture = this.createShipPreviewTexture(`${SHIP_PREVIEW_MODEL_ROOT}textures/Fighter_01_Windows_BaseColor.png`, scene);
      material.bumpTexture = new Texture(`${SHIP_PREVIEW_MODEL_ROOT}textures/Fighter_01_Windows_Normal.png`, scene);
      material.diffuseColor = new Color3(0.95, 1.0, 1.05);
      material.emissiveColor = new Color3(0.035, 0.08, 0.095);
      material.specularPower = 180;
    }
  }

  private createShipPreviewTexture(url: string, scene: Scene, level = 1.35): Texture {
    const texture = new Texture(url, scene);
    texture.level = level;
    return texture;
  }

  private bindEvents(data: FleetManagerPanelData): void {
    if (!this.panelElement) return;
    this.panelElement.querySelector<HTMLButtonElement>("[data-fm-close]")?.addEventListener("click", () => this.close());
    this.panelElement.querySelector<HTMLElement>("[data-fm-drag]")?.addEventListener("pointerdown", (ev) => {
      if (!this.panelElement) return;
      ev.preventDefault();
      const rect = this.panelElement.getBoundingClientRect();
      this.dragOffset.x = ev.clientX - rect.left;
      this.dragOffset.y = ev.clientY - rect.top;
      this.isDragging = true;
      window.addEventListener("pointermove", this.onPointerMove);
      window.addEventListener("pointerup", this.onPointerUp);
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        this.activeTab = button.dataset.fmTab === "shipDesigner" ? "shipDesigner" : "fleetManager";
        this.addShipsOpen = false;
        this.show(data);
      });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-select-fleet]").forEach((button) => {
      button.addEventListener("click", () => {
        const fleetId = button.dataset.fmSelectFleet;
        if (!fleetId) return;
        this.selectedFleetId = fleetId;
        this.addShipsOpen = false;
        this.show(data);
      });
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-fm-add-ships]")?.addEventListener("click", () => {
      this.addShipsOpen = true;
      this.show(data);
    });
    this.panelElement.querySelectorAll<HTMLSelectElement>("[data-fm-fleet-stance]").forEach((select) => {
      select.addEventListener("change", () => {
        const fleet = this.getSelectedFleet(data);
        if (!fleet) return;
        data.onFleetCommand?.({
          type: "setFleetCombatSettings",
          fleetId: fleet.id,
          combatStance: select.value as CombatStance,
          combatSettings: {},
        });
      });
    });
    this.panelElement.querySelectorAll<HTMLSelectElement>("[data-fm-fleet-behavior]").forEach((select) => {
      select.addEventListener("change", () => {
        const fleet = this.getSelectedFleet(data);
        if (!fleet) return;
        data.onFleetCommand?.({
          type: "setFleetCombatSettings",
          fleetId: fleet.id,
          combatSettings: { behavior: select.value as FleetBehavior },
        });
      });
    });
    this.panelElement.querySelectorAll<HTMLSelectElement>("[data-fm-fleet-chase]").forEach((select) => {
      select.addEventListener("change", () => {
        const fleet = this.getSelectedFleet(data);
        if (!fleet) return;
        data.onFleetCommand?.({
          type: "setFleetCombatSettings",
          fleetId: fleet.id,
          combatSettings: { chasePolicy: select.value as FleetChasePolicy },
        });
      });
    });
    this.panelElement.querySelectorAll<HTMLSelectElement>("[data-fm-fleet-retreat]").forEach((select) => {
      select.addEventListener("change", () => {
        const fleet = this.getSelectedFleet(data);
        if (!fleet) return;
        data.onFleetCommand?.({
          type: "setFleetCombatSettings",
          fleetId: fleet.id,
          combatSettings: { retreatPolicy: select.value as FleetRetreatPolicy },
        });
      });
    });
    this.panelElement.querySelectorAll<HTMLSelectElement>("[data-fm-fleet-retreat-destination]").forEach((select) => {
      select.addEventListener("change", () => {
        const fleet = this.getSelectedFleet(data);
        if (!fleet) return;
        const retreatDestination = select.value.startsWith("system:")
          ? { kind: "selectedSystem" as const, targetStarId: Number(select.value.slice("system:".length)) }
          : { kind: "nearestFriendlyStarbase" as const };
        data.onFleetCommand?.({
          type: "setFleetCombatSettings",
          fleetId: fleet.id,
          combatSettings: { retreatDestination },
        });
      });
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-fm-close-ship-picker]")?.addEventListener("click", () => {
      this.addShipsOpen = false;
      this.show(data);
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-build-ship]").forEach((button) => {
      button.addEventListener("click", () => {
        const fleet = this.getSelectedFleet(data);
        const shipKind = button.dataset.fmBuildShip as StarbaseShipKind | undefined;
        const designId = button.dataset.fmBuildDesign;
        if (!fleet || !shipKind) return;
        const shipyard = this.findNearestShipyard(data, fleet);
        if (!shipyard) return;
        data.onFleetCommand?.({
          type: "buildStarbaseShip",
          starbaseId: shipyard.id,
          shipKind,
          designId,
        });
      });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-upgrade-ship]").forEach((button) => {
      button.addEventListener("click", () => {
        const shipId = button.dataset.fmUpgradeShip;
        if (!shipId) return;
        const ship = data.ships.find((candidate) => candidate.id === shipId);
        if (!ship) return;
        const fleet = data.fleets.find((candidate) => candidate.id === ship.fleetId);
        if (!fleet) return;
        const targetDesign = this.getTargetDesignForShip(data, ship);
        const shipyard = this.findShipyardInFleetSystem(data, fleet);
        if (!targetDesign || !shipyard) return;
        data.onFleetCommand?.({
          type: "upgradeShip",
          shipId,
          starbaseId: shipyard.id,
          targetDesignId: targetDesign.id,
        });
      });
    });
    this.bindDesignerEvents(data);
  }

  private bindDesignerEvents(data: FleetManagerPanelData): void {
    if (!this.panelElement || this.activeTab !== "shipDesigner") return;
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-select-design]").forEach((button) => {
      button.addEventListener("click", () => {
        const design = data.shipDesigns.find((candidate) => candidate.id === button.dataset.fmSelectDesign);
        if (!design) return;
        this.selectedDesignId = design.id;
        this.designerDraft = this.cloneDesign(design);
        this.selectedDesignerSlot = null;
        this.show(data);
      });
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-fm-new-design]")?.addEventListener("click", () => {
      const ownerId = data.playerFactionId ?? data.factions[0]?.id ?? 0;
      const draft = createDefaultShipDesign(ownerId, "corvette", data.clockYear);
      this.selectedDesignId = null;
      this.designerDraft = {
        ...draft,
        id: "",
        name: "New Corvette Design",
      };
      this.selectedDesignerSlot = null;
      this.show(data);
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-design-slot]").forEach((button) => {
      button.addEventListener("click", () => {
        const slot = button.dataset.fmDesignSlot;
        if (!slot) return;
        this.selectedDesignerSlot = this.selectedDesignerSlot === slot ? null : slot;
        this.show(data);
      });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-module]").forEach((button) => {
      button.addEventListener("click", () => {
        const moduleId = button.dataset.fmModule;
        if (!moduleId || !this.designerDraft) return;
        this.applyModuleToDraft(moduleId);
        this.show(data);
      });
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-fm-clear-design]")?.addEventListener("click", () => {
      if (!this.designerDraft) return;
      const ownerId = this.designerDraft.ownerId;
      const shipKind = this.designerDraft.shipKind;
      const base = createDefaultShipDesign(ownerId, shipKind, data.clockYear);
      this.designerDraft = {
        ...this.designerDraft,
        weaponSectionModuleIds: [...base.weaponSectionModuleIds],
        defenseSectionModuleIds: [...base.defenseSectionModuleIds],
        weaponModuleIds: [...base.weaponModuleIds],
        defenseModuleIds: [...base.defenseModuleIds],
        utilityModuleIds: [...base.utilityModuleIds],
        utilityModuleId: base.utilityModuleId,
      };
      this.show(data);
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-save-design], [data-fm-save-design-name]").forEach((button) => {
      button.addEventListener("click", () => this.saveDesignerDraft(data));
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-fm-decommission-design]")?.addEventListener("click", () => {
      if (!this.designerDraft?.id) return;
      data.onFleetCommand?.({ type: "decommissionShipDesign", designId: this.designerDraft.id });
    });
  }

  private applyPosition(): void {
    if (!this.panelElement) return;
    this.panelElement.style.left = `${this.position.x}px`;
    this.panelElement.style.top = `${this.position.y}px`;
  }

  private render(data: FleetManagerPanelData): string {
    return `
      <div class="fmHeader" data-fm-drag>
        <div class="fmHeaderIcon">FL</div>
        <div>
          <div class="fmTitle">Fleet Operations</div>
          <div class="fmSubtitle">${this.escapeHtml(this.getPanelSubtitle(data))}</div>
        </div>
        <button class="fmClose" type="button" data-fm-close aria-label="Close fleet manager">X</button>
      </div>
      ${this.activeTab === "shipDesigner" ? this.renderShipDesigner(data) : this.renderFleetManager(data)}
      <nav class="fmTabs">
        ${this.renderTab("fleetManager", "Fleet Manager")}
        ${this.renderTab("shipDesigner", "Ship Designer")}
      </nav>
    `;
  }

  private renderFleetManager(data: FleetManagerPanelData): string {
    const selectedFleet = this.getSelectedFleet(data);
    const navalUsed = this.getTotalShipCount(data);
    return `
      <section class="fmBody">
        <article class="fmColumn fmFleetListColumn">
          <div class="fmFleetListHeader">
            <div class="fmPanelTitle">
              <span class="fmPanelIcon fmPanelIcon-fleet" aria-hidden="true"></span>
              <strong>Fleet Manager</strong>
            </div>
            <span class="fmCapacityChip"><small>Naval Capacity</small><strong>${this.escapeHtml(String(navalUsed))} / 100</strong></span>
          </div>
          <label class="fmFleetSearch">
            <input type="search" placeholder="Search fleets..." aria-label="Search fleets">
            <span class="fmSearchIcon" aria-hidden="true"></span>
          </label>
          <div class="fmFleetList">
            ${data.fleets.length === 0
              ? '<div class="fmEmpty">No fleets currently visible.</div>'
              : data.fleets.map((fleet, index) => this.renderFleetListItem(data, fleet, index)).join("")}
          </div>
        </article>
        <article class="fmColumn fmSelectedColumn">
          ${selectedFleet ? this.renderSelectedFleet(data, selectedFleet) : this.renderNoSelectedFleet()}
        </article>
        <aside class="fmColumn fmCompositionColumn">
          ${selectedFleet ? (this.addShipsOpen ? this.renderShipPicker(data, selectedFleet) : this.renderFleetCompositionPanel(data, selectedFleet)) : this.renderNoSelectedFleet()}
        </aside>
      </section>
    `;
  }

  private renderFleetListItem(data: FleetManagerPanelData, fleet: ServerFleet, index: number): string {
    const owner = this.getFaction(data, fleet.ownerId);
    const selected = fleet.id === this.selectedFleetId;
    const shipCount = this.getFleetShipCount(data, fleet);
    const systemName = this.getStarName(data, fleet.currentStarId);
    return `
      <button class="fmFleetCard ${selected ? "selected" : ""}" type="button" data-fm-select-fleet="${this.escapeAttribute(fleet.id)}">
        <span class="fmFleetPip" style="--fleet-owner-color: ${this.colorToCss(owner?.color, 0.95)}"></span>
        <span class="fmFleetCopy">
          <strong>${this.escapeHtml(this.getFleetName(data, fleet, index))}</strong>
          <small>${this.escapeHtml(systemName)} | ${this.escapeHtml(this.formatFleetStatus(fleet))}</small>
        </span>
        <span class="fmFleetGhost" aria-hidden="true"></span>
        <span class="fmFleetNumbers">
          <strong>${this.escapeHtml(this.formatFleetPower(data, fleet, index))}</strong>
          <small>${shipCount} ship${shipCount === 1 ? "" : "s"}</small>
        </span>
      </button>
    `;
  }

  private renderSelectedFleet(data: FleetManagerPanelData, fleet: ServerFleet): string {
    const owner = this.getFaction(data, fleet.ownerId);
    const ships = this.getShipsForFleet(data, fleet.id);
    const index = Math.max(0, data.fleets.findIndex((candidate) => candidate.id === fleet.id));
    const shipCount = this.getFleetShipCount(data, fleet);
    const defense = this.getFleetDefense(data, fleet);
    const commandUsed = Math.max(shipCount, ships.length);
    return `
      <div class="fmSelectedHeader">
        <div>
          <div class="fmSectionTitle">Selected Fleet</div>
          <h3>${this.escapeHtml(this.getFleetName(data, fleet, index))}</h3>
          <span>${this.escapeHtml(this.getStarName(data, fleet.currentStarId))} System</span>
        </div>
        <div class="fmSelectedHeaderChips">
          <span class="fmCommandChip"><small>Command Limit</small><strong>${this.escapeHtml(String(commandUsed))} / 100</strong></span>
          <div class="fmPowerBadge"><strong>${this.escapeHtml(this.formatFleetPower(data, fleet, index))}</strong><small>Fleet Power</small></div>
        </div>
      </div>
      <div class="fmStatGrid">
        ${this.renderFleetInfoCard("status", "Status", this.formatFleetStatus(fleet))}
        ${this.renderFleetInfoCard("owner", "Owner", owner?.name ?? "Unknown")}
        ${this.renderFleetInfoCard("class", "Class", shipCount === 1 ? "Single-Ship Fleet" : `${shipCount} Ships`)}
        ${this.renderFleetInfoCard("shields", "Shields", `${Math.round(defense.shield)} / ${Math.round(defense.maxShield)}`, this.getRatio(defense.shield, defense.maxShield))}
        ${this.renderFleetInfoCard("armor", "Armor", `${Math.round(defense.armor)} / ${Math.round(defense.maxArmor)}`, this.getRatio(defense.armor, defense.maxArmor))}
        ${this.renderFleetInfoCard("hull", "Hull", `${Math.round(defense.hull)} / ${Math.round(defense.maxHull)}`, this.getRatio(defense.hull, defense.maxHull))}
        ${this.renderFleetInfoCard("speed", "Speed", `${this.formatCompact(fleet.speed * 2)} ly/day`)}
        ${this.renderFleetInfoCard("order", "Order", this.formatFleetOrder(data, fleet))}
      </div>
      ${this.renderFleetDoctrinePanel(data, fleet, ships)}
      <button class="fmAddShipsButton" type="button" data-fm-add-ships ${data.playerFactionId === fleet.ownerId ? "" : "disabled"}>Add Ships</button>
    `;
  }

  private saveDesignerDraft(data: FleetManagerPanelData): void {
    if (!this.designerDraft) return;
    const nameInput = this.panelElement?.querySelector<HTMLInputElement>("[data-fm-design-name]");
    const name = (nameInput?.value ?? this.designerDraft.name).trim() || this.designerDraft.name;
    this.designerDraft.name = name;
    data.onFleetCommand?.({
      type: "saveShipDesign",
      designId: this.designerDraft.id || undefined,
      shipKind: this.designerDraft.shipKind,
      name,
      weaponSectionModuleIds: [...this.designerDraft.weaponSectionModuleIds],
      defenseSectionModuleIds: [...this.designerDraft.defenseSectionModuleIds],
      weaponModuleIds: [...this.designerDraft.weaponModuleIds],
      defenseModuleIds: [...this.designerDraft.defenseModuleIds],
      utilityModuleIds: [...this.designerDraft.utilityModuleIds],
      utilityModuleId: this.designerDraft.utilityModuleId,
    });
  }

  private renderFleetDoctrinePanel(data: FleetManagerPanelData, fleet: ServerFleet, ships: ServerShip[]): string {
    const canCommand = data.playerFactionId === fleet.ownerId;
    const tacticalRadius = fleet.tacticalRadius ?? getFleetTacticalRadius(Math.max(ships.length, fleet.shipIds.length));
    const range = fleet.maxWeaponRange ?? 0;
    const status = fleet.combatStatus ?? "idle";
    return `
      <div class="fmDoctrinePanel">
        <div class="fmDoctrineHeader">
          <div class="fmPanelTitle">
            <span class="fmPanelIcon fmPanelIcon-doctrine" aria-hidden="true"></span>
            <strong>Fleet Doctrine</strong>
          </div>
          <span>${this.escapeHtml(this.formatCombatStatus(status))} | footprint ${this.formatCompact(tacticalRadius)} | max range ${this.formatCompact(range)}</span>
        </div>
        <div class="fmDoctrineGrid">
          <label>Stance ${this.renderFleetStanceSelect(fleet, canCommand)}</label>
          <label>Behavior ${this.renderFleetBehaviorSelect(fleet, canCommand)}</label>
          <label>Chase ${this.renderFleetChaseSelect(fleet, canCommand)}</label>
          <label>Auto-retreat ${this.renderFleetRetreatSelect(fleet, canCommand)}</label>
          <label class="wide">Retreat to ${this.renderFleetRetreatDestinationSelect(data, fleet, canCommand)}</label>
        </div>
      </div>
    `;
  }

  private renderFleetInfoCard(icon: string, label: string, value: string, ratio?: number): string {
    const clampedRatio = ratio === undefined ? null : Math.max(0, Math.min(1, ratio));
    return `
      <div class="fmInfoCard ${clampedRatio === null ? "" : "hasBar"}">
        <span class="fmInfoIcon fmInfoIcon-${this.escapeAttribute(icon)}" aria-hidden="true"></span>
        <div>
          <small>${this.escapeHtml(label)}</small>
          <strong>${this.escapeHtml(value)}</strong>
        </div>
        ${clampedRatio === null ? "" : `<span class="fmInfoBar" style="--info-ratio: ${(clampedRatio * 100).toFixed(1)}%" aria-hidden="true"><i></i></span>`}
      </div>
    `;
  }

  private renderFleetStanceSelect(fleet: ServerFleet, canCommand: boolean): string {
    const options: CombatStance[] = ["passive", "evade", "holdPosition", "guardArea", "defendSystem", "aggressive", "hunt"];
    return `
      <select data-fm-fleet-stance ${canCommand ? "" : "disabled"}>
        ${options.map((option) => `<option value="${option}" ${fleet.combatStance === option ? "selected" : ""}>${this.escapeHtml(this.formatCombatStance(option))}</option>`).join("")}
      </select>
    `;
  }

  private renderFleetBehaviorSelect(fleet: ServerFleet, canCommand: boolean): string {
    const options: FleetBehavior[] = ["artillery", "line", "brawler", "swarm", "defender"];
    return `
      <select data-fm-fleet-behavior ${canCommand ? "" : "disabled"}>
        ${options.map((option) => `<option value="${option}" ${fleet.combatSettings.behavior === option ? "selected" : ""}>${this.escapeHtml(this.formatFleetBehavior(option))}</option>`).join("")}
      </select>
    `;
  }

  private renderFleetChaseSelect(fleet: ServerFleet, canCommand: boolean): string {
    const options: FleetChasePolicy[] = ["none", "system", "friendlySystems", "neutralSystems", "enemySystems"];
    return `
      <select data-fm-fleet-chase ${canCommand ? "" : "disabled"}>
        ${options.map((option) => `<option value="${option}" ${fleet.combatSettings.chasePolicy === option ? "selected" : ""}>${this.escapeHtml(this.formatFleetChasePolicy(option))}</option>`).join("")}
      </select>
    `;
  }

  private renderFleetRetreatSelect(fleet: ServerFleet, canCommand: boolean): string {
    const options: FleetRetreatPolicy[] = ["none", "low", "medium", "high"];
    return `
      <select data-fm-fleet-retreat ${canCommand ? "" : "disabled"}>
        ${options.map((option) => `<option value="${option}" ${fleet.combatSettings.retreatPolicy === option ? "selected" : ""}>${this.escapeHtml(this.formatFleetRetreatPolicy(option))}</option>`).join("")}
      </select>
    `;
  }

  private renderFleetRetreatDestinationSelect(data: FleetManagerPanelData, fleet: ServerFleet, canCommand: boolean): string {
    const destination = fleet.combatSettings.retreatDestination;
    const selectedValue = destination?.kind === "selectedSystem" && typeof destination.targetStarId === "number"
      ? `system:${destination.targetStarId}`
      : "nearestFriendlyStarbase";
    const systemOptions = data.stars.map((star, index) => `
      <option value="system:${index}" ${selectedValue === `system:${index}` ? "selected" : ""}>${this.escapeHtml(star.name)}</option>
    `).join("");
    return `
      <select data-fm-fleet-retreat-destination ${canCommand ? "" : "disabled"}>
        <option value="nearestFriendlyStarbase" ${selectedValue === "nearestFriendlyStarbase" ? "selected" : ""}>Nearest friendly starbase</option>
        ${systemOptions}
      </select>
    `;
  }

  private renderCompositionRows(
    data: FleetManagerPanelData,
    fleet: ServerFleet,
    ships: ServerShip[],
  ): string {
    if (ships.length > 0) {
      return ships.map((ship, index) => this.renderShipRow(data, fleet, ship, index)).join("");
    }
    if (fleet.shipIds.length > 0) {
      return fleet.shipIds.map((shipId, index) => this.renderShipPlaceholderRow(data, fleet, shipId, index)).join("");
    }
    return '<div class="fmEmpty">No ships assigned to this fleet.</div>';
  }

  private renderFleetCompositionPanel(data: FleetManagerPanelData, fleet: ServerFleet): string {
    const ships = this.getShipsForFleet(data, fleet.id);
    return `
      <div class="fmCompositionHeader">
        <div class="fmPanelTitle">
          <span class="fmPanelIcon fmPanelIcon-composition" aria-hidden="true"></span>
          <strong>Fleet Composition</strong>
        </div>
        <button class="fmAddShipsMini" type="button" data-fm-add-ships ${data.playerFactionId === fleet.ownerId ? "" : "disabled"}>+</button>
      </div>
      <div class="fmCompositionTableHeader" aria-hidden="true">
        <span>Ship</span>
        <span>Shields</span>
        <span>Armor</span>
        <span>Hull</span>
        <span>Power</span>
        <span>Actions</span>
      </div>
      <div class="fmCompositionList">
        ${this.renderCompositionRows(data, fleet, ships)}
      </div>
    `;
  }

  private renderShipRow(data: FleetManagerPanelData, fleet: ServerFleet, ship: ServerShip, index: number): string {
    const definition = STARBASE_SHIP_DEFINITIONS[ship.shipKind];
    const targetDesign = this.getTargetDesignForShip(data, ship);
    const shipPower = computeShipPower(ship, undefined, data.shipDesigns);
    return `
      <div class="fmCompositionRow">
        <div class="fmShipCell">
          <span class="fmShipThumb" aria-hidden="true"></span>
          <span class="fmShipCopy">
            <strong>${this.escapeHtml(this.getShipDisplayName(data, fleet, ship, index))}</strong>
            <small>${this.escapeHtml(definition?.label ?? ship.shipKind)}</small>
            ${index === 0 ? '<em>Flagship</em>' : ""}
            ${targetDesign ? `<em class="upgradeReady">Upgrade Ready</em>` : ""}
          </span>
        </div>
        ${this.renderShipDefenseCell("shields", ship.shield, ship.maxShield)}
        ${this.renderShipDefenseCell("armor", ship.armor, ship.maxArmor)}
        ${this.renderShipDefenseCell("hull", ship.hull, ship.maxHull)}
        <div class="fmShipPowerCell"><span class="fmActionIcon fmActionIcon-power" aria-hidden="true"></span><strong>${this.escapeHtml(this.formatPowerValue(shipPower))}</strong></div>
        ${this.renderShipActionButtons(data, fleet, ship.id, targetDesign)}
      </div>
    `;
  }

  private renderShipPlaceholderRow(data: FleetManagerPanelData, fleet: ServerFleet, shipId: string, index: number): string {
    return `
      <div class="fmCompositionRow">
        <div class="fmShipCell">
          <span class="fmShipThumb" aria-hidden="true"></span>
          <span class="fmShipCopy">
            <strong>${this.escapeHtml(this.getPlaceholderShipName(data, fleet, index))}</strong>
            <small>${this.escapeHtml(shipId)}</small>
            ${index === 0 ? '<em>Flagship</em>' : ""}
          </span>
        </div>
        ${this.renderShipDefenseCell("shields", 0, 0)}
        ${this.renderShipDefenseCell("armor", 0, 0)}
        ${this.renderShipDefenseCell("hull", 0, 0)}
        <div class="fmShipPowerCell"><span class="fmActionIcon fmActionIcon-power" aria-hidden="true"></span><strong>0K</strong></div>
        ${this.renderShipActionButtons(data, fleet, shipId, null)}
      </div>
    `;
  }

  private renderShipDefenseCell(kind: "shields" | "armor" | "hull", value: number, maxValue: number): string {
    return `
      <div class="fmShipDefenseCell">
        <span class="fmInfoIcon fmInfoIcon-${kind}" aria-hidden="true"></span>
        <strong>${Math.round(value)} / ${Math.round(maxValue)}</strong>
        <span class="fmShipStatBar" style="--ship-stat-ratio: ${(this.getRatio(value, maxValue) * 100).toFixed(1)}%" aria-hidden="true"><i></i></span>
      </div>
    `;
  }

  private renderShipActionButtons(
    data: FleetManagerPanelData,
    fleet: ServerFleet,
    shipId: string,
    targetDesign: ShipDesign | null,
  ): string {
    const canCommand = data.playerFactionId === fleet.ownerId;
    const shipyard = this.findShipyardInFleetSystem(data, fleet);
    const missingTechnology = targetDesign ? this.getDesignMissingTechnologyName(data, targetDesign) : null;
    const canUpgrade = canCommand && !!targetDesign && !!shipyard && !missingTechnology;
    const upgradeTitle = !targetDesign
      ? "Ship is already using the newest design"
      : missingTechnology
        ? `Requires ${missingTechnology}`
        : shipyard
        ? `Upgrade to ${targetDesign.name}`
        : "Move fleet to a completed shipyard system before upgrading";
    return `
      <div class="fmShipActions">
        <button type="button" title="Repair ship" aria-label="Repair ship ${this.escapeAttribute(shipId)}"><span class="fmActionIcon fmActionIcon-repair" aria-hidden="true"></span></button>
        <button type="button" title="${this.escapeAttribute(upgradeTitle)}" aria-label="Upgrade ship ${this.escapeAttribute(shipId)}" ${canUpgrade ? `data-fm-upgrade-ship="${this.escapeAttribute(shipId)}"` : "disabled"}><span class="fmActionIcon fmActionIcon-upgrade" aria-hidden="true"></span></button>
        <button class="danger" type="button" title="Destroy ship" aria-label="Destroy ship ${this.escapeAttribute(shipId)}"><span class="fmActionIcon fmActionIcon-trash" aria-hidden="true"></span></button>
      </div>
    `;
  }

  private renderNoSelectedFleet(): string {
    return `
      <div class="fmNoSelection">
        <div class="fmSectionTitle">Selected Fleet</div>
        <p>Select a fleet from the manager list.</p>
      </div>
    `;
  }

  private renderOverallStats(data: FleetManagerPanelData): string {
    const totalFleetPower = data.fleets.reduce((total, fleet, index) => (
      total + this.getFleetPowerValue(data, fleet, index)
    ), 0);
    return `
      <div class="fmStatsHeader">
        <div>
          <div class="fmSectionTitle">Overall Fleet Statistics</div>
          <span>Strategic readiness summary</span>
        </div>
      </div>
      <div class="fmOverallGrid">
        ${this.renderStat("Total Fleets", String(data.fleets.length))}
        ${this.renderStat("Total Ships", String(this.getTotalShipCount(data)))}
        ${this.renderStat("Fleet Power", this.formatPowerValue(totalFleetPower))}
        ${this.renderStat("Reinforcements", "Placeholder")}
        ${this.renderStat("Naval Capacity", "Placeholder")}
        ${this.renderStat("Command Limit", "Placeholder")}
        ${this.renderStat("Upkeep", "Placeholder")}
        ${this.renderStat("Readiness", "Placeholder")}
      </div>
      <div class="fmStatsNote">
        <strong>Shipyards</strong>
        <span>${this.getAvailableShipyardCount(data)} completed slip${this.getAvailableShipyardCount(data) === 1 ? "" : "s"} available.</span>
      </div>
    `;
  }

  private renderShipPicker(data: FleetManagerPanelData, fleet: ServerFleet): string {
    const nearest = this.findNearestShipyard(data, fleet);
    const designs = this.getActiveDesigns(data, fleet.ownerId);
    return `
      <div class="fmShipPicker">
        <div class="fmPickerHeader">
          <div>
            <strong>Add Ships</strong>
            <span>${nearest ? `Nearest shipyard: ${this.escapeHtml(this.getStarName(data, nearest.starId))}` : "No completed shipyard available"}</span>
          </div>
          <button type="button" data-fm-close-ship-picker aria-label="Close add ships">X</button>
        </div>
        <div class="fmBuildShipList">
          ${designs.length === 0 ? '<div class="fmEmpty">No active designs available.</div>' : designs.map((design) => {
            const stats = calculateShipDesignStats(design);
            const predictedAlloys = stats.alloyUpkeepPerDay * stats.buildDays;
            const missingTechnology = this.getDesignMissingTechnologyName(data, design);
            const canBuild = Boolean(nearest) && !missingTechnology;
            const note = missingTechnology
              ? `Requires ${missingTechnology}`
              : `${this.formatCompact(predictedAlloys)} alloys predicted | ${stats.buildDays.toFixed(1)} days | ${this.formatCompact(stats.crewDemand)} crew`;
            return `
              <button class="fmBuildShipCard" type="button" data-fm-build-ship="${design.shipKind}" data-fm-build-design="${this.escapeAttribute(design.id)}" ${canBuild ? "" : "disabled"}>
                <span class="fmShipIcon">${this.escapeHtml(this.getInitials(SHIP_HULL_DEFINITIONS[design.shipKind]?.label ?? design.shipKind))}</span>
                <span>
                  <strong>${this.escapeHtml(design.name)}</strong>
                  <small>${this.escapeHtml(SHIP_HULL_DEFINITIONS[design.shipKind]?.label ?? design.shipKind)}</small>
                  <em>${this.escapeHtml(note)}</em>
                </span>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  private renderShipDesigner(data: FleetManagerPanelData): string {
    const draft = this.getDesignerDraft(data);
    if (!draft) {
      return `
        <section class="fmDesignerBody">
          <article class="fmDesignerEmpty">
            <div class="fmSectionTitle">Ship Designer</div>
            <p>No ship designs are available.</p>
          </article>
        </section>
      `;
    }
    const stats = calculateShipDesignStats(draft);
    const layout = getShipDesignLayout(draft);
    const comparisonStats = this.getDesignStatComparisons(data, draft, stats);
    const activeDesignCount = this.getActiveDesigns(data, draft.ownerId, draft.shipKind).length;
    return `
      <section class="fmDesignerBody">
        <aside class="fmDesignListPane">
          <button class="fmNewDesignCard" type="button" data-fm-new-design>
            <span>+</span>
            <strong>New Design</strong>
          </button>
          ${this.renderDesignList(data, draft)}
        </aside>
        <main class="fmDesignWorkbench">
          <div class="fmDesignNameBar">
            <input type="text" value="${this.escapeAttribute(draft.name)}" maxlength="40" data-fm-design-name aria-label="Design name">
            <button class="fmNameSaveButton" type="button" data-fm-save-design-name>Save Name</button>
          </div>
          <div class="fmDesignViewport" data-fm-ship-preview aria-label="Ship preview">
            <div class="fmPreviewOverlay">
              <div class="fmTopSlotTray">
                <div class="fmCoreSelector">
                  <div class="fmSectionModuleRow">
                    ${draft.weaponSectionModuleIds.map((moduleId, index) => this.renderSectionModuleSlot("weaponSection", index, moduleId)).join("")}
                  </div>
                </div>
                <div class="fmPreviewSlotGroup fmWeaponGroup">
                  <div class="fmSlotRow fmWeaponSlots">
                    ${layout.weaponSlots.map((slot, index) => this.renderDesignSlot("weapon", index, draft.weaponModuleIds[index], slot)).join("")}
                  </div>
                </div>
              </div>
              <div class="fmBottomSlotTray">
                <div class="fmPreviewSlotGroup fmDefenseGroup">
                  <div class="fmSlotRow fmDefenseSlots">
                    ${layout.defenseSlots.map((slot, index) => this.renderDesignSlot("defense", index, draft.defenseModuleIds[index], slot)).join("")}
                  </div>
                </div>
              </div>
              <div class="fmUtilityRail">
                <div class="fmSlotColumn">
                  ${layout.utilitySlots.map((slot, index) => this.renderDesignSlot("utility", index, draft.utilityModuleIds[index], slot)).join("")}
                </div>
              </div>
              ${this.selectedDesignerSlot ? `<div class="fmModulePalette fmPreviewPalette">${this.renderModulePalette()}</div>` : ""}
            </div>
          </div>
        </main>
        <aside class="fmDesignStatsPane">
          <div class="fmStatsHeader">
            <div>
              <div class="fmSectionTitle">Ship Stats</div>
              <span>${this.escapeHtml(stats.className)}</span>
            </div>
          </div>
          <div class="fmOverallGrid fmDesignStatGrid">
            ${comparisonStats.map((metric) => this.renderDesignStatBar(metric)).join("")}
          </div>
          ${this.renderResourceBreakdown("Cost", stats.cost)}
          ${this.renderResourceBreakdown("Upkeep", stats.upkeep)}
          <div class="fmControlStack">
            <button type="button" data-fm-clear-design>Auto-complete</button>
            <button type="button" data-fm-save-design>Save</button>
            <button type="button" data-fm-decommission-design ${draft.id && activeDesignCount > 1 ? "" : "disabled"}>Decommission</button>
          </div>
        </aside>
      </section>
    `;
  }

  private renderDesignList(data: FleetManagerPanelData, draft: ShipDesign): string {
    const groups = new Map<StarbaseShipKind, ShipDesign[]>();
    for (const design of data.shipDesigns.filter((candidate) => candidate.status === "active")) {
      if (data.playerFactionId !== null && design.ownerId !== data.playerFactionId) continue;
      const list = groups.get(design.shipKind) ?? [];
      list.push(design);
      groups.set(design.shipKind, list);
    }
    const orderedKinds: StarbaseShipKind[] = ["corvette"];
    return orderedKinds.map((shipKind) => {
      const designs = (groups.get(shipKind) ?? []).sort((a, b) => a.name.localeCompare(b.name));
      if (designs.length === 0) return "";
      const hull = SHIP_HULL_DEFINITIONS[shipKind];
      return `
        <div class="fmDesignTypeGroup">
          <div class="fmDesignTypeLabel">${this.escapeHtml(hull?.label ?? shipKind)}</div>
          ${designs.map((design) => `
            <button class="fmDesignCard ${draft.id === design.id ? "selected" : ""}" type="button" data-fm-select-design="${this.escapeAttribute(design.id)}">
              <span class="fmDesignThumb fmShipSilhouette" aria-hidden="true"></span>
              <span class="fmDesignCardCopy">
                <strong>${this.escapeHtml(design.name)}</strong>
                <small>${this.escapeHtml(hull?.label ?? shipKind)}</small>
                <span class="fmDesignModuleStrip">${this.renderDesignModuleStrip(design)}</span>
              </span>
            </button>
          `).join("")}
        </div>
      `;
    }).join("");
  }

  private renderSectionModuleSlot(
    kind: ShipSectionSlotType,
    index: number,
    moduleId: string | null | undefined,
  ): string {
    const module = getShipSectionModuleDefinition(moduleId);
    const slot = `${kind}:${index}`;
    const selected = this.selectedDesignerSlot === slot;
    const slotSummary = (module?.slots ?? [])
      .map((componentSlot) => componentSlot.kind === "weapon" ? WEAPON_SLOT_SIZE_LABELS[componentSlot.size ?? "small"] : "D")
      .join(" ");
    return `
      <button class="fmSectionModuleSlot ${selected ? "selected" : ""} ${module ? "" : "empty"}" type="button" data-fm-design-slot="${this.escapeAttribute(slot)}" title="${this.escapeAttribute(module?.description ?? "Select section module")}">
        ${this.renderModuleGlyph(module, "section")}
        <span>
          <strong>${this.escapeHtml(module?.label ?? "Section Module")}</strong>
          <small>${this.escapeHtml(slotSummary)}</small>
        </span>
      </button>
    `;
  }

  private renderDesignSlot(
    kind: ShipComponentSlotType,
    index: number,
    moduleId: string | null | undefined,
    componentSlot: ShipComponentSlotDefinition,
  ): string {
    const module = getShipModuleDefinition(moduleId);
    const slot = `${kind}:${index}`;
    const selected = this.selectedDesignerSlot === slot;
    const emptyLabel = kind === "utility" ? "Utility" : kind === "weapon" ? "Weapon" : "Defense";
    const sizeLabel = componentSlot.kind === "weapon" ? WEAPON_SLOT_SIZE_LABELS[componentSlot.size ?? "small"] : "";
    return `
      <button class="fmDesignSlot ${selected ? "selected" : ""} ${module ? "" : "empty"}" type="button" data-fm-design-slot="${this.escapeAttribute(slot)}" title="${this.escapeAttribute(module?.label ?? emptyLabel)}">
        ${this.renderModuleGlyph(module, sizeLabel ? "component hasSize" : "component")}
        <strong>${this.escapeHtml(this.getCompactModuleLabel(module?.label ?? emptyLabel))}</strong>
        ${sizeLabel ? `<small>${this.escapeHtml(sizeLabel)}</small>` : ""}
      </button>
    `;
  }

  private renderModulePalette(): string {
    if (!this.selectedDesignerSlot) return "";
    const slot = this.parseDesignerSlot(this.selectedDesignerSlot);
    const modules = this.getModulesForSlot(slot.kind, slot.index);
    return `
      <div class="fmPaletteHeader">
        <strong>${this.escapeHtml(this.formatSlotKind(slot.kind))}</strong>
      </div>
      <div class="fmPaletteList">
        ${modules.map((module) => this.renderModuleButton(module)).join("")}
      </div>
    `;
  }

  private renderModuleButton(module: DesignerModuleOption): string {
    const selected = this.isModuleSelectedInSlot(module.id);
    return `
      <button class="fmModuleButton ${selected ? "selected" : ""}" type="button" data-fm-module="${this.escapeAttribute(module.id)}" title="${this.escapeAttribute(module.description)}">
        ${this.renderModuleGlyph(module, "palette")}
        <span>
          <strong>${this.escapeHtml(module.label)}</strong>
          <small>${this.escapeHtml(this.getModuleMetaLabel(module))}</small>
        </span>
      </button>
    `;
  }

  private renderDesignModuleStrip(design: ShipDesign): string {
    const modules: DesignerModuleOption[] = [
      ...design.weaponSectionModuleIds.map((id) => getShipSectionModuleDefinition(id)),
      ...design.weaponModuleIds.map((id) => getShipModuleDefinition(id)),
      ...design.defenseModuleIds.map((id) => getShipModuleDefinition(id)),
      ...design.utilityModuleIds.slice(0, 3).map((id) => getShipModuleDefinition(id)),
    ].filter((module): module is DesignerModuleOption => !!module);
    return modules.slice(0, 9).map((module) => this.renderModuleGlyph(module, "strip")).join("");
  }

  private renderModuleGlyph(
    module: DesignerModuleOption | null | undefined,
    variant = "",
  ): string {
    const iconKind = module?.iconKind ?? (module?.slotType === "weapon" ? module.weaponKind : module?.slotType ?? "empty");
    const title = module?.label ?? "Empty";
    const sizeClass = module && "weaponSize" in module && module.weaponSize ? ` fmSize-${module.weaponSize}` : "";
    return `<span class="fmModuleGlyph fmIcon-${this.escapeAttribute(iconKind)} ${this.escapeAttribute(variant)}${sizeClass}" title="${this.escapeAttribute(title)}" aria-hidden="true"></span>`;
  }

  private renderTab(tab: FleetManagerTab, label: string): string {
    return `<button class="${this.activeTab === tab ? "active" : ""}" type="button" data-fm-tab="${tab}">${label}</button>`;
  }

  private renderStat(label: string, value: string): string {
    return `
      <div class="fmStat">
        <span>${this.escapeHtml(label)}</span>
        <strong>${this.escapeHtml(value)}</strong>
      </div>
    `;
  }

  private ensureDesignerDraft(data: FleetManagerPanelData): void {
    const available = this.getActiveDesigns(data, data.playerFactionId ?? undefined);
    const selected = this.selectedDesignId
      ? data.shipDesigns.find((design) => design.id === this.selectedDesignId)
      : null;
    if (this.designerDraft && (!this.selectedDesignId || selected)) return;
    const design = selected ?? available[0] ?? data.shipDesigns.find((candidate) => candidate.status === "active");
    this.selectedDesignId = design?.id ?? null;
    this.designerDraft = design ? this.cloneDesign(design) : null;
  }

  private getDesignerDraft(data: FleetManagerPanelData): ShipDesign | null {
    this.ensureDesignerDraft(data);
    return this.designerDraft;
  }

  private cloneDesign(design: ShipDesign): ShipDesign {
    return {
      ...design,
      weaponSectionModuleIds: [...design.weaponSectionModuleIds],
      defenseSectionModuleIds: [...design.defenseSectionModuleIds],
      weaponModuleIds: [...design.weaponModuleIds],
      defenseModuleIds: [...design.defenseModuleIds],
      utilityModuleIds: [...design.utilityModuleIds],
    };
  }

  private getDesignById(data: FleetManagerPanelData, designId: string | null | undefined): ShipDesign | null {
    if (!designId) return null;
    return data.shipDesigns.find((design) => design.id === designId) ?? null;
  }

  private getActiveDesigns(
    data: FleetManagerPanelData,
    ownerId?: number | null,
    shipKind?: StarbaseShipKind,
  ): ShipDesign[] {
    return data.shipDesigns
      .filter((design) => (
        design.status === "active"
        && (ownerId === undefined || ownerId === null || design.ownerId === ownerId)
        && (!shipKind || design.shipKind === shipKind)
      ))
      .sort((a, b) => {
        const kindDelta = a.shipKind.localeCompare(b.shipKind);
        return kindDelta !== 0 ? kindDelta : a.name.localeCompare(b.name);
      });
  }

  private getNewestActiveDesign(
    data: FleetManagerPanelData,
    ownerId: number,
    shipKind: StarbaseShipKind,
  ): ShipDesign | null {
    return data.shipDesigns
      .filter((design) => design.status === "active" && design.ownerId === ownerId && design.shipKind === shipKind)
      .sort((a, b) => {
        const yearDelta = (b.updatedAtYear ?? b.createdAtYear) - (a.updatedAtYear ?? a.createdAtYear);
        if (yearDelta !== 0) return yearDelta;
        return b.createdAtYear - a.createdAtYear;
      })[0] ?? null;
  }

  private getTargetDesignForShip(data: FleetManagerPanelData, ship: ServerShip): ShipDesign | null {
    const currentDesign = this.getDesignById(data, ship.designId);
    const assignedTarget = this.getDesignById(data, ship.targetDesignId);
    if (assignedTarget?.status === "active" && assignedTarget.id !== currentDesign?.id) return assignedTarget;
    const newest = this.getNewestActiveDesign(data, ship.ownerId, ship.shipKind);
    if (newest && newest.id !== currentDesign?.id && currentDesign?.status === "decommissioned") return newest;
    return null;
  }

  private getDesignMissingTechnologyName(data: FleetManagerPanelData, design: ShipDesign): string | null {
    const technology = data.technology;
    const hullTechs = getRequiredTechIdsForShipHull(design.shipKind);
    if (!this.areRequiredTechsCompleted(technology, hullTechs)) return getFirstRequiredTechName(hullTechs);
    for (const sectionModuleId of [...design.weaponSectionModuleIds, ...design.defenseSectionModuleIds]) {
      const required = getRequiredTechIdsForShipSection(sectionModuleId);
      if (!this.areRequiredTechsCompleted(technology, required)) return getFirstRequiredTechName(required);
    }
    for (const moduleId of [...design.weaponModuleIds, ...design.defenseModuleIds, ...design.utilityModuleIds]) {
      const required = getRequiredTechIdsForShipModule(moduleId);
      if (!this.areRequiredTechsCompleted(technology, required)) return getFirstRequiredTechName(required);
    }
    return null;
  }

  private isShipModuleUnlocked(technology: FactionTechnologyView | null | undefined, moduleId: string): boolean {
    return this.areRequiredTechsCompleted(technology, getRequiredTechIdsForShipModule(moduleId));
  }

  private isShipSectionUnlocked(technology: FactionTechnologyView | null | undefined, sectionModuleId: string): boolean {
    return this.areRequiredTechsCompleted(technology, getRequiredTechIdsForShipSection(sectionModuleId));
  }

  private areRequiredTechsCompleted(technology: FactionTechnologyView | null | undefined, requiredTechIds: TechId[]): boolean {
    if (requiredTechIds.length === 0) return true;
    return requiredTechIds.some((techId) => technology?.completedTechIds.includes(techId) === true);
  }

  private parseDesignerSlot(slot: string): { kind: DesignerSlotKind; index: number } {
    const [kind, indexText] = slot.split(":");
    if (kind === "defense" || kind === "utility" || kind === "weapon" || kind === "weaponSection" || kind === "defenseSection") {
      return { kind, index: Math.max(0, Number(indexText) || 0) };
    }
    return { kind: "weaponSection", index: 0 };
  }

  private getModulesForSlot(kind: DesignerSlotKind, index: number): DesignerModuleOption[] {
    if (!this.designerDraft) return [];
    const technology = this.currentData?.technology;
    if (kind === "weaponSection" || kind === "defenseSection") {
      return getShipSectionModulesForKind(this.designerDraft.shipKind, kind)
        .filter((module) => this.isShipSectionUnlocked(technology, module.id));
    }
    const layout = getShipDesignLayout(this.designerDraft);
    const slots = kind === "weapon"
      ? layout.weaponSlots
      : kind === "defense"
        ? layout.defenseSlots
        : layout.utilitySlots;
    const slot = slots[index];
    return slot
      ? getShipModulesForComponentSlot(this.designerDraft.shipKind, slot)
        .filter((module) => this.isShipModuleUnlocked(technology, module.id))
      : [];
  }

  private applyModuleToDraft(moduleId: string): void {
    if (!this.designerDraft) return;
    if (!this.selectedDesignerSlot) return;
    const slot = this.parseDesignerSlot(this.selectedDesignerSlot);
    if (slot.kind === "weaponSection" || slot.kind === "defenseSection") {
      const module = getShipSectionModuleDefinition(moduleId);
      if (!module || module.slotType !== slot.kind || !module.shipKinds.includes(this.designerDraft.shipKind)) return;
      if (slot.kind === "weaponSection" && slot.index < this.designerDraft.weaponSectionModuleIds.length) {
        this.designerDraft.weaponSectionModuleIds[slot.index] = moduleId;
      } else if (slot.kind === "defenseSection" && slot.index < this.designerDraft.defenseSectionModuleIds.length) {
        this.designerDraft.defenseSectionModuleIds[slot.index] = moduleId;
      }
      this.normalizeDesignerDraft();
      return;
    }

    const module = getShipModuleDefinition(moduleId);
    if (!module || module.slotType !== slot.kind) return;
    if (slot.kind === "weapon" && slot.index < this.designerDraft.weaponModuleIds.length) {
      this.designerDraft.weaponModuleIds[slot.index] = moduleId;
    } else if (slot.kind === "defense" && slot.index < this.designerDraft.defenseModuleIds.length) {
      this.designerDraft.defenseModuleIds[slot.index] = moduleId;
    } else if (slot.kind === "utility" && slot.index < this.designerDraft.utilityModuleIds.length) {
      this.designerDraft.utilityModuleIds[slot.index] = moduleId;
      this.designerDraft.utilityModuleId = moduleId;
    }
    this.normalizeDesignerDraft();
  }

  private isModuleSelectedInSlot(moduleId: string): boolean {
    if (!this.designerDraft) return false;
    if (!this.selectedDesignerSlot) return false;
    const slot = this.parseDesignerSlot(this.selectedDesignerSlot);
    if (slot.kind === "weaponSection") return this.designerDraft.weaponSectionModuleIds[slot.index] === moduleId;
    if (slot.kind === "defenseSection") return this.designerDraft.defenseSectionModuleIds[slot.index] === moduleId;
    if (slot.kind === "weapon") return this.designerDraft.weaponModuleIds[slot.index] === moduleId;
    if (slot.kind === "defense") return this.designerDraft.defenseModuleIds[slot.index] === moduleId;
    return this.designerDraft.utilityModuleIds[slot.index] === moduleId;
  }

  private normalizeDesignerDraft(): void {
    if (!this.designerDraft) return;
    this.designerDraft = normalizeShipDesign(this.designerDraft, this.designerDraft.ownerId, this.currentData?.clockYear ?? this.designerDraft.updatedAtYear);
  }

  private formatSlotKind(kind: DesignerSlotKind): string {
    if (kind === "weaponSection") return "Core Modules";
    if (kind === "defenseSection") return "Core Defense";
    if (kind === "defense") return "Defense Components";
    if (kind === "utility") return "Utility Components";
    return "Weapons";
  }

  private getModuleMetaLabel(module: DesignerModuleOption): string {
    if (module.slotType === "weaponSection" || module.slotType === "defenseSection") {
      return module.slots
        .map((slot) => slot.kind === "weapon" ? WEAPON_SLOT_SIZE_LABELS[slot.size ?? "small"] : "D")
        .join(" ");
    }
    if (module.slotType === "weapon") return `${WEAPON_SLOT_SIZE_LABELS[module.weaponSize ?? "small"]} hardpoint`;
    if (module.slotType === "defense") return module.defenseKind ?? "defense";
    return "utility";
  }

  private getCompactModuleLabel(label: string): string {
    return label
      .replace(/^S\s+/, "")
      .replace(/^M\s+/, "")
      .replace(/^L\s+/, "")
      .replace("Point Defense", "PD")
      .replace("Missile Rack", "Missile")
      .replace("Laser Cannon", "Laser")
      .replace("Shield Generator", "Shield")
      .replace("Armor Plating", "Armor")
      .replace("Reinforced Hull", "Hull")
      .replace("Reactor Capacitor", "Reactor")
      .replace("Shield Capacitor", "Capacitor")
      .replace("Repair Drones", "Repair");
  }

  private formatResources(resources: Record<string, number>): string {
    const parts = Object.entries(resources)
      .filter(([, value]) => Math.abs(value) > 0.001)
      .map(([resource, value]) => `${this.formatCompact(value)} ${resource}`);
    return parts.length > 0 ? parts.join(" | ") : "None";
  }

  private getDesignStatComparisons(
    data: FleetManagerPanelData,
    draft: ShipDesign,
    stats: ShipDesignStats,
  ): DesignStatComparison[] {
    const galaxyDesigns = data.shipDesigns
      .filter((design) => design.status === "active")
      .filter((design) => design.id !== draft.id);
    const comparisonDesigns = [...galaxyDesigns, draft];
    const sampleStats = comparisonDesigns.map((design) => this.getComparableStatValues(calculateShipDesignStats(design)));
    const current = this.getComparableStatValues(stats);
    const metricLabels: Array<{ id: DesignStatMetricId; label: string }> = [
      { id: "power", label: "Power" },
      { id: "damage", label: "Damage" },
      { id: "shields", label: "Shields" },
      { id: "armor", label: "Armor" },
      { id: "hull", label: "Hull" },
      { id: "evasion", label: "Evasion" },
      { id: "speed", label: "Speed" },
      { id: "sensor", label: "Sensor" },
    ];

    return metricLabels.map(({ id, label }) => ({
      id,
      label,
      value: current[id],
      displayValue: this.formatDesignStatValue(id, current[id]),
      score: this.calculateDistributionScore(current[id], sampleStats.map((sample) => sample[id])),
    }));
  }

  private getComparableStatValues(stats: ShipDesignStats): Record<DesignStatMetricId, number> {
    return {
      power: computeCombatPowerFromStats(stats.combat),
      damage: stats.combat.weaponMounts.reduce((sum, mount) => sum + mount.damage * mount.barrels, 0),
      shields: stats.combat.maxShield,
      armor: stats.combat.maxArmor,
      hull: stats.combat.maxHull,
      evasion: stats.combat.evasion * 100,
      speed: stats.speed,
      sensor: stats.combat.sensorRange,
    };
  }

  private calculateDistributionScore(value: number, samples: number[]): number {
    const sorted = samples
      .filter((sample) => Number.isFinite(sample))
      .sort((a, b) => a - b);
    if (sorted.length <= 1) return 50;
    const min = sorted[0];
    const q1 = this.quantile(sorted, 0.25);
    const median = this.quantile(sorted, 0.5);
    const q3 = this.quantile(sorted, 0.75);
    const max = sorted[sorted.length - 1];
    if (Math.abs(max - min) < 0.0001) return 50;
    if (value <= q1) return this.interpolateScore(value, min, q1, 0, 25);
    if (value <= median) return this.interpolateScore(value, q1, median, 25, 50);
    if (value <= q3) return this.interpolateScore(value, median, q3, 50, 75);
    return this.interpolateScore(value, q3, max, 75, 100);
  }

  private quantile(sorted: number[], q: number): number {
    if (sorted.length === 0) return 0;
    const position = (sorted.length - 1) * q;
    const base = Math.floor(position);
    const rest = position - base;
    return sorted[base + 1] === undefined
      ? sorted[base]
      : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }

  private interpolateScore(value: number, fromValue: number, toValue: number, fromScore: number, toScore: number): number {
    if (Math.abs(toValue - fromValue) < 0.0001) return (fromScore + toScore) / 2;
    const progress = Math.max(0, Math.min(1, (value - fromValue) / (toValue - fromValue)));
    return fromScore + progress * (toScore - fromScore);
  }

  private formatDesignStatValue(id: DesignStatMetricId, value: number): string {
    if (id === "evasion") return `${Math.round(value)}%`;
    if (id === "speed") return value.toFixed(2);
    if (id === "sensor") return value.toFixed(1);
    return this.formatCompact(value);
  }

  private renderDesignStatBar(metric: DesignStatComparison): string {
    const score = Math.max(0, Math.min(100, metric.score));
    return `
      <div class="fmDesignStatBar" style="--stat-score: ${score.toFixed(1)}%">
        <span class="fmMetricIcon fmMetricIcon-${this.escapeAttribute(metric.id)}" aria-hidden="true"></span>
        <span class="fmDesignStatText">
          <strong>${this.escapeHtml(metric.label)}</strong>
          <small>${this.escapeHtml(metric.displayValue)}</small>
        </span>
        <span class="fmStatTrack" aria-hidden="true"><i></i></span>
      </div>
    `;
  }

  private renderResourceBreakdown(label: string, resources: Record<string, number>): string {
    const rows = Object.entries(resources)
      .filter(([, value]) => Math.abs(value) > 0.001)
      .map(([resource, value]) => `
        <span class="fmResourceRow">
          <span class="fmResourceIcon fmResourceIcon-${this.escapeAttribute(resource)}" aria-hidden="true"></span>
          <strong>${this.escapeHtml(this.formatCompact(value))}</strong>
          <small>${this.escapeHtml(this.formatResourceLabel(resource))}</small>
        </span>
      `);
    return `
      <div class="fmStatsNote">
        <strong>${this.escapeHtml(label)}</strong>
        <span class="fmResourceRows">${rows.length > 0 ? rows.join("") : "None"}</span>
      </div>
    `;
  }

  private formatResourceLabel(resource: string): string {
    return resource.slice(0, 1).toUpperCase() + resource.slice(1);
  }

  private ensureSelectedFleet(data: FleetManagerPanelData): void {
    if (this.selectedFleetId && data.fleets.some((fleet) => fleet.id === this.selectedFleetId)) return;
    const ownFleet = data.playerFactionId === null
      ? null
      : data.fleets.find((fleet) => fleet.ownerId === data.playerFactionId);
    this.selectedFleetId = (ownFleet ?? data.fleets[0])?.id ?? null;
    this.addShipsOpen = false;
  }

  private getSelectedFleet(data: FleetManagerPanelData): ServerFleet | null {
    if (!this.selectedFleetId) return null;
    return data.fleets.find((fleet) => fleet.id === this.selectedFleetId) ?? null;
  }

  private getShipsForFleet(data: FleetManagerPanelData, fleetId: string): ServerShip[] {
    return data.ships.filter((ship) => ship.fleetId === fleetId);
  }

  private getFleetShipCount(data: FleetManagerPanelData, fleet: ServerFleet): number {
    return Math.max(fleet.shipIds.length, this.getShipsForFleet(data, fleet.id).length);
  }

  private getTotalShipCount(data: FleetManagerPanelData): number {
    return data.fleets.reduce((total, fleet) => total + this.getFleetShipCount(data, fleet), 0);
  }

  private getFleetDefense(data: FleetManagerPanelData, fleet: ServerFleet): {
    shield: number;
    maxShield: number;
    armor: number;
    maxArmor: number;
    hull: number;
    maxHull: number;
  } {
    const ships = this.getShipsForFleet(data, fleet.id);
    if (ships.length === 0) {
      return { shield: 0, maxShield: 0, armor: 0, maxArmor: 0, hull: 0, maxHull: 0 };
    }
    return ships.reduce(
      (total, ship) => ({
        shield: total.shield + ship.shield,
        maxShield: total.maxShield + ship.maxShield,
        armor: total.armor + ship.armor,
        maxArmor: total.maxArmor + ship.maxArmor,
        hull: total.hull + ship.hull,
        maxHull: total.maxHull + ship.maxHull,
      }),
      { shield: 0, maxShield: 0, armor: 0, maxArmor: 0, hull: 0, maxHull: 0 },
    );
  }

  private getRatio(value: number, maxValue: number): number {
    return maxValue > 0 ? Math.max(0, Math.min(1, value / maxValue)) : 0;
  }

  private getShipDisplayName(data: FleetManagerPanelData, fleet: ServerFleet, ship: ServerShip, index: number): string {
    return this.getPlaceholderShipName(data, fleet, index);
  }

  private getPlaceholderShipName(data: FleetManagerPanelData, fleet: ServerFleet, index: number): string {
    const owner = this.getFaction(data, fleet.ownerId);
    const prefix = this.getShipNamePrefix(owner?.name ?? "Fleet");
    const callsigns = ["Spearhead", "Lancer", "Valiant", "Arrow", "Vanguard", "Sentinel", "Defender", "Aegis", "Pioneer", "Ranger"];
    return `${prefix}-${String(index + 1).padStart(2, "0")} ${callsigns[index % callsigns.length]}`;
  }

  private getShipNamePrefix(name: string): string {
    const digit = name.match(/\d+/)?.[0];
    if (digit) return `C${digit}S`;
    const letters = name
      .split(/\s+/)
      .map((word) => word[0])
      .join("")
      .replace(/[^A-Za-z]/g, "")
      .slice(0, 2)
      .toUpperCase();
    return `${letters || "FL"}S`;
  }

  private getShipsDefense(ships: ServerShip[]): { total: number; maxTotal: number } {
    return ships.reduce(
      (total, ship) => ({
        total: total.total + ship.shield + ship.armor + ship.hull,
        maxTotal: total.maxTotal + ship.maxShield + ship.maxArmor + ship.maxHull,
      }),
      { total: 0, maxTotal: 0 },
    );
  }

  private formatCombatStance(stance: CombatStance): string {
    const labels: Record<CombatStance, string> = {
      passive: "Passive",
      evade: "Evade",
      holdPosition: "Hold Position",
      guardArea: "Guard Area",
      defendSystem: "Defend System",
      aggressive: "Aggressive",
      hunt: "Hunt",
    };
    return labels[stance] ?? stance;
  }

  private formatFleetBehavior(behavior: FleetBehavior): string {
    const labels: Record<FleetBehavior, string> = {
      artillery: "Artillery",
      line: "Line",
      brawler: "Brawler",
      swarm: "Swarm",
      defender: "Defender",
    };
    return labels[behavior] ?? behavior;
  }

  private formatFleetChasePolicy(chase: FleetChasePolicy): string {
    const labels: Record<FleetChasePolicy, string> = {
      none: "No chase",
      system: "In system",
      friendlySystems: "Friendly systems",
      neutralSystems: "Neutral systems",
      enemySystems: "Enemy systems",
    };
    return labels[chase] ?? chase;
  }

  private formatFleetRetreatPolicy(policy: FleetRetreatPolicy): string {
    const labels: Record<FleetRetreatPolicy, string> = {
      none: "No auto-retreat",
      low: "Low HP 25%",
      medium: "Medium HP 50%",
      high: "High HP 75%",
    };
    return labels[policy] ?? policy;
  }

  private formatCombatStatus(status: ServerFleet["combatStatus"]): string {
    const labels: Record<NonNullable<ServerFleet["combatStatus"]>, string> = {
      idle: "Idle",
      maneuvering: "Maneuvering",
      engaging: "Engaging",
      firing: "Firing",
      evading: "Evading",
      retreating: "Retreating",
      destroyed: "Destroyed",
    };
    return labels[status ?? "idle"] ?? status ?? "Idle";
  }

  private getDoctrineDescription(stance: CombatStance, behavior: FleetBehavior): string {
    const stanceCopy: Record<CombatStance, string> = {
      passive: "Won't initiate unless ordered to attack.",
      evade: "Avoids threats and fires only while escaping.",
      holdPosition: "Keeps its current position and fires in range.",
      guardArea: "Intercepts nearby threats, then returns to guard.",
      defendSystem: "Moves to engage hostiles in this system.",
      aggressive: "Seeks in-system targets and pursues by chase policy.",
      hunt: "Prioritizes damaged or retreating hostiles.",
    };
    const behaviorCopy: Record<FleetBehavior, string> = {
      artillery: "Artillery prefers long range and kites close enemies.",
      line: "Line closes until most weapons can fire, then holds spacing.",
      brawler: "Brawler closes to short range and sticks to the target.",
      swarm: "Swarm charges directly and fights at point blank.",
      defender: "Defender favors guarded objectives and local intercepts.",
    };
    return `${stanceCopy[stance] ?? ""} ${behaviorCopy[behavior] ?? ""}`.trim();
  }

  private getFleetName(data: FleetManagerPanelData, fleet: ServerFleet, index: number): string {
    const owner = this.getFaction(data, fleet.ownerId);
    const suffix = data.fleets.filter((candidate) => candidate.ownerId === fleet.ownerId).length > 1
      ? ` ${index + 1}`
      : "";
    return owner ? `${owner.name} Fleet${suffix}` : `Unidentified Fleet ${index + 1}`;
  }

  private getPanelSubtitle(data: FleetManagerPanelData): string {
    const player = data.playerFactionId === null ? null : this.getFaction(data, data.playerFactionId);
    return player ? `${player.name} Fleet Command` : "Observer Fleet Command";
  }

  private getFaction(data: FleetManagerPanelData, ownerId: number): FactionInfo | null {
    return data.factions.find((faction) => faction.id === ownerId) ?? null;
  }

  private getStarName(data: FleetManagerPanelData, starId: number): string {
    return data.stars[starId]?.name ?? `Star ${starId}`;
  }

  private findNearestShipyard(data: FleetManagerPanelData, fleet: ServerFleet): ServerStarbase | null {
    if (data.playerFactionId !== null && fleet.ownerId !== data.playerFactionId) return null;
    const fleetPosition = this.getFleetMapPosition(data, fleet);
    if (!fleetPosition) return null;
    let nearest: ServerStarbase | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const starbase of data.starbases) {
      if (starbase.ownerId !== fleet.ownerId) continue;
      if (starbase.status !== "online") continue;
      if (countStarbaseShipyards(starbase.buildingSlots) <= 0) continue;
      const star = data.stars[starbase.starId];
      if (!star) continue;
      const dx = star.x - fleetPosition.x;
      const dz = star.z - fleetPosition.z;
      const distance = dx * dx + dz * dz;
      if (distance < nearestDistance) {
        nearest = starbase;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private findShipyardInFleetSystem(data: FleetManagerPanelData, fleet: ServerFleet): ServerStarbase | null {
    if (data.playerFactionId !== null && fleet.ownerId !== data.playerFactionId) return null;
    return data.starbases.find((starbase) => (
      starbase.ownerId === fleet.ownerId
      && starbase.starId === fleet.currentStarId
      && starbase.status === "online"
      && countStarbaseShipyards(starbase.buildingSlots) > 0
    )) ?? null;
  }

  private getFleetMapPosition(data: FleetManagerPanelData, fleet: ServerFleet): { x: number; z: number } | null {
    if (fleet.hyperlanePosition) {
      const from = data.stars[fleet.hyperlanePosition.fromStarId];
      const to = data.stars[fleet.hyperlanePosition.toStarId];
      if (!from || !to) return null;
      const progress = Math.max(0, Math.min(1, fleet.hyperlanePosition.progress));
      return {
        x: from.x + (to.x - from.x) * progress,
        z: from.z + (to.z - from.z) * progress,
      };
    }
    const star = data.stars[fleet.currentStarId];
    return star ? { x: star.x, z: star.z } : null;
  }

  private getAvailableShipyardCount(data: FleetManagerPanelData): number {
    const playerFactionId = data.playerFactionId;
    return data.starbases
      .filter((starbase) => (
        starbase.status === "online"
        && (playerFactionId === null || starbase.ownerId === playerFactionId)
      ))
      .reduce((total, starbase) => total + countStarbaseShipyards(starbase.buildingSlots), 0);
  }

  private getFleetPowerValue(data: FleetManagerPanelData, fleet: ServerFleet, index: number): number {
    const ships = this.getShipsForFleet(data, fleet.id);
    return computeFleetPower(ships, Math.max(1, this.getFleetShipCount(data, fleet)), undefined, data.shipDesigns);
  }

  private formatFleetPower(data: FleetManagerPanelData, fleet: ServerFleet, index: number): string {
    return this.formatPowerValue(this.getFleetPowerValue(data, fleet, index));
  }

  private formatPowerValue(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${Math.round(value / 1000)}K`;
    return String(Math.round(value));
  }

  private formatFleetStatus(fleet: ServerFleet): string {
    switch (fleet.phase) {
      case "departingSystem":
        return "Departing";
      case "arrivingSystem":
        return "Arriving";
      case "buildingStarbase":
        return "Building";
      case "jumpingHyperlane":
        return "In Transit";
      case "movingSystem":
        return fleet.orderType === "merge" ? "Merging" : "Maneuvering";
      case "orbiting":
      case "orbitingPlanet":
        return "Orbiting";
      case "idle":
      default:
        return "Operational";
    }
  }

  private formatFleetOrder(data: FleetManagerPanelData, fleet: ServerFleet): string {
    if (fleet.movementPlan) {
      const destination = fleet.movementPlan.destinationPlanetId
        ? this.findPlanetName(data, fleet.movementPlan.destinationPlanetId)
        : (fleet.movementPlan.destinationOrbitTarget
          ? this.formatOrbitTarget(data, fleet.movementPlan.destinationOrbitTarget)
          : this.getStarName(data, fleet.movementPlan.destinationStarId));
      const remainingDays = Math.max(0, (fleet.movementPlan.endsAtYear - data.clockYear) * GAME_DAYS_PER_YEAR);
      const remainingMinutes = remainingDays * REAL_MS_PER_GAME_DAY / 60_000;
      return `${destination} | ${remainingDays.toFixed(1)}d | ${remainingMinutes.toFixed(1)}m`;
    }
    if (fleet.orderType === "build") return "Build Starbase";
    if (fleet.orderType === "orbit" && fleet.orbitTargetPlanetId) return `Orbiting ${this.findPlanetName(data, fleet.orbitTargetPlanetId)}`;
    if (fleet.orbitTarget) return `Orbiting ${this.formatOrbitTarget(data, fleet.orbitTarget)}`;
    if (fleet.orderType === "merge") return "Merge rendezvous";
    if (fleet.orderType === "move") return fleet.targetStarId === null ? "Move" : `Move to ${this.getStarName(data, fleet.targetStarId)}`;
    return "None";
  }

  private formatOrbitTarget(data: FleetManagerPanelData, target: NonNullable<ServerFleet["orbitTarget"]>): string {
    if (target.kind === "planet" && target.planetId) return this.findPlanetName(data, target.planetId);
    if (target.kind === "star") return this.getStarName(data, target.starId);
    if (target.kind === "starbase") return `${this.getStarName(data, target.starId)} Starbase`;
    if (target.kind === "hyperlane") return `${this.getStarName(data, target.starId)} Hyperlane`;
    if (target.kind === "fleet") return "Fleet";
    return this.getStarName(data, target.starId);
  }

  private findPlanetName(data: FleetManagerPanelData, planetId: string): string {
    for (const star of data.stars) {
      const planet = star.system.planets.find((candidate) => candidate.id === planetId);
      if (planet) return planet.name;
    }
    return planetId;
  }

  private formatCompact(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}K`;
    return abs.toFixed(abs >= 10 ? 0 : 1);
  }

  private getInitials(label: string): string {
    return label.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();
  }

  private colorToCss(color: [number, number, number] | undefined, alpha: number): string {
    if (!color) return `rgba(114, 226, 255, ${alpha})`;
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
.fleetManagerPanel {
  --fleet-accent: rgba(114, 226, 255, 0.95);
  --fleet-panel-scale: 0.82;
  position: fixed;
  width: min(1200px, calc(100vw - 32px));
  height: min(680px, calc(100vh - 32px));
  transform: scale(var(--fleet-panel-scale));
  transform-origin: top left;
  z-index: 58;
  pointer-events: auto;
  display: grid;
  grid-template-rows: 58px minmax(0, 1fr) 44px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--fleet-accent) 76%, transparent);
  background:
    radial-gradient(circle at 70% 22%, color-mix(in srgb, var(--fleet-accent) 12%, transparent), transparent 18rem),
    linear-gradient(180deg, rgba(7, 28, 31, 0.98), rgba(2, 12, 15, 0.99));
  color: #e9fff8;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.56), inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  user-select: none;
}

.fmHeader {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  cursor: grab;
  border-bottom: 1px solid rgba(103, 255, 221, 0.24);
  background: linear-gradient(90deg, rgba(20, 70, 62, 0.86), rgba(4, 19, 23, 0.92));
}

.fmHeaderIcon {
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

.fmTitle {
  font-size: 19px;
  font-weight: 900;
}

.fmSubtitle {
  margin-top: 2px;
  color: rgba(206, 232, 226, 0.68);
  font-size: 11px;
  text-transform: uppercase;
}

.fmClose {
  margin-left: auto;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(103, 255, 221, 0.62);
  background: rgba(6, 42, 38, 0.76);
  color: #bfffee;
  font: inherit;
  cursor: pointer;
}

.fmBody {
  min-height: 0;
  display: grid;
  grid-template-columns: 270px minmax(360px, 0.9fr) minmax(460px, 1.15fr);
  gap: 8px;
  padding: 8px;
}

.fmColumn,
.fmDesignerEmpty,
.fmDesignListPane,
.fmDesignWorkbench,
.fmDesignStatsPane {
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(103, 255, 221, 0.26);
  background: rgba(5, 24, 25, 0.72);
}

.fmFleetListColumn,
.fmSelectedColumn,
.fmStatsColumn,
.fmCompositionColumn {
  padding: 8px;
}

.fmFleetListColumn,
.fmSelectedColumn,
.fmCompositionColumn {
  display: flex;
  flex-direction: column;
}

.fmFleetListHeader,
.fmCompositionHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.fmPanelTitle {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.fmPanelTitle strong {
  color: #eafff8;
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
}

.fmPanelIcon {
  position: relative;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  color: #72e2ff;
}

.fmPanelIcon::before,
.fmPanelIcon::after {
  content: "";
  position: absolute;
  box-sizing: border-box;
}

.fmPanelIcon-fleet::before {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #72e2ff;
  box-shadow: -8px 8px 0 #72e2ff, 8px 8px 0 #72e2ff, 0 16px 0 #72e2ff;
}

.fmPanelIcon-doctrine::before {
  width: 21px;
  height: 21px;
  border: 2px solid #72e2ff;
  border-radius: 50%;
}

.fmPanelIcon-doctrine::after {
  width: 22px;
  height: 2px;
  background: #72e2ff;
}

.fmPanelIcon-composition::before {
  width: 22px;
  height: 22px;
  border: 2px solid #72e2ff;
  transform: rotate(45deg);
}

.fmPanelIcon-composition::after {
  width: 8px;
  height: 8px;
  background: #72e2ff;
  border-radius: 50%;
}

.fmCapacityChip,
.fmCommandChip {
  display: grid;
  place-items: center;
  min-width: 86px;
  min-height: 42px;
  padding: 5px 8px;
  border: 1px solid rgba(103, 255, 221, 0.28);
  background: linear-gradient(180deg, rgba(9, 45, 51, 0.82), rgba(2, 14, 18, 0.78));
  text-align: center;
}

.fmCapacityChip small,
.fmCommandChip small,
.fmPowerBadge small {
  color: #72e2ff;
  font-size: 9px;
  text-transform: uppercase;
}

.fmCapacityChip strong,
.fmCommandChip strong {
  color: #ffffff;
  font-size: 14px;
}

.fmFleetSearch {
  position: relative;
  display: block;
  margin-bottom: 10px;
}

.fmFleetSearch input {
  width: 100%;
  height: 34px;
  border: 1px solid rgba(103, 255, 221, 0.28);
  background: rgba(1, 8, 10, 0.36);
  color: #eafff8;
  font: inherit;
  font-size: 11px;
  padding: 0 34px 0 10px;
}

.fmFleetSearch input::placeholder {
  color: rgba(206, 232, 226, 0.46);
}

.fmSearchIcon {
  position: absolute;
  right: 10px;
  top: 50%;
  width: 14px;
  height: 14px;
  border: 2px solid #72e2ff;
  border-radius: 50%;
  transform: translateY(-50%);
}

.fmSearchIcon::after {
  content: "";
  position: absolute;
  width: 7px;
  height: 2px;
  right: -6px;
  bottom: -3px;
  background: #72e2ff;
  transform: rotate(45deg);
}

.fmSectionTitle {
  margin: 0 0 7px;
  color: #eafef8;
  font-size: 13px;
  font-weight: 900;
}

.fmFleetList,
.fmCompositionList,
.fmBuildShipList {
  min-height: 0;
  overflow-y: auto;
  display: grid;
  align-content: start;
  gap: 6px;
  padding-right: 3px;
  scrollbar-width: thin;
}

.fmFleetList {
  flex: 1;
  max-height: none;
}

.fmCompositionList {
  flex: 1;
  max-height: none;
}

.fmBuildShipList {
  max-height: 424px;
}

.fmFleetList::-webkit-scrollbar,
.fmCompositionList::-webkit-scrollbar,
.fmBuildShipList::-webkit-scrollbar {
  width: 6px;
}

.fmFleetList::-webkit-scrollbar-thumb,
.fmCompositionList::-webkit-scrollbar-thumb,
.fmBuildShipList::-webkit-scrollbar-thumb {
  background: rgba(103, 255, 221, 0.34);
  border-radius: 999px;
}

.fmFleetCard {
  min-height: 64px;
  display: grid;
  grid-template-columns: 6px minmax(0, 1fr) 48px 48px;
  gap: 8px;
  align-items: center;
  border: 1px solid rgba(103, 255, 221, 0.24);
  background: linear-gradient(135deg, rgba(16, 57, 52, 0.76), rgba(4, 17, 21, 0.94));
  color: #e9fff8;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.fmFleetCard.selected {
  border-color: rgba(103, 255, 221, 0.82);
  box-shadow: inset 3px 0 0 rgba(255, 105, 201, 0.9), 0 0 18px rgba(103, 255, 221, 0.16);
}

.fmFleetCard:hover {
  border-color: rgba(103, 255, 221, 0.72);
}

.fmFleetPip {
  width: 4px;
  height: 42px;
  margin-left: 5px;
  background: var(--fleet-owner-color, var(--fleet-accent));
}

.fmFleetCopy,
.fmFleetNumbers,
.fmCompositionRow span,
.fmBuildShipCard span {
  min-width: 0;
}

.fmFleetCopy strong,
.fmFleetCopy small,
.fmFleetNumbers strong,
.fmFleetNumbers small {
  display: block;
}

.fmFleetCopy strong {
  color: #eafff8;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fmFleetCopy small,
.fmFleetNumbers small {
  color: rgba(206, 232, 226, 0.62);
  font-size: 10px;
}

.fmFleetNumbers {
  text-align: right;
  padding-right: 7px;
}

.fmFleetNumbers strong {
  color: #75ff9b;
  font-size: 15px;
}

.fmFleetGhost {
  width: 42px;
  height: 32px;
  opacity: 0.16;
  background: linear-gradient(90deg, #72e2ff, #75ff9b);
  clip-path: polygon(0 52%, 27% 18%, 80% 0, 100% 50%, 80% 100%, 27% 82%);
  filter: blur(0.2px);
}

.fmSelectedHeader,
.fmStatsHeader {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(103, 255, 221, 0.2);
}

.fmSelectedHeader h3 {
  margin: 0;
  color: #eafff8;
  font-size: 22px;
  line-height: 1.05;
}

.fmSelectedHeader span,
.fmStatsHeader span,
.fmDesignerEmpty p {
  display: block;
  margin-top: 3px;
  color: rgba(206, 232, 226, 0.62);
  font-size: 11px;
  line-height: 1.35;
}

.fmPowerBadge {
  display: grid;
  place-items: center;
  min-width: 74px;
  min-height: 48px;
  padding: 6px 9px;
  border: 1px solid rgba(255, 224, 123, 0.64);
  background: rgba(48, 34, 13, 0.72);
  color: #ffe48a;
  text-align: center;
}

.fmPowerBadge strong {
  color: #ffe48a;
  font-size: 18px;
  font-weight: 900;
}

.fmSelectedHeaderChips {
  display: flex;
  align-items: center;
  gap: 8px;
}

.fmStatGrid,
.fmOverallGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin-top: 12px;
}

.fmInfoCard {
  min-height: 58px;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid rgba(103, 255, 221, 0.24);
  background: rgba(1, 8, 10, 0.36);
}

.fmInfoCard.hasBar {
  grid-template-columns: 36px minmax(0, 1fr) 78px;
}

.fmInfoCard small {
  display: block;
  color: #72e2ff;
  font-size: 9px;
  text-transform: uppercase;
}

.fmInfoCard strong {
  display: block;
  min-width: 0;
  margin-top: 4px;
  color: #ffffff;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fmInfoIcon {
  position: relative;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: #72e2ff;
}

.fmInfoIcon::before,
.fmInfoIcon::after {
  content: "";
  position: absolute;
  box-sizing: border-box;
}

.fmInfoIcon-status::before,
.fmInfoIcon-order::before {
  width: 23px;
  height: 23px;
  border: 2px solid #72e2ff;
  border-radius: 50%;
}

.fmInfoIcon-status::after,
.fmInfoIcon-order::after {
  width: 8px;
  height: 8px;
  border: 2px solid #72e2ff;
  border-radius: 50%;
}

.fmInfoIcon-owner::before {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #72e2ff;
  top: 3px;
}

.fmInfoIcon-owner::after {
  width: 22px;
  height: 12px;
  border-radius: 14px 14px 4px 4px;
  background: rgba(114, 226, 255, 0.85);
  bottom: 2px;
}

.fmInfoIcon-class::before {
  width: 8px;
  height: 20px;
  background: #72e2ff;
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
}

.fmInfoIcon-class::after {
  width: 22px;
  height: 8px;
  border-left: 2px solid #72e2ff;
  border-right: 2px solid #72e2ff;
  bottom: 3px;
}

.fmInfoIcon-shields::before {
  width: 18px;
  height: 23px;
  background: linear-gradient(180deg, #72e2ff, rgba(85, 117, 255, 0.72));
  clip-path: polygon(50% 0, 88% 16%, 78% 72%, 50% 100%, 22% 72%, 12% 16%);
}

.fmInfoIcon-armor::before {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #72e2ff;
  box-shadow: -8px 0 0 #72e2ff, 8px 0 0 #72e2ff, -4px 8px 0 #72e2ff, 4px 8px 0 #72e2ff;
}

.fmInfoIcon-hull::before {
  width: 23px;
  height: 15px;
  background: #72e2ff;
  clip-path: polygon(50% 0, 100% 26%, 100% 74%, 50% 100%, 0 74%, 0 26%);
}

.fmInfoIcon-speed::before {
  width: 22px;
  height: 16px;
  border-top: 3px solid #72e2ff;
  border-right: 3px solid #72e2ff;
  transform: rotate(45deg);
}

.fmInfoIcon-speed::after {
  width: 14px;
  height: 11px;
  border-top: 3px solid #72e2ff;
  border-right: 3px solid #72e2ff;
  transform: translateX(-8px) rotate(45deg);
  opacity: 0.66;
}

.fmInfoBar,
.fmShipStatBar {
  height: 5px;
  background: rgba(206, 232, 226, 0.16);
  overflow: hidden;
}

.fmInfoBar i,
.fmShipStatBar i {
  display: block;
  width: var(--info-ratio, var(--ship-stat-ratio, 0%));
  height: 100%;
  background: #20dfe8;
  box-shadow: 0 0 10px rgba(32, 223, 232, 0.55);
}

.fmStat {
  min-height: 46px;
  padding: 6px;
  border: 1px solid rgba(103, 255, 221, 0.24);
  background: rgba(1, 8, 10, 0.36);
}

.fmStat span,
.fmShipPicker .fmPickerHeader span {
  display: block;
  color: rgba(206, 232, 226, 0.62);
  font-size: 10px;
  text-transform: uppercase;
}

.fmStat strong {
  display: block;
  margin-top: 6px;
  color: #eafff8;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fmCompositionTitle {
  margin-top: 10px;
}

.fmDoctrinePanel {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(103, 255, 221, 0.18);
}

.fmDoctrineHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.fmDoctrineHeader span {
  color: rgba(206, 232, 226, 0.62);
  font-size: 10px;
}

.fmDoctrineGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin-top: 8px;
}

.fmDoctrineGrid label.wide {
  grid-column: 1 / -1;
}

.fmDoctrineGrid label {
  display: grid;
  gap: 4px;
  color: rgba(206, 232, 226, 0.62);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.fmDoctrineGrid select {
  min-width: 0;
  border: 1px solid rgba(103, 255, 221, 0.32);
  background: linear-gradient(180deg, rgba(5, 31, 36, 0.92), rgba(1, 12, 16, 0.94));
  color: #eafff8;
  font: inherit;
  font-size: 11px;
  padding: 9px 8px;
}

.fmDoctrineNote {
  display: grid;
  gap: 4px;
  margin-top: 8px;
  padding: 8px;
  border: 1px solid rgba(103, 255, 221, 0.18);
  background: rgba(1, 8, 10, 0.34);
}

.fmDoctrineNote strong {
  color: #eafff8;
  font-size: 11px;
}

.fmDoctrineNote span {
  color: rgba(206, 232, 226, 0.64);
  font-size: 10px;
  line-height: 1.35;
}

.fmDoctrineActions {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}

.fmDoctrineActions button {
  min-height: 26px;
  border: 1px solid rgba(103, 255, 221, 0.38);
  background: rgba(6, 42, 38, 0.72);
  color: #d8fff6;
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}

.fmDoctrineActions button:disabled {
  opacity: 0.38;
  cursor: default;
}

.fmCompositionRow,
.fmBuildShipCard {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-height: 56px;
  border: 1px solid rgba(103, 255, 221, 0.22);
  background: rgba(1, 8, 10, 0.42);
  padding: 7px;
}

.fmCompositionRow strong,
.fmCompositionRow small,
.fmBuildShipCard strong,
.fmBuildShipCard small,
.fmBuildShipCard em {
  display: block;
}

.fmCompositionRow strong,
.fmBuildShipCard strong {
  color: #eafff8;
  font-size: 12px;
}

.fmCompositionRow small,
.fmBuildShipCard small {
  color: #75ff9b;
  font-size: 10px;
}

.fmCompositionRow em,
.fmBuildShipCard em {
  color: rgba(216, 238, 232, 0.62);
  font-size: 10px;
  font-style: normal;
}

.fmShipIcon,
.fmDesignerIcon {
  display: grid;
  place-items: center;
  border: 1px solid rgba(103, 255, 221, 0.42);
  background: rgba(103, 255, 221, 0.1);
  color: #a9ffea;
  font-weight: 900;
}

.fmShipIcon {
  width: 32px;
  height: 32px;
  font-size: 10px;
}

.fmCompositionColumn {
  min-width: 0;
}

.fmCompositionHeader {
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(103, 255, 221, 0.18);
}

.fmAddShipsMini {
  width: 30px;
  height: 30px;
  border: 1px solid rgba(103, 255, 221, 0.44);
  background: rgba(6, 42, 38, 0.72);
  color: #d8fff6;
  font: inherit;
  font-size: 18px;
  cursor: pointer;
}

.fmAddShipsMini:disabled {
  opacity: 0.38;
  cursor: default;
}

.fmCompositionTableHeader {
  display: grid;
  grid-template-columns: minmax(130px, 1.55fr) repeat(3, minmax(58px, 0.68fr)) minmax(48px, 0.5fr) 88px;
  gap: 8px;
  padding: 0 8px 8px;
  color: #72e2ff;
  font-size: 9px;
  text-transform: uppercase;
}

.fmCompositionColumn .fmCompositionList {
  display: grid;
  align-content: start;
  gap: 7px;
  overflow-y: auto;
  padding-right: 5px;
  min-height: 0;
}

.fmCompositionColumn .fmCompositionRow {
  display: grid;
  grid-template-columns: minmax(130px, 1.55fr) repeat(3, minmax(58px, 0.68fr)) minmax(48px, 0.5fr) 88px;
  gap: 8px;
  align-items: center;
  min-height: 76px;
  padding: 7px;
  border: 1px solid rgba(103, 255, 221, 0.22);
  background: linear-gradient(135deg, rgba(4, 23, 28, 0.82), rgba(1, 8, 10, 0.55));
}

.fmShipCell {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.fmShipThumb {
  width: 46px;
  height: 30px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.5), transparent 40%),
    linear-gradient(90deg, #6f7c86, #1f2d36);
  clip-path: polygon(0 58%, 20% 30%, 68% 0, 100% 46%, 82% 80%, 24% 100%);
  filter: drop-shadow(0 0 6px rgba(114, 226, 255, 0.24));
}

.fmShipCopy {
  min-width: 0;
}

.fmShipCopy strong,
.fmShipCopy small,
.fmShipCopy em {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fmShipCopy strong {
  color: #ffffff;
  font-size: 12px;
}

.fmShipCopy small {
  margin-top: 3px;
  color: #bfffee;
  font-size: 10px;
}

.fmShipCopy em {
  width: max-content;
  max-width: 100%;
  margin-top: 5px;
  padding: 2px 6px;
  border: 1px solid rgba(255, 105, 201, 0.36);
  background: rgba(255, 105, 201, 0.14);
  color: #ff9fe0;
  font-size: 9px;
  font-style: normal;
  text-transform: uppercase;
}

.fmShipCopy em.upgradeReady {
  border-color: rgba(255, 220, 114, 0.48);
  background: rgba(255, 220, 114, 0.13);
  color: #ffdc72;
}

.fmShipDefenseCell {
  display: grid;
  justify-items: center;
  gap: 5px;
  min-width: 0;
}

.fmShipDefenseCell .fmInfoIcon {
  width: 22px;
  height: 22px;
  transform: scale(0.78);
}

.fmShipDefenseCell strong {
  color: #eafff8;
  font-size: 10px;
  white-space: nowrap;
}

.fmShipStatBar {
  width: 52px;
}

.fmShipPowerCell {
  display: grid;
  justify-items: center;
  gap: 4px;
  color: #ffe48a;
}

.fmShipPowerCell strong {
  color: #ffffff;
  font-size: 12px;
}

.fmShipActions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}

.fmShipActions button {
  position: relative;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(103, 255, 221, 0.42);
  background: rgba(2, 18, 22, 0.78);
  color: #72e2ff;
  cursor: pointer;
}

.fmShipActions button.danger {
  border-color: rgba(255, 74, 88, 0.56);
  color: #ff4a58;
}

.fmShipActions button:disabled {
  opacity: 0.35;
  cursor: default;
}

.fmActionIcon {
  position: relative;
  display: block;
  width: 16px;
  height: 16px;
}

.fmActionIcon::before,
.fmActionIcon::after {
  content: "";
  position: absolute;
  box-sizing: border-box;
}

.fmActionIcon-power::before {
  width: 9px;
  height: 16px;
  background: #ffdc72;
  clip-path: polygon(48% 0, 100% 0, 62% 42%, 100% 42%, 24% 100%, 43% 56%, 0 56%);
}

.fmActionIcon-repair::before,
.fmActionIcon-repair::after {
  background: #72e2ff;
}

.fmActionIcon-repair::before {
  width: 16px;
  height: 4px;
  top: 6px;
}

.fmActionIcon-repair::after {
  width: 4px;
  height: 16px;
  left: 6px;
}

.fmActionIcon-upgrade::before {
  width: 14px;
  height: 8px;
  left: 0;
  top: 7px;
  background: linear-gradient(90deg, #8b9aa4, #d5e0e6 48%, #526371);
  clip-path: polygon(0 58%, 24% 20%, 72% 0, 100% 48%, 78% 84%, 24% 100%);
  filter: drop-shadow(0 0 3px rgba(114, 226, 255, 0.25));
}

.fmActionIcon-upgrade::after {
  width: 9px;
  height: 11px;
  right: -1px;
  top: 0;
  background: #ffdc72;
  clip-path: polygon(50% 0, 100% 44%, 68% 44%, 68% 100%, 32% 100%, 32% 44%, 0 44%);
  filter: drop-shadow(0 0 4px rgba(255, 220, 114, 0.45));
}

.fmActionIcon-trash::before {
  width: 13px;
  height: 12px;
  left: 2px;
  top: 5px;
  border: 2px solid #ff4a58;
  border-top: 0;
}

.fmActionIcon-trash::after {
  width: 15px;
  height: 2px;
  top: 2px;
  background: #ff4a58;
}

.fmAddShipsButton {
  width: 100%;
  min-height: 36px;
  margin-top: 8px;
  border: 1px solid rgba(103, 255, 221, 0.5);
  background: rgba(6, 42, 38, 0.72);
  color: #d8fff6;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.fmAddShipsButton:disabled {
  opacity: 0.38;
  cursor: default;
}

.fmStatsNote {
  display: grid;
  gap: 3px;
  margin-top: 8px;
  padding: 8px;
  border: 1px solid rgba(103, 255, 221, 0.18);
  background: rgba(0, 0, 0, 0.18);
}

.fmStatsNote strong {
  color: #eafff8;
  font-size: 12px;
}

.fmStatsNote span {
  color: rgba(206, 232, 226, 0.62);
  font-size: 11px;
}

.fmResourceRows {
  display: grid;
  gap: 5px;
}

.fmResourceRow {
  display: grid;
  grid-template-columns: 18px 42px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
}

.fmResourceRow strong,
.fmResourceRow small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fmResourceRow strong {
  color: #eafff8;
  font-size: 11px;
}

.fmResourceRow small {
  color: rgba(206, 232, 226, 0.64);
  font-size: 10px;
}

.fmResourceIcon,
.fmMetricIcon {
  position: relative;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
}

.fmResourceIcon::before,
.fmMetricIcon::before,
.fmMetricIcon::after {
  content: "";
  position: absolute;
  box-sizing: border-box;
}

.fmResourceIcon-minerals::before {
  width: 13px;
  height: 13px;
  background: #ff9f66;
  clip-path: polygon(50% 0, 100% 30%, 84% 100%, 16% 100%, 0 30%);
}

.fmResourceIcon-energy::before {
  width: 9px;
  height: 17px;
  background: #ffdc72;
  clip-path: polygon(48% 0, 100% 0, 61% 42%, 100% 42%, 25% 100%, 43% 56%, 0 56%);
}

.fmResourceIcon-alloys::before,
.fmResourceIcon-goods::before {
  width: 14px;
  height: 14px;
  border: 2px solid #8fb2ff;
  transform: rotate(45deg);
}

.fmResourceIcon-food::before {
  width: 12px;
  height: 15px;
  border-radius: 50% 50% 45% 45%;
  background: #75ff9b;
}

.fmResourceIcon-research::before {
  width: 15px;
  height: 15px;
  border: 2px solid #b985ff;
  border-radius: 50%;
}

.fmShipPicker {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.fmPickerHeader {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.fmPickerHeader strong {
  display: block;
  color: #eafff8;
  font-size: 13px;
}

.fmPickerHeader button {
  width: 28px;
  height: 28px;
  border: 1px solid rgba(103, 255, 221, 0.5);
  background: rgba(6, 42, 38, 0.72);
  color: #d8fff6;
  font: inherit;
  cursor: pointer;
}

.fmBuildShipCard {
  grid-template-columns: 38px minmax(0, 1fr);
  color: #e9fff8;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.fmBuildShipCard:hover {
  border-color: rgba(103, 255, 221, 0.72);
}

.fmBuildShipCard:disabled {
  opacity: 0.44;
  cursor: default;
}

.fmNoSelection,
.fmEmpty {
  color: rgba(206, 232, 226, 0.56);
  font-size: 11px;
  line-height: 1.4;
}

.fmDesignerBody {
  min-height: 0;
  display: grid;
  grid-template-columns: 230px minmax(500px, 1fr) 270px;
  gap: 8px;
  padding: 8px;
}

.fmDesignerEmpty {
  height: 100%;
  padding: 18px;
}

.fmDesignListPane,
.fmDesignWorkbench,
.fmDesignStatsPane {
  padding: 8px;
}

.fmDesignListPane {
  overflow-y: auto;
  scrollbar-width: thin;
}

.fmNewDesignCard,
.fmDesignCard {
  width: 100%;
  display: grid;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(103, 255, 221, 0.24);
  background: rgba(1, 8, 10, 0.42);
  color: #e9fff8;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.fmNewDesignCard {
  grid-template-columns: 34px minmax(0, 1fr);
  min-height: 52px;
  margin-bottom: 10px;
  background: rgba(103, 255, 221, 0.08);
}

.fmNewDesignCard > span,
.fmDesignThumb {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(103, 255, 221, 0.38);
  color: #a9ffea;
  font-weight: 900;
}

.fmShipSilhouette {
  position: relative;
  overflow: hidden;
}

.fmShipSilhouette::before {
  content: "";
  width: 25px;
  height: 13px;
  background: linear-gradient(90deg, rgba(114, 226, 255, 0.9), rgba(117, 255, 155, 0.72));
  clip-path: polygon(0 50%, 34% 14%, 82% 0, 100% 50%, 82% 100%, 34% 86%);
  filter: drop-shadow(0 0 5px rgba(114, 226, 255, 0.55));
}

.fmDesignTypeGroup {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
}

.fmDesignTypeLabel {
  color: rgba(206, 232, 226, 0.66);
  font-size: 10px;
  text-transform: uppercase;
  font-weight: 900;
}

.fmDesignCard {
  grid-template-columns: 40px minmax(0, 1fr);
  min-height: 62px;
  padding: 7px;
}

.fmDesignCardCopy {
  min-width: 0;
}

.fmDesignCard.selected,
.fmDesignSlot.selected,
.fmModuleButton.selected {
  border-color: rgba(248, 218, 103, 0.82);
  box-shadow: inset 0 0 0 1px rgba(248, 218, 103, 0.24);
}

.fmDesignCard strong,
.fmDesignCard small,
.fmNewDesignCard strong {
  display: block;
}

.fmDesignCard strong,
.fmNewDesignCard strong {
  color: #eafff8;
  font-size: 12px;
}

.fmDesignCard small {
  color: rgba(206, 232, 226, 0.62);
  font-size: 10px;
}

.fmDesignModuleStrip {
  display: flex;
  gap: 3px;
  margin-top: 5px;
  min-height: 16px;
  overflow: hidden;
}

.fmDesignModuleStrip .fmModuleGlyph {
  width: 15px;
  height: 15px;
  min-width: 15px;
}

.fmDesignWorkbench {
  display: grid;
  grid-template-rows: 36px minmax(0, 1fr);
  gap: 8px;
}

.fmDesignNameBar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.fmDesignNameBar input {
  min-width: 0;
  height: 34px;
  border: 1px solid rgba(103, 255, 221, 0.38);
  background: rgba(0, 0, 0, 0.32);
  color: #eafff8;
  padding: 0 9px;
  font: inherit;
  font-size: 13px;
}

.fmNameSaveButton {
  min-width: 92px;
  height: 34px;
  border: 1px solid rgba(103, 255, 221, 0.42);
  background: rgba(6, 42, 38, 0.72);
  color: #d8fff6;
  font: inherit;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  cursor: pointer;
}

.fmNameSaveButton:hover {
  border-color: rgba(103, 255, 221, 0.76);
  color: #ffffff;
}

.fmCoreSection,
.fmLowerSections,
.fmModulePalette {
  border: 1px solid rgba(103, 255, 221, 0.18);
  background: rgba(1, 8, 10, 0.32);
  padding: 8px;
}

.fmSlotRow {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.fmSectionModuleRow {
  display: grid;
  gap: 5px;
  margin-bottom: 6px;
}

.fmSectionModuleSlot {
  width: 100%;
  min-height: 48px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(103, 255, 221, 0.3);
  background: linear-gradient(135deg, rgba(13, 49, 52, 0.88), rgba(2, 14, 18, 0.92));
  color: #e9fff8;
  font: inherit;
  text-align: left;
  cursor: pointer;
  padding: 6px;
}

.fmSectionModuleSlot.selected,
.fmDesignSlot.selected,
.fmModuleButton.selected {
  border-color: rgba(248, 218, 103, 0.82);
  box-shadow: inset 0 0 0 1px rgba(248, 218, 103, 0.24);
}

.fmSectionModuleSlot strong,
.fmSectionModuleSlot small {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fmSectionModuleSlot strong {
  color: #eafff8;
  font-size: 11px;
}

.fmSectionModuleSlot small {
  margin-top: 3px;
  color: rgba(255, 224, 123, 0.76);
  font-size: 9px;
  letter-spacing: 0.08em;
}

.fmDesignSlot {
  position: relative;
  width: 76px;
  height: 66px;
  display: grid;
  grid-template-rows: 30px 1fr;
  justify-items: center;
  align-items: center;
  gap: 3px;
  border: 1px solid rgba(103, 255, 221, 0.28);
  background: rgba(5, 20, 22, 0.72);
  color: #e9fff8;
  font: inherit;
  cursor: pointer;
  padding: 6px 5px 5px;
}

.fmDesignSlot strong {
  width: 100%;
  min-width: 0;
  color: #eafff8;
  font-size: 9px;
  line-height: 1.05;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

.fmDesignSlot small {
  position: absolute;
  top: 4px;
  right: 4px;
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  border: 1px solid rgba(255, 224, 123, 0.48);
  background: rgba(48, 34, 13, 0.72);
  color: #ffe48a;
  font-size: 8px;
  font-weight: 900;
}

.fmDesignViewport {
  position: relative;
  min-height: 430px;
  border: 1px solid rgba(103, 255, 221, 0.2);
  background:
    radial-gradient(circle at 24% 42%, rgba(36, 117, 122, 0.3), transparent 13rem),
    radial-gradient(circle at 78% 32%, rgba(91, 74, 142, 0.24), transparent 15rem),
    radial-gradient(circle at 55% 62%, rgba(34, 74, 92, 0.35), transparent 17rem),
    linear-gradient(180deg, #02080d, #031014 48%, #010509);
  overflow: hidden;
  box-shadow: inset 0 0 28px rgba(103, 255, 221, 0.08);
  isolation: isolate;
}

.fmDesignViewport::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background:
    radial-gradient(circle at 16% 18%, rgba(255, 255, 255, 0.72) 0 1px, transparent 1.5px),
    radial-gradient(circle at 68% 28%, rgba(255, 255, 255, 0.54) 0 1px, transparent 1.5px),
    radial-gradient(circle at 84% 72%, rgba(117, 255, 155, 0.46) 0 1px, transparent 1.5px),
    linear-gradient(rgba(103, 255, 221, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(103, 255, 221, 0.03) 1px, transparent 1px),
    radial-gradient(circle at 56% 44%, rgba(103, 255, 221, 0.12), transparent 18rem),
    linear-gradient(180deg, rgba(103, 255, 221, 0.05), transparent 24%, transparent 76%, rgba(0, 0, 0, 0.42));
  background-size:
    auto,
    auto,
    auto,
    42px 42px,
    42px 42px,
    auto,
    auto;
  opacity: 0.92;
}

.fmShipPreviewCanvas {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  display: block;
  background: transparent;
  outline: none;
  touch-action: none;
}

.fmPreviewOverlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}

.fmTopSlotTray {
  position: absolute;
  top: 10px;
  left: 10px;
  right: 92px;
  display: grid;
  grid-template-rows: auto auto auto;
  justify-items: center;
  gap: 4px;
  pointer-events: auto;
}

.fmCoreSelector {
  width: min(230px, 100%);
}

.fmCoreSelector .fmSectionModuleRow {
  margin: 0;
}

.fmCoreSelector .fmSectionModuleSlot {
  min-height: 30px;
  grid-template-columns: 24px minmax(0, 1fr);
  padding: 3px 8px;
  background: rgba(1, 10, 13, 0.46);
  border-color: rgba(103, 255, 221, 0.38);
}

.fmCoreSelector .fmSectionModuleSlot .fmModuleGlyph {
  width: 20px;
  height: 20px;
  min-width: 20px;
}

.fmCoreSelector .fmSectionModuleSlot strong {
  font-size: 11px;
  text-align: center;
}

.fmCoreSelector .fmSectionModuleSlot small {
  display: none;
}

.fmPreviewSlotGroup {
  display: flex;
  justify-content: center;
  border: 0;
  background: transparent;
  box-shadow: none;
  padding: 0;
  max-width: 100%;
}

.fmPreviewSlotGroup .fmSlotRow {
  gap: 3px;
  justify-content: center;
}

.fmPreviewSlotGroup .fmDesignSlot {
  width: 58px;
  height: 52px;
  background: rgba(4, 15, 18, 0.34);
  border-color: rgba(206, 232, 226, 0.22);
  backdrop-filter: blur(1px);
}

.fmPreviewSlotGroup .fmDesignSlot .fmModuleGlyph {
  width: 24px;
  height: 24px;
  min-width: 24px;
}

.fmPreviewSlotGroup .fmDesignSlot strong {
  font-size: 8px;
}

.fmBottomSlotTray {
  position: absolute;
  left: 10px;
  right: 92px;
  bottom: 16px;
  z-index: 3;
  display: flex;
  justify-content: center;
  pointer-events: auto;
}

.fmUtilityRail {
  position: absolute;
  top: 92px;
  right: 10px;
  z-index: 3;
  pointer-events: auto;
}

.fmSlotColumn {
  display: grid;
  gap: 7px;
}

.fmUtilityRail .fmDesignSlot {
  width: 58px;
  height: 58px;
  grid-template-rows: 1fr;
  background: rgba(4, 15, 18, 0.28);
  border-color: rgba(206, 232, 226, 0.24);
  backdrop-filter: blur(1px);
}

.fmUtilityRail .fmDesignSlot strong {
  display: none;
}

.fmPreviewPalette {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 88px;
  z-index: 3;
  pointer-events: auto;
  border-color: rgba(103, 255, 221, 0.28);
  background: rgba(1, 10, 13, 0.78);
  box-shadow: 0 -12px 30px rgba(0, 0, 0, 0.34), inset 0 0 0 1px rgba(255, 255, 255, 0.03);
}

.fmLowerSections {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 116px;
  gap: 8px;
}

.fmModulePalette {
  min-height: 0;
  overflow: hidden;
}

.fmPaletteHeader {
  margin-bottom: 7px;
  color: #eafff8;
  font-size: 12px;
}

.fmPaletteList {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 3px;
}

.fmModuleButton {
  min-width: 154px;
  height: 62px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  border: 1px solid rgba(103, 255, 221, 0.24);
  background: rgba(1, 8, 10, 0.42);
  color: #e9fff8;
  font: inherit;
  text-align: left;
  cursor: pointer;
  padding: 6px;
}

.fmModuleButton > span {
  min-width: 0;
}

.fmModuleButton strong,
.fmModuleButton small {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fmModuleButton strong {
  color: #eafff8;
  font-size: 10px;
}

.fmModuleButton small {
  margin-top: 3px;
  color: rgba(206, 232, 226, 0.62);
  font-size: 9px;
}

.fmModuleGlyph {
  position: relative;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  min-width: 28px;
  border: 1px solid rgba(103, 255, 221, 0.36);
  background: radial-gradient(circle at 50% 50%, rgba(103, 255, 221, 0.16), rgba(0, 0, 0, 0.08));
  color: #a9ffea;
  overflow: hidden;
}

.fmModuleGlyph::before,
.fmModuleGlyph::after {
  content: "";
  position: absolute;
  box-sizing: border-box;
}

.fmSectionModuleSlot .fmModuleGlyph,
.fmModuleButton .fmModuleGlyph {
  width: 30px;
  height: 30px;
}

.fmDesignSlot .fmModuleGlyph {
  width: 28px;
  height: 28px;
}

.fmIcon-laser::before {
  width: 22px;
  height: 3px;
  border-radius: 999px;
  background: linear-gradient(90deg, #75ff9b, #72e2ff);
  transform: rotate(-32deg);
  box-shadow: 0 0 9px rgba(114, 226, 255, 0.8);
}

.fmIcon-missile::before {
  width: 20px;
  height: 7px;
  border-radius: 999px 3px 3px 999px;
  background: linear-gradient(90deg, #ffad5a, #72e2ff);
  transform: rotate(-24deg);
}

.fmIcon-missile::after {
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 7px solid #ffdc72;
  transform: translate(10px, -5px) rotate(-24deg);
}

.fmIcon-pointDefense::before {
  width: 20px;
  height: 20px;
  border: 2px solid #72e2ff;
  border-radius: 50%;
}

.fmIcon-pointDefense::after {
  width: 18px;
  height: 2px;
  background: #ff5a78;
  box-shadow: 0 0 0 1px rgba(255, 90, 120, 0.25);
}

.fmIcon-shield::before {
  width: 18px;
  height: 22px;
  background: linear-gradient(180deg, rgba(114, 226, 255, 0.95), rgba(85, 117, 255, 0.65));
  clip-path: polygon(50% 0, 88% 16%, 78% 72%, 50% 100%, 22% 72%, 12% 16%);
}

.fmIcon-armor::before {
  width: 21px;
  height: 17px;
  border: 2px solid #ffdc72;
  transform: skewX(-16deg);
}

.fmIcon-hull::before {
  width: 21px;
  height: 18px;
  background: linear-gradient(135deg, #75ff9b, #d8fff6);
  clip-path: polygon(18% 0, 82% 0, 100% 50%, 82% 100%, 18% 100%, 0 50%);
}

.fmIcon-targeting::before,
.fmIcon-sensor::before {
  width: 20px;
  height: 20px;
  border: 2px solid #b985ff;
  border-radius: 50%;
}

.fmIcon-targeting::after {
  width: 22px;
  height: 2px;
  background: #b985ff;
  box-shadow: 0 0 0 1px rgba(185, 133, 255, 0.18);
}

.fmIcon-sensor::after {
  width: 9px;
  height: 9px;
  border-top: 2px solid #b985ff;
  border-right: 2px solid #b985ff;
  transform: rotate(45deg);
}

.fmIcon-power::before {
  width: 11px;
  height: 22px;
  background: #ffdc72;
  clip-path: polygon(46% 0, 100% 0, 64% 41%, 100% 41%, 29% 100%, 47% 56%, 0 56%);
}

.fmIcon-speed::before {
  width: 20px;
  height: 20px;
  border: 2px solid #72e2ff;
  border-radius: 50%;
}

.fmIcon-speed::after {
  width: 9px;
  height: 2px;
  background: #72e2ff;
  transform-origin: left center;
  transform: translate(2px, 1px) rotate(-35deg);
}

.fmIcon-repair::before {
  width: 18px;
  height: 4px;
  background: #75ff9b;
  transform: rotate(-45deg);
  border-radius: 999px;
}

.fmIcon-repair::after {
  width: 4px;
  height: 18px;
  background: #75ff9b;
  transform: rotate(-45deg);
  border-radius: 999px;
}

.fmIcon-swarm::before {
  width: 7px;
  height: 7px;
  background: #75ff9b;
  box-shadow: -9px 6px 0 #72e2ff, 9px 6px 0 #ffdc72;
  transform: rotate(45deg);
}

.fmIcon-tank::before,
.fmIcon-bulwark::before {
  width: 22px;
  height: 16px;
  border: 2px solid #ffdc72;
  border-radius: 2px;
  box-shadow: inset 0 0 0 3px rgba(255, 220, 114, 0.18);
}

.fmIcon-screen::before {
  width: 22px;
  height: 18px;
  border: 2px solid #72e2ff;
  border-radius: 50% 50% 42% 42%;
}

.fmIcon-utility::before,
.fmIcon-empty::before {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(216, 255, 246, 0.72);
  transform: rotate(45deg);
}

.fmSize-small {
  border-color: rgba(117, 255, 155, 0.42);
}

.fmSize-medium {
  border-color: rgba(114, 226, 255, 0.48);
}

.fmSize-large {
  border-color: rgba(255, 220, 114, 0.56);
}

.fmDesignStatsPane {
  overflow-y: auto;
}

.fmDesignStatGrid {
  grid-template-columns: 1fr;
  gap: 7px;
}

.fmDesignStatBar {
  min-height: 40px;
  display: grid;
  grid-template-columns: 22px minmax(76px, 1fr) 92px;
  align-items: center;
  gap: 7px;
  padding: 6px;
  border: 1px solid rgba(103, 255, 221, 0.2);
  background: rgba(1, 8, 10, 0.34);
}

.fmDesignStatText {
  min-width: 0;
}

.fmDesignStatText strong,
.fmDesignStatText small {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fmDesignStatText strong {
  color: #eafff8;
  font-size: 10px;
}

.fmDesignStatText small {
  margin-top: 3px;
  color: rgba(206, 232, 226, 0.64);
  font-size: 10px;
}

.fmStatTrack {
  height: 5px;
  background: rgba(206, 232, 226, 0.16);
  overflow: hidden;
}

.fmStatTrack i {
  display: block;
  width: var(--stat-score, 50%);
  height: 100%;
  background: linear-gradient(90deg, #ff5a78, #ffdc72 50%, #75ff9b);
  box-shadow: 0 0 10px rgba(117, 255, 155, 0.24);
}

.fmMetricIcon-power::before {
  width: 14px;
  height: 14px;
  background: #ffdc72;
  clip-path: polygon(50% 0, 100% 28%, 88% 88%, 50% 100%, 12% 88%, 0 28%);
}

.fmMetricIcon-damage::before {
  width: 18px;
  height: 3px;
  border-radius: 999px;
  background: #ff5a78;
  transform: rotate(-35deg);
}

.fmMetricIcon-shields::before {
  width: 15px;
  height: 18px;
  background: #72e2ff;
  clip-path: polygon(50% 0, 88% 18%, 76% 73%, 50% 100%, 24% 73%, 12% 18%);
}

.fmMetricIcon-armor::before {
  width: 16px;
  height: 13px;
  border: 2px solid #ffdc72;
  transform: skewX(-14deg);
}

.fmMetricIcon-hull::before {
  width: 17px;
  height: 15px;
  background: #75ff9b;
  clip-path: polygon(18% 0, 82% 0, 100% 50%, 82% 100%, 18% 100%, 0 50%);
}

.fmMetricIcon-evasion::before {
  width: 18px;
  height: 9px;
  border-top: 2px solid #75ff9b;
  border-right: 2px solid #75ff9b;
  transform: rotate(45deg);
}

.fmMetricIcon-speed::before {
  width: 17px;
  height: 17px;
  border: 2px solid #72e2ff;
  border-radius: 50%;
}

.fmMetricIcon-speed::after {
  width: 8px;
  height: 2px;
  background: #72e2ff;
  transform-origin: left center;
  transform: translate(2px, 1px) rotate(-35deg);
}

.fmMetricIcon-sensor::before {
  width: 18px;
  height: 18px;
  border: 2px solid #b985ff;
  border-radius: 50%;
}

.fmMetricIcon-sensor::after {
  width: 6px;
  height: 6px;
  border-top: 2px solid #b985ff;
  border-right: 2px solid #b985ff;
  transform: rotate(45deg);
}

.fmControlStack {
  display: grid;
  gap: 7px;
  margin-top: 10px;
}

.fmControlStack button {
  min-height: 34px;
  border: 1px solid rgba(103, 255, 221, 0.44);
  background: rgba(6, 42, 38, 0.72);
  color: #d8fff6;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.fmControlStack button:disabled {
  opacity: 0.38;
  cursor: default;
}

.fmTabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid rgba(103, 255, 221, 0.24);
}

.fmTabs button {
  border: 0;
  border-right: 1px solid rgba(103, 255, 221, 0.18);
  background: linear-gradient(135deg, rgba(22, 67, 58, 0.72), rgba(8, 19, 22, 0.94));
  color: rgba(228, 248, 242, 0.78);
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}

.fmTabs button.active {
  color: #ffffff;
  background: linear-gradient(135deg, rgba(39, 104, 88, 0.82), rgba(13, 39, 39, 0.96));
}

@media (max-width: 900px) {
  .fleetManagerPanel {
    width: calc(100vw - 16px);
  }

  .fmBody {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .fmDesignerBody {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .fmFleetList,
  .fmCompositionList,
  .fmBuildShipList {
    max-height: none;
  }
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

  private escapeAttribute(value: unknown): string {
    return this.escapeHtml(value).replace(/'/g, "&#039;");
  }
}
