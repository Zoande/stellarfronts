import { RESOURCE_KINDS } from "./Economy";
import type { ResourceKind } from "./Economy";

export type MarketTradeType = "buy" | "sell" | "auto_buy" | "auto_sell";

export interface MarketResourceState {
  resourceId: ResourceKind;
  basePrice: number;
  currentPrice: number;
  liquidity: number;
  temporaryPressure: number;
  persistentPressure: number;
  marketEnabled: boolean;
  lastUpdatedAt: number;
}

export interface MarketPlayerStats {
  playerId: number;
  totalImportsEnergy: number;
  totalExportsEnergy: number;
}

export interface MarketTransactionRecord {
  playerId: number;
  resourceId: ResourceKind;
  type: MarketTradeType;
  amount: number;
  unitPrice: number;
  feeRate: number;
  feePaid: number;
  totalEnergyDelta: number;
  timestamp: number;
}

export interface MarketPriceSnapshot {
  resourceId: ResourceKind;
  price: number;
  temporaryPressure: number;
  persistentPressure: number;
  timestamp: number;
}

export interface MarketAutoTradeOrder {
  id: string;
  playerId: number;
  resourceId: ResourceKind;
  type: "auto_buy" | "auto_sell";
  amountPerHour: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MarketTradeAlert {
  /** Stable id: `${playerId}:${resourceId}:${tradeType}` */
  id: string;
  playerId: number;
  resourceId: ResourceKind;
  tradeType: "auto_buy" | "auto_sell";
  requestedPerHour: number;
  /** Actual amount traded in the last processed period, normalised to per-hour. */
  executedPerHour: number;
}

export interface MarketState {
  resources: MarketResourceState[];
  playerStats: MarketPlayerStats[];
  autoTrades: MarketAutoTradeOrder[];
  transactions: MarketTransactionRecord[];
  priceSnapshots: MarketPriceSnapshot[];
  tradeAlerts: MarketTradeAlert[];
  lastProcessedHour: number;
  lastSnapshotHour: number;
}

interface MarketResourceDefinition {
  basePrice: number;
  liquidity: number;
  marketEnabled: boolean;
}

export const MARKET_FEE_RATE = 0.05;
export const MARKET_MIN_PRICE_MULTIPLIER = 0.25;
export const MARKET_MAX_PRICE_MULTIPLIER = 4;
export const MARKET_TEMPORARY_DECAY_PER_HOUR = 0.96;
export const MARKET_PERSISTENT_DECAY_PER_HOUR = 0.995;
export const MARKET_MANUAL_PRESSURE_FACTOR = 0.04;
export const MARKET_AUTO_PRESSURE_FACTOR = 0.01;
export const MARKET_PRICE_SNAPSHOT_INTERVAL_HOURS = 6;
export const MARKET_PRICE_SNAPSHOT_LIMIT_PER_RESOURCE = 180;
export const MARKET_TRANSACTION_LIMIT = 320;
export const PLAYER_INTERNAL_MODIFIER_MIN = 0.85;
export const PLAYER_INTERNAL_MODIFIER_MAX = 1.18;

export const MARKET_RESOURCE_DEFINITIONS: Record<ResourceKind, MarketResourceDefinition> = {
  food: { basePrice: 1.1, liquidity: 5_000, marketEnabled: true },
  minerals: { basePrice: 1.4, liquidity: 4_500, marketEnabled: true },
  energy: { basePrice: 1, liquidity: 10_000, marketEnabled: false },
  goods: { basePrice: 3.2, liquidity: 2_200, marketEnabled: true },
  alloys: { basePrice: 5.5, liquidity: 1_600, marketEnabled: true },
  research: { basePrice: 6.5, liquidity: 1_200, marketEnabled: false },
};

export function clampMarketValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateMarketPrice(basePrice: number, persistentPressure: number, temporaryPressure: number): number {
  const multiplier = clampMarketValue(
    1 + persistentPressure + temporaryPressure,
    MARKET_MIN_PRICE_MULTIPLIER,
    MARKET_MAX_PRICE_MULTIPLIER,
  );
  return Math.max(0.000001, basePrice * multiplier);
}

export function calculateMarketPressureDelta(amount: number, liquidity: number, factor: number): number {
  return factor * Math.sqrt(Math.max(0, amount) / Math.max(1, liquidity));
}

export function createInitialMarketResource(resourceId: ResourceKind, timestamp = 0): MarketResourceState {
  const definition = MARKET_RESOURCE_DEFINITIONS[resourceId];
  const currentPrice = calculateMarketPrice(definition.basePrice, 0, 0);
  return {
    resourceId,
    basePrice: definition.basePrice,
    currentPrice,
    liquidity: definition.liquidity,
    temporaryPressure: 0,
    persistentPressure: 0,
    marketEnabled: definition.marketEnabled,
    lastUpdatedAt: timestamp,
  };
}

export function createInitialMarketState(
  factionIds: number[] = [],
  currentHour = 0,
  timestamp = 0,
): MarketState {
  const resources = RESOURCE_KINDS.map((resource) => createInitialMarketResource(resource, timestamp));
  return {
    resources,
    playerStats: factionIds.map((playerId) => ({
      playerId,
      totalImportsEnergy: 0,
      totalExportsEnergy: 0,
    })),
    autoTrades: [],
    transactions: [],
    tradeAlerts: [],
    priceSnapshots: resources.map((resource) => ({
      resourceId: resource.resourceId,
      price: resource.currentPrice,
      temporaryPressure: resource.temporaryPressure,
      persistentPressure: resource.persistentPressure,
      timestamp,
    })),
    lastProcessedHour: currentHour,
    lastSnapshotHour: currentHour,
  };
}

export function normalizeMarketState(
  raw: Partial<MarketState> | undefined,
  factionIds: number[],
  currentHour = 0,
  timestamp = 0,
): { state: MarketState; changed: boolean } {
  if (!raw || !Array.isArray(raw.resources)) {
    return { state: createInitialMarketState(factionIds, currentHour, timestamp), changed: true };
  }

  let changed = false;
  const rawResources = new Map<ResourceKind, Partial<MarketResourceState>>();
  for (const resource of raw.resources) {
    if (
      typeof resource?.resourceId === "string"
      && RESOURCE_KINDS.includes(resource.resourceId as ResourceKind)
    ) {
      rawResources.set(resource.resourceId as ResourceKind, resource);
    }
  }

  const resources = RESOURCE_KINDS.map((resourceId) => {
    const fallback = createInitialMarketResource(resourceId, timestamp);
    const rawResource = rawResources.get(resourceId);
    if (!rawResource) {
      changed = true;
      return fallback;
    }
    const definition = MARKET_RESOURCE_DEFINITIONS[resourceId];
    const basePrice = sanitizePositiveNumber(rawResource.basePrice, definition.basePrice);
    const liquidity = sanitizePositiveNumber(rawResource.liquidity, definition.liquidity);
    const temporaryPressure = sanitizeFiniteNumber(rawResource.temporaryPressure, 0);
    const persistentPressure = sanitizeFiniteNumber(rawResource.persistentPressure, 0);
    const currentPrice = calculateMarketPrice(basePrice, persistentPressure, temporaryPressure);
    if (
      basePrice !== rawResource.basePrice
      || liquidity !== rawResource.liquidity
      || temporaryPressure !== rawResource.temporaryPressure
      || persistentPressure !== rawResource.persistentPressure
      || currentPrice !== rawResource.currentPrice
      || definition.marketEnabled !== rawResource.marketEnabled
    ) {
      changed = true;
    }
    return {
      resourceId,
      basePrice,
      currentPrice,
      liquidity,
      temporaryPressure,
      persistentPressure,
      marketEnabled: definition.marketEnabled,
      lastUpdatedAt: sanitizeFiniteNumber(rawResource.lastUpdatedAt, timestamp),
    };
  });

  const factionSet = new Set(factionIds);
  const rawStats = Array.isArray(raw.playerStats) ? raw.playerStats : [];
  const statsByFaction = new Map<number, Partial<MarketPlayerStats>>();
  for (const entry of rawStats) {
    if (Number.isInteger(entry?.playerId) && factionSet.has(Number(entry.playerId))) {
      statsByFaction.set(Number(entry.playerId), entry);
    }
  }
  const playerStats = factionIds.map((playerId) => {
    const entry = statsByFaction.get(playerId);
    if (!entry) {
      changed = true;
      return { playerId, totalImportsEnergy: 0, totalExportsEnergy: 0 };
    }
    return {
      playerId,
      totalImportsEnergy: sanitizeFiniteNumber(entry.totalImportsEnergy, 0),
      totalExportsEnergy: sanitizeFiniteNumber(entry.totalExportsEnergy, 0),
    };
  });

  const autoTrades = normalizeAutoTrades(raw.autoTrades, factionSet);
  if (autoTrades.length !== (Array.isArray(raw.autoTrades) ? raw.autoTrades.length : 0)) changed = true;

  const transactions = normalizeTransactions(raw.transactions, factionSet);
  if (transactions.length !== (Array.isArray(raw.transactions) ? raw.transactions.length : 0)) changed = true;

  const priceSnapshots = normalizePriceSnapshots(raw.priceSnapshots);
  if (priceSnapshots.length === 0) {
    changed = true;
    priceSnapshots.push(...resources.map((resource) => ({
      resourceId: resource.resourceId,
      price: resource.currentPrice,
      temporaryPressure: resource.temporaryPressure,
      persistentPressure: resource.persistentPressure,
      timestamp,
    })));
  }

  return {
    state: {
      resources,
      playerStats,
      autoTrades,
      transactions: transactions.slice(-MARKET_TRANSACTION_LIMIT),
      tradeAlerts: Array.isArray(raw.tradeAlerts) ? raw.tradeAlerts.filter((a) => a && typeof a.id === "string") : [],
      priceSnapshots: trimMarketPriceSnapshots(priceSnapshots),
      lastProcessedHour: sanitizeFiniteNumber(raw.lastProcessedHour, currentHour),
      lastSnapshotHour: sanitizeFiniteNumber(raw.lastSnapshotHour, currentHour),
    },
    changed,
  };
}

export function recomputeMarketResourcePrice(resource: MarketResourceState, timestamp: number): MarketResourceState {
  return {
    ...resource,
    currentPrice: calculateMarketPrice(resource.basePrice, resource.persistentPressure, resource.temporaryPressure),
    lastUpdatedAt: timestamp,
  };
}

export function trimMarketPriceSnapshots(snapshots: MarketPriceSnapshot[]): MarketPriceSnapshot[] {
  const byResource = new Map<ResourceKind, MarketPriceSnapshot[]>();
  for (const snapshot of snapshots) {
    const list = byResource.get(snapshot.resourceId) ?? [];
    list.push(snapshot);
    byResource.set(snapshot.resourceId, list);
  }
  return Array.from(byResource.values())
    .flatMap((list) => list.sort((a, b) => a.timestamp - b.timestamp).slice(-MARKET_PRICE_SNAPSHOT_LIMIT_PER_RESOURCE))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function normalizeAutoTrades(
  raw: MarketState["autoTrades"] | undefined,
  factionSet: Set<number>,
): MarketAutoTradeOrder[] {
  if (!Array.isArray(raw)) return [];
  const usedIds = new Set<string>();
  return raw
    .filter((entry): entry is MarketAutoTradeOrder => (
      typeof entry?.id === "string"
      && Number.isInteger(entry.playerId)
      && factionSet.has(Number(entry.playerId))
      && typeof entry.resourceId === "string"
      && RESOURCE_KINDS.includes(entry.resourceId as ResourceKind)
      && (entry.type === "auto_buy" || entry.type === "auto_sell")
      && Number.isFinite(entry.amountPerHour)
      && Number.isFinite(entry.createdAt)
      && Number.isFinite(entry.updatedAt)
    ))
    .map((entry) => {
      let id = entry.id.trim() || `auto-${entry.playerId}-${entry.resourceId}-${entry.type}`;
      if (usedIds.has(id)) id = `${id}-${usedIds.size + 1}`;
      usedIds.add(id);
      return {
        id,
        playerId: Number(entry.playerId),
        resourceId: entry.resourceId,
        type: entry.type,
        amountPerHour: Math.max(0, Number(entry.amountPerHour)),
        enabled: entry.enabled !== false,
        createdAt: Number(entry.createdAt),
        updatedAt: Number(entry.updatedAt),
      };
    })
    .filter((entry) => entry.amountPerHour > 0);
}

function normalizeTransactions(
  raw: MarketState["transactions"] | undefined,
  factionSet: Set<number>,
): MarketTransactionRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is MarketTransactionRecord => (
      Number.isInteger(entry?.playerId)
      && factionSet.has(Number(entry.playerId))
      && typeof entry.resourceId === "string"
      && RESOURCE_KINDS.includes(entry.resourceId as ResourceKind)
      && isMarketTradeType(entry.type)
      && Number.isFinite(entry.amount)
      && Number.isFinite(entry.unitPrice)
      && Number.isFinite(entry.feeRate)
      && Number.isFinite(entry.feePaid)
      && Number.isFinite(entry.totalEnergyDelta)
      && Number.isFinite(entry.timestamp)
    ))
    .map((entry) => ({
      playerId: Number(entry.playerId),
      resourceId: entry.resourceId,
      type: entry.type,
      amount: Math.max(0, Number(entry.amount)),
      unitPrice: Math.max(0, Number(entry.unitPrice)),
      feeRate: Math.max(0, Number(entry.feeRate)),
      feePaid: Math.max(0, Number(entry.feePaid)),
      totalEnergyDelta: Number(entry.totalEnergyDelta),
      timestamp: Number(entry.timestamp),
    }))
    .slice(-MARKET_TRANSACTION_LIMIT);
}

function normalizePriceSnapshots(raw: MarketState["priceSnapshots"] | undefined): MarketPriceSnapshot[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is MarketPriceSnapshot => (
      typeof entry?.resourceId === "string"
      && RESOURCE_KINDS.includes(entry.resourceId as ResourceKind)
      && Number.isFinite(entry.price)
      && Number.isFinite(entry.temporaryPressure)
      && Number.isFinite(entry.persistentPressure)
      && Number.isFinite(entry.timestamp)
    ))
    .map((entry) => ({
      resourceId: entry.resourceId,
      price: Math.max(0, Number(entry.price)),
      temporaryPressure: Number(entry.temporaryPressure),
      persistentPressure: Number(entry.persistentPressure),
      timestamp: Number(entry.timestamp),
    }));
}

function isMarketTradeType(value: unknown): value is MarketTradeType {
  return value === "buy" || value === "sell" || value === "auto_buy" || value === "auto_sell";
}

function sanitizeFiniteNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function sanitizePositiveNumber(value: unknown, fallback: number): number {
  const next = sanitizeFiniteNumber(value, fallback);
  return next > 0 ? next : fallback;
}
