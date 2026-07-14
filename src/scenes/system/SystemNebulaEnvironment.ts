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
import type { NebulaRegion } from "../../data/Nebula";
import { AmbientNebulaSystemEnvironment } from "./AmbientNebulaSystemEnvironment";

export interface SystemNebulaEnvironment {
  update(deltaSeconds: number): void;
  dispose(): void;
}

interface IonRibbonState {
  mesh: Mesh;
  material: StandardMaterial;
  hazeMesh: Mesh;
  hazeMaterial: StandardMaterial;
  baseAlpha: number;
  hazeBaseAlpha: number;
  pulseSpeed: number;
  phase: number;
}

interface IonPulseRingState {
  mesh: LinesMesh;
  hazeMesh: Mesh;
  hazeMaterial: StandardMaterial;
  baseAlpha: number;
  hazeBaseAlpha: number;
  rotationSpeed: number;
  phase: number;
}

interface IonArcState {
  mesh: LinesMesh;
  hazeMesh: Mesh;
  hazeMaterial: StandardMaterial;
  age: number;
  duration: number;
  cooldown: number;
  active: boolean;
  phase: number;
}

const ION_CLOUD_TEXTURE_WIDTH = 1024;
const ION_CLOUD_TEXTURE_HEIGHT = 512;
const ION_VEIL_TEXTURE_WIDTH = 768;
const ION_VEIL_TEXTURE_HEIGHT = 384;
const ION_ARC_COUNT = 7;
const ION_ARC_POINTS = 24;
const ION_RIBBON_COUNT = 7;
const ION_RING_COUNT = 4;

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function rgba(color: [number, number, number], alpha: number): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
}

class IonStormSystemEnvironment implements SystemNebulaEnvironment {
  private readonly root: TransformNode;
  private readonly cloudShells: Mesh[] = [];
  private readonly cloudMaterials: StandardMaterial[] = [];
  private readonly cloudTextures: DynamicTexture[] = [];
  private readonly ribbons: IonRibbonState[] = [];
  private readonly rings: IonPulseRingState[] = [];
  private readonly arcs: IonArcState[] = [];
  private readonly particleSystems: ParticleSystem[] = [];
  private readonly glowMeshes = new Set<Mesh>();
  private readonly stormLight: HemisphericLight;
  private readonly rand: () => number;
  private elapsed = 0;

  constructor(
    private readonly scene: Scene,
    private readonly glowLayer: GlowLayer,
    seed: number,
  ) {
    this.rand = mulberry32(seed ^ 0x51ed270b);
    this.root = new TransformNode("ionStormSystemEnvironment", scene);

    this.createCloudShells(seed);
    this.createMagneticRibbons();
    this.createPulseRings();
    this.createArcPool();
    this.createParticleFields();

    this.stormLight = new HemisphericLight(
      "ionStormEnvironmentLight",
      new Vector3(-0.3, 0.8, 0.5),
      scene,
    );
    this.stormLight.diffuse = new Color3(0.24, 0.31, 0.68);
    this.stormLight.specular = new Color3(0.28, 0.62, 1);
    this.stormLight.groundColor = new Color3(0.11, 0.04, 0.24);
    this.stormLight.intensity = 0.055;
  }

  update(deltaSeconds: number): void {
    const dt = Math.max(0, Math.min(0.1, deltaSeconds));
    this.elapsed += dt;

    if (this.cloudShells[0]) {
      this.cloudShells[0].rotation.y += dt * 0.0065;
      this.cloudShells[0].rotation.z = Math.sin(this.elapsed * 0.025) * 0.025;
    }
    if (this.cloudShells[1]) {
      this.cloudShells[1].rotation.y -= dt * 0.011;
      this.cloudShells[1].rotation.x = 0.08 + Math.sin(this.elapsed * 0.037) * 0.035;
    }

    this.root.rotation.y += dt * 0.018;
    this.root.rotation.z = Math.sin(this.elapsed * 0.055) * 0.018;

    for (const ribbon of this.ribbons) {
      const pulse = 0.72 + Math.sin(this.elapsed * ribbon.pulseSpeed + ribbon.phase) * 0.2;
      ribbon.material.alpha = ribbon.baseAlpha * pulse;
      ribbon.hazeMaterial.alpha = ribbon.hazeBaseAlpha * (0.8 + pulse * 0.35);
    }

    for (let index = 0; index < this.rings.length; index++) {
      const ring = this.rings[index];
      ring.mesh.rotation.y += dt * ring.rotationSpeed;
      ring.mesh.rotation.z = Math.sin(this.elapsed * 0.08 + ring.phase) * 0.16;
      ring.mesh.alpha = ring.baseAlpha * (0.72 + Math.sin(this.elapsed * 0.34 + ring.phase) * 0.22);
      ring.hazeMesh.rotation.copyFrom(ring.mesh.rotation);
      ring.hazeMaterial.alpha = ring.hazeBaseAlpha
        * (0.78 + Math.sin(this.elapsed * 0.29 + ring.phase) * 0.18);
      const breathing = 1 + Math.sin(this.elapsed * 0.19 + ring.phase) * 0.035;
      ring.mesh.scaling.setAll(breathing);
      ring.hazeMesh.scaling.setAll(breathing * 1.01);
    }

    this.updateArcs(dt);
    this.stormLight.intensity = 0.048
      + Math.sin(this.elapsed * 0.41) * 0.008
      + Math.sin(this.elapsed * 1.37) * 0.004;
  }

