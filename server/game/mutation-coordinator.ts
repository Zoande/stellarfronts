import type { ClientCommand, ServerUpdateField } from "../../src/game/GameProtocol";
import type { RuntimeContext } from "./types";

export const SPECIALIZED_OR_READ_ONLY_COMMANDS = new Set<ClientCommand["type"]>([
  "join",
  "adminCommand",
  "requestDetails",
  "subscribeDetails",
  "unsubscribeDetails",
]);

export interface MutationEffects {
  changed?: ServerUpdateField[];
  recalculatePlanets?: boolean;
  refreshFactionEconomy?: boolean;
  refreshDiscovery?: boolean;
  refreshIntelligence?: boolean;
  planetDetailIds?: string[];
  dirty?: boolean;
}

export type CommandOutcome =
  | { ok: true; message?: string; effects: MutationEffects }
  | { ok: false; message: string };

/**
 * The central persistence invariant for authoritative commands. Domain handlers
 * may reject or produce no change, but a successful mutating command can no
 * longer forget to make its resulting state durable.
 */
export function runAuthoritativeCommand(
  ctx: RuntimeContext,
  command: ClientCommand,
  execute: () => CommandOutcome,
): void {
  const outcome = execute();
  if (!outcome.ok) return;
  applyMutationEffects(ctx, {
    ...outcome.effects,
    dirty: !SPECIALIZED_OR_READ_ONLY_COMMANDS.has(command.type)
      ? outcome.effects.dirty
      : false,
  });
}

/** Apply the common cross-domain aftermath in one deterministic order. */
export function applyMutationEffects(ctx: RuntimeContext, effects: MutationEffects): void {
  if (effects.recalculatePlanets) ctx.recalculatePlanetEconomies();
  if (effects.refreshFactionEconomy) ctx.refreshFactionEconomyDeltas();
  if (effects.refreshDiscovery) ctx.refreshDiscovery();
  if (effects.refreshIntelligence) ctx.refreshIntelligence();
  for (const planetId of effects.planetDetailIds ?? []) ctx.queuePlanetDetailRefresh(planetId);
  if (effects.dirty !== false) ctx.hasDirtyState = true;
  if (effects.changed?.length) ctx.broadcastUpdates(Array.from(new Set(effects.changed)));
}
