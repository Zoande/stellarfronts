import type { ResourceCounts } from "./Economy";
import type { PlanetFeatureKind } from "./PlanetFeatures";
import type { PlanetType } from "./StarMap";

export type ArmyTypeId = "lightInfantry" | "lineInfantry" | "mechanizedArmy" | "garrison";
export type ArmyMobility = "mobile" | "local";

export interface ArmyTypeDefinition {
  id: ArmyTypeId;
  name: string;
  description: string;
  mobility: ArmyMobility;
  attackPower: number;
  defensePower: number;
  trainingDays: number;
  hpRecoveryDays: number;
  manpowerRecoveryDays: number;
  cost: ResourceCounts;
  upkeep: ResourceCounts;
  requiredTechnologyId?: string;
}

export interface ArmyLocationFleet {
  kind: "fleet";
  fleetId: string;
}

export interface ArmyLocationPlanet {
  kind: "planet";
  planetId: string;
}

export type ArmyLocation = ArmyLocationFleet | ArmyLocationPlanet;

/**
 * Authoritative transport state while a mobile army is landed. The live ship is
 * removed from the space simulation and recreated from this snapshot on embark.
 */
export interface LandedArmyTransport {
  id: string;
  designId?: string;
  speed: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  armor: number;
  maxArmor: number;
  hull: number;
  maxHull: number;
  lastShieldDamageAtYear?: number | null;
  weaponCooldowns?: Record<string, number>;
  weaponReadyAtYears?: Record<string, number>;
  disabled?: boolean;
  crew: number;
  crewCapacity: number;
  subsystemState?: {
    disabledWeaponKeys: string[];
    engineDisabled: boolean;
    emergencyMobility: boolean;
  };
}

export interface ArmyUnit {
  id: string;
  ownerId: number;
  speciesId: string;
  typeId: ArmyTypeId;
  mobility: ArmyMobility;
  manpower: number;
  maxManpower: number;
  hp: number;
  maxHp: number;
  location: ArmyLocation;
  transportShipId?: string | null;
  landedTransport?: LandedArmyTransport | null;
  sourceFortressKey?: string | null;
  supported?: boolean;
  depleted?: boolean;
}

export interface GroundBattleState {
  id: string;
  planetId: string;
  attackerFactionId: number;
  defenderFactionId: number;
  attackerArmyIds: string[];
  defenderArmyIds: string[];
  startedAtYear: number;
  lastProcessedDay: number;
  withdrawalRequestedAtYear?: number | null;
  withdrawalDueYear?: number | null;
}

export interface ArmyPowerBreakdown {
  attack: number;
  defense: number;
  nominal: number;
  hpRatio: number;
  manpowerRatio: number;
}

const resources = (values: Partial<ResourceCounts>): ResourceCounts => ({
  food: values.food ?? 0,
  minerals: values.minerals ?? 0,
  energy: values.energy ?? 0,
  goods: values.goods ?? 0,
  alloys: values.alloys ?? 0,
  research: values.research ?? 0,
});

export const ARMY_MANPOWER = 50_000;
export const ARMY_TRANSPORT_CREW = 10_000;
export const ARMY_TOTAL_CREW_DEMAND = ARMY_MANPOWER + ARMY_TRANSPORT_CREW;
export const ARMY_TRANSPORT_BUILD_DAYS = 90;
export const ARMY_POPULATION_PER_CAP = 100_000_000;
export const SOLDIERS_PER_GARRISON = 1_000_000;
export const GARRISONS_PER_FORTRESS = 10;
export const GROUND_WITHDRAWAL_DAYS = 30;
export const GROUND_BASE_HP_LOSS_PER_DAY = 100 / 90;
export const GROUND_BASE_MANPOWER_LOSS_PER_DAY = ARMY_MANPOWER / 120;

const TRANSPORT_UPKEEP = resources({ energy: 0.745, goods: 0.045, alloys: 0.07 });

