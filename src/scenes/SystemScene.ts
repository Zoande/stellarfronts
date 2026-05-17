/**
 * SystemScene
 * Dedicated star-system view entered from the galaxy map.
 * Escape triggers a scene-level exit callback back to GalaxyScene.
 */

import {
  Scene,
  Vector3,
  Color3,
  Color4,
  ArcRotateCamera,
  HemisphericLight,
  PointLight,
  MeshBuilder,
  StandardMaterial,
  MultiMaterial,
  Texture,
  GlowLayer,
  TransformNode,
  SceneLoader,
  DynamicTexture,
  Material,
  Mesh,
  Ray,
  Quaternion,
  Matrix,
  PointerEventTypes,
} from "@babylonjs/core";
import type { AbstractEngine, AbstractMesh, LinesMesh, Observer, PointerInfo } from "@babylonjs/core";
import "@babylonjs/loaders/OBJ/objFileLoader";
import "@babylonjs/loaders/glTF";
import type { IGameScene } from "../SceneManager";
import {
  STAR_TYPES,
  StarType,
  PLANET_TYPES,
  PlanetType,
  applyPlanetStatesToStars,
  createPlanetId,
  withPlanetObjectDetails,
} from "../data/StarMap";
import type { PlanetConfig, StarData, StarVisualKind } from "../data/StarMap";
import {
  getHyperlaneExitSystemPosition,
  getPlanetSystemOrbitRadius,
  getPlanetSystemPosition,
  getPlanetVisualDiameter,
  getSystemOrbitLayout,
  getSystemStarOrbitPosition,
  getSystemStarbasePosition,
  getSystemStarbaseOrbitPosition,
  SYSTEM_FLEET_Y,
  SYSTEM_HYPERLANE_EXIT_MARKER_Y,
  withPlanetOrbitFields,
} from "../data/SystemCoordinates";
import type { SystemPosition } from "../data/SystemCoordinates";
import type { PlanetState } from "../data/Economy";
import type { FactionInfo } from "../data/Factions";
import { STARBASE_LEVEL_DEFINITIONS } from "../data/Starbase";
import { calculateShipDesignStats } from "../data/ShipDesigns";
import type { ShipDesign } from "../data/ShipDesigns";
import { OrbitSystem } from "../systems/OrbitSystem";
import type { GalaxyShipTransit, HyperlaneExitPoint, ShipAction } from "../game/GameplayTypes";
import type { BattleLayerDamage, BattleZone, ClientCommand, CombatGroup, FleetOrbitTarget, ServerBattle, ServerCombatContact, ServerFleet, ServerShip, ServerStarbase } from "../game/GameProtocol";
import type { RangeBand } from "../game/CombatTypes";
import { GAME_DAYS_PER_YEAR, REAL_MS_PER_GAME_DAY } from "../game/GameTime";
import { getFleetTacticalRadius, getLayeredFleetFormationPosition } from "../game/tacticalFormation";
import { CelestialObjectPanel } from "../ui/CelestialObjectPanel";
import { SelectionPanel } from "../ui/SelectionPanel";
import type { BattleSelectionParticipant, SelectionData } from "../ui/SelectionPanel";
import { StarbasePanel } from "../ui/StarbasePanel";
import { computeFleetPower, computeStarbasePower } from "../game/combatPower";
import { createFlagDesign } from "../flags/flagGenerator";
import { renderFlagSvg } from "../flags/renderFlagSvg";
// OBJ and glTF loading are handled by @babylonjs/loaders modules

type ExitSystemHandler = () => void | Promise<void>;

type SystemActionTargetKind = "star" | "planet" | "starbase" | "hyperlane";

interface SystemActionTarget {
  kind: SystemActionTargetKind;
  label: string;
  starId: number;
  position: SystemPosition;
  markerPosition: SystemPosition;
  planetId?: string;
  starbaseId?: string;
  connectedStarId?: number;
}

interface TacticalBattleGroupView {
  id: string;
  fleetId: string | null;
  ownerId: number;
  name: string;
  shipIds: string[];
  behavior: string;
  count: number;
  position: SystemPosition;
  originPosition: SystemPosition;
  leashRadius: number;
  status: string;
  hpRatio: number;
  order: string;
  targetGroupId?: string | null;
  destination?: SystemPosition | null;
  maxWeaponRange: number;
  chaseSetting: string;
  retreatText: string;
}

interface TacticalFleetView {
  id: string;
  ownerId: number;
  name: string;
  shipIds: string[];
  position: SystemPosition;
  status: string;
  hpRatio: number;
  tacticalRadius: number;
  maxWeaponRange: number;
}

export interface SystemSceneOptions {
  homeSystemStarIds?: number[];
  playerShipStarId?: number;
  playerShipSystemIds?: number[];
  fleetSystemPositions?: Record<string, { x: number; y: number; z: number }>;
  serverFleets?: ServerFleet[];
  serverShips?: ServerShip[];
  shipDesigns?: ShipDesign[];
  battles?: ServerBattle[];
  recentCombatContacts?: ServerCombatContact[];
  starbaseSystemIds?: number[];
  starbases?: ServerStarbase[];
  factions?: FactionInfo[];
  playerFactionId?: number;
  planetStates?: PlanetState[];
  shipTransit?: GalaxyShipTransit | null;
  hyperlaneExits?: HyperlaneExitPoint[];
  clockYear?: number;
  onGameplayFrame?: (deltaTime: number) => void;
  selectedFleetId?: string | null;
  selectedFleetIds?: Iterable<string>;
  onSelectedFleetIdsChange?: (fleetIds: string[]) => void;
  onRequestFleetActionInGalaxy?: (fleetId: string, action: ShipAction) => void;
  onPlanetCommand?: (command: ClientCommand) => void;
  onFleetCommand?: (command: ClientCommand) => void;
  onRequestPlanetDetails?: (planetId: string) => Promise<{ planet: PlanetConfig; planetState: PlanetState }>;
}

const PLAYER_SHIP_MODEL_ROOT = "/ships/fighter_01/";
const PLAYER_SHIP_MODEL_FILE = "Fighter_01.obj";
const PLAYER_SHIP_TARGET_SIZE = 0.8;
const PLAYER_SHIP_BASE_POSITION = new Vector3(23, 4.8, -19);
const PLAYER_SHIP_MODEL_PITCH = 0.18;
const PLAYER_SHIP_MODEL_ROLL = -0.08;
const PLAYER_SHIP_MODEL_YAW_OFFSET = 0;
const PLAYER_SHIP_TURN_RATE = 8;
const PLAYER_SHIP_TRAIL_SAMPLE_INTERVAL = 0.03;
const PLAYER_SHIP_TRAIL_TTL = 2.0;
const PLAYER_SHIP_TRAIL_MIN_DISTANCE = 0.01;
const PLAYER_SHIP_TRAIL_MAX_SEGMENT_DISTANCE = 2.5;
const PLAYER_SHIP_TRAIL_RADIUS = 0.06;
const PLAYER_SHIP_TRAIL_START_ALPHA = 0.72;
const SELECTED_FLEET_ROUTE_LINE_Y_OFFSET = 0.08;
const SYSTEM_ACTION_MARKER_COLOR = new Color3(0.18, 1.0, 0.9);
const SYSTEM_ACTION_MARKER_PULSE_SPEED = 4.2;
const SYSTEM_ACTION_MARKER_ROTATION_SPEED = 0.42;
const SYSTEM_ACTION_MARKER_MAX_EMPTY_MOVE_RADIUS = 72;

const STARBASE_MODEL_URL = "/starbase/star_trek_-_starbase_375.glb";
const SHIP_EXIT_END_PROGRESS = 0.28;
const SHIP_ENTRY_START_PROGRESS = 0.72;
const SYSTEM_LABEL_TEXTURE_WIDTH = 2048;
const SYSTEM_LABEL_TEXTURE_HEIGHT = 512;
const SYSTEM_LABEL_U_SCALE = -1;
const SYSTEM_LABEL_U_OFFSET = 1;
const STAR_BANNER_DIR = "/textures/planet-banners";

const BATTLE_SHIP_TARGET_SIZE = 0.65;
const BATTLE_BEAM_TTL = 0.45;
const BATTLE_ZONE_SPREAD = 3.6;
const BATTLE_GROUP_MARKER_Y_OFFSET = 0.06;
const BATTLE_GROUP_SHIP_Y_OFFSET = 0.25;
const BATTLE_GROUP_RING_BASE_DIAMETER = 2;
const FLEET_MARKER_Y_OFFSET = 0.04;
const TACTICAL_RING_SEGMENTS = 144;
const BATTLE_RANGE_DISTANCE_BY_BAND: Record<RangeBand, number> = {
  pointBlank: 6,
  close: 16,
  medium: 30,
  long: 46,
  extreme: 64,
  outOfRange: Number.POSITIVE_INFINITY,
};
const BATTLE_ZONE_POSITIONS: Record<BattleZone, Vector3> = {
  0: new Vector3(-18, 4.2, -6),
  1: new Vector3(-8, 4.1, -2),
  2: new Vector3(8, 4.0, 2),
  3: new Vector3(18, 3.9, 6),
};

