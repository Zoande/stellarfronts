import {
  Color3,
  Color4,
  DynamicTexture,
  GlowLayer,
  HemisphericLight,
  Material,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { LinesMesh } from "@babylonjs/core";
import type { NebulaKind } from "../../data/Nebula";

type AmbientNebulaKind = Exclude<NebulaKind, "ionStorm">;
type Rgb = [number, number, number];

interface EnvironmentProfile {
  palette: [Rgb, Rgb, Rgb, Rgb];
  shellAlpha: [number, number];
  lightDiffuse: Color3;
  lightGround: Color3;
  particleColors: [Color4, Color4, Color4];
  particleBlend: number;
  rootSpeed: number;
}

interface SoftVolumeState {
  mesh: Mesh;
  material: StandardMaterial;
  baseAlpha: number;
  phase: number;
  pulseSpeed: number;
  baseScale: number;
}

interface FlowState {
  core: Mesh;
  coreMaterial: StandardMaterial;
  haze: Mesh;
  hazeMaterial: StandardMaterial;
  baseAlpha: number;
  hazeBaseAlpha: number;
  phase: number;
  speed: number;
}

interface PulseState {
  core: LinesMesh;
  haze: Mesh;
  hazeMaterial: StandardMaterial;
  phase: number;
  speed: number;
  baseAlpha: number;
  hazeBaseAlpha: number;
}

interface ProtostarState {
  mesh: Mesh;
  material: StandardMaterial;
  halo: Mesh;
  haloMaterial: StandardMaterial;
  phase: number;
  speed: number;
  baseScale: number;
}

interface ElectricStrikeState {
  cores: LinesMesh[];
  hazes: Mesh[];
  hazeMaterials: StandardMaterial[];
  cooldown: number;
  age: number;
  duration: number;
  active: boolean;
  phase: number;
}

const PROFILES: Record<AmbientNebulaKind, EnvironmentProfile> = {
  standard: {
    palette: [[19, 31, 89], [42, 76, 175], [119, 86, 219], [68, 184, 224]],
    shellAlpha: [0.66, 0.4],
    lightDiffuse: new Color3(0.18, 0.25, 0.52),
    lightGround: new Color3(0.1, 0.06, 0.22),
    particleColors: [
      new Color4(0.28, 0.48, 1, 0.18),
      new Color4(0.58, 0.3, 1, 0.16),
      new Color4(0.08, 0.12, 0.4, 0),
    ],
    particleBlend: ParticleSystem.BLENDMODE_ADD,
    rootSpeed: 0.009,
  },
  toxic: {
    palette: [[23, 49, 14], [76, 126, 25], [179, 211, 45], [47, 164, 75]],
    shellAlpha: [0.7, 0.45],
    lightDiffuse: new Color3(0.25, 0.42, 0.12),
    lightGround: new Color3(0.08, 0.16, 0.05),
    particleColors: [
      new Color4(0.58, 0.88, 0.15, 0.22),
      new Color4(0.2, 0.68, 0.28, 0.18),
      new Color4(0.12, 0.22, 0.05, 0),
    ],
    particleBlend: ParticleSystem.BLENDMODE_STANDARD,
    rootSpeed: 0.007,
  },
  dustCloud: {
    palette: [[48, 29, 19], [101, 60, 31], [174, 105, 51], [214, 151, 76]],
    shellAlpha: [0.76, 0.5],
    lightDiffuse: new Color3(0.38, 0.24, 0.13),
    lightGround: new Color3(0.12, 0.08, 0.06),
    particleColors: [
      new Color4(0.68, 0.42, 0.2, 0.2),
      new Color4(0.9, 0.63, 0.3, 0.14),
      new Color4(0.2, 0.12, 0.07, 0),
    ],
    particleBlend: ParticleSystem.BLENDMODE_STANDARD,
    rootSpeed: 0.004,
  },
  electric: {
    palette: [[4, 18, 43], [9, 53, 91], [18, 151, 218], [71, 215, 255]],
    shellAlpha: [0.82, 0.55],
    lightDiffuse: new Color3(0.12, 0.34, 0.67),
    lightGround: new Color3(0.04, 0.12, 0.25),
    particleColors: [
      new Color4(0.2, 0.68, 1, 0.24),
      new Color4(0.42, 0.37, 1, 0.18),
      new Color4(0.04, 0.14, 0.4, 0),
    ],
    particleBlend: ParticleSystem.BLENDMODE_ADD,
    rootSpeed: 0.012,
  },
  radiation: {
    palette: [[65, 9, 27], [151, 22, 54], [235, 61, 69], [255, 143, 51]],
    shellAlpha: [0.71, 0.43],
    lightDiffuse: new Color3(0.55, 0.13, 0.18),
    lightGround: new Color3(0.24, 0.06, 0.05),
    particleColors: [
      new Color4(1, 0.24, 0.2, 0.22),
      new Color4(1, 0.62, 0.18, 0.2),
      new Color4(0.4, 0.03, 0.08, 0),
    ],
    particleBlend: ParticleSystem.BLENDMODE_ADD,
    rootSpeed: 0.005,
  },
  stellarNursery: {
    palette: [[63, 16, 57], [164, 45, 104], [239, 104, 148], [86, 143, 239]],
    shellAlpha: [0.73, 0.48],
    lightDiffuse: new Color3(0.48, 0.2, 0.4),
    lightGround: new Color3(0.12, 0.08, 0.24),
    particleColors: [
      new Color4(0.98, 0.42, 0.68, 0.24),
      new Color4(0.35, 0.55, 1, 0.22),
      new Color4(0.22, 0.06, 0.3, 0),
    ],
    particleBlend: ParticleSystem.BLENDMODE_ADD,
    rootSpeed: 0.006,
  },
};

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
}

