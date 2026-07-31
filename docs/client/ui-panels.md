# UI Panels

In-game UI is **DOM overlaid on the BabylonJS canvas**, not React. The HUD frames the view; panels and
modals open on top. All live in [`src/ui/`](../../src/ui/).

## The pattern

A panel is a class that:

1. Builds its own DOM into an overlay root.
2. Is constructed/opened from [`src/game/boot.ts`](../../src/game/boot.ts) (often via the HUD
   sidebar).
3. **Subscribes** to a server detail scope for its data (`subscribeDetail` on the
   `GameServerClient` — see [server-client-and-details.md](server-client-and-details.md)) and
   re-renders when the payload changes.
4. Sends `ClientCommand`s for user actions (e.g. build, move, trade).
5. Releases its subscription and DOM on close.

Shared helpers: [`panelTheme.ts`](../../src/ui/panelTheme.ts) (styling),
[`panelDomState.ts`](../../src/ui/panelDomState.ts) (scroll capture/restore, an interaction gate), and
[`FloatingTooltipManager.ts`](../../src/ui/FloatingTooltipManager.ts) (tooltips).

## HUD & modals

- [`HudOverlay.ts`](../../src/ui/HudOverlay.ts) — header (clock/speed/exit), bottom economy/population
  bar, centered compact Dark Matter resource, sidebar of panel buttons, view toggles (hyperlanes,
  ownership, labels, …), notifications, and the connected-system navigation list.
- [`EventModal.ts`](../../src/ui/EventModal.ts) / [`SituationModal.ts`](../../src/ui/SituationModal.ts)
  — blocking decision/condition modals (see [events-and-situations.md](../systems/events-and-situations.md)).
- [`LoginOverlay.ts`](../../src/ui/LoginOverlay.ts) — in-view login overlay.
- [`SelectionPanel.ts`](../../src/ui/SelectionPanel.ts) — selected fleet/entity actions, fleet route
  progress, and the Dark Matter travel-boost toggle.

## Panel catalog

| Panel | System | Sends (examples) |
| --- | --- | --- |
| [CelestialObjectPanel.ts](../../src/ui/CelestialObjectPanel.ts) | Planet/star detail, economy, construction, multi-species job locks | `buildDistrict`, `buildPlanetBuilding`, `upgradePlanetBuilding`, `setPlanetJobLock`, `setUrbanSubDistrict`, `cancelPlanetConstruction`, `skipPlanetConstruction` |
| [PlanetOperationsPanel.ts](../../src/ui/PlanetOperationsPanel.ts) | Owned-planet operations | planet construction commands |
| [FleetManagerPanel.ts](../../src/ui/FleetManagerPanel.ts) | Fleets + ship designer | fleet orders, `buildStarbaseShip`, `upgradeShip`, `saveShipDesign`, `setFleetCombatSettings` |
| [StarbasePanel.ts](../../src/ui/StarbasePanel.ts) | Starbase stats/queues | `buildStarbaseBuilding`, `upgradeStarbase` |
| [MarketPanel.ts](../../src/ui/MarketPanel.ts) | Market prices/trade | `marketTrade`, `addMarketAutoTrade`, `removeMarketAutoTrade` |
| [TechnologyPanel.ts](../../src/ui/TechnologyPanel.ts) | Tech tree | `setActiveTechnology` |
| [LeadersPanel.ts](../../src/ui/LeadersPanel.ts) | Leaders | `recruitLeader`, `assignLeader`, `dismissLeader` |
| [GovernmentPanel.ts](../../src/ui/GovernmentPanel.ts) | Laws/positions | `setGovernmentLaw` |
| [SocietyPanel.ts](../../src/ui/SocietyPanel.ts) | Species/rights | `setSpeciesRights` |
| [DiplomacyPanel.ts](../../src/ui/DiplomacyPanel.ts) | Relations | `declareWar`, `proposeTreaty`, `proposePeace`, `respondDiplomacyProposal`, `setBorderPolicy`, `sendDiplomacyMessage` |
| [AdminCommandPanel.ts](../../src/ui/AdminCommandPanel.ts) | Admin (admin accounts) | `adminCommand` |

Exact command shapes are in the `ClientCommand` union
([`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts)).

Planet Operations is keyed by owned system rather than planet ownership, so uninhabited planets in
owned systems remain visible. Its rows use the founding species' effective habitability and typed
eligibility metadata to show `Colonizable`, `Restricted world`, or `Unsuitable`. Capital labels,
descriptions, jobs, housing, and local modifiers come from the same authored tier helpers used by
the economy; the capital downgrade control is disabled at every level.

## How to extend / rules

- Follow the subscribe-render-command-cleanup lifecycle; wire the new panel into `src/game/boot.ts`.
- Read defensively (an older server may omit a new field — default it; see
  [`../must-read/04-backward-compatibility.md`](../must-read/04-backward-compatibility.md)).
- Use `panelTheme`/`panelDomState`/`FloatingTooltipManager` rather than reinventing styling, scroll
  handling, or tooltips.
- Actions are requests: the panel sends a command and waits for the next snapshot/detail to reflect
  the result — don't mutate authoritative state locally.

## Key files

- HUD/panels/modals: [`src/ui/`](../../src/ui/).
- Composition root: [`src/game/boot.ts`](../../src/game/boot.ts).
- Command types: [`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts).
