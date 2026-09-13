import { STARBASE_SHIP_DEFINITIONS } from "../../src/data/Starbase";
import type { FleetRetreatPolicy } from "../../src/game/CombatTypes";
import type { FleetFormation } from "../../src/game/GameProtocol";

export const DISCOVERY_JUMPS = 2;
export const DEPART_DURATION_MS = 20_000;
export const JUMP_DURATION_MS = 10_000;
export const ARRIVE_DURATION_MS = 30_000;
/** 180 game days at the standard one-real-second-per-game-hour clock. */
export const BUILD_DURATION_MS = 180 * 24 * 1_000;
export const SAVE_INTERVAL_MS = 5_000;
export const SERVER_TICK_INTERVAL_MS = 100;
export const RUNTIME_STATS_INTERVAL_MS = 5_000;
export const RUNTIME_CATALOG_SYNC_INTERVAL_MS = 1_000;
export const DEFAULT_TICK_SIZE_DAYS = 1 / 24;
export const DEFAULT_TICK_SPEED_SECONDS = 1;
export const DEFAULT_SHIP_SPEED = STARBASE_SHIP_DEFINITIONS.corvette.speed;
export const STARBASE_ARMOR_REPAIR_FRACTION_PER_DAY = 1 / 1_200;
export const STARBASE_HULL_REPAIR_FRACTION_PER_DAY = 1 / 3_600;
export const STARBASE_ARMOR_REPAIR_ALLOY_COST_PER_POINT = 0.035;
export const STARBASE_HULL_REPAIR_ALLOY_COST_PER_POINT = 0.06;
export const STARBASE_REPAIR_ENERGY_COST_PER_POINT = 0.015;
export const EMERGENCY_RETREAT_SHIELD_LOSS_FRACTION = 1;
export const EMERGENCY_RETREAT_ARMOR_DAMAGE_FRACTION = 0.18;
export const EMERGENCY_RETREAT_HULL_DAMAGE_FRACTION = 0.12;
export const EMERGENCY_RETREAT_SHIP_LOSS_CHANCE = 0.06;
export const EMERGENCY_RETREAT_MIN_MIA_DAYS = 8;
export const EMERGENCY_RETREAT_DISTANCE_MIA_DIVISOR = 14;
export const SYSTEM_FLEET_SPEED_UNITS_PER_DAY = 10.4;
export const SYSTEM_PLANET_ORBIT_DISTANCE = 3.4;
export const STARBASE_TACTICAL_RADIUS = 7;
export const RECENT_COMBAT_CONTACT_HISTORY = 160;
export const FLEET_GUARD_RADIUS = 72;
export const FLEET_EVADE_DISTANCE = 34;
export const FLEET_SOFT_SEPARATION_FACTOR = 0.35;
export const FLEET_RETREAT_THRESHOLDS: Record<FleetRetreatPolicy, number> = {
  none: 0,
  low: 0.25,
  medium: 0.5,
  high: 0.75,
};
export const FORMATION_EVASION_BONUS: Record<FleetFormation, number> = {
  line: 0,
  vanguard: -0.02,
  echelon: 0.04,
  defensive: 0.02,
};
// Distance falloff between the source and destination star (in hyperlane jumps).
// Neighbouring systems exchange the most migrants; distant systems still trickle.
export const MIGRATION_DISTANCE_DECAY = 0.78;
export const MIGRATION_DISTANCE_FLOOR = 0.12;
export const MIGRATION_DISTANCE_MAX_JUMPS = 16;
// Shortage only begins when stockpile hits 0; no pre-buffer.
// Rates are tuned to real-time: 1 game hour = 1 real second at default speed.
// 0→100 in 7 real days (25,200 game days) at full deficit; 100→0 in 2 real days (7,200 game days).
export const SHORTAGE_GRACE_MONTHS = 0;
export const SHORTAGE_PROGRESS_RISE_PER_DAY = 100 / 25_200; // ~0.00397
export const SHORTAGE_PROGRESS_FALL_PER_DAY = 100 / 7_200;  // ~0.01389
export const LOST_IN_TRANSIT_CHANCE_PER_DAY = 0.0018;
export const LOST_IN_TRANSIT_MIN_DAYS = 25;
export const LOST_IN_TRANSIT_MAX_DAYS = 210;
export const LEADER_OFFER_CHANCE_PER_DAY = 5.3e-6;
