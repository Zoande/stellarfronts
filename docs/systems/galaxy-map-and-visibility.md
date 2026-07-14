# Galaxy, Map & Visibility

The galaxy is a deterministic procedural starfield connected by hyperlanes, with per-faction fog of
war. Generation config is [`src/data/GalaxyMap.ts`](../../src/data/GalaxyMap.ts); stars/planets are in
[`src/data/StarMap.ts`](../../src/data/StarMap.ts); lanes in
[`src/data/Hyperlanes.ts`](../../src/data/Hyperlanes.ts); factions and visibility math in
[`src/data/Factions.ts`](../../src/data/Factions.ts); server-side discovery in
[`server/game/visibility.ts`](../../server/game/visibility.ts).

## Generation

`GALAXY_MAP` ([`src/data/GalaxyMap.ts`](../../src/data/GalaxyMap.ts)) defines a deterministic galaxy:
`starCount` 500, `seed` 42, a 4-arm spiral shape, minimum star spacing, and camera limits. Generation
is seeded so the same game seed reproduces the same galaxy. Each star carries planet configs
(`StarMap.ts`); planet habitability/types drive colonization potential.

Factions: `FACTION_COUNT` is 15 ([`src/data/Factions.ts`](../../src/data/Factions.ts)). `buildFactions`
assigns spatially distributed home stars and a color palette; `buildHomeSystemOwnership` seeds initial
ownership. The 15 seeded `color_*` accounts map one-to-one onto these faction slots.

## Hyperlanes & adjacency

Stars are linked by undirected hyperlanes, stored on `GameState` as `hyperlanes` (id pairs) with a
derived `adjacency` list. Fleets travel **only** along lanes; in-system movement is separate (see
[ships-fleets-starbases.md](ships-fleets-starbases.md)). System geometry (planet orbits, lane entry/
exit, staging) comes from [`src/data/SystemCoordinates.ts`](../../src/data/SystemCoordinates.ts).

## Visibility & fog of war

Two related notions ([`server/game/visibility.ts`](../../server/game/visibility.ts)):

- **Currently visible** — `computeCurrentVisibleSet` unions discovery from a faction's home star,
  every *online* starbase it owns, and every fleet it owns (including both endpoints while in
  transit). Each source reveals stars within `DISCOVERY_JUMPS` (2) hops via
  `computeVisibleStarIds(adjacency, source, DISCOVERY_JUMPS)`. (The function's own default cap is
  `FOG_OF_WAR_MAX_JUMPS` = 3 when no override is passed; the server passes 2.)
- **Discovered (known)** — `refreshDiscovery` folds the visible set into a **monotonic**
  `discoveredByFaction` record: once seen, a system stays known. It also records
  `lastKnownOwnershipByFaction` (what you last saw owning a star) so fog shows stale-but-plausible
  ownership.

**First contact ("met")** is derived from discovery: if faction A has ever discovered a star owned by
B, they are recorded as met — symmetrically — in `metByFaction` (`markFactionsMet`). "Met" gates
cross-faction migration and some diplomacy.

The snapshot/view builders translate these into what each client receives: full data for visible
systems, name-only stubs for discovered-but-not-visible systems, redaction for the rest, and
lane/fleet/starbase filtering by visibility. See
[`../server/protocol-and-snapshots.md`](../server/protocol-and-snapshots.md).

## How to extend / rules

- Galaxy shape/size is data — change `GALAXY_MAP`, not generation call sites.
- Discovery records are **monotonic**; preserve that (don't remove from `discoveredByFaction` outside
  the explicit admin `forget`/`reset_visibility` paths).
- Anything visibility-affecting (a fleet moves, a starbase goes online/offline) must trigger
  `refreshDiscovery` so snapshots stay correct — the tick already does this when fleets move.
- New per-faction visibility records (like `metByFaction`) are `Record<string, …>` keyed by faction
  id string; backfill them on load.

## Key files

- Config: [`src/data/GalaxyMap.ts`](../../src/data/GalaxyMap.ts).
- Stars/planets: [`src/data/StarMap.ts`](../../src/data/StarMap.ts),
  [`src/data/SystemCoordinates.ts`](../../src/data/SystemCoordinates.ts).
- Lanes: [`src/data/Hyperlanes.ts`](../../src/data/Hyperlanes.ts).
- Factions/visibility math: [`src/data/Factions.ts`](../../src/data/Factions.ts).
- Server discovery: [`server/game/visibility.ts`](../../server/game/visibility.ts).