  dispose(): void {
    for (const particles of this.particleSystems) particles.dispose();
    this.particleSystems.length = 0;

    for (const mesh of this.glowMeshes) this.glowLayer.removeIncludedOnlyMesh(mesh);
    this.glowMeshes.clear();

    for (const arc of this.arcs) arc.mesh.dispose();
    for (const arc of this.arcs) {
      arc.hazeMesh.dispose();
      arc.hazeMaterial.dispose();
    }
    this.arcs.length = 0;
    for (const ring of this.rings) ring.mesh.dispose();
    for (const ring of this.rings) {
      ring.hazeMesh.dispose();
      ring.hazeMaterial.dispose();
    }
    this.rings.length = 0;
    for (const ribbon of this.ribbons) {
      ribbon.mesh.dispose();
      ribbon.material.dispose();
      ribbon.hazeMesh.dispose();
      ribbon.hazeMaterial.dispose();
    }
    this.ribbons.length = 0;

    for (const shell of this.cloudShells) shell.dispose();
    for (const material of this.cloudMaterials) material.dispose(false, false);
    for (const texture of this.cloudTextures) texture.dispose();
    this.cloudShells.length = 0;
    this.cloudMaterials.length = 0;
    this.cloudTextures.length = 0;

    this.stormLight.dispose();
    this.root.dispose();
  }

  private createCloudShells(seed: number): void {
    const cloudTexture = this.createIonCloudTexture(
      "ionStormCloudTexture",
      ION_CLOUD_TEXTURE_WIDTH,
      ION_CLOUD_TEXTURE_HEIGHT,
      seed ^ 0x243f6a88,
      false,
    );
    const veilTexture = this.createIonCloudTexture(
      "ionStormVeilTexture",
      ION_VEIL_TEXTURE_WIDTH,
      ION_VEIL_TEXTURE_HEIGHT,
      seed ^ 0xb7e15162,
      true,
    );
    this.cloudTextures.push(cloudTexture, veilTexture);

    this.createCloudShell("ionStormCloudShell", 1750, cloudTexture, 0.72, new Vector3(0.03, 0, -0.02));
    this.createCloudShell("ionStormVeilShell", 1480, veilTexture, 0.48, new Vector3(0.08, 0.12, 0.03));
  }

  private createCloudShell(
    name: string,
    diameter: number,
    texture: DynamicTexture,
    alpha: number,
    rotation: Vector3,
  ): void {
    const shell = MeshBuilder.CreateSphere(name, { diameter, segments: 32 }, this.scene);
    shell.rotation.copyFrom(rotation);
    shell.isPickable = false;
    shell.alwaysSelectAsActiveMesh = true;
    shell.infiniteDistance = true;
    shell.applyFog = false;
    shell.renderingGroupId = 0;
    shell.alphaIndex = -120 + this.cloudShells.length;

    const material = new StandardMaterial(`${name}Material`, this.scene);
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = new Color3(0.82, 0.78, 1.08);
    material.emissiveTexture = texture;
    material.opacityTexture = texture;
    material.disableLighting = true;
    material.disableDepthWrite = true;
    material.backFaceCulling = false;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    material.alpha = alpha;
    shell.material = material;

    this.cloudShells.push(shell);
    this.cloudMaterials.push(material);
  }

