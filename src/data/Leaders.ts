import type { PlanetModifierOperation, PlanetModifierTarget } from "./Economy";
import type { GovernmentLeaderTraitEffect } from "./Government";

export type LeaderClass = "civilian" | "military";
export type LeaderStatus = "pool" | "recruited" | "dead";
export type LeaderAssignmentKind = "planet" | "fleet" | "government";

export interface LeaderAssignment {
  kind: LeaderAssignmentKind;
  targetId: string;
}

export type LeaderTraitId =
  | "popular"
  | "embezzler"
  | "urbanPlanner"
  | "industrialOrganizer"
  | "strictAdministrator"
  | "brilliantTheorist"
  | "systemsArchitect"
  | "coalitionBuilder"
  | "aggressive"
  | "cautious"
  | "logistician"
  | "reckless"
  | "inspiring"
  | "defenseCoordinator"
  | "logisticsCommander";

export interface LeaderPlanetEffect {
  target: PlanetModifierTarget;
  operation: PlanetModifierOperation;
  value: number;
}

export interface LeaderFleetEffects {
  attackMultiplier?: number;
  speedMultiplier?: number;
  shieldMultiplier?: number;
  upkeepMultiplier?: number;
  evasionBonus?: number;
}

export interface LeaderTraitDefinition {
  id: LeaderTraitId;
  name: string;
  classes: LeaderClass[];
  description: string;
  planetEffects?: LeaderPlanetEffect[];
  fleetEffects?: LeaderFleetEffects;
  governmentEffects?: GovernmentLeaderTraitEffect[];
}

export interface LeaderState {
  id: string;
  factionId: number;
  class: LeaderClass;
  name: string;
  level: number;
  xp: number;
  age: number;
  lifespan: number;
  status: LeaderStatus;
  traits: LeaderTraitId[];
  assignment: LeaderAssignment | null;
  portraitUrl?: string | null;
  createdAtYear: number;
  recruitedAtYear?: number | null;
  diedAtYear?: number | null;
}

export const LEADER_MAX_LEVEL = 100;
export const LEADER_XP_LEVEL_FACTOR = 220;
export const LEADER_POOL_PER_CLASS = 3;

