import { writeFileSync } from "node:fs";
import { createHeadlessGame } from "./headless-game";
import { prepareScenario, scriptedActions } from "./simulation-scenarios";
import { campaignStep } from "./campaign-schedule";
import { campaignSample } from "./active-lab";

/** Small scripted fixtures measure schedule error; they are not natural wars. */
export function calibrateCampaign(output: string) {
  const comparisons = [];
  for (const scenario of ["idle-economy", "construction-research", "expansion", "combat-repair"] as const) {
    const checkpoint = prepareScenario(scenario, { worldSeed: 19, simulationSeed: 71, initialWorld: { starCount: 8, factionCount: 2 } });
    const runs = [];
    for (const schedule of ["production", "adaptive"] as const) {
      const game = createHeadlessGame({ checkpoint, stepMs: schedule === "production" ? 100 : 24000 });
      for (const action of scriptedActions(scenario, 0, game.observe(0))) {
        const outcome = game.act(game.createAiActor(0), action);
        if (!outcome.ok) throw new Error(`${scenario}: ${outcome.message}`);
      }
      const start = performance.now(), duration = 24000;
      let elapsed = 0, ticks = 0;
      const reasons: Record<string, number> = {};
      while (elapsed < duration) {
        const next = schedule === "production" ? { ms: 100, reason: "production" } : campaignStep(game.diagnosticState(), 24000, 24000);
        const ms = Math.min(next.ms, duration - elapsed);
        game.step(ms); elapsed += ms; ticks++; reasons[next.reason] = (reasons[next.reason] ?? 0) + 1;
      }
      runs.push({ schedule, ticks, runtimeMs: performance.now() - start, reasons, sample: campaignSample(game.diagnosticState(), [], elapsed / 24000),
        shipHealth: game.diagnosticState().ships.map((ship) => ({ id: ship.id, hull: ship.hull, armor: ship.armor, shield: ship.shield })),
        combatReports: game.diagnosticState().combatReports, digest: game.digest() });
    }
    const [reference, accelerated] = runs;
    const resourceErrors = reference.sample.factions.map((faction) => ({ factionId: faction.id,
      stockpileErrors: Object.fromEntries(Object.entries(faction.stockpiles).map(([resource, amount]) => [resource,
        accelerated.sample.factions.find((entry) => entry.id === faction.id)!.stockpiles[resource as keyof typeof faction.stockpiles] - amount])),
      populationError: accelerated.sample.factions.find((entry) => entry.id === faction.id)!.population - faction.population }));
    comparisons.push({ scenario, runs, resourceErrors, identicalCombat: JSON.stringify(reference.shipHealth) === JSON.stringify(accelerated.shipHealth)
      && JSON.stringify(reference.combatReports) === JSON.stringify(accelerated.combatReports) });
  }
  writeFileSync(output, JSON.stringify({ note: "One-game-day scripted fixtures, including combat. This measures local schedule error, not full campaign equivalence.", comparisons }, null, 2));
  return comparisons;
}
