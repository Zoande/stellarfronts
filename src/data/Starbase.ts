import { createEmptyResourceCounts, RESOURCE_KINDS } from "./Economy";
import type { ResourceCounts } from "./Economy";
import type { RangeBand } from "../game/CombatTypes";

export type StarbaseLevel = "outpost" | "starbase" | "starhold" | "starFortress";
export type StarbaseBuildingKind =
  | "shipyard"
  | "solarArray"
  | "hydroponicsBay"
  | "orbitalFabricator"
  | "alloyAssemblyDock"
  | "researchAnnex"
  | "logisticsDepot";
export type StarbaseShipKind = "corvette" | "constructionShip";

export type WeaponKind = "laser" | "missile" | "pointDefense";

export interface WeaponMountDefinition {
  id?: string;
  kind: WeaponKind;
  label?: string;
  barrels: number;
  damage: number;
  shieldPenetration: number;
  armorPenetration: number;
  accuracy: number;
  minRangeBand?: RangeBand;
  maxRangeBand?: RangeBand;
  optimalRangeBand?: RangeBand;
  cooldownRounds?: number;
}

export interface CombatStats {
  maxShield: number;
  maxArmor: number;
  maxHull: number;
  evasion: number;
  sensorRange: number;
  weaponMounts: WeaponMountDefinition[];
}

export const WEAPON_KIND_DEFINITIONS: Record<WeaponKind, {
  range: number;
  minRangeBand: RangeBand;
  maxRangeBand: RangeBand;
  optimalRangeBand: RangeBand;
  cooldownRounds: number;
}> = {
  laser: {
    range: 2,
    minRangeBand: "close",
    maxRangeBand: "medium",
    optimalRangeBand: "medium",
    cooldownRounds: 1,
  },
  missile: {
    range: 4,
    minRangeBand: "medium",
    maxRangeBand: "long",
    optimalRangeBand: "long",
    cooldownRounds: 2,
  },
  pointDefense: {
    range: 1,
    minRangeBand: "pointBlank",
    maxRangeBand: "close",
    optimalRangeBand: "close",
    cooldownRounds: 1,
  },
};

export interface StarbaseEconomy {
  production: ResourceCounts;
  upkeep: ResourceCounts;
  net: ResourceCounts;
}

export interface StarbaseUpgradeDefinition {
  targetLevel: StarbaseLevel;
  alloyCost: number;
  cost: ResourceCounts;
  buildDays: number;
}

export interface StarbaseLevelDefinition {
  level: StarbaseLevel;
  label: string;
  description: string;
  buildingSlots: number;
  production: ResourceCounts;
  upkeep: ResourceCounts;
  combat: CombatStats;
  upgrade?: StarbaseUpgradeDefinition;
}

export interface StarbaseConstructionQueueItem {
  id: string;
  label: string;
  kind: "upgrade" | "building";
  cost: ResourceCounts;
  remainingDays: number;
  totalDays: number;
  targetLevel?: StarbaseLevel;
  buildingKind?: StarbaseBuildingKind;
  slotIndex?: number;
}

export type StarbaseShipQueueKind = "build" | "upgrade";

export interface StarbaseShipQueueItem {
  id: string;
  kind: StarbaseShipQueueKind;
  shipKind: StarbaseShipKind;
  designId?: string | null;
  targetDesignId?: string | null;
  shipId?: string | null;
  label: string;
  cost: ResourceCounts;
  upfrontCost: ResourceCounts;
  resourceUpkeepPerDay: ResourceCounts;
  totalDays: number;
  remainingDays: number;
  alloyUpkeepPerDay: number;
  crewDemand: number;
}

export interface StarbaseBuildingDefinition {
  kind: StarbaseBuildingKind;
  label: string;
  description: string;
  production: ResourceCounts;
  upkeep: ResourceCounts;
  cost: ResourceCounts;
  buildDays: number;
  shipyards?: number;
}

export interface StarbaseShipDefinition {
  kind: StarbaseShipKind;
  label: string;
  className: string;
  description: string;
  speed: number;
  buildDays: number;
  alloyUpkeepPerDay: number;
  crewDemand: number;
  upkeep: ResourceCounts;
  combat: CombatStats;
}

function resources(values: Partial<ResourceCounts>): ResourceCounts {
  return {
    ...createEmptyResourceCounts(),
    ...values,
  };
}

