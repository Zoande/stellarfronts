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
  PBRMaterial,
  MultiMaterial,
  Texture,
  GlowLayer,
  TransformNode,
  Material,
  Mesh,
  Ray,
  Matrix,
  PointerEventTypes,
} from "@babylonjs/core";
import type { AbstractEngine, AbstractMesh, LinesMesh, Observer, PointerInfo } from "@babylonjs/core";
import type { IGameScene } from "../SceneManager";
import { SHIP_MODEL_DEFINITIONS, STARBASE_MODEL_DEFINITIONS } from "../data/Starbase";
import type { StarbaseLevel, StarbaseShipKind } from "../data/Starbase";
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
import type { NebulaRegion } from "../data/Nebula";
import {
  getHyperlaneExitSystemPosition,
  getPlanetSystemOrbitRadius,
  getPlanetSystemPosition,
  getPlanetVisualDiameter,
  getSystemOrbitLayout,
  getSystemStarOrbitPosition,
  getSystemStarbasePosition,
  getSystemStarbaseOrbitPosition,
  normalizeSystemStarbasePosition,
  SYSTEM_FLEET_Y,
  SYSTEM_HYPERLANE_EXIT_MARKER_Y,
  withPlanetOrbitFields,
} from "../data/SystemCoordinates";
import type { SystemPosition } from "../data/SystemCoordinates";
import type { PlanetState } from "../data/Economy";
import type { LeaderState } from "../data/Leaders";
import type { FactionInfo } from "../data/Factions";
import { STARBASE_LEVEL_DEFINITIONS } from "../data/Starbase";
import { SHIP_HULL_DEFINITIONS } from "../data/ShipDesigns";
import type { ShipDesign } from "../data/ShipDesigns";
import { OrbitSystem } from "../systems/OrbitSystem";
import type { GalaxyShipTransit, HyperlaneExitPoint, ShipAction } from "../game/GameplayTypes";
import type {
  ClientCommand,
  DiplomacyMovementPayload,
  FleetMovementSegment,
  FleetOrbitTarget,
  ServerCombatContact,
  ServerCombatProjectile,
  ServerFleet,
  ServerShip,
  ServerStarbase,
  ServerStarbaseSummary,
  SystemDetailPayload,
} from "../game/GameProtocol";
import type { FactionTechnologyView } from "../data/Technology";
import { GAME_DAYS_PER_YEAR, REAL_MS_PER_GAME_DAY } from "../game/GameTime";
import { getFleetTacticalRadius, getLayeredFleetFormationPosition } from "../game/tacticalFormation";
import { CelestialObjectPanel } from "../ui/CelestialObjectPanel";
import { SelectionPanel } from "../ui/SelectionPanel";
import type { FleetPolicyControl, FleetPolicyValue, SelectionData, SelectionShipData } from "../ui/SelectionPanel";
import { StarbasePanel } from "../ui/StarbasePanel";
import { computeFleetPower, computeStarbasePower } from "../game/combatPower";
import type { FleetDoctrine, FleetEngagementRule, FleetRetreatPreset } from "../game/CombatTypes";
import { getClientIntelField } from "../game/ClientIntelligence";
import { SystemAssetRegistry } from "./system/SystemAssetRegistry";
import type { SystemAssetDefinition } from "./system/SystemAssetRegistry";
import { SystemLabelOverlay } from "./system/SystemLabelOverlay";
import type { SystemLabelOverlayItem } from "./system/SystemLabelOverlay";
import { SystemObjectRenderer } from "./system/SystemObjectRenderer";
import type { SystemRenderableDefinition } from "./system/SystemObjectRenderer";
import { SystemEffectsRenderer } from "./system/SystemEffectsRenderer";
import { createSystemNebulaEnvironment } from "./system/SystemNebulaEnvironment";
import type { SystemNebulaEnvironment } from "./system/SystemNebulaEnvironment";
import { SystemInputController } from "./system/SystemInputController";
import { SystemActionTargetRenderer } from "./system/SystemActionTargetRenderer";
import type { SystemActionTarget } from "./system/SystemActionTargetRenderer";
import { SystemViewStore } from "./system/SystemViewStore";
import { ContextActionMenu } from "./shared/ContextActionMenu";
import type { ContextMenuItem } from "./shared/ContextActionMenu";
import type { PointerTarget } from "./shared/PointerTarget";
import { createProceduralSpaceSkybox, getSystemSkyboxSettings } from "../utils/proceduralSpaceSkybox";

type ExitSystemHandler = () => void | Promise<void>;

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
  systemPayload?: SystemDetailPayload;
  /** The nebula covering this system, if any (themes the skybox + gates buildings). */
  nebula?: NebulaRegion | null;
  playerShipStarId?: number;
  playerShipSystemIds?: number[];
  fleetSystemPositions?: Record<string, { x: number; y: number; z: number }>;
  serverFleets?: ServerFleet[];
  serverShips?: ServerShip[];
  shipDesigns?: ShipDesign[];
  recentCombatContacts?: ServerCombatContact[];
  combatProjectiles?: ServerCombatProjectile[];
  starbaseSystemIds?: number[];
  starbases?: ServerStarbaseSummary[];
  factions?: FactionInfo[];
  starOwnership?: number[];
  diplomacy?: DiplomacyMovementPayload;
  playerFactionId?: number;
  planetStates?: PlanetState[];
  leaders?: LeaderState[];
  technology?: FactionTechnologyView | null;
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
  onReleasePlanetDetails?: (planetId: string) => void;
  onRequestStarbaseDetails?: (starbaseId: string) => Promise<ServerStarbase | null>;
  onReleaseStarbaseDetails?: (starbaseId: string) => void;
}

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
const TACTICAL_SHIP_TRAIL_SAMPLE_INTERVAL = 0.055;
const TACTICAL_SHIP_TRAIL_TTL = 1.45;
const TACTICAL_SHIP_TRAIL_MIN_DISTANCE = 0.025;
const TACTICAL_SHIP_TRAIL_MAX_SEGMENT_DISTANCE = 3.2;
const TACTICAL_SHIP_TRAIL_RADIUS = 0.026;
const TACTICAL_SHIP_TRAIL_START_ALPHA = 0.58;
const TACTICAL_SHIP_TRAIL_MAX_SEGMENTS_PER_SHIP = 32;
const SYSTEM_SHIP_DIRECT_FOLLOW_SNAP_DISTANCE = 9;
const FLEET_VISUAL_STACK_KEY_SIZE = 0.18;
const FLEET_VISUAL_SEPARATION_DISTANCE = 1.05;
const SELECTED_FLEET_ROUTE_LINE_Y_OFFSET = 0.08;
const SYSTEM_ACTION_MARKER_COLOR = new Color3(0.18, 1.0, 0.9);
const SYSTEM_ACTION_MARKER_PULSE_SPEED = 4.2;
const SYSTEM_ACTION_MARKER_ROTATION_SPEED = 0.42;
const SYSTEM_ACTION_MARKER_MAX_EMPTY_MOVE_RADIUS = 72;

const SHIP_EXIT_END_PROGRESS = 0.28;
const SHIP_ENTRY_START_PROGRESS = 0.72;
const STAR_BANNER_DIR = "/textures/planet-banners";

const TACTICAL_SHIP_TARGET_SIZE = 0.65;
const TACTICAL_RING_SEGMENTS = 144;

