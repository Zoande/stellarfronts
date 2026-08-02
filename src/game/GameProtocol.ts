import type { FactionInfo, GalaxyPerspective } from "../data/Factions";
import type { GalaxyIntelligenceView, IntelEntityView } from "../data/Intelligence";
import type { ActiveEvent } from "../data/Events";
import type { ActiveSituation } from "../data/Situations";
import type {
  BuildingKind,
  BuildingSlotArea,
  DistrictKind,
  FactionEconomyState,
  JobKind,
  PlanetState,
  PlanetDefenseBuildingKind,
  PlanetDefenseSection,
  ResourceKind,
  ResourceCounts,
  UrbanSubDistrictKind,
} from "../data/Economy";
import type { ColonizationEligibility } from "../data/Colonization";
import type {
  MarketPlayerStats,
  MarketAutoTradeOrder,
  MarketPriceSnapshot,
  MarketResourceKind,
  MarketTransactionRecord,
  MarketTradeAlert,
} from "../data/Market";

/** Wire protocols accepted by the current browser client, newest last. */
export const SUPPORTED_SERVER_PROTOCOL_VERSIONS: number[] = [5, 6, 7, 8, 9];
import type {
  StarbaseConstructionQueueItem,
  StarbaseEconomy,
  StarbaseBuildingKind,
  StarbaseLevel,
  StarbaseShipKind,
  StarbaseShipQueueItem,
} from "../data/Starbase";
import type { ShipDesign } from "../data/ShipDesigns";
import type { FactionTechnologyView, TechId } from "../data/Technology";
import type { LeaderAssignment, LeaderState } from "../data/Leaders";
import type { FactionGovernmentState, GovernmentLawId, GovernmentLawOptionId } from "../data/Government";
import type {
  FactionSpeciesRightsState,
  LegalSpeciesRightsOptions,
  SpeciesRights,
  SpeciesState,
} from "../data/Species";
import type {
  BorderPolicy,
  DiplomacyChatMessage,
  DiplomacyPeaceTerms,
  DiplomacyProposal,
  DiplomacySystemTransferTerm,
  DiplomacyTreaty,
  DiplomacyWar,
  TreatyArticleDefinition,
  TreatyArticleId,
} from "../data/Diplomacy";
import type { PlanetConfig, StarData } from "../data/StarMap";
import type { NebulaRegion } from "../data/Nebula";
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

export type ShipAction =
  | "move"
  | "build"
  | "colonize"
  | "attack"
  | "merge"
  | "stop"
  | "retreat"
  | "retreatTo"
  | "emergencyRetreatTo"
  | "orbit"
  | "hold"
  | "guard"
  | "protect"
  | "toggleDarkMatterBoost";

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
  lastProcessedLeaderDay?: number;
  lastProcessedPopulationWeek?: number;
  lastProcessedPopulationMonth?: number;
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
  | "technologies"
  | "leaders"
  | "governments"
  | "species"
  | "diplomacy"
  | "market"
  | "combatContacts"
  | "combatProjectiles"
  | "combatReports"
  | "situations"
  | "events"
  | "tradeAlerts";

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
  weaponReadyAtYears?: Record<string, number>;
  lastShieldDamageAtYear?: number | null;
  level: StarbaseLevel;
  economy: StarbaseEconomy;
  buildingSlots: Array<StarbaseBuildingKind | null>;
  constructionQueue: StarbaseConstructionQueueItem[];
  shipQueue: StarbaseShipQueueItem[];
}

export type ServerStarbaseSummary = Omit<
  ServerStarbase,
  "economy" | "buildingSlots" | "constructionQueue" | "shipQueue"
>;

export type GameDetailScope =
  | "system"
  | "planet"
  | "starbase"
  | "fleet"
  | "fleetManager"
  | "planetManager"
  | "market"
  | "technology"
  | "leaders"
  | "government"
  | "society"
  | "diplomacy"
  | "selection"
  | "hud";

