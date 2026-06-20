# StellarFronts Prototype

StellarFronts is a browser-based space strategy prototype with a Vite/React client, a WebSocket game server, and a separate HTTP auth server. It is a mixed 2D/3D strategy app: the browser frontend handles login, game selection, and the command UI, while BabylonJS powers the in-game scene and asset rendering.

## At A Glance

- The core loop is join a game, claim or resume a country, explore the galaxy, expand with starbases and districts, and manage economy and research over time.
- The app uses a split client/server architecture: `src/` holds the React UI and shared gameplay data, while `server/` contains auth, state persistence, and real-time game simulation.
- The game supports multiple account types, including normal players, observers, and admins, with observer/admin access controlling how much of the map you can see. Admin debug commands are included in game.
- The command view uses BabylonJS, procedural skybox code, and loaded GLB ships/starbases to present the game world.
- Asset warm-up happens in `src/utils/preloadAuthAssets.ts`, while the main 3D scene work lives in `src/components/BackgroundScene.tsx`, `src/ui/FleetManagerPanel.ts`, and `src/utils/proceduralSpaceSkybox.ts`.
- The project is built around logistics, expansion, economy, research, market trading, and system control rather than only direct combat. All systems and balance are still a work in progress

## Quick Start

1. Install dependencies with `npm install`.
2. Start the full local stack with `npm run dev:all`.
3. Open `http://localhost:5173`.

The local stack is:

- Client: `http://localhost:5173`
- Auth server: `http://localhost:8788`
- Game server: `ws://localhost:8787`

## Scripts

- `npm run dev` starts the Vite client only.
- `npm run server:dev` starts the WebSocket game server.
- `npm run auth:dev` starts the HTTP auth server.
- `npm run dev:all` starts client, auth, and game servers together.
- `npm run orchestrator:dev` starts the orchestrator that hosts games across code versions.
- `npm run control` is the command-line client for the orchestrator (versions and game lifecycle).
- `npm run server:test` runs the server test suite.
- `npm run server:typecheck` type-checks the server and shared TypeScript files.
- `npm run build` runs the production TypeScript and Vite builds.
- `npm run preview` previews the built client.

## What The App Does

The app is split into pathname-driven flows in `src/App.tsx`:

- `/` shows the login/signup experience.
- `/home` shows the game catalog and account summary.
- `/game/:gameId` boots the BabylonJS command view for a specific game.
- `/dev` opens the developer panel.

The client uses React 19, Vite, React Router, and BabylonJS 7. The space backdrop is procedural rather than image-only, and the command view mixes 3D scenes with HUD-style overlays.

## Authentication And Accounts

Authentication lives in `server/auth-server.ts` and `server/auth-store.ts`.

- Accounts are stored in SQLite at `server/state/auth.sqlite`.
- Sessions use the HttpOnly cookie `sf_session`.
- Passwords are hashed with PBKDF2.
- The auth server exposes login, signup, logout, `me`, game listing, game join, and dev-panel endpoints.
- Google and Microsoft OAuth endpoints exist, but they return `501` because OAuth is not enabled yet.

Seeded accounts are created automatically:

- `observer` / `observer`
- `admin` uses the configured admin password, defaulting to `ABDUGYA1398`
- `color_1` through `color_15` are seeded user accounts

Observer and admin accounts can enter games without claiming a country. Normal accounts join a game by claiming one generated country.

## Persistence

- Game state is stored under `server/state/games/<gameId>/game-state.json`.
- Auth state and dev stats live in the SQLite database under `server/state/auth.sqlite`.
- The game server saves dirty state on a timer, and deleted dev games also remove their saved state directory.

## Game Versions And Lifecycle

