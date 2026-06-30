// =============================================================================
// Nebulas — cloud-like regions blanketing clusters of ~5-10 systems.
//
// A nebula always renders as a cloud on the galaxy map (even over unexplored
// systems), blocks sensor coverage into the systems it covers, rethemes the
// procedural skybox of systems inside it, and applies per-type gameplay/economic
// effects. This module is the single source of truth shared by client + server:
//   - type/definition tables (NEBULA_DEFINITIONS)
//   - deterministic generation (generateNebulae)
//   - lookup helpers (findNebulaForStar, buildNebulaStarIdSet)
//
// Effects are intentionally expressed as plain PlanetModifiers so a future tech
// or building can nullify/diminish them by emitting counter-modifiers through
// the same stacking pipeline (see server/game/state-queries.ts).
// =============================================================================

import type { PlanetModifier } from "./Economy";
import type { StarbaseBuildingKind } from "./Starbase";

export type NebulaKind =
  | "standard"
  | "toxic"
  | "dustCloud"
  | "electric"
  | "radiation"
  | "stellarNursery"
  | "ionStorm";

export const NEBULA_KINDS: NebulaKind[] = [
  "standard",
  "toxic",
  "dustCloud",
  "electric",
  "radiation",
  "stellarNursery",
  "ionStorm",
];

/** A modifier template; the `source` tag is stamped per-region at apply time. */
export type NebulaModifierTemplate = Omit<PlanetModifier, "source">;

export interface NebulaDefinition {
  kind: NebulaKind;
  label: string;
  description: string;
  /** Primary cloud tint on the galaxy map + skybox palette base (RGB 0-1). */
  color: [number, number, number];
  /** Secondary skybox color for variety (RGB 0-1). */
  accentColor: [number, number, number];
  /** Economic effects applied to planets inside the nebula. */
  planetModifiers: NebulaModifierTemplate[];
  /** Starbase building only buildable in systems inside this nebula. */
  enablesStarbaseBuilding?: StarbaseBuildingKind;
  /** Ships & starbases inside cannot hold shields (cap forced to 0). */
  forcesShieldsToZero?: boolean;
  /** Hull/armor damage applied per economy tick to ships inside. */
  hullDamagePerTick?: number;
  /** Fleet transit speed multiplier through this nebula (< 1 slows). */
  fleetSpeedMultiplier?: number;
  /**
   * Relative weight used during random generation. Higher = more common.
   * Exotic/strong nebulas are rarer.
   */
  spawnWeight: number;
}

function mod(
  id: string,
  label: string,
  target: PlanetModifier["target"],
  operation: PlanetModifier["operation"],
  value: number,
): NebulaModifierTemplate {
  return { id, label, target, operation, value };
}