export const ARMY_TYPE_DEFINITIONS: Record<ArmyTypeId, ArmyTypeDefinition> = {
  lightInfantry: {
    id: "lightInfantry",
    name: "Light Infantry",
    description: "Fast-trained expeditionary infantry with modest equipment and balanced field performance.",
    mobility: "mobile",
    attackPower: 8_000,
    defensePower: 8_000,
    trainingDays: 90,
    hpRecoveryDays: 90,
    manpowerRecoveryDays: 180,
    cost: resources({ food: 250, minerals: 390, energy: 27, goods: 250, alloys: 450 }),
    upkeep: resources({ ...TRANSPORT_UPKEEP, food: 0.1, goods: TRANSPORT_UPKEEP.goods + 0.05 }),
  },
  lineInfantry: {
    id: "lineInfantry",
    name: "Line Infantry",
    description: "Disciplined combined-arms infantry trained for sustained planetary campaigns.",
    mobility: "mobile",
    attackPower: 12_000,
    defensePower: 12_000,
    trainingDays: 180,
    hpRecoveryDays: 180,
    manpowerRecoveryDays: 360,
    cost: resources({ food: 400, minerals: 500, energy: 75, goods: 400, alloys: 600 }),
    upkeep: resources({ ...TRANSPORT_UPKEEP, food: 0.15, goods: TRANSPORT_UPKEEP.goods + 0.1, alloys: TRANSPORT_UPKEEP.alloys + 0.05 }),
    requiredTechnologyId: "ground_warfare_doctrine",
  },
  mechanizedArmy: {
    id: "mechanizedArmy",
    name: "Mechanized Army",
    description: "Heavy armored formations with exceptional breakthrough and defensive power.",
    mobility: "mobile",
    attackPower: 30_000,
    defensePower: 30_000,
    trainingDays: 360,
    hpRecoveryDays: 360,
    manpowerRecoveryDays: 540,
    cost: resources({ food: 350, minerals: 900, energy: 250, goods: 750, alloys: 1_200 }),
    upkeep: resources({ food: 0.1, minerals: 0.05, energy: TRANSPORT_UPKEEP.energy + 0.25, goods: TRANSPORT_UPKEEP.goods + 0.2, alloys: TRANSPORT_UPKEEP.alloys + 0.18 }),
    requiredTechnologyId: "mechanized_ground_warfare",
  },
  garrison: {
    id: "garrison",
    name: "Garrison",
    description: "A Fortress-supported local defense formation that cannot embark.",
    mobility: "local",
    attackPower: 8_000,
    defensePower: 12_000,
    trainingDays: 0,
    hpRecoveryDays: 180,
    manpowerRecoveryDays: 360,
    cost: resources({}),
    upkeep: resources({}),
  },
};

export const MOBILE_ARMY_TYPE_IDS: ArmyTypeId[] = ["lightInfantry", "lineInfantry", "mechanizedArmy"];

export function isArmyTypeId(value: unknown): value is ArmyTypeId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ARMY_TYPE_DEFINITIONS, value);
}

export function getArmyMaxHp(speciesTraitIds: readonly string[]): number {
  if (speciesTraitIds.includes("resilient")) return 110;
  if (speciesTraitIds.includes("delicate")) return 90;
  return 100;
}

export function getArmyHabitabilityMultiplier(habitability: number): number {
  const bounded = Math.max(0, Math.min(100, Number(habitability) || 0));
  if (bounded <= 80) return 0.6 + (bounded / 80) * 0.4;
  return 1 + ((bounded - 80) / 20) * 0.1;
}

export function getArmyCurrentPower(
  army: Pick<ArmyUnit, "typeId" | "hp" | "maxHp" | "manpower" | "maxManpower">,
  modifiers: { habitabilityMultiplier?: number; attackMultiplier?: number; defenseMultiplier?: number } = {},
): ArmyPowerBreakdown {
  const definition = ARMY_TYPE_DEFINITIONS[army.typeId];
  const hpRatio = Math.max(0, Math.min(1, army.maxHp > 0 ? army.hp / army.maxHp : 0));
  const manpowerRatio = Math.max(0, Math.min(1, army.maxManpower > 0 ? army.manpower / army.maxManpower : 0));
  const readiness = hpRatio * manpowerRatio * Math.max(0, modifiers.habitabilityMultiplier ?? 1);
  const attack = definition.attackPower * readiness * Math.max(0, modifiers.attackMultiplier ?? 1);
  const defense = definition.defensePower * readiness * Math.max(0, modifiers.defenseMultiplier ?? 1);
  return {
    attack,
    defense,
    nominal: Math.sqrt(Math.max(0, attack * defense)),
    hpRatio,
    manpowerRatio,
  };
}

export const BASE_COMBAT_WIDTH_BY_PLANET_TYPE: Record<PlanetType, number> = {
  Barren: 3,
  Gaseous: 2,
  Snowy: 3,
  Arid: 4,
  Dusty: 3,
  Grassland: 4,
  Jungle: 2,
  Marshy: 2,
  Martian: 3,
  Methane: 2,
  Sandy: 4,
  Tundra: 3,
};

export const COMBAT_WIDTH_BY_FEATURE: Partial<Record<PlanetFeatureKind, number>> = {
  stableFoundations: 1,
  broadContinentalShelf: 1,
  strategicCrossroads: 2,
  ecumenicFoundations: 2,
  naturalCaverns: -1,
  ruggedFrontier: -1,
  flashFloods: -1,
  seismicFaults: -1,
  colossalFauna: -1,
  volatileTectonics: -1,
  hostileBiosphere: -1,
  vastCavernNetwork: -2,
  perpetualStorms: -2,
  shatteredCrust: -2,
};

export function getPlanetCombatWidth(planetType: PlanetType, features: readonly PlanetFeatureKind[]): number {
  const base = BASE_COMBAT_WIDTH_BY_PLANET_TYPE[planetType] ?? 3;
  return Math.max(1, features.reduce((total, feature) => total + (COMBAT_WIDTH_BY_FEATURE[feature] ?? 0), base));
}

