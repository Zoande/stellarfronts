import type { PlanetModifierOperation, PlanetModifierTarget } from "./Economy";
import type { GovernmentLeaderTraitEffect } from "./Government";
import type { SpeciesArchetypeId, SpeciesState } from "./Species";

export type LeaderClass = "civilian" | "military";
export type LeaderGender = "female" | "male";
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
  | "masterEconomist"
  | "visionary"
  | "aggressive"
  | "cautious"
  | "logistician"
  | "reckless"
  | "inspiring"
  | "defenseCoordinator"
  | "logisticsCommander"
  | "warHero"
  | "voidStrategist"
  // Legendary traits — only granted to rare offered leaders (not in the normal pool).
  | "legendaryStatesman"
  | "legendaryAdmiral";

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
  gender: LeaderGender;
  speciesArchetypeId: SpeciesArchetypeId;
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
  masterEconomist: {
    id: "masterEconomist",
    name: "Master Economist",
    classes: ["civilian"],
    description: "The governed planet gains +5% output from all jobs.",
    planetEffects: [{ target: "jobOutput", operation: "multiply", value: 0.05 }],
  },
  visionary: {
    id: "visionary",
    name: "Visionary",
    classes: ["civilian"],
    description: "The governed planet gains +8% researcher output and +5% population growth.",
    planetEffects: [
      { target: "jobOutput:researcher:research", operation: "multiply", value: 0.08 },
      { target: "populationGrowth", operation: "multiply", value: 0.05 },
    ],
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
  warHero: {
    id: "warHero",
    name: "War Hero",
    classes: ["military"],
    description: "Commanded fleets gain +12% attack and +4% evasion.",
    fleetEffects: { attackMultiplier: 0.12, evasionBonus: 0.04 },
  },
  voidStrategist: {
    id: "voidStrategist",
    name: "Void Strategist",
    classes: ["military"],
    description: "Commanded fleets gain +6% attack, +6% speed, and +6% shield endurance.",
    fleetEffects: { attackMultiplier: 0.06, speedMultiplier: 0.06, shieldMultiplier: 0.06 },
  },
  legendaryStatesman: {
    id: "legendaryStatesman",
    name: "Legendary Statesman",
    classes: ["civilian"],
    description: "A once-in-an-era administrator: the governed planet gains +12% happiness, +8 stability, and +6% output from all jobs.",
    planetEffects: [
      { target: "happiness", operation: "multiply", value: 0.12 },
      { target: "stability", operation: "add", value: 8 },
      { target: "jobOutput", operation: "multiply", value: 0.06 },
    ],
  },
  legendaryAdmiral: {
    id: "legendaryAdmiral",
    name: "Legendary Admiral",
    classes: ["military"],
    description: "A peerless fleet commander: commanded fleets gain +20% attack, +12% shield endurance, and +6% evasion.",
    fleetEffects: { attackMultiplier: 0.2, shieldMultiplier: 0.12, evasionBonus: 0.06 },
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
  "masterEconomist",
  "visionary",
];

const MILITARY_TRAITS: LeaderTraitId[] = [
  "aggressive",
  "cautious",
  "logistician",
  "reckless",
  "inspiring",
  "defenseCoordinator",
  "logisticsCommander",
  "warHero",
  "voidStrategist",
];

// Legendary traits are reserved for rare offered leaders; they never enter the
// normal hire pool or council rotation.
const LEGENDARY_CIVILIAN_TRAITS: LeaderTraitId[] = ["legendaryStatesman"];
const LEGENDARY_MILITARY_TRAITS: LeaderTraitId[] = ["legendaryAdmiral"];

export function getLegendaryClassTraits(leaderClass: LeaderClass): LeaderTraitId[] {
  return leaderClass === "military" ? LEGENDARY_MILITARY_TRAITS : LEGENDARY_CIVILIAN_TRAITS;
}

const FEMALE_FIRST_NAMES = [
  "Amina",
  "Elena",
  "Hana",
  "Juno",
  "Leona",
  "Mira",
  "Orla",
  "Sana",
  "Vera",
  "Anwen",
  "Cyra",
  "Esme",
  "Imara",
  "Keziah",
  "Lucia",
  "Nadia",
  "Priya",
  "Quinn",
  "Soraya",
  "Una",
  "Yara",
];

const MALE_FIRST_NAMES = [
  "Dario",
  "Farid",
  "Ilya",
  "Kaito",
  "Niko",
  "Rafi",
  "Tomas",
  "Bastian",
  "Dmitri",
  "Goran",
  "Joaquin",
  "Mateo",
  "Osei",
  "Reza",
  "Theo",
  "Zane",
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
  "Adeyemi",
  "Berg",
  "Castellan",
  "Delacroix",
  "Eskandari",
  "Fontaine",
  "Halvorsen",
  "Ishikawa",
  "Jovanovic",
  "Khoury",
  "Larsson",
  "Mbeki",
  "Novak",
  "Oyelaran",
  "Reyes",
  "Solberg",
  "Vasquez",
  "Wu",
  "Zhao",
];

// Distinctive given names + earned epithets, used only for rare legendary leaders
// so a once-in-an-era figure reads as special.
const LEGENDARY_FEMALE_FIRST_NAMES = [
  "Seraphina",
  "Valeria",
  "Anastasia",
  "Isolde",
  "Ravenna",
  "Lyra",
];

const LEGENDARY_MALE_FIRST_NAMES = [
  "Cassius",
  "Augustin",
  "Lorcan",
  "Magnus",
  "Cyrus",
  "Octavian",
];

const LEGENDARY_EPITHETS = [
  "the Unbroken",
  "the Ascendant",
  "the Farsighted",
  "the Ironhand",
  "the Tideturner",
  "the Star-Forged",
  "the Indomitable",
  "the Peerless",
  "the Lawgiver",
  "the Voidwise",
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

const PORTRAIT_ARCHETYPE_SLUG: Record<SpeciesArchetypeId, string> = {
  humanoid: "human",
  avian: "avian",
  reptilian: "reptilian",
  aquatic: "aquatic",
  fungoid: "fungoid",
};

function getLeaderPortraitUrl(gender: LeaderGender, archetypeId: SpeciesArchetypeId, key: string): string {
  const index = (hashString(`portrait:${key}`) % 5) + 1;
  return `/textures/leaders/${gender}_${PORTRAIT_ARCHETYPE_SLUG[archetypeId]}_leader_${index}.webp`;
}

function isManagedLeaderPortrait(url: string): boolean {
  return /^\/textures\/leaders\/(?:female|male)_(?:human|avian|reptilian|aquatic|fungoid)_leader_[1-5]\.webp$/.test(url);
}

export function getLeaderArchetypesByFaction(
  factions: ReadonlyArray<{ id: number; foundingSpeciesId?: string | null }>,
  species: readonly SpeciesState[],
): Map<number, SpeciesArchetypeId> {
  return new Map(factions.map((faction) => {
    const foundingSpecies = species.find((candidate) => (
      candidate.id === faction.foundingSpeciesId || candidate.originFactionId === faction.id
    ));
    return [faction.id, foundingSpecies?.archetypeId ?? "humanoid"];
  }));
}

function inferLeaderGender(raw: Partial<LeaderState>, fallback: LeaderState): LeaderGender {
  if (raw.gender === "female" || raw.gender === "male") return raw.gender;
  const firstName = raw.name?.split(/\s+/)[0];
  if (firstName && [...FEMALE_FIRST_NAMES, ...LEGENDARY_FEMALE_FIRST_NAMES].includes(firstName)) return "female";
  if (firstName && [...MALE_FIRST_NAMES, ...LEGENDARY_MALE_FIRST_NAMES].includes(firstName)) return "male";
  return hashString(raw.id ?? fallback.id) % 2 === 0 ? "female" : "male";
}

function isLegendaryLeader(id: string, traits: LeaderTraitId[]): boolean {
  return id.includes("-legendary-") || traits.some((trait) => (
    trait === "legendaryStatesman" || trait === "legendaryAdmiral"
  ));
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
  speciesArchetypeId: SpeciesArchetypeId = "humanoid",
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
  const gender: LeaderGender = rng() < 0.5 ? "female" : "male";
  const id = `leader-${factionId}-${status}-${dayIndex}-${leaderClass}-${slotIndex}-${seed.toString(36)}`;

  return {
    id,
    factionId,
    class: leaderClass,
    gender,
    speciesArchetypeId,
    name: `${pick(gender === "female" ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES, rng)} ${pick(LAST_NAMES, rng)}`,
    level: calculateLeaderLevel(xp),
    xp,
    age,
    lifespan,
    status,
    traits: secondTrait ? [firstTrait, secondTrait] : [firstTrait],
    assignment: null,
    portraitUrl: getLeaderPortraitUrl(gender, speciesArchetypeId, id),
    createdAtYear: year,
    recruitedAtYear: status === "recruited" ? year : null,
    diedAtYear: null,
  };
}

/**
 * A rare, "legendary" leader offered by the recruitment-offer event. Far stronger
 * than a pool hire: high starting level (so it survives the xp→level normalization),
 * a guaranteed exclusive legendary trait plus two strong regular traits, a unique
 * epithet name, and a longer lifespan.
 */
export function createLegendaryLeaderCandidate(
  factionId: number,
  leaderClass: LeaderClass,
  dayIndex: number,
  slotIndex: number,
  year: number,
  speciesArchetypeId: SpeciesArchetypeId = "humanoid",
): LeaderState {
  const seed = hashString(`legendary:${factionId}:${leaderClass}:${dayIndex}:${slotIndex}`);
  const rng = mulberry32(seed);

  // Level is always derived from xp (see normalizeLeaderState), so buff via xp to
  // make the buff persist across save/load. Target a clearly elite starting level.
  const targetLevel = 14 + Math.floor(rng() * 7); // 14..20
  const xp = leaderXpForLevel(targetLevel) + Math.floor(rng() * LEADER_XP_LEVEL_FACTOR);

  const legendaryTrait = pick(getLegendaryClassTraits(leaderClass), rng);
  const regularPool = getLeaderClassTraits(leaderClass).slice();
  const first = pick(regularPool, rng);
  const second = pick(regularPool.filter((trait) => trait !== first), rng);
  const traits = Array.from(new Set<LeaderTraitId>([legendaryTrait, first, second]));

  const epithet = pick(LEGENDARY_EPITHETS, rng);
  const gender: LeaderGender = rng() < 0.5 ? "female" : "male";
  const legendaryNames = gender === "female" ? LEGENDARY_FEMALE_FIRST_NAMES : LEGENDARY_MALE_FIRST_NAMES;
  const name = `${pick(legendaryNames, rng)} ${pick(LAST_NAMES, rng)} ${epithet}`;
  const age = Math.round((leaderClass === "military" ? 34 : 36) + rng() * 18);
  const lifespan = Math.round(88 + rng() * 24);

  return {
    id: `leader-${factionId}-legendary-${dayIndex}-${leaderClass}-${slotIndex}-${seed.toString(36)}`,
    factionId,
    class: leaderClass,
    gender,
    speciesArchetypeId,
    name,
    level: calculateLeaderLevel(xp),
    xp,
    age,
    lifespan,
    status: "pool",
    traits,
    assignment: null,
    portraitUrl: null,
    createdAtYear: year,
    recruitedAtYear: null,
    diedAtYear: null,
  };
}

export function createInitialLeaders(
  factionIds: number[],
  dayIndex: number,
  year: number,
  archetypesByFaction: ReadonlyMap<number, SpeciesArchetypeId> = new Map(),
): LeaderState[] {
  const leaders: LeaderState[] = [];
  for (const factionId of factionIds) {
    const archetypeId = archetypesByFaction.get(factionId) ?? "humanoid";
    leaders.push(createLeaderCandidate(factionId, "civilian", dayIndex - 1, 0, year, "recruited", archetypeId));
    leaders.push(createLeaderCandidate(factionId, "military", dayIndex - 1, 1, year, "recruited", archetypeId));
  }
  return refreshLeaderPool(leaders, factionIds, dayIndex, year, archetypesByFaction);
}

export function refreshLeaderPool(
  leaders: LeaderState[],
  factionIds: number[],
  dayIndex: number,
  year: number,
  archetypesByFaction: ReadonlyMap<number, SpeciesArchetypeId> = new Map(),
): LeaderState[] {
  const retained = leaders.filter((leader) => leader.status !== "pool");
  const next = retained.slice();
  for (const factionId of factionIds) {
    const archetypeId = archetypesByFaction.get(factionId) ?? "humanoid";
    for (let index = 0; index < LEADER_POOL_PER_CLASS; index += 1) {
      next.push(createLeaderCandidate(factionId, "civilian", dayIndex, index, year, "pool", archetypeId));
      next.push(createLeaderCandidate(factionId, "military", dayIndex, index, year, "pool", archetypeId));
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
  const id = raw?.id || fallback.id;
  const gender = inferLeaderGender(raw ?? {}, fallback);
  const speciesArchetypeId = fallback.speciesArchetypeId;
  const rawPortrait = typeof raw?.portraitUrl === "string" ? raw.portraitUrl : null;

  return {
    id,
    factionId: Number.isInteger(raw?.factionId) ? Number(raw?.factionId) : fallback.factionId,
    class: leaderClass,
    gender,
    speciesArchetypeId,
    name: raw?.name || fallback.name,
    level: calculateLeaderLevel(xp),
    xp,
    age: Math.max(18, Number(raw?.age ?? fallback.age) || fallback.age),
    lifespan: Math.max(45, Number(raw?.lifespan ?? fallback.lifespan) || fallback.lifespan),
    status,
    traits: traits.length > 0 ? traits : fallback.traits,
    assignment: status === "dead" ? null : assignment,
    portraitUrl: isLegendaryLeader(id, traits)
      ? null
      : (rawPortrait && !isManagedLeaderPortrait(rawPortrait)
          ? rawPortrait
          : getLeaderPortraitUrl(gender, speciesArchetypeId, id)),
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
  archetypesByFaction: ReadonlyMap<number, SpeciesArchetypeId> = new Map(),
): LeaderState[] {
  if (!Array.isArray(rawLeaders) || rawLeaders.length === 0) {
    return createInitialLeaders(factionIds, dayIndex, year, archetypesByFaction);
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
      archetypesByFaction.get(Number(raw?.factionId)) ?? "humanoid",
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
      normalized.push(createLeaderCandidate(
        factionId,
        leaderClass,
        dayIndex - 1,
        normalized.length,
        year,
        "recruited",
        archetypesByFaction.get(factionId) ?? "humanoid",
      ));
    }
  }

  return refreshLeaderPool(normalized, factionIds, dayIndex, year, archetypesByFaction);
}
