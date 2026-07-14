// =============================================================================
// NebulaFieldRenderer — paints nebula regions as soft, colorful clouds on the
// galaxy plane. Mirrors OwnershipOverlayRenderer's DynamicTexture-on-ground
// approach, but tuned for luminous gas rather than territory borders. A second
// transparent texture carries each type's animated particles, currents and storms.
//
// Driven purely by the (public, never fog-gated) nebula regions, so the cloud
// always renders even over unexplored systems — you can see a nebula is there
// without seeing what's inside it.
// =============================================================================

import { DynamicTexture, Texture } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { StarData } from "../data/StarMap";
import type { NebulaKind, NebulaRegion } from "../data/Nebula";

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
type Point2 = { x: number; y: number };

type LightningPath = {
  points: Point2[];
  strength: number;
};

type LightningStrike = {
  startedAt: number;
  duration: number;
  flashCenter: Point2;
  flashRadius: number;
  paths: LightningPath[];
};

type ElectricStormState = {
  nebula: NebulaRegion;
  rand: () => number;
  nextStrikeAt: number;
  strikes: LightningStrike[];
};

type AmbientNebulaState = {
  nebula: NebulaRegion;
  phaseOffset: number;
};

type StaticNebulaTheme = {
  outer: Rgb;
  shadow: Rgb;
  mid: Rgb;
  core: Rgb;
  accent: Rgb;
  secondary: Rgb;
  aspect: number;
};

// Alphas are tuned for source-over (normal) compositing on the texture + a normal
// alpha-blended mesh that the galaxy renders ABOVE the additive star glow: layers
// blend toward the puff colour instead of summing past it, so the cloud tints to
// its type hue rather than washing out to white. The cloud is built in three
// passes — a faint broad wash for cohesion, a dense core right on each member star
// (which is where the star glow is brightest, so it needs the most tint), and many
// small organic puffs + fine wisps for a filamentary, gassy look rather than a
// flat blob.
// The palette is already saturated, so keep this near 1 (no extra punch) — pushing
// it harder tips the clouds into a neon, over-intense look.

// Animation uses a smaller texture so effects can move without uploading the full
// high-resolution gas texture every frame.
const NEBULA_EFFECT_TEXTURE_SCALE = 0.54;
const NEBULA_EFFECT_MIN_TEXTURE_SIZE = 720;
const NEBULA_EFFECT_FPS = 20;
const ELECTRIC_CELLS_PER_MEMBER = 7;
const ELECTRIC_WISPS_PER_MEMBER = 5;
const ELECTRIC_MIN_STRIKE_DELAY = 0.28;
const ELECTRIC_RANDOM_STRIKE_DELAY = 1.05;
const ELECTRIC_STRIKE_MIN_DURATION = 0.28;
const ELECTRIC_STRIKE_RANDOM_DURATION = 0.3;

const ELECTRIC_SHADOW: Rgb = { r: 3, g: 12, b: 29 };
const ELECTRIC_DEEP: Rgb = { r: 6, g: 31, b: 57 };
const ELECTRIC_CLOUD: Rgb = { r: 10, g: 62, b: 91 };
const ELECTRIC_PLASMA: Rgb = { r: 19, g: 157, b: 221 };
const ELECTRIC_CHARGE: Rgb = { r: 73, g: 218, b: 255 };
const ELECTRIC_VIOLET: Rgb = { r: 75, g: 91, b: 211 };

