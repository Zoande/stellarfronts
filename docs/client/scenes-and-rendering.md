# Scenes & Rendering

The in-game 3D view is BabylonJS. There are two scenes (galaxy and system) plus reusable rendering
subsystems. The engine and render loop are owned by
[`src/SceneManager.ts`](../../src/SceneManager.ts).

## SceneManager

[`src/SceneManager.ts`](../../src/SceneManager.ts) initializes the engine (WebGPU, falling back to
WebGL2), holds the active scene, runs the render loop (calling the scene's `onBeforeRender` then
`scene.render`), and handles resize. Scenes implement a small `IGameScene` interface
(`scene`, `setup`, `onBeforeRender`, `dispose`).

## GalaxyScene

[`src/scenes/GalaxyScene.ts`](../../src/scenes/GalaxyScene.ts) — the galaxy map: stars, hyperlanes,
faction ownership overlay, and fleet/starbase icons, with camera controls; clicking a star opens the
system view. It composes these subsystems from [`src/systems/`](../../src/systems/):

- [`StarFieldRenderer.ts`](../../src/systems/StarFieldRenderer.ts) — star sprites (halo + core),
  type-based coloring, highlighting.
- [`CameraController.ts`](../../src/systems/CameraController.ts) — WASD pan, scroll zoom, orbit, with
  galaxy-bounds clamping (limits from [`src/data/GalaxyMap.ts`](../../src/data/GalaxyMap.ts)).
- [`OwnershipOverlayRenderer.ts`](../../src/systems/OwnershipOverlayRenderer.ts) — faction territory
  from `starOwnership`.
- [`OrbitSystem.ts`](../../src/systems/OrbitSystem.ts) — orbital positioning math.

## SystemScene

[`src/scenes/SystemScene.ts`](../../src/scenes/SystemScene.ts) — a single system in detail: planets,
starbases, the star, lane exits, and 3D fleet movement/combat. Its helpers live in
[`src/scenes/system/`](../../src/scenes/system/):

- `SystemObjectRenderer.ts` — loads GLB models (planets, starbases, ships), orbit paths.
- `SystemLabelOverlay.ts` — DOM labels projected from 3D to screen.
- `SystemEffectsRenderer.ts` — combat/stellar particle effects.
- `SystemInputController.ts` — click-to-move, selection, context menus.
- `SystemActionTargetRenderer.ts` — move/attack/orbit target indicators.
- `SystemAssetRegistry.ts` — model/material caching.
- `SystemViewStore.ts` — local view state (selection, targets, toggles).

Shared pointer/menu helpers are in [`src/scenes/shared/`](../../src/scenes/shared/)
(`ContextActionMenu`, `PointerTarget`, `pointerMath`).

## Data flow

Scenes read the latest server state through the `GameServerClient` (snapshot + merged updates; see
[server-client-and-details.md](server-client-and-details.md)) and re-render in `onBeforeRender`,
interpolating fleet positions between updates. Effects (weapon hits, explosions) are **visual only** —
combat is resolved server-side ([combat.md](../systems/combat.md)).

## How to extend / rules

- Add galaxy-scale visuals as a subsystem in [`src/systems/`](../../src/systems/) and compose it in
  GalaxyScene; add system-scale visuals under [`src/scenes/system/`](../../src/scenes/system/).
- Drive everything from server state; the client never invents authoritative positions/outcomes
  (interpolation/preview is fine).
- Reuse `SystemAssetRegistry` for model/material caching rather than loading assets ad hoc.

## Key files

- Engine: [`src/SceneManager.ts`](../../src/SceneManager.ts).
- Scenes: [`src/scenes/GalaxyScene.ts`](../../src/scenes/GalaxyScene.ts),
  [`src/scenes/SystemScene.ts`](../../src/scenes/SystemScene.ts).
- Subsystems: [`src/systems/`](../../src/systems/), [`src/scenes/system/`](../../src/scenes/system/).
- Skybox: [`src/utils/proceduralSpaceSkybox.ts`](../../src/utils/proceduralSpaceSkybox.ts).
