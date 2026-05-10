import { createEmptyResourceCounts } from "./Economy";
import type { ResourceCounts } from "./Economy";

export type StarbaseLevel = "outpost" | "starbase" | "starhold" | "starFortress";
export type StarbaseBuildingKind =
  | "solarArray"
  | "hydroponicsBay"
  | "orbitalFabricator"
  | "alloyAssemblyDock"
  | "researchAnnex"
  | "logisticsDepot";

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

export interface StarbaseBuildingDefinition {
  kind: StarbaseBuildingKind;
  label: string;
  description: string;
  production: ResourceCounts;
  upkeep: ResourceCounts;
  cost: ResourceCounts;
  buildDays: number;
}

function resources(values: Partial<ResourceCounts>): ResourceCounts {
  return {
    ...createEmptyResourceCounts(),
    ...values,
  };
}

function createConstructionId(prefix: string, parts: Array<string | number | undefined>): string {
  return `${prefix}-${parts.filter((part) => part !== undefined).join("-")}-${Date.now().toString(36)}`;
}

export const STARBASE_LEVEL_ORDER: StarbaseLevel[] = ["outpost", "starbase", "starhold", "starFortress"];

export const STARBASE_LEVEL_DEFINITIONS: Record<StarbaseLevel, StarbaseLevelDefinition> = {
  outpost: {
    level: "outpost",
    label: "Outpost",
    description: "A minimal orbital foothold with basic command, docking, and claim projection.",
    buildingSlots: 2,
    production: resources({}),
    upkeep: resources({ energy: 8, food: 0.5, goods: 0.5, alloys: 1 }),
    upgrade: { targetLevel: "starbase", alloyCost: 500, cost: resources({ alloys: 500 }), buildDays: 360 },
  },
  starbase: {
    level: "starbase",
    label: "Starbase",
    description: "A permanent orbital base with expanded logistics and defensive operations.",
    buildingSlots: 4,
    production: resources({}),
    upkeep: resources({ energy: 24, food: 4, goods: 4, alloys: 6 }),
    upgrade: { targetLevel: "starhold", alloyCost: 1250, cost: resources({ alloys: 1250, minerals: 250 }), buildDays: 720 },
  },
  starhold: {
    level: "starhold",
    label: "Starhold",
    description: "A hardened system command node with heavy docking and fleet support infrastructure.",
    buildingSlots: 6,
    production: resources({}),
    upkeep: resources({ energy: 46, food: 10, goods: 10, alloys: 14, minerals: 4 }),
    upgrade: { targetLevel: "starFortress", alloyCost: 3000, cost: resources({ alloys: 3000, minerals: 900 }), buildDays: 1080 },
  },
  starFortress: {
    level: "starFortress",
    label: "Star Fortress",
    description: "A major military installation with deep reserves and large-scale defensive systems.",
    buildingSlots: 9,
    production: resources({}),
    upkeep: resources({ energy: 78, food: 18, goods: 18, alloys: 26, minerals: 12 }),
  },
};

export const STARBASE_BUILDING_KINDS: StarbaseBuildingKind[] = [
  "solarArray",
  "hydroponicsBay",
  "orbitalFabricator",
  "alloyAssemblyDock",
  "researchAnnex",
  "logisticsDepot",
];

export const STARBASE_BUILDING_DEFINITIONS: Record<StarbaseBuildingKind, StarbaseBuildingDefinition> = {
  solarArray: {
    kind: "solarArray",
    label: "Solar Array",
    description: "Wide collector wings convert stellar radiation into station power.",
    production: resources({ energy: 18 }),
    upkeep: resources({ alloys: 0.5 }),
    cost: resources({ minerals: 220, alloys: 35 }),
    buildDays: 180,
  },
  hydroponicsBay: {
    kind: "hydroponicsBay",
    label: "Hydroponics Bay",
    description: "Pressurized cultivation decks grow food for crews and passing fleets.",
    production: resources({ food: 12 }),
    upkeep: resources({ energy: 4, goods: 1 }),
    cost: resources({ minerals: 260, goods: 40 }),
    buildDays: 210,
  },
  orbitalFabricator: {
    kind: "orbitalFabricator",
    label: "Orbital Fabricator",
    description: "Microgravity workshops turn imported minerals into advanced goods.",
    production: resources({ goods: 8 }),
    upkeep: resources({ minerals: 12, energy: 5 }),
    cost: resources({ minerals: 380, alloys: 55 }),
    buildDays: 270,
  },
  alloyAssemblyDock: {
    kind: "alloyAssemblyDock",
    label: "Alloy Assembly Dock",
    description: "Heavy orbital foundries refine imported minerals into ship-grade alloys.",
    production: resources({ alloys: 5 }),
    upkeep: resources({ minerals: 14, energy: 6 }),
    cost: resources({ minerals: 520, alloys: 90 }),
    buildDays: 330,
  },
  researchAnnex: {
    kind: "researchAnnex",
    label: "Research Annex",
    description: "Observation labs and test bays generate research from orbital operations.",
    production: resources({ research: 10 }),
    upkeep: resources({ energy: 8, goods: 2 }),
    cost: resources({ minerals: 420, goods: 80 }),
    buildDays: 300,
  },
  logisticsDepot: {
    kind: "logisticsDepot",
    label: "Logistics Depot",
    description: "Storage, docking, and maintenance facilities reduce station supply strain.",
    production: resources({ energy: 4, goods: 2 }),
    upkeep: resources({}),
    cost: resources({ minerals: 300, alloys: 45 }),
    buildDays: 240,
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
