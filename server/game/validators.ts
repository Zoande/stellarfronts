import type { FleetFormation } from "../../src/game/GameProtocol";
import type { DistrictKind } from "../../src/data/Economy";
import type {
  CombatStance,
  FleetBehavior,
  FleetChasePolicy,
  FleetRetreatPolicy,
  FleetTacticalOrderType,
  FleetEngagementRule,
  FleetDoctrine,
  FleetRetreatPreset,
} from "../../src/game/CombatTypes";

export function isDistrictKind(value: string): value is DistrictKind {
  return value === "city" || value === "generator" || value === "mining" || value === "agriculture";
}

export function isValidSlotIndex(value: number, length: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < length;
}

export const FLEET_FORMATIONS: FleetFormation[] = ["line", "vanguard", "echelon", "defensive"];
export const COMBAT_STANCES: CombatStance[] = ["passive", "evade", "holdPosition", "guardArea", "defendSystem", "aggressive", "hunt"];
export const FLEET_BEHAVIORS: FleetBehavior[] = ["artillery", "line", "brawler", "swarm", "defender"];
export const FLEET_CHASE_POLICIES: FleetChasePolicy[] = ["none", "system", "friendlySystems", "neutralSystems", "enemySystems"];
export const FLEET_RETREAT_POLICIES: FleetRetreatPolicy[] = ["none", "low", "medium", "high"];
export const FLEET_TACTICAL_ORDER_TYPES: FleetTacticalOrderType[] = ["move", "attack", "hold", "guard", "retreat"];
export const FLEET_ENGAGEMENT_RULES: FleetEngagementRule[] = ["avoid", "defendSystem", "engageSystem"];
export const FLEET_DOCTRINES: FleetDoctrine[] = ["artillery", "line", "assault", "escort"];
export const FLEET_RETREAT_PRESETS: FleetRetreatPreset[] = ["fightOn", "balanced", "preserveFleet", "avoidLosses"];

export function isFleetFormation(value: string | undefined): value is FleetFormation {
  return !!value && FLEET_FORMATIONS.includes(value as FleetFormation);
}

export function isCombatStance(value: string | undefined): value is CombatStance {
  return !!value && COMBAT_STANCES.includes(value as CombatStance);
}

export function normalizeCombatStance(value: unknown): CombatStance {
  if (value === "defensive") return "defendSystem";
  if (typeof value === "string" && isCombatStance(value)) return value;
  return "aggressive";
}

export function isFleetBehavior(value: unknown): value is FleetBehavior {
  return typeof value === "string" && FLEET_BEHAVIORS.includes(value as FleetBehavior);
}

export function isFleetChasePolicy(value: unknown): value is FleetChasePolicy {
  return typeof value === "string" && FLEET_CHASE_POLICIES.includes(value as FleetChasePolicy);
}

export function isFleetRetreatPolicy(value: unknown): value is FleetRetreatPolicy {
  return typeof value === "string" && FLEET_RETREAT_POLICIES.includes(value as FleetRetreatPolicy);
}

export function isFleetTacticalOrderType(value: unknown): value is FleetTacticalOrderType {
  return typeof value === "string" && FLEET_TACTICAL_ORDER_TYPES.includes(value as FleetTacticalOrderType);
}

export function isFleetEngagementRule(value: unknown): value is FleetEngagementRule {
  return typeof value === "string" && FLEET_ENGAGEMENT_RULES.includes(value as FleetEngagementRule);
}

export function isFleetDoctrine(value: unknown): value is FleetDoctrine {
  return typeof value === "string" && FLEET_DOCTRINES.includes(value as FleetDoctrine);
}

export function isFleetRetreatPreset(value: unknown): value is FleetRetreatPreset {
  return typeof value === "string" && FLEET_RETREAT_PRESETS.includes(value as FleetRetreatPreset);
}