/** Stable strongest-first ordering shared by the simulation and its UI/tests. */
export function selectStrongestArmyIds(
  candidates: ReadonlyArray<{ id: string; power: number }>,
  width: number,
): string[] {
  return [...candidates]
    .sort((left, right) => right.power - left.power || left.id.localeCompare(right.id))
    .slice(0, Math.max(0, Math.floor(width)))
    .map((candidate) => candidate.id);
}

export function calculateGroundDailyLoss(incomingAttack: number, defendingPower: number): {
  ratio: number;
  hp: number;
  manpower: number;
} {
  const rawRatio = Math.max(0, incomingAttack) / Math.max(0.000001, defendingPower);
  const ratio = Math.max(0.25, Math.min(4, rawRatio));
  return {
    ratio,
    hp: GROUND_BASE_HP_LOSS_PER_DAY * ratio,
    manpower: GROUND_BASE_MANPOWER_LOSS_PER_DAY * ratio,
  };
}

export function createArmyUnit(values: {
  id: string;
  ownerId: number;
  speciesId: string;
  typeId: ArmyTypeId;
  location: ArmyLocation;
  speciesTraitIds?: readonly string[];
  transportShipId?: string | null;
  sourceFortressKey?: string | null;
}): ArmyUnit {
  const definition = ARMY_TYPE_DEFINITIONS[values.typeId];
  const maxHp = getArmyMaxHp(values.speciesTraitIds ?? []);
  return {
    id: values.id,
    ownerId: values.ownerId,
    speciesId: values.speciesId,
    typeId: values.typeId,
    mobility: definition.mobility,
    manpower: ARMY_MANPOWER,
    maxManpower: ARMY_MANPOWER,
    hp: maxHp,
    maxHp,
    location: values.location,
    transportShipId: values.transportShipId ?? null,
    landedTransport: null,
    sourceFortressKey: values.sourceFortressKey ?? null,
    supported: true,
    depleted: false,
  };
}

export function normalizeArmyUnit(value: unknown): ArmyUnit | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ArmyUnit>;
  if (typeof raw.id !== "string" || !raw.id || !Number.isInteger(raw.ownerId) || typeof raw.speciesId !== "string" || !isArmyTypeId(raw.typeId)) return null;
  const definition = ARMY_TYPE_DEFINITIONS[raw.typeId];
  const location = raw.location?.kind === "fleet" && typeof raw.location.fleetId === "string"
    ? { kind: "fleet" as const, fleetId: raw.location.fleetId }
    : raw.location?.kind === "planet" && typeof raw.location.planetId === "string"
      ? { kind: "planet" as const, planetId: raw.location.planetId }
      : null;
  if (!location) return null;
  const maxManpower = Math.max(1, Math.floor(Number(raw.maxManpower) || ARMY_MANPOWER));
  const maxHp = Math.max(1, Number(raw.maxHp) || 100);
  const landed = raw.landedTransport && typeof raw.landedTransport === "object"
    ? raw.landedTransport as LandedArmyTransport
    : null;
  return {
    id: raw.id,
    ownerId: Number(raw.ownerId),
    speciesId: raw.speciesId,
    typeId: raw.typeId,
    mobility: definition.mobility,
    manpower: Math.max(0, Math.min(maxManpower, Number(raw.manpower) || 0)),
    maxManpower,
    hp: Math.max(0, Math.min(maxHp, Number(raw.hp) || 0)),
    maxHp,
    location,
    transportShipId: typeof raw.transportShipId === "string" ? raw.transportShipId : null,
    landedTransport: landed,
    sourceFortressKey: typeof raw.sourceFortressKey === "string" ? raw.sourceFortressKey : null,
    supported: raw.supported !== false,
    depleted: raw.depleted === true,
  };
}

export function normalizeGroundBattle(value: unknown): GroundBattleState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<GroundBattleState>;
  if (
    typeof raw.id !== "string" || !raw.id
    || typeof raw.planetId !== "string" || !raw.planetId
    || !Number.isInteger(raw.attackerFactionId)
    || !Number.isInteger(raw.defenderFactionId)
  ) return null;
  return {
    id: raw.id,
    planetId: raw.planetId,
    attackerFactionId: Number(raw.attackerFactionId),
    defenderFactionId: Number(raw.defenderFactionId),
    attackerArmyIds: Array.isArray(raw.attackerArmyIds) ? raw.attackerArmyIds.filter((id): id is string => typeof id === "string") : [],
    defenderArmyIds: Array.isArray(raw.defenderArmyIds) ? raw.defenderArmyIds.filter((id): id is string => typeof id === "string") : [],
    startedAtYear: Number(raw.startedAtYear) || 0,
    lastProcessedDay: Math.max(0, Math.floor(Number(raw.lastProcessedDay) || 0)),
    withdrawalRequestedAtYear: Number.isFinite(raw.withdrawalRequestedAtYear) ? Number(raw.withdrawalRequestedAtYear) : null,
    withdrawalDueYear: Number.isFinite(raw.withdrawalDueYear) ? Number(raw.withdrawalDueYear) : null,
  };
}
