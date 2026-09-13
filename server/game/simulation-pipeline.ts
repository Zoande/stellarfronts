import type { ServerUpdateField } from "../../src/game/GameProtocol";
import type { RuntimeContext } from "./types";

export interface SimulationStepEffects {
  changed?: ServerUpdateField[];
  dirty?: boolean;
  planetDetailIds?: string[];
}

export interface SimulationStep {
  name: string;
  run: () => SimulationStepEffects;
}

/**
 * Executes simulation phases in declaration order and folds their effects into
 * one deterministic result. Domain processors remain independently testable
 * and do not need to know how the runtime queues detail refreshes.
 */
export function runSimulationPipeline(
  ctx: RuntimeContext,
  steps: readonly SimulationStep[],
): Set<ServerUpdateField> {
  const changed = new Set<ServerUpdateField>();
  const detailIds = new Set<string>();
  for (const step of steps) {
    const effects = step.run();
    for (const field of effects.changed ?? []) changed.add(field);
    for (const planetId of effects.planetDetailIds ?? []) detailIds.add(planetId);
    if (effects.dirty) ctx.hasDirtyState = true;
  }
  for (const planetId of detailIds) ctx.queuePlanetDetailRefresh(planetId);
  return changed;
}
