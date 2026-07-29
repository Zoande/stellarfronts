# Galaxy, Map & Intelligence

The galaxy is a deterministic procedural starfield connected by hyperlanes. What a faction knows is
controlled by a field-level intelligence system rather than one all-or-nothing fog radius.
Generation config is [`src/data/GalaxyMap.ts`](../../src/data/GalaxyMap.ts); stars and planets are in
[`src/data/StarMap.ts`](../../src/data/StarMap.ts); lanes in
[`src/data/Hyperlanes.ts`](../../src/data/Hyperlanes.ts); intelligence definitions in
[`src/data/Intelligence.ts`](../../src/data/Intelligence.ts); and evaluation/persistence in
[`server/game/intelligence.ts`](../../server/game/intelligence.ts).

## Generation

`GALAXY_MAP` defines a deterministic 500-star, 4-arm spiral using seed 42, minimum star spacing, and
camera limits. Each star carries planet configs whose types and habitability affect colonization.
`FACTION_COUNT` is 15; `buildFactions` distributes home systems and
`buildHomeSystemOwnership` seeds ownership.

Stars are linked by undirected `hyperlanes` pairs with a derived `adjacency` list. Fleets cross only
known, enterable lanes; in-system travel is a separate movement segment. System geometry comes from
[`src/data/SystemCoordinates.ts`](../../src/data/SystemCoordinates.ts).

## Field-level intelligence

Intel is stored per faction as `IntelligenceByFaction`. Each entity (`star`, `system`, `planet`,
`starbase`, `fleet`, `ship`, or `faction`) has independently observed fields. A field exposed to the
client is:

- `current` while an active source observes it;
- `stale` when the last observation is remembered but no source currently covers it; or
- absent/`unknown` when the faction has never learned it.

This allows, for example, knowing a star's type without its full planet economy, or remembering a
fleet contact without receiving current telemetry. Known lanes are persisted similarly and become
stale outside current coverage. There is no separate first-contact or `metByFaction` system:
faction identity is public, while foreign government, economy, technology, leadership, and
diplomacy facts are governed by intel bundles.

## Sensors, coverage, and command links

Sensor suites are data-driven in `SENSOR_SUITE_DEFINITIONS`. Planetary capitals, listening stations,
online starbases and their sensor buildings, and operational ship modules contribute sources.
Different range bands reveal different bundles; military sensors can be restricted to military
contacts, while science and civilian sensors expose different field sets.

Nebula systems block propagation across their boundary, so a remote source covers the near side but
not the system inside. A source located inside a nebula covers only its own system.

Command links use the same evaluated source network but are distinct from observation. Planet and
starbase sources provide authority; mobile ship sources relay only when their coverage overlaps an
authority network. Server command handlers call `hasCommandLink` before accepting remote fleet or
planet orders.

`refreshIntelligence` records newly observed truth into the persistent faction store.
`getKnownStarIds`, `getCurrentStarIds`, `getKnownLanePairs`, and `getKnownSystemOwner` are derived
from those observations. [`server/game/visibility.ts`](../../server/game/visibility.ts) remains as a
compatibility facade for older call sites; new intelligence behavior belongs in `intelligence.ts`.

## Snapshot behavior

Snapshots materialize entities from the requesting perspective. Observers receive current truth;
faction players receive only known fields, marked current or stale. Unknown structured fields are
omitted rather than emitted as empty arrays, because even an array length can leak information.
Client helpers in [`src/game/ClientIntelligence.ts`](../../src/game/ClientIntelligence.ts) interpret
these sparse views for scenes and panels.

## How to extend / rules

- Add or tune sensor behavior in `SENSOR_SUITE_DEFINITIONS`; do not hard-code a new vision radius in a
  scene or command handler.
- Assign new truth fields to an `IntelBundleId`, then grant that bundle or explicit field from the
  intended sensor bands.
- Preserve stored observations when current coverage disappears so values correctly become stale.
- Never enumerate unknown truth-side collection members into a wire view.
- Visibility- or sensor-affecting state changes must invalidate/refresh intelligence before updates
  are broadcast.
- New persistent intelligence fields need bootstrap and normalization defaults.

## Key files

- Map data: [`src/data/GalaxyMap.ts`](../../src/data/GalaxyMap.ts),
  [`src/data/StarMap.ts`](../../src/data/StarMap.ts),
  [`src/data/Hyperlanes.ts`](../../src/data/Hyperlanes.ts).
- Intel model: [`src/data/Intelligence.ts`](../../src/data/Intelligence.ts).
- Server evaluation: [`server/game/intelligence.ts`](../../server/game/intelligence.ts).
- Snapshot materialization: [`server/game/snapshot.ts`](../../server/game/snapshot.ts).
- Client reads: [`src/game/ClientIntelligence.ts`](../../src/game/ClientIntelligence.ts).
- Tests: [`server/tests/intelligence.test.ts`](../../server/tests/intelligence.test.ts).
