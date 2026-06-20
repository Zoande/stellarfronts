# Orchestrator & Version Lifecycle

The orchestrator hosts **multiple code versions at once** and routes clients to the right one, so a
new game can run updated code while an older game keeps running its original code. It is optional
(plain dev runs a single game server), but it is how the project does zero-downtime upgrades. Source:
[`server/orchestrator.ts`](../../server/orchestrator.ts); CLI: [`scripts/control.ts`](../../scripts/control.ts).
Read [`../must-read/03-versioning-and-schema.md`](../must-read/03-versioning-and-schema.md) first.

## What a "version" is

A version is a **git ref checked out as an isolated worktree** under `versions/<id>/`, run as its own
game-server child process on an internal port. The special `dev` version is the current working tree
(`DEV_VERSION_ID`, internal port `DEV_INTERNAL_PORT` = 8809); tagged versions get ports from
`VERSION_PORT_BASE` = 8810 up.

Registration (`register-version`):
1. `git fetch` from `GIT_REMOTE` (default `origin`) and resolve the ref (branch → tag → commit) to an
   immutable **SHA** (`revCommit`).
2. `git worktree add --detach <path> <sha>` so a later branch move never changes this version
   (`ensureWorktreeAt`).
3. Probe the build's identity by running its server with `--print-version` (`probeManifest`) to read
   `protocolVersion` / `schemaVersion` / `migratesFromSchema`.
4. Store the version (worktree path, port, manifest) in the auth-store catalog.

## The gateway

The orchestrator listens on two ports (defaults): the **control API** on `CONTROL_PORT` (8790) and the
public **game WS gateway** on `GATEWAY_PORT` (8787). The gateway proxies each client WebSocket to the
internal process for that game's assigned version — so the public endpoint and tunnel config never
change as versions come and go. (Run the orchestrator *or* a standalone game server on 8787, not
both.)

## Process supervision

A single reconcile loop is the spawn authority: it loads active games, ensures each version with
active games has a running child (`GAME_SERVER_PORT=<internal>`, `SF_VERSION_ID=<id>`,
`SF_STATE_DIR=<shared root>`), and disposes processes whose games moved away. Crash handling:
exponential backoff on rapid crashes up to a cap, and after too many in a row a version is
**quarantined** (no auto-restart) until re-registered or explicitly started. Crash history clears on a
healthy run, on (re)registration, and on orchestrator restart.

## Game lifecycle & the control CLI

Drive the control API with `npm run control <cmd>` ([`scripts/control.ts`](../../scripts/control.ts);
token-gated by `CONTROL_TOKEN`):

| Command | Effect |
| --- | --- |
| `versions` / `register-version <ref> [--id x] [--port n]` / `unregister-version <id>` | List / pin / remove versions (a version with games can't be removed). |
| `games` / `create-game --name … [--version <id>]` | List / create a game pinned to a version. |
| `compat --to <versionId>` | Dry-run: can the target version load this game's schema? |
| `update-game <id> --to <versionId>` | Move a game to another version (gated on compatibility). |
| `reset-game <id>` | Reset to a fresh galaxy (state backed up first). |
| `stop-game` / `start-game` / `archive-game` / `rollback-game <id>` | Lifecycle controls. |
| `endpoint` | Show the public game endpoint. |

## Compatibility gate

Moving a game to a version is allowed only if the target accepts the game's recorded schema
([`server/orchestrator.ts`](../../server/orchestrator.ts)):

```ts
// dev accepts everything; a tagged version gates on its migratesFromSchema.
return target.migratesFromSchema.includes(game.schemaVersion);
```

State is backed up before resets/updates, enabling `rollback-game`.

## How to extend / rules

- A new build that changes persisted shape must keep `migratesFromSchema` covering the schemas of
  games you intend to upgrade — don't narrow it casually.
- The schema/protocol numbers a version advertises come straight from
  [`server/versionManifest.ts`](../../server/versionManifest.ts) via `--print-version`; keep that
  accurate (and in lockstep — see the known inconsistency in
  [`../must-read/03-versioning-and-schema.md`](../must-read/03-versioning-and-schema.md)).
- Worktrees are detached at a SHA on purpose; don't point a version at a moving branch and expect it
  to track.

## Key files

- Orchestrator: [`server/orchestrator.ts`](../../server/orchestrator.ts).
- Control CLI: [`scripts/control.ts`](../../scripts/control.ts).
- Manifest: [`server/versionManifest.ts`](../../server/versionManifest.ts).
- Tests: [`server/tests/versioning.test.ts`](../../server/tests/versioning.test.ts).
