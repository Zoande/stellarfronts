export type AdminCommandCategory =
  | "help"
  | "time"
  | "save"
  | "navigation"
  | "ownership"
  | "economy"
  | "technology"
  | "designs"
  | "fleets"
  | "doctrine"
  | "combat"
  | "starbases"
  | "events";

export interface AdminCommandContext {
  currentStarId?: number | null;
  selectedFleetId?: string | null;
  selectedFleetIds?: string[];
  selectedShipId?: string | null;
  selectedStarbaseId?: string | null;
  selectedPlanetId?: string | null;
  perspectiveOwnerId?: number | null;
}

export interface AdminCommandRow {
  [key: string]: string | number | boolean | null | undefined;
}

export interface AdminCommandResult {
  type: "adminCommandResult";
  requestId?: string;
  ok: boolean;
  input?: string;
  command?: string;
  message: string;
  rows?: AdminCommandRow[];
  changed?: string[];
  requiresConfirmation?: boolean;
  destructive?: boolean;
}

export interface AdminCommandDefinition {
  name: string;
  aliases?: string[];
  category: AdminCommandCategory;
  syntax: string;
  description: string;
  examples?: string[];
  destructive?: boolean;
  localOnly?: boolean;
}

export interface ParsedAdminCommand {
  input: string;
  name: string;
  canonicalName: string;
  args: string[];
  options: Record<string, string | boolean>;
  flags: Set<string>;
  definition?: AdminCommandDefinition;
}

function command(
  name: string,
  category: AdminCommandCategory,
  syntax: string,
  description: string,
  options: Pick<AdminCommandDefinition, "aliases" | "examples" | "destructive" | "localOnly"> = {},
): AdminCommandDefinition {
  return { name, category, syntax, description, ...options };
}