export const LEADER_TRAIT_DEFINITIONS: Record<LeaderTraitId, LeaderTraitDefinition> = {
  popular: {
    id: "popular",
    name: "Popular",
    classes: ["civilian"],
    description: "The governed planet gains +10% happiness.",
    planetEffects: [{ target: "happiness", operation: "multiply", value: 0.1 }],
  },
  embezzler: {
    id: "embezzler",
    name: "Embezzler",
    classes: ["civilian"],
    description: "Energy work on the governed planet loses 1% output.",
    planetEffects: [{ target: "jobOutput:technician:energy", operation: "multiply", value: -0.01 }],
  },
  urbanPlanner: {
    id: "urbanPlanner",
    name: "Urban Planner",
    classes: ["civilian"],
    description: "The governed planet gains +5% housing.",
    planetEffects: [{ target: "housing", operation: "multiply", value: 0.05 }],
  },
  industrialOrganizer: {
    id: "industrialOrganizer",
    name: "Industrial Organizer",
    classes: ["civilian"],
    description: "Artisans and metallurgists on the governed planet gain +4% output.",
    planetEffects: [
      { target: "jobOutput:artisan:goods", operation: "multiply", value: 0.04 },
      { target: "jobOutput:metallurgist:alloys", operation: "multiply", value: 0.04 },
    ],
  },
  strictAdministrator: {
    id: "strictAdministrator",
    name: "Strict Administrator",
    classes: ["civilian"],
    description: "The governed planet gains +4 stability but loses 3 happiness.",
    planetEffects: [
      { target: "stability", operation: "add", value: 4 },
      { target: "happiness", operation: "add", value: -3 },
    ],
  },
  brilliantTheorist: {
    id: "brilliantTheorist",
    name: "Brilliant Theorist",
    classes: ["civilian"],
    description: "Council: as Head of Research, adds +8% research speed.",
    governmentEffects: [{
      positionId: "headOfResearch",
      description: "Head of Research: +8% research speed.",
      effects: [{ type: "researchSpeed", value: 0.08 }],
    }],
  },
  systemsArchitect: {
    id: "systemsArchitect",
    name: "Systems Architect",
    classes: ["civilian"],
    description: "Council: as Head of Development, adds +10% construction speed.",
    governmentEffects: [{
      positionId: "headOfDevelopment",
      description: "Head of Development: +10% planetary construction speed.",
      effects: [{ type: "planetModifier", target: "constructionSpeed", operation: "multiply", value: 0.1 }],
    }],
  },
  coalitionBuilder: {
    id: "coalitionBuilder",
    name: "Coalition Builder",
    classes: ["civilian"],
    description: "Council: as President, adds stability, unity, and diplomatic standing.",
    governmentEffects: [{
      positionId: "president",
      description: "President: +3 stability, +8% unity, and +6 diplomatic relations.",
      effects: [
        { type: "planetModifier", target: "stability", operation: "add", value: 3 },
        { type: "empireStat", stat: "unity", value: 0.08 },
        { type: "empireStat", stat: "diplomaticRelations", value: 6 },
      ],
    }],
  },
  aggressive: {
    id: "aggressive",
    name: "Aggressive",
    classes: ["military"],
    description: "Commanded fleets gain +10% attack but lose 3% evasion.",
    fleetEffects: { attackMultiplier: 0.1, evasionBonus: -0.03 },
  },
  cautious: {
    id: "cautious",
    name: "Cautious",
    classes: ["military"],
    description: "Commanded fleets gain +10% shield endurance but lose 5% speed.",
    fleetEffects: { shieldMultiplier: 0.1, speedMultiplier: -0.05 },
  },
  logistician: {
    id: "logistician",
    name: "Logistician",
    classes: ["military"],
    description: "Commanded ships use 10% less monthly upkeep.",
    fleetEffects: { upkeepMultiplier: -0.1 },
  },
  reckless: {
    id: "reckless",
    name: "Reckless",
    classes: ["military"],
    description: "Commanded fleets gain +15% attack and +5% speed but lose 10% shield endurance.",
    fleetEffects: { attackMultiplier: 0.15, speedMultiplier: 0.05, shieldMultiplier: -0.1 },
  },
  inspiring: {
    id: "inspiring",
    name: "Inspiring",
    classes: ["military"],
    description: "Commanded fleets gain +5% attack, +5% speed, and +2% evasion.",
    fleetEffects: { attackMultiplier: 0.05, speedMultiplier: 0.05, evasionBonus: 0.02 },
  },
  defenseCoordinator: {
    id: "defenseCoordinator",
    name: "Defense Coordinator",
    classes: ["military"],
    description: "Council: as Minister of Defense, adds +8% fleet attack and shields.",
    governmentEffects: [{
      positionId: "ministerOfDefense",
      description: "Minister of Defense: +8% fleet attack and shield endurance.",
      effects: [
        { type: "fleetModifier", target: "attack", value: 0.08 },
        { type: "fleetModifier", target: "shield", value: 0.08 },
      ],
    }],
  },
  logisticsCommander: {
    id: "logisticsCommander",
    name: "Logistics Commander",
    classes: ["military"],
    description: "Council: as Minister of Defense, reduces fleet upkeep and improves speed.",
    governmentEffects: [{
      positionId: "ministerOfDefense",
      description: "Minister of Defense: -8% fleet upkeep and +4% fleet speed.",
      effects: [
        { type: "fleetModifier", target: "upkeep", value: -0.08 },
        { type: "fleetModifier", target: "speed", value: 0.04 },
      ],
    }],
  },
};

const CIVILIAN_TRAITS: LeaderTraitId[] = [
  "popular",
  "embezzler",
  "urbanPlanner",
  "industrialOrganizer",
  "strictAdministrator",
  "brilliantTheorist",
  "systemsArchitect",
  "coalitionBuilder",
];

const MILITARY_TRAITS: LeaderTraitId[] = [
  "aggressive",
  "cautious",
  "logistician",
  "reckless",
  "inspiring",
  "defenseCoordinator",
  "logisticsCommander",
];

const FIRST_NAMES = [
  "Amina",
  "Dario",
  "Elena",
  "Farid",
  "Hana",
  "Ilya",
  "Juno",
  "Kaito",
  "Leona",
  "Mira",
  "Niko",
  "Orla",
  "Rafi",
  "Sana",
  "Tomas",
  "Vera",
];

