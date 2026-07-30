import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateStarbaseEconomy,
  getStarbaseShipConstructionCostMultiplier,
  OUTPOST_CONSTRUCTION_COST,
} from "../../src/data/Starbase";
import { createEmptyResourceCounts } from "../../src/data/Economy";
import { refundPendingStarbaseBuildCost } from "../game/fleet-combat";
import type { GameFleet, RuntimeContext } from "../game/types";

test("logistics depots reduce level upkeep and ship construction demand", () => {
  const base = calculateStarbaseEconomy("starbase", []);
  const logistics = calculateStarbaseEconomy("starbase", ["logisticsDepot"]);

  assert.equal(base.upkeep.energy, 10);
  assert.equal(logistics.upkeep.energy, 9.5);
  assert.equal(logistics.upkeep.goods, 1.525);
  assert.equal(getStarbaseShipConstructionCostMultiplier([]), 1);
  assert.equal(getStarbaseShipConstructionCostMultiplier(["logisticsDepot"]), 0.95);
});

test("outpost construction reservations refund their complete resource bundle", () => {
  const stockpiles = createEmptyResourceCounts();
  const fleet = {
    ownerId: 7,
    pendingStarbaseBuildCost: { ...OUTPOST_CONSTRUCTION_COST },
  } as GameFleet;
  const ctx = {
    state: {
      factionEconomies: [{
        factionId: 7,
        stockpiles,
        monthlyDelta: createEmptyResourceCounts(),
        lastProcessedMonth: 0,
        lastProcessedHour: 0,
      }],
    },
    hasDirtyState: false,
  } as unknown as RuntimeContext;

  assert.equal(refundPendingStarbaseBuildCost(ctx, fleet), true);
  assert.deepEqual(ctx.state.factionEconomies[0].stockpiles, OUTPOST_CONSTRUCTION_COST);
  assert.equal(fleet.pendingStarbaseBuildCost, null);
  assert.equal(ctx.hasDirtyState, true);
});
