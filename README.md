# StellarFronts

StellarFronts is a browser-based multiplayer 4X space-strategy prototype. Players claim a country,
explore a persistent procedural galaxy, build planetary and orbital infrastructure, design fleets,
research technologies, trade, negotiate, and fight real-time battles. React provides the account and
home experience; BabylonJS and imperative DOM overlays power the in-game command view.

Balance and content are still in active development.

## Quick start

Requirements: a current Node.js release supported by the dependencies and npm.

```bash
npm install
```

Create `.env` in the repository root:

```env
ADMIN_PASSWORD=replace-with-a-local-admin-password
DEV_PANEL_PASSWORD=replace-with-a-local-dev-panel-password
CONTROL_TOKEN=replace-with-a-long-random-shared-control-token
```

Both variables are required; startup fails instead of falling back to a built-in password. Values are
read literally, so parentheses or quotes become part of the password. Then run:

```bash
npm run dev:all
```

Open `http://localhost:5173`. The local stack uses:

| Service | Default |
| --- | --- |
| Vite client | `http://localhost:5173` |
| Auth HTTP server | `http://localhost:8788` |
| Orchestrator game gateway | `ws://localhost:8787` |

See [the local development guide](docs/must-read/06-local-dev-and-environments.md) and
[`.env.example`](.env.example) for all environment variables and production examples.

## Architecture

StellarFronts normally runs as three long-lived processes:

- `src/`: React pages, BabylonJS scenes, DOM HUD/panels, and gameplay modules shared with the server.
- `server/auth-server.ts`: account, profile, news, messaging, game-catalog, and developer HTTP APIs.
- `server/orchestrator.ts`: the supervised multi-version host and public WebSocket gateway.

The orchestrator launches `server/index.ts` once per active code version and proxies each client to
the correct runtime. Game state is saved per game; accounts and cross-game progression live in
SQLite. The `/dev` panel is the normal operations surface for versions, lifecycle, failures,
verified backups, rollback, and gateway/process health.

`src/data/` and `src/game/` are imported by both browser and server code. Changes there affect both
builds and must remain compatible with persisted state and the supported wire protocol. Start with
[the engineering docs](docs/README.md) before changing shared models.

## App routes

- `/`: login and signup.
- `/home`: game catalog, joined games, account profile, progression, quests, and achievements.
- `/game/:gameId`: the BabylonJS galaxy/system command view.
- `/news` and `/news/:slug`: public news, comments, and voting.
- `/dev`: password-gated developer and version-management tools.

Google and Microsoft OAuth routes currently return `501`. Email-verification UI exists, but there is
no backend verification flow.

## Gameplay

Implemented systems include:

- A deterministic 500-star, 15-faction galaxy with hyperlanes and generated planets/nebulae.
- Field-level intelligence with sensor suites, current/stale observations, known lanes, nebula
  blocking, and authority-based command links.
- Real-time fleet movement with route segments, system/hyperlane travel, orbiting, merging, retreat,
  tactical formations, repair orders, and selectable doctrines.
- Modular ship design across hulls, sections, weapons, defenses, and utilities.
- Starbase construction, upgrades, buildings, shipyards, ship queues, defenses, and repairs.
- Planetary districts, urban sub-districts, buildings/upgrades, construction queues, and colonies.
- Population by species, jobs/classes, housing, amenities, happiness, crime, stability, growth,
  habitability, species rights, and living standards.
- Food, minerals, energy, goods, alloys, and research production/upkeep with shortages.
- Technology prerequisites, active/passive research, unlocks, and economic/fleet modifiers.
- Government laws and positions, recruitable leaders, and planet/fleet/government assignments.
- Market prices, player pressure, direct trades, transaction history, and auto-trade orders.
- Diplomacy messages, border policies, wars, treaties, migration/trade privileges, and peace terms.
- Continuous fleet/starbase combat with range bands, projectiles, interception, subsystem damage,
  tactical orders, retreats, reports, and captured systems.
- Situations, decision events, notifications, admin commands, and runtime developer controls.

## Account progression and Dark Matter

XP, 20 account levels, achievements, weekly/three-day quests, news activity, and direct messages are
stored per account. Achievements and quests reward both XP and Dark Matter.

Dark Matter carries across games. It currently supports:

- 10× fleet movement for 1 Dark Matter per in-game moving day, stopping on arrival or when the
  account runs out.
- Immediate planetary construction completion at
  `max(1, ceil(remaining days × 0.05))` Dark Matter.

The game server performs atomic account debits and pushes balance updates to every connected session
for that account. See
[Account Progression & Dark Matter](docs/systems/account-progression-and-dark-matter.md).

## Accounts and persistence

Authentication uses PBKDF2 password hashes and an HttpOnly `sf_session` cookie. First startup seeds:

- `observer` / `observer`: read-only full-truth observer.
- `admin` / `$ADMIN_PASSWORD`: privileged read-only game observer with admin commands.
- `color_1` through `color_15`: ordinary local player accounts whose password matches the username.

Ordinary accounts claim a generated country independently in each game. Account state, sessions,
memberships, news, messaging, and progression are stored in `server/state/auth.sqlite`. Game saves
are stored under `server/state/games/<gameId>/game-state.json`.

## Versioning

The current build advertises protocol version 7 and schema version 27. It normalizes schemas
23–26 into schema 27, while the browser client accepts wire protocols 5, 6, and 7. The orchestrator
checks compatibility before moving a game and creates checksummed, version-aware backups around
destructive operations. Corrupt or incompatible saves are quarantined and preserved rather than
being replaced with a fresh galaxy.

See [Versioning & Schema](docs/must-read/03-versioning-and-schema.md) before changing persisted or
wire state.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite client. |
| `npm run auth:dev` | Start the auth HTTP server. |
| `npm run server:dev` | Start the standalone game WebSocket server. |
| `npm run dev:all` | Start client, auth, and the multi-version orchestrator/gateway. |
| `npm run dev:bare` | Start client, auth, and one standalone game server. |
| `npm run orchestrator:dev` | Start the multi-version gateway/orchestrator. |
| `npm run control` | Call orchestrator version/game lifecycle commands. |
| `npx tsc --noEmit` | Type-check client and shared TypeScript. |
| `npm run server:typecheck` | Type-check server and shared TypeScript. |
| `npm run server:test` | Run the Node server test suite. |
| `npm run build` | Type-check and build the production client. |
| `npm run preview` | Preview the production client build. |

## Repository map

```text
src/
  auth/          Auth client and shared account/profile types
  components/    React shells and shared page components
  data/          Shared gameplay models and definitions
  game/          Protocol, time, boot, and shared gameplay helpers
  pages/         Login, home, game, news, and developer pages
  scenes/        BabylonJS galaxy/system scenes
  systems/       Scene rendering and interaction subsystems
  ui/            In-game DOM HUD, panels, and modals
server/
  game/          Authoritative simulation, persistence, intelligence, snapshots
  tests/         Node test suite
  auth-store.ts  SQLite accounts, catalog, news, messaging, progression
  auth-server.ts HTTP API
  index.ts       Game server/runtime and command handlers
  orchestrator.ts Multi-version host and gateway
docs/            Engineering and gameplay-system documentation
resources/       Source art and model resources
public/          Browser-served static assets
```

## Documentation

- [Documentation index](docs/README.md)
- [Project overview](docs/must-read/01-project-overview.md)
- [Architecture and data flow](docs/must-read/02-architecture.md)
- [Contributing rules](docs/must-read/05-contributing-rules.md)
- [Gameplay systems](docs/systems/README.md)
- [Server engineering](docs/server/README.md)
- [Client engineering](docs/client/README.md)