export const NEBULA_DEFINITIONS: Record<NebulaKind, NebulaDefinition> = {
  standard: {
    kind: "standard",
    label: "Nebula",
    description: "A dense veil of interstellar gas and dust. Scatters sensors so nothing inside can be seen from outside.",
    // Deep cobalt reflection cloud with violet wisps — the calm baseline blue.
    color: [0.26, 0.40, 0.82],
    accentColor: [0.52, 0.36, 0.80],
    planetModifiers: [],
    spawnWeight: 3,
  },
  toxic: {
    kind: "toxic",
    label: "Toxic Nebula",
    description: "Caustic clouds poison biospheres — crops fail and populations sicken — but exotic chemistry accelerates research.",
    // Sickly chartreuse green fading to acid yellow — unmistakably toxic.
    color: [0.44, 0.74, 0.26],
    accentColor: [0.74, 0.80, 0.20],
    planetModifiers: [
      mod("nebula-toxic-food", "Toxic atmosphere", "jobOutput:farmer:food", "multiply", -0.3),
      mod("nebula-toxic-growth", "Toxic atmosphere", "populationGrowth", "multiply", -0.3),
      mod("nebula-toxic-research", "Exotic chemistry", "jobOutput:researcher:research", "multiply", 0.2),
      mod("nebula-toxic-happiness", "Toxic atmosphere", "happiness", "add", -15),
    ],
    spawnWeight: 2,
  },
  dustCloud: {
    kind: "dustCloud",
    label: "Dust Cloud",
    description: "Mineral-rich dust enriches mining and shelters crops, but the gloom wears on morale and starves power grids.",
    // Muted rusty ochre — a dim, earthy dust bank rather than a glowing cloud.
    color: [0.60, 0.40, 0.24],
    accentColor: [0.78, 0.55, 0.32],
    planetModifiers: [
      mod("nebula-dust-minerals", "Mineral-rich dust", "jobOutput:miner:minerals", "multiply", 0.3),
      mod("nebula-dust-food", "Sheltered cultivation", "jobOutput:farmer:food", "multiply", 0.1),
      mod("nebula-dust-energy", "Obscured starlight", "jobOutput:technician:energy", "multiply", -0.15),
      mod("nebula-dust-happiness", "Perpetual gloom", "happiness", "add", -10),
    ],
    enablesStarbaseBuilding: "mineralHarvester",
    spawnWeight: 2,
  },
  electric: {
    kind: "electric",
    label: "Electric Nebula",
    description: "Crackling ion storms flood reactors with power but fry agriculture and prevent shields from holding a charge.",
    // Vivid electric cyan with a deep-teal core — crackles, never washes white.
    color: [0.16, 0.68, 0.92],
    accentColor: [0.08, 0.44, 0.80],
    planetModifiers: [
      mod("nebula-electric-energy", "Charged plasma", "jobOutput:technician:energy", "multiply", 0.5),
      mod("nebula-electric-food", "Electrified soil", "jobOutput:farmer:food", "multiply", -0.5),
      mod("nebula-electric-happiness", "Restless static", "happiness", "add", -5),
    ],
    forcesShieldsToZero: true,
    spawnWeight: 1.5,
  },
  radiation: {
    kind: "radiation",
    label: "Radiation Nebula",
    description: "A pulsar's glare bathes the region in hard radiation — a research bonanza that slowly corrodes ship hulls.",
    // Hot crimson bleeding to ember orange — an angry, irradiated red.
    color: [0.88, 0.20, 0.36],
    accentColor: [1.0, 0.46, 0.26],
    planetModifiers: [
      mod("nebula-radiation-research", "Exotic radiation", "jobOutput:researcher:research", "multiply", 0.4),
      mod("nebula-radiation-happiness", "Radiation sickness", "happiness", "add", -10),
    ],
    hullDamagePerTick: 40,
    spawnWeight: 1.5,
  },
  stellarNursery: {
    kind: "stellarNursery",
    label: "Stellar Nursery",
    description: "Young, hot stars light the clouds, flooding the region with energy and speeding orbital construction.",
    // Rosy hydrogen-alpha pink lit by blue newborn stars — classic star-forming hue.
    color: [0.94, 0.46, 0.60],
    accentColor: [0.40, 0.58, 0.95],
    planetModifiers: [
      mod("nebula-nursery-energy", "Radiant young stars", "jobOutput:technician:energy", "multiply", 0.3),
      mod("nebula-nursery-construction", "Abundant raw material", "constructionSpeed", "multiply", 0.25),
      mod("nebula-nursery-happiness", "Blinding skies", "happiness", "add", -5),
    ],
    spawnWeight: 1.5,
  },
  ionStorm: {
    kind: "ionStorm",
    label: "Ion Storm",
    description: "Violent ion tempests power reactors yet cripple agriculture, collapse shields, and mire fleets in transit.",
    // Stormy amethyst violet shot through with electric blue — a churning tempest.
    color: [0.54, 0.28, 0.92],
    accentColor: [0.30, 0.50, 0.94],
    planetModifiers: [
      mod("nebula-ion-energy", "Ion discharge", "jobOutput:technician:energy", "multiply", 0.4),
      mod("nebula-ion-food", "Storm-blasted fields", "jobOutput:farmer:food", "multiply", -0.4),
      mod("nebula-ion-happiness", "Constant tempest", "happiness", "add", -10),
    ],
    forcesShieldsToZero: true,
    fleetSpeedMultiplier: 0.6,
    spawnWeight: 1,
  },
};

export interface NebulaRegion {
  id: number;
  kind: NebulaKind;
  /** Region center in galaxy-plane coordinates. */
  centerX: number;
  centerZ: number;
  /** Spatial radius in galaxy-plane units. */
  radiusWorld: number;
  /** Systems whose (x,z) fall within the region. */
  starIds: number[];
}

export function isNebulaKind(value: unknown): value is NebulaKind {
  return typeof value === "string" && NEBULA_KINDS.includes(value as NebulaKind);
}

/** Starbase buildings that can only be constructed inside a specific nebula type. */
export function getNebulaGatedBuildingKinds(): Set<StarbaseBuildingKind> {
  const gated = new Set<StarbaseBuildingKind>();
  for (const kind of NEBULA_KINDS) {
    const building = NEBULA_DEFINITIONS[kind].enablesStarbaseBuilding;
    if (building) gated.add(building);
  }
  return gated;
}

