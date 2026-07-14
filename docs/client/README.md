# Client Engineering

The browser side: a React shell for login/home/dev, and a BabylonJS command view for the actual game
with DOM-overlay panels. Gameplay rules live in [`../systems/`](../systems/); this folder is about how
the client is wired.

## The docs

| Doc | Topic |
| --- | --- |
| [app-flow-and-boot.md](app-flow-and-boot.md) | Routing, `useAppFlow`, and the `boot.ts` in-game startup. |
| [scenes-and-rendering.md](scenes-and-rendering.md) | `SceneManager`, GalaxyScene/SystemScene, and the rendering subsystems. |
| [ui-panels.md](ui-panels.md) | The DOM overlay panel architecture and a catalog of panels. |
| [server-client-and-details.md](server-client-and-details.md) | `GameServerClient`: snapshots, updates, detail subscriptions, commands. |
| [flags.md](flags.md) | Procedural faction-flag generation. |

## Two UI worlds

1. **React** (`src/App.tsx`, `src/pages/`, `src/components/`) — everything *outside* a running game:
   login, home/game-select, dev panel, news, loading screens.
2. **Imperative DOM + BabylonJS** (`src/game/`, `src/scenes/`, `src/systems/`, `src/ui/`) — the
   in-game command view. The 3D scenes render the galaxy/system; the HUD and panels are plain HTML
   overlays (not React). This split is deliberate — don't reach for React inside the game view.

## Add-a-panel pattern (recap)

A panel is a class in `src/ui/` that builds its own DOM, is opened from `boot.ts` (often the HUD
sidebar), **subscribes** to a server detail scope for its data, sends `ClientCommand`s for actions,
and tears down its subscription on close. Full walkthrough: [ui-panels.md](ui-panels.md).

## Add-a-scene-element pattern (recap)

Render from the latest snapshot inside a scene's update loop (or a dedicated renderer in
`src/systems/` or `src/scenes/system/`), reading server state via the `GameServerClient`. Never
compute authoritative game state on the client — see
[`../must-read/04-backward-compatibility.md`](../must-read/04-backward-compatibility.md).
