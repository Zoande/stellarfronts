import assert from "node:assert/strict";
import { test } from "node:test";
import { SYSTEM_FLEET_Y } from "../../src/data/SystemCoordinates";
import {
  DARK_MATTER_FLEET_SPEED_MULTIPLIER,
  getConstructionDarkMatterCost,
  getFleetDarkMatterBillingPlan,
} from "../../src/game/DarkMatter";
import { GAME_DAYS_PER_YEAR, GAME_START_YEAR } from "../../src/game/GameTime";
import { rescaleFleetMovementPlan } from "../game/fleet-combat";
import { normalizeFleet } from "../game/state-normalization";
import type { GameFleet, RuntimeContext } from "../game/types";

const daysToYears = (days: number): number => days / GAME_DAYS_PER_YEAR;

test("construction skips charge one Dark Matter per 20 remaining days, rounded up", () => {
  assert.equal(getConstructionDarkMatterCost(0), 1);
  assert.equal(getConstructionDarkMatterCost(0.1), 1);
  assert.equal(getConstructionDarkMatterCost(20), 1);
  assert.equal(getConstructionDarkMatterCost(20.01), 2);
  assert.equal(getConstructionDarkMatterCost(80), 4);
  assert.equal(getConstructionDarkMatterCost(Number.NaN), 1);
});

test("fleet boost billing charges only moving-day boundaries before arrival", () => {
  const paidUntil = GAME_START_YEAR + daysToYears(1);

  assert.deepEqual(
    getFleetDarkMatterBillingPlan(
      paidUntil,
      GAME_START_YEAR + daysToYears(0.9),
      GAME_START_YEAR + daysToYears(10),
      10,
    ),
    {
      chargesDue: 0,
      chargedDays: 0,
      darkMatterCost: 0,
      nextPaidUntilYear: paidUntil,
      exhaustedAtYear: null,
    },
  );

  const atBoundary = getFleetDarkMatterBillingPlan(
    paidUntil,
    paidUntil,
    GAME_START_YEAR + daysToYears(10),
    10,
  );
  assert.equal(atBoundary.chargesDue, 1);
  assert.equal(atBoundary.darkMatterCost, 1);
  assert.equal(atBoundary.exhaustedAtYear, null);

  const arrivingAtBoundary = getFleetDarkMatterBillingPlan(
    paidUntil,
    paidUntil,
    paidUntil,
    10,
  );
  assert.equal(arrivingAtBoundary.chargesDue, 0);
});

test("fleet boost billing records the exact moving day where funds run out", () => {
  const paidUntil = GAME_START_YEAR + daysToYears(1);
  const billing = getFleetDarkMatterBillingPlan(
    paidUntil,
    GAME_START_YEAR + daysToYears(3.4),
    GAME_START_YEAR + daysToYears(10),
    2,
  );

  assert.equal(billing.chargesDue, 3);
  assert.equal(billing.chargedDays, 2);
  assert.equal(billing.darkMatterCost, 2);
  assert.ok(billing.exhaustedAtYear !== null);
  assert.ok(Math.abs(billing.exhaustedAtYear! - (GAME_START_YEAR + daysToYears(3))) < 1e-9);
});

test("movement plan rescaling preserves position while changing only remaining travel time", () => {
  const start = GAME_START_YEAR;
  const midpoint = start + daysToYears(5);
  const ctx = {
    state: { clock: { year: midpoint } },
  } as unknown as RuntimeContext;
  const fleet = {
    id: "fleet-dark-matter",
    ownerId: 0,
    currentStarId: 0,
    phase: "movingSystem",
    phaseStartedAtYear: start,
    phaseDurationDays: 10,
    phaseProgress: 0.5,
    systemPosition: { x: 0, y: SYSTEM_FLEET_Y, z: 0 },
    movementPlan: {
      destinationStarId: 0,
      startedAtYear: start,
      endsAtYear: start + daysToYears(10),
      totalDays: 10,
      segments: [{
        kind: "system",
        fromStarId: 0,
        toStarId: 0,
        from: { x: 0, y: SYSTEM_FLEET_Y, z: 0 },
        to: { x: 10, y: SYSTEM_FLEET_Y, z: 0 },
        startYear: start,
        endYear: start + daysToYears(10),
      }],
    },
  } as GameFleet;

  rescaleFleetMovementPlan(ctx, fleet, 1 / DARK_MATTER_FLEET_SPEED_MULTIPLIER, midpoint);
  assert.ok(Math.abs(fleet.systemPosition.x - 5) < 1e-9);
  assert.ok(Math.abs((fleet.movementPlan!.endsAtYear - midpoint) * GAME_DAYS_PER_YEAR - 0.5) < 1e-8);
  assert.ok(Math.abs(fleet.movementPlan!.segments[0].from.x - 5) < 1e-9);

  rescaleFleetMovementPlan(ctx, fleet, DARK_MATTER_FLEET_SPEED_MULTIPLIER, midpoint);
  assert.ok(Math.abs(fleet.systemPosition.x - 5) < 1e-9);
  assert.ok(Math.abs((fleet.movementPlan!.endsAtYear - midpoint) * GAME_DAYS_PER_YEAR - 5) < 1e-8);
});

test("legacy fleets normalize with Dark Matter boost disabled", () => {
  const ctx = {
    state: { clock: { year: GAME_START_YEAR } },
  } as unknown as RuntimeContext;
  const fleet = normalizeFleet(ctx, {
    id: "legacy-fleet",
    ownerId: 0,
    currentStarId: 0,
  });

  assert.equal(fleet.darkMatterBoostActive, false);
  assert.equal(fleet.darkMatterBoostPaidUntilYear, null);
});
