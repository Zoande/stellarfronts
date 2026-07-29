// =============================================================================
// Ship / fleet entity construction + normalization — extracted from server/index.ts
//
// Builders that mint fresh ships and fleets (ctx-scoped, since they allocate
// runtime ids) plus the pure normalize helpers used when rehydrating persisted
// state. The larger normalizeShip/normalizeFleet rehydrators stay in index.ts
// and import these.
// =============================================================================

import { calculateShipDesignStats } from "../../src/data/ShipDesigns";
import type { ShipDesign } from "../../src/data/ShipDesigns";
import { createEmptyResourceCounts, RESOURCE_KINDS } from "../../src/data/Economy";
import type { ResourceCounts } from "../../src/data/Economy";
import { STARBASE_LEVEL_DEFINITIONS } from "../../src/data/Starbase";
import type { StarbaseShipKind } from "../../src/data/Starbase";
import { getFleetTacticalRadius } from "../../src/game/tacticalFormation";
import type {
  FleetCombatSettings,
  FleetRetreatDestination,
  FleetRetreatState,
  FleetTacticalOrder,
  ServerStarbase,
} from "../../src/game/GameProtocol";
import { GAME_START_YEAR } from "../../src/game/GameTime";
import { DEFAULT_SHIP_SPEED } from "./constants";
import { clamp, systemCenterPosition, cloneSystemPosition } from "./pure-helpers";
import { isFleetBehavior, isFleetChasePolicy, isFleetRetreatPolicy, isFleetTacticalOrderType, isFleetEngagementRule, isFleetDoctrine, isFleetRetreatPreset } from "./validators";
import { resolveShipDesign } from "./ship-designs";
import type { GameFleet, GameShip, RuntimeContext } from "./types";

// ---------------------------------------------------------------------------
// Ship builders
// ---------------------------------------------------------------------------

export function calculateShipUpgradePlan(fromDesign: ShipDesign, targetDesign: ShipDesign): {
  cost: ResourceCounts;
  totalDays: number;
  alloyUpkeepPerDay: number;
} {
  const fromStats = calculateShipDesignStats(fromDesign);
  const targetStats = calculateShipDesignStats(targetDesign);
  const cost = createEmptyResourceCounts();
  let positiveCost = 0;
  let targetCost = 0;
  for (const resource of RESOURCE_KINDS) {
    const delta = Math.max(0, targetStats.cost[resource] - fromStats.cost[resource]);
    cost[resource] = delta;
    positiveCost += delta;
    targetCost += Math.max(0, targetStats.cost[resource]);
  }
  const refitAlloyCost = Math.max(5, targetStats.cost.alloys * 0.15);
  cost.alloys = Math.max(cost.alloys, refitAlloyCost);
  const costRatio = targetCost > 0 ? Math.max(0.2, Math.min(1, positiveCost / targetCost)) : 0.35;
  const totalDays = Math.max(1, Math.ceil(targetStats.buildDays * Math.max(0.25, costRatio)));
  return {
    cost,
    totalDays,
    alloyUpkeepPerDay: cost.alloys / totalDays,
  };
}

export function applyShipDesignToShip(ship: GameShip, design: ShipDesign): void {
  const stats = calculateShipDesignStats(design);
  const combat = stats.combat;
  const shieldRatio = ship.maxShield > 0 ? ship.shield / ship.maxShield : 1;
  const armorRatio = ship.maxArmor > 0 ? ship.armor / ship.maxArmor : 1;
  const hullRatio = ship.maxHull > 0 ? ship.hull / ship.maxHull : 1;
  ship.shipKind = design.shipKind;
  ship.designId = design.id;
  ship.targetDesignId = null;
  ship.speed = stats.speed;
  ship.maxShield = combat.maxShield;
  ship.maxArmor = combat.maxArmor;
  ship.maxHull = combat.maxHull;
  ship.maxHp = combat.maxHull;
  ship.shield = clamp(combat.maxShield * shieldRatio, 0, combat.maxShield);
  ship.armor = clamp(combat.maxArmor * armorRatio, 0, combat.maxArmor);
  ship.hull = clamp(combat.maxHull * hullRatio, 1, combat.maxHull);
  ship.hp = ship.hull;
  ship.weaponCooldowns = {};
}

