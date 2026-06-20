# Backward Compatibility

Because StellarFronts hosts multiple code versions and `src/` is shared by both client and server
(see [`01-project-overview.md`](01-project-overview.md)), a change can put a **new client** in front
of an **older server** (or vice versa). This doc is the discipline that keeps that from breaking.

## The version skew you must design for

The orchestrator can run an updated game-server version while a client that auto-loaded newer static
assets connects to a game still pinned to older server code. The realistic, must-handle case is:

> **A new client talking to a server running the current (older) code.**

In that case the server emits state shaped by the *old* shared files: it won't send your new fields,
won't place your new objects, won't know your new enum values. The new client must tolerate their
absence and render the old-shaped state without crashing.

The reverse (old client + new server) matters less in practice because clients are static assets that
update together; the protocol-version handshake
([`SUPPORTED_SERVER_PROTOCOL_VERSIONS`](../../src/game/GameServerClient.ts)) is the hard gate that
stops a truly incompatible pairing.

## The rules

1. **Prefer additive changes.** Add fields and enum members; don't rename, repurpose, or remove. A
   normalizer can backfill a new field; it cannot invent data for a renamed one.
2. **Read defensively on the client.** When you read a value the server might not send yet, default
   it. `record[key] ?? 0`, `array ?? []`, `obj?.field`. Never index a per-enum map with a new key and
   assume a number comes back.
3. **Don't let the client invent authoritative state.** If a new object (like a new building) should
   exist, the **server** must create it. A new client must not synthesize it locally, or it will
   disagree with an old server that never created it.
4. **Gate the wire format, not just the data.** If a payload shape genuinely changes incompatibly,
   bump `protocolVersion` and widen the client's supported list — see
   [`03-versioning-and-schema.md`](03-versioning-and-schema.md).
5. **Keep normalizers total.** Any new field on a persisted object needs a default in its normalizer
   so old saves (and old-server snapshots) load cleanly.

## Worked example: the Planetary Capital + Ruler job

A recent change added a new auto-placed building (`planetaryCapital`) and a new job (`ruler`) in
[`src/data/Economy.ts`](../../src/data/Economy.ts). Here's how each rule applied — it's a good
template for "add a building/job."

- **Additive enums.** `"ruler"` was appended to `JobKind`/`JOB_KINDS`/`JOB_FILL_ORDER` and
  `"planetaryCapital"` to `BuildingKind`. The exhaustive `Record<JobKind, …>` and
  `Record<BuildingKind, …>` maps (job class, definitions, capacities, icons) were all extended so the
  compiler proved nothing was missed.
- **Server creates the object.** The capital is injected at planet creation/normalization
  (`ensureCapitalBuilding` called from `createPlanetStateFromSeed`), **not** by the client. New
  games, colonization, and save-load all flow through that seed path, so every habited planet gets a
  capital on the *server*. The client never forces one into slot 0 — otherwise it would paint a
  capital that an old server doesn't know about.
- **Client reads defensively.** A new client against an old server receives a `jobCapacity` with no
  `ruler` key. Reads were routed through a helper that defaults to `0`
  (`planetState.economy.jobCapacity[job] ?? 0` in
  [`src/ui/CelestialObjectPanel.ts`](../../src/ui/CelestialObjectPanel.ts)). Without that guard,
  summing capacities would have produced `NaN`.
- **No capital on an old server is fine.** Such a server simply has `administrativeComplex` in the
  first city slot; the new client renders it normally. No crash, no desync.
- **Tech gating is additive.** The capital's higher levels reuse the existing service-building level
  techs ([`src/data/Technology.ts`](../../src/data/Technology.ts)); it has no level-1 unlock (it's
  auto-placed), which a guardrail test explicitly allows for `autoPlaced` buildings.

The net effect: the change is invisible-but-safe on an old server and fully featured on a new one.

## A quick self-check before you ship

- If the server didn't send field X, does the client still render? (Default it.)
- If the client is new and the server is old, can the UI crash on a missing enum key or object? (Guard
  it.)
- Does any new persisted field have a normalizer default so old saves load? (Add it.)
- Did you change a payload shape incompatibly? (Then bump `protocolVersion`, not just hope.)
- Are new objects created server-side, with the client only *rendering* them? (They must be.)

## See also

- The mechanics behind "normalization is migration": [`03-versioning-and-schema.md`](03-versioning-and-schema.md).
- Step-by-step recipes (add a building/job/command/state field):
  [`05-contributing-rules.md`](05-contributing-rules.md).
