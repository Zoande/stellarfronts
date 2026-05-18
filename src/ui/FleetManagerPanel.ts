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
  getShipModuleDefinition,
  SHIP_DEFENSE_MODULES,
  SHIP_HULL_DEFINITIONS,
  SHIP_UTILITY_MODULES,
  SHIP_WEAPON_MODULES,
} from "../data/ShipDesigns";
import type { ShipDesign, ShipModuleDefinition, ShipModuleSlotType } from "../data/ShipDesigns";
import type { StarData } from "../data/StarMap";
import type { ClientCommand, ServerFleet, ServerShip, ServerStarbase } from "../game/GameProtocol";
import type {
  CombatStance,
  FleetBehavior,
  FleetChasePolicy,
  FleetRetreatPolicy,
} from "../game/CombatTypes";
import { GAME_DAYS_PER_YEAR, REAL_MS_PER_GAME_DAY } from "../game/GameTime";
import { computeCombatPowerFromStats, computeFleetPower } from "../game/combatPower";
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
type DesignerSlotKind = "weapon" | "defense" | "utility";

export class FleetManagerPanel {
  private root: HTMLDivElement;
  private panelElement: HTMLDivElement | null = null;
  private currentData: FleetManagerPanelData | null = null;
  private activeTab: FleetManagerTab = "fleetManager";
  private selectedFleetId: string | null = null;
  private selectedDesignId: string | null = null;
  private designerDraft: ShipDesign | null = null;
  private selectedDesignerSlot = "weapon:0";
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
    scene.clearColor = new Color4(0, 0, 0, 1);

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
        this.selectedDesignerSlot = "weapon:0";
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
      this.selectedDesignerSlot = "weapon:0";
      this.show(data);
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-fm-design-slot]").forEach((button) => {
      button.addEventListener("click", () => {
        const slot = button.dataset.fmDesignSlot;
        if (!slot) return;
        this.selectedDesignerSlot = slot;
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
        weaponModuleIds: [...base.weaponModuleIds],
        defenseModuleIds: [...base.defenseModuleIds],
        utilityModuleId: base.utilityModuleId,
      };
      this.show(data);
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-fm-save-design]")?.addEventListener("click", () => {
      if (!this.designerDraft) return;
      const nameInput = this.panelElement?.querySelector<HTMLInputElement>("[data-fm-design-name]");
      const name = (nameInput?.value ?? this.designerDraft.name).trim() || this.designerDraft.name;
      this.designerDraft.name = name;
      data.onFleetCommand?.({
        type: "saveShipDesign",
        designId: this.designerDraft.id || undefined,
        shipKind: this.designerDraft.shipKind,
        name,
        weaponModuleIds: [...this.designerDraft.weaponModuleIds],
        defenseModuleIds: [...this.designerDraft.defenseModuleIds],
        utilityModuleId: this.designerDraft.utilityModuleId,
      });
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
    return `
      <section class="fmBody">
        <article class="fmColumn fmFleetListColumn">
          <div class="fmSectionTitle">Fleet Manager</div>
          <div class="fmFleetList">
            ${data.fleets.length === 0
              ? '<div class="fmEmpty">No fleets currently visible.</div>'
              : data.fleets.map((fleet, index) => this.renderFleetListItem(data, fleet, index)).join("")}
          </div>
        </article>
        <article class="fmColumn fmSelectedColumn">
          ${selectedFleet ? this.renderSelectedFleet(data, selectedFleet) : this.renderNoSelectedFleet()}
        </article>
        <aside class="fmColumn fmStatsColumn">
          ${this.addShipsOpen && selectedFleet ? this.renderShipPicker(data, selectedFleet) : this.renderOverallStats(data)}
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
        <span class="fmFleetNumbers">
          <strong>${shipCount}</strong>
          <small>${this.escapeHtml(this.formatFleetPower(data, fleet, index))}</small>
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
    return `
      <div class="fmSelectedHeader">
        <div>
          <div class="fmSectionTitle">Selected Fleet</div>
          <h3>${this.escapeHtml(this.getFleetName(data, fleet, index))}</h3>
          <span>${this.escapeHtml(this.getStarName(data, fleet.currentStarId))} System</span>
        </div>
        <div class="fmPowerBadge">${this.escapeHtml(this.formatFleetPower(data, fleet, index))}</div>
      </div>
      <div class="fmStatGrid">
        ${this.renderStat("Status", this.formatFleetStatus(fleet))}
        ${this.renderStat("Owner", owner?.name ?? "Unknown")}
        ${this.renderStat("Class", shipCount === 1 ? "Single-Ship Fleet" : `${shipCount} Ships`)}
        ${this.renderStat("Shields", `${Math.round(defense.shield)} / ${Math.round(defense.maxShield)}`)}
        ${this.renderStat("Armor", `${Math.round(defense.armor)} / ${Math.round(defense.maxArmor)}`)}
        ${this.renderStat("Hull", `${Math.round(defense.hull)} / ${Math.round(defense.maxHull)}`)}
        ${this.renderStat("Speed", `${this.formatCompact(fleet.speed * 2)} ly/day`)}
        ${this.renderStat("Order", this.formatFleetOrder(data, fleet))}
      </div>
      ${this.renderFleetDoctrinePanel(data, fleet, ships)}
      <div class="fmDoctrineHeader">
        <div>
          <div class="fmSectionTitle fmCompositionTitle">Fleet Composition</div>
          <span>${ships.length} ship${ships.length === 1 ? "" : "s"} tracked inside this fleet</span>
        </div>
      </div>
      <div class="fmCompositionList">
        ${this.renderCompositionRows(data, fleet, ships)}
      </div>
      <button class="fmAddShipsButton" type="button" data-fm-add-ships ${data.playerFactionId === fleet.ownerId ? "" : "disabled"}>Add Ships</button>
    `;
  }

  private renderFleetDoctrinePanel(data: FleetManagerPanelData, fleet: ServerFleet, ships: ServerShip[]): string {
    const canCommand = data.playerFactionId === fleet.ownerId;
    const settings = fleet.combatSettings;
    const tacticalRadius = fleet.tacticalRadius ?? getFleetTacticalRadius(Math.max(ships.length, fleet.shipIds.length));
    const range = fleet.maxWeaponRange ?? 0;
    const status = fleet.combatStatus ?? "idle";
    return `
      <div class="fmDoctrineHeader">
        <div>
          <div class="fmSectionTitle fmCompositionTitle">Fleet Doctrine</div>
          <span>${this.escapeHtml(this.formatCombatStatus(status))} | footprint ${this.formatCompact(tacticalRadius)} | max range ${this.formatCompact(range)}</span>
        </div>
      </div>
      <div class="fmDoctrineGrid">
        <label>Stance ${this.renderFleetStanceSelect(fleet, canCommand)}</label>
        <label>Behavior ${this.renderFleetBehaviorSelect(fleet, canCommand)}</label>
        <label>Chase ${this.renderFleetChaseSelect(fleet, canCommand)}</label>
        <label>Auto-retreat ${this.renderFleetRetreatSelect(fleet, canCommand)}</label>
        <label>Retreat to ${this.renderFleetRetreatDestinationSelect(data, fleet, canCommand)}</label>
      </div>
      <div class="fmDoctrineNote">
        <strong>${this.escapeHtml(this.formatCombatStance(fleet.combatStance))}</strong>
        <span>${this.escapeHtml(this.getDoctrineDescription(fleet.combatStance, settings.behavior))}</span>
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
      return ships.map((ship) => this.renderShipRow(data, ship)).join("");
    }
    if (fleet.shipIds.length > 0) {
      return fleet.shipIds.map((shipId) => `
        <div class="fmCompositionRow">
          <span class="fmShipIcon">CV</span>
          <span>
            <strong>Corvette</strong>
            <small>${this.escapeHtml(shipId)}</small>
          </span>
          <em>Tracked</em>
        </div>
      `).join("");
    }
    return '<div class="fmEmpty">No ships assigned to this fleet.</div>';
  }

  private renderShipRow(data: FleetManagerPanelData, ship: ServerShip): string {
    const definition = STARBASE_SHIP_DEFINITIONS[ship.shipKind];
    const design = this.getDesignById(data, ship.designId);
    const shieldPct = ship.maxShield > 0 ? Math.round((ship.shield / ship.maxShield) * 100) : 0;
    const armorPct = ship.maxArmor > 0 ? Math.round((ship.armor / ship.maxArmor) * 100) : 0;
    const hullPct = ship.maxHull > 0 ? Math.round((ship.hull / ship.maxHull) * 100) : 0;
    return `
      <div class="fmCompositionRow">
        <span class="fmShipIcon">${this.escapeHtml(this.getInitials(definition?.label ?? ship.shipKind))}</span>
        <span>
          <strong>${this.escapeHtml(definition?.label ?? ship.shipKind)}</strong>
          <small>${this.escapeHtml(design?.name ?? definition?.className ?? "Unknown class")}</small>
        </span>
        <em>S ${shieldPct}% | A ${armorPct}% | H ${hullPct}%</em>
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
            return `
              <button class="fmBuildShipCard" type="button" data-fm-build-ship="${design.shipKind}" data-fm-build-design="${this.escapeAttribute(design.id)}" ${nearest ? "" : "disabled"}>
                <span class="fmShipIcon">${this.escapeHtml(this.getInitials(SHIP_HULL_DEFINITIONS[design.shipKind]?.label ?? design.shipKind))}</span>
                <span>
                  <strong>${this.escapeHtml(design.name)}</strong>
                  <small>${this.escapeHtml(SHIP_HULL_DEFINITIONS[design.shipKind]?.label ?? design.shipKind)}</small>
                  <em>${this.formatCompact(predictedAlloys)} alloys predicted | ${stats.buildDays.toFixed(1)} days | ${this.formatCompact(stats.crewDemand)} crew</em>
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
            <span>${this.escapeHtml(SHIP_HULL_DEFINITIONS[draft.shipKind]?.label ?? draft.shipKind)}</span>
          </div>
          <div class="fmDesignViewport" data-fm-ship-preview aria-label="Ship preview">
            <div class="fmPreviewOverlay">
              <div class="fmPreviewSlots">
                <div class="fmPreviewSlotGroup">
                  <div class="fmPreviewSlotTitle">Weapons</div>
                  <div class="fmSlotRow fmWeaponSlots">
                    ${draft.weaponModuleIds.map((moduleId, index) => this.renderDesignSlot("weapon", index, moduleId)).join("")}
                  </div>
                </div>
                <div class="fmPreviewSlotGroup">
                  <div class="fmPreviewSlotTitle">Defense</div>
                  <div class="fmSlotRow fmDefenseSlots">
                    ${draft.defenseModuleIds.map((moduleId, index) => this.renderDesignSlot("defense", index, moduleId)).join("")}
                  </div>
                </div>
                <div class="fmPreviewSlotGroup compact">
                  <div class="fmPreviewSlotTitle">Extra</div>
                  <div class="fmSlotRow">
                    ${this.renderDesignSlot("utility", 0, draft.utilityModuleId)}
                  </div>
                </div>
              </div>
              <div class="fmModulePalette fmPreviewPalette">
                ${this.renderModulePalette()}
              </div>
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
            ${this.renderStat("Power", this.formatPowerValue(computeCombatPowerFromStats(stats.combat)))}
            ${this.renderStat("Damage", this.formatCompact(stats.combat.weaponMounts.reduce((sum, mount) => sum + mount.damage * mount.barrels, 0)))}
            ${this.renderStat("Shields", this.formatCompact(stats.combat.maxShield))}
            ${this.renderStat("Armor", this.formatCompact(stats.combat.maxArmor))}
            ${this.renderStat("Hull", this.formatCompact(stats.combat.maxHull))}
            ${this.renderStat("Evasion", `${Math.round(stats.combat.evasion * 100)}%`)}
            ${this.renderStat("Speed", this.formatCompact(stats.speed))}
            ${this.renderStat("Sensor", this.formatCompact(stats.combat.sensorRange))}
          </div>
          <div class="fmStatsNote">
            <strong>Cost</strong>
            <span>${this.escapeHtml(this.formatResources(stats.cost))}</span>
          </div>
          <div class="fmStatsNote">
            <strong>Upkeep</strong>
            <span>${this.escapeHtml(this.formatResources(stats.upkeep))}</span>
          </div>
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
              <span class="fmDesignThumb">${this.escapeHtml(this.getInitials(hull?.label ?? shipKind))}</span>
              <span>
                <strong>${this.escapeHtml(design.name)}</strong>
                <small>${this.escapeHtml(hull?.label ?? shipKind)}</small>
              </span>
            </button>
          `).join("")}
        </div>
      `;
    }).join("");
  }

  private renderDesignSlot(kind: DesignerSlotKind, index: number, moduleId: string | null | undefined): string {
    const module = getShipModuleDefinition(moduleId);
    const slot = `${kind}:${index}`;
    const selected = this.selectedDesignerSlot === slot;
    const emptyLabel = kind === "utility" ? "Extra" : kind === "weapon" ? "Weapon" : "Defense";
    return `
      <button class="fmDesignSlot ${selected ? "selected" : ""} ${module ? "" : "empty"}" type="button" data-fm-design-slot="${this.escapeAttribute(slot)}">
        <span>${this.escapeHtml(module ? this.getInitials(module.label) : "+")}</span>
        <strong>${this.escapeHtml(module?.label ?? emptyLabel)}</strong>
      </button>
    `;
  }

  private renderModulePalette(): string {
    const slot = this.parseDesignerSlot(this.selectedDesignerSlot);
    const modules = this.getModulesForSlot(slot.kind);
    return `
      <div class="fmPaletteHeader">
        <strong>${this.escapeHtml(this.formatSlotKind(slot.kind))}</strong>
      </div>
      <div class="fmPaletteList">
        ${modules.map((module) => this.renderModuleButton(module)).join("")}
      </div>
    `;
  }

  private renderModuleButton(module: ShipModuleDefinition): string {
    const selected = this.isModuleSelectedInSlot(module.id);
    return `
      <button class="fmModuleButton ${selected ? "selected" : ""}" type="button" data-fm-module="${this.escapeAttribute(module.id)}">
        <span>${this.escapeHtml(this.getInitials(module.label))}</span>
        <strong>${this.escapeHtml(module.label)}</strong>
      </button>
    `;
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
      weaponModuleIds: [...design.weaponModuleIds],
      defenseModuleIds: [...design.defenseModuleIds],
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

  private parseDesignerSlot(slot: string): { kind: DesignerSlotKind; index: number } {
    const [kind, indexText] = slot.split(":");
    if (kind === "defense" || kind === "utility" || kind === "weapon") {
      return { kind, index: Math.max(0, Number(indexText) || 0) };
    }
    return { kind: "weapon", index: 0 };
  }

  private getModulesForSlot(kind: DesignerSlotKind): ShipModuleDefinition[] {
    if (kind === "defense") return SHIP_DEFENSE_MODULES;
    if (kind === "utility") return SHIP_UTILITY_MODULES;
    return SHIP_WEAPON_MODULES;
  }

  private applyModuleToDraft(moduleId: string): void {
    if (!this.designerDraft) return;
    const module = getShipModuleDefinition(moduleId);
    if (!module) return;
    const slot = this.parseDesignerSlot(this.selectedDesignerSlot);
    if (module.slotType !== slot.kind) return;
    if (slot.kind === "weapon" && slot.index < this.designerDraft.weaponModuleIds.length) {
      this.designerDraft.weaponModuleIds[slot.index] = moduleId;
    } else if (slot.kind === "defense" && slot.index < this.designerDraft.defenseModuleIds.length) {
      this.designerDraft.defenseModuleIds[slot.index] = moduleId;
    } else if (slot.kind === "utility") {
      this.designerDraft.utilityModuleId = moduleId;
    }
  }

  private isModuleSelectedInSlot(moduleId: string): boolean {
    if (!this.designerDraft) return false;
    const slot = this.parseDesignerSlot(this.selectedDesignerSlot);
    if (slot.kind === "weapon") return this.designerDraft.weaponModuleIds[slot.index] === moduleId;
    if (slot.kind === "defense") return this.designerDraft.defenseModuleIds[slot.index] === moduleId;
    return this.designerDraft.utilityModuleId === moduleId;
  }

  private formatSlotKind(kind: ShipModuleSlotType): string {
    if (kind === "defense") return "Defense Modules";
    if (kind === "utility") return "Extra Components";
    return "Weapons";
  }

  private formatResources(resources: Record<string, number>): string {
    const parts = Object.entries(resources)
      .filter(([, value]) => Math.abs(value) > 0.001)
      .map(([resource, value]) => `${this.formatCompact(value)} ${resource}`);
    return parts.length > 0 ? parts.join(" | ") : "None";
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
    return `${Math.round(value / 1000)}K`;
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
  position: fixed;
  width: min(1120px, calc(100vw - 32px));
  height: min(680px, calc(100vh - 32px));
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
  background: var(--fleet-accent);
  color: #062018;
  font-weight: 900;
  font-size: 11px;
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
  grid-template-columns: 270px minmax(0, 1fr) 270px;
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
.fmStatsColumn {
  padding: 8px;
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
  max-height: calc(100% - 26px);
}

.fmCompositionList {
  max-height: 154px;
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
  grid-template-columns: 6px minmax(0, 1fr) 56px;
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
  border-color: rgba(248, 218, 103, 0.78);
  box-shadow: inset 3px 0 0 rgba(248, 218, 103, 0.82), 0 0 14px rgba(248, 218, 103, 0.12);
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
  font-size: 17px;
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
  min-width: 62px;
  padding: 5px 8px;
  border: 1px solid rgba(255, 224, 123, 0.64);
  background: rgba(48, 34, 13, 0.72);
  color: #ffe48a;
  font-size: 12px;
  font-weight: 900;
  text-align: center;
}

.fmStatGrid,
.fmOverallGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  margin-top: 8px;
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

.fmDoctrineHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(103, 255, 221, 0.2);
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
  background: rgba(2, 18, 22, 0.86);
  color: #eafff8;
  font: inherit;
  font-size: 10px;
  padding: 6px;
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
  grid-template-columns: 208px minmax(430px, 1fr) 232px;
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

.fmNewDesignCard span,
.fmDesignThumb {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(103, 255, 221, 0.38);
  color: #a9ffea;
  font-weight: 900;
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

.fmDesignNameBar span {
  color: #75ff9b;
  font-size: 11px;
  text-transform: uppercase;
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

.fmDesignSlot {
  width: 92px;
  height: 60px;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(103, 255, 221, 0.28);
  background: rgba(5, 20, 22, 0.72);
  color: #e9fff8;
  font: inherit;
  cursor: pointer;
  padding: 5px;
}

.fmDesignSlot span {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid rgba(103, 255, 221, 0.34);
  color: #a9ffea;
  font-size: 9px;
  font-weight: 900;
}

.fmDesignSlot strong {
  min-width: 0;
  color: #eafff8;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fmDesignViewport {
  position: relative;
  min-height: 430px;
  border: 1px solid rgba(103, 255, 221, 0.2);
  background: #000;
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
    radial-gradient(circle at 56% 44%, rgba(103, 255, 221, 0.12), transparent 18rem),
    linear-gradient(180deg, rgba(103, 255, 221, 0.05), transparent 24%, transparent 76%, rgba(0, 0, 0, 0.42));
}

.fmShipPreviewCanvas {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  display: block;
  background: #000;
  outline: none;
  touch-action: none;
}

.fmPreviewOverlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}

.fmPreviewSlots {
  position: absolute;
  top: 10px;
  left: 10px;
  width: min(292px, calc(100% - 20px));
  display: grid;
  gap: 7px;
  pointer-events: auto;
}

.fmPreviewSlotGroup {
  border: 1px solid rgba(103, 255, 221, 0.22);
  background: rgba(1, 10, 13, 0.72);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.28), inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  padding: 7px;
}

.fmPreviewSlotGroup.compact {
  width: max-content;
  max-width: 100%;
}

.fmPreviewSlotTitle {
  margin-bottom: 6px;
  color: rgba(206, 232, 226, 0.72);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.fmPreviewSlotGroup .fmSlotRow {
  gap: 5px;
}

.fmPreviewSlotGroup .fmDesignSlot {
  width: 86px;
  height: 50px;
  grid-template-columns: 24px minmax(0, 1fr);
}

.fmPreviewSlotGroup .fmDesignSlot span {
  width: 22px;
  height: 22px;
}

.fmPreviewSlotGroup .fmDesignSlot strong {
  font-size: 9px;
}

.fmPreviewPalette {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 10px;
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
  min-width: 132px;
  height: 58px;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
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

.fmModuleButton span {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(103, 255, 221, 0.34);
  color: #a9ffea;
  font-size: 9px;
  font-weight: 900;
}

.fmModuleButton strong {
  min-width: 0;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fmDesignStatsPane {
  overflow-y: auto;
}

.fmDesignStatGrid {
  grid-template-columns: 1fr;
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
