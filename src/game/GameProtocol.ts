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
  BattleGroupBehavior,
  BattleGroupChaseSetting,
  BattleGroupOrderType,
  BattleGroupRetreatDestinationKind,
  BattleGroupRetreatMode,
  CombatTargetKind,
  CombatStance,
  FleetBehavior,
  FleetChasePolicy,
  FleetRetreatPolicy,
  FleetTacticalOrderType,
  RangeBand,
} from "./CombatTypes";

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
  | "battles"
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

export interface BattleGroupRetreatPolicy {
  mode: BattleGroupRetreatMode;
  thresholdPercent?: number | null;
}

export interface BattleGroupRetreatDestination {
  kind: BattleGroupRetreatDestinationKind;
  targetStarId?: number | null;
  targetSystemPosition?: ShipSystemPosition | null;
}

export interface BattleGroupProtectedTarget {
  kind: "battleGroup" | "fleet" | "starbase" | "planet" | "position";
  id?: string | null;
  position?: ShipSystemPosition | null;
}

export interface BattleGroupTacticalOrder {
  type: BattleGroupOrderType;
  targetGroupId?: string | null;
  targetObjectId?: string | null;
  targetPosition?: ShipSystemPosition | null;
  protectedTarget?: BattleGroupProtectedTarget | null;
  issuedAtYear?: number | null;
}

export interface BattleGroupConfig {
  id: string;
  name: string;
  shipIds: string[];
  behavior: BattleGroupBehavior;
  retreatPolicy: BattleGroupRetreatPolicy;
  retreatDestination?: BattleGroupRetreatDestination | null;
  chaseSetting: BattleGroupChaseSetting;
  protectedTarget?: BattleGroupProtectedTarget | null;
  originPosition?: ShipSystemPosition | null;
  deployedPosition?: ShipSystemPosition | null;
  leashRadius?: number | null;
  currentOrder?: BattleGroupTacticalOrder | null;
}

export type FleetRetreatOrder = "none" | "retreat";

