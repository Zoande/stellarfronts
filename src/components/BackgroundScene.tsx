import { useEffect, useRef } from 'react';

interface BackgroundSceneProps {
  onLoadProgress?: (progress: number, detail: string) => void;
  onReady?: () => void;
}
import {
  ArcRotateCamera,
  Axis,
  Color3,
  Color4,
  Engine,
  GlowLayer,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PointLight,
  Scene,
  SceneLoader,
  Space,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders';
import { SHIP_MODEL_DEFINITIONS } from '../data/Starbase';

const AUTH_SHIP_MODEL = SHIP_MODEL_DEFINITIONS.corvette;
const AUTH_FLEET_MODELS = [
  {
    definition: SHIP_MODEL_DEFINITIONS.battleship,
    position: new Vector3(-4.5, 38.2, -1.4),
    rotation: Math.PI * 0.08,
    scaleBoost: 3.4,
  },
  {
    definition: SHIP_MODEL_DEFINITIONS.cruiser,
    position: new Vector3(-2.2, 36.8, 1.4),
    rotation: -Math.PI * 0.18,
    scaleBoost: 3.0,
  },
  {
    definition: SHIP_MODEL_DEFINITIONS.destroyer,
    position: new Vector3(-3.8, 36.0, 4.0),
    rotation: Math.PI * 0.28,
    scaleBoost: 3.15,
  },
] as const;

function rnd(seedRef: { v: number }) {
  seedRef.v = (seedRef.v * 1664525 + 1013904223) >>> 0;
  return seedRef.v / 4294967296;
}

export default function BackgroundScene({ onLoadProgress, onReady }: BackgroundSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const c = canvas;
    const gctx = ctx;

    let width = c.clientWidth || window.innerWidth;
    let height = c.clientHeight || window.innerHeight;
    c.width = width * devicePixelRatio;
    c.height = height * devicePixelRatio;
    gctx.scale(devicePixelRatio, devicePixelRatio);

    const seedRef = { v: 42 };
    const starCount = 140;
    const stars: { x: number; y: number; r: number; alpha: number }[] = [];
    for (let i = 0; i < starCount; i++) {
      const x = rnd(seedRef) * width;
      const y = rnd(seedRef) * height;
      const r = 0.6 + rnd(seedRef) * 1.8;
      const alpha = 0.2 + rnd(seedRef) * 0.8;
      stars.push({ x, y, r, alpha });
    }

    // Load a few planet images (public folder)
    const planetSrcs = [
      '/textures/gas_giant.webp',
      '/textures/rocky_planet.webp',
      '/textures/ice_planet.webp',
      '/textures/planets/Arid/Arid_01-1024x512.webp'
    ];
    const planets: HTMLImageElement[] = [];
    planetSrcs.forEach((src) => {
      const img = new Image();
      img.src = src;
      planets.push(img);
    });

    // glow sprite for star
    const glow = new Image();
    glow.src = '/textures/star.glow.webp';

    // central star position (near upper-left quadrant)
    const star = {
      x: Math.floor(width * 0.32),
      y: Math.floor(height * 0.36),
      size: Math.max(80, Math.min(220, Math.floor(Math.min(width, height) * 0.12)))
    };

    // planet instances orbiting the star
    const planetInstances: {
      img: HTMLImageElement;
      orbitR: number;
      angle: number;
      angularSpeed: number;
      size: number;
      tilt: number;
    }[] = [];

    const planetCount = 5;
    for (let i = 0; i < planetCount; i++) {
      const img = planets[i % planets.length];
      const orbitR = star.size * (1.2 + i * 0.9) + rnd(seedRef) * 40;
      const angle = rnd(seedRef) * Math.PI * 2;
      // slow down planets significantly for a calm background
      const angularSpeed = (0.00025 + rnd(seedRef) * 0.0009 * (0.6 + i * 0.2)) * 0.12;
      // slight size variance
      const size = Math.floor(star.size * (0.28 + rnd(seedRef) * 0.6));
      // small tilt to flatten orbits slightly
      const tilt = (rnd(seedRef) * 0.5 - 0.25) * 0.6;
      planetInstances.push({ img, orbitR, angle, angularSpeed, size, tilt });
    }

    let raf = 0;
    let t0 = performance.now();

    function draw(now: number) {
      const dt = now - t0;
      t0 = now;

      // clear
      gctx.clearRect(0, 0, width, height);

      // subtle galaxy background gradient
      const g = gctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, 'rgba(6,8,15,1)');
      g.addColorStop(0.5, 'rgba(8,12,20,1)');
      g.addColorStop(1, 'rgba(2,4,8,1)');
      gctx.fillStyle = g;
      gctx.fillRect(0, 0, width, height);

      // draw stars
      for (const s of stars) {
        gctx.beginPath();
        gctx.fillStyle = `rgba(255,255,255,${s.alpha * 0.9})`;
        gctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        gctx.fill();
      }

      // draw a normal star with very strong glow/bloom
      const rot = now * 0.0002;
      const s = star.size;

      gctx.save();
      gctx.globalCompositeOperation = 'lighter';

      // large bloom halo
      const bloom = gctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, s * 3.2);
      bloom.addColorStop(0, 'rgba(255,250,235,0.9)');
      bloom.addColorStop(0.16, 'rgba(255,232,190,0.58)');
      bloom.addColorStop(0.35, 'rgba(255,198,126,0.28)');
      bloom.addColorStop(0.7, 'rgba(255,150,82,0.08)');
      bloom.addColorStop(1, 'rgba(0,0,0,0)');
      gctx.fillStyle = bloom;
      gctx.beginPath();
      gctx.arc(star.x, star.y, s * 3.2, 0, Math.PI * 2);
      gctx.fill();

      // bright corona ring
      const corona = gctx.createRadialGradient(star.x, star.y, s * 0.18, star.x, star.y, s * 1.5);
      corona.addColorStop(0, 'rgba(255,255,255,0.95)');
      corona.addColorStop(0.2, 'rgba(255,244,220,0.8)');
      corona.addColorStop(0.55, 'rgba(255,213,146,0.28)');
      corona.addColorStop(1, 'rgba(255,180,110,0)');
      gctx.fillStyle = corona;
      gctx.beginPath();
      gctx.arc(star.x, star.y, s * 1.5, 0, Math.PI * 2);
      gctx.fill();

      // hot core disc
      const core = gctx.createRadialGradient(
        star.x - s * 0.1,
        star.y - s * 0.12,
        s * 0.04,
        star.x,
        star.y,
        s * 0.62,
      );
      core.addColorStop(0, 'rgba(255,255,255,1)');
      core.addColorStop(0.28, 'rgba(255,246,230,1)');
      core.addColorStop(0.62, 'rgba(255,224,170,0.96)');
      core.addColorStop(1, 'rgba(255,183,112,0.92)');
      gctx.fillStyle = core;
      gctx.beginPath();
      gctx.arc(star.x, star.y, s * 0.62, 0, Math.PI * 2);
      gctx.fill();

      // subtle rotating surface motion, but not spherical
      gctx.save();
      gctx.translate(star.x, star.y);
      gctx.rotate(rot);
      const streakGrad = gctx.createLinearGradient(-s * 0.75, 0, s * 0.75, 0);
      streakGrad.addColorStop(0, 'rgba(255,255,255,0)');
      streakGrad.addColorStop(0.35, 'rgba(255,255,255,0.1)');
      streakGrad.addColorStop(0.5, 'rgba(255,240,210,0.22)');
      streakGrad.addColorStop(0.65, 'rgba(255,255,255,0.1)');
      streakGrad.addColorStop(1, 'rgba(255,255,255,0)');
      gctx.fillStyle = streakGrad;
      gctx.fillRect(-s * 0.9, -s * 0.1, s * 1.8, s * 0.2);
      gctx.restore();

      // soft glare overlay for extra bloom
      const glare = gctx.createRadialGradient(star.x, star.y, s * 0.15, star.x, star.y, s * 2.2);
      glare.addColorStop(0, 'rgba(255,255,255,0.28)');
      glare.addColorStop(0.45, 'rgba(255,245,220,0.16)');
      glare.addColorStop(1, 'rgba(255,220,160,0)');
      gctx.fillStyle = glare;
      gctx.beginPath();
      gctx.arc(star.x, star.y, s * 2.2, 0, Math.PI * 2);
      gctx.fill();

      gctx.restore();

      // draw orbiting planets as circular discs with texture clipped
      for (let i = 0; i < planetInstances.length; i++) {
        const p = planetInstances[i];
        p.angle += p.angularSpeed * dt;
        const px = star.x + Math.cos(p.angle) * p.orbitR;
        const py = star.y + Math.sin(p.angle) * p.orbitR * (0.86 + p.tilt * 0.12);

        gctx.save();
        // circular mask
        gctx.beginPath();
        gctx.arc(px, py, p.size / 2, 0, Math.PI * 2);
        gctx.closePath();
        gctx.clip();

        const img = p.img;
        if (img && img.complete && img.width > 0 && img.height > 0) {
          gctx.drawImage(img, px - p.size / 2, py - p.size / 2, p.size, p.size);
        } else {
          gctx.fillStyle = 'rgba(140,150,180,0.12)';
          gctx.beginPath();
          gctx.arc(px, py, p.size / 2, 0, Math.PI * 2);
          gctx.fill();
        }

        // lighting: compute direction from planet to star
        const lx = star.x - px;
        const ly = star.y - py;
        const dist = Math.max(1, Math.sqrt(lx * lx + ly * ly));
        const nx = lx / dist;
        const ny = ly / dist;

        // night-side shadow using linear gradient along light vector
        const gradStartX = px - nx * (p.size * 0.5);
        const gradStartY = py - ny * (p.size * 0.5);
        const gradEndX = px + nx * (p.size * 0.5);
        const gradEndY = py + ny * (p.size * 0.5);
        const nightGrad = gctx.createLinearGradient(gradStartX, gradStartY, gradEndX, gradEndY);
        nightGrad.addColorStop(0.0, 'rgba(0,0,0,0.5)');
        nightGrad.addColorStop(0.5, 'rgba(0,0,0,0.08)');
        nightGrad.addColorStop(1.0, 'rgba(0,0,0,0.0)');
        gctx.globalCompositeOperation = 'multiply';
        gctx.fillStyle = nightGrad;
        gctx.beginPath();
        gctx.arc(px, py, p.size / 2, 0, Math.PI * 2);
        gctx.fill();

        // specular highlight (small bright spot toward the star)
        const hx = px + nx * (p.size * 0.22);
        const hy = py + ny * (p.size * 0.22);
        const specR = Math.max(2, p.size * 0.06);
        gctx.globalCompositeOperation = 'lighter';
        const spg = gctx.createRadialGradient(hx, hy, 0, hx, hy, specR * 3);
        spg.addColorStop(0, 'rgba(255,255,245,0.95)');
        spg.addColorStop(0.35, 'rgba(255,240,200,0.35)');
        spg.addColorStop(1, 'rgba(255,200,140,0)');
        gctx.fillStyle = spg;
        gctx.beginPath();
        gctx.arc(hx, hy, specR * 3, 0, Math.PI * 2);
        gctx.fill();

        // subtle rim (darken outer edge)
        gctx.globalCompositeOperation = 'source-over';
        const rim = gctx.createRadialGradient(px, py, p.size * 0.45, px, py, p.size * 0.52);
        rim.addColorStop(0, 'rgba(0,0,0,0)');
        rim.addColorStop(1, 'rgba(0,0,0,0.22)');
        gctx.fillStyle = rim;
        gctx.beginPath();
        gctx.arc(px, py, p.size / 2, 0, Math.PI * 2);
        gctx.fill();

        gctx.restore();
      }

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);

    function onResize() {
      width = c.clientWidth || window.innerWidth;
      height = c.clientHeight || window.innerHeight;
      c.width = width * devicePixelRatio;
      c.height = height * devicePixelRatio;
      gctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }

    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    const canvas = modelCanvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    onLoadProgress?.(0.1, 'Creating auth background scene');

    const engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      alpha: true,
      antialias: true,
    });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0, 0, 0, 0);
    onLoadProgress?.(0.18, 'Setting up cameras and lighting');

    const camera = new ArcRotateCamera(
      'authModelCamera',
      -Math.PI / 2.2,
      Math.PI / 2.45,
      62,
      new Vector3(-10.0, -3.0, 0),
      scene,
    );
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 24;
    camera.upperRadiusLimit = 120;
    camera.wheelPrecision = 300;
    camera.panningSensibility = 0;
    camera.inputs.clear();

    const hemi = new HemisphericLight('authHemi', new Vector3(0, 1, 0), scene);
    hemi.intensity = 1.05;
    hemi.diffuse = new Color3(0.95, 0.98, 1.0);
    hemi.groundColor = new Color3(0.12, 0.14, 0.18);

    const rim = new PointLight('authRim', new Vector3(5, 4, -6), scene);
    rim.intensity = 1.3;
    rim.diffuse = new Color3(0.8, 0.92, 1.0);

    const glow = new GlowLayer('authGlow', scene, {
      mainTextureFixedSize: 256,
      blurKernelSize: 16,
    });
    glow.intensity = 0.2;

    const root = new TransformNode('authModelRoot', scene);
    root.position = new Vector3(-15.8, -3.0, 0);
    root.rotation.y = 0.45;
    const clusterScale = 0.24;
    const clusterScaleInv = 1 / clusterScale;
    root.scaling.setAll(clusterScale);

    const shipPositions = [
      new Vector3(-14.2, -1.25, -0.2),
    ];

    const computeMeshBounds = (meshes: Mesh[]) => {
      const min = new Vector3(
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
      );
      const max = new Vector3(
        Number.NEGATIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      );

      for (const mesh of meshes) {
        mesh.computeWorldMatrix(true);
        const corners = mesh.getBoundingInfo().boundingBox.vectorsWorld;
        for (const corner of corners) {
          min.minimizeInPlace(corner);
          max.maximizeInPlace(corner);
        }
      }

      if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) {
        return {
          min: new Vector3(-1, -1, -1),
          max: new Vector3(1, 1, 1),
          center: Vector3.Zero(),
        };
      }
      return {
        min,
        max,
        center: min.add(max).scale(0.5),
      };
    };
    const trimShipVertexData = (mesh: Mesh) => {
      const allowedKinds = new Set(['position', 'normal', 'uv']);
      const kinds = mesh.getVerticesDataKinds();
      for (const kind of kinds) {
        if (!allowedKinds.has(kind)) {
          mesh.removeVerticesData(kind);
        }
      }
    };

    const shipRoots: TransformNode[] = [];
    const shipAnimationState: {
      root: TransformNode;
      basePosition: Vector3;
      phase: number;
      thrusterMaterial: StandardMaterial;
      trailMaterial: StandardMaterial;
      glowMeshes: Mesh[];
      trailMeshes: Mesh[];
    }[] = [];
    const shipMaterials: StandardMaterial[] = [];
    const faceShipAtFleet = (ship: TransformNode, target: Vector3) => {
      const dir = target.subtract(ship.position);
      dir.y = 0;
      dir.normalize();
      const yaw = Math.atan2(dir.x, dir.z);
      ship.rotation = new Vector3(
        AUTH_SHIP_MODEL.modelPitch ?? 0,
        yaw + (AUTH_SHIP_MODEL.modelYawOffset ?? 0),
        AUTH_SHIP_MODEL.modelRoll ?? 0,
      );
    };

    const fleetRoot = new TransformNode('authFleetRoot', scene);
    fleetRoot.parent = root;
    onLoadProgress?.(0.35, 'Importing fleet models');
    fleetRoot.position = new Vector3(-7.0, 32.8, 2.4);
    const fleetBaseY = fleetRoot.position.y;

    const fleetPromise = Promise.all(
      AUTH_FLEET_MODELS.map((entry, index) => SceneLoader.ImportMeshAsync('', entry.definition.modelPath, entry.definition.modelFile, scene)
        .then((result) => ({ result, entry, index }))
        .catch((error) => ({ error, entry, index }))),
    ).then((results) => {
      results.forEach((loaded) => {
        if ('error' in loaded) {
          console.warn('[AuthFleet] Failed to load GLB, using fallback.', loaded.error);
          const fallback = MeshBuilder.CreateBox(`authFleetFallback_${loaded.index}`, { width: 2.2, height: 0.42, depth: 0.88 }, scene);
          fallback.parent = fleetRoot;
          fallback.position = loaded.entry.position.clone();
          fallback.rotation.y = loaded.entry.rotation;
          fallback.scaling.setAll(0.8 + loaded.index * 0.12);
          const mat = new StandardMaterial(`authFleetFallbackMat_${loaded.index}`, scene);
          mat.diffuseColor = new Color3(0.52, 0.6, 0.72);
          mat.emissiveColor = new Color3(0.2, 0.28, 0.36);
          mat.specularColor = new Color3(0.82, 0.88, 0.96);
          fallback.material = mat;
          return;
        }

        const { result, entry, index } = loaded;
        const meshes = result.meshes.filter((mesh): mesh is Mesh => typeof mesh.getTotalVertices === 'function' && mesh.getTotalVertices() > 0);
        if (meshes.length === 0) {
          console.warn('[AuthFleet] No renderable meshes found in GLB');
          return;
        }

        const bounds = computeMeshBounds(meshes);
        const maxDimension = Math.max(
          0.001,
          bounds.max.x - bounds.min.x,
          bounds.max.y - bounds.min.y,
          bounds.max.z - bounds.min.z,
        );
        const targetSize = index === 0 ? 12 : index === 1 ? 10 : 9;
        const sizeScale = entry.scaleBoost;
        const modelScale = (targetSize / maxDimension) * clusterScaleInv * sizeScale;

        const assetRoot = new TransformNode(`authFleetAssetRoot_${index}`, scene);
        assetRoot.parent = fleetRoot;
        assetRoot.rotation.y = entry.rotation;
        assetRoot.position = entry.position.clone();
        assetRoot.position.subtractInPlace(bounds.center);

        const fallbackMat = new StandardMaterial(`authFleetFallbackMat_${index}`, scene);
        fallbackMat.emissiveColor = new Color3(0.22, 0.3, 0.42);
        fallbackMat.diffuseColor = new Color3(0.52, 0.6, 0.72);
        fallbackMat.specularColor = new Color3(0.82, 0.88, 0.96);

        for (const mesh of meshes) {
          trimShipVertexData(mesh);
          mesh.parent = assetRoot;
          mesh.isPickable = false;
          mesh.alwaysSelectAsActiveMesh = true;
          const mat = (mesh.material as StandardMaterial | null) ?? fallbackMat;
          mat.diffuseColor = new Color3(0.54, 0.62, 0.74);
          mat.emissiveColor = new Color3(0.18, 0.26, 0.34);
          mat.specularColor = new Color3(0.9, 0.94, 1.0);
          mat.disableLighting = false;
          mesh.material = mat;
          mesh.isVisible = true;
          glow.addIncludedOnlyMesh(mesh);
        }

        assetRoot.scaling.setAll(modelScale * 0.72);

        const shipLight = new PointLight(`authFleetLight_${index}`, new Vector3(0, 6, -8), scene);
        shipLight.parent = assetRoot;
        shipLight.intensity = 1.35;
        shipLight.range = 28;
        shipLight.diffuse = new Color3(0.78, 0.92, 1.0);
        shipLight.specular = new Color3(0.95, 0.97, 1.0);
      });
    });

    onLoadProgress?.(0.65, 'Importing ship model');

    const shipPromise = SceneLoader.ImportMeshAsync('', AUTH_SHIP_MODEL.modelPath, AUTH_SHIP_MODEL.modelFile, scene)
      .then((result) => {
        const meshes = result.meshes.filter((mesh): mesh is Mesh => typeof mesh.getTotalVertices === 'function' && mesh.getTotalVertices() > 0);
        if (meshes.length === 0) throw new Error('No fighter meshes loaded');

        const shipBounds = computeMeshBounds(meshes);
        const shipSize = shipBounds.max.subtract(shipBounds.min);
        const meshBounds = meshes[0].getBoundingInfo().boundingBox.extendSize.clone();
        const shipSizeScale = 0.55;
        const baseScale = (0.004 / Math.max(meshBounds.x, meshBounds.y, meshBounds.z, 1)) * clusterScaleInv * shipSizeScale;

        for (let i = 0; i < shipPositions.length; i++) {
          const shipRoot = new TransformNode(`authShipRoot_${i}`, scene);
          shipRoot.parent = root;
          shipRoot.position = shipPositions[i].clone();
          shipRoot.scaling.setAll(baseScale * 0.74 * (0.88 + i * 0.015));
          faceShipAtFleet(shipRoot, fleetRoot.position);
          shipRoots.push(shipRoot);

          for (const mesh of meshes) {
            const clone = mesh.clone(`authShip_${i}_${mesh.name}`, shipRoot);
            if (clone) {
              clone.isVisible = false;
              clone.parent = shipRoot;
              clone.isPickable = false;
            }
          }

          const engineX = shipBounds.min.x - shipSize.x * 0.035;
          const zOffset = Math.max(0.45, shipSize.z * 0.22);
          const glowDiameter = Math.max(0.18, Math.max(shipSize.x, shipSize.z) * 0.05);
          const trailLength = Math.max(0.8, shipSize.x * 0.34);
          const trailDiameter = Math.max(0.12, glowDiameter * 1.25);

          const thrusterMat = new StandardMaterial(`authShipThrusterMat_${i}`, scene);
          thrusterMat.diffuseColor = Color3.Black();
          thrusterMat.specularColor = Color3.Black();
          thrusterMat.emissiveColor = new Color3(0.32, 0.72, 1.0).scale(2.2);
          thrusterMat.disableLighting = true;
          thrusterMat.alpha = 0.82;

          const trailMat = new StandardMaterial(`authShipTrailMat_${i}`, scene);
          trailMat.diffuseColor = Color3.Black();
          trailMat.specularColor = Color3.Black();
          trailMat.emissiveColor = new Color3(0.24, 0.62, 1.0).scale(1.8);
          trailMat.disableLighting = true;
          trailMat.alpha = 0.34;
          trailMat.backFaceCulling = false;

          const glowMeshes: Mesh[] = [];
          const trailMeshes: Mesh[] = [];

          for (const z of [-zOffset, zOffset]) {
            const glowMesh = MeshBuilder.CreateSphere(
              `authShipThrusterGlow_${i}_${z}`,
              { diameter: glowDiameter, segments: 16 },
              scene,
            );
            glowMesh.parent = shipRoot;
            glowMesh.position.set(engineX, shipBounds.center.y, shipBounds.center.z + z);
            glowMesh.material = thrusterMat;
            glowMesh.isPickable = false;
            glow.addIncludedOnlyMesh(glowMesh);
            glowMeshes.push(glowMesh);

            const trailMesh = MeshBuilder.CreateCylinder(
              `authShipThrusterTrail_${i}_${z}`,
              {
                height: trailLength,
                diameterTop: trailDiameter * 0.15,
                diameterBottom: trailDiameter,
                tessellation: 18,
              },
              scene,
            );
            trailMesh.parent = shipRoot;
            trailMesh.position.set(engineX - trailLength * 0.56, shipBounds.center.y, shipBounds.center.z + z);
            trailMesh.rotation.z = Math.PI / 2;
            trailMesh.material = trailMat;
            trailMesh.isPickable = false;
            glow.addIncludedOnlyMesh(trailMesh);
            trailMeshes.push(trailMesh);
          }

          shipAnimationState.push({
            root: shipRoot,
            basePosition: shipPositions[i].clone(),
            phase: i * 1.7,
            thrusterMaterial: thrusterMat,
            trailMaterial: trailMat,
            glowMeshes,
            trailMeshes,
          });
        }

        const shipMat = new StandardMaterial('authShipMat', scene);
        shipMat.diffuseColor = new Color3(0.84, 0.88, 0.92);
        shipMat.emissiveColor = new Color3(0.14, 0.18, 0.24);
        shipMat.specularColor = new Color3(0.48, 0.54, 0.62);
        shipMaterials.push(shipMat);

        for (const shipRoot of shipRoots) {
          shipRoot.getChildMeshes().forEach((mesh) => {
            mesh.material = shipMat;
            mesh.isVisible = true;
          });
        }
      })
      .catch(() => {
        for (let i = 0; i < shipPositions.length; i++) {
          const shipRoot = new TransformNode(`authShipFallbackRoot_${i}`, scene);
          shipRoot.parent = root;
          shipRoot.position = shipPositions[i].clone();
          shipRoot.scaling.setAll(0.009);
          faceShipAtFleet(shipRoot, fleetRoot.position);
          shipRoots.push(shipRoot);

          const body = MeshBuilder.CreateBox(`authShipFallbackBody_${i}`, { width: 2.4, height: 0.34, depth: 0.8 }, scene);
          body.parent = shipRoot;
          const wing = MeshBuilder.CreateBox(`authShipFallbackWing_${i}`, { width: 1.0, height: 0.08, depth: 1.7 }, scene);
          wing.parent = shipRoot;
          wing.position.y = -0.05;

          const mat = new StandardMaterial(`authShipFallbackMat_${i}`, scene);
          mat.diffuseColor = new Color3(0.82, 0.86, 0.92);
          mat.emissiveColor = new Color3(0.1, 0.14, 0.18);
          body.material = mat;
          wing.material = mat;

          const thrusterMat = new StandardMaterial(`authShipFallbackThrusterMat_${i}`, scene);
          thrusterMat.diffuseColor = Color3.Black();
          thrusterMat.specularColor = Color3.Black();
          thrusterMat.emissiveColor = new Color3(0.32, 0.72, 1.0).scale(2.2);
          thrusterMat.disableLighting = true;
          thrusterMat.alpha = 0.82;

          const trailMat = new StandardMaterial(`authShipFallbackTrailMat_${i}`, scene);
          trailMat.diffuseColor = Color3.Black();
          trailMat.specularColor = Color3.Black();
          trailMat.emissiveColor = new Color3(0.24, 0.62, 1.0).scale(1.8);
          trailMat.disableLighting = true;
          trailMat.alpha = 0.34;
          trailMat.backFaceCulling = false;

          const glowMesh = MeshBuilder.CreateSphere(`authShipFallbackThrusterGlow_${i}`, { diameter: 0.24, segments: 16 }, scene);
          glowMesh.parent = shipRoot;
          glowMesh.position.set(-1.35, 0, 0);
          glowMesh.material = thrusterMat;
          glowMesh.isPickable = false;
          glow.addIncludedOnlyMesh(glowMesh);

          const trailMesh = MeshBuilder.CreateCylinder(
            `authShipFallbackThrusterTrail_${i}`,
            { height: 1.1, diameterTop: 0.03, diameterBottom: 0.26, tessellation: 18 },
            scene,
          );
          trailMesh.parent = shipRoot;
          trailMesh.position.set(-1.92, 0, 0);
          trailMesh.rotation.z = Math.PI / 2;
          trailMesh.material = trailMat;
          trailMesh.isPickable = false;
          glow.addIncludedOnlyMesh(trailMesh);

          shipAnimationState.push({
            root: shipRoot,
            basePosition: shipPositions[i].clone(),
            phase: i * 1.7,
            thrusterMaterial: thrusterMat,
            trailMaterial: trailMat,
            glowMeshes: [glowMesh],
            trailMeshes: [trailMesh],
          });
        }
      });


    const animate = () => {
      const dt = engine.getDeltaTime() / 1000;
      const rotAmount = dt * 0.035;
      const shipTurnAmount = dt * 0.09;
      const elapsed = performance.now() * 0.001;
      
      fleetRoot.rotate(Axis.Y, rotAmount, Space.LOCAL);
      fleetRoot.position.y = fleetBaseY;

      for (const ship of shipAnimationState) {
        const motion = elapsed + ship.phase;
        ship.root.position.x = ship.basePosition.x + Math.sin(motion * 0.46) * 0.28;
        ship.root.position.y = ship.basePosition.y + Math.sin(motion * 0.82) * 0.09;
        ship.root.position.z = ship.basePosition.z + Math.cos(motion * 0.52) * 0.18;
        ship.root.rotate(Axis.Y, shipTurnAmount, Space.LOCAL);
        ship.root.rotate(Axis.Z, Math.sin(motion * 0.7) * dt * 0.06, Space.LOCAL);

        const thrusterPulse = 0.65 + 0.35 * Math.sin(motion * 5.8);
        ship.thrusterMaterial.alpha = 0.45 + thrusterPulse * 0.45;
        ship.trailMaterial.alpha = 0.18 + thrusterPulse * 0.28;

        for (const glowMesh of ship.glowMeshes) {
          glowMesh.scaling.setAll(1.55 + thrusterPulse * 0.95);
        }

        for (const trailMesh of ship.trailMeshes) {
          trailMesh.scaling.x = 1;
          trailMesh.scaling.y = 1 + thrusterPulse * 0.34;
          trailMesh.scaling.z = 1;
        }
      }

      scene.render();
    };

    engine.runRenderLoop(animate);
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    void Promise.all([fleetPromise, shipPromise]).then(() => {
      if (!cancelled) {
        onLoadProgress?.(1, 'Login background is ready');
        onReady?.();
      }
      scene.executeWhenReady(() => engine.resize());
    });

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      scene.dispose();
      engine.dispose();
    };
  }, [onLoadProgress, onReady]);

  return (
    <>
      <canvas id="authBgCanvas" ref={canvasRef} />
      <canvas id="authModelCanvas" ref={modelCanvasRef} />
    </>
  );
}
