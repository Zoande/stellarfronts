import type { FactionInfo, GalaxyPerspective } from "../data/Factions";
import type {
  BuildingKind,
  BuildingSlotArea,
  DistrictKind,
  FactionEconomyState,
  PlanetState,
  UrbanSubDistrictKind,
} from "../data/Economy";
import type {
  StarbaseConstructionQueueItem,
  StarbaseEconomy,
  StarbaseBuildingKind,
  StarbaseLevel,
  StarbaseShipKind,
  StarbaseShipQueueItem,
} from "../data/Starbase";
import type { ShipDesign } from "../data/ShipDesigns";
import type { PlanetConfig, StarData } from "../data/StarMap";
import type { SystemPosition } from "../data/SystemCoordinates";
import type {
  CombatTargetKind,
  CombatStance,
  FleetBehavior,
  FleetChasePolicy,
  FleetRetreatPolicy,
  FleetTacticalOrderType,
} from "./CombatTypes";
import type { AdminCommandContext, AdminCommandResult } from "./AdminCommands";

export type ShipAction = "move" | "build" | "attack" | "merge" | "retreat" | "retreatTo" | "emergencyRetreatTo";

export type FleetFormation = "line" | "vanguard" | "echelon" | "defensive";

export type ShipTransitPhase =
  | "idle"
  | "departingSystem"
  | "jumpingHyperlane"
  | "arrivingSystem"
  | "buildingStarbase"
  | "movingSystem"
  | "orbitingPlanet"
  | "orbiting"
  | "missingInAction";

export interface GameClock {
  year: number;
  speedMultiplier: number;
  tickSizeDays: number;
  tickSpeedSeconds: number;
  paused: boolean;
  syncedAtMs: number;
}

export type ServerUpdateField =
  | "clock"
  | "visibility"
  | "planetStates"
  | "habitedPlanetSystems"
  | "factionEconomies"
  | "ships"
  | "shipDesigns"
  | "fleets"
  | "starbases"
  | "combatContacts";

export interface ServerStar extends StarData {}

export interface FactionState extends FactionInfo {
  discoveredStarIds: number[];
}

export interface ServerStarbase {
  id: string;
  ownerId: number;
  starId: number;
  systemPosition: ShipSystemPosition;
  status: "online" | "building";
  buildProgress: number;
  shield: number;
  maxShield: number;
  armor: number;
  maxArmor: number;
  hull: number;
  maxHull: number;
  weaponCooldowns?: Record<string, number>;
  lastShieldDamageAtYear?: number | null;
  level: StarbaseLevel;
  economy: StarbaseEconomy;
  buildingSlots: Array<StarbaseBuildingKind | null>;
  constructionQueue: StarbaseConstructionQueueItem[];
  shipQueue: StarbaseShipQueueItem[];
}

export type ShipSystemPosition = SystemPosition;

export interface ShipHyperlanePosition {
  fromStarId: number;
  toStarId: number;
  progress: number;
}

export type FleetOrderType = "move" | "build" | "orbit" | "merge" | "retreat" | null;

export type FleetOrbitTargetKind = "star" | "planet" | "starbase" | "hyperlane" | "fleet";

export interface FleetOrbitTarget {
  kind: FleetOrbitTargetKind;
  starId: number;
  position: ShipSystemPosition;
  planetId?: string | null;
  starbaseId?: string | null;
  connectedStarId?: number | null;
  targetFleetId?: string | null;
}

export type FleetMovementSegmentKind = "system" | "hyperlane" | "orbit";

export interface FleetMovementSegment {
  kind: FleetMovementSegmentKind;
  fromStarId: number;
  toStarId: number;
  startYear: number;
  endYear: number;
  from: ShipSystemPosition;
  to: ShipSystemPosition;
  targetPlanetId?: string | null;
}

export interface FleetMovementPlan {
  destinationStarId: number;
  destinationPlanetId?: string | null;
  destinationPosition?: ShipSystemPosition | null;
  destinationOrbitTarget?: FleetOrbitTarget | null;
  startedAtYear: number;
  endsAtYear: number;
  totalDays: number;
  segments: FleetMovementSegment[];
}

export type FleetRetreatMode = "system" | "emergencyFtl";
export type FleetRetreatStatus = "ordered" | "escaping" | "mia" | "completed";

export interface FleetRetreatState {
  mode: FleetRetreatMode;
  status: FleetRetreatStatus;
  targetStarId: number;
  targetSystemPosition?: ShipSystemPosition | null;
  startedAtYear: number;
  miaUntilYear?: number | null;
  riskApplied?: boolean;
}

export interface FleetRetreatDestination {
  kind: "nearestFriendlyStarbase" | "selectedSystem";
  targetStarId?: number | null;
  targetSystemPosition?: ShipSystemPosition | null;
}

