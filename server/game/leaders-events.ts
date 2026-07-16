import { RESOURCE_KINDS } from "../../src/data/Economy";
import type { PlanetModifier, ResourceCounts } from "../../src/data/Economy";
import { createLegendaryLeaderCandidate, formatLeaderClass, getLeaderArchetypesByFaction } from "../../src/data/Leaders";
import type { LeaderClass, LeaderState } from "../../src/data/Leaders";
import type { GameEffect } from "../../src/data/GameEffects";
import { getEventDefinition, LEADER_OFFER_EVENT_ID, LOST_IN_TRANSIT_EVENT_ID } from "../../src/data/Events";
import type { ActiveEvent } from "../../src/data/Events";
import { getSituationDefinition } from "../../src/data/Situations";
import type { ActiveSituation } from "../../src/data/Situations";
import {
  LOST_IN_TRANSIT_CHANCE_PER_DAY,
  LOST_IN_TRANSIT_MIN_DAYS,
  LOST_IN_TRANSIT_MAX_DAYS,
  LEADER_OFFER_CHANCE_PER_DAY,
} from "./constants";
import { clamp, gameDaysToYears } from "./pure-helpers";
import { computeShortageSeverity, getLeaderDayIndex, getActiveFactionPlanetModifiers } from "./state-queries";
import { SHORTAGE_SITUATION_ID, situationInstanceId } from "../../src/data/Situations";
import { SHORTAGE_PROGRESS_RISE_PER_DAY, SHORTAGE_PROGRESS_FALL_PER_DAY } from "./constants";
import type { GameFleet, GameState, RuntimeContext } from "./types";

export function nextEventInstanceId(ctx: RuntimeContext): string {
  ctx.eventInstanceSeq += 1;
  return `evt-${Date.now().toString(36)}-${ctx.eventInstanceSeq.toString(36)}`;
}

export function probabilityOverDays(chancePerDay: number, elapsedDays: number): number {
  if (chancePerDay <= 0 || elapsedDays <= 0) return 0;
  return 1 - Math.pow(1 - Math.min(1, chancePerDay), elapsedDays);
}