const STAR_BANNER_TEXTURES: Record<StarType, string> = {
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

export class SystemScene implements IGameScene {
  public scene: Scene;
  private engine: AbstractEngine;
  private star: StarData;
  private playerShipStarId: number;
  private playerShipSystemIds: Set<number>;
  private fleetSystemPositions: Record<string, { x: number; y: number; z: number }>;
  private serverFleets: ServerFleet[];
  private serverShips: ServerShip[];
  private shipDesigns: ShipDesign[];
  private recentCombatContacts: ServerCombatContact[];
  private combatProjectiles: ServerCombatProjectile[];
  private starbaseSystemIds: Set<number>;
  private starbases: ServerStarbaseSummary[];
  private factions: FactionInfo[];
  private starOwnership: number[];
  private openBorderFactionIds = new Set<number>();
  private warFactionIds = new Set<number>();
  private playerFactionId: number;
  private planetStates: PlanetState[];
  private leaders: LeaderState[];
  private shipTransit: GalaxyShipTransit | null;
  private clockYear: number;
  private hyperlaneExits: HyperlaneExitPoint[];
  private systemStore: SystemViewStore | null = null;
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
  private playerShipTrailAttachmentPoint: TransformNode | null = null;
  private playerShipKind: StarbaseShipKind = "corvette";
  private playerShipFleetId: string | null = null;
  private playerShipBasePosition = PLAYER_SHIP_BASE_POSITION.clone();
  private playerShipTargetPosition = PLAYER_SHIP_BASE_POSITION.clone();
  private playerShipTrailTimer = 0;
  private playerShipLastTrailPosition: Vector3 | null = null;
  private playerShipLastTrailAttachmentPosition: Vector3 | null = null;
  private selectedFleetRouteLine: LinesMesh | null = null;

  private assetRegistry!: SystemAssetRegistry;
  private objectRenderer!: SystemObjectRenderer;
  private shipVisualRoots = new Map<string, TransformNode>();
  private shipVisualTargets = new Map<string, Vector3>();
  private shipVisualTrailTimers = new Map<string, number>();
  private shipVisualLastTrailPositions = new Map<string, Vector3>();
  private shipVisualRefreshVersion = 0;
  private fleetPickMaterial: StandardMaterial | null = null;
  private effectsRenderer: SystemEffectsRenderer | null = null;
  private nebulaEnvironment: SystemNebulaEnvironment | null = null;
  private combatContactSeen = new Set<string>();

  private starbaseRoot: TransformNode | null = null;
  private starbaseVisualLevel: StarbaseLevel | null = null;
  private starbaseLight: PointLight | null = null;
  private starbaseRangeRing: LinesMesh | null = null;
  private starbaseRangeSignature: string | null = null;
  private hyperlaneExitMaterial: StandardMaterial | null = null;

  private orbitSystem = new OrbitSystem();
  private orbitRings: LinesMesh[] = [];
  private planetMeshes: Mesh[] = [];
  private planetConfigs: PlanetConfig[] = [];
  private planetDiameters: number[] = [];
  private labelOverlay: SystemLabelOverlay | null = null;
  private objectPanel!: CelestialObjectPanel;
  private planetPanelRequestSequence = 0;
  private selectionPanel!: SelectionPanel;
  private starbasePanel!: StarbasePanel;
  private inputController: SystemInputController | null = null;
  private selectedFleetId: string | null = null;
  private selectedFleetIds = new Set<string>();
  private activeFleetAction: ShipAction | null = null;
  private actionTargetRenderer: SystemActionTargetRenderer | null = null;
  private readonly contextMenu = new ContextActionMenu();
  private pointerObserver: Observer<PointerInfo> | null = null;
  private starOccluded = false;
  private renderDebugEnabled = false;
  private renderDebugOverlay: HTMLDivElement | null = null;
  private renderDebugState: { starOccluded: boolean; starOccluderName: string | null } = {
    starOccluded: false,
    starOccluderName: null,
  };
  private isExiting = false;
  private elapsed = 0;
  private starsVisible = true;
  private bloomEnabled = true;
  private labelsVisible = true;
  private rangesVisible = true;
  private footprintsVisible = false;

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
  private detailTexturePath = "/textures/star_surface.webp";

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
    if (this.contextMenu.isOpen) {
      this.contextMenu.close();
      return;
    }
    this.requestExit();
  };

  private readonly onCanvasContextMenu = (ev: MouseEvent): void => {
    ev.preventDefault();
  };

  constructor(
    engine: AbstractEngine,
    star: StarData,
    onExitSystem: ExitSystemHandler,
    options: SystemSceneOptions = {},
  ) {
    this.engine = engine;
    const initialClockYear = options.clockYear ?? 2100;
    if (options.systemPayload) {
      this.systemStore = new SystemViewStore(
        { ...options.systemPayload, leaders: options.leaders ?? [] },
        initialClockYear,
      );
    }
    this.star = this.systemStore?.getStar() ?? star;
    this.playerShipStarId = options.playerShipStarId ?? -1;
    this.playerShipSystemIds = new Set(
      options.playerShipSystemIds
        ?? (this.playerShipStarId >= 0 ? [this.playerShipStarId] : []),
    );
    this.fleetSystemPositions = this.systemStore?.getFleetSystemPositions(initialClockYear) ?? options.fleetSystemPositions ?? {};
    this.serverFleets = this.systemStore?.getFleets() ?? options.serverFleets ?? [];
    this.serverShips = this.systemStore?.getShips() ?? options.serverShips ?? [];
    this.shipDesigns = this.systemStore?.getShipDesigns() ?? options.shipDesigns ?? [];
    this.recentCombatContacts = this.systemStore?.getRecentCombatContacts() ?? options.recentCombatContacts ?? [];
    this.combatProjectiles = this.systemStore?.getCombatProjectiles() ?? options.combatProjectiles ?? [];
    this.starbases = this.systemStore?.getStarbases() ?? options.starbases ?? [];
    this.starbaseSystemIds = new Set(
      this.systemStore
        ? this.starbases.map((starbase) => starbase.starId)
        : (options.starbaseSystemIds ?? []),
    );
    this.factions = this.systemStore?.getFactions() ?? options.factions ?? [];
    this.starOwnership = options.starOwnership ? [...options.starOwnership] : [];
    const initialStarOwnerId = this.systemStore?.getStarOwnerId();
    if (initialStarOwnerId !== undefined) {
      this.starOwnership[this.star.id] = initialStarOwnerId ?? -1;
    }
    this.playerFactionId = options.playerFactionId ?? 0;
    this.applyDiplomacyMovement(options.diplomacy);
    this.planetStates = this.systemStore?.getPlanetStates() ?? options.planetStates ?? [];
    this.leaders = this.systemStore?.getLeaders() ?? options.leaders ?? [];
    applyPlanetStatesToStars([this.star], this.planetStates);
    this.shipTransit = options.shipTransit ?? null;
    this.clockYear = initialClockYear;
    this.hyperlaneExits = this.systemStore?.getHyperlaneExits() ?? options.hyperlaneExits ?? [];
    this.selectedFleetId = options.selectedFleetId ?? null;
    this.selectedFleetIds = new Set(options.selectedFleetIds ?? (this.selectedFleetId ? [this.selectedFleetId] : []));
    this.onExitSystem = onExitSystem;
    this.options = options;
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.01, 0.015, 0.03, 1);
    this.assetRegistry = new SystemAssetRegistry(this.scene);
    this.objectRenderer = new SystemObjectRenderer(this.scene);
    this.configureSystemObjectRenderer();
  }

  private configureSystemObjectRenderer(): void {
    this.objectRenderer.registerFactory("fleet-pick-volume", ({ definition, root }) => {
      const diameter = Math.max(3.2, (definition.pickRadius ?? 1.6) * 2);
      const pickMesh = MeshBuilder.CreateSphere(
        `fleetPickVolume-${definition.id}`,
        { diameter, segments: 12 },
        this.scene,
      );
      pickMesh.parent = root;
      pickMesh.position.set(0, 0, 0);
      pickMesh.material = this.getFleetPickMaterial();
      pickMesh.isPickable = true;
      pickMesh.alwaysSelectAsActiveMesh = true;
      return [pickMesh];
    });
    this.objectRenderer.registerFactory("hyperlane-exit", ({ definition, root }) => {
      const marker = MeshBuilder.CreateTorus(
        `hyperlaneExit_${definition.id}`,
        { diameter: 2.4, thickness: 0.08, tessellation: 36 },
        this.scene,
      );
      marker.parent = root;
      marker.rotation.x = Math.PI / 2;
      marker.material = this.getHyperlaneExitMaterial();
      marker.isPickable = false;
      marker.alwaysSelectAsActiveMesh = true;
      return [marker];
    });
  }

  private getFleetRenderableId(fleetId: string): string {
    return `fleet:${fleetId}`;
  }

  private getHyperlaneRenderableId(connectedStarId: number): string {
    return `hyperlane:${this.star.id}:${connectedStarId}`;
  }

  private hasPlayerShipPresence(): boolean {
    if (this.serverFleets.some((fleet) => fleet.currentStarId === this.star.id && fleet.ownerId === this.playerFactionId)) return true;
    if (this.playerShipSystemIds.has(this.star.id)) return true;
    if (this.playerShipStarId === this.star.id) return true;
    return !!this.shipTransit
      && (this.shipTransit.fromStarId === this.star.id || this.shipTransit.toStarId === this.star.id);
  }

  private getPlayerShipFleetCandidate(): ServerFleet | null {
    const fleetsInSystem = this.serverFleets.filter((fleet) => (
      fleet.currentStarId === this.star.id && fleet.ownerId === this.playerFactionId
    ));
    if (fleetsInSystem.length === 0) return null;

    const selectedFleetId = this.getPrimarySelectedFleetId();
    if (selectedFleetId) {
      const selectedFleet = fleetsInSystem.find((fleet) => fleet.id === selectedFleetId);
      if (selectedFleet) return selectedFleet;
    }

    const constructionFleet = fleetsInSystem.find((fleet) => (
      this.getShipsForFleet(fleet.id).some((ship) => ship.shipKind === "constructionShip")
    ));
    return constructionFleet ?? fleetsInSystem[0];
  }

  private getPreferredShipForFleet(fleet: ServerFleet): ServerShip | null {
    const ships = this.getShipsForFleet(fleet.id);
    return ships.find((ship) => ship.shipKind === "constructionShip") ?? ships[0] ?? null;
  }

  private disposePlayerShipVisuals(): void {
    this.disposePlayerShipTrail();
    this.playerShipRoot?.dispose();
    this.playerShipRoot = null;
    this.playerShipFleetId = null;
    this.playerShipLight?.dispose();
    this.playerShipLight = null;
    this.playerShipTrailAttachmentPoint = null;
  }

  private async refreshPlayerShipFromSelection(): Promise<void> {
    if (!this.hasPlayerShipPresence()) return;
    const fleet = this.getPlayerShipFleetCandidate();
    if (!fleet) return;
    const ship = this.getPreferredShipForFleet(fleet);
    if (!ship) return;

    if (!this.playerShipRoot) {
      await this.createPlayerShipIfPresent();
      return;
    }

    if (ship.shipKind !== this.playerShipKind) {
      this.disposePlayerShipVisuals();
      await this.createPlayerShipIfPresent();
      return;
    }

    if (fleet.id !== this.playerShipFleetId) {
      this.playerShipFleetId = fleet.id;
    }
    const position = this.getFleetRenderPosition(fleet);
    this.playerShipTargetPosition.set(position.x, position.y, position.z);
  }

  private hasStarbasePresence(): boolean {
    return this.starbaseSystemIds.has(this.star.id);
  }

  private getCurrentStarbaseVisualLevel(): StarbaseLevel {
    return this.getStarbasesInCurrentSystem()[0]?.level ?? "outpost";
  }

  private getShipAssetDefinition(
    shipKind: StarbaseShipKind,
    keyPrefix: string,
    targetSize: number,
  ): SystemAssetDefinition {
    const modelDef = SHIP_MODEL_DEFINITIONS[shipKind];
    return {
      key: `${keyPrefix}:${shipKind}`,
      rootUrl: modelDef.modelPath,
      fileName: modelDef.modelFile,
      targetSize,
      scaleMultiplier: modelDef.scaleMultiplier ?? 1,
      trailSocketName: modelDef.trailSocketName,
      configureMesh: (mesh) => {
        this.applyBasicShipMaterialStyle(mesh.material);
      },
    };
  }

  private getStarbaseAssetDefinition(level = this.getCurrentStarbaseVisualLevel()): SystemAssetDefinition {
    const modelDef = STARBASE_MODEL_DEFINITIONS[level] ?? STARBASE_MODEL_DEFINITIONS.outpost;
    return {
      key: `starbase:${modelDef.level}`,
      rootUrl: modelDef.modelPath,
      fileName: modelDef.modelFile,
      targetSize: modelDef.targetSize,
      configureMesh: (mesh) => {
        this.trimStarbaseVertexData(mesh);
        this.applyStarbaseMaterialStyle(mesh.material);
      },
    };
  }

  private findDescendantByName(root: TransformNode, name: string): TransformNode | null {
    for (const node of root.getDescendants()) {
      if (node.name === name) return node as TransformNode;
    }
    return null;
  }

  private disposeStarbaseVisuals(): void {
    this.starbaseLight?.dispose();
    this.starbaseLight = null;
    this.starbaseRoot?.dispose(false, true);
    this.starbaseRoot = null;
    this.starbaseVisualLevel = null;
  }

  private async createStarbaseIfPresent(): Promise<void> {
    if (!this.hasStarbasePresence()) return;

    const starbaseLevel = this.getCurrentStarbaseVisualLevel();
    if (this.starbaseRoot) {
      if (this.starbaseVisualLevel === starbaseLevel) return;
      this.disposeStarbaseVisuals();
    }

    const starbaseSystemPosition = normalizeSystemStarbasePosition(
      this.getStarbasesInCurrentSystem()[0]?.systemPosition ?? getSystemStarbasePosition(),
    );
    const starbaseBasePosition = new Vector3(
      starbaseSystemPosition.x,
      8.5,
      starbaseSystemPosition.z,
    );
    const modelDef = STARBASE_MODEL_DEFINITIONS[starbaseLevel] ?? STARBASE_MODEL_DEFINITIONS.outpost;
    this.starbaseRoot = new TransformNode("starbaseRoot", this.scene);
    this.starbaseVisualLevel = starbaseLevel;
    this.starbaseRoot.position = starbaseBasePosition.clone();
    this.starbaseRoot.rotation.set(
      modelDef.modelPitch ?? 0.18,
      modelDef.modelYawOffset ?? 0.2,
      modelDef.modelRoll ?? 0.05,
    );

    try {
      const assetRoot = await this.assetRegistry.instantiate(
        this.getStarbaseAssetDefinition(starbaseLevel),
        "starbaseAssetRoot",
      );
      if (!assetRoot) {
        throw new Error(`${modelDef.modelFile} did not produce renderable meshes.`);
      }
      assetRoot.parent = this.starbaseRoot;
      for (const mesh of assetRoot.getChildMeshes()) {
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        this.glowLayer.addIncludedOnlyMesh(mesh as Mesh);
      }

      this.starbaseLight = new PointLight(
        "starbaseInspectionLight",
        new Vector3(0, 6, -10),
        this.scene,
      );
      this.starbaseLight.parent = this.starbaseRoot;
      this.starbaseLight.intensity = 1.45;
      this.starbaseLight.range = 36;
      this.starbaseLight.diffuse = new Color3(0.72, 0.92, 1.0);
      this.starbaseLight.specular = new Color3(0.95, 0.98, 1.0);
    } catch (err) {
      console.warn("Failed to load starbase model, using procedural fallback.", err);
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
  }

  private createProceduralStarbaseFallback(): void {
    if (!this.starbaseRoot) return;

    const hullMat = new StandardMaterial("starbaseHullMat", this.scene);
    hullMat.diffuseColor = new Color3(0.38, 0.43, 0.5);
    hullMat.specularColor = new Color3(0.65, 0.7, 0.78);
    hullMat.emissiveColor = new Color3(0.08, 0.1, 0.13);

    const accentMat = new StandardMaterial("starbaseAccentMat", this.scene);
    accentMat.diffuseColor = Color3.Black();
    accentMat.specularColor = Color3.Black();
    accentMat.disableLighting = true;
    accentMat.emissiveColor = new Color3(0.48, 0.84, 1.0).scale(1.5);
    accentMat.alpha = 0.95;

    const hubMat = new StandardMaterial("starbaseHubMat", this.scene);
    hubMat.diffuseColor = new Color3(0.48, 0.52, 0.6);
    hubMat.specularColor = new Color3(0.76, 0.82, 0.9);
    hubMat.emissiveColor = new Color3(0.09, 0.11, 0.15);

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
    this.starbaseLight.intensity = 1.45;
    this.starbaseLight.range = 36;
    this.starbaseLight.diffuse = new Color3(0.72, 0.92, 1.0);
    this.starbaseLight.specular = new Color3(0.95, 0.98, 1.0);
  }

  async setup(): Promise<void> {
    const canvas = this.engine.getRenderingCanvas()!;

    this.configureVisualPreset();
    this.setupBackground();
    this.setupCamera(canvas);
    this.inputController = new SystemInputController(this.scene, this.camera, () => this.engine.getRenderingCanvas());
    this.setupLighting();
    this.nebulaEnvironment = createSystemNebulaEnvironment(
      this.scene,
      this.glowLayer,
      this.options.nebula,
      this.star.id,
    );
    this.buildSystemObjects();
    this.objectPanel = new CelestialObjectPanel();
    this.selectionPanel = new SelectionPanel(canvas, {
      onShipAction: (action, selection) => this.handleSelectedFleetAction(action, selection),
      onFleetPolicyChange: (control, value, selection) => this.setFleetPolicy(control, value, selection),
      onRepairFleet: (constructionFleetId, targetFleetId) => this.options.onFleetCommand?.({ type: "repairFleet", constructionFleetId, targetFleetId }),
    });
    this.labelOverlay = new SystemLabelOverlay();
    this.renderSelectedFleetPanels();
    this.starbasePanel = new StarbasePanel();
    this.installObjectLabelClicks();
    await this.createPlayerShipIfPresent();
    await this.createStarbaseIfPresent();
    this.refreshShipVisuals();
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
      const playerFleet = this.playerShipFleetId
        ? this.serverFleets.find((fleet) => fleet.id === this.playerShipFleetId)
        : null;
      const directFollow = !!playerFleet && this.shouldDirectFollowFleet(playerFleet);
      const distanceToTarget = Vector3.Distance(this.playerShipBasePosition, this.playerShipTargetPosition);
      if (directFollow || distanceToTarget > SYSTEM_SHIP_DIRECT_FOLLOW_SNAP_DISTANCE) {
        this.playerShipBasePosition.copyFrom(this.playerShipTargetPosition);
      } else {
        const t = Math.min(1, dt * 4.5);
        this.playerShipBasePosition.x = this.playerShipBasePosition.x + (this.playerShipTargetPosition.x - this.playerShipBasePosition.x) * t;
        this.playerShipBasePosition.y = this.playerShipBasePosition.y + (this.playerShipTargetPosition.y - this.playerShipBasePosition.y) * t;
        this.playerShipBasePosition.z = this.playerShipBasePosition.z + (this.playerShipTargetPosition.z - this.playerShipBasePosition.z) * t;
      }
      this.playerShipRoot.position.x = this.playerShipBasePosition.x;
      this.playerShipRoot.position.y =
        this.playerShipBasePosition.y + Math.sin(this.elapsed * 1.15) * 0.32;
      this.playerShipRoot.position.z = this.playerShipBasePosition.z;
      this.updatePlayerShipHeading(previousShipPosition, this.playerShipRoot.position, dt);
      this.updatePlayerShipTrail(dt, previousShipPosition, this.playerShipRoot.position);
    }
    this.updateSelectedFleetRouteLine();
    this.updateSystemActionTargetMarkers();

    if (this.shipVisualRoots.size > 0) {
      const moveT = Math.min(1, dt * 5);
      for (const [shipId, root] of this.shipVisualRoots) {
        const target = this.shipVisualTargets.get(shipId);
        if (!target) continue;
        const previousPosition = root.position.clone();
        const fleet = this.getFleetForShipVisual(root);
        const directFollow = fleet ? this.shouldDirectFollowFleet(fleet) : false;
        const distanceToTarget = Vector3.Distance(root.position, target);
        if (directFollow || distanceToTarget > SYSTEM_SHIP_DIRECT_FOLLOW_SNAP_DISTANCE) {
          root.position.copyFrom(target);
        } else {
          root.position.x = root.position.x + (target.x - root.position.x) * moveT;
          root.position.y = root.position.y + (target.y - root.position.y) * moveT;
          root.position.z = root.position.z + (target.z - root.position.z) * moveT;
        }
        this.updateShipVisualHeading(root, previousPosition, root.position, dt);
        this.updateShipVisualTrail(shipId, dt, previousPosition, root.position);
      }
    }

    this.objectRenderer.update(dt, 3.8);
    this.effectsRenderer?.update(dt);
    const cameraImpulse = this.effectsRenderer?.consumeCameraImpulse() ?? 0;
    if (cameraImpulse > 0.001 && this.camera) {
      this.camera.inertialAlphaOffset += (Math.random() - 0.5) * cameraImpulse * 0.012;
      this.camera.inertialBetaOffset += (Math.random() - 0.5) * cameraImpulse * 0.007;
    }
    this.nebulaEnvironment?.update(dt);

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

    this.updateSystemLabelOverlay();
    this.updateStarOcclusionAndGlow();
    this.updateRenderDebugOverlay();
  }

  private updatePlayerShipHeading(previousPosition: Vector3, currentPosition: Vector3, deltaTime: number): void {
    if (!this.playerShipRoot) return;
    const dx = currentPosition.x - previousPosition.x;
    const dz = currentPosition.z - previousPosition.z;
    if (Math.hypot(dx, dz) < 0.0008) return;

    const modelDef = SHIP_MODEL_DEFINITIONS[this.playerShipKind];
    const pitch = typeof modelDef.modelPitch === "number" ? modelDef.modelPitch : PLAYER_SHIP_MODEL_PITCH;
    const roll = typeof modelDef.modelRoll === "number" ? modelDef.modelRoll : PLAYER_SHIP_MODEL_ROLL;
    const yawOffset = typeof modelDef.modelYawOffset === "number" ? modelDef.modelYawOffset : PLAYER_SHIP_MODEL_YAW_OFFSET;

    const targetYaw = Math.atan2(dx, dz) + yawOffset;
    const currentYaw = this.playerShipRoot.rotation.y;
    const yawDelta = Math.atan2(Math.sin(targetYaw - currentYaw), Math.cos(targetYaw - currentYaw));
    const turn = Math.min(1, deltaTime * PLAYER_SHIP_TURN_RATE);
    this.playerShipRoot.rotation.set(
      pitch,
      currentYaw + yawDelta * turn,
      roll,
    );
  }

  private getFleetForShipVisual(root: TransformNode): ServerFleet | null {
    const metadata = root.metadata as { fleetId?: string | null } | null;
    const fleetId = metadata?.fleetId ?? null;
    return fleetId ? this.serverFleets.find((fleet) => fleet.id === fleetId) ?? null : null;
  }

  private shouldDirectFollowFleet(fleet: ServerFleet): boolean {
    if (fleet.orbitTargetPlanetId && !fleet.movementPlan) return true;
    return this.getActiveLocalMovementSegment(fleet) !== null;
  }

  private getActiveLocalMovementSegment(fleet: ServerFleet): FleetMovementSegment | null {
    const segment = fleet.movementPlan?.segments.find((candidate) => (
      this.clockYear >= candidate.startYear
      && this.clockYear < candidate.endYear
      && candidate.kind !== "hyperlane"
      && candidate.fromStarId === this.star.id
      && candidate.toStarId === this.star.id
    ));
    return segment ?? null;
  }

  private updatePlayerShipTrail(deltaTime: number, previousPosition: Vector3, currentPosition: Vector3): void {
    if (!this.playerShipRoot?.isEnabled()) {
      this.playerShipLastTrailPosition = null;
      this.playerShipLastTrailAttachmentPosition = null;
      return;
    }
    this.playerShipTrailTimer += deltaTime;

    // If attachment present, sample attachment absolute positions directly
    if (this.playerShipTrailAttachmentPoint?.isEnabled()) {
      const attachNow = this.getTrailSocketAnchorPosition(
        this.playerShipTrailAttachmentPoint,
        SHIP_MODEL_DEFINITIONS[this.playerShipKind],
      );
      const prevAttach = this.playerShipLastTrailAttachmentPosition ?? attachNow.clone();
      const distance = Vector3.Distance(prevAttach, attachNow);
      if (distance > PLAYER_SHIP_TRAIL_MAX_SEGMENT_DISTANCE) {
        this.playerShipLastTrailAttachmentPosition = attachNow.clone();
        this.playerShipTrailTimer = 0;
        return;
      }
      if (this.playerShipTrailTimer < PLAYER_SHIP_TRAIL_SAMPLE_INTERVAL || distance < PLAYER_SHIP_TRAIL_MIN_DISTANCE) return;
      this.playerShipTrailTimer = 0;
      this.createPlayerShipTrailSegment(prevAttach, attachNow);
      this.playerShipLastTrailAttachmentPosition = attachNow.clone();
      // also update last root position to keep fallback logic consistent
      this.playerShipLastTrailPosition = currentPosition.clone();
      return;
    }

    // Fallback to root-position-based trail sampling
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

    let trailStartPos = this.playerShipLastTrailPosition.clone();
    const modelDef = SHIP_MODEL_DEFINITIONS[this.playerShipKind];
    if (modelDef.trailOffsetY) {
      trailStartPos.y += modelDef.trailOffsetY;
    }
    let trailEndPos = currentPosition.clone();
    if (modelDef.trailOffsetY) {
      trailEndPos.y += modelDef.trailOffsetY;
    }
    this.createPlayerShipTrailSegment(trailStartPos, trailEndPos);
    this.playerShipLastTrailPosition = currentPosition.clone();
  }

  private createPlayerShipTrailSegment(from: Vector3, to: Vector3): void {
    this.effectsRenderer?.queueTrail({
      name: "playerShipTrailSegment",
      ownerId: "playerShip",
      from: new Vector3(from.x, from.y - 0.22, from.z),
      to: new Vector3(to.x, to.y - 0.22, to.z),
      radius: PLAYER_SHIP_TRAIL_RADIUS,
      tessellation: 8,
      diffuse: new Color3(0.02, 0.16, 0.48),
      emissive: new Color3(0.08, 0.75, 1.0),
      ttl: PLAYER_SHIP_TRAIL_TTL,
      startAlpha: PLAYER_SHIP_TRAIL_START_ALPHA,
      fadePower: 1.35,
      maxPerOwner: 72,
    });
  }

  private getTrailSocketAnchorPosition(
    attachment: TransformNode,
    modelDef: { trailAxis?: "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z"; trailSocketOffset?: number; trailSocketLift?: number },
  ): Vector3 {
    // The attachment itself is already the offset anchor; sample its world position directly.
    return attachment.getAbsolutePosition().clone();
  }

  private createTrailSocketAnchorNode(
    attachment: TransformNode,
    modelDef: { trailAxis?: "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z"; trailSocketOffset?: number; trailSocketLift?: number },
    name: string,
  ): TransformNode {
    const anchor = new TransformNode(name, this.scene);
    anchor.parent = attachment;

    const offset = modelDef.trailSocketOffset ?? 0;
    const lift = modelDef.trailSocketLift ?? 0;
    const axis = modelDef.trailAxis ?? "+X";
    anchor.position.set(
      axis === "+X" ? offset : axis === "-X" ? -offset : 0,
      (axis === "+Y" ? offset : axis === "-Y" ? -offset : 0) + lift,
      axis === "+Z" ? offset : axis === "-Z" ? -offset : 0,
    );
    return anchor;
  }

  private disposePlayerShipTrail(): void {
    this.effectsRenderer?.removeTrails("playerShip");
    this.playerShipLastTrailPosition = null;
    this.playerShipLastTrailAttachmentPosition = null;
    this.playerShipTrailTimer = 0;
  }

  private updateShipVisualHeading(
    root: TransformNode,
    previousPosition: Vector3,
    currentPosition: Vector3,
    deltaTime: number,
  ): void {
    const dx = currentPosition.x - previousPosition.x;
    const dz = currentPosition.z - previousPosition.z;
    if (Math.hypot(dx, dz) < 0.002) return;

    const md = (root.metadata as { shipKind?: StarbaseShipKind } | null) ?? null;
    const shipKind = md?.shipKind ?? "corvette";
    const modelDef = SHIP_MODEL_DEFINITIONS[shipKind];
    const pitch = typeof modelDef.modelPitch === "number" ? modelDef.modelPitch : PLAYER_SHIP_MODEL_PITCH;
    const roll = typeof modelDef.modelRoll === "number" ? modelDef.modelRoll : PLAYER_SHIP_MODEL_ROLL;
    const yawOffset = typeof modelDef.modelYawOffset === "number" ? modelDef.modelYawOffset : PLAYER_SHIP_MODEL_YAW_OFFSET;

    const targetYaw = Math.atan2(dx, dz) + yawOffset;
    const currentYaw = root.rotation.y;
    const yawDelta = Math.atan2(Math.sin(targetYaw - currentYaw), Math.cos(targetYaw - currentYaw));
    const turn = Math.min(1, deltaTime * PLAYER_SHIP_TURN_RATE);
    root.rotation.set(
      pitch,
      currentYaw + yawDelta * turn,
      roll,
    );
  }

  private updateShipVisualTrail(
    shipId: string,
    deltaTime: number,
    previousPosition: Vector3,
    currentPosition: Vector3,
  ): void {
    const root = this.shipVisualRoots.get(shipId);
    if (!root?.isEnabled()) {
      this.shipVisualLastTrailPositions.delete(shipId);
      this.shipVisualTrailTimers.delete(shipId);
      return;
    }
    // If the instance exposed a named trail/socket attachment, sample that node's absolute position
    const metadata = root.metadata as any;
    const attachment = metadata?.trailAttachment as TransformNode | null | undefined;
    if (attachment) {
      // Sample absolute position directly
      const ship = this.serverShips.find((candidate) => candidate.id === shipId);
      const attachNow = this.getTrailSocketAnchorPosition(
        attachment,
        SHIP_MODEL_DEFINITIONS[ship?.shipKind ?? "corvette"],
      );
      const prevAttach = this.shipVisualLastTrailPositions.get(shipId) ?? attachNow.clone();
      const distance = Vector3.Distance(prevAttach, attachNow);
      const nextTimer = (this.shipVisualTrailTimers.get(shipId) ?? 0) + deltaTime;
      this.shipVisualTrailTimers.set(shipId, nextTimer);
      if (distance > TACTICAL_SHIP_TRAIL_MAX_SEGMENT_DISTANCE) {
        this.shipVisualLastTrailPositions.set(shipId, attachNow.clone());
        this.shipVisualTrailTimers.set(shipId, 0);
        return;
      }
      if (nextTimer < TACTICAL_SHIP_TRAIL_SAMPLE_INTERVAL || distance < TACTICAL_SHIP_TRAIL_MIN_DISTANCE) return;
      this.createShipVisualTrailSegment(shipId, prevAttach, attachNow);
      this.shipVisualLastTrailPositions.set(shipId, attachNow.clone());
      this.shipVisualTrailTimers.set(shipId, 0);
      return;
    }

    // Fallback: use world-root positions (existing behavior)
    const movedThisFrame = Vector3.Distance(previousPosition, currentPosition);
    if (movedThisFrame < 0.001) return;

    const nextTimer = (this.shipVisualTrailTimers.get(shipId) ?? 0) + deltaTime;
    this.shipVisualTrailTimers.set(shipId, nextTimer);
    if (!this.shipVisualLastTrailPositions.has(shipId)) {
      this.shipVisualLastTrailPositions.set(shipId, previousPosition.clone());
    }
    const lastPosition = this.shipVisualLastTrailPositions.get(shipId);
    if (!lastPosition) return;

    const distance = Vector3.Distance(lastPosition, currentPosition);
    if (distance > TACTICAL_SHIP_TRAIL_MAX_SEGMENT_DISTANCE) {
      this.shipVisualLastTrailPositions.set(shipId, currentPosition.clone());
      this.shipVisualTrailTimers.set(shipId, 0);
      return;
    }
    if (nextTimer < TACTICAL_SHIP_TRAIL_SAMPLE_INTERVAL || distance < TACTICAL_SHIP_TRAIL_MIN_DISTANCE) return;

    this.createShipVisualTrailSegment(shipId, lastPosition, currentPosition);
    this.shipVisualLastTrailPositions.set(shipId, currentPosition.clone());
    this.shipVisualTrailTimers.set(shipId, 0);
  }

  private createShipVisualTrailSegment(shipId: string, from: Vector3, to: Vector3): void {
    const palette = this.getShipTrailPalette(shipId);
    // Allow model-provided trail axis to nudge the trail slightly along the socket's world direction
    let start = new Vector3(from.x, from.y - 0.1, from.z);
    let end = new Vector3(to.x, to.y - 0.1, to.z);
    const ship = this.serverShips.find((s) => s.id === shipId);
    const modelDef = SHIP_MODEL_DEFINITIONS[ship?.shipKind ?? "corvette"];
    if (modelDef.trailAxis) {
      // try to find instance attachment and compute world axis
      const root = this.shipVisualRoots.get(shipId);
      const attachment = (root?.metadata as any)?.trailAttachment as TransformNode | null | undefined;
      if (attachment) {
        try {
          const localAxis = (() => {
            switch (modelDef.trailAxis) {
              case "+X": return new Vector3(1, 0, 0);
              case "-X": return new Vector3(-1, 0, 0);
              case "+Y": return new Vector3(0, 1, 0);
              case "-Y": return new Vector3(0, -1, 0);
              case "+Z": return new Vector3(0, 0, 1);
              case "-Z": return new Vector3(0, 0, -1);
              default: return new Vector3(0, 0, 0);
            }
          })();
          const wm = (attachment as any).getWorldMatrix ? (attachment as any).getWorldMatrix() : attachment.computeWorldMatrix(true);
          const worldDir = Vector3.TransformNormal(localAxis, wm).normalize();
          const nudge = worldDir.scale(0.08);
          start = start.add(nudge);
          end = end.add(nudge);
        } catch (e) {
          // ignore fallback to unmodified path
        }
      }
    }
    this.effectsRenderer?.queueTrail({
      name: `shipTrailSegment-${shipId}`,
      ownerId: `ship:${shipId}`,
      from: start,
      to: end,
      radius: TACTICAL_SHIP_TRAIL_RADIUS,
      tessellation: 6,
      diffuse: palette.diffuse,
      emissive: palette.emissive,
      ttl: TACTICAL_SHIP_TRAIL_TTL,
      startAlpha: TACTICAL_SHIP_TRAIL_START_ALPHA,
      fadePower: 1.4,
      maxPerOwner: TACTICAL_SHIP_TRAIL_MAX_SEGMENTS_PER_SHIP,
    });
  }

  private getShipTrailPalette(shipId: string): { diffuse: Color3; emissive: Color3 } {
    const ship = this.serverShips.find((candidate) => candidate.id === shipId);
    if (ship?.shipKind === "constructionShip") {
      return {
        diffuse: new Color3(0.42, 0.16, 0.02),
        emissive: new Color3(1.0, 0.45, 0.08),
      };
    }
    if (ship?.shipKind === "colonizationShip") {
      return {
        diffuse: new Color3(0.1, 0.34, 0.24),
        emissive: new Color3(0.35, 1.0, 0.72),
      };
    }
    return {
      diffuse: new Color3(0.02, 0.14, 0.38),
      emissive: new Color3(0.08, 0.68, 1.0),
    };
  }

  private disposeShipVisualTrail(shipId: string): void {
    this.effectsRenderer?.removeTrails(`ship:${shipId}`);
    this.shipVisualLastTrailPositions.delete(shipId);
    this.shipVisualTrailTimers.delete(shipId);
  }

  private disposeAllShipVisualTrails(): void {
    const shipIds = new Set([
      ...this.shipVisualLastTrailPositions.keys(),
      ...this.shipVisualTrailTimers.keys(),
    ]);
    for (const shipId of shipIds) {
      this.disposeShipVisualTrail(shipId);
    }
    this.shipVisualLastTrailPositions.clear();
    this.shipVisualTrailTimers.clear();
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
    if (action === "stop") {
      this.options.onFleetCommand?.({ type: "stopFleet", fleetId });
      this.clearFleetAction();
      return;
    }
    if (action === "retreatTo" || action === "emergencyRetreatTo") {
      this.options.onRequestFleetActionInGalaxy?.(fleetId, action);
      this.clearFleetAction();
      return;
    }
    if (action === "build") {
      this.options.onRequestFleetActionInGalaxy?.(fleetId, "build");
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
      if (this.hasLocalHostileTarget(fleetId)) {
        this.issueBasicAttack(fleetId);
      } else {
        this.options.onRequestFleetActionInGalaxy?.(fleetId, "attack");
      }
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

  private setFleetPolicy(control: FleetPolicyControl, value: FleetPolicyValue, selection?: SelectionData): void {
    const fleetId = selection?.id ?? this.getPrimarySelectedFleetId();
    if (!fleetId) return;
    const fleet = this.serverFleets.find((candidate) => candidate.id === fleetId);
    if (!fleet || fleet.ownerId !== this.playerFactionId) return;

    if (control === "engagementRule") {
      const options: FleetEngagementRule[] = ["avoid", "defendSystem", "engageSystem"];
      if (!options.includes(value as FleetEngagementRule)) return;
      this.options.onFleetCommand?.({
        type: "setFleetCombatSettings",
        fleetId,
        combatSettings: { engagementRule: value as FleetEngagementRule },
      });
      return;
    }

    if (control === "doctrine") {
      const options: FleetDoctrine[] = ["artillery", "line", "assault", "escort"];
      if (!options.includes(value as FleetDoctrine)) return;
      this.options.onFleetCommand?.({
        type: "setFleetCombatSettings",
        fleetId,
        combatSettings: { doctrine: value as FleetDoctrine },
      });
      return;
    }

    const options: FleetRetreatPreset[] = ["fightOn", "balanced", "preserveFleet", "avoidLosses"];
    if (!options.includes(value as FleetRetreatPreset)) return;
    this.options.onFleetCommand?.({
      type: "setFleetCombatSettings",
      fleetId,
      combatSettings: { retreatPreset: value as FleetRetreatPreset },
    });
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
      && this.warFactionIds.has(candidate.ownerId)
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
      && this.warFactionIds.has(candidate.ownerId)
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

  private hasLocalHostileTarget(fleetId: string): boolean {
    const fleet = this.serverFleets.find((candidate) => candidate.id === fleetId);
    if (!fleet) return false;
    return this.serverFleets.some((candidate) => (
      candidate.id !== fleet.id
      && candidate.currentStarId === fleet.currentStarId
      && candidate.ownerId !== fleet.ownerId
      && this.warFactionIds.has(candidate.ownerId)
    )) || this.starbases.some((candidate) => (
      candidate.starId === fleet.currentStarId
      && candidate.ownerId !== fleet.ownerId
      && this.warFactionIds.has(candidate.ownerId)
    ));
  }

  private canPlayerEnterStar(starId: number): boolean {
    const owner = this.starOwnership[starId] ?? -1;
    if (owner < 0 || owner === this.playerFactionId) return true;
    if (this.warFactionIds.has(owner)) return true;
    return this.openBorderFactionIds.has(owner);
  }

  private rebuildSystemActionTargetMarkers(): void {
    this.actionTargetRenderer?.setTargets(
      this.getSystemActionTargets(),
      (target) => this.getSystemActionMarkerRadius(target),
    );
  }

  private updateSystemActionTargetMarkers(): void {
    this.actionTargetRenderer?.update(
      this.elapsed,
      (target) => this.resolveSystemActionTargetMarkerPosition(target),
    );
  }

  private disposeSystemActionTargetMarkers(): void {
    this.actionTargetRenderer?.clear();
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
    const isColonize = this.activeFleetAction === "colonize";
    if (this.activeFleetAction !== "move" && !isColonize) return [];

    const targets: SystemActionTarget[] = [];

    // Planets are valid targets for both move (orbit) and colonize.
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

    // Colonize only targets planets; everything below is movement-only.
    if (isColonize) return targets;

    const starPosition = getSystemStarOrbitPosition();
    targets.unshift({
      kind: "star",
      label: this.star.name,
      starId: this.star.id,
      position: starPosition,
      markerPosition: { x: 0, y: SYSTEM_FLEET_Y, z: 0 },
    });

    const starbase = this.getStarbasesInCurrentSystem()[0];
    if (starbase) {
      const starbasePosition = normalizeSystemStarbasePosition(starbase.systemPosition ?? getSystemStarbasePosition());
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

    for (const exit of this.hyperlaneExits) {
      if (!this.canPlayerEnterStar(exit.starId)) continue;
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
    if (!this.actionTargetRenderer?.hasTargets) return null;

    // Prefer the actual visible planet sphere so orbit/colonize hit what you see.
    const planetPick = this.inputController?.pickWithTolerance(ev, (mesh) => this.planetMeshes.includes(mesh));
    if (planetPick?.hit && planetPick.pickedMesh) {
      const index = this.planetMeshes.findIndex((mesh) => mesh === planetPick.pickedMesh);
      const planetId = index >= 0 ? this.planetConfigs[index]?.id : undefined;
      const planetTarget = planetId ? this.buildPlanetActionTarget(planetId) : null;
      if (planetTarget) return planetTarget;
    }

    // Then the action marker meshes themselves.
    const pick = this.inputController?.pick(ev, (mesh) => this.actionTargetRenderer?.hasMesh(mesh) === true);
    if (pick?.hit && pick.pickedMesh) {
      const meshTarget = this.actionTargetRenderer.getTargetForMesh(pick.pickedMesh as Mesh);
      if (meshTarget) return meshTarget;
    }

    // Finally a modest proximity snap (kept small so empty-space clicks aren't hijacked).
    const hit = this.getRawPointerSystemPlanePosition(ev);
    if (!hit) return null;
    return this.actionTargetRenderer.findTargetNearPosition(
      hit,
      (target) => this.getSystemActionMarkerRadius(target),
      { radiusScale: 1.35, minimumRadius: 3.0 },
    );
  }

  private buildPlanetActionTarget(planetId: string): SystemActionTarget | null {
    const index = this.planetConfigs.findIndex((planet) => planet.id === planetId);
    const planet = index >= 0 ? this.planetConfigs[index] : null;
    const mesh = index >= 0 ? this.planetMeshes[index] : null;
    if (!planet || !mesh) return null;
    return {
      kind: "planet",
      label: planet.name,
      starId: this.star.id,
      planetId: planet.id,
      position: { x: mesh.position.x, y: SYSTEM_FLEET_Y, z: mesh.position.z },
      markerPosition: { x: mesh.position.x, y: SYSTEM_FLEET_Y, z: mesh.position.z },
    };
  }

  private getRawPointerSystemPlanePosition(ev: PointerEvent): Vector3 | null {
    return this.inputController?.getSystemPlanePosition(ev, SYSTEM_FLEET_Y) ?? null;
  }

  private getPointerSystemPlanePosition(ev: PointerEvent): SystemPosition | null {
    const hit = this.getRawPointerSystemPlanePosition(ev);
    if (!hit) return null;
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
    if (this.activeFleetAction === "colonize") {
      if (target.kind === "planet" && target.planetId) {
        const fleetId = this.getPrimarySelectedFleetId();
        if (fleetId) this.options.onFleetCommand?.({ type: "colonizePlanet", fleetId, planetId: target.planetId });
      }
      this.clearFleetAction();
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

  private refreshSystemEntityCards(): void {
    this.updateSystemLabelOverlay();
  }

  private updateSystemEntityCards(): void {
    this.updateSystemLabelOverlay();
  }

  private updateSystemLabelOverlay(): void {
    if (!this.labelOverlay) return;
    this.labelOverlay.setVisible(this.labelsVisible);
    this.labelOverlay.setInteractive(this.activeFleetAction === null);
    if (!this.labelsVisible) return;
    const items = this.createSystemLabelOverlayItems();
    this.labelOverlay.setItems(items);
    this.labelOverlay.update((anchor) => this.projectToScreen(anchor));
  }

  private createSystemLabelOverlayItems(): SystemLabelOverlayItem[] {
    const items: SystemLabelOverlayItem[] = [];
    if (this.starMesh) {
      const [r, g, b] = this.star.color.map((channel) => Math.round(channel * 255));
      items.push({
        key: `star:${this.star.id}`,
        kind: "star",
        anchor: this.starMesh.position.add(new Vector3(0, this.starDiameter * 0.72 + 1.8, 0)),
        text: this.star.name,
        detail: "Star",
        icon: "S",
        accent: `rgba(${r}, ${g}, ${b}, 0.95)`,
        priority: 90,
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.clearFleetSelection();
          this.showStarObjectPanel();
        },
      });
    }

    for (let i = 0; i < this.planetMeshes.length; i += 1) {
      const mesh = this.planetMeshes[i];
      const planet = this.planetConfigs[i];
      const diameter = this.planetDiameters[i] ?? 2;
      if (!mesh || !planet) continue;
      items.push({
        key: `planet:${planet.id}`,
        kind: "planet",
        anchor: mesh.position.add(new Vector3(0, diameter * 0.6 + 1.2, 0)),
        text: planet.name,
        detail: planet.isHabited ? "Habited planet" : "Planet",
        icon: planet.isHabited ? "H" : "P",
        accent: planet.isHabited ? "rgba(92, 221, 184, 0.92)" : "rgba(166, 210, 255, 0.82)",
        priority: planet.isHabited ? 82 : 55,
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.clearFleetSelection();
          void this.showPlanetObjectPanel(planet);
        },
      });
    }

    this.getFleetsInCurrentSystem().forEach((fleet, index) => {
      const anchor = this.getFleetCardAnchor(fleet.id);
      if (!anchor) return;
      const owner = this.getFaction(fleet.ownerId);
      items.push({
        key: `fleet:${fleet.id}`,
        kind: "fleet",
        anchor,
        text: this.formatFleetPower(fleet, index),
        detail: this.formatFleetStatus(fleet),
        icon: "F",
        accent: this.factionColorCss(owner, "rgba(88, 211, 255, 0.95)"),
        priority: fleet.ownerId === this.playerFactionId ? 100 : 88,
        offsetY: -28 - index * 14,
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.selectFleetFromCard(fleet, event.shiftKey);
        },
      });
    });

    this.getStarbasesInCurrentSystem().forEach((starbase, index) => {
      const anchor = this.getStarbaseCardAnchor(starbase.id);
      if (!anchor) return;
      const owner = this.getFaction(starbase.ownerId);
      items.push({
        key: `starbase:${starbase.id}`,
        kind: "starbase",
        anchor,
        text: this.formatStarbasePower(starbase),
        detail: starbase.status === "building" ? "Building" : "Starbase",
        icon: "SB",
        accent: this.factionColorCss(owner, "rgba(255, 207, 115, 0.95)"),
        priority: 96,
        offsetY: -16 - index * 12,
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openStarbasePanel(starbase);
        },
      });
    });

    for (const exit of this.hyperlaneExits) {
      const position = exit.systemPosition ?? getHyperlaneExitSystemPosition(exit);
      items.push({
        key: `hyperlane:${this.star.id}:${exit.starId}`,
        kind: "hyperlane",
        anchor: new Vector3(position.x, SYSTEM_HYPERLANE_EXIT_MARKER_Y + 1.2, position.z),
        text: exit.name,
        detail: "Hyperlane",
        icon: "HL",
        accent: "rgba(92, 196, 255, 0.75)",
        priority: 32,
      });
    }
    return items;
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

  private getVisibleFleetViews(): TacticalFleetView[] {
    const views = this.getFleetsInCurrentSystem()
      .filter((fleet) => fleet.shipIds.length > 0)
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
    return this.applyFleetVisualSeparation(views);
  }

  private applyFleetVisualSeparation(views: TacticalFleetView[]): TacticalFleetView[] {
    const groups = new Map<string, TacticalFleetView[]>();
    for (const view of views) {
      const key = [
        Math.round(view.position.x / FLEET_VISUAL_STACK_KEY_SIZE),
        Math.round(view.position.z / FLEET_VISUAL_STACK_KEY_SIZE),
      ].join(":");
      const group = groups.get(key) ?? [];
      group.push(view);
      groups.set(key, group);
    }

    const offsets = new Map<string, { x: number; z: number }>();
    for (const [key, group] of groups) {
      if (group.length <= 1) continue;
      const sorted = group.slice().sort((a, b) => a.id.localeCompare(b.id));
      const baseAngle = ((this.hashString(key) % 360) / 360) * Math.PI * 2;
      const firstRingCount = Math.min(sorted.length, 8);
      for (let index = 0; index < sorted.length; index += 1) {
        const ringIndex = Math.floor(index / 8);
        const ringOffsetIndex = index % 8;
        const ringCount = ringIndex === 0 ? firstRingCount : Math.min(8, sorted.length - ringIndex * 8);
        const radius = FLEET_VISUAL_SEPARATION_DISTANCE * (sorted.length === 2 ? 0.62 : 0.92 + ringIndex * 0.72);
        const angle = baseAngle + (ringOffsetIndex / Math.max(1, ringCount)) * Math.PI * 2;
        offsets.set(sorted[index].id, {
          x: Math.cos(angle) * radius,
          z: Math.sin(angle) * radius,
        });
      }
    }

    return views.map((view) => {
      const offset = offsets.get(view.id);
      if (!offset) return view;
      return {
        ...view,
        position: {
          ...view.position,
          x: view.position.x + offset.x,
          z: view.position.z + offset.z,
        },
      };
    });
  }

  private getStarbasesInCurrentSystem(): ServerStarbaseSummary[] {
    return this.starbases.filter((starbase) => starbase.starId === this.star.id);
  }

  private getFleetCardAnchor(fleetId?: string): Vector3 | null {
    if (!fleetId) return null;
    const fleet = this.serverFleets.find((candidate) => candidate.id === fleetId);
    if (!fleet || fleet.currentStarId !== this.star.id || fleet.phase === "jumpingHyperlane") return null;
    const fleetRoot = this.objectRenderer.getRoot(this.getFleetRenderableId(fleet.id));
    if (fleetRoot?.isEnabled()) {
      return fleetRoot.position.add(new Vector3(0, 2.6, 0));
    }
    if (this.playerShipRoot?.isEnabled() && fleet.ownerId === this.playerFactionId) {
      return this.playerShipRoot.position.add(new Vector3(0, 2.6, 0));
    }
    const position = this.getFleetRenderPosition(fleet);
    return new Vector3(position.x, position.y + 2.6, position.z);
  }

  private getStarbaseCardAnchor(starbaseId?: string): Vector3 | null {
    if (!starbaseId) return null;
    const starbase = this.starbases.find((candidate) => candidate.id === starbaseId);
    if (!starbase || starbase.starId !== this.star.id) return null;
    if (this.starbaseRoot?.isEnabled()) {
      return this.starbaseRoot.position.add(new Vector3(0, 2.8, 0));
    }
    const position = normalizeSystemStarbasePosition(starbase.systemPosition ?? getSystemStarbasePosition());
    return new Vector3(position.x, 8.5 + 2.8, position.z);
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
    this.selectedFleetIds.add(fleet.id);
    this.selectedFleetId = fleet.id;
    this.systemStore?.setSelectedFleetIds(this.selectedFleetIds);
    this.notifyFleetSelectionChanged();
    this.selectionPanel.select(this.createFleetSelectionData(fleet), shiftKey);
    this.refreshFleetMarkers();
  }

  private fleetCanBuildStarbase(fleet: ServerFleet | null | undefined): boolean {
    if (!fleet || fleet.ownerId !== this.playerFactionId) return false;
    return this.getShipsForFleet(fleet.id).some((ship) => ship.shipKind === "constructionShip" && ship.hull > 0);
  }

  private fleetCanColonize(fleet: ServerFleet | null | undefined): boolean {
    if (!fleet || fleet.ownerId !== this.playerFactionId) return false;
    return this.getShipsForFleet(fleet.id).some((ship) => ship.shipKind === "colonizationShip" && ship.hull > 0);
  }

  private getFleetActions(fleet: ServerFleet): ShipAction[] {
    if (fleet.stationaryStarbaseId) return [];
    const actions: ShipAction[] = ["move"];
    if (this.fleetCanBuildStarbase(fleet)) actions.push("build");
    if (this.fleetCanColonize(fleet)) actions.push("colonize");
    actions.push("attack", "stop", "hold", "guard", "retreat", "retreatTo", "emergencyRetreatTo", "merge");
    return actions;
  }

  private createFleetSelectionData(fleet: ServerFleet): SelectionData {
    const owner = this.getFaction(fleet.ownerId);
    const ships = this.getShipsForFleet(fleet.id);
    const shipCount = fleet.shipIds.length || ships.length || 1;
    const defense = this.getFleetDefense(fleet.id);
    const actions = this.getFleetActions(fleet);
    const doctrine = fleet.combatSettings
      ? `${fleet.combatSettings.engagementRule ?? "defendSystem"} | ${fleet.combatSettings.doctrine ?? "line"} | ${fleet.combatSettings.retreatPreset ?? "preserveFleet"}`
      : this.formatFleetNavigationDetail(fleet);
    return {
      type: "fleet",
      id: fleet.id,
      readoutId: this.formatFleetReadoutId(fleet),
      name: fleet.stationaryStarbaseId
        ? `${owner?.name ?? "Unidentified"} Defense Platforms`
        : owner ? `${owner.name} Fleet` : "Unidentified Fleet",
      hp: defense.hull,
      maxHp: defense.maxHull,
      shield: defense.shield,
      maxShield: defense.maxShield,
      armor: defense.armor,
      maxArmor: defense.maxArmor,
      hull: defense.hull,
      maxHull: defense.maxHull,
      shipCount,
      ships: this.createSelectionShipRows(fleet, owner),
      class: fleet.stationaryStarbaseId ? `${shipCount} Stationary Platform${shipCount === 1 ? "" : "s"}` : shipCount === 1 ? "Single-Ship Fleet" : `${shipCount} Ships`,
      status: fleet.combatStatus && fleet.combatStatus !== "idle" ? fleet.combatStatus : this.formatFleetStatus(fleet),
      detail: fleet.ownerId === this.playerFactionId
        ? doctrine
        : "Foreign fleet. Tactical details are limited.",
      movement: this.createFleetMovementSelectionData(fleet),
      ownerName: owner?.name ?? "Unknown",
      ownerColor: owner?.color,
      canCommand: fleet.ownerId === this.playerFactionId && !fleet.stationaryStarbaseId,
      actions: fleet.ownerId === this.playerFactionId && !fleet.stationaryStarbaseId ? actions : undefined,
      engagementRule: fleet.combatSettings.engagementRule ?? "defendSystem",
      doctrine: fleet.combatSettings.doctrine ?? "line",
      retreatPreset: fleet.combatSettings.retreatPreset ?? "preserveFleet",
      repairTargets: ships.some((ship) => ship.shipKind === "constructionShip") ? this.getFieldRepairTargets(fleet) : undefined,
      activeRepairTargetFleetId: fleet.repairOrder?.targetFleetId ?? null,
      repairStatus: fleet.repairOrder ? `${fleet.repairOrder.stage}${fleet.combatStatus !== "idle" ? " (paused during combat)" : ""}` : null,
      leader: this.getAssignedLeader("fleet", fleet.id),
    };
  }

  private createFleetMovementSelectionData(fleet: ServerFleet): SelectionData["movement"] {
    if (!fleet.movementPlan) return undefined;
    const destination = fleet.movementPlan.destinationPlanetId
      ? this.getPlanetName(fleet.movementPlan.destinationPlanetId)
      : (fleet.movementPlan.destinationOrbitTarget
        ? this.formatOrbitTargetName(fleet.movementPlan.destinationOrbitTarget)
        : this.star.id === fleet.movementPlan.destinationStarId
          ? this.star.name
          : `Star ${fleet.movementPlan.destinationStarId}`);
    return {
      destination,
      arrivalYear: fleet.movementPlan.endsAtYear,
    };
  }

  private createSelectionShipRows(fleet: ServerFleet, owner: FactionInfo | null): SelectionShipData[] {
    const order = new Map(fleet.shipIds.map((shipId, index) => [shipId, index]));
    return this.getShipsForFleet(fleet.id)
      .slice()
      .sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER))
      .map((ship, index) => {
        const hull = SHIP_HULL_DEFINITIONS[ship.shipKind];
        const design = ship.designId
          ? this.shipDesigns.find((candidate) => candidate.id === ship.designId && candidate.ownerId === ship.ownerId)
          : undefined;
        const shipCode = `${this.formatFactionShipPrefix(owner, ship.ownerId)}S-${String(index + 1).padStart(2, "0")}`;
        return {
          id: ship.id,
          shipKind: ship.shipKind,
          name: `${shipCode} ${this.formatShipDisplayName(design, hull?.baseClassName ?? hull?.label ?? ship.shipKind)}`,
          designName: design?.name ?? `${hull?.baseClassName ?? hull?.label ?? ship.shipKind}-class`,
          className: hull?.label ?? this.formatPolicyLikeValue(ship.shipKind),
          shield: ship.shield,
          maxShield: ship.maxShield,
          armor: ship.armor,
          maxArmor: ship.maxArmor,
          hull: ship.hull,
          maxHull: ship.maxHull,
          ownerColor: owner?.color,
        };
      });
  }

  private formatFleetReadoutId(fleet: ServerFleet): string {
    return `CF-${String(fleet.ownerId + 1).padStart(3, "0")}`;
  }

  private formatFactionShipPrefix(owner: FactionInfo | null, ownerId: number): string {
    const colorMatch = owner?.name.match(/^Color\s+(\d+)$/i);
    if (colorMatch) return `C${colorMatch[1]}`;
    if (owner?.name) {
      const initials = owner.name
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 2)
        .toUpperCase();
      if (initials) return initials;
    }
    return `F${ownerId + 1}`;
  }

  private formatShipDisplayName(design: ShipDesign | undefined, fallback: string): string {
    const raw = design?.name ?? fallback;
    const withoutClass = raw
      .replace(/-class\s+.*/i, "")
      .replace(/\s+class\s+.*/i, "")
      .trim();
    return withoutClass || raw;
  }

  private formatPolicyLikeValue(value: string): string {
    return value
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (char) => char.toUpperCase());
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
      this.systemStore?.setSelectedFleetIds([]);
      this.clearFleetAction();
      this.notifyFleetSelectionChanged();
    }
  }

  private clearFleetSelection(): void {
    if (this.selectedFleetIds.size === 0 && !this.selectedFleetId) return;
    this.selectedFleetIds.clear();
    this.selectedFleetId = null;
    this.systemStore?.setSelectedFleetIds([]);
    this.selectionPanel?.clear();
    this.disposeSelectedFleetRouteLine();
    this.clearFleetAction();
    this.notifyFleetSelectionChanged();
  }

  private notifyFleetSelectionChanged(): void {
    this.options.onSelectedFleetIdsChange?.(Array.from(this.selectedFleetIds));
    void this.refreshPlayerShipFromSelection();
  }

  private handleSelectedFleetAction(action: ShipAction, selection?: SelectionData): void {
    if (selection?.id && this.selectedFleetIds.has(selection.id)) {
      this.selectedFleetId = selection.id;
    }
    this.beginFleetAction(action);
  }

  private openStarbasePanel(starbase: ServerStarbaseSummary): void {
    const owner = this.getFaction(starbase.ownerId);
    this.clearFleetSelection();
    this.starbasePanel.show({
      id: starbase.id,
      name: `${this.star.name} Station`,
      systemName: `${this.star.name} System`,
      ownerName: owner?.name,
      ownerColor: owner?.color,
      status: starbase.status,
      power: this.formatStarbasePower(starbase),
      fleets: this.serverFleets,
      ships: this.serverShips,
      shipDesigns: this.shipDesigns,
      technology: this.options.technology,
      nebulaKind: this.options.nebula?.kind ?? null,
      onStarbaseCommand: (command) => this.options.onPlanetCommand?.(command),
      onClose: (starbaseId) => this.options.onReleaseStarbaseDetails?.(starbaseId),
    });
    void this.options.onRequestStarbaseDetails?.(starbase.id).then((detail) => {
      if (detail) this.starbasePanel.refreshStarbase(detail);
    });
  }

  private getFaction(ownerId: number): FactionInfo | null {
    return this.factions.find((faction) => faction.id === ownerId) ?? null;
  }

  private factionColorCss(faction: FactionInfo | null, fallback: string): string {
    if (!faction) return fallback;
    const [r, g, b] = faction.color.map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255));
    return `rgba(${r}, ${g}, ${b}, 0.95)`;
  }

  private getShipsForFleet(fleetId: string): ServerShip[] {
    return this.serverShips.filter((ship) => ship.fleetId === fleetId);
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

  private formatFleetPower(fleet: ServerFleet, index: number): string {
    const ships = this.getShipsForFleet(fleet.id);
    const value = computeFleetPower(ships, Math.max(1, fleet.shipIds.length), undefined, this.shipDesigns);
    return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : `${Math.round(value / 1000)}K`;
  }

  private formatStarbasePower(starbase: ServerStarbaseSummary): string {
    const power = computeStarbasePower(starbase);
    return power >= 1_000_000 ? `${(power / 1_000_000).toFixed(1)}M` : `${Math.round(power / 1000)}K`;
  }

  private formatFleetStatus(fleet: ServerFleet): string {
    if (fleet.combatStatus === "engaging" || fleet.combatStatus === "firing" || fleet.combatStatus === "retreating") {
      return fleet.combatStatus;
    }
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

    this.renderDebugState = {
      starOccluded: occluded,
      starOccluderName: pick?.pickedMesh?.name ?? null,
    };

    const target = occluded ? this.glowBaseIntensity * 0.12 : this.glowBaseIntensity;
    const current = this.glowLayer.intensity;
    this.glowLayer.intensity = current + (target - current) * 0.18;
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
    this.detailTexturePath = "/textures/star_surface.webp";

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
        this.detailTexturePath = "/textures/gas_giant.webp";

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
    const generated = createProceduralSpaceSkybox(this.scene, {
      name: "systemSkybox",
      materialName: "systemSkyboxMat",
      size: 4000,
      render: getSystemSkyboxSettings(this.star, this.options.nebula ?? null),
      textureLevel: 0.9,
      environmentIntensity: 0.38,
    });
    if (generated) return;

    const bgSphere = MeshBuilder.CreateSphere(
      "systemBackground",
      { diameter: 4000, segments: 20 },
      this.scene,
    );
    const bgMat = new StandardMaterial("systemBackgroundMat", this.scene);
    bgMat.emissiveTexture = new Texture("/textures/galaxy_bg.webp", this.scene);
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
    this.effectsRenderer = new SystemEffectsRenderer(this.scene, this.glowLayer, {
      maxBeams: 96,
      maxProjectiles: 180,
      maxPulses: 96,
      maxParticles: 56,
    });
    this.actionTargetRenderer = new SystemActionTargetRenderer(this.scene, this.glowLayer, {
      color: SYSTEM_ACTION_MARKER_COLOR,
      pulseSpeed: SYSTEM_ACTION_MARKER_PULSE_SPEED,
      rotationSpeed: SYSTEM_ACTION_MARKER_ROTATION_SPEED,
    });
    this.scene.ambientColor = new Color3(0.18, 0.2, 0.24);
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
    this.starMesh.isPickable = true;

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
    this.refreshHyperlaneExits();
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
    if (!this.hasPlayerShipPresence() || this.playerShipRoot) return;

    this.playerShipBasePosition = PLAYER_SHIP_BASE_POSITION.clone();
    this.playerShipTargetPosition = PLAYER_SHIP_BASE_POSITION.clone();
    const primaryFleet = this.getPlayerShipFleetCandidate();
    const serverPosition = primaryFleet ? this.getFleetRenderPosition(primaryFleet) : null;
    if (serverPosition) {
      this.playerShipBasePosition.set(serverPosition.x, serverPosition.y, serverPosition.z);
      this.playerShipTargetPosition.copyFrom(this.playerShipBasePosition);
    }

    if (primaryFleet) {
      const primaryShip = this.getPreferredShipForFleet(primaryFleet);
      if (primaryShip) {
        this.playerShipKind = primaryShip.shipKind;
        this.playerShipFleetId = primaryFleet.id;
      }
    }
    
    this.playerShipRoot = new TransformNode("playerShipRoot", this.scene);
    this.playerShipRoot.position = this.playerShipBasePosition.clone();
    // Apply initial per-model orientation if available
    const initialModelDef = SHIP_MODEL_DEFINITIONS[this.playerShipKind];
    const initPitch = typeof initialModelDef.modelPitch === "number" ? initialModelDef.modelPitch : PLAYER_SHIP_MODEL_PITCH;
    const initRoll = typeof initialModelDef.modelRoll === "number" ? initialModelDef.modelRoll : PLAYER_SHIP_MODEL_ROLL;
    const initYaw = -0.7 + (typeof initialModelDef.modelYawOffset === "number" ? initialModelDef.modelYawOffset : 0);
    this.playerShipRoot.rotation.set(initPitch, initYaw, initRoll);

    try {
      const modelDef = SHIP_MODEL_DEFINITIONS[this.playerShipKind];
      const assetRoot = await this.assetRegistry.instantiate(
        this.getShipAssetDefinition(
          this.playerShipKind,
          "playerShip",
          modelDef.systemTargetSize ?? PLAYER_SHIP_TARGET_SIZE,
        ),
        "playerShipAssetRoot",
      );
      if (!assetRoot) {
        throw new Error(`${modelDef.modelFile} did not produce renderable meshes.`);
      }
      assetRoot.parent = this.playerShipRoot;
      for (const mesh of assetRoot.getChildMeshes()) {
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
      }

      if (modelDef.trailSocketName) {
        const socket = this.findDescendantByName(assetRoot, modelDef.trailSocketName);
        if (socket) {
          this.playerShipTrailAttachmentPoint = this.createTrailSocketAnchorNode(socket, modelDef, "playerShipTrailAnchor");
        } else {
          console.warn(`Trail socket "${modelDef.trailSocketName}" not found; using configured offset.`);
        }
      }

      this.createPlayerShipReadabilityLight();
    } catch (err) {
      console.warn("Failed to load player ship model; using procedural fallback.", err);
      this.createFallbackPlayerShip();
    }
  }

  private applyBasicShipMaterialStyle(material: Material | null): void {
    this.applyReadableModelMaterialStyle(material, {
      diffuse: new Color3(1.08, 1.12, 1.16),
      ambient: new Color3(0.48, 0.54, 0.62),
      specular: new Color3(0.92, 0.96, 1.0),
      emissive: new Color3(0.055, 0.075, 0.095),
      pbrEmissive: new Color3(0.075, 0.095, 0.115),
    });
  }

  private applyStarbaseMaterialStyle(material: Material | null): void {
    this.applyReadableModelMaterialStyle(material, {
      diffuse: new Color3(1.12, 1.13, 1.12),
      ambient: new Color3(0.55, 0.58, 0.62),
      specular: new Color3(0.95, 0.94, 0.9),
      emissive: new Color3(0.08, 0.095, 0.11),
      pbrEmissive: new Color3(0.1, 0.115, 0.13),
    });
  }

  private applyReadableModelMaterialStyle(
    material: Material | null,
    colors: {
      diffuse: Color3;
      ambient: Color3;
      specular: Color3;
      emissive: Color3;
      pbrEmissive: Color3;
    },
  ): void {
    if (!material) return;

    if (material instanceof MultiMaterial) {
      for (const subMaterial of material.subMaterials) {
        this.applyReadableModelMaterialStyle(subMaterial, colors);
      }
      return;
    }

    if (material instanceof PBRMaterial) {
      material.albedoColor = colors.diffuse;
      material.emissiveColor = colors.pbrEmissive;
      material.emissiveIntensity = Math.max(material.emissiveIntensity ?? 0, 0.75);
      material.environmentIntensity = Math.max(material.environmentIntensity ?? 0, 0.9);
      material.metallic = Math.min(material.metallic ?? 0.45, 0.65);
      material.roughness = Math.min(material.roughness ?? 0.7, 0.62);
      return;
    }

    if (!(material instanceof StandardMaterial)) {
      return;
    }

    material.disableLighting = false;
    material.diffuseColor = colors.diffuse;
    material.ambientColor = colors.ambient;
    material.specularColor = colors.specular;
    material.emissiveColor = colors.emissive;
    material.specularPower = 135;
  }

  private createPlayerShipReadabilityLight(): void {
    if (!this.playerShipRoot || this.playerShipLight) return;

    this.playerShipLight = new PointLight(
      "playerShipSoftFill",
      new Vector3(0, 7, -9),
      this.scene,
    );
    this.playerShipLight.parent = this.playerShipRoot;
    this.playerShipLight.intensity = 1.15;
    this.playerShipLight.range = 38;
    this.playerShipLight.diffuse = new Color3(0.74, 0.82, 0.92);
    this.playerShipLight.specular = new Color3(0.9, 0.94, 1.0);
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

  private getGroupShipFormationPosition(_groupId: string, position: SystemPosition, shipIds: string[], shipId: string): Vector3 {
    const formed = getLayeredFleetFormationPosition(
      position,
      SYSTEM_FLEET_Y + 0.25,
      shipIds,
      shipId,
    );
    return new Vector3(formed.x, formed.y, formed.z);
  }

  private async ensureTacticalShipTemplate(shipKind: StarbaseShipKind): Promise<void> {
    const modelDef = SHIP_MODEL_DEFINITIONS[shipKind];
    const template = await this.assetRegistry.loadTemplate(
      this.getShipAssetDefinition(
        shipKind,
        "tacticalShip",
        modelDef.tacticalTargetSize ?? TACTICAL_SHIP_TARGET_SIZE,
      ),
    );
    if (!template) {
      console.warn(`Failed to load tactical ship model for ${shipKind}.`);
    }
  }

  private createShipVisualInstance(shipId: string, shipKind: StarbaseShipKind): TransformNode | null {
    const clone = this.assetRegistry.cloneTemplate(`tacticalShip:${shipKind}`, `shipVisual-${shipId}`);
    if (!clone) return null;
    clone.setEnabled(this.starsVisible);
    // Apply per-model orientation overrides if specified
    const modelDef = SHIP_MODEL_DEFINITIONS[shipKind];
    const pitch = typeof modelDef.modelPitch === "number" ? modelDef.modelPitch : PLAYER_SHIP_MODEL_PITCH;
    const roll = typeof modelDef.modelRoll === "number" ? modelDef.modelRoll : PLAYER_SHIP_MODEL_ROLL;
    const yawOffset = typeof modelDef.modelYawOffset === "number" ? modelDef.modelYawOffset : 0;
    clone.rotation.set(pitch, yawOffset, roll);

    // Locate per-instance trail/socket in the cloned hierarchy and store on metadata for runtime sampling
    let instanceTrailAttachment: TransformNode | null = null;
    if (modelDef.trailSocketName) {
      const desc = clone.getDescendants();
      for (const d of desc) {
        if ((d as any).name === modelDef.trailSocketName) {
          instanceTrailAttachment = d as TransformNode;
          break;
        }
      }
    }
    for (const mesh of clone.getChildMeshes()) {
      mesh.isPickable = true;
    }
    // attach initial metadata; more metadata is added later by `setShipVisualMetadata`
    clone.metadata = { shipId, shipKind, trailAttachment: instanceTrailAttachment } as any;
    this.shipVisualRoots.set(shipId, clone);
    this.shipVisualTargets.set(shipId, clone.position.clone());
    return clone;
  }

  private setShipVisualMetadata(
    root: TransformNode,
    metadata: { shipId: string; fleetId?: string | null; shipKind?: StarbaseShipKind },
  ): void {
    // Merge existing metadata (preserve instance-specific fields like trailAttachment)
    const prev = (root.metadata as any) ?? {};
    const merged = { ...prev, ...metadata } as any;
    root.metadata = merged;
    for (const mesh of root.getChildMeshes()) {
      mesh.metadata = merged;
      mesh.isPickable = true;
    }
  }

  private refreshFleetMarkers(views = this.getVisibleFleetViews()): void {
    const definitions: SystemRenderableDefinition[] = views.map((view) => ({
      id: this.getFleetRenderableId(view.id),
      kind: "fleet",
      assetKey: "fleet-pick-volume",
      position: new Vector3(view.position.x, SYSTEM_FLEET_Y + 0.25, view.position.z),
      pickRadius: view.tacticalRadius,
      label: view.name,
      ownerId: view.ownerId,
      visible: this.starsVisible,
      metadata: { fleetId: view.id, view },
    }));
    this.objectRenderer.reconcile(definitions, { scopeKinds: ["fleet"] });
  }

  private getFleetPickMaterial(): StandardMaterial {
    if (!this.fleetPickMaterial) {
      const material = new StandardMaterial("fleetPickVolumeMat", this.scene);
      material.diffuseColor = Color3.Black();
      material.specularColor = Color3.Black();
      material.emissiveColor = Color3.Black();
      material.alpha = this.footprintsVisible ? 0.1 : 0.001;
      material.disableLighting = true;
      this.fleetPickMaterial = material;
    }
    return this.fleetPickMaterial;
  }

  private updateFleetVisualTargetsOnly(): void {
    const views = this.getVisibleFleetViews();
    this.refreshFleetMarkers(views);

    const viewById = new Map(views.map((view) => [view.id, view]));
    for (const [shipId, root] of this.shipVisualRoots) {
      const metadata = root.metadata as { fleetId?: string | null } | null;
      const fleetId = metadata?.fleetId ?? null;
      const view = fleetId ? viewById.get(fleetId) : undefined;
      if (!view) continue;
      this.shipVisualTargets.set(
        shipId,
        this.getGroupShipFormationPosition(`fleet:${view.id}`, view.position, view.shipIds, shipId),
      );
    }

    const playerFleet = this.getPlayerShipFleetCandidate();
    if (this.playerShipRoot && playerFleet) {
      const position = this.getFleetRenderPosition(playerFleet);
      this.playerShipTargetPosition.set(position.x, position.y, position.z);
    }
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
    const starbase = this.getStarbasesInCurrentSystem().find((candidate) => candidate.status === "online") ?? null;
    const position = starbase?.systemPosition ?? null;
    const range = starbase ? this.getStarbaseMaxWeaponRange(starbase) : 0;
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
    this.starbaseRangeRing?.setEnabled(this.starsVisible && this.rangesVisible && range > 0);
  }

  private getStarbaseMaxWeaponRange(starbase: ServerStarbaseSummary): number {
    const mounts = STARBASE_LEVEL_DEFINITIONS[starbase.level]?.combat.weaponMounts ?? [];
    return mounts.reduce((max, mount) => {
      const range = this.rangeBandToSystemDistance(mount.maxRangeBand ?? "close");
      return Math.max(max, Number.isFinite(range) ? range : 0);
    }, 0);
  }

  private rangeBandToSystemDistance(rangeBand: string): number {
    switch (rangeBand) {
      case "pointBlank":
        return 6;
      case "close":
        return 16;
      case "medium":
        return 30;
      case "long":
        return 46;
      case "extreme":
        return 64;
      default:
        return 16;
    }
  }

  private refreshShipVisuals(): void {
    const refreshVersion = ++this.shipVisualRefreshVersion;
    const visibleFleetViews = this.getVisibleFleetViews();
    const liveServerShipIds = new Set(this.serverShips.map((ship) => ship.id));
    const serverShipById = new Map(this.serverShips.map((ship) => [ship.id, ship]));
    const fleetViewByShipId = new Map<string, TacticalFleetView>();
    for (const fleet of visibleFleetViews) {
      for (const shipId of fleet.shipIds) {
        if (liveServerShipIds.has(shipId)) {
          fleetViewByShipId.set(shipId, fleet);
        }
      }
    }
    const shipIds = new Set(fleetViewByShipId.keys());
    const shipKinds = new Set<StarbaseShipKind>();
    for (const shipId of shipIds) {
      const ship = serverShipById.get(shipId);
      shipKinds.add(ship?.shipKind ?? "corvette");
    }
    this.refreshFleetMarkers(visibleFleetViews);
    this.refreshStarbaseCombatRangeRing();

    if (shipIds.size === 0) {
      for (const [, root] of this.shipVisualRoots) {
        root.dispose();
      }
      this.shipVisualRoots.clear();
      this.shipVisualTargets.clear();
      this.disposeAllShipVisualTrails();
      this.refreshFleetMarkers([]);
      if (this.playerShipRoot) {
        this.playerShipRoot.setEnabled(this.starsVisible);
      }
      return;
    }

    void Promise.all(
      Array.from(shipKinds, (shipKind) => this.ensureTacticalShipTemplate(shipKind)),
    ).then(() => {
      if (refreshVersion !== this.shipVisualRefreshVersion) return;

      const latestVisibleFleetViews = this.getVisibleFleetViews();
      const latestLiveServerShipIds = new Set(this.serverShips.map((ship) => ship.id));
      const latestServerShipById = new Map(this.serverShips.map((ship) => [ship.id, ship]));
      const latestFleetViewByShipId = new Map<string, TacticalFleetView>();
      for (const fleet of latestVisibleFleetViews) {
        for (const shipId of fleet.shipIds) {
          if (latestLiveServerShipIds.has(shipId)) {
            latestFleetViewByShipId.set(shipId, fleet);
          }
        }
      }
      const latestShipIds = new Set(latestFleetViewByShipId.keys());
      this.refreshFleetMarkers(latestVisibleFleetViews);
      this.refreshStarbaseCombatRangeRing();

      if (latestShipIds.size === 0) {
        for (const [, root] of this.shipVisualRoots) {
          root.dispose();
        }
        this.shipVisualRoots.clear();
        this.shipVisualTargets.clear();
        this.disposeAllShipVisualTrails();
        this.refreshFleetMarkers([]);
        if (this.playerShipRoot) {
          this.playerShipRoot.setEnabled(this.starsVisible);
        }
        return;
      }

      for (const [shipId, root] of Array.from(this.shipVisualRoots.entries())) {
        if (!latestShipIds.has(shipId)) {
          root.dispose();
          this.shipVisualRoots.delete(shipId);
          this.shipVisualTargets.delete(shipId);
          this.disposeShipVisualTrail(shipId);
        }
      }

      for (const [shipId, fleet] of latestFleetViewByShipId) {
        const ship = latestServerShipById.get(shipId);
        const shipKind = ship?.shipKind ?? "corvette";
        let existingRoot = this.shipVisualRoots.get(shipId);
        const existingKind = (existingRoot?.metadata as { shipKind?: StarbaseShipKind } | null)?.shipKind;
        if (existingRoot && existingKind && existingKind !== shipKind) {
          existingRoot.dispose();
          this.shipVisualRoots.delete(shipId);
          this.shipVisualTargets.delete(shipId);
          this.disposeShipVisualTrail(shipId);
          existingRoot = undefined;
        }
        const root = this.shipVisualRoots.get(shipId) ?? this.createShipVisualInstance(shipId, shipKind);
        if (!root) continue;
        const target = this.getGroupShipFormationPosition(`fleet:${fleet.id}`, fleet.position, fleet.shipIds, shipId);
        if (!existingRoot) {
          root.position.copyFrom(target);
        }
        this.setShipVisualMetadata(root, {
          shipId,
          fleetId: fleet.id,
          shipKind,
        });
        this.shipVisualTargets.set(shipId, target);
      }

      if (this.playerShipRoot) {
        this.playerShipRoot.setEnabled(false);
      }

      this.queueRecentCombatContactEffects();
    });
  }

  private getCombatEntityPosition(entityId: string): Vector3 | null {
    const shipRoot = this.shipVisualRoots.get(entityId);
    if (shipRoot) return shipRoot.position.clone();
    const fleetRoot = this.objectRenderer.getRoot(this.getFleetRenderableId(entityId));
    if (fleetRoot) return fleetRoot.position.clone();
    for (const root of this.shipVisualRoots.values()) {
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
      const from = this.getCombatEntityPosition(contact.sourceId)
        ?? new Vector3(contact.sourcePosition.x, SYSTEM_FLEET_Y + 0.4, contact.sourcePosition.z);
      const to = this.getCombatEntityPosition(contact.targetId)
        ?? new Vector3(contact.targetPosition.x, SYSTEM_FLEET_Y + 0.4, contact.targetPosition.z);
      this.effectsRenderer?.queueCombatContact(contact, from, to);
      effectsQueued += 1;
    }
    if (this.combatContactSeen.size > 320) {
      this.combatContactSeen = new Set(Array.from(this.combatContactSeen).slice(-160));
    }
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
    outerMat.emissiveTexture = new Texture("/textures/star_surface.webp", this.scene);
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
    const texturePath = `${planetCfg.texturePrefix}_0${textureVariantNum}-1024x512.webp`;

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
    const typeIntel = getClientIntelField("planet", planet.id, "type");
    if (typeIntel.status === "unknown") {
      mat.diffuseColor = new Color3(0.28, 0.31, 0.33);
      mat.specularColor = new Color3(0.05, 0.05, 0.05);
    } else {
      const planetTexture = new Texture(texturePath, this.scene);
      planetTexture.hasAlpha = false;
      mat.diffuseTexture = planetTexture;
      mat.specularColor = new Color3(0.12, 0.12, 0.12);
    }
    // Keep a subtle baseline lift for readability without making planets
    // look self-illuminated or washing out the sunlit side.
    mat.emissiveColor = this.planetNightLift.scale(0.2);
    mat.alpha = 1.0;
    mat.useAlphaFromDiffuseTexture = false;
    mat.transparencyMode = Material.MATERIAL_OPAQUE;
    mat.forceDepthWrite = true;
    mesh.material = mat;
    mesh.isPickable = true;
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
    const axialPhase = Number.isFinite(planet.orbitPhaseAtEpoch)
      ? (planet.orbitPhaseAtEpoch / (Math.PI * 2)) % 1
      : 0;
    this.orbitSystem.addBody({
      mesh,
      getSystemPosition,
      axialRotationSpeed: 0.18 + axialPhase * 0.22,
    });
  }

  private getHyperlaneExitMaterial(): StandardMaterial {
    if (!this.hyperlaneExitMaterial) {
      const material = new StandardMaterial("systemHyperlaneExitMat", this.scene);
      material.emissiveColor = new Color3(0.32, 0.75, 1.0);
      material.diffuseColor = new Color3(0.08, 0.22, 0.32);
      material.specularColor = new Color3(0.35, 0.75, 1.0);
      material.alpha = 0.78;
      this.hyperlaneExitMaterial = material;
    }
    return this.hyperlaneExitMaterial;
  }

  private refreshHyperlaneExits(): void {
    const definitions: SystemRenderableDefinition[] = this.hyperlaneExits.map((exit) => {
      const position = exit.systemPosition ?? getHyperlaneExitSystemPosition(exit);
      return {
        id: this.getHyperlaneRenderableId(exit.starId),
        kind: "hyperlane",
        assetKey: "hyperlane-exit",
        position: new Vector3(position.x, SYSTEM_HYPERLANE_EXIT_MARKER_Y, position.z),
        label: exit.name,
        visible: this.starsVisible,
        metadata: { connectedStarId: exit.starId, exit },
      };
    });
    this.objectRenderer.reconcile(definitions, { scopeKinds: ["hyperlane"] });
  }

  private getHyperlaneExitSignature(exits: HyperlaneExitPoint[]): string {
    return exits
      .map((exit) => [
        exit.starId,
        exit.name,
        exit.dx.toFixed(4),
        exit.dz.toFixed(4),
        exit.systemPosition?.x.toFixed(2) ?? "",
        exit.systemPosition?.z.toFixed(2) ?? "",
      ].join(":"))
      .sort()
      .join("|");
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

  private installObjectLabelClicks(): void {
    this.engine.getRenderingCanvas()?.addEventListener("contextmenu", this.onCanvasContextMenu);
    this.pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type !== PointerEventTypes.POINTERDOWN) return;
      const ev = pointerInfo.event as PointerEvent;

      // Right-click: open the context action menu for the resolved target.
      if (ev.button === 2) {
        ev.preventDefault();
        this.openSystemContextMenu(ev);
        return;
      }
      if (ev.button !== 0) return;
      this.contextMenu.close();

      if (this.tryIssueActiveFleetActionAtPointer(ev)) {
        ev.preventDefault();
        return;
      }
      if (this.trySelectShipVisualAtPointer(ev) || this.trySelectFleetMarkerAtPointer(ev)) {
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

  private trySelectFleetMarkerAtPointer(ev: PointerEvent): boolean {
    const point = this.inputController?.getCanvasPoint(ev);
    if (!point) return false;
    const pick = this.objectRenderer.pick(
      point.canvasX,
      point.canvasY,
      (definition) => definition.kind === "fleet",
    );
    const fleetId = pick?.entry.definition.metadata?.fleetId as string | undefined;
    if (!fleetId) return false;
    const fleet = this.serverFleets.find((candidate) => candidate.id === fleetId);
    if (!fleet) return false;
    this.selectFleetFromCard(fleet, ev.shiftKey);
    this.refreshFleetMarkers();
    return true;
  }

  private trySelectShipVisualAtPointer(ev: PointerEvent): boolean {
    if (this.shipVisualRoots.size === 0) return false;
    const shipMeshes = new Set<Mesh>();
    for (const root of this.shipVisualRoots.values()) {
      for (const mesh of root.getChildMeshes()) shipMeshes.add(mesh as Mesh);
    }
    const pick = this.inputController?.pickWithTolerance(ev, (mesh) => shipMeshes.has(mesh));
    if (!pick?.hit || !pick.pickedMesh) return false;
    const metadata = pick.pickedMesh.metadata as { fleetId?: string | null } | null;
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

  private tryOpenObjectPanelAtPointer(ev: PointerEvent): boolean {
    const objectMeshes = new Set<Mesh>([
      ...this.planetMeshes,
      ...(this.starMesh ? [this.starMesh] : []),
    ]);
    const objectPick = this.inputController?.pickWithTolerance(ev, (mesh) => objectMeshes.has(mesh));
    if (objectPick?.hit && objectPick.pickedMesh) {
      const planetIndex = this.planetMeshes.findIndex((mesh) => mesh === objectPick.pickedMesh);
      if (planetIndex >= 0) {
        const planet = this.planetConfigs[planetIndex];
        if (planet) {
          this.clearFleetSelection();
          void this.showPlanetObjectPanel(planet);
          return true;
        }
      }
      if (objectPick.pickedMesh === this.starMesh) {
        this.clearFleetSelection();
        this.showStarObjectPanel();
        return true;
      }
    }

    return false;
  }

  /**
   * Resolve "what is under the pointer" to a scene-agnostic {@link PointerTarget}.
   * Picks the actual visible meshes (planet spheres, starbase, star, ships, fleet
   * markers, hyperlane gates) so orbit/colonize hit the planet you can see, and
   * falls back to an unclamped ground-plane point for empty space.
   */
  private resolvePointerTarget(ev: PointerEvent): PointerTarget {
    // Planet sphere first — clicking the visible planet must orbit/colonize it.
    const planetPick = this.inputController?.pickWithTolerance(ev, (mesh) => this.planetMeshes.includes(mesh));
    if (planetPick?.hit && planetPick.pickedMesh) {
      const index = this.planetMeshes.findIndex((mesh) => mesh === planetPick.pickedMesh);
      const planet = index >= 0 ? this.planetConfigs[index] : null;
      const mesh = index >= 0 ? this.planetMeshes[index] : null;
      if (planet && mesh) {
        return {
          kind: "planet",
          id: planet.id,
          starId: this.star.id,
          label: planet.name,
          position: { x: mesh.position.x, y: SYSTEM_FLEET_Y, z: mesh.position.z },
        };
      }
    }

    // Starbase structure.
    if (this.starbaseRoot) {
      const starbaseMeshes = new Set<Mesh>(this.starbaseRoot.getChildMeshes().map((mesh) => mesh as Mesh));
      const starbasePick = this.inputController?.pickWithTolerance(ev, (mesh) => starbaseMeshes.has(mesh));
      if (starbasePick?.hit) {
        const starbase = this.getStarbasesInCurrentSystem()[0];
        if (starbase) {
          const position = this.starbaseRoot.position;
          return {
            kind: "starbase",
            id: starbase.id,
            starId: this.star.id,
            ownerId: starbase.ownerId,
            label: "Starbase",
            position: { x: position.x, y: SYSTEM_FLEET_Y, z: position.z },
          };
        }
      }
    }

    // Ships / fleet markers.
    const fleetTarget = this.resolveFleetPointerTarget(ev);
    if (fleetTarget) return fleetTarget;

    // Star body.
    if (this.starMesh) {
      const starPick = this.inputController?.pickWithTolerance(ev, (mesh) => mesh === this.starMesh);
      if (starPick?.hit) {
        return { kind: "star", starId: this.star.id, label: this.star.name, position: getSystemStarOrbitPosition() };
      }
    }

    // Hyperlane gate.
    const point = this.inputController?.getCanvasPoint(ev);
    if (point) {
      const gatePick = this.objectRenderer.pick(point.canvasX, point.canvasY, (definition) => definition.kind === "hyperlane");
      const connectedStarId = gatePick?.entry.definition.metadata?.connectedStarId as number | undefined;
      if (connectedStarId !== undefined) {
        const exit = this.hyperlaneExits.find((candidate) => candidate.starId === connectedStarId);
        const destination = exit
          ? getHyperlaneExitSystemPosition({ dx: -exit.dx, dz: -exit.dz })
          : { x: 0, y: SYSTEM_FLEET_Y, z: 0 };
        return { kind: "hyperlaneGate", starId: this.star.id, toStarId: connectedStarId, label: exit?.name ?? "Hyperlane", position: destination };
      }
    }

    // Empty space → ground-plane point, bounded to the system play area.
    const plane = this.getPointerSystemPlanePosition(ev);
    if (plane) return { kind: "empty", label: "Deep Space", position: plane };
    return { kind: "empty", label: "Deep Space" };
  }

  private resolveFleetPointerTarget(ev: PointerEvent): PointerTarget | null {
    const toTarget = (fleetId: string): PointerTarget | null => {
      const fleet = this.serverFleets.find((candidate) => candidate.id === fleetId);
      if (!fleet) return null;
      return { kind: "fleet", id: fleet.id, ownerId: fleet.ownerId, label: "Fleet", position: this.getFleetRenderPosition(fleet) };
    };

    if (this.shipVisualRoots.size > 0) {
      const shipMeshes = new Set<Mesh>();
      for (const root of this.shipVisualRoots.values()) {
        for (const mesh of root.getChildMeshes()) shipMeshes.add(mesh as Mesh);
      }
      const pick = this.inputController?.pickWithTolerance(ev, (mesh) => shipMeshes.has(mesh));
      const fleetId = (pick?.pickedMesh?.metadata as { fleetId?: string | null } | null)?.fleetId;
      if (fleetId) {
        const target = toTarget(fleetId);
        if (target) return target;
      }
    }

    const point = this.inputController?.getCanvasPoint(ev);
    if (point) {
      const pick = this.objectRenderer.pick(point.canvasX, point.canvasY, (definition) => definition.kind === "fleet");
      const fleetId = pick?.entry.definition.metadata?.fleetId as string | undefined;
      if (fleetId) {
        const target = toTarget(fleetId);
        if (target) return target;
      }
    }
    return null;
  }

  private openSystemContextMenu(ev: PointerEvent): void {
    const target = this.resolvePointerTarget(ev);
    const fleetId = this.getPrimarySelectedFleetId();
    const fleet = fleetId ? this.serverFleets.find((candidate) => candidate.id === fleetId) ?? null : null;
    const ownFleet = fleet && fleet.ownerId === this.playerFactionId ? fleet : null;
    const items = ownFleet
      ? this.buildFleetContextItems(ownFleet, target)
      : this.buildInspectContextItems(target);
    if (items.length === 0) return;
    const title = target.label ?? "Options";
    this.contextMenu.open({ x: ev.clientX, y: ev.clientY, title, items });
  }

  private buildFleetContextItems(fleet: ServerFleet, target: PointerTarget): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];
    const moveHere = (): void => {
      if (target.position) this.issueMoveToSystemPosition(target.position);
    };
    const isHostile = (ownerId: number | null | undefined): boolean =>
      ownerId != null && ownerId !== this.playerFactionId && this.warFactionIds.has(ownerId);

    switch (target.kind) {
      case "planet": {
        const planetId = target.id;
        if (planetId) {
          items.push({ label: `Orbit ${target.label ?? "Planet"}`, onSelect: () => this.options.onFleetCommand?.({ type: "orbitPlanet", fleetId: fleet.id, planetId }) });
          if (this.fleetCanColonize(fleet)) {
            items.push({ label: `Colonize ${target.label ?? "Planet"}`, onSelect: () => this.options.onFleetCommand?.({ type: "colonizePlanet", fleetId: fleet.id, planetId }) });
          }
        }
        if (target.position) items.push({ label: "Move Here", onSelect: moveHere });
        break;
      }
      case "starbase": {
        if (target.position) {
          const orbitTarget = this.createFleetOrbitTarget({
            kind: "starbase", label: "Starbase", starId: this.star.id, starbaseId: target.id,
            position: target.position, markerPosition: target.position,
          });
          items.push({ label: "Orbit Starbase", onSelect: () => this.issueMoveToSystemPosition(target.position!, this.star.id, orbitTarget) });
          items.push({ label: "Move Here", onSelect: moveHere });
        }
        if (isHostile(target.ownerId) && target.id) {
          items.push({ label: "Attack Starbase", onSelect: () => this.options.onFleetCommand?.({ type: "attackTarget", fleetId: fleet.id, targetKind: "starbase", targetId: target.id! }) });
        }
        break;
      }
      case "star": {
        if (target.position) {
          const orbitTarget = this.createFleetOrbitTarget({
            kind: "star", label: this.star.name, starId: this.star.id,
            position: target.position, markerPosition: { x: 0, y: SYSTEM_FLEET_Y, z: 0 },
          });
          items.push({ label: "Orbit Star", onSelect: () => this.issueMoveToSystemPosition(target.position!, this.star.id, orbitTarget) });
        }
        if (this.fleetCanBuildStarbase(fleet)) {
          items.push({ label: "Build Starbase", onSelect: () => this.issueBuildAtStar() });
        }
        break;
      }
      case "hyperlaneGate": {
        if (target.toStarId !== undefined && target.position) {
          items.push({
            label: `Travel to ${target.label ?? "System"}`,
            onSelect: () => this.options.onFleetCommand?.({ type: "moveFleet", fleetId: fleet.id, targetStarId: target.toStarId!, targetSystemPosition: target.position!, orbitTarget: null }),
          });
        }
        break;
      }
      case "fleet": {
        if (isHostile(target.ownerId) && target.id) {
          items.push({ label: "Attack Fleet", onSelect: () => this.options.onFleetCommand?.({ type: "attackTarget", fleetId: fleet.id, targetKind: "fleet", targetId: target.id! }) });
        }
        if (target.position) items.push({ label: "Move Here", onSelect: moveHere });
        break;
      }
      default: {
        if (target.position) items.push({ label: "Move Here", onSelect: moveHere });
        break;
      }
    }
    return items;
  }

  private buildInspectContextItems(target: PointerTarget): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];
    if (target.kind === "planet" && target.id) {
      const planet = this.planetConfigs.find((candidate) => candidate.id === target.id);
      if (planet) items.push({ label: "Open Details", onSelect: () => void this.showPlanetObjectPanel(planet) });
    } else if (target.kind === "star") {
      items.push({ label: "Open Details", onSelect: () => this.showStarObjectPanel() });
    } else if (target.kind === "starbase" && target.id) {
      const starbaseId = target.id;
      items.push({ label: "Open Details", onSelect: () => this.selectStarbaseById(starbaseId) });
    } else if (target.kind === "fleet" && target.id) {
      const fleet = this.serverFleets.find((candidate) => candidate.id === target.id);
      if (fleet) {
        items.push({ label: "Select Fleet", onSelect: () => { this.selectFleetFromCard(fleet, false); this.refreshFleetMarkers(); } });
      }
    }
    return items;
  }

  private async showPlanetObjectPanel(planet: PlanetConfig): Promise<void> {
    const requestSequence = ++this.planetPanelRequestSequence;
    const localState = this.getPlanetState(planet.id);
    const needsRefresh = Boolean(this.options.onRequestPlanetDetails);
    this.renderPlanetObjectPanel(planet, localState, !needsRefresh, requestSequence);
    if (!this.options.onRequestPlanetDetails) return;
    try {
      const details = await this.options.onRequestPlanetDetails(planet.id);
      if (requestSequence !== this.planetPanelRequestSequence) return;
      this.renderPlanetObjectPanel(details.planet, details.planetState, true, requestSequence);
    } catch (error) {
      console.info(error instanceof Error ? error.message : "Information does not exist.");
    }
  }

  private getFieldRepairTargets(constructionFleet: ServerFleet): Array<{ fleetId: string; label: string }> {
    return this.serverFleets
      .filter((fleet) => fleet.id !== constructionFleet.id && fleet.currentStarId === constructionFleet.currentStarId)
      .filter((fleet) => this.getShipsForFleet(fleet.id).some((ship) => ship.hull < ship.maxHull || ship.armor < ship.maxArmor || ship.shield < ship.maxShield || ship.subsystemState?.engineDisabled || (ship.subsystemState?.disabledWeaponKeys.length ?? 0) > 0))
      .map((fleet) => ({ fleetId: fleet.id, label: `${this.getFaction(fleet.ownerId)?.name ?? "Unknown"} · ${fleet.id}` }));
  }

  private renderPlanetObjectPanel(
    panelPlanet: PlanetConfig,
    planetState: PlanetState | undefined,
    interactive: boolean,
    requestSequence: number,
  ): void {
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
      technology: this.options.technology,
      orbitFleetId: this.getOrbitCapableFleetId(),
      assignedLeader: this.getAssignedLeader("planet", panelPlanet.id),
      canManageLeaders: interactive && this.getCurrentStarOwnerId() === this.playerFactionId,
      onPlanetCommand: interactive ? (command) => this.options.onPlanetCommand?.(command) : undefined,
      onClose: (objectId, kind) => {
        if (kind === "planet") {
          if (requestSequence === this.planetPanelRequestSequence) this.planetPanelRequestSequence++;
          this.options.onReleasePlanetDetails?.(objectId);
        }
      },
    });
  }

  private getCurrentStarOwnerId(): number | null {
    const explicitOwner = this.starOwnership[this.star.id];
    if (Number.isInteger(explicitOwner) && explicitOwner >= 0) return explicitOwner;
    return this.starbases.find((starbase) => starbase.starId === this.star.id)?.ownerId ?? null;
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

  showPlanetDetails(planet: PlanetConfig, planetState: PlanetState, interactive = true): void {
    this.planetStates = this.planetStates.filter((candidate) => candidate.id !== planetState.id);
    this.planetStates.push(planetState);
    this.star.system.planets[planetState.planetIndex] = planet;
    this.planetConfigs = this.star.system.planets;
    this.objectPanel.show({
      kind: "planet",
      objectId: planet.id,
      name: planet.name,
      subtitle: `${this.star.name} System`,
      isHabited: planet.isHabited === true,
      objectDetails: planet.objectDetails,
      planetState,
      imageUrl: this.getPlanetTextureUrl(planet),
      accentColor: "rgba(102, 236, 199, 0.95)",
      technology: this.options.technology,
      orbitFleetId: this.getOrbitCapableFleetId(),
      assignedLeader: this.getAssignedLeader("planet", planet.id),
      canManageLeaders: interactive && this.getCurrentStarOwnerId() === this.playerFactionId,
      onPlanetCommand: interactive ? (command) => this.options.onPlanetCommand?.(command) : undefined,
      onClose: (objectId, kind) => {
        if (kind === "planet") this.options.onReleasePlanetDetails?.(objectId);
      },
    });
  }

  isShowingPlanetDetails(planetId: string): boolean {
    return this.objectPanel.isShowing(planetId, "planet");
  }

  private getPlanetTextureUrl(planet: PlanetConfig): string {
    const cfg = PLANET_TYPES[planet.type];
    const variation = String(planet.textureVariation + 1).padStart(2, "0");
    return `${cfg.texturePrefix}_${variation}-1024x512.webp`;
  }

  private getStarBannerTextureUrl(): string {
    return STAR_BANNER_TEXTURES[this.star.type] ?? "/textures/star_surface.webp";
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
      const hasTacticalFleetVisuals = this.shipVisualRoots.size > 0 || this.getVisibleFleetViews().length > 0;
      this.playerShipRoot.setEnabled(visible && !hasTacticalFleetVisuals);
    }
    for (const [, root] of this.shipVisualRoots) {
      root.setEnabled(visible);
    }
    this.objectRenderer.setVisibleForKind("fleet", visible);
    this.objectRenderer.setVisibleForKind("hyperlane", visible);
    this.refreshStarbaseCombatRangeRing();
  }

  setBloomEnabled(enabled: boolean): void {
    this.bloomEnabled = enabled;
    if (this.glowLayer) {
      this.glowLayer.intensity = enabled ? this.glowLayer.intensity : 0;
    }
  }

  setLabelsVisible(visible: boolean): void {
    this.labelsVisible = visible;
    this.labelOverlay?.setVisible(visible);
    if (visible) {
      this.updateSystemLabelOverlay();
    }
  }

  setRangeRingsVisible(visible: boolean): void {
    this.rangesVisible = visible;
    this.refreshStarbaseCombatRangeRing();
  }

  setFootprintsVisible(visible: boolean): void {
    this.footprintsVisible = visible;
    if (this.fleetPickMaterial) {
      this.fleetPickMaterial.alpha = visible ? 0.1 : 0.001;
    }
  }

  setRenderDebugEnabled(enabled: boolean): void {
    this.renderDebugEnabled = enabled;
    if (!enabled) {
      this.renderDebugOverlay?.remove();
      this.renderDebugOverlay = null;
      return;
    }
    this.updateRenderDebugOverlay();
  }

  private updateRenderDebugOverlay(): void {
    if (!this.renderDebugEnabled) return;
    const overlay = this.ensureRenderDebugOverlay();
    overlay.innerHTML = `
      <strong>System Render</strong>
      <span>meshes ${this.scene.meshes.length}</span>
      <span>ships ${this.shipVisualRoots.size}</span>
      <span>fleets ${this.getVisibleFleetViews().length}</span>
      <span>labels ${this.labelsVisible ? "on" : "off"}</span>
      <span>ranges ${this.rangesVisible ? "on" : "off"}</span>
      <span>footprints ${this.footprintsVisible ? "on" : "off"}</span>
      <span>star ${this.renderDebugState.starOccluded ? `occluded by ${this.escapeHtml(this.renderDebugState.starOccluderName ?? "unknown")}` : "clear"}</span>
    `;
  }

  private ensureRenderDebugOverlay(): HTMLDivElement {
    if (this.renderDebugOverlay) return this.renderDebugOverlay;
    if (!document.getElementById("system-render-debug-style")) {
      const style = document.createElement("style");
      style.id = "system-render-debug-style";
      style.textContent = `
.systemRenderDebugOverlay {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 58;
  display: grid;
  gap: 3px;
  min-width: 178px;
  padding: 8px 10px;
  border: 1px solid rgba(126, 218, 255, 0.5);
  border-radius: 4px;
  background: rgba(3, 9, 15, 0.82);
  color: rgba(226, 245, 255, 0.94);
  font: 10px "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
  pointer-events: none;
}

.systemRenderDebugOverlay strong {
  font-size: 11px;
  color: #ffffff;
}
`;
      document.head.appendChild(style);
    }
    const overlay = document.createElement("div");
    overlay.className = "systemRenderDebugOverlay";
    document.body.appendChild(overlay);
    this.renderDebugOverlay = overlay;
    return overlay;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  setFleetSystemPositions(
    positions: Record<string, { x: number; y: number; z: number }>,
    options: { refreshCards?: boolean } = {},
  ): void {
    const refreshCards = options.refreshCards ?? true;
    this.fleetSystemPositions = positions;
    this.playerShipRoot?.setEnabled(false);
    this.refreshShipVisuals();
    if (refreshCards) this.refreshSystemEntityCards();
  }

  setServerFleets(fleets: ServerFleet[]): void {
    this.serverFleets = fleets;
    this.starbasePanel?.refreshMilitaryContext(this.serverFleets, this.serverShips, this.shipDesigns);
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
    this.refreshShipVisuals();
    this.refreshSystemEntityCards();
  }

  setClockYear(year: number): void {
    this.clockYear = year;
    if (this.systemStore) {
      this.systemStore.setClockYear(year);
      this.fleetSystemPositions = this.systemStore.getFleetSystemPositions(year);
      this.updateFleetVisualTargetsOnly();
    }
    this.selectionPanel?.setClockYear(year);
    this.objectPanel?.setClockYear(year);
    this.syncCombatProjectileVisuals();
  }

  selectFleetById(fleetId: string): boolean {
    const fleet = this.serverFleets.find((candidate) => candidate.id === fleetId && candidate.currentStarId === this.star.id);
    if (!fleet) return false;
    this.selectFleetFromCard(fleet, false);
    return true;
  }

  startFleetAction(fleetId: string, action: ShipAction): boolean {
    if (!this.selectFleetById(fleetId)) return false;
    this.beginFleetAction(action);
    return true;
  }

  selectStarbaseById(starbaseId: string): boolean {
    const starbase = this.starbases.find((candidate) => candidate.id === starbaseId && candidate.starId === this.star.id);
    if (!starbase) return false;
    this.openStarbasePanel(starbase);
    return true;
  }

  setServerShips(ships: ServerShip[]): void {
    this.serverShips = ships;
    this.starbasePanel?.refreshMilitaryContext(this.serverFleets, this.serverShips, this.shipDesigns);
    this.refreshShipVisuals();
    this.refreshSystemEntityCards();
  }

  setFactions(factions: FactionInfo[]): void {
    this.factions = factions;
    this.refreshSystemEntityCards();
    if (this.selectedFleetIds.size > 0) this.renderSelectedFleetPanels();
  }

  setShipDesigns(shipDesigns: ShipDesign[]): void {
    this.shipDesigns = shipDesigns;
    this.starbasePanel?.refreshMilitaryContext(this.serverFleets, this.serverShips, this.shipDesigns);
    this.refreshShipVisuals();
    this.refreshSystemEntityCards();
  }

  setRecentCombatContacts(contacts: ServerCombatContact[]): void {
    this.recentCombatContacts = contacts;
    this.queueRecentCombatContactEffects();
  }

  setCombatProjectiles(projectiles: ServerCombatProjectile[]): void {
    this.combatProjectiles = projectiles;
    this.syncCombatProjectileVisuals();
  }

  private syncCombatProjectileVisuals(): void {
    this.effectsRenderer?.syncCombatProjectiles(
      this.combatProjectiles,
      this.clockYear,
      (entityId) => entityId ? this.getCombatEntityPosition(entityId) : null,
    );
  }

  setTechnology(technology: FactionTechnologyView | null): void {
    this.options.technology = technology;
  }

  applySystemPayload(
    payload: SystemDetailPayload,
    context: { leaders?: LeaderState[]; selectedFleetIds?: Iterable<string>; clockYear?: number } = {},
  ): void {
    const clockYear = context.clockYear ?? this.clockYear;
    const previousSelection = Array.from(this.selectedFleetIds).join("\0");
    const storePayload = { ...payload, leaders: context.leaders ?? this.leaders };
    if (this.systemStore) {
      this.systemStore.applyPayload(storePayload);
    } else {
      this.systemStore = new SystemViewStore(storePayload, clockYear);
    }
    this.systemStore.setClockYear(clockYear);
    this.systemStore.setSelectedFleetIds(context.selectedFleetIds ?? this.selectedFleetIds);

    this.star = this.systemStore.getStar();
    this.serverFleets = this.systemStore.getFleets();
    this.serverShips = this.systemStore.getShips();
    this.shipDesigns = this.systemStore.getShipDesigns();
    this.recentCombatContacts = this.systemStore.getRecentCombatContacts();
    this.combatProjectiles = this.systemStore.getCombatProjectiles();
    this.starbases = this.systemStore.getStarbases();
    this.starbaseSystemIds = new Set(this.starbases.map((starbase) => starbase.starId));
    this.factions = this.systemStore.getFactions();
    this.planetStates = this.systemStore.getPlanetStates();
    const previousHyperlaneExitSignature = this.getHyperlaneExitSignature(this.hyperlaneExits);
    this.hyperlaneExits = this.systemStore.getHyperlaneExits();
    const nextHyperlaneExitSignature = this.getHyperlaneExitSignature(this.hyperlaneExits);
    this.leaders = this.systemStore.getLeaders();
    this.options.technology = this.systemStore.getTechnology();

    const ownerId = this.systemStore.getStarOwnerId();
    this.starOwnership = [...this.starOwnership];
    this.starOwnership[this.star.id] = ownerId ?? -1;
    this.fleetSystemPositions = this.systemStore.getFleetSystemPositions(clockYear);
    this.selectedFleetIds = new Set(this.systemStore.getSelectedFleetIds());
    this.selectedFleetId = this.systemStore.getPrimarySelectedFleetId();

    applyPlanetStatesToStars([this.star], this.planetStates);
    this.planetConfigs = this.star.system.planets.length > 0
      ? this.star.system.planets
      : this.planetConfigs;
    this.clockYear = clockYear;
    this.selectionPanel?.setClockYear(clockYear);
    this.objectPanel?.setClockYear(clockYear);
    this.queueRecentCombatContactEffects();
    this.syncCombatProjectileVisuals();

    const nextSelection = Array.from(this.selectedFleetIds).join("\0");
    if (previousSelection !== nextSelection) {
      this.notifyFleetSelectionChanged();
      this.renderSelectedFleetPanels();
    } else if (this.selectedFleetIds.size > 0) {
      this.renderSelectedFleetPanels();
    }

    this.syncStarbasePresence();
    if (previousHyperlaneExitSignature !== nextHyperlaneExitSignature) {
      this.refreshHyperlaneExits();
    }
    this.refreshShipVisuals();
    this.refreshSystemEntityCards();
    this.refreshStarbaseCombatRangeRing();
    this.queueRecentCombatContactEffects();
    if (this.activeFleetAction) {
      this.rebuildSystemActionTargetMarkers();
    }
  }

  setLeaders(leaders: LeaderState[]): void {
    this.leaders = leaders;
    if (this.selectedFleetIds.size > 0) this.renderSelectedFleetPanels();
    const currentObjectId = this.objectPanel?.getCurrentObjectId();
    if (currentObjectId && this.objectPanel?.getCurrentKind() === "planet") {
      this.objectPanel.refreshAssignedLeader(
        currentObjectId,
        this.getAssignedLeader("planet", currentObjectId),
        this.getCurrentStarOwnerId() === this.playerFactionId,
      );
    }
    for (const planetState of this.planetStates) {
      if (planetState.starId !== this.star.id) continue;
      const planet = this.star.system.planets[planetState.planetIndex];
      if (planet) {
        this.objectPanel?.refreshAssignedLeader(
          planet.id,
          this.getAssignedLeader("planet", planet.id),
          this.getCurrentStarOwnerId() === this.playerFactionId,
        );
      }
    }
  }

  setStarOwnerships(ownerByStar: number[]): void {
    this.starOwnership = ownerByStar;
    if (this.activeFleetAction) {
      this.rebuildSystemActionTargetMarkers();
    }
  }

  setDiplomacyMovement(diplomacy: DiplomacyMovementPayload | undefined): void {
    this.applyDiplomacyMovement(diplomacy);
    if (this.activeFleetAction) {
      this.rebuildSystemActionTargetMarkers();
    }
  }

  private applyDiplomacyMovement(diplomacy: DiplomacyMovementPayload | undefined): void {
    this.openBorderFactionIds = new Set(diplomacy?.openBorderFactionIds ?? []);
    this.warFactionIds = new Set(diplomacy?.warFactionIds ?? []);
  }

  private syncStarbasePresence(): void {
    if (this.starbaseSystemIds.has(this.star.id)) {
      const level = this.getCurrentStarbaseVisualLevel();
      if (this.starbaseRoot && this.starbaseVisualLevel === level) {
        this.starbaseRoot.setEnabled(true);
        return;
      }
      if (this.starbaseRoot) this.disposeStarbaseVisuals();
      void this.createStarbaseIfPresent().then(() => {
        this.refreshStarbaseCombatRangeRing();
        this.refreshSystemEntityCards();
      });
      return;
    }

    this.disposeStarbaseVisuals();
    this.disposeStarbaseCombatRangeRing();
  }

  private getAssignedLeader(kind: "planet" | "fleet", targetId: string): LeaderState | null {
    return this.leaders.find((leader) => (
      leader.status === "recruited"
      && leader.assignment?.kind === kind
      && leader.assignment.targetId === targetId
    )) ?? null;
  }

  setStarbaseSystemIds(starIds: Iterable<number>): void {
    this.starbaseSystemIds = new Set(starIds);
    if (this.starbaseSystemIds.has(this.star.id)) {
      const level = this.getCurrentStarbaseVisualLevel();
      if (this.starbaseRoot && this.starbaseVisualLevel === level) {
        this.starbaseRoot.setEnabled(true);
        this.refreshStarbaseCombatRangeRing();
        this.refreshSystemEntityCards();
        return;
      }
      if (this.starbaseRoot) this.disposeStarbaseVisuals();
      void this.createStarbaseIfPresent().then(() => {
        this.refreshStarbaseCombatRangeRing();
        this.refreshSystemEntityCards();
      });
      return;
    }

    this.disposeStarbaseVisuals();
    this.disposeStarbaseCombatRangeRing();
    this.refreshSystemEntityCards();
  }

  setServerStarbases(starbases: ServerStarbaseSummary[]): void {
    this.starbases = starbases;
    this.starbaseSystemIds = new Set(this.starbases.map((starbase) => starbase.starId));
    this.syncStarbasePresence();
    this.refreshStarbaseCombatRangeRing();
    this.refreshSystemEntityCards();
  }

  refreshStarbaseDetails(starbase: ServerStarbase): void {
    this.starbasePanel?.refreshStarbase(starbase);
  }

  setPlanetStates(planetStates: PlanetState[]): void {
    this.planetStates = planetStates;
    applyPlanetStatesToStars([this.star], planetStates);
    this.planetConfigs = this.star.system.planets.length > 0
      ? this.star.system.planets
      : this.planetConfigs;

    for (const planetState of planetStates) {
      if (planetState.starId !== this.star.id) continue;
      const planet = this.star.system.planets[planetState.planetIndex];
      if (planet) {
        this.objectPanel?.refreshPlanetState(planet.id, planetState, planet.objectDetails, planet.isHabited === true);
      }
    }
    this.refreshSystemEntityCards();
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
    this.refreshSystemEntityCards();
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onEscapeKey);
    this.engine.getRenderingCanvas()?.removeEventListener("contextmenu", this.onCanvasContextMenu);
    this.contextMenu.dispose();
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
      this.pointerObserver = null;
    }
    this.objectPanel?.dispose();
    this.selectionPanel?.clear();
    this.starbasePanel?.dispose();
    for (const [, root] of this.shipVisualRoots) {
      root.dispose();
    }
    this.shipVisualRoots.clear();
    this.shipVisualTargets.clear();
    this.disposeAllShipVisualTrails();
    this.objectRenderer.dispose();
    this.fleetPickMaterial?.dispose();
    this.fleetPickMaterial = null;
    this.disposeStarbaseCombatRangeRing();
    this.disposeStarbaseVisuals();
    this.effectsRenderer?.dispose();
    this.effectsRenderer = null;
    this.nebulaEnvironment?.dispose();
    this.nebulaEnvironment = null;
    this.hyperlaneExitMaterial?.dispose();
    this.hyperlaneExitMaterial = null;
    this.disposePlayerShipTrail();
    this.disposeSelectedFleetRouteLine();
    this.actionTargetRenderer?.dispose();
    this.actionTargetRenderer = null;
    this.assetRegistry.dispose();
    this.labelOverlay?.dispose();
    this.labelOverlay = null;
    this.renderDebugOverlay?.remove();
    this.renderDebugOverlay = null;
    this.orbitSystem.dispose();
    this.camera?.detachControl();
    this.scene.dispose();
  }
}
