// =============================================================================
// Admin command execution — extracted from server/index.ts
//
// executeAdminCommand is the (socket-free) engine behind the admin console: it
// resolves tokens, mutates RuntimeContext, and returns an AdminCommandResult-ish
// payload. The socket dispatch (handleAdminCommand) stays in index.ts. Orchestration
// callbacks it can't own (advanceState/syncClockSpeedFields/broadcastSnapshots/
// createInitialState/recalculate/refresh/discovery) are reached via ctx methods.
// =============================================================================

import {
  RESOURCE_KINDS,
  BUILDING_KINDS,
  progressPlanetConstructionQueue,
  recalculatePlanetStateEconomy,
} from "../../src/data/Economy";
import type {
  BuildingKind,
  BuildingSlotArea,
  DistrictKind,
  PlanetState,
  ResourceKind,
} from "../../src/data/Economy";
import { applyPlanetStatesToStars } from "../../src/data/StarMap";
import {
  STARBASE_LEVEL_DEFINITIONS,
  calculateStarbaseEconomy,
  createEmptyStarbaseSlots,
  isStarbaseBuildingKind,
  progressStarbaseConstructionQueue,
} from "../../src/data/Starbase";
import type { StarbaseBuildingKind, StarbaseLevel, StarbaseShipKind } from "../../src/data/Starbase";
import {
  calculateShipDesignStats,
  getShipDesignLayout,
  isKnownShipKind,
  normalizeShipDesign,
  SHIP_HULL_DEFINITIONS,
} from "../../src/data/ShipDesigns";
import { getSystemStarbasePosition, SYSTEM_FLEET_Y } from "../../src/data/SystemCoordinates";
import {
  TECHNOLOGY_BY_ID,
  TECHNOLOGY_DEFINITIONS,
  createEmptyTechProgress,
  getMissingPrerequisites,
  isTechnologyCompleted,
} from "../../src/data/Technology";
import type { TechId } from "../../src/data/Technology";
import { SHORTAGE_SITUATION_ID, situationInstanceId } from "../../src/data/Situations";
import { getEventDefinition, LEADER_OFFER_EVENT_ID } from "../../src/data/Events";
import { computeVisibleStarIds } from "../../src/data/Factions";
import type { GalaxyPerspective } from "../../src/data/Factions";
import { HUMAN_SPECIES_ID } from "../../src/data/Species";
import { getFleetTacticalRadius } from "../../src/game/tacticalFormation";
import { gameYearToWeekIndex } from "../../src/game/GameTime";
import {
  ADMIN_COMMAND_DEFINITIONS,
  formatAdminCommandHelp,
  getAdminCommandDefinition,
} from "../../src/game/AdminCommands";
import type { AdminCommandContext, AdminCommandResult, AdminCommandRow, ParsedAdminCommand } from "../../src/game/AdminCommands";
import type { ClientCommand, ServerStarbase, ServerUpdateField } from "../../src/game/GameProtocol";
import { getWeaponId } from "./combat";
import { saveState } from "./persistence";
import { RECENT_COMBAT_CONTACT_HISTORY, DISCOVERY_JUMPS } from "./constants";
import { clamp, systemCenterPosition, cloneSystemPosition } from "./pure-helpers";
import { normalizeCombatStance, isFleetBehavior, isFleetChasePolicy, isFleetRetreatPolicy, isDistrictKind, isValidSlotIndex } from "./validators";
import {
  getFactionTechnology,
  getPlanetDistrictLimitsFromState,
  getPlanetTechnologyModifiers,
  getPlanetSpeciesContext,
  getLeaderDayIndex,
} from "./state-queries";
import { createFactionTechnologyView, completeTechnology, ensureActiveTechnology } from "./research";
import { resolveShipDesign, getShipDesignForShip } from "./ship-designs";
import { createFleet, createShipFromDesign, createDefaultFleetCombatSettings, syncStarbaseCombatHealth } from "./fleet-factory";
import { clearFleetMovementNow, getDefaultMoveDestination, startMoveOrder, removeDestroyedShips, getStarbaseWeaponMounts } from "./fleet-combat";
import { normalizeStarbase, syncFleetMembership, syncSystemOwnershipFromStarbases, syncShipsForDesign } from "./state-normalization";
import { queueFactionEvent, buildLeaderOfferContext, sendFleetMissing } from "./leaders-events";
import type { GameFleet, GameShip, RuntimeContext } from "./types";

const SPEED_PRESETS: Record<string, { tickSizeDays: number; tickSpeedSeconds: number }> = {
  "1": { tickSizeDays: 1 / 24, tickSpeedSeconds: 1 },
  "2": { tickSizeDays: 0.25, tickSpeedSeconds: 1 },
  "3": { tickSizeDays: 1, tickSpeedSeconds: 1 },
  "4": { tickSizeDays: 3, tickSpeedSeconds: 1 },
  "5": { tickSizeDays: 10, tickSpeedSeconds: 1 },
  "6": { tickSizeDays: 30, tickSpeedSeconds: 1 },
  "7": { tickSizeDays: 90, tickSpeedSeconds: 1 },
  "8": { tickSizeDays: 180, tickSpeedSeconds: 1 },
  "9": { tickSizeDays: 360, tickSpeedSeconds: 1 },
};

// === EXTRACTED BODY BELOW (transformed for ctx-first signatures) ===
function commandOption(parsed: ParsedAdminCommand, key: string): string | undefined {
  const value = parsed.options[key];
  return typeof value === "string" ? value : undefined;
}

function numberArg(value: string | undefined, label: string, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`Invalid ${label}.`);
  }
  return number;
}

