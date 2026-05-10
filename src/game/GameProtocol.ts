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

export type ShipAction = "move" | "build" | "attack";

export type ShipTransitPhase =
  | "idle"
  | "departingSystem"
  | "jumpingHyperlane"
  | "arrivingSystem"
  | "buildingStarbase";

export interface GameClock {
  year: number;
  speedMultiplier: number;
}

export type ServerUpdateField =
  | "clock"
  | "visibility"
  | "planetStates"
  | "habitedPlanetSystems"
  | "factionEconomies"
  | "ships"
  | "starbases";

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

export interface ShipSystemPosition {
  x: number;
  y: number;
  z: number;
}

export interface ShipHyperlanePosition {
  fromStarId: number;
  toStarId: number;
  progress: number;
}

export interface ServerShip {
  id: string;
  ownerId: number;
  currentStarId: number;
  targetStarId: number | null;
  phase: ShipTransitPhase;
  phaseStartedAtYear: number;
  phaseDurationDays: number;
  route: number[];
  routeIndex: number;
  phaseProgress: number;
  orderType: "move" | "build" | null;
  systemPosition: ShipSystemPosition;
  hyperlanePosition: ShipHyperlanePosition | null;
}

export interface MoveCommand {
  type: "moveShip";
  shipId: string;
  targetStarId: number;
}

export interface BuildCommand {
  type: "buildStarbase";
  shipId: string;
  targetStarId: number;
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
  | SetSpeedCommand
  | BuildDistrictCommand
  | BuildPlanetBuildingCommand
  | BuildStarbaseBuildingCommand
  | UpgradeStarbaseCommand
  | BuildStarbaseShipCommand
  | SetUrbanSubDistrictCommand
  | RequestSystemDetailsCommand
  | RequestPlanetDetailsCommand;

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
  starbases: ServerStarbase[];
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
  starbases?: ServerStarbase[];
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