export function createShipFromDesign(
  ctx: RuntimeContext,
  ownerId: number,
  fleetId: string,
  design: ShipDesign,
  id = ctx.createRuntimeId("ship", [ownerId, design.shipKind]),
): GameShip {
  const stats = calculateShipDesignStats(design);
  const combat = stats.combat;
  return {
    id,
    ownerId,
    fleetId,
    shipKind: design.shipKind,
    designId: design.id,
    targetDesignId: null,
    speed: stats.speed,
    hp: combat.maxHull,
    maxHp: combat.maxHull,
    shield: combat.maxShield,
    maxShield: combat.maxShield,
    armor: combat.maxArmor,
    maxArmor: combat.maxArmor,
    hull: combat.maxHull,
    maxHull: combat.maxHull,
    weaponCooldowns: {},
    weaponReadyAtYears: {},
    lastShieldDamageAtYear: null,
    subsystemState: { disabledWeaponKeys: [], engineDisabled: false, emergencyMobility: false },
    disabled: false,
  };
}

export function createShip(
  ctx: RuntimeContext,
  ownerId: number,
  fleetId: string,
  shipKind: StarbaseShipKind = "corvette",
  id = ctx.createRuntimeId("ship", [ownerId, shipKind]),
  designId?: string | null,
): GameShip {
  const design = resolveShipDesign(ctx.state.shipDesigns, ownerId, shipKind, designId, ctx.state.clock.year);
  return createShipFromDesign(ctx, ownerId, fleetId, design, id);
}

// ---------------------------------------------------------------------------
// Fleet builders + combat-settings/tactical-order normalization
// ---------------------------------------------------------------------------

export function createFleet(
  ctx: RuntimeContext,
  ownerId: number,
  currentStarId: number,
  shipIds: string[],
  id = ctx.createRuntimeId("fleet", [ownerId, currentStarId]),
): GameFleet {
  return {
    id,
    ownerId,
    stationaryStarbaseId: null,
    shipIds,
    formation: "line",
    currentStarId,
    targetStarId: null,
    phase: "idle",
    phaseStartedAtYear: GAME_START_YEAR,
    phaseDurationDays: 0,
    route: [currentStarId],
    routeIndex: 0,
    phaseProgress: 0,
    phaseElapsedMs: 0,
    orderType: null,
    speed: DEFAULT_SHIP_SPEED,
    combatStance: "aggressive",
    retreatState: null,
    systemPosition: systemCenterPosition(),
    hyperlanePosition: null,
    movementPlan: null,
    darkMatterBoostActive: false,
    darkMatterBoostPaidUntilYear: null,
    orbitTargetPlanetId: null,
    orbitOffset: null,
    orbitTarget: null,
    mergeTargetFleetId: null,
    combatSettings: createDefaultFleetCombatSettings(),
    currentTacticalOrder: null,
    tacticalRadius: getFleetTacticalRadius(shipIds.length),
    maxWeaponRange: 0,
    minWeaponRange: 0,
    weightedWeaponRange: 0,
    currentTargetId: null,
    currentTargetKind: null,
    combatStatus: "idle",
    lastCombatAtYear: null,
    battleSnapshot: null,
    repairOrder: null,
    commandUsed: 0,
    commandCapacity: 20,
    commandAccuracyMultiplier: 1,
    commandCooldownMultiplier: 1,
    commandCoordinationMultiplier: 1,
  };
}

export function syncStarbaseCombatHealth(starbase: ServerStarbase): ServerStarbase {
  const combat = STARBASE_LEVEL_DEFINITIONS[starbase.level]?.combat ?? STARBASE_LEVEL_DEFINITIONS.outpost.combat;
  const maxShield = Math.max(0, combat.maxShield);
  const maxArmor = Math.max(0, combat.maxArmor);
  const maxHull = Math.max(1, combat.maxHull);
  const shieldRatio = starbase.maxShield > 0 ? starbase.shield / starbase.maxShield : 1;
  const armorRatio = starbase.maxArmor > 0 ? starbase.armor / starbase.maxArmor : 1;
  const hullRatio = starbase.maxHull > 0 ? starbase.hull / starbase.maxHull : 1;
  return {
    ...starbase,
    maxShield,
    maxArmor,
    maxHull,
    shield: clamp(maxShield * shieldRatio, 0, maxShield),
    armor: clamp(maxArmor * armorRatio, 0, maxArmor),
    hull: clamp(maxHull * hullRatio, 1, maxHull),
  };
}

