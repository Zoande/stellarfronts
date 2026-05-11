import type { StarData } from "./StarMap";

const TAU = Math.PI * 2;
const HYPERLANE_MIN_CONNECTIONS = 2;
const HYPERLANE_MAX_CONNECTIONS = 3;

export type CoreTextureShape = {
  innerRadiusFraction: number;
  outerRadiusFraction: number;
  spiralArms: number;
  spiralTightness: number;
  armSpread: number;
};

type StarArmMeta = {
  armIndex: number;
  spiralPhase: number;
  normalizedR: number;
};

type HyperlaneCandidate = {
  index: number;
  distance: number;
  score: number;
  sameArm: boolean;
};

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalizeAngle(angle: number): number {
  let a = angle % TAU;
  if (a < 0) a += TAU;
  return a;
}

function shortestAngleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
}

function buildStarArmMetadata(
  stars: StarData[],
  width: number,
  height: number,
  shape: CoreTextureShape,
): StarArmMeta[] {
  const minAxis = Math.min(width, height);
  const xScale = width / minAxis;
  const zScale = height / minAxis;
  const halfSize = minAxis / 2;
  const innerR = halfSize * shape.innerRadiusFraction;
  const outerR = halfSize * shape.outerRadiusFraction;
  const radialSpan = Math.max(0.0001, outerR - innerR);
  const armCount = Math.max(0, Math.floor(shape.spiralArms));
  const armSector = armCount > 0 ? TAU / armCount : TAU;

  const metadata: StarArmMeta[] = [];
  for (const star of stars) {
    const nx = star.x / xScale;
    const nz = star.z / zScale;
    const r = Math.hypot(nx, nz);
    const theta = Math.atan2(nz, nx);
    const normalizedR = clamp((r - innerR) / radialSpan, 0, 1);
    const twist = normalizedR * shape.spiralTightness * Math.PI;
    const spiralPhase = normalizeAngle(theta - twist);

    let armIndex = 0;
    if (armCount > 0) {
      armIndex = Math.round(spiralPhase / armSector) % armCount;
      if (armIndex < 0) armIndex += armCount;
    }

    metadata.push({ armIndex, spiralPhase, normalizedR });
  }

  return metadata;
}

