export const MARKET_RESOURCE_KINDS = ["food", "minerals", "goods", "alloys"] as const;
export type MarketResourceKind = (typeof MARKET_RESOURCE_KINDS)[number];

export type MarketTradeType = "buy" | "sell" | "auto_buy" | "auto_sell";

export interface MarketPlayerStats {
  playerId: number;
  totalImportsEnergy: number;
  totalExportsEnergy: number;
}

export interface MarketTransactionRecord {
  playerId: number;
  resourceId: MarketResourceKind;
  type: MarketTradeType;
  amount: number;
  unitPrice: number;
  feeRate: number;
  feePaid: number;
  totalEnergyDelta: number;
  timestamp: number;
}

export interface MarketPriceSnapshot {
  playerId: number;
  resourceId: MarketResourceKind;
  price: number;
  timestamp: number;
}

export interface MarketTradeBucket {
  playerId: number;
  resourceId: MarketResourceKind;
  monthIndex: number;
  purchases: number;
  sales: number;
}

export interface MarketAutoTradeOrder {
  id: string;
  playerId: number;
  resourceId: MarketResourceKind;
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
  resourceId: MarketResourceKind;
  tradeType: "auto_buy" | "auto_sell";
  requestedPerHour: number;
  /** Actual amount traded in the last processed period, normalised to per-hour. */
  executedPerHour: number;
}

export interface MarketState {
  tradeBuckets: MarketTradeBucket[];
  playerStats: MarketPlayerStats[];
  autoTrades: MarketAutoTradeOrder[];
  transactions: MarketTransactionRecord[];
  priceSnapshots: MarketPriceSnapshot[];
  tradeAlerts: MarketTradeAlert[];
  lastProcessedHour: number;
  lastSnapshotHour: number;
}

export interface MarketResourceDefinition {
  basePrice: number;
}

export interface MarketPricingState {
  resourceId: MarketResourceKind;
  basePrice: number;
  monthlyProduction: number;
  monthlyUpkeep: number;
  baselineSupply: number;
  baselineDemand: number;
  tradeBalance: number;
  effectiveSupply: number;
  effectiveDemand: number;
  currentPrice: number;
  minimumPrice: number;
}

export interface MarketBulkQuote {
  tradeType: "buy" | "sell";
  amount: number;
  priceBefore: number;
  priceAfter: number;
  averageUnitPrice: number;
  feeRate: number;
  feePaid: number;
  totalEnergy: number;
  postTradeBalance: number;
}

export const MARKET_FEE_RATE = 0.05;
export const MARKET_MIN_PRICE_MULTIPLIER = 0.25;
export const MARKET_INTERNAL_FLOW_MULTIPLIER = 5;
export const MARKET_SEED_LIQUIDITY = 10;
export const MARKET_TRADE_WINDOW_MONTHS = 5;
export const MARKET_PRICE_SNAPSHOT_INTERVAL_HOURS = 6;
export const MARKET_PRICE_SNAPSHOT_LIMIT_PER_FACTION_RESOURCE = 600;
export const MARKET_TRANSACTION_LIMIT = 320;

export const MARKET_RESOURCE_DEFINITIONS: Record<MarketResourceKind, MarketResourceDefinition> = {
  food: { basePrice: 1.1 },
  minerals: { basePrice: 1.4 },
  goods: { basePrice: 3.2 },
  alloys: { basePrice: 5.5 },
};

export function isMarketResourceKind(value: unknown): value is MarketResourceKind {
  return typeof value === "string" && MARKET_RESOURCE_KINDS.includes(value as MarketResourceKind);
}

