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
- `/news` and `/news/:slug` — public news list/article views.

`EmailVerificationPage` and `SuccessPage` exist as UI shells but are not part of the active route
switch.

## `useAppFlow`

[`src/hooks/useAppFlow.ts`](../../src/hooks/useAppFlow.ts) is the app-flow state machine: it checks the
session (via [`src/auth/client.ts`](../../src/auth/client.ts)), drives loading screens and the
login→home transition, and coordinates asset warm-up. Auth assets are preloaded in
[`src/utils/preloadAuthAssets.ts`](../../src/utils/preloadAuthAssets.ts); the procedural login
backdrop is [`src/components/BackgroundScene.tsx`](../../src/components/BackgroundScene.tsx).
Routes and the backdrop are code-split. The authentication backdrop intentionally uses BabylonJS
and authored ship models, so its larger renderer/model chunk loads when the login experience starts.

## In-game boot

Opening a game runs [`src/game/boot.ts`](../../src/game/boot.ts), which:

1. **Loads account resources and connects** a `GameServerClient`
   ([`src/game/GameServerClient.ts`](../../src/game/GameServerClient.ts)) over WebSocket, awaiting the
   first `snapshot`. It checks `protocolVersion` against `SUPPORTED_SERVER_PROTOCOL_VERSIONS` and
   refuses an unsupported server. Account-resource events keep Dark Matter synchronized afterward.
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
