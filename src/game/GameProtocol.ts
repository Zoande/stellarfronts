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
import type { PlanetConfig, StarData } from "../data/StarMap";
import type { SystemPosition } from "../data/SystemCoordinates";

export type ShipAction = "move" | "build" | "attack" | "merge" | "retreat";

export type FleetFormation = "line" | "vanguard" | "echelon" | "defensive";

export type ShipTransitPhase =
  | "idle"
  | "departingSystem"
  | "jumpingHyperlane"
  | "arrivingSystem"
  | "buildingStarbase"
  | "movingSystem"
  | "orbitingPlanet"
  | "orbiting";

export interface GameClock {
  year: number;
  speedMultiplier: number;
  syncedAtMs: number;
}

export type ServerUpdateField =
  | "clock"
  | "visibility"
  | "planetStates"
  | "habitedPlanetSystems"
  | "factionEconomies"
  | "ships"
  | "fleets"
  | "starbases"
  | "battles";

export interface ServerStar extends StarData {}

export interface FactionState extends FactionInfo {
  discoveredStarIds: number[];
}

export interface ServerStarbase {
  id: string;
  ownerId: number;
  starId: number;
  status: "online" | "building";
  buildProgress: number;
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

export type FleetOrderType = "move" | "build" | "orbit" | "merge" | null;

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

export interface ServerShip {
  id: string;
  ownerId: number;
  fleetId: string;
  shipKind: StarbaseShipKind;
  speed: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  armor: number;
  maxArmor: number;
  hull: number;
  maxHull: number;
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
  systemPosition: ShipSystemPosition;
  hyperlanePosition: ShipHyperlanePosition | null;
  movementPlan: FleetMovementPlan | null;
  orbitTargetPlanetId: string | null;
  orbitOffset: ShipSystemPosition | null;
  orbitTarget: FleetOrbitTarget | null;
  mergeTargetFleetId: string | null;
}

export type BattlePhase = "opening" | "engaged" | "retreating" | "resolved";
export type BattleSide = "attacker" | "defender";
export type BattleZone = 0 | 1 | 2 | 3;

export interface ServerBattleAction {
  actorId: string;
  movedToZone?: BattleZone;
  fired?: {
    targetId: string;
    hit: boolean;
    shieldDamage: number;
    armorDamage: number;
    hullDamage: number;
    targetDestroyed: boolean;
  };
}

export interface ServerBattleRound {
  round: number;
  actions: ServerBattleAction[];
}

export interface ServerBattleShipState {
  shipId: string;
  fleetId: string;
  ownerId: number;
  side: BattleSide;
  zone: BattleZone;
  targetId?: string | null;
  shield: number;
  maxShield: number;
  armor: number;
  maxArmor: number;
  hull: number;
  maxHull: number;
  destroyed: boolean;
  lastHitRound: number;
}

export interface ServerBattleStarbaseState {
  starbaseId: string;
  ownerId: number;
  zone: BattleZone;
  shield: number;
  maxShield: number;
  armor: number;
  maxArmor: number;
  hull: number;
  maxHull: number;
  destroyed: boolean;
  lastHitRound: number;
}

export interface ServerBattleResult {
  winnerFactionId: number;
  survivingShipIds: string[];
  capturedStarbase: boolean;
}

export interface ServerBattle {
  id: string;
  starId: number;
  attackerFactionId: number;
  defenderFactionId: number;
  attackerFleetIds: string[];
  defenderFleetIds: string[];
  starbaseId?: string | null;
  ships: ServerBattleShipState[];
  starbase?: ServerBattleStarbaseState | null;
  round: number;
  phase: BattlePhase;
  recentRounds: ServerBattleRound[];
  result?: ServerBattleResult;
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
}

export interface RetreatFleetCommand {
  type: "retreatFleet";
  fleetId: string;
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

export type ClientCommand =
  | JoinCommand
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
  | SetUrbanSubDistrictCommand
  | RequestSystemDetailsCommand
  | RequestPlanetDetailsCommand
  | RetreatFleetCommand;

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
  fleets: ServerFleet[];
  starbases: ServerStarbase[];
  battles: ServerBattle[];
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
  fleets?: ServerFleet[];
  starbases?: ServerStarbase[];
  battles?: ServerBattle[];
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
  | ServerInfoEvent
  | SystemDetailsEvent
  | PlanetDetailsEvent;
