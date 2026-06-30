// =============================================================================
// NebulaFieldRenderer — paints nebula regions as soft, colorful clouds on the
// galaxy plane. Mirrors OwnershipOverlayRenderer's DynamicTexture-on-ground
// approach, but tuned for luminous gas rather than territory borders.
//
// Driven purely by the (public, never fog-gated) nebula regions, so the cloud
// always renders even over unexplored systems — you can see a nebula is there
// without seeing what's inside it.
// =============================================================================

import { DynamicTexture, Texture } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { StarData } from "../data/StarMap";
import { NEBULA_DEFINITIONS } from "../data/Nebula";
import type { NebulaRegion } from "../data/Nebula";

export interface NebulaFieldRendererOptions {
  textureSize: number;
  mapWidth: number;
  mapHeight: number;
  stars: StarData[];
  nebulae: NebulaRegion[];
  /** Hyperlane pairs (post nebula-connection) used to bridge the cloud between members. */
  hyperlanePairs?: Array<[number, number]>;
}

type Rgb = { r: number; g: number; b: number };

// Alphas are tuned for source-over (normal) compositing on the texture + a normal
// alpha-blended mesh that the galaxy renders ABOVE the additive star glow: layers
// blend toward the puff colour instead of summing past it, so the cloud tints to
// its type hue rather than washing out to white. The cloud is built in three
// passes — a faint broad wash for cohesion, a dense core right on each member star
// (which is where the star glow is brightest, so it needs the most tint), and many
// small organic puffs + fine wisps for a filamentary, gassy look rather than a
// flat blob.
const BASE_GRADIENT_ALPHA = 0.3;
const CORE_PUFF_ALPHA = 0.52;
const PUFF_ALPHA = 0.3;
const PUFFS_PER_MEMBER = 5;
const WISP_ALPHA = 0.16;
const WISPS_PER_MEMBER = 5;
// Puffs strung along each in-nebula hyperlane so neighbouring systems read as one
// continuous cloud.
const BRIDGE_PUFFS_MIN = 2;
const BRIDGE_PUFF_ALPHA = 0.24;
const BRIDGE_PUFF_SPACING = 0.7;
// How far the accent colour is allowed to wash the type tint. Kept low so each
// nebula type stays recognisably its own colour even before discovery.
const ACCENT_MIX_MAX = 0.35;
// The palette is already saturated; nudge a little further so the hue still reads
// at low alpha without tipping into neon.
const BASE_SATURATE = 1.25;
const ACCENT_SATURATE = 1.12;

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toRgb(color: [number, number, number]): Rgb {
  return {
    r: Math.round(Math.max(0, Math.min(1, color[0])) * 255),
    g: Math.round(Math.max(0, Math.min(1, color[1])) * 255),
    b: Math.round(Math.max(0, Math.min(1, color[2])) * 255),
  };
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

/** Push a colour away from grey so the nebula type reads clearly at low alpha. */
function saturate(color: Rgb, amount: number): Rgb {
  const luma = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
  return {
    r: Math.round(Math.max(0, Math.min(255, luma + (color.r - luma) * amount))),
    g: Math.round(Math.max(0, Math.min(255, luma + (color.g - luma) * amount))),
    b: Math.round(Math.max(0, Math.min(255, luma + (color.b - luma) * amount))),
  };
}

export class NebulaFieldRenderer {
  readonly texture: DynamicTexture;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly widthPx: number;
  private readonly heightPx: number;
  private readonly mapWidth: number;
  private readonly mapHeight: number;
  private readonly stars: StarData[];
  private readonly nebulae: NebulaRegion[];
  private readonly hyperlanePairs: Array<[number, number]>;

  constructor(scene: Scene, options: NebulaFieldRendererOptions) {
    const mapAspect = options.mapWidth / Math.max(1, options.mapHeight);
    this.widthPx = mapAspect >= 1
      ? options.textureSize
      : Math.max(640, Math.round(options.textureSize * mapAspect));
    this.heightPx = mapAspect >= 1
      ? Math.max(640, Math.round(options.textureSize / Math.max(0.001, mapAspect)))
      : options.textureSize;
    this.mapWidth = options.mapWidth;
    this.mapHeight = options.mapHeight;
    this.stars = options.stars;
    this.nebulae = options.nebulae;
    this.hyperlanePairs = options.hyperlanePairs ?? [];

    this.texture = new DynamicTexture(
      "galaxyNebulaFieldTexture",
      { width: this.widthPx, height: this.heightPx },
      scene,
      true,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    this.texture.hasAlpha = true;
    this.texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.texture.anisotropicFilteringLevel = 8;

    this.ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";

    this.render();
  }

  dispose(): void {
    this.texture.dispose();
  }

  private projectX(worldX: number): number {
    return (worldX / this.mapWidth + 0.5) * (this.widthPx - 1);
  }

  private projectY(worldZ: number): number {
    return (0.5 - worldZ / this.mapHeight) * (this.heightPx - 1);
  }

  private worldToPx(worldRadius: number): number {
    const pxPerWorldX = (this.widthPx - 1) / Math.max(1, this.mapWidth);
    const pxPerWorldY = (this.heightPx - 1) / Math.max(1, this.mapHeight);
    return worldRadius * (pxPerWorldX + pxPerWorldY) * 0.5;
  }

  private render(): void {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.widthPx, this.heightPx);
    // Normal (source-over) compositing so overlapping puffs blend toward their
    // colour instead of summing to white. The mesh material adds the finished
    // texture over the starfield, which supplies the luminous-gas glow.
    this.ctx.globalCompositeOperation = "source-over";

    for (const nebula of this.nebulae) {
      this.paintNebula(nebula);
    }

    this.ctx.restore();
    this.texture.update(true);
  }

  private paintNebula(nebula: NebulaRegion): void {
    const definition = NEBULA_DEFINITIONS[nebula.kind];
    // Saturate so each type reads as a distinct hue rather than a pale haze.
    const baseColor = saturate(toRgb(definition.color), BASE_SATURATE);
    const accentColor = saturate(toRgb(definition.accentColor), ACCENT_SATURATE);
    const rand = mulberry32((nebula.id + 1) * 0x85ebca6b);
    const tint = (): Rgb => mixRgb(baseColor, accentColor, rand() * ACCENT_MIX_MAX);

    const radiusPx = Math.max(8, this.worldToPx(nebula.radiusWorld));

    // Wide, faint base wash for cohesion — a soft halo that ties the members
    // together without flooding the region.
    this.paintPuff(
      this.projectX(nebula.centerX),
      this.projectY(nebula.centerZ),
      radiusPx * 1.25,
      baseColor,
      BASE_GRADIENT_ALPHA,
    );

    const memberSet = new Set(nebula.starIds);

    // Bridge the cloud along every in-nebula hyperlane so connected systems read
    // as one continuous region instead of separate blobs.
    for (const [a, b] of this.hyperlanePairs) {
      if (!memberSet.has(a) || !memberSet.has(b)) continue;
      const starA = this.stars[a];
      const starB = this.stars[b];
      if (!starA || !starB) continue;
      const ax = this.projectX(starA.x);
      const ay = this.projectY(starA.z);
      const bx = this.projectX(starB.x);
      const by = this.projectY(starB.z);
      const segLength = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(BRIDGE_PUFFS_MIN, Math.round(segLength / (radiusPx * BRIDGE_PUFF_SPACING)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const jitter = (rand() - 0.5) * radiusPx * 0.18;
        const px = ax + (bx - ax) * t + jitter;
        const py = ay + (by - ay) * t + jitter;
        const puffRadius = radiusPx * (0.2 + rand() * 0.16);
        this.paintPuff(px, py, puffRadius, tint(), BRIDGE_PUFF_ALPHA * (0.7 + rand() * 0.5));
      }
    }

    // Per member: a dense colour core right on the star (this is where the additive
    // star glow is brightest, so it needs the strongest tint to avoid a white
    // hotspot), then a scatter of organic puffs and fine wisps for a filamentary,
    // gassy texture that fades out toward the edges.
    const memberStars = nebula.starIds
      .map((starId) => this.stars[starId])
      .filter((star): star is StarData => !!star);

    for (const star of memberStars) {
      const sx = this.projectX(star.x);
      const sy = this.projectY(star.z);

      this.paintPuff(sx, sy, radiusPx * 0.26, baseColor, CORE_PUFF_ALPHA);

      for (let i = 0; i < PUFFS_PER_MEMBER; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = rand() * radiusPx * 0.45;
        const puffRadius = radiusPx * (0.2 + rand() * 0.3);
        this.paintPuff(
          sx + Math.cos(angle) * dist,
          sy + Math.sin(angle) * dist,
          puffRadius,
          tint(),
          PUFF_ALPHA * (0.6 + rand() * 0.7),
        );
      }

      for (let i = 0; i < WISPS_PER_MEMBER; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = rand() * radiusPx * 0.75;
        const puffRadius = radiusPx * (0.07 + rand() * 0.13);
        this.paintPuff(
          sx + Math.cos(angle) * dist,
          sy + Math.sin(angle) * dist,
          puffRadius,
          tint(),
          WISP_ALPHA * (0.6 + rand() * 0.8),
        );
      }
    }
  }

  private paintPuff(x: number, y: number, radius: number, color: Rgb, alpha: number): void {
    if (radius <= 0) return;
    // A soft, gradual falloff (no hard rim) so overlapping puffs read as continuous
    // gas rather than stacked discs.
    const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${color.r},${color.g},${color.b},${alpha})`);
    gradient.addColorStop(0.4, `rgba(${color.r},${color.g},${color.b},${alpha * 0.5})`);
    gradient.addColorStop(0.72, `rgba(${color.r},${color.g},${color.b},${alpha * 0.16})`);
    gradient.addColorStop(1, `rgba(${color.r},${color.g},${color.b},0)`);
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fill();
  }
}
