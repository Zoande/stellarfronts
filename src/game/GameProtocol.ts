import type { FactionInfo, GalaxyPerspective } from "../data/Factions";
import type {
  BuildingKind,
  BuildingSlotArea,
  DistrictKind,
  FactionEconomyState,
  PlanetState,
  UrbanSubDistrictKind,
} from "../data/Economy";
import type { StarData } from "../data/StarMap";

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

export interface JoinCommand {
  type: "join";
  perspective: GalaxyPerspective;
}

export type ClientCommand =
  | JoinCommand
  | MoveCommand
  | BuildCommand
  | SetSpeedCommand
  | BuildDistrictCommand
  | BuildPlanetBuildingCommand
  | SetUrbanSubDistrictCommand;

export interface GameSnapshot {
  type: "snapshot";
  perspective: GalaxyPerspective;
  clock: GameClock;
  stars: ServerStar[];
  planetStates: PlanetState[];
  factionEconomies: FactionEconomyState[];
  hyperlanes: Array<[number, number]>;
  factions: FactionState[];
  starOwnership: number[];
  visibleStarIds: number[] | null;
  knownStarIds: number[] | null;
  ships: ServerShip[];
  starbases: ServerStarbase[];
}

export interface GameUpdate {
  type: "update";
  perspective: GalaxyPerspective;
  clock: GameClock;
  planetStates: PlanetState[];
  factionEconomies: FactionEconomyState[];
  hyperlanes: Array<[number, number]>;
  factions: FactionState[];
  starOwnership: number[];
  visibleStarIds: number[] | null;
  knownStarIds: number[] | null;
  ships: ServerShip[];
  starbases: ServerStarbase[];
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

export type ServerEvent = GameSnapshot | GameUpdate | CommandResultEvent | ServerInfoEvent;
