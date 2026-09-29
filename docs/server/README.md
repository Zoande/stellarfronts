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

- [`server/index.ts`](../../server/index.ts) — game-server dependency composition and startup.
- [`server/game-runtime.ts`](../../server/game-runtime.ts) — runtime lifecycle, tick pipeline, and command handlers.
- [`server/game/`](../../server/game/) — the simulation, split by concern (clock, economy-tick,
  fleet-combat, research, persistence, snapshot, state-bootstrap/normalization, visibility, …).
- [`server/auth-server.ts`](../../server/auth-server.ts), [`server/auth-store.ts`](../../server/auth-store.ts) — auth.
- [`server/orchestrator.ts`](../../server/orchestrator.ts), [`scripts/control.ts`](../../scripts/control.ts) — versioning.
- [`server/versionManifest.ts`](../../server/versionManifest.ts) — this build's identity.

## Add-a-command pattern (recap)

Define the `ClientCommand`, validate its fields in `game/command-fields.ts`, and dispatch gameplay
through `executeGameCommand`. Keep handlers transport-free, check ownership and legality there, and
return an outcome for the mutation coordinator to apply. `handleCommand` remains the WebSocket
adapter for request IDs, details, and administrative operations. Full recipe:
[`../must-read/05-contributing-rules.md`](../must-read/05-contributing-rules.md).

## Add-a-tick-phase pattern

A new periodic system is a function `processX(ctx, …): { somethingChanged: boolean }` in
`server/game/`, called from `advanceState` ([`server/game-runtime.ts`](../../server/game-runtime.ts)) at the right
point in the order, adding the relevant `ServerUpdateField`s to the `changed` set. Gate "once per
hour/week/day" work on the corresponding game-time index (see
[runtime-and-tick.md](runtime-and-tick.md)).

See [AI foundations and simulation laboratory](ai-foundations-and-laboratory.md) for shared actions,
fair observations, deterministic saves, and scripted experiments.
The [Stage 1 findings](ai-stage-1-findings.md) summarize the seeded runs and reproduction cases.