export interface SystemDetailPayload {
  intelligence?: IntelEntityView[];
  commandLinked?: boolean;
  star: ServerStar;
  planetStates: PlanetState[];
  fleets: ServerFleet[];
  ships: ServerShip[];
  starbases: ServerStarbaseSummary[];
  recentCombatContacts: ServerCombatContact[];
  combatProjectiles?: ServerCombatProjectile[];
  combatReports?: CombatAfterActionReport[];
  hyperlaneExits: SystemHyperlaneExitPoint[];
  factions: FactionState[];
  shipDesigns: ShipDesign[];
  technology: FactionTechnologyView | null;
  starOwnerId: number | null;
}

export interface SystemHyperlaneExitPoint {
  starId: number;
  name: string;
  dx: number;
  dz: number;
  systemPosition: ShipSystemPosition;
}

export interface PlanetDetailPayload {
  intelligence?: IntelEntityView[];
  commandLinked?: boolean;
  starId: number;
  planet: PlanetConfig;
  planetState: PlanetState;
}

export interface StarbaseDetailPayload {
  intelligence?: IntelEntityView[];
  commandLinked?: boolean;
  starbase: ServerStarbase;
}

export interface FleetDetailPayload {
  intelligence?: IntelEntityView[];
  commandLinked?: boolean;
  fleet: ServerFleet;
  ships: ServerShip[];
}

export interface FleetManagerDetailPayload {
  fleets: ServerFleet[];
  ships: ServerShip[];
  shipDesigns: ShipDesign[];
  starbases: ServerStarbase[];
  technologies: FactionTechnologyView[];
  leaders: LeaderState[];
  factionEconomies: FactionEconomyState[];
  combatReports: CombatAfterActionReport[];
}

export interface PlanetManagerPlanetEntry {
  starId: number;
  starName: string;
  ownerId: number;
  systemOwnerId?: number;
  planet: PlanetConfig;
  planetState: PlanetState;
  foundingSpeciesId?: string | null;
  foundingSpeciesName?: string | null;
  foundingSpeciesHabitability?: number | null;
  colonizationEligibility?: ColonizationEligibility;
}

export interface PlanetManagerDetailPayload {
  planets: PlanetManagerPlanetEntry[];
  leaders: LeaderState[];
  factionEconomies: FactionEconomyState[];
}

export type MarketTrend = "up" | "down" | "flat";

export interface MarketResourceQuote {
  resourceId: MarketResourceKind;
  marketMemberIds: number[];
  basePrice: number;
  currentPrice: number;
  minimumPrice: number;
  finalQuotePrice: number;
  buyPrice: number;
  sellPrice: number;
  marketFee: number;
  ownedAmount: number;
  monthlyProduction: number;
  monthlyUpkeep: number;
  baselineSupply: number;
  baselineDemand: number;
  tradeBalance: number;
  effectiveSupply: number;
  effectiveDemand: number;
  totalExportsEnergy: number;
  totalImportsEnergy: number;
  priceHistory: MarketPriceSnapshot[];
  trend: MarketTrend;
}

export interface MarketDetailPayload {
  resources: MarketResourceQuote[];
  marketMemberIds: number[];
  playerStats: MarketPlayerStats | null;
  autoTrades: MarketAutoTradeOrder[];
  transactions: MarketTransactionRecord[];
  marketFee: number;
}

export interface TechnologyDetailPayload {
  technologies: FactionTechnologyView[];
  factionEconomies: FactionEconomyState[];
}

export interface LeadersDetailPayload {
  leaders: LeaderState[];
  fleets: ServerFleet[];
  planetStates: PlanetState[];
}

export interface GovernmentDetailPayload {
  government: FactionGovernmentState | null;
  leaders: LeaderState[];
  technologies: FactionTechnologyView[];
  factionEconomies: FactionEconomyState[];
}