/** Whether a star is inside a nebula that enables the given starbase building. */
export function nebulaEnablesBuildingAtStar(
  nebulae: NebulaRegion[] | undefined,
  starId: number,
  building: StarbaseBuildingKind,
): boolean {
  const nebula = findNebulaForStar(nebulae, starId);
  return !!nebula && NEBULA_DEFINITIONS[nebula.kind].enablesStarbaseBuilding === building;
}

/** Build a flat set of every star id covered by any nebula. */
export function buildNebulaStarIdSet(nebulae: NebulaRegion[] | undefined): Set<number> {
  const set = new Set<number>();
  if (!nebulae) return set;
  for (const nebula of nebulae) {
    for (const starId of nebula.starIds) set.add(starId);
  }
  return set;
}

/** Find the nebula containing a given star, or null. */
export function findNebulaForStar(
  nebulae: NebulaRegion[] | undefined,
  starId: number,
): NebulaRegion | null {
  if (!nebulae) return null;
  for (const nebula of nebulae) {
    if (nebula.starIds.includes(starId)) return nebula;
  }
  return null;
}

/**
 * Travel-speed multiplier for crossing a hyperlane edge. Returns the slowest
 * (smallest) `fleetSpeedMultiplier` among the edge's endpoints, or 1 if neither
 * endpoint is in a movement-slowing nebula (e.g. an ion storm).
 */
export function nebulaTravelSpeedMultiplier(
  nebulae: NebulaRegion[] | undefined,
  fromStarId: number,
  toStarId: number,
): number {
  let multiplier = 1;
  for (const starId of [fromStarId, toStarId]) {
    const nebula = findNebulaForStar(nebulae, starId);
    const candidate = nebula ? NEBULA_DEFINITIONS[nebula.kind].fleetSpeedMultiplier : undefined;
    if (candidate !== undefined && candidate < multiplier) multiplier = candidate;
  }
  return multiplier;
}

/** Build a starId -> NebulaRegion lookup for repeated per-tick queries. */
export function buildNebulaByStarId(nebulae: NebulaRegion[] | undefined): Map<number, NebulaRegion> {
  const map = new Map<number, NebulaRegion>();
  if (!nebulae) return map;
  for (const nebula of nebulae) {
    for (const starId of nebula.starIds) map.set(starId, nebula);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/*  Seeded PRNG (Mulberry32) — matches the family used by StarMap.  */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface NebulaGenStar {
  id: number;
  x: number;
  z: number;
}

export interface GenerateNebulaeOptions {
  /** Star ids that must never fall inside a nebula (e.g. faction capitals). */
  avoidStarIds?: Iterable<number>;
  /** Number of nebulas to attempt to place. Defaults to 5-6. */
  count?: number;
}

function pickWeightedKind(rng: () => number): NebulaKind {
  const total = NEBULA_KINDS.reduce((sum, kind) => sum + NEBULA_DEFINITIONS[kind].spawnWeight, 0);
  let roll = rng() * total;
  for (const kind of NEBULA_KINDS) {
    roll -= NEBULA_DEFINITIONS[kind].spawnWeight;
    if (roll <= 0) return kind;
  }
  return "standard";
}

/**
 * Deterministically place nebulas over the star field. Each region captures
 * 5-10 systems via a spatial radius grown to the Nth-nearest star, never
 * overlapping another region and never enclosing an avoided (capital) star.
 */
export function generateNebulae(
  stars: NebulaGenStar[],
  seed: number,
  options: GenerateNebulaeOptions = {},
): NebulaRegion[] {
  const rng = mulberry32((seed | 0) ^ 0x9e3779b9);
  const avoid = new Set<number>(options.avoidStarIds ?? []);
  const targetCount = options.count ?? (rng() < 0.5 ? 5 : 6);

  const candidates = stars.filter((star) => !avoid.has(star.id));
  if (candidates.length < 5) return [];

  const used = new Set<number>(avoid);
  const regions: NebulaRegion[] = [];
  const maxAttempts = targetCount * 40;
  let attempts = 0;

  const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }): number => {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz;
  };

  while (regions.length < targetCount && attempts < maxAttempts) {
    attempts++;
    const center = candidates[Math.floor(rng() * candidates.length)];
    if (!center || used.has(center.id)) continue;

    const targetMembers = 5 + Math.floor(rng() * 6); // 5..10
    const sorted = candidates
      .map((star) => ({ star, d2: dist2(center, star) }))
      .sort((a, b) => a.d2 - b.d2);

    const radiusIdx = Math.min(targetMembers, sorted.length) - 1;
    const radius = Math.sqrt(sorted[radiusIdx].d2) * 1.12 + 1;
    const radiusSq = radius * radius;

    // Reject if any avoided (capital) star sits inside the cloud.
    const smothersCapital = stars.some(
      (star) => avoid.has(star.id) && dist2(center, star) <= radiusSq,
    );
    if (smothersCapital) continue;

    // Reject overlap with an already-placed region.
    const overlaps = regions.some(
      (region) =>
        dist2(center, { x: region.centerX, z: region.centerZ })
        < (region.radiusWorld + radius) * (region.radiusWorld + radius),
    );
    if (overlaps) continue;

    const members = sorted
      .filter((entry) => entry.d2 <= radiusSq && !used.has(entry.star.id))
      .map((entry) => entry.star.id);
    if (members.length < 5 || members.length > 10) continue;

    for (const memberId of members) used.add(memberId);
    regions.push({
      id: regions.length,
      kind: pickWeightedKind(rng),
      centerX: center.x,
      centerZ: center.z,
      radiusWorld: radius,
      starIds: members,
    });
  }

  return regions;
}