export const ADMIN_COMMAND_DEFINITIONS: AdminCommandDefinition[] = [
  command("help", "help", "help [command|category]", "Show command help.", { aliases: ["?"] }),
  command("commands", "help", "commands [category]", "List available commands."),
  command("inspect", "help", "inspect <fleet|ship|starbase|planet|system|owner> <id>", "Inspect one entity."),
  command("list_fleets", "help", "list_fleets [system=<id|selected|current>] [owner=<id|me|all>]", "List fleets."),
  command("list_ships", "help", "list_ships <fleetId|selected>", "List ships in a fleet."),
  command("list_designs", "help", "list_designs [owner=<id|me|all>]", "List ship designs."),
  command("list_starbases", "help", "list_starbases [system=<id|selected|current>] [owner=<id|me|all>]", "List starbases."),
  command("list_planets", "help", "list_planets [system=<id|selected|current>]", "List planets."),
  command("where", "help", "where <entityId>", "Find where an entity is located."),
  command("combat_status", "help", "combat_status [system=<id|current>]", "Summarize fleet/starbase combat state."),
  command("economy_status", "help", "economy_status <owner|me|all>", "Summarize faction economy state."),
  command("tech_status", "technology", "tech_status <owner|me|all>", "Summarize faction technology progress."),
  command("state_summary", "help", "state_summary", "Summarize global game state."),

  command("tick_size", "time", "tick_size <days>", "Set game days advanced per simulation tick."),
  command("tick_speed", "time", "tick_speed <seconds>", "Set real seconds per simulation tick; decimals are supported."),
  command("pause", "time", "pause", "Pause simulation advancement."),
  command("resume", "time", "resume", "Resume simulation advancement."),
  command("step", "time", "step [ticks=1]", "Advance one or more configured ticks while paused."),
  command("advance_hours", "time", "advance_hours <hours> [--confirm]", "Force-advance the simulation by game hours.", { destructive: true }),
  command("advance_days", "time", "advance_days <days> [--confirm]", "Force-advance the simulation by game days.", { destructive: true }),
  command("set_year", "time", "set_year <year> [--confirm]", "Set the game clock year.", { destructive: true }),
  command("speed_preset", "time", "speed_preset <1-9>", "Apply a testing speed preset."),

  command("save", "save", "save", "Save game state now."),
  command("reset_galaxy", "save", "reset_galaxy [--confirm]", "Reset to a fresh generated galaxy.", { destructive: true }),
  command("clear_recent_combat", "save", "clear_recent_combat", "Clear recent combat effect history."),
  command("clear_orders", "save", "clear_orders [fleetId|all]", "Clear tactical orders."),
  command("clear_fleet_movement", "save", "clear_fleet_movement <fleetId|selected|all>", "Stop fleet movement."),
  command("clear_planet_queue", "save", "clear_planet_queue <planetId|selected|all_owned> [--confirm]", "Clear planet construction queues.", { destructive: true }),
  command("clear_starbase_queue", "save", "clear_starbase_queue <starbaseId|selected|all_owned> [--confirm]", "Clear starbase construction and ship queues.", { destructive: true }),

  command("goto", "navigation", "goto <system|fleet|starbase> <id|selected|current>", "Move the client camera/view.", { localOnly: true }),
  command("select", "navigation", "select <fleet|starbase|planet> <id>", "Select a client entity.", { localOnly: true }),
  command("render_debug", "navigation", "render_debug <on|off>", "Toggle local render debug overlays.", { localOnly: true }),
  command("show_ranges", "navigation", "show_ranges <on|off>", "Toggle local range overlays.", { localOnly: true }),
  command("show_footprints", "navigation", "show_footprints <on|off>", "Toggle local footprint overlays.", { localOnly: true }),
  command("show_labels", "navigation", "show_labels <on|off>", "Toggle local labels.", { localOnly: true }),
  command("effect_test", "navigation", "effect_test <laser|missile|point_defense> <sourceId> <targetId> [count=1]", "Spawn local/server test combat effects."),

  command("intel_inspect", "ownership", "intel_inspect <owner|me> [kind] [id]", "Inspect stored intelligence and current sensor grants."),
  command("intel_report", "ownership", "intel_report <owner|me> <star|system|planet|starbase|fleet|ship|faction> <id> [fields=a,b]", "Add a dated one-shot intelligence report."),
  command("intel_revoke", "ownership", "intel_revoke <owner|me> [kind] [id] [--confirm]", "Revoke stored intelligence reports.", { destructive: true }),
  command("sensor_debug", "ownership", "sensor_debug <owner|me>", "Inspect sources, bands, grants, command links, and nebula blocks."),
  command("own_system", "ownership", "own_system <systemId|selected|current> <owner|none>", "Set system ownership."),
  command("set_home_system", "ownership", "set_home_system <owner> <systemId> [--confirm]", "Move a faction home-system pointer.", { destructive: true }),

  command("add_resource", "economy", "add_resource <owner|me> <resource|all> <amount>", "Add resources to a faction."),
  command("set_resource", "economy", "set_resource <owner|me> <resource|all> <amount>", "Set faction resources."),
  command("complete_planet_queue", "economy", "complete_planet_queue <planetId|selected|all_owned>", "Complete planet construction queues."),
  command("complete_starbase_queue", "economy", "complete_starbase_queue <starbaseId|selected|all_owned>", "Complete starbase queues."),
  command("set_population", "economy", "set_population <planetId|selected> <amount>", "Set planet population."),
  command("add_population", "economy", "add_population <planetId|selected> <amount>", "Add planet population."),
  command("set_habitability", "economy", "set_habitability <planetId|selected> <0-100>", "Set planet habitability."),
  command("set_stability", "economy", "set_stability <planetId|selected> <0-100>", "Apply a test stability modifier."),
  command("build_district_now", "economy", "build_district_now <planetId|selected> <districtKind>", "Build a district immediately."),
  command("build_planet_building_now", "economy", "build_planet_building_now <planetId|selected> <area> <slotIndex> <buildingKind> [subDistrictIndex]", "Build a planet building immediately."),

  command("set_active_tech", "technology", "set_active_tech <owner|me> <techId>", "Set the active research technology."),
  command("add_tech_progress", "technology", "add_tech_progress <owner|me> <techId> <amount>", "Add active research progress to a technology."),
  command("complete_tech", "technology", "complete_tech <owner|me> <techId>", "Complete a technology immediately."),

  command("create_design", "designs", "create_design <owner|me> <shipKind> name=\"<name>\" weapon_sections=<ids> weapons=<ids> defenses=<ids> utility=<ids|null>", "Create a ship design."),
  command("clone_design", "designs", "clone_design <designId> <owner|me> [name=\"<name>\"]", "Clone a ship design."),
  command("set_design_modules", "designs", "set_design_modules <designId> weapon_sections=<ids> weapons=<ids> defenses=<ids> utility=<ids|null>", "Change ship design modules."),
  command("delete_design", "designs", "delete_design <designId> [--confirm]", "Delete a ship design.", { destructive: true }),

  command("create_fleet", "fleets", "create_fleet <systemId|selected|current> <owner|me> [x,z] [name=\"<name>\"]", "Create an empty fleet."),
  command("create_ship", "fleets", "create_ship <systemId|fleetId|selected|current> <owner|me> <designId|default> [count=1] [x,z]", "Create ships in a fleet/system."),
  command("delete_ship", "fleets", "delete_ship <shipId> [--confirm]", "Delete a ship.", { destructive: true }),
  command("delete_fleet", "fleets", "delete_fleet <fleetId|selected> [--confirm]", "Delete a fleet and its ships.", { destructive: true }),
  command("kill_ship", "fleets", "kill_ship <shipId> [--confirm]", "Set a ship hull to zero.", { destructive: true }),
  command("kill_fleet", "fleets", "kill_fleet <fleetId|selected> [--confirm]", "Kill every ship in a fleet.", { destructive: true }),
  command("repair_ship", "fleets", "repair_ship <shipId>", "Repair a ship."),
  command("repair_fleet", "fleets", "repair_fleet <fleetId|selected>", "Repair a fleet."),
  command("damage_ship", "fleets", "damage_ship <shipId> <shield|armor|hull|all> <amount|percent%>", "Damage a ship."),
  command("damage_fleet", "fleets", "damage_fleet <fleetId|selected> <shield|armor|hull|all> <amount|percent%>", "Damage every ship in a fleet."),
  command("set_ship_health", "fleets", "set_ship_health <shipId> shield=<value|percent%> armor=<value|percent%> hull=<value|percent%>", "Set ship health layers."),
  command("set_fleet_health", "fleets", "set_fleet_health <fleetId|selected> shield=<percent%> armor=<percent%> hull=<percent%>", "Set fleet health layers."),
  command("move_fleet", "fleets", "move_fleet <fleetId|selected> <systemId> [x,z]", "Issue a normal move order."),
  command("teleport_fleet", "fleets", "teleport_fleet <fleetId|selected> <systemId|current> [x,z]", "Teleport a fleet."),
  command("set_fleet_position", "fleets", "set_fleet_position <fleetId|selected> <x,z>", "Set fleet system-plane position."),
  command("set_fleet_owner", "fleets", "set_fleet_owner <fleetId|selected> <owner>", "Change fleet and ship owner."),
  command("split_fleet", "fleets", "split_fleet <fleetId|selected> <count|shipId,shipId,...>", "Split ships into a new fleet."),
  command("merge_fleets", "fleets", "merge_fleets <targetFleetId> <sourceFleetId,...>", "Merge fleets immediately."),
  command("set_cooldowns", "fleets", "set_cooldowns <fleetId|shipId|starbaseId|selected> <ready|hours>", "Set weapon cooldowns."),

  command("set_fleet_doctrine", "doctrine", "set_fleet_doctrine <fleetId|selected> [engagement=<avoid|defendSystem|engageSystem>] [doctrine=<artillery|line|assault|escort>] [retreat=<fightOn|balanced|preserveFleet|avoidLosses>]", "Set fleet automation controls."),
  command("set_retreat_destination", "doctrine", "set_retreat_destination <fleetId|selected> <nearest_friendly_starbase|selected_system> [systemId]", "Set retreat destination."),
  command("order_fleet", "doctrine", "order_fleet <fleetId|selected> <hold|retreat|attack|guard|move> [...]", "Issue a tactical order."),
  command("clear_order", "doctrine", "clear_order <fleetId|selected>", "Clear a tactical order."),

  command("start_duel", "combat", "start_duel <systemId|current> <ownerA> <ownerB> [designA=default] [designB=default] [countA=1] [countB=1] [distance=40]", "Spawn two hostile test fleets."),
  command("spawn_encounter", "combat", "spawn_encounter <skirmish|artillery_vs_starbase|assault_vs_line|retreat_test|orbit_defense> <systemId|current>", "Spawn a named combat scenario."),
  command("force_attack", "combat", "force_attack <fleetId|selected> <targetFleetId|starbaseId>", "Force a fleet to attack."),
  command("stop_combat", "combat", "stop_combat <fleetId|selected|system|all>", "Clear combat orders/status."),
  command("set_weapon_cooldown", "combat", "set_weapon_cooldown <shipId|starbaseId> <mountIndex|all> <ready|hours>", "Set a weapon cooldown."),
  command("fire_test_contact", "combat", "fire_test_contact <sourceId> <targetId> <weaponId> [hit|miss|dodge]", "Add a recent combat contact for visual testing."),

  command("create_starbase", "starbases", "create_starbase <systemId|selected|current> <owner|me> [level=outpost|starbase|starhold|starFortress]", "Create or replace a starbase."),
  command("delete_starbase", "starbases", "delete_starbase <starbaseId|selected> [--confirm]", "Delete a starbase.", { destructive: true }),
  command("upgrade_starbase_now", "starbases", "upgrade_starbase_now <starbaseId|selected> [level]", "Upgrade a starbase immediately."),
  command("set_starbase_position", "starbases", "set_starbase_position <starbaseId|selected> <x,z>", "Set starbase system position."),
  command("repair_starbase", "starbases", "repair_starbase <starbaseId|selected>", "Repair a starbase."),
  command("damage_starbase", "starbases", "damage_starbase <starbaseId|selected> <shield|armor|hull|all> <amount|percent%>", "Damage a starbase."),
  command("set_starbase_health", "starbases", "set_starbase_health <starbaseId|selected> shield=<value|percent%> armor=<value|percent%> hull=<value|percent%>", "Set starbase health layers."),
  command("add_starbase_building", "starbases", "add_starbase_building <starbaseId|selected> <slotIndex> <buildingKind>", "Add a starbase building immediately."),
  command("remove_starbase_building", "starbases", "remove_starbase_building <starbaseId|selected> <slotIndex>", "Remove a starbase building."),

  command("trigger_event", "events", "trigger_event <owner|me> <eventId>", "Queue an event for a faction (e.g. leaderRecruitmentOffer)."),
  command("set_situation", "events", "set_situation <owner|me> <resource> <progress 0-100>", "Set a resource-shortage situation's progress."),
  command("lose_fleet", "events", "lose_fleet <fleetId|selected> [days]", "Send a fleet missing in transit."),
];

