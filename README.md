# StellarFronts Prototype

## Gameplay Documentation
See [src/game/README_GAMEPLAY.md](src/game/README_GAMEPLAY.md) for a full gameplay guide, rules, and how to play.

StellarFronts is a browser-based space strategy prototype with a Vite/React client, a websocket game server, and a separate HTTP auth server. The current build is authenticated end to end: login and signup happen against the auth service, and the game server derives the player perspective from the authenticated account instead of trusting the browser.

## Current State

The project now includes a real account system, session cookies, a separate auth service, server-side perspective handling, and a cleaned-up in-game logout path. User-created accounts are treated as observers, while the seeded faction accounts are the only ones bound to factions. Logout is now part of the game HUD and tears down the active game UI instead of leaving the clock/resources behind.

## Run Locally

1. Install dependencies with `npm install`.
2. Start the full stack with `npm run dev:all`.
3. Open `http://localhost:5173` in your browser.

Available scripts:

- `npm run dev` starts the client only.
- `npm run server:dev` starts the websocket game server on `ws://localhost:8787`.
- `npm run auth:dev` starts the auth server on `http://localhost:8788`.
- `npm run dev:all` starts client, auth, and game servers together.
- `npm run server:test` runs the server tests.
- `npm run server:typecheck` type-checks the server/shared TS files.
- `npm run build` produces a production client build.

## App Layout

- Home route: command dashboard, account summary, and launch point.
- Game route: BabylonJS-backed strategy view with an imperative HUD.
- Login and signup routes: auth forms backed by the auth server.

## Core Gameplay Loop


# What is Stellarfronts?
Stellarfronts is a turn-based strategy game set in a procedurally generated galaxy. Players command fleets, capture stars, build starbases, and compete for galactic dominance.

## How to Play
- **Goal:** Achieve the victory condition (e.g., control all stars or complete all objectives).
- **Turns:** Each player takes actions in turns. On your turn, you can move fleets, build ships, and manage resources.
- **Movement:** Fleets travel between stars via hyperlanes. Moving takes several turns depending on distance.
- **Combat:** When fleets from different players meet at a star, combat is resolved automatically.
- **Resources:** Capturing stars increases your resource income, allowing you to build more ships and starbases.
- **Objectives:** Complete special objectives for additional victory paths.
- **Win/Lose:** The game ends in victory if you meet the victory condition, or defeat if all your fleets are destroyed or the max turn limit is reached.

## Victory Conditions
- Control every star in the galaxy.
- Complete all listed objectives.

## Defeat Conditions
- All your fleets are destroyed.
- The maximum number of turns is reached.

## Tips
- Expand early to secure resources.
- Protect your fleets and starbases.
- Plan your moves ahead—travel takes time!
- Watch your objectives for alternate win paths.

---
For more details, see `/src/game/README_GAMEPLAY.md`, `/src/game/core.ts`, and `/src/types/game.ts`.

The game is currently a logistics and expansion prototype rather than a full war game. The main loop is:

1. Log in as an observer or a seeded faction account.
2. Open the galaxy map and inspect discovered stars and connected systems.
3. Move ships through the hyperlane network.
4. Build starbases from ships, then upgrade them and add orbital infrastructure.
5. Develop habited planets by adding districts, planet buildings, and urban sub-districts.
6. Watch economy, population, and resource production change over time as the clock advances.

## Economy System

The economy is implemented at both the planet and faction level.

Planet-level systems include:

- Resource production and upkeep for food, minerals, energy, goods, alloys, and research.
- Population, species population groups, employment, unemployment, housing, amenities, happiness, crime, and stability.
- Job classes and job slots such as administrators, researchers, artisans, metallurgists, entertainers, enforcers, farmers, miners, technicians, clerks, and unemployed pops.
- District construction for city, generator, mining, and agriculture districts.
- Planet buildings with compatibility rules for district slots and urban sub-district slots.
- Urban sub-district types that can be changed, with incompatible buildings being removed when a sub-district changes.
- Construction queues for districts and buildings.
- Population growth and decline based on housing, amenities, stability, crime, employment, and capacity pressure.

Faction-level systems include:

- Resource stockpiles and monthly resource deltas.
- Economy updates driven by owned habited planets and orbital infrastructure.

Habited planets start with a population baseline and starter infrastructure, so there is already a working economy loop at game start.

## Military And Expansion

The current military layer is focused on movement, control, and orbital buildup rather than direct combat.

Implemented systems include:

- Ships with transit phases for idle, departing, jumping hyperlane, arriving, and building starbase.
- Ship movement across the hyperlane network.
- Building a starbase from a ship at a target star.
- Starbase levels from outpost to star fortress.
- Starbase building slots with infrastructure like shipyards, solar arrays, hydroponics bays, orbital fabricators, alloy assembly docks, research annexes, and logistics depots.
- Corvette production from completed shipyards.
- Faction-bound starbase ownership and upkeep costs.
- Fog-of-war style star visibility for faction perspectives.

Important caveat: direct combat is not implemented yet. The protocol still has an `attack` ship action type in the shared types, but there is no server-side combat handler wired up in the current gameplay loop.

## Exploration And Visibility

The galaxy is procedurally generated and deterministic. The game includes:

- A seeded galaxy map with 500 stars.
- Faction home star assignment from the star field.
- Observer and faction perspectives.
- Faction visibility based on jump distance from the home system.
- Galaxy and system scene transitions in the client.

## Authentication

Accounts are stored on the auth server in SQLite at `server/state/auth.sqlite`. Sessions use an HttpOnly cookie named `sf_session`, and the server keeps the session token hashed rather than storing it in plain text.

Seeded accounts:

- `observer` / `observer`
- `color_1` / `color_1`
- `color_2` / `color_2`
- `color_3` / `color_3`
- `color_4` / `color_4`
- `color_5` / `color_5`
- `color_6` / `color_6`
- `color_7` / `color_7`
- `color_8` / `color_8`
- `color_9` / `color_9`
- `color_10` / `color_10`
- `color_11` / `color_11`
- `color_12` / `color_12`
- `color_13` / `color_13`
- `color_14` / `color_14`
- `color_15` / `color_15`

User-created accounts can use any unused username and password. They are created as observer accounts for gameplay.

Google and Microsoft login buttons are placeholders and currently disabled. Email verification is disabled for now.

## Persistence

- Game state lives in `server/state/game-state.json`.
- Auth data lives in the SQLite auth database under `server/state/auth.sqlite`.
- Auth database sidecar files are local runtime artifacts and are ignored by git.

## Dev Notes

- `server/index.ts` hosts the websocket game server.
- `server/auth-server.ts` hosts the auth API.
- The client talks to the auth server over HTTP and the game server over websocket.
- The project uses PBKDF2 password hashing and SQLite for local persistence.