export function calculateMarketPricingState(
  resourceId: MarketResourceKind,
  monthlyProduction: number,
  monthlyUpkeep: number,
  tradeBalance: number,
): MarketPricingState {
  const basePrice = MARKET_RESOURCE_DEFINITIONS[resourceId].basePrice;
  const normalizedProduction = Math.max(0, finiteOr(monthlyProduction, 0));
  const normalizedUpkeep = Math.max(0, finiteOr(monthlyUpkeep, 0));
  const normalizedBalance = finiteOr(tradeBalance, 0);
  const baselineSupply = Math.max(MARKET_SEED_LIQUIDITY, normalizedProduction * MARKET_INTERNAL_FLOW_MULTIPLIER);
  const baselineDemand = Math.max(MARKET_SEED_LIQUIDITY, normalizedUpkeep * MARKET_INTERNAL_FLOW_MULTIPLIER);
  const effectiveSupply = baselineSupply + Math.max(0, -normalizedBalance);
  const effectiveDemand = baselineDemand + Math.max(0, normalizedBalance);
  const minimumPrice = basePrice * MARKET_MIN_PRICE_MULTIPLIER;
  const currentPrice = Math.max(
    minimumPrice,
    basePrice * Math.sqrt(effectiveDemand / effectiveSupply),
  );
  return {
    resourceId,
    basePrice,
    monthlyProduction: normalizedProduction,
    monthlyUpkeep: normalizedUpkeep,
    baselineSupply,
    baselineDemand,
    tradeBalance: normalizedBalance,
    effectiveSupply,
    effectiveDemand,
    currentPrice,
    minimumPrice,
  };
}

export function calculateBulkMarketQuote(
  pricing: MarketPricingState,
  tradeType: "buy" | "sell",
  rawAmount: number,
): MarketBulkQuote {
  const amount = Math.max(0, finiteOr(rawAmount, 0));
  const postTradeBalance = pricing.tradeBalance + (tradeType === "buy" ? amount : -amount);
  const postPricing = calculateMarketPricingState(
    pricing.resourceId,
    pricing.monthlyProduction,
    pricing.monthlyUpkeep,
    postTradeBalance,
  );
  const averageUnitPrice = (pricing.currentPrice + postPricing.currentPrice) / 2;
  const grossEnergy = amount * averageUnitPrice;
  const feePaid = grossEnergy * MARKET_FEE_RATE;
  return {
    tradeType,
    amount,
    priceBefore: pricing.currentPrice,
    priceAfter: postPricing.currentPrice,
    averageUnitPrice,
    feeRate: MARKET_FEE_RATE,
    feePaid,
    totalEnergy: tradeType === "buy" ? grossEnergy + feePaid : grossEnergy - feePaid,
    postTradeBalance,
  };
}

export function createInitialMarketState(
  factionIds: number[] = [],
  currentHour = 0,
  _timestamp = 0,
): MarketState {
  return {
    tradeBuckets: [],
    playerStats: factionIds.map((playerId) => ({
      playerId,
      totalImportsEnergy: 0,
      totalExportsEnergy: 0,
    })),
    autoTrades: [],
    transactions: [],
    tradeAlerts: [],
    priceSnapshots: [],
    lastProcessedHour: currentHour,
    lastSnapshotHour: currentHour,
  };
}

export function normalizeMarketState(
  raw: Partial<MarketState> | undefined,
  factionIds: number[],
  currentHour = 0,
  _timestamp = 0,
): { state: MarketState; changed: boolean } {
  if (!raw || typeof raw !== "object") {
    return { state: createInitialMarketState(factionIds, currentHour), changed: true };
  }

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
    return {
      playerId,
      totalImportsEnergy: Math.max(0, finiteOr(entry?.totalImportsEnergy, 0)),
      totalExportsEnergy: Math.max(0, finiteOr(entry?.totalExportsEnergy, 0)),
    };
  });

  const currentMonthIndex = Math.floor(currentHour / (30 * 24));
  const tradeBuckets = normalizeTradeBuckets(raw.tradeBuckets, factionSet, currentMonthIndex);
  const autoTrades = normalizeAutoTrades(raw.autoTrades, factionSet);
  const transactions = normalizeTransactions(raw.transactions, factionSet);
  const priceSnapshots = normalizePriceSnapshots(raw.priceSnapshots, factionSet);
  const tradeAlerts = normalizeTradeAlerts(raw.tradeAlerts, factionSet);
  const normalized: MarketState = {
    tradeBuckets,
    playerStats,
    autoTrades,
    transactions: transactions.slice(-MARKET_TRANSACTION_LIMIT),
    tradeAlerts,
    priceSnapshots: trimMarketPriceSnapshots(priceSnapshots),
    lastProcessedHour: finiteOr(raw.lastProcessedHour, currentHour),
    lastSnapshotHour: finiteOr(raw.lastSnapshotHour, currentHour),
  };

  return {
    state: normalized,
    changed: JSON.stringify(raw) !== JSON.stringify(normalized),
  };
}