const DEFINITIONS_BY_NAME = new Map<string, AdminCommandDefinition>();
for (const definition of ADMIN_COMMAND_DEFINITIONS) {
  DEFINITIONS_BY_NAME.set(definition.name, definition);
  for (const alias of definition.aliases ?? []) DEFINITIONS_BY_NAME.set(alias, definition);
}

export function getAdminCommandDefinition(name: string): AdminCommandDefinition | undefined {
  return DEFINITIONS_BY_NAME.get(name.trim().toLowerCase());
}

export function getAdminCommandNames(): string[] {
  return ADMIN_COMMAND_DEFINITIONS.map((definition) => definition.name);
}

export function isLocalAdminCommand(name: string): boolean {
  return getAdminCommandDefinition(name)?.localOnly === true;
}

export function tokenizeAdminCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of input.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current.length > 0) tokens.push(current);
  return tokens;
}

export function parseAdminCommand(input: string): ParsedAdminCommand | null {
  const tokens = tokenizeAdminCommand(input);
  if (tokens.length === 0) return null;
  const name = tokens[0].toLowerCase();
  const definition = getAdminCommandDefinition(name);
  const args: string[] = [];
  const options: Record<string, string | boolean> = {};
  const flags = new Set<string>();

  for (const token of tokens.slice(1)) {
    if (token.startsWith("--")) {
      const flag = token.slice(2);
      if (flag) {
        flags.add(flag);
        options[flag] = true;
      }
      continue;
    }
    const equalsIndex = token.indexOf("=");
    if (equalsIndex > 0) {
      const key = token.slice(0, equalsIndex);
      const value = token.slice(equalsIndex + 1);
      options[key] = value;
      continue;
    }
    args.push(token);
  }

  return {
    input,
    name,
    canonicalName: definition?.name ?? name,
    args,
    options,
    flags,
    definition,
  };
}

export function formatAdminCommandHelp(definition: AdminCommandDefinition): AdminCommandRow {
  return {
    command: definition.name,
    category: definition.category,
    syntax: definition.syntax,
    description: definition.description,
    destructive: definition.destructive === true,
    local: definition.localOnly === true,
  };
}
