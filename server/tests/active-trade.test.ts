import assert from "node:assert/strict";
import test from "node:test";
import { createHeadlessGame } from "../game/headless-game";
import { tradeBudget, hasTradeLiquidity } from "../game/active-trade";

test("import funding requires stressed recurring exports and liquid reserves", () => {
  const observation = structuredClone(createHeadlessGame({ initialWorld: { starCount: 6, factionCount: 2 } }).observe(0));
  const economy = observation.snapshot.factionEconomies.find((entry) => entry.factionId === 0)!;
  for (const resource of ["food", "minerals", "energy", "goods", "alloys", "research"] as const) {
    economy.monthlyDelta[resource] = 0; economy.stockpiles[resource] = 10000;
  }
  economy.monthlyDelta.minerals = -50;
  economy.monthlyDelta.alloys = 300;
  assert.ok(tradeBudget(observation).sustainable);
  assert.ok(hasTradeLiquidity(observation, { energy: 1, alloys: 1 }));
  economy.monthlyDelta.alloys = 0;
  assert.equal(tradeBudget(observation).sustainable, false, "selling finite inventory is not a sustainable income");
  economy.monthlyDelta.alloys = 300; economy.stockpiles.energy = 100;
  assert.equal(hasTradeLiquidity(observation), false);
  economy.stockpiles.energy = 10000; economy.stockpiles.minerals = 10;
  assert.equal(hasTradeLiquidity(observation), false, "inputs must last until the next purchases");
  economy.stockpiles.minerals = 10000;
  observation.market.resources = observation.market.resources.filter((quote) => quote.resourceId !== "minerals");
  assert.equal(hasTradeLiquidity(observation), false, "an unquoted import cannot be funded");
});