export function normalizeFleetRetreatState(retreatState: Partial<FleetRetreatState> | null | undefined): FleetRetreatState | null {
  if (!retreatState || !Number.isInteger(retreatState.targetStarId)) return null;
  const targetStarId = retreatState.targetStarId as number;
  const mode = retreatState.mode === "emergencyFtl" ? "emergencyFtl" : "system";
  const status = retreatState.status === "escaping" || retreatState.status === "mia" || retreatState.status === "completed"
    ? retreatState.status
    : "ordered";
  return {
    mode,
    status,
    targetStarId,
    targetSystemPosition: retreatState.targetSystemPosition ?? null,
    startedAtYear: Number(retreatState.startedAtYear) || GAME_START_YEAR,
    miaUntilYear: Number.isFinite(retreatState.miaUntilYear) ? retreatState.miaUntilYear ?? null : null,
    riskApplied: retreatState.riskApplied === true,
  };
}

export function normalizeSystemPositionValue(
  position: Partial<ReturnType<typeof systemCenterPosition>> | null | undefined,
  fallback: ReturnType<typeof systemCenterPosition> | null = null,
): ReturnType<typeof systemCenterPosition> | null {
  if (!position) return fallback ? cloneSystemPosition(fallback) : null;
  const x = Number(position.x);
  const y = Number(position.y);
  const z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return fallback ? cloneSystemPosition(fallback) : null;
  }
  return { x, y, z };
}

export function normalizeFleetRetreatDestination(
  value: Partial<FleetRetreatDestination> | null | undefined,
): FleetRetreatDestination | null {
  if (!value) return null;
  if (value.kind === "selectedSystem") {
    const targetStarId = Number(value.targetStarId);
    if (!Number.isInteger(targetStarId) || targetStarId < 0) return null;
    return {
      kind: "selectedSystem",
      targetStarId,
      targetSystemPosition: normalizeSystemPositionValue(value.targetSystemPosition),
    };
  }
  if (value.kind === "nearestFriendlyStarbase") {
    return { kind: "nearestFriendlyStarbase" };
  }
  return null;
}

export function createDefaultFleetCombatSettings(
  overrides: Partial<FleetCombatSettings> | null | undefined = null,
): FleetCombatSettings {
  return {
    behavior: isFleetBehavior(overrides?.behavior) ? overrides!.behavior! : "line",
    chasePolicy: isFleetChasePolicy(overrides?.chasePolicy) ? overrides!.chasePolicy! : "system",
    retreatPolicy: isFleetRetreatPolicy(overrides?.retreatPolicy) ? overrides!.retreatPolicy! : "medium",
    retreatDestination: normalizeFleetRetreatDestination(overrides?.retreatDestination),
    engagementRule: isFleetEngagementRule(overrides?.engagementRule) ? overrides!.engagementRule : "defendSystem",
    doctrine: isFleetDoctrine(overrides?.doctrine)
      ? overrides!.doctrine
      : overrides?.behavior === "artillery" || overrides?.behavior === "brawler" || overrides?.behavior === "swarm" || overrides?.behavior === "defender"
        ? ({ artillery: "artillery", brawler: "assault", swarm: "assault", defender: "escort" } as const)[overrides.behavior]
        : "line",
    retreatPreset: isFleetRetreatPreset(overrides?.retreatPreset)
      ? overrides!.retreatPreset
      : overrides?.retreatPolicy === "none" ? "fightOn"
        : overrides?.retreatPolicy === "low" ? "balanced"
          : overrides?.retreatPolicy === "high" ? "avoidLosses"
            : "preserveFleet",
  };
}

export function normalizeFleetTacticalOrder(order: Partial<FleetTacticalOrder> | null | undefined): FleetTacticalOrder | null {
  if (!order || !isFleetTacticalOrderType(order.type)) return null;
  const targetKind = order.targetKind === "fleet" || order.targetKind === "starbase" ? order.targetKind : null;
  return {
    type: order.type,
    targetId: typeof order.targetId === "string" ? order.targetId : null,
    targetKind,
    targetPosition: normalizeSystemPositionValue(order.targetPosition),
    guardPosition: normalizeSystemPositionValue(order.guardPosition),
    issuedAtYear: Number.isFinite(order.issuedAtYear) ? Number(order.issuedAtYear) : null,
  };
}