export interface SocietyPlanetSpeciesSummary {
  planetId: string;
  planetName: string;
  starId: number;
  starName: string;
  population: number;
  speciesPopulations: Array<{ speciesId: string; population: number }>;
  averageHappiness: number;
  averageHabitability: number;
}

export interface SocietyDetailPayload {
  playerFactionId: number | null;
  faction: FactionState | null;
  species: SpeciesState[];
  rights: FactionSpeciesRightsState | null;
  legalOptions: LegalSpeciesRightsOptions;
  government: FactionGovernmentState | null;
  factionEconomy: FactionEconomyState | null;
  planets: SocietyPlanetSpeciesSummary[];
  laws: {
    civilRights: string;
    speciesPolicy: string;
    migrationPolicy: string;
  };
}

export interface DiplomacyCountrySummary {
  faction: FactionState;
  isSelf: boolean;
  atWar: boolean;
  ourBorderPolicy: BorderPolicy;
  theirBorderPolicy: BorderPolicy;
  activeTreatyCount: number;
  pendingProposalCount: number;
  tradePrivilegeActive: boolean;
  tradePrivilegeSuspended: boolean;
  migrationPactActive: boolean;
  migrationPactSuspended: boolean;
}

export interface DiplomacyEligiblePeaceTransferSystem extends DiplomacySystemTransferTerm {
  starId: number;
  starName: string;
  ownerId: number;
  ownerName: string;
}

export interface DiplomacyDetailPayload {
  countries: DiplomacyCountrySummary[];
  wars: DiplomacyWar[];
  treaties: DiplomacyTreaty[];
  proposals: DiplomacyProposal[];
  chatMessages: DiplomacyChatMessage[];
  eligiblePeaceTransferSystems: DiplomacyEligiblePeaceTransferSystem[];
  treatyArticles: TreatyArticleDefinition[];
  playerFactionId: number | null;
}

export interface DiplomacyMovementPayload {
  playerFactionId: number | null;
  openBorderFactionIds: number[];
  warFactionIds: number[];
}

export interface SelectionDetailPayload {
  fleets: ServerFleet[];
  ships: ServerShip[];
  starbases: ServerStarbase[];
  leaders: LeaderState[];
}

export interface HudDetailPayload {
  clock: GameClock;
  factionEconomies: FactionEconomyState[];
  habitedPlanetSystemIds: number[];
  starOwnership: Array<[number, number]>;
}

export type GameDetailPayload =
  | SystemDetailPayload
  | PlanetDetailPayload
  | StarbaseDetailPayload
  | FleetDetailPayload
  | FleetManagerDetailPayload
  | PlanetManagerDetailPayload
  | MarketDetailPayload
  | TechnologyDetailPayload
  | LeadersDetailPayload
  | GovernmentDetailPayload
  | SocietyDetailPayload
  | DiplomacyDetailPayload
  | SelectionDetailPayload
  | HudDetailPayload;

export type ShipSystemPosition = SystemPosition;

export interface ShipHyperlanePosition {
  fromStarId: number;
  toStarId: number;
  progress: number;
}

export type FleetOrderType = "move" | "build" | "attack" | "orbit" | "colonize" | "armyTransfer" | "merge" | "retreat" | null;

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

export type FleetRetreatMode = "system" | "emergencyFtl" | "lostInTransit";
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
  engagementRule?: import("./CombatTypes").FleetEngagementRule;
  doctrine?: import("./CombatTypes").FleetDoctrine;
  retreatPreset?: import("./CombatTypes").FleetRetreatPreset;
}

export interface ShipSubsystemState {
  disabledWeaponKeys: string[];
  engineDisabled: boolean;
  emergencyMobility: boolean;
}

export interface FleetBattleSnapshot {
  battleId: string;
  startedAtYear: number;
  initialDurability: number;
  initialShipIds: string[];
  projectilesIntercepted?: number;
  strayHits?: number;
  subsystemCriticals?: number;
  capturedStarbaseIds?: string[];
  retreated?: boolean;
  repairSpending?: Partial<ResourceCounts>;
}