const STATIC_NEBULA_THEMES: Record<NebulaKind, StaticNebulaTheme> = {
  standard: {
    outer: { r: 16, g: 30, b: 78 },
    shadow: { r: 8, g: 15, b: 47 },
    mid: { r: 38, g: 76, b: 164 },
    core: { r: 80, g: 119, b: 225 },
    accent: { r: 143, g: 104, b: 226 },
    secondary: { r: 72, g: 190, b: 229 },
    aspect: 1.18,
  },
  toxic: {
    outer: { r: 35, g: 57, b: 17 },
    shadow: { r: 14, g: 30, b: 10 },
    mid: { r: 78, g: 126, b: 31 },
    core: { r: 151, g: 200, b: 49 },
    accent: { r: 222, g: 231, b: 62 },
    secondary: { r: 57, g: 171, b: 88 },
    aspect: 1.06,
  },
  dustCloud: {
    outer: { r: 71, g: 42, b: 24 },
    shadow: { r: 31, g: 20, b: 16 },
    mid: { r: 123, g: 76, b: 38 },
    core: { r: 178, g: 111, b: 52 },
    accent: { r: 221, g: 154, b: 77 },
    secondary: { r: 139, g: 91, b: 66 },
    aspect: 1.34,
  },
  electric: {
    outer: ELECTRIC_DEEP,
    shadow: ELECTRIC_SHADOW,
    mid: ELECTRIC_CLOUD,
    core: ELECTRIC_PLASMA,
    accent: ELECTRIC_CHARGE,
    secondary: ELECTRIC_VIOLET,
    aspect: 1.12,
  },
  radiation: {
    outer: { r: 72, g: 11, b: 30 },
    shadow: { r: 34, g: 5, b: 20 },
    mid: { r: 160, g: 27, b: 61 },
    core: { r: 235, g: 63, b: 77 },
    accent: { r: 255, g: 139, b: 54 },
    secondary: { r: 255, g: 215, b: 105 },
    aspect: 1.08,
  },
  stellarNursery: {
    outer: { r: 74, g: 21, b: 62 },
    shadow: { r: 36, g: 9, b: 43 },
    mid: { r: 173, g: 54, b: 111 },
    core: { r: 244, g: 116, b: 151 },
    accent: { r: 105, g: 151, b: 246 },
    secondary: { r: 244, g: 203, b: 230 },
    aspect: 1.2,
  },
  ionStorm: {
    outer: { r: 41, g: 15, b: 83 },
    shadow: { r: 18, g: 7, b: 49 },
    mid: { r: 91, g: 44, b: 181 },
    core: { r: 151, g: 81, b: 239 },
    accent: { r: 64, g: 153, b: 246 },
    secondary: { r: 181, g: 145, b: 255 },
    aspect: 1.02,
  },
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

export class NebulaFieldRenderer {
  readonly texture: DynamicTexture;
  readonly effectsTexture: DynamicTexture | null;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly effectsCtx: CanvasRenderingContext2D | null;
  private readonly widthPx: number;
  private readonly heightPx: number;
  private readonly effectsWidthPx: number;
  private readonly effectsHeightPx: number;
  private readonly mapWidth: number;
  private readonly mapHeight: number;
  private readonly stars: StarData[];
  private readonly nebulae: NebulaRegion[];
  private readonly hyperlanePairs: Array<[number, number]>;
  private readonly electricStorms: ElectricStormState[];
  private readonly ambientNebulae: AmbientNebulaState[];
  private elapsedSeconds = 0;
  private effectsFrameAccumulator = 0;

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

    const electricNebulae = this.nebulae.filter((nebula) => nebula.kind === "electric");
    if (this.nebulae.length > 0) {
      const effectTextureSize = Math.max(
        NEBULA_EFFECT_MIN_TEXTURE_SIZE,
        Math.round(options.textureSize * NEBULA_EFFECT_TEXTURE_SCALE),
      );
      this.effectsWidthPx = mapAspect >= 1
        ? effectTextureSize
        : Math.max(480, Math.round(effectTextureSize * mapAspect));
      this.effectsHeightPx = mapAspect >= 1
        ? Math.max(480, Math.round(effectTextureSize / Math.max(0.001, mapAspect)))
        : effectTextureSize;
      this.effectsTexture = new DynamicTexture(
        "galaxyNebulaEffectsTexture",
        { width: this.effectsWidthPx, height: this.effectsHeightPx },
        scene,
        true,
        Texture.BILINEAR_SAMPLINGMODE,
      );
      this.effectsTexture.hasAlpha = true;
      this.effectsTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
      this.effectsTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
      this.effectsCtx = this.effectsTexture.getContext() as unknown as CanvasRenderingContext2D;
      this.effectsCtx.imageSmoothingEnabled = true;
      this.effectsCtx.imageSmoothingQuality = "high";
    } else {
      this.effectsWidthPx = 0;
      this.effectsHeightPx = 0;
      this.effectsTexture = null;
      this.effectsCtx = null;
    }

    this.electricStorms = electricNebulae.map((nebula) => {
      const rand = mulberry32((nebula.id + 1) * 0x27d4eb2d);
      return {
        nebula,
        rand,
        nextStrikeAt: 0.12 + rand() * 0.85,
        strikes: [],
      };
    });
    this.ambientNebulae = this.nebulae
      .filter((nebula) => nebula.kind !== "electric")
      .map((nebula) => ({
        nebula,
        phaseOffset: mulberry32((nebula.id + 1) * 0x165667b1)() * Math.PI * 2,
      }));

    this.render();
    this.renderEffects();
  }

  dispose(): void {
    this.effectsTexture?.dispose();
    this.texture.dispose();
  }

  update(deltaSeconds: number): void {
    if (!this.effectsTexture || !this.effectsCtx || this.nebulae.length === 0) return;

    const dt = Math.max(0, Math.min(0.1, deltaSeconds));
    this.elapsedSeconds += dt;
    this.effectsFrameAccumulator += dt;
    let changed = false;

    for (const storm of this.electricStorms) {
      if (this.elapsedSeconds >= storm.nextStrikeAt) {
        storm.strikes.push(this.createLightningStrike(storm));
        // Occasional double discharge makes the storm feel volatile without
        // turning the entire cloud into a constant white strobe.
        if (storm.rand() < 0.2) {
          storm.strikes.push(this.createLightningStrike(storm, 0.08 + storm.rand() * 0.1));
        }
        storm.nextStrikeAt = this.elapsedSeconds
          + ELECTRIC_MIN_STRIKE_DELAY
          + storm.rand() * ELECTRIC_RANDOM_STRIKE_DELAY;
        changed = true;
      }

      const active = storm.strikes.filter((strike) => (
        this.elapsedSeconds < strike.startedAt + strike.duration
      ));
      if (active.length !== storm.strikes.length) changed = true;
      storm.strikes = active;
    }

    const frameInterval = 1 / NEBULA_EFFECT_FPS;
    const hasActiveLightning = this.electricStorms.some((storm) => storm.strikes.length > 0);
    const hasContinuousEffects = this.ambientNebulae.length > 0;
    if (!changed && this.effectsFrameAccumulator < frameInterval) return;
    if (!changed && !hasActiveLightning && !hasContinuousEffects) return;

    this.effectsFrameAccumulator %= frameInterval;
    this.renderEffects();
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

  private projectEffectX(worldX: number): number {
    return (worldX / this.mapWidth + 0.5) * (this.effectsWidthPx - 1);
  }

  private projectEffectY(worldZ: number): number {
    return (0.5 - worldZ / this.mapHeight) * (this.effectsHeightPx - 1);
  }

  private worldToEffectPx(worldRadius: number): number {
    const pxPerWorldX = (this.effectsWidthPx - 1) / Math.max(1, this.mapWidth);
    const pxPerWorldY = (this.effectsHeightPx - 1) / Math.max(1, this.mapHeight);
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
    if (nebula.kind === "electric") {
      this.paintElectricNebula(nebula);
      return;
    }

    const theme = STATIC_NEBULA_THEMES[nebula.kind];
    this.paintLayeredNebula(nebula, theme);
    return;

    // Wide, faint base wash for cohesion — a soft halo that ties the members
    // together without flooding the region.
    // Bridge the cloud along every in-nebula hyperlane so connected systems read
    // as one continuous region instead of separate blobs.
    // Per member: a dense colour core right on the star (this is where the additive
    // star glow is brightest, so it needs the strongest tint to avoid a white
    // hotspot), then a scatter of organic puffs and fine wisps for a filamentary,
    // gassy texture that fades out toward the edges.
  }

  private paintLayeredNebula(nebula: NebulaRegion, theme: StaticNebulaTheme): void {
    const rand = mulberry32((nebula.id + 1) * 0x85ebca6b);
    const radiusPx = Math.max(8, this.worldToPx(nebula.radiusWorld));
    const centerX = this.projectX(nebula.centerX);
    const centerY = this.projectY(nebula.centerZ);
    const rotation = (rand() - 0.5) * 0.65;
    const memberSet = new Set(nebula.starIds);

    this.paintEllipticalPuff(
      centerX,
      centerY,
      radiusPx * 1.28 * theme.aspect,
      radiusPx * 0.98,
      theme.outer,
      0.42,
      rotation,
    );
    this.paintEllipticalPuff(
      centerX - Math.cos(rotation) * radiusPx * 0.08,
      centerY - Math.sin(rotation) * radiusPx * 0.08,
      radiusPx * 0.94 * theme.aspect,
      radiusPx * 0.68,
      theme.shadow,
      0.3,
      rotation + 0.12,
    );

    // Irregular perimeter banks establish a distinct silhouette and keep the
    // high-resolution cloud from reading as one radial-gradient disc.
    for (let i = 0; i < 16; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = radiusPx * (0.25 + rand() * 0.63);
      const size = radiusPx * (0.18 + rand() * 0.26);
      const colorRoll = rand();
      const color = colorRoll < 0.28 ? theme.shadow : colorRoll < 0.72 ? theme.outer : theme.mid;
      this.paintEllipticalPuff(
        centerX + Math.cos(angle) * dist * theme.aspect,
        centerY + Math.sin(angle) * dist * 0.82,
        size * (1 + rand() * 0.9),
        size * (0.48 + rand() * 0.5),
        color,
        0.17 + rand() * 0.2,
        angle + (rand() - 0.5) * 0.9,
      );
    }

    // As with the electric front, bridge member systems so each generated region
    // reads as a single physical phenomenon rather than a set of circular stains.
    for (const [a, b] of this.hyperlanePairs) {
      if (!memberSet.has(a) || !memberSet.has(b)) continue;
      const starA = this.stars[a];
      const starB = this.stars[b];
      if (!starA || !starB) continue;
      const ax = this.projectX(starA.x);
      const ay = this.projectY(starA.z);
      const bx = this.projectX(starB.x);
      const by = this.projectY(starB.z);
      const laneAngle = Math.atan2(by - ay, bx - ax);
      const steps = Math.max(3, Math.round(Math.hypot(bx - ax, by - ay) / (radiusPx * 0.38)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const size = radiusPx * (0.12 + rand() * 0.13);
        this.paintEllipticalPuff(
          ax + (bx - ax) * t + (rand() - 0.5) * radiusPx * 0.1,
          ay + (by - ay) * t + (rand() - 0.5) * radiusPx * 0.1,
          size * (1.45 + rand() * 0.5),
          size * (0.58 + rand() * 0.3),
          rand() < 0.28 ? theme.accent : theme.mid,
          0.16 + rand() * 0.14,
          laneAngle,
        );
      }
    }

    const memberStars = nebula.starIds
      .map((starId) => this.stars[starId])
      .filter((star): star is StarData => !!star);
    for (const star of memberStars) {
      const sx = this.projectX(star.x);
      const sy = this.projectY(star.z);
      this.paintPuff(sx, sy, radiusPx * 0.3, theme.shadow, 0.38);
      this.paintPuff(sx, sy, radiusPx * 0.2, theme.mid, 0.34);
      this.paintPuff(sx, sy, radiusPx * 0.09, theme.core, 0.24);

      for (let i = 0; i < 6; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = rand() * radiusPx * 0.52;
        const size = radiusPx * (0.1 + rand() * 0.2);
        const colorRoll = rand();
        const color = colorRoll < 0.2 ? theme.shadow : colorRoll < 0.68 ? theme.mid : theme.accent;
        this.paintEllipticalPuff(
          sx + Math.cos(angle) * dist,
          sy + Math.sin(angle) * dist,
          size * (1 + rand() * 0.85),
          size * (0.5 + rand() * 0.5),
          color,
          0.14 + rand() * 0.2,
          angle + (rand() - 0.5) * 0.8,
        );
      }

      for (let i = 0; i < 4; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = rand() * radiusPx * 0.75;
        const size = radiusPx * (0.045 + rand() * 0.08);
        this.paintEllipticalPuff(
          sx + Math.cos(angle) * dist,
          sy + Math.sin(angle) * dist,
          size * (2.2 + rand() * 1.4),
          size * (0.35 + rand() * 0.3),
          rand() < 0.5 ? theme.accent : theme.secondary,
          0.06 + rand() * 0.08,
          angle,
        );
      }
    }

    this.paintThemedStaticAccents(nebula, theme, rand, centerX, centerY, radiusPx, rotation);
  }

  private paintThemedStaticAccents(
    nebula: NebulaRegion,
    theme: StaticNebulaTheme,
    rand: () => number,
    centerX: number,
    centerY: number,
    radiusPx: number,
    rotation: number,
  ): void {
    this.ctx.save();

    if (nebula.kind === "standard") {
      this.ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 9; i++) {
        const yOffset = (i / 8 - 0.5) * radiusPx * 1.15;
        this.paintStaticRibbon(
          centerX,
          centerY + yOffset,
          radiusPx * (0.65 + rand() * 0.38),
          radiusPx * (0.07 + rand() * 0.07),
          rotation + (rand() - 0.5) * 0.55,
          i % 3 === 0 ? theme.secondary : theme.accent,
          0.045 + rand() * 0.045,
          rand() * Math.PI * 2,
        );
      }
    } else if (nebula.kind === "toxic") {
      for (let i = 0; i < 24; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = radiusPx * Math.sqrt(rand()) * 0.88;
        const size = radiusPx * (0.025 + rand() * 0.075);
        const x = centerX + Math.cos(angle) * dist * theme.aspect;
        const y = centerY + Math.sin(angle) * dist * 0.82;
        this.paintStaticRing(x, y, size, rand() < 0.35 ? theme.accent : theme.secondary, 0.12 + rand() * 0.12);
        if (rand() < 0.45) this.paintPuff(x, y, size * 0.58, theme.core, 0.12);
      }
    } else if (nebula.kind === "dustCloud") {
      this.clipEllipse(centerX, centerY, radiusPx * 1.2 * theme.aspect, radiusPx * 0.86, rotation);
      this.ctx.lineCap = "round";
      for (let i = 0; i < 85; i++) {
        const along = (rand() - 0.5) * radiusPx * 2.55;
        const across = (rand() - 0.5) * radiusPx * 1.6;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const x = centerX + along * cos - across * sin;
        const y = centerY + along * sin + across * cos;
        const length = radiusPx * (0.025 + rand() * 0.12);
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(x + cos * length, y + sin * length);
        this.ctx.strokeStyle = `rgba(${theme.accent.r},${theme.accent.g},${theme.accent.b},${0.055 + rand() * 0.1})`;
        this.ctx.lineWidth = Math.max(0.7, radiusPx * (0.002 + rand() * 0.004));
        this.ctx.stroke();
      }
    } else if (nebula.kind === "radiation") {
      this.ctx.globalCompositeOperation = "lighter";
      this.paintPuff(centerX, centerY, radiusPx * 0.22, theme.secondary, 0.3);
      for (let i = 0; i < 18; i++) {
        const angle = (i / 18) * Math.PI * 2 + (rand() - 0.5) * 0.12;
        const inner = radiusPx * (0.13 + rand() * 0.08);
        const outer = radiusPx * (0.55 + rand() * 0.42);
        this.ctx.beginPath();
        this.ctx.moveTo(centerX + Math.cos(angle) * inner, centerY + Math.sin(angle) * inner);
        this.ctx.lineTo(centerX + Math.cos(angle) * outer, centerY + Math.sin(angle) * outer);
        this.ctx.strokeStyle = `rgba(${theme.accent.r},${theme.accent.g},${theme.accent.b},${0.035 + rand() * 0.06})`;
        this.ctx.lineWidth = Math.max(0.7, radiusPx * (0.002 + rand() * 0.006));
        this.ctx.stroke();
      }
      this.paintStaticRing(centerX, centerY, radiusPx * 0.38, theme.accent, 0.1);
    } else if (nebula.kind === "stellarNursery") {
      this.ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 18; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = radiusPx * Math.sqrt(rand()) * 0.82;
        const x = centerX + Math.cos(angle) * dist * theme.aspect;
        const y = centerY + Math.sin(angle) * dist * 0.78;
        const size = radiusPx * (0.012 + rand() * 0.025);
        this.paintPuff(x, y, size * 4.5, i % 3 === 0 ? theme.accent : theme.core, 0.14);
        this.paintStaticStar(x, y, size, i % 3 === 0 ? theme.secondary : theme.accent, 0.35 + rand() * 0.3);
      }
      for (let i = 0; i < 7; i++) {
        this.paintStaticRibbon(
          centerX + (rand() - 0.5) * radiusPx * 0.45,
          centerY + (rand() - 0.5) * radiusPx * 0.45,
          radiusPx * (0.5 + rand() * 0.48),
          radiusPx * (0.05 + rand() * 0.06),
          rand() * Math.PI,
          i % 2 === 0 ? theme.accent : theme.secondary,
          0.045 + rand() * 0.05,
          rand() * Math.PI * 2,
        );
      }
    } else if (nebula.kind === "ionStorm") {
      this.ctx.globalCompositeOperation = "lighter";
      this.paintPuff(centerX, centerY, radiusPx * 0.25, theme.accent, 0.15);
      for (let i = 0; i < 8; i++) {
        const ringRadius = radiusPx * (0.17 + i * 0.09);
        this.ctx.beginPath();
        this.ctx.ellipse(centerX, centerY, ringRadius * theme.aspect, ringRadius * 0.66, rotation + i * 0.18, i * 0.7, i * 0.7 + Math.PI * (0.65 + rand() * 0.5));
        this.ctx.strokeStyle = `rgba(${i % 2 === 0 ? theme.accent.r : theme.secondary.r},${i % 2 === 0 ? theme.accent.g : theme.secondary.g},${i % 2 === 0 ? theme.accent.b : theme.secondary.b},${0.055 + rand() * 0.06})`;
        this.ctx.lineWidth = Math.max(0.8, radiusPx * (0.004 + rand() * 0.005));
        this.ctx.stroke();
      }
    }

    this.ctx.restore();
  }

  private paintStaticRibbon(
    x: number,
    y: number,
    length: number,
    amplitude: number,
    rotation: number,
    color: Rgb,
    alpha: number,
    phase: number,
  ): void {
    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(rotation);
    this.ctx.beginPath();
    const segments = 24;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const px = (t - 0.5) * length * 2;
      const py = Math.sin(t * Math.PI * 2.5 + phase) * amplitude * (0.45 + Math.sin(t * Math.PI) * 0.55);
      if (i === 0) this.ctx.moveTo(px, py);
      else this.ctx.lineTo(px, py);
    }
    this.ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
    this.ctx.lineWidth = Math.max(1, amplitude * 0.24);
    this.ctx.shadowColor = `rgba(${color.r},${color.g},${color.b},${alpha})`;
    this.ctx.shadowBlur = amplitude * 0.8;
    this.ctx.stroke();
    this.ctx.restore();
  }

  private paintStaticRing(x: number, y: number, radius: number, color: Rgb, alpha: number): void {
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
    this.ctx.lineWidth = Math.max(0.75, radius * 0.12);
    this.ctx.stroke();
  }

  private paintStaticStar(x: number, y: number, radius: number, color: Rgb, alpha: number): void {
    this.ctx.save();
    this.ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
    this.ctx.lineWidth = Math.max(0.7, radius * 0.24);
    this.ctx.beginPath();
    this.ctx.moveTo(x - radius * 2.4, y);
    this.ctx.lineTo(x + radius * 2.4, y);
    this.ctx.moveTo(x, y - radius * 2.4);
    this.ctx.lineTo(x, y + radius * 2.4);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private clipEllipse(x: number, y: number, radiusX: number, radiusY: number, rotation: number): void {
    this.ctx.translate(x, y);
    this.ctx.rotate(rotation);
    this.ctx.scale(radiusX, radiusY);
    this.ctx.beginPath();
    this.ctx.arc(0, 0, 1, 0, Math.PI * 2);
    this.ctx.clip();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private paintElectricNebula(nebula: NebulaRegion): void {
    const rand = mulberry32((nebula.id + 1) * 0x85ebca6b);
    const radiusPx = Math.max(8, this.worldToPx(nebula.radiusWorld));
    const centerX = this.projectX(nebula.centerX);
    const centerY = this.projectY(nebula.centerZ);
    const memberSet = new Set(nebula.starIds);

    // A broad anisotropic thunderhead gives the region a recognizable silhouette
    // before the detailed cloud cells are layered over it.
    this.paintEllipticalPuff(
      centerX,
      centerY,
      radiusPx * 1.38,
      radiusPx * 0.96,
      ELECTRIC_DEEP,
      0.55,
      (rand() - 0.5) * 0.34,
    );
    this.paintEllipticalPuff(
      centerX - radiusPx * 0.08,
      centerY + radiusPx * 0.05,
      radiusPx * 1.08,
      radiusPx * 0.7,
      ELECTRIC_SHADOW,
      0.45,
      (rand() - 0.5) * 0.4,
    );

    // Bulging dark banks around the perimeter create depth and the scalloped edge
    // of a real thunder cloud rather than the old soft circular haze.
    for (let i = 0; i < 18; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = radiusPx * (0.2 + rand() * 0.68);
      const puffRadius = radiusPx * (0.22 + rand() * 0.27);
      const color = rand() < 0.38 ? ELECTRIC_SHADOW : ELECTRIC_DEEP;
      this.paintEllipticalPuff(
        centerX + Math.cos(angle) * dist,
        centerY + Math.sin(angle) * dist * 0.75,
        puffRadius * (0.95 + rand() * 0.75),
        puffRadius * (0.55 + rand() * 0.45),
        color,
        0.25 + rand() * 0.22,
        angle + (rand() - 0.5) * 0.7,
      );
    }

    // Charged cloud bridges follow the connected systems, making the storm look
    // like one electrically coupled front rather than isolated blue islands.
    for (const [a, b] of this.hyperlanePairs) {
      if (!memberSet.has(a) || !memberSet.has(b)) continue;
      const starA = this.stars[a];
      const starB = this.stars[b];
      if (!starA || !starB) continue;
      const ax = this.projectX(starA.x);
      const ay = this.projectY(starA.z);
      const bx = this.projectX(starB.x);
      const by = this.projectY(starB.z);
      const steps = Math.max(3, Math.round(Math.hypot(bx - ax, by - ay) / (radiusPx * 0.42)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const jitterX = (rand() - 0.5) * radiusPx * 0.12;
        const jitterY = (rand() - 0.5) * radiusPx * 0.12;
        const px = ax + (bx - ax) * t + jitterX;
        const py = ay + (by - ay) * t + jitterY;
        const size = radiusPx * (0.15 + rand() * 0.13);
        this.paintEllipticalPuff(
          px,
          py,
          size * 1.45,
          size * 0.72,
          ELECTRIC_CLOUD,
          0.23 + rand() * 0.13,
          Math.atan2(by - ay, bx - ax),
        );
      }
    }

    const memberStars = nebula.starIds
      .map((starId) => this.stars[starId])
      .filter((star): star is StarData => !!star);

    for (const star of memberStars) {
      const sx = this.projectX(star.x);
      const sy = this.projectY(star.z);

      this.paintPuff(sx, sy, radiusPx * 0.34, ELECTRIC_DEEP, 0.54);
      this.paintPuff(sx, sy, radiusPx * 0.19, ELECTRIC_PLASMA, 0.35);
      this.paintPuff(sx, sy, radiusPx * 0.09, ELECTRIC_CHARGE, 0.24);

      // Alternating shadow and illuminated cells make the cloud appear lit from
      // within whenever a lightning flash crosses the animated layer above it.
      for (let i = 0; i < ELECTRIC_CELLS_PER_MEMBER; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = rand() * radiusPx * 0.56;
        const size = radiusPx * (0.13 + rand() * 0.22);
        const luminous = rand() < 0.42;
        this.paintEllipticalPuff(
          sx + Math.cos(angle) * dist,
          sy + Math.sin(angle) * dist,
          size * (1.05 + rand() * 0.8),
          size * (0.52 + rand() * 0.5),
          luminous ? (rand() < 0.25 ? ELECTRIC_VIOLET : ELECTRIC_PLASMA) : ELECTRIC_SHADOW,
          luminous ? 0.16 + rand() * 0.13 : 0.24 + rand() * 0.18,
          angle + (rand() - 0.5) * 0.8,
        );
      }

      for (let i = 0; i < ELECTRIC_WISPS_PER_MEMBER; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = rand() * radiusPx * 0.75;
        const size = radiusPx * (0.06 + rand() * 0.09);
        this.paintEllipticalPuff(
          sx + Math.cos(angle) * dist,
          sy + Math.sin(angle) * dist,
          size * (2.1 + rand() * 1.4),
          size * (0.34 + rand() * 0.3),
          rand() < 0.3 ? ELECTRIC_VIOLET : ELECTRIC_CHARGE,
          0.08 + rand() * 0.08,
          angle,
        );
      }
    }

    this.paintStaticChargeVeins(nebula, rand, radiusPx);
  }

  private paintStaticChargeVeins(
    nebula: NebulaRegion,
    rand: () => number,
    radiusPx: number,
  ): void {
    const center = { x: this.projectX(nebula.centerX), y: this.projectY(nebula.centerZ) };
    this.ctx.save();
    this.ctx.globalCompositeOperation = "lighter";
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";

    for (let i = 0; i < 11; i++) {
      const startAngle = rand() * Math.PI * 2;
      const endAngle = startAngle + (rand() - 0.5) * 1.8;
      const startDist = radiusPx * (0.08 + rand() * 0.45);
      const endDist = radiusPx * (0.38 + rand() * 0.55);
      const start = {
        x: center.x + Math.cos(startAngle) * startDist,
        y: center.y + Math.sin(startAngle) * startDist * 0.72,
      };
      const end = {
        x: center.x + Math.cos(endAngle) * endDist,
        y: center.y + Math.sin(endAngle) * endDist * 0.72,
      };
      const points = this.buildJaggedPath(start, end, rand, radiusPx * 0.055, 3);
      this.tracePath(this.ctx, points);
      this.ctx.strokeStyle = `rgba(${ELECTRIC_CHARGE.r},${ELECTRIC_CHARGE.g},${ELECTRIC_CHARGE.b},${0.055 + rand() * 0.055})`;
      this.ctx.lineWidth = Math.max(0.65, radiusPx * 0.006);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  private paintEllipticalPuff(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    color: Rgb,
    alpha: number,
    rotation: number,
  ): void {
    if (radiusX <= 0 || radiusY <= 0) return;
    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(rotation);
    this.ctx.scale(radiusX, radiusY);
    const gradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gradient.addColorStop(0, `rgba(${color.r},${color.g},${color.b},${alpha})`);
    gradient.addColorStop(0.42, `rgba(${color.r},${color.g},${color.b},${alpha * 0.6})`);
    gradient.addColorStop(0.76, `rgba(${color.r},${color.g},${color.b},${alpha * 0.2})`);
    gradient.addColorStop(1, `rgba(${color.r},${color.g},${color.b},0)`);
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(0, 0, 1, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  private createLightningStrike(storm: ElectricStormState, delay = 0): LightningStrike {
    const { nebula, rand } = storm;
    const radius = Math.max(12, this.worldToEffectPx(nebula.radiusWorld));
    const center = {
      x: this.projectEffectX(nebula.centerX),
      y: this.projectEffectY(nebula.centerZ),
    };
    const memberPoints = nebula.starIds
      .map((starId) => this.stars[starId])
      .filter((star): star is StarData => !!star)
      .map((star) => ({ x: this.projectEffectX(star.x), y: this.projectEffectY(star.z) }));

    const randomCloudPoint = (): Point2 => {
      const angle = rand() * Math.PI * 2;
      const distance = radius * Math.sqrt(rand()) * 0.88;
      return {
        x: center.x + Math.cos(angle) * distance,
        y: center.y + Math.sin(angle) * distance * 0.72,
      };
    };
    const pickAnchor = (): Point2 => (
      memberPoints.length > 0 && rand() < 0.62
        ? memberPoints[Math.floor(rand() * memberPoints.length)]
        : randomCloudPoint()
    );

    let start = pickAnchor();
    let end = pickAnchor();
    for (let tries = 0; tries < 4 && Math.hypot(end.x - start.x, end.y - start.y) < radius * 0.42; tries++) {
      end = randomCloudPoint();
    }
    if (Math.hypot(end.x - start.x, end.y - start.y) < radius * 0.3) {
      const angle = rand() * Math.PI * 2;
      const startDistance = radius * (0.38 + rand() * 0.24);
      const endDistance = radius * (0.48 + rand() * 0.28);
      start = {
        x: center.x - Math.cos(angle) * startDistance,
        y: center.y - Math.sin(angle) * startDistance * 0.72,
      };
      end = {
        x: center.x + Math.cos(angle) * endDistance,
        y: center.y + Math.sin(angle) * endDistance * 0.72,
      };
    }

    const mainPoints = this.buildJaggedPath(start, end, rand, radius * 0.12, 5);
    const paths: LightningPath[] = [{ points: mainPoints, strength: 1 }];
    const branchCount = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < branchCount; i++) {
      const sourceIndex = 2 + Math.floor(rand() * Math.max(1, mainPoints.length - 4));
      const source = mainPoints[Math.min(mainPoints.length - 2, sourceIndex)];
      const next = mainPoints[Math.min(mainPoints.length - 1, sourceIndex + 1)];
      const mainAngle = Math.atan2(next.y - source.y, next.x - source.x);
      const branchAngle = mainAngle + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.85);
      const branchLength = radius * (0.16 + rand() * 0.34);
      const branchEnd = {
        x: source.x + Math.cos(branchAngle) * branchLength,
        y: source.y + Math.sin(branchAngle) * branchLength,
      };
      paths.push({
        points: this.buildJaggedPath(source, branchEnd, rand, radius * 0.055, 3),
        strength: 0.38 + rand() * 0.28,
      });
    }

    return {
      startedAt: this.elapsedSeconds + delay,
      duration: ELECTRIC_STRIKE_MIN_DURATION + rand() * ELECTRIC_STRIKE_RANDOM_DURATION,
      flashCenter: mainPoints[Math.floor(mainPoints.length * (0.35 + rand() * 0.3))],
      flashRadius: radius * (0.22 + rand() * 0.16),
      paths,
    };
  }

  private buildJaggedPath(
    start: Point2,
    end: Point2,
    rand: () => number,
    displacement: number,
    iterations: number,
  ): Point2[] {
    let points = [start, end];
    let currentDisplacement = displacement;
    for (let iteration = 0; iteration < iterations; iteration++) {
      const nextPoints: Point2[] = [points[0]];
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.max(0.001, Math.hypot(dx, dy));
        const offset = (rand() - 0.5) * currentDisplacement * 2;
        nextPoints.push({
          x: (a.x + b.x) * 0.5 + (-dy / length) * offset,
          y: (a.y + b.y) * 0.5 + (dx / length) * offset,
        });
        nextPoints.push(b);
      }
      points = nextPoints;
      currentDisplacement *= 0.52;
    }
    return points;
  }

  private renderAmbientNebulaEffect(ctx: CanvasRenderingContext2D, state: AmbientNebulaState): void {
    const { nebula, phaseOffset } = state;
    const theme = STATIC_NEBULA_THEMES[nebula.kind];
    if (!theme) return;
    const center = {
      x: this.projectEffectX(nebula.centerX),
      y: this.projectEffectY(nebula.centerZ),
    };
    const radius = Math.max(12, this.worldToEffectPx(nebula.radiusWorld));
    const time = this.elapsedSeconds + phaseOffset;
    const rand = mulberry32((nebula.id + 1) * 0x9e3779b1);

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, radius * 1.22 * theme.aspect, radius * 0.94, 0, 0, Math.PI * 2);
    ctx.clip();

    switch (nebula.kind) {
      case "standard":
        this.renderStandardEffects(ctx, center, radius, theme, time, rand);
        break;
      case "toxic":
        this.renderToxicEffects(ctx, center, radius, theme, time, rand);
        break;
      case "dustCloud":
        this.renderDustEffects(ctx, center, radius, theme, time, rand);
        break;
      case "radiation":
        this.renderRadiationEffects(ctx, center, radius, theme, time, rand);
        break;
      case "stellarNursery":
        this.renderStellarNurseryEffects(ctx, center, radius, theme, time, rand);
        break;
      case "ionStorm":
        this.renderIonStormEffects(ctx, center, radius, theme, time, rand, nebula.id);
        break;
      default:
        break;
    }

    ctx.restore();
  }

  private renderStandardEffects(
    ctx: CanvasRenderingContext2D,
    center: Point2,
    radius: number,
    theme: StaticNebulaTheme,
    time: number,
    rand: () => number,
  ): void {
    // Long aurora currents slide gently across one another. They deliberately
    // avoid fast motion so the standard nebula remains the calm baseline type.
    for (let i = 0; i < 5; i++) {
      const phase = time * (0.14 + i * 0.018) + rand() * Math.PI * 2;
      const y = center.y + (i / 4 - 0.5) * radius * 1.2 + Math.sin(phase * 0.7) * radius * 0.08;
      this.strokeAnimatedRibbon(
        ctx,
        center.x + Math.cos(phase * 0.42) * radius * 0.12,
        y,
        radius * (0.85 + rand() * 0.22),
        radius * (0.07 + rand() * 0.04),
        -0.18 + i * 0.08,
        i % 2 === 0 ? theme.secondary : theme.accent,
        0.1 + Math.sin(phase) * 0.025,
        phase,
      );
    }

    for (let i = 0; i < 26; i++) {
      const baseAngle = rand() * Math.PI * 2;
      const distance = radius * Math.sqrt(rand()) * 0.86;
      const drift = time * (0.018 + rand() * 0.03);
      const x = center.x + Math.cos(baseAngle + drift) * distance * theme.aspect;
      const y = center.y + Math.sin(baseAngle + drift) * distance * 0.78;
      const pulse = 0.45 + 0.55 * Math.sin(time * (0.8 + rand()) + rand() * 8) ** 2;
      this.paintEffectGlow(ctx, x, y, radius * (0.008 + rand() * 0.013), i % 3 === 0 ? theme.accent : theme.secondary, 0.08 + pulse * 0.14);
    }
  }

  private renderToxicEffects(
    ctx: CanvasRenderingContext2D,
    center: Point2,
    radius: number,
    theme: StaticNebulaTheme,
    time: number,
    rand: () => number,
  ): void {
    // Semi-organic chemical blisters swell and collapse while spores drift through
    // the cloud, giving this type a living, hostile quality.
    for (let i = 0; i < 18; i++) {
      const angle = rand() * Math.PI * 2;
      const distance = radius * Math.sqrt(rand()) * 0.78;
      const speed = 0.12 + rand() * 0.2;
      const wobble = Math.sin(time * speed + rand() * Math.PI * 2);
      const x = center.x + Math.cos(angle + wobble * 0.08) * distance * theme.aspect;
      const y = center.y + Math.sin(angle) * distance * 0.78 + wobble * radius * 0.025;
      const bubbleRadius = radius * (0.018 + rand() * 0.05) * (0.82 + wobble * 0.14);
      this.paintEffectGlow(ctx, x, y, bubbleRadius * 1.8, i % 4 === 0 ? theme.secondary : theme.core, 0.07 + (wobble + 1) * 0.035);
      this.strokeEffectRing(ctx, x, y, bubbleRadius, theme.accent, 0.16 + (wobble + 1) * 0.06, Math.max(0.8, bubbleRadius * 0.1));
    }

    for (let i = 0; i < 42; i++) {
      const lane = rand() * 2 - 1;
      const speed = 0.025 + rand() * 0.075;
      const travel = ((rand() + time * speed) % 1) * 2 - 1;
      const x = center.x + lane * radius * theme.aspect * 0.8 + Math.sin(time * 0.3 + i) * radius * 0.035;
      const y = center.y + travel * radius * 0.82;
      const size = radius * (0.003 + rand() * 0.008);
      this.paintEffectGlow(ctx, x, y, size * 2.2, rand() < 0.25 ? theme.secondary : theme.accent, 0.13 + rand() * 0.18);
    }

    ctx.save();
    ctx.lineCap = "round";
    for (let i = 0; i < 4; i++) {
      const ring = radius * (0.24 + i * 0.13);
      const start = time * (0.08 + i * 0.015) + i * 1.4;
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, ring * theme.aspect, ring * 0.64, i * 0.22, start, start + Math.PI * 0.8);
      ctx.strokeStyle = `rgba(${theme.secondary.r},${theme.secondary.g},${theme.secondary.b},${0.055 + i * 0.01})`;
      ctx.lineWidth = Math.max(1, radius * 0.012);
      ctx.shadowColor = `rgba(${theme.secondary.r},${theme.secondary.g},${theme.secondary.b},0.16)`;
      ctx.shadowBlur = radius * 0.035;
      ctx.stroke();
    }
    ctx.restore();
  }

  private renderDustEffects(
    ctx: CanvasRenderingContext2D,
    center: Point2,
    radius: number,
    theme: StaticNebulaTheme,
    time: number,
    rand: () => number,
  ): void {
    // Everything moves in one prevailing direction, selling a vast dust front
    // sweeping across the map rather than luminous gas boiling in place.
    const direction = -0.28;
    const cos = Math.cos(direction);
    const sin = Math.sin(direction);
    ctx.save();
    ctx.lineCap = "round";
    for (let i = 0; i < 90; i++) {
      const speed = 0.035 + rand() * 0.09;
      const along = (((rand() + time * speed) % 1) * 2 - 1) * radius * 1.35;
      const across = (rand() * 2 - 1) * radius * 0.85;
      const x = center.x + along * cos - across * sin;
      const y = center.y + along * sin + across * cos;
      const length = radius * (0.012 + rand() * 0.055);
      ctx.beginPath();
      ctx.moveTo(x - cos * length, y - sin * length);
      ctx.lineTo(x + cos * length, y + sin * length);
      const color = rand() < 0.22 ? theme.secondary : theme.accent;
      ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${0.055 + rand() * 0.16})`;
      ctx.lineWidth = Math.max(0.65, radius * (0.002 + rand() * 0.004));
      ctx.stroke();
    }

    for (let i = 0; i < 5; i++) {
      const across = (i / 4 - 0.5) * radius * 1.35 + Math.sin(time * 0.12 + i) * radius * 0.07;
      const x = center.x - across * sin;
      const y = center.y + across * cos;
      ctx.beginPath();
      ctx.moveTo(x - cos * radius, y - sin * radius);
      ctx.lineTo(x + cos * radius, y + sin * radius);
      ctx.strokeStyle = `rgba(${theme.mid.r},${theme.mid.g},${theme.mid.b},${0.035 + i * 0.009})`;
      ctx.lineWidth = radius * (0.035 + i * 0.008);
      ctx.shadowColor = `rgba(${theme.accent.r},${theme.accent.g},${theme.accent.b},0.08)`;
      ctx.shadowBlur = radius * 0.06;
      ctx.stroke();
    }
    ctx.restore();
  }

  private renderRadiationEffects(
    ctx: CanvasRenderingContext2D,
    center: Point2,
    radius: number,
    theme: StaticNebulaTheme,
    time: number,
    rand: () => number,
  ): void {
    const heartbeat = 0.65 + Math.sin(time * 1.7) * 0.16 + Math.sin(time * 3.4) * 0.07;
    this.paintEffectGlow(ctx, center.x, center.y, radius * (0.18 + heartbeat * 0.05), theme.secondary, 0.2 + heartbeat * 0.12);

    // Concentric fronts expand from the hard-radiation source and fade into the
    // cloud, visibly communicating repeated irradiation waves.
    for (let i = 0; i < 4; i++) {
      const progress = (time * 0.14 + i / 4) % 1;
      const ringRadius = radius * (0.14 + progress * 0.82);
      this.strokeEffectRing(ctx, center.x, center.y, ringRadius, i % 2 === 0 ? theme.accent : theme.secondary, (1 - progress) * 0.22, Math.max(0.8, radius * 0.009));
    }

    ctx.save();
    ctx.lineCap = "round";
    for (let i = 0; i < 22; i++) {
      const angle = (i / 22) * Math.PI * 2 + time * (0.035 + (i % 3) * 0.009);
      const inner = radius * 0.17;
      const outer = radius * (0.52 + rand() * 0.4);
      const gradient = ctx.createLinearGradient(
        center.x + Math.cos(angle) * inner,
        center.y + Math.sin(angle) * inner,
        center.x + Math.cos(angle) * outer,
        center.y + Math.sin(angle) * outer,
      );
      gradient.addColorStop(0, `rgba(${theme.secondary.r},${theme.secondary.g},${theme.secondary.b},0.16)`);
      gradient.addColorStop(1, `rgba(${theme.accent.r},${theme.accent.g},${theme.accent.b},0)`);
      ctx.beginPath();
      ctx.moveTo(center.x + Math.cos(angle) * inner, center.y + Math.sin(angle) * inner);
      ctx.lineTo(center.x + Math.cos(angle) * outer, center.y + Math.sin(angle) * outer);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = Math.max(0.7, radius * (0.003 + rand() * 0.006));
      ctx.stroke();
    }
    ctx.restore();

    for (let i = 0; i < 28; i++) {
      const angle = rand() * Math.PI * 2;
      const distance = radius * Math.sqrt(rand()) * 0.9;
      const blink = Math.max(0, Math.sin(time * (2.1 + rand() * 4.2) + rand() * 12));
      if (blink < 0.45) continue;
      this.paintEffectGlow(
        ctx,
        center.x + Math.cos(angle) * distance,
        center.y + Math.sin(angle) * distance * 0.78,
        radius * (0.004 + rand() * 0.01),
        theme.secondary,
        (blink - 0.4) * 0.28,
      );
    }
  }

  private renderStellarNurseryEffects(
    ctx: CanvasRenderingContext2D,
    center: Point2,
    radius: number,
    theme: StaticNebulaTheme,
    time: number,
    rand: () => number,
  ): void {
    // Embedded protostars have independent breathing cycles, surrounded by slow
    // hydrogen currents and occasional expanding birth shockwaves.
    for (let i = 0; i < 16; i++) {
      const angle = rand() * Math.PI * 2;
      const distance = radius * Math.sqrt(rand()) * 0.82;
      const x = center.x + Math.cos(angle) * distance * theme.aspect;
      const y = center.y + Math.sin(angle) * distance * 0.76;
      const pulse = 0.5 + 0.5 * Math.sin(time * (0.7 + rand() * 1.5) + rand() * Math.PI * 2);
      const color = i % 4 === 0 ? theme.accent : i % 3 === 0 ? theme.secondary : theme.core;
      const size = radius * (0.008 + rand() * 0.014);
      this.paintEffectGlow(ctx, x, y, size * (3.2 + pulse * 2.2), color, 0.1 + pulse * 0.23);
      this.strokeEffectStar(ctx, x, y, size * (0.8 + pulse * 0.55), theme.secondary, 0.25 + pulse * 0.5);
    }

    for (let i = 0; i < 5; i++) {
      const phase = time * (0.08 + i * 0.012) + i * 1.3;
      this.strokeAnimatedRibbon(
        ctx,
        center.x + Math.sin(phase * 0.6) * radius * 0.14,
        center.y + (i / 4 - 0.5) * radius * 1.05,
        radius * (0.7 + i * 0.045),
        radius * (0.055 + i * 0.006),
        -0.34 + i * 0.16,
        i % 2 === 0 ? theme.accent : theme.secondary,
        0.07 + Math.sin(phase) * 0.018,
        phase,
      );
    }

    for (let i = 0; i < 2; i++) {
      const progress = (time * 0.075 + i * 0.5) % 1;
      const envelope = Math.sin(progress * Math.PI);
      this.strokeEffectRing(
        ctx,
        center.x,
        center.y,
        radius * (0.1 + progress * 0.75),
        i === 0 ? theme.secondary : theme.accent,
        envelope * 0.11,
        Math.max(0.8, radius * 0.007),
      );
    }
  }

  private renderIonStormEffects(
    ctx: CanvasRenderingContext2D,
    center: Point2,
    radius: number,
    theme: StaticNebulaTheme,
    time: number,
    rand: () => number,
    nebulaId: number,
  ): void {
    const rotation = time * 0.16;
    this.paintEffectGlow(ctx, center.x, center.y, radius * 0.27, theme.accent, 0.14 + Math.sin(time * 1.2) * 0.03);

    // Counter-layered arcs create a rotating plasma vortex, visually separating
    // the ion storm from the branching cloud-to-cloud bolts of an electric nebula.
    ctx.save();
    ctx.lineCap = "round";
    for (let i = 0; i < 9; i++) {
      const ringRadius = radius * (0.14 + i * 0.085);
      const direction = i % 3 === 0 ? -1 : 1;
      const start = rotation * direction + i * 0.92;
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, ringRadius * (1.08 + i * 0.02), ringRadius * 0.62, i * 0.16, start, start + Math.PI * (0.55 + (i % 3) * 0.18));
      const color = i % 2 === 0 ? theme.accent : theme.secondary;
      ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${0.1 + (i % 3) * 0.025})`;
      ctx.lineWidth = Math.max(0.9, radius * (0.006 + i * 0.0007));
      ctx.shadowColor = `rgba(${color.r},${color.g},${color.b},0.22)`;
      ctx.shadowBlur = radius * 0.025;
      ctx.stroke();

      const knotAngle = start + time * (0.22 + i * 0.015);
      const knotX = center.x + Math.cos(knotAngle) * ringRadius * 1.08;
      const knotY = center.y + Math.sin(knotAngle) * ringRadius * 0.62;
      this.paintEffectGlow(ctx, knotX, knotY, radius * (0.012 + (i % 3) * 0.004), color, 0.18);
    }
    ctx.restore();

    // Short-lived sheet discharges tear tangentially across the vortex. A fixed
    // time bucket gives each flash a stable shape for several frames.
    const sheetRate = 3.4;
    const bucket = Math.floor(time * sheetRate);
    const bucketPhase = (time * sheetRate) % 1;
    const sheetRand = mulberry32((nebulaId + 1) * 0x7f4a7c15 ^ bucket * 0x45d9f3b);
    const sheetAlpha = Math.pow(1 - bucketPhase, 2.2);
    if (sheetAlpha > 0.05) {
      for (let i = 0; i < 3; i++) {
        const angle = sheetRand() * Math.PI * 2;
        const distance = radius * (0.18 + sheetRand() * 0.58);
        const start = {
          x: center.x + Math.cos(angle) * distance,
          y: center.y + Math.sin(angle) * distance * 0.66,
        };
        const tangent = angle + Math.PI * 0.5 + (sheetRand() - 0.5) * 0.45;
        const length = radius * (0.12 + sheetRand() * 0.22);
        const end = {
          x: start.x + Math.cos(tangent) * length,
          y: start.y + Math.sin(tangent) * length,
        };
        const points = this.buildJaggedPath(start, end, sheetRand, radius * 0.025, 3);
        this.strokeLightningPath(ctx, points, Math.max(0.7, radius * 0.006), `rgba(${theme.secondary.r},${theme.secondary.g},${theme.secondary.b},${sheetAlpha * 0.54})`, radius * 0.035);
      }
    }
  }

  private strokeAnimatedRibbon(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    halfLength: number,
    amplitude: number,
    rotation: number,
    color: Rgb,
    alpha: number,
    phase: number,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.beginPath();
    const segments = 34;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const px = (t * 2 - 1) * halfLength;
      const taper = Math.sin(t * Math.PI);
      const py = Math.sin(t * Math.PI * 3 + phase) * amplitude * taper;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${Math.max(0, alpha)})`;
    ctx.lineWidth = Math.max(1, amplitude * 0.22);
    ctx.shadowColor = `rgba(${color.r},${color.g},${color.b},${Math.max(0, alpha * 1.4)})`;
    ctx.shadowBlur = amplitude * 0.9;
    ctx.stroke();
    ctx.restore();
  }

  private paintEffectGlow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    color: Rgb,
    alpha: number,
  ): void {
    if (radius <= 0 || alpha <= 0) return;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${color.r},${color.g},${color.b},${alpha})`);
    gradient.addColorStop(0.35, `rgba(${color.r},${color.g},${color.b},${alpha * 0.52})`);
    gradient.addColorStop(1, `rgba(${color.r},${color.g},${color.b},0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  private strokeEffectRing(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    color: Rgb,
    alpha: number,
    width: number,
  ): void {
    if (radius <= 0 || alpha <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
    ctx.lineWidth = width;
    ctx.shadowColor = `rgba(${color.r},${color.g},${color.b},${alpha * 0.85})`;
    ctx.shadowBlur = width * 2.8;
    ctx.stroke();
    ctx.restore();
  }

  private strokeEffectStar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    color: Rgb,
    alpha: number,
  ): void {
    ctx.save();
    ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
    ctx.lineWidth = Math.max(0.7, radius * 0.22);
    ctx.shadowColor = `rgba(${color.r},${color.g},${color.b},${alpha})`;
    ctx.shadowBlur = radius * 1.5;
    ctx.beginPath();
    ctx.moveTo(x - radius * 2.8, y);
    ctx.lineTo(x + radius * 2.8, y);
    ctx.moveTo(x, y - radius * 2.8);
    ctx.lineTo(x, y + radius * 2.8);
    ctx.stroke();
    ctx.restore();
  }

  private renderEffects(): void {
    if (!this.effectsTexture || !this.effectsCtx) return;
    const ctx = this.effectsCtx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.effectsWidthPx, this.effectsHeightPx);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const ambient of this.ambientNebulae) {
      this.renderAmbientNebulaEffect(ctx, ambient);
    }

    for (const storm of this.electricStorms) {
      for (const strike of storm.strikes) {
        const age = this.elapsedSeconds - strike.startedAt;
        if (age < 0 || age >= strike.duration) continue;
        const phase = age / strike.duration;
        const decay = Math.pow(1 - phase, 0.72);
        const strobe = 0.68 + Math.abs(Math.sin(age * 72 + strike.startedAt * 19)) * 0.32;
        const intensity = decay * strobe;

        const flash = ctx.createRadialGradient(
          strike.flashCenter.x,
          strike.flashCenter.y,
          0,
          strike.flashCenter.x,
          strike.flashCenter.y,
          strike.flashRadius,
        );
        flash.addColorStop(0, `rgba(108,224,255,${intensity * 0.2})`);
        flash.addColorStop(0.35, `rgba(37,147,255,${intensity * 0.1})`);
        flash.addColorStop(1, "rgba(12,63,180,0)");
        ctx.fillStyle = flash;
        ctx.beginPath();
        ctx.arc(strike.flashCenter.x, strike.flashCenter.y, strike.flashRadius, 0, Math.PI * 2);
        ctx.fill();

        for (const path of strike.paths) {
          const pathIntensity = intensity * path.strength;
          this.strokeLightningPath(ctx, path.points, 12 * path.strength, `rgba(18,92,255,${pathIntensity * 0.16})`, 17);
          this.strokeLightningPath(ctx, path.points, 5.2 * path.strength, `rgba(39,191,255,${pathIntensity * 0.5})`, 8);
          this.strokeLightningPath(ctx, path.points, Math.max(0.8, 1.55 * path.strength), `rgba(231,252,255,${Math.min(1, pathIntensity * 1.2)})`, 2.5);
        }
      }
    }

    ctx.restore();
    this.effectsTexture.update(true);
  }

  private strokeLightningPath(
    ctx: CanvasRenderingContext2D,
    points: Point2[],
    width: number,
    color: string,
    shadowBlur: number,
  ): void {
    this.tracePath(ctx, points);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = shadowBlur;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  private tracePath(ctx: CanvasRenderingContext2D, points: Point2[]): void {
    if (points.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
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
