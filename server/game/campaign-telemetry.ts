import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { GameState } from "./types";
import { calculateFactionResourceFlow } from "./economy-market";

/** Observer recorder never passes authoritative state to an AI controller. */
export function createCampaignTelemetry(output: string, initial: Readonly<GameState>) {
  const file = (name: string) => path.join(output, name + ".jsonl");
  for (const name of ["economies", "planets", "development", "market", "performance", "decisions"]) writeFileSync(file(name), "");
  const write = (name: string, value: unknown) => appendFileSync(file(name), JSON.stringify(value) + "\n");
  let ships = new Map(initial.ships.map((ship) => [ship.id, ship.ownerId]));
  let colonies = new Map(initial.planetStates.map((planet) => [planet.id, { owner: planet.ownerId, inhabited: planet.isHabited }]));
  const completed = new Set(initial.factionTechnologies.flatMap((tech) => tech.completedTechIds.map((id) => `${tech.factionId}:${id}`)));
  function projectSnapshot(state: Readonly<GameState>) {
    return new Map([...state.planetStates, ...state.starbases].flatMap((site) => [...site.constructionQueue, ...("defense" in site ? site.defense.shipQueue : site.shipQueue)]
      .map((item) => [item.id, { siteId: site.id, ownerId: site.ownerId, ...item }] as const)));
  }
  let projects = projectSnapshot(initial);
  let battles = new Map(initial.groundBattles.map((battle) => [battle.id, { ...battle }]));
  let armies = new Map(initial.armies.map((army) => [army.id, army.ownerId]));
  const transactions = new WeakSet<object>(initial.market.transactions);
  const milestones: Record<number, Record<string, number>> = {};
  const decisionCounts: Record<number, { total: number; idle: number; sustainableTrade: number; recovery: number }> = {};
  function milestone(factionId: number, event: string, day: number) { (milestones[factionId] ??= {})[event] ??= day; }
  return {
    decision: (day: number, record: import("./ai-diagnostics").AiDecisionRecord) => {
      write("decisions", { day, ...record });
      const counts = decisionCounts[record.factionId] ??= { total: 0, idle: 0, sustainableTrade: 0, recovery: 0 };
      counts.total++; if (!record.selected.length) counts.idle++; if (record.trade.sustainable) counts.sustainableTrade++;
      if (record.selected.some((action) => ["setPlanetJobLock", "setPlanetBuildingEnabled"].includes(action.type))) counts.recovery++;
      for (const action of record.selected) milestone(record.factionId, "attempt:" + action.type, day);
    },
    step: (state: Readonly<GameState>, day: number, elapsedDays: number, runtimeMs: number, reason: string) => {
      write("performance", { day, elapsedDays, runtimeMs, reason });
      const currentShips = new Map(state.ships.map((ship) => [ship.id, ship.ownerId]));
      for (const ship of state.ships) if (!ships.has(ship.id)) { write("development", { day, type: "ship-created", ship }); milestone(ship.ownerId, "ship:" + ship.shipKind, day); }
      for (const [id, ownerId] of ships) if (!currentShips.has(id)) write("development", { day, type: "ship-removed", id, ownerId });
      ships = currentShips;
      for (const planet of state.planetStates) {
        const before = colonies.get(planet.id);
        if (before && (before.owner !== planet.ownerId || before.inhabited !== planet.isHabited)) {
          write("development", { day, type: "colony", planetId: planet.id, before, ownerId: planet.ownerId, inhabited: planet.isHabited });
          if (planet.ownerId !== null && planet.isHabited) milestone(planet.ownerId, "new-colony", day);
        }
      }
      colonies = new Map(state.planetStates.map((planet) => [planet.id, { owner: planet.ownerId, inhabited: planet.isHabited }]));
      for (const tech of state.factionTechnologies) for (const techId of tech.completedTechIds) {
        const key = `${tech.factionId}:${techId}`;
        if (!completed.has(key)) { completed.add(key); write("development", { day, type: "technology-completed", factionId: tech.factionId, techId }); milestone(tech.factionId, "technology", day); }
      }
      const nextProjects = projectSnapshot(state);
      for (const [id, project] of nextProjects) if (!projects.has(id)) write("development", { day, type: "project-queued", project });
      for (const [id, project] of projects) if (!nextProjects.has(id)) write("development", { day, type: "project-left-queue", project });
      projects = nextProjects;
      for (const battle of state.groundBattles) if (!battles.has(battle.id)) write("development", { day, type: "ground-battle-started", battle });
      for (const [id, battle] of battles) if (!state.groundBattles.some((entry) => entry.id === id)) write("development", { day, type: "ground-battle-ended", battle });
      battles = new Map(state.groundBattles.map((battle) => [battle.id, { ...battle }]));
      for (const army of state.armies) if (!armies.has(army.id)) write("development", { day, type: "army-created", army });
      for (const [id, ownerId] of armies) if (!state.armies.some((army) => army.id === id)) write("development", { day, type: "army-removed", id, ownerId });
      armies = new Map(state.armies.map((army) => [army.id, army.ownerId]));
      for (const transaction of state.market.transactions) if (!transactions.has(transaction)) { transactions.add(transaction); write("market", { day, ...transaction }); }
    },
    sample: (state: Readonly<GameState>, day: number) => {
      write("economies", { day, factions: state.factionEconomies.map((economy) => ({ ...economy, flow: calculateFactionResourceFlow(state as GameState, economy.factionId),
        market: state.market.playerStats.find((entry) => entry.playerId === economy.factionId),
        technology: state.factionTechnologies.find((entry) => entry.factionId === economy.factionId) })) });
      write("planets", { day, planets: state.planetStates.filter((planet) => planet.isHabited) });
    },
    summary: () => ({ milestones, decisionCounts }),
  };
}