function scaleResources(values: ResourceCounts, scale: number): ResourceCounts {
  return {
    food: values.food * scale,
    minerals: values.minerals * scale,
    energy: values.energy * scale,
    goods: values.goods * scale,
    alloys: values.alloys * scale,
    research: values.research * scale,
  };
}

function subtractResources(a: ResourceCounts, b: ResourceCounts): ResourceCounts {
  return {
    food: a.food - b.food,
    minerals: a.minerals - b.minerals,
    energy: a.energy - b.energy,
    goods: a.goods - b.goods,
    alloys: a.alloys - b.alloys,
    research: a.research - b.research,
  };
}

function addResources(a: ResourceCounts, b: ResourceCounts): ResourceCounts {
  return {
    food: a.food + b.food,
    minerals: a.minerals + b.minerals,
    energy: a.energy + b.energy,
    goods: a.goods + b.goods,
    alloys: a.alloys + b.alloys,
    research: a.research + b.research,
  };
}

function createConstructionId(prefix: string, parts: Array<string | number | undefined>): string {
  return `${prefix}-${parts.filter((part) => part !== undefined).join("-")}-${Date.now().toString(36)}`;
}

function createLaserMount(overrides: Partial<WeaponMountDefinition> = {}): WeaponMountDefinition {
  return {
    id: "laser",
    kind: "laser",
    label: "Laser Battery",
    barrels: 2,
    damage: 12,
    shieldPenetration: 0.12,
    armorPenetration: 0.35,
    accuracy: 0.82,
    minRangeBand: WEAPON_KIND_DEFINITIONS.laser.minRangeBand,
    maxRangeBand: WEAPON_KIND_DEFINITIONS.laser.maxRangeBand,
    optimalRangeBand: WEAPON_KIND_DEFINITIONS.laser.optimalRangeBand,
    cooldownRounds: WEAPON_KIND_DEFINITIONS.laser.cooldownRounds,
    ...overrides,
  };
}

function repeatMount(mount: WeaponMountDefinition, count: number): WeaponMountDefinition[] {
  return Array.from({ length: Math.max(1, count) }, () => ({ ...mount }));
}

export const STARBASE_LEVEL_ORDER: StarbaseLevel[] = ["outpost", "starbase", "starhold", "starFortress"];

export const STARBASE_LEVEL_DEFINITIONS: Record<StarbaseLevel, StarbaseLevelDefinition> = {
  outpost: {
    level: "outpost",
    label: "Outpost",
    description: "A minimal orbital foothold with basic command, docking, and claim projection.",
    buildingSlots: 2,
    production: resources({}),
    upkeep: resources({ energy: 12, food: 1, goods: 1, alloys: 2 }),
    combat: {
      maxShield: 700,
      maxArmor: 500,
      maxHull: 1600,
      evasion: 0.05,
      sensorRange: 3,
      weaponMounts: repeatMount(createLaserMount({ damage: 20, barrels: 3, accuracy: 0.8, armorPenetration: 0.4 }), 3),
    },
    upgrade: { targetLevel: "starbase", alloyCost: 800, cost: resources({ alloys: 800, minerals: 200 }), buildDays: 18 },
  },
  starbase: {
    level: "starbase",
    label: "Starbase",
    description: "A permanent orbital base with expanded logistics and defensive operations.",
    buildingSlots: 4,
    production: resources({}),
    upkeep: resources({ energy: 28, food: 6, goods: 6, alloys: 8 }),
    combat: {
      maxShield: 1500,
      maxArmor: 1100,
      maxHull: 6000,
      evasion: 0.04,
      sensorRange: 3,
      weaponMounts: repeatMount(createLaserMount({ damage: 26, barrels: 4, accuracy: 0.82, armorPenetration: 0.4 }), 5),
    },
    upgrade: { targetLevel: "starhold", alloyCost: 2200, cost: resources({ alloys: 2200, minerals: 600 }), buildDays: 60 },
  },
  starhold: {
    level: "starhold",
    label: "Starhold",
    description: "A hardened system command node with heavy docking and fleet support infrastructure.",
    buildingSlots: 6,
    production: resources({}),
    upkeep: resources({ energy: 55, food: 14, goods: 14, alloys: 18, minerals: 6 }),
    combat: {
      maxShield: 2500,
      maxArmor: 1800,
      maxHull: 12000,
      evasion: 0.04,
      sensorRange: 3,
      weaponMounts: repeatMount(createLaserMount({ damage: 30, barrels: 4, accuracy: 0.84, armorPenetration: 0.45 }), 8),
    },
    upgrade: { targetLevel: "starFortress", alloyCost: 4800, cost: resources({ alloys: 4800, minerals: 1400 }), buildDays: 180 },
  },
  starFortress: {
    level: "starFortress",
    label: "Star Fortress",
    description: "A major military installation with deep reserves and large-scale defensive systems.",
    buildingSlots: 9,
    production: resources({}),
    upkeep: resources({ energy: 95, food: 24, goods: 24, alloys: 34, minerals: 18 }),
    combat: {
      maxShield: 3500,
      maxArmor: 2600,
      maxHull: 18000,
      evasion: 0.03,
      sensorRange: 3,
      weaponMounts: repeatMount(createLaserMount({ damage: 34, barrels: 4, accuracy: 0.86, armorPenetration: 0.5 }), 10),
    },
  },
};

