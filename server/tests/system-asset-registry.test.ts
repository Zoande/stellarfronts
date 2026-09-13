import assert from "node:assert/strict";
import test from "node:test";
import {
  MeshBuilder,
  NullEngine,
  Scene,
  SceneLoader,
} from "@babylonjs/core";
import { SystemAssetRegistry } from "../../src/scenes/system/SystemAssetRegistry";

test("system asset registry imports one source for differently-scaled templates", async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const registry = new SystemAssetRegistry(scene);
  const originalImportMeshAsync = SceneLoader.ImportMeshAsync;
  let importCount = 0;

  SceneLoader.ImportMeshAsync = (async () => {
    importCount += 1;
    const mesh = MeshBuilder.CreateBox(`cached-source-${importCount}`, { size: 1 }, scene);
    return {
      meshes: [mesh],
      particleSystems: [],
      skeletons: [],
      animationGroups: [],
      transformNodes: [],
      geometries: [],
      lights: [],
      spriteManagers: [],
    };
  }) as unknown as typeof SceneLoader.ImportMeshAsync;

  try {
    const [systemInstance, tacticalInstance] = await Promise.all([
      registry.instantiate({
        key: "playerShip:constructionShip",
        rootUrl: "/ships/construction_ship/",
        fileName: "model.glb",
        targetSize: 1.02,
      }, "system-instance"),
      registry.instantiate({
        key: "tacticalShip:constructionShip",
        rootUrl: "/ships/construction_ship/",
        fileName: "model.glb",
        targetSize: 0.82,
      }, "tactical-instance"),
    ]);

    assert.equal(importCount, 1);
    assert.ok(systemInstance);
    assert.ok(tacticalInstance);
    assert.ok(Math.abs(systemInstance.scaling.x - 1.02) < 1e-6);
    assert.ok(Math.abs(tacticalInstance.scaling.x - 0.82) < 1e-6);
  } finally {
    SceneLoader.ImportMeshAsync = originalImportMeshAsync;
    registry.dispose();
    scene.dispose();
    engine.dispose();
  }
});