function color3(color: Rgb): Color3 {
  return new Color3(color[0] / 255, color[1] / 255, color[2] / 255);
}

export class AmbientNebulaSystemEnvironment {
  private readonly profile: EnvironmentProfile;
  private readonly rand: () => number;
  private readonly root: TransformNode;
  private readonly meshes: Mesh[] = [];
  private readonly materials: StandardMaterial[] = [];
  private readonly textures: Texture[] = [];
  private readonly particles: ParticleSystem[] = [];
  private readonly glowMeshes = new Set<Mesh>();
  private readonly shells: Mesh[] = [];
  private readonly volumes: SoftVolumeState[] = [];
  private readonly flows: FlowState[] = [];
  private readonly pulses: PulseState[] = [];
  private readonly protostars: ProtostarState[] = [];
  private readonly electricStrikes: ElectricStrikeState[] = [];
  private readonly environmentLight: HemisphericLight;
  private softCloudTexture: DynamicTexture | null = null;
  private electricFlash = 0;
  private elapsed = 0;

  constructor(
    private readonly scene: Scene,
    private readonly glowLayer: GlowLayer,
    private readonly kind: AmbientNebulaKind,
    seed: number,
  ) {
    this.profile = PROFILES[kind];
    this.rand = mulberry32(seed ^ 0x6a09e667);
    this.root = new TransformNode(`${kind}SystemEnvironment`, scene);

    this.createBackdrop(seed);
    this.createSoftVolumes();
    this.createParticleField();
    this.createUniqueFeatures();

    this.environmentLight = new HemisphericLight(
      `${kind}EnvironmentLight`,
      new Vector3(-0.35, 0.78, 0.42),
      scene,
    );
    this.environmentLight.diffuse = this.profile.lightDiffuse;
    this.environmentLight.specular = this.profile.lightDiffuse.scale(0.72);
    this.environmentLight.groundColor = this.profile.lightGround;
    this.environmentLight.intensity = kind === "dustCloud" ? 0.032 : 0.047;
  }

  update(deltaSeconds: number): void {
    const dt = Math.max(0, Math.min(0.1, deltaSeconds));
    this.elapsed += dt;
    this.root.rotation.y += dt * this.profile.rootSpeed;
    this.root.rotation.z = Math.sin(this.elapsed * 0.041) * 0.012;

    if (this.shells[0]) this.shells[0].rotation.y += dt * this.profile.rootSpeed * 0.48;
    if (this.shells[1]) this.shells[1].rotation.y -= dt * this.profile.rootSpeed * 0.71;

    for (const volume of this.volumes) {
      const pulse = 1 + Math.sin(this.elapsed * volume.pulseSpeed + volume.phase) * 0.075;
      volume.mesh.scaling.setAll(volume.baseScale * pulse);
      volume.material.alpha = volume.baseAlpha
        * (0.82 + Math.sin(this.elapsed * volume.pulseSpeed * 0.72 + volume.phase) * 0.13);
    }

    for (const flow of this.flows) {
      const pulse = 0.74 + Math.sin(this.elapsed * flow.speed + flow.phase) * 0.18;
      flow.coreMaterial.alpha = flow.baseAlpha * pulse;
      flow.hazeMaterial.alpha = flow.hazeBaseAlpha * (0.78 + pulse * 0.3);
    }

    for (const pulse of this.pulses) {
      const progress = (this.elapsed * pulse.speed + pulse.phase) % 1;
      const envelope = Math.sin(progress * Math.PI);
      const scale = 0.72 + progress * 0.72;
      pulse.core.scaling.setAll(scale);
      pulse.haze.scaling.setAll(scale * 1.01);
      pulse.core.alpha = pulse.baseAlpha * envelope;
      pulse.hazeMaterial.alpha = pulse.hazeBaseAlpha * envelope;
      pulse.core.rotation.y += dt * 0.035;
      pulse.haze.rotation.copyFrom(pulse.core.rotation);
    }

    for (const protostar of this.protostars) {
      const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * protostar.speed + protostar.phase);
      protostar.mesh.scaling.setAll(protostar.baseScale * (0.82 + pulse * 0.34));
      protostar.halo.scaling.setAll(protostar.baseScale * (1.8 + pulse * 0.7));
      protostar.material.alpha = 0.58 + pulse * 0.38;
      protostar.haloMaterial.alpha = 0.035 + pulse * 0.065;
    }