- An orchestrator (`server/orchestrator.ts`) can host games on different code versions at the same time, so a new game can run updated code while an older game stays on its original code.
- A version is a git ref the orchestrator checks out as an isolated worktree and runs as its own game-server process; clients reach the right one through a single gateway, so the public endpoint and tunnel config stay unchanged.
- Versions and per-game lifecycle (create on a chosen version, reset, update, stop, start, archive, and rollback) are controlled from the developer panel or the `npm run control` CLI, with compatibility checks before an update.
- Each save is stamped with its schema and protocol version, and state is backed up before resets and updates.

## Gameplay Systems

The project is a logistics, expansion, and command prototype rather than a pure battle sandbox. The implemented systems include:

- A deterministic procedural galaxy with 500 stars and 15 factions.
- Faction visibility and fog-of-war based on jump distance from each home system.
- Fleet movement across the hyperlane network with transit phases.
- Starbase construction from fleets, plus starbase upgrades from outpost to star fortress.
- Starbase buildings such as shipyards, solar arrays, hydroponics bays, orbital fabricators, alloy assembly docks, research annexes, and logistics depots.
- Corvette production from completed shipyards.
- Planet districts, planet buildings, and urban sub-districts with compatibility rules.
- Resource production and upkeep for food, minerals, energy, goods, alloys, and research.
- Population, jobs, housing, amenities, happiness, crime, stability, and growth pressure.
- Research with active and passive pools, prerequisites, and unlocks.
- Government laws, leaders, and leader assignment effects.
- Market trading with player pressure and auto-trade orders.
- Combat systems with tactical orders, attack-target and attack-system commands, range bands, shield/armor/hull damage resolution, and combat contacts tracked in system view.
- Admin commands and a developer panel for game and account management.

## Data Model Highlights

The main shared data modules live under `src/data/` and `src/game/`:

- `src/data/Economy.ts` defines resources, jobs, districts, buildings, population growth, and upkeep logic.
- `src/data/Starbase.ts` defines starbase levels, building kinds, ship kinds, and combat stats.
- `src/data/Factions.ts` defines faction generation and visibility calculations.
- `src/data/GalaxyMap.ts` defines the deterministic galaxy size, shape, and camera limits.
- `src/data/Technology.ts` defines the tech tree and research effects.
- `src/data/Market.ts` defines market state, pricing, and trade pressure.
- `src/data/Government.ts` and `src/data/Leaders.ts` define laws, effects, and leaders.
- `src/game/GameProtocol.ts` defines the client/server protocol and game state payloads.

## Development And Configuration

The repo includes `.env.example` with local development values and commented production examples.

Local development works without extra setup if you keep the default localhost values:

```env
VITE_AUTH_SERVER_URL=http://localhost:8788
VITE_WS_URL=ws://localhost:8787
AUTH_SERVER_PORT=8788
GAME_SERVER_PORT=8787
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
WS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Production examples in `.env.example` show a split frontend/backend deployment with separate auth and WebSocket endpoints, plus cookie domain and secure-cookie settings for cross-subdomain auth.

`wrangler.jsonc` points Cloudflare Pages static assets at `dist/` with single-page-application fallback for client-side routing.

## Current Limitations

- `src/pages/EmailVerificationPage.tsx` is a UI shell; there is no backend email verification flow yet.
- OAuth login buttons exist in the UI, but the server explicitly returns `501` for those endpoints.

## Verification

The current README content is aligned with the checked-in code and repo config in:

- `package.json`
- `src/App.tsx`
- `src/auth/client.ts`
- `server/auth-server.ts`
- `server/auth-store.ts`
- `server/index.ts`
- `server/game-state-path.ts`
- `src/data/Economy.ts`
- `src/data/Starbase.ts`
- `src/data/Factions.ts`
- `src/data/GalaxyMap.ts`
- `src/data/Technology.ts`
- `src/data/Market.ts`
- `src/data/Government.ts`
- `src/data/Leaders.ts`
- `src/game/GameProtocol.ts`
- `server/combat.ts`
- `server/combat.test.ts`
- `.env.example`
- `wrangler.jsonc`