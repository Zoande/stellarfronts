# Local Development & Environments

How to run StellarFronts locally and what the moving parts are.

## Quick start

```bash
npm install
npm run dev:all     # client + auth server + game server together
# open http://localhost:5173
```

`dev:all` runs three processes concurrently (via `concurrently`): the Vite client, the auth server,
and the game server. See [`package.json`](../../package.json).

## Scripts

| Script | What it runs |
| --- | --- |
| `npm run dev` | Vite client only (`http://localhost:5173`). |
| `npm run server:dev` | Game server (`tsx server/index.ts`) — WebSocket on `:8787`. |
| `npm run auth:dev` | Auth server (`tsx server/auth-server.ts`) — HTTP on `:8788`. |
| `npm run dev:all` | Client + auth + game server. |
| `npm run orchestrator:dev` | The multi-version orchestrator (gateway `:8787`, control `:8790`). |
| `npm run control` | CLI for the orchestrator control API (see below). |
| `npm run server:test` | Node test suite (`server/tests/*.test.ts`). |
| `npm run server:typecheck` | Type-check server + shared files (`tsconfig.server.json`). |
| `npm run build` | Production build: `tsc` then `vite build`. |
| `npm run preview` | Preview the built client. |

> There is no single client typecheck script; use `npx tsc --noEmit` (driven by `tsconfig.json`).

## Ports & endpoints

Defaults from [`.env.example`](../../.env.example) and
[`server/game/constants.ts`](../../server/game/constants.ts) /
[`server/orchestrator.ts`](../../server/orchestrator.ts):

| Service | URL | Env var |
| --- | --- | --- |
| Client (Vite) | `http://localhost:5173` | — |
| Auth server | `http://localhost:8788` | `AUTH_SERVER_PORT`, client `VITE_AUTH_SERVER_URL` |
| Game server (WebSocket) | `ws://localhost:8787` | `GAME_SERVER_PORT`, client `VITE_WS_URL` |
| Orchestrator control API | `http://localhost:8790` | `CONTROL_PORT` |
| Orchestrator game gateway | `ws://localhost:8787` | `PUBLIC_GAME_PORT` / `GAME_SERVER_PORT` |
| Orchestrator dev-version process | internal `:8809` | `DEV_INTERNAL_PORT` |
| Orchestrator tagged versions | internal from `:8810` up | `VERSION_PORT_BASE` |

Note the orchestrator gateway and a standalone game server both default to `:8787` — run one or the
other, not both.

## Environment configuration

Copy [`.env.example`](../../.env.example) to `.env`. Local defaults work with no changes. Key vars:

- `VITE_AUTH_SERVER_URL`, `VITE_WS_URL` — where the client looks for the auth and game servers.
- `ALLOWED_ORIGINS` (auth, CORS) and `WS_ALLOWED_ORIGINS` (game server, WebSocket origin allow-list).
- `ADMIN_PASSWORD`, `DEV_PANEL_PASSWORD` — default `ABDUGYA1398`.
- `COOKIE_DOMAIN`, `COOKIE_SECURE` — leave unset locally; set for cross-subdomain production.

The production section of `.env.example` shows a split deploy (Cloudflare Pages client +
Raspberry-Pi/Cloudflare-tunnel auth and WebSocket servers). `wrangler.jsonc` serves `dist/` as an SPA
with client-side routing fallback.

## Accounts (seeded automatically)

The auth store seeds accounts on first run ([`server/auth-store.ts`](../../server/auth-store.ts),
`seedAccounts`):

- `observer` / `observer` — read-only spectator; can enter any game without claiming a country.
- `admin` / `$ADMIN_PASSWORD` (default `ABDUGYA1398`) — privileged; observer-style access plus admin
  commands.
- `color_1` … `color_15` (password = username) — ordinary player accounts, one per faction slot.

Observer and admin accounts join in **observer mode** (read-only). Ordinary accounts join by claiming
one generated country (faction).

## On-disk state

- Game saves: `server/state/games/<gameId>/game-state.json` (+ a `.owner` lock file).
- Accounts, sessions, game catalog, versions, news: `server/state/auth.sqlite`.
- `SF_STATE_DIR` overrides the state root (the orchestrator sets it for child version processes); see
  [`server/game-state-path.ts`](../../server/game-state-path.ts).

## Running with the orchestrator (multi-version)

Start it with `npm run orchestrator:dev`, then drive it with the control CLI:

```bash
npm run control versions
npm run control register-version <gitRef> [--id name] [--port n]
npm run control create-game --name "…" [--version <id>]
npm run control compat --to <versionId>
npm run control update-game <id> --to <versionId>
npm run control stop-game | start-game | archive-game | rollback-game <id>
```

The control API is token-gated (`CONTROL_TOKEN`). Full lifecycle details:
[`server/orchestrator-and-lifecycle.md`](../server/orchestrator-and-lifecycle.md).

## Known limitations (current)

- OAuth login endpoints return `501` (not enabled).
- Email verification is a UI shell with no backend flow.