    if (this.kind === "electric") this.updateElectricStrikes(dt);
    const baseLight = this.kind === "dustCloud" ? 0.032 : 0.047;
    const ambientPulse = Math.sin(this.elapsed * 0.33) * 0.006;
    this.environmentLight.intensity = baseLight + ambientPulse + this.electricFlash * 0.12;
    this.electricFlash = Math.max(0, this.electricFlash - dt * 4.8);
  }

  dispose(): void {
    for (const particles of this.particles) particles.dispose();
    for (const mesh of this.glowMeshes) this.glowLayer.removeIncludedOnlyMesh(mesh);
    for (const mesh of this.meshes) mesh.dispose();
    for (const material of this.materials) material.dispose(false, false);
    for (const texture of this.textures) texture.dispose();
    this.environmentLight.dispose();
    this.root.dispose();
  }

  private createBackdrop(seed: number): void {
    const first = this.createBackdropTexture(`${this.kind}BackdropClouds`, 1024, 512, seed ^ 0xbb67ae85, false);
    const second = this.createBackdropTexture(`${this.kind}BackdropVeil`, 768, 384, seed ^ 0x3c6ef372, true);
    this.textures.push(first, second);
    this.createShell(`${this.kind}BackdropShell`, 1760, first, this.profile.shellAlpha[0], 0);
    this.createShell(`${this.kind}VeilShell`, 1490, second, this.profile.shellAlpha[1], 0.08);
  }

  private createShell(name: string, diameter: number, texture: Texture, alpha: number, tilt: number): void {
    const mesh = MeshBuilder.CreateSphere(name, { diameter, segments: 32 }, this.scene);
    mesh.rotation.set(tilt, this.rand() * Math.PI * 2, tilt * 0.4);
    mesh.isPickable = false;
    mesh.infiniteDistance = true;
    mesh.applyFog = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.alphaIndex = -125 + this.shells.length;

    const material = this.createTransparentMaterial(
      `${name}Material`,
      new Color3(0.86, 0.82, 1.04),
      alpha,
    );
    material.emissiveTexture = texture;
    material.opacityTexture = texture;
    mesh.material = material;
    this.trackMesh(mesh);
    this.shells.push(mesh);
  }

  private createBackdropTexture(
    name: string,
    width: number,
    height: number,
    seed: number,
    veil: boolean,
  ): DynamicTexture {
    const texture = new DynamicTexture(name, { width, height }, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    texture.hasAlpha = true;
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 4;
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    const rand = mulberry32(seed);
    ctx.clearRect(0, 0, width, height);

    if (this.kind === "dustCloud") {
      this.paintDustTexture(ctx, width, height, rand, veil);
    } else {
      this.paintCloudTexture(ctx, width, height, rand, veil);
    }
    texture.update(true);
    return texture;
  }

  private paintCloudTexture(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    rand: () => number,
    veil: boolean,
  ): void {
    const count = veil ? 90 : 165;
    for (let index = 0; index < count; index++) {
      const x = rand() * width;
      const y = height * (0.06 + rand() * 0.88);
      const radiusX = width * (0.035 + rand() * (veil ? 0.09 : 0.14));
      const radiusY = height * (0.03 + rand() * (veil ? 0.08 : 0.14));
      const color = this.profile.palette[Math.floor(rand() * this.profile.palette.length)];
      const alpha = (veil ? 0.035 : 0.055) + rand() * (veil ? 0.08 : 0.14);
      this.paintWrappedPuff(ctx, width, x, y, radiusX, radiusY, color, alpha);
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const filamentCount = this.kind === "toxic" ? 8 : veil ? 17 : 10;
    for (let index = 0; index < filamentCount; index++) {
      const y = height * (0.1 + rand() * 0.8);
      const amplitude = height * (0.035 + rand() * 0.11);
      const color = this.profile.palette[2 + (index % 2)] ?? this.profile.palette[2];
      ctx.beginPath();
      ctx.moveTo(-width * 0.06, y);
      ctx.bezierCurveTo(width * 0.22, y - amplitude, width * 0.33, y + amplitude, width * 0.52, y);
      ctx.bezierCurveTo(width * 0.7, y - amplitude, width * 0.83, y + amplitude, width * 1.06, y);
      ctx.strokeStyle = rgba(color, 0.035 + rand() * (veil ? 0.085 : 0.05));
      ctx.lineWidth = height * (0.006 + rand() * 0.016);
      ctx.shadowColor = rgba(color, 0.12);
      ctx.shadowBlur = height * 0.04;
      ctx.stroke();
    }

    if (this.kind === "toxic") {
      for (let index = 0; index < 65; index++) {
        const x = rand() * width;
        const y = rand() * height;
        const radius = 2 + rand() * 11;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(this.profile.palette[index % 2 === 0 ? 2 : 3], 0.07 + rand() * 0.11);
        ctx.lineWidth = 0.8 + rand() * 2;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private paintDustTexture(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    rand: () => number,
    veil: boolean,
  ): void {
    ctx.save();
    ctx.lineCap = "round";
    for (let index = 0; index < (veil ? 230 : 420); index++) {
      const x = rand() * width;
      const y = rand() * height;
      const length = width * (0.008 + rand() * (veil ? 0.06 : 0.11));
      const color = this.profile.palette[Math.floor(rand() * this.profile.palette.length)];
      ctx.beginPath();
      ctx.moveTo(x - length, y + length * 0.18);
      ctx.lineTo(x + length, y - length * 0.18);
      ctx.strokeStyle = rgba(color, 0.025 + rand() * (veil ? 0.09 : 0.13));
      ctx.lineWidth = 0.6 + rand() * (veil ? 3 : 7);
      ctx.stroke();
    }
    for (let index = 0; index < 70; index++) {
      this.paintWrappedPuff(
        ctx,
        width,
        rand() * width,
        rand() * height,
        width * (0.025 + rand() * 0.08),
        height * (0.018 + rand() * 0.06),
        this.profile.palette[index % this.profile.palette.length],
        0.025 + rand() * 0.07,
      );
    }
    ctx.restore();
  }

  private paintWrappedPuff(
    ctx: CanvasRenderingContext2D,
    width: number,
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    color: Rgb,
    alpha: number,
  ): void {
    for (const offset of [-width, 0, width]) {
      ctx.save();
      ctx.translate(x + offset, y);
      ctx.scale(radiusX, radiusY);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      gradient.addColorStop(0, rgba(color, alpha));
      gradient.addColorStop(0.45, rgba(color, alpha * 0.52));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private createSoftVolumes(): void {
    const texture = this.createSoftCloudTexture();
    this.softCloudTexture = texture;
    this.textures.push(texture);
    const count = this.kind === "dustCloud" ? 9 : this.kind === "electric" ? 17 : 13;
    for (let index = 0; index < count; index++) {
      const position = this.randomOuterPosition(105, 235, 26, 105);
      const size = 24 + this.rand() * 54;
      const mesh = MeshBuilder.CreatePlane(`${this.kind}CloudVolume-${index}`, { size }, this.scene);
      mesh.parent = this.root;
      mesh.position.copyFrom(position);
      mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.alphaIndex = -30 + index;
      const tint = color3(this.profile.palette[1 + (index % 3)]);
      const baseAlpha = (this.kind === "dustCloud" ? 0.055 : 0.035) + this.rand() * 0.035;
      const material = this.createTransparentMaterial(`${this.kind}CloudVolumeMat-${index}`, tint, baseAlpha);
      material.emissiveTexture = texture;
      material.opacityTexture = texture;
      mesh.material = material;
      this.trackMesh(mesh);
      this.volumes.push({
        mesh,
        material,
        baseAlpha,
        phase: this.rand() * Math.PI * 2,
        pulseSpeed: 0.12 + this.rand() * 0.24,
        baseScale: 0.8 + this.rand() * 0.65,
      });
    }
  }

  private createSoftCloudTexture(): DynamicTexture {
    const texture = new DynamicTexture(`${this.kind}SoftCloud`, { width: 256, height: 256 }, this.scene, true);
    texture.hasAlpha = true;
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 256, 256);
    const rand = mulberry32(Math.floor(this.rand() * 0x7fffffff));
    for (let index = 0; index < 28; index++) {
      const x = 128 + (rand() - 0.5) * 110;
      const y = 128 + (rand() - 0.5) * 110;
      const radius = 32 + rand() * 68;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(255,255,255,${0.065 + rand() * 0.11})`);
      gradient.addColorStop(0.5, `rgba(255,255,255,${0.025 + rand() * 0.05})`);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    texture.update(true);
    return texture;
  }

  private createParticleField(): void {
    this.createParticleBand(1);
    this.createParticleBand(-1);
  }

  private createParticleBand(heightSign: 1 | -1): void {
    const bandName = heightSign > 0 ? "Upper" : "Lower";
    const particleSystem = new ParticleSystem(`${this.kind}${bandName}AmbientParticles`, 150, this.scene);
    particleSystem.particleTexture = new Texture("/textures/star.glow.webp", this.scene);
    particleSystem.emitter = Vector3.Zero();
    particleSystem.minEmitBox = new Vector3(-210, heightSign > 0 ? 28 : -108, -210);
    particleSystem.maxEmitBox = new Vector3(210, heightSign > 0 ? 108 : -28, 210);
    particleSystem.color1 = this.profile.particleColors[0];
    particleSystem.color2 = this.profile.particleColors[1];
    particleSystem.colorDead = this.profile.particleColors[2];
    particleSystem.minSize = this.kind === "dustCloud" ? 0.06 : 0.12;
    particleSystem.maxSize = this.kind === "stellarNursery" ? 0.9 : this.kind === "dustCloud" ? 0.36 : 0.62;
    particleSystem.minLifeTime = 4;
    particleSystem.maxLifeTime = 9;
    particleSystem.emitRate = this.kind === "dustCloud" ? 18 : 12;
    particleSystem.minEmitPower = this.kind === "dustCloud" ? 0.35 : 0.04;
    particleSystem.maxEmitPower = this.kind === "dustCloud" ? 0.9 : 0.18;
    particleSystem.direction1 = this.kind === "dustCloud"
      ? new Vector3(-0.9, heightSign * 0.08, 0.22)
      : new Vector3(-0.12, heightSign * -0.06, -0.12);
    particleSystem.direction2 = this.kind === "dustCloud"
      ? new Vector3(-0.45, heightSign * 0.18, 0.42)
      : new Vector3(0.12, heightSign * 0.06, 0.12);
    particleSystem.blendMode = this.profile.particleBlend;
    particleSystem.updateSpeed = 0.018;
    particleSystem.start();
    this.particles.push(particleSystem);
  }

  private createUniqueFeatures(): void {
    switch (this.kind) {
      case "standard":
        this.createFlows(8, 118, 235, 28, 94, 0.14, 1.3, 0.035, 0.014);
        break;
      case "toxic":
        this.createFlows(4, 112, 205, 30, 86, 0.2, 1.8, 0.028, 0.018);
        this.createToxicCells();
        break;
      case "dustCloud":
        this.createDustSheets();
        break;
      case "electric":
        this.createFlows(3, 135, 225, 38, 100, 0.12, 1.45, 0.025, 0.012);
        this.createElectricStrikePool();
        break;
      case "radiation":
        this.createRadiationPulses();
        this.createRadiationRays();
        break;
      case "stellarNursery":
        this.createFlows(7, 108, 224, 27, 92, 0.16, 1.55, 0.035, 0.016);
        this.createProtostars();
        this.createRadiationPulses(true);
        break;
    }
  }

  private createFlows(
    count: number,
    minRadius: number,
    maxRadius: number,
    minHeight: number,
    maxHeight: number,
    coreRadius: number,
    hazeRadius: number,
    baseAlpha: number,
    hazeBaseAlpha: number,
  ): void {
    for (let index = 0; index < count; index++) {
      const path: Vector3[] = [];
      const radius = minRadius + this.rand() * (maxRadius - minRadius);
      const start = this.rand() * Math.PI * 2;
      const span = Math.PI * (0.72 + this.rand() * 1.05);
      const sign = index % 2 === 0 ? 1 : -1;
      const height = sign * (minHeight + this.rand() * (maxHeight - minHeight));
      const roughPhase = this.rand() * Math.PI * 2;
      const segments = 64;
      for (let segment = 0; segment <= segments; segment++) {
        const t = segment / segments;
        const taper = Math.sin(t * Math.PI);
        const angle = start + span * t;
        const roughness = (
          Math.sin(t * Math.PI * 11 + roughPhase) * 2.4
          + Math.sin(t * Math.PI * 29 + roughPhase * 0.6) * 0.9
        ) * taper;
        path.push(new Vector3(
          Math.cos(angle) * (radius + roughness),
          height + Math.sin(t * Math.PI * 2.4 + index) * 8 + roughness * 0.55,
          Math.sin(angle) * (radius + roughness),
        ));
      }
      const color = color3(this.profile.palette[2 + (index % 2)] ?? this.profile.palette[2]);
      const coreMaterial = this.createTransparentMaterial(`${this.kind}FlowCoreMat-${index}`, color.scale(1.15), baseAlpha);
      const core = MeshBuilder.CreateTube(
        `${this.kind}FlowCore-${index}`,
        { path, radius: coreRadius + index * 0.012, tessellation: 6, cap: Mesh.NO_CAP },
        this.scene,
      );
      core.parent = this.root;
      core.isPickable = false;
      core.alwaysSelectAsActiveMesh = true;
      core.material = coreMaterial;
      this.trackMesh(core);
      if (index % 3 === 0) this.includeInGlow(core);

      const hazeMaterial = this.createTransparentMaterial(`${this.kind}FlowHazeMat-${index}`, color.scale(0.62), hazeBaseAlpha);
      const haze = MeshBuilder.CreateTube(
        `${this.kind}FlowHaze-${index}`,
        { path, radius: hazeRadius + index * 0.055, tessellation: 8, cap: Mesh.NO_CAP },
        this.scene,
      );
      haze.parent = this.root;
      haze.isPickable = false;
      haze.alwaysSelectAsActiveMesh = true;
      haze.material = hazeMaterial;
      this.trackMesh(haze);
      this.flows.push({
        core,
        coreMaterial,
        haze,
        hazeMaterial,
        baseAlpha,
        hazeBaseAlpha,
        phase: this.rand() * Math.PI * 2,
        speed: 0.14 + this.rand() * 0.3,
      });
    }
  }

  private createToxicCells(): void {
    const texture = this.createCellTexture();
    this.textures.push(texture);
    for (let index = 0; index < 14; index++) {
      const size = 8 + this.rand() * 22;
      const mesh = MeshBuilder.CreatePlane(`toxicCell-${index}`, { size }, this.scene);
      mesh.parent = this.root;
      mesh.position.copyFrom(this.randomOuterPosition(112, 228, 28, 96));
      mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      mesh.isPickable = false;
      const material = this.createTransparentMaterial(
        `toxicCellMat-${index}`,
        color3(this.profile.palette[index % 2 === 0 ? 2 : 3]),
        0.12 + this.rand() * 0.08,
      );
      material.emissiveTexture = texture;
      material.opacityTexture = texture;
      mesh.material = material;
      this.trackMesh(mesh);
      this.volumes.push({
        mesh,
        material,
        baseAlpha: material.alpha,
        phase: this.rand() * Math.PI * 2,
        pulseSpeed: 0.28 + this.rand() * 0.45,
        baseScale: 0.8 + this.rand() * 0.6,
      });
    }
  }

  private createCellTexture(): DynamicTexture {
    const texture = new DynamicTexture("toxicCellTexture", { width: 256, height: 256 }, this.scene, true);
    texture.hasAlpha = true;
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 256, 256);
    const gradient = ctx.createRadialGradient(128, 128, 18, 128, 128, 112);
    gradient.addColorStop(0, "rgba(220,255,110,0.08)");
    gradient.addColorStop(0.55, "rgba(135,225,55,0.18)");
    gradient.addColorStop(0.72, "rgba(205,245,75,0.42)");
    gradient.addColorStop(0.84, "rgba(82,185,62,0.13)");
    gradient.addColorStop(1, "rgba(30,100,30,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(128, 128, 112, 0, Math.PI * 2);
    ctx.fill();
    texture.update(true);
    return texture;
  }

  private createDustSheets(): void {
    const texture = this.createDustSheetTexture();
    this.textures.push(texture);
    for (let index = 0; index < 7; index++) {
      const mesh = MeshBuilder.CreatePlane(
        `dustFront-${index}`,
        { width: 120 + this.rand() * 85, height: 28 + this.rand() * 28 },
        this.scene,
      );
      mesh.parent = this.root;
      mesh.position.copyFrom(this.randomOuterPosition(115, 225, 32, 92));
      mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      mesh.isPickable = false;
      const material = this.createTransparentMaterial(
        `dustFrontMat-${index}`,
        color3(this.profile.palette[1 + (index % 3)]),
        0.11 + this.rand() * 0.08,
      );
      material.emissiveTexture = texture;
      material.opacityTexture = texture;
      mesh.material = material;
      this.trackMesh(mesh);
      this.volumes.push({
        mesh,
        material,
        baseAlpha: material.alpha,
        phase: this.rand() * Math.PI * 2,
        pulseSpeed: 0.07 + this.rand() * 0.09,
        baseScale: 0.85 + this.rand() * 0.45,
      });
    }
  }

  private createDustSheetTexture(): DynamicTexture {
    const texture = new DynamicTexture("dustFrontTexture", { width: 512, height: 192 }, this.scene, true);
    texture.hasAlpha = true;
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    const rand = mulberry32(Math.floor(this.rand() * 0x7fffffff));
    ctx.clearRect(0, 0, 512, 192);
    ctx.lineCap = "round";
    for (let index = 0; index < 190; index++) {
      const y = rand() * 192;
      const x = rand() * 512;
      const length = 15 + rand() * 95;
      ctx.beginPath();
      ctx.moveTo(x - length, y + length * 0.12);
      ctx.lineTo(x + length, y - length * 0.12);
      ctx.strokeStyle = rgba(this.profile.palette[1 + (index % 3)], 0.025 + rand() * 0.12);
      ctx.lineWidth = 0.6 + rand() * 5;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "destination-in";
    const horizontalFade = ctx.createLinearGradient(0, 0, 512, 0);
    horizontalFade.addColorStop(0, "rgba(255,255,255,0)");
    horizontalFade.addColorStop(0.14, "rgba(255,255,255,1)");
    horizontalFade.addColorStop(0.86, "rgba(255,255,255,1)");
    horizontalFade.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = horizontalFade;
    ctx.fillRect(0, 0, 512, 192);
    const verticalFade = ctx.createLinearGradient(0, 0, 0, 192);
    verticalFade.addColorStop(0, "rgba(255,255,255,0)");
    verticalFade.addColorStop(0.18, "rgba(255,255,255,1)");
    verticalFade.addColorStop(0.82, "rgba(255,255,255,1)");
    verticalFade.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = verticalFade;
    ctx.fillRect(0, 0, 512, 192);
    ctx.globalCompositeOperation = "source-over";
    texture.update(true);
    return texture;
  }

  private createRadiationPulses(nursery = false): void {
    const count = nursery ? 2 : 5;
    for (let index = 0; index < count; index++) {
      const radius = (nursery ? 74 : 98) + index * (nursery ? 48 : 31);
      const points = this.createIrregularArcPoints(
        radius,
        (index % 2 === 0 ? 1 : -1) * (nursery ? 34 : 42 + index * 5),
        Math.PI * (1.15 + this.rand() * 0.62),
        80,
      );
      const core = MeshBuilder.CreateLines(`${this.kind}PulseCore-${index}`, { points }, this.scene);
      core.parent = this.root;
      core.color = color3(this.profile.palette[index % 2 === 0 ? 2 : 3]);
      core.alpha = 0;
      core.isPickable = false;
      core.alwaysSelectAsActiveMesh = true;
      this.includeInGlow(core);

      const hazeMaterial = this.createTransparentMaterial(
        `${this.kind}PulseHazeMat-${index}`,
        color3(this.profile.palette[index % 2 === 0 ? 2 : 3]).scale(0.7),
        0,
      );
      const haze = MeshBuilder.CreateTube(
        `${this.kind}PulseHaze-${index}`,
        { path: points, radius: nursery ? 1.2 : 1.5, tessellation: 8, cap: Mesh.NO_CAP },
        this.scene,
      );
      haze.parent = this.root;
      haze.material = hazeMaterial;
      haze.isPickable = false;
      this.trackMesh(haze);
      this.pulses.push({
        core,
        haze,
        hazeMaterial,
        phase: index / count,
        speed: nursery ? 0.035 + index * 0.004 : 0.07 + index * 0.006,
        baseAlpha: nursery ? 0.14 : 0.2,
        hazeBaseAlpha: nursery ? 0.026 : 0.038,
      });
    }
  }

  private createRadiationRays(): void {
    for (let index = 0; index < 16; index++) {
      const angle = (index / 16) * Math.PI * 2 + (this.rand() - 0.5) * 0.12;
      const inner = 112 + this.rand() * 18;
      const outer = 178 + this.rand() * 62;
      const height = (index % 2 === 0 ? 1 : -1) * (36 + this.rand() * 36);
      const rayStart = new Vector3(Math.cos(angle) * inner, height, Math.sin(angle) * inner);
      const rayEnd = new Vector3(
        Math.cos(angle) * outer,
        height + (this.rand() - 0.5) * 12,
        Math.sin(angle) * outer,
      );
      const points = this.createJaggedPath(rayStart, rayEnd, 12, 2.8);
      const material = this.createTransparentMaterial(
        `radiationRayMat-${index}`,
        color3(this.profile.palette[index % 3 === 0 ? 3 : 2]),
        0.018 + this.rand() * 0.022,
      );
      const mesh = MeshBuilder.CreateTube(
        `radiationRay-${index}`,
        { path: points, radius: 0.45 + this.rand() * 0.7, tessellation: 7, cap: Mesh.NO_CAP },
        this.scene,
      );
      mesh.parent = this.root;
      mesh.material = material;
      mesh.isPickable = false;
      this.trackMesh(mesh);

      const hazeMaterial = this.createTransparentMaterial(
        `radiationRayHazeMat-${index}`,
        color3(this.profile.palette[index % 3 === 0 ? 3 : 2]).scale(0.52),
        0.008 + this.rand() * 0.009,
      );
      const haze = MeshBuilder.CreateTube(
        `radiationRayHaze-${index}`,
        { path: points, radius: 1.7 + this.rand() * 1.4, tessellation: 8, cap: Mesh.NO_CAP },
        this.scene,
      );
      haze.parent = this.root;
      haze.material = hazeMaterial;
      haze.isPickable = false;
      this.trackMesh(haze);
    }
  }

  private createProtostars(): void {
    for (let index = 0; index < 17; index++) {
      const position = this.randomOuterPosition(92, 226, 26, 96);
      const color = color3(this.profile.palette[index % 4 === 0 ? 3 : 2]);
      const material = this.createTransparentMaterial(`protostarMat-${index}`, color.scale(1.7), 0.8);
      const mesh = MeshBuilder.CreateSphere(
        `protostar-${index}`,
        { diameter: 0.65 + this.rand() * 1.25, segments: 8 },
        this.scene,
      );
      mesh.parent = this.root;
      mesh.position.copyFrom(position);
      mesh.material = material;
      mesh.isPickable = false;
      this.trackMesh(mesh);
      this.includeInGlow(mesh);

      const haloMaterial = this.createTransparentMaterial(`protostarHaloMat-${index}`, color.scale(0.82), 0.06);
      if (this.softCloudTexture) {
        haloMaterial.emissiveTexture = this.softCloudTexture;
        haloMaterial.opacityTexture = this.softCloudTexture;
      }
      const halo = MeshBuilder.CreatePlane(
        `protostarHalo-${index}`,
        { size: 5 + this.rand() * 6 },
        this.scene,
      );
      halo.parent = this.root;
      halo.position.copyFrom(position);
      halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
      halo.material = haloMaterial;
      halo.isPickable = false;
      this.trackMesh(halo);
      this.protostars.push({
        mesh,
        material,
        halo,
        haloMaterial,
        phase: this.rand() * Math.PI * 2,
        speed: 0.55 + this.rand() * 1.5,
        baseScale: 0.75 + this.rand() * 0.65,
      });
    }
  }

  private createElectricStrikePool(): void {
    const placeholder = Array.from({ length: 25 }, (_value, index) => new Vector3(index * 0.01, 0, 0));
    for (let strikeIndex = 0; strikeIndex < 4; strikeIndex++) {
      const cores: LinesMesh[] = [];
      const hazes: Mesh[] = [];
      const hazeMaterials: StandardMaterial[] = [];
      for (let branch = 0; branch < 3; branch++) {
        const core = MeshBuilder.CreateLines(
          `electricStrikeCore-${strikeIndex}-${branch}`,
          { points: placeholder, updatable: true },
          this.scene,
        );
        core.color = branch === 0 ? new Color3(0.78, 0.95, 1) : new Color3(0.35, 0.72, 1);
        core.alpha = 0;
        core.isVisible = false;
        core.isPickable = false;
        core.alwaysSelectAsActiveMesh = true;
        this.includeInGlow(core);
        cores.push(core);

        const hazeMaterial = this.createTransparentMaterial(
          `electricStrikeHazeMat-${strikeIndex}-${branch}`,
          branch === 0 ? new Color3(0.14, 0.52, 1) : new Color3(0.22, 0.32, 0.9),
          0,
        );
        const haze = MeshBuilder.CreateTube(
          `electricStrikeHaze-${strikeIndex}-${branch}`,
          { path: placeholder, radius: branch === 0 ? 1.25 : 0.82, tessellation: 7, cap: Mesh.NO_CAP, updatable: true },
          this.scene,
        );
        haze.material = hazeMaterial;
        haze.isVisible = false;
        haze.isPickable = false;
        this.trackMesh(haze);
        hazes.push(haze);
        hazeMaterials.push(hazeMaterial);
      }
      this.electricStrikes.push({
        cores,
        hazes,
        hazeMaterials,
        cooldown: 0.18 + strikeIndex * 0.48 + this.rand(),
        age: 0,
        duration: 0.34,
        active: false,
        phase: this.rand() * Math.PI * 2,
      });
    }
  }

  private updateElectricStrikes(deltaSeconds: number): void {
    for (const strike of this.electricStrikes) {
      if (!strike.active) {
        strike.cooldown -= deltaSeconds;
        if (strike.cooldown <= 0) this.spawnElectricStrike(strike);
        continue;
      }
      strike.age += deltaSeconds;
      if (strike.age >= strike.duration) {
        strike.active = false;
        strike.cooldown = 0.42 + this.rand() * 1.55;
        for (let index = 0; index < strike.cores.length; index++) {
          strike.cores[index].isVisible = false;
          strike.hazes[index].isVisible = false;
          strike.hazeMaterials[index].alpha = 0;
        }
        continue;
      }
      const life = strike.age / strike.duration;
      const envelope = Math.pow(1 - life, 0.6);
      const strobe = 0.58 + Math.abs(Math.sin(strike.age * 82 + strike.phase)) * 0.42;
      for (let index = 0; index < strike.cores.length; index++) {
        const branchStrength = index === 0 ? 1 : 0.56;
        strike.cores[index].alpha = envelope * strobe * 0.62 * branchStrength;
        strike.hazeMaterials[index].alpha = envelope * (0.03 + strobe * 0.045) * branchStrength;
      }
    }
  }

  private spawnElectricStrike(strike: ElectricStrikeState): void {
    const radius = 135 + this.rand() * 82;
    const startAngle = this.rand() * Math.PI * 2;
    const angularSpan = (this.rand() < 0.5 ? -1 : 1) * (0.24 + this.rand() * 0.62);
    const heightSign = this.rand() < 0.5 ? -1 : 1;
    const startHeight = heightSign * (42 + this.rand() * 58);
    const start = new Vector3(
      Math.cos(startAngle) * radius,
      startHeight,
      Math.sin(startAngle) * radius,
    );
    const endRadius = radius + (this.rand() - 0.5) * 34;
    const end = new Vector3(
      Math.cos(startAngle + angularSpan) * endRadius,
      startHeight + (this.rand() - 0.5) * 30,
      Math.sin(startAngle + angularSpan) * endRadius,
    );
    const main = this.createJaggedPath(start, end, 25, 8.5);
    const firstBranchStart = main[8 + Math.floor(this.rand() * 4)];
    const secondBranchStart = main[14 + Math.floor(this.rand() * 4)];
    const branchOne = this.createJaggedPath(
      firstBranchStart,
      firstBranchStart.add(new Vector3((this.rand() - 0.5) * 48, (this.rand() - 0.5) * 34, (this.rand() - 0.5) * 48)),
      25,
      5.2,
    );
    const branchTwo = this.createJaggedPath(
      secondBranchStart,
      secondBranchStart.add(new Vector3((this.rand() - 0.5) * 42, (this.rand() - 0.5) * 30, (this.rand() - 0.5) * 42)),
      25,
      4.5,
    );
    const paths = [main, branchOne, branchTwo];
    for (let index = 0; index < paths.length; index++) {
      MeshBuilder.CreateLines(strike.cores[index].name, { points: paths[index], instance: strike.cores[index] }, this.scene);
      MeshBuilder.CreateTube(
        strike.hazes[index].name,
        {
          path: paths[index],
          radius: index === 0 ? 1.05 + this.rand() * 0.55 : 0.65 + this.rand() * 0.35,
          tessellation: 7,
          cap: Mesh.NO_CAP,
          instance: strike.hazes[index],
        },
        this.scene,
      );
      strike.cores[index].isVisible = true;
      strike.hazes[index].isVisible = true;
    }
    strike.age = 0;
    strike.duration = 0.24 + this.rand() * 0.35;
    strike.phase = this.rand() * Math.PI * 2;
    strike.active = true;
    this.electricFlash = Math.max(this.electricFlash, 0.65 + this.rand() * 0.35);
  }

  private createJaggedPath(start: Vector3, end: Vector3, pointCount: number, jitter: number): Vector3[] {
    const points: Vector3[] = [];
    const direction = end.subtract(start);
    for (let index = 0; index < pointCount; index++) {
      const t = index / (pointCount - 1);
      const taper = Math.sin(t * Math.PI);
      const point = start.add(direction.scale(t));
      point.x += (this.rand() - 0.5) * jitter * taper;
      point.y += (this.rand() - 0.5) * jitter * taper;
      point.z += (this.rand() - 0.5) * jitter * taper;
      points.push(point);
    }
    return points;
  }

  private createIrregularArcPoints(radius: number, height: number, span: number, segments: number): Vector3[] {
    const points: Vector3[] = [];
    const start = this.rand() * Math.PI * 2;
    const roughPhase = this.rand() * Math.PI * 2;
    for (let index = 0; index <= segments; index++) {
      const t = index / segments;
      const angle = start + t * span;
      const rough = (
        Math.sin(t * Math.PI * 13 + roughPhase) * 2.1
        + Math.sin(t * Math.PI * 37 + roughPhase * 0.7) * 0.7
      ) * Math.sin(t * Math.PI);
      points.push(new Vector3(
        Math.cos(angle) * (radius + rough),
        height + Math.sin(t * Math.PI * 3) * 4 + rough * 0.4,
        Math.sin(angle) * (radius + rough),
      ));
    }
    return points;
  }

  private randomOuterPosition(minRadius: number, maxRadius: number, minHeight: number, maxHeight: number): Vector3 {
    const angle = this.rand() * Math.PI * 2;
    const radius = minRadius + this.rand() * (maxRadius - minRadius);
    const height = (this.rand() < 0.5 ? -1 : 1) * (minHeight + this.rand() * (maxHeight - minHeight));
    return new Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
  }

  private createTransparentMaterial(name: string, emissive: Color3, alpha: number): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = emissive;
    material.disableLighting = true;
    material.disableDepthWrite = true;
    material.backFaceCulling = false;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    material.alpha = alpha;
    this.materials.push(material);
    return material;
  }

  private trackMesh<T extends Mesh>(mesh: T): T {
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    this.meshes.push(mesh);
    return mesh;
  }

  private includeInGlow(mesh: Mesh): void {
    this.glowLayer.addIncludedOnlyMesh(mesh);
    this.glowMeshes.add(mesh);
    if (!this.meshes.includes(mesh)) this.meshes.push(mesh);
  }
}