export const STARBASE_BUILDING_KINDS: StarbaseBuildingKind[] = [
  "shipyard",
  "solarArray",
  "hydroponicsBay",
  "orbitalFabricator",
  "alloyAssemblyDock",
  "researchAnnex",
  "logisticsDepot",
];

export const STARBASE_BUILDING_DEFINITIONS: Record<StarbaseBuildingKind, StarbaseBuildingDefinition> = {
  shipyard: {
    kind: "shipyard",
    label: "Shipyard",
    description: "Dedicated construction slip for assembling military and utility hulls in orbit.",
    production: resources({}),
    upkeep: resources({ energy: 8, goods: 2, alloys: 1 }),
    cost: resources({ minerals: 380, alloys: 100 }),
    buildDays: 18,
    shipyards: 1,
  },
  solarArray: {
    kind: "solarArray",
    label: "Solar Array",
    description: "Wide collector wings convert stellar radiation into station power.",
    production: resources({ energy: 18 }),
    upkeep: resources({ alloys: 0.5 }),
    cost: resources({ minerals: 260, alloys: 40 }),
    buildDays: 30,
  },
  hydroponicsBay: {
    kind: "hydroponicsBay",
    label: "Hydroponics Bay",
    description: "Pressurized cultivation decks grow food for crews and passing fleets.",
    production: resources({ food: 12 }),
    upkeep: resources({ energy: 4, goods: 1 }),
    cost: resources({ minerals: 300, goods: 50 }),
    buildDays: 30,
  },
  orbitalFabricator: {
    kind: "orbitalFabricator",
    label: "Orbital Fabricator",
    description: "Microgravity workshops turn imported minerals into advanced goods.",
    production: resources({ goods: 8 }),
    upkeep: resources({ minerals: 12, energy: 5 }),
    cost: resources({ minerals: 480, alloys: 80 }),
    buildDays: 60,
  },
  alloyAssemblyDock: {
    kind: "alloyAssemblyDock",
    label: "Alloy Assembly Dock",
    description: "Heavy orbital foundries refine imported minerals into ship-grade alloys.",
    production: resources({ alloys: 5 }),
    upkeep: resources({ minerals: 14, energy: 6 }),
    cost: resources({ minerals: 650, alloys: 140 }),
    buildDays: 90,
  },
  researchAnnex: {
    kind: "researchAnnex",
    label: "Research Annex",
    description: "Observation labs and test bays generate research from orbital operations.",
    production: resources({ research: 10 }),
    upkeep: resources({ energy: 8, goods: 2 }),
    cost: resources({ minerals: 500, goods: 100 }),
    buildDays: 60,
  },
  logisticsDepot: {
    kind: "logisticsDepot",
    label: "Logistics Depot",
    description: "Storage, docking, and maintenance facilities reduce station supply strain.",
    production: resources({ energy: 4, goods: 2 }),
    upkeep: resources({}),
    cost: resources({ minerals: 320, alloys: 60 }),
    buildDays: 30,
  },
};

export interface ShipModelDefinition {
  modelPath: string;
  modelFile: string;
  modelFormat: "obj" | "glb";
  modelPitch?: number;
  modelRoll?: number;
  modelYawOffset?: number;
  trailSocketName?: string;
  trailAxis?: "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
  trailSocketOffset?: number;
  trailSocketLift?: number;
  trailOffsetY?: number;
}

