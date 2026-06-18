import type { WebSocket } from "ws";
import type { AuthAccount, DevGameRuntimeRow } from "../../src/auth/types";
import type { FactionInfo, GalaxyPerspective } from "../../src/data/Factions";
import type { StarData } from "../../src/data/StarMap";
import type { PlanetState, FactionEconomyState } from "../../src/data/Economy";
import type { FactionTechState } from "../../src/data/Technology";
import type { FactionGovernmentState } from "../../src/data/Government";
import type { SpeciesState, FactionSpeciesRightsState } from "../../src/data/Species";
import type { DiplomacyState } from "../../src/data/Diplomacy";
import type { MarketState } from "../../src/data/Market";
import type { LeaderState } from "../../src/data/Leaders";
import type { ActiveSituation } from "../../src/data/Situations";
import type { ActiveEvent } from "../../src/data/Events";
import type { FactionModifierState } from "../../src/data/GameEffects";
import type { ShipDesign } from "../../src/data/ShipDesigns";
import type {
  GameClock,
  GameDetailScope,
  ServerCombatContact,
  ServerFleet,
  ServerShip,
  ServerStarbase,
  ShipTransitPhase,
} from "../../src/game/GameProtocol";
import type { StoredGame } from "../auth-store";

export interface GameFleet extends ServerFleet {
  phaseElapsedMs: number;
}

export interface GameShip extends ServerShip {}

export interface GameState {
  schemaVersion: 20;
  stars: StarData[];
  planetStates: PlanetState[];
  factionEconomies: FactionEconomyState[];
  factionTechnologies: FactionTechState[];
  governments: FactionGovernmentState[];
  species: SpeciesState[];
  speciesRights: FactionSpeciesRightsState[];
  diplomacy: DiplomacyState;
  market: MarketState;
  leaders: LeaderState[];
  situations: ActiveSituation[];
  events: ActiveEvent[];
  factionModifiers: FactionModifierState[];
  hyperlanes: Array<[number, number]>;
  adjacency: number[][];
  factions: FactionInfo[];
  starOwnership: number[];
  starbases: ServerStarbase[];
  shipDesigns: ShipDesign[];
  ships: GameShip[];
  fleets: GameFleet[];
  recentCombatContacts: ServerCombatContact[];
  discoveredByFaction: Record<string, number[]>;
  // Symmetric first-contact record: metByFaction[a] lists every faction id that
  // faction a has discovered (and that has therefore discovered a). Monotonic.
  metByFaction: Record<string, number[]>;
  lastKnownOwnershipByFaction: Record<string, number[]>;
  clock: GameClock & { lastUpdatedAt: number; lastProcessedPopulationWeek: number; lastProcessedLeaderDay: number };
}

export interface DetailSubscription {
  scope: GameDetailScope;
  id: string | number | null;
  lastRevision: string | null;
}

export interface ClientSession {
  socket: WebSocket;
  account: AuthAccount;
  perspective: GalaxyPerspective;
  detailSubscriptions: Map<string, DetailSubscription>;
  sentInitialSnapshot: boolean;
}

export interface GameRuntime {
  game: StoredGame;
  attachClient: (socket: WebSocket, account: AuthAccount, perspective: GalaxyPerspective) => void;
  touchMembershipNames: () => void;
  tick: (now: number) => void;
  save: () => Promise<void>;
  dispose: (message?: string, deleteState?: boolean) => Promise<void>;
  getStats: () => DevGameRuntimeRow;
}

export interface RuntimeContext {
  game: StoredGame;
  statePath: string;
  state: GameState;
  clients: Set<ClientSession>;
  pendingPlanetDetailRefreshes: Set<string>;
  hasDirtyState: boolean;
  lastSaveAt: number;
  runtimeIdCounter: number;
  eventInstanceSeq: number;
  // Method fields wired up inside createGameRuntime (hoisted declarations, so safe to reference at ctx init).
  setFleetPhase: (fleet: GameFleet, phase: ShipTransitPhase) => void;
  // Infrastructure callbacks — defined late in createGameRuntime but safe to reference here because
  // these are hoisted function declarations.
  recalculatePlanetEconomies: () => void;
  refreshFactionEconomyDeltas: () => void;
  queuePlanetDetailRefresh: (planetId: string) => void;
  refreshDiscovery: () => void;
  syncSystemOwnershipFromStarbases: () => boolean;
  syncFleetMembership: () => boolean;
  createRuntimeId: (prefix: string, parts?: Array<string | number | undefined>) => string;
}