export function pruneMarketTradeBuckets(
  buckets: MarketTradeBucket[],
  currentMonthIndex: number,
): MarketTradeBucket[] {
  return buckets.filter((bucket) => (
    bucket.monthIndex <= currentMonthIndex
    && currentMonthIndex - bucket.monthIndex < MARKET_TRADE_WINDOW_MONTHS
  ));
}

export function trimMarketPriceSnapshots(snapshots: MarketPriceSnapshot[]): MarketPriceSnapshot[] {
  const byFactionResource = new Map<string, MarketPriceSnapshot[]>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.playerId}:${snapshot.resourceId}`;
    const list = byFactionResource.get(key) ?? [];
    list.push(snapshot);
    byFactionResource.set(key, list);
  }
  return Array.from(byFactionResource.values())
    .flatMap((list) => list
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-MARKET_PRICE_SNAPSHOT_LIMIT_PER_FACTION_RESOURCE))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function normalizeTradeBuckets(
  raw: MarketState["tradeBuckets"] | undefined,
  factionSet: Set<number>,
  currentMonthIndex: number,
): MarketTradeBucket[] {
  if (!Array.isArray(raw)) return [];
  const merged = new Map<string, MarketTradeBucket>();
  for (const entry of raw) {
    if (
      !Number.isInteger(entry?.playerId)
      || !factionSet.has(Number(entry.playerId))
      || !isMarketResourceKind(entry.resourceId)
      || !Number.isInteger(entry.monthIndex)
    ) continue;
    const key = `${entry.playerId}:${entry.resourceId}:${entry.monthIndex}`;
    const existing = merged.get(key) ?? {
      playerId: Number(entry.playerId),
      resourceId: entry.resourceId,
      monthIndex: Number(entry.monthIndex),
      purchases: 0,
      sales: 0,
    };
    existing.purchases += Math.max(0, finiteOr(entry.purchases, 0));
    existing.sales += Math.max(0, finiteOr(entry.sales, 0));
    merged.set(key, existing);
  }
  return pruneMarketTradeBuckets(Array.from(merged.values()), currentMonthIndex);
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
      && isMarketResourceKind(entry.resourceId)
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
      && isMarketResourceKind(entry.resourceId)
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
    }));
}

function normalizePriceSnapshots(
  raw: MarketState["priceSnapshots"] | undefined,
  factionSet: Set<number>,
): MarketPriceSnapshot[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is MarketPriceSnapshot => (
      Number.isInteger(entry?.playerId)
      && factionSet.has(Number(entry.playerId))
      && isMarketResourceKind(entry.resourceId)
      && Number.isFinite(entry.price)
      && Number.isFinite(entry.timestamp)
    ))
    .map((entry) => ({
      playerId: Number(entry.playerId),
      resourceId: entry.resourceId,
      price: Math.max(0, Number(entry.price)),
      timestamp: Number(entry.timestamp),
    }));
}

function normalizeTradeAlerts(
  raw: MarketState["tradeAlerts"] | undefined,
  factionSet: Set<number>,
): MarketTradeAlert[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is MarketTradeAlert => (
    typeof entry?.id === "string"
    && Number.isInteger(entry.playerId)
    && factionSet.has(Number(entry.playerId))
    && isMarketResourceKind(entry.resourceId)
    && (entry.tradeType === "auto_buy" || entry.tradeType === "auto_sell")
    && Number.isFinite(entry.requestedPerHour)
    && Number.isFinite(entry.executedPerHour)
  ));
}

function isMarketTradeType(value: unknown): value is MarketTradeType {
  return value === "buy" || value === "sell" || value === "auto_buy" || value === "auto_sell";
}

function finiteOr(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}