  private createIonCloudTexture(
    name: string,
    width: number,
    height: number,
    seed: number,
    veil: boolean,
  ): DynamicTexture {
    const texture = new DynamicTexture(
      name,
      { width, height },
      this.scene,
      true,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    texture.hasAlpha = true;
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 4;

    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    const rand = mulberry32(seed);
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";

    const palettes: Array<[number, number, number]> = veil
      ? [[57, 104, 231], [99, 58, 220], [48, 184, 246], [151, 90, 236]]
      : [[30, 18, 84], [63, 31, 139], [28, 87, 174], [115, 48, 178]];
    const puffCount = veil ? 92 : 165;
    for (let index = 0; index < puffCount; index++) {
      const x = rand() * width;
      const y = height * (0.08 + rand() * 0.84);
      const radiusX = width * (veil ? 0.035 + rand() * 0.1 : 0.045 + rand() * 0.13);
      const radiusY = height * (veil ? 0.025 + rand() * 0.075 : 0.045 + rand() * 0.13);
      const color = palettes[Math.floor(rand() * palettes.length)];
      const alphaValue = veil ? 0.035 + rand() * 0.09 : 0.06 + rand() * 0.14;
      this.paintWrappedCloudPuff(ctx, width, x, y, radiusX, radiusY, color, alphaValue);
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const filamentCount = veil ? 18 : 11;
    for (let index = 0; index < filamentCount; index++) {
      const y = height * (0.12 + rand() * 0.76);
      const amplitude = height * (0.035 + rand() * 0.12);
      const color = rand() < 0.45 ? palettes[2] : palettes[3];
      ctx.beginPath();
      ctx.moveTo(-width * 0.08, y);
      ctx.bezierCurveTo(
        width * 0.2,
        y + (rand() - 0.5) * amplitude,
        width * 0.34,
        y + (rand() - 0.5) * amplitude * 2,
        width * 0.52,
        y + (rand() - 0.5) * amplitude,
      );
      ctx.bezierCurveTo(
        width * 0.7,
        y + (rand() - 0.5) * amplitude * 2,
        width * 0.84,
        y + (rand() - 0.5) * amplitude,
        width * 1.08,
        y,
      );
      ctx.strokeStyle = rgba(color, veil ? 0.08 + rand() * 0.08 : 0.045 + rand() * 0.06);
      ctx.lineWidth = height * (veil ? 0.005 + rand() * 0.012 : 0.009 + rand() * 0.018);
      ctx.shadowColor = rgba(color, 0.14);
      ctx.shadowBlur = height * 0.035;
      ctx.stroke();
    }

    for (let index = 0; index < (veil ? 150 : 85); index++) {
      const x = rand() * width;
      const y = rand() * height;
      const radius = 0.5 + rand() * (veil ? 2.2 : 1.4);
      const color = rand() < 0.4 ? palettes[2] : palettes[3];
      ctx.fillStyle = rgba(color, 0.12 + rand() * 0.26);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    texture.update(true);
    return texture;
  }

  private paintWrappedCloudPuff(
    ctx: CanvasRenderingContext2D,
    width: number,
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    color: [number, number, number],
    alpha: number,
  ): void {
    for (const offset of [-width, 0, width]) {
      ctx.save();
      ctx.translate(x + offset, y);
      ctx.scale(radiusX, radiusY);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      gradient.addColorStop(0, rgba(color, alpha));
      gradient.addColorStop(0.45, rgba(color, alpha * 0.5));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private createMagneticRibbons(): void {
    for (let index = 0; index < ION_RIBBON_COUNT; index++) {
      const path: Vector3[] = [];
      const radius = 128 + index * 18 + this.rand() * 12;
      const startAngle = this.rand() * Math.PI * 2;
      const arcLength = Math.PI * (0.78 + this.rand() * 0.9);
      const heightSign = index % 2 === 0 ? 1 : -1;
      const baseHeight = heightSign * (30 + index * 5 + this.rand() * 18);
      const roughPhase = this.rand() * Math.PI * 2;
      const segments = 64;
      for (let segment = 0; segment <= segments; segment++) {
        const t = segment / segments;
        const angle = startAngle + arcLength * t;
        const wave = Math.sin(t * Math.PI * (2.4 + index * 0.17) + index) * (6 + index * 0.8);
        const roughness = (
          Math.sin(t * Math.PI * 13 + roughPhase) * 1.8
          + Math.sin(t * Math.PI * 31 + roughPhase * 0.7) * 0.65
        );
        const tapered = Math.sin(t * Math.PI);
        path.push(new Vector3(
          Math.cos(angle) * (radius + (wave + roughness) * tapered),
          baseHeight
            + Math.sin(t * Math.PI * 2 + index) * (7 + index * 0.5)
            + roughness * 0.65,
          Math.sin(angle) * (radius + (wave + roughness) * tapered),
        ));
      }

      const mesh = MeshBuilder.CreateTube(
        `ionStormMagneticRibbon-${index}`,
        {
          path,
          radius: 0.22 + index * 0.045,
          tessellation: 6,
          cap: Mesh.NO_CAP,
        },
        this.scene,
      );
      mesh.parent = this.root;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.renderingGroupId = 0;

      const cyan = index % 3 === 0;
      const color = cyan ? new Color3(0.18, 0.63, 1) : new Color3(0.48, 0.2, 1);
      const material = new StandardMaterial(`ionStormMagneticRibbonMat-${index}`, this.scene);
      material.diffuseColor = Color3.Black();
      material.specularColor = Color3.Black();
      material.emissiveColor = color.scale(1.25);
      material.disableLighting = true;
      material.disableDepthWrite = true;
      material.backFaceCulling = false;
      material.transparencyMode = Material.MATERIAL_ALPHABLEND;
      const baseAlpha = 0.035 + this.rand() * 0.04;
      material.alpha = baseAlpha;
      mesh.material = material;

      const hazeMesh = MeshBuilder.CreateTube(
        `ionStormMagneticRibbonHaze-${index}`,
        {
          path,
          radius: 1.15 + index * 0.11,
          tessellation: 8,
          cap: Mesh.NO_CAP,
        },
        this.scene,
      );
      hazeMesh.parent = this.root;
      hazeMesh.isPickable = false;
      hazeMesh.alwaysSelectAsActiveMesh = true;
      hazeMesh.renderingGroupId = 0;
      const hazeMaterial = new StandardMaterial(`ionStormMagneticRibbonHazeMat-${index}`, this.scene);
      hazeMaterial.diffuseColor = Color3.Black();
      hazeMaterial.specularColor = Color3.Black();
      hazeMaterial.emissiveColor = color.scale(0.68);
      hazeMaterial.disableLighting = true;
      hazeMaterial.disableDepthWrite = true;
      hazeMaterial.backFaceCulling = false;
      hazeMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
      const hazeBaseAlpha = 0.012 + this.rand() * 0.016;
      hazeMaterial.alpha = hazeBaseAlpha;
      hazeMesh.material = hazeMaterial;

      if (index % 3 === 0) this.includeInGlow(mesh);
      this.ribbons.push({
        mesh,
        material,
        hazeMesh,
        hazeMaterial,
        baseAlpha,
        hazeBaseAlpha,
        pulseSpeed: 0.22 + this.rand() * 0.28,
        phase: this.rand() * Math.PI * 2,
      });
    }
  }

  private createPulseRings(): void {
    for (let index = 0; index < ION_RING_COUNT; index++) {
      const radius = 112 + index * 38;
      const points: Vector3[] = [];
      const segments = 76;
      const startAngle = this.rand() * Math.PI * 2;
      const angularSpan = Math.PI * (1.12 + this.rand() * 0.55);
      const roughPhase = this.rand() * Math.PI * 2;
      for (let segment = 0; segment <= segments; segment++) {
        const t = segment / segments;
        const angle = startAngle + t * angularSpan;
        const roughness = (
          Math.sin(t * Math.PI * 17 + roughPhase) * 2.2
          + Math.sin(t * Math.PI * 43 + roughPhase * 0.6) * 0.7
        ) * Math.sin(t * Math.PI);
        points.push(new Vector3(
          Math.cos(angle) * (radius + roughness),
          (index % 2 === 0 ? 1 : -1) * (38 + index * 9)
            + Math.sin(angle * 3 + index) * 5
            + roughness * 0.55,
          Math.sin(angle) * (radius + roughness),
        ));
      }
      const mesh = MeshBuilder.CreateLines(`ionStormPulseRing-${index}`, { points }, this.scene);
      mesh.parent = this.root;
      mesh.color = index % 2 === 0
        ? new Color3(0.2, 0.65, 1)
        : new Color3(0.62, 0.28, 1);
      mesh.alpha = 0.07;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      this.includeInGlow(mesh);

      const hazeMesh = MeshBuilder.CreateTube(
        `ionStormPulseRingHaze-${index}`,
        {
          path: points,
          radius: 1.35 + index * 0.14,
          tessellation: 8,
          cap: Mesh.NO_CAP,
        },
        this.scene,
      );
      hazeMesh.parent = this.root;
      hazeMesh.isPickable = false;
      hazeMesh.alwaysSelectAsActiveMesh = true;
      const hazeColor = index % 2 === 0
        ? new Color3(0.2, 0.65, 1)
        : new Color3(0.62, 0.28, 1);
      const hazeMaterial = new StandardMaterial(`ionStormPulseRingHazeMat-${index}`, this.scene);
      hazeMaterial.diffuseColor = Color3.Black();
      hazeMaterial.specularColor = Color3.Black();
      hazeMaterial.emissiveColor = hazeColor.scale(0.62);
      hazeMaterial.disableLighting = true;
      hazeMaterial.disableDepthWrite = true;
      hazeMaterial.backFaceCulling = false;
      hazeMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
      const hazeBaseAlpha = 0.012 + index * 0.003;
      hazeMaterial.alpha = hazeBaseAlpha;
      hazeMesh.material = hazeMaterial;
      this.rings.push({
        mesh,
        hazeMesh,
        hazeMaterial,
        baseAlpha: 0.032 + index * 0.008,
        hazeBaseAlpha,
        rotationSpeed: (index % 2 === 0 ? 1 : -1) * (0.018 + index * 0.006),
        phase: index * 1.7 + this.rand(),
      });
    }
  }

  private createArcPool(): void {
    const points = Array.from(
      { length: ION_ARC_POINTS },
      (_value, index) => new Vector3(index * 0.01, 0, 0),
    );
    for (let index = 0; index < ION_ARC_COUNT; index++) {
      const mesh = MeshBuilder.CreateLines(
        `ionStormDischarge-${index}`,
        { points, updatable: true },
        this.scene,
      );
      mesh.color = index % 3 === 0
        ? new Color3(0.7, 0.52, 1)
        : new Color3(0.38, 0.82, 1);
      mesh.alpha = 0;
      mesh.isVisible = false;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      this.includeInGlow(mesh);

      const hazeMesh = MeshBuilder.CreateTube(
        `ionStormDischargeHaze-${index}`,
        {
          path: points,
          radius: 0.78,
          tessellation: 7,
          cap: Mesh.NO_CAP,
          updatable: true,
        },
        this.scene,
      );
      hazeMesh.isVisible = false;
      hazeMesh.isPickable = false;
      hazeMesh.alwaysSelectAsActiveMesh = true;
      const hazeMaterial = new StandardMaterial(`ionStormDischargeHazeMat-${index}`, this.scene);
      hazeMaterial.diffuseColor = Color3.Black();
      hazeMaterial.specularColor = Color3.Black();
      hazeMaterial.emissiveColor = index % 3 === 0
        ? new Color3(0.52, 0.27, 0.95)
        : new Color3(0.13, 0.48, 0.9);
      hazeMaterial.disableLighting = true;
      hazeMaterial.disableDepthWrite = true;
      hazeMaterial.backFaceCulling = false;
      hazeMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
      hazeMaterial.alpha = 0;
      hazeMesh.material = hazeMaterial;
      this.arcs.push({
        mesh,
        hazeMesh,
        hazeMaterial,
        age: 0,
        duration: 0.3,
        cooldown: 0.25 + index * 0.27 + this.rand() * 0.6,
        active: false,
        phase: this.rand() * Math.PI * 2,
      });
    }
  }

  private createParticleFields(): void {
    this.particleSystems.push(
      this.createParticleField("ionStormUpperCharge", 1),
      this.createParticleField("ionStormLowerCharge", -1),
    );
  }

  private createParticleField(name: string, heightSign: 1 | -1): ParticleSystem {
    const particles = new ParticleSystem(name, 150, this.scene);
    particles.particleTexture = new Texture("/textures/star.glow.webp", this.scene);
    particles.emitter = Vector3.Zero();
    particles.minEmitBox = new Vector3(-190, heightSign > 0 ? 28 : -108, -190);
    particles.maxEmitBox = new Vector3(190, heightSign > 0 ? 108 : -28, 190);
    particles.color1 = new Color4(0.23, 0.52, 1, 0.24);
    particles.color2 = new Color4(0.62, 0.25, 1, 0.2);
    particles.colorDead = new Color4(0.12, 0.1, 0.45, 0);
    particles.minSize = 0.14;
    particles.maxSize = 0.72;
    particles.minLifeTime = 4.5;
    particles.maxLifeTime = 9.5;
    particles.emitRate = 18;
    particles.minEmitPower = 0.04;
    particles.maxEmitPower = 0.2;
    particles.direction1 = new Vector3(-0.16, heightSign * 0.02, -0.1);
    particles.direction2 = new Vector3(0.16, heightSign * 0.08, 0.1);
    particles.minAngularSpeed = -0.6;
    particles.maxAngularSpeed = 0.6;
    particles.blendMode = ParticleSystem.BLENDMODE_ADD;
    particles.updateSpeed = 0.018;
    particles.start();
    return particles;
  }

  private updateArcs(deltaSeconds: number): void {
    for (const arc of this.arcs) {
      if (!arc.active) {
        arc.cooldown -= deltaSeconds;
        if (arc.cooldown <= 0) this.spawnArc(arc);
        continue;
      }

      arc.age += deltaSeconds;
      if (arc.age >= arc.duration) {
        arc.active = false;
        arc.mesh.isVisible = false;
        arc.mesh.alpha = 0;
        arc.hazeMesh.isVisible = false;
        arc.hazeMaterial.alpha = 0;
        arc.cooldown = 0.42 + this.rand() * 1.65;
        continue;
      }

      const life = arc.age / arc.duration;
      const envelope = Math.pow(1 - life, 0.62);
      const strobe = 0.58 + Math.abs(Math.sin(arc.age * 78 + arc.phase)) * 0.42;
      arc.mesh.alpha = envelope * strobe * 0.58;
      arc.hazeMaterial.alpha = envelope * (0.035 + strobe * 0.035);
    }
  }

  private spawnArc(arc: IonArcState): void {
    const radius = 132 + this.rand() * 112;
    const startAngle = this.rand() * Math.PI * 2;
    const direction = this.rand() < 0.5 ? -1 : 1;
    const angularSpan = direction * (0.22 + this.rand() * 0.62);
    const heightSign = this.rand() < 0.5 ? -1 : 1;
    const baseHeight = heightSign * (34 + this.rand() * 78);
    const bow = 9 + this.rand() * 24;
    const points: Vector3[] = [];

    for (let index = 0; index < ION_ARC_POINTS; index++) {
      const t = index / (ION_ARC_POINTS - 1);
      const taper = Math.sin(t * Math.PI);
      const angle = startAngle + angularSpan * t;
      const radialJitter = (this.rand() - 0.5) * 10 * taper;
      const verticalJitter = (this.rand() - 0.5) * 9 * taper;
      points.push(new Vector3(
        Math.cos(angle) * (radius + radialJitter),
        baseHeight + taper * bow * heightSign + verticalJitter,
        Math.sin(angle) * (radius + radialJitter),
      ));
    }

    MeshBuilder.CreateLines(arc.mesh.name, { points, instance: arc.mesh }, this.scene);
    MeshBuilder.CreateTube(
      arc.hazeMesh.name,
      {
        path: points,
        radius: 0.68 + this.rand() * 0.48,
        tessellation: 7,
        cap: Mesh.NO_CAP,
        instance: arc.hazeMesh,
      },
      this.scene,
    );
    arc.mesh.color = this.rand() < 0.35
      ? new Color3(0.72, 0.52, 1)
      : new Color3(0.35, 0.8, 1);
    arc.mesh.isVisible = true;
    arc.mesh.alpha = 0.58;
    arc.hazeMesh.isVisible = true;
    arc.hazeMaterial.alpha = 0.07;
    arc.age = 0;
    arc.duration = 0.2 + this.rand() * 0.34;
    arc.phase = this.rand() * Math.PI * 2;
    arc.active = true;
  }

  private includeInGlow(mesh: Mesh): void {
    this.glowLayer.addIncludedOnlyMesh(mesh);
    this.glowMeshes.add(mesh);
  }
}

export function createSystemNebulaEnvironment(
  scene: Scene,
  glowLayer: GlowLayer,
  nebula: NebulaRegion | null | undefined,
  starId: number,
): SystemNebulaEnvironment | null {
  if (!nebula) return null;

  switch (nebula.kind) {
    case "ionStorm":
      return new IonStormSystemEnvironment(
        scene,
        glowLayer,
        ((nebula.id + 1) * 0x45d9f3b) ^ ((starId + 1) * 0x27d4eb2d),
      );
    default:
      return new AmbientNebulaSystemEnvironment(
        scene,
        glowLayer,
        nebula.kind,
        ((nebula.id + 1) * 0x45d9f3b) ^ ((starId + 1) * 0x27d4eb2d),
      );
  }
}