export interface FleetCombatSettings {
  behavior: FleetBehavior;
  chasePolicy: FleetChasePolicy;
  retreatPolicy: FleetRetreatPolicy;
  retreatDestination?: BattleGroupRetreatDestination | null;
  /** Deprecated battle-group compatibility. */
  retreatOrder: FleetRetreatOrder;
  /** Deprecated battle-group compatibility. */
  defaultBehavior: BattleGroupBehavior;
  /** Deprecated battle-group compatibility. */
  defaultChaseSetting: BattleGroupChaseSetting;
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
  /** Deprecated save compatibility only; active combat is fleet-level. */
  battleGroups: BattleGroupConfig[];
  /** Deprecated save compatibility only; fleet stance/behavior now determines readiness. */
  alertMode: boolean;
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

export type BattlePhase = "opening" | "engaged" | "retreating" | "resolved";
export type BattleSide = "attacker" | "defender";
export type BattleZone = 0 | 1 | 2 | 3;
export type BattleParticipantSourceType =
  | "fleet"
  | "starbase"
  | "planet"
  | "platform"
  | "monster"
  | "minefield"
  | "megastructure";
export type CombatGroupRole = BattleGroupBehavior | "station" | "support";
export type CombatGroupStatus = "active" | "retreating" | "escaped" | "destroyed";

export interface BattleRetreatState {
  mode: FleetRetreatMode;
  status: FleetRetreatStatus;
  targetStarId: number;
  startedAtYear: number;
  miaUntilYear?: number | null;
}

export interface BattleParticipant {
  id: string;
  sourceId: string;
  sourceType: BattleParticipantSourceType;
  ownerId: number;
  stance: CombatStance;
  canInitiateCombat: boolean;
  canBeTargeted: boolean;
  canMove: boolean;
  canRetreat: boolean;
  hostileParticipantIds: string[];
  retreatState?: BattleRetreatState | null;
  status: "active" | "retreating" | "escaped" | "destroyed";
}

export interface CombatGroup {
  id: string;
  battleId: string;
  participantId: string;
  sourceObjectId: string;
  sourceFleetId?: string | null;
  ownerId: number;
  shipKind?: StarbaseShipKind | null;
  shipDesignId?: string | null;
  shipIds: string[];
  count: number;
  maxGroupSize: number;
  weaponIds: string[];
  role: CombatGroupRole;
  behavior: BattleGroupBehavior | "station";
  preferredRangeBand: RangeBand;
  targetGroupId?: string | null;
  currentRangeBand: RangeBand;
  movementProgress: number;
  speed: number;
  retreatState?: BattleRetreatState | null;
  status: CombatGroupStatus;
  position: ShipSystemPosition;
  destination?: ShipSystemPosition | null;
  originPosition: ShipSystemPosition;
  leashRadius: number;
  currentOrder?: BattleGroupTacticalOrder | null;
  chaseSetting: BattleGroupChaseSetting;
  retreatPolicy?: BattleGroupRetreatPolicy | null;
  retreatDestination?: BattleGroupRetreatDestination | null;
  protectedTarget?: BattleGroupProtectedTarget | null;
  maxWeaponRange: number;
  minWeaponRange: number;
  hpRatio: number;
}

export interface BattleLayerDamage {
  shield: number;
  armor: number;
  hull: number;
}

export interface BattleParticipantStats {
  damageDealt: BattleLayerDamage;
  damageReceived: BattleLayerDamage;
  shotsFired: number;
  shotsHit: number;
  shotsMissed: number;
  shotsDodged: number;
  shipsDestroyed: number;
  shipsLost: number;
  retreatingShips: number;
  escapedShips: number;
}

export interface BattleWeaponStats {
  weaponId: string;
  weaponName: string;
  ownerParticipantId: string;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  kills: number;
}

export interface BattleStats {
  byParticipant: Record<string, BattleParticipantStats>;
  byOwner: Record<string, BattleParticipantStats>;
  weapons: Record<string, BattleWeaponStats>;
}

export interface BattleHostilityEdge {
  participantAId: string;
  participantBId: string;
  hostile: boolean;
}

export interface ServerBattleAction {
  actorId: string;
  actorGroupId?: string | null;
  movedToZone?: BattleZone;
  movedToRangeBand?: RangeBand;
  fired?: {
    targetId: string;
    targetGroupId?: string | null;
    weaponId?: string;
    weaponName?: string;
    weaponEffects?: ServerBattleWeaponEffect[];
    hit: boolean;
    accuracyMiss?: boolean;
    dodged?: boolean;
    shieldDamage: number;
    armorDamage: number;
    hullDamage: number;
    targetDestroyed: boolean;
  };
}

export interface ServerBattleWeaponEffect {
  targetId: string;
  targetGroupId?: string | null;
  weaponId?: string;
  weaponName?: string;
  hit: boolean;
  accuracyMiss?: boolean;
  dodged?: boolean;
  shieldDamage: number;
  armorDamage: number;
  hullDamage: number;
  targetDestroyed: boolean;
}

export interface ServerBattleRound {
  round: number;
  actions: ServerBattleAction[];
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

export interface ServerBattleShipState {
  shipId: string;
  fleetId: string;
  ownerId: number;
  side: BattleSide;
  participantId?: string;
  groupId?: string;
  rangeBand?: RangeBand;
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
  participantId?: string;
  groupId?: string;
  rangeBand?: RangeBand;
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
  startedAtYear: number;
  lastTickYear: number;
  attackerFactionId: number;
  defenderFactionId: number;
  attackerFleetIds: string[];
  defenderFleetIds: string[];
  starbaseId?: string | null;
  ships: ServerBattleShipState[];
  starbase?: ServerBattleStarbaseState | null;
  participants: BattleParticipant[];
  combatGroups: CombatGroup[];
  hostility: BattleHostilityEdge[];
  stats: BattleStats;
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
  designId?: string;
}

export interface SaveShipDesignCommand {
  type: "saveShipDesign";
  designId?: string;
  shipKind: StarbaseShipKind;
  name: string;
  weaponModuleIds: string[];
  defenseModuleIds: string[];
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

export interface CreateBattleGroupCommand {
  type: "createBattleGroup";
  fleetId: string;
  name?: string;
  shipIds?: string[];
  behavior?: BattleGroupBehavior;
}

export interface DeleteBattleGroupCommand {
  type: "deleteBattleGroup";
  fleetId: string;
  battleGroupId: string;
}

export interface RenameBattleGroupCommand {
  type: "renameBattleGroup";
  fleetId: string;
  battleGroupId: string;
  name: string;
}

export interface MoveShipsToBattleGroupCommand {
  type: "moveShipsToBattleGroup";
  fleetId: string;
  fromBattleGroupId?: string | null;
  toBattleGroupId: string;
  shipIds: string[];
}

export interface SplitBattleGroupCommand {
  type: "splitBattleGroup";
  fleetId: string;
  battleGroupId: string;
  shipIds: string[];
  name?: string;
}

export interface MergeBattleGroupsCommand {
  type: "mergeBattleGroups";
  fleetId: string;
  sourceBattleGroupId: string;
  targetBattleGroupId: string;
}

export interface SetBattleGroupBehaviorCommand {
  type: "setBattleGroupBehavior";
  fleetId: string;
  battleGroupId: string;
  behavior: BattleGroupBehavior;
}

export interface SetBattleGroupRetreatPolicyCommand {
  type: "setBattleGroupRetreatPolicy";
  fleetId: string;
  battleGroupId: string;
  retreatPolicy: BattleGroupRetreatPolicy;
}

export interface SetBattleGroupChaseSettingCommand {
  type: "setBattleGroupChaseSetting";
  fleetId: string;
  battleGroupId: string;
  chaseSetting: BattleGroupChaseSetting;
}

export interface SetBattleGroupRetreatDestinationCommand {
  type: "setBattleGroupRetreatDestination";
  fleetId: string;
  battleGroupId: string;
  retreatDestination: BattleGroupRetreatDestination | null;
}

export interface SetFleetCombatSettingsCommand {
  type: "setFleetCombatSettings";
  fleetId: string;
  combatSettings: Partial<FleetCombatSettings>;
  combatStance?: CombatStance;
}

export interface SetFleetAlertModeCommand {
  type: "setFleetAlertMode";
  fleetId: string;
  alertMode: boolean;
}

export interface IssueFleetTacticalOrderCommand {
  type: "issueFleetTacticalOrder";
  fleetId: string;
  order: FleetTacticalOrder;
}

export interface IssueBattleGroupOrderCommand {
  type: "issueBattleGroupOrder";
  fleetId: string;
  battleGroupId: string;
  order: BattleGroupTacticalOrder;
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
  | SaveShipDesignCommand
  | DecommissionShipDesignCommand
  | SetUrbanSubDistrictCommand
  | RequestSystemDetailsCommand
  | RequestPlanetDetailsCommand
  | RetreatFleetCommand
  | RetreatFleetToCommand
  | EmergencyRetreatFleetToCommand
  | AttackTargetCommand
  | CreateBattleGroupCommand
  | DeleteBattleGroupCommand
  | RenameBattleGroupCommand
  | MoveShipsToBattleGroupCommand
  | SplitBattleGroupCommand
  | MergeBattleGroupsCommand
  | SetBattleGroupBehaviorCommand
  | SetBattleGroupRetreatPolicyCommand
  | SetBattleGroupChaseSettingCommand
  | SetBattleGroupRetreatDestinationCommand
  | SetFleetCombatSettingsCommand
  | SetFleetAlertModeCommand
  | IssueFleetTacticalOrderCommand
  | IssueBattleGroupOrderCommand;

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
  battles: ServerBattle[];
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
  battles?: ServerBattle[];
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
  | ServerInfoEvent
  | SystemDetailsEvent
  | PlanetDetailsEvent;