export interface ConstructionRepairOrder {
  targetFleetId: string;
  targetShipId?: string | null;
  stage: "emergencyMobility" | "subsystems" | "hull" | "armor" | "shield";
  progressHours: number;
  startedAtYear: number;
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
  targetDesignId?: string | null;
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
  weaponReadyAtYears?: Record<string, number>;
  lastShieldDamageAtYear?: number | null;
  subsystemState?: ShipSubsystemState;
  disabled?: boolean;
  crew: number;
  crewCapacity: number;
}

export interface ServerFleet {
  id: string;
  ownerId: number;
  /** Non-null for a defense-platform group permanently anchored to a starbase. */
  stationaryStarbaseId?: string | null;
  /** Non-null for a defense-platform group permanently anchored to a planet. */
  stationaryPlanetId?: string | null;
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
  /** Resources reserved for an active outpost construction order. */
  pendingStarbaseBuildCost?: ResourceCounts | null;
  speed: number;
  combatStance: CombatStance;
  retreatState: FleetRetreatState | null;
  systemPosition: ShipSystemPosition;
  hyperlanePosition: ShipHyperlanePosition | null;
  movementPlan: FleetMovementPlan | null;
  darkMatterBoostActive?: boolean;
  darkMatterBoostPaidUntilYear?: number | null;
  orbitTargetPlanetId: string | null;
  pendingArmyTransfer?: { planetId: string; mode: "fill" | "drop" } | null;
  orbitOffset: ShipSystemPosition | null;
  orbitTarget: FleetOrbitTarget | null;
  mergeTargetFleetId: string | null;
  combatSettings: FleetCombatSettings;
  currentTacticalOrder?: FleetTacticalOrder | null;
  tacticalRadius: number;
  maxWeaponRange: number;
  minWeaponRange: number;
  weightedWeaponRange?: number;
  currentTargetId?: string | null;
  currentTargetKind?: CombatTargetKind | null;
  combatStatus: FleetCombatStatus;
  lastCombatAtYear?: number | null;
  battleSnapshot?: FleetBattleSnapshot | null;
  repairOrder?: ConstructionRepairOrder | null;
  commandUsed?: number;
  commandCapacity?: number;
  commandAccuracyMultiplier?: number;
  commandCooldownMultiplier?: number;
  commandCoordinationMultiplier?: number;
}

export interface ServerCombatProjectile {
  id: string;
  ownerId: number;
  sourceActorId: string;
  sourceActorKind: CombatTargetKind;
  sourceShipId?: string | null;
  sourceMountKey: string;
  targetActorId: string;
  targetActorKind: CombatTargetKind;
  targetShipId?: string | null;
  targetProjectileId?: string | null;
  starId: number;
  attackClass: import("./CombatTypes").CombatAttackClass;
  interceptableBy: import("./CombatTypes").CombatCounterClass[];
  launchYear: number;
  impactYear: number;
  sourcePosition: ShipSystemPosition;
  targetPosition: ShipSystemPosition;
  damage: number;
  shieldPenetration: number;
  armorPenetration: number;
  shieldDamageMultiplier: number;
  armorDamageMultiplier: number;
  hullDamageMultiplier: number;
  lockedHit: boolean;
  accuracyMiss: boolean;
  dodged: boolean;
  guided: boolean;
  reacquired: boolean;
  hp: number;
  maxHp: number;
  evasion: number;
  status: import("./CombatTypes").CombatProjectileStatus;
}

