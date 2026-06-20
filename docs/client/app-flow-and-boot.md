# App Flow & Boot

How the client goes from page load to a running 3D game.

## Entry & routing

[`src/index.tsx`](../../src/index.tsx) mounts [`src/App.tsx`](../../src/App.tsx), which routes by
pathname:

- `/` — login/signup ([`src/pages/LoginPage.tsx`](../../src/pages/LoginPage.tsx),
  [`SignupPage.tsx`](../../src/pages/SignupPage.tsx)).
- `/home` — game catalog and account summary ([`src/pages/HomePage.tsx`](../../src/pages/HomePage.tsx)).
- `/game/:gameId` — the BabylonJS command view ([`src/pages/GamePage.tsx`](../../src/pages/GamePage.tsx)).
- `/dev` — developer panel ([`src/pages/DevPage.tsx`](../../src/pages/DevPage.tsx),
  [`DevVersionPanel.tsx`](../../src/pages/DevVersionPanel.tsx)).
- `/news`, plus `EmailVerificationPage`/`SuccessPage` shells.

## `useAppFlow`

[`src/hooks/useAppFlow.ts`](../../src/hooks/useAppFlow.ts) is the app-flow state machine: it checks the
session (via [`src/auth/client.ts`](../../src/auth/client.ts)), drives loading screens and the
login→home transition, and coordinates asset warm-up. Auth assets are preloaded in
[`src/utils/preloadAuthAssets.ts`](../../src/utils/preloadAuthAssets.ts); the procedural login
backdrop is [`src/components/BackgroundScene.tsx`](../../src/components/BackgroundScene.tsx).

## In-game boot

Opening a game runs [`src/game/boot.ts`](../../src/game/boot.ts), which:

1. **Connects** a `GameServerClient` ([`src/game/GameServerClient.ts`](../../src/game/GameServerClient.ts))
   over WebSocket and awaits the first `snapshot`. It checks `protocolVersion` against
   `SUPPORTED_SERVER_PROTOCOL_VERSIONS` and refuses an unsupported server.
2. **Initializes the engine** via [`src/SceneManager.ts`](../../src/SceneManager.ts) (WebGPU with a
   WebGL2 fallback) and starts the render loop.
3. **Starts in GalaxyScene** ([`src/scenes/GalaxyScene.ts`](../../src/scenes/GalaxyScene.ts)); clicking
   a star opens **SystemScene** ([`src/scenes/SystemScene.ts`](../../src/scenes/SystemScene.ts)).
4. **Builds the HUD and panels** ([`src/ui/HudOverlay.ts`](../../src/ui/HudOverlay.ts) plus the
   `src/ui/*Panel.ts` family and `EventModal`/`SituationModal`), wiring each panel's data subscription
   and command callbacks.
5. **Returns a cleanup function** that disposes the scene manager, panels, and subscriptions.

## How to extend / rules

- New pages are React under `src/pages/` and a route in `src/App.tsx`.
- New in-game UI/scene wiring is registered in `src/game/boot.ts` (it's the composition root for the
  game view).
- Keep React out of the in-game view; use the DOM-panel pattern instead (see
  [ui-panels.md](ui-panels.md)).

## Key files

- Entry/routing: [`src/index.tsx`](../../src/index.tsx), [`src/App.tsx`](../../src/App.tsx).
- Flow: [`src/hooks/useAppFlow.ts`](../../src/hooks/useAppFlow.ts).
- Boot: [`src/game/boot.ts`](../../src/game/boot.ts), [`src/SceneManager.ts`](../../src/SceneManager.ts).
- Auth client: [`src/auth/client.ts`](../../src/auth/client.ts).