const LAST_NAMES = [
  "Akande",
  "Chen",
  "Dray",
  "Hale",
  "Ibarra",
  "Kovacs",
  "Muwanga",
  "Nadir",
  "Okoye",
  "Patel",
  "Rossi",
  "Sato",
  "Sharma",
  "Tarek",
  "Voss",
  "Weber",
];

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)] ?? items[0];
}

export function getLeaderTraitDefinition(traitId: LeaderTraitId): LeaderTraitDefinition {
  return LEADER_TRAIT_DEFINITIONS[traitId];
}

export function calculateLeaderLevel(xp: number): number {
  return Math.max(1, Math.min(LEADER_MAX_LEVEL, 1 + Math.floor(Math.sqrt(Math.max(0, xp) / LEADER_XP_LEVEL_FACTOR))));
}

export function leaderXpForLevel(level: number): number {
  const bounded = Math.max(1, Math.min(LEADER_MAX_LEVEL, Math.floor(level)));
  return (bounded - 1) * (bounded - 1) * LEADER_XP_LEVEL_FACTOR;
}

export function formatLeaderClass(leaderClass: LeaderClass): string {
  return leaderClass === "military" ? "Commander" : "Official";
}

export function getLeaderAssignmentClass(kind: LeaderAssignmentKind): LeaderClass {
  return kind === "fleet" ? "military" : "civilian";
}

export function getLeaderClassTraits(leaderClass: LeaderClass): LeaderTraitId[] {
  return leaderClass === "military" ? MILITARY_TRAITS : CIVILIAN_TRAITS;
}

export function createLeaderCandidate(
  factionId: number,
  leaderClass: LeaderClass,
  dayIndex: number,
  slotIndex: number,
  year: number,
  status: LeaderStatus = "pool",
): LeaderState {
  const seed = hashString(`${factionId}:${leaderClass}:${dayIndex}:${slotIndex}:${status}`);
  const rng = mulberry32(seed);
  const traits = getLeaderClassTraits(leaderClass).slice();
  const firstTrait = pick(traits, rng);
  const secondTrait = rng() > 0.78
    ? pick(traits.filter((trait) => trait !== firstTrait), rng)
    : null;
  const xp = status === "recruited" ? Math.floor(rng() * 260) : Math.floor(rng() * 80);
  const age = Math.round((leaderClass === "military" ? 30 : 32) + rng() * 24);
  const lifespan = Math.round(72 + rng() * 22);

  return {
    id: `leader-${factionId}-${status}-${dayIndex}-${leaderClass}-${slotIndex}-${seed.toString(36)}`,
    factionId,
    class: leaderClass,
    name: `${pick(FIRST_NAMES, rng)} ${pick(LAST_NAMES, rng)}`,
    level: calculateLeaderLevel(xp),
    xp,
    age,
    lifespan,
    status,
    traits: secondTrait ? [firstTrait, secondTrait] : [firstTrait],
    assignment: null,
    portraitUrl: null,
    createdAtYear: year,
    recruitedAtYear: status === "recruited" ? year : null,
    diedAtYear: null,
  };
}

export function createInitialLeaders(factionIds: number[], dayIndex: number, year: number): LeaderState[] {
  const leaders: LeaderState[] = [];
  for (const factionId of factionIds) {
    leaders.push(createLeaderCandidate(factionId, "civilian", dayIndex - 1, 0, year, "recruited"));
    leaders.push(createLeaderCandidate(factionId, "military", dayIndex - 1, 1, year, "recruited"));
  }
  return refreshLeaderPool(leaders, factionIds, dayIndex, year);
}

export function refreshLeaderPool(
  leaders: LeaderState[],
  factionIds: number[],
  dayIndex: number,
  year: number,
): LeaderState[] {
  const retained = leaders.filter((leader) => leader.status !== "pool");
  const next = retained.slice();
  for (const factionId of factionIds) {
    for (let index = 0; index < LEADER_POOL_PER_CLASS; index += 1) {
      next.push(createLeaderCandidate(factionId, "civilian", dayIndex, index, year, "pool"));
      next.push(createLeaderCandidate(factionId, "military", dayIndex, index, year, "pool"));
    }
  }
  return next;
}