export const SHIP_MODEL_DEFINITIONS: Record<StarbaseShipKind, ShipModelDefinition> = {
  corvette: {
    modelPath: "/ships/fighter_01/",
    modelFile: "Fighter_01.obj",
    modelFormat: "obj",
    trailOffsetY: -0.22,
  },
  constructionShip: {
    modelPath: "/ships/construction_ship/",
    modelFile: "model.glb",
    modelFormat: "glb",
    modelPitch: 0,
    modelRoll: 0,
    modelYawOffset: 1.5707963267948966,
    trailSocketName: "FX_EngineTrail_Main",
    trailAxis: "+X",
    trailSocketOffset: 4.0,
    trailSocketLift: 0.35,
    trailOffsetY: 0,
  },
};

export const STARBASE_SHIP_KINDS: StarbaseShipKind[] = ["corvette", "constructionShip"];

export const STARBASE_SHIP_DEFINITIONS: Record<StarbaseShipKind, StarbaseShipDefinition> = {
  corvette: {
    kind: "corvette",
    label: "Corvette",
    className: "Falcon-class",
    description: "Fast escort hull for patrols, interception, and early fleet operations.",
    speed: 1,
    buildDays: 6,
    alloyUpkeepPerDay: 20,
    crewDemand: 1_200,
    upkeep: resources({ energy: 1.2, alloys: 0.2 }),
    combat: {
      maxShield: 120,
      maxArmor: 80,
      maxHull: 100,
      evasion: 0.2,
      sensorRange: 3,
      weaponMounts: [createLaserMount({ damage: 12, barrels: 2, accuracy: 0.82 })],
    },
  },
  constructionShip: {
    kind: "constructionShip",
    label: "Construction Ship",
    className: "Pioneer-class",
    description: "Utility hull fitted for deep-space construction and starbase deployment.",
    speed: 0.85,
    buildDays: 8,
    alloyUpkeepPerDay: 16,
    crewDemand: 700,
    upkeep: resources({ energy: 1, alloys: 0.16 }),
    combat: {
      maxShield: 80,
      maxArmor: 50,
      maxHull: 140,
      evasion: 0.08,
      sensorRange: 3,
      weaponMounts: [],
    },
  },
};

export function calculateStarbaseEconomy(
  level: StarbaseLevel,
  buildingSlots: Array<StarbaseBuildingKind | null> = [],
): StarbaseEconomy {
  const definition = STARBASE_LEVEL_DEFINITIONS[level] ?? STARBASE_LEVEL_DEFINITIONS.outpost;
  const production = resources(definition.production);
  const upkeep = resources(definition.upkeep);
  for (const buildingKind of buildingSlots) {
    if (!buildingKind) continue;
    const building = STARBASE_BUILDING_DEFINITIONS[buildingKind];
    if (!building) continue;
    for (const resource of Object.keys(production) as Array<keyof ResourceCounts>) {
      production[resource] += building.production[resource];
      upkeep[resource] += building.upkeep[resource];
    }
  }
  const net = createEmptyResourceCounts();
  for (const resource of Object.keys(net) as Array<keyof ResourceCounts>) {
    net[resource] = production[resource] - upkeep[resource];
  }
  return { production, upkeep, net };
}

export function getNextStarbaseLevel(level: StarbaseLevel): StarbaseLevel | null {
  return STARBASE_LEVEL_DEFINITIONS[level]?.upgrade?.targetLevel ?? null;
}

export function createEmptyStarbaseSlots(): Array<StarbaseBuildingKind | null> {
  return Array<StarbaseBuildingKind | null>(9).fill(null);
}

export function createStarbaseBuildingQueueItem(
  buildingKind: StarbaseBuildingKind,
  slotIndex: number,
  id = createConstructionId("starbase-building", [buildingKind, slotIndex]),
): StarbaseConstructionQueueItem {
  const definition = STARBASE_BUILDING_DEFINITIONS[buildingKind];
  return {
    id,
    kind: "building",
    label: definition.label,
    cost: resources(definition.cost),
    totalDays: definition.buildDays,
    remainingDays: definition.buildDays,
    buildingKind,
    slotIndex,
  };
}

