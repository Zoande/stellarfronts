# Orchestrator & Version Lifecycle

The Raspberry Pi runs one auth service and one orchestrator. Cloudflare continues to serve one
browser client and tunnel the fixed auth/WebSocket endpoints. The orchestrator can host several
backend versions without changing either public endpoint.

## Immutable version artifacts

Registering a version from `/dev`:

1. Fetches the selected git ref and resolves it to an immutable commit SHA.
2. Creates a detached worktree under `versions/<id>`.
3. Reads `server/version-manifest.json` without importing or executing historical server code.
   Legacy commits are parsed statically from `versionManifest.ts`.
4. Runs `npm ci` inside that worktree and stamps the lockfile hash. Each backend therefore resolves
   its own pinned dependencies rather than the current root `node_modules`.
5. Stores the version and starts it when an active game needs it.

Historical backend imports of `server/auth-store` are redirected to the deployed control-plane
module. Game processes run it in runtime mode, which cannot execute database DDL, migrations, or
account seeding. This keeps old application code away from old control-plane initialization logic.

## Public gateway

The public WebSocket address never changes. The gateway resolves `gameId` to the assigned internal
version port and uses a bounded proxy state machine:

- cold version starts retry without closing the browser connection;
- queued startup messages have count and byte limits;
- downstream and upstream buffered amounts are bounded;
- target availability is rechecked on every attempt;
- invalid, oversized, or congested connections fail explicitly.

Gateway connection, retry, rejection, and queued-byte metrics appear in `/dev`.

## Failure containment and supervision

One process hosts the games assigned to one version, but each game loads and ticks independently. A
bad save or thrown tick quarantines only that game and releases its lock. Healthy games continue.
The dev panel shows the failure and provides Retry.

Version crashes use exponential backoff and quarantine. Crash state is persisted in
`orchestrator-health.json`, so restarting the orchestrator does not erase a crash loop. An explicit
Start/Retry or re-registration clears the quarantine.

## Safe lifecycle

All lifecycle operations are exposed through the auth-gated `/dev` panel:

- create, start, stop, retry, archive, and delete;
- register/unregister immutable versions;
- compatibility check and version update;
- manual verified backup, backup listing, exact rollback selection, and reset.

Stop changes catalog state, waits for the runtime to save and release ownership, and fails closed on
timeout. A version process receives `SIGTERM`, drains all runtimes, and must exit before lifecycle
work continues; `SIGKILL` is only a timed fallback and is reported as an error.

Update backs up the quiesced save before changing version assignment. Rollback verifies the selected
backup checksum and restores its recorded source backend as well as its state. Reset and deletion
also retain a final verified backup.

## Health and unattended operation

The control API binds to `127.0.0.1` by default and requires `CONTROL_TOKEN`; auth proxies it without
exposing the token to the browser. `/dev` displays:

- gateway state;
- artifact/dependency readiness;
- version PID, uptime, crash count, retry/quarantine, and last error;
- game runtime state, tick timing, last save, current lock owner, schema/protocol, and backups.

Once auth and orchestrator are supervised by the Pi's service manager, normal operation requires no
shell access. SSH is only needed for host-level failures such as power, disk, networking, or service
manager debugging.

## Required configuration

`ADMIN_PASSWORD`, `DEV_PANEL_PASSWORD`, and `CONTROL_TOKEN` are mandatory. Auth and orchestrator must
receive the same control token. See [`.env.example`](../../.env.example) for ports, state root,
origins, retention, and host binding.

## Key files

- Control plane: [`server/orchestrator.ts`](../../server/orchestrator.ts)
- Version artifacts: [`server/version-artifacts.ts`](../../server/version-artifacts.ts)
- Runtime catalog guard: [`server/runtime-module-guard.mjs`](../../server/runtime-module-guard.mjs)
- Gateway: [`server/ws-gateway.ts`](../../server/ws-gateway.ts)
- Backups: [`server/game-backups.ts`](../../server/game-backups.ts)
- Dev operations UI: [`src/pages/DevVersionPanel.tsx`](../../src/pages/DevVersionPanel.tsx)