export function normalizeLeaderState(raw: Partial<LeaderState> | undefined, fallback: LeaderState): LeaderState {
  const leaderClass: LeaderClass = raw?.class === "military" ? "military" : "civilian";
  const status: LeaderStatus = raw?.status === "dead" || raw?.status === "recruited" || raw?.status === "pool"
    ? raw.status
    : fallback.status;
  const traits = (raw?.traits ?? fallback.traits)
    .filter((trait): trait is LeaderTraitId => Boolean(LEADER_TRAIT_DEFINITIONS[trait as LeaderTraitId]))
    .filter((trait) => LEADER_TRAIT_DEFINITIONS[trait].classes.includes(leaderClass));
  const xp = Math.max(0, Number(raw?.xp ?? fallback.xp) || 0);
  const assignment = raw?.assignment
    && (raw.assignment.kind === "planet" || raw.assignment.kind === "fleet" || raw.assignment.kind === "government")
    && typeof raw.assignment.targetId === "string"
      ? { kind: raw.assignment.kind, targetId: raw.assignment.targetId }
      : null;

  return {
    id: raw?.id || fallback.id,
    factionId: Number.isInteger(raw?.factionId) ? Number(raw?.factionId) : fallback.factionId,
    class: leaderClass,
    name: raw?.name || fallback.name,
    level: calculateLeaderLevel(xp),
    xp,
    age: Math.max(18, Number(raw?.age ?? fallback.age) || fallback.age),
    lifespan: Math.max(45, Number(raw?.lifespan ?? fallback.lifespan) || fallback.lifespan),
    status,
    traits: traits.length > 0 ? traits : fallback.traits,
    assignment: status === "dead" ? null : assignment,
    portraitUrl: typeof raw?.portraitUrl === "string" ? raw.portraitUrl : null,
    createdAtYear: Number(raw?.createdAtYear ?? fallback.createdAtYear) || fallback.createdAtYear,
    recruitedAtYear: raw?.recruitedAtYear === null || raw?.recruitedAtYear === undefined
      ? null
      : (Number(raw.recruitedAtYear) || fallback.recruitedAtYear || null),
    diedAtYear: raw?.diedAtYear === null || raw?.diedAtYear === undefined
      ? null
      : Number(raw.diedAtYear) || null,
  };
}

export function normalizeLeadersForFactions(
  factionIds: number[],
  rawLeaders: unknown,
  dayIndex: number,
  year: number,
): LeaderState[] {
  if (!Array.isArray(rawLeaders) || rawLeaders.length === 0) {
    return createInitialLeaders(factionIds, dayIndex, year);
  }

  const factionIdSet = new Set(factionIds);
  const usedIds = new Set<string>();
  const normalized: LeaderState[] = [];
  for (let index = 0; index < rawLeaders.length; index += 1) {
    const raw = rawLeaders[index] as Partial<LeaderState>;
    const fallback = createLeaderCandidate(
      Number.isInteger(raw?.factionId) ? Number(raw.factionId) : factionIds[0] ?? 0,
      raw?.class === "military" ? "military" : "civilian",
      dayIndex,
      index,
      year,
      raw?.status === "recruited" || raw?.status === "dead" ? raw.status : "pool",
    );
    const leader = normalizeLeaderState(raw, fallback);
    if (!factionIdSet.has(leader.factionId)) continue;
    if (usedIds.has(leader.id)) {
      leader.id = `${leader.id}-${index}`;
    }
    usedIds.add(leader.id);
    normalized.push(leader);
  }

  const factionHasRecruited = new Set(
    normalized
      .filter((leader) => leader.status === "recruited")
      .map((leader) => `${leader.factionId}:${leader.class}`),
  );
  for (const factionId of factionIds) {
    for (const leaderClass of ["civilian", "military"] as const) {
      if (factionHasRecruited.has(`${factionId}:${leaderClass}`)) continue;
      normalized.push(createLeaderCandidate(factionId, leaderClass, dayIndex - 1, normalized.length, year, "recruited"));
    }
  }

  return refreshLeaderPool(normalized, factionIds, dayIndex, year);
}