const STAR_BANNER_TEXTURES: Record<StarType, string> = {
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

export class SystemScene implements IGameScene {
  public scene: Scene;
  private engine: AbstractEngine;
  private star: StarData;
  private starCount: number;  // Track actual star count for player ship detection
  private homeSystemStarIds: Set<number>;
  private playerShipStarId: number;
  private playerShipSystemIds: Set<number>;
  private fleetSystemPositions: Record<string, { x: number; y: number; z: number }>;
  private serverFleets: ServerFleet[];
  private serverShips: ServerShip[];
  private shipDesigns: ShipDesign[];
  private battles: ServerBattle[];
  private recentCombatContacts: ServerCombatContact[];
  private starbaseSystemIds: Set<number>;
  private starbases: ServerStarbase[];
  private factions: FactionInfo[];
  private playerFactionId: number;
  private planetStates: PlanetState[];
  private shipTransit: GalaxyShipTransit | null;
  private clockYear: number;
  private hyperlaneExits: HyperlaneExitPoint[];
  private readonly onExitSystem: ExitSystemHandler;
  private readonly options: SystemSceneOptions;

  private camera!: ArcRotateCamera;
  private glowLayer!: GlowLayer;
  private starMesh: Mesh | null = null;
  private starDetailMesh: Mesh | null = null;
  private starCoronaMesh: Mesh | null = null;
  private starDiameter = 1.2;
  private starLight: PointLight | null = null;
  private fillLight: PointLight | null = null;

  private pulsarBeamPivot: TransformNode | null = null;
  private pulsarBeamMaterial: StandardMaterial | null = null;

  private blackHoleDiskOuter: Mesh | null = null;
  private blackHoleDiskInner: Mesh | null = null;
  private playerShipRoot: TransformNode | null = null;
  private playerShipLight: PointLight | null = null;
  private playerShipThrusterMaterial: StandardMaterial | null = null;
  private playerShipBasePosition = PLAYER_SHIP_BASE_POSITION.clone();
  private playerShipTargetPosition = PLAYER_SHIP_BASE_POSITION.clone();
  private playerShipTrailTimer = 0;
  private playerShipLastTrailPosition: Vector3 | null = null;
  private playerShipTrailSegments: Array<{ mesh: Mesh; material: StandardMaterial; age: number; ttl: number }> = [];
  private selectedFleetRouteLine: LinesMesh | null = null;
  private selectedBattleGroupOrderLine: LinesMesh | null = null;

  private battleShipTemplate: TransformNode | null = null;
  private battleShipTemplatePromise: Promise<void> | null = null;
  private battleShipRoots = new Map<string, TransformNode>();
  private battleShipTargets = new Map<string, Vector3>();
  private fleetRoots = new Map<string, TransformNode>();
  private fleetTargets = new Map<string, Vector3>();
  private fleetMaterials = new Map<string, StandardMaterial>();
  private battleGroupRoots = new Map<string, TransformNode>();
  private battleGroupTargets = new Map<string, Vector3>();
  private battleGroupMaterials = new Map<string, StandardMaterial>();
  private selectedBattleGroupId: string | null = null;
  private battleBeams: Array<{ mesh: LinesMesh; ttl: number; maxTtl: number }> = [];
  private battleProjectiles: Array<{ mesh: Mesh; material: StandardMaterial; velocity: Vector3; ttl: number; maxTtl: number }> = [];
  private battleRoundSeen = new Map<string, number>();
  private combatContactSeen = new Set<string>();

  private starbaseRoot: TransformNode | null = null;
  private starbaseLight: PointLight | null = null;
  private starbaseRangeRing: LinesMesh | null = null;
  private starbaseRangeSignature: string | null = null;
  private hyperlaneExitMeshes: Mesh[] = [];
  private hyperlaneExitMaterial: StandardMaterial | null = null;

  private orbitSystem = new OrbitSystem();
  private orbitRings: LinesMesh[] = [];
  private planetMeshes: Mesh[] = [];
  private planetLabelMeshes: Mesh[] = [];
  private planetConfigs: PlanetConfig[] = [];
  private planetDiameters: number[] = [];
  private starLabelMesh: Mesh | null = null;
  private objectPanel!: CelestialObjectPanel;
  private selectionPanel!: SelectionPanel;
  private starbasePanel!: StarbasePanel;
  private entityCardLayer: HTMLDivElement | null = null;
  private selectedFleetId: string | null = null;
  private selectedFleetIds = new Set<string>();
  private activeFleetAction: ShipAction | null = null;
  private systemActionTargetRoots: Array<{ root: TransformNode; target: SystemActionTarget; meshes: Mesh[] }> = [];
  private systemActionMarkerMaterial: StandardMaterial | null = null;
  private readonly factionFlagSvgCache = new Map<number, string>();
  private pointerObserver: Observer<PointerInfo> | null = null;
  private starOccluded = false;
  private debugLogOccluder = false;
  private deepDebug = false;
  private isExiting = false;
  private elapsed = 0;
  private starsVisible = true;
  private bloomEnabled = true;

  private starKind: StarVisualKind = "main-sequence";

  // Tunable visual profile (configured per star type)
  private glowBaseIntensity = 1.7;
  private glowPulseAmplitude = 0.18;
  private glowPulseSpeed = 1.3;

  private coronaPulseAmplitude = 0.035;
  private coronaPulseSpeed = 1.8;

  private starRotationSpeed = 0.04;
  private starDetailRotationSpeed = -0.09;
  private starDetailTiltSpeed = 0.015;

  private starBaseEmissiveScale = 1.75;
  private starDetailEmissiveScale = 1.3;
  private starDetailTextureLevel = 1.5;
  private starDetailAlpha = 0.68;
  private starCoronaScale = 1.22;
  private starCoronaAlpha = 0.34;
  private systemScaleMultiplier = 1.15;
  private detailTexturePath = "/textures/star_surface.png";

  private ambientIntensity = 0.2;
  private bounceIntensity = 0.08;
  private starLightIntensity = 3.2;
  private starLightRange = 220;
  private fillIntensity = 0.55;
  private fillColor = new Color3(0.32, 0.38, 0.5);

  private orbitBaseOffset = 14;
  private orbitSpacing = 11;
  private planetNightLift = new Color3(0.12, 0.12, 0.15);

  private readonly onEscapeKey = (ev: KeyboardEvent): void => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    this.requestExit();
  };

  constructor(
    engine: AbstractEngine,
    star: StarData,
    onExitSystem: ExitSystemHandler,
    starCount: number = 500,
    options: SystemSceneOptions = {},
  ) {
    this.engine = engine;
    this.star = star;
    this.starCount = starCount;
    this.homeSystemStarIds = new Set(options.homeSystemStarIds ?? []);
    this.playerShipStarId = options.playerShipStarId ?? (options.homeSystemStarIds?.[0] ?? -1);
    this.playerShipSystemIds = new Set(
      options.playerShipSystemIds
        ?? options.homeSystemStarIds
        ?? (this.playerShipStarId >= 0 ? [this.playerShipStarId] : []),
    );
    this.fleetSystemPositions = options.fleetSystemPositions ?? {};
    this.serverFleets = options.serverFleets ?? [];
    this.serverShips = options.serverShips ?? [];
    this.shipDesigns = options.shipDesigns ?? [];
    this.battles = options.battles ?? [];
    this.recentCombatContacts = options.recentCombatContacts ?? [];
    this.starbaseSystemIds = new Set(options.starbaseSystemIds ?? options.homeSystemStarIds ?? []);
    this.starbases = options.starbases ?? [];
    this.factions = options.factions ?? [];
    this.playerFactionId = options.playerFactionId ?? 0;
    this.planetStates = options.planetStates ?? [];
    applyPlanetStatesToStars([this.star], this.planetStates);
    this.shipTransit = options.shipTransit ?? null;
    this.clockYear = options.clockYear ?? 2100;
    this.hyperlaneExits = options.hyperlaneExits ?? [];
    this.selectedFleetId = options.selectedFleetId ?? null;
    this.selectedFleetIds = new Set(options.selectedFleetIds ?? (this.selectedFleetId ? [this.selectedFleetId] : []));
    this.onExitSystem = onExitSystem;
    this.options = options;
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.01, 0.015, 0.03, 1);
    console.log(`📍 SystemScene init: star.id=${star.id}, totalStarCount=${starCount}`);
  }

  private hasPlayerShipPresence(): boolean {
    if (this.serverFleets.some((fleet) => fleet.currentStarId === this.star.id && fleet.ownerId === this.playerFactionId)) return true;
    if (this.playerShipSystemIds.has(this.star.id)) return true;
    if (this.playerShipStarId === this.star.id) return true;
    return !!this.shipTransit
      && (this.shipTransit.fromStarId === this.star.id || this.shipTransit.toStarId === this.star.id);
  }

  private hasStarbasePresence(): boolean {
    return this.starbaseSystemIds.has(this.star.id);
  }

  private async createStarbaseIfPresent(): Promise<void> {
    console.log(`🔍 Checking starbase: star.id=${this.star.id}, using starCount=${this.starCount}`);
    if (!this.hasStarbasePresence() || this.starbaseRoot) return;
    console.log(`✅ This is the starbase system!`);

    const starbaseSystemPosition = this.getStarbasesInCurrentSystem()[0]?.systemPosition ?? getSystemStarbasePosition();
    const starbaseBasePosition = new Vector3(
      starbaseSystemPosition.x,
      8.5,
      starbaseSystemPosition.z,
    );
    this.starbaseRoot = new TransformNode("starbaseRoot", this.scene);
    this.starbaseRoot.position = starbaseBasePosition.clone();
    this.starbaseRoot.rotation.set(0.18, 0.2, 0.05);
    console.log(`📍 Starbase root position: ${JSON.stringify(starbaseBasePosition)}`);

    try {
      console.log(`📦 Importing starbase GLB from ${STARBASE_MODEL_URL}`);
      const result = await SceneLoader.ImportMeshAsync("", "", STARBASE_MODEL_URL, this.scene);

      console.log(`✓ Loaded ${result.meshes.length} total meshes from GLB`);
      const meshes = result.meshes.filter((mesh) => (
        typeof mesh.getTotalVertices === "function" && mesh.getTotalVertices() > 0
      ));
      console.log(`✓ Filtered to ${meshes.length} renderable meshes`);
      if (meshes.length === 0) {
        throw new Error("star_trek_-_starbase_375.glb did not produce renderable meshes.");
      }

      const bounds = this.computeMeshBounds(meshes);
      const maxDimension = Math.max(
        0.001,
        bounds.max.x - bounds.min.x,
        bounds.max.y - bounds.min.y,
        bounds.max.z - bounds.min.z,
      );
      console.log(`📐 Bounds: min=${JSON.stringify(bounds.min)}, max=${JSON.stringify(bounds.max)}, maxDim=${maxDimension}`);

      const starbaseTargetSize = 15.0;
      const starbaseScale = starbaseTargetSize / maxDimension;
      console.log(`📏 Scaling to ${starbaseTargetSize} world units: scale=${starbaseScale}`);

      const assetRoot = new TransformNode("starbaseAssetRoot", this.scene);
      assetRoot.parent = this.starbaseRoot;
      assetRoot.position = bounds.center.scale(-1);

      for (const mesh of meshes) {
        this.trimStarbaseVertexData(mesh);
        mesh.parent = assetRoot;
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        this.glowLayer.addIncludedOnlyMesh(mesh as Mesh);
      }

      this.starbaseRoot.scaling.setAll(starbaseScale);

      this.starbaseLight = new PointLight(
        "starbaseInspectionLight",
        new Vector3(0, 6, -10),
        this.scene,
      );
      this.starbaseLight.parent = this.starbaseRoot;
      this.starbaseLight.intensity = 1.0;
      this.starbaseLight.range = 42;
      this.starbaseLight.diffuse = new Color3(0.58, 0.86, 1.0);
      this.starbaseLight.specular = new Color3(0.85, 0.92, 1.0);

      console.log(`✅ Starbase GLB loaded successfully! Root position: ${JSON.stringify(this.starbaseRoot.position)}`);
    } catch (err) {
      console.warn("❌ Failed to load starbase GLB, falling back to procedural starbase", err);
      this.createProceduralStarbaseFallback();
    }
  }

  private trimStarbaseVertexData(mesh: AbstractMesh): void {
    const allowedKinds = new Set(["position", "normal", "uv"]);
    const concreteMesh = mesh as Mesh;
    const kinds = concreteMesh.getVerticesDataKinds();

    for (const kind of kinds) {
      if (!allowedKinds.has(kind)) {
        concreteMesh.removeVerticesData(kind);
      }
    }

    console.log(`🧹 Trimmed ${mesh.name}: ${kinds.join(", ")}`);
  }

  private createProceduralStarbaseFallback(): void {
    if (!this.starbaseRoot) return;

    const hullMat = new StandardMaterial("starbaseHullMat", this.scene);
    hullMat.diffuseColor = new Color3(0.2, 0.24, 0.3);
    hullMat.specularColor = new Color3(0.45, 0.5, 0.58);
    hullMat.emissiveColor = new Color3(0.03, 0.05, 0.08);

    const accentMat = new StandardMaterial("starbaseAccentMat", this.scene);
    accentMat.diffuseColor = Color3.Black();
    accentMat.specularColor = Color3.Black();
    accentMat.disableLighting = true;
    accentMat.emissiveColor = new Color3(0.48, 0.84, 1.0).scale(1.5);
    accentMat.alpha = 0.95;

    const hubMat = new StandardMaterial("starbaseHubMat", this.scene);
    hubMat.diffuseColor = new Color3(0.34, 0.38, 0.46);
    hubMat.specularColor = new Color3(0.62, 0.68, 0.75);
    hubMat.emissiveColor = new Color3(0.04, 0.06, 0.1);

    const core = MeshBuilder.CreateCylinder(
      "starbaseCore",
      {
        height: 2.8,
        diameterTop: 1.7,
        diameterBottom: 1.9,
        tessellation: 28,
      },
      this.scene,
    );
    core.parent = this.starbaseRoot;
    core.material = hullMat;
    core.isPickable = false;

    const ring = MeshBuilder.CreateTorus(
      "starbaseRing",
      {
        diameter: 5.2,
        thickness: 0.28,
        tessellation: 64,
      },
      this.scene,
    );
    ring.parent = this.starbaseRoot;
    ring.rotation.x = Math.PI / 2;
    ring.material = accentMat;
    ring.isPickable = false;

    const hub = MeshBuilder.CreateSphere(
      "starbaseHub",
      { diameter: 1.25, segments: 20 },
      this.scene,
    );
    hub.parent = this.starbaseRoot;
    hub.material = hubMat;
    hub.isPickable = false;

    this.glowLayer.addIncludedOnlyMesh(core);
    this.glowLayer.addIncludedOnlyMesh(ring);
    this.glowLayer.addIncludedOnlyMesh(hub);

    this.starbaseLight = new PointLight(
      "starbaseInspectionLight",
      new Vector3(0, 6, -10),
      this.scene,
    );
    this.starbaseLight.parent = this.starbaseRoot;
    this.starbaseLight.intensity = 1.0;
    this.starbaseLight.range = 42;
    this.starbaseLight.diffuse = new Color3(0.58, 0.86, 1.0);
    this.starbaseLight.specular = new Color3(0.85, 0.92, 1.0);
  }

  async setup(): Promise<void> {
    const canvas = this.engine.getRenderingCanvas()!;

    this.configureVisualPreset();
    this.setupBackground();
    this.setupCamera(canvas);
    this.setupLighting();
    this.buildSystemObjects();
    this.objectPanel = new CelestialObjectPanel();
    this.selectionPanel = new SelectionPanel(canvas, {
      onShipAction: (action, selection) => this.handleSelectedFleetAction(action, selection),
    });
    this.renderSelectedFleetPanels();
    this.starbasePanel = new StarbasePanel();
    this.installObjectLabelClicks();
    await this.createPlayerShipIfPresent();
    await this.createStarbaseIfPresent();
    this.refreshBattleShips();
    this.refreshSystemEntityCards();
    this.setStarsVisible(this.starsVisible);
    this.setBloomEnabled(this.bloomEnabled);

    window.addEventListener("keydown", this.onEscapeKey);
    await this.scene.whenReadyAsync();
  }

  onBeforeRender(): void {
    const dt = this.engine.getDeltaTime() / 1000;
    this.options.onGameplayFrame?.(dt);
    this.elapsed += dt;

    this.orbitSystem.update(dt, Date.now());

    if (this.starMesh) {
      this.starMesh.rotation.y += this.starRotationSpeed * dt;
    }
    if (this.starDetailMesh) {
      this.starDetailMesh.rotation.y += this.starDetailRotationSpeed * dt;
      this.starDetailMesh.rotation.x += this.starDetailTiltSpeed * dt;
    }

    if (this.starCoronaMesh && this.starKind !== "black-hole") {
      const coronaPulse = 1 + this.coronaPulseAmplitude * Math.sin(this.elapsed * this.coronaPulseSpeed);
      this.starCoronaMesh.scaling.setAll(coronaPulse);
    }

    if (this.playerShipRoot) {
      const previousShipPosition = this.playerShipRoot.position.clone();
      const t = Math.min(1, dt * 4.5);
      this.playerShipBasePosition.x = this.playerShipBasePosition.x + (this.playerShipTargetPosition.x - this.playerShipBasePosition.x) * t;
      this.playerShipBasePosition.y = this.playerShipBasePosition.y + (this.playerShipTargetPosition.y - this.playerShipBasePosition.y) * t;
      this.playerShipBasePosition.z = this.playerShipBasePosition.z + (this.playerShipTargetPosition.z - this.playerShipBasePosition.z) * t;
      this.playerShipRoot.position.x = this.playerShipBasePosition.x;
      this.playerShipRoot.position.y =
        this.playerShipBasePosition.y + Math.sin(this.elapsed * 1.15) * 0.32;
      this.playerShipRoot.position.z = this.playerShipBasePosition.z;
      this.updatePlayerShipHeading(dt);
      this.updatePlayerShipTrail(dt, previousShipPosition, this.playerShipRoot.position);
    }
    this.updatePlayerShipTrailFades(dt);
    this.updateSelectedFleetRouteLine();
    this.updateSelectedBattleGroupOrderLine();
    this.updateSystemActionTargetMarkers();

    if (this.battleShipRoots.size > 0) {
      const moveT = Math.min(1, dt * 5);
      for (const [shipId, root] of this.battleShipRoots) {
        const target = this.battleShipTargets.get(shipId);
        if (!target) continue;
        root.position.x = root.position.x + (target.x - root.position.x) * moveT;
        root.position.y = root.position.y + (target.y - root.position.y) * moveT;
        root.position.z = root.position.z + (target.z - root.position.z) * moveT;
        root.rotation.y += dt * 0.35;
      }
    }

    if (this.battleGroupRoots.size > 0) {
      const moveT = Math.min(1, dt * 3.2);
      for (const [groupId, root] of this.battleGroupRoots) {
        const target = this.battleGroupTargets.get(groupId);
        if (!target) continue;
        root.position.x = root.position.x + (target.x - root.position.x) * moveT;
        root.position.y = root.position.y + (target.y - root.position.y) * moveT;
        root.position.z = root.position.z + (target.z - root.position.z) * moveT;
        const commandRing = root.getChildMeshes().find((mesh) => mesh.name.startsWith("battleGroupCommandRing-"));
        if (commandRing) commandRing.rotation.z += dt * 0.32;
        this.updateBattleGroupMarkerOriginOffset(root);
      }
    }

    if (this.fleetRoots.size > 0) {
      const moveT = Math.min(1, dt * 3.8);
      for (const [fleetId, root] of this.fleetRoots) {
        const target = this.fleetTargets.get(fleetId);
        if (!target) continue;
        root.position.x = root.position.x + (target.x - root.position.x) * moveT;
        root.position.y = root.position.y + (target.y - root.position.y) * moveT;
        root.position.z = root.position.z + (target.z - root.position.z) * moveT;
        const ring = root.getChildMeshes().find((mesh) => mesh.name.startsWith("fleetMarkerRing-"));
        if (ring) ring.rotation.z += dt * 0.22;
      }
    }

    if (this.battleBeams.length > 0) {
      const nextBeams: Array<{ mesh: LinesMesh; ttl: number; maxTtl: number }> = [];
      for (const beam of this.battleBeams) {
        beam.ttl -= dt;
        if (beam.ttl <= 0) {
          beam.mesh.dispose();
          continue;
        }
        const alpha = Math.max(0, beam.ttl / beam.maxTtl);
        beam.mesh.alpha = alpha;
        nextBeams.push(beam);
      }
      this.battleBeams = nextBeams;
    }
    if (this.battleProjectiles.length > 0) {
      const nextProjectiles: Array<{ mesh: Mesh; material: StandardMaterial; velocity: Vector3; ttl: number; maxTtl: number }> = [];
      for (const projectile of this.battleProjectiles) {
        projectile.ttl -= dt;
        if (projectile.ttl <= 0) {
          projectile.mesh.dispose();
          projectile.material.dispose();
          continue;
        }
        projectile.mesh.position.addInPlace(projectile.velocity.scale(dt));
        const alpha = Math.max(0, projectile.ttl / projectile.maxTtl);
        projectile.material.alpha = alpha;
        nextProjectiles.push(projectile);
      }
      this.battleProjectiles = nextProjectiles;
    }
    if (this.playerShipThrusterMaterial) {
      const thrusterPulse = 0.65 + 0.35 * Math.sin(this.elapsed * 5.8);
      this.playerShipThrusterMaterial.alpha = 0.45 + thrusterPulse * 0.45;
      this.playerShipThrusterMaterial.emissiveColor = new Color3(0.32, 0.72, 1.0).scale(
        1.8 + thrusterPulse * 1.2,
      );
    }

    if (this.starKind === "pulsar") {
      const beamPulse = 0.5 + 0.5 * Math.abs(Math.sin(this.elapsed * this.glowPulseSpeed));

      if (this.pulsarBeamPivot) {
        this.pulsarBeamPivot.rotation.y += 8.5 * dt;
        this.pulsarBeamPivot.rotation.z = 0.25 * Math.sin(this.elapsed * 0.8);
      }
      if (this.pulsarBeamMaterial) {
        this.pulsarBeamMaterial.alpha = 0.2 + 0.65 * beamPulse;
      }
      if (this.starLight) {
        this.starLight.intensity = this.starLightIntensity * (0.6 + 0.95 * beamPulse);
      }
      if (this.fillLight) {
        this.fillLight.intensity = this.fillIntensity * (0.5 + 0.8 * beamPulse);
      }

      this.glowLayer.intensity = this.glowBaseIntensity + this.glowPulseAmplitude * beamPulse;
    } else if (this.starKind === "black-hole") {
      if (this.blackHoleDiskOuter) {
        this.blackHoleDiskOuter.rotation.y += 0.28 * dt;
      }
      if (this.blackHoleDiskInner) {
        this.blackHoleDiskInner.rotation.y -= 0.4 * dt;
      }

      const diskPulse = 0.7 + 0.3 * Math.sin(this.elapsed * this.glowPulseSpeed);
      this.glowLayer.intensity = this.glowBaseIntensity + this.glowPulseAmplitude * diskPulse;
    } else {
      this.glowLayer.intensity =
        this.glowBaseIntensity + this.glowPulseAmplitude * Math.sin(this.elapsed * this.glowPulseSpeed);
    }

    if (!this.bloomEnabled) {
      this.glowLayer.intensity = 0;
    }

    this.updatePlanetLabels();
    this.updateSystemEntityCards();
    this.updateStarOcclusionAndGlow();
  }

  private updatePlanetLabels(): void {
    // Update planet labels
    for (let i = 0; i < this.planetMeshes.length; i++) {
      const planetMesh = this.planetMeshes[i];
      const labelMesh = this.planetLabelMeshes[i];
      const diameter = this.planetDiameters[i];
      if (labelMesh && planetMesh && diameter) {
        // Position label above planet based on its actual diameter
        const offsetDistance = diameter * 0.6 + 1.2;
        labelMesh.position = new Vector3(
          planetMesh.position.x,
          planetMesh.position.y + offsetDistance,
          planetMesh.position.z,
        );
        this.faceSystemLabelToCamera(labelMesh);
      }
    }

    // Update star label
    if (this.starLabelMesh && this.starMesh) {
      const offsetDistance = this.starDiameter * 0.6 + 1.2;
      this.starLabelMesh.position = new Vector3(
        this.starMesh.position.x,
        this.starMesh.position.y + offsetDistance,
        this.starMesh.position.z,
      );
      this.faceSystemLabelToCamera(this.starLabelMesh);
    }
  }

  private updatePlayerShipHeading(deltaTime: number): void {
    if (!this.playerShipRoot) return;
    const dx = this.playerShipTargetPosition.x - this.playerShipBasePosition.x;
    const dz = this.playerShipTargetPosition.z - this.playerShipBasePosition.z;
    if (Math.hypot(dx, dz) < 0.02) return;

    const targetYaw = Math.atan2(dx, dz) + PLAYER_SHIP_MODEL_YAW_OFFSET;
    const currentYaw = this.playerShipRoot.rotation.y;
    const yawDelta = Math.atan2(Math.sin(targetYaw - currentYaw), Math.cos(targetYaw - currentYaw));
    const turn = Math.min(1, deltaTime * PLAYER_SHIP_TURN_RATE);
    this.playerShipRoot.rotation.set(
      PLAYER_SHIP_MODEL_PITCH,
      currentYaw + yawDelta * turn,
      PLAYER_SHIP_MODEL_ROLL,
    );
  }

  private updatePlayerShipTrail(deltaTime: number, previousPosition: Vector3, currentPosition: Vector3): void {
    if (!this.playerShipRoot?.isEnabled()) {
      this.playerShipLastTrailPosition = null;
      return;
    }
    this.playerShipTrailTimer += deltaTime;
    if (!this.playerShipLastTrailPosition) {
      this.playerShipLastTrailPosition = previousPosition.clone();
    }
    const distance = Vector3.Distance(this.playerShipLastTrailPosition, currentPosition);
    if (distance > PLAYER_SHIP_TRAIL_MAX_SEGMENT_DISTANCE) {
      this.playerShipLastTrailPosition = currentPosition.clone();
      this.playerShipTrailTimer = 0;
      return;
    }
    if (this.playerShipTrailTimer < PLAYER_SHIP_TRAIL_SAMPLE_INTERVAL || distance < PLAYER_SHIP_TRAIL_MIN_DISTANCE) return;
    this.playerShipTrailTimer = 0;

    const direction = currentPosition.subtract(this.playerShipLastTrailPosition);
    if (direction.lengthSquared() < 0.0001) return;
    this.createPlayerShipTrailSegment(this.playerShipLastTrailPosition, currentPosition);
    this.playerShipLastTrailPosition = currentPosition.clone();
  }

  private updatePlayerShipTrailFades(deltaTime: number): void {
    if (this.playerShipTrailSegments.length === 0) return;
    const nextSegments: typeof this.playerShipTrailSegments = [];
    for (const segment of this.playerShipTrailSegments) {
      segment.age += deltaTime;
      const life = Math.max(0, 1 - segment.age / segment.ttl);
      segment.material.alpha = PLAYER_SHIP_TRAIL_START_ALPHA * Math.pow(life, 1.35);
      if (segment.age < segment.ttl) {
        nextSegments.push(segment);
      } else {
        this.glowLayer.removeIncludedOnlyMesh(segment.mesh);
        segment.mesh.dispose();
        segment.material.dispose();
      }
    }
    this.playerShipTrailSegments = nextSegments;
  }

  private createPlayerShipTrailSegment(from: Vector3, to: Vector3): void {
    const path = [
      new Vector3(from.x, from.y - 0.22, from.z),
      new Vector3(to.x, to.y - 0.22, to.z),
    ];
    const material = new StandardMaterial("playerShipTrailSegmentMat", this.scene);
    material.diffuseColor = new Color3(0.02, 0.16, 0.48);
    material.emissiveColor = new Color3(0.08, 0.75, 1.0);
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    material.alpha = PLAYER_SHIP_TRAIL_START_ALPHA;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;

    const mesh = MeshBuilder.CreateTube(
      "playerShipTrailSegment",
      {
        path,
        radius: PLAYER_SHIP_TRAIL_RADIUS,
        tessellation: 8,
        cap: Mesh.NO_CAP,
      },
      this.scene,
    );
    mesh.material = material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    this.glowLayer.addIncludedOnlyMesh(mesh);
    this.playerShipTrailSegments.push({ mesh, material, age: 0, ttl: PLAYER_SHIP_TRAIL_TTL });
  }

  private disposePlayerShipTrail(): void {
    for (const segment of this.playerShipTrailSegments) {
      this.glowLayer.removeIncludedOnlyMesh(segment.mesh);
      segment.mesh.dispose();
      segment.material.dispose();
    }
    this.playerShipTrailSegments = [];
    this.playerShipLastTrailPosition = null;
    this.playerShipTrailTimer = 0;
  }

  private updateSelectedFleetRouteLine(): void {
    const route = this.getSelectedFleetRouteLinePoints();
    if (!route) {
      this.disposeSelectedFleetRouteLine();
      return;
    }

    const points = [
      new Vector3(route.from.x, route.from.y + SELECTED_FLEET_ROUTE_LINE_Y_OFFSET, route.from.z),
      new Vector3(route.to.x, route.to.y + SELECTED_FLEET_ROUTE_LINE_Y_OFFSET, route.to.z),
    ];
    this.disposeSelectedFleetRouteLine();
    this.selectedFleetRouteLine = MeshBuilder.CreateLines("selectedFleetRouteLine", { points }, this.scene);
    this.selectedFleetRouteLine.color = new Color3(1, 0.55, 0.08);
    this.selectedFleetRouteLine.alpha = 0.92;
    this.selectedFleetRouteLine.isPickable = false;
    this.glowLayer.addIncludedOnlyMesh(this.selectedFleetRouteLine);
  }

  private getSelectedFleetRouteLinePoints(): { from: Vector3; to: Vector3 } | null {
    const selectedFleetId = this.getPrimarySelectedFleetId();
    if (!selectedFleetId) return null;
    const fleet = this.serverFleets.find((candidate) => candidate.id === selectedFleetId);
    if (!fleet?.movementPlan) return null;

    const currentSegment = fleet.movementPlan.segments.find((segment) => (
      this.clockYear >= segment.startYear
      && this.clockYear < segment.endYear
      && segment.fromStarId === this.star.id
      && segment.toStarId === this.star.id
    ));
    if (currentSegment) {
      const progress = Math.max(
        0,
        Math.min(1, (this.clockYear - currentSegment.startYear) / Math.max(0.000001, currentSegment.endYear - currentSegment.startYear)),
      );
      const renderedFrom = this.playerShipRoot?.isEnabled()
        ? this.playerShipRoot.position.clone()
        : null;
      return {
        from: renderedFrom ?? this.vectorFromPosition({
          x: currentSegment.from.x + (currentSegment.to.x - currentSegment.from.x) * progress,
          y: currentSegment.from.y + (currentSegment.to.y - currentSegment.from.y) * progress,
          z: currentSegment.from.z + (currentSegment.to.z - currentSegment.from.z) * progress,
        }),
        to: this.vectorFromPosition(currentSegment.to),
      };
    }

    const nextLocalSegment = fleet.movementPlan.segments.find((segment) => (
      segment.kind !== "hyperlane"
      && segment.fromStarId === this.star.id
      && segment.toStarId === this.star.id
      && this.clockYear < segment.endYear
    ));
    if (!nextLocalSegment) return null;
    return {
      from: this.vectorFromPosition(nextLocalSegment.from),
      to: this.vectorFromPosition(nextLocalSegment.to),
    };
  }

  private vectorFromPosition(position: { x: number; y: number; z: number }): Vector3 {
    return new Vector3(position.x, position.y, position.z);
  }

  private getPrimarySelectedFleetId(): string | null {
    if (this.selectedFleetId && this.selectedFleetIds.has(this.selectedFleetId)) return this.selectedFleetId;
    return this.selectedFleetIds.values().next().value ?? null;
  }

  private disposeSelectedFleetRouteLine(): void {
    if (!this.selectedFleetRouteLine) return;
    this.glowLayer.removeIncludedOnlyMesh(this.selectedFleetRouteLine);
    this.selectedFleetRouteLine.dispose();
    this.selectedFleetRouteLine = null;
  }

  private updateSelectedBattleGroupOrderLine(): void {
    if (!this.selectedBattleGroupId) {
      this.disposeSelectedBattleGroupOrderLine();
      return;
    }
    const view = this.getVisibleBattleGroupViews().find((candidate) => candidate.id === this.selectedBattleGroupId);
    if (!view) {
      this.disposeSelectedBattleGroupOrderLine();
      return;
    }
    const targetView = view.targetGroupId
      ? this.getVisibleBattleGroupViews().find((candidate) => candidate.id === view.targetGroupId)
      : null;
    const to = targetView?.position ?? view.destination ?? null;
    if (!to) {
      this.disposeSelectedBattleGroupOrderLine();
      return;
    }
    const points = [
      new Vector3(view.position.x, SYSTEM_FLEET_Y + 0.18, view.position.z),
      new Vector3(to.x, SYSTEM_FLEET_Y + 0.18, to.z),
    ];
    this.disposeSelectedBattleGroupOrderLine();
    this.selectedBattleGroupOrderLine = MeshBuilder.CreateLines("selectedBattleGroupOrderLine", { points }, this.scene);
    this.selectedBattleGroupOrderLine.color = targetView ? new Color3(1, 0.34, 0.18) : new Color3(0.26, 1, 0.82);
    this.selectedBattleGroupOrderLine.alpha = 0.72;
    this.selectedBattleGroupOrderLine.isPickable = false;
    this.glowLayer.addIncludedOnlyMesh(this.selectedBattleGroupOrderLine);
  }

  private disposeSelectedBattleGroupOrderLine(): void {
    if (!this.selectedBattleGroupOrderLine) return;
    this.glowLayer.removeIncludedOnlyMesh(this.selectedBattleGroupOrderLine);
    this.selectedBattleGroupOrderLine.dispose();
    this.selectedBattleGroupOrderLine = null;
  }

  private beginFleetAction(action: ShipAction): void {
    const fleetId = this.getPrimarySelectedFleetId();
    if (!fleetId) {
      this.clearFleetAction();
      return;
    }

    if (action === "merge") {
      this.mergeSelectedFleets();
      return;
    }
    if (action === "retreatTo" || action === "emergencyRetreatTo") {
      this.options.onRequestFleetActionInGalaxy?.(fleetId, action);
      this.clearFleetAction();
      return;
    }
    if (action === "retreat") {
      this.options.onFleetCommand?.({
        type: "issueFleetTacticalOrder",
        fleetId,
        order: { type: "retreat", issuedAtYear: this.clockYear },
      });
      this.clearFleetAction();
      return;
    }
    if (action === "hold") {
      this.options.onFleetCommand?.({
        type: "issueFleetTacticalOrder",
        fleetId,
        order: { type: "hold", issuedAtYear: this.clockYear },
      });
      this.clearFleetAction();
      return;
    }
    if (action === "guard") {
      const fleet = this.serverFleets.find((candidate) => candidate.id === fleetId);
      const position = fleet ? this.getFleetRenderPosition(fleet) : undefined;
      this.options.onFleetCommand?.({
        type: "issueFleetTacticalOrder",
        fleetId,
        order: { type: "guard", guardPosition: position, issuedAtYear: this.clockYear },
      });
      this.clearFleetAction();
      return;
    }
    if (action === "attack") {
      this.issueBasicAttack(fleetId);
      this.clearFleetAction();
      return;
    }

    if (this.activeFleetAction === action) {
      this.clearFleetAction();
      return;
    }
    this.activeFleetAction = action;
    this.selectionPanel?.setActiveShipAction(action);
    this.rebuildSystemActionTargetMarkers();
  }

  private clearFleetAction(): void {
    this.activeFleetAction = null;
    this.selectionPanel?.setActiveShipAction(null);
    this.disposeSystemActionTargetMarkers();
  }

  private mergeSelectedFleets(): void {
    const targetFleetId = this.selectedFleetId ?? this.getPrimarySelectedFleetId();
    if (!targetFleetId) {
      this.clearFleetAction();
      return;
    }
    const sourceFleetIds = Array.from(this.selectedFleetIds).filter((fleetId) => fleetId !== targetFleetId);
    if (sourceFleetIds.length === 0) {
      this.clearFleetAction();
      return;
    }
    this.options.onFleetCommand?.({ type: "mergeFleets", targetFleetId, sourceFleetIds });
    this.clearFleetAction();
  }

  private issueBasicAttack(fleetId: string): void {
    const fleet = this.serverFleets.find((candidate) => candidate.id === fleetId);
    if (!fleet) return;
    const hostileFleet = this.serverFleets.find((candidate) => (
      candidate.id !== fleet.id
      && candidate.currentStarId === fleet.currentStarId
      && candidate.ownerId !== fleet.ownerId
    ));
    if (hostileFleet) {
      this.options.onFleetCommand?.({
        type: "attackTarget",
        fleetId,
        targetKind: "fleet",
        targetId: hostileFleet.id,
      });
      return;
    }
    const hostileStarbase = this.starbases.find((candidate) => (
      candidate.starId === fleet.currentStarId
      && candidate.ownerId !== fleet.ownerId
    ));
    if (hostileStarbase) {
      this.options.onFleetCommand?.({
        type: "attackTarget",
        fleetId,
        targetKind: "starbase",
        targetId: hostileStarbase.id,
      });
    }
  }

  private rebuildSystemActionTargetMarkers(): void {
    this.disposeSystemActionTargetMarkers();
    const targets = this.getSystemActionTargets();
    if (targets.length === 0) return;
    const material = this.getSystemActionMarkerMaterial();
    for (const target of targets) {
      const root = new TransformNode(`systemActionTarget_${target.kind}_${target.starId}`, this.scene);
      root.position.set(target.markerPosition.x, target.markerPosition.y, target.markerPosition.z);
      const radius = this.getSystemActionMarkerRadius(target);
      const meshes = this.createSystemActionMarkerBoxes(root, material, radius);
      this.systemActionTargetRoots.push({ root, target, meshes });
    }
  }

  private getSystemActionMarkerMaterial(): StandardMaterial {
    if (!this.systemActionMarkerMaterial) {
      const material = new StandardMaterial("systemActionTargetMarkerMat", this.scene);
      material.diffuseColor = SYSTEM_ACTION_MARKER_COLOR.scale(0.14);
      material.emissiveColor = SYSTEM_ACTION_MARKER_COLOR.scale(2.2);
      material.specularColor = Color3.Black();
      material.disableLighting = true;
      material.backFaceCulling = false;
      material.alpha = 0.58;
      material.alphaMode = 2;
      this.systemActionMarkerMaterial = material;
    }
    return this.systemActionMarkerMaterial;
  }

  private createSystemActionMarkerBoxes(
    parent: TransformNode,
    material: StandardMaterial,
    radius: number,
  ): Mesh[] {
    const meshes: Mesh[] = [];
    const angles = [-Math.PI / 2, Math.PI / 6, (Math.PI * 5) / 6];
    const width = Math.max(1.8, radius * 0.42);
    const depth = Math.max(1.0, radius * 0.22);
    const thickness = Math.max(0.16, radius * 0.045);
    for (let i = 0; i < angles.length; i++) {
      const angle = angles[i];
      const radialX = Math.cos(angle);
      const radialZ = Math.sin(angle);
      const box = MeshBuilder.CreateBox(
        `systemActionTargetRect_${i}`,
        { width, height: thickness, depth },
        this.scene,
      );
      box.parent = parent;
      box.position.set(radialX * radius, 0, radialZ * radius);
      box.rotation.y = -angle - Math.PI / 2;
      box.material = material;
      box.isPickable = true;
      box.alwaysSelectAsActiveMesh = true;
      this.glowLayer.addIncludedOnlyMesh(box);
      meshes.push(box);
    }
    return meshes;
  }

  private updateSystemActionTargetMarkers(): void {
    if (this.systemActionTargetRoots.length === 0) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * SYSTEM_ACTION_MARKER_PULSE_SPEED);
    const scale = 0.94 + pulse * 0.12;
    if (this.systemActionMarkerMaterial) {
      this.systemActionMarkerMaterial.alpha = 0.42 + pulse * 0.22;
      this.systemActionMarkerMaterial.emissiveColor = SYSTEM_ACTION_MARKER_COLOR.scale(1.6 + pulse * 1.0);
    }
    for (const item of this.systemActionTargetRoots) {
      const target = this.resolveSystemActionTargetMarkerPosition(item.target);
      item.target = target;
      item.root.position.set(target.markerPosition.x, target.markerPosition.y, target.markerPosition.z);
      item.root.rotation.y = -this.elapsed * SYSTEM_ACTION_MARKER_ROTATION_SPEED;
      item.root.scaling.set(scale, scale, scale);
    }
  }

  private disposeSystemActionTargetMarkers(): void {
    for (const item of this.systemActionTargetRoots) {
      for (const mesh of item.meshes) {
        this.glowLayer.removeIncludedOnlyMesh(mesh);
        mesh.dispose();
      }
      item.root.dispose();
    }
    this.systemActionTargetRoots = [];
  }

  private getSystemActionTargets(): SystemActionTarget[] {
    if (!this.activeFleetAction) return [];
    if (this.activeFleetAction === "build") {
      const starPosition = getSystemStarOrbitPosition();
      return [{
        kind: "star",
        label: this.star.name,
        starId: this.star.id,
        position: starPosition,
        markerPosition: { x: 0, y: SYSTEM_FLEET_Y, z: 0 },
      }];
    }
    if (this.activeFleetAction !== "move") return [];

    const targets: SystemActionTarget[] = [];
    const starPosition = getSystemStarOrbitPosition();
    targets.push({
      kind: "star",
      label: this.star.name,
      starId: this.star.id,
      position: starPosition,
      markerPosition: { x: 0, y: SYSTEM_FLEET_Y, z: 0 },
    });

    const starbase = this.getStarbasesInCurrentSystem()[0];
    if (starbase) {
      const starbasePosition = starbase.systemPosition ?? getSystemStarbasePosition();
      const starbaseOrbitPosition = getSystemStarbaseOrbitPosition(starbasePosition);
      targets.push({
        kind: "starbase",
        label: "Starbase",
        starId: this.star.id,
        starbaseId: starbase.id,
        position: starbaseOrbitPosition,
        markerPosition: starbasePosition,
      });
    }

    for (let i = 0; i < this.planetConfigs.length; i++) {
      const planet = this.planetConfigs[i];
      const mesh = this.planetMeshes[i];
      if (!planet || !mesh) continue;
      targets.push(this.resolveSystemActionTargetMarkerPosition({
        kind: "planet",
        label: planet.name,
        starId: this.star.id,
        planetId: planet.id,
        position: { x: mesh.position.x, y: SYSTEM_FLEET_Y, z: mesh.position.z },
        markerPosition: { x: mesh.position.x, y: SYSTEM_FLEET_Y, z: mesh.position.z },
      }));
    }

    for (const exit of this.hyperlaneExits) {
      const markerPosition = exit.systemPosition ?? getHyperlaneExitSystemPosition(exit);
      const destinationPosition = getHyperlaneExitSystemPosition({ dx: -exit.dx, dz: -exit.dz });
      targets.push({
        kind: "hyperlane",
        label: exit.name,
        starId: exit.starId,
        connectedStarId: exit.starId,
        position: destinationPosition,
        markerPosition: { x: markerPosition.x, y: SYSTEM_FLEET_Y, z: markerPosition.z },
      });
    }
    return targets;
  }

  private resolveSystemActionTargetMarkerPosition(target: SystemActionTarget): SystemActionTarget {
    if (target.kind !== "planet" || !target.planetId) return target;
    const index = this.planetConfigs.findIndex((planet) => planet.id === target.planetId);
    const mesh = index >= 0 ? this.planetMeshes[index] : null;
    if (!mesh) return target;
    return {
      ...target,
      position: { x: mesh.position.x, y: SYSTEM_FLEET_Y, z: mesh.position.z },
      markerPosition: { x: mesh.position.x, y: SYSTEM_FLEET_Y, z: mesh.position.z },
    };
  }

  private getSystemActionMarkerRadius(target: SystemActionTarget): number {
    if (target.kind === "star") return Math.max(6, this.starDiameter * 0.75);
    if (target.kind === "planet" && target.planetId) {
      const index = this.planetConfigs.findIndex((planet) => planet.id === target.planetId);
      return Math.max(2.2, (this.planetDiameters[index] ?? 2) * 0.9);
    }
    if (target.kind === "starbase") return 6.8;
    return 2.9;
  }

  private tryIssueActiveFleetActionAtPointer(ev: PointerEvent): boolean {
    if (!this.activeFleetAction) return false;
    const markerTarget = this.pickSystemActionTarget(ev);
    if (markerTarget) {
      this.issueFleetActionTarget(markerTarget);
      return true;
    }
    if (this.activeFleetAction === "move") {
      const position = this.getPointerSystemPlanePosition(ev);
      if (position) {
        this.issueMoveToSystemPosition(position);
      } else {
        this.clearFleetAction();
      }
      return true;
    }
    this.clearFleetAction();
    return true;
  }

  private pickSystemActionTarget(ev: PointerEvent): SystemActionTarget | null {
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas || this.systemActionTargetRoots.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const canvasX = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (ev.clientY - rect.top) * (canvas.height / rect.height);
    const targetMeshes = new Set(this.systemActionTargetRoots.flatMap((item) => item.meshes));
    const pick = this.scene.pick(
      canvasX,
      canvasY,
      (mesh) => targetMeshes.has(mesh as Mesh),
    );
    if (!pick?.hit || !pick.pickedMesh) return null;
    const item = this.systemActionTargetRoots.find((candidate) => candidate.meshes.includes(pick.pickedMesh as Mesh));
    return item?.target ?? null;
  }

  private getPointerSystemPlanePosition(ev: PointerEvent): SystemPosition | null {
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const canvasX = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (ev.clientY - rect.top) * (canvas.height / rect.height);
    const ray = this.scene.createPickingRay(canvasX, canvasY, Matrix.Identity(), this.camera);
    if (Math.abs(ray.direction.y) < 0.0001) return null;
    const t = (0 - ray.origin.y) / ray.direction.y;
    if (t < 0) return null;
    const hit = ray.origin.add(ray.direction.scale(t));
    const distance = Math.hypot(hit.x, hit.z);
    const scale = distance > SYSTEM_ACTION_MARKER_MAX_EMPTY_MOVE_RADIUS
      ? SYSTEM_ACTION_MARKER_MAX_EMPTY_MOVE_RADIUS / distance
      : 1;
    return { x: hit.x * scale, y: SYSTEM_FLEET_Y, z: hit.z * scale };
  }

  private issueFleetActionTarget(target: SystemActionTarget): void {
    if (this.activeFleetAction === "build") {
      this.issueBuildAtStar();
      return;
    }
    if (this.activeFleetAction !== "move") {
      this.clearFleetAction();
      return;
    }
    if (target.kind === "planet" && target.planetId) {
      const fleetId = this.getPrimarySelectedFleetId();
      if (fleetId) this.options.onFleetCommand?.({ type: "orbitPlanet", fleetId, planetId: target.planetId });
      this.clearFleetAction();
      return;
    }
    const orbitTarget = this.createFleetOrbitTarget(target);
    this.issueMoveToSystemPosition(target.position, target.starId, orbitTarget);
  }

  private issueMoveToSystemPosition(
    position: SystemPosition,
    targetStarId = this.star.id,
    orbitTarget: FleetOrbitTarget | null = null,
  ): void {
    if (this.selectedBattleGroupId) {
      const fleetId = this.getFleetIdForBattleGroup(this.selectedBattleGroupId);
      if (fleetId) {
        this.options.onFleetCommand?.({
          type: "issueBattleGroupOrder",
          fleetId,
          battleGroupId: this.selectedBattleGroupId,
          order: { type: "move", targetPosition: position, issuedAtYear: this.clockYear },
        });
      }
      this.clearFleetAction();
      return;
    }
    const fleetId = this.getPrimarySelectedFleetId();
    if (!fleetId) {
      this.clearFleetAction();
      return;
    }
    this.options.onFleetCommand?.({
      type: "moveFleet",
      fleetId,
      targetStarId,
      targetSystemPosition: position,
      orbitTarget,
    });
    this.clearFleetAction();
  }

  private issueBuildAtStar(): void {
    const fleetId = this.getPrimarySelectedFleetId();
    if (fleetId) {
      this.options.onFleetCommand?.({ type: "buildStarbase", fleetId, targetStarId: this.star.id });
    }
    this.clearFleetAction();
  }

  private createFleetOrbitTarget(target: SystemActionTarget): FleetOrbitTarget | null {
    if (target.kind === "planet" || !target.kind) return null;
    return {
      kind: target.kind,
      starId: target.starId,
      position: target.position,
      starbaseId: target.starbaseId ?? null,
      connectedStarId: target.connectedStarId ?? null,
    };
  }

  private faceSystemLabelToCamera(labelMesh: Mesh): void {
    const camera = this.scene.activeCamera ?? this.camera;
    if (!camera) return;

    const toCamera = camera.position.subtract(labelMesh.position);
    if (toCamera.lengthSquared() < 0.0001) return;

    const normal = toCamera.normalize();
    const cameraRight = camera.getDirection(Vector3.Right()).normalize();
    const cameraUp = camera.getDirection(Vector3.Up()).normalize();

    let right = cameraRight.subtract(normal.scale(Vector3.Dot(cameraRight, normal)));
    if (right.lengthSquared() < 0.0001) {
      right = Vector3.Cross(Vector3.Up(), normal);
    }
    if (right.lengthSquared() < 0.0001) {
      right = Vector3.Right();
    }
    right.normalize();
    if (Vector3.Dot(right, cameraRight) < 0) {
      right.scaleInPlace(-1);
    }

    let up = Vector3.Cross(normal, right);
    if (Vector3.Dot(up, cameraUp) < 0) {
      right.scaleInPlace(-1);
      up = Vector3.Cross(normal, right);
    }
    up.normalize();

    const rotationMatrix = Matrix.Identity();
    Matrix.FromXYZAxesToRef(right, up, normal, rotationMatrix);
    labelMesh.rotationQuaternion = Quaternion.FromRotationMatrix(rotationMatrix);
  }

  private refreshSystemEntityCards(): void {
    this.entityCardLayer?.remove();
    this.entityCardLayer = null;

    const allFleets = this.getFleetsInCurrentSystem();
    const starbases = this.getStarbasesInCurrentSystem();
    const battleGroups = this.getVisibleBattleGroupViews();
    const groupedFleetIds = new Set(battleGroups.map((group) => group.fleetId).filter((id): id is string => !!id));
    const fleets = allFleets.filter((fleet) => !groupedFleetIds.has(fleet.id));
    if (fleets.length === 0 && starbases.length === 0 && battleGroups.length === 0) return;

    this.injectSystemEntityCardStyles();
    const root = document.getElementById("spaceHudRoot") ?? document.body;
    const layer = document.createElement("div");
    layer.className = "systemEntityCardLayer";
    this.entityCardLayer = layer;

    fleets.forEach((fleet, index) => {
      const owner = this.getFaction(fleet.ownerId);
      const card = document.createElement("button");
      card.type = "button";
      card.className = "systemEntityCard fleet";
      card.dataset.entityKind = "fleet";
      card.dataset.entityId = fleet.id;
      card.dataset.offsetY = String(-28 - index * 36);
      card.style.setProperty("--entity-accent", this.factionColorCss(owner, "rgba(88, 211, 255, 0.95)"));
      card.innerHTML = `
        <span class="systemEntityFlag">${this.getFactionFlagSvg(fleet.ownerId)}</span>
        <span class="systemEntityCopy">
          <strong>${this.escapeHtml(this.formatFleetPower(fleet, index))}</strong>
          <small>${this.escapeHtml(this.formatFleetStatus(fleet))}</small>
        </span>
        <span class="systemEntityIcon">F</span>
      `;
      card.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.selectFleetFromCard(fleet, ev.shiftKey);
      });
      layer.appendChild(card);
    });

    battleGroups.forEach((group, index) => {
      const owner = this.getFaction(group.ownerId);
      const card = document.createElement("button");
      card.type = "button";
      card.className = "systemEntityCard battleGroup";
      card.dataset.entityKind = "battleGroup";
      card.dataset.entityId = group.id;
      card.dataset.offsetY = String(-24 - index * 22);
      card.style.setProperty("--entity-accent", this.factionColorCss(owner, "rgba(108, 236, 255, 0.95)"));
      card.innerHTML = `
        <span class="systemEntityFlag">${this.getFactionFlagSvg(group.ownerId)}</span>
        <span class="systemEntityCopy">
          <strong>${this.escapeHtml(group.name)}</strong>
          <small>${this.escapeHtml(`${group.behavior} | ${group.count} | ${group.order}`)}</small>
        </span>
        <span class="systemEntityIcon">BG</span>
      `;
      card.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.selectBattleGroup(group, ev.shiftKey);
      });
      layer.appendChild(card);
    });

    starbases.forEach((starbase, index) => {
      const owner = this.getFaction(starbase.ownerId);
      const card = document.createElement("button");
      card.type = "button";
      card.className = "systemEntityCard starbase";
      card.dataset.entityKind = "starbase";
      card.dataset.entityId = starbase.id;
      card.dataset.offsetY = String(-16 - index * 34);
      card.style.setProperty("--entity-accent", this.factionColorCss(owner, "rgba(255, 207, 115, 0.95)"));
      card.innerHTML = `
        <span class="systemEntityFlag">${this.getFactionFlagSvg(starbase.ownerId)}</span>
        <span class="systemEntityCopy">
          <strong>${this.escapeHtml(this.formatStarbasePower(starbase))}</strong>
          <small>${this.escapeHtml(starbase.status === "building" ? "Building" : "Starbase")}</small>
        </span>
        <span class="systemEntityIcon">SB</span>
      `;
      card.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.openStarbasePanel(starbase);
      });
      layer.appendChild(card);
    });

    root.appendChild(layer);
    this.updateSystemEntityCards();
  }

  private updateSystemEntityCards(): void {
    if (!this.entityCardLayer) return;
    const visibleCards: Array<{ card: HTMLElement; x: number; y: number }> = [];
    for (const card of Array.from(this.entityCardLayer.querySelectorAll<HTMLElement>(".systemEntityCard"))) {
      const kind = card.dataset.entityKind;
      const id = card.dataset.entityId;
      const offsetY = Number(card.dataset.offsetY ?? "0");
      const anchor = kind === "fleet"
        ? this.getFleetCardAnchor(id)
        : kind === "battleGroup"
          ? this.getBattleGroupCardAnchor(id)
          : this.getStarbaseCardAnchor(id);
      const projected = anchor ? this.projectToScreen(anchor) : null;
      if (!projected) {
        card.style.display = "none";
        continue;
      }
      card.style.display = "grid";
      visibleCards.push({ card, x: projected.x, y: projected.y + offsetY });
    }
    visibleCards.sort((a, b) => a.y - b.y || a.x - b.x);
    const placed: Array<{ x: number; y: number }> = [];
    for (const item of visibleCards) {
      let y = item.y;
      for (let guard = 0; guard < 12; guard += 1) {
        const collision = placed.find((other) => Math.abs(other.x - item.x) < 150 && Math.abs(other.y - y) < 34);
        if (!collision) break;
        y = collision.y + 34;
      }
      placed.push({ x: item.x, y });
      item.card.style.left = `${item.x}px`;
      item.card.style.top = `${y}px`;
    }
  }

  private getFleetsInCurrentSystem(): ServerFleet[] {
    return this.serverFleets.filter((fleet) => (
      fleet.currentStarId === this.star.id && fleet.phase !== "jumpingHyperlane"
    ));
  }

  private getFleetRenderPosition(fleet: ServerFleet): SystemPosition {
    const keyedPosition = this.fleetSystemPositions[fleet.id];
    if (keyedPosition) return keyedPosition;
    return fleet.systemPosition ?? { x: PLAYER_SHIP_BASE_POSITION.x, y: SYSTEM_FLEET_Y, z: PLAYER_SHIP_BASE_POSITION.z };
  }

  private getActiveBattleFleetIds(): Set<string> {
    return new Set(this.battles
      .filter((battle) => battle.starId === this.star.id && battle.phase !== "resolved")
      .flatMap((battle) => [...battle.attackerFleetIds, ...battle.defenderFleetIds]));
  }

  private getVisibleFleetViews(): TacticalFleetView[] {
    const activeBattleFleetIds = this.getActiveBattleFleetIds();
    return this.getFleetsInCurrentSystem()
      .filter((fleet) => !activeBattleFleetIds.has(fleet.id) && !fleet.alertMode && fleet.shipIds.length > 0)
      .map((fleet) => {
        const defense = this.getFleetDefense(fleet.id);
        const current = defense.shield + defense.armor + defense.hull;
        const max = defense.maxShield + defense.maxArmor + defense.maxHull;
        const owner = this.getFaction(fleet.ownerId);
        return {
          id: fleet.id,
          ownerId: fleet.ownerId,
          name: owner ? `${owner.name} Fleet` : "Unidentified Fleet",
          shipIds: [...fleet.shipIds],
          position: this.getFleetRenderPosition(fleet),
          status: this.formatFleetStatus(fleet),
          hpRatio: max > 0 ? current / max : 0,
          tacticalRadius: fleet.tacticalRadius ?? getFleetTacticalRadius(fleet.shipIds.length),
          maxWeaponRange: fleet.maxWeaponRange ?? 0,
        };
      });
  }

  private getStarbasesInCurrentSystem(): ServerStarbase[] {
    return this.starbases.filter((starbase) => starbase.starId === this.star.id);
  }

  private getFleetCardAnchor(fleetId?: string): Vector3 | null {
    if (!fleetId) return null;
    const fleet = this.serverFleets.find((candidate) => candidate.id === fleetId);
    if (!fleet || fleet.currentStarId !== this.star.id || fleet.phase === "jumpingHyperlane") return null;
    const fleetRoot = this.fleetRoots.get(fleet.id);
    if (fleetRoot?.isEnabled()) {
      return fleetRoot.position.add(new Vector3(0, 2.6, 0));
    }
    const groupRoots = Array.from(this.battleGroupRoots.entries())
      .filter(([groupId]) => (fleet.battleGroups ?? []).some((group) => group.id === groupId))
      .map(([, root]) => root)
      .filter((root) => root.isEnabled());
    if (groupRoots.length > 0) {
      const center = groupRoots.reduce((total, root) => total.add(root.position), Vector3.Zero()).scale(1 / groupRoots.length);
      return center.add(new Vector3(0, 3.0, 0));
    }
    if (this.playerShipRoot?.isEnabled() && fleet.ownerId === this.playerFactionId) {
      return this.playerShipRoot.position.add(new Vector3(0, 2.6, 0));
    }
    const position = this.getFleetRenderPosition(fleet);
    return new Vector3(position.x, position.y + 2.6, position.z);
  }

  private getBattleGroupCardAnchor(groupId?: string): Vector3 | null {
    if (!groupId) return null;
    const root = this.battleGroupRoots.get(groupId);
    if (root?.isEnabled()) return root.position.add(new Vector3(0, 2.4, 0));
    const view = this.getVisibleBattleGroupViews().find((candidate) => candidate.id === groupId);
    if (!view) return null;
    return new Vector3(view.position.x, SYSTEM_FLEET_Y + 2.8, view.position.z);
  }

  private getStarbaseCardAnchor(starbaseId?: string): Vector3 | null {
    if (!starbaseId) return null;
    const starbase = this.starbases.find((candidate) => candidate.id === starbaseId);
    if (!starbase || starbase.starId !== this.star.id) return null;
    if (this.starbaseRoot?.isEnabled()) {
      return this.starbaseRoot.position.add(new Vector3(0, 2.8, 0));
    }
    const starRadius = Math.max(0.6, this.starDiameter * 0.5);
    return new Vector3(3.2, 8.5 + 2.8, -(starRadius + 4.5 + 10));
  }

  private projectToScreen(world: Vector3): { x: number; y: number } | null {
    const canvas = this.engine.getRenderingCanvas();
    const camera = this.scene.activeCamera ?? this.camera;
    if (!canvas || !camera) return null;
    const viewport = camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight());
    const projected = Vector3.Project(world, Matrix.Identity(), this.scene.getTransformMatrix(), viewport);
    if (projected.z < 0 || projected.z > 1) return null;
    const rect = canvas.getBoundingClientRect();
    const xScale = rect.width / Math.max(1, this.engine.getRenderWidth());
    const yScale = rect.height / Math.max(1, this.engine.getRenderHeight());
    return {
      x: rect.left + projected.x * xScale,
      y: rect.top + projected.y * yScale,
    };
  }

  private selectFleetFromCard(fleet: ServerFleet, shiftKey: boolean): void {
    if (!shiftKey) this.selectedFleetIds.clear();
    this.selectedBattleGroupId = null;
    this.selectedFleetIds.add(fleet.id);
    this.selectedFleetId = fleet.id;
    this.notifyFleetSelectionChanged();
    this.selectionPanel.select(this.createFleetSelectionData(fleet), shiftKey);
    this.refreshFleetMarkers();
  }

  private createFleetSelectionData(fleet: ServerFleet): SelectionData {
    const owner = this.getFaction(fleet.ownerId);
    const ships = this.getShipsForFleet(fleet.id);
    const shipCount = fleet.shipIds.length || ships.length || 1;
    const defense = this.getFleetDefense(fleet.id);
    const actions: ShipAction[] = ["move", "attack", "hold", "guard", "retreat", "retreatTo", "emergencyRetreatTo", "build", "merge"];
    const doctrine = fleet.combatSettings
      ? `${fleet.combatStance} | ${fleet.combatSettings.behavior} | retreat ${fleet.combatSettings.retreatPolicy}`
      : this.formatFleetNavigationDetail(fleet);
    return {
      type: "fleet",
      id: fleet.id,
      name: owner ? `${owner.name} Fleet` : "Unidentified Fleet",
      hp: defense.hull,
      maxHp: defense.maxHull,
      shield: defense.shield,
      maxShield: defense.maxShield,
      armor: defense.armor,
      maxArmor: defense.maxArmor,
      hull: defense.hull,
      maxHull: defense.maxHull,
      class: shipCount === 1 ? "Single-Ship Fleet" : `${shipCount} Ships`,
      status: fleet.combatStatus && fleet.combatStatus !== "idle" ? fleet.combatStatus : this.formatFleetStatus(fleet),
      detail: fleet.ownerId === this.playerFactionId
        ? doctrine
        : "Foreign fleet. Tactical details are limited.",
      ownerName: owner?.name ?? "Unknown",
      ownerColor: owner?.color,
      canCommand: fleet.ownerId === this.playerFactionId,
      actions: fleet.ownerId === this.playerFactionId ? actions : undefined,
    };
  }

  private renderSelectedFleetPanels(): void {
    if (!this.selectionPanel) return;
    this.selectionPanel.clear();
    let append = false;
    for (const fleetId of this.selectedFleetIds) {
      const fleet = this.serverFleets.find((candidate) => candidate.id === fleetId);
      if (!fleet) continue;
      this.selectionPanel.select(this.createFleetSelectionData(fleet), append);
      append = true;
    }
    if (append && this.activeFleetAction) {
      this.selectionPanel.setActiveShipAction(this.activeFleetAction);
    }
    if (!append) {
      this.selectedFleetIds.clear();
      this.selectedFleetId = null;
      this.clearFleetAction();
      this.notifyFleetSelectionChanged();
    }
  }

  private clearFleetSelection(): void {
    if (this.selectedFleetIds.size === 0 && !this.selectedFleetId && !this.selectedBattleGroupId) return;
    this.selectedFleetIds.clear();
    this.selectedFleetId = null;
    this.selectedBattleGroupId = null;
    this.selectionPanel?.clear();
    this.disposeSelectedFleetRouteLine();
    this.disposeSelectedBattleGroupOrderLine();
    this.clearFleetAction();
    this.notifyFleetSelectionChanged();
  }

  private notifyFleetSelectionChanged(): void {
    this.options.onSelectedFleetIdsChange?.(Array.from(this.selectedFleetIds));
  }

  private handleSelectedFleetAction(action: ShipAction, selection?: SelectionData): void {
    if (selection?.type === "battleGroup" && selection.id) {
      this.selectedBattleGroupId = selection.id;
      this.beginBattleGroupAction(action, selection);
      return;
    }
    if (selection?.id && this.selectedFleetIds.has(selection.id)) {
      this.selectedFleetId = selection.id;
    }
    this.beginFleetAction(action);
  }

  private beginBattleGroupAction(action: ShipAction, selection: SelectionData): void {
    const fleetId = this.getFleetIdForBattleGroup(selection.id ?? "");
    const battleGroupId = selection.id;
    if (!fleetId || !battleGroupId) return;
    if (action === "retreat") {
      this.options.onFleetCommand?.({
        type: "issueBattleGroupOrder",
        fleetId,
        battleGroupId,
        order: { type: "retreat", issuedAtYear: this.clockYear },
      });
      this.clearFleetAction();
      return;
    }
    if (action === "hold") {
      this.options.onFleetCommand?.({
        type: "issueBattleGroupOrder",
        fleetId,
        battleGroupId,
        order: { type: "hold", issuedAtYear: this.clockYear },
      });
      this.clearFleetAction();
      return;
    }
    if (action === "protect") {
      const protectedTarget = this.getBestProtectTargetForBattleGroup(battleGroupId);
      if (protectedTarget) {
        this.options.onFleetCommand?.({
          type: "issueBattleGroupOrder",
          fleetId,
          battleGroupId,
          order: {
            type: "protect",
            protectedTarget: {
              kind: "battleGroup",
              id: protectedTarget.id,
              position: protectedTarget.position,
            },
            issuedAtYear: this.clockYear,
          },
        });
      }
      this.clearFleetAction();
      return;
    }
    if (action === "attack") {
      const target = this.getNearestHostileCombatGroup(battleGroupId);
      if (target) {
        this.options.onFleetCommand?.({
          type: "issueBattleGroupOrder",
          fleetId,
          battleGroupId,
          order: { type: "attack", targetGroupId: target.id, targetObjectId: target.sourceObjectId, issuedAtYear: this.clockYear },
        });
      }
      this.clearFleetAction();
      return;
    }
    if (action === "move") {
      this.activeFleetAction = "move";
      this.selectionPanel?.setActiveShipAction(action);
      return;
    }
  }

  private getFleetIdForBattleGroup(battleGroupId: string): string | null {
    for (const fleet of this.serverFleets) {
      if ((fleet.battleGroups ?? []).some((group) => group.id === battleGroupId)) return fleet.id;
    }
    for (const battle of this.battles) {
      const group = (battle.combatGroups ?? []).find((candidate) => candidate.id === battleGroupId);
      if (group?.sourceFleetId) return group.sourceFleetId;
    }
    return null;
  }

  private getBestProtectTargetForBattleGroup(battleGroupId: string): TacticalBattleGroupView | null {
    const views = this.getVisibleBattleGroupViews();
    const source = views.find((view) => view.id === battleGroupId);
    if (!source) return null;
    const behaviorPriority: Record<string, number> = {
      artillery: 80,
      line: 55,
      defender: 35,
      brawler: 20,
      screen: 10,
    };
    return views
      .filter((view) => view.id !== source.id && view.ownerId === source.ownerId)
      .sort((a, b) => {
        const aScore = (behaviorPriority[a.behavior] ?? 0)
          + (a.fleetId === source.fleetId ? 12 : 0)
          - this.distance2d(source.position, a.position) * 0.2;
        const bScore = (behaviorPriority[b.behavior] ?? 0)
          + (b.fleetId === source.fleetId ? 12 : 0)
          - this.distance2d(source.position, b.position) * 0.2;
        return bScore - aScore;
      })[0] ?? null;
  }

  private getNearestHostileCombatGroup(battleGroupId: string): CombatGroup | null {
    const groups = this.battles
      .filter((battle) => battle.starId === this.star.id && battle.phase !== "resolved")
      .flatMap((battle) => battle.combatGroups ?? []);
    const source = groups.find((group) => group.id === battleGroupId);
    if (!source) return null;
    return groups
      .filter((group) => group.id !== source.id && group.ownerId !== source.ownerId && group.status !== "destroyed" && group.status !== "escaped")
      .sort((a, b) => this.distance2d(source.position, a.position) - this.distance2d(source.position, b.position))[0] ?? null;
  }

  private distance2d(a: SystemPosition, b: SystemPosition): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  private openStarbasePanel(starbase: ServerStarbase): void {
    const owner = this.getFaction(starbase.ownerId);
    this.clearFleetSelection();
    const battle = this.getBattleForStarbase(starbase.id);
    if (battle) {
      this.starbasePanel.close();
      this.selectionPanel.select({
        type: "starbase",
        id: starbase.id,
        name: `${this.star.name} Starbase`,
        hp: starbase.hull,
        maxHp: starbase.maxHull,
        shield: starbase.shield,
        maxShield: starbase.maxShield,
        armor: starbase.armor,
        maxArmor: starbase.maxArmor,
        hull: starbase.hull,
        maxHull: starbase.maxHull,
        class: "Station",
        status: "Engaged",
        detail: "Station is engaged in battle.",
        ownerName: owner?.name ?? "Unknown",
        ownerColor: owner?.color,
        canCommand: false,
        battle: this.createBattleSelectionData(battle, `starbase:${starbase.id}`),
      }, false);
      return;
    }
    this.starbasePanel.show({
      id: starbase.id,
      name: `${this.star.name} Station`,
      systemName: `${this.star.name} System`,
      ownerName: owner?.name,
      ownerColor: owner?.color,
      status: starbase.status,
      power: this.formatStarbasePower(starbase),
      starbase,
      onStarbaseCommand: (command) => this.options.onPlanetCommand?.(command),
    });
  }

  private getFaction(ownerId: number): FactionInfo | null {
    return this.factions.find((faction) => faction.id === ownerId) ?? null;
  }

  private getFactionFlagSvg(ownerId: number): string {
    const cached = this.factionFlagSvgCache.get(ownerId);
    if (cached) return cached;
    const svg = renderFlagSvg(createFlagDesign({ seed: `system-entity-${ownerId}` }), {
      size: 26,
      className: "systemEntityFlagSvg",
      idPrefix: `system-entity-flag-${ownerId}`,
    });
    this.factionFlagSvgCache.set(ownerId, svg);
    return svg;
  }

  private factionColorCss(faction: FactionInfo | null, fallback: string): string {
    if (!faction) return fallback;
    const [r, g, b] = faction.color.map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255));
    return `rgba(${r}, ${g}, ${b}, 0.95)`;
  }

  private getShipsForFleet(fleetId: string): ServerShip[] {
    return this.serverShips.filter((ship) => ship.fleetId === fleetId);
  }

  private getBattleForFleet(fleetId: string): ServerBattle | null {
    return this.battles.find((battle) => (
      battle.phase !== "resolved"
      && (battle.attackerFleetIds.includes(fleetId) || battle.defenderFleetIds.includes(fleetId))
    )) ?? null;
  }

  private getBattleForStarbase(starbaseId: string): ServerBattle | null {
    return this.battles.find((battle) => (
      battle.phase !== "resolved"
      && battle.starbaseId === starbaseId
    )) ?? null;
  }

  private createEmptyDamage(): BattleLayerDamage {
    return { shield: 0, armor: 0, hull: 0 };
  }

  private createBattleSelectionData(battle: ServerBattle, focusParticipantId: string): SelectionData["battle"] {
    const focus = battle.participants?.find((participant) => participant.id === focusParticipantId)
      ?? battle.participants?.find((participant) => participant.ownerId === this.playerFactionId)
      ?? null;
    const hostileIds = new Set(focus?.hostileParticipantIds ?? []);
    const allied: BattleSelectionParticipant[] = [];
    const hostile: BattleSelectionParticipant[] = [];
    for (const participant of battle.participants ?? []) {
      const rendered = this.createBattleParticipantSummary(battle, participant.id);
      if (!rendered) continue;
      if (hostileIds.has(participant.id)) hostile.push(rendered);
      else allied.push(rendered);
    }
    return { battleId: battle.id, allied, hostile };
  }

  private createBattleParticipantSummary(battle: ServerBattle, participantId: string): BattleSelectionParticipant | null {
    const participant = battle.participants?.find((candidate) => candidate.id === participantId);
    if (!participant) return null;
    const owner = this.getFaction(participant.ownerId);
    const groups = (battle.combatGroups ?? [])
      .filter((group) => group.participantId === participantId && group.status !== "destroyed")
      .map((group) => {
        if (group.role === "station") return "Station";
        const kind = group.shipKind ? `${group.shipKind}` : "ships";
        const range = group.maxWeaponRange > 0 ? ` ${Math.round(group.maxWeaponRange)}u` : "";
        return `${group.behavior} ${group.count} ${kind}${range}`;
      });
    const stats = battle.stats?.byParticipant?.[participantId];
    const shots = stats ? Math.max(1, stats.shotsFired) : 1;
    const evasionAttempts = stats ? Math.max(1, stats.shotsHit + stats.shotsDodged) : 1;
    const topWeapons = Object.values(battle.stats?.weapons ?? {})
      .filter((weapon) => weapon.ownerParticipantId === participantId)
      .sort((a, b) => b.damageDealt - a.damageDealt)
      .slice(0, 3)
      .map((weapon) => `${weapon.weaponName} ${Math.round(weapon.damageDealt)}`);
    const name = participant.sourceType === "starbase"
      ? `${this.star.name} Starbase`
      : (participant.sourceType === "fleet" ? `${owner?.name ?? "Unknown"} Fleet` : participant.sourceType);
    return {
      id: participant.id,
      name,
      ownerName: owner?.name ?? "Unknown",
      status: participant.status,
      groups,
      damageDealt: stats?.damageDealt ?? this.createEmptyDamage(),
      damageReceived: stats?.damageReceived ?? this.createEmptyDamage(),
      topWeapons,
      hitRate: stats ? stats.shotsHit / shots : 0,
      dodgeRate: stats ? stats.shotsDodged / evasionAttempts : 0,
      shipsLost: stats?.shipsLost ?? 0,
      escapedShips: stats?.escapedShips ?? 0,
    };
  }

  private getFleetDefense(fleetId: string): {
    shield: number;
    maxShield: number;
    armor: number;
    maxArmor: number;
    hull: number;
    maxHull: number;
  } {
    const ships = this.getShipsForFleet(fleetId);
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

  private hasActiveBattleInSystem(): boolean {
    return this.battles.some((battle) => battle.starId === this.star.id && battle.phase !== "resolved");
  }

  private formatFleetPower(fleet: ServerFleet, index: number): string {
    const ships = this.getShipsForFleet(fleet.id);
    const value = computeFleetPower(ships, Math.max(1, fleet.shipIds.length), undefined, this.shipDesigns);
    return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : `${Math.round(value / 1000)}K`;
  }

  private formatStarbasePower(starbase: ServerStarbase): string {
    const power = computeStarbasePower(starbase);
    return power >= 1_000_000 ? `${(power / 1_000_000).toFixed(1)}M` : `${Math.round(power / 1000)}K`;
  }

  private formatFleetStatus(fleet: ServerFleet): string {
    if (this.getBattleForFleet(fleet.id)) return "Engaged";
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

  private injectSystemEntityCardStyles(): void {
    const styleId = "system-entity-card-style";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
.systemEntityCardLayer {
  position: fixed;
  inset: 0;
  z-index: 54;
  pointer-events: none;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
}

.systemEntityCard {
  --entity-accent: rgba(88, 211, 255, 0.95);
  position: absolute;
  min-width: 124px;
  height: 34px;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 5px;
  padding: 3px 5px 3px 4px;
  pointer-events: auto;
  border: 1px solid color-mix(in srgb, var(--entity-accent) 72%, transparent);
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--entity-accent) 38%, rgba(5, 21, 28, 0.94)), rgba(4, 15, 20, 0.94)),
    radial-gradient(circle at 18% 50%, color-mix(in srgb, var(--entity-accent) 28%, transparent), transparent 3rem);
  color: #eaffff;
  cursor: pointer;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.42), inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  transform: translate(-50%, -50%);
  transition: transform 0.12s ease, filter 0.12s ease;
}