export interface CombatAfterActionReport {
  id: string;
  ownerId: number;
  starId: number;
  startedAtYear: number;
  endedAtYear: number;
  participantFleetIds: string[];
  shipsLost: string[];
  projectilesIntercepted: number;
  strayHits: number;
  subsystemCriticals: number;
  capturedStarbaseIds: string[];
  retreatedFleetIds: string[];
  repairSpending: Partial<ResourceCounts>;
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

export interface ColonizePlanetCommand {
  type: "colonizePlanet";
  fleetId: string;
  planetId: string;
}

export interface MergeFleetsCommand {
  type: "mergeFleets";
  targetFleetId: string;
  sourceFleetIds: string[];
}

export interface StopFleetCommand {
  type: "stopFleet";
  fleetId: string;
}

export interface SetFleetDarkMatterBoostCommand {
  type: "setFleetDarkMatterBoost";
  fleetId: string;
  enabled: boolean;
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

export interface UpgradePlanetBuildingCommand {
  type: "upgradePlanetBuilding";
  planetId: string;
  area: BuildingSlotArea;
  slotIndex: number;
  subDistrictIndex?: number;
}

export interface DowngradePlanetBuildingCommand {
  type: "downgradePlanetBuilding";
  planetId: string;
  area: BuildingSlotArea;
  slotIndex: number;
  subDistrictIndex?: number;
}

export interface SetPlanetBuildingEnabledCommand {
  type: "setPlanetBuildingEnabled";
  planetId: string;
  area: BuildingSlotArea;
  slotIndex: number;
  subDistrictIndex?: number;
  enabled: boolean;
}

export interface SetPlanetJobLockCommand {
  type: "setPlanetJobLock";
  planetId: string;
  job: Exclude<JobKind, "criminal" | "unemployed">;
  locked: boolean;
}

export interface SetUrbanSubDistrictCommand {
  type: "setUrbanSubDistrict";
  planetId: string;
  subDistrictIndex: number;
  subDistrictKind: UrbanSubDistrictKind;
}

export interface CancelPlanetConstructionCommand {
  type: "cancelPlanetConstruction";
  planetId: string;
  queueItemId: string;
}

export interface SkipPlanetConstructionCommand {
  type: "skipPlanetConstruction";
  planetId: string;
  queueItemId: string;
}

export interface BuildPlanetDefenseBuildingCommand {
  type: "buildPlanetDefenseBuilding";
  planetId: string;
  section: PlanetDefenseSection;
  slotIndex: number;
  buildingKind: PlanetDefenseBuildingKind;
}

export interface UpgradePlanetDefenseBuildingCommand {
  type: "upgradePlanetDefenseBuilding";
  planetId: string;
  section: PlanetDefenseSection;
  slotIndex: number;
}

export interface SetPlanetDefenseBuildingEnabledCommand {
  type: "setPlanetDefenseBuildingEnabled";
  planetId: string;
  section: PlanetDefenseSection;
  slotIndex: number;
  enabled: boolean;
}

export interface DemolishPlanetDefenseBuildingCommand {
  type: "demolishPlanetDefenseBuilding";
  planetId: string;
  section: PlanetDefenseSection;
  slotIndex: number;
}

export interface BuildPlanetShipCommand {
  type: "buildPlanetShip";
  planetId: string;
  shipKind: StarbaseShipKind;
  designId?: string;
}

export interface CancelShipConstructionCommand {
  type: "cancelShipConstruction";
  yardKind: "planet" | "starbase";
  yardId: string;
  queueItemId: string;
}

export interface OrderArmyTransferCommand {
  type: "orderArmyTransfer";
  fleetId: string;
  planetId: string;
  mode: "fill" | "drop";
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

export interface UpgradeShipCommand {
  type: "upgradeShip";
  shipId: string;
  starbaseId: string;
  targetDesignId?: string;
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

export interface SetActiveTechnologyCommand {
  type: "setActiveTechnology";
  techId: TechId;
}

export interface RecruitLeaderCommand {
  type: "recruitLeader";
  leaderId: string;
}

export interface ResolveEventCommand {
  type: "resolveEvent";
  eventId: string;
  choiceId: string;
}

export interface AssignLeaderCommand {
  type: "assignLeader";
  leaderId: string;
  assignment: LeaderAssignment | null;
}

export interface DismissLeaderCommand {
  type: "dismissLeader";
  leaderId: string;
}

export interface SetGovernmentLawCommand {
  type: "setGovernmentLaw";
  lawId: GovernmentLawId;
  optionId: GovernmentLawOptionId;
}

export interface SetSpeciesRightsCommand {
  type: "setSpeciesRights";
  speciesId: string;
  rights: Partial<SpeciesRights>;
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

export interface AttackSystemCommand {
  type: "attackSystem";
  fleetId: string;
  targetStarId: number;
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

export interface RepairFleetCommand {
  type: "repairFleet";
  constructionFleetId: string;
  targetFleetId: string;
}

export interface MarketTradeCommand {
  type: "marketTrade";
  resourceId: MarketResourceKind;
  tradeType: "buy" | "sell";
  amount: number;
}

export interface AddMarketAutoTradeCommand {
  type: "addMarketAutoTrade";
  resourceId: MarketResourceKind;
  tradeType: "auto_buy" | "auto_sell";
  amountPerHour: number;
}

export interface RemoveMarketAutoTradeCommand {
  type: "removeMarketAutoTrade";
  orderId: string;
}

export interface SendDiplomacyMessageCommand {
  type: "sendDiplomacyMessage";
  targetFactionId: number;
  body: string;
}

export interface SetBorderPolicyCommand {
  type: "setBorderPolicy";
  targetFactionId: number;
  policy: BorderPolicy;
}

export interface DeclareWarCommand {
  type: "declareWar";
  targetFactionId: number;
}

export interface ProposeTreatyCommand {
  type: "proposeTreaty";
  targetFactionId: number;
  articleIds: TreatyArticleId[];
  durationYears?: number;
  replacesTreatyId?: string | null;
}

export interface RespondDiplomacyProposalCommand {
  type: "respondDiplomacyProposal";
  proposalId: string;
  response: "accept" | "decline";
}

export interface CancelTreatyCommand {
  type: "cancelTreaty";
  treatyId: string;
}

export interface CancelDiplomacyProposalCommand {
  type: "cancelDiplomacyProposal";
  proposalId: string;
}

export interface ProposePeaceCommand {
  type: "proposePeace";
  targetFactionId: number;
  terms: DiplomacyPeaceTerms;
}

export interface RequestDetailsCommand {
  type: "requestDetails";
  scope: GameDetailScope;
  id?: string | number | null;
  knownRevision?: string | null;
}

export interface SubscribeDetailsCommand {
  type: "subscribeDetails";
  scope: GameDetailScope;
  id?: string | number | null;
  knownRevision?: string | null;
}

export interface UnsubscribeDetailsCommand {
  type: "unsubscribeDetails";
  scope: GameDetailScope;
  id?: string | number | null;
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

type ClientCommandPayload =
  | JoinCommand
  | AdminCommandCommand
  | MoveCommand
  | BuildCommand
  | OrbitPlanetCommand
  | ColonizePlanetCommand
  | MergeFleetsCommand
  | StopFleetCommand
  | SetFleetDarkMatterBoostCommand
  | SetSpeedCommand
  | BuildDistrictCommand
  | BuildPlanetBuildingCommand
  | UpgradePlanetBuildingCommand
  | DowngradePlanetBuildingCommand
  | SetPlanetBuildingEnabledCommand
  | SetPlanetJobLockCommand
  | CancelPlanetConstructionCommand
  | SkipPlanetConstructionCommand
  | BuildPlanetDefenseBuildingCommand
  | UpgradePlanetDefenseBuildingCommand
  | SetPlanetDefenseBuildingEnabledCommand
  | DemolishPlanetDefenseBuildingCommand
  | BuildPlanetShipCommand
  | CancelShipConstructionCommand
  | OrderArmyTransferCommand
  | BuildStarbaseBuildingCommand
  | UpgradeStarbaseCommand
  | BuildStarbaseShipCommand
  | UpgradeShipCommand
  | SaveShipDesignCommand
  | DecommissionShipDesignCommand
  | SetActiveTechnologyCommand
  | RecruitLeaderCommand
  | ResolveEventCommand
  | AssignLeaderCommand
  | DismissLeaderCommand
  | SetGovernmentLawCommand
  | SetSpeciesRightsCommand
  | SetUrbanSubDistrictCommand
  | MarketTradeCommand
  | AddMarketAutoTradeCommand
  | RemoveMarketAutoTradeCommand
  | SendDiplomacyMessageCommand
  | SetBorderPolicyCommand
  | DeclareWarCommand
  | ProposeTreatyCommand
  | RespondDiplomacyProposalCommand
  | CancelTreatyCommand
  | CancelDiplomacyProposalCommand
  | ProposePeaceCommand
  | RequestDetailsCommand
  | SubscribeDetailsCommand
  | UnsubscribeDetailsCommand
  | RetreatFleetCommand
  | RetreatFleetToCommand
  | EmergencyRetreatFleetToCommand
  | AttackTargetCommand
  | AttackSystemCommand
  | SetFleetCombatSettingsCommand
  | IssueFleetTacticalOrderCommand
  | RepairFleetCommand;

/**
 * Protocol 8 correlates normal command results with the command that produced
 * them. The field remains optional so the same client types can adapt protocols
 * 5-7 and the specialized join/detail/admin flows.
 */
export type ClientCommand = ClientCommandPayload & {
  requestId?: string;
};

export interface GameSnapshot {
  type: "snapshot";
  protocolVersion?: number;
  perspective: GalaxyPerspective;
  intelligence: GalaxyIntelligenceView;
  clock: GameClock;
  stars: ServerStar[];
  // Nebula regions are public/global — always sent in full regardless of fog so
  // the galaxy-map cloud renders even over unexplored systems.
  nebulae: NebulaRegion[];
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
  starbases: ServerStarbaseSummary[];
  technologies: FactionTechnologyView[];
  leaders: LeaderState[];
  governments: FactionGovernmentState[];
  species: SpeciesState[];
  recentCombatContacts: ServerCombatContact[];
  combatProjectiles: ServerCombatProjectile[];
  combatReports: CombatAfterActionReport[];
  diplomacy: DiplomacyMovementPayload;
  situations: ActiveSituation[];
  events: ActiveEvent[];
  tradeAlerts: MarketTradeAlert[];
}

export interface GameUpdate {
  type: "update";
  protocolVersion?: number;
  perspective: GalaxyPerspective;
  intelligence?: GalaxyIntelligenceView;
  changed: ServerUpdateField[];
  clock?: GameClock;
  stars?: ServerStar[];
  nebulae?: NebulaRegion[];
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
  starbases?: ServerStarbaseSummary[];
  technologies?: FactionTechnologyView[];
  leaders?: LeaderState[];
  governments?: FactionGovernmentState[];
  species?: SpeciesState[];
  recentCombatContacts?: ServerCombatContact[];
  combatProjectiles?: ServerCombatProjectile[];
  combatReports?: CombatAfterActionReport[];
  diplomacy?: DiplomacyMovementPayload;
  situations?: ActiveSituation[];
  events?: ActiveEvent[];
  tradeAlerts?: MarketTradeAlert[];
}

export interface CommandResultEvent {
  type: "commandResult";
  ok: boolean;
  message: string;
  requestId?: string;
}

export interface AccountResourcesEvent {
  type: "accountResources";
  darkMatter: number;
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

export interface GameDetailEvent {
  type: "detail";
  scope: GameDetailScope;
  id?: string | number | null;
  revision: string;
  status: "full" | "notModified" | "unavailable";
  message?: string;
  payload?: GameDetailPayload;
}

export type ServerEvent =
  | GameSnapshot
  | GameUpdate
  | CommandResultEvent
  | AccountResourcesEvent
  | AdminCommandResult
  | ServerInfoEvent
  | PlanetDetailsEvent
  | GameDetailEvent;
