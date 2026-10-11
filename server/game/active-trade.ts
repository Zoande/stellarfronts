import { RESOURCE_KINDS, type ResourceCounts } from "../../src/data/Economy";
import type { AiObservation } from "./ai-observation";

/** Conservative steady-state cashflow at the country's own visible quotes.
 * Export only recurring surplus, discount receipts, stress import prices, and
 * exclude research (not a commodity). Existing inventory is not income. */
export function tradeBudget(observation: AiObservation, additional: Partial<ResourceCounts> = {}) {
  const economy = observation.snapshot.factionEconomies.find((entry) => entry.factionId === observation.factionId);
  let imports = 0, exports = 0;
  if (!economy) return { imports: Infinity, exports: 0, cashflow: -Infinity, sustainable: false };
  for (const resource of RESOURCE_KINDS) {
    if (resource === "energy" || resource === "research") continue;
    const delta = economy.monthlyDelta[resource] - (additional[resource] ?? 0);
    const quote = observation.market.resources.find((entry) => entry.resourceId === resource);
    if (!quote && delta < 0) { imports = Infinity; continue; }
    if (!quote) continue;
    if (delta < 0) imports += -delta * quote.buyPrice * (1 + observation.market.marketFee) * 1.2;
    else exports += delta * quote.sellPrice * (1 - observation.market.marketFee) * 0.8;
  }
  const cashflow = economy.monthlyDelta.energy - (additional.energy ?? 0) + exports - imports;
  return { imports, exports, cashflow, sustainable: Number.isFinite(cashflow) && cashflow >= 5 };
}

export function hasTradeLiquidity(observation: AiObservation, additional: Partial<ResourceCounts> = {}, cost: Partial<ResourceCounts> = {}) {
  const economy = observation.snapshot.factionEconomies.find((entry) => entry.factionId === observation.factionId);
  const budget = tradeBudget(observation, additional);
  return !!economy && budget.sustainable && economy.stockpiles.energy - (cost.energy ?? 0) >= Math.max(500, budget.imports * 2)
    && RESOURCE_KINDS.every((resource) => resource === "research" || resource === "energy"
      || economy.stockpiles[resource] - (cost[resource] ?? 0) >= Math.max(100, -(economy.monthlyDelta[resource] - (additional[resource] ?? 0)) * 2));
}
