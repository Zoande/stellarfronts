# Local Development & Environments

## Quick start

Copy [`.env.example`](../../.env.example) to `.env`, set unique values for
`ADMIN_PASSWORD`, `DEV_PANEL_PASSWORD`, and `CONTROL_TOKEN`, then:

```bash
npm install
npm run dev:all
```

`dev:all` starts the client, auth server, and orchestrator. The orchestrator owns the public
WebSocket gateway and starts backend processes as needed. Use `dev:bare` only when deliberately
testing one standalone game server without multi-version lifecycle management.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite client on `:5173`. |
| `npm run auth:dev` | Auth server on `:8788`. |
| `npm run orchestrator:dev` | Gateway on `:8787`, internal control API on `:8790`. |
| `npm run dev:all` | Client + auth + orchestrator. |
| `npm run dev:bare` | Client + auth + standalone game server. |
| `npm run control` | Local diagnostic/control CLI. The `/dev` UI is preferred for routine work. |
| `npm run server:test` | Server tests. |
| `npm run server:typecheck` | Server/shared typecheck. |
| `npm run build` | Client typecheck, production bundle, and initial-entry budget enforcement. |

## Service endpoints

| Service | Default | Configuration |
| --- | --- | --- |
| Vite client | `http://localhost:5173` | Vite |
| Auth HTTP | `127.0.0.1:8788` | `AUTH_SERVER_HOST`, `AUTH_SERVER_PORT` |
| WebSocket gateway | `127.0.0.1:8787` | `GATEWAY_HOST`, `PUBLIC_GAME_PORT` |
| Orchestrator control | `127.0.0.1:8790` | `CONTROL_HOST`, `CONTROL_PORT` |
| Development backend | internal `:8809` | `DEV_INTERNAL_PORT` |
| Immutable backends | internal from `:8810` | `VERSION_PORT_BASE` |

Production should expose auth and the gateway through Cloudflare Tunnel. Keep the control API and
backend ports loopback-only. The Cloudflare-hosted client uses `VITE_AUTH_SERVER_URL` and
`VITE_WS_URL` to reach those public tunnel endpoints.

## Required security configuration

- `ADMIN_PASSWORD`: initial admin account password.
- `DEV_PANEL_PASSWORD`: protects `/dev`.
- `CONTROL_TOKEN`: shared only by auth and orchestrator; never expose it to the client.
- `ALLOWED_ORIGINS`: allowed auth/CORS origins.
- `WS_ALLOWED_ORIGINS`: allowed browser WebSocket origins.
- `COOKIE_DOMAIN` and `COOKIE_SECURE`: production cookie scope and transport policy.

Auth and orchestrator refuse to start without the control token. Login endpoints are rate-limited,
request bodies are bounded, gateway queues and payloads are bounded, and internal services bind to
loopback unless explicitly configured otherwise.

## Pi operation

Run auth and orchestrator as supervised services with automatic restart. Once running, normal
maintenance is available from `/dev`:

- health and process inspection;
- immutable version registration and artifact status;
- game creation, start, stop, retry, update, archive, reset, rollback, and deletion;
- manual backup creation and exact verified-backup selection;
- crash/quarantine, owner-lock, save, and tick diagnostics.

SSH access should only be needed for host-level work such as OS/package upgrades, service-unit
changes, disk recovery, or deeper debugging.

## State

- Auth catalog: `server/state/auth.sqlite`
- Game saves: `server/state/games/<gameId>/game-state.json`
- Owner token: adjacent `.owner` file
- Verified backups: game backup directory under the state root
- Immutable worktrees/dependency stamps: orchestrator version directory
- Orchestrator crash/quarantine health: persisted control-plane health file

`SF_STATE_DIR` relocates runtime state. Backups are retained according to
`GAME_BACKUP_RETENTION_COUNT`.

## Verification

Before deploying:

```bash
npm run server:test
npm run server:typecheck
npm run build
```

The build fails if the initial client entry exceeds its budget. The authored BabylonJS
authentication background is intentionally excluded from that limit.

Known product limitations remain unchanged: OAuth endpoints return `501`, and email verification is
still a UI shell.