function integerArg(value: string | undefined, label: string, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): number {
  const number = numberArg(value, label, min, max);
  if (!Number.isInteger(number)) throw new Error(`Invalid ${label}.`);
  return number;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function resolvePerspectiveOwner(context: AdminCommandContext | undefined, perspective: GalaxyPerspective): number {
  if (typeof context?.perspectiveOwnerId === "number") return context.perspectiveOwnerId;
  return perspective.mode === "faction" ? perspective.factionId : 0;
}

function resolveOwnerToken(ctx: RuntimeContext, token: string | undefined, context: AdminCommandContext | undefined, perspective: GalaxyPerspective): number {
  const value = token ?? "me";
  if (value === "me" || value === "selected") return resolvePerspectiveOwner(context, perspective);
  const ownerId = integerArg(value, "owner id", 0, ctx.state.factions.length - 1);
  if (!ctx.state.factions.some((faction) => faction.id === ownerId)) throw new Error("Owner not found.");
  return ownerId;
}

function resolveCurrentStarId(ctx: RuntimeContext, context: AdminCommandContext | undefined): number {
  if (Number.isInteger(context?.currentStarId)) return context!.currentStarId!;
  const selectedFleetId = context?.selectedFleetId ?? context?.selectedFleetIds?.[0];
  const selectedFleet = selectedFleetId ? ctx.state.fleets.find((fleet) => fleet.id === selectedFleetId) : null;
  if (selectedFleet) return selectedFleet.currentStarId;
  return ctx.state.factions[0]?.homeStarId ?? 0;
}

function resolveSystemToken(ctx: RuntimeContext, token: string | undefined, context: AdminCommandContext | undefined): number {
  const value = token ?? "current";
  if (value === "current" || value === "selected") return resolveCurrentStarId(ctx, context);
  const starId = integerArg(value, "system id", 0, ctx.state.stars.length - 1);
  if (!ctx.state.stars[starId]) throw new Error("System not found.");
  return starId;
}

function resolveFleetToken(ctx: RuntimeContext, token: string | undefined, context: AdminCommandContext | undefined): GameFleet {
  const fleetId = token === "selected" || !token ? context?.selectedFleetId ?? context?.selectedFleetIds?.[0] : token;
  const fleet = fleetId ? ctx.state.fleets.find((candidate) => candidate.id === fleetId) : null;
  if (!fleet) throw new Error("Fleet not found.");
  return fleet;
}

function resolveShipToken(ctx: RuntimeContext, token: string | undefined, context: AdminCommandContext | undefined): GameShip {
  const shipId = token === "selected" || !token ? context?.selectedShipId : token;
  const ship = shipId ? ctx.state.ships.find((candidate) => candidate.id === shipId) : null;
  if (!ship) throw new Error("Ship not found.");
  return ship;
}

function resolveStarbaseToken(ctx: RuntimeContext, token: string | undefined, context: AdminCommandContext | undefined): ServerStarbase {
  const starbaseId = token === "selected" || !token ? context?.selectedStarbaseId : token;
  const starbase = starbaseId ? ctx.state.starbases.find((candidate) => candidate.id === starbaseId) : null;
  if (!starbase) throw new Error("Starbase not found.");
  return starbase;
}

function resolvePlanetToken(ctx: RuntimeContext, token: string | undefined, context: AdminCommandContext | undefined): PlanetState {
  const planetId = token === "selected" || !token ? context?.selectedPlanetId : token;
  const planet = planetId ? ctx.state.planetStates.find((candidate) => candidate.id === planetId) : null;
  if (!planet) throw new Error("Planet not found.");
  return planet;
}

function parseSystemPosition(tokens: string[], startIndex: number, fallback: ReturnType<typeof systemCenterPosition>): {
  position: ReturnType<typeof systemCenterPosition>;
  nextIndex: number;
} {
  const token = tokens[startIndex];
  if (!token) return { position: cloneSystemPosition(fallback), nextIndex: startIndex };
  if (token.includes(",")) {
    const [xRaw, zRaw] = token.split(",");
    return {
      position: { x: numberArg(xRaw, "x coordinate"), y: SYSTEM_FLEET_Y, z: numberArg(zRaw, "z coordinate") },
      nextIndex: startIndex + 1,
    };
  }
  const next = tokens[startIndex + 1];
  if (next !== undefined && Number.isFinite(Number(token)) && Number.isFinite(Number(next))) {
    return {
      position: { x: Number(token), y: SYSTEM_FLEET_Y, z: Number(next) },
      nextIndex: startIndex + 2,
    };
  }
  return { position: cloneSystemPosition(fallback), nextIndex: startIndex };
}

function parseLayerValue(value: string, max: number): number {
  if (value.endsWith("%")) {
    return clamp((Number(value.slice(0, -1)) / 100) * max, 0, max);
  }
  return clamp(Number(value), 0, max);
}

type HealthLayer = "shield" | "armor" | "hull" | "all";

function isHealthLayer(value: string): value is HealthLayer {
  return value === "shield" || value === "armor" || value === "hull" || value === "all";
}

function damageShipLayer(ship: GameShip, layer: HealthLayer, amountToken: string): void {
  const apply = (key: "shield" | "armor" | "hull", maxKey: "maxShield" | "maxArmor" | "maxHull") => {
    const max = Math.max(0, ship[maxKey]);
    const amount = amountToken.endsWith("%") ? (Number(amountToken.slice(0, -1)) / 100) * max : Number(amountToken);
    ship[key] = clamp(ship[key] - Math.max(0, amount), 0, max);
    if (key === "hull") ship.hp = ship.hull;
  };
  if (layer === "shield" || layer === "all") apply("shield", "maxShield");
  if (layer === "armor" || layer === "all") apply("armor", "maxArmor");
  if (layer === "hull" || layer === "all") apply("hull", "maxHull");
}

function repairShip(ship: GameShip): void {
  ship.shield = ship.maxShield;
  ship.armor = ship.maxArmor;
  ship.hull = ship.maxHull;
  ship.hp = ship.maxHp;
  ship.weaponCooldowns = {};
}



function createAdminStarbase(ctx: RuntimeContext, starId: number, ownerId: number, level: StarbaseLevel, position = getSystemStarbasePosition()): ServerStarbase {
  const combat = STARBASE_LEVEL_DEFINITIONS[level].combat;
  return normalizeStarbase({
    id: ctx.createRuntimeId("starbase", [ownerId, starId]),
    ownerId,
    starId,
    systemPosition: position,
    status: "online",
    buildProgress: 1,
    shield: combat.maxShield,
    maxShield: combat.maxShield,
    armor: combat.maxArmor,
    maxArmor: combat.maxArmor,
    hull: combat.maxHull,
    maxHull: combat.maxHull,
    weaponCooldowns: {},
    lastShieldDamageAtYear: null,
    level,
    economy: calculateStarbaseEconomy(level),
    buildingSlots: createEmptyStarbaseSlots(),
    constructionQueue: [],
    shipQueue: [],
  });
}

function createAdminFleetWithShips(ctx: RuntimeContext, 
  ownerId: number,
  starId: number,
  designId: string | undefined,
  count: number,
  position: ReturnType<typeof systemCenterPosition>,
): GameFleet {
  const design = resolveShipDesign(ctx.state.shipDesigns, ownerId, "corvette", designId === "default" ? undefined : designId, ctx.state.clock.year);
  const fleet = createFleet(ctx, ownerId, starId, [], ctx.createRuntimeId("fleet", [ownerId, starId]));
  fleet.systemPosition = cloneSystemPosition(position);
  clearFleetMovementNow(ctx, fleet);
  const ships = Array.from({ length: Math.max(1, count) }, () => createShipFromDesign(ctx, ownerId, fleet.id, design));
  fleet.shipIds = ships.map((ship) => ship.id);
  fleet.tacticalRadius = getFleetTacticalRadius(fleet.shipIds.length);
  fleet.speed = Math.min(...ships.map((ship) => ship.speed));
  ctx.state.fleets.push(fleet);
  ctx.state.ships.push(...ships);
  return fleet;
}

function changedResult(ctx: RuntimeContext, 
  message: string,
  changed: ServerUpdateField[],
  rows?: AdminCommandResult["rows"],
): { message: string; changed: ServerUpdateField[]; rows?: AdminCommandResult["rows"] } {
  ctx.hasDirtyState = true;
  return { message, changed: Array.from(new Set(changed)), rows };
}

function forceAdvanceGameDays(ctx: RuntimeContext, days: number): Set<ServerUpdateField> {
  const originalPaused = ctx.state.clock.paused;
  ctx.state.clock.paused = false;
  ctx.syncClockSpeedFields();
  const now = Date.now();
  const realMs = (Math.max(0, days) * Math.max(0.01, ctx.state.clock.tickSpeedSeconds) / Math.max(0.000001, ctx.state.clock.tickSizeDays)) * 1000;
  ctx.state.clock.lastUpdatedAt = now - realMs;
  const changed = ctx.advanceState(now);
  ctx.state.clock.paused = originalPaused;
  ctx.syncClockSpeedFields();
  ctx.state.clock.syncedAtMs = Date.now();
  changed.add("clock");
  return changed;
}

function adminRowsForFleets(fleets: GameFleet[]): AdminCommandRow[] {
  return fleets.map((fleet) => ({
    id: fleet.id,
    owner: fleet.ownerId,
    system: fleet.currentStarId,
    ships: fleet.shipIds.length,
    phase: fleet.phase,
    stance: fleet.combatStance,
    behavior: fleet.combatSettings.behavior,
    status: fleet.combatStatus,
  }));
}

function adminRowsForShips(ships: GameShip[]): AdminCommandRow[] {
  return ships.map((ship) => ({
    id: ship.id,
    owner: ship.ownerId,
    fleet: ship.fleetId,
    design: ship.designId,
    shield: Math.round(ship.shield),
    armor: Math.round(ship.armor),
    hull: Math.round(ship.hull),
  }));
}

function resolveTechnologyToken(token: string | undefined): TechId {
  const value = token?.trim();
  if (!value) throw new Error("Technology id is required.");
  if (TECHNOLOGY_BY_ID[value]) return value;
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  const tech = TECHNOLOGY_DEFINITIONS.find((candidate) => (
    candidate.id.toLowerCase() === normalized
    || candidate.name.toLowerCase() === value.toLowerCase()
    || candidate.name.toLowerCase().replace(/[\s-]+/g, "_") === normalized
  ));
  if (!tech) throw new Error(`Technology "${value}" not found.`);
  return tech.id;
}

function adminRowsForTechnologies(ctx: RuntimeContext, factionId: number, onlyTechId?: TechId): AdminCommandRow[] {
  const view = createFactionTechnologyView(ctx, factionId);
  return view.technologies
    .filter((status) => !onlyTechId || status.id === onlyTechId)
    .map((status) => {
      const tech = TECHNOLOGY_BY_ID[status.id];
      const progressPercent = tech.cost <= 0
        ? 100
        : Math.min(100, (status.progress.totalProgress / tech.cost) * 100);
      const stateLabel = status.completed
        ? "completed"
        : status.active
          ? "active"
          : status.available
            ? "available"
            : "locked";
      return {
        faction: factionId,
        id: tech.id,
        name: tech.name,
        category: tech.category,
        tier: tech.tier,
        state: stateLabel,
        progress: `${progressPercent.toFixed(1)}%`,
        total: Math.round(status.progress.totalProgress),
        cost: tech.cost,
        passive: Math.round(status.progress.passiveProgress),
        passiveCap: Math.round(status.passiveCap),
        multiplier: `${status.evaluation.multiplier.toFixed(2)}x`,
        missing: status.missingPrerequisites.join(", "),
      };
    });
}

function changedTechnologyResult(ctx: RuntimeContext, 
  message: string,
  completedTech: boolean,
  rows?: AdminCommandResult["rows"],
): { message: string; changed: ServerUpdateField[]; rows?: AdminCommandResult["rows"] } {
  const changed: ServerUpdateField[] = ["technologies"];
  if (completedTech) {
    ctx.recalculatePlanetEconomies();
    ctx.refreshFactionEconomyDeltas();
    changed.push("planetStates", "factionEconomies");
  }
  return changedResult(ctx, message, changed, rows);
}

export async function executeAdminCommand(
  ctx: RuntimeContext,
  parsed: ParsedAdminCommand,
  command: Extract<ClientCommand, { type: "adminCommand" }>,
  perspective: GalaxyPerspective,
): Promise<{ message: string; changed?: ServerUpdateField[]; rows?: AdminCommandResult["rows"] }> {
  const context = command.context;
  const name = parsed.canonicalName;

  if (!parsed.definition) throw new Error(`Unknown admin command "${parsed.name}".`);
  if (parsed.definition.localOnly) return { message: `"${name}" is a client-local command.` };

  switch (name) {
    case "help": {
      const key = parsed.args[0];
      if (!key) return { message: "Admin command help.", rows: ADMIN_COMMAND_DEFINITIONS.slice(0, 40).map(formatAdminCommandHelp) };
      const definition = getAdminCommandDefinition(key);
      if (definition) return { message: `Help for ${definition.name}.`, rows: [formatAdminCommandHelp(definition)] };
      return {
        message: `Commands in ${key}.`,
        rows: ADMIN_COMMAND_DEFINITIONS.filter((definition) => definition.category === key).map(formatAdminCommandHelp),
      };
    }
    case "commands": {
      const category = parsed.args[0];
      const definitions = category
        ? ADMIN_COMMAND_DEFINITIONS.filter((definition) => definition.category === category)
        : ADMIN_COMMAND_DEFINITIONS;
      return { message: `${definitions.length} admin commands.`, rows: definitions.map(formatAdminCommandHelp) };
    }
    case "inspect": {
      const kind = parsed.args[0];
      const id = parsed.args[1];
      if (kind === "fleet") return { message: "Fleet.", rows: adminRowsForFleets([resolveFleetToken(ctx, id, context)]) };
      if (kind === "ship") return { message: "Ship.", rows: adminRowsForShips([resolveShipToken(ctx, id, context)]) };
      if (kind === "starbase") {
        const starbase = resolveStarbaseToken(ctx, id, context);
        return { message: "Starbase.", rows: [{ id: starbase.id, owner: starbase.ownerId, system: starbase.starId, level: starbase.level, hull: Math.round(starbase.hull), status: starbase.status }] };
      }
      if (kind === "planet") {
        const planet = resolvePlanetToken(ctx, id, context);
        return { message: "Planet.", rows: [{ id: planet.id, system: planet.starId, index: planet.planetIndex, population: Math.round(planet.population), habitability: planet.habitability, stability: Math.round(planet.economy.stability) }] };
      }
      if (kind === "system") {
        const starId = resolveSystemToken(ctx, id, context);
        const star = ctx.state.stars[starId];
        return { message: "System.", rows: [{ id: star.id, name: star.name, owner: ctx.state.starOwnership[starId] ?? -1, planets: star.system.planets.length, fleets: ctx.state.fleets.filter((fleet) => fleet.currentStarId === starId).length }] };
      }
      if (kind === "owner") {
        const owner = resolveOwnerToken(ctx, id, context, perspective);
        const faction = ctx.state.factions.find((candidate) => candidate.id === owner);
        return { message: "Owner.", rows: [{ id: owner, name: faction?.name ?? "Unknown", homeSystem: faction?.homeStarId ?? null }] };
      }
      throw new Error("Inspect kind must be fleet, ship, starbase, planet, system, or owner.");
    }
    case "list_fleets": {
      const owner = commandOption(parsed, "owner") ?? parsed.args[0];
      const system = commandOption(parsed, "system");
      const ownerFilter = owner && owner !== "all" ? resolveOwnerToken(ctx, owner, context, perspective) : null;
      const systemFilter = system ? resolveSystemToken(ctx, system, context) : null;
      const fleets = ctx.state.fleets.filter((fleet) => (
        (ownerFilter === null || fleet.ownerId === ownerFilter)
        && (systemFilter === null || fleet.currentStarId === systemFilter)
      ));
      return { message: `${fleets.length} fleets.`, rows: adminRowsForFleets(fleets) };
    }
    case "list_ships": {
      const fleet = resolveFleetToken(ctx, parsed.args[0], context);
      return { message: `${fleet.shipIds.length} ships.`, rows: adminRowsForShips(ctx.state.ships.filter((ship) => ship.fleetId === fleet.id)) };
    }
    case "list_designs": {
      const owner = commandOption(parsed, "owner") ?? parsed.args[0];
      const ownerFilter = owner && owner !== "all" ? resolveOwnerToken(ctx, owner, context, perspective) : null;
      const designs = ctx.state.shipDesigns.filter((design) => ownerFilter === null || design.ownerId === ownerFilter);
      return { message: `${designs.length} designs.`, rows: designs.map((design) => ({ id: design.id, owner: design.ownerId, kind: design.shipKind, name: design.name, status: design.status })) };
    }
    case "list_starbases": {
      const owner = commandOption(parsed, "owner");
      const system = commandOption(parsed, "system") ?? parsed.args[0];
      const ownerFilter = owner && owner !== "all" ? resolveOwnerToken(ctx, owner, context, perspective) : null;
      const systemFilter = system ? resolveSystemToken(ctx, system, context) : null;
      const starbases = ctx.state.starbases.filter((starbase) => (
        (ownerFilter === null || starbase.ownerId === ownerFilter)
        && (systemFilter === null || starbase.starId === systemFilter)
      ));
      return { message: `${starbases.length} starbases.`, rows: starbases.map((starbase) => ({ id: starbase.id, owner: starbase.ownerId, system: starbase.starId, level: starbase.level, status: starbase.status, hull: Math.round(starbase.hull) })) };
    }
    case "list_planets": {
      const systemId = resolveSystemToken(ctx, commandOption(parsed, "system") ?? parsed.args[0], context);
      return {
        message: `Planets in system ${systemId}.`,
        rows: ctx.state.planetStates
          .filter((planet) => planet.starId === systemId)
          .map((planet) => ({ id: planet.id, index: planet.planetIndex, habited: planet.isHabited, population: Math.round(planet.population), habitability: planet.habitability })),
      };
    }
    case "where": {
      const id = parsed.args[0];
      const fleet = ctx.state.fleets.find((candidate) => candidate.id === id);
      if (fleet) return { message: "Found fleet.", rows: adminRowsForFleets([fleet]) };
      const ship = ctx.state.ships.find((candidate) => candidate.id === id);
      if (ship) return { message: "Found ship.", rows: adminRowsForShips([ship]) };
      const starbase = ctx.state.starbases.find((candidate) => candidate.id === id);
      if (starbase) return { message: "Found starbase.", rows: [{ id: starbase.id, system: starbase.starId, owner: starbase.ownerId }] };
      const planet = ctx.state.planetStates.find((candidate) => candidate.id === id);
      if (planet) return { message: "Found planet.", rows: [{ id: planet.id, system: planet.starId, index: planet.planetIndex }] };
      throw new Error("Entity not found.");
    }
    case "combat_status": {
      const system = commandOption(parsed, "system") ?? parsed.args[0];
      const systemId = system ? resolveSystemToken(ctx, system, context) : resolveCurrentStarId(ctx, context);
      return {
        message: `Combat status for system ${systemId}.`,
        rows: [
          ...adminRowsForFleets(ctx.state.fleets.filter((fleet) => fleet.currentStarId === systemId)),
          ...ctx.state.starbases.filter((starbase) => starbase.starId === systemId).map((starbase) => ({ id: starbase.id, owner: starbase.ownerId, system: starbase.starId, level: starbase.level, hull: Math.round(starbase.hull), status: starbase.status })),
        ],
      };
    }
    case "economy_status": {
      const ownerArg = parsed.args[0] ?? "me";
      const economies = ownerArg === "all"
        ? ctx.state.factionEconomies
        : ctx.state.factionEconomies.filter((economy) => economy.factionId === resolveOwnerToken(ctx, ownerArg, context, perspective));
      return { message: `${economies.length} economies.`, rows: economies.map((economy) => ({ owner: economy.factionId, ...economy.stockpiles })) };
    }
    case "tech_status": {
      const ownerArg = parsed.args[0] ?? "me";
      const ownerIds = ownerArg === "all"
        ? ctx.state.factions.map((faction) => faction.id)
        : [resolveOwnerToken(ctx, ownerArg, context, perspective)];
      return {
        message: `Technology status for ${ownerIds.length} faction${ownerIds.length === 1 ? "" : "s"}.`,
        rows: ownerIds.flatMap((ownerId) => adminRowsForTechnologies(ctx, ownerId)),
      };
    }
    case "state_summary":
      return {
        message: "State summary.",
        rows: [{
          year: ctx.state.clock.year.toFixed(3),
          systems: ctx.state.stars.length,
          factions: ctx.state.factions.length,
          fleets: ctx.state.fleets.length,
          ships: ctx.state.ships.length,
          starbases: ctx.state.starbases.length,
          combatContacts: ctx.state.recentCombatContacts.length,
        }],
      };
    case "tick_size": {
      ctx.state.clock.tickSizeDays = numberArg(parsed.args[0], "tick size days", 0.000001);
      ctx.syncClockSpeedFields();
      ctx.state.clock.syncedAtMs = Date.now();
      return changedResult(ctx, `Tick size set to ${ctx.state.clock.tickSizeDays} ctx.game days.`, ["clock"]);
    }
    case "tick_speed": {
      ctx.state.clock.tickSpeedSeconds = numberArg(parsed.args[0], "tick speed seconds", 0.01);
      ctx.syncClockSpeedFields();
      ctx.state.clock.syncedAtMs = Date.now();
      return changedResult(ctx, `Tick speed set to ${ctx.state.clock.tickSpeedSeconds} real seconds.`, ["clock"]);
    }
    case "pause":
      ctx.state.clock.paused = true;
      ctx.syncClockSpeedFields();
      ctx.state.clock.syncedAtMs = Date.now();
      return changedResult(ctx, "Simulation paused.", ["clock"]);
    case "resume":
      ctx.state.clock.paused = false;
      ctx.syncClockSpeedFields();
      ctx.state.clock.syncedAtMs = Date.now();
      return changedResult(ctx, "Simulation resumed.", ["clock"]);
    case "step": {
      const ticks = integerArg(parsed.args[0] ?? "1", "ticks", 1, 10000);
      const changed = Array.from(forceAdvanceGameDays(ctx, ctx.state.clock.tickSizeDays * ticks));
      return changedResult(ctx, `Advanced ${ticks} tick(s).`, changed);
    }
    case "advance_hours": {
      const hours = numberArg(parsed.args[0], "hours", 0);
      return changedResult(ctx, `Advanced ${hours} ctx.game hours.`, Array.from(forceAdvanceGameDays(ctx, hours / 24)));
    }
    case "advance_days": {
      const days = numberArg(parsed.args[0], "days", 0);
      return changedResult(ctx, `Advanced ${days} ctx.game days.`, Array.from(forceAdvanceGameDays(ctx, days)));
    }
    case "set_year": {
      ctx.state.clock.year = numberArg(parsed.args[0], "year", 0);
      ctx.state.clock.lastUpdatedAt = Date.now();
      ctx.state.clock.syncedAtMs = ctx.state.clock.lastUpdatedAt;
      ctx.state.clock.lastProcessedPopulationWeek = gameYearToWeekIndex(ctx.state.clock.year);
      ctx.state.clock.lastProcessedLeaderDay = getLeaderDayIndex(ctx.state.clock.year);
      return changedResult(ctx, `Year set to ${ctx.state.clock.year}.`, ["clock"]);
    }
    case "speed_preset": {
      const preset = SPEED_PRESETS[parsed.args[0] ?? ""];
      if (!preset) throw new Error("Speed preset must be 1-9.");
      ctx.state.clock.tickSizeDays = preset.tickSizeDays;
      ctx.state.clock.tickSpeedSeconds = preset.tickSpeedSeconds;
      ctx.state.clock.paused = false;
      ctx.syncClockSpeedFields();
      ctx.state.clock.syncedAtMs = Date.now();
      return changedResult(ctx, `Speed preset ${parsed.args[0]} applied.`, ["clock"]);
    }
    case "save":
      await saveState(ctx);
      return { message: "Game ctx.state saved." };
    case "reset_galaxy": {
      ctx.state = ctx.createInitialState();
      await saveState(ctx);
      ctx.broadcastSnapshots();
      return { message: "Galaxy reset.", changed: ["clock", "visibility", "planetStates", "factionEconomies", "species", "ships", "shipDesigns", "fleets", "starbases", "combatContacts"] };
    }
    case "clear_recent_combat":
      ctx.state.recentCombatContacts = [];
      return changedResult(ctx, "Recent combat contacts cleared.", ["combatContacts"]);
    case "clear_orders": {
      const token = parsed.args[0] ?? "selected";
      const fleets = token === "all" ? ctx.state.fleets : [resolveFleetToken(ctx, token, context)];
      for (const fleet of fleets) {
        fleet.currentTacticalOrder = null;
        fleet.currentTargetId = null;
        fleet.currentTargetKind = null;
        fleet.combatStatus = "idle";
      }
      return changedResult(ctx, `Cleared orders on ${fleets.length} fleet(s).`, ["fleets"]);
    }
    case "clear_fleet_movement": {
      const token = parsed.args[0] ?? "selected";
      const fleets = token === "all" ? ctx.state.fleets : [resolveFleetToken(ctx, token, context)];
      for (const fleet of fleets) clearFleetMovementNow(ctx, fleet);
      return changedResult(ctx, `Stopped ${fleets.length} fleet(s).`, ["fleets", "visibility"]);
    }
    case "clear_planet_queue": {
      const token = parsed.args[0] ?? "selected";
      const owner = resolvePerspectiveOwner(context, perspective);
      const planets = token === "all_owned"
        ? ctx.state.planetStates.filter((planet) => ctx.state.starOwnership[planet.starId] === owner)
        : [resolvePlanetToken(ctx, token, context)];
      for (const planet of planets) planet.constructionQueue = [];
      ctx.refreshFactionEconomyDeltas();
      return changedResult(ctx, `Cleared ${planets.length} planet queue(s).`, ["planetStates", "factionEconomies"]);
    }
    case "clear_starbase_queue": {
      const token = parsed.args[0] ?? "selected";
      const owner = resolvePerspectiveOwner(context, perspective);
      const starbases = token === "all_owned"
        ? ctx.state.starbases.filter((starbase) => starbase.ownerId === owner)
        : [resolveStarbaseToken(ctx, token, context)];
      for (const starbase of starbases) {
        starbase.constructionQueue = [];
        starbase.shipQueue = [];
      }
      ctx.refreshFactionEconomyDeltas();
      return changedResult(ctx, `Cleared ${starbases.length} starbase queue(s).`, ["starbases", "factionEconomies"]);
    }
    case "discover": {
      const owner = resolveOwnerToken(ctx, parsed.args[0], context, perspective);
      const target = parsed.args[1] ?? "current";
      const jumps = integerArg(commandOption(parsed, "jumps") ?? parsed.args[2] ?? "0", "jumps", 0, ctx.state.stars.length);
      const current = new Set(ctx.state.discoveredByFaction[String(owner)] ?? []);
      const addSystem = (starId: number) => {
        current.add(starId);
        if (jumps > 0) {
          for (const visible of computeVisibleStarIds(ctx.state.adjacency, starId, jumps)) current.add(visible);
        }
      };
      if (target === "all") {
        ctx.state.stars.forEach((_, starId) => current.add(starId));
      } else {
        addSystem(resolveSystemToken(ctx, target, context));
      }
      ctx.state.discoveredByFaction[String(owner)] = Array.from(current).sort((a, b) => a - b);
      ctx.refreshDiscovery();
      return changedResult(ctx, "Discovery updated.", ["visibility"]);
    }
    case "forget": {
      const owner = resolveOwnerToken(ctx, parsed.args[0], context, perspective);
      const target = parsed.args[1] ?? "current";
      if (target === "all") {
        ctx.state.discoveredByFaction[String(owner)] = [];
      } else {
        const starId = resolveSystemToken(ctx, target, context);
        ctx.state.discoveredByFaction[String(owner)] = (ctx.state.discoveredByFaction[String(owner)] ?? []).filter((id) => id !== starId);
      }
      ctx.refreshDiscovery();
      return changedResult(ctx, "Discovery removed.", ["visibility"]);
    }
    case "reveal_all": {
      const owner = resolveOwnerToken(ctx, parsed.args[0], context, perspective);
      ctx.state.discoveredByFaction[String(owner)] = ctx.state.stars.map((_, index) => index);
      ctx.refreshDiscovery();
      return changedResult(ctx, "All systems revealed.", ["visibility"]);
    }
    case "reset_visibility": {
      const owner = resolveOwnerToken(ctx, parsed.args[0], context, perspective);
      const faction = ctx.state.factions.find((candidate) => candidate.id === owner);
      ctx.state.discoveredByFaction[String(owner)] = faction ? Array.from(computeVisibleStarIds(ctx.state.adjacency, faction.homeStarId, DISCOVERY_JUMPS)) : [];
      ctx.refreshDiscovery();
      return changedResult(ctx, "Visibility reset.", ["visibility"]);
    }
    case "own_system": {
      const starId = resolveSystemToken(ctx, parsed.args[0], context);
      const ownerToken = parsed.args[1] ?? "me";
      ctx.state.starOwnership[starId] = ownerToken === "none" ? -1 : resolveOwnerToken(ctx, ownerToken, context, perspective);
      ctx.recalculatePlanetEconomies();
      ctx.refreshFactionEconomyDeltas();
      ctx.refreshDiscovery();
      return changedResult(ctx, `System ${starId} ownership changed.`, ["visibility", "planetStates", "factionEconomies"]);
    }
    case "set_home_system": {
      const owner = resolveOwnerToken(ctx, parsed.args[0], context, perspective);
      const starId = resolveSystemToken(ctx, parsed.args[1], context);
      const faction = ctx.state.factions.find((candidate) => candidate.id === owner);
      if (!faction) throw new Error("Faction not found.");
      faction.homeStarId = starId;
      ctx.refreshDiscovery();
      return changedResult(ctx, `Faction ${owner} home system set to ${starId}.`, ["visibility"]);
    }
    case "add_resource":
    case "set_resource": {
      const owner = resolveOwnerToken(ctx, parsed.args[0], context, perspective);
      const resource = parsed.args[1] as ResourceKind | "all" | undefined;
      const amount = numberArg(parsed.args[2], "amount");
      const economy = ctx.state.factionEconomies.find((candidate) => candidate.factionId === owner);
      if (!economy) throw new Error("Economy not found.");
      const resources = resource === "all" ? RESOURCE_KINDS : [resource as ResourceKind];
      for (const kind of resources) {
        if (!RESOURCE_KINDS.includes(kind)) throw new Error("Invalid resource.");
        economy.stockpiles[kind] = name === "add_resource" ? economy.stockpiles[kind] + amount : amount;
      }
      ctx.refreshFactionEconomyDeltas();
      return changedResult(ctx, "Resources updated.", ["factionEconomies"]);
    }
    case "trigger_event": {
      const owner = resolveOwnerToken(ctx, parsed.args[0], context, perspective);
      const eventId = parsed.args[1];
      if (!eventId || !getEventDefinition(eventId)) throw new Error("Unknown event id.");
      const eventContext = eventId === LEADER_OFFER_EVENT_ID ? buildLeaderOfferContext(ctx, owner) : undefined;
      if (!queueFactionEvent(ctx, owner, eventId, eventContext)) throw new Error("Failed to queue event.");
      return changedResult(ctx, `Queued event ${eventId}.`, ["events"]);
    }
    case "set_situation": {
      const owner = resolveOwnerToken(ctx, parsed.args[0], context, perspective);
      const resource = parsed.args[1] as ResourceKind;
      if (!RESOURCE_KINDS.includes(resource)) throw new Error("Invalid resource.");
      const progress = numberArg(parsed.args[2], "progress", 0, 100);
      const instanceId = situationInstanceId(SHORTAGE_SITUATION_ID, owner, resource);
      const existing = ctx.state.situations.find((candidate) => candidate.id === instanceId);
      if (existing) {
        existing.progress = progress;
        existing.lastThreshold = Math.max(existing.lastThreshold, progress);
      } else {
        ctx.state.situations.push({
          id: instanceId,
          defId: SHORTAGE_SITUATION_ID,
          factionId: owner,
          subject: resource,
          progress,
          startedAtYear: ctx.state.clock.year,
          lastThreshold: progress,
        });
      }
      ctx.recalculatePlanetEconomies();
      ctx.refreshFactionEconomyDeltas();
      return changedResult(ctx, `Shortage(${resource}) progress set to ${progress}.`, ["situations", "factionEconomies"]);
    }
    case "lose_fleet": {
      const fleet = resolveFleetToken(ctx, parsed.args[0] ?? "selected", context);
      const days = parsed.args[1] ? numberArg(parsed.args[1], "days", 0) : 60;
      if (!sendFleetMissing(ctx, fleet.id, days)) throw new Error("Fleet cannot be sent missing.");
      ctx.refreshDiscovery();
      return changedResult(ctx, "Fleet sent missing in transit.", ["fleets", "visibility"]);
    }
    case "complete_planet_queue": {
      const token = parsed.args[0] ?? "selected";
      const owner = resolvePerspectiveOwner(context, perspective);
      const planets = token === "all_owned" ? ctx.state.planetStates.filter((planet) => ctx.state.starOwnership[planet.starId] === owner) : [resolvePlanetToken(ctx, token, context)];
      for (const planet of planets) {
        const result = progressPlanetConstructionQueue(
          planet,
          1_000_000,
          getPlanetDistrictLimitsFromState(ctx.state, planet),
          getPlanetTechnologyModifiers(ctx.state, planet),
          getPlanetSpeciesContext(ctx.state, planet),
        );
        Object.assign(planet, result.state);
      }
      applyPlanetStatesToStars(ctx.state.stars, ctx.state.planetStates);
      ctx.refreshFactionEconomyDeltas();
      return changedResult(ctx, `Completed ${planets.length} planet queue(s).`, ["planetStates", "factionEconomies", "habitedPlanetSystems"]);
    }
    case "complete_starbase_queue": {
      const token = parsed.args[0] ?? "selected";
      const owner = resolvePerspectiveOwner(context, perspective);
      const starbases = token === "all_owned" ? ctx.state.starbases.filter((starbase) => starbase.ownerId === owner) : [resolveStarbaseToken(ctx, token, context)];
      for (const starbase of starbases) {
        const result = progressStarbaseConstructionQueue(starbase, 1_000_000);
        Object.assign(starbase, normalizeStarbase(result.starbase));
        starbase.shipQueue = [];
      }
      ctx.refreshFactionEconomyDeltas();
      return changedResult(ctx, `Completed ${starbases.length} starbase queue(s).`, ["starbases", "factionEconomies"]);
    }
    case "set_population":
    case "add_population": {
      const planet = resolvePlanetToken(ctx, parsed.args[0], context);
      const amount = numberArg(parsed.args[1], "population", name === "set_population" ? 0 : Number.NEGATIVE_INFINITY);
      planet.population = name === "add_population" ? Math.max(0, planet.population + amount) : amount;
      const ownerId = ctx.state.starOwnership[planet.starId] ?? -1;
      const foundingSpeciesId = ctx.state.factions.find((faction) => faction.id === ownerId)?.foundingSpeciesId ?? HUMAN_SPECIES_ID;
      planet.speciesPopulations = [{ speciesId: foundingSpeciesId, population: planet.population }];
      const recalculated = recalculatePlanetStateEconomy(
        planet,
        getPlanetDistrictLimitsFromState(ctx.state, planet),
        getPlanetTechnologyModifiers(ctx.state, planet),
        getPlanetSpeciesContext(ctx.state, planet),
      );
      Object.assign(planet, recalculated);
      applyPlanetStatesToStars(ctx.state.stars, ctx.state.planetStates);
      ctx.refreshFactionEconomyDeltas();
      return changedResult(ctx, "Population updated.", ["planetStates", "factionEconomies", "habitedPlanetSystems"]);
    }
    case "set_habitability": {
      const planet = resolvePlanetToken(ctx, parsed.args[0], context);
      planet.habitability = numberArg(parsed.args[1], "habitability", 0, 100);
      Object.assign(planet, recalculatePlanetStateEconomy(planet, getPlanetDistrictLimitsFromState(ctx.state, planet), getPlanetTechnologyModifiers(ctx.state, planet), getPlanetSpeciesContext(ctx.state, planet)));
      ctx.refreshFactionEconomyDeltas();
      return changedResult(ctx, "Habitability updated.", ["planetStates", "factionEconomies"]);
    }
    case "set_stability": {
      const planet = resolvePlanetToken(ctx, parsed.args[0], context);
      const value = numberArg(parsed.args[1], "stability", 0, 100);
      planet.modifiers = [
        ...planet.modifiers.filter((modifier) => modifier.id !== "admin-stability"),
        { id: "admin-stability", label: "Admin Stability", source: "Admin", target: "stability", operation: "add", value: value - 50 },
      ];
      Object.assign(planet, recalculatePlanetStateEconomy(planet, getPlanetDistrictLimitsFromState(ctx.state, planet), getPlanetTechnologyModifiers(ctx.state, planet), getPlanetSpeciesContext(ctx.state, planet)));
      ctx.refreshFactionEconomyDeltas();
      return changedResult(ctx, "Stability test modifier updated.", ["planetStates", "factionEconomies"]);
    }
    case "build_district_now": {
      const planet = resolvePlanetToken(ctx, parsed.args[0], context);
      const district = parsed.args[1] as DistrictKind;
      if (!isDistrictKind(district)) throw new Error("Invalid district.");
      planet.builtDistricts[district] += 1;
      Object.assign(planet, recalculatePlanetStateEconomy(planet, getPlanetDistrictLimitsFromState(ctx.state, planet), getPlanetTechnologyModifiers(ctx.state, planet), getPlanetSpeciesContext(ctx.state, planet)));
      applyPlanetStatesToStars(ctx.state.stars, ctx.state.planetStates);
      ctx.refreshFactionEconomyDeltas();
      return changedResult(ctx, "District built.", ["planetStates", "factionEconomies"]);
    }
    case "build_planet_building_now": {
      const planet = resolvePlanetToken(ctx, parsed.args[0], context);
      const area = parsed.args[1] as BuildingSlotArea;
      const slotIndex = integerArg(parsed.args[2], "slot index", 0);
      const building = parsed.args[3] as BuildingKind;
      if (!BUILDING_KINDS.includes(building)) throw new Error("Invalid building.");
      if (area === "urbanSubDistrict") {
        const subIndex = integerArg(parsed.args[4], "sub-district index", 0);
        const sub = planet.urbanSubDistricts[subIndex];
        if (!sub || !isValidSlotIndex(slotIndex, sub.buildings.length)) throw new Error("Invalid urban slot.");
        sub.buildings[slotIndex] = building;
      } else {
        if (!isDistrictKind(area) || !isValidSlotIndex(slotIndex, planet.buildings[area].length)) throw new Error("Invalid building slot.");
        planet.buildings[area][slotIndex] = building;
      }
      Object.assign(planet, recalculatePlanetStateEconomy(planet, getPlanetDistrictLimitsFromState(ctx.state, planet), getPlanetTechnologyModifiers(ctx.state, planet), getPlanetSpeciesContext(ctx.state, planet)));
      ctx.refreshFactionEconomyDeltas();
      return changedResult(ctx, "Building built.", ["planetStates", "factionEconomies"]);
    }
    case "set_active_tech": {
      const ownerId = resolveOwnerToken(ctx, parsed.args[0], context, perspective);
      const techId = resolveTechnologyToken(parsed.args[1]);
      const tech = TECHNOLOGY_BY_ID[techId];
      const techState = getFactionTechnology(ctx.state, ownerId);
      if (!techState) throw new Error("Faction technology ctx.state unavailable.");
      if (isTechnologyCompleted(techState, techId)) throw new Error(`${tech.name} is already completed.`);
      const missing = getMissingPrerequisites(tech, techState);
      if (missing.length > 0) {
        throw new Error(`Missing prerequisites: ${missing.map((id) => TECHNOLOGY_BY_ID[id]?.name ?? id).join(", ")}.`);
      }
      techState.activeTechId = techId;
      return changedTechnologyResult(ctx, `Active research set to ${tech.name}.`, false, adminRowsForTechnologies(ctx, ownerId, techId));
    }
    case "add_tech_progress": {
      const ownerId = resolveOwnerToken(ctx, parsed.args[0], context, perspective);
      const techId = resolveTechnologyToken(parsed.args[1]);
      const amount = numberArg(parsed.args[2], "research progress", 0);
      const tech = TECHNOLOGY_BY_ID[techId];
      const techState = getFactionTechnology(ctx.state, ownerId);
      if (!techState) throw new Error("Faction technology ctx.state unavailable.");
      if (isTechnologyCompleted(techState, techId)) {
        return { message: `${tech.name} is already completed.`, rows: adminRowsForTechnologies(ctx, ownerId, techId) };
      }
      const progress = techState.progressByTechId[techId] ?? createEmptyTechProgress();
      progress.activeProgress = Math.min(tech.cost, progress.activeProgress + amount);
      progress.totalProgress = Math.min(tech.cost, progress.totalProgress + amount);
      progress.completed = false;
      techState.progressByTechId[techId] = progress;
      const completed = progress.totalProgress >= tech.cost - 0.000001 && completeTechnology(techState, techId);
      ensureActiveTechnology(techState);
      return changedTechnologyResult(ctx, `Added ${Math.round(amount)} progress to ${tech.name}.`, completed, adminRowsForTechnologies(ctx, ownerId, techId));
    }
    case "complete_tech": {
      const ownerId = resolveOwnerToken(ctx, parsed.args[0], context, perspective);
      const techId = resolveTechnologyToken(parsed.args[1]);
      const tech = TECHNOLOGY_BY_ID[techId];
      const techState = getFactionTechnology(ctx.state, ownerId);
      if (!techState) throw new Error("Faction technology ctx.state unavailable.");
      const completed = completeTechnology(techState, techId);
      ensureActiveTechnology(techState);
      return changedTechnologyResult(ctx, `${tech.name} completed.`, completed, adminRowsForTechnologies(ctx, ownerId, techId));
    }
    case "create_design":
    case "set_design_modules": {
      const isCreate = name === "create_design";
      const owner = isCreate ? resolveOwnerToken(ctx, parsed.args[0], context, perspective) : 0;
      const design = isCreate ? null : ctx.state.shipDesigns.find((candidate) => candidate.id === parsed.args[0]);
      if (!isCreate && !design) throw new Error("Design not found.");
      const shipKind = (isCreate ? parsed.args[1] : design!.shipKind) as StarbaseShipKind;
      if (!isKnownShipKind(shipKind)) throw new Error("Invalid ship kind.");
      const utilityOption = commandOption(parsed, "utility");
      const utilityModuleIds = utilityOption === "null" ? [] : splitList(utilityOption);
      const normalized = normalizeShipDesign({
        id: design?.id ?? ctx.createRuntimeId("design", [owner, shipKind]),
        ownerId: design?.ownerId ?? owner,
        shipKind,
        name: commandOption(parsed, "name") ?? design?.name ?? "Admin Design",
        status: "active",
        weaponSectionModuleIds: splitList(commandOption(parsed, "weapon_sections")),
        defenseSectionModuleIds: splitList(commandOption(parsed, "defense_sections")),
        weaponModuleIds: splitList(commandOption(parsed, "weapons")),
        defenseModuleIds: splitList(commandOption(parsed, "defenses")),
        utilityModuleIds,
        utilityModuleId: utilityModuleIds[0] ?? null,
        createdAtYear: design?.createdAtYear ?? ctx.state.clock.year,
        updatedAtYear: ctx.state.clock.year,
      }, design?.ownerId ?? owner, ctx.state.clock.year);
      const hull = SHIP_HULL_DEFINITIONS[normalized.shipKind];
      const layout = getShipDesignLayout(normalized);
      if (
        normalized.weaponSectionModuleIds.length !== hull.weaponSectionSlots
        || normalized.defenseSectionModuleIds.length !== hull.defenseSectionSlots
        || normalized.weaponModuleIds.length !== layout.weaponSlots.length
        || normalized.defenseModuleIds.length !== layout.defenseSlots.length
        || normalized.utilityModuleIds.length !== layout.utilitySlots.length
      ) {
        throw new Error("Design module counts do not match hull slots.");
      }
      if (design) ctx.state.shipDesigns = ctx.state.shipDesigns.map((candidate) => candidate.id === design.id ? normalized : candidate);
      else ctx.state.shipDesigns.push(normalized);
      const shipsChanged = syncShipsForDesign(ctx, ctx.state, normalized);
      return changedResult(ctx, "Ship design updated.", shipsChanged ? ["shipDesigns", "ships", "fleets"] : ["shipDesigns"], [{ id: normalized.id, owner: normalized.ownerId, name: normalized.name }]);
    }
    case "clone_design": {
      const source = ctx.state.shipDesigns.find((design) => design.id === parsed.args[0]);
      if (!source) throw new Error("Design not found.");
      const owner = resolveOwnerToken(ctx, parsed.args[1], context, perspective);
      const clone = normalizeShipDesign({
        ...source,
        id: ctx.createRuntimeId("design", [owner, source.shipKind]),
        ownerId: owner,
        name: commandOption(parsed, "name") ?? `${source.name} Copy`,
        createdAtYear: ctx.state.clock.year,
        updatedAtYear: ctx.state.clock.year,
      }, owner, ctx.state.clock.year);
      ctx.state.shipDesigns.push(clone);
      return changedResult(ctx, "Ship design cloned.", ["shipDesigns"], [{ id: clone.id, owner: clone.ownerId, name: clone.name }]);
    }
    case "delete_design": {
      const designId = parsed.args[0];
      const before = ctx.state.shipDesigns.length;
      ctx.state.shipDesigns = ctx.state.shipDesigns.filter((design) => design.id !== designId);
      if (ctx.state.shipDesigns.length === before) throw new Error("Design not found.");
      return changedResult(ctx, "Ship design deleted.", ["shipDesigns"]);
    }
    case "create_fleet": {
      const starId = resolveSystemToken(ctx, parsed.args[0], context);
      const owner = resolveOwnerToken(ctx, parsed.args[1], context, perspective);
      const { position } = parseSystemPosition(parsed.args, 2, systemCenterPosition());
      const fleet = createFleet(ctx, owner, starId, [], ctx.createRuntimeId("fleet", [owner, starId]));
      fleet.systemPosition = position;
      ctx.state.fleets.push(fleet);
      return changedResult(ctx, "Empty fleet created. Add ships to keep it after membership sync.", ["fleets", "visibility"], adminRowsForFleets([fleet]));
    }
    case "create_ship": {
      const target = parsed.args[0] ?? "current";
      const owner = resolveOwnerToken(ctx, parsed.args[1], context, perspective);
      const designToken = parsed.args[2] ?? "default";
      const count = integerArg(commandOption(parsed, "count") ?? "1", "count", 1, 1000);
      let fleet = target === "selected" ? resolveFleetToken(ctx, target, context) : ctx.state.fleets.find((candidate) => candidate.id === target) ?? null;
      let starId = fleet?.currentStarId ?? resolveSystemToken(ctx, target, context);
      const { position } = parseSystemPosition(parsed.args, 3, fleet?.systemPosition ?? systemCenterPosition());
      if (!fleet || fleet.ownerId !== owner) {
        fleet = createFleet(ctx, owner, starId, [], ctx.createRuntimeId("fleet", [owner, starId]));
        fleet.systemPosition = position;
        ctx.state.fleets.push(fleet);
      }
      const design = resolveShipDesign(ctx.state.shipDesigns, owner, "corvette", designToken === "default" ? undefined : designToken, ctx.state.clock.year);
      const ships = Array.from({ length: count }, () => createShipFromDesign(ctx, owner, fleet!.id, design));
      ctx.state.ships.push(...ships);
      syncFleetMembership(ctx, ctx.state);
      return changedResult(ctx, `Created ${count} ship(s).`, ["ships", "fleets", "visibility"], adminRowsForFleets([fleet]));
    }
    case "delete_ship": {
      const ship = resolveShipToken(ctx, parsed.args[0], context);
      ctx.state.ships = ctx.state.ships.filter((candidate) => candidate.id !== ship.id);
      syncFleetMembership(ctx, ctx.state);
      return changedResult(ctx, "Ship deleted.", ["ships", "fleets", "visibility"]);
    }
    case "delete_fleet": {
      const fleet = resolveFleetToken(ctx, parsed.args[0], context);
      ctx.state.ships = ctx.state.ships.filter((ship) => ship.fleetId !== fleet.id);
      ctx.state.fleets = ctx.state.fleets.filter((candidate) => candidate.id !== fleet.id);
      return changedResult(ctx, "Fleet deleted.", ["ships", "fleets", "visibility"]);
    }
    case "kill_ship": {
      const ship = resolveShipToken(ctx, parsed.args[0], context);
      ship.shield = 0; ship.armor = 0; ship.hull = 0; ship.hp = 0;
      removeDestroyedShips(ctx);
      return changedResult(ctx, "Ship killed.", ["ships", "fleets", "visibility"]);
    }
    case "kill_fleet": {
      const fleet = resolveFleetToken(ctx, parsed.args[0], context);
      for (const ship of ctx.state.ships.filter((candidate) => candidate.fleetId === fleet.id)) {
        ship.shield = 0; ship.armor = 0; ship.hull = 0; ship.hp = 0;
      }
      removeDestroyedShips(ctx);
      return changedResult(ctx, "Fleet killed.", ["ships", "fleets", "visibility"]);
    }
    case "repair_ship": {
      repairShip(resolveShipToken(ctx, parsed.args[0], context));
      return changedResult(ctx, "Ship repaired.", ["ships", "fleets"]);
    }
    case "repair_fleet": {
      const fleet = resolveFleetToken(ctx, parsed.args[0], context);
      for (const ship of ctx.state.ships.filter((candidate) => candidate.fleetId === fleet.id)) repairShip(ship);
      return changedResult(ctx, "Fleet repaired.", ["ships", "fleets"]);
    }
    case "damage_ship": {
      const ship = resolveShipToken(ctx, parsed.args[0], context);
      const layer = parsed.args[1];
      if (!isHealthLayer(layer)) throw new Error("Invalid health layer.");
      damageShipLayer(ship, layer, parsed.args[2] ?? "0");
      removeDestroyedShips(ctx);
      return changedResult(ctx, "Ship damaged.", ["ships", "fleets", "visibility"]);
    }
    case "damage_fleet": {
      const fleet = resolveFleetToken(ctx, parsed.args[0], context);
      const layer = parsed.args[1];
      if (!isHealthLayer(layer)) throw new Error("Invalid health layer.");
      for (const ship of ctx.state.ships.filter((candidate) => candidate.fleetId === fleet.id)) damageShipLayer(ship, layer, parsed.args[2] ?? "0");
      removeDestroyedShips(ctx);
      return changedResult(ctx, "Fleet damaged.", ["ships", "fleets", "visibility"]);
    }
    case "set_ship_health": {
      const ship = resolveShipToken(ctx, parsed.args[0], context);
      const shield = commandOption(parsed, "shield");
      const armor = commandOption(parsed, "armor");
      const hull = commandOption(parsed, "hull");
      if (shield) ship.shield = parseLayerValue(shield, ship.maxShield);
      if (armor) ship.armor = parseLayerValue(armor, ship.maxArmor);
      if (hull) { ship.hull = parseLayerValue(hull, ship.maxHull); ship.hp = ship.hull; }
      removeDestroyedShips(ctx);
      return changedResult(ctx, "Ship health set.", ["ships", "fleets", "visibility"]);
    }
    case "set_fleet_health": {
      const fleet = resolveFleetToken(ctx, parsed.args[0], context);
      for (const ship of ctx.state.ships.filter((candidate) => candidate.fleetId === fleet.id)) {
        const shield = commandOption(parsed, "shield");
        const armor = commandOption(parsed, "armor");
        const hull = commandOption(parsed, "hull");
        if (shield) ship.shield = parseLayerValue(shield, ship.maxShield);
        if (armor) ship.armor = parseLayerValue(armor, ship.maxArmor);
        if (hull) { ship.hull = parseLayerValue(hull, ship.maxHull); ship.hp = ship.hull; }
      }
      removeDestroyedShips(ctx);
      return changedResult(ctx, "Fleet health set.", ["ships", "fleets", "visibility"]);
    }
    case "move_fleet": {
      const fleet = resolveFleetToken(ctx, parsed.args[0], context);
      const starId = resolveSystemToken(ctx, parsed.args[1], context);
      const { position } = parseSystemPosition(parsed.args, 2, getDefaultMoveDestination(ctx, starId).position);
      startMoveOrder(ctx, fleet, starId, position);
      return changedResult(ctx, "Fleet move order started.", ["clock", "fleets", "visibility"]);
    }
    case "teleport_fleet": {
      const fleet = resolveFleetToken(ctx, parsed.args[0], context);
      const starId = resolveSystemToken(ctx, parsed.args[1], context);
      const { position } = parseSystemPosition(parsed.args, 2, systemCenterPosition());
      clearFleetMovementNow(ctx, fleet);
      fleet.currentStarId = starId;
      fleet.route = [starId];
      fleet.systemPosition = position;
      ctx.refreshDiscovery();
      return changedResult(ctx, "Fleet teleported.", ["fleets", "visibility"]);
    }
    case "set_fleet_position": {
      const fleet = resolveFleetToken(ctx, parsed.args[0], context);
      const { position } = parseSystemPosition(parsed.args, 1, fleet.systemPosition);
      clearFleetMovementNow(ctx, fleet);
      fleet.systemPosition = position;
      return changedResult(ctx, "Fleet position set.", ["fleets"]);
    }
    case "set_fleet_owner": {
      const fleet = resolveFleetToken(ctx, parsed.args[0], context);
      const owner = resolveOwnerToken(ctx, parsed.args[1], context, perspective);
      fleet.ownerId = owner;
      for (const ship of ctx.state.ships.filter((candidate) => candidate.fleetId === fleet.id)) ship.ownerId = owner;
      ctx.refreshDiscovery();
      return changedResult(ctx, "Fleet owner set.", ["ships", "fleets", "visibility"]);
    }
    case "split_fleet": {
      const fleet = resolveFleetToken(ctx, parsed.args[0], context);
      const spec = parsed.args[1];
      const sourceShips = ctx.state.ships.filter((ship) => ship.fleetId === fleet.id);
      const movingIds = spec?.includes(",")
        ? new Set(splitList(spec))
        : new Set(sourceShips.slice(0, integerArg(spec, "split count", 1, sourceShips.length - 1)).map((ship) => ship.id));
      const newFleet = createFleet(ctx, fleet.ownerId, fleet.currentStarId, [], ctx.createRuntimeId("fleet", [fleet.ownerId, fleet.currentStarId]));
      newFleet.systemPosition = { ...fleet.systemPosition, x: fleet.systemPosition.x + 2 };
      ctx.state.fleets.push(newFleet);
      for (const ship of sourceShips) if (movingIds.has(ship.id)) ship.fleetId = newFleet.id;
      syncFleetMembership(ctx, ctx.state);
      return changedResult(ctx, "Fleet split.", ["ships", "fleets", "visibility"], adminRowsForFleets([fleet, newFleet]));
    }
    case "merge_fleets": {
      const target = resolveFleetToken(ctx, parsed.args[0], context);
      const sourceIds = splitList(parsed.args[1]);
      for (const ship of ctx.state.ships) {
        if (sourceIds.includes(ship.fleetId)) ship.fleetId = target.id;
      }
      ctx.state.fleets = ctx.state.fleets.filter((fleet) => !sourceIds.includes(fleet.id));
      syncFleetMembership(ctx, ctx.state);
      return changedResult(ctx, "Fleets merged.", ["ships", "fleets", "visibility"]);
    }
    case "set_cooldowns": {
      const id = parsed.args[0] === "selected" ? context?.selectedFleetId : parsed.args[0];
      const value = parsed.args[1] === "ready" ? 0 : numberArg(parsed.args[1], "cooldown hours", 0);
      const fleet = id ? ctx.state.fleets.find((candidate) => candidate.id === id) : null;
      const ship = id ? ctx.state.ships.find((candidate) => candidate.id === id) : null;
      const starbase = id ? ctx.state.starbases.find((candidate) => candidate.id === id) : null;
      if (fleet) for (const fleetShip of ctx.state.ships.filter((candidate) => candidate.fleetId === fleet.id)) fleetShip.weaponCooldowns = Object.fromEntries(Object.keys(fleetShip.weaponCooldowns ?? {}).map((key) => [key, value]));
      else if (ship) ship.weaponCooldowns = Object.fromEntries(Object.keys(ship.weaponCooldowns ?? {}).map((key) => [key, value]));
      else if (starbase) starbase.weaponCooldowns = Object.fromEntries(Object.keys(starbase.weaponCooldowns ?? {}).map((key) => [key, value]));
      else throw new Error("Cooldown target not found.");
      return changedResult(ctx, "Cooldowns updated.", ["ships", "starbases"]);
    }
    case "set_fleet_doctrine": {
      const fleet = resolveFleetToken(ctx, parsed.args[0], context);
      const stance = commandOption(parsed, "stance");
      const behavior = commandOption(parsed, "behavior");
      const chase = commandOption(parsed, "chase");
      const retreat = commandOption(parsed, "retreat");
      if (stance) fleet.combatStance = normalizeCombatStance(stance);
      fleet.combatSettings = createDefaultFleetCombatSettings({
        ...fleet.combatSettings,
        behavior: isFleetBehavior(behavior) ? behavior : fleet.combatSettings.behavior,
        chasePolicy: isFleetChasePolicy(chase) ? chase : fleet.combatSettings.chasePolicy,
        retreatPolicy: isFleetRetreatPolicy(retreat) ? retreat : fleet.combatSettings.retreatPolicy,
      });
      return changedResult(ctx, "Fleet doctrine updated.", ["fleets"]);
    }
    case "set_retreat_destination": {
      const fleet = resolveFleetToken(ctx, parsed.args[0], context);
      const kind = parsed.args[1];
      if (kind === "nearest_friendly_starbase" || kind === "nearestFriendlyStarbase") {
        fleet.combatSettings.retreatDestination = { kind: "nearestFriendlyStarbase" };
      } else if (kind === "selected_system" || kind === "selectedSystem") {
        fleet.combatSettings.retreatDestination = { kind: "selectedSystem", targetStarId: resolveSystemToken(ctx, parsed.args[2], context) };
      } else {
        throw new Error("Invalid retreat destination.");
      }
      return changedResult(ctx, "Retreat destination updated.", ["fleets"]);
    }
    case "order_fleet": {
      const fleet = resolveFleetToken(ctx, parsed.args[0], context);
      const order = parsed.args[1];
      if (order === "hold" || order === "retreat") {
        fleet.currentTacticalOrder = { type: order, issuedAtYear: ctx.state.clock.year };
      } else if (order === "attack") {
        const targetId = parsed.args[2];
        const targetKind = ctx.state.starbases.some((starbase) => starbase.id === targetId) ? "starbase" : "fleet";
        fleet.currentTacticalOrder = { type: "attack", targetId, targetKind, issuedAtYear: ctx.state.clock.year };
      } else if (order === "guard" || order === "move") {
        const { position } = parseSystemPosition(parsed.args, 2, fleet.systemPosition);
        fleet.currentTacticalOrder = order === "guard"
          ? { type: "guard", guardPosition: position, issuedAtYear: ctx.state.clock.year }
          : { type: "move", targetPosition: position, issuedAtYear: ctx.state.clock.year };
      } else {
        throw new Error("Invalid fleet order.");
      }
      return changedResult(ctx, "Fleet order issued.", ["fleets"]);
    }
    case "clear_order": {
      const fleet = resolveFleetToken(ctx, parsed.args[0], context);
      fleet.currentTacticalOrder = null;
      fleet.currentTargetId = null;
      fleet.currentTargetKind = null;
      return changedResult(ctx, "Fleet order cleared.", ["fleets"]);
    }
    case "start_duel": {
      const starId = resolveSystemToken(ctx, parsed.args[0], context);
      const ownerA = resolveOwnerToken(ctx, parsed.args[1], context, perspective);
      const ownerB = resolveOwnerToken(ctx, parsed.args[2], context, perspective);
      const distance = numberArg(commandOption(parsed, "distance") ?? "40", "distance", 1);
      const countA = integerArg(commandOption(parsed, "countA") ?? "1", "countA", 1, 1000);
      const countB = integerArg(commandOption(parsed, "countB") ?? "1", "countB", 1, 1000);
      const center = systemCenterPosition();
      const left = { x: center.x - distance / 2, y: SYSTEM_FLEET_Y, z: center.z };
      const right = { x: center.x + distance / 2, y: SYSTEM_FLEET_Y, z: center.z };
      const fleetA = createAdminFleetWithShips(ctx, ownerA, starId, commandOption(parsed, "designA"), countA, left);
      const fleetB = createAdminFleetWithShips(ctx, ownerB, starId, commandOption(parsed, "designB"), countB, right);
      fleetA.currentTacticalOrder = { type: "attack", targetId: fleetB.id, targetKind: "fleet", issuedAtYear: ctx.state.clock.year };
      fleetB.currentTacticalOrder = { type: "attack", targetId: fleetA.id, targetKind: "fleet", issuedAtYear: ctx.state.clock.year };
      ctx.refreshDiscovery();
      return changedResult(ctx, "Duel started.", ["ships", "fleets", "visibility"], adminRowsForFleets([fleetA, fleetB]));
    }
    case "spawn_encounter": {
      const scenario = parsed.args[0];
      const starId = resolveSystemToken(ctx, parsed.args[1], context);
      const ownerA = resolvePerspectiveOwner(context, perspective);
      const ownerB = (ownerA + 1) % Math.max(1, ctx.state.factions.length);
      if (scenario === "artillery_vs_starbase") {
        const fleet = createAdminFleetWithShips(ctx, ownerA, starId, undefined, 6, { x: -48, y: SYSTEM_FLEET_Y, z: 0 });
        fleet.combatSettings.behavior = "artillery";
        ctx.state.starbases = ctx.state.starbases.filter((starbase) => starbase.starId !== starId);
        ctx.state.starbases.push(createAdminStarbase(ctx, starId, ownerB, "starbase", getSystemStarbasePosition()));
      } else if (scenario === "swarm_vs_line") {
        const a = createAdminFleetWithShips(ctx, ownerA, starId, undefined, 16, { x: -30, y: SYSTEM_FLEET_Y, z: 0 });
        const b = createAdminFleetWithShips(ctx, ownerB, starId, undefined, 10, { x: 30, y: SYSTEM_FLEET_Y, z: 0 });
        a.combatSettings.behavior = "swarm"; b.combatSettings.behavior = "line";
      } else if (scenario === "retreat_test") {
        const a = createAdminFleetWithShips(ctx, ownerA, starId, undefined, 4, { x: -22, y: SYSTEM_FLEET_Y, z: 0 });
        const b = createAdminFleetWithShips(ctx, ownerB, starId, undefined, 12, { x: 22, y: SYSTEM_FLEET_Y, z: 0 });
        a.combatSettings.retreatPolicy = "high"; b.combatSettings.behavior = "brawler";
      } else if (scenario === "orbit_defense") {
        ctx.state.starbases.push(createAdminStarbase(ctx, starId, ownerA, "starbase", getSystemStarbasePosition()));
        createAdminFleetWithShips(ctx, ownerB, starId, undefined, 8, { x: 44, y: SYSTEM_FLEET_Y, z: 0 });
      } else {
        createAdminFleetWithShips(ctx, ownerA, starId, undefined, 5, { x: -26, y: SYSTEM_FLEET_Y, z: 0 });
        createAdminFleetWithShips(ctx, ownerB, starId, undefined, 5, { x: 26, y: SYSTEM_FLEET_Y, z: 0 });
      }
      ctx.refreshDiscovery();
      return changedResult(ctx, `Encounter ${scenario} spawned.`, ["ships", "fleets", "starbases", "visibility"]);
    }
    case "force_attack": {
      const fleet = resolveFleetToken(ctx, parsed.args[0], context);
      const targetId = parsed.args[1];
      const targetKind = ctx.state.starbases.some((starbase) => starbase.id === targetId) ? "starbase" : "fleet";
      fleet.currentTacticalOrder = { type: "attack", targetId, targetKind, issuedAtYear: ctx.state.clock.year };
      return changedResult(ctx, "Force attack order set.", ["fleets"]);
    }
    case "stop_combat": {
      const token = parsed.args[0] ?? "selected";
      const fleets = token === "all"
        ? ctx.state.fleets
        : token === "system"
          ? ctx.state.fleets.filter((fleet) => fleet.currentStarId === resolveCurrentStarId(ctx, context))
          : [resolveFleetToken(ctx, token, context)];
      for (const fleet of fleets) {
        fleet.currentTacticalOrder = null;
        fleet.currentTargetId = null;
        fleet.currentTargetKind = null;
        fleet.combatStatus = "idle";
      }
      return changedResult(ctx, "Combat ctx.state cleared.", ["fleets"]);
    }
    case "set_weapon_cooldown": {
      const id = parsed.args[0];
      const mount = parsed.args[1] ?? "all";
      const value = parsed.args[2] === "ready" ? 0 : numberArg(parsed.args[2], "cooldown hours", 0);
      const ship = ctx.state.ships.find((candidate) => candidate.id === id);
      const starbase = ctx.state.starbases.find((candidate) => candidate.id === id);
      if (ship) {
        const mounts = calculateShipDesignStats(getShipDesignForShip(ctx, ship)).combat.weaponMounts;
        const keys = mount === "all"
          ? mounts.map((m, index) => `${index}:${getWeaponId(m)}`)
          : (() => {
            const mountIndex = integerArg(mount, "mount index", 0, mounts.length - 1);
            return [`${mountIndex}:${getWeaponId(mounts[mountIndex])}`];
          })();
        ship.weaponCooldowns = { ...(ship.weaponCooldowns ?? {}) };
        for (const key of keys) ship.weaponCooldowns[key] = value;
      } else if (starbase) {
        const mounts = getStarbaseWeaponMounts(starbase);
        const keys = mount === "all"
          ? mounts.map((m, index) => `${index}:${getWeaponId(m)}`)
          : (() => {
            const mountIndex = integerArg(mount, "mount index", 0, mounts.length - 1);
            return [`${mountIndex}:${getWeaponId(mounts[mountIndex])}`];
          })();
        starbase.weaponCooldowns = { ...(starbase.weaponCooldowns ?? {}) };
        for (const key of keys) starbase.weaponCooldowns[key] = value;
      } else {
        throw new Error("Weapon cooldown target not found.");
      }
      return changedResult(ctx, "Weapon cooldown updated.", ["ships", "starbases"]);
    }
    case "effect_test":
    case "fire_test_contact": {
      const sourceId = name === "effect_test" ? parsed.args[1] : parsed.args[0];
      const targetId = name === "effect_test" ? parsed.args[2] : parsed.args[1];
      const sourceFleet = ctx.state.fleets.find((fleet) => fleet.id === sourceId);
      const sourceStarbase = ctx.state.starbases.find((starbase) => starbase.id === sourceId);
      const targetFleet = ctx.state.fleets.find((fleet) => fleet.id === targetId);
      const targetStarbase = ctx.state.starbases.find((starbase) => starbase.id === targetId);
      const sourcePosition = sourceFleet?.systemPosition ?? sourceStarbase?.systemPosition;
      const targetPosition = targetFleet?.systemPosition ?? targetStarbase?.systemPosition;
      if (!sourcePosition || !targetPosition) throw new Error("Source or target not found.");
      const hitMode = name === "effect_test" ? "hit" : parsed.args[3] ?? "hit";
      ctx.state.recentCombatContacts.push({
        id: ctx.createRuntimeId("contact", [sourceId, targetId]),
        year: ctx.state.clock.year,
        sourceId,
        sourceKind: sourceFleet ? "fleet" : "starbase",
        sourceOwnerId: sourceFleet?.ownerId ?? sourceStarbase!.ownerId,
        targetId,
        targetKind: targetFleet ? "fleet" : "starbase",
        targetOwnerId: targetFleet?.ownerId ?? targetStarbase!.ownerId,
        weaponId: name === "effect_test" ? parsed.args[0] : parsed.args[2],
        weaponName: name === "effect_test" ? parsed.args[0] : parsed.args[2],
        hit: hitMode === "hit",
        accuracyMiss: hitMode === "miss",
        dodged: hitMode === "dodge",
        shieldDamage: hitMode === "hit" ? 10 : 0,
        armorDamage: 0,
        hullDamage: 0,
        targetDestroyed: false,
        sourcePosition,
        targetPosition,
      });
      ctx.state.recentCombatContacts = ctx.state.recentCombatContacts.slice(-RECENT_COMBAT_CONTACT_HISTORY);
      return changedResult(ctx, "Test contact added.", ["combatContacts"]);
    }
    case "create_starbase": {
      const starId = resolveSystemToken(ctx, parsed.args[0], context);
      const owner = resolveOwnerToken(ctx, parsed.args[1], context, perspective);
      const level = (commandOption(parsed, "level") ?? parsed.args[2] ?? "outpost") as StarbaseLevel;
      if (!STARBASE_LEVEL_DEFINITIONS[level]) throw new Error("Invalid starbase level.");
      ctx.state.starbases = ctx.state.starbases.filter((starbase) => starbase.starId !== starId);
      const starbase = createAdminStarbase(ctx, starId, owner, level);
      ctx.state.starbases.push(starbase);
      ctx.state.starOwnership[starId] = owner;
      syncSystemOwnershipFromStarbases(ctx.state);
      ctx.recalculatePlanetEconomies();
      ctx.refreshFactionEconomyDeltas();
      ctx.refreshDiscovery();
      return changedResult(ctx, "Starbase created.", ["starbases", "planetStates", "factionEconomies", "visibility"], [{ id: starbase.id, owner, system: starId, level }]);
    }
    case "delete_starbase": {
      const starbase = resolveStarbaseToken(ctx, parsed.args[0], context);
      ctx.state.starbases = ctx.state.starbases.filter((candidate) => candidate.id !== starbase.id);
      syncSystemOwnershipFromStarbases(ctx.state);
      ctx.recalculatePlanetEconomies();
      ctx.refreshFactionEconomyDeltas();
      ctx.refreshDiscovery();
      return changedResult(ctx, "Starbase deleted.", ["starbases", "planetStates", "factionEconomies", "visibility"]);
    }
    case "upgrade_starbase_now": {
      const starbase = resolveStarbaseToken(ctx, parsed.args[0], context);
      const level = (parsed.args[1] ?? STARBASE_LEVEL_DEFINITIONS[starbase.level].upgrade?.targetLevel ?? starbase.level) as StarbaseLevel;
      if (!STARBASE_LEVEL_DEFINITIONS[level]) throw new Error("Invalid starbase level.");
      Object.assign(starbase, syncStarbaseCombatHealth({ ...starbase, level, economy: calculateStarbaseEconomy(level, starbase.buildingSlots), constructionQueue: [] }));
      return changedResult(ctx, "Starbase upgraded.", ["starbases", "factionEconomies"]);
    }
    case "set_starbase_position": {
      const starbase = resolveStarbaseToken(ctx, parsed.args[0], context);
      const { position } = parseSystemPosition(parsed.args, 1, starbase.systemPosition);
      starbase.systemPosition = position;
      return changedResult(ctx, "Starbase position set.", ["starbases"]);
    }
    case "repair_starbase": {
      const starbase = resolveStarbaseToken(ctx, parsed.args[0], context);
      starbase.shield = starbase.maxShield;
      starbase.armor = starbase.maxArmor;
      starbase.hull = starbase.maxHull;
      starbase.weaponCooldowns = {};
      return changedResult(ctx, "Starbase repaired.", ["starbases"]);
    }
    case "damage_starbase": {
      const starbase = resolveStarbaseToken(ctx, parsed.args[0], context);
      const layer = parsed.args[1];
      if (!isHealthLayer(layer)) throw new Error("Invalid health layer.");
      const apply = (key: "shield" | "armor" | "hull", maxKey: "maxShield" | "maxArmor" | "maxHull") => {
        const amount = (parsed.args[2] ?? "0").endsWith("%")
          ? Number((parsed.args[2] ?? "0").slice(0, -1)) / 100 * starbase[maxKey]
          : Number(parsed.args[2] ?? "0");
        starbase[key] = clamp(starbase[key] - Math.max(0, amount), 0, starbase[maxKey]);
      };
      if (layer === "shield" || layer === "all") apply("shield", "maxShield");
      if (layer === "armor" || layer === "all") apply("armor", "maxArmor");
      if (layer === "hull" || layer === "all") apply("hull", "maxHull");
      return changedResult(ctx, "Starbase damaged.", ["starbases"]);
    }
    case "set_starbase_health": {
      const starbase = resolveStarbaseToken(ctx, parsed.args[0], context);
      const shield = commandOption(parsed, "shield");
      const armor = commandOption(parsed, "armor");
      const hull = commandOption(parsed, "hull");
      if (shield) starbase.shield = parseLayerValue(shield, starbase.maxShield);
      if (armor) starbase.armor = parseLayerValue(armor, starbase.maxArmor);
      if (hull) starbase.hull = parseLayerValue(hull, starbase.maxHull);
      return changedResult(ctx, "Starbase health set.", ["starbases"]);
    }
    case "add_starbase_building": {
      const starbase = resolveStarbaseToken(ctx, parsed.args[0], context);
      const slotIndex = integerArg(parsed.args[1], "slot index", 0, starbase.buildingSlots.length - 1);
      const building = parsed.args[2] as StarbaseBuildingKind;
      if (!isStarbaseBuildingKind(building)) throw new Error("Invalid starbase building.");
      starbase.buildingSlots[slotIndex] = building;
      starbase.economy = calculateStarbaseEconomy(starbase.level, starbase.buildingSlots);
      ctx.refreshFactionEconomyDeltas();
      return changedResult(ctx, "Starbase building added.", ["starbases", "factionEconomies"]);
    }
    case "remove_starbase_building": {
      const starbase = resolveStarbaseToken(ctx, parsed.args[0], context);
      const slotIndex = integerArg(parsed.args[1], "slot index", 0, starbase.buildingSlots.length - 1);
      starbase.buildingSlots[slotIndex] = null;
      starbase.economy = calculateStarbaseEconomy(starbase.level, starbase.buildingSlots);
      ctx.refreshFactionEconomyDeltas();
      return changedResult(ctx, "Starbase building removed.", ["starbases", "factionEconomies"]);
    }
    default:
      throw new Error(`Command "${name}" is registered but not implemented.`);
  }
}
