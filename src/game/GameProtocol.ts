import type { FactionInfo, GalaxyPerspective } from "../data/Factions";
import type { ActiveEvent } from "../data/Events";
import type { ActiveSituation } from "../data/Situations";
import type {
  BuildingKind,
  BuildingSlotArea,
  DistrictKind,
  FactionEconomyState,
  PlanetState,
  ResourceKind,
  UrbanSubDistrictKind,
} from "../data/Economy";
import type {
  MarketPlayerStats,
  MarketAutoTradeOrder,
  MarketPriceSnapshot,
  MarketTransactionRecord,
  MarketTradeAlert,
} from "../data/Market";
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
  | "protect";

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
  star: ServerStar;
  planetStates: PlanetState[];
  fleets: ServerFleet[];
  ships: ServerShip[];
  starbases: ServerStarbaseSummary[];
  recentCombatContacts: ServerCombatContact[];
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
  starId: number;
  planet: PlanetConfig;
  planetState: PlanetState;
}

export interface StarbaseDetailPayload {
  starbase: ServerStarbase;
}

export interface FleetDetailPayload {
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
}

export interface PlanetManagerPlanetEntry {
  starId: number;
  starName: string;
  ownerId: number;
  planet: PlanetConfig;
  planetState: PlanetState;
}

export interface PlanetManagerDetailPayload {
  planets: PlanetManagerPlanetEntry[];
  leaders: LeaderState[];
  factionEconomies: FactionEconomyState[];
}

export type MarketTrend = "up" | "down" | "flat";

export interface MarketResourceQuote {
  resourceId: ResourceKind;
  basePrice: number;
  currentPrice: number;
  liquidity: number;
  temporaryPressure: number;
  persistentPressure: number;
  marketEnabled: boolean;
  lastUpdatedAt: number;
  finalQuotePrice: number;
  buyPrice: number;
  sellPrice: number;
  marketFee: number;
  ownedAmount: number;
  productionPerHour: number;
  consumptionPerHour: number;
  internalSupply: number;
  internalDemand: number;
  playerInternalModifier: number;
  totalExportsEnergy: number;
  totalImportsEnergy: number;
  priceHistory: MarketPriceSnapshot[];
  trend: MarketTrend;
}

export interface MarketDetailPayload {
  resources: MarketResourceQuote[];
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

export type FleetOrderType = "move" | "build" | "attack" | "orbit" | "merge" | "retreat" | null;

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

export interface MarketTradeCommand {
  type: "marketTrade";
  resourceId: ResourceKind;
  tradeType: "buy" | "sell";
  amount: number;
}

export interface AddMarketAutoTradeCommand {
  type: "addMarketAutoTrade";
  resourceId: ResourceKind;
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

export type ClientCommand =
  | JoinCommand
  | AdminCommandCommand
  | MoveCommand
  | BuildCommand
  | OrbitPlanetCommand
  | ColonizePlanetCommand
  | MergeFleetsCommand
  | StopFleetCommand
  | SetSpeedCommand
  | BuildDistrictCommand
  | BuildPlanetBuildingCommand
  | UpgradePlanetBuildingCommand
  | DowngradePlanetBuildingCommand
  | SetPlanetBuildingEnabledCommand
  | CancelPlanetConstructionCommand
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
  | IssueFleetTacticalOrderCommand;

export interface GameSnapshot {
  type: "snapshot";
  protocolVersion?: 2;
  perspective: GalaxyPerspective;
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
  diplomacy: DiplomacyMovementPayload;
  situations: ActiveSituation[];
  events: ActiveEvent[];
  tradeAlerts: MarketTradeAlert[];
}

export interface GameUpdate {
  type: "update";
  protocolVersion?: 2;
  perspective: GalaxyPerspective;
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
  diplomacy?: DiplomacyMovementPayload;
  situations?: ActiveSituation[];
  events?: ActiveEvent[];
  tradeAlerts?: MarketTradeAlert[];
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

export interface GameDetailEvent {
  type: "detail";
  scope: GameDetailScope;
  id?: string | number | null;
  revision: string;
  status: "full" | "notModified";
  payload?: GameDetailPayload;
}

export type ServerEvent =
  | GameSnapshot
  | GameUpdate
  | CommandResultEvent
  | AdminCommandResult
  | ServerInfoEvent
  | PlanetDetailsEvent
  | GameDetailEvent;
