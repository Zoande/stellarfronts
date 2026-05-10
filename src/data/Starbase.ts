import { createEmptyResourceCounts } from "./Economy";
import type { ResourceCounts } from "./Economy";

export type StarbaseLevel = "outpost" | "starbase" | "starhold" | "starFortress";

export interface StarbaseEconomy {
  production: ResourceCounts;
  upkeep: ResourceCounts;
  net: ResourceCounts;
}

export interface StarbaseUpgradeDefinition {
  targetLevel: StarbaseLevel;
  alloyCost: number;
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
  remainingDays: number;
  totalDays: number;
}

function resources(values: Partial<ResourceCounts>): ResourceCounts {
  return {
    ...createEmptyResourceCounts(),
    ...values,
  };
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
    upgrade: { targetLevel: "starbase", alloyCost: 500, buildDays: 360 },
  },
  starbase: {
    level: "starbase",
    label: "Starbase",
    description: "A permanent orbital base with expanded logistics and defensive operations.",
    buildingSlots: 4,
    production: resources({}),
    upkeep: resources({ energy: 24, food: 4, goods: 4, alloys: 6 }),
    upgrade: { targetLevel: "starhold", alloyCost: 1250, buildDays: 720 },
  },
  starhold: {
    level: "starhold",
    label: "Starhold",
    description: "A hardened system command node with heavy docking and fleet support infrastructure.",
    buildingSlots: 6,
    production: resources({}),
    upkeep: resources({ energy: 46, food: 10, goods: 10, alloys: 14, minerals: 4 }),
    upgrade: { targetLevel: "starFortress", alloyCost: 3000, buildDays: 1080 },
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

export function calculateStarbaseEconomy(level: StarbaseLevel): StarbaseEconomy {
  const definition = STARBASE_LEVEL_DEFINITIONS[level] ?? STARBASE_LEVEL_DEFINITIONS.outpost;
  const production = resources(definition.production);
  const upkeep = resources(definition.upkeep);
  const net = createEmptyResourceCounts();
  for (const resource of Object.keys(net) as Array<keyof ResourceCounts>) {
    net[resource] = production[resource] - upkeep[resource];
  }
  return { production, upkeep, net };
}

export function getNextStarbaseLevel(level: StarbaseLevel): StarbaseLevel | null {
  return STARBASE_LEVEL_DEFINITIONS[level]?.upgrade?.targetLevel ?? null;
}

export function createEmptyStarbaseSlots(): Array<string | null> {
  return Array<string | null>(9).fill(null);
}
