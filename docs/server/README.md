# Server Engineering

The Node side: the live game simulation, persistence, the wire protocol, multi-version hosting, and
auth. Gameplay rules themselves live in [`../systems/`](../systems/); this folder is the runtime that
drives them.

## The docs

| Doc | Topic |
| --- | --- |
| [runtime-and-tick.md](runtime-and-tick.md) | `RuntimeContext`, the `advanceState` tick pipeline, the clock/time model. |
| [state-persistence-and-normalization.md](state-persistence-and-normalization.md) | Create/load/save, normalization-as-migration, the save timer, ownership lock. |
| [protocol-and-snapshots.md](protocol-and-snapshots.md) | Snapshot/update/detail messages, perspective filtering, fog-of-war redaction. |
| [orchestrator-and-lifecycle.md](orchestrator-and-lifecycle.md) | Versions as worktrees, the gateway, the control CLI, compatibility gating, crash supervision. |
| [auth-and-accounts.md](auth-and-accounts.md) | Auth server/store, sessions, accounts, dev panel. |

## Where things live

- [`server/index.ts`](../../server/index.ts) — game server entry: the tick loop and command handlers.
- [`server/game/`](../../server/game/) — the simulation, split by concern (clock, economy-tick,
  fleet-combat, research, persistence, snapshot, state-bootstrap/normalization, visibility, …).
- [`server/auth-server.ts`](../../server/auth-server.ts), [`server/auth-store.ts`](../../server/auth-store.ts) — auth.
- [`server/orchestrator.ts`](../../server/orchestrator.ts), [`scripts/control.ts`](../../scripts/control.ts) — versioning.
- [`server/versionManifest.ts`](../../server/versionManifest.ts) — this build's identity.

## Add-a-command pattern (recap)

Define the `ClientCommand`, dispatch it in `handleCommand`, validate perspective/ownership, mutate
state + `hasDirtyState = true`, `accept`/`reject`, and `broadcastUpdates([...])`. Full recipe:
[`../must-read/05-contributing-rules.md`](../must-read/05-contributing-rules.md).

## Add-a-tick-phase pattern

A new periodic system is a function `processX(ctx, …): { somethingChanged: boolean }` in
`server/game/`, called from `advanceState` ([`server/index.ts`](../../server/index.ts)) at the right
point in the order, adding the relevant `ServerUpdateField`s to the `changed` set. Gate "once per
hour/week/day" work on the corresponding game-time index (see
[runtime-and-tick.md](runtime-and-tick.md)).