// ---------------------------------------------------------------------------
// Hyperlane connectivity
// ---------------------------------------------------------------------------

interface NebulaConnectStar {
  id: number;
  x: number;
  z: number;
}

/**
 * Guarantee that every system inside a nebula is reachable from every other
 * system in the same nebula via hyperlanes. The base hyperlane generator can
 * leave a region's members split across disconnected sub-clusters; that makes a
 * nebula look (and play) like a barrier with isolated pockets. We weld those
 * sub-clusters together by adding the shortest cross-cluster lanes, ignoring the
 * usual per-star degree cap so the cloud always reads as one navigable region.
 *
 * Deterministic: given the same hyperlanes/nebulae/stars it returns the same
 * edges, so the client (which regenerates lanes locally) and the server stay in
 * lockstep. Returns a new array; the input is not mutated.
 */
export function connectNebulaeWithHyperlanes(
  hyperlanes: Array<[number, number]>,
  nebulae: NebulaRegion[] | undefined,
  stars: NebulaConnectStar[],
): Array<[number, number]> {
  if (!nebulae || nebulae.length === 0) return hyperlanes;

  const result: Array<[number, number]> = hyperlanes.map(([a, b]) => [a, b] as [number, number]);
  const edgeKey = (a: number, b: number): string => `${Math.min(a, b)}:${Math.max(a, b)}`;
  const edges = new Set(result.map(([a, b]) => edgeKey(a, b)));
  const addEdge = (a: number, b: number): void => {
    if (a === b) return;
    const key = edgeKey(a, b);
    if (edges.has(key)) return;
    edges.add(key);
    result.push([Math.min(a, b), Math.max(a, b)]);
  };

  for (const nebula of nebulae) {
    const members = nebula.starIds.filter((id) => id >= 0 && id < stars.length);
    if (members.length < 2) continue;
    const memberSet = new Set(members);

    // Union-find over the members, seeded with the lanes that already join them.
    const parent = new Map<number, number>(members.map((id) => [id, id]));
    const find = (x: number): number => {
      let root = x;
      while (parent.get(root) !== root) root = parent.get(root) as number;
      let cur = x;
      while (parent.get(cur) !== root) {
        const next = parent.get(cur) as number;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };
    const union = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    for (const [a, b] of result) {
      if (memberSet.has(a) && memberSet.has(b)) union(a, b);
    }

    // Repeatedly weld the two closest members that sit in different clusters
    // until the whole region is one connected component.
    const distinctRoots = (): Set<number> => new Set(members.map((id) => find(id)));
    while (distinctRoots().size > 1) {
      let bestA = -1;
      let bestB = -1;
      let bestDistSq = Number.POSITIVE_INFINITY;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i];
          const b = members[j];
          if (find(a) === find(b)) continue;
          const dx = stars[a].x - stars[b].x;
          const dz = stars[a].z - stars[b].z;
          const distSq = dx * dx + dz * dz;
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestA = a;
            bestB = b;
          }
        }
      }
      if (bestA < 0) break;
      addEdge(bestA, bestB);
      union(bestA, bestB);
    }
  }

  return result;
}

/** Stamp each star's `nebulaId` from a set of regions (mutates in place). */
export function stampNebulaIds(
  stars: Array<{ id: number; nebulaId?: number }>,
  nebulae: NebulaRegion[],
): void {
  const byStar = new Map<number, number>();
  for (const nebula of nebulae) {
    for (const starId of nebula.starIds) byStar.set(starId, nebula.id);
  }
  for (const star of stars) {
    const nebulaId = byStar.get(star.id);
    if (nebulaId !== undefined) star.nebulaId = nebulaId;
    else delete star.nebulaId;
  }
}
