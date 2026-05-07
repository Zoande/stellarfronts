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
      '/textures/gas_giant.png',
      '/textures/rocky_planet.png',
      '/textures/ice_planet.png',
      '/textures/planets/Arid/Arid_01-1024x512.png'
    ];
    const planets: HTMLImageElement[] = [];
    planetSrcs.forEach((src) => {
      const img = new Image();
      img.src = src;
      planets.push(img);
    });

    // glow sprite for star
    const glow = new Image();
    glow.src = '/textures/star.glow.png';

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
      new Vector3(5.5, 1.0, 0),
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
    root.position = new Vector3(3.4, -0.25, 0);
    root.rotation.y = 0.45;
    const clusterScale = 0.24;
    const clusterScaleInv = 1 / clusterScale;
    root.scaling.setAll(clusterScale);

    const shipPositions = [
      new Vector3(3.0, 0.6, -0.2),
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

    const trimStarbaseVertexData = (mesh: Mesh) => {
      const allowedKinds = new Set(['position', 'normal', 'uv']);
      const kinds = mesh.getVerticesDataKinds();
      for (const kind of kinds) {
        if (!allowedKinds.has(kind)) {
          mesh.removeVerticesData(kind);
        }
      }
    };

    const shipRoots: TransformNode[] = [];
    const shipMaterials: StandardMaterial[] = [];
    const faceShipAtStarbase = (ship: TransformNode) => {
      const dir = starbaseRoot.position.subtract(ship.position);
      dir.y = 0;
      dir.normalize();
      const yaw = Math.atan2(dir.x, dir.z);
      ship.rotation = new Vector3(0, yaw, 0);
      ship.addRotation(0, Math.PI, 0);
      ship.addRotation(0, Math.PI / 2, 0);
      ship.addRotation(Math.PI / 2, 0, 0);
    };

    const starbaseRoot = new TransformNode('authStarbaseRoot', scene);
    starbaseRoot.parent = root;
    onLoadProgress?.(0.35, 'Importing starbase model');
    starbaseRoot.position = new Vector3(51.4, 60.2, 0.1);
    const starbaseBaseY = starbaseRoot.position.y;

    console.info('[AuthStarbase] Loading /starbase/star_trek_-_starbase_375.glb');
    const starbasePromise = SceneLoader.ImportMeshAsync('', '', '/starbase/star_trek_-_starbase_375.glb', scene)
      .then((result) => {
        console.info('[AuthStarbase] Raw meshes:', result.meshes.length);
        const meshes = result.meshes.filter((mesh): mesh is Mesh => typeof mesh.getTotalVertices === 'function' && mesh.getTotalVertices() > 0);
        console.info('[AuthStarbase] Renderable meshes:', meshes.length);
        if (meshes.length === 0) {
          console.warn('[AuthStarbase] No renderable meshes found in GLB');
          return;
        }
        const bounds = computeMeshBounds(meshes);
        const maxDimension = Math.max(
          0.001,
          bounds.max.x - bounds.min.x,
          bounds.max.y - bounds.min.y,
          bounds.max.z - bounds.min.z,
        );
        const starbaseTargetSize = 15;
        const starbaseSizeScale = 3.45;
        const starbaseScale = (starbaseTargetSize / maxDimension) * clusterScaleInv * starbaseSizeScale;
        console.info('[AuthStarbase] Bounds:', bounds);
        console.info('[AuthStarbase] Scale:', starbaseScale, 'Target size:', starbaseTargetSize, 'Cluster scale:', clusterScale);

        const assetRoot = new TransformNode('authStarbaseAssetRoot', scene);
        assetRoot.parent = starbaseRoot;
        assetRoot.rotation.y = Math.PI * 0.16;
        assetRoot.position = bounds.center.scale(-1);

        const fallbackMat = new StandardMaterial('authStarbaseFallbackMat', scene);
        fallbackMat.emissiveColor = new Color3(0.16, 0.2, 0.28);
        fallbackMat.diffuseColor = new Color3(0.18, 0.22, 0.28);
        fallbackMat.specularColor = new Color3(0.18, 0.2, 0.24);

        let missingMaterialCount = 0;
        let fallbackAssignedCount = 0;
        let texturedCount = 0;
        const materialClasses: Record<string, number> = {};

        for (const mesh of meshes) {
          trimStarbaseVertexData(mesh);
          mesh.parent = assetRoot;
          mesh.isPickable = false;
          mesh.alwaysSelectAsActiveMesh = true;
          const mat = mesh.material as StandardMaterial | null;
          if (!mat) {
            mesh.material = fallbackMat;
            fallbackAssignedCount += 1;
            missingMaterialCount += 1;
          } else {
            const className = typeof (mat as any).getClassName === 'function'
              ? (mat as any).getClassName()
              : (mat as any).constructor?.name || 'Unknown';
            materialClasses[className] = (materialClasses[className] || 0) + 1;
            const hasTexture = !!((mat as any).diffuseTexture || (mat as any).albedoTexture || (mat as any).emissiveTexture);
            if (hasTexture) texturedCount += 1;
          }
          mesh.isVisible = true;
          glow.addIncludedOnlyMesh(mesh);
        }

        console.info('[AuthStarbase] Missing materials:', missingMaterialCount);
        console.info('[AuthStarbase] Fallback materials assigned:', fallbackAssignedCount);
        console.info('[AuthStarbase] Textured materials:', texturedCount);
        console.info('[AuthStarbase] Material classes:', materialClasses);

        starbaseRoot.scaling.setAll(starbaseScale);
        console.info('[AuthStarbase] Final root scale:', starbaseScale);

        const starbaseLight = new PointLight('authStarbaseLight', new Vector3(0, 6, -10), scene);
        starbaseLight.parent = starbaseRoot;
        starbaseLight.intensity = 0.9;
        starbaseLight.range = 28;
        starbaseLight.diffuse = new Color3(0.58, 0.86, 1.0);
        starbaseLight.specular = new Color3(0.85, 0.92, 1.0);
      })
      .catch((err) => {
        console.warn('[AuthStarbase] Failed to load GLB, using fallback.', err);
        const fallback = MeshBuilder.CreateTorus('authStarbaseFallback', { diameter: 2.2, thickness: 0.38, tessellation: 28 }, scene);
        fallback.parent = starbaseRoot;
        const mat = new StandardMaterial('authStarbaseFallbackMat', scene);
        mat.diffuseColor = new Color3(0.18, 0.2, 0.24);
        mat.emissiveColor = new Color3(0.16, 0.18, 0.22);
        fallback.material = mat;
      });

    onLoadProgress?.(0.65, 'Importing fighter model');

    const shipPromise = SceneLoader.ImportMeshAsync('', '', '/ships/fighter_01/Fighter_01.obj', scene)
      .then((result) => {
        const meshes = result.meshes.filter((mesh): mesh is Mesh => typeof mesh.getTotalVertices === 'function' && mesh.getTotalVertices() > 0);
        if (meshes.length === 0) throw new Error('No fighter meshes loaded');

        const meshBounds = meshes[0].getBoundingInfo().boundingBox.extendSize.clone();
        const shipSizeScale = 0.55;
        const baseScale = (0.004 / Math.max(meshBounds.x, meshBounds.y, meshBounds.z, 1)) * clusterScaleInv * shipSizeScale;

        for (let i = 0; i < shipPositions.length; i++) {
          const shipRoot = new TransformNode(`authShipRoot_${i}`, scene);
          shipRoot.parent = root;
          shipRoot.position = shipPositions[i].clone();
          shipRoot.scaling.setAll(baseScale * (0.88 + i * 0.015));
          faceShipAtStarbase(shipRoot);
          shipRoots.push(shipRoot);

          for (const mesh of meshes) {
            const clone = mesh.clone(`authShip_${i}_${mesh.name}`, shipRoot);
            if (clone) {
              clone.isVisible = false;
              clone.parent = shipRoot;
              clone.isPickable = false;
            }
          }
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
          shipRoot.scaling.setAll(0.012);
          faceShipAtStarbase(shipRoot);
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
        }
      });


    const animate = () => {
      const dt = engine.getDeltaTime() / 1000;
      const rotAmount = dt * 0.035;
      
      starbaseRoot.rotate(Axis.Y, rotAmount, Space.LOCAL);
      starbaseRoot.position.y = starbaseBaseY;

      // Rotate each ship in place
      for (const shipRoot of shipRoots) {
        shipRoot.rotate(Axis.Y, rotAmount, Space.LOCAL);
      }

      scene.render();
    };

    engine.runRenderLoop(animate);
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    void Promise.all([starbasePromise, shipPromise]).then(() => {
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