export function createStarbaseUpgradeQueueItem(
  level: StarbaseLevel,
  id = createConstructionId("starbase-upgrade", [level]),
): StarbaseConstructionQueueItem | null {
  const upgrade = STARBASE_LEVEL_DEFINITIONS[level]?.upgrade;
  if (!upgrade) return null;
  const target = STARBASE_LEVEL_DEFINITIONS[upgrade.targetLevel];
  return {
    id,
    kind: "upgrade",
    label: `Upgrade to ${target.label}`,
    cost: resources(upgrade.cost),
    totalDays: upgrade.buildDays,
    remainingDays: upgrade.buildDays,
    targetLevel: upgrade.targetLevel,
  };
}

export function isStarbaseBuildingKind(value: string): value is StarbaseBuildingKind {
  return STARBASE_BUILDING_KINDS.includes(value as StarbaseBuildingKind);
}

export function hasQueuedStarbaseBuildingTarget(
  queue: StarbaseConstructionQueueItem[],
  slotIndex: number,
): boolean {
  return queue.some((item) => item.kind === "building" && item.slotIndex === slotIndex);
}

export function countStarbaseShipyards(buildingSlots: Array<StarbaseBuildingKind | null>): number {
  return buildingSlots.reduce((total, buildingKind) => (
    total + (buildingKind ? STARBASE_BUILDING_DEFINITIONS[buildingKind]?.shipyards ?? 0 : 0)
  ), 0);
}

export function createStarbaseShipQueueItem(
  shipKind: StarbaseShipKind,
  overrides: Partial<Omit<StarbaseShipQueueItem, "id" | "shipKind">> = {},
  id = createConstructionId("starbase-ship", [shipKind]),
): StarbaseShipQueueItem {
  const definition = STARBASE_SHIP_DEFINITIONS[shipKind];
  const totalDays = overrides.totalDays ?? definition.buildDays;
  const cost = resources(overrides.cost ?? { alloys: definition.alloyUpkeepPerDay * totalDays });
  const upfrontCost = resources(overrides.upfrontCost ?? scaleResources(cost, 0.05));
  const deferredCost = subtractResources(cost, upfrontCost);
  const resourceUpkeepPerDay = resources(overrides.resourceUpkeepPerDay ?? scaleResources(deferredCost, 1 / Math.max(1, totalDays)));
  const alloyUpkeepPerDay = overrides.alloyUpkeepPerDay ?? resourceUpkeepPerDay.alloys;
  return {
    id,
    kind: overrides.kind ?? "build",
    shipKind,
    designId: overrides.designId ?? null,
    targetDesignId: overrides.targetDesignId ?? null,
    shipId: overrides.shipId ?? null,
    label: overrides.label ?? definition.label,
    cost,
    upfrontCost,
    resourceUpkeepPerDay,
    totalDays,
    remainingDays: overrides.remainingDays ?? totalDays,
    alloyUpkeepPerDay,
    crewDemand: overrides.crewDemand ?? definition.crewDemand,
  };
}

export function isStarbaseShipKind(value: string): value is StarbaseShipKind {
  return STARBASE_SHIP_KINDS.includes(value as StarbaseShipKind);
}

function completeStarbaseConstructionItem<T extends {
  level: StarbaseLevel;
  buildingSlots: Array<StarbaseBuildingKind | null>;
  constructionQueue: StarbaseConstructionQueueItem[];
  economy: StarbaseEconomy;
}>(starbase: T, item: StarbaseConstructionQueueItem): T {
  let next: T = starbase;
  if (item.kind === "upgrade" && item.targetLevel && STARBASE_LEVEL_DEFINITIONS[item.targetLevel]) {
    next = { ...next, level: item.targetLevel };
  }
  if (
    item.kind === "building"
    && item.buildingKind
    && item.slotIndex !== undefined
    && item.slotIndex >= 0
    && item.slotIndex < next.buildingSlots.length
    && item.slotIndex < STARBASE_LEVEL_DEFINITIONS[next.level].buildingSlots
    && !next.buildingSlots[item.slotIndex]
  ) {
    next = {
      ...next,
      buildingSlots: next.buildingSlots.map((building, index) => (
        index === item.slotIndex ? item.buildingKind! : building
      )),
    };
  }
  return {
    ...next,
    economy: calculateStarbaseEconomy(next.level, next.buildingSlots),
  };
}