export function resolveEventTokens(template: string, context?: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = context?.[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function fleetDisplayName(fleet: GameFleet): string {
  return `Fleet ${fleet.id.slice(-4).toUpperCase()}`;
}

export function queueFactionEvent(ctx: RuntimeContext, factionId: number, defId: string, context?: Record<string, unknown>): ActiveEvent | null {
  const definition = getEventDefinition(defId);
  if (!definition) return null;
  const event: ActiveEvent = {
    id: nextEventInstanceId(ctx),
    defId,
    factionId,
    createdAtYear: ctx.state.clock.year,
    expiresAtYear: ctx.state.clock.year + gameDaysToYears(definition.timeoutDays),
    title: resolveEventTokens(definition.title, context),
    body: resolveEventTokens(definition.body, context),
    category: definition.category,
    imageUrl: definition.imageUrl,
    choices: definition.choices,
    defaultChoiceId: definition.defaultChoiceId,
    context,
  };
  ctx.state.events.push(event);
  ctx.hasDirtyState = true;
  return event;
}

export function addFactionModifierState(
  ctx: RuntimeContext,
  factionId: number,
  id: string,
  label: string,
  modifiers: PlanetModifier[],
  durationDays: number | null,
): void {
  ctx.state.factionModifiers = ctx.state.factionModifiers.filter((entry) => !(entry.factionId === factionId && entry.id === id));
  ctx.state.factionModifiers.push({
    id,
    factionId,
    label,
    source: `effect:${id}`,
    modifiers,
    expiresAtYear: durationDays !== null ? ctx.state.clock.year + gameDaysToYears(durationDays) : null,
  });
  ctx.hasDirtyState = true;
}

export function expireFactionModifiers(ctx: RuntimeContext): boolean {
  const before = ctx.state.factionModifiers.length;
  ctx.state.factionModifiers = ctx.state.factionModifiers.filter(
    (entry) => entry.expiresAtYear === null || ctx.state.clock.year < entry.expiresAtYear,
  );
  return ctx.state.factionModifiers.length !== before;
}

export function generatePowerfulLeaderCandidate(ctx: RuntimeContext, factionId: number): LeaderState {
  const leaderClass: LeaderClass = Math.random() < 0.5 ? "military" : "civilian";
  const archetypeId = getLeaderArchetypesByFaction(ctx.state.factions, ctx.state.species).get(factionId) ?? "humanoid";
  return createLegendaryLeaderCandidate(
    factionId,
    leaderClass,
    getLeaderDayIndex(ctx.state.clock.year),
    Math.floor(Math.random() * 100000),
    ctx.state.clock.year,
    archetypeId,
  );
}

export function buildLeaderOfferContext(ctx: RuntimeContext, factionId: number): Record<string, unknown> {
  const leader = generatePowerfulLeaderCandidate(ctx, factionId);
  return { leaderName: leader.name, leaderClass: formatLeaderClass(leader.class), leader };
}

export function spawnLeaderFromEffect(ctx: RuntimeContext, factionId: number, effect: Extract<GameEffect, { type: "spawnLeader" }>, context?: Record<string, unknown>): void {
  const offered = context?.leader as LeaderState | undefined;
  const leader: LeaderState = offered
    ? { ...offered, factionId, status: "recruited", recruitedAtYear: ctx.state.clock.year }
    : { ...generatePowerfulLeaderCandidate(ctx, factionId), status: "recruited", recruitedAtYear: ctx.state.clock.year };
  if (effect.bonusLevel && effect.bonusLevel > 0) {
    leader.level = Math.max(leader.level, leader.level + effect.bonusLevel);
  }
  ctx.state.leaders.push(leader);
  ctx.hasDirtyState = true;
}

export function sendFleetMissing(ctx: RuntimeContext, fleetId: string, days: number): boolean {
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet || fleet.phase === "missingInAction") return false;
  const returnStarId = fleet.targetStarId ?? fleet.route[fleet.route.length - 1] ?? fleet.currentStarId;
  fleet.retreatState = {
    mode: "lostInTransit",
    status: "mia",
    targetStarId: returnStarId,
    startedAtYear: ctx.state.clock.year,
    miaUntilYear: ctx.state.clock.year + gameDaysToYears(days),
  };
  fleet.hyperlanePosition = null;
  ctx.setFleetPhase(fleet, "missingInAction");
  ctx.hasDirtyState = true;
  return true;
}

// The single place GameEffects mutate the world. Callers that need immediate
// economy feedback (player decisions) recalc afterwards; the tick path lets the
// next economy pass pick changes up.
export function applyGameEffects(ctx: RuntimeContext, factionId: number, effects: GameEffect[], context?: Record<string, unknown>): void {
  for (const effect of effects) {
    switch (effect.type) {
      case "addResource": {
        const economy = ctx.state.factionEconomies.find((e) => e.factionId === factionId) ?? null;
        if (economy) {
          economy.stockpiles[effect.resource] = Math.max(0, (economy.stockpiles[effect.resource] ?? 0) + effect.amount);
          ctx.hasDirtyState = true;
        }
        break;
      }
      case "factionModifier":
        addFactionModifierState(ctx, factionId, effect.id, effect.label, effect.modifiers, effect.durationDays ?? null);
        break;
      case "clearFactionModifier":
        ctx.state.factionModifiers = ctx.state.factionModifiers.filter((entry) => !(entry.factionId === factionId && entry.id === effect.id));
        ctx.hasDirtyState = true;
        break;
      case "triggerEvent":
        queueFactionEvent(ctx, factionId, effect.eventId, context);
        break;
      case "spawnLeader":
        spawnLeaderFromEffect(ctx, factionId, effect, context);
        break;
      case "fleetMissing":
        sendFleetMissing(ctx, effect.fleetId, effect.days);
        break;
      case "adjustSituation": {
        const situation = ctx.state.situations.find((candidate) => candidate.id === effect.situationId && candidate.factionId === factionId);
        if (situation) {
          const max = getSituationDefinition(situation.defId)?.max ?? 100;
          situation.progress = clamp(situation.progress + effect.delta, 0, max);
          ctx.hasDirtyState = true;
        }
        break;
      }
      case "notify":
        // Notifications are derived client-side from situations/events; nothing to persist.
        break;
      case "disbandShipsFraction": {
        const factionShips = ctx.state.ships.filter((s) => s.ownerId === factionId);
        const toDisband = Math.floor(factionShips.length * effect.fraction);
        if (toDisband > 0) {
          const shuffled = [...factionShips].sort(() => Math.random() - 0.5);
          const disbanded = new Set(shuffled.slice(0, toDisband).map((s) => s.id));
          ctx.state.ships = ctx.state.ships.filter((s) => !disbanded.has(s.id));
          for (const fleet of ctx.state.fleets) {
            if (fleet.ownerId !== factionId) continue;
            fleet.shipIds = fleet.shipIds.filter((id) => !disbanded.has(id));
          }
          ctx.hasDirtyState = true;
        }
        break;
      }
      case "clearContextSituation": {
        const situationId = context?.situationId as string | undefined;
        if (situationId) {
          ctx.state.situations = ctx.state.situations.filter((s) => s.id !== situationId);
          ctx.hasDirtyState = true;
        }
        break;
      }
    }
  }
}

export function fireSituationThresholds(ctx: RuntimeContext, situation: ActiveSituation, previousProgress: number): boolean {
  const definition = getSituationDefinition(situation.defId);
  if (!definition) return false;
  let changed = false;
  for (const threshold of definition.thresholds) {
    if (previousProgress < threshold.at && situation.progress >= threshold.at) {
      applyGameEffects(ctx, situation.factionId, threshold.effects, { resource: situation.subject, situationId: situation.id });
      changed = true;
    }
  }
  if (situation.progress > situation.lastThreshold) situation.lastThreshold = situation.progress;
  return changed;
}

export function processRandomEvents(ctx: RuntimeContext, elapsedGameDays: number): boolean {
  if (elapsedGameDays <= 0) return false;
  let changed = false;

  const lostChance = probabilityOverDays(LOST_IN_TRANSIT_CHANCE_PER_DAY, elapsedGameDays);
  for (const fleet of ctx.state.fleets) {
    if (fleet.phase !== "jumpingHyperlane") continue;
    if (Math.random() >= lostChance) continue;
    const days = LOST_IN_TRANSIT_MIN_DAYS + Math.random() * (LOST_IN_TRANSIT_MAX_DAYS - LOST_IN_TRANSIT_MIN_DAYS);
    if (sendFleetMissing(ctx, fleet.id, days)) {
      queueFactionEvent(ctx, fleet.ownerId, LOST_IN_TRANSIT_EVENT_ID, { fleetName: fleetDisplayName(fleet) });
      changed = true;
    }
  }

  const offerChance = probabilityOverDays(LEADER_OFFER_CHANCE_PER_DAY, elapsedGameDays);
  for (const faction of ctx.state.factions) {
    if (Math.random() >= offerChance) continue;
    if (ctx.state.events.some((event) => event.factionId === faction.id && event.defId === LEADER_OFFER_EVENT_ID)) continue;
    queueFactionEvent(ctx, faction.id, LEADER_OFFER_EVENT_ID, buildLeaderOfferContext(ctx, faction.id));
    changed = true;
  }

  if (changed) ctx.hasDirtyState = true;
  return changed;
}

export function resolveActiveEvent(ctx: RuntimeContext, event: ActiveEvent, choiceId: string): void {
  const choice = event.choices.find((candidate) => candidate.id === choiceId)
    ?? event.choices.find((candidate) => candidate.id === event.defaultChoiceId);
  ctx.state.events = ctx.state.events.filter((candidate) => candidate.id !== event.id);
  if (choice) applyGameEffects(ctx, event.factionId, choice.effects, event.context);
  ctx.hasDirtyState = true;
}

export function processEventTimeouts(ctx: RuntimeContext): boolean {
  let changed = false;
  for (const event of [...ctx.state.events]) {
    if (ctx.state.clock.year >= event.expiresAtYear) {
      resolveActiveEvent(ctx, event, event.defaultChoiceId);
      changed = true;
    }
  }
  return changed;
}
