# Admin Commands Reference

In-game debug/test commands available to the `admin` account via the Admin Command panel. The
**authoritative catalog** is `ADMIN_COMMAND_DEFINITIONS` in
[`src/game/AdminCommands.ts`](../../src/game/AdminCommands.ts) (each entry has a name, category,
syntax, description, and flags); server execution lives in
[`server/game/admin-commands.ts`](../../server/game/admin-commands.ts). This page summarizes by
category — consult the source for exact, current syntax.

## How they run

- The client parses input and sends an `adminCommand` `ClientCommand`
  ([`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts)); the server validates the account is
  admin and executes, replying with an `adminCommandResult` (matched by request id).
- Commands flagged **`localOnly`** (e.g. `goto`, `select`, `show_labels`) act on the local client
  view and don't mutate server state.
- Commands flagged **`destructive`** (e.g. `reset_galaxy`, `advance_days`, `set_year`,
  `clear_planet_queue`) require an explicit `--confirm`.
- The UI panel is [`src/ui/AdminCommandPanel.ts`](../../src/ui/AdminCommandPanel.ts).

## Categories

| Category | Examples | Purpose |
| --- | --- | --- |
| **help** | `help`, `commands`, `inspect`, `list_fleets`, `list_ships`, `list_designs`, `list_starbases`, `list_planets`, `where`, `combat_status`, `economy_status`, `state_summary` | Inspect entities and summarize game state. |
| **time** | `tick_size`, `tick_speed`, `pause`, `resume`, `step`, `advance_hours`, `advance_days`, `set_year`, `speed_preset` | Control the clock and force-advance the simulation. |
| **save** | `save`, `reset_galaxy`, `clear_recent_combat`, `clear_orders`, `clear_fleet_movement`, `clear_planet_queue`, `clear_starbase_queue` | Persistence and queue/order cleanup. |
| **navigation** (localOnly) | `goto`, `select`, `render_debug`, `show_ranges`, `show_footprints`, `show_labels`, `effect_test` | Move the client view and toggle debug overlays. |
| **ownership** | `discover`, `forget`, `reveal_all`, `reset_visibility` | Manipulate fog-of-war / discovery for a faction. |
| **economy** | (see source) | Adjust faction stockpiles / economy for testing. |
| **technology** | `tech_status`, … | Inspect/force research progress and unlocks. |
| **designs** | (see source) | Inspect/spawn ship designs. |
| **fleets** | (see source) | Spawn/move/manipulate fleets and ships. |
| **doctrine** | (see source) | Set fleet doctrine/tactical behavior for testing. |
| **combat** | (see source) | Trigger/inspect combat scenarios. |
| **starbases** | (see source) | Build/upgrade/manipulate starbases. |
| **events** | (see source) | Trigger/resolve events and situations. |

> The category list itself is the `AdminCommandCategory` union at the top of
> [`src/game/AdminCommands.ts`](../../src/game/AdminCommands.ts). Because the catalog evolves, treat
> that file as the source of truth and this page as orientation.