.systemEntityCard:hover {
  filter: brightness(1.16);
  transform: translate(-50%, -50%) scale(1.04);
}

.systemEntityCard.starbase {
  border-color: rgba(255, 212, 116, 0.74);
}

.systemEntityCard.battleGroup {
  min-width: 146px;
  height: 32px;
  opacity: 0.92;
}

.systemEntityFlag {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.6));
}

.systemEntityFlag svg {
  width: 26px;
  height: 26px;
  display: block;
  overflow: visible;
}

.systemEntityCopy {
  min-width: 0;
  display: grid;
  line-height: 1;
}

.systemEntityCopy strong {
  font-size: 12px;
  font-weight: 900;
  color: #ecfffb;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}

.systemEntityCopy small {
  margin-top: 3px;
  color: rgba(193, 230, 224, 0.72);
  font-size: 7px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.systemEntityIcon {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  clip-path: polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
  background: color-mix(in srgb, var(--entity-accent) 34%, rgba(0, 0, 0, 0.4));
  border: 1px solid color-mix(in srgb, var(--entity-accent) 82%, transparent);
  color: #ffffff;
  font-size: 10px;
}
    `;
    document.head.appendChild(style);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private updateStarOcclusionAndGlow(): void {
    if (!this.starMesh || !this.camera || !this.glowLayer) return;

    const camPos = this.camera.position;
    const starPos = this.starMesh.position;
    const dir = starPos.subtract(camPos);
    const dist = dir.length();
    if (dist <= 0.0001) return;

    const ray = new Ray(camPos, dir.normalize(), dist - 0.001);
    const pick = this.scene.pickWithRay(ray, (mesh) => {
      if (!mesh) return false;
      // Ignore star's own meshes
      if (mesh === this.starMesh || mesh === this.starDetailMesh || mesh === this.starCoronaMesh) return false;
      // Ignore label planes (they are UI-like and should not occlude glow)
      if (mesh.name && (mesh.name.startsWith("planetLabel_mesh") || mesh.name.includes("Label"))) return false;
      return true;
    });

    const occluded = !!(pick && pick.hit && pick.pickedPoint);
    this.starOccluded = occluded;

    if (this.debugLogOccluder && occluded && pick && pick.pickedMesh) {
      console.log(`🌑 Star occluded by mesh: ${pick.pickedMesh.name}`);
      if (this.deepDebug) {
        // Dump material info for the occluding mesh
        this.dumpMeshMaterialInfo(pick.pickedMesh);

        // Find a starbase mesh (if present) to compare materials
        const sb = this.scene.meshes.find((m) => m.name.toLowerCase().includes("starbase") && m.material);
        if (sb) {
          console.log("🔎 Example starbase mesh for comparison:", sb.name);
          this.dumpMeshMaterialInfo(sb);
        }

        // If the occluder is not a planet, also dump the nearest planet material
        if (!pick.pickedMesh.name.startsWith("systemPlanet")) {
          const planet = this.planetMeshes.length > 0 ? this.planetMeshes[0] : null;
          if (planet) {
            console.log(`🔎 Example planet mesh for comparison: ${planet.name}`);
            this.dumpMeshMaterialInfo(planet);
          }
        }
      }
    }

    const target = occluded ? this.glowBaseIntensity * 0.12 : this.glowBaseIntensity;
    const current = this.glowLayer.intensity;
    this.glowLayer.intensity = current + (target - current) * 0.18;
  }

  private dumpMeshMaterialInfo(mesh: AbstractMesh | null): void {
    if (!mesh) return;
    try {
      mesh.computeWorldMatrix(true);
      console.log(`  • Mesh: ${mesh.name}, renderingGroupId=${(mesh as Mesh).renderingGroupId}, isPickable=${mesh.isPickable}, alwaysSelectAsActiveMesh=${mesh.alwaysSelectAsActiveMesh}`);
      const material = (mesh as Mesh).material as any;
      if (!material) {
        console.log("    - No material attached");
        return;
      }

      // Handle MultiMaterial
      if (material.subMaterials) {
        console.log(`    - MultiMaterial with ${material.subMaterials.length} subMaterials`);
        material.subMaterials.forEach((m: any, idx: number) => {
          console.log(`    - subMaterial[${idx}]: ${m.name || "<anon>"}`);
          this.logMaterialFields(m);
        });
        return;
      }

      console.log(`    - Material: ${material.name || "<anon>"}, type=${material.getClassName ? material.getClassName() : typeof material}`);
      this.logMaterialFields(material);
    } catch (err) {
      console.warn("Failed to dump material info", err);
    }
  }

  private logMaterialFields(mat: any): void {
    if (!mat) return;
    const entries: string[] = [];
    try {
      entries.push(`alpha=${mat.alpha}`);
      if (typeof mat.transparencyMode !== "undefined") entries.push(`transparencyMode=${mat.transparencyMode}`);
      if (typeof mat.useAlphaFromDiffuseTexture !== "undefined") entries.push(`useAlphaFromDiffuseTexture=${mat.useAlphaFromDiffuseTexture}`);
      if (typeof mat.needDepthPrePass !== "undefined") entries.push(`needDepthPrePass=${mat.needDepthPrePass}`);
      if (typeof mat.backFaceCulling !== "undefined") entries.push(`backFaceCulling=${mat.backFaceCulling}`);
      if (typeof (mat as any).forceDepthWrite !== "undefined") entries.push(`forceDepthWrite=${(mat as any).forceDepthWrite}`);
      if (typeof mat.disableLighting !== "undefined") entries.push(`disableLighting=${mat.disableLighting}`);
      if (mat.emissiveColor) entries.push(`emissiveColor=${mat.emissiveColor.r?.toFixed(2)},${mat.emissiveColor.g?.toFixed(2)},${mat.emissiveColor.b?.toFixed(2)}`);
      if (mat.diffuseTexture) entries.push(`diffuseTexture=${mat.diffuseTexture.name || mat.diffuseTexture.url || '<texture>'}`);
      if (mat.opacityTexture) entries.push(`opacityTexture=${mat.opacityTexture?.name || mat.opacityTexture?.url || '<texture>'}`);
      if (mat.emissiveTexture) entries.push(`emissiveTexture=${mat.emissiveTexture?.name || mat.emissiveTexture?.url || '<texture>'}`);
    } catch (err) {
      entries.push(`(failed reading fields: ${err})`);
    }
    for (const e of entries) console.log(`      - ${e}`);
  }

  private configureVisualPreset(): void {
    const typeCfg = STAR_TYPES[this.star.type];
    this.starKind = typeCfg.kind;

    // Defaults
    this.glowBaseIntensity = 1.7;
    this.glowPulseAmplitude = 0.18;
    this.glowPulseSpeed = 1.3;

    this.coronaPulseAmplitude = 0.035;
    this.coronaPulseSpeed = 1.8;

    this.starRotationSpeed = 0.04;
    this.starDetailRotationSpeed = -0.09;
    this.starDetailTiltSpeed = 0.015;

    this.starBaseEmissiveScale = 1.75;
    this.starDetailEmissiveScale = 1.3;
    this.starDetailTextureLevel = 1.5;
    this.starDetailAlpha = 0.68;
    this.starCoronaScale = 1.22;
    this.starCoronaAlpha = 0.34;
    this.systemScaleMultiplier = 1.15;
    this.detailTexturePath = "/textures/star_surface.png";

    this.ambientIntensity = 0.2;
    this.bounceIntensity = 0.08;
    this.starLightIntensity = 3.2;
    this.starLightRange = 220;
    this.fillIntensity = 0.55;
    this.fillColor = new Color3(0.32, 0.38, 0.5);

    this.orbitBaseOffset = 14;
    this.orbitSpacing = 11;
    this.planetNightLift = new Color3(0.12, 0.12, 0.15);

    switch (this.star.type) {
      case StarType.B:
        this.starBaseEmissiveScale = 2.1;
        this.starDetailEmissiveScale = 1.6;
        this.starDetailTextureLevel = 1.9;
        this.starCoronaScale = 1.38;
        this.starCoronaAlpha = 0.46;

        this.starRotationSpeed = 0.07;
        this.starDetailRotationSpeed = -0.16;
        this.starDetailTiltSpeed = 0.02;

        this.glowBaseIntensity = 2.05;
        this.glowPulseAmplitude = 0.24;
        this.glowPulseSpeed = 1.9;

        this.starLightIntensity = 4.2;
        this.starLightRange = 260;
        this.fillIntensity = 0.7;
        this.fillColor = new Color3(0.36, 0.43, 0.62);
        break;

      case StarType.A:
        this.starBaseEmissiveScale = 1.95;
        this.starDetailEmissiveScale = 1.45;
        this.starDetailTextureLevel = 1.7;
        this.starCoronaScale = 1.32;
        this.starCoronaAlpha = 0.4;

        this.starRotationSpeed = 0.06;
        this.starDetailRotationSpeed = -0.13;
        this.starDetailTiltSpeed = 0.018;

        this.glowBaseIntensity = 1.9;
        this.glowPulseAmplitude = 0.18;
        this.glowPulseSpeed = 1.6;

        this.starLightIntensity = 3.8;
        this.starLightRange = 245;
        this.fillIntensity = 0.62;
        this.fillColor = new Color3(0.36, 0.41, 0.56);
        break;

      case StarType.F:
        this.starBaseEmissiveScale = 1.72;
        this.starDetailEmissiveScale = 1.28;
        this.starDetailTextureLevel = 1.45;
        this.starCoronaScale = 1.24;
        this.starCoronaAlpha = 0.34;

        this.starLightIntensity = 3.3;
        this.starLightRange = 225;
        this.fillIntensity = 0.58;
        this.fillColor = new Color3(0.4, 0.4, 0.45);
        break;

      case StarType.G:
        this.starBaseEmissiveScale = 1.62;
        this.starDetailEmissiveScale = 1.22;
        this.starDetailTextureLevel = 1.38;
        this.starCoronaScale = 1.2;
        this.starCoronaAlpha = 0.3;

        this.starLightIntensity = 3.0;
        this.starLightRange = 215;
        this.fillIntensity = 0.52;
        this.fillColor = new Color3(0.38, 0.35, 0.32);
        break;

      case StarType.K:
        this.starBaseEmissiveScale = 1.45;
        this.starDetailEmissiveScale = 1.1;
        this.starDetailTextureLevel = 1.25;
        this.starCoronaScale = 1.16;
        this.starCoronaAlpha = 0.28;

        this.starRotationSpeed = 0.03;
        this.starDetailRotationSpeed = -0.07;

        this.glowBaseIntensity = 1.45;
        this.glowPulseAmplitude = 0.12;

        this.starLightIntensity = 2.6;
        this.starLightRange = 200;
        this.fillIntensity = 0.48;
        this.fillColor = new Color3(0.4, 0.3, 0.26);
        break;

      case StarType.M:
        this.starBaseEmissiveScale = 1.2;
        this.starDetailEmissiveScale = 1.0;
        this.starDetailTextureLevel = 1.18;
        this.starDetailAlpha = 0.72;
        this.starCoronaScale = 1.15;
        this.starCoronaAlpha = 0.26;

        this.starRotationSpeed = 0.028;
        this.starDetailRotationSpeed = -0.05;

        this.glowBaseIntensity = 1.2;
        this.glowPulseAmplitude = 0.2;
        this.glowPulseSpeed = 1.15;

        this.starLightIntensity = 2.0;
        this.starLightRange = 175;
        this.fillIntensity = 0.44;
        this.fillColor = new Color3(0.34, 0.25, 0.23);
        break;

      case StarType.MRedGiant:
        this.starBaseEmissiveScale = 1.55;
        this.starDetailEmissiveScale = 1.12;
        this.starDetailTextureLevel = 1.35;
        this.starDetailAlpha = 0.62;
        this.starCoronaScale = 1.72;
        this.starCoronaAlpha = 0.52;
        this.systemScaleMultiplier = 1.75;

        this.starRotationSpeed = 0.018;
        this.starDetailRotationSpeed = -0.042;
        this.starDetailTiltSpeed = 0.01;

        this.glowBaseIntensity = 1.95;
        this.glowPulseAmplitude = 0.28;
        this.glowPulseSpeed = 0.75;

        this.ambientIntensity = 0.24;
        this.bounceIntensity = 0.11;
        this.starLightIntensity = 4.0;
        this.starLightRange = 350;
        this.fillIntensity = 0.75;
        this.fillColor = new Color3(0.5, 0.32, 0.22);

        this.orbitBaseOffset = 28;
        this.orbitSpacing = 16;
        this.planetNightLift = new Color3(0.14, 0.13, 0.14);
        break;

      case StarType.TBrownDwarf:
        this.starBaseEmissiveScale = 0.72;
        this.starDetailEmissiveScale = 0.62;
        this.starDetailTextureLevel = 1.0;
        this.starDetailAlpha = 0.78;
        this.starCoronaScale = 1.08;
        this.starCoronaAlpha = 0.12;
        this.systemScaleMultiplier = 1.0;
        this.detailTexturePath = "/textures/gas_giant.png";

        this.starRotationSpeed = 0.03;
        this.starDetailRotationSpeed = -0.05;

        this.glowBaseIntensity = 0.95;
        this.glowPulseAmplitude = 0.08;
        this.glowPulseSpeed = 0.9;

        this.ambientIntensity = 0.16;
        this.bounceIntensity = 0.07;
        this.starLightIntensity = 1.2;
        this.starLightRange = 130;
        this.fillIntensity = 0.42;
        this.fillColor = new Color3(0.3, 0.22, 0.2);

        this.orbitBaseOffset = 12;
        this.orbitSpacing = 10;
        this.planetNightLift = new Color3(0.16, 0.15, 0.16);
        break;

      case StarType.NeutronStar:
        this.starBaseEmissiveScale = 3.0;
        this.starDetailEmissiveScale = 2.3;
        this.starDetailTextureLevel = 2.2;
        this.starDetailAlpha = 0.45;
        this.starCoronaScale = 1.55;
        this.starCoronaAlpha = 0.28;
        this.systemScaleMultiplier = 0.48;

        this.starRotationSpeed = 0.34;
        this.starDetailRotationSpeed = -0.55;
        this.starDetailTiltSpeed = 0.03;

        this.glowBaseIntensity = 2.35;
        this.glowPulseAmplitude = 0.42;
        this.glowPulseSpeed = 3.2;

        this.ambientIntensity = 0.18;
        this.bounceIntensity = 0.07;
        this.starLightIntensity = 4.8;
        this.starLightRange = 190;
        this.fillIntensity = 0.62;
        this.fillColor = new Color3(0.35, 0.43, 0.62);

        this.orbitBaseOffset = 13;
        this.orbitSpacing = 10;
        this.planetNightLift = new Color3(0.14, 0.14, 0.16);
        break;

      case StarType.Pulsar:
        this.starBaseEmissiveScale = 3.3;
        this.starDetailEmissiveScale = 2.5;
        this.starDetailTextureLevel = 2.4;
        this.starDetailAlpha = 0.5;
        this.starCoronaScale = 1.65;
        this.starCoronaAlpha = 0.35;
        this.systemScaleMultiplier = 0.42;

        this.starRotationSpeed = 0.85;
        this.starDetailRotationSpeed = -1.4;
        this.starDetailTiltSpeed = 0.06;

        this.glowBaseIntensity = 2.6;
        this.glowPulseAmplitude = 0.95;
        this.glowPulseSpeed = 7.5;

        this.ambientIntensity = 0.17;
        this.bounceIntensity = 0.07;
        this.starLightIntensity = 3.0;
        this.starLightRange = 220;
        this.fillIntensity = 0.35;
        this.fillColor = new Color3(0.3, 0.4, 0.58);

        this.orbitBaseOffset = 14;
        this.orbitSpacing = 11;
        this.planetNightLift = new Color3(0.14, 0.14, 0.17);
        break;

      case StarType.BlackHole:
        this.starBaseEmissiveScale = 0;
        this.starDetailEmissiveScale = 0;
        this.starDetailTextureLevel = 0;
        this.starDetailAlpha = 0;
        this.starCoronaScale = 1.0;
        this.starCoronaAlpha = 0;
        this.systemScaleMultiplier = 0.9;

        this.starRotationSpeed = 0;
        this.starDetailRotationSpeed = 0;
        this.starDetailTiltSpeed = 0;

        this.glowBaseIntensity = 1.25;
        this.glowPulseAmplitude = 0.16;
        this.glowPulseSpeed = 1.1;

        this.ambientIntensity = 0.14;
        this.bounceIntensity = 0.05;
        this.starLightIntensity = 1.25;
        this.starLightRange = 280;
        this.fillIntensity = 0.55;
        this.fillColor = new Color3(0.42, 0.34, 0.28);

        this.orbitBaseOffset = 20;
        this.orbitSpacing = 14;
        this.planetNightLift = new Color3(0.18, 0.18, 0.2);
        break;
    }
  }

  private setupBackground(): void {
    const bgSphere = MeshBuilder.CreateSphere(
      "systemBackground",
      { diameter: 4000, segments: 20 },
      this.scene,
    );
    const bgMat = new StandardMaterial("systemBackgroundMat", this.scene);
    bgMat.emissiveTexture = new Texture("/textures/galaxy_bg.png", this.scene);
    bgMat.disableLighting = true;
    bgMat.backFaceCulling = false;
    bgSphere.material = bgMat;
    bgSphere.isPickable = false;
    bgSphere.infiniteDistance = true;
  }

  private setupCamera(canvas: HTMLCanvasElement): void {
    this.camera = new ArcRotateCamera(
      "systemCamera",
      -Math.PI / 2,
      Math.PI / 2.6,
      65,
      Vector3.Zero(),
      this.scene,
    );

    this.camera.attachControl(canvas, true);
    this.camera.lowerRadiusLimit = 12;
    this.camera.upperRadiusLimit = 260;
    this.camera.lowerBetaLimit = 0.12;
    this.camera.upperBetaLimit = Math.PI / 2.05;
    this.camera.wheelDeltaPercentage = 0.06;
    this.camera.inertia = 0.84;

    this.camera.panningSensibility = 0;
    this.camera.keysUp = [];
    this.camera.keysDown = [];
    this.camera.keysLeft = [];
    this.camera.keysRight = [];
  }

  private setupLighting(): void {
    const hemi = new HemisphericLight("systemAmbient", new Vector3(0, 1, 0), this.scene);
    hemi.intensity = this.ambientIntensity;
    hemi.diffuse = new Color3(0.45, 0.48, 0.55);
    hemi.specular = new Color3(0.25, 0.25, 0.3);

    const bounce = new HemisphericLight("systemBounce", new Vector3(0, -1, 0), this.scene);
    bounce.intensity = this.bounceIntensity * 1.3;
    bounce.diffuse = new Color3(0.2, 0.22, 0.26);
    bounce.specular = new Color3(0.05, 0.05, 0.08);

    const starLightColor =
      this.starKind === "black-hole"
        ? new Color3(1.0, 0.82, 0.56)
        : new Color3(this.star.color[0], this.star.color[1], this.star.color[2]);

    this.starLight = new PointLight("systemStarLight", Vector3.Zero(), this.scene);
    this.starLight.intensity = this.starLightIntensity;
    this.starLight.range = this.starLightRange;
    this.starLight.diffuse = starLightColor;
    this.starLight.specular = new Color3(0.8, 0.8, 0.85);

    this.fillLight = new PointLight("systemFillLight", new Vector3(0, -28, 0), this.scene);
    this.fillLight.intensity = this.fillIntensity;
    this.fillLight.range = 320;
    this.fillLight.diffuse = this.fillColor;

    this.glowLayer = new GlowLayer("systemGlow", this.scene, {
      mainTextureFixedSize: 1024,
      blurKernelSize: 48,
    });
    this.glowLayer.intensity = this.glowBaseIntensity;
    this.scene.ambientColor = new Color3(0.18, 0.2, 0.24);

    // Debug: allow toggling glow with 'g' key to quickly test occlusion behavior
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (ev.key.toLowerCase() === "g") {
          this.glowLayer!.isEnabled = !this.glowLayer!.isEnabled;
          console.log(`🔆 Glow layer toggled: ${this.glowLayer!.isEnabled}`);
        }
        if (ev.key.toLowerCase() === "d") {
          this.deepDebug = !this.deepDebug;
          console.log(`🐞 Deep debug toggled: ${this.deepDebug}`);
        }
      });
    }
  }

  private buildSystemObjects(): void {
    const typeCfg = STAR_TYPES[this.star.type];
    const starTint = new Color3(this.star.color[0], this.star.color[1], this.star.color[2]);
    const starDiameter = Math.max(1.2, typeCfg.systemDiameter * this.systemScaleMultiplier);
    this.starDiameter = starDiameter;

    this.starMesh = MeshBuilder.CreateSphere(
      "systemStar",
      { diameter: starDiameter, segments: 40 },
      this.scene,
    );

    const starBaseMat = new StandardMaterial("systemStarBaseMat", this.scene);
    starBaseMat.emissiveColor =
      this.starKind === "black-hole"
        ? Color3.Black()
        : starTint.scale(this.starBaseEmissiveScale);
    starBaseMat.diffuseColor = Color3.Black();
    starBaseMat.specularColor = Color3.Black();
    starBaseMat.disableLighting = true;
    this.starMesh.material = starBaseMat;
    this.starMesh.isPickable = false;

    this.starDetailMesh = MeshBuilder.CreateSphere(
      "systemStarDetail",
      { diameter: starDiameter * 1.008, segments: 40 },
      this.scene,
    );
    this.starDetailMesh.parent = this.starMesh;

    const detailMat = new StandardMaterial("systemStarDetailMat", this.scene);
    if (this.starDetailTextureLevel > 0.01) {
      detailMat.emissiveTexture = new Texture(this.detailTexturePath, this.scene);
      detailMat.emissiveTexture.level = this.starDetailTextureLevel;
    }
    detailMat.emissiveColor =
      this.starKind === "black-hole"
        ? new Color3(0.05, 0.05, 0.06)
        : starTint.scale(this.starDetailEmissiveScale);
    detailMat.diffuseColor = Color3.Black();
    detailMat.specularColor = Color3.Black();
    detailMat.disableLighting = true;
    detailMat.alpha = this.starDetailAlpha;
    detailMat.backFaceCulling = false;
    this.starDetailMesh.material = detailMat;
    this.starDetailMesh.isPickable = false;

    this.starCoronaMesh = MeshBuilder.CreateSphere(
      "systemStarCorona",
      { diameter: starDiameter * this.starCoronaScale, segments: 28 },
      this.scene,
    );
    this.starCoronaMesh.parent = this.starMesh;

    const coronaMat = new StandardMaterial("systemStarCoronaMat", this.scene);
    coronaMat.emissiveColor =
      this.starKind === "black-hole"
        ? new Color3(0.05, 0.05, 0.07)
        : starTint.scale(1.2);
    coronaMat.diffuseColor = Color3.Black();
    coronaMat.specularColor = Color3.Black();
    coronaMat.disableLighting = true;
    coronaMat.backFaceCulling = false;
    coronaMat.alpha = this.starCoronaAlpha;
    this.starCoronaMesh.material = coronaMat;
    this.starCoronaMesh.isPickable = false;

    if (this.starKind !== "black-hole") {
      // Avoid adding the base star mesh to the glow layer — the glow render
      // pass can cause emissive effect to appear over occluders. Only include
      // detail/corona meshes which will be depth-checked.
      // this.glowLayer.addIncludedOnlyMesh(this.starMesh);
      if (this.starDetailMesh) {
        // Ensure the detail material participates in depth tests to avoid
        // drawing over nearer occluders like planets.
        const detMat = this.starDetailMesh.material as StandardMaterial | null;
        if (detMat) {
          detMat.needDepthPrePass = true as any;
          // Force write to depth buffer so occluders hide the detail when needed
          (detMat as any).forceDepthWrite = true;
        }
        this.glowLayer.addIncludedOnlyMesh(this.starDetailMesh);
      }
      if (this.starCoronaMesh && this.starCoronaAlpha > 0.01) {
        const coronaMat = this.starCoronaMesh.material as StandardMaterial | null;
        if (coronaMat) {
          coronaMat.needDepthPrePass = true as any;
          (coronaMat as any).forceDepthWrite = true;
        }
        this.glowLayer.addIncludedOnlyMesh(this.starCoronaMesh);
      }
    }

    if (this.starKind === "red-giant") {
      this.createRedGiantAtmosphere(starDiameter, starTint);
    }
    if (this.starKind === "pulsar") {
      this.createPulsarBeams(starDiameter, starTint);
    }
    if (this.starKind === "black-hole") {
      this.createBlackHoleFeatures(starDiameter);
    }

    const planets =
      this.star.system.planets.length > 0
        ? this.star.system.planets
        : this.createFallbackPlanets(this.starKind);

    this.planetConfigs = planets;
    for (let i = 0; i < planets.length; i++) {
      this.createPlanet(i, planets[i]);
    }
    this.createHyperlaneExits();

    // Create star label
    this.starLabelMesh = this.createStarLabel();
  }

  private formatFleetNavigationDetail(fleet: ServerFleet): string {
    if (!fleet.movementPlan) {
      if (fleet.phase === "orbitingPlanet" && fleet.orbitTargetPlanetId) {
        return `Orbiting ${this.getPlanetName(fleet.orbitTargetPlanetId)}.`;
      }
      if (fleet.phase === "orbiting" && fleet.orbitTarget) {
        return `Holding orbit at ${this.formatOrbitTargetName(fleet.orbitTarget)}.`;
      }
      return "Fleet selected. Choose a command or click empty space while Move is active.";
    }
    const destination = fleet.movementPlan.destinationPlanetId
      ? this.getPlanetName(fleet.movementPlan.destinationPlanetId)
      : (fleet.movementPlan.destinationOrbitTarget
        ? this.formatOrbitTargetName(fleet.movementPlan.destinationOrbitTarget)
        : `Star ${fleet.movementPlan.destinationStarId}`);
    const remainingDays = Math.max(0, (fleet.movementPlan.endsAtYear - this.clockYear) * GAME_DAYS_PER_YEAR);
    const remainingMinutes = remainingDays * REAL_MS_PER_GAME_DAY / 60_000;
    return `Destination: ${destination}. Time remaining: ${remainingDays.toFixed(1)} days (${remainingMinutes.toFixed(1)} minutes).`;
  }

  private getPlanetName(planetId: string): string {
    return this.star.system.planets.find((planet) => planet.id === planetId)?.name ?? planetId;
  }

  private formatOrbitTargetName(target: FleetOrbitTarget): string {
    if (target.kind === "star") return this.star.id === target.starId ? this.star.name : `Star ${target.starId}`;
    if (target.kind === "starbase") return "Starbase";
    if (target.kind === "hyperlane") return "Hyperlane point";
    if (target.kind === "planet" && target.planetId) return this.getPlanetName(target.planetId);
    if (target.kind === "fleet") return "merge rendezvous";
    return "system point";
  }

  private async createPlayerShipIfPresent(): Promise<void> {
    console.log(`🔍 Checking player ship: star.id=${this.star.id}, using starCount=${this.starCount}`);
    if (!this.hasPlayerShipPresence() || this.playerShipRoot) return;
    console.log(`✅ This is the player ship system!`);

    console.log(`🚀 Loading player ship for star ID ${this.star.id}`);

    this.playerShipBasePosition = PLAYER_SHIP_BASE_POSITION.clone();
    this.playerShipTargetPosition = PLAYER_SHIP_BASE_POSITION.clone();
    const primaryFleet = this.serverFleets.find((fleet) => (
      fleet.currentStarId === this.star.id && fleet.ownerId === this.playerFactionId
    ));
    const serverPosition = primaryFleet ? this.getFleetRenderPosition(primaryFleet) : null;
    if (serverPosition) {
      this.playerShipBasePosition.set(serverPosition.x, serverPosition.y, serverPosition.z);
      this.playerShipTargetPosition.copyFrom(this.playerShipBasePosition);
    }
    this.playerShipRoot = new TransformNode("playerShipRoot", this.scene);
    this.playerShipRoot.position = this.playerShipBasePosition.clone();
    this.playerShipRoot.rotation.set(0.18, -0.7, -0.08);
    console.log(`📍 Player ship root position: ${JSON.stringify(this.playerShipBasePosition)}`);

    try {
      console.log(`📦 Importing ${PLAYER_SHIP_MODEL_FILE} from ${PLAYER_SHIP_MODEL_ROOT}`);
      const result = await SceneLoader.ImportMeshAsync(
        "",
        PLAYER_SHIP_MODEL_ROOT,
        PLAYER_SHIP_MODEL_FILE,
        this.scene,
      );

      console.log(`✓ Loaded ${result.meshes.length} total meshes from OBJ`);
      const meshes = result.meshes.filter((mesh) => (
        typeof mesh.getTotalVertices === "function" && mesh.getTotalVertices() > 0
      ));
      console.log(`✓ Filtered to ${meshes.length} renderable meshes`);
      if (meshes.length === 0) {
        throw new Error("Fighter_01.obj did not produce renderable meshes.");
      }

      const bounds = this.computeMeshBounds(meshes);
      const maxDimension = Math.max(
        0.001,
        bounds.max.x - bounds.min.x,
        bounds.max.y - bounds.min.y,
        bounds.max.z - bounds.min.z,
      );
      console.log(`📐 Bounds: min=${JSON.stringify(bounds.min)}, max=${JSON.stringify(bounds.max)}, maxDim=${maxDimension}`);
      const shipScale = PLAYER_SHIP_TARGET_SIZE / maxDimension;
      console.log(`📏 Scaling to ${PLAYER_SHIP_TARGET_SIZE} world units: scale=${shipScale}`);

      const assetRoot = new TransformNode("playerShipAssetRoot", this.scene);
      assetRoot.parent = this.playerShipRoot;
      assetRoot.position = bounds.center.scale(-1);

      for (const mesh of meshes) {
        mesh.parent = assetRoot;
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        console.log(`  - Mesh "${mesh.name}": vertices=${mesh.getTotalVertices()}`);
        this.applyPlayerShipMaterialStyle(mesh.material);
      }

      this.playerShipRoot.scaling.setAll(shipScale);
      this.createPlayerShipReadabilityLight();
      console.log(`✅ Player ship loaded successfully! Root position: ${JSON.stringify(this.playerShipRoot.position)}, rotation: ${JSON.stringify(this.playerShipRoot.rotation)}`);
    } catch (err) {
      console.warn("❌ Failed to load player ship model", err);
      this.createFallbackPlayerShip();
    }
  }

  private computeMeshBounds(meshes: AbstractMesh[]): {
    min: Vector3;
    max: Vector3;
    center: Vector3;
  } {
    const min = new Vector3(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    );
    const max = new Vector3(
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    );

    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      const corners = mesh.getBoundingInfo().boundingBox.vectorsWorld;
      for (const corner of corners) {
        min.minimizeInPlace(corner);
        max.maximizeInPlace(corner);
      }
    }

    if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) {
      return {
        min: new Vector3(-1, -1, -1),
        max: new Vector3(1, 1, 1),
        center: Vector3.Zero(),
      };
    }

    return {
      min,
      max,
      center: min.add(max).scale(0.5),
    };
  }

  private applyPlayerShipMaterialStyle(material: Material | null): void {
    if (!material) return;

    if (material instanceof MultiMaterial) {
      for (const subMaterial of material.subMaterials) {
        this.applyPlayerShipMaterialStyle(subMaterial);
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
      material.diffuseTexture = this.createPlayerShipTexture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Body_BaseColor.png`,
      );
      material.bumpTexture = new Texture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Body_Normal.png`,
        this.scene,
      );
      material.diffuseColor = new Color3(1.02, 1.04, 1.06);
      material.emissiveColor = new Color3(0.026, 0.028, 0.033);
      material.specularPower = 110;
      return;
    }

    if (name.includes("front")) {
      material.diffuseTexture = this.createPlayerShipTexture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Front_BaseColor.png`,
      );
      material.bumpTexture = new Texture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Front_Normal.png`,
        this.scene,
      );
      material.emissiveTexture = new Texture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Front_Emissive.png`,
        this.scene,
      );
      material.diffuseColor = new Color3(0.96, 1.0, 1.04);
      material.emissiveColor = new Color3(0.018, 0.032, 0.052);
      material.specularPower = 160;
      return;
    }

    if (name.includes("rear")) {
      material.diffuseTexture = this.createPlayerShipTexture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Rear_BaseColor.png`,
      );
      material.bumpTexture = new Texture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Rear_Normal.png`,
        this.scene,
      );
      material.emissiveTexture = new Texture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Rear_Emissive.png`,
        this.scene,
      );
      material.diffuseColor = new Color3(0.96, 0.98, 1.0);
      material.emissiveColor = new Color3(0.055, 0.02, 0.012);
      material.specularPower = 150;
      return;
    }

    if (name.includes("windows")) {
      material.diffuseTexture = this.createPlayerShipTexture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Windows_BaseColor.png`,
      );
      material.bumpTexture = new Texture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Windows_Normal.png`,
        this.scene,
      );
      material.diffuseColor = new Color3(0.95, 1.0, 1.05);
      material.emissiveColor = new Color3(0.035, 0.08, 0.095);
      material.specularPower = 180;
    }
  }

  private createPlayerShipTexture(url: string, level = 1.35): Texture {
    const texture = new Texture(url, this.scene);
    texture.level = level;
    return texture;
  }

  private createPlayerShipReadabilityLight(): void {
    if (!this.playerShipRoot || this.playerShipLight) return;

    this.playerShipLight = new PointLight(
      "playerShipSoftFill",
      new Vector3(0, 7, -9),
      this.scene,
    );
    this.playerShipLight.parent = this.playerShipRoot;
    this.playerShipLight.intensity = 0.9;
    this.playerShipLight.range = 34;
    this.playerShipLight.diffuse = new Color3(0.64, 0.7, 0.78);
    this.playerShipLight.specular = new Color3(0.72, 0.78, 0.86);
  }

  private createPlayerShipAccents(
    parent: TransformNode,
    bounds: { min: Vector3; max: Vector3; center: Vector3 },
  ): void {
    if (!this.playerShipRoot) return;

    const size = bounds.max.subtract(bounds.min);
    const glowDiameter = Math.max(0.18, Math.max(size.x, size.z) * 0.045);
    const zOffset = Math.max(0.45, size.z * 0.22);
    const engineX = bounds.min.x - size.x * 0.035;

    const thrusterMat = new StandardMaterial("playerShipThrusterMat", this.scene);
    thrusterMat.diffuseColor = Color3.Black();
    thrusterMat.specularColor = Color3.Black();
    thrusterMat.emissiveColor = new Color3(0.32, 0.72, 1.0).scale(2.2);
    thrusterMat.disableLighting = true;
    thrusterMat.alpha = 0.78;
    this.playerShipThrusterMaterial = thrusterMat;

    for (const z of [-zOffset, zOffset]) {
      const glow = MeshBuilder.CreateSphere(
        "playerShipThrusterGlow",
        { diameter: glowDiameter, segments: 16 },
        this.scene,
      );
      glow.parent = parent;
      glow.position.set(engineX, bounds.center.y, bounds.center.z + z);
      glow.material = thrusterMat;
      glow.isPickable = false;
      this.glowLayer.addIncludedOnlyMesh(glow);
    }

    this.playerShipLight = new PointLight(
      "playerShipInspectionLight",
      new Vector3(0, 6, -8),
      this.scene,
    );
    this.playerShipLight.parent = this.playerShipRoot;
    this.playerShipLight.intensity = 1.45;
    this.playerShipLight.range = 46;
    this.playerShipLight.diffuse = new Color3(0.54, 0.7, 1.0);
    this.playerShipLight.specular = new Color3(0.85, 0.9, 1.0);
  }

  private createFallbackPlayerShip(): void {
    if (!this.playerShipRoot) return;

    const body = MeshBuilder.CreateBox(
      "playerShipFallbackBody",
      { width: 6.8, height: 1.1, depth: 2.4 },
      this.scene,
    );
    body.parent = this.playerShipRoot;
    body.isPickable = false;

    const bodyMat = new StandardMaterial("playerShipFallbackBodyMat", this.scene);
    bodyMat.diffuseColor = new Color3(0.28, 0.33, 0.42);
    bodyMat.emissiveColor = new Color3(0.04, 0.06, 0.1);
    bodyMat.specularColor = new Color3(0.65, 0.7, 0.78);
    body.material = bodyMat;
  }

  private hashString(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  private getBattleZonePosition(zone: BattleZone, seed: string): Vector3 {
    const base = BATTLE_ZONE_POSITIONS[zone];
    const hash = this.hashString(seed);
    const spread = BATTLE_ZONE_SPREAD;
    const offsetX = ((hash & 0xff) / 255 - 0.5) * spread;
    const offsetY = (((hash >> 8) & 0xff) / 255 - 0.5) * 0.8;
    const offsetZ = (((hash >> 16) & 0xff) / 255 - 0.5) * spread;
    return new Vector3(base.x + offsetX, base.y + offsetY, base.z + offsetZ);
  }

  private getBattleShipFormationPosition(group: CombatGroup, shipId: string): Vector3 {
    return this.getGroupShipFormationPosition(group.id, group.position, group.shipIds, shipId);
  }

  private getAlertGroupShipFormationPosition(group: TacticalBattleGroupView, shipId: string): Vector3 {
    return this.getGroupShipFormationPosition(group.id, group.position, group.shipIds, shipId);
  }

  private getGroupShipFormationPosition(_groupId: string, position: SystemPosition, shipIds: string[], shipId: string): Vector3 {
    const formed = getLayeredFleetFormationPosition(
      position,
      SYSTEM_FLEET_Y + BATTLE_GROUP_SHIP_Y_OFFSET,
      shipIds,
      shipId,
    );
    return new Vector3(formed.x, formed.y, formed.z);
  }

  private async ensureBattleShipTemplate(): Promise<void> {
    if (this.battleShipTemplate) return;
    if (this.battleShipTemplatePromise) return this.battleShipTemplatePromise;
    this.battleShipTemplatePromise = (async () => {
      try {
        const result = await SceneLoader.ImportMeshAsync(
          "",
          PLAYER_SHIP_MODEL_ROOT,
          PLAYER_SHIP_MODEL_FILE,
          this.scene,
        );
        const meshes = result.meshes.filter((mesh) => (
          typeof mesh.getTotalVertices === "function" && mesh.getTotalVertices() > 0
        ));
        if (meshes.length === 0) {
          throw new Error("Fighter_01.obj did not produce renderable meshes.");
        }

        const bounds = this.computeMeshBounds(meshes);
        const maxDimension = Math.max(
          0.001,
          bounds.max.x - bounds.min.x,
          bounds.max.y - bounds.min.y,
          bounds.max.z - bounds.min.z,
        );
        const shipScale = BATTLE_SHIP_TARGET_SIZE / maxDimension;

        const templateRoot = new TransformNode("battleShipTemplateRoot", this.scene);
        const assetRoot = new TransformNode("battleShipTemplateAsset", this.scene);
        assetRoot.parent = templateRoot;
        assetRoot.position = bounds.center.scale(-1);

        for (const mesh of meshes) {
          mesh.parent = assetRoot;
          mesh.isPickable = false;
          mesh.alwaysSelectAsActiveMesh = true;
          this.applyPlayerShipMaterialStyle(mesh.material);
        }

        templateRoot.scaling.setAll(shipScale);
        templateRoot.setEnabled(false);
        this.battleShipTemplate = templateRoot;
      } catch (err) {
        console.warn("Failed to load battle ship model", err);
      } finally {
        this.battleShipTemplatePromise = null;
      }
    })();
    return this.battleShipTemplatePromise;
  }

  private createBattleShipInstance(shipId: string): TransformNode | null {
    if (!this.battleShipTemplate) return null;
    const clone = this.battleShipTemplate.clone(`battleShip-${shipId}`, null);
    if (!clone) return null;
    clone.setEnabled(this.starsVisible);
    for (const mesh of clone.getChildMeshes()) {
      mesh.isPickable = true;
    }
    this.battleShipRoots.set(shipId, clone);
    this.battleShipTargets.set(shipId, clone.position.clone());
    return clone;
  }

  private setShipVisualMetadata(
    root: TransformNode,
    metadata: { shipId: string; fleetId?: string | null; battleGroupId?: string | null },
  ): void {
    root.metadata = metadata;
    for (const mesh of root.getChildMeshes()) {
      mesh.metadata = metadata;
      mesh.isPickable = true;
    }
  }

  private getVisibleBattleGroupViews(): TacticalBattleGroupView[] {
    return [];
  }

  private createBattleGroupViewFromCombatGroup(group: CombatGroup): TacticalBattleGroupView {
    const fleet = group.sourceFleetId ? this.serverFleets.find((candidate) => candidate.id === group.sourceFleetId) : null;
    const config = fleet?.battleGroups.find((candidate) => candidate.id === group.id);
    return {
      id: group.id,
      fleetId: group.sourceFleetId ?? null,
      ownerId: group.ownerId,
      name: config?.name ?? this.formatCombatGroupName(group),
      shipIds: [...group.shipIds],
      behavior: group.behavior,
      count: group.count,
      position: group.position,
      originPosition: group.originPosition,
      leashRadius: group.leashRadius,
      status: group.status,
      hpRatio: group.hpRatio,
      order: group.currentOrder?.type ?? "behavior",
      targetGroupId: group.targetGroupId ?? null,
      destination: group.destination ?? group.currentOrder?.targetPosition ?? null,
      maxWeaponRange: group.maxWeaponRange,
      chaseSetting: group.chaseSetting,
      retreatText: group.retreatPolicy ? this.formatRetreatPolicy(group.retreatPolicy) : "No retreat",
    };
  }

  private getFleetGroupDefense(shipIds: string[]): { total: number; maxTotal: number } {
    const shipSet = new Set(shipIds);
    return this.serverShips
      .filter((ship) => shipSet.has(ship.id))
      .reduce(
        (total, ship) => ({
          total: total.total + ship.shield + ship.armor + ship.hull,
          maxTotal: total.maxTotal + ship.maxShield + ship.maxArmor + ship.maxHull,
        }),
        { total: 0, maxTotal: 0 },
      );
  }

  private getFleetGroupMaxWeaponRange(shipIds: string[]): number {
    const shipSet = new Set(shipIds);
    const designsById = new Map(this.shipDesigns.map((design) => [design.id, design]));
    return this.serverShips
      .filter((ship) => shipSet.has(ship.id))
      .reduce((maxRange, ship) => {
        const design = ship.designId ? designsById.get(ship.designId) : null;
        const mounts = design ? calculateShipDesignStats(design).combat.weaponMounts : [];
        const shipMaxRange = mounts.reduce((max, mount) => {
          const rangeBand = mount.maxRangeBand ?? "close";
          const range = BATTLE_RANGE_DISTANCE_BY_BAND[rangeBand] ?? BATTLE_RANGE_DISTANCE_BY_BAND.close;
          return Math.max(max, Number.isFinite(range) ? range : 0);
        }, 0);
        return Math.max(maxRange, shipMaxRange);
      }, 0);
  }

  private formatRetreatPolicy(policy: { mode: string; thresholdPercent?: number | null }): string {
    if (policy.mode !== "hpPercent") return "No retreat";
    return `Retreat ${Math.round(policy.thresholdPercent ?? 0)}%`;
  }

  private formatCombatGroupName(group: CombatGroup): string {
    const label = group.behavior === "station" ? "Station" : group.behavior.charAt(0).toUpperCase() + group.behavior.slice(1);
    return `${label} Group`;
  }

  private refreshBattleGroupMarkers(views = this.getVisibleBattleGroupViews()): void {
    const viewById = new Map(views.map((view) => [view.id, view]));
    for (const [groupId, root] of Array.from(this.battleGroupRoots.entries())) {
      if (!viewById.has(groupId)) {
        root.dispose();
        this.battleGroupRoots.delete(groupId);
        this.battleGroupTargets.delete(groupId);
        this.disposeBattleGroupMaterials(groupId);
      }
    }
    for (const view of views) {
      const existingRoot = this.battleGroupRoots.get(view.id);
      const root = existingRoot ?? this.createBattleGroupMarker(view);
      const target = new Vector3(view.position.x, SYSTEM_FLEET_Y + BATTLE_GROUP_MARKER_Y_OFFSET, view.position.z);
      if (!existingRoot) {
        root.position.copyFrom(target);
      }
      this.battleGroupTargets.set(view.id, target);
      root.setEnabled(this.starsVisible);
      this.updateBattleGroupMarkerVisuals(root, view);
    }
    this.refreshStarbaseCombatRangeRing();
  }

  private createBattleGroupMarker(view: TacticalBattleGroupView): TransformNode {
    const root = new TransformNode(`battleGroup-${view.id}`, this.scene);
    root.metadata = { battleGroupId: view.id, view };
    const owner = this.getFaction(view.ownerId);
    const color = owner?.color
      ? new Color3(owner.color[0], owner.color[1], owner.color[2])
      : new Color3(0.42, 0.88, 1);
    const material = new StandardMaterial(`battleGroupMat-${view.id}`, this.scene);
    material.diffuseColor = color.scale(0.22);
    material.emissiveColor = color.scale(0.34);
    material.specularColor = Color3.Black();
    material.alpha = 0.38;
    material.disableLighting = true;
    this.battleGroupMaterials.set(view.id, material);

    const rangeMaterial = new StandardMaterial(`battleGroupRangeMat-${view.id}`, this.scene);
    rangeMaterial.diffuseColor = color.scale(0.18);
    rangeMaterial.emissiveColor = color.scale(0.65);
    rangeMaterial.specularColor = Color3.Black();
    rangeMaterial.alpha = 0.16;
    rangeMaterial.disableLighting = true;
    this.battleGroupMaterials.set(`${view.id}:range`, rangeMaterial);

    const leashMaterial = new StandardMaterial(`battleGroupLeashMat-${view.id}`, this.scene);
    leashMaterial.diffuseColor = color.scale(0.12);
    leashMaterial.emissiveColor = color.scale(0.38);
    leashMaterial.specularColor = Color3.Black();
    leashMaterial.alpha = 0.12;
    leashMaterial.disableLighting = true;
    this.battleGroupMaterials.set(`${view.id}:leash`, leashMaterial);

    const core = MeshBuilder.CreateSphere(`battleGroupCore-${view.id}`, { diameter: 0.46, segments: 12 }, this.scene);
    core.parent = root;
    core.position.y = -0.18;
    core.material = material;
    core.isPickable = true;
    core.metadata = { battleGroupId: view.id };

    const ring = MeshBuilder.CreateTorus(`battleGroupCommandRing-${view.id}`, {
      diameter: Math.max(3.2, Math.min(8, 2.8 + view.count * 0.12)),
      thickness: 0.06,
      tessellation: 48,
    }, this.scene);
    ring.parent = root;
    ring.position.y = -0.18;
    ring.material = material;
    ring.isPickable = true;
    ring.metadata = { battleGroupId: view.id };
    ring.setEnabled(false);

    const rangeRing = MeshBuilder.CreateTorus(`battleGroupRangeRing-${view.id}`, {
      diameter: BATTLE_GROUP_RING_BASE_DIAMETER,
      thickness: 0.035,
      tessellation: 96,
    }, this.scene);
    rangeRing.parent = root;
    rangeRing.material = rangeMaterial;
    rangeRing.isPickable = false;
    rangeRing.setEnabled(false);

    const leashRing = MeshBuilder.CreateTorus(`battleGroupLeashRing-${view.id}`, {
      diameter: BATTLE_GROUP_RING_BASE_DIAMETER,
      thickness: 0.028,
      tessellation: 96,
    }, this.scene);
    leashRing.parent = root;
    leashRing.material = leashMaterial;
    leashRing.isPickable = false;
    leashRing.setEnabled(false);

    const origin = MeshBuilder.CreateSphere(`battleGroupOrigin-${view.id}`, { diameter: 0.42, segments: 10 }, this.scene);
    origin.parent = root;
    origin.material = leashMaterial;
    origin.isPickable = false;
    origin.setEnabled(false);

    this.battleGroupRoots.set(view.id, root);
    this.updateBattleGroupMarkerVisuals(root, view);
    return root;
  }

  private updateBattleGroupMarkerVisuals(root: TransformNode, view: TacticalBattleGroupView): void {
    const metadata = (root.metadata as { battleGroupId?: string; view?: TacticalBattleGroupView } | null) ?? {};
    root.metadata = { ...metadata, battleGroupId: view.id, view };

    const selected = view.id === this.selectedBattleGroupId;
    const core = root.getChildMeshes().find((mesh) => mesh.name.startsWith("battleGroupCore-"));
    const commandRing = root.getChildMeshes().find((mesh) => mesh.name.startsWith("battleGroupCommandRing-"));
    const rangeRing = root.getChildMeshes().find((mesh) => mesh.name.startsWith("battleGroupRangeRing-"));
    const leashRing = root.getChildMeshes().find((mesh) => mesh.name.startsWith("battleGroupLeashRing-"));
    const origin = root.getChildMeshes().find((mesh) => mesh.name.startsWith("battleGroupOrigin-"));
    const emphasis = selected ? 1.22 : 1;
    core?.scaling.setAll(emphasis);
    commandRing?.scaling.setAll(emphasis);
    commandRing?.setEnabled(selected && this.starsVisible);
    const weaponRadius = Math.max(0, view.maxWeaponRange);
    if (rangeRing) {
      rangeRing.setEnabled(selected && weaponRadius > 0 && this.starsVisible);
      rangeRing.scaling.set(weaponRadius, 1, weaponRadius);
    }
    const leashRadius = Math.max(0, view.leashRadius);
    if (leashRing) {
      leashRing.setEnabled(selected && leashRadius > 0 && this.starsVisible);
      leashRing.scaling.set(leashRadius, 1, leashRadius);
    }
    if (origin) {
      origin.setEnabled(selected && leashRadius > 0 && this.starsVisible);
    }
    this.updateBattleGroupMarkerOriginOffset(root);
  }

  private updateBattleGroupMarkerOriginOffset(root: TransformNode): void {
    const view = (root.metadata as { view?: TacticalBattleGroupView } | null)?.view;
    if (!view) return;
    const origin = root.getChildMeshes().find((mesh) => mesh.name.startsWith("battleGroupOrigin-"));
    const leashRing = root.getChildMeshes().find((mesh) => mesh.name.startsWith("battleGroupLeashRing-"));
    const localOrigin = new Vector3(
      view.originPosition.x - root.position.x,
      -0.04,
      view.originPosition.z - root.position.z,
    );
    origin?.position.copyFrom(localOrigin);
    leashRing?.position.copyFrom(localOrigin);
  }

  private disposeBattleGroupMaterials(groupId: string): void {
    for (const [key, material] of Array.from(this.battleGroupMaterials.entries())) {
      if (key === groupId || key.startsWith(`${groupId}:`)) {
        material.dispose();
        this.battleGroupMaterials.delete(key);
      }
    }
  }

  private refreshFleetMarkers(views = this.getVisibleFleetViews()): void {
    const viewById = new Map(views.map((view) => [view.id, view]));
    for (const [fleetId, root] of Array.from(this.fleetRoots.entries())) {
      if (!viewById.has(fleetId)) {
        root.dispose();
        this.fleetRoots.delete(fleetId);
        this.fleetTargets.delete(fleetId);
        const material = this.fleetMaterials.get(fleetId);
        material?.dispose();
        this.fleetMaterials.delete(fleetId);
      }
    }
    for (const view of views) {
      const existingRoot = this.fleetRoots.get(view.id);
      const root = existingRoot ?? this.createFleetMarker(view);
      const target = new Vector3(view.position.x, SYSTEM_FLEET_Y + FLEET_MARKER_Y_OFFSET, view.position.z);
      if (!existingRoot) root.position.copyFrom(target);
      this.fleetTargets.set(view.id, target);
      root.setEnabled(this.starsVisible);
      const selected = view.id === this.selectedFleetId || this.selectedFleetIds.has(view.id);
      root.scaling.setAll(selected ? 1.08 : 1);
      const ring = root.getChildMeshes().find((mesh) => mesh.name.startsWith("fleetMarkerRing-"));
      if (ring) {
        ring.setEnabled(selected && this.starsVisible);
        ring.scaling.set(Math.max(1, view.tacticalRadius), 1, Math.max(1, view.tacticalRadius));
      }
      root.metadata = { fleetId: view.id, view };
    }
  }

  private createFleetMarker(view: TacticalFleetView): TransformNode {
    const root = new TransformNode(`fleetMarker-${view.id}`, this.scene);
    root.metadata = { fleetId: view.id, view };
    const owner = this.getFaction(view.ownerId);
    const color = owner?.color
      ? new Color3(owner.color[0], owner.color[1], owner.color[2])
      : new Color3(0.55, 0.84, 1);
    const material = new StandardMaterial(`fleetMarkerMat-${view.id}`, this.scene);
    material.diffuseColor = color.scale(0.18);
    material.emissiveColor = color.scale(0.24);
    material.specularColor = Color3.Black();
    material.alpha = 0.3;
    material.disableLighting = true;
    this.fleetMaterials.set(view.id, material);

    const core = MeshBuilder.CreateSphere(`fleetMarkerCore-${view.id}`, { diameter: 0.32, segments: 10 }, this.scene);
    core.parent = root;
    core.position.y = -0.14;
    core.material = material;
    core.isPickable = true;
    core.metadata = { fleetId: view.id };

    const ring = MeshBuilder.CreateTorus(`fleetMarkerRing-${view.id}`, {
      diameter: BATTLE_GROUP_RING_BASE_DIAMETER,
      thickness: 0.045,
      tessellation: 48,
    }, this.scene);
    ring.parent = root;
    ring.position.y = -0.14;
    ring.material = material;
    ring.isPickable = true;
    ring.metadata = { fleetId: view.id };
    ring.setEnabled(false);

    this.fleetRoots.set(view.id, root);
    return root;
  }

  private createSystemPlaneCircleLine(
    name: string,
    position: SystemPosition,
    radius: number,
    y: number,
    color: Color3,
    alpha: number,
  ): LinesMesh {
    const points: Vector3[] = [];
    for (let index = 0; index <= TACTICAL_RING_SEGMENTS; index += 1) {
      const theta = (index / TACTICAL_RING_SEGMENTS) * Math.PI * 2;
      points.push(new Vector3(
        position.x + Math.cos(theta) * radius,
        y,
        position.z + Math.sin(theta) * radius,
      ));
    }
    const ring = MeshBuilder.CreateLines(name, { points }, this.scene);
    ring.color = color;
    ring.alpha = alpha;
    ring.isPickable = false;
    ring.alwaysSelectAsActiveMesh = true;
    return ring;
  }

  private disposeStarbaseCombatRangeRing(): void {
    this.starbaseRangeRing?.dispose();
    this.starbaseRangeRing = null;
    this.starbaseRangeSignature = null;
  }

  private refreshStarbaseCombatRangeRing(): void {
    const stationGroup = this.battles
      .filter((battle) => battle.starId === this.star.id && battle.phase !== "resolved")
      .flatMap((battle) => battle.combatGroups ?? [])
      .find((group) => group.role === "station" && group.status !== "destroyed" && group.maxWeaponRange > 0);
    const starbase = this.getStarbasesInCurrentSystem().find((candidate) => candidate.status === "online") ?? null;
    const position = stationGroup?.position ?? starbase?.systemPosition ?? null;
    const range = stationGroup?.maxWeaponRange ?? (starbase ? this.getStarbaseMaxWeaponRange(starbase) : 0);
    if (!position || range <= 0) {
      this.disposeStarbaseCombatRangeRing();
      return;
    }
    const signature = [
      position.x.toFixed(2),
      position.z.toFixed(2),
      range.toFixed(2),
    ].join(":");
    if (this.starbaseRangeSignature !== signature) {
      this.disposeStarbaseCombatRangeRing();
      this.starbaseRangeRing = this.createSystemPlaneCircleLine(
        "starbaseCombatRangeRing",
        position,
        range,
        SYSTEM_FLEET_Y + 0.07,
        new Color3(0.28, 0.72, 1.0),
        0.32,
      );
      this.starbaseRangeSignature = signature;
    }
    this.starbaseRangeRing?.setEnabled(this.starsVisible && range > 0);
  }

  private getStarbaseMaxWeaponRange(starbase: ServerStarbase): number {
    const mounts = STARBASE_LEVEL_DEFINITIONS[starbase.level]?.combat.weaponMounts ?? [];
    return mounts.reduce((max, mount) => {
      const rangeBand = mount.maxRangeBand ?? "close";
      const range = BATTLE_RANGE_DISTANCE_BY_BAND[rangeBand] ?? BATTLE_RANGE_DISTANCE_BY_BAND.close;
      return Math.max(max, Number.isFinite(range) ? range : 0);
    }, 0);
  }

  private refreshBattleShips(): void {
    const battlesInSystem = this.battles.filter((battle) => (
      battle.starId === this.star.id && battle.phase !== "resolved"
    ));
    const shipStates = battlesInSystem.flatMap((battle) => battle.ships).filter((ship) => !ship.destroyed);
    const groupById = new Map(battlesInSystem.flatMap((battle) => battle.combatGroups ?? []).map((group) => [group.id, group]));
    const battleShipIds = new Set(shipStates.map((ship) => ship.shipId));
    const visibleGroupViews = this.getVisibleBattleGroupViews();
    const visibleFleetViews = this.getVisibleFleetViews();
    const liveServerShipIds = new Set(this.serverShips.map((ship) => ship.id));
    const alertGroupByShipId = new Map<string, TacticalBattleGroupView>();
    const fleetViewByShipId = new Map<string, TacticalFleetView>();
    for (const group of visibleGroupViews) {
      if (group.status !== "alert") continue;
      for (const shipId of group.shipIds) {
        if (!battleShipIds.has(shipId) && liveServerShipIds.has(shipId)) {
          alertGroupByShipId.set(shipId, group);
        }
      }
    }
    for (const fleet of visibleFleetViews) {
      for (const shipId of fleet.shipIds) {
        if (!battleShipIds.has(shipId) && !alertGroupByShipId.has(shipId) && liveServerShipIds.has(shipId)) {
          fleetViewByShipId.set(shipId, fleet);
        }
      }
    }
    const shipIds = new Set([
      ...battleShipIds,
      ...alertGroupByShipId.keys(),
      ...fleetViewByShipId.keys(),
    ]);
    this.refreshBattleGroupMarkers(visibleGroupViews);
    this.refreshFleetMarkers(visibleFleetViews);

    if (shipIds.size === 0) {
      for (const [, root] of this.battleShipRoots) {
        root.dispose();
      }
      this.battleShipRoots.clear();
      this.battleShipTargets.clear();
      this.battleRoundSeen.clear();
      this.refreshBattleGroupMarkers();
      this.refreshFleetMarkers([]);
      if (this.playerShipRoot) {
        this.playerShipRoot.setEnabled(this.starsVisible);
      }
      return;
    }

    void this.ensureBattleShipTemplate().then(() => {
      for (const [shipId, root] of Array.from(this.battleShipRoots.entries())) {
        if (!shipIds.has(shipId)) {
          root.dispose();
          this.battleShipRoots.delete(shipId);
          this.battleShipTargets.delete(shipId);
        }
      }

      for (const shipState of shipStates) {
        const existingRoot = this.battleShipRoots.get(shipState.shipId);
        const root = existingRoot ?? this.createBattleShipInstance(shipState.shipId);
        if (!root) continue;
        const group = shipState.groupId ? groupById.get(shipState.groupId) : null;
        const target = group ? this.getBattleShipFormationPosition(group, shipState.shipId) : this.getBattleZonePosition(shipState.zone, shipState.shipId);
        if (!existingRoot) {
          root.position.copyFrom(target);
        }
        this.setShipVisualMetadata(root, {
          shipId: shipState.shipId,
          fleetId: shipState.fleetId,
          battleGroupId: shipState.groupId ?? null,
        });
        this.battleShipTargets.set(shipState.shipId, target);
      }

      for (const [shipId, group] of alertGroupByShipId) {
        const existingRoot = this.battleShipRoots.get(shipId);
        const root = existingRoot ?? this.createBattleShipInstance(shipId);
        if (!root) continue;
        const target = this.getAlertGroupShipFormationPosition(group, shipId);
        if (!existingRoot) {
          root.position.copyFrom(target);
        }
        this.setShipVisualMetadata(root, {
          shipId,
          fleetId: group.fleetId,
          battleGroupId: group.id,
        });
        this.battleShipTargets.set(shipId, target);
      }

      for (const [shipId, fleet] of fleetViewByShipId) {
        const existingRoot = this.battleShipRoots.get(shipId);
        const root = existingRoot ?? this.createBattleShipInstance(shipId);
        if (!root) continue;
        const target = this.getGroupShipFormationPosition(`fleet:${fleet.id}`, fleet.position, fleet.shipIds, shipId);
        if (!existingRoot) {
          root.position.copyFrom(target);
        }
        this.setShipVisualMetadata(root, {
          shipId,
          fleetId: fleet.id,
          battleGroupId: null,
        });
        this.battleShipTargets.set(shipId, target);
      }

      if (this.playerShipRoot) {
        this.playerShipRoot.setEnabled(false);
      }

      this.queueBattleRoundBeams(battlesInSystem);
      this.queueRecentCombatContactEffects();
    });
  }

  private getBattleEntityPosition(entityId: string): Vector3 | null {
    const shipRoot = this.battleShipRoots.get(entityId);
    if (shipRoot) return shipRoot.position.clone();
    const fleetRoot = this.fleetRoots.get(entityId);
    if (fleetRoot) return fleetRoot.position.clone();
    for (const root of this.battleShipRoots.values()) {
      const metadata = root.metadata as { fleetId?: string | null } | null;
      if (metadata?.fleetId === entityId) return root.position.clone();
    }
    if (this.starbaseRoot && this.starbaseRoot.isEnabled() && this.starbases.some((sb) => sb.id === entityId)) {
      return this.starbaseRoot.position.clone();
    }
    return null;
  }

  private queueRecentCombatContactEffects(): void {
    let effectsQueued = 0;
    const maxEffects = 80;
    for (const contact of this.recentCombatContacts) {
      if (this.combatContactSeen.has(contact.id)) continue;
      this.combatContactSeen.add(contact.id);
      if (effectsQueued >= maxEffects) continue;
      const from = this.getBattleEntityPosition(contact.sourceId)
        ?? new Vector3(contact.sourcePosition.x, SYSTEM_FLEET_Y + 0.4, contact.sourcePosition.z);
      const to = this.getBattleEntityPosition(contact.targetId)
        ?? new Vector3(contact.targetPosition.x, SYSTEM_FLEET_Y + 0.4, contact.targetPosition.z);
      const weaponId = contact.weaponId?.toLowerCase() ?? "";
      if (weaponId.includes("missile") || weaponId.includes("torpedo")) {
        this.queueBattleProjectile(`fleetMissile-${contact.id}`, from, to, new Color3(1, 0.52, 0.12), 0.8, 0.24);
      } else if (weaponId.includes("point") || weaponId.includes("pd") || weaponId.includes("flak")) {
        for (let i = 0; i < 3; i += 1) {
          const offset = new Vector3((i - 1) * 0.12, i * 0.04, 0);
          this.queueBattleProjectile(`fleetPd-${contact.id}-${i}`, from.add(offset), to, new Color3(0.5, 0.9, 1), 0.32, 0.1);
        }
      } else {
        const beam = MeshBuilder.CreateLines(`fleetBeam-${contact.id}`, { points: [from, to] }, this.scene);
        beam.color = contact.hit ? new Color3(0.3, 0.84, 1) : new Color3(0.7, 0.72, 0.78);
        beam.alpha = contact.hit ? 0.85 : 0.38;
        beam.isPickable = false;
        this.glowLayer.addIncludedOnlyMesh(beam);
        this.battleBeams.push({ mesh: beam, ttl: BATTLE_BEAM_TTL, maxTtl: BATTLE_BEAM_TTL });
      }
      effectsQueued += 1;
    }
    if (this.combatContactSeen.size > 320) {
      this.combatContactSeen = new Set(Array.from(this.combatContactSeen).slice(-160));
    }
  }

  private queueBattleRoundBeams(battles: ServerBattle[]): void {
    for (const battle of battles) {
      const latestRound = battle.recentRounds[battle.recentRounds.length - 1];
      if (!latestRound) continue;
      const lastSeen = this.battleRoundSeen.get(battle.id) ?? -1;
      if (latestRound.round <= lastSeen) continue;
      this.battleRoundSeen.set(battle.id, latestRound.round);
      let effectsQueued = 0;
      const maxEffectsPerRound = 90;

      for (const action of latestRound.actions) {
        if (!action.fired) continue;
        const from = this.getBattleEntityPosition(action.actorId);
        if (!from) continue;
        const effects = action.fired.weaponEffects?.length ? action.fired.weaponEffects : [action.fired];
        for (let effectIndex = 0; effectIndex < effects.length; effectIndex += 1) {
          if (effectsQueued >= maxEffectsPerRound) break;
          const effect = effects[effectIndex];
          const to = this.getBattleEntityPosition(effect.targetId);
          if (!to) continue;
          effectsQueued += 1;
          const salvoOffset = new Vector3((effectIndex - (effects.length - 1) / 2) * 0.18, 0.02 * effectIndex, 0);
          const effectFrom = from.add(salvoOffset);
          const weaponId = effect.weaponId?.toLowerCase() ?? action.fired.weaponId?.toLowerCase() ?? "";
          if (weaponId.includes("missile")) {
            this.queueBattleProjectile(
              `battleMissile-${battle.id}-${action.actorId}-${latestRound.round}-${effectIndex}`,
              effectFrom,
              to,
              effect.hit ? new Color3(1.0, 0.52, 0.16) : new Color3(1.0, 0.25, 0.12),
              0.8,
              0.24,
            );
            continue;
          }
          if (weaponId.includes("point-defense") || weaponId.includes("pointdefense")) {
            for (let i = 0; i < 4; i += 1) {
              const jitter = new Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.9);
              this.queueBattleProjectile(
                `battlePd-${battle.id}-${action.actorId}-${latestRound.round}-${effectIndex}-${i}`,
                effectFrom.add(jitter),
                to.add(jitter.scale(0.35)),
                effect.hit ? new Color3(1.0, 0.86, 0.38) : new Color3(1.0, 0.38, 0.24),
                0.34,
                0.1,
              );
            }
            continue;
          }
          const beam = MeshBuilder.CreateLines(
            `battleBeam-${battle.id}-${action.actorId}-${latestRound.round}-${effectIndex}`,
            { points: [effectFrom, to] },
            this.scene,
          );
          beam.color = effect.hit ? new Color3(0.6, 0.9, 1.0) : new Color3(1.0, 0.5, 0.3);
          beam.isPickable = false;
          this.battleBeams.push({ mesh: beam, ttl: BATTLE_BEAM_TTL, maxTtl: BATTLE_BEAM_TTL });
        }
      }
    }
  }

  private queueBattleProjectile(
    name: string,
    from: Vector3,
    to: Vector3,
    color: Color3,
    ttl: number,
    diameter: number,
  ): void {
    const projectile = MeshBuilder.CreateSphere(name, { diameter, segments: 10 }, this.scene);
    projectile.position.copyFrom(from);
    projectile.isPickable = false;
    const material = new StandardMaterial(`${name}Mat`, this.scene);
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = color.scale(1.8);
    material.disableLighting = true;
    material.alpha = 1;
    projectile.material = material;
    this.glowLayer.addIncludedOnlyMesh(projectile);
    const velocity = to.subtract(from).scale(1 / Math.max(0.01, ttl));
    this.battleProjectiles.push({ mesh: projectile, material, velocity, ttl, maxTtl: ttl });
  }

  private createRedGiantAtmosphere(starDiameter: number, starTint: Color3): void {
    if (!this.starMesh) return;

    const haze = MeshBuilder.CreateSphere(
      "redGiantHaze",
      { diameter: starDiameter * 1.5, segments: 24 },
      this.scene,
    );
    haze.parent = this.starMesh;
    haze.isPickable = false;

    const hazeMat = new StandardMaterial("redGiantHazeMat", this.scene);
    hazeMat.emissiveColor = starTint.scale(0.9);
    hazeMat.diffuseColor = Color3.Black();
    hazeMat.specularColor = Color3.Black();
    hazeMat.disableLighting = true;
    hazeMat.backFaceCulling = false;
    hazeMat.alpha = 0.22;
    haze.material = hazeMat;

    this.glowLayer.addIncludedOnlyMesh(haze);
  }

  private createPulsarBeams(starDiameter: number, starTint: Color3): void {
    if (!this.starMesh) return;

    this.pulsarBeamPivot = new TransformNode("pulsarBeamPivot", this.scene);
    this.pulsarBeamPivot.parent = this.starMesh;

    const beamLength = Math.max(18, starDiameter * 18);
    const beamRadius = Math.max(0.08, starDiameter * 0.24);

    const beamMat = new StandardMaterial("pulsarBeamMat", this.scene);
    beamMat.emissiveColor = new Color3(
      Math.min(1, starTint.r * 0.5 + 0.45),
      Math.min(1, starTint.g * 0.7 + 0.45),
      1,
    ).scale(1.8);
    beamMat.diffuseColor = Color3.Black();
    beamMat.specularColor = Color3.Black();
    beamMat.disableLighting = true;
    beamMat.alpha = 0.45;
    beamMat.backFaceCulling = false;
    this.pulsarBeamMaterial = beamMat;

    const upBeam = MeshBuilder.CreateCylinder(
      "pulsarBeamUp",
      {
        height: beamLength,
        diameterTop: 0.01,
        diameterBottom: beamRadius,
        tessellation: 18,
      },
      this.scene,
    );
    upBeam.parent = this.pulsarBeamPivot;
    upBeam.position.y = beamLength * 0.5 + starDiameter * 0.65;
    upBeam.material = beamMat;
    upBeam.isPickable = false;

    const downBeam = MeshBuilder.CreateCylinder(
      "pulsarBeamDown",
      {
        height: beamLength,
        diameterTop: 0.01,
        diameterBottom: beamRadius,
        tessellation: 18,
      },
      this.scene,
    );
    downBeam.parent = this.pulsarBeamPivot;
    downBeam.position.y = -beamLength * 0.5 - starDiameter * 0.65;
    downBeam.rotation.z = Math.PI;
    downBeam.material = beamMat;
    downBeam.isPickable = false;

    this.glowLayer.addIncludedOnlyMesh(upBeam);
    this.glowLayer.addIncludedOnlyMesh(downBeam);
  }

  private createBlackHoleFeatures(starDiameter: number): void {
    if (!this.starMesh) return;

    const outerDisk = MeshBuilder.CreateTorus(
      "blackHoleDiskOuter",
      {
        diameter: starDiameter * 4.8,
        thickness: starDiameter * 0.85,
        tessellation: 72,
      },
      this.scene,
    );
    outerDisk.parent = this.starMesh;
    outerDisk.rotation.x = Math.PI / 2.35;
    outerDisk.isPickable = false;

    const outerMat = new StandardMaterial("blackHoleDiskOuterMat", this.scene);
    outerMat.emissiveTexture = new Texture("/textures/star_surface.png", this.scene);
    outerMat.emissiveTexture.level = 2.0;
    outerMat.emissiveColor = new Color3(1.2, 0.78, 0.4);
    outerMat.diffuseColor = Color3.Black();
    outerMat.specularColor = Color3.Black();
    outerMat.disableLighting = true;
    outerMat.backFaceCulling = false;
    outerMat.alpha = 0.92;
    outerDisk.material = outerMat;

    const innerDisk = MeshBuilder.CreateTorus(
      "blackHoleDiskInner",
      {
        diameter: starDiameter * 3.3,
        thickness: starDiameter * 0.38,
        tessellation: 64,
      },
      this.scene,
    );
    innerDisk.parent = this.starMesh;
    innerDisk.rotation.x = Math.PI / 2.35;
    innerDisk.isPickable = false;

    const innerMat = new StandardMaterial("blackHoleDiskInnerMat", this.scene);
    innerMat.emissiveColor = new Color3(0.72, 0.86, 1.0).scale(1.35);
    innerMat.diffuseColor = Color3.Black();
    innerMat.specularColor = Color3.Black();
    innerMat.disableLighting = true;
    innerMat.backFaceCulling = false;
    innerMat.alpha = 0.56;
    innerDisk.material = innerMat;

    const lensRing = MeshBuilder.CreateTorus(
      "blackHoleLensRing",
      {
        diameter: starDiameter * 2.15,
        thickness: starDiameter * 0.12,
        tessellation: 56,
      },
      this.scene,
    );
    lensRing.parent = this.starMesh;
    lensRing.rotation.x = Math.PI / 2.35;
    lensRing.isPickable = false;

    const lensMat = new StandardMaterial("blackHoleLensRingMat", this.scene);
    lensMat.emissiveColor = new Color3(0.9, 0.92, 1.0);
    lensMat.diffuseColor = Color3.Black();
    lensMat.specularColor = Color3.Black();
    lensMat.disableLighting = true;
    lensMat.backFaceCulling = false;
    lensMat.alpha = 0.38;
    lensRing.material = lensMat;

    const jetMat = new StandardMaterial("blackHoleJetMat", this.scene);
    jetMat.emissiveColor = new Color3(0.65, 0.78, 1.0).scale(1.4);
    jetMat.diffuseColor = Color3.Black();
    jetMat.specularColor = Color3.Black();
    jetMat.disableLighting = true;
    jetMat.backFaceCulling = false;
    jetMat.alpha = 0.24;

    const jetLength = starDiameter * 9;
    const jetRadius = Math.max(0.04, starDiameter * 0.16);

    const topJet = MeshBuilder.CreateCylinder(
      "blackHoleJetTop",
      {
        height: jetLength,
        diameterTop: 0.01,
        diameterBottom: jetRadius,
        tessellation: 16,
      },
      this.scene,
    );
    topJet.parent = this.starMesh;
    topJet.position.y = jetLength * 0.5 + starDiameter * 0.6;
    topJet.material = jetMat;
    topJet.isPickable = false;

    const bottomJet = MeshBuilder.CreateCylinder(
      "blackHoleJetBottom",
      {
        height: jetLength,
        diameterTop: 0.01,
        diameterBottom: jetRadius,
        tessellation: 16,
      },
      this.scene,
    );
    bottomJet.parent = this.starMesh;
    bottomJet.position.y = -jetLength * 0.5 - starDiameter * 0.6;
    bottomJet.rotation.z = Math.PI;
    bottomJet.material = jetMat;
    bottomJet.isPickable = false;

    this.blackHoleDiskOuter = outerDisk;
    this.blackHoleDiskInner = innerDisk;

    this.glowLayer.addIncludedOnlyMesh(outerDisk);
    this.glowLayer.addIncludedOnlyMesh(innerDisk);
    this.glowLayer.addIncludedOnlyMesh(lensRing);
    this.glowLayer.addIncludedOnlyMesh(topJet);
    this.glowLayer.addIncludedOnlyMesh(bottomJet);
  }

  private createPlanet(index: number, planet: PlanetConfig): void {
    const planetCfg = PLANET_TYPES[planet.type];
    const textureVariantNum = planet.textureVariation + 1;
    const texturePath = `${planetCfg.texturePrefix}_0${textureVariantNum}-1024x512.png`;

    const orbitLayout = {
      ...getSystemOrbitLayout(this.star.type),
      orbitBaseOffset: this.orbitBaseOffset,
      orbitSpacing: this.orbitSpacing,
    };
    const orbitRadius = getPlanetSystemOrbitRadius(planet, index, orbitLayout);
    const diameter = getPlanetVisualDiameter(planet);

    const mesh = MeshBuilder.CreateSphere(
      `systemPlanet_${index}`,
      { diameter, segments: 28 },
      this.scene,
    );

    const mat = new StandardMaterial(`systemPlanetMat_${index}`, this.scene);
    const planetTexture = new Texture(texturePath, this.scene);
    planetTexture.hasAlpha = false;
    mat.diffuseTexture = planetTexture;
    mat.specularColor = new Color3(0.12, 0.12, 0.12);
    // Keep a subtle baseline lift for readability without making planets
    // look self-illuminated or washing out the sunlit side.
    mat.emissiveColor = this.planetNightLift.scale(0.2);
    mat.alpha = 1.0;
    mat.useAlphaFromDiffuseTexture = false;
    mat.transparencyMode = Material.MATERIAL_OPAQUE;
    mat.forceDepthWrite = true;
    mesh.material = mat;
    mesh.isPickable = false;
    const getSystemPosition = (nowMs: number) => getPlanetSystemPosition(planet, index, nowMs, orbitLayout);
    const initialPosition = getSystemPosition(Date.now());
    mesh.position.set(initialPosition.x, initialPosition.y, initialPosition.z);

    // Add planet as an occluder to the glow pass so the star's bloom doesn't
    // composite over planets. Planets have near-zero emissive above.
    if (this.glowLayer) {
      this.glowLayer.addIncludedOnlyMesh(mesh as Mesh);
    }

    this.createOrbitRing(index, orbitRadius);
    this.planetMeshes.push(mesh);
    this.planetDiameters.push(diameter);
    
    // Create planet label
    const labelMesh = this.createPlanetLabel(index, planet, orbitRadius);
    this.planetLabelMeshes.push(labelMesh);

    const axialPhase = Number.isFinite(planet.orbitPhaseAtEpoch)
      ? (planet.orbitPhaseAtEpoch / (Math.PI * 2)) % 1
      : 0;
    this.orbitSystem.addBody({
      mesh,
      getSystemPosition,
      axialRotationSpeed: 0.18 + axialPhase * 0.22,
    });
  }

  private createHyperlaneExits(): void {
    if (this.hyperlaneExits.length === 0) return;
    if (!this.hyperlaneExitMaterial) {
      const material = new StandardMaterial("systemHyperlaneExitMat", this.scene);
      material.emissiveColor = new Color3(0.32, 0.75, 1.0);
      material.diffuseColor = new Color3(0.08, 0.22, 0.32);
      material.specularColor = new Color3(0.35, 0.75, 1.0);
      material.alpha = 0.78;
      this.hyperlaneExitMaterial = material;
    }

    for (const exit of this.hyperlaneExits) {
      const position = exit.systemPosition ?? getHyperlaneExitSystemPosition(exit);
      const marker = MeshBuilder.CreateTorus(
        `hyperlaneExit_${this.star.id}_${exit.starId}`,
        { diameter: 2.4, thickness: 0.08, tessellation: 36 },
        this.scene,
      );
      marker.position.set(position.x, SYSTEM_HYPERLANE_EXIT_MARKER_Y, position.z);
      marker.rotation.x = Math.PI / 2;
      marker.material = this.hyperlaneExitMaterial;
      marker.isPickable = false;
      marker.alwaysSelectAsActiveMesh = true;
      this.hyperlaneExitMeshes.push(marker);
      this.glowLayer.addIncludedOnlyMesh(marker);
    }
  }

  private createOrbitRing(index: number, radius: number): void {
    const points: Vector3[] = [];
    const segments = 144;
    const dashCount = Math.max(18, Math.round(radius * 0.4));
    const ringY = 0.03;

    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      points.push(new Vector3(Math.cos(t) * radius, ringY, Math.sin(t) * radius));
    }

    const ring = MeshBuilder.CreateDashedLines(
      `systemOrbitRing_${index}`,
      {
        points,
        dashSize: 3.4,
        gapSize: 4.2,
        dashNb: dashCount,
      },
      this.scene,
    );
    ring.color = new Color3(0.74, 0.74, 0.78);
    ring.alpha = 0.32;
    ring.renderingGroupId = 1;
    ring.alwaysSelectAsActiveMesh = true;
    ring.isPickable = false;
    this.orbitRings.push(ring);
  }

  private createPlanetLabel(index: number, planet: PlanetConfig, orbitRadius: number): Mesh {
    const labelTexture = new DynamicTexture(
      `planetLabel_${index}`,
      { width: SYSTEM_LABEL_TEXTURE_WIDTH, height: SYSTEM_LABEL_TEXTURE_HEIGHT },
      this.scene,
      false,
    );
    labelTexture.hasAlpha = true;
    labelTexture.uScale = SYSTEM_LABEL_U_SCALE;
    labelTexture.uOffset = SYSTEM_LABEL_U_OFFSET;
    const ctx = labelTexture.getContext() as unknown as CanvasRenderingContext2D;

    const isHabited = planet.isHabited ?? false;
    ctx.clearRect(0, 0, SYSTEM_LABEL_TEXTURE_WIDTH, SYSTEM_LABEL_TEXTURE_HEIGHT);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    if (isHabited) {
      this.drawSystemNameplate(ctx, SYSTEM_LABEL_TEXTURE_WIDTH, SYSTEM_LABEL_TEXTURE_HEIGHT, planet.name, "HABITED", true);
    } else {
      this.drawSimpleSystemLabel(ctx, SYSTEM_LABEL_TEXTURE_WIDTH, SYSTEM_LABEL_TEXTURE_HEIGHT, planet.name, 150);
    }

    labelTexture.update(true);

    // Create material
    const material = new StandardMaterial(`planetLabelMat_${index}`, this.scene);
    material.diffuseTexture = labelTexture;
    material.emissiveTexture = labelTexture;
    material.opacityTexture = labelTexture;
    material.diffuseColor = Color3.White();
    material.emissiveColor = Color3.White();
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.useAlphaFromDiffuseTexture = true;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    material.alpha = 1.0;
    material.disableDepthWrite = true;
    

    // Create plane mesh - texture and plane share the same aspect ratio to avoid stretching.
    const labelMesh = MeshBuilder.CreatePlane(
      `planetLabel_mesh_${index}`,
      { width: isHabited ? 8.2 : 5.8, height: isHabited ? 2.05 : 1.45 },
      this.scene,
    );
    
    // Position label (will be updated each frame)
    labelMesh.position = new Vector3(0, 0, 0);
    labelMesh.material = material;
    labelMesh.isPickable = false;
    labelMesh.renderingGroupId = 2;
    labelMesh.alwaysSelectAsActiveMesh = true;
    labelMesh.billboardMode = Mesh.BILLBOARDMODE_NONE;
    
    return labelMesh;
  }

  private createStarLabel(): Mesh {
    const labelTexture = new DynamicTexture(
      "starLabel",
      { width: SYSTEM_LABEL_TEXTURE_WIDTH, height: SYSTEM_LABEL_TEXTURE_HEIGHT },
      this.scene,
      false,
    );
    labelTexture.hasAlpha = true;
    labelTexture.uScale = SYSTEM_LABEL_U_SCALE;
    labelTexture.uOffset = SYSTEM_LABEL_U_OFFSET;
    const ctx = labelTexture.getContext() as unknown as CanvasRenderingContext2D;

    ctx.clearRect(0, 0, SYSTEM_LABEL_TEXTURE_WIDTH, SYSTEM_LABEL_TEXTURE_HEIGHT);
    this.drawSimpleSystemLabel(ctx, SYSTEM_LABEL_TEXTURE_WIDTH, SYSTEM_LABEL_TEXTURE_HEIGHT, this.star.name, 150);

    labelTexture.update(true);

    // Create material
    const material = new StandardMaterial("starLabelMat", this.scene);
    material.diffuseTexture = labelTexture;
    material.emissiveTexture = labelTexture;
    material.opacityTexture = labelTexture;
    material.diffuseColor = Color3.White();
    material.emissiveColor = Color3.White();
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.useAlphaFromDiffuseTexture = true;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    material.alpha = 1.0;
    material.disableDepthWrite = true;
    

    // Create plane mesh for star label
    const labelMesh = MeshBuilder.CreatePlane(
      "starLabel_mesh",
      { width: 6.2, height: 1.55 },
      this.scene,
    );
    
    labelMesh.position = new Vector3(0, this.starDiameter + 3, 0);
    labelMesh.material = material;
    labelMesh.isPickable = false;
    labelMesh.renderingGroupId = 2;
    labelMesh.alwaysSelectAsActiveMesh = true;
    labelMesh.billboardMode = Mesh.BILLBOARDMODE_NONE;
    
    return labelMesh;
  }

  private drawSimpleSystemLabel(
    ctx: CanvasRenderingContext2D,
    textureWidth: number,
    textureHeight: number,
    text: string,
    fontSize: number,
  ): void {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxTextWidth = textureWidth - 180;
    let fittedFontSize = fontSize;
    do {
      ctx.font = `800 ${fittedFontSize}px "Segoe UI", Arial, sans-serif`;
      if (ctx.measureText(text).width <= maxTextWidth) break;
      fittedFontSize -= 6;
    } while (fittedFontSize > 72);

    ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 5;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.96)";
    ctx.lineWidth = Math.max(10, fittedFontSize * 0.11);
    ctx.strokeText(text, textureWidth / 2, textureHeight / 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
    ctx.fillText(text, textureWidth / 2, textureHeight / 2);
    ctx.restore();
  }

  private drawSystemNameplate(
    ctx: CanvasRenderingContext2D,
    textureWidth: number,
    textureHeight: number,
    name: string,
    status: string,
    drawBadge: boolean,
  ): void {
    const plateW = 1120;
    const plateH = 210;
    const plateX = (textureWidth - plateW) / 2 - (drawBadge ? 115 : 0);
    const plateY = (textureHeight - plateH) / 2;
    const badgeX = plateX + plateW + 125;
    const badgeY = textureHeight / 2;
    const badgeR = 110;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.82)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = "rgba(5, 45, 39, 0.94)";
    ctx.strokeStyle = "rgba(152, 240, 219, 0.86)";
    ctx.lineWidth = 12;
    this.drawSystemRoundedRect(ctx, plateX, plateY, plateW, plateH, 12);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(35, 137, 116, 0.34)";
    ctx.fillRect(plateX + 24, plateY + 24, plateW - 48, 24);
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxTextWidth = plateW - 90;
    let nameFontSize = 112;
    do {
      ctx.font = `900 ${nameFontSize}px "Segoe UI", Arial, sans-serif`;
      if (ctx.measureText(name).width <= maxTextWidth) break;
      nameFontSize -= 5;
    } while (nameFontSize > 58);

    ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
    ctx.shadowBlur = 14;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.95)";
    ctx.lineWidth = Math.max(7, nameFontSize * 0.07);
    ctx.strokeText(name, plateX + plateW / 2, plateY + 92, maxTextWidth);
    ctx.fillStyle = "rgba(230, 255, 250, 0.98)";
    ctx.fillText(name, plateX + plateW / 2, plateY + 92, maxTextWidth);

    ctx.font = `800 42px "Segoe UI", Arial, sans-serif`;
    ctx.fillStyle = "rgba(114, 230, 139, 0.9)";
    ctx.fillText(status, plateX + plateW / 2, plateY + 158);
    ctx.restore();

    if (drawBadge) {
      this.drawSystemHabitedPlanetBadge(ctx, badgeX, badgeY, badgeR);
    }
  }

  private drawSystemRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  private drawSystemHexBadge(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
    const drawHex = (r: number): void => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = -Math.PI / 6 + (i * Math.PI * 2) / 6;
        const px = x + Math.cos(angle) * r;
        const py = y + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.82)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 12;
    drawHex(radius);
    ctx.fillStyle = "rgba(224, 239, 235, 0.98)";
    ctx.fill();
    ctx.lineWidth = 20;
    ctx.strokeStyle = "rgba(66, 86, 82, 0.96)";
    ctx.stroke();

    drawHex(radius * 0.64);
    ctx.fillStyle = "rgba(245, 252, 250, 1)";
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(92, 112, 108, 0.86)";
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(78, 93, 90, 0.98)";
    const nodeR = radius * 0.12;
    const nodes = [
      [x, y - radius * 0.22],
      [x - radius * 0.22, y + radius * 0.12],
      [x + radius * 0.22, y + radius * 0.12],
    ];
    ctx.lineWidth = 14;
    ctx.strokeStyle = "rgba(78, 93, 90, 0.95)";
    ctx.beginPath();
    ctx.moveTo(nodes[0][0], nodes[0][1]);
    ctx.lineTo(nodes[1][0], nodes[1][1]);
    ctx.lineTo(nodes[2][0], nodes[2][1]);
    ctx.lineTo(nodes[0][0], nodes[0][1]);
    ctx.stroke();
    for (const [nx, ny] of nodes) {
      ctx.beginPath();
      ctx.arc(nx, ny, nodeR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawSystemHabitedPlanetBadge(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
    const drawHex = (r: number): void => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = -Math.PI / 6 + (i * Math.PI * 2) / 6;
        const px = x + Math.cos(angle) * r;
        const py = y + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.82)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 12;

    drawHex(radius);
    const bg = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
    bg.addColorStop(0, "rgba(24, 171, 126, 0.98)");
    bg.addColorStop(0.58, "rgba(21, 100, 137, 0.98)");
    bg.addColorStop(1, "rgba(226, 166, 61, 0.98)");
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 20;
    ctx.strokeStyle = "rgba(194, 255, 231, 0.96)";
    ctx.stroke();

    drawHex(radius * 0.76);
    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(7, 35, 40, 0.72)";
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * 0.45, radius * 0.32, -0.18, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(210, 252, 230, 0.98)";
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(9, 50, 51, 0.88)";
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(x - radius * 0.1, y - radius * 0.02, radius * 0.5, radius * 0.16, -0.34, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 232, 134, 0.95)";
    ctx.lineWidth = 9;
    ctx.stroke();

    ctx.fillStyle = "rgba(34, 124, 92, 0.9)";
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.27, y - radius * 0.06);
    ctx.bezierCurveTo(x - radius * 0.1, y - radius * 0.2, x + radius * 0.08, y - radius * 0.14, x + radius * 0.17, y);
    ctx.bezierCurveTo(x + radius * 0.02, y + radius * 0.05, x - radius * 0.12, y + radius * 0.08, x - radius * 0.27, y - radius * 0.06);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 226, 105, 0.96)";
    const lightR = Math.max(4, radius * 0.045);
    const lights = [
      [x - radius * 0.11, y + radius * 0.1],
      [x + radius * 0.03, y + radius * 0.07],
      [x + radius * 0.18, y + radius * 0.02],
    ];
    for (const [lx, ly] of lights) {
      ctx.beginPath();
      ctx.arc(lx, ly, lightR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private installObjectLabelClicks(): void {
    this.pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type !== PointerEventTypes.POINTERDOWN) return;
      const ev = pointerInfo.event as PointerEvent;
      if (ev.button !== 0) return;
      if (this.tryIssueActiveFleetActionAtPointer(ev)) {
        ev.preventDefault();
        return;
      }
      if (this.trySelectBattleGroupAtPointer(ev)) {
        ev.preventDefault();
        return;
      }
      if (this.trySelectFleetMarkerAtPointer(ev) || this.trySelectShipVisualAtPointer(ev)) {
        ev.preventDefault();
        return;
      }
      if (this.tryOpenObjectPanelAtPointer(ev)) {
        ev.preventDefault();
        return;
      }
      if (!ev.shiftKey) this.clearFleetSelection();
    });
  }

  private trySelectBattleGroupAtPointer(ev: PointerEvent): boolean {
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas || this.battleGroupRoots.size === 0) return false;
    const rect = canvas.getBoundingClientRect();
    const canvasX = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (ev.clientY - rect.top) * (canvas.height / rect.height);
    const groupMeshes = new Set<Mesh>();
    for (const root of this.battleGroupRoots.values()) {
      for (const mesh of root.getChildMeshes()) groupMeshes.add(mesh as Mesh);
    }
    const pick = this.scene.pick(canvasX, canvasY, (mesh) => groupMeshes.has(mesh as Mesh));
    if (!pick?.hit || !pick.pickedMesh) return false;
    const battleGroupId = (pick.pickedMesh.metadata as { battleGroupId?: string } | null)?.battleGroupId;
    if (!battleGroupId) return false;
    const view = this.getVisibleBattleGroupViews().find((candidate) => candidate.id === battleGroupId);
    if (!view) return false;
    this.selectBattleGroup(view, ev.shiftKey);
    return true;
  }

  private trySelectFleetMarkerAtPointer(ev: PointerEvent): boolean {
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas || this.fleetRoots.size === 0) return false;
    const rect = canvas.getBoundingClientRect();
    const canvasX = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (ev.clientY - rect.top) * (canvas.height / rect.height);
    const fleetMeshes = new Set<Mesh>();
    for (const root of this.fleetRoots.values()) {
      for (const mesh of root.getChildMeshes()) fleetMeshes.add(mesh as Mesh);
    }
    const pick = this.scene.pick(canvasX, canvasY, (mesh) => fleetMeshes.has(mesh as Mesh));
    if (!pick?.hit || !pick.pickedMesh) return false;
    const fleetId = (pick.pickedMesh.metadata as { fleetId?: string } | null)?.fleetId;
    if (!fleetId) return false;
    const fleet = this.serverFleets.find((candidate) => candidate.id === fleetId);
    if (!fleet) return false;
    this.selectFleetFromCard(fleet, ev.shiftKey);
    this.refreshFleetMarkers();
    return true;
  }

  private trySelectShipVisualAtPointer(ev: PointerEvent): boolean {
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas || this.battleShipRoots.size === 0) return false;
    const rect = canvas.getBoundingClientRect();
    const canvasX = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (ev.clientY - rect.top) * (canvas.height / rect.height);
    const shipMeshes = new Set<Mesh>();
    for (const root of this.battleShipRoots.values()) {
      for (const mesh of root.getChildMeshes()) shipMeshes.add(mesh as Mesh);
    }
    const pick = this.scene.pick(canvasX, canvasY, (mesh) => shipMeshes.has(mesh as Mesh));
    if (!pick?.hit || !pick.pickedMesh) return false;
    const metadata = pick.pickedMesh.metadata as { fleetId?: string | null; battleGroupId?: string | null } | null;
    if (metadata?.battleGroupId) {
      const view = this.getVisibleBattleGroupViews().find((candidate) => candidate.id === metadata.battleGroupId);
      if (view) {
        this.selectBattleGroup(view, ev.shiftKey);
        return true;
      }
    }
    if (metadata?.fleetId) {
      const fleet = this.serverFleets.find((candidate) => candidate.id === metadata.fleetId);
      if (fleet) {
        this.selectFleetFromCard(fleet, ev.shiftKey);
        this.refreshFleetMarkers();
        return true;
      }
    }
    return false;
  }

  private selectBattleGroup(view: TacticalBattleGroupView, shiftKey: boolean): void {
    if (!shiftKey) {
      this.selectedFleetIds.clear();
      this.selectedFleetId = null;
      this.selectionPanel.clear();
    }
    this.selectedBattleGroupId = view.id;
    this.selectionPanel.select(this.createBattleGroupSelectionData(view), shiftKey);
    this.refreshBattleGroupMarkers();
  }

  private createBattleGroupSelectionData(view: TacticalBattleGroupView): SelectionData {
    const owner = this.getFaction(view.ownerId);
    const hull = Math.max(0, view.hpRatio);
    return {
      type: "battleGroup",
      id: view.id,
      name: view.name,
      hp: hull,
      maxHp: 1,
      hull,
      maxHull: 1,
      class: `${view.behavior} | ${view.count} ships`,
      status: view.status,
      detail: `Fleet: ${view.fleetId ?? "fixed"} | Order: ${view.order} | Chase: ${view.chaseSetting} | ${view.retreatText}`,
      ownerName: owner?.name ?? "Unknown",
      ownerColor: owner?.color,
      canCommand: !!view.fleetId && view.ownerId === this.playerFactionId,
      actions: ["move", "attack", "hold", "protect", "retreat"],
    };
  }

  private refreshSelectedBattleGroupSelection(): void {
    if (!this.selectionPanel) return;
    if (!this.selectedBattleGroupId) return;
    const view = this.getVisibleBattleGroupViews().find((candidate) => candidate.id === this.selectedBattleGroupId);
    if (!view) {
      this.selectedBattleGroupId = null;
      this.selectionPanel.clear();
      this.clearFleetAction();
      return;
    }
    this.selectionPanel.select(this.createBattleGroupSelectionData(view), false);
    this.refreshBattleGroupMarkers();
  }

  private tryOpenObjectPanelAtPointer(ev: PointerEvent): boolean {
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const canvasX = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (ev.clientY - rect.top) * (canvas.height / rect.height);
    const ray = this.scene.createPickingRay(canvasX, canvasY, Matrix.Identity(), this.camera);

    for (let i = 0; i < this.planetLabelMeshes.length; i++) {
      const labelMesh = this.planetLabelMeshes[i];
      const planet = this.planetConfigs[i];
      if (!labelMesh || !planet || !labelMesh.isEnabled() || !this.hitLabelPlane(ray, labelMesh)) continue;
      this.clearFleetSelection();
      void this.showPlanetObjectPanel(planet);
      return true;
    }

    if (this.starLabelMesh && this.starLabelMesh.isEnabled() && this.hitLabelPlane(ray, this.starLabelMesh)) {
      this.clearFleetSelection();
      this.showStarObjectPanel();
      return true;
    }

    return false;
  }

  private hitLabelPlane(ray: Ray, labelMesh: Mesh): boolean {
    const normal = labelMesh.getDirection(Vector3.Forward());
    const denominator = Vector3.Dot(ray.direction, normal);
    if (Math.abs(denominator) < 0.0001) return false;

    const t = Vector3.Dot(labelMesh.position.subtract(ray.origin), normal) / denominator;
    if (t < 0) return false;

    const hitPoint = ray.origin.add(ray.direction.scale(t));
    const inverseWorld = labelMesh.getWorldMatrix().clone().invert();
    const local = Vector3.TransformCoordinates(hitPoint, inverseWorld);
    const width = labelMesh.getBoundingInfo().boundingBox.extendSize.x * 2;
    const height = labelMesh.getBoundingInfo().boundingBox.extendSize.y * 2;
    return Math.abs(local.x) <= width / 2 && Math.abs(local.y) <= height / 2;
  }

  private async showPlanetObjectPanel(planet: PlanetConfig): Promise<void> {
    let panelPlanet = planet;
    let planetState = this.getPlanetState(planet.id);
    if (this.options.onRequestPlanetDetails) {
      try {
        const details = await this.options.onRequestPlanetDetails(planet.id);
        panelPlanet = details.planet;
        planetState = details.planetState;
      } catch (error) {
        console.error("Failed to load planet details", error);
      }
    }
    this.objectPanel.show({
      kind: "planet",
      objectId: panelPlanet.id,
      name: panelPlanet.name,
      subtitle: `${this.star.name} System`,
      isHabited: panelPlanet.isHabited === true,
      objectDetails: panelPlanet.objectDetails,
      planetState,
      imageUrl: this.getPlanetTextureUrl(panelPlanet),
      accentColor: "rgba(102, 236, 199, 0.95)",
      orbitFleetId: this.getOrbitCapableFleetId(),
      onPlanetCommand: (command) => this.options.onPlanetCommand?.(command),
    });
  }

  private getOrbitCapableFleetId(): string | null {
    const primarySelectedFleetId = this.getPrimarySelectedFleetId();
    const selected = primarySelectedFleetId
      ? this.serverFleets.find((fleet) => fleet.id === primarySelectedFleetId)
      : null;
    if (selected && selected.ownerId === this.playerFactionId && selected.currentStarId === this.star.id && (selected.phase === "idle" || selected.phase === "orbitingPlanet" || selected.phase === "orbiting")) {
      return selected.id;
    }
    return this.serverFleets.find((fleet) => (
      fleet.ownerId === this.playerFactionId
      && fleet.currentStarId === this.star.id
      && (fleet.phase === "idle" || fleet.phase === "orbitingPlanet" || fleet.phase === "orbiting")
    ))?.id ?? null;
  }

  private showStarObjectPanel(): void {
    const [r, g, b] = this.star.color.map((channel) => Math.round(channel * 255));
    this.objectPanel.show({
      kind: "star",
      objectId: `star-${this.star.id}`,
      name: this.star.name,
      subtitle: "Stellar Object",
      isHabited: false,
      objectDetails: this.star.objectDetails,
      imageUrl: this.getStarBannerTextureUrl(),
      accentColor: `rgba(${r}, ${g}, ${b}, 0.95)`,
    });
  }

  private getPlanetState(planetId: string): PlanetState | undefined {
    return this.planetStates.find((planetState) => planetState.id === planetId);
  }

  private getPlanetTextureUrl(planet: PlanetConfig): string {
    const cfg = PLANET_TYPES[planet.type];
    const variation = String(planet.textureVariation + 1).padStart(2, "0");
    return `${cfg.texturePrefix}_${variation}-1024x512.png`;
  }

  private getStarBannerTextureUrl(): string {
    return STAR_BANNER_TEXTURES[this.star.type] ?? "/textures/star_surface.png";
  }

  private createFallbackPlanets(kind: StarVisualKind): PlanetConfig[] {
    const createFallbackPlanet = (
      index: number,
      planet: Omit<PlanetConfig, "objectDetails" | "orbitPhaseAtEpoch" | "orbitEpochMs">,
    ): PlanetConfig => withPlanetObjectDetails(
      withPlanetOrbitFields(planet, this.star.id, index),
      `${this.star.id}:fallback:${index}`,
    );

    if (kind === "black-hole") {
      return [
        createFallbackPlanet(0, { id: createPlanetId(this.star.id, 0), type: PlanetType.Barren, textureVariation: 0, diameter: 1.2, orbitRadius: 12, orbitSpeed: 0.32, name: `${this.star.name} I` }),
        createFallbackPlanet(1, { id: createPlanetId(this.star.id, 1), type: PlanetType.Methane, textureVariation: 0, diameter: 2.8, orbitRadius: 20, orbitSpeed: 0.2, name: `${this.star.name} II` }),
      ];
    }
    if (kind === "neutron-star" || kind === "pulsar") {
      return [
        createFallbackPlanet(0, { id: createPlanetId(this.star.id, 0), type: PlanetType.Barren, textureVariation: 0, diameter: 1.0, orbitRadius: 9, orbitSpeed: 0.62, name: `${this.star.name} I` }),
        createFallbackPlanet(1, { id: createPlanetId(this.star.id, 1), type: PlanetType.Snowy, textureVariation: 0, diameter: 1.1, orbitRadius: 15, orbitSpeed: 0.46, name: `${this.star.name} II` }),
      ];
    }
    return [
      createFallbackPlanet(0, { id: createPlanetId(this.star.id, 0), type: PlanetType.Barren, textureVariation: 0, diameter: 1.4, orbitRadius: 7, orbitSpeed: 0.55, name: `${this.star.name} I` }),
      createFallbackPlanet(1, { id: createPlanetId(this.star.id, 1), type: PlanetType.Gaseous, textureVariation: 0, diameter: 3.2, orbitRadius: 12, orbitSpeed: 0.24, name: `${this.star.name} II` }),
      createFallbackPlanet(2, { id: createPlanetId(this.star.id, 2), type: PlanetType.Snowy, textureVariation: 0, diameter: 1.1, orbitRadius: 18, orbitSpeed: 0.4, name: `${this.star.name} III` }),
    ];
  }

  private requestExit(): void {
    if (this.isExiting) return;
    this.isExiting = true;
    Promise.resolve(this.onExitSystem())
      .catch((err) => console.error("Failed to exit system view", err))
      .finally(() => {
        this.isExiting = false;
      });
  }

  getStar(): StarData {
    return this.star;
  }

  setStarsVisible(visible: boolean): void {
    this.starsVisible = visible;
    if (this.starMesh) {
      this.starMesh.setEnabled(visible);
    }
    if (this.playerShipRoot) {
      const hasTacticalFleetVisuals = this.battleShipRoots.size > 0 || this.fleetRoots.size > 0 || this.battleGroupRoots.size > 0;
      this.playerShipRoot.setEnabled(visible && !hasTacticalFleetVisuals);
    }
    for (const marker of this.hyperlaneExitMeshes) {
      marker.setEnabled(visible);
    }
    for (const [, root] of this.battleShipRoots) {
      root.setEnabled(visible);
    }
    for (const [, root] of this.battleGroupRoots) {
      root.setEnabled(visible);
    }
    for (const [, root] of this.fleetRoots) {
      root.setEnabled(visible);
    }
    this.refreshStarbaseCombatRangeRing();
  }

  setBloomEnabled(enabled: boolean): void {
    this.bloomEnabled = enabled;
    if (this.glowLayer) {
      this.glowLayer.intensity = enabled ? this.glowLayer.intensity : 0;
    }
  }

  setFleetSystemPositions(
    positions: Record<string, { x: number; y: number; z: number }>,
    options: { refreshCards?: boolean } = {},
  ): void {
    const refreshCards = options.refreshCards ?? true;
    this.fleetSystemPositions = positions;
    this.playerShipRoot?.setEnabled(false);
    this.refreshBattleShips();
    if (refreshCards) this.refreshSystemEntityCards();
  }

  setServerFleets(fleets: ServerFleet[]): void {
    this.serverFleets = fleets;
    let selectionChanged = false;
    for (const fleetId of Array.from(this.selectedFleetIds)) {
      if (!fleets.some((fleet) => fleet.id === fleetId)) {
        this.selectedFleetIds.delete(fleetId);
        selectionChanged = true;
      }
    }
    if (this.selectedFleetId && !this.selectedFleetIds.has(this.selectedFleetId)) {
      this.selectedFleetId = this.getPrimarySelectedFleetId();
      selectionChanged = true;
    }
    if (selectionChanged) {
      this.notifyFleetSelectionChanged();
      this.renderSelectedFleetPanels();
    } else if (this.selectedFleetIds.size > 0) {
      this.renderSelectedFleetPanels();
    }
    this.refreshBattleShips();
    this.refreshSelectedBattleGroupSelection();
    this.refreshSystemEntityCards();
  }

  setClockYear(year: number): void {
    this.clockYear = year;
  }

  setServerShips(ships: ServerShip[]): void {
    this.serverShips = ships;
    this.refreshBattleShips();
    this.refreshSelectedBattleGroupSelection();
    this.refreshSystemEntityCards();
  }

  setShipDesigns(shipDesigns: ShipDesign[]): void {
    this.shipDesigns = shipDesigns;
    this.refreshBattleShips();
    this.refreshSelectedBattleGroupSelection();
    this.refreshSystemEntityCards();
  }

  setBattles(battles: ServerBattle[]): void {
    this.battles = battles;
    this.refreshBattleShips();
    this.refreshSelectedBattleGroupSelection();
    this.refreshSystemEntityCards();
  }

  setRecentCombatContacts(contacts: ServerCombatContact[]): void {
    this.recentCombatContacts = contacts;
    this.queueRecentCombatContactEffects();
  }

  setStarbaseSystemIds(starIds: Iterable<number>): void {
    this.starbaseSystemIds = new Set(starIds);
    if (this.starbaseSystemIds.has(this.star.id)) {
      if (this.starbaseRoot) {
        this.starbaseRoot.setEnabled(true);
        this.refreshStarbaseCombatRangeRing();
        this.refreshSystemEntityCards();
        return;
      }
      void this.createStarbaseIfPresent().then(() => {
        this.refreshStarbaseCombatRangeRing();
        this.refreshSystemEntityCards();
      });
      return;
    }

    this.starbaseRoot?.setEnabled(false);
    this.disposeStarbaseCombatRangeRing();
    this.refreshSystemEntityCards();
  }

  setServerStarbases(starbases: ServerStarbase[]): void {
    this.starbases = starbases;
    for (const starbase of starbases) {
      this.starbasePanel?.refreshStarbase(starbase);
    }
    this.refreshStarbaseCombatRangeRing();
    this.refreshSystemEntityCards();
  }

  setPlanetStates(planetStates: PlanetState[]): void {
    this.planetStates = planetStates;
    const previousHabited = this.planetConfigs.map((planet) => planet.isHabited === true);
    applyPlanetStatesToStars([this.star], planetStates);
    this.planetConfigs = this.star.system.planets.length > 0
      ? this.star.system.planets
      : this.planetConfigs;

    for (let i = 0; i < this.planetConfigs.length; i++) {
      if (previousHabited[i] === (this.planetConfigs[i].isHabited === true)) continue;
      const oldLabel = this.planetLabelMeshes[i];
      if (oldLabel) {
        const material = oldLabel.material as StandardMaterial | null;
        material?.diffuseTexture?.dispose();
        material?.dispose();
        oldLabel.dispose();
      }
      this.planetLabelMeshes[i] = this.createPlanetLabel(
        i,
        this.planetConfigs[i],
        this.planetConfigs[i].orbitRadius,
      );
    }
    for (const planetState of planetStates) {
      if (planetState.starId !== this.star.id) continue;
      const planet = this.star.system.planets[planetState.planetIndex];
      if (planet) {
        this.objectPanel?.refreshPlanetState(planet.id, planetState, planet.objectDetails, planet.isHabited === true);
      }
    }
  }

  refreshPlanetDetails(planet: PlanetConfig, planetState: PlanetState): void {
    const nextPlanetStates = this.planetStates.filter((candidate) => candidate.id !== planetState.id);
    nextPlanetStates.push(planetState);
    this.planetStates = nextPlanetStates;
    this.star.system.planets[planetState.planetIndex] = planet;
    this.planetConfigs = this.star.system.planets;
    this.objectPanel?.refreshPlanetState(
      planet.id,
      planetState,
      planet.objectDetails,
      planet.isHabited === true,
    );
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onEscapeKey);
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
      this.pointerObserver = null;
    }
    this.objectPanel?.dispose();
    this.selectionPanel?.clear();
    this.starbasePanel?.dispose();
    for (const [, root] of this.battleShipRoots) {
      root.dispose();
    }
    this.battleShipRoots.clear();
    for (const [, root] of this.battleGroupRoots) {
      root.dispose();
    }
    this.battleGroupRoots.clear();
    for (const [, root] of this.fleetRoots) {
      root.dispose();
    }
    this.fleetRoots.clear();
    this.fleetTargets.clear();
    for (const [, material] of this.fleetMaterials) {
      material.dispose();
    }
    this.fleetMaterials.clear();
    for (const [, material] of this.battleGroupMaterials) {
      material.dispose();
    }
    this.battleGroupMaterials.clear();
    this.battleGroupTargets.clear();
    this.disposeStarbaseCombatRangeRing();
    for (const beam of this.battleBeams) {
      beam.mesh.dispose();
    }
    this.battleBeams = [];
    for (const projectile of this.battleProjectiles) {
      projectile.mesh.dispose();
      projectile.material.dispose();
    }
    this.battleProjectiles = [];
    this.disposePlayerShipTrail();
    this.disposeSelectedFleetRouteLine();
    this.disposeSelectedBattleGroupOrderLine();
    this.disposeSystemActionTargetMarkers();
    this.systemActionMarkerMaterial?.dispose();
    this.systemActionMarkerMaterial = null;
    this.battleShipTemplate?.dispose();
    this.battleShipTemplate = null;
    this.entityCardLayer?.remove();
    this.entityCardLayer = null;
    this.orbitSystem.dispose();
    this.camera?.detachControl();
    this.scene.dispose();
  }
}