export function progressStarbaseConstructionQueue<T extends {
  level: StarbaseLevel;
  buildingSlots: Array<StarbaseBuildingKind | null>;
  constructionQueue: StarbaseConstructionQueueItem[];
  economy: StarbaseEconomy;
}>(
  starbase: T,
  elapsedDays: number,
): { starbase: T; changed: boolean; completed: StarbaseConstructionQueueItem[] } {
  let next = {
    ...starbase,
    economy: calculateStarbaseEconomy(starbase.level, starbase.buildingSlots),
  };
  let days = Math.max(0, elapsedDays);
  const completed: StarbaseConstructionQueueItem[] = [];
  let changed = false;

  while (days > 0 && next.constructionQueue.length > 0) {
    const [current, ...rest] = next.constructionQueue;
    if (days < current.remainingDays) {
      current.remainingDays -= days;
      next = { ...next, constructionQueue: [current, ...rest] };
      changed = true;
      break;
    }

    days = Math.max(0, days - current.remainingDays);
    const completedItem = { ...current, remainingDays: 0 };
    next = completeStarbaseConstructionItem({ ...next, constructionQueue: rest }, completedItem);
    completed.push(completedItem);
    changed = true;
  }

  return { starbase: next, changed, completed };
}

export function progressStarbaseShipQueue<T extends {
  buildingSlots: Array<StarbaseBuildingKind | null>;
  shipQueue: StarbaseShipQueueItem[];
}>(
  starbase: T,
  elapsedDays: number,
  availableResources?: ResourceCounts,
): { starbase: T; changed: boolean; completed: StarbaseShipQueueItem[]; resourcesConsumed: ResourceCounts; alloysConsumed: number } {
  const shipyardCount = countStarbaseShipyards(starbase.buildingSlots);
  if (shipyardCount <= 0 || elapsedDays <= 0 || starbase.shipQueue.length === 0) {
    return { starbase, changed: false, completed: [], resourcesConsumed: createEmptyResourceCounts(), alloysConsumed: 0 };
  }

  let queue = starbase.shipQueue
    .filter((item) => item.remainingDays > 0)
    .map((item) => ({ ...item }));
  let days = Math.max(0, elapsedDays);
  const completed: StarbaseShipQueueItem[] = [];
  let resourcesConsumed = createEmptyResourceCounts();
  let remainingResources = availableResources ? resources(availableResources) : null;
  let changed = false;

  while (days > 0 && queue.length > 0) {
    const active = queue.slice(0, shipyardCount);
    if (active.length === 0) break;
    const activeDemandPerDay = active.reduce(
      (total, item) => addResources(total, item.resourceUpkeepPerDay ?? resources({ alloys: item.alloyUpkeepPerDay })),
      createEmptyResourceCounts(),
    );
    let step = Math.min(days, ...active.map((item) => Math.max(0, item.remainingDays)));
    if (remainingResources) {
      let affordableDays = Number.POSITIVE_INFINITY;
      for (const resource of RESOURCE_KINDS) {
        const dailyDemand = activeDemandPerDay[resource];
        if (dailyDemand <= 0) continue;
        affordableDays = Math.min(affordableDays, Math.max(0, remainingResources[resource]) / dailyDemand);
      }
      step = Math.min(step, affordableDays);
    }
    if (step <= 0) break;

    for (let index = 0; index < active.length; index += 1) {
      const item = queue[index];
      item.remainingDays = Math.max(0, item.remainingDays - step);
    }
    const stepDemand = scaleResources(activeDemandPerDay, step);
    resourcesConsumed = addResources(resourcesConsumed, stepDemand);
    if (remainingResources) remainingResources = subtractResources(remainingResources, stepDemand);
    days = Math.max(0, days - step);
    changed = true;

    const remaining: StarbaseShipQueueItem[] = [];
    for (const item of queue) {
      if (item.remainingDays <= 0) {
        completed.push({ ...item, remainingDays: 0 });
      } else {
        remaining.push(item);
      }
    }
    queue = remaining;
  }

  return {
    starbase: { ...starbase, shipQueue: queue },
    changed,
    completed,
    resourcesConsumed,
    alloysConsumed: resourcesConsumed.alloys,
  };
}