export interface FleetCombatSettings {
  behavior: FleetBehavior;
  chasePolicy: FleetChasePolicy;
  retreatPolicy: FleetRetreatPolicy;
  retreatDestination?: FleetRetreatDestination | null;
}

export interface FleetTacticalOrder {
  type: FleetTacticalOrderType;
  targetId?: string | null;
  targetKind?: CombatTargetKind | null;
  targetPosition?: ShipSystemPosition | null;
  guardPosition?: ShipSystemPosition | null;
  issuedAtYear?: number | null;
}

export type FleetCombatStatus = "idle" | "maneuvering" | "engaging" | "firing" | "evading" | "retreating" | "destroyed";

export interface ServerShip {
  id: string;
  ownerId: number;
  fleetId: string;
  shipKind: StarbaseShipKind;
  designId?: string;
  speed: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  armor: number;
  maxArmor: number;
  hull: number;
  maxHull: number;
  weaponCooldowns?: Record<string, number>;
}

export interface ServerFleet {
  id: string;
  ownerId: number;
  shipIds: string[];
  formation: FleetFormation;
  currentStarId: number;
  targetStarId: number | null;
  phase: ShipTransitPhase;
  phaseStartedAtYear: number;
  phaseDurationDays: number;
  route: number[];
  routeIndex: number;
  phaseProgress: number;
  orderType: FleetOrderType;
  speed: number;
  combatStance: CombatStance;
  retreatState: FleetRetreatState | null;
  systemPosition: ShipSystemPosition;
  hyperlanePosition: ShipHyperlanePosition | null;
  movementPlan: FleetMovementPlan | null;
  orbitTargetPlanetId: string | null;
  orbitOffset: ShipSystemPosition | null;
  orbitTarget: FleetOrbitTarget | null;
  mergeTargetFleetId: string | null;
  combatSettings: FleetCombatSettings;
  currentTacticalOrder?: FleetTacticalOrder | null;
  tacticalRadius: number;
  maxWeaponRange: number;
  minWeaponRange: number;
  currentTargetId?: string | null;
  currentTargetKind?: CombatTargetKind | null;
  combatStatus: FleetCombatStatus;
  lastCombatAtYear?: number | null;
}

export interface ServerCombatContact {
  id: string;
  year: number;
  sourceId: string;
  sourceKind: CombatTargetKind;
  sourceOwnerId: number;
  targetId: string;
  targetKind: CombatTargetKind;
  targetOwnerId: number;
  weaponId?: string;
  weaponName?: string;
  hit: boolean;
  accuracyMiss?: boolean;
  dodged?: boolean;
  shieldDamage: number;
  armorDamage: number;
  hullDamage: number;
  targetDestroyed: boolean;
  sourcePosition: ShipSystemPosition;
  targetPosition: ShipSystemPosition;
}

export interface MoveCommand {
  type: "moveFleet" | "moveShip";
  fleetId?: string;
  shipId?: string;
  targetStarId: number;
  targetSystemPosition?: ShipSystemPosition;
  orbitTarget?: FleetOrbitTarget | null;
}

export interface BuildCommand {
  type: "buildStarbase";
  fleetId?: string;
  shipId?: string;
  targetStarId: number;
}

export interface OrbitPlanetCommand {
  type: "orbitPlanet";
  fleetId: string;
  planetId: string;
}

export interface MergeFleetsCommand {
  type: "mergeFleets";
  targetFleetId: string;
  sourceFleetIds: string[];
}

export interface SetSpeedCommand {
  type: "setSpeedMultiplier";
  multiplier: number;
}

export interface BuildDistrictCommand {
  type: "buildDistrict";
  planetId: string;
  districtKind: DistrictKind;
}

export interface BuildPlanetBuildingCommand {
  type: "buildPlanetBuilding";
  planetId: string;
  area: BuildingSlotArea;
  slotIndex: number;
  buildingKind: BuildingKind;
  subDistrictIndex?: number;
}

export interface SetUrbanSubDistrictCommand {
  type: "setUrbanSubDistrict";
  planetId: string;
  subDistrictIndex: number;
  subDistrictKind: UrbanSubDistrictKind;
}

export interface BuildStarbaseBuildingCommand {
  type: "buildStarbaseBuilding";
  starbaseId: string;
  slotIndex: number;
  buildingKind: StarbaseBuildingKind;
}

export interface UpgradeStarbaseCommand {
  type: "upgradeStarbase";
  starbaseId: string;
}

export interface BuildStarbaseShipCommand {
  type: "buildStarbaseShip";
  starbaseId: string;
  shipKind: StarbaseShipKind;
  designId?: string;
}