export function buildHyperlanePairs(
  stars: StarData[],
  width: number,
  height: number,
  shape: CoreTextureShape,
  seed: number,
): Array<[number, number]> {
  if (stars.length < 2) return [];

  const rng = mulberry32(seed ^ 0x9e3779b1);
  const armCount = Math.max(0, Math.floor(shape.spiralArms));
  const starMeta = buildStarArmMetadata(stars, width, height, shape);
  const minAxis = Math.min(width, height);
  const maxCandidateDistance = minAxis * 0.34;
  const minBridgeDistance = minAxis * 0.1;
  const candidatePoolSize = 26;
  const candidates: HyperlaneCandidate[][] = Array.from({ length: stars.length }, () => []);

  for (let i = 0; i < stars.length; i++) {
    const localCandidates: HyperlaneCandidate[] = [];
    for (let j = 0; j < stars.length; j++) {
      if (i === j) continue;
      const dx = stars[j].x - stars[i].x;
      const dz = stars[j].z - stars[i].z;
      const distance = Math.hypot(dx, dz);
      if (distance > maxCandidateDistance) continue;

      const sameArm = armCount > 0 && starMeta[i].armIndex === starMeta[j].armIndex;
      const radialDelta = Math.abs(starMeta[i].normalizedR - starMeta[j].normalizedR);
      const spiralDelta = shortestAngleDiff(starMeta[i].spiralPhase, starMeta[j].spiralPhase);
      let score = distance;

      if (armCount > 0) {
        if (sameArm) {
          score *= 0.78 + radialDelta * 0.32;
          score *= 1 + (spiralDelta / Math.PI) * 0.18;
        } else {
          score *= 1.18 + Math.max(0, 0.1 - radialDelta) * 0.6;
          score *= 1 + ((Math.PI - spiralDelta) / Math.PI) * 0.08;
        }
      }

      localCandidates.push({ index: j, distance, score, sameArm });
    }

    if (localCandidates.length === 0) {
      for (let j = 0; j < stars.length; j++) {
        if (i === j) continue;
        const dx = stars[j].x - stars[i].x;
        const dz = stars[j].z - stars[i].z;
        localCandidates.push({
          index: j,
          distance: Math.hypot(dx, dz),
          score: Math.hypot(dx, dz),
          sameArm: armCount > 0 && starMeta[i].armIndex === starMeta[j].armIndex,
        });
      }
    }

    localCandidates.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.distance - b.distance;
    });
    candidates[i] = localCandidates.slice(0, candidatePoolSize);
  }

  const degree = new Uint8Array(stars.length);
  const targetDegree = new Uint8Array(stars.length);
  for (let i = 0; i < stars.length; i++) {
    targetDegree[i] = rng() < 0.42 ? 3 : 2;
  }

  const edges = new Set<string>();
  const hyperlanes: Array<[number, number]> = [];
  const edgeKey = (a: number, b: number): string => `${Math.min(a, b)}:${Math.max(a, b)}`;

  const connect = (a: number, b: number): boolean => {
    if (a === b) return false;
    if (degree[a] >= HYPERLANE_MAX_CONNECTIONS || degree[b] >= HYPERLANE_MAX_CONNECTIONS) return false;
    const key = edgeKey(a, b);
    if (edges.has(key)) return false;
    edges.add(key);
    degree[a] += 1;
    degree[b] += 1;
    hyperlanes.push([Math.min(a, b), Math.max(a, b)]);
    return true;
  };

  for (let pass = 0; pass < HYPERLANE_MIN_CONNECTIONS; pass++) {
    for (let i = 0; i < stars.length; i++) {
      while (degree[i] <= pass && degree[i] < HYPERLANE_MIN_CONNECTIONS) {
        const candidate = candidates[i].find((c) => degree[c.index] < HYPERLANE_MAX_CONNECTIONS && !edges.has(edgeKey(i, c.index)));
        if (!candidate) break;
        connect(i, candidate.index);
      }
    }
  }

  for (let i = 0; i < stars.length; i++) {
    if (degree[i] >= targetDegree[i]) continue;
    const candidate = candidates[i].find((c) => {
      if (degree[c.index] >= HYPERLANE_MAX_CONNECTIONS) return false;
      if (edges.has(edgeKey(i, c.index))) return false;
      return c.sameArm || rng() < 0.24;
    });
    if (candidate) connect(i, candidate.index);
  }

  if (armCount > 1) {
    for (let i = 0; i < stars.length; i++) {
      if (degree[i] >= HYPERLANE_MAX_CONNECTIONS) continue;
      if (rng() > 0.18) continue;
      const bridge = candidates[i].find((c) => (
        !c.sameArm
        && c.distance >= minBridgeDistance
        && degree[c.index] < HYPERLANE_MAX_CONNECTIONS
        && !edges.has(edgeKey(i, c.index))
      ));
      if (bridge) connect(i, bridge.index);
    }
  }

  for (let i = 0; i < stars.length; i++) {
    while (degree[i] < HYPERLANE_MIN_CONNECTIONS) {
      const candidate = candidates[i].find((c) => degree[c.index] < HYPERLANE_MAX_CONNECTIONS && !edges.has(edgeKey(i, c.index)));
      if (!candidate) break;
      connect(i, candidate.index);
    }
  }

  return hyperlanes;
}

export function buildHyperlaneAdjacency(
  hyperlanes: Array<[number, number]>,
  starCount: number,
): number[][] {
  const adjacency: number[][] = Array.from({ length: starCount }, () => []);
  for (const [a, b] of hyperlanes) {
    if (a < 0 || b < 0 || a >= starCount || b >= starCount) continue;
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  return adjacency;
}