export interface SaveShipDesignCommand {
  type: "saveShipDesign";
  designId?: string;
  shipKind: StarbaseShipKind;
  name: string;
  weaponSectionModuleIds?: string[];
  defenseSectionModuleIds?: string[];
  weaponModuleIds: string[];
  defenseModuleIds: string[];
  utilityModuleIds?: string[];
  utilityModuleId?: string | null;
}

export interface DecommissionShipDesignCommand {
  type: "decommissionShipDesign";
  designId: string;
}

export interface RetreatFleetCommand {
  type: "retreatFleet";
  fleetId: string;
}

export interface RetreatFleetToCommand {
  type: "retreatFleetTo";
  fleetId: string;
  targetStarId: number;
  targetSystemPosition?: ShipSystemPosition;
}

export interface EmergencyRetreatFleetToCommand {
  type: "emergencyRetreatFleetTo";
  fleetId: string;
  targetStarId: number;
}

export interface AttackTargetCommand {
  type: "attackTarget";
  fleetId: string;
  targetId: string;
  targetKind: "fleet" | "starbase";
}

export interface SetFleetCombatSettingsCommand {
  type: "setFleetCombatSettings";
  fleetId: string;
  combatSettings: Partial<FleetCombatSettings>;
  combatStance?: CombatStance;
}

export interface IssueFleetTacticalOrderCommand {
  type: "issueFleetTacticalOrder";
  fleetId: string;
  order: FleetTacticalOrder;
}

export interface RequestSystemDetailsCommand {
  type: "requestSystemDetails";
  starId: number;
}

export interface RequestPlanetDetailsCommand {
  type: "requestPlanetDetails";
  planetId: string;
}

export interface JoinCommand {
  type: "join";
}

export interface AdminCommandCommand {
  type: "adminCommand";
  input: string;
  context?: AdminCommandContext;
  requestId?: string;
}

export type ClientCommand =
  | JoinCommand
  | AdminCommandCommand
  | MoveCommand
  | BuildCommand
  | OrbitPlanetCommand
  | MergeFleetsCommand
  | SetSpeedCommand
  | BuildDistrictCommand
  | BuildPlanetBuildingCommand
  | BuildStarbaseBuildingCommand
  | UpgradeStarbaseCommand
  | BuildStarbaseShipCommand
  | SaveShipDesignCommand
  | DecommissionShipDesignCommand
  | SetUrbanSubDistrictCommand
  | RequestSystemDetailsCommand
  | RequestPlanetDetailsCommand
  | RetreatFleetCommand
  | RetreatFleetToCommand
  | EmergencyRetreatFleetToCommand
  | AttackTargetCommand
  | SetFleetCombatSettingsCommand
  | IssueFleetTacticalOrderCommand;

export interface GameSnapshot {
  type: "snapshot";
  perspective: GalaxyPerspective;
  clock: GameClock;
  stars: ServerStar[];
  planetStates: PlanetState[];
  factionEconomies: FactionEconomyState[];
  habitedPlanetSystemIds: number[];
  hyperlanes: Array<[number, number]>;
  factions: FactionState[];
  starOwnership: Array<[number, number]>;
  visibleStarIds: number[] | null;
  knownStarIds: number[] | null;
  ships: ServerShip[];
  shipDesigns: ShipDesign[];
  fleets: ServerFleet[];
  starbases: ServerStarbase[];
  recentCombatContacts: ServerCombatContact[];
}

export interface GameUpdate {
  type: "update";
  perspective: GalaxyPerspective;
  changed: ServerUpdateField[];
  clock?: GameClock;
  stars?: ServerStar[];
  planetStates?: PlanetState[];
  factionEconomies?: FactionEconomyState[];
  habitedPlanetSystemIds?: number[];
  hyperlanes?: Array<[number, number]>;
  factions?: FactionState[];
  starOwnership?: Array<[number, number]>;
  visibleStarIds?: number[] | null;
  knownStarIds?: number[] | null;
  ships?: ServerShip[];
  shipDesigns?: ShipDesign[];
  fleets?: ServerFleet[];
  starbases?: ServerStarbase[];
  recentCombatContacts?: ServerCombatContact[];
}

export interface CommandResultEvent {
  type: "commandResult";
  ok: boolean;
  message: string;
}

export interface ServerInfoEvent {
  type: "serverInfo";
  message: string;
}

export interface SystemDetailsEvent {
  type: "systemDetails";
  star: ServerStar;
  planetStates: PlanetState[];
}

export interface PlanetDetailsEvent {
  type: "planetDetails";
  starId: number;
  planet: PlanetConfig;
  planetState: PlanetState;
}

export type ServerEvent =
  | GameSnapshot
  | GameUpdate
  | CommandResultEvent
  | AdminCommandResult
  | ServerInfoEvent
  | SystemDetailsEvent
  | PlanetDetailsEvent;